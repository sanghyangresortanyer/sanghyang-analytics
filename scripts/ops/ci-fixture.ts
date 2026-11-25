/**
 * Baseline basis data untuk CI: salinan tabel hasil crawl nyata dari DB kerja lokal, supaya tes di tests/unit yang
 * membaca registri, promo, ulasan, fakta, tarif, dan riwayat pembaruan juga bisa jalan di DB CI yang baru dimigrasi.
 * Isinya data asli tanpa karangan; yang dikecualikan hanya data internal pemilik (omset, tujuan bulanan, potret
 * bulanan) dan isi penuh artikel berita (kolom content), karena tidak ada tes yang membacanya.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/ci-fixture.ts export
 *   node --env-file-if-exists=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/ci-fixture.ts load [--rebase-days N | --no-rebase]
 *
 * export hanya membaca DB kerja lokal (127.0.0.1:55432). load hanya menulis ke host loopback dan menolak tabel yang
 * sudah berisi, jadi tidak pernah menimpa data yang ada.
 *
 * Jendela waktu bergulir (berita 30 hari, promo 60 hari, jendela 40 hari di tes) bisa basi bila fixture dimuat lama
 * sesudah diekspor. load menggeser semua kolom waktu dan tanggal sebanyak hari bulat yang sama sehingga pengamatan
 * terbaru jatuh pada hari pemuatan; selisih antarbaris tidak berubah. Salinan di repo tidak pernah digeser.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { assertLocalWorkDatabase } from "./local-db-guard";

const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures/ci-db");
const DAY_MS = 86_400_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

interface FixtureTable {
  table: string;
  /** Subquery sumber baris; default seluruh tabel. */
  select?: string;
  /** Kolom yang tidak diekspor; terisi NULL saat dimuat. */
  omit?: string[];
}

/** Urutan memuat mengikuti kunci asing. */
export const FIXTURE_TABLES: FixtureTable[] = [
  { table: "Source" },
  { table: "Article", select: 'SELECT * FROM "Article" WHERE id IN (SELECT "articleId" FROM "MarketItem")', omit: ["content"] },
  { table: "MarketItem" },
  { table: "GeoPlace" },
  { table: "Competitor" },
  { table: "CompetitorPriceSnapshot" },
  { table: "SanghyangPriceSnapshot" },
  { table: "CompetitorPromotion" },
  { table: "CompetitorReview" },
  { table: "CompetitorFact" },
  { table: "MarketMacroStat" },
  { table: "MarketInsight" },
  { table: "ScrapeRun" },
  { table: "ScrapeError" },
];

const fileOf = (table: string) => path.join(FIXTURE_DIR, `${table}.json`);
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function exportFixture(): Promise<void> {
  assertLocalWorkDatabase();
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const { table, select, omit = [] } of FIXTURE_TABLES) {
    const source = select ?? `SELECT * FROM ${quote(table)}`;
    const keys = omit.length ? ` - ARRAY[${omit.map((k) => `'${k}'`).join(", ")}]` : "";
    const rows = await db.$queryRawUnsafe<{ json: string }[]>(
      `SELECT coalesce(jsonb_agg(to_jsonb(t)${keys} ORDER BY t.id), '[]'::jsonb)::text AS json FROM (${source}) t`,
    );
    const parsed = JSON.parse(rows[0].json) as unknown[];
    // Satu baris per entri supaya perubahan data terbaca di diff.
    writeFileSync(fileOf(table), `[\n${parsed.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`);
    console.log(`${table}: ${parsed.length} baris`);
  }
}

function assertLoopbackTarget(): void {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || !URL.canParse(raw)) throw new Error("DATABASE_URL kosong atau tidak terbaca sebagai URL.");
  const { hostname } = new URL(raw);
  if (!LOOPBACK_HOSTS.has(hostname)) throw new Error(`Fixture CI hanya dimuat ke basis data di mesin ini, bukan ${hostname}.`);
}

async function assertTargetEmpty(): Promise<void> {
  for (const { table } of FIXTURE_TABLES) {
    const [{ n }] = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${quote(table)}`);
    if (n > 0) throw new Error(`Tabel ${table} sudah berisi ${n} baris; fixture CI hanya dimuat ke basis data kosong.`);
  }
}

const OBSERVATION_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "observedAt",
  "capturedAt",
  "ratingObservedAt",
  "publishedAt",
  "readAt",
  "verifiedAt",
  "lastRunAt",
  "lastSuccessAt",
  "generatedAt",
  "reviewDate",
  "archivedAt",
]);
const FIXED_DATE_COLUMNS = new Set(["MarketMacroStat.period"]);

function parseTimestampUtc(value: string): number {
  return Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
}

/** Hari bulat dari pengamatan terbaru di fixture sampai hari ini; 0 bila fixture masih segar. */
function autoRebaseDays(): number {
  let newest = -Infinity;
  for (const { table } of FIXTURE_TABLES) {
    const rows = JSON.parse(readFileSync(fileOf(table), "utf8")) as Record<string, unknown>[];
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (!OBSERVATION_KEYS.has(key) || typeof value !== "string") continue;
        const ts = parseTimestampUtc(value);
        if (!Number.isFinite(ts)) throw new Error(`Timestamp ${table}.${key} di fixture tidak terbaca: ${value}`);
        if (ts > newest) newest = ts;
      }
    }
  }
  if (!Number.isFinite(newest)) throw new Error("Fixture kosong atau tidak memiliki kolom waktu pengamatan.");
  return Math.max(0, Math.floor((Date.now() - newest) / DAY_MS));
}

async function shiftTimes(days: number): Promise<void> {
  if (days === 0) return;
  for (const { table } of FIXTURE_TABLES) {
    const cols = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('timestamp without time zone', 'timestamp with time zone', 'date')`,
      table,
    );
    const shiftable = cols.filter((c) => !FIXED_DATE_COLUMNS.has(`${table}.${c.column_name}`));
    if (shiftable.length === 0) continue;
    const sets = shiftable.map((c) => `${quote(c.column_name)} = ${quote(c.column_name)} + make_interval(days => ${days})`).join(", ");
    await db.$executeRawUnsafe(`UPDATE ${quote(table)} SET ${sets}`);
  }
  console.log(`Kolom waktu dan tanggal digeser ${days} hari.`);
}

async function loadFixture(args: string[]): Promise<void> {
  assertLoopbackTarget();
  for (const { table } of FIXTURE_TABLES) if (!existsSync(fileOf(table))) throw new Error(`Berkas fixture ${fileOf(table)} tidak ada; jalankan export.`);
  await assertTargetEmpty();

  const flag = args.indexOf("--rebase-days");
  const days = args.includes("--no-rebase") ? 0 : flag >= 0 ? Number(args[flag + 1]) : autoRebaseDays();
  if (!Number.isInteger(days) || days < 0) throw new Error("--rebase-days butuh bilangan bulat tidak negatif.");

  for (const { table } of FIXTURE_TABLES) {
    const json = readFileSync(fileOf(table), "utf8");
    const inserted = await db.$executeRawUnsafe(
      `INSERT INTO ${quote(table)} SELECT * FROM jsonb_populate_recordset(null::${quote(table)}, $1::jsonb)`,
      json,
    );
    console.log(`${table}: ${inserted} baris dimuat`);
  }
  await shiftTimes(days);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "export") await exportFixture();
  else if (mode === "load") await loadFixture(args);
  else throw new Error('Pakai "export" atau "load".');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
