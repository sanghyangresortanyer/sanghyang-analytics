/**
 * Memasukkan hasil render Crawl4AI listing Google Maps restoran, bar, dan spa pesaing (pipelines/grounding/render_pages.py)
 * ke DB kerja lokal dan lib/market/review-topics.data.json: rating dan jumlah ulasan listing (dengan OCC) serta topik
 * ulasan. Isi ulasan tidak diambil karena tampilan terbatas tidak menampilkan bintang per ulasan.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/ingest-crawl4ai-venues.ts <folder output grounding> [--apply]
 *
 * Tanpa --apply hanya mencetak perubahan yang akan dibuat.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import type { ReviewTopics } from "@/lib/market/competitor-comparison";
import { parseRenderedListing } from "@/lib/market/crawl4ai-venue";
import { loadVenueReviewTargets } from "@/lib/market/scrape-new-reviews";
import { assertLocalWorkDatabase } from "./local-db-guard";

const TOPICS_FILE = path.resolve(process.cwd(), "src/lib/market/review-topics.data.json");
const RATING_SOURCE = "Google Maps (tampilan terbatas)";

interface RenderedRow {
  url: string;
  markdown: string;
  rendered_at: string;
  status: number;
}

async function main() {
  const [outputDir] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!outputDir) throw new Error("Pemakaian: ingest-crawl4ai-venues.ts <folder output grounding> [--apply]");
  const apply = process.argv.includes("--apply");
  if (apply) assertLocalWorkDatabase();
  const rows = readFileSync(path.join(outputDir, "rendered", "index.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RenderedRow);
  const targets = new Map((await loadVenueReviewTargets()).map((t) => [t.mapsUrl, t]));
  const topics: Record<string, ReviewTopics> = {};
  const unavailable: string[] = [];
  let ratingUpdates = 0;

  for (const row of rows) {
    const target = targets.get(row.url);
    if (!target || row.status !== 200) continue;
    const listing = parseRenderedListing(readFileSync(path.join(outputDir, row.markdown), "utf8"));
    if (!listing) {
      unavailable.push(target.name);
      continue;
    }
    if (listing.topics.length) topics[target.name] = { url: row.url, observedAt: row.rendered_at, topics: listing.topics };
    const current = await db.competitor.findUnique({ where: { id: target.competitorId }, select: { rating: true, reviewCount: true, version: true } });
    if (!current) throw new Error(`baris Competitor ${target.name} tidak ada`);
    const changed = Number(current.rating ?? NaN) !== listing.rating || current.reviewCount !== listing.reviewCount;
    console.log(
      `- ${target.name}: rating ${listing.rating} dari ${listing.reviewCount} ulasan` +
        `${changed ? ` (sebelumnya ${current.rating ?? "-"} dari ${current.reviewCount ?? "-"})` : " (tidak berubah)"}, ${listing.topics.length} topik`,
    );
    if (!apply || !changed) continue;
    const updated = await db.competitor.updateMany({
      where: { id: target.competitorId, version: current.version },
      data: {
        rating: listing.rating,
        reviewCount: listing.reviewCount,
        ratingSource: RATING_SOURCE,
        ratingSourceUrl: row.url,
        ratingObservedAt: new Date(row.rendered_at),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error(`konflik versi saat memperbarui ${target.name}; baca ulang lalu jalankan lagi`);
    ratingUpdates += 1;
  }

  if (apply && Object.keys(topics).length) {
    const file = JSON.parse(readFileSync(TOPICS_FILE, "utf8")) as { $comment: string; places: Record<string, ReviewTopics> };
    file.places = { ...file.places, ...topics };
    writeFileSync(TOPICS_FILE, `${JSON.stringify(file, null, 2)}\n`);
  }
  console.log(
    `[crawl4ai-venue] ${rows.length} listing dirender: topik ${Object.keys(topics).length} tempat, rating diperbarui ${ratingUpdates}` +
      `${apply ? "" : " (uji kering)"}; panel tidak tersedia: ${unavailable.join(", ") || "-"}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
