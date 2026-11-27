/**
 * Perbandingan tarif OTA kamar Sanghyang vs resort kompetitor, bersumber dari workbook analisa
 * (lihat scripts/ops/import-resort-room-rates.py). Semua angka turunan dihitung di sini dari data mentah;
 * harga yang tidak tampil di bukti bernilai null dan tidak pernah diisi tebakan.
 *
 * Aturan harga (koridor pasar bintang 4, per jenis kamar & hari):
 *  - Lantai bersih = kuartil 25% harga kompetitor bintang 4. Harga BERSIH setelah promo apa pun tidak boleh di bawahnya.
 *  - Fase 1 (segera): harga dibawa masuk ke koridor [lantai, kuartil 75%]; bila tepat di lantai, promo hanya nilai tambah.
 *  - Fase 2 (target): harga publikasi naik ke median pasar bintang 4; diskon promo dibatasi agar harga bersih tetap ≥ lantai.
 */
import data from "./resort-room-rates.data.json";
import compset from "./hotel-compset.data.json";
import { COMPSET_MAX_ROAD_KM } from "./compset";

/** Keputusan pemilik 06 Nov 2026: pembanding semua outlet maksimal 25 km jarak jalan dari Sanghyang. */
export const COMPETITOR_RADIUS_KM = COMPSET_MAX_ROAD_KM;
const ROLE = new Map(compset.hotels.map((h) => [h.hotelId, h.compsetRole ?? null]));
/**
 * Hanya pembanding inti (bintang 4–5, ≤ 25 km) yang ikut koridor harga & indeks. Hotel acuan tetap tampil sebagai
 * referensi; hotel yang dikeluarkan (mis. bintang di bawah 4) tidak dipakai sama sekali.
 */
export const isPricingCompetitor = (hotelId: string) => ROLE.get(hotelId) === "inti";

export type RateCluster = "KLASTER_I_BINTANG_4" | "KLASTER_II_BINTANG_5";
export type RoomKind = "lowest" | "standard" | "suite" | "villa";
export type Stay = "weekday" | "weekend";

export interface DayRate {
  sanghyang: number | null;
  competitor: number | null;
}

export interface RoomRateRow {
  hotelId: string;
  competitorName: string;
  starRating: number;
  cluster: RateCluster;
  kind: RoomKind;
  offer: string;
  sanghyangRoom: string;
  competitorRoom: string;
  weekday: DayRate;
  weekend: DayRate;
  note: string;
}

/** Tarif OTA termurah satu malam beserta tanggal check-in dan penyedianya; ketiganya null bila tidak ada data. */
export interface DatedRate {
  price: number | null;
  checkIn: string | null;
  source: string | null;
}

/** Termurah dan termahal satu jenis hari di jendela tanggal; `nights` = jumlah malam yang harganya tampil. */
export interface StayRange {
  nights: number;
  min: DatedRate;
  max: DatedRate;
}

export type HotelRateRange = Record<Stay, StayRange>;
export type RangeEnd = keyof Omit<StayRange, "nights">;

/** Jendela tanggal crawl: malam H+1 sampai H+nights. */
export interface RateWindow {
  nights: number;
  firstCheckIn: string;
  lastCheckIn: string;
}

export interface LowestHotelRate {
  hotelId: string;
  hotel: string;
  starRating: number;
  /** Penawaran OTA termurah pada tanggal utama (checkInWeekday / checkInWeekend). */
  weekday: { price: number | null; source: string | null };
  weekend: { price: number | null; source: string | null };
  /** Termurah dan termahal per jenis hari di jendela tanggal; tidak ada pada berkas sebelum jendela tanggal. */
  range?: HotelRateRange;
}

export interface RateEvidence {
  hotelId: string;
  stay: Stay;
  provider: string;
  roomType: string;
  kind: Exclude<RoomKind, "lowest">;
  price: number;
  /** Penawaran termasuk sarapan (crawl otomatis, room-offers.ts). Tidak ada pada data impor workbook lama. */
  breakfast?: boolean;
}

export type MarketPosition = "DI_ATAS_PASAR" | "SETARA" | "DI_BAWAH_PASAR" | "PEMBANDING_KURANG" | "TANPA_DATA";

