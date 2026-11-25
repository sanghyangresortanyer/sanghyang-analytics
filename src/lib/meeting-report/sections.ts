/**
 * Fungsi murni penyusun komponen laporan PDF ringkas Insight Pasar (jendela pembanding dinamis
 * sesuai durasi periode terpilih, sentimen positif/netral/negatif, tabel matriks ringkas tanpa
 * kolom Audit pembanding, pembersih teks cetak, serta helper `renderPlaceSubsectionReviews`).
 */
import type { StoredFact } from "../market/competitor-facts";
import type { PlaceSpecs } from "../market/place-specs";
import type { FnbMatrixEntry, HotelMatrixEntry, OutletCompetitorMatrix } from "../market/competitor-matrix";
import type { CompetitorMenuItem, PerPersonRange } from "../market/competitor-menu";
import { wibDay, wibDayStart, type DayRange } from "../market/date-range";
import { dateLabel } from "../market/menu-format";
import { extractPromoPlainText } from "../market/promo-radar";
import type { HotelRateRange } from "../market/resort-room-rates";
import { truncateText } from "../text/safe-truncate";
import {
  NO_DATA,
  type ReportReviewQuote,
  type ReportSource,
  type ReportSubsection,
  type ReportTable,
  type SentimentCounts,
} from "./types";

export interface PlaceReview {
  rating: number;
  sentiment?: string | null;
  text: string;
  source: string;
  sourceUrl: string;
  reviewDate: string;
  themes: string[];
}

export interface PlaceData {
  name: string;
  role: "sanghyang" | "inti" | "acuan";
  category: string | null;
  starRating: number | null;
  roadKm: number | null;
  driveMinutes: number | null;
  distanceSource: string | null;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  ratingObservedAt: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  roomCount: number | null;
  roomCountSource: string | null;
  auditRationale: string | null;
  facts: StoredFact[];
  reviews: PlaceReview[];
  promos: {
    title: string;
    discount: number | null;
    sourceUrl: string | null;
    sourceLabel: string;
    note: string | null;
    program: boolean;
    event: boolean;
    dateLabel: string;
  }[];
  rates: { kind: string; room: string; weekday: number | null; weekend: number | null; source: string | null }[];
  rateRange: HotelRateRange | null;
  market: { estimatedMonthlyRevenue: number | null; share: number | null; priceVsSanghyang: number | null } | null;
  actualShare: { month: string; share: number; rank: string } | null;
  menu: CompetitorMenuItem[];
  menuSources: ReportSource[];
  perPerson: PerPersonRange | null;
  menuChecked: string[];
  menuListed: boolean;
  specs?: PlaceSpecs | null;
}

export interface SectionContext {
  isResort: boolean;
  ratesCapturedAt: string;
  ratesCheckIn: { weekday: string; weekend: string };
  ratesWindowNote: string;
  tpk: { percent: number; period: string; sourceUrl: string } | null;
}

/** Kolom Audit pembanding tetap di web tetapi tidak dicetak di PDF (pemilik, 20 Nov 2026); cocokkan tanpa peka huruf. */
export const isAuditColumn = (column: string) => /^audit\s+pembanding$/i.test(column.trim());

/** Kolom tabel 2 yang dicetak: urutan kolom web dikurangi Audit pembanding. */
export const pdfMatrixColumns = (cm: Pick<OutletCompetitorMatrix, "columns">) => cm.columns.filter((c) => !isAuditColumn(c));

const DAY_MS = 86_400_000;
const MAX_QUOTES = 3;
const QUOTE_CHARS = 220;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function uniqueSources(list: (ReportSource | null)[]): ReportSource[] {
  const out: ReportSource[] = [];
  for (const s of list) {
    if (s && !out.some((o) => o.label === s.label && o.url === s.url)) out.push(s);
  }
  return out;
}

