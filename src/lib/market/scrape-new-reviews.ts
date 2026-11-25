import crypto from "node:crypto";
import { db } from "../db";
import { ReviewSentiment } from "@prisma/client";
import type { Browser, Page } from "puppeteer";
import { getReviewTargets } from "./competitor-repository";
import type { CompetitorMenu } from "./competitor-menu";
import type { ReviewTopics } from "./competitor-comparison";
import { PROFILE_CRAWLER_UA } from "./official-pages";
import { parseMapsRating, parseMapsReviewCard, parseMapsReviewCount, type MapsReviewCard } from "./outlet-ratings";
import { parseTopicChips } from "./review-topics";

export type ReviewTarget = {
  /** Nama persis baris Competitor di DB; id diambil saat runtime. */
  competitorName: string;
  /** Nama untuk log. Pencarian Google Travel tidak dipakai lagi karena /travel/search dilarang robots.txt. */
  query: string;
  /** Halaman entity Google Travel dari registri (ratesUrl, atau dihitung dari mapsUrl lewat google-travel-entity.ts). */
  travelEntityUrl?: string | null;
};

export type ParsedReview = {
  author: string;
  rating: number;
  reviewDate: Date;
  text: string;
  source: string;
  sourceUrl: string;
  observedAt: Date;
  dateUncertaintyDays: number;
  rawDateText?: string;
  /** Id ulasan dari kartu Google Maps (data-review-id); stabil walau teks atau tanggal relatifnya berubah. */
  reviewId?: string;
};

export interface ParsedRelativeDate {
  date: Date;
  uncertaintyDays: number;
  raw: string;
}

/**
 * Penguraian tanggal relatif Google Travel dengan pencatatan ketidakpastian hari (C4).
 * Contoh: "2 minggu lalu" -> estimasi tanggal dengan ketidakpastian ±7 hari.
 */
export function parseRelativeDateWithUncertainty(text: string, baseDate = new Date()): ParsedRelativeDate {
  const norm = text.toLowerCase().trim();
  const now = baseDate.getTime();

  // Urutan "Terbaru" memuat ulasan beberapa jam lalu ("8 jam lalu"); tanpa cabang ini tanggalnya jatuh ke tanggal baca
  // lewat Date.parse yang gagal, tanpa catatan ketidakpastian.
  if (/\b(jam|menit|detik|hour|minute|second)/.test(norm)) {
    const amount = Number(norm.match(/(\d+)/)?.[1] ?? 1);
    const unitMs = /jam|hour/.test(norm) ? 3_600_000 : /menit|minute/.test(norm) ? 60_000 : 1_000;
    return { date: new Date(now - amount * unitMs), uncertaintyDays: 0, raw: text };
  }
  if (norm.includes("hari") || norm.includes("day")) {
    const match = norm.match(/(\d+)/);
    const days = match ? parseInt(match[1], 10) : 1;
    return {
      date: new Date(now - days * 24 * 60 * 60 * 1000),
      uncertaintyDays: 1,
      raw: text,
    };
  }
  if (norm.includes("minggu") || norm.includes("week")) {
    const match = norm.match(/(\d+)/);
    const weeks = match ? parseInt(match[1], 10) : 1;
    return {
      date: new Date(now - weeks * 7 * 24 * 60 * 60 * 1000),
      uncertaintyDays: 7,
      raw: text,
    };
  }
  if (norm.includes("bulan") || norm.includes("month")) {
    const match = norm.match(/(\d+)/);
    const months = match ? parseInt(match[1], 10) : 1;
    return {
      date: new Date(now - months * 30 * 24 * 60 * 60 * 1000),
      uncertaintyDays: 30,
      raw: text,
    };
  }
  if (norm.includes("tahun") || norm.includes("year")) {
    const match = norm.match(/(\d+)/);
    const years = match ? parseInt(match[1], 10) : 1;
    return {
      date: new Date(now - years * 365 * 24 * 60 * 60 * 1000),
      uncertaintyDays: 365,
      raw: text,
    };
  }

  // Coba parse ISO / text tanggal biasa
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return {
      date: new Date(parsed),
      uncertaintyDays: 0,
      raw: text,
    };
  }

  return {
    date: baseDate,
    uncertaintyDays: 0,
    raw: text,
  };
}

export function parseRelativeDate(text: string, baseDate = new Date()): Date {
  return parseRelativeDateWithUncertainty(text, baseDate).date;
}

export const DEFAULT_REVIEW_WINDOW_MONTHS = 24;

/** Periksa apakah tanggal ulasan masuk ke dalam batas jendela waktu (default 24 bulan). */
export function isReviewWithinWindow(
  reviewDate: Date,
  months = DEFAULT_REVIEW_WINDOW_MONTHS,
  baseDate = new Date()
): boolean {
  const cutoff = new Date(baseDate);
  cutoff.setMonth(cutoff.getMonth() - months);
  return reviewDate.getTime() >= cutoff.getTime();
}

/** Saring ulasan agar hanya mencakup ulasan dalam rentang jendela waktu (default 24 bulan). */
export function filterReviewsByWindow<T extends { reviewDate: Date }>(
  reviews: T[],
  months = DEFAULT_REVIEW_WINDOW_MONTHS,
  baseDate = new Date()
): T[] {
  return reviews.filter((r) => isReviewWithinWindow(r.reviewDate, months, baseDate));
}

/**
 * Pemisahan label yang jujur antara total ulasan di platform publik vs ulasan tersimpan di sistem.
 */
