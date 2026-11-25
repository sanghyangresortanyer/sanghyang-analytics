/**
 * Arsipkan ulasan ganda (review id Google atau teks sama, sumber sama, tempat sama); teks terlengkap tetap tampil. Tanpa --apply hanya
 * menghitung. Penulisan ke basis data produksi ditolak lib/db.ts kecuali ALLOW_PRODUCTION_WRITE=1 (keputusan pemilik).
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/archive-duplicate-reviews.ts [--apply]
 */
import { db, getDatabaseTarget } from "@/lib/db";
import { findDuplicateReviews } from "@/lib/market/review-duplicates";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await db.competitorReview.findMany({
    where: { archivedAt: null },
    select: { id: true, competitorId: true, source: true, text: true, sourceUrl: true, capturedAt: true },
  });
  const duplicates = findDuplicateReviews(rows);
  console.log(`[ulasan-ganda] basis data ${getDatabaseTarget()}: ${rows.length} ulasan aktif, ${duplicates.length} ganda.`);
  if (!apply || duplicates.length === 0) {
    if (duplicates.length) console.log("[ulasan-ganda] uji kering; jalankan dengan --apply untuk mengarsipkan.");
    return;
  }
  const { count } = await db.competitorReview.updateMany({
    where: { id: { in: duplicates }, archivedAt: null },
    data: { archivedAt: new Date(), version: { increment: 1 } },
  });
  console.log(`[ulasan-ganda] ${count} baris diarsipkan.`);
}

main()
  .catch((error) => {
    console.error("[ulasan-ganda] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
