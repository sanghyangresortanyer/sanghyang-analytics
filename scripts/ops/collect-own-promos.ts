/**
 * Promo Sanghyang sendiri ke CompetitorPromotion: kartu penawaran situs resmi (https://sanghyang.com/offers) dan program
 * bulanan tim marketing (lib/market/own-promos-team.data.json). Idempoten: promo yang sama diperbarui, yang hilang dari
 * situs ditandai berakhir. Juga dijalankan langkah "situs" di pembaruan penuh (lib/market/full-refresh.ts).
 *
 *   PUPPETEER_NO_SANDBOX=1 node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/collect-own-promos.ts
 */
import { db } from "@/lib/db";
import { scrapeOwnOffers } from "@/lib/market/own-promos";

async function main() {
  const site = await scrapeOwnOffers();
  console.log(`[promo-sanghyang] situs resmi: ${site.offers} penawaran (${site.created} baru, ${site.updated} diperbarui, ${site.expired} berakhir).`);
  // Catatan: importTeamPromos dinonaktifkan sesuai permintaan pemilik agar data promo fokus pada data eksternal murni.
}

main()
  .catch((error) => {
    console.error("[promo-sanghyang] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