export interface ReviewSourceCounts {
  /** Total ulasan yang tertera di profil publik Google (mis. 2.937 di Google Travel atau 450 di Google Maps) */
  totalOnGoogle: number;
  /** Ulasan fisik yang benar-benar tersimpan di database sistem */
  savedInSystem: number;
  /** Ulasan tersimpan yang berada dalam rentang jendela waktu aktif (default 24 bulan) */
  inWindowSaved: number;
}

/**
 * Format teks ringkasan ulasan yang transparan untuk tampilan UI / laporan.
 */
export function formatReviewCountBreakdown(counts: ReviewSourceCounts): {
  headline: string;
  detail: string;
} {
  return {
    headline: `${counts.savedInSystem} ulasan tersimpan di sistem`,
    detail: `Dari total ${counts.totalOnGoogle} ulasan di Google (${counts.inWindowSaved} ulasan dalam 24 bulan terakhir)`,
  };
}

export function extractThemes(text: string): string[] {
  const lower = text.toLowerCase();
  const themes: string[] = [];

  if (/kamar|bed|kasur|ac|bersih|bocor|nyamuk|sprei|bantal/.test(lower)) {
    themes.push("kamar & kebersihan");
  }
  if (/makan|sarapan|breakfast|resto|restoran|buffet|menu|kuliner|minum/.test(lower)) {
    themes.push("makanan & sarapan");
  }
  if (/pantai|beach|sunset|kolam|pool|laut|pemandangan|view|dermaga/.test(lower)) {
    themes.push("fasilitas & pantai");
  }
  if (/staf|pelayanan|ramah|receptionist|check in|resepsionis|lambat|satpam|housekeeping/.test(lower)) {
    themes.push("pelayanan & staf");
  }
  if (/harga|mahal|murah|worth it|promo|diskon|biaya/.test(lower)) {
    themes.push("harga & value");
  }
  if (/anak|keluarga|family|playground|wahana/.test(lower)) {
    themes.push("keluarga & anak");
  }

  return themes.length > 0 ? themes : ["umum"];
}

/**
 * Sentimen yang diturunkan langsung dari nilai bintang/rating ulasan tamu.
 * Dinamai jujur agar pengguna tahu sumber klasifikasinya adalah rating bintang, bukan skor tebakan.
 */
export function determineSentimentFromRating(rating: number): ReviewSentiment {
  if (rating >= 4) return ReviewSentiment.positive;
  if (rating === 3) return ReviewSentiment.neutral;
  return ReviewSentiment.negative;
}

const POSITIVE_KEYWORDS = /bagus|puas|nyaman|bersih|ramah|enak|lezat|mantap|recomended|recommended|rekomen|tenang|asri|luas|indah|keren|juara|suka|terbaik|top|sejuk|hangat/i;
const NEGATIVE_KEYWORDS = /kotor|bau|bocor|rusak|mahal|kecewa|buruk|jelek|komplain|nyamuk|lambat|asin|bising|parah|kapok|jorok|sempit|berisik|panas|mati ac|kumuh/i;

/**
 * Analisis sentimen berbasis kata kunci ulasan nyata berbahasa Indonesia.
 * Mengembalikan null jika teks netral atau tidak memuat kata kunci emosi yang kuat.
 */
export function determineSentimentFromText(text: string): ReviewSentiment | null {
  const lower = text.toLowerCase();
  const hasPositive = POSITIVE_KEYWORDS.test(lower);
  const hasNegative = NEGATIVE_KEYWORDS.test(lower);

  if (hasPositive && !hasNegative) return ReviewSentiment.positive;
  if (hasNegative && !hasPositive) return ReviewSentiment.negative;
  if (hasPositive && hasNegative) return ReviewSentiment.neutral;
  return null;
}

/**
 * Sentimen ulasan yang transparan dan jujur:
 * Mengutamakan sentimen teks jika ada sinyal emosi yang tegas, dan menggunakan rating bintang sebagai dasar.
 */
export function determineReviewSentiment(text: string, rating?: number): ReviewSentiment {
  const textSentiment = determineSentimentFromText(text);
  if (textSentiment !== null) {
    return textSentiment;
  }
  if (rating !== undefined && Number.isFinite(rating)) {
    return determineSentimentFromRating(rating);
  }
  return ReviewSentiment.neutral;
}

/**
 * Kompatibilitas ke belakang untuk pemanggil yang mengandalkan determineSentiment(rating).
 */
export function determineSentiment(rating: number): ReviewSentiment {
  return determineSentimentFromRating(rating);
}

/**
 * Menghasilkan ID eksternal deterministik dan stabil (C4).
 * Menggunakan kombinasi nama hotel, nama penulis, dan cuplikan teks yang dinormalisasi.
 * Parameter tanggal (jika diberikan) tidak lagi dijadikan penentu hash agar tidak bergeser
 * saat tanggal relatif ("2 minggu lalu") di-crawl pada hari berbeda.
 */
export function generateExternalId(
  hotelName: string,
  author: string,
  dateOrText: Date | string | null | undefined,
  maybeText?: string
): string {
  const text = typeof dateOrText === "string" && maybeText === undefined ? dateOrText : (maybeText ?? "");
  const normHotel = hotelName.trim().toLowerCase();
  const normAuthor = author.trim().toLowerCase();
  const normText = text.trim().replace(/\s+/g, " ");

  const hash = crypto.createHash("sha256");
  hash.update(`${normHotel}:${normAuthor}:${normText}`);
  return hash.digest("hex").slice(0, 32);
}

