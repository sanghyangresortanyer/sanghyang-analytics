/**
 * Tarif kamar resmi Sanghyang dari booking engine hotel (Exely) untuk tanggal check-in hari biasa dan akhir pekan lapisan
 * OTA (checkInWeekday/checkInWeekend di src/lib/market/resort-room-rates.data.json), 1 malam, 2 dewasa, lalu tulis
 * src/lib/market/official-room-rates.data.json. Berkas hanya ditimpa bila data lolos validasi; bila tidak, data lama dipakai.
 * Dijalankan job GitHub "room-rates" (nightly-market-scrape.yml) tepat setelah crawl-room-rates.ts, dalam commit yang sama.
 * Intinya ada di src/lib/market/official-room-rates-refresh.ts dan dipakai juga langkah tarif "Perbarui Semua Data".
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/crawl-official-room-rates.ts
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/crawl-official-room-rates.ts --dry
 */
import { ExelyCredentialsMissingError } from "@/lib/market/official-room-rates";
import { refreshOfficialRoomRates } from "@/lib/market/official-room-rates-refresh";

async function main() {
  const dry = process.argv.includes("--dry");
  try {
    const { file, problems } = await refreshOfficialRoomRates({ dry });
    if (problems.length) {
      console.error(`[tarif-resmi] data tidak dipakai, berkas lama dipertahankan: ${problems.join("; ")}`);
      process.exitCode = 1;
    } else if (dry) {
      console.log(JSON.stringify(file, null, 2));
    }
  } catch (error) {
    if (error instanceof ExelyCredentialsMissingError) {
      console.error(`[tarif-resmi] ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (/crawl-official-room-rates\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`[tarif-resmi] gagal: ${(error as Error).message}`);
    process.exit(1);
  });
}