export interface PricePhase {
  /** Harga publikasi (rate card OTA & reservasi langsung). */
  publish: number;
  changePercent: number;
  /** Diskon promo maksimal (persen bulat ke bawah) agar harga bersih tetap ≥ lantai pasar bintang 4. */
  maxDiscountPercent: number;
}

export interface DayRecommendation {
  sanghyang: number | null;
  /** Jumlah harga kompetitor bintang 4 yang tampil di bukti untuk hari ini. */
  directSampleSize: number;
  /** Koridor pasar bintang 4: lantai (kuartil 25%), median, plafon (kuartil 75%). */
  floor: number | null;
  median: number | null;
  ceiling: number | null;
  luxuryMedian: number | null;
  position: MarketPosition;
  /** Fase 1 (segera). Null bila harga Sanghyang tidak tampil di bukti. */
  phase1: PricePhase | null;
  /** Fase 2 (target median). Null bila pembanding kurang atau harga Sanghyang tidak tampil. */
  phase2: PricePhase | null;
  /** Lompatan Fase 1 besar: cek kesetaraan tipe kamar & naikkan bertahap. */
  needsReview: boolean;
}

export interface RoomRateSummary {
  kind: RoomKind;
  room: string;
  roomDetail: string;
  rows: RoomRateRow[];
  weekday: DayRecommendation;
  weekend: DayRecommendation;
  /** Satu baris per jenis hari dan fase, untuk daftar di tab Strategy. */
  recommendationLines: string[];
  recommendation: string;
}

export const RESORT_ROOM_RATE_SOURCE = {
  source: data.source,
  sourceMethod: data.sourceMethod,
  capturedAt: data.capturedAt,
  checkInWeekday: data.checkInWeekday,
  checkInWeekend: data.checkInWeekend,
  /** null pada berkas lama yang hanya memuat satu malam per jenis hari. */
  window: "window" in data ? (data.window as RateWindow) : null,
};

export const SANGHYANG_HOTEL_ID = "sanghyang";

/**
 * Workbook tarif masih memuat hotel yang sudah dikeluarkan dari pembanding (mis. Allisa bintang 2, Mutiara 34 km).
 * Baris itu disaring di sini sekali, supaya tangga harga, peringkat, dan paritas tidak pernah memakainya.
 */
const inCompset = (hotelId: string) => hotelId === SANGHYANG_HOTEL_ID || ROLE.get(hotelId) != null;
export const RESORT_ROOM_RATES = (data.rates as RoomRateRow[]).filter((r) => inCompset(r.hotelId));
export const RESORT_LOWEST_BY_HOTEL = (data.lowestByHotel as LowestHotelRate[]).filter((h) => inCompset(h.hotelId));
export const RESORT_RATE_EVIDENCE = (data.evidence as RateEvidence[]).filter((e) => inCompset(e.hotelId));
/**
 * Data crawl tanpa saringan peran statis. Matriks Insight Pasar dan halaman Untuk Direksi memilih hotel dari daftar
 * kompetitor aktif di DB, jadi hotel yang diarsipkan tidak ikut dan hotel baru yang sudah dicrawl langsung terbaca.
 */
export const RESORT_ROOM_RATES_ALL = data.rates as RoomRateRow[];
export const RESORT_LOWEST_BY_HOTEL_ALL = data.lowestByHotel as LowestHotelRate[];
export const RESORT_RATE_EVIDENCE_ALL = data.evidence as RateEvidence[];

const KIND_ORDER: RoomKind[] = ["lowest", "standard", "suite", "villa"];
export const KIND_LABEL: Record<RoomKind, string> = {
  lowest: "Harga Terendah (semua tipe kamar)",
  standard: "Kamar Standar",
  suite: "Suite",
  villa: "Villa / Unit Multi-Kamar",
};
/** Minimal harga kompetitor bintang 4 agar koridor pasar bermakna. */
const MIN_DIRECT_SAMPLES = 2;
/** Tarif rekomendasi dibulatkan ke kelipatan Rp 10.000 (konvensi rate card). */
const ROUNDING = 10_000;
/** Perubahan Fase 1 di atas ini ditandai untuk dicek manual (kemungkinan tipe kamar kurang setara). */
const REVIEW_CHANGE_PERCENT = 50;
/** Malam per minggu: hari biasa = Minggu–Kamis, akhir pekan = Jumat–Sabtu. */
const NIGHTS: Record<Stay, number> = { weekday: 5, weekend: 2 };