const MONTH_SHORT: Record<string, string> = {
  jan: "Jan", januari: "Jan", feb: "Feb", februari: "Feb", mar: "Mar", maret: "Mar", apr: "Apr", april: "Apr",
  mei: "Mei", jun: "Jun", juni: "Jun", jul: "Jul", juli: "Jul", agu: "Agu", agt: "Agu", agustus: "Agu",
  sep: "Sep", september: "Sep", okt: "Okt", oktober: "Okt", nov: "Nov", november: "Nov", des: "Des", desember: "Des",
};
/** "diperiksa 15 & 19 Nov 2026" atau "diperiksa 17 November 2026" yang belum diawali "terakhir". */
const CHECKED_DATES = /(?<!terakhir\s)\bdiperiksa\s+(?:\d{1,2}\s*(?:&|dan|,)\s*)*(\d{1,2})\s+(\p{L}{3,9})\.?\s+(\d{4})/giu;

/** Format pemilik untuk tanggal pemeriksaan sumber: "terakhir diperiksa DD Mmm YYYY" (tanggal paling akhir saja). */
export function normalizeCheckedDates(text: string): string {
  return text.replace(CHECKED_DATES, (whole, day: string, month: string, year: string) => {
    const short = MONTH_SHORT[month.toLowerCase()];
    return short ? `terakhir diperiksa ${day} ${short} ${year}` : whole;
  });
}

/**
 * Nama alat pengambil data dan nama berkas internal tidak dicetak, walau alatnya memang dipakai; cukup sumber data dan
 * tanggal pembacaan (pemilik, 20 Nov 2026). Jarak dari server rute terbuka ditulis "estimasi rute": jujur bukan
 * pengukuran Google Maps, tanpa menyebut nama alatnya.
 */
export function scrubToolMentions(text: string): string {
  return text
    .replace(/\b(?:diperiksa|crawl)\s+Crawl4AI\b/gi, "terakhir diperiksa")
    .replace(/\(\s*OSRM\s*\)/g, "(estimasi rute)")
    .replace(/\s*\/\s*OSRM\b/g, "")
    .replace(/\bOSRM\b/g, "perhitungan rute")
    .replace(/\b(?:Crawl4AI|Playwright|Puppeteer|Selenium|Antigravity)\b/gi, "")
    .replace(/\(\s*[\w-]+\.(?:json|csv|ts|js|py)\s*\)/gi, "")
    .replace(/\b[\w-]+\.(?:json|csv|py)\b/gi, "");
}

const URL_TOKEN = /\bhttps?:\/\/[^\s,)]+/gi;
const DOMAIN_TOKEN = /\b(?:[a-z0-9-]+\.)+(?:com|co\.id|id|net|org|io|travel)(?:\/[^\s,)]*)?/gi;
const PATH_TOKEN = /(^|\s)&?\s*\/[a-z0-9._-]+(?:\/[a-z0-9._-]*)*/gi;