// hl/gl dipaksa Indonesia: runner GitHub (AS) tetap mendapat label "Terbaru" & tanggal "x lalu".
const LOCALE_PARAMS = "hl=id&gl=id";
/**
 * Batas atas menunggu peristiwa di halaman (bukan jeda tetap). Kartu ulasan Google Travel tampil sekitar 3–6 detik
 * setelah halaman dimuat (diukur 14 Nov 2026); menunggu "jaringan diam" (networkidle2) tidak pernah selesai di
 * Google dan menjadi sebab galat "Timed out after waiting 60000ms".
 */
const REVIEW_LIST_TIMEOUT_MS = 30_000;
const REVIEW_UPDATE_TIMEOUT_MS = 12_000;
/** Opsi kotak pilihan tampil kurang dari satu detik setelah kotaknya dibuka (diamati 18 Nov 2026). */
const LISTBOX_OPEN_TIMEOUT_MS = 4_000;
const REVIEW_CARD = "div.Svr5cf";
/**
 * Popup kotak sumber terbuka di bawah daftar; dengan tinggi 900 px opsi terakhir (Trip.com) berada di tepi bawah dan
 * kliknya tidak memilih apa pun (diamati 18 Nov 2026), jadi halaman dibuka setinggi ini.
 */
const REVIEW_VIEWPORT = { width: 1280, height: 1800 } as const;
/**
 * Pilihan urutan dan sumber di tab ulasan Google Travel adalah kotak pilihan (role=listbox) berlabel bahasa Indonesia
 * karena hl=id (diamati 18 Nov 2026). Tiap tampilan memuat 10 kartu; gulir tidak menambah kartu, jadi cakupan
 * diperluas dengan membaca 10 ulasan terbaru per sumber.
 */
const SORT_LISTBOX = '[role="listbox"][aria-label="Tinjau Opsi Urutan"]';
const SOURCE_LISTBOX = '[role="listbox"][aria-label="Tinjau Opsi Sumber"]';
const NEWEST_SORT = "2";
const ALL_SOURCES = "-2";

/**
 * Label platform kartu ulasan. Kartu bertanda "di Google" adalah ulasan Google untuk tempat itu, yang sama dengan
 * ulasan di listing Google Maps-nya: tab ulasan Google Travel Sanghyang menulis "Ringkasan ulasan Google 4,4 · 3.047
 * ulasan", sama dengan listing Google Maps "4,4 (3.047)" (keduanya dibaca 18 Nov 2026). Jadi labelnya Google Maps,
 * apa pun halaman tempat kartu itu dibaca; halaman bacanya tetap tersimpan di sourceUrl. Ulasan OTA (Tripadvisor,
 * Trip.com, Agoda, Booking.com) tetap memakai nama platformnya.
 */
export function normalizeReviewSource(raw: string): string {
  const trimmed = raw.trim();
  return /^google( reviews)?$/i.test(trimmed) ? "Google Maps" : trimmed;
}

/** Tab ulasan untuk sebuah halaman entity Google Travel. */
export const travelReviewsUrl = (entityUrl: string) =>
  `${entityUrl.replace(/\?.*$/, "").replace(/\/(reviews|prices|overview)$/, "")}/reviews?${LOCALE_PARAMS}`;

// Baris label tipe perjalanan ("Liburan ❘ Keluarga") bukan isi ulasan.
const TRIP_TYPE_LINE = /^(Liburan|Bisnis|Pasangan|Keluarga|Teman|Sendiri)(\s*❘\s*\S+)*$/;
const BODY_END_LINE = /^(Tanggapan dari pemilik|Baca selengkapnya|\+\d+$)|^(Kamar|Layanan|Lokasi)\d/;

/**
 * Urai teks satu kartu ulasan Google Travel:
 * [penulis, "<waktu> di <sumber>", "<skor>/5", ...teks, (Tanggapan dari pemilik ...)].
 * Mengembalikan null untuk kartu non-ulasan (ringkasan/iklan) atau teks terlalu pendek.
 */
export function parseReviewCard(card: string, sourceUrl: string, baseDate = new Date()): ParsedReview | null {
  const lines = card.split("\n").map((l) => l.trim()).filter(Boolean);
  const meta = lines[1]?.match(/^(.*?)\s+di\s+(.+)$/);
  const score = lines[2]?.match(/^([1-5])\/5$/);
  if (!meta || !score) return null;
  const bodyLines: string[] = [];
  for (const line of lines.slice(3).filter((l) => !TRIP_TYPE_LINE.test(l))) {
    if (BODY_END_LINE.test(line)) break;
    bodyLines.push(line);
  }
  const text = bodyLines.join(" ").replace(/\s*…\s*Baca$/, "").trim();
  if (text.length < 15) return null;
  const dateInfo = parseRelativeDateWithUncertainty(meta[1], baseDate);
  return {
    author: lines[0],
    rating: Number(score[1]),
    reviewDate: dateInfo.date,
    dateUncertaintyDays: dateInfo.uncertaintyDays,
    rawDateText: dateInfo.raw,
    observedAt: baseDate,
    text,
    source: normalizeReviewSource(meta[2]),
    sourceUrl,
  };
}

/**
 * Pilih satu opsi di kotak pilihan tab ulasan. Opsi hanya bisa dipilih setelah kotaknya dibuka; klik pada opsi yang
 * masih tersembunyi tidak mengubah apa pun, dan karena itu urutan "Terbaru" tidak pernah aktif sebelum 18 Nov 2026
 * (yang terbaca selama ini 10 ulasan "Paling berguna"). Diamati 18 Nov 2026: sesudah kotak lain dipakai, klik pertama
 * pada kotak sumber hanya memfokuskannya, jadi kotak dibuka menurut keadaan aria-expanded-nya, paling banyak dua klik.
 * Gagal memilih dilempar supaya tidak tercatat sebagai berhasil.
 */