/** Persentil dengan interpolasi linear (setara QUARTILE.INC Excel). */
export function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const roundRate = (n: number) => Math.round(n / ROUNDING) * ROUNDING;
const pct = (from: number, to: number) => Number((((to - from) / from) * 100).toFixed(1));
const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Diskon maksimal (persen bulat ke bawah) yang masih menyisakan harga bersih ≥ lantai. */
export const maxDiscountKeepingFloor = (publish: number, floor: number) =>
  Math.max(0, Math.floor((1 - floor / publish) * 100 + 1e-9));

/** Harga bersih setelah diskon persen. */
export const netAfterDiscount = (publish: number, discountPercent: number) => Math.round(publish * (1 - discountPercent / 100));

/** Selisih persen harga kompetitor terhadap Sanghyang (positif = kompetitor lebih mahal); null bila salah satu tidak tampil. */
export const competitorGapPercent = (d: DayRate): number | null =>
  d.sanghyang !== null && d.competitor !== null ? pct(d.sanghyang, d.competitor) : null;

function recommendDay(rows: RoomRateRow[], day: Stay, isPricing: (hotelId: string) => boolean): DayRecommendation {
  const sanghyang = rows.find((r) => r[day].sanghyang !== null)?.[day].sanghyang ?? null;
  const prices = (cluster: RateCluster) =>
    rows
      .filter((r) => r.cluster === cluster && isPricing(r.hotelId) && r[day].competitor !== null)
      .map((r) => r[day].competitor as number)
      .sort((a, b) => a - b);
  const direct = prices("KLASTER_I_BINTANG_4");
  const luxury = prices("KLASTER_II_BINTANG_5");
  const enough = direct.length >= MIN_DIRECT_SAMPLES;
  const corridor = {
    floor: enough ? roundRate(percentile(direct, 0.25)) : null,
    median: enough ? roundRate(percentile(direct, 0.5)) : null,
    ceiling: enough ? roundRate(percentile(direct, 0.75)) : null,
  };
  const base = { sanghyang, directSampleSize: direct.length, ...corridor, luxuryMedian: luxury.length ? roundRate(percentile(luxury, 0.5)) : null };

  if (sanghyang === null) {
    return { ...base, position: "TANPA_DATA", phase1: null, phase2: null, needsReview: false };
  }
  const { floor, median, ceiling } = corridor;
  if (floor === null || median === null || ceiling === null) {
    // Tanpa koridor pasar yang bisa diverifikasi: tahan harga & jangan diskon.
    return { ...base, position: "PEMBANDING_KURANG", phase1: { publish: sanghyang, changePercent: 0, maxDiscountPercent: 0 }, phase2: null, needsReview: false };
  }
  const phase = (publish: number): PricePhase => ({
    publish,
    changePercent: pct(sanghyang, publish),
    maxDiscountPercent: maxDiscountKeepingFloor(publish, floor),
  });
  const phase1 = phase(Math.min(Math.max(sanghyang, floor), ceiling));
  const phase2 = phase(Math.max(median, phase1.publish));
  return {
    ...base,
    position: sanghyang < floor ? "DI_BAWAH_PASAR" : sanghyang > ceiling ? "DI_ATAS_PASAR" : "SETARA",
    phase1,
    phase2,
    needsReview: Math.abs(phase1.changePercent) > REVIEW_CHANGE_PERCENT,
  };
}

/**
 * Kalimat rekomendasi satu jenis hari, satu baris per fase. Ditulis dengan tanda baca biasa seperti catatan staf: tanpa
 * em dash, panah, atau simbol ≥ (permintaan pemilik 27 Nov 2026), supaya tidak terbaca seperti teks mesin.
 */
