import type { Browser } from "puppeteer";
import { db } from "../db";
import {
  ensureTotalPerNightPrices,
  googleHotelPricesUrl,
  parseDisplayedRate,
  type GoogleHotelRate,
} from "./google-hotel-rate";
import { getHotelRateTargets, type HotelRateTarget } from "./competitor-repository";
import { wibDay } from "./date-range";
import { PROPERTY_RATE_PACKAGE } from "./rate-basis";

export type HotelTarget = HotelRateTarget;

/** Tarif termurah properti yang dibaca dengan pilihan "Total per malam" (termasuk pajak + biaya); paket lama di rate-basis.ts. */
export const HOTEL_PACKAGE_NAME = PROPERTY_RATE_PACKAGE;

/**
 * Satu putaran pengambilan tarif selesai jauh di bawah jendela ini. Dipakai untuk idempotensi (pengamatan hotel dan
 * tanggal yang sama dalam jendela ini diperbarui, bukan ditambah) dan untuk memilih putaran terakhir tiap hotel
 * (panel admin, Knowledge Graph).
 */
export const RATE_BATCH_WINDOW_MS = 12 * 60 * 60 * 1000;

export type DynamicDatePair = {
  label: "tomorrow" | "weekend" | "weekday";
  checkIn: Date;
  checkOut: Date;
};

/**
 * Menghitung jendela 14 malam berurutan (H+1 sampai H+nights) secara dinamis menurut kalender WIB.
 * Malam Jumat (5) dan Sabtu (6) diberi label "weekend", malam Minggu sampai Kamis diberi label "weekday".
 */
export function getDynamicStayWindowPairs(baseDate: Date = new Date(), nights = 14): DynamicDatePair[] {
  const today = new Date(`${wibDay(baseDate)}T00:00:00Z`);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();
  const count = Math.max(1, Math.min(30, Math.floor(nights)));
  const out: DynamicDatePair[] = [];
  for (let i = 1; i <= count; i++) {
    const checkIn = new Date(Date.UTC(y, m, d + i, 0, 0, 0));
    const checkOut = new Date(Date.UTC(y, m, d + i + 1, 0, 0, 0));
    const dow = checkIn.getUTCDay();
    out.push({
      label: dow === 5 || dow === 6 ? "weekend" : "weekday",
      checkIn,
      checkOut,
    });
  }
  return out;
}

/**
 * Menghitung tanggal menginap target secara dinamis setiap kali cron berjalan, menurut kalender WIB:
 * 1. Besok malam (last-minute weekday/weekend rate)
 * 2. Sabtu terdekat mendatang (peak weekend staycation rate)
 * Runner GitHub berjalan dalam UTC dan sering tertunda lewat tengah malam WIB; dengan tanggal UTC, "besok" jatuh pada
 * malam itu juga (tercatat 13 Nov 2026 05.00 WIB: check-in 13 Nov).
 */
export function getDynamicTargetDates(baseDate: Date = new Date()): {
  tomorrow: DynamicDatePair;
  weekend: DynamicDatePair;
} {
  const today = new Date(`${wibDay(baseDate)}T00:00:00Z`);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();

  // Besok (+1 hari)
  const tomorrowCheckIn = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
  const tomorrowCheckOut = new Date(Date.UTC(y, m, d + 2, 0, 0, 0));

  // Sabtu terdekat mendatang
  const dayOfWeek = today.getUTCDay(); // 0: Minggu, 6: Sabtu
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7;
  const weekendCheckIn = new Date(Date.UTC(y, m, d + daysUntilSaturday, 0, 0, 0));
  const weekendCheckOut = new Date(Date.UTC(y, m, d + daysUntilSaturday + 1, 0, 0, 0));

  return {
    tomorrow: { label: "tomorrow", checkIn: tomorrowCheckIn, checkOut: tomorrowCheckOut },
    weekend: { label: "weekend", checkIn: weekendCheckIn, checkOut: weekendCheckOut },
  };
}

