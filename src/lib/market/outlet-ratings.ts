/**
 * Rating Google Maps outlet Sanghyang sendiri, dan potret bulanan untuk perbandingan "vs bulan lalu".
 * Dijalankan job malam (full-refresh.ts). Rating lama di database sempat lebih tinggi dari Google Maps
 * (mis. D'Bar 4,3 vs 3,7), jadi sumbernya sekarang dibaca langsung dari listing tiap outlet.
 */
import data from "./hotel-compset.data.json";
import { PROFILE_CRAWLER_UA } from "./official-pages";
import { OUTLET_MARKET_SHARE_DATA } from "./pricing-benchmark";

export interface OwnOutlet {
  outletKey: string;
  competitorName: string;
  placeName: string | null;
  mapsUrl: string | null;
}

export const OWN_OUTLETS = data.ownOutlets as OwnOutlet[];

/** Rating "4,4" dari teks ringkasan listing Google Maps (baris pertama berbentuk angka koma satu desimal). */
export function parseMapsRating(text: string): number | null {
  const line = text.split("\n").map((l) => l.trim()).find((l) => /^[1-5],\d$/.test(l));
  return line ? Number(line.replace(",", ".")) : null;
}

/** Jumlah ulasan dari blok rating Google Maps, mis. "4,5\n(1.234)" -> 1234; null bila tidak tampil. */
export function parseMapsReviewCount(text: string): number | null {
  const m = text.match(/\((\d{1,3}(?:[.,\u00a0]\d{3})+|\d+)\)/);
  return m ? Number(m[1].replace(/[.,\u00a0]/g, "")) : null;
}

export interface MapsReviewCard { id: string | null; author: string; stars: string; date: string; text: string }

/** Kartu ulasan Google Maps -> ulasan siap simpan; null bila bintang tidak terbaca atau tanpa teks. */
export function parseMapsReviewCard(card: MapsReviewCard, mapsUrl: string, now: Date, parseDate: (t: string, base: Date) => Date) {
  const rating = Number(card.stars.match(/^([1-5])\s*bintang/i)?.[1] ?? NaN);
  const text = card.text.replace(/\s*…?\s*Lainnya$/, "").trim();
  if (!Number.isFinite(rating) || !text || !card.id) return null;
  // reviewid di URL = bukti ulasan dibaca dari kartu Google Maps (lihat isVerifiedReviewSource).
  const sourceUrl = `${mapsUrl}?hl=id&reviewid=${encodeURIComponent(card.id)}`;
  return {
    author: card.author,
    rating,
    reviewDate: parseDate(card.date.replace(/^Diedit\s+/i, ""), now),
    text,
    source: "Google Maps",
    sourceUrl,
    observedAt: now,
    dateUncertaintyDays: 7,
    reviewId: card.id,
  };
}

/** Batas atas menunggu tab Ulasan muncul; listing hotel resort memang tidak punya tab ini. */
const TAB_TIMEOUT_MS = 15_000;
/** Batas atas menunggu kartu tab Ulasan terisi setelah tab diklik. */
const CARDS_TIMEOUT_MS = 10_000;
/** Batas atas menunggu teks ulasan terbuka setelah tombol "Lainnya" diklik (biasanya di bawah satu detik). */
const EXPAND_TIMEOUT_MS = 5_000;