function describeDay(label: string, d: DayRecommendation): string[] {
  if (d.position === "TANPA_DATA" || d.phase1 === null) return [`${label}: harga Sanghyang tidak tampil di bukti, belum bisa dibandingkan.`];
  const current = rupiah(d.sanghyang!);
  if (d.position === "PEMBANDING_KURANG") {
    const lux = d.luxuryMedian ? `; median bintang 5 ${rupiah(d.luxuryMedian)}` : "";
    return [`${label}: pertahankan ${current} tanpa diskon (baru ${d.directSampleSize} pembanding bintang 4${lux}).`];
  }
  const p1 = d.phase1;
  const move =
    p1.publish === d.sanghyang
      ? `pertahankan ${current}`
      : `${p1.publish > d.sanghyang! ? "naikkan" : "turunkan"} dari ${current} menjadi ${rupiah(p1.publish)}`;
  const promo1 = p1.maxDiscountPercent === 0 ? "tanpa diskon, promo hanya berupa nilai tambah" : `diskon promo maksimal ${p1.maxDiscountPercent}%`;
  const lines = [`${label}, Fase 1: ${move} (lantai bintang 4 ${rupiah(d.floor!)}), ${promo1}.`];
  const p2 = d.phase2;
  if (p2 && p2.publish !== p1.publish) {
    lines.push(
      `${label}, Fase 2: harga publikasi ${rupiah(p2.publish)} (median bintang 4), diskon promo maksimal ${p2.maxDiscountPercent}% agar harga bersih tetap minimal ${rupiah(d.floor!)}.`,
    );
  }
  if (d.needsReview) lines.push(`${label}: lompatan harganya besar, jadi cek dulu kesetaraan tipe kamar lalu naikkan bertahap.`);
  return lines;
}

function roomTitle(kind: RoomKind, rows: RoomRateRow[]): { room: string; roomDetail: string } {
  if (kind === "lowest") return { room: KIND_LABEL.lowest, roomDetail: "Penawaran OTA termurah untuk semua tipe kamar" };
  const name = rows[0].sanghyangRoom;
  const provider = name.match(/\(([^)]+)\)\s*$/)?.[1];
  const title = name.replace(/\s*\([^)]+\)\s*$/, "");
  return {
    // "Sanghyang Suite" sudah menyebut kelasnya; hindari label berulang "Sanghyang Suite · Suite".
    room: title.toLowerCase().includes(KIND_LABEL[kind].toLowerCase()) ? title : `${title} · ${KIND_LABEL[kind]}`,
    roomDetail: provider ? `Harga Sanghyang via ${provider}` : KIND_LABEL[kind],
  };
}

/**
 * Price Positioning Index resort: median (harga Sanghyang / harga kompetitor bintang 4) × 100 pada baris
 * yang keduanya tampil di bukti, hari biasa & akhir pekan. 100 = setara pasar, <100 = lebih murah.
 */
export function resortPricePositioningIndex(
  rows: RoomRateRow[] = RESORT_ROOM_RATES,
  isPricing: (hotelId: string) => boolean = isPricingCompetitor,
): number {
  const ratios = rows
    .filter((r) => r.cluster === "KLASTER_I_BINTANG_4" && isPricing(r.hotelId))
    .flatMap((r) => [r.weekday, r.weekend])
    .filter((d): d is { sanghyang: number; competitor: number } => d.sanghyang !== null && d.competitor !== null)
    .map((d) => (d.sanghyang / d.competitor) * 100)
    .sort((a, b) => a - b);
  if (ratios.length === 0) throw new Error("Tidak ada pasangan harga Sanghyang & kompetitor bintang 4 untuk indeks harga resort");
  return Number(percentile(ratios, 0.5).toFixed(1));
}

/** Sanghyang dan pembanding inti: kelompok yang dipakai untuk peringkat harga (acuan tidak ikut dihitung). */
export const RANKED_LOWEST_BY_HOTEL = RESORT_LOWEST_BY_HOTEL.filter((h) => h.hotelId === SANGHYANG_HOTEL_ID || isPricingCompetitor(h.hotelId));