export type CollectRatesOptions = {
  checkIn?: Date;
  checkOut?: Date;
  targets?: HotelTarget[];
  dateMode?: "tomorrow" | "weekend" | "both" | "window14";
  windowNights?: number;
};

export type CollectedRateResult = {
  hotel: string;
  price: number;
  currency: string;
  sourceUrl: string;
  checkIn: Date;
  checkOut: Date;
};

export type HotelPricePageStatus = "available" | "sold_out" | "contact_property" | "unreadable";

export interface HotelPriceReadResult {
  status: HotelPricePageStatus;
  rate: GoogleHotelRate | null;
  reason: string | null;
}

export interface UnavailableHotelRate {
  hotel: string;
  checkIn: string;
  reason: string;
}

/** Tarif yang tersimpan beserta kegagalan per hotel dan tanggal; kegagalan dicatat pemanggil ke ScrapeError. */
export interface CollectRatesOutcome {
  rates: CollectedRateResult[];
  failures: string[];
  /** Properti yang terbaca halamannya di Google Hotels tetapi memang tidak mempublikasikan tarif OTA (konfirmasi langsung). */
  unavailable?: UnavailableHotelRate[];
}

const OTHER_HOTEL_MARKERS = [
  "Bersponsor·Hotel serupa",
  "Hotel serupa",
  "Orang juga melihat",
  "Akomodasi serupa",
  "Hotel lain di sekitar",
  "Akomodasi lain di sekitar",
  "Tempat-tempat terdekat",
  "Sponsored·Similar hotels",
  "Similar hotels",
  "People also viewed",
];
const CONTACT_PROPERTY_RE =
  /hubungi pihak properti ini|telepon atau kunjungi situs untuk mengetahui tarif dan ketersediaan|contact this property|call or visit site for rates and availability/i;
const SOLD_OUT_RE =
  /tersedia untuk tanggal|tidak tersedia untuk tanggal|tidak ada kamar tersedia|habis dipesan|available for\b|unavailable for your dates|no rooms available|sold out/i;
const DESKTOP_VIEWPORT = { width: 1280, height: 3200 };
const PRICE_MODE_BUTTON = 'button[aria-label^="Harga yang ditampilkan"]';
const PRICE_BUTTON_WAIT_MS = 10_000;
const MAX_ALTERNATE_DATES = 3;

/**
 * Mengklasifikasikan halaman tab Prices Google Hotels secara jujur sebelum batas blok hotel serupa:
 * - `available`: penawaran hotel itu sendiri tampil (harga total per malam yang sah);
 * - `contact_property`: Google Hotels menyatakan properti tidak menjual kamar lewat OTA (minta hubungi langsung);
 * - `sold_out`: properti penuh pada tanggal yang diminta (Google menyarankan tanggal alternatif);
 * - `unreadable`: halaman gagal dimuat atau tidak menampilkan elemen harga maupun keterangan ketersediaan.
 */
export function classifyGoogleHotelPricePage(
  text: string,
  context: Omit<GoogleHotelRate, "price" | "currency" | "source" | "observedAt">,
): HotelPriceReadResult {
  const rate = parseDisplayedRate(text, context);
  if (rate) return { status: "available", rate, reason: null };

  const ends = OTHER_HOTEL_MARKERS.map((marker) => text.indexOf(marker)).filter((i) => i >= 0);
  const region = text.slice(0, ends.length ? Math.min(...ends) : text.length);

  if (CONTACT_PROPERTY_RE.test(region)) {
    return {
      status: "contact_property",
      rate: null,
      reason: "Properti tidak mempublikasikan tarif di Google Hotels (konfirmasi langsung ke properti)",
    };
  }
  if (SOLD_OUT_RE.test(region)) {
    return {
      status: "sold_out",
      rate: null,
      reason: "Tidak tersedia pada tanggal yang diminta",
    };
  }
  return {
    status: "unreadable",
    rate: null,
    reason: "harga tidak tampil di Google Hotels",
  };
}

