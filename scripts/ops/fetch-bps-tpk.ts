/**
 * Ambil TPK hotel bintang Banten dari satu atau beberapa rilis resmi BPS Banten lalu simpan ke MarketMacroStat.
 * Dipakai untuk mengisi data awal sebelum BPS_WEBAPI_KEY tersedia; setelah itu pembaruan penuh menemukan rilis baru sendiri.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/fetch-bps-tpk.ts <url-rilis> [url-rilis...]
 */
import { db } from "@/lib/db";
import { fetchTpkPressRelease, saveTpk } from "@/lib/market/bps-tpk";

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) throw new Error("Sebutkan minimal satu URL rilis BPS Banten tentang TPK hotel bintang.");
  for (const url of urls) {
    const obs = await fetchTpkPressRelease(url);
    await saveTpk(obs);
    console.log(`[bps-tpk] ${obs.period.toISOString().slice(0, 7)}: ${obs.value.toLocaleString("id-ID")}% (${obs.sourceTitle})`);
  }
}

main()
  .catch((error) => {
    console.error("[bps-tpk] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