/** Peringkat harga terendah per hotel (1 = termurah) untuk satu hari; hotel tanpa harga tidak diberi peringkat. */
export function lowestRateRank(day: Stay, hotels: LowestHotelRate[] = RANKED_LOWEST_BY_HOTEL): Map<string, number> {
  const priced = hotels.filter((h) => h[day].price !== null).sort((a, b) => (a[day].price as number) - (b[day].price as number));
  return new Map(priced.map((h, i) => [h.hotelId, i + 1]));
}

const NO_RATE: DatedRate = { price: null, checkIn: null, source: null };
/** Teks tarif yang tidak ada di data; sama dengan teks PDF Rapat Senin. */
export const NO_RATE_TEXT = "Belum ada data";

/**
 * Termurah dan termahal per jenis hari untuk satu hotel. Berkas lama hanya memuat satu malam per jenis hari:
 * termurahnya tarif malam itu, termahalnya belum ada data (tidak disamakan dengan termurah).
 */
export function hotelRateRange(
  h: LowestHotelRate,
  checkIn: Record<Stay, string> = { weekday: RESORT_ROOM_RATE_SOURCE.checkInWeekday, weekend: RESORT_ROOM_RATE_SOURCE.checkInWeekend },
): HotelRateRange {
  if (h.range) return h.range;
  const single = (stay: Stay): StayRange => {
    const { price, source } = h[stay];
    return price === null ? { nights: 0, min: NO_RATE, max: NO_RATE } : { nights: 1, min: { price, checkIn: checkIn[stay], source }, max: NO_RATE };
  };
  return { weekday: single("weekday"), weekend: single("weekend") };
}

/** "17 Nov 2026": tanggal check-in ringkas untuk sel tabel web dan PDF. */
export const checkInLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "Rp 358.000 (17 Nov 2026)", atau "Belum ada data". */
export const datedRateText = (r: DatedRate) => (r.price === null || r.checkIn === null ? NO_RATE_TEXT : `${rupiah(r.price)} (${checkInLabel(r.checkIn)})`);

/** Sel termurah atau termahal, hari biasa / akhir pekan: "Rp 358.000 (17 Nov 2026) / Rp 871.200 (21 Nov 2026)". */
export function rangeCellText(range: HotelRateRange, end: RangeEnd): string {
  const sides = [range.weekday[end], range.weekend[end]];
  return sides.every((r) => r.price === null) ? NO_RATE_TEXT : sides.map(datedRateText).join(" / ");
}

export interface RateRangeRow {
  hotelId: string;
  hotel: string;
  starRating: number;
  range: HotelRateRange;
  /** Selisih persen terhadap Sanghyang pada ukuran dan jenis hari yang sama; null di baris Sanghyang atau bila salah satu tidak ada. */
  gap: Record<RangeEnd, Record<Stay, number | null>>;
}

/** Baris tabel web "Harga Terendah (semua tipe kamar)": Sanghyang lebih dulu, lalu hotel lain sesuai urutan data. */
export function rateRangeRows(
  hotels: LowestHotelRate[] = RESORT_LOWEST_BY_HOTEL,
  checkIn: Record<Stay, string> = { weekday: RESORT_ROOM_RATE_SOURCE.checkInWeekday, weekend: RESORT_ROOM_RATE_SOURCE.checkInWeekend },
): RateRangeRow[] {
  const own = hotels.find((h) => h.hotelId === SANGHYANG_HOTEL_ID);
  const ownRange = own ? hotelRateRange(own, checkIn) : null;
  const ordered = [...(own ? [own] : []), ...hotels.filter((h) => h !== own)];
  return ordered.map((h) => {
    const range = hotelRateRange(h, checkIn);
    const gapOf = (end: RangeEnd, stay: Stay) =>
      h === own || ownRange === null ? null : competitorGapPercent({ sanghyang: ownRange[stay][end].price, competitor: range[stay][end].price });
    const gaps = (end: RangeEnd) => ({ weekday: gapOf(end, "weekday"), weekend: gapOf(end, "weekend") });
    return { hotelId: h.hotelId, hotel: h.hotel, starRating: h.starRating, range, gap: { min: gaps("min"), max: gaps("max") } };
  });
}

const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const DEFAULT_DYNAMIC_WINDOW_NIGHTS = 14;

