/**
 * Menyegarkan daftar OTA dan sumber ulasan Google Travel secara dinamis untuk seluruh hotel pembanding aktif,
 * lalu menyimpan hasilnya (`otaProviders`, `reviewSourcesByHotel`, `otaDiscoveredAt`) ke
 * `src/lib/market/resort-room-rates.data.json` tanpa mengubah angka tarif yang sudah tervalidasi.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { db } from "@/lib/db";
import { nextStayDates, pricesUrl } from "@/lib/market/room-offers";
import { discoverDynamicOtasForHotels, type OtaHotelTarget } from "@/lib/market/ota-crawler";
import { normalizeHost } from "@/lib/market/ota-providers";
import { COMPSET_HOTELS } from "@/lib/market/hotel-compset";

const EXCLUDED_INFRA_HOSTS = new Set(["google.com", "google.co.id", "instagram.com", "tiktok.com", "facebook.com", "youtube.com", "linktr.ee"]);

async function main() {
  const stayDate = nextStayDates(new Date()).weekday;
  const hotelIds = COMPSET_HOTELS.map((h) => h.hotelId).filter(Boolean);
  const comps = await db.competitor.findMany({
    where: { placeId: { in: hotelIds } },
    select: { placeId: true, name: true, websiteUrl: true, bookingUrl: true },
  });
  const byPid = new Map(comps.map((c) => [c.placeId, c]));

  const targets: OtaHotelTarget[] = [];
  for (const id of hotelIds) {
    let url: string;
    try {
      url = pricesUrl(id, stayDate.checkin, stayDate.checkout);
    } catch {
      continue;
    }
    const c = byPid.get(id);
    const officialHosts: string[] = [];
    for (const raw of [c?.websiteUrl, c?.bookingUrl]) {
      if (!raw || !URL.canParse(raw)) continue;
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      const nh = normalizeHost(parsed.hostname);
      if (nh && ![...EXCLUDED_INFRA_HOSTS].some((ex) => nh === ex || nh.endsWith(`.${ex}`))) {
        officialHosts.push(nh);
      }
    }
    targets.push({ hotelId: id, name: c?.name ?? id, ratesUrl: url, officialHosts });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"],
  });
  try {
    const result = await discoverDynamicOtasForHotels(browser, targets);
    for (const obs of result.observations) {
      const pairs = obs.providers.map((p) => (p.host ? `${p.provider}(${p.host})` : p.provider)).join(", ");
      console.log(`${obs.hotelId} | priceOTAs=${obs.providers.length}: ${pairs} | revSources=${obs.reviewSources.join(", ")}`);
    }
    const jsonPath = path.join(process.cwd(), "src/lib/market/resort-room-rates.data.json");
    const existing = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    existing.otaProviders = result.otaProviders;
    existing.reviewSourcesByHotel = result.reviewSourcesByHotel;
    existing.otaDiscoveredAt = new Date().toISOString();
    fs.writeFileSync(jsonPath, JSON.stringify(existing, null, 2) + "\n");
    console.log(
      `Saved ${result.otaProviders.length} dynamic OTAs across ${Object.keys(result.reviewSourcesByHotel).length} review source lists.`,
    );
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