async function chooseReviewOption(page: Page, listbox: string, value: string): Promise<void> {
  const option = `${listbox} [role="option"][data-value="${value}"]`;
  if (await page.$$eval(option, (els) => els.some((o) => o.getAttribute("aria-selected") === "true"))) return;
  const firstBefore = await page.$eval(REVIEW_CARD, (el) => (el as HTMLElement).innerText);
  await page.waitForFunction(() => !document.querySelector('[role="listbox"][aria-expanded="true"]'), { timeout: REVIEW_UPDATE_TIMEOUT_MS });
  for (let click = 1; ; click++) {
    if ((await page.$eval(listbox, (el) => el.getAttribute("aria-expanded"))) !== "true") await page.click(listbox);
    const shown = await page
      .waitForFunction((sel) => (document.querySelector(sel)?.getBoundingClientRect().height ?? 0) > 0, { timeout: LISTBOX_OPEN_TIMEOUT_MS }, option)
      .then(() => true, () => false);
    if (shown) break;
    if (click === 2) throw new Error(`kotak ${listbox} tidak terbuka setelah dua klik`);
  }
  await page.click(option);
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((o) => o.getAttribute("aria-selected") === "true"), { timeout: REVIEW_UPDATE_TIMEOUT_MS }, option);
  await page
    .waitForFunction((sel, before) => (document.querySelector(sel) as HTMLElement | null)?.innerText !== before, { timeout: REVIEW_UPDATE_TIMEOUT_MS }, REVIEW_CARD, firstBefore)
    // ZERO-FALLBACK: daftar yang kartu pertamanya kebetulan sama setelah pilihan berganti tetap dibaca apa adanya.
    .catch(() => undefined);
}

/**
 * Merayap ulasan terbaru (Google + OTA seperti Tripadvisor/Trip.com) dari tab ulasan Google Travel: urutan "Terbaru",
 * lalu 10 kartu terbaru untuk semua sumber dan untuk tiap sumber. Melempar error bila halaman atau urutan tidak dapat
 * dibaca, agar kegagalan tidak tercatat sebagai "0 ulasan baru".
 */
export async function scrapeReviewsFromGoogle(target: ReviewTarget, baseDate = new Date(), sharedBrowser?: Browser): Promise<ParsedReview[]> {
  // Pencarian nama di Google Travel memakai /travel/search, yang dilarang robots.txt google.com; tanpa alamat entity
  // dari registri (ratesUrl atau mapsUrl) hotel itu dicatat gagal, bukan dicari.
  if (!target.travelEntityUrl) {
    throw new Error(`alamat entity Google Travel untuk ${target.competitorName} belum tercatat di daftar kompetitor; pencarian /travel/search dilarang robots.txt google.com`);
  }
  const reviewsUrl = travelReviewsUrl(target.travelEntityUrl);
  const browser = sharedBrowser ?? (await launchReviewBrowser());
  // Konteks baru per hotel menjaga sesi/cookie tidak terbawa antar properti Google Travel maupun ke venue Google Maps.
  const ctx = sharedBrowser ? await browser.createBrowserContext() : null;
  const page = ctx ? await ctx.newPage() : await browser.newPage();
  try {
    await page.setViewport(REVIEW_VIEWPORT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "id-ID,id;q=0.9" });
    await page.goto(reviewsUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(REVIEW_CARD, { timeout: REVIEW_LIST_TIMEOUT_MS }).catch(() => {
      throw new Error(`0 kartu ulasan terbaca di ${reviewsUrl} (struktur halaman berubah?)`);
    });
    await chooseReviewOption(page, SORT_LISTBOX, NEWEST_SORT).catch((error: Error) => {
      throw new Error(`urutan "Terbaru" tidak bisa dipilih di ${reviewsUrl}: ${error.message}`);
    });

    const cards = new Set<string>();
    const readCards = async () => {
      for (const card of await page.$$eval(REVIEW_CARD, (els) => els.map((el) => (el as HTMLElement).innerText))) cards.add(card);
    };
    await readCards();
    // Hotel tanpa ulasan OTA tidak punya kotak sumber; daftar "Semua ulasan" di atas sudah mencakup semuanya.
    const sources = await page.$$eval(`${SOURCE_LISTBOX} [role="option"]`, (els) => els.map((e) => e.getAttribute("data-value")).filter((v): v is string => v !== null));
    for (const value of sources.filter((v) => v !== ALL_SOURCES)) {
      await chooseReviewOption(page, SOURCE_LISTBOX, value);
      await readCards();
    }

    const results = [...cards]
      .map((card) => parseReviewCard(card, reviewsUrl, baseDate))
      .filter((r): r is ParsedReview => r !== null);
    if (results.length === 0) throw new Error(`${cards.size} kartu terbaca tetapi tidak ada yang bisa diurai di ${reviewsUrl}`);
    return results;
  } finally {
    await page.close().catch(() => undefined); // ZERO-FALLBACK: tab putus dibersihkan oleh penutupan konteks/browser.
    if (ctx) await ctx.close().catch(() => undefined); // ZERO-FALLBACK: konteks putus dibersihkan oleh penutupan browser.
    if (!sharedBrowser) await browser.close();
  }
}

async function launchReviewBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"],
  });
}

/** true bila `short` adalah teks kartu yang terpotong ("…") dari ulasan yang sama dengan `full`. */
export function isTruncatedVersionOf(short: string, full: string): boolean {
  const head = short.replace(/\s*(…|\.\.\.)\s*$/, "").trim();
  return head.length < short.trim().length && full.length > head.length && full.startsWith(head);
}