/**
 * Tanggal alternatif dengan jenis hari yang sama (weekday: Minggu–Kamis, weekend: Jumat–Sabtu) dalam jendela 14 malam WIB.
 * Dipakai saat tanggal target utama (mis. besok malam H+1) penuh di OTA sehingga tarif hari sejenis tetap terbaca dari
 * tanggal aktual yang tersedia, bukan menebak harga malam penuh.
 */
export function getAlternateStayDates(
  checkIn: Date,
  baseDate: Date = new Date(),
  maxCandidates = MAX_ALTERNATE_DATES,
): { checkIn: Date; checkOut: Date }[] {
  const targetIso = checkIn.toISOString().slice(0, 10);
  const dow = checkIn.getUTCDay();
  const targetStay: "weekend" | "weekday" = dow === 5 || dow === 6 ? "weekend" : "weekday";
  const windowPairs = getDynamicStayWindowPairs(baseDate, 14);
  return windowPairs
    .filter((pair) => pair.label === targetStay && pair.checkIn.toISOString().slice(0, 10) !== targetIso)
    .slice(0, Math.max(0, maxCandidates))
    .map(({ checkIn: ci, checkOut: co }) => ({ checkIn: ci, checkOut: co }));
}

export async function resolveHotelRateWithFallback(params: {
  hotelName: string;
  checkIn: Date;
  checkOut: Date;
  allowDateFallback: boolean;
  baseDate?: Date;
  maxAlternateDates?: number;
  readNight: (checkIn: Date, checkOut: Date) => Promise<HotelPriceReadResult>;
}): Promise<HotelPriceReadResult> {
  const primary = await params.readNight(params.checkIn, params.checkOut);
  if (primary.status !== "sold_out" || !params.allowDateFallback) return primary;

  const alternates = getAlternateStayDates(params.checkIn, params.baseDate, params.maxAlternateDates);
  for (const alt of alternates) {
    const next = await params.readNight(alt.checkIn, alt.checkOut);
    if (next.status === "available" || next.status === "contact_property") return next;
  }
  return {
    status: "sold_out",
    rate: null,
    reason: `kamar penuh di Google Hotels pada ${params.checkIn.toISOString().slice(0, 10)} maupun ${alternates.length} tanggal alternatif sejenis`,
  };
}

async function readGoogleHotelNightOnce(
  browser: Browser,
  url: string,
  context: Omit<GoogleHotelRate, "price" | "currency" | "source" | "sourceUrl" | "observedAt">,
): Promise<HotelPriceReadResult> {
  const target = googleHotelPricesUrl(url, context.checkIn, context.checkOut, context.guests);
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setViewport(DESKTOP_VIEWPORT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "id-ID,id;q=0.9" });
    await page
      .goto(target, { waitUntil: "networkidle2", timeout: 30_000 })
      .catch(async (error: unknown) => {
        // Tracker latar kadang menahan networkidle2 walau panel harga sudah dirender; lanjutkan hanya bila tombol dasar harga tampil.
        const ready = await page.waitForSelector(PRICE_MODE_BUTTON, { timeout: PRICE_BUTTON_WAIT_MS }).then(() => true, () => false);
        if (!ready) throw error;
      });
    await page.waitForSelector(PRICE_MODE_BUTTON, { timeout: PRICE_BUTTON_WAIT_MS }).catch(() => undefined); // ZERO-FALLBACK: ensureTotalPerNightPrices melempar galat jelas bila tombol tidak tampil.
    const mode = await ensureTotalPerNightPrices(page);
    if (mode.action === "switch") {
      console.log(
        `[google-hotel-rate] ${context.hotelName} ${context.checkIn.toISOString().slice(0, 10)}: tampilan harga diganti dari ${mode.from ?? "pilihan tidak diketahui"} ke Total per malam`,
      );
    }
    const text = await page.evaluate(() => document.body.innerText);
    return classifyGoogleHotelPricePage(text, { ...context, sourceUrl: target });
  } finally {
    await ctx.close().catch(() => undefined); // ZERO-FALLBACK: konteks putus ditutup oleh browser.close() pemanggil.
  }
}

