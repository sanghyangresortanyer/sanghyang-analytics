/**
 * Crawl tarif per tipe kamar (Google Travel, tab Prices) untuk tanggal utama Selasa–Kamis & Sabtu terdekat, ditambah
 * tarif termurah tiap malam di jendela H+1 sampai H+WINDOW_NIGHTS untuk semua hotel, lalu tulis
 * src/lib/market/resort-room-rates.data.json. File hanya ditimpa bila data lolos validasi; bila tidak, data lama dipakai.
 * Dijalankan job GitHub "room-rates" (nightly-market-scrape.yml) yang meng-commit file ini supaya Vercel deploy ulang.
 *
 *   npx tsx scripts/ops/crawl-room-rates.ts                     # semua hotel, 3 sampel tanggal utama
 *   npx tsx scripts/ops/crawl-room-rates.ts --hotels=sanghyang --samples=1 --dry
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { discoverDynamicOtasForHotels, type OtaHotelTarget } from "@/lib/market/ota-crawler";
import { normalizeHost } from "@/lib/market/ota-providers";
import { COMPSET_HOTELS } from "@/lib/market/hotel-compset";
import {
  buildRoomRateData,
  crawlRoomRates,
  nextStayDates,
  pricesUrl,
  ROOM_RATE_HOTELS,
  stayWindow,
  validateRoomRateData,
  weekdayCandidates,
  WINDOW_SAMPLES,
  type HotelCrawl,
} from "@/lib/market/room-offers";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const OUT = path.join(__dirname, "..", "..", "src", "lib", "market", "resort-room-rates.data.json");

async function main() {
  const now = new Date();
  const dates = nextStayDates(now);
  // Jendela dihitung sekali di awal: crawl bisa melewati tengah malam, tanggalnya tidak boleh bergeser di tengah jalan.
  const stayNights = stayWindow(now);
  const hotels = arg("hotels")?.split(",") ?? ROOM_RATE_HOTELS;
  const samples = Number(arg("samples") ?? 3);
  // Hari biasa = Selasa/Rabu/Kamis terdekat pertama yang menampilkan tipe kamar Sanghyang.
  let probe: HotelCrawl | undefined;
  for (const candidate of weekdayCandidates(now)) {
    const [sh] = await crawlRoomRates({ ...dates, weekday: candidate }, samples, ["sanghyang"], ["weekday"]);
    if (sh.weekday?.rooms.length) {
      dates.weekday = candidate;
      probe = sh;
      break;
    }
    console.log(`[room-rates] tipe kamar Sanghyang tidak tampil untuk ${candidate.checkin}, coba tanggal berikutnya`);
  }
  // Tanggal utama sudah dirayapi dengan beberapa sampel; malam lain di jendela cukup WINDOW_SAMPLES sampel.
  const extraNights = stayNights.filter((n) => n.checkin !== dates.weekday.checkin && n.checkin !== dates.weekend.checkin);
  console.log(
    `[room-rates] hari biasa ${dates.weekday.checkin}, akhir pekan ${dates.weekend.checkin}, ${hotels.length} hotel x ${samples} sampel; ` +
      `jendela ${stayNights[0].checkin} sampai ${stayNights[stayNights.length - 1].checkin}: ${extraNights.length} malam lain x ${WINDOW_SAMPLES} sampel`,
  );
  const crawls = await crawlRoomRates(dates, samples, hotels, undefined, extraNights);
  // Hasil percobaan tanggal tadi dipakai bila muat ulang kali ini kebetulan tidak menampilkan tipe kamar Sanghyang.
  const sanghyang = crawls.find((c) => c.hotelId === "sanghyang");
  if (sanghyang && probe?.weekday && !sanghyang.weekday?.rooms.length) sanghyang.weekday = probe.weekday;
  const data = buildRoomRateData(crawls, dates, new Date(), stayNights);
  console.log(`[room-rates] ${data.lowestByHotel.length} hotel berharga, ${data.rates.length} baris tarif, ${data.evidence.length} penawaran kamar (${data.evidence.filter((e) => e.breakfast).length} dengan sarapan)`);
  if (process.argv.includes("--dry")) {
    console.log(JSON.stringify({ window: data.window, lowestByHotel: data.lowestByHotel, evidence: data.evidence }, null, 2));
    console.log(`[room-rates] validasi: ${validateRoomRateData(data).join("; ") || "lolos"}`);
    return;
  }
  const problems = validateRoomRateData(data);
  if (problems.length) {
    console.error(`[room-rates] data tidak dipakai, file lama dipertahankan: ${problems.join("; ")}`);
    process.exit(1);
  }
  const enriched: Record<string, unknown> = { ...data };
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown>;
    if (prev.otaProviders) enriched.otaProviders = prev.otaProviders;
    if (prev.reviewSourcesByHotel) enriched.reviewSourcesByHotel = prev.reviewSourcesByHotel;
    if (prev.otaDiscoveredAt) enriched.otaDiscoveredAt = prev.otaDiscoveredAt;
  }
  if (!arg("hotels")) {
    const officialByHotel = new Map<string, string[]>();
    if (process.env.DATABASE_URL?.trim()) {
      const { db } = await import("@/lib/db");
      try {
        const comps = await db.competitor.findMany({
          where: { placeId: { in: COMPSET_HOTELS.map((h) => h.hotelId) } },
          select: { placeId: true, websiteUrl: true, bookingUrl: true },
        });
        for (const c of comps) {
          if (!c.placeId) continue;
          const hosts: string[] = [];
          for (const raw of [c.websiteUrl, c.bookingUrl]) {
            if (raw && URL.canParse(raw)) hosts.push(normalizeHost(new URL(raw).hostname));
          }
          if (hosts.length) officialByHotel.set(c.placeId, hosts);
        }
      } finally {
        await db.$disconnect();
      }
    }
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"],
    });
    try {
      const targets: OtaHotelTarget[] = [];
      for (const h of COMPSET_HOTELS) {
        try {
          const url = pricesUrl(h.hotelId, dates.weekday.checkin, dates.weekday.checkout);
          targets.push({ hotelId: h.hotelId, name: h.name, ratesUrl: url, officialHosts: officialByHotel.get(h.hotelId) ?? [] });
        } catch {
          // Hotel tanpa entity Google Travel (mis. alamat belum lengkap) dilewati.
        }
      }
      if (targets.length) {
        const discovered = await discoverDynamicOtasForHotels(browser, targets);
        enriched.otaProviders = discovered.otaProviders;
        enriched.reviewSourcesByHotel = discovered.reviewSourcesByHotel;
        enriched.otaDiscoveredAt = new Date().toISOString();
      }
    } finally {
      await browser.close();
    }
  }
  writeFileSync(OUT, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  console.log(`[room-rates] tersimpan: ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