/**
 * Menyimpan ulasan hasil perayapan ke Supabase secara idempoten (Zero Duplicate via externalId sha256).
 */
export async function ingestScrapedReviews(
  competitorId: string,
  competitorName: string,
  reviews: ParsedReview[]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const r of reviews) {
    const externalId = r.reviewId ? `gmaps:${r.reviewId}` : generateExternalId(competitorName, r.author, r.reviewDate, r.text);
    // Teks yang sama dihitung sudah ada (externalId versi lama memuat tanggal relatif yang bergeser tiap hari). Ulasan
    // Google Maps juga dicocokkan lewat review id, karena kartu yang belum dibuka tertangkap dengan teks terpotong.
    const sameReview = [
      { externalId },
      { text: r.text },
      ...(r.reviewId ? [{ sourceUrl: { contains: `reviewid=${encodeURIComponent(r.reviewId)}` } }] : []),
    ];
    const existing = await db.competitorReview.findFirst({
      where: { competitorId, source: r.source, OR: sameReview },
      select: { id: true, text: true, version: true },
    });
    if (existing) {
      if (isTruncatedVersionOf(existing.text, r.text)) {
        await db.competitorReview.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { text: r.text, sentiment: determineReviewSentiment(r.text, r.rating), themes: extractThemes(r.text), version: { increment: 1 } },
        });
      }
      skipped++;
      continue;
    }
    await db.competitorReview.create({
      data: {
        competitorId,
        externalId,
        source: r.source,
        sourceUrl: r.sourceUrl,
        rating: r.rating,
        reviewDate: r.reviewDate,
        text: r.text,
        sentiment: determineReviewSentiment(r.text, r.rating),
        themes: extractThemes(r.text),
        capturedAt: r.observedAt ?? new Date(),
      },
    });
    inserted++;
  }

  return { inserted, skipped };
}

/**
 * Eksekusi perayapan ulasan harian.
 * Secara bawaan mengambil target dari repositori DB (getReviewTargets).
 * Kegagalan per target dikumpulkan dan dikembalikan (bukan ditelan) sehingga job malam bisa menandai run sebagai gagal.
 */
export async function scrapeNewGoogleReviews(
  targets?: ReviewTarget[]
): Promise<{ attempted: number; totalInserted: number; totalSkipped: number; failures: string[] }> {
  let totalInserted = 0;
  let totalSkipped = 0;
  const failures: string[] = [];

  const resolvedTargets = targets && targets.length > 0 ? targets : await getReviewTargets();
  let attempted = resolvedTargets.length;

  const competitors = await db.competitor.findMany({
    where: { name: { in: resolvedTargets.map((t) => t.competitorName) } },
    select: { id: true, name: true },
  });
  const idByName = new Map(competitors.map((c) => [c.name, c.id]));

  console.log(`[scrape-reviews] Memulai perayapan ulasan baru untuk ${resolvedTargets.length} hotel...`);

  // Satu Chrome untuk semua hotel; dulu satu peluncuran per hotel membuat langkah ini makan waktu dua jam.
  const browser = await launchReviewBrowser();
  try {
  for (const target of resolvedTargets) {
    const competitorId = idByName.get(target.competitorName);
    if (!competitorId) {
      failures.push(`${target.competitorName}: tidak ada di tabel Competitor`);
      continue;
    }
    try {
      const started = Date.now();
      const reviews = await scrapeReviewsFromGoogle(target, new Date(), browser);
      const stats = await ingestScrapedReviews(competitorId, target.competitorName, reviews);
      totalInserted += stats.inserted;
      totalSkipped += stats.skipped;
      console.log(`[scrape-reviews] ${target.competitorName}: ${reviews.length} terbaca, +${stats.inserted} baru, ${stats.skipped} sudah ada (${((Date.now() - started) / 1000).toFixed(1)} dtk, ${target.travelEntityUrl ? "entity registri" : "pencarian nama"}).`);
    } catch (err) {
      const message = (err as Error).message;
      failures.push(`${target.competitorName}: ${message}`);
      console.error(`[scrape-reviews] GAGAL ${target.competitorName}: ${message}`);
    }
  }

    // Restoran, bar, dan spa pesaing di Google Maps memakai Chrome yang sama; kegagalannya ikut dilaporkan per tempat.
    // Pemanggil yang menyebut target hotel sendiri hanya meminta hotel itu.
    const venues = await scrapeVenueMapsReviews(browser, targets?.length ? [] : await loadVenueReviewTargets());
    totalInserted += venues.inserted;
    totalSkipped += venues.skipped;
    failures.push(...venues.failures);
    attempted += venues.attempted;
    console.log(`[scrape-reviews] Google Maps restoran, bar, dan spa: ${venues.attempted} tempat, +${venues.inserted} ulasan baru, ${venues.failures.length} gagal.`);
  } finally {
    await browser.close();
  }

  return { attempted, totalInserted, totalSkipped, failures };
}

/*
 * Ulasan Google Maps restoran, bar, dan spa pesaing (termasuk outlet di dalam hotel yang punya listing sendiri). Dibaca
 * dengan identitas perayap jujur: uji 16 Nov 2026 menunjukkan tab Ulasan tetap tampil untuk SanghyangNewsCrawler/1.0,
 * berisi 5 ulasan "paling relevan" dan tombol topik. Tampilannya tidak selalu sama (kunjungan ulang bisa tanpa judul
 * tempat atau dengan kartu lebih sedikit), jadi halaman tanpa blok rating dicatat gagal, bukan dianggap 0 ulasan.
 */