async function readGoogleHotelNightWithRetry(
  browser: Browser,
  url: string,
  context: Omit<GoogleHotelRate, "price" | "currency" | "source" | "sourceUrl" | "observedAt">,
): Promise<HotelPriceReadResult> {
  let lastError: unknown = null;
  let lastResult: HotelPriceReadResult | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await readGoogleHotelNightOnce(browser, url, context);
      if (res.status !== "unreadable") return res;
      lastResult = res;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResult) return lastResult;
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function collectGoogleHotelMarketRates(
  options?: CollectRatesOptions
): Promise<CollectRatesOutcome> {
  const targets = options?.targets ?? (await getHotelRateTargets());
  const baseDate = new Date();
  const dynamicDates = getDynamicTargetDates(baseDate);

  // Tentukan pasangan tanggal yang akan dikumpulkan
  const datePairs: { checkIn: Date; checkOut: Date }[] = [];
  const allowDateFallback = !(options?.checkIn && options?.checkOut) && options?.dateMode !== "window14";
  if (options?.checkIn && options?.checkOut) {
    datePairs.push({ checkIn: options.checkIn, checkOut: options.checkOut });
  } else if (options?.dateMode === "window14") {
    datePairs.push(...getDynamicStayWindowPairs(baseDate, options.windowNights ?? 14));
  } else if (options?.dateMode === "weekend") {
    datePairs.push(dynamicDates.weekend);
  } else if (options?.dateMode === "both") {
    datePairs.push(dynamicDates.tomorrow);
    datePairs.push(dynamicDates.weekend);
  } else {
    // Default: besok malam (last-minute market rate)
    datePairs.push(dynamicDates.tomorrow);
  }

  const results: CollectedRateResult[] = [];
  const failures: string[] = [];
  const unavailable: UnavailableHotelRate[] = [];
  if (targets.length === 0 || datePairs.length === 0) return { rates: results, failures, unavailable };

  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  try {
    for (const { checkIn, checkOut } of datePairs) {
      const requestedIso = checkIn.toISOString().split("T")[0];
      for (const hotel of targets) {
        let outcome: HotelPriceReadResult;
        try {
          outcome = await resolveHotelRateWithFallback({
            hotelName: hotel.name,
            checkIn,
            checkOut,
            allowDateFallback,
            baseDate,
            readNight: (ci, co) =>
              readGoogleHotelNightWithRetry(browser, hotel.url, {
                hotelName: hotel.name,
                checkIn: ci,
                checkOut: co,
                guests: 2,
              }),
          });
        } catch (error) {
          console.error(`[collect-rates] Gagal mengambil tarif ${hotel.name} (${requestedIso}):`, error);
          failures.push(`${hotel.name} (${requestedIso}): ${(error as Error).message}`);
          continue;
        }

        if (outcome.status === "contact_property") {
          const reason = outcome.reason ?? "Properti tidak mempublikasikan tarif di Google Hotels";
          console.log(`[collect-rates] ${hotel.name} (${requestedIso}): ${reason}`);
          unavailable.push({ hotel: hotel.name, checkIn: requestedIso, reason });
          continue;
        }

        const rate = outcome.rate;
        if (!rate) {
          const reason = outcome.reason ?? "harga tidak tampil di Google Hotels";
          console.warn(`[collect-rates] Tarif tidak ditemukan untuk ${hotel.name} (${requestedIso}): ${reason}`);
          failures.push(`${hotel.name} (${requestedIso}): ${reason}`);
          continue;
        }

        const actualIso = rate.checkIn.toISOString().split("T")[0];
        if (actualIso !== requestedIso) {
          console.log(
            `[collect-rates] ${hotel.name}: penuh pada ${requestedIso}, memakai tanggal alternatif sejenis ${actualIso} (Rp ${rate.price.toLocaleString("id-ID")})`,
          );
        }

        const observedAt = new Date();
        // Jendela putaran ini untuk idempotency tanpa menghapus histori kemarin
        const twelveHoursAgo = new Date(observedAt.getTime() - RATE_BATCH_WINDOW_MS);

        if (hotel.competitorId) {
          // Cari apakah sudah ada snapshot hari ini untuk hotel & tanggal checkIn aktual yang sama
          const existingSnapshot = await db.competitorPriceSnapshot.findFirst({
            where: {
              competitorId: hotel.competitorId,
              packageName: HOTEL_PACKAGE_NAME,
              checkIn: rate.checkIn,
              observedAt: { gte: twelveHoursAgo },
            },
            select: { id: true, version: true },
          });

          if (existingSnapshot) {
            const updated = await db.competitorPriceSnapshot.updateMany({
              where: { id: existingSnapshot.id, version: existingSnapshot.version },
              data: {
                price: rate.price,
                currency: rate.currency,
                guests: rate.guests,
                checkIn: rate.checkIn,
                checkOut: rate.checkOut,
                source: rate.source,
                sourceUrl: rate.sourceUrl,
                observedAt,
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) {
              failures.push(`${hotel.name} (${actualIso}): konflik OCC saat memperbarui snapshot harga`);
              continue;
            }
          } else {
            await db.competitorPriceSnapshot.create({
              data: {
                competitorId: hotel.competitorId,
                roomName: "Market rate",
                packageName: HOTEL_PACKAGE_NAME,
                price: rate.price,
                currency: rate.currency,
                guests: rate.guests,
                checkIn: rate.checkIn,
                checkOut: rate.checkOut,
                source: rate.source,
                sourceUrl: rate.sourceUrl,
                observedAt,
              },
            });
          }
        } else {
          // Sanghyang Price Snapshot
          const existingSanghyang = await db.sanghyangPriceSnapshot.findFirst({
            where: {
              packageName: HOTEL_PACKAGE_NAME,
              checkIn: rate.checkIn,
              observedAt: { gte: twelveHoursAgo },
            },
            select: { id: true, version: true },
          });

          if (existingSanghyang) {
            const updated = await db.sanghyangPriceSnapshot.updateMany({
              where: { id: existingSanghyang.id, version: existingSanghyang.version },
              data: {
                price: rate.price,
                currency: rate.currency,
                guests: rate.guests,
                checkIn: rate.checkIn,
                checkOut: rate.checkOut,
                source: rate.source,
                sourceUrl: rate.sourceUrl,
                observedAt,
                version: { increment: 1 },
              },
            });
            if (updated.count !== 1) {
              failures.push(`${hotel.name} (${actualIso}): konflik OCC saat memperbarui snapshot harga`);
              continue;
            }
          } else {
            await db.sanghyangPriceSnapshot.create({
              data: {
                roomName: "Market rate",
                packageName: HOTEL_PACKAGE_NAME,
                price: rate.price,
                currency: rate.currency,
                guests: rate.guests,
                checkIn: rate.checkIn,
                checkOut: rate.checkOut,
                source: rate.source,
                sourceUrl: rate.sourceUrl,
                observedAt,
              },
            });
          }
        }

        results.push({
          hotel: hotel.name,
          price: rate.price,
          currency: rate.currency,
          sourceUrl: rate.sourceUrl,
          checkIn: rate.checkIn,
          checkOut: rate.checkOut,
        });
      }
    }
  } finally {
    await browser.close();
  }

  return { rates: results, failures, unavailable };
}
