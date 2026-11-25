/**
 * Ulasan Google Maps restoran, bar, dan spa pesaing yang punya listing sendiri (registri, atau data menu untuk outlet di
 * dalam hotel), dibaca dengan identitas perayap jujur SanghyangNewsCrawler/1.0 tanpa login. Google hanya menampilkan
 * 5 ulasan "paling relevan" dan tombol topik untuk tampilan ini; itu yang diambil.
 *
 *   PUPPETEER_NO_SANDBOX=1 python3 .agents/scripts/resource_guard.py --profile e2e -- \
 *     node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/crawl-venue-reviews.ts [--apply] [nama tempat ...]
 *
 * Tanpa --apply hanya membaca dan mencetak. --apply menyimpan ulasan dan rating outlet ke DB kerja lokal (dijaga
 * local-db-guard.ts) serta topik ulasan ke lib/market/review-topics.data.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { localLaunchOptions } from "@/lib/browser-launch";
import type { ReviewTopics } from "@/lib/market/competitor-comparison";
import { loadVenueReviewTargets, readVenueListing, scrapeVenueMapsReviews } from "@/lib/market/scrape-new-reviews";
import { assertLocalWorkDatabase } from "./local-db-guard";

const TOPICS_FILE = path.resolve(process.cwd(), "src/lib/market/review-topics.data.json");

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const only = new Set(args.filter((a) => !a.startsWith("--")));
  if (apply) assertLocalWorkDatabase();
  const targets = (await loadVenueReviewTargets()).filter((t) => only.size === 0 || only.has(t.name));
  console.log(`[ulasan-venue] ${targets.length} tempat dengan listing Google Maps sendiri${apply ? "" : " (baca saja)"}.`);
  const puppeteer = (await import("puppeteer")).default;
  const launch = localLaunchOptions();
  const browser = await puppeteer.launch({ ...launch, args: [...launch.args, "--disable-dev-shm-usage", "--lang=id-ID"] });
  try {
    if (!apply) {
      for (const t of targets) {
        try {
          const page = await readVenueListing(browser, t);
          console.log(`- ${t.name}: rating ${page.rating} dari ${page.reviewCount} ulasan, ${page.reviews.length} kartu, topik: ${page.topics.map((x) => `${x.label} ${x.count}`).join(", ") || "-"}`);
        } catch (error) {
          console.log(`- ${t.name}: GAGAL ${(error as Error).message}`);
          process.exitCode = 1;
        }
      }
      return;
    }
    const run = await scrapeVenueMapsReviews(browser, targets);
    const file = JSON.parse(readFileSync(TOPICS_FILE, "utf8")) as { $comment: string; places: Record<string, ReviewTopics> };
    file.places = { ...file.places, ...run.topics };
    writeFileSync(TOPICS_FILE, `${JSON.stringify(file, null, 2)}\n`);
    console.log(
      `[ulasan-venue] ${run.attempted} tempat: +${run.inserted} ulasan baru, ${run.skipped} sudah ada, topik ${Object.keys(run.topics).length} tempat, rating outlet hotel: ${run.venueRatings.join(", ") || "-"}.`,
    );
    if (run.failures.length) {
      console.log(`[ulasan-venue] gagal:\n  - ${run.failures.join("\n  - ")}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    console.error("[ulasan-venue] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
