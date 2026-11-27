/**
 * Tarif kamar booking engine resmi kompetitor (be.dip.id, saat ini Nemuru Grand Anyer Palazo) untuk tanggal check-in hari
 * biasa dan akhir pekan lapisan OTA, lalu tulis src/lib/market/competitor-official-rates.data.json. Berkas hanya ditimpa
 * bila data lolos validasi; bila tidak, data lama dipakai. Dijalankan job GitHub "room-rates" (nightly-market-scrape.yml)
 * setelah crawl-room-rates.ts, dalam commit yang sama. Intinya ada di src/lib/market/competitor-official-rates-refresh.ts.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/ops/crawl-competitor-official-rates.ts
 *   node node_modules/tsx/dist/cli.mjs scripts/ops/crawl-competitor-official-rates.ts --dry
 */
import { refreshCompetitorOfficialRates } from "@/lib/market/competitor-official-rates-refresh";

async function main() {
  const dry = process.argv.includes("--dry");
  const { file, problems, written } = await refreshCompetitorOfficialRates({ dry });
  if (problems.length) {
    console.error(`[tarif-resmi-kompetitor] data tidak dipakai, berkas lama dipertahankan: ${problems.join("; ")}`);
    process.exitCode = 1;
  } else if (dry) {
    console.log(JSON.stringify(file, null, 2));
  } else if (written) {
    console.log(`[tarif-resmi-kompetitor] berkas ditulis untuk ${file.hotels.length} hotel (check-in ${file.checkInWeekday} dan ${file.checkInWeekend}).`);
  }
}

if (/crawl-competitor-official-rates\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[tarif-resmi-kompetitor] gagal: ${(error as Error).message}`);
    process.exit(1);
  });
}