export interface DynamicRateWindowResult {
  nights: number;
  firstCheckIn: string;
  lastCheckIn: string;
  checkInWeekday: string;
  checkInWeekend: string;
  /** Tanggal pemeriksaan acuan (YYYY-MM-DD, WIB). */
  observedAt: string;
  window: RateWindow;
}

function wibMidnightUtcMs(date: Date): number {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate());
}

function isoDateFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function nearestDowAfter(anchorMidnightMs: number, dow: number, maxNights: number): string {
  const offset = (dow - new Date(anchorMidnightMs).getUTCDay() + 7) % 7 || 7;
  if (offset <= maxNights) return isoDateFromMs(anchorMidnightMs + offset * DAY_MS);
  return isoDateFromMs(anchorMidnightMs + DAY_MS);
}

export type RateWindowBasis = "crawl" | "snapshot" | "none";

/**
 * Jendela tarif yang benar-benar dipakai matriks. `crawl`: crawl 14 malam terakhir yang sudah ada saat akhir periode
 * (berkas tarif harian); `snapshot`: crawl itu baru ada sesudah periode, jadi dipakai pantauan harian DB di periode;
 * `none`: belum ada tarif sama sekali.
 */
export interface ResolvedRateWindow extends DynamicRateWindowResult {
  basis: RateWindowBasis;
  /** Tanggal crawl 14 malam yang dipakai (YYYY-MM-DD, WIB); null bila jendela tidak berasal dari crawl. */
  crawlDate: string | null;
}

export interface ResolveRateWindowOptions {
  /** `observedAt` pantauan harian DB (dipakai bila crawl 14 malam tidak berlaku untuk periode). */
  snapshotObservedDates?: Date[];
  periodFrom?: Date;
  periodTo?: Date;
  /** Acuan waktu bila tidak ada periode dan tidak ada data sama sekali. */
  now?: Date;
  source?: Pick<typeof RESORT_ROOM_RATE_SOURCE, "capturedAt" | "window" | "checkInWeekday" | "checkInWeekend">;
}

/** Tanggal crawl wajib terbaca; tanggal yang rusak tidak diganti jam sekarang karena akan menyesatkan jendela. */
export function crawlCapturedAtMs(capturedAt: string): number {
  const ms = Date.parse(`${capturedAt.replace(/\s*WIB\s*$/i, "").trim().replace(" ", "T")}:00+07:00`);
  if (!Number.isFinite(ms)) throw new Error(`Tanggal crawl tarif tidak terbaca: "${capturedAt}"`);
  return ms;
}

export const isoDateWib = (date: Date) => isoDateFromMs(wibMidnightUtcMs(date));

export function resolveRateWindow(options: ResolveRateWindowOptions = {}): ResolvedRateWindow {
  const source = options.source ?? RESORT_ROOM_RATE_SOURCE;
  const valid = (d: Date | undefined): d is Date => d instanceof Date && Number.isFinite(d.getTime());
  const toMs = valid(options.periodTo) ? options.periodTo.getTime() : null;
  const fromMs = valid(options.periodFrom) ? options.periodFrom.getTime() : null;

  if (source.window) {
    const crawlMs = crawlCapturedAtMs(source.capturedAt);
    if (toMs === null || crawlMs <= toMs) {
      const crawlDate = isoDateWib(new Date(crawlMs));
      return {
        basis: "crawl",
        crawlDate,
        nights: source.window.nights,
        firstCheckIn: source.window.firstCheckIn,
        lastCheckIn: source.window.lastCheckIn,
        checkInWeekday: source.checkInWeekday,
        checkInWeekend: source.checkInWeekend,
        observedAt: crawlDate,
        window: { ...source.window },
      };
    }
  }

  const nights = source.window?.nights ?? DEFAULT_DYNAMIC_WINDOW_NIGHTS;
  const observed = (options.snapshotObservedDates ?? []).filter(
    (d) => valid(d) && (toMs === null || d.getTime() <= toMs) && (fromMs === null || d.getTime() >= fromMs),
  );
  const anchor = observed.length
    ? new Date(Math.max(...observed.map((d) => d.getTime())))
    : valid(options.periodTo)
      ? options.periodTo
      : valid(options.now)
        ? options.now
        : new Date();
  const anchorMid = wibMidnightUtcMs(anchor);
  const firstCheckIn = isoDateFromMs(anchorMid + DAY_MS);
  const lastCheckIn = isoDateFromMs(anchorMid + nights * DAY_MS);
  return {
    basis: observed.length ? "snapshot" : "none",
    crawlDate: null,
    nights,
    firstCheckIn,
    lastCheckIn,
    checkInWeekday: nearestDowAfter(anchorMid, 2, nights),
    checkInWeekend: nearestDowAfter(anchorMid, 6, nights),
    observedAt: isoDateFromMs(anchorMid),
    window: { nights, firstCheckIn, lastCheckIn },
  };
}