/** Tanpa login Google Maps hanya menampilkan 5 ulasan "paling relevan"; itu yang diambil tiap malam. */
async function readMapsReviews(page: import("puppeteer").Page): Promise<MapsReviewCard[]> {
  // Tab dirender setelah blok rating; diperiksa sekali tanpa menunggu, tab kadang belum ada dan ulasan terlewat.
  const tab = await page.waitForSelector('button[role="tab"][aria-label*="Ulasan"]', { timeout: TAB_TIMEOUT_MS }).catch(() => null);
  if (!tab) return [];
  await tab.click();
  // Panel Ringkasan juga memuat beberapa kartu ulasan (div.jftiEf). Saat tab Ulasan dimuat, kartu itu dibuang lalu
  // diganti, jadi menunggu div.jftiEf saja bisa lolos sebelum pergantian dan berakhir membaca nol kartu.
  await page
    .waitForFunction(
      () => {
        const t = document.querySelector('button[role="tab"][aria-label*="Ulasan"]');
        return t !== null && t.getAttribute("aria-selected") === "true" && document.querySelectorAll("div.jftiEf .kvMYJc").length > 0;
      },
      { timeout: CARDS_TIMEOUT_MS },
    )
    // ZERO-FALLBACK: bila tab tidak berpindah, kartu Ringkasan yang masih tampil itulah yang dibaca.
    .catch(() => undefined);
  // Buka teks yang terpotong ("Lainnya"), lalu tunggu sampai ada kartu dan tidak ada yang masih berakhir "…".
  await page.$$eval("div.jftiEf button.w8nwRe", (els) => els.forEach((e) => (e as HTMLElement).click()));
  await page
    .waitForFunction(
      () => {
        const texts = [...document.querySelectorAll("div.jftiEf .wiI7pd")];
        return texts.length > 0 && !texts.some((e) => /…\s*$/.test(e.textContent || ""));
      },
      { timeout: EXPAND_TIMEOUT_MS },
    )
    // ZERO-FALLBACK: kartu yang tetap terpotong disimpan apa adanya; review id-nya membuat teks lengkap menggantikannya di pembaruan berikutnya.
    .catch(() => undefined);
  return page.$$eval("div.jftiEf", (els) =>
    els.map((e) => ({
      id: e.getAttribute("data-review-id"),
      author: (e.querySelector(".d4r55") as HTMLElement | null)?.innerText ?? "",
      stars: e.querySelector(".kvMYJc")?.getAttribute("aria-label") ?? "",
      date: (e.querySelector(".rsqaWe") as HTMLElement | null)?.innerText ?? "",
      text: (e.querySelector(".wiI7pd") as HTMLElement | null)?.innerText ?? "",
    })),
  );
}

interface RatingTarget { key: string; names: string[]; mapsUrl: string; ownOutlet: OwnOutlet | null }

/**
 * Outlet Sanghyang ditambah semua pembanding aktif (inti dan acuan) di registri yang punya tautan Google Maps sendiri.
 * Outlet di dalam hotel pesaing yang tautannya sama dengan hotel induknya (mis. spa hotel) dilewati, supaya rating
 * hotel tidak tercatat sebagai rating spa atau restorannya.
 */
async function ratingTargets(db: typeof import("../db").db): Promise<RatingTarget[]> {
  const own = OWN_OUTLETS.filter((o) => o.mapsUrl).map((o) => ({ key: o.outletKey, names: [o.competitorName], mapsUrl: o.mapsUrl!, ownOutlet: o }));
  const ownNames = new Set(OWN_OUTLETS.map((o) => o.competitorName));
  const registry = await db.competitor.findMany({
    where: { active: true, compsetRole: { in: ["inti", "benchmark"] } },
    select: { name: true, category: true, mapsUrl: true, googleMapsUrl: true },
  });
  const lodgingUrls = new Set(registry.filter((c) => c.category === "hotel" || c.category === "resort").map((c) => c.mapsUrl ?? c.googleMapsUrl));
  const rivals = registry
    .filter((c) => !ownNames.has(c.name))
    .flatMap((c) => {
      const url = c.mapsUrl ?? c.googleMapsUrl;
      const isLodging = c.category === "hotel" || c.category === "resort";
      return url && (isLodging || !lodgingUrls.has(url)) ? [{ key: c.name, names: [c.name], mapsUrl: url, ownOutlet: null }] : [];
    });
  return [...own, ...rivals];
}

/**
 * Rating Google Maps outlet Sanghyang dan pesaing dalam compset, plus 5 ulasan Maps tiap outlet Sanghyang.
 * Pesaing hanya diambil ratingnya; ulasan hotel pesaing datang dari Google Travel.
 */
