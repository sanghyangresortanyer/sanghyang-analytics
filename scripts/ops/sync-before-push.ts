/**
 * Dijalankan hook git pre-push mesin kerja ini (scripts/ops/pre-push-sync.sh) sebelum push ke cabang produksi:
 * migrasi yang belum tercatat di DB produksi diterapkan, lalu data produksi dan DB kerja lokal disamakan
 * (sync-production-data.ts). Permintaan pemakai 19 Nov 2026, setelah deploy tampil tanpa data registri pesaing
 * karena data itu hanya pernah diisi di DB lokal.
 *
 * Migrasi yang membuat kode yang sedang berjalan gagal (lihat DESTRUCTIVE) tidak diterapkan di sini: urutan rilisnya
 * kebalikan (kode yang tidak lagi memakainya di-deploy dulu), jadi push dibatalkan dengan petunjuk.
 *
 *   ALLOW_PRODUCTION_WRITE=1 node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/ops/sync-before-push.ts
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDatabaseTarget } from "@/lib/db";
import { createSyncRemoteClient, syncProductionData } from "./sync-production-data";

/**
 * Pernyataan yang membuat kode lama gagal bila migrasinya mendahului deploy kode: menghapus atau mengganti nama skema dan
 * nilai enum, mengubah tipe kolom, mewajibkan isi kolom (SET NOT NULL), menghapus constraint atau indeks yang diandalkan
 * kode lama (mis. target ON CONFLICT), serta menghapus isi tabel. "ON DELETE" pada kunci asing aditif, jadi yang ditangkap
 * hanya DELETE FROM.
 */
const DESTRUCTIVE =
  /\b(DROP\s+(TABLE|COLUMN|TYPE|SCHEMA|CONSTRAINT|INDEX)|RENAME\s+(COLUMN|TO|VALUE)|ALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE|SET\s+NOT\s+NULL|TRUNCATE|DELETE\s+FROM)\b/i;

export const pendingMigrations = (dirs: readonly string[], applied: ReadonlySet<string>) => dirs.filter((d) => !applied.has(d)).sort();

export const destructiveMigrations = (names: readonly string[], readSql: (name: string) => string) => names.filter((n) => DESTRUCTIVE.test(readSql(n)));

async function main() {
  if (getDatabaseTarget() !== "produksi") throw new Error("tujuan sinkron harus DB produksi (jalankan dengan --env-file=.env.local)");
  const dir = path.join(process.cwd(), "prisma/migrations");
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  // Klien bertimeout yang sama dengan sinkron, supaya soket yang macet di sini pun membatalkan push alih-alih menggantung.
  const remote = createSyncRemoteClient();
  const rows = await remote
    .$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    .finally(() => remote.$disconnect());
  const pending = pendingMigrations(dirs, new Set(rows.map((r) => r.migration_name)));
  if (pending.length) {
    const risky = destructiveMigrations(pending, (name) => readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
    if (risky.length) {
      throw new Error(
        `migrasi ${risky.join(", ")} membuat kode yang sedang berjalan gagal atau menghapus data. Urutannya: push kode yang ` +
          "tidak lagi memakainya dengan `git push --no-verify`, tunggu deploy Vercel READY, lalu jalankan migrasi dan " +
          "scripts/ops/sync-production-data.ts --apply. Migrasi yang menghapus isi tabel dijalankan pemilik.",
      );
    }
    console.log(`[pre-push] Menerapkan ${pending.length} migrasi ke produksi: ${pending.join(", ")}`);
    const res = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit", env: process.env });
    if (res.status !== 0) throw new Error("prisma migrate deploy ke produksi gagal");
  }
  await syncProductionData(true);
}

if (process.argv[1]?.endsWith("sync-before-push.ts")) {
  main().catch((error) => {
    console.error(`[pre-push] Push dibatalkan: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