/** Keterangan "dicek" pada sel Belum ada data dalam bentuk cetak: tanpa URL, domain, atau nama berkas. */
export function compactCheckNote(text: string): string {
  return normalizeCheckedDates(scrubToolMentions(text).replace(URL_TOKEN, "").replace(DOMAIN_TOKEN, "").replace(PATH_TOKEN, "$1"))
    .replace(/\(\s*[,;&]\s*/g, "(")
    .replace(/\s*[,;&]\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,;:)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const EMOJI_CHARS = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const RAW_POST_PREFIX = /^\[(REELS|FEED|CAROUSEL|TIKTOK_VIDEO|STORY)\]/i;
const SOCIAL_TAG = /(^|\s)[#@][\p{L}\p{N}_.]+/gu;
const OFFER_SENTENCE = /\b(?:free|gratis|diskon|discount|promo|hemat|cashback|voucher|bundling|paket|package|buy\s+\d|beli\s+\d)\b|\b(?:rp\.?|idr)\s*\d|\d{1,3}\s*%|\b\d{2,4}\s*k\b/i;
const DISPLAY_TITLE_MAX = 110;

const stripEmoji = (text: string) => text.replace(EMOJI_CHARS, " ").replace(/\s+/g, " ").trim();
const cleanCaptionLine = (line: string) => stripEmoji(line.replace(SOCIAL_TAG, "$1").replace(/\*\*|__/g, ""));

function shortenAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = truncateText(text, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace >= Math.floor(max / 2) ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:·–-]+$/u, "")}…`;
}

/**
 * Judul promo/event untuk dicetak. Unggahan sosmed yang belum dikurasi berjudul potongan takarir mentah
 * ("[REELS] ... Kimia Fa"), jadi judulnya disusun ulang dari takarir: baris pembuka ditambah kalimat penawaran
 * (promo) atau kalimat berikutnya (event), tanpa emoji, tagar, dan sebutan akun.
 */
export function promoDisplayTitle(item: { title: string; description?: string | null; kind: "promo" | "event" }): string {
  const { title, body } = extractPromoPlainText(item);
  const lines = RAW_POST_PREFIX.test(item.title) && body ? body.split(/\n+/).map(cleanCaptionLine).filter(Boolean) : [];
  if (!lines.length) return shortenAtWord(stripEmoji(title), DISPLAY_TITLE_MAX);
  const [headline, ...rest] = lines;
  const follow = item.kind === "promo" ? (rest.find((l) => OFFER_SENTENCE.test(l)) ?? rest[0]) : rest[0];
  const joined = follow ? `${headline}${/[.!?…]$/u.test(headline) ? " " : " · "}${follow}` : headline;
  return shortenAtWord(joined, DISPLAY_TITLE_MAX);
}

function ymdAddDays(ymd: string, deltaDays: number): string {
  const utc = Date.parse(`${ymd}T00:00:00Z`) + deltaDays * DAY_MS;
  return new Date(utc).toISOString().slice(0, 10);
}

function isFullCalendarMonth(fromYmd: string, toYmd: string): boolean {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  if (fy !== ty || fm !== tm || fd !== 1) return false;
  const lastDay = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
  return td === lastDay;
}

function isFullCalendarYear(fromYmd: string, toYmd: string): boolean {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  return fy === ty && fm === 1 && fd === 1 && tm === 12 && td === 31;
}

/** Jumlah hari kalender WIB inklusif dalam rentang (mis. 15–20 Nov 2026 = 6 hari). */
export function inclusiveRangeDays(range: DayRange): number {
  const fromYmd = wibDay(range.from);
  const toYmd = wibDay(range.to);
  const diff = Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / DAY_MS);
  return Math.max(1, diff + 1);
}

/** Format rentang tanggal ringkas: "9–14 Nov 2026", "22 Sep–21 Okt 2026", atau "19 Nov 2026". */
export function compactDateRange(range: DayRange): string {
  const fromYmd = wibDay(range.from);
  const toYmd = wibDay(range.to);
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  if (fromYmd === toYmd) return `${fd} ${SHORT_MONTHS[fm - 1]} ${fy}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${SHORT_MONTHS[fm - 1]} ${fy}`;
  if (fy === ty) return `${fd} ${SHORT_MONTHS[fm - 1]}–${td} ${SHORT_MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${SHORT_MONTHS[fm - 1]} ${fy}–${td} ${SHORT_MONTHS[tm - 1]} ${ty}`;
}

/**
 * Menghitung rentang pembanding yang setara persis dengan durasi periode terpilih dalam hari WIB:
 * - Satu bulan kalender penuh (tgl 1 s.d. akhir bulan) -> bulan kalender penuh sebelumnya.
 * - Satu tahun kalender penuh (1 Jan s.d. 31 Des) -> tahun kalender penuh sebelumnya.
 * - Rentang lain (mis. 15–20 Nov = 6 hari, atau 30 hari berjalan) -> tepat N hari inklusif yang berakhir sehari sebelum `range.from`.
 */
export function previousPeriodRange(range: DayRange): DayRange {
  const fromYmd = wibDay(range.from);
  const toYmd = wibDay(range.to);
  const [fy, fm] = fromYmd.split("-").map(Number);

  if (isFullCalendarYear(fromYmd, toYmd)) {
    const start = wibDayStart(`${fy - 1}-01-01`) as Date;
    const endStart = wibDayStart(`${fy - 1}-12-31`) as Date;
    return { from: start, to: new Date(endStart.getTime() + DAY_MS - 1) };
  }

  if (isFullCalendarMonth(fromYmd, toYmd)) {
    const prevYear = fm === 1 ? fy - 1 : fy;
    const prevMonth = fm === 1 ? 12 : fm - 1;
    const lastDayPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
    const startStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const endStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(lastDayPrevMonth).padStart(2, "0")}`;
    const start = wibDayStart(startStr) as Date;
    const endStart = wibDayStart(endStr) as Date;
    return { from: start, to: new Date(endStart.getTime() + DAY_MS - 1) };
  }

  const days = inclusiveRangeDays(range);
  const prevEndYmd = ymdAddDays(fromYmd, -1);
  const prevStartYmd = ymdAddDays(fromYmd, -days);
  const start = wibDayStart(prevStartYmd) as Date;
  const endStart = wibDayStart(prevEndYmd) as Date;
  return { from: start, to: new Date(endStart.getTime() + DAY_MS - 1) };
}