export interface VenueMapsPage {
  ratingBlock: string | null;
  /** true bila tab Ulasan/Reviews tampil dan terbuka; false menandakan tampilan terbatas Google Maps. */
  tabOpened?: boolean;
  chipLabels: (string | null)[];
  cards: (Omit<MapsReviewCard, "author"> & { author?: string })[];
}

export interface VenueReviewTarget {
  competitorId: string;
  name: string;
  mapsUrl: string;
  /** true untuk outlet di dalam hotel; ratingnya disimpan ke baris outlet karena job rating malam hanya membaca listing registri. */
  isVenue: boolean;
}

export interface VenueRegistryRow {
  id: string;
  name: string;
  category: string | null;
  parentId: string | null;
  compsetRole: string | null;
  mapsUrl?: string | null;
  googleMapsUrl?: string | null;
}

const MAPS_PLACE = /^https:\/\/www\.google\.com\/maps\/place\//;
const LODGING_CATEGORIES = new Set(["hotel", "resort"]);

/** Listing Google Maps tempat itu sendiri dari data menu pesaing (kisaran per orang atau foto menu), bila tercatat. */
export function listingFromMenu(menu: CompetitorMenu | null): string | null {
  if (!menu) return null;
  return [menu.perPerson?.url, ...menu.sources.map((s) => s.url)].find((u): u is string => Boolean(u && MAPS_PLACE.test(u))) ?? null;
}

/**
 * Restoran, bar, dan spa pembanding dengan listing Google Maps sendiri. Outlet di dalam hotel yang tautan registrinya sama
 * dengan hotel induk memakai listing dari data menu; tanpa itu outlet dilewati supaya ulasan hotel tidak tercatat
 * sebagai ulasan restorannya.
 */
export function venueReviewTargets(
  rows: readonly VenueRegistryRow[],
  ownOutlets: readonly { competitorName: string }[],
  listingOf: (name: string) => string | null,
): VenueReviewTarget[] {
  const own = new Set(ownOutlets.map((o) => o.competitorName));
  const urlOf = (r: VenueRegistryRow) => r.mapsUrl ?? r.googleMapsUrl ?? null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const targets: VenueReviewTarget[] = [];
  for (const r of rows) {
    if (own.has(r.name) || LODGING_CATEGORIES.has(r.category ?? "") || (r.compsetRole !== "inti" && r.compsetRole !== "benchmark")) continue;
    const registryUrl = urlOf(r);
    const parentUrl = r.parentId ? urlOf(byId.get(r.parentId) ?? ({} as VenueRegistryRow)) : null;
    const ownListing = registryUrl && MAPS_PLACE.test(registryUrl) && registryUrl !== parentUrl ? registryUrl : null;
    const url = ownListing ?? (r.parentId ? listingOf(r.name) : null);
    if (url) targets.push({ competitorId: r.id, name: r.name, mapsUrl: url, isVenue: Boolean(r.parentId) });
  }
  return targets;
}

/** Mendukung format koma Indonesia ("4,6") maupun titik Inggris ("4.6") bila Google mengabaikan hl=id. */
function parseMapsRatingFlexible(text: string): number | null {
  const fromId = parseMapsRating(text);
  if (fromId !== null) return fromId;
  const line = text.split("\n").map((l) => l.trim()).find((l) => /^[1-5][.,]\d$/.test(l));
  return line ? Number(line.replace(",", ".")) : null;
}

/** Menormalisasi label bintang kartu Maps ("5 stars", "4 out of 5 stars", "5/5") agar cocok dengan parseMapsReviewCard. */
function normalizeMapsStars(stars: string): string {
  const trimmed = stars.trim();
  if (/^[1-5]\s*bintang/i.test(trimmed)) return trimmed;
  const m = trimmed.match(/^([1-5])(?:\.0)?(?:\s*(?:stars?|out of 5|\/5))/i) ?? trimmed.match(/^([1-5])\/5$/);
  return m ? `${m[1]} bintang` : trimmed;
}

function normalizeMapsCard(c: Omit<MapsReviewCard, "author"> & { author?: string }): MapsReviewCard {
  return {
    id: c.id,
    author: c.author ?? "",
    stars: normalizeMapsStars(c.stars),
    date: c.date.replace(/^Edited\s+/i, "Diedit "),
    text: c.text.replace(/\s*…?\s*More$/i, "").trim(),
  };
}

/** Rating, jumlah ulasan, topik, jumlah kartu ber-bintang (termasuk tanpa teks), dan ulasan siap simpan dari tab Ulasan Maps. */
export function parseVenueMapsPage(page: VenueMapsPage, mapsUrl: string, now: Date) {
  const normalizedCards = page.cards.map(normalizeMapsCard);
  const ratedCardsCount = normalizedCards.filter((c) => Boolean(c.id) && /^[1-5]\s*bintang/i.test(c.stars)).length;
  const reviews = normalizedCards
    .map((c) => parseMapsReviewCard(c, mapsUrl, now, parseRelativeDate))
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return {
    rating: page.ratingBlock ? parseMapsRatingFlexible(page.ratingBlock) : null,
    reviewCount: page.ratingBlock ? parseMapsReviewCount(page.ratingBlock) : null,
    topics: parseTopicChips(page.chipLabels),
    ratedCardsCount,
    reviews: reviews as ParsedReview[],
  };
}

/**
 * Validasi jujur hasil baca tab Ulasan Google Maps.
 * Mengembalikan pesan galat bila tampilan terbatas atau kartu tidak termuat, dan `null` bila sah (termasuk tempat yang
 * seluruh ulasannya berupa rating bintang tanpa teks komentar seperti Alta Spa 5,0 / 1 ulasan).
 */