export async function refreshOwnOutletRatings(): Promise<{ updated: string[]; failures: string[]; reviewsInserted: number }> {
  const { db } = await import("../db");
  const { ingestScrapedReviews, parseRelativeDate } = await import("./scrape-new-reviews");
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"] });
  const updated: string[] = [];
  const failures: string[] = [];
  let reviewsInserted = 0;
  try {
    for (const t of await ratingTargets(db)) {
      const rows = await db.competitor.findMany({ where: { name: { in: t.names } }, select: { id: true, name: true, version: true } });
      if (!rows.length) {
        if (t.ownOutlet) failures.push(`${t.key}: baris Competitor tidak ada`);
        continue; // pesaing yang belum tercatat di database
      }
      // Tab baru per tempat: bila satu halaman Maps memutus frame-nya, tempat berikutnya tidak ikut gagal berantai.
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 900 });
        // Perayap memperkenalkan diri dengan jujur (konstitusi, Pasal I). Tampilan terbatas Google untuk UA ini tetap memuat
        // blok rating dan jumlah ulasan (terbukti di penemuan pesaing dan probe ulasan venue, 16 Nov 2026).
        await page.setUserAgent(PROFILE_CRAWLER_UA);
        // Tunggu blok rating muncul; "networkidle2" tidak pernah selesai di Google Maps dan menjadi sebab timeout.
        await page.goto(`${t.mapsUrl}${t.mapsUrl.includes("?") ? "&" : "?"}hl=id`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("div.F7nice", { timeout: 30_000 });
        const ratingText = await page.$eval("div.F7nice", (el) => (el as HTMLElement).innerText);
        const rating = parseMapsRating(ratingText);
        if (rating === null) throw new Error("rating tidak terbaca di listing");
        const reviewCount = parseMapsReviewCount(ratingText);
        for (const row of rows) {
          const r = await db.competitor.updateMany({
            where: { id: row.id, version: row.version },
            data: {
              rating,
              reviewCount,
              ratingSource: "Google Maps",
              ratingSourceUrl: t.mapsUrl,
              ratingObservedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (r.count !== 1) throw new Error("OCC conflict");
        }
        updated.push(`${t.key} ${rating}`);
        const o = t.ownOutlet;
        // Listing hotel resort tidak punya tab Ulasan biasa; ulasannya datang dari Google Travel (scrape-new-reviews).
        if (!o || o.outletKey === "resort") continue;
        const now = new Date();
        const reviews = (await readMapsReviews(page)).map((c) => parseMapsReviewCard(c, t.mapsUrl, now, parseRelativeDate)).filter((x) => x !== null);
        if (!reviews.length) failures.push(`${o.outletKey}: ulasan Google Maps tidak terbaca`);
        reviewsInserted += (await ingestScrapedReviews(rows[0].id, o.competitorName, reviews)).inserted;
      } catch (error) {
        failures.push(`${t.key}: ${(error as Error).message}`);
      } finally {
        await page.close().catch(() => undefined); // ZERO-FALLBACK: tab yang frame-nya sudah putus tidak bisa ditutup lagi; browser ditutup di bawah.
      }
    }
  } finally {
    await browser.close();
  }
  return { updated, failures, reviewsInserted };
}

/** Upsert potret bulan berjalan untuk keenam outlet (rating Google, indeks harga, jumlah ulasan tercatat). */
export async function upsertMonthlySnapshots(month: string): Promise<number> {
  const { db } = await import("../db");
  const monthDate = new Date(`${month}T00:00:00Z`);
  let written = 0;
  for (const o of OWN_OUTLETS) {
    const row = await db.competitor.findFirst({ where: { name: o.competitorName }, select: { id: true, rating: true, ratingSource: true } });
    if (!row) continue;
    const reviewsRecorded = await db.competitorReview.count({ where: { competitorId: row.id, archivedAt: null } });
    const fields = {
      // Hanya rating yang sudah dibaca dari Google Maps yang dipotret; angka lama tanpa sumber tidak dipakai.
      googleRating: row.ratingSource === "Google Maps" ? row.rating : null,
      pricePositioningIndex: OUTLET_MARKET_SHARE_DATA[o.outletKey]?.pricePositioningIndex ?? null,
      reviewsRecorded,
      capturedAt: new Date(),
    };
    await db.outletMonthlySnapshot.upsert({
      where: { outletKey_month: { outletKey: o.outletKey, month: monthDate } },
      create: { outletKey: o.outletKey, month: monthDate, ...fields },
      update: { ...fields, version: { increment: 1 } },
    });
    written++;
  }
  return written;
}