export interface PreviousPeriodMeta {
  range: DayRange;
  days: number;
  title: string;
  dateRangeLabel: string;
  compactLabel: string;
}

/**
 * Menyusun rentang pembanding beserta label dinamis yang mencerminkan durasi periode terpilih
 * (mis. 6 hari -> "Periode Sebelumnya (6 hari: 9–14 Nov 2026)"; 30 hari -> "30 Hari Sebelumnya (...)").
 */
export function previousPeriodMeta(activeRange: DayRange): PreviousPeriodMeta {
  const fromYmd = wibDay(activeRange.from);
  const toYmd = wibDay(activeRange.to);
  const days = inclusiveRangeDays(activeRange);
  const range = previousPeriodRange(activeRange);
  const prevFromYmd = wibDay(range.from);
  const prevToYmd = wibDay(range.to);
  const dateRangeLabel =
    prevFromYmd === prevToYmd
      ? dateLabel(prevFromYmd)
      : `${dateLabel(prevFromYmd)} – ${dateLabel(prevToYmd)}`;
  const compactDates = compactDateRange(range);

  if (isFullCalendarYear(fromYmd, toYmd)) {
    return {
      range,
      days,
      title: "Tahun Sebelumnya",
      dateRangeLabel,
      compactLabel: `Tahun Sebelumnya (${compactDates})`,
    };
  }
  if (isFullCalendarMonth(fromYmd, toYmd)) {
    return {
      range,
      days,
      title: "Bulan Sebelumnya",
      dateRangeLabel,
      compactLabel: `Bulan Sebelumnya (${compactDates})`,
    };
  }
  if (days === 30 || days === 90 || days === 7 || days === 1) {
    const title = `${days} Hari Sebelumnya`;
    return {
      range,
      days,
      title,
      dateRangeLabel,
      compactLabel: `${title} (${compactDates})`,
    };
  }
  return {
    range,
    days,
    title: `Periode Sebelumnya (${days} hari)`,
    dateRangeLabel,
    compactLabel: `Periode Sebelumnya (${days} hari: ${compactDates})`,
  };
}

/** Klasifikasi sentimen konsisten: komentar sosial (rating 0) mengikuti `sentiment`, bukan dianggap keluhan. */
export function classifyReviewSentiment(r: Pick<PlaceReview, "rating" | "sentiment">): "positive" | "neutral" | "negative" {
  const s = r.sentiment?.toLowerCase();
  if (s === "positive" || s === "neutral" || s === "negative") return s;
  if (r.rating >= 4) return "positive";
  if (r.rating > 0 && r.rating <= 3) return "negative";
  return "neutral";
}