export function validateVenueMapsRead(
  raw: VenueMapsPage,
  parsed: ReturnType<typeof parseVenueMapsPage>,
): string | null {
  if (parsed.rating === null) return "blok rating tidak tampil di listing (tampilan terbatas untuk perayap)";
  const expectedReviews = parsed.reviewCount ?? 1;
  if (raw.tabOpened === false && expectedReviews > 0) {
    return "tab Ulasan tidak tampil di listing (tampilan terbatas untuk perayap)";
  }
  if (parsed.ratedCardsCount === 0 && expectedReviews > 0) {
    return "tab Ulasan tidak menampilkan kartu ulasan";
  }
  return null;
}

/** Batas atas menunggu blok rating, tab Ulasan, dan kartu ulasan muncul (peristiwa halaman, bukan jeda tetap). */
const VENUE_RATING_TIMEOUT_MS = 30_000;
const VENUE_TAB_TIMEOUT_MS = 15_000;
const VENUE_CARDS_TIMEOUT_MS = 15_000;
const VENUE_TAB_SELECTOR = 'button[role="tab"][aria-label*="Ulasan"], button[role="tab"][aria-label*="Reviews"]';

export type RawVenueMapsCard = Omit<MapsReviewCard, "author"> & { author?: string };

/**
 * Mengutamakan kartu dari tab Ulasan (lebih lengkap + topik); bila XHR tab Ulasan sedang kosong sementara, memakai
 * kartu asli yang sudah dirender Google Maps pada panel Ringkasan tempat yang sama (Zero Mock).
 */
export function mergeVenueMapsCards(
  tabCards: readonly RawVenueMapsCard[],
  overviewCards: readonly RawVenueMapsCard[],
): RawVenueMapsCard[] {
  return tabCards.length > 0 ? [...tabCards] : [...overviewCards];
}

async function extractDomMapsCards(page: Page): Promise<RawVenueMapsCard[]> {
  return page.$$eval("div.jftiEf", (els) =>
    els.map((e) => ({
      id: e.getAttribute("data-review-id"),
      author: (e.querySelector(".d4r55") as HTMLElement | null)?.innerText ?? "",
      stars:
        e.querySelector(".kvMYJc")?.getAttribute("aria-label") ??
        (e.querySelector(".fzvQIb") as HTMLElement | null)?.innerText ??
        "",
      date: (e.querySelector(".rsqaWe") as HTMLElement | null)?.innerText ?? "",
      text: (e.querySelector(".wiI7pd") as HTMLElement | null)?.innerText ?? "",
    })),
  );
}

async function readVenueMapsPage(page: Page, mapsUrl: string): Promise<{ page: VenueMapsPage; fromTab: boolean }> {
  await page.goto(`${mapsUrl}${mapsUrl.includes("?") ? "&" : "?"}hl=id`, { waitUntil: "domcontentloaded" });
  const rating = await page.waitForSelector("div.F7nice", { timeout: VENUE_RATING_TIMEOUT_MS }).then(() => true, () => false);
  if (!rating) return { page: { ratingBlock: null, tabOpened: false, chipLabels: [], cards: [] }, fromTab: false };
  const ratingBlock = await page.$eval("div.F7nice", (el) => (el as HTMLElement).innerText);
  const tab = await page.waitForSelector(VENUE_TAB_SELECTOR, { timeout: VENUE_TAB_TIMEOUT_MS }).catch(() => null);
  if (!tab) return { page: { ratingBlock, tabOpened: false, chipLabels: [], cards: [] }, fromTab: false };

  // Rekam kartu ulasan asli yang sudah tampil di panel Ringkasan sebelum klik tab Ulasan mengganti DOM.
  const overviewCards = await extractDomMapsCards(page);

  const waitReviewsPanel = () =>
    page
      .waitForFunction(
        (tabSel: string) => {
          const t = document.querySelector(tabSel);
          if (!t || t.getAttribute("aria-selected") !== "true") return false;
          // Panel Ringkasan juga memuat kartu div.jftiEf; tombol Urutkan/Telusuri hanya muncul setelah panel tab Ulasan selesai dimuat.
          const panelMounted = Boolean(
            document.querySelector('button[aria-label*="Urutkan"], button[aria-label*="Sort"], button[aria-label*="Telusuri ulasan"], button[aria-label*="Search reviews"], div[role="radiogroup"]'),
          );
          const hasCards = document.querySelectorAll("div.jftiEf .kvMYJc, div.jftiEf .fzvQIb").length > 0;
          return panelMounted && hasCards;
        },
        { timeout: VENUE_CARDS_TIMEOUT_MS },
        VENUE_TAB_SELECTOR,
      )
      .then(() => true, () => false);

  await tab.click();
  let loaded = await waitReviewsPanel();
  if (!loaded) {
    // Bila klik pertama terserap transisi layout awal, klik ulang langsung pada tombol tab lalu tunggu ulang.
    await page.evaluate((tabSel: string) => (document.querySelector(tabSel) as HTMLElement | null)?.click(), VENUE_TAB_SELECTOR);
    loaded = await waitReviewsPanel();
  }

  if (loaded) {
    await page.$$eval("div.jftiEf button.w8nwRe", (els) => els.forEach((e) => (e as HTMLElement).click()));
    await page
      .waitForFunction(() => ![...document.querySelectorAll("div.jftiEf .wiI7pd")].some((e) => /…\s*$/.test(e.textContent || "")), { timeout: VENUE_CARDS_TIMEOUT_MS })
      // ZERO-FALLBACK: teks yang tetap terpotong disimpan apa adanya; review id membuat teks lengkap menggantikannya nanti.
      .catch(() => undefined);
  }
  const chipLabels = await page.$$eval("div[role='radiogroup'] button, button.e2moi", (els) => els.map((e) => e.getAttribute("aria-label")));
  const tabCards = await extractDomMapsCards(page);
  const cards = mergeVenueMapsCards(tabCards, overviewCards);
  const selected = await page.evaluate(
    (tabSel: string) => document.querySelector(tabSel)?.getAttribute("aria-selected") === "true",
    VENUE_TAB_SELECTOR,
  );
  return {
    page: { ratingBlock, tabOpened: selected || loaded, chipLabels, cards },
    fromTab: tabCards.length > 0,
  };
}

