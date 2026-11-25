import { collectGoogleHotelMarketRates } from "@/lib/market/collect-rates";
import { db } from "@/lib/db";

async function main() {
  console.log("Starting Google Hotels live market rates collection via Crawl4AI...");
  const { rates, failures } = await collectGoogleHotelMarketRates();
  console.log("Market rates updated:");
  for (const r of rates) {
    console.log(`- ${r.hotel}: ${r.currency} ${r.price.toLocaleString("id-ID")}`);
  }
  for (const f of failures) console.error(`- gagal: ${f}`);
  if (failures.length) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