/** Catatan jendela tarif di web dan PDF; semua tanggal dibaca dari jendela yang dipakai, tidak ada tanggal tertulis. */
export function resolvedRateWindowNote(w: ResolvedRateWindow, latestObservedAt: string | null): string {
  const range = `check-in ${checkInLabel(w.firstCheckIn)} sampai ${checkInLabel(w.lastCheckIn)}`;
  const split = "dipisah hari biasa (malam Minggu sampai Kamis) dan akhir pekan (malam Jumat dan Sabtu)";
  const latest = latestObservedAt ? ` Terakhir diperiksa ${checkInLabel(latestObservedAt)}.` : "";
  if (w.basis === "crawl" && w.crawlDate) {
    return (
      `Jendela ${w.nights} malam dari pemeriksaan ${checkInLabel(w.crawlDate)} (H+1 sampai H+${w.nights}): ${range}. ` +
      `Rentang tarif di baris tempat sama dengan harga terendah dan tertinggi di sub-baris tipe kamar (situs resmi dan OTA termurah), ${split}. ` +
      `Tarif OTA per tipe kamar memakai tanggal utama hari biasa ${checkInLabel(w.checkInWeekday)} dan akhir pekan ${checkInLabel(w.checkInWeekend)}; ` +
      `tarif termurah properti di jendela itu dipasang pada kamar kelas dasar beserta tanggal check-in-nya.${latest}`
    );
  }
  if (w.basis === "snapshot") {
    return (
      `Belum ada pemeriksaan ${w.nights} malam pada periode ini, jadi tarif memakai pantauan harian terakhir ${checkInLabel(w.observedAt)}: ${range}. ` +
      `Rentang tarif di baris tempat sama dengan harga terendah dan tertinggi di sub-barisnya, ${split}.${latest}`
    );
  }
  return `Belum ada tarif kamar yang terpantau sampai ${checkInLabel(w.observedAt)}.`;
}

/** Kalimat asal tanggal tarif, sama di web dan PDF: jendela tanggal, atau satu malam per jenis hari pada berkas lama. */
export function rateWindowNote(
  source: Pick<typeof RESORT_ROOM_RATE_SOURCE, "window" | "checkInWeekday" | "checkInWeekend"> = RESORT_ROOM_RATE_SOURCE,
): string {
  const primary = `hari biasa ${checkInLabel(source.checkInWeekday)}, akhir pekan ${checkInLabel(source.checkInWeekend)}`;
  const w = source.window;
  if (!w) return `Tangkapan ini hanya memuat satu malam per jenis hari (${primary}), jadi tarif termahal belum ada data.`;
  return (
    `Jendela ${w.nights} malam (H+1 sampai H+${w.nights}): check-in ${checkInLabel(w.firstCheckIn)} sampai ${checkInLabel(w.lastCheckIn)}. ` +
    "Termurah dan termahal adalah tarif OTA termurah per malam (semua tipe kamar) yang paling rendah dan paling tinggi di jendela itu, " +
    `dipisah hari biasa (malam Minggu sampai Kamis) dan akhir pekan (malam Jumat dan Sabtu). Tarif per tipe kamar memakai tanggal utama: ${primary}.`
  );
}

export interface RateParityGap {
  stay: Stay;
  kind: Exclude<RoomKind, "lowest">;
  min: number;
  max: number;
  providers: string[];
  offers: number;
}