export interface VenueReviewRun {
  attempted: number;
  inserted: number;
  skipped: number;
  failures: string[];
  topics: Record<string, ReviewTopics>;
  /** Rating listing outlet di dalam hotel yang tersimpan ke registri. */
  venueRatings: string[];
}

/**
 * Buka satu listing di BrowserContext terisolasi dengan identitas perayap jujur lalu urai isinya; tidak menulis apa pun.
 * Isolasi konteks mencegah cookie kunjungan sebelumnya memicu tampilan terbatas Google Maps; mencoba ulang 1x bila
 * percobaan pertama gagal muat, terkena tampilan terbatas, atau tab Ulasan kosong sementara.
 */
export async function readVenueListing(browser: Browser, target: VenueReviewTarget, now = new Date()) {
  let lastError: string | null = null;
  let overviewBackup: ReturnType<typeof parseVenueMapsPage> | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctx = await browser.createBrowserContext();
    try {
      const page = await ctx.newPage();
      await page.setUserAgent(PROFILE_CRAWLER_UA);
      await page.setViewport({ width: 1280, height: 900 });
      await page.setExtraHTTPHeaders({ "Accept-Language": "id-ID,id;q=0.9" });
      const { page: raw, fromTab } = await readVenueMapsPage(page, target.mapsUrl);
      const parsed = parseVenueMapsPage(raw, target.mapsUrl, now);
      const failure = validateVenueMapsRead(raw, parsed);
      if (!failure) {
        if (fromTab || attempt === 2) return parsed;
        overviewBackup = parsed;
      } else {
        lastError = failure;
      }
    } finally {
      await ctx.close().catch(() => undefined); // ZERO-FALLBACK: konteks yang frame-nya putus dibersihkan oleh browser.close() pemanggil.
    }
  }
  if (overviewBackup) return overviewBackup;
  throw new Error(lastError ?? "tab Ulasan tidak menampilkan kartu ulasan");
}

/** Baca ulasan Google Maps para target satu per satu, simpan idempoten, dan kembalikan kegagalan apa adanya. */
export async function scrapeVenueMapsReviews(browser: Browser, targets: readonly VenueReviewTarget[], now = new Date()): Promise<VenueReviewRun> {
  const run: VenueReviewRun = { attempted: targets.length, inserted: 0, skipped: 0, failures: [], topics: {}, venueRatings: [] };
  for (const t of targets) {
    try {
      const parsed = await readVenueListing(browser, t, now);
      const stats = await ingestScrapedReviews(t.competitorId, t.name, parsed.reviews);
      run.inserted += stats.inserted;
      run.skipped += stats.skipped;
      if (parsed.topics.length) run.topics[t.name] = { url: t.mapsUrl, observedAt: now.toISOString(), topics: parsed.topics };
      if (t.isVenue) {
        const row = await db.competitor.findUnique({ where: { id: t.competitorId }, select: { version: true } });
        if (!row) throw new Error("baris daftar kompetitor hilang");
        const res = await db.competitor.updateMany({
          where: { id: t.competitorId, version: row.version },
          data: { rating: parsed.rating, reviewCount: parsed.reviewCount, ratingSource: "Google Maps", ratingSourceUrl: t.mapsUrl, ratingObservedAt: now, version: { increment: 1 } },
        });
        if (res.count !== 1) throw new Error("OCC conflict: rating outlet diubah proses lain");
        run.venueRatings.push(`${t.name} ${parsed.rating}`);
      }
      const note =
        parsed.reviews.length === 0 && parsed.ratedCardsCount > 0
          ? `0 ulasan bertulis (${parsed.ratedCardsCount} kartu rating bintang tanpa komentar)`
          : `${parsed.reviews.length} terbaca`;
      console.log(`[ulasan-venue] ${t.name}: ${note}, +${stats.inserted} baru, ${parsed.topics.length} topik.`);
    } catch (error) {
      run.failures.push(`${t.name}: ${(error as Error).message}`);
      console.error(`[ulasan-venue] GAGAL ${t.name}: ${(error as Error).message}`);
    }
  }
  return run;
}

/** Target ulasan venue dari registri aktif dan listing di data menu pesaing. */
export async function loadVenueReviewTargets(): Promise<VenueReviewTarget[]> {
  const [{ OWN_OUTLETS }, { competitorMenu }] = await Promise.all([import("./outlet-ratings"), import("./competitor-menu")]);
  const rows = await db.competitor.findMany({
    where: { active: true },
    select: { id: true, name: true, category: true, parentId: true, compsetRole: true, mapsUrl: true, googleMapsUrl: true },
  });
  return venueReviewTargets(rows, OWN_OUTLETS, (name) => listingFromMenu(competitorMenu(name)));
}
