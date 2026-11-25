/**
 * Mengosongkan hasil pembacaan berita dengan status tertentu supaya dibaca dan dinilai ulang oleh readCandidateNews
 * (lib/market/news-relevance.ts), misalnya sesudah aturan penilaian diperketat. Hanya kolom hasil bacaan yang
 * dikosongkan; artikel dan item pasarnya tetap. Pengaman tulis lib/db.ts menolak DB jarak jauh kecuali pemilik
 * menjalankannya dengan ALLOW_PRODUCTION_WRITE=1.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/reset-news-readings.ts --status relevan [--dry-run]
 */
import { db } from "@/lib/db";
import type { NewsReadStatus } from "@prisma/client";

const STATUSES: readonly NewsReadStatus[] = ["relevan", "tidak_relevan", "di_luar_radius", "lokasi_tidak_jelas", "tidak_terbaca"];

async function main() {
  const at = process.argv.indexOf("--status");
  const status = STATUSES.find((s) => s === process.argv[at + 1]);
  if (at < 0 || !status) throw new Error(`--status wajib salah satu dari: ${STATUSES.join(", ")}`);
  const rows = await db.marketItem.findMany({ where: { readStatus: status }, select: { id: true, version: true } });
  console.log(`${rows.length} berita berstatus ${status} akan dibaca ulang.`);
  if (process.argv.includes("--dry-run")) return;
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const res = await tx.marketItem.updateMany({
        where: { id: r.id, version: r.version },
        data: { readStatus: null, readAt: null, readNote: null, readSummary: null, outlets: [], articleUrl: null, distanceKm: null, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new Error(`konflik versi saat mengosongkan bacaan berita ${r.id}`);
    }
  });
  console.log("Selesai; jalankan scripts/ops/read-news-backlog.ts untuk membacanya ulang.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