/** Selisih harga kamar Sanghyang yang sama antar OTA pada tanggal yang sama (paritas harga), terbesar dulu. */
export function sanghyangRateParity(evidence: RateEvidence[] = RESORT_RATE_EVIDENCE): RateParityGap[] {
  const groups = new Map<string, RateEvidence[]>();
  for (const e of evidence.filter((x) => x.hotelId === SANGHYANG_HOTEL_ID)) {
    const key = `${e.stay}|${e.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()]
    .map((g) => ({
      stay: g[0].stay,
      kind: g[0].kind,
      min: Math.min(...g.map((e) => e.price)),
      max: Math.max(...g.map((e) => e.price)),
      providers: [...new Set(g.map((e) => e.provider))],
      offers: g.length,
    }))
    .filter((g) => g.offers > 1 && g.max > g.min)
    .sort((a, b) => b.max / b.min - a.max / a.min);
}

/** Satu ringkasan per jenis kamar Sanghyang (harga terendah, standar, suite, villa). */
export interface BreakfastGap {
  hotelId: string;
  hotel: string;
  stay: Stay;
  withBreakfast: number | null;
  withoutBreakfast: number | null;
}

/** Penawaran kamar termurah dengan vs tanpa sarapan per hotel & hari (hanya penawaran yang tandanya diketahui). */
export function breakfastComparison(evidence: RateEvidence[] = RESORT_RATE_EVIDENCE, hotels: LowestHotelRate[] = RESORT_LOWEST_BY_HOTEL): BreakfastGap[] {
  const min = (list: RateEvidence[]) => (list.length ? Math.min(...list.map((e) => e.price)) : null);
  return hotels.flatMap((h) =>
    (["weekday", "weekend"] as Stay[])
      .map((stay) => {
        const known = evidence.filter((e) => e.hotelId === h.hotelId && e.stay === stay && e.breakfast !== undefined);
        return { hotelId: h.hotelId, hotel: h.hotel, stay, withBreakfast: min(known.filter((e) => e.breakfast)), withoutBreakfast: min(known.filter((e) => !e.breakfast)) };
      })
      .filter((g) => g.withBreakfast !== null || g.withoutBreakfast !== null),
  );
}

export function buildRoomRateSummaries(
  rows: RoomRateRow[] = RESORT_ROOM_RATES,
  isPricing: (hotelId: string) => boolean = isPricingCompetitor,
): RoomRateSummary[] {
  return KIND_ORDER.filter((kind) => rows.some((r) => r.kind === kind)).map((kind) => {
    const kindRows = rows.filter((r) => r.kind === kind);
    const weekday = recommendDay(kindRows, "weekday", isPricing);
    const weekend = recommendDay(kindRows, "weekend", isPricing);
    const recommendationLines = [...describeDay("Hari biasa", weekday), ...describeDay("Akhir pekan", weekend)];
    return {
      kind,
      ...roomTitle(kind, kindRows),
      rows: kindRows,
      weekday,
      weekend,
      recommendationLines,
      recommendation: recommendationLines.join(" "),
    };
  });
}

/**
 * Kenaikan harga rata-rata Fase 1 (persen), memakai penawaran OTA termurah sebagai proksi ADR,
 * dibobot jumlah malam (5 hari biasa, 2 akhir pekan).
 */
export function resortPhase1PriceLiftPercent(summaries: RoomRateSummary[] = buildRoomRateSummaries()): number {
  const lowest = summaries.find((s) => s.kind === "lowest");
  const wk = lowest?.weekday.phase1;
  const we = lowest?.weekend.phase1;
  if (!wk || !we) throw new Error("Penawaran OTA termurah Sanghyang (hari biasa & akhir pekan) wajib ada untuk proyeksi omset resort");
  const total = NIGHTS.weekday + NIGHTS.weekend;
  return Number(((wk.changePercent * NIGHTS.weekday + we.changePercent * NIGHTS.weekend) / total).toFixed(1));
}

/** Penurunan okupansi maksimal (persen) sebelum omset turun, untuk kenaikan harga tertentu. */
export const breakEvenOccupancyDropPercent = (priceLiftPercent: number) =>
  Number(((priceLiftPercent / (100 + priceLiftPercent)) * 100).toFixed(1));