export function countSentiments(reviews: Pick<PlaceReview, "rating" | "sentiment">[]): SentimentCounts {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const r of reviews) {
    const s = classifyReviewSentiment(r);
    if (s === "positive") positive++;
    else if (s === "negative") negative++;
    else neutral++;
  }
  return { total: reviews.length, positive, neutral, negative };
}

/**
 * Memisahkan kutipan ulasan positif (pujian) dan negatif (perlu perhatian). Masukannya hanya ulasan periode terpilih:
 * pemilik menolak ulasan negatif dari luar periode (21 Nov 2026), jadi tidak ada cadangan ulasan lama.
 */
export function splitReviewQuotes(
  inPeriod: PlaceReview[],
  maxPerSide = 4,
): { praises: ReportReviewQuote[]; complaints: ReportReviewQuote[] } {
  const toQuote = (r: PlaceReview): ReportReviewQuote => ({
    rating: r.rating,
    sentiment: classifyReviewSentiment(r),
    text: truncateText(r.text.replace(/\s+/g, " ").trim(), QUOTE_CHARS),
    source: r.source,
    sourceUrl: r.sourceUrl,
    reviewDate: r.reviewDate,
    themes: r.themes,
  });

  const praises = inPeriod
    .filter((r) => classifyReviewSentiment(r) === "positive")
    .slice(0, maxPerSide)
    .map(toQuote);
  const complaints = inPeriod
    .filter((r) => classifyReviewSentiment(r) === "negative")
    .slice(0, maxPerSide)
    .map(toQuote);

  return { praises, complaints };
}

export function roomTypeSummary(h: Pick<HotelMatrixEntry, "roomTypes">): string {
  if (h.roomTypes.length === 0) return NO_DATA;
  const multi = h.roomTypes.filter((r) => (r.bedrooms ?? 0) >= 2).length;
  return `${h.roomTypes.length} tipe${multi > 0 ? ` (${multi} unit 2BR+)` : ""}`;
}

/** Sel "Rincian Menu & Harga": bila belum ada harga, keterangan pemeriksaan sumber diringkas untuk dicetak. */
export function fnbMenuDetailForPrint(f: Pick<FnbMatrixEntry, "menuItemCount" | "menuChecked" | "menuDetailLabel">): string {
  if (f.menuItemCount > 0 || f.menuChecked.length === 0) return f.menuDetailLabel;
  const note = compactCheckNote(f.menuChecked[0]);
  return note ? `${NO_DATA} (dicek: ${note})` : NO_DATA;
}

const RESORT_CELLS: Record<string, (h: HotelMatrixEntry) => string> = {
  No: (h) => String(h.no),
  Tempat: (h) => h.name,
  Bintang: (h) => h.starLabel,
  Jarak: (h) => h.distanceLabel,
  "Tipe Kamar": roomTypeSummary,
  Luas: (h) => h.areaSummaryLabel,
  "Tarif kamar (biasa / akhir pekan)": (h) => h.otaRateLabel,
  "Rating Google": (h) => h.ratingLabel,
  Kamar: (h) => h.roomCountLabel,
  "Smart TV": (h) => h.smartTvLabel,
  Bathtub: (h) => h.bathtubLabel,
  "Kolam / Air Panas": (h) => h.poolLabel,
  "Gaya Desain": (h) => h.designStyleLabel,
};

const FNB_CELLS: Record<string, (f: FnbMatrixEntry) => string> = {
  No: (f) => String(f.no),
  Tempat: (f) => f.name,
  Jarak: (f) => f.distanceLabel,
  "Rating Google": (f) => f.ratingLabel,
  "Kisaran Menu / Paket": (f) => f.menuRangeLabel,
  "Rincian Menu & Harga": fnbMenuDetailForPrint,
  "Fasilitas & Suasana": (f) => f.facilitiesLabel,
};

/**
 * Isi satu sel tabel 2 menurut nama kolom web. Kolom baru di matriks web harus diberi sel cetak di sini; tanpa itu
 * laporan gagal dengan pesan jelas, bukan mencetak kolom kosong.
 */
export function matrixCell(kind: OutletCompetitorMatrix["kind"], entry: HotelMatrixEntry | FnbMatrixEntry, column: string): string {
  const cell = kind === "resort" ? RESORT_CELLS[column] : FNB_CELLS[column];
  if (!cell) throw new Error(`Kolom matriks "${column}" (${kind}) belum punya sel cetak di lib/meeting-report/sections.ts`);
  return (cell as (e: HotelMatrixEntry | FnbMatrixEntry) => string)(entry);
}

/** Tabel 2 ringkas PDF: baris induk saja (tanpa sub-baris tipe kamar) dan tanpa kolom Audit pembanding. */
export function matrixTableFromCompetitorMatrix(cm: OutletCompetitorMatrix): ReportTable {
  const head = pdfMatrixColumns(cm);
  const entries: (HotelMatrixEntry | FnbMatrixEntry)[] = cm.kind === "resort" ? (cm.hotelEntries ?? []) : (cm.fnbEntries ?? []);
  return { head, rows: entries.map((e) => head.map((column) => matrixCell(cm.kind, e, column))) };
}

/**
 * Helper subbagian ulasan per tempat (dipertahankan untuk kompatibilitas kontrak `browser-social-sync.test.ts`):
 * komentar sosial tanpa rating bintang (rating 0) mengikuti `sentiment`, tidak dilabeli "Keluhan 0/5".
 */
export function renderPlaceSubsectionReviews(p: PlaceData): ReportSubsection {
  const quote = (r: PlaceReview) => {
    const scoreOrChannel = r.rating > 0 ? `${r.rating}/5` : "Komentar publik";
    return `"${truncateText(r.text.replace(/\s+/g, " "), QUOTE_CHARS)}" (${r.source}, ${scoreOrChannel}, ${dateLabel(r.reviewDate)})`;
  };
  const praises = p.reviews.filter((r) => (r.rating > 0 ? r.rating >= 4 : r.sentiment === "positive")).slice(0, MAX_QUOTES);
  const complaints = p.reviews.filter((r) => (r.rating > 0 ? r.rating <= 3 : r.sentiment === "negative")).slice(0, MAX_QUOTES);
  const themeCount = new Map<string, number>();
  for (const r of p.reviews) for (const t of r.themes) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
  const topThemes = [...themeCount].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    title: "Ulasan tamu & analisis keluhan",
    paragraphs: p.reviews.length ? [] : ["Belum ada ulasan terverifikasi yang tersimpan untuk tempat ini."],
    bullets: [
      p.rating !== null
        ? `Rating Google ${p.rating.toLocaleString("id-ID")} dari ${p.reviewCount?.toLocaleString("id-ID") ?? "?"} ulasan${p.ratingObservedAt ? ` (diamati ${dateLabel(p.ratingObservedAt)})` : ""}.`
        : `Rating Google: ${NO_DATA}.`,
      ...(topThemes.length ? [`Tema yang paling sering disebut: ${topThemes.map(([t, n]) => `${t} (${n})`).join(", ")}.`] : []),
      ...praises.map((r) => `Pujian: ${quote(r)}`),
      ...complaints.map((r) => `Keluhan: ${quote(r)}`),
    ],
    table: null,
    sources: uniqueSources([
      p.mapsUrl ? { label: "Google Maps (rating)", url: p.mapsUrl } : null,
      ...[...praises, ...complaints].map((r) => ({ label: `Ulasan ${r.source}`, url: r.sourceUrl })),
    ]),
  };
}
