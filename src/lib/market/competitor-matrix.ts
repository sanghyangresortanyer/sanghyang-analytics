/**
 * Satu sumber kebenaran (Single Source of Truth) matriks pembanding seluruh 6 outlet Sanghyang
 * (Kamar & Resort, Sunset Grill, Dragon Beach Club, D'Bistro, D'Bar & Karaoke, D'Spa & Hot Spring).
 *
 * Daftar tempat mengikuti kompetitor aktif di DB (`loadCompsetAudit`); data statis hanya pemetaan pelengkap.
 * - Tipe kamar & luas m²: `loadDynamicHotelRoomTypes()` (situs resmi menang atas OTA), ditambah kamar yang hanya
 *   disebut penawaran OTA
 * - Spesifikasi fasilitas beserta sumbernya: `loadPlaceSpecsMap()`
 * - Menu & harga kompetitor F&B/Bar/Spa: `loadDynamicCompetitorMenuItems()` + `competitorMenu()`
 * - Tarif kamar dua lapisan (situs resmi + OTA termurah dengan tautan, tanggal check-in, dan sarapan) dari crawl
 *   14 malam terakhir (`resort-room-rates.data.json`) dan pantauan harian DB, hanya yang check-in-nya di dalam jendela;
 *   rentang di baris tempat dihitung dari harga yang tercetak di sub-barisnya
 * - Audit pembanding komparatif: `loadCompsetAudit()` & `sanghyangAuditSummary()`
 *
 * Dipakai bersama oleh `/api/market-intelligence/summary` (Frontend Langkah 3) dan laporan PDF
 * (`lib/meeting-report/*`).
 */
import { db } from "../db";
import { galleryPhotosOf, isShownPhoto } from "./competitor-gallery";
import {
  isAddon,
  isCountedMenuItem,
  menuExclusion,
  menuPriceRange,
  pricedSources,
  sampleItems,
  type CompetitorMenuItem,
  type PerPersonRange,
} from "./competitor-menu";
import {
  loadCompsetAudit,
  mergeCompetitorMenu,
  type OutletCompsetAudit,
} from "./compset-audit";
import { sanghyangAuditSummary } from "./compset-rationale";
import { COMPSET_MAX_ROAD_KM, MIN_LODGING_STARS } from "./compset";
import { drivingMinutesFor } from "./distance-source";
import {
  compareItems,
  menuGroup,
  officialFnbItems,
  rivalGap,
  type FnbItem,
} from "./fnb-compare";
import { googleTravelEntityUrlFromMaps } from "./google-travel-entity";
import { COMPSET_HOTELS } from "./hotel-compset";
import {
  formatAreaSqm,
  getHotelRoomTypes,
  inferOfficialBreakfastFromHighlights,
  loadDynamicHotelRoomTypes,
  sanitizePublicText,
  type HotelRoomTypeSpec,
  type HotelRoomTypesProfile,
  type RoomSpecSourcePriority,
  type RoomTypeCategory,
} from "./hotel-room-types";
import { loadResortMarketSize, type ResortMarketSize } from "./market-size";
import { itemPriceText, perPersonText, rupiah, rupiahRange, servingLabel } from "./menu-format";
import { officialMenu, OFFICIAL_MENU_SOURCE } from "./official-menu";
import { OUTLET_KEYS, type OutletKey } from "./outlet-filters";
import { OWN_OUTLETS } from "./outlet-ratings";
import { competitorOfficialRoomRatesFor } from "./competitor-official-rates-data";
import { officialRoomRatesFor, officialRoomRatesSource, type OfficialRoomRate } from "./official-room-rates";
import { loadPlaceSpecsMap, type PlaceSpecs, type SourceRef } from "./place-specs";
import { OUTLET_MARKET_SHARE_DATA } from "./pricing-benchmark";
import { breakfastFromPackage, COMPARABLE_RATE_WHERE, isComparableRate } from "./rate-basis";
import {
  loadDynamicCompetitorMenuItems,
  type DynamicCompetitorMenuRecord,
} from "./refresh-competitor-menus";
import {
  checkInLabel,
  hotelRateRange,
  isoDateWib,
  rangeCellText,
  RESORT_LOWEST_BY_HOTEL_ALL,
  RESORT_RATE_EVIDENCE_ALL,
  RESORT_ROOM_RATE_SOURCE,
  resolveRateWindow,
  resolvedRateWindowNote,
  type DatedRate,
  type HotelRateRange,
  type RateEvidence,
  type ResolvedRateWindow,
} from "./resort-room-rates";
import { buildTs } from "./room-offers";
import { bestMatchingRoomIndex, extractBedroomsFromName } from "./room-name-match";

export const MATRIX_NO_DATA = "Belum ada data";

export const RESORT_MATRIX_COLUMNS: readonly string[] = [
  "No",
  "Tempat",
  "Bintang",
  "Jarak",
  "Tipe Kamar",
  "Luas",
  "Tarif kamar (biasa / akhir pekan)",
  "Rating Google",
  "Kamar",
  "Smart TV",
  "Bathtub",
  "Kolam / Air Panas",
  "Gaya Desain",
  "Audit pembanding",
];

export const FNB_MATRIX_COLUMNS: readonly string[] = [
  "No",
  "Tempat",
  "Jarak",
  "Rating Google",
  "Kisaran Menu / Paket",
  "Rincian Menu & Harga",
  "Fasilitas & Suasana",
  "Audit pembanding",
];

export type RoomBreakfastStatus =
  | "Termasuk sarapan"
  | "Tanpa sarapan"
  | "Tersedia keduanya"
  /** Penawaran OTA yang dipakai hanya menampilkan harga, tanpa keterangan sarapan. */
  | "Tidak disebutkan"
  | "Belum tercatat";

/** Satu penawaran OTA dengan status sarapan yang tersebut: harga, OTA, dan tanggal check-in-nya. */
export interface BreakfastOfferPoint {
  price: number;
  otaName: string;
  checkIn: string;
}

/** Penawaran termurah dengan dan tanpa sarapan untuk satu jenis hari; null bila tidak ada penawaran yang menyebutnya. */
export interface StayBreakfastOffers {
  withBreakfast: BreakfastOfferPoint | null;
  withoutBreakfast: BreakfastOfferPoint | null;
}

export interface RoomOfficialRateLayer {
  /**
   * Harga yang ikut dihitung: harga sub-baris, rentang ringkasan, perbandingan termurah, dan selisih. Tarif booking engine
   * resmi hanya masuk sini bila malamnya sama dengan tanggal utama lapisan OTA untuk jenis hari itu.
   */
  weekdayPrice: number | null;
  weekendPrice: number | null;
  priceLabel: string;
  sourceLabel: string;
  sourceUrl: string;
  breakfastIncluded: boolean | null;
  breakfastLabel: RoomBreakfastStatus;
  /** Diisi untuk tarif booking engine resmi: tanggal check-in, sarapan, dan rate plan per jenis hari. */
  weekdayCheckIn: string | null;
  weekendCheckIn: string | null;
  weekdayBreakfast: boolean | null;
  weekendBreakfast: boolean | null;
  ratePlan: string | null;
  /** Alasan sisi tanpa harga dari booking engine (mis. kamar tidak dijual pada tanggal itu). */
  weekdayUnavailableReason: string | null;
  weekendUnavailableReason: string | null;
  /** Tautan /book untuk tanggal sisi itu. */
  weekdaySourceUrl: string | null;
  weekendSourceUrl: string | null;
  /**
   * Tarif booking engine resmi yang check-in-nya (weekdayCheckIn/weekendCheckIn) bukan tanggal utama lapisan OTA, mis.
   * berkas resmi tertinggal saat crawl OTA sudah bergeser. Tampil dengan tanggalnya sendiri, tetapi tidak dihitung.
   */
  weekdayOtherNightPrice: number | null;
  weekendOtherNightPrice: number | null;
  /** Tanggal utama lapisan OTA pembanding tarif booking engine; null bila tarif OTA tidak berasal dari crawl. */
  otaCheckInWeekday: string | null;
  otaCheckInWeekend: string | null;
}

export interface RoomOtaLowestLayer {
  weekdayPrice: number | null;
  weekendPrice: number | null;
  priceLabel: string;
  /** Nama penyedia OTA termurah (mis. "Agoda", "Traveloka.com", "Booking.com", "Hotels.com / Booking.com"). */
  otaName: string;
  /** Tautan langsung yang dapat diklik ke halaman tarif OTA / Google Travel properti. */
  otaUrl: string;
  weekdayOtaName: string | null;
  weekdayOtaUrl: string | null;
  weekdayCheckIn: string | null;
  weekendOtaName: string | null;
  weekendOtaUrl: string | null;
  weekendCheckIn: string | null;
  breakfastIncluded: boolean | null;
  breakfastLabel: RoomBreakfastStatus;
  withBreakfastWeekdayPrice: number | null;
  withoutBreakfastWeekdayPrice: number | null;
  withBreakfastWeekendPrice: number | null;
  withoutBreakfastWeekendPrice: number | null;
  /** Rincian penawaran termurah dengan dan tanpa sarapan per jenis hari (OTA dan tanggal check-in). */
  breakfastOffers: Record<"weekday" | "weekend", StayBreakfastOffers>;
  /** Status sarapan penawaran termurah per jenis hari; null = penawaran tidak menyebutnya. */
  weekdayBreakfast: boolean | null;
  weekendBreakfast: boolean | null;
  /** true bila sisi itu adalah tarif termurah properti di jendela (OTA tidak menyebut nama kamarnya). */
  weekdayIsPropertyLowest: boolean;
  weekendIsPropertyLowest: boolean;
  /** true bila salah satu sisi berasal dari tarif termurah properti. */
  isPropertyLowestRate?: boolean;
}

export interface HotelRoomTypeMatrixSubRow {
  name: string;
  category: RoomTypeCategory;
  bedrooms: number | null;
  areaSqm: number | null;
  areaLabel: string;
  weekdayPrice: number | null;
  weekendPrice: number | null;
  priceLabel: string;
  priceSource: string | null;
  smartTv: boolean | null;
  smartTvLabel: string;
  bathtub: boolean | null;
  bathtubLabel: string;
  highlights: string[];
  sourcePriority: RoomSpecSourcePriority;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  conflictNote: string | null;
  officialRate: RoomOfficialRateLayer | null;
  /** Alasan harga situs resmi belum ada (dari pemuat tarif resmi); null bila tidak ada keterangan. */
  officialUnavailableReason: string | null;
  otaLowest: RoomOtaLowestLayer | null;
  breakfastIncluded: boolean | null;
  breakfastLabel: RoomBreakfastStatus;
}

/** Satu kalimat fasilitas beserta sumbernya, untuk narasi di dialog detail (situs resmi dan OTA). */
export interface FacilityStatement {
  text: string;
  sources: SourceRef[];
}

export interface HotelMatrixEntry {
  no: number;
  competitorId: string;
  placeId: string | null;
  name: string;
  role: "sanghyang" | "inti" | "acuan";
  starRating: number | null;
  starLabel: string;
  roadKm: number | null;
  driveMinutes: number | null;
  distanceLabel: string;
  distanceSource: string | null;
  roomCount: number | null;
  roomCountLabel: string;
  areaSummaryLabel: string;
  hasMultiBedroomUnit: boolean;
  multiBedroomNote: string | null;
  otaRateWeekdayMin: number | null;
  otaRateWeekendMin: number | null;
  otaRateWeekdayMax: number | null;
  otaRateWeekendMax: number | null;
  otaRateLabel: string;
  otaRateMinText: string;
  otaRateMaxText: string;
  cheapestWeekdayOtaName?: string | null;
  cheapestWeekdayOtaUrl?: string | null;
  cheapestWeekendOtaName?: string | null;
  cheapestWeekendOtaUrl?: string | null;
  breakfastSummaryLabel?: RoomBreakfastStatus;
  rateConsistencyNote?: string | null;
  priceVsSanghyang: number | null;
  rating: number | null;
  reviewCount: number | null;
  ratingLabel: string;
  smartTv: boolean | null;
  smartTvLabel: string;
  bathtub: boolean | null;
  bathtubLabel: string;
  poolLabel: string;
  designStyleLabel: string;
  auditRationale: string;
  roomTypes: HotelRoomTypeMatrixSubRow[];
  facilityNarrative: FacilityStatement[];
  specs: PlaceSpecs | null;
  photosCount: number;
  mapsUrl: string | null;
  websiteUrl: string | null;
}

export interface CheapestRateComparisonRow {
  stay: "weekday" | "weekend";
  stayLabel: "Hari Biasa (Weekday)" | "Akhir Pekan (Weekend)";
  role: "sanghyang" | "kompetitor";
  hotelId: string;
  competitorId: string;
  hotelName: string;
  starLabel: string;
  roomTypeName: string;
  areaLabel: string;
  breakfastIncluded: boolean | null;
  breakfastLabel: RoomBreakfastStatus;
  /**
   * Penawaran kamar yang sama dengan dan tanpa sarapan, diisi bila penawaran termurah tidak menyebut sarapan (OTA seperti
   * Trip.com dan Traveloka hanya menampilkan harga di Google Travel); null bila status sarapannya sudah tersebut.
   */
  breakfastOffers: StayBreakfastOffers | null;
  price: number;
  priceLabel: string;
  otaName: string;
  otaUrl: string;
  checkIn: string | null;
  diffAmount: number | null;
  diffPercent: number | null;
  diffLabel: string;
  rank: number;
}

export interface CheapestRateComparison {
  title: string;
  subtitle: string;
  rows: CheapestRateComparisonRow[];
  weekday: {
    sanghyang: CheapestRateComparisonRow | null;
    cheapestCompetitor: CheapestRateComparisonRow | null;
    competitors: CheapestRateComparisonRow[];
  };
  weekend: {
    sanghyang: CheapestRateComparisonRow | null;
    cheapestCompetitor: CheapestRateComparisonRow | null;
    competitors: CheapestRateComparisonRow[];
  };
}

export interface ComparableMenuItemEntry {
  ownItemName: string;
  ownPrice: number;
  ownUnit: string | null;
  competitorItems: string[];
  competitorPrice: number;
  gapPercent: number;
  /** Padanan umum (ikan bakar per berat tanpa jenis ikan), dicetak dengan GENERIC_MATCH_LABEL. */
  generic: boolean;
}

export interface FnbMatrixEntry {
  no: number;
  competitorId: string;
  placeId: string | null;
  name: string;
  role: "sanghyang" | "inti" | "acuan";
  category: string | null;
  parentName: string | null;
  roadKm: number | null;
  driveMinutes: number | null;
  distanceLabel: string;
  distanceSource: string | null;
  rating: number | null;
  reviewCount: number | null;
  ratingLabel: string;
  menuPriceRange: { min: number; max: number } | null;
  perPersonRange: PerPersonRange | null;
  menuRangeLabel: string;
  menuItemCount: number;
  menuDetailLabel: string;
  /** Item yang menjadi batas bawah dan batas atas kisaran (null bila tidak ada kisaran). */
  rangeCheapest: CompetitorMenuItem | null;
  rangePriciest: CompetitorMenuItem | null;
  /** Item yang dihitung dalam kisaran (per porsi; bukan tambahan, promo, paket beberapa orang, atau sewa ruang), urut harga naik. */
  countedItems: CompetitorMenuItem[];
  /** Item tambahan, promo, paket beberapa orang, sewa ruang, atau bersatuan (per ons, per jam) yang tidak dihitung dalam kisaran. */
  excludedItems: CompetitorMenuItem[];
  sampleMenuItems: CompetitorMenuItem[];
  menuSources: { label: string; url: string }[];
  menuChecked: string[];
  comparableGap: { percent: number; items: number } | null;
  comparableItems: ComparableMenuItemEntry[];
  facilitiesLabel: string;
  auditRationale: string;
  specs: PlaceSpecs | null;
  photosCount: number;
  mapsUrl: string | null;
  websiteUrl: string | null;
}

export interface OutletItemComparisonRow {
  itemName: string;
  category: string | null;
  sanghyangPrice: number;
  unit: string | null;
  averageCompetitorPrice: number | null;
  averageGapPercent: number | null;
  matches: {
    rival: string;
    core: boolean;
    items: string[];
    price: number;
    gapPercent: number;
    /** Padanan umum (ikan bakar per berat tanpa jenis ikan), dicetak dengan GENERIC_MATCH_LABEL. */
    generic: boolean;
  }[];
}

export interface OutletCompetitorMatrix {
  outletKey: OutletKey;
  outletName: string;
  kind: "resort" | "fnb";
  columns: string[];
  note: string;
  ratesWindowNote?: string;
  ratesCheckedAt?: string;
  rateWindow?: ResolvedRateWindow;
  cheapestComparison?: CheapestRateComparison;
  hotelEntries?: HotelMatrixEntry[];
  fnbEntries?: FnbMatrixEntry[];
  itemComparisons?: OutletItemComparisonRow[];
}

export interface MatrixPriceSnapshot {
  competitorId: string;
  roomName?: string | null;
  packageName?: string | null;
  price: unknown;
  checkIn: Date | null;
  source: string;
  sourceUrl?: string | null;
  observedAt: Date;
}

export interface BuildOutletCompetitorMatricesOptions {
  /** Saring hanya outlet tertentu; bila kosong dibangun untuk semua 6 outlet. */
  outlets?: OutletKey[];
  /** Rentang tanggal snapshot harga (opsional). */
  from?: Date;
  to?: Date;
  /** Data yang sudah dimuat caller agar tidak ada kueri DB ganda. */
  marketSize?: ResortMarketSize;
  compsetAudit?: Record<string, OutletCompsetAudit>;
  roomTypesMap?: Map<string, HotelRoomTypesProfile>;
  specsMap?: Map<string, PlaceSpecs>;
  dynamicMenusMap?: Map<string, DynamicCompetitorMenuRecord>;
  priceSnapshots?: MatrixPriceSnapshot[];
}

const RULE_NOTE = `Aturan kompetitor: sejenis, paling jauh ${COMPSET_MAX_ROAD_KM} km jarak tempuh dari Sanghyang, penginapan minimal bintang ${MIN_LODGING_STARS}.`;
const outletLabel = (key: OutletKey) => (OUTLET_MARKET_SHARE_DATA[key]?.outletName ?? key).replace(/\s*\(.*\)$/, "");
const clean = (text: string | null | undefined) => (text ? sanitizePublicText(text) : "");
const fmtNum = (n: number) => n.toLocaleString("id-ID");
const fmtAreaNum = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));

function cleanOtaProviderName(raw: string | null | undefined): string {
  const s = clean(raw);
  if (!s) return "Google Travel (OTA)";
  if (/google\s+hotels(?:\s+lowest\s+displayed\s+rate)?/i.test(s)) return "Google Travel (OTA)";
  return s;
}

function nextIsoDay(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms + 86_400_000).toISOString().slice(0, 10);
}

function buildHotelGooglePricesUrl(
  entityBaseUrl: string | null,
  checkInIso: string | null,
  fallbackUrl: string | null,
): string {
  if (entityBaseUrl) {
    const cleanBase = entityBaseUrl.replace(/\/prices(?:\?.*)?$/, "");
    if (checkInIso && /^\d{4}-\d{2}-\d{2}$/.test(checkInIso)) {
      const params = new URLSearchParams({
        hl: "id",
        gl: "id",
        curr: "IDR",
        ts: buildTs(checkInIso, nextIsoDay(checkInIso), "IDR"),
      });
      return `${cleanBase}/prices?${params.toString()}`;
    }
    return `${cleanBase}/prices?hl=id&gl=id&curr=IDR`;
  }
  return fallbackUrl || "https://www.google.com/travel/hotels";
}

/**
 * Menyusun `HotelRateRange` dari snapshot harga DB (`CompetitorPriceSnapshot` / `SanghyangPriceSnapshot`).
 * Memakai pengamatan terbaru per tanggal check-in agar tarif lama pada tanggal yang sama tidak membayangi data segar.
 */
export function buildRateRangeFromSnapshots(snaps: MatrixPriceSnapshot[]): HotelRateRange | null {
  const valid = snaps.filter((s) => Number.isFinite(Number(s.price)) && Number(s.price) > 0);
  if (!valid.length) return null;

  // Deduplikasi per (checkIn, roomName): ambil pengamatan terbaru (`observedAt` terbesar)
  const latestByNight = new Map<string, MatrixPriceSnapshot>();
  const sortedByObs = [...valid].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  for (const s of sortedByObs) {
    const ci = (s.checkIn ?? s.observedAt).toISOString().slice(0, 10);
    const key = `${ci}|${(s.roomName ?? "Market rate").trim().toLowerCase()}`;
    if (!latestByNight.has(key)) latestByNight.set(key, s);
  }
  const deduped = [...latestByNight.values()];

  const toDatedRate = (s: MatrixPriceSnapshot): DatedRate => ({
    price: Math.round(Number(s.price)),
    checkIn: (s.checkIn ?? s.observedAt).toISOString().slice(0, 10),
    source: cleanOtaProviderName(s.source),
  });

  const weekdaySnaps: MatrixPriceSnapshot[] = [];
  const weekendSnaps: MatrixPriceSnapshot[] = [];
  for (const s of deduped) {
    const d = s.checkIn ?? s.observedAt;
    const day = d.getUTCDay();
    if (day === 5 || day === 6) weekendSnaps.push(s);
    else weekdaySnaps.push(s);
  }

  const findMinMax = (arr: MatrixPriceSnapshot[]) => {
    if (!arr.length) {
      return { nights: 0, min: { price: null, checkIn: null, source: null }, max: { price: null, checkIn: null, source: null } };
    }
    const sorted = [...arr].sort((a, b) => Number(a.price) - Number(b.price));
    return {
      nights: arr.length,
      min: toDatedRate(sorted[0]),
      max: toDatedRate(sorted[sorted.length - 1]),
    };
  };

  return {
    weekday: findMinMax(weekdaySnaps),
    weekend: findMinMax(weekendSnaps),
  };
}

/** Menggabungkan `HotelRateRange` dari crawl 14 malam dan snapshot DB terbaru. */
function mergeRateRanges(staticRange: HotelRateRange | null, snapRange: HotelRateRange | null): HotelRateRange | null {
  if (!staticRange) return snapRange;
  if (!snapRange) return staticRange;

  const pickMin = (a: DatedRate, b: DatedRate): DatedRate => {
    if (a.price === null) return b;
    if (b.price === null) return a;
    // Utamakan sumber OTA bernama spesifik bila tarif sama; bila berbeda pilih yang lebih rendah.
    return a.price <= b.price ? a : b;
  };
  const pickMax = (a: DatedRate, b: DatedRate): DatedRate => {
    if (a.price === null) return b;
    if (b.price === null) return a;
    return a.price >= b.price ? a : b;
  };

  return {
    weekday: {
      nights: Math.max(staticRange.weekday.nights, snapRange.weekday.nights),
      min: pickMin(staticRange.weekday.min, snapRange.weekday.min),
      max: pickMax(staticRange.weekday.max, snapRange.weekday.max),
    },
    weekend: {
      nights: Math.max(staticRange.weekend.nights, snapRange.weekend.nights),
      min: pickMin(staticRange.weekend.min, snapRange.weekend.min),
      max: pickMax(staticRange.weekend.max, snapRange.weekend.max),
    },
  };
}

/** Label jarak tempuh jujur: jarak dari server rute terbuka ditulis "estimasi rute", tanpa menit dan tanpa mengaku Google Maps. */
export function formatDistanceLabel(
  roadKm: number | null,
  driveMinutes: number | null,
  distanceSource: string | null,
  role: "sanghyang" | "inti" | "acuan",
): string {
  if (role === "sanghyang") return "Titik awal";
  if (roadKm === null) return MATRIX_NO_DATA;
  const safeMin = drivingMinutesFor(distanceSource, driveMinutes);
  const isOsrm = Boolean(distanceSource && /OSRM/i.test(distanceSource));
  if (isOsrm) return `${fmtNum(roadKm)} km (estimasi rute)`;
  if (safeMin !== null) return `${fmtNum(roadKm)} km (${safeMin} mnt)`;
  return `${fmtNum(roadKm)} km`;
}

function formatSmartTv(val: boolean | null | undefined): string {
  if (val === true) return "Smart TV";
  if (val === false) return "TV Biasa";
  return MATRIX_NO_DATA;
}

function formatBathtub(val: boolean | null | undefined, roomTypes?: HotelRoomTypeSpec[]): string {
  if (roomTypes && roomTypes.length > 0) {
    const known = roomTypes.filter((r) => r.bathtub !== null);
    if (known.length > 0) {
      const withBath = known.filter((r) => r.bathtub === true).length;
      if (withBath === known.length) return "Ada";
      if (withBath > 0) return `Sebagian (${withBath}/${roomTypes.length})`;
      return "Tidak";
    }
  }
  if (val === true) return "Ada";
  if (val === false) return "Tidak";
  return MATRIX_NO_DATA;
}

function formatHotelSmartTv(val: boolean | null | undefined, roomTypes?: HotelRoomTypeSpec[]): string {
  if (roomTypes && roomTypes.length > 0) {
    const known = roomTypes.filter((r) => r.smartTv !== null);
    if (known.length > 0) {
      const withSmart = known.filter((r) => r.smartTv === true).length;
      if (withSmart === known.length) return "Smart TV";
      if (withSmart > 0) return `Sebagian (${withSmart}/${roomTypes.length})`;
      return "TV Biasa";
    }
  }
  return formatSmartTv(val);
}

function formatPoolLabel(specs: PlaceSpecs | null): string {
  if (!specs) return MATRIX_NO_DATA;
  if (specs.facilities.hotSpring) return "Hot Spring & Sea Pool";
  if (specs.facilities.infinityPool) return "Infinity Pool";
  if (specs.facilities.poolType) {
    const short = clean(specs.facilities.poolType).split(/[.;]/)[0].trim();
    return short.length <= 42 ? short : "Kolam Renang";
  }
  return MATRIX_NO_DATA;
}

function formatDesignLabel(specs: PlaceSpecs | null): string {
  const raw = specs?.facilities.designStyle ?? specs?.visual?.designStyle ?? null;
  if (!raw) return MATRIX_NO_DATA;
  const short = clean(raw).split(/[.;]/)[0].trim();
  return short.length <= 65 ? short : `${short.slice(0, 62).replace(/\s+\S*$/, "")}…`;
}

function formatMinMaxPair(
  wdMin: number | null,
  wdMax: number | null,
  weMin: number | null,
  weMax: number | null,
): string {
  const side = (min: number | null, max: number | null) => {
    if (min === null && max === null) return MATRIX_NO_DATA;
    if (min !== null && max !== null && max > min) return `${rupiah(min)}–${rupiah(max)}`;
    return rupiah((min ?? max) as number);
  };
  const wd = side(wdMin, wdMax);
  const we = side(weMin, weMax);
  if (wd === MATRIX_NO_DATA && we === MATRIX_NO_DATA) return MATRIX_NO_DATA;
  return `${wd} / ${we}`;
}

function formatRoomTypePrice(wd: number | null, we: number | null): string {
  if (wd !== null && we !== null) return `${rupiah(wd)} / ${rupiah(we)}`;
  if (wd !== null) return `${rupiah(wd)} / —`;
  if (we !== null) return `— / ${rupiah(we)}`;
  return "—";
}

function areaSummaryFromRooms(roomTypes: HotelRoomTypeMatrixSubRow[], specs: PlaceSpecs | null): string {
  const sizes = roomTypes
    .map((r) => r.areaSqm)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (sizes.length === 1) return `${fmtAreaNum(sizes[0])} m²`;
  if (sizes.length > 1) return `${fmtAreaNum(sizes[0])}–${fmtAreaNum(sizes[sizes.length - 1])} m²`;
  return specs?.facilities.roomSizeRangeLabel ?? MATRIX_NO_DATA;
}

function roomSourcesOf(rooms: HotelRoomTypeMatrixSubRow[]): SourceRef[] {
  const out = new Map<string, SourceRef>();
  for (const rt of rooms) {
    if (rt.sourceUrl && !out.has(rt.sourceUrl)) {
      out.set(rt.sourceUrl, { label: rt.sourceLabel || (rt.sourcePriority === "official" ? "Situs resmi" : "Listing OTA"), url: rt.sourceUrl, observedAt: rt.observedAt.slice(0, 10) || null });
    }
  }
  return [...out.values()];
}

/**
 * Narasi fasilitas satu hotel untuk dialog detail Langkah 3: jumlah dan luas kamar, TV, bathtub, kolam atau air panas,
 * fasilitas lain, dan gaya desain dari galeri. Tiap kalimat membawa sumbernya (situs resmi, OTA, atau galeri foto);
 * fasilitas yang belum terbaca ditulis "belum tercatat", bukan ditebak.
 */
export function buildHotelFacilityNarrative(input: {
  roomCount: number | null;
  roomCountSource: string | null;
  roomTypes: HotelRoomTypeMatrixSubRow[];
  specs: PlaceSpecs | null;
}): FacilityStatement[] {
  const { roomCount, roomTypes, specs } = input;
  const fac = specs?.facilities;
  const facSrc = specs?.facilitySources ?? {};
  const out: FacilityStatement[] = [];

  if (roomCount) {
    const src = facSrc.roomCount ?? (input.roomCountSource ? { label: clean(input.roomCountSource), url: null, observedAt: null } : null);
    out.push({ text: `${fmtNum(roomCount)} kamar.`, sources: src ? [src] : [] });
  } else {
    out.push({ text: "Jumlah kamar belum tercatat.", sources: [] });
  }

  if (roomTypes.length) {
    const multi = roomTypes.filter((rt) => (rt.bedrooms ?? 0) >= 2).length;
    const area = areaSummaryFromRooms(roomTypes, specs);
    out.push({
      text: `${roomTypes.length} tipe kamar${multi ? `, ${multi} di antaranya unit 2 kamar tidur atau lebih` : ""}; luas ${area === MATRIX_NO_DATA ? "belum tercatat" : area}.`,
      sources: roomSourcesOf(roomTypes),
    });
  }

  const featureLine = (
    label: string,
    pick: (rt: HotelRoomTypeMatrixSubRow) => boolean | null,
    placeValue: boolean | null | undefined,
    placeNote: string | null | undefined,
    placeSource: SourceRef | undefined,
    yes: string,
    no: string,
  ) => {
    const known = roomTypes.filter((rt) => pick(rt) !== null);
    if (known.length) {
      const withIt = known.filter((rt) => pick(rt) === true);
      const text =
        withIt.length === known.length
          ? `${yes} di semua tipe kamar yang tercatat.`
          : withIt.length === 0
            ? `${no} di semua tipe kamar yang tercatat.`
            : `${yes} di ${withIt.map((rt) => rt.name).join(", ")}; ${known.length - withIt.length} tipe lain tanpa ${label}.`;
      out.push({ text, sources: roomSourcesOf(known) });
      return;
    }
    if (placeValue === true || placeValue === false) {
      out.push({ text: clean(placeNote) || (placeValue ? `${yes}.` : `${no}.`), sources: placeSource ? [placeSource] : [] });
      return;
    }
    out.push({ text: `Keterangan ${label} belum tercatat.`, sources: [] });
  };
  featureLine("Smart TV", (rt) => rt.smartTv, fac?.smartTv, fac?.smartTvNote, facSrc.smartTv, "Smart TV", "TV biasa (bukan Smart TV)");
  featureLine("bathtub", (rt) => rt.bathtub, fac?.bathtub, fac?.bathtubNote, facSrc.bathtub, "Bathtub", "Tanpa bathtub");

  if (fac?.hotSpring) out.push({ text: clean(fac.hotSpringNote) || "Pemandian air panas alami.", sources: facSrc.hotSpring ? [facSrc.hotSpring] : [] });
  if (fac?.poolType) out.push({ text: clean(fac.poolType), sources: facSrc.pool ? [facSrc.pool] : [] });
  if (!fac?.hotSpring && !fac?.poolType) out.push({ text: "Keterangan kolam renang belum tercatat.", sources: [] });

  const amenities = (fac?.keyAmenities ?? []).map(clean).filter(Boolean);
  if (amenities.length) out.push({ text: `Fasilitas lain: ${amenities.slice(0, 8).join(", ")}.`, sources: facSrc.amenities ? [facSrc.amenities] : [] });

  const design = clean(specs?.visual?.designStyle ?? fac?.designStyle ?? null);
  if (design) out.push({ text: `Gaya desain: ${design}`.replace(/\.?$/, "."), sources: facSrc.design ? [facSrc.design] : [] });

  return out;
}


/**
 * Memilih indeks kamar kelas dasar (entry-level) properti:
 * utamakan 1 kamar tidur kategori `standard`, lalu 1 kamar tidur kategori lain, lalu indeks 0.
 */
function pickEntryLevelRoomIndex(roomTypes: HotelRoomTypeSpec[]): number {
  if (!roomTypes.length) return -1;
  const std1Br = roomTypes.findIndex((r) => r.category === "standard" && (r.bedrooms === 1 || r.bedrooms === null));
  if (std1Br >= 0) return std1Br;
  const any1Br = roomTypes.findIndex((r) => r.bedrooms === 1);
  if (any1Br >= 0) return any1Br;
  return 0;
}

function summarizeBreakfastStatus(
  hasTrue: boolean,
  hasFalse: boolean,
  fallback: boolean | null,
): { included: boolean | null; label: RoomBreakfastStatus } {
  if (hasTrue && hasFalse) return { included: null, label: "Tersedia keduanya" };
  if (hasTrue) return { included: true, label: "Termasuk sarapan" };
  if (hasFalse) return { included: false, label: "Tanpa sarapan" };
  if (fallback === true) return { included: true, label: "Termasuk sarapan" };
  if (fallback === false) return { included: false, label: "Tanpa sarapan" };
  return { included: null, label: "Belum tercatat" };
}

function minNonNull(a: number | null | undefined, b: number | null | undefined): number | null {
  const va = typeof a === "number" && Number.isFinite(a) && a > 0 ? a : null;
  const vb = typeof b === "number" && Number.isFinite(b) && b > 0 ? b : null;
  if (va !== null && vb !== null) return Math.min(va, vb);
  return va ?? vb;
}

interface BuildHotelRoomSubRowsContext {
  roomTypes: HotelRoomTypeSpec[];
  /** Bukti penawaran per kamar dari crawl yang dipakai (kosong bila jendela tidak berasal dari crawl). */
  evidence: RateEvidence[];
  /** Tanggal check-in asli bukti per kamar pada crawl itu. */
  evidenceCheckIn: { weekday: string; weekend: string };
  /** Pantauan harian DB yang check-in-nya sudah pasti di dalam jendela. */
  snapshots: MatrixPriceSnapshot[];
  /** Termurah dan termahal properti; titiknya sudah disaring ke dalam jendela. */
  propertyRange: HotelRateRange | null;
  /** Harga situs resmi yang diamati sesudah tanggal ini tidak dipakai (periode historis). */
  officialObservedLimit: string | null;
  /** Tarif booking engine resmi per tipe kamar (pemuat tarif resmi); menang atas kolom harga profil kamar. */
  officialRates: OfficialRoomRate[];
  /** Alasan pemuat tarif resmi belum punya data untuk hotel ini; null bila hotel ini tidak punya pemuat. */
  officialUnavailableReason: string | null;
  /** Tanggal crawl bukti per kamar (null bila tidak memakai crawl). */
  crawlDate: string | null;
  /** Tanggal pengamatan terbaru tarif properti yang dipakai (null bila tidak ada tarif). */
  ratesObservedAt: string | null;
  /** Jendela check-in yang disebut catatan; tarif resmi di luar jendela tidak dipakai. */
  windowFirstCheckIn: string;
  windowLastCheckIn: string;
  entityBaseUrl: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
}

interface OtaCandidate {
  price: number;
  provider: string;
  checkIn: string;
  url: string;
  breakfast: boolean | null;
  isPropertyLowest: boolean;
}

const KIND_TO_CATEGORY: Record<RateEvidence["kind"], RoomTypeCategory> = {
  standard: "standard",
  suite: "suite",
  villa: "villa",
};

/** Kamar yang hanya muncul di penawaran OTA tetap ditampilkan supaya tabel memuat semua tipe dari semua sumber. */
function roomSpecFromOffer(ev: RateEvidence, sourceUrl: string, observedAt: string): HotelRoomTypeSpec {
  const name = clean(ev.roomType.split(/\s+-\s+/)[0]) || clean(ev.roomType);
  return {
    name,
    category: KIND_TO_CATEGORY[ev.kind],
    bedrooms: extractBedroomsFromName(name),
    areaSqm: null,
    areaLabel: null,
    smartTv: null,
    bathtub: null,
    highlights: [],
    weekdayPrice: null,
    weekendPrice: null,
    priceSource: null,
    sourcePriority: "ota",
    sourceLabel: `Penawaran ${cleanOtaProviderName(ev.provider)}`,
    sourceUrl,
    observedAt,
  };
}

const PROPERTY_LOWEST_ROOM: Pick<HotelRoomTypeSpec, "name" | "category"> = {
  name: "Semua tipe kamar (tarif termurah properti)",
  category: "standard",
};

/**
 * Sub-baris tipe kamar dengan dua lapisan harga: situs resmi dan OTA termurah (dengan tautan, tanggal check-in, dan
 * status sarapan per jenis hari). Semua tarif OTA berasal dari jendela yang disebut catatan: bukti per kamar memakai
 * tanggal check-in crawl aslinya, dan tarif termurah properti dipasang pada kamar kelas dasar bila lebih murah.
 */
export function buildHotelRoomSubRows(ctx: BuildHotelRoomSubRowsContext): HotelRoomTypeMatrixSubRow[] {
  const { evidence, snapshots, propertyRange, evidenceCheckIn, entityBaseUrl, websiteUrl, mapsUrl } = ctx;

  const snapUrlForCheckIn = (ci: string): string | null => {
    const hit =
      snapshots.find((s) => s.sourceUrl && /^https:\/\//i.test(s.sourceUrl) && (s.checkIn ?? s.observedAt).toISOString().slice(0, 10) === ci) ??
      snapshots.find((s) => s.sourceUrl && /^https:\/\//i.test(s.sourceUrl));
    return hit?.sourceUrl ?? null;
  };
  const otaUrlForCheckIn = (ci: string): string =>
    buildHotelGooglePricesUrl(entityBaseUrl, ci, snapUrlForCheckIn(ci) ?? mapsUrl ?? websiteUrl);

  // Kamar dari profil (situs resmi menang atas OTA), lalu kamar yang hanya disebut penawaran OTA.
  const roomTypes: HotelRoomTypeSpec[] = [...ctx.roomTypes];
  const evidenceByIdx = new Map<number, RateEvidence[]>();
  for (const ev of evidence) {
    let idx = bestMatchingRoomIndex(ev.roomType, roomTypes);
    if (idx < 0) {
      if (!ctx.crawlDate) throw new Error("Bukti tarif per kamar dipakai tanpa tanggal crawl");
      roomTypes.push(roomSpecFromOffer(ev, otaUrlForCheckIn(evidenceCheckIn[ev.stay]), ctx.crawlDate));
      idx = roomTypes.length - 1;
    }
    evidenceByIdx.set(idx, [...(evidenceByIdx.get(idx) ?? []), ev]);
  }

  const snapByIdx = new Map<number, MatrixPriceSnapshot[]>();
  for (const s of snapshots) {
    const rn = s.roomName?.trim() ?? "";
    if (!rn || /^market\s+rate$/i.test(rn)) continue;
    const idx = bestMatchingRoomIndex(rn, roomTypes);
    if (idx >= 0) snapByIdx.set(idx, [...(snapByIdx.get(idx) ?? []), s]);
  }

  const hasPropertyRate = Boolean(propertyRange && (propertyRange.weekday.min.price !== null || propertyRange.weekend.min.price !== null));
  if (!roomTypes.length && hasPropertyRate && ctx.ratesObservedAt) {
    roomTypes.push({
      ...PROPERTY_LOWEST_ROOM,
      bedrooms: null,
      areaSqm: null,
      areaLabel: null,
      smartTv: null,
      bathtub: null,
      highlights: [],
      weekdayPrice: null,
      weekendPrice: null,
      priceSource: null,
      sourcePriority: "ota",
      sourceLabel: "Tarif termurah properti di OTA",
      sourceUrl: otaUrlForCheckIn(evidenceCheckIn.weekday),
      observedAt: ctx.ratesObservedAt,
    });
  }
  if (!roomTypes.length) return [];

  const entryIdx = pickEntryLevelRoomIndex(roomTypes);

  return roomTypes.map((rt, idx) => {
    const highlights = rt.highlights.map(clean).filter(Boolean);
    const officialBf = inferOfficialBreakfastFromHighlights(highlights);

    // Tarif booking engine resmi untuk kamar yang sama menang atas kolom harga profil kamar (keputusan pemilik E2).
    const engine = ctx.officialRates.find(
      (r) => r.roomName === rt.name && (!ctx.officialObservedLimit || isoDateWib(new Date(r.observedAt)) <= ctx.officialObservedLimit),
    );
    const engineIn = (ci: string | null) => ci !== null && ci >= ctx.windowFirstCheckIn && ci <= ctx.windowLastCheckIn;
    const engineWd = engine && engine.weekdayPrice !== null && engineIn(engine.checkInWeekday) ? engine.weekdayPrice : null;
    const engineWe = engine && engine.weekendPrice !== null && engineIn(engine.checkInWeekend) ? engine.weekendPrice : null;
    // Lapisan booking engine resmi dijanjikan sebanding dengan lapisan OTA pada malam yang sama (official-room-rates.ts).
    // Berkas resmi bisa tertinggal saat langkah crawl resminya dilewati sementara crawl OTA bergeser, jadi harga resmi
    // hanya dihitung bila check-in jenis hari itu sama persis dengan tanggal utama OTA; malam lain di jendela tetap tampil
    // dengan tanggalnya sendiri. Tanpa bukti crawl (jendela dari pantauan harian DB) lapisan OTA tidak punya tanggal
    // utama, jadi tidak ada harga resmi yang dihitung.
    const otaLayerCheckIn = ctx.crawlDate !== null ? evidenceCheckIn : null;
    const countedWd = engineWd !== null && engine?.checkInWeekday === otaLayerCheckIn?.weekday ? engineWd : null;
    const countedWe = engineWe !== null && engine?.checkInWeekend === otaLayerCheckIn?.weekend ? engineWe : null;
    // Hanya tarif booking engine yang bertanggal yang menjadi lapisan situs resmi. Harga riset profil kamar tanpa tanggal
    // menginap tidak dipakai lagi: harga be.dip.id yang dicatat 19 Nov untuk menginap 21 dan 24 Nov tampil seolah tarif
    // hari ini, tanpa paket sarapan wajib, dan dengan sarapan "Belum tercatat" (laporan pemilik 27 Nov 2026).
    const officialRate: RoomOfficialRateLayer | null =
      engine && (engineWd !== null || engineWe !== null)
        ? {
            weekdayPrice: countedWd,
            weekendPrice: countedWe,
            priceLabel: formatRoomTypePrice(countedWd, countedWe),
            sourceLabel: clean(engine.sourceLabel),
            sourceUrl: engine.sourceUrl,
            breakfastIncluded: engine.breakfastIncluded,
            breakfastLabel: engine.breakfastIncluded === true ? "Termasuk sarapan" : engine.breakfastIncluded === false ? "Tanpa sarapan" : "Belum tercatat",
            weekdayCheckIn: engineWd !== null ? engine.checkInWeekday : null,
            weekendCheckIn: engineWe !== null ? engine.checkInWeekend : null,
            weekdayBreakfast: engineWd !== null ? engine.weekday.breakfastIncluded : null,
            weekendBreakfast: engineWe !== null ? engine.weekend.breakfastIncluded : null,
            ratePlan: engine.ratePlan,
            weekdayUnavailableReason: engineWd === null ? clean(engine.weekday.unavailableReason) || null : null,
            weekendUnavailableReason: engineWe === null ? clean(engine.weekend.unavailableReason) || null : null,
            weekdaySourceUrl: engineWd !== null ? engine.weekday.sourceUrl : null,
            weekendSourceUrl: engineWe !== null ? engine.weekend.sourceUrl : null,
            weekdayOtherNightPrice: countedWd === null ? engineWd : null,
            weekendOtherNightPrice: countedWe === null ? engineWe : null,
            otaCheckInWeekday: otaLayerCheckIn?.weekday ?? null,
            otaCheckInWeekend: otaLayerCheckIn?.weekend ?? null,
          }
        : null;
    const officialUnavailableReason = officialRate
      ? null
      : engine
        ? clean(engine.weekday.unavailableReason ?? engine.weekend.unavailableReason ?? null) || ctx.officialUnavailableReason
        : ctx.officialUnavailableReason;

    const wdCandidates: OtaCandidate[] = [];
    const weCandidates: OtaCandidate[] = [];
    const push = (stay: "weekday" | "weekend", c: OtaCandidate) => (stay === "weekday" ? wdCandidates : weCandidates).push(c);

    for (const ev of evidenceByIdx.get(idx) ?? []) {
      const ci = evidenceCheckIn[ev.stay];
      push(ev.stay, {
        price: ev.price,
        provider: cleanOtaProviderName(ev.provider),
        checkIn: ci,
        url: otaUrlForCheckIn(ci),
        breakfast: typeof ev.breakfast === "boolean" ? ev.breakfast : null,
        isPropertyLowest: false,
      });
    }

    for (const s of snapByIdx.get(idx) ?? []) {
      const p = Math.round(Number(s.price));
      if (!Number.isFinite(p) || p <= 0) continue;
      const d = s.checkIn ?? s.observedAt;
      const ci = d.toISOString().slice(0, 10);
      push(d.getUTCDay() === 5 || d.getUTCDay() === 6 ? "weekend" : "weekday", {
        price: p,
        provider: cleanOtaProviderName(s.source),
        checkIn: ci,
        url: (s.sourceUrl && /^https:\/\//i.test(s.sourceUrl) ? s.sourceUrl : null) ?? otaUrlForCheckIn(ci),
        breakfast: breakfastFromPackage(s.packageName),
        isPropertyLowest: false,
      });
    }

    // Tarif termurah properti (nama kamar tidak disebut OTA) dipasang pada kamar kelas dasar bila lebih murah.
    if (idx === entryIdx && propertyRange) {
      for (const stay of ["weekday", "weekend"] as const) {
        const point = propertyRange[stay].min;
        if (point.price === null || point.checkIn === null) continue;
        const list = stay === "weekday" ? wdCandidates : weCandidates;
        const currentMin = list.length ? Math.min(...list.map((c) => c.price)) : Number.POSITIVE_INFINITY;
        if (point.price < currentMin) {
          list.push({
            price: point.price,
            provider: cleanOtaProviderName(point.source),
            checkIn: point.checkIn,
            url: otaUrlForCheckIn(point.checkIn),
            breakfast: null,
            isPropertyLowest: true,
          });
        }
      }
    }

    wdCandidates.sort((a, b) => a.price - b.price);
    weCandidates.sort((a, b) => a.price - b.price);
    const bestWd = wdCandidates[0] ?? null;
    const bestWe = weCandidates[0] ?? null;

    const allCands = [...wdCandidates, ...weCandidates];
    const bfSummary = summarizeBreakfastStatus(
      allCands.some((c) => c.breakfast === true),
      allCands.some((c) => c.breakfast === false),
      officialBf,
    );

    const offerPoint = (c: OtaCandidate | undefined): BreakfastOfferPoint | null =>
      c ? { price: c.price, otaName: c.provider, checkIn: c.checkIn } : null;
    const stayOffers = (list: OtaCandidate[]): StayBreakfastOffers => ({
      withBreakfast: offerPoint(list.find((c) => c.breakfast === true)),
      withoutBreakfast: offerPoint(list.find((c) => c.breakfast === false)),
    });
    const breakfastOffers = { weekday: stayOffers(wdCandidates), weekend: stayOffers(weCandidates) };

    let otaLowest: RoomOtaLowestLayer | null = null;
    if (bestWd || bestWe) {
      const otaNames = [...new Set([bestWd?.provider, bestWe?.provider].filter((x): x is string => Boolean(x)))];
      otaLowest = {
        weekdayPrice: bestWd?.price ?? null,
        weekendPrice: bestWe?.price ?? null,
        priceLabel: formatRoomTypePrice(bestWd?.price ?? null, bestWe?.price ?? null),
        otaName: otaNames.join(" / "),
        otaUrl: (bestWd ?? bestWe)!.url,
        weekdayOtaName: bestWd?.provider ?? null,
        weekdayOtaUrl: bestWd?.url ?? null,
        weekdayCheckIn: bestWd?.checkIn ?? null,
        weekendOtaName: bestWe?.provider ?? null,
        weekendOtaUrl: bestWe?.url ?? null,
        weekendCheckIn: bestWe?.checkIn ?? null,
        breakfastIncluded: bfSummary.included,
        breakfastLabel: bfSummary.label,
        withBreakfastWeekdayPrice: breakfastOffers.weekday.withBreakfast?.price ?? null,
        withoutBreakfastWeekdayPrice: breakfastOffers.weekday.withoutBreakfast?.price ?? null,
        withBreakfastWeekendPrice: breakfastOffers.weekend.withBreakfast?.price ?? null,
        withoutBreakfastWeekendPrice: breakfastOffers.weekend.withoutBreakfast?.price ?? null,
        breakfastOffers,
        weekdayBreakfast: bestWd?.breakfast ?? null,
        weekendBreakfast: bestWe?.breakfast ?? null,
        weekdayIsPropertyLowest: Boolean(bestWd?.isPropertyLowest),
        weekendIsPropertyLowest: Boolean(bestWe?.isPropertyLowest),
        isPropertyLowestRate: Boolean(bestWd?.isPropertyLowest || bestWe?.isPropertyLowest),
      };
    }

    // Harga dan sumber sub-baris hanya dari lapisan yang dihitung; harga resmi malam lain tidak ikut.
    const effectiveWeekday = minNonNull(otaLowest?.weekdayPrice, officialRate?.weekdayPrice);
    const effectiveWeekend = minNonNull(otaLowest?.weekendPrice, officialRate?.weekendPrice);
    const officialCounted = officialRate !== null && (officialRate.weekdayPrice !== null || officialRate.weekendPrice !== null);
    const sourceParts = [
      officialCounted ? `Resmi: ${officialRate.sourceLabel}` : null,
      otaLowest ? `OTA: ${otaLowest.otaName}` : null,
    ].filter(Boolean);

    return {
      name: clean(rt.name),
      category: rt.category,
      bedrooms: rt.bedrooms,
      areaSqm: rt.areaSqm,
      areaLabel: formatAreaSqm(rt),
      weekdayPrice: effectiveWeekday,
      weekendPrice: effectiveWeekend,
      priceLabel: formatRoomTypePrice(effectiveWeekday, effectiveWeekend),
      priceSource: sourceParts.join(" · ") || null,
      smartTv: rt.smartTv,
      smartTvLabel: rt.smartTv === true ? "Smart TV" : rt.smartTv === false ? "TV Biasa" : "—",
      bathtub: rt.bathtub,
      bathtubLabel: rt.bathtub === true ? "Ada" : rt.bathtub === false ? "Tidak" : "—",
      highlights,
      sourcePriority: rt.sourcePriority,
      sourceLabel: clean(rt.sourceLabel),
      sourceUrl: rt.sourceUrl,
      observedAt: rt.observedAt,
      conflictNote: clean(rt.conflictNote) || null,
      officialRate,
      officialUnavailableReason,
      otaLowest,
      breakfastIncluded: bfSummary.included,
      breakfastLabel: bfSummary.label,
    };
  });
}

/**
 * Harga yang dihitung di sub-baris satu jenis hari: baris situs resmi (malam yang sama dengan tanggal utama OTA) dan
 * baris OTA termurah. Harga resmi malam lain tercetak dengan tanggalnya dan tanda "tidak dihitung", jadi tidak ikut.
 */
export function shownRoomPrices(roomTypes: HotelRoomTypeMatrixSubRow[], stay: "weekday" | "weekend"): number[] {
  const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  return roomTypes.flatMap((rt) =>
    [stay === "weekday" ? rt.officialRate?.weekdayPrice : rt.officialRate?.weekendPrice,
      stay === "weekday" ? rt.otaLowest?.weekdayPrice : rt.otaLowest?.weekendPrice].filter(ok),
  );
}

/**
 * Kalimat catatan matriks (web dan PDF) bila ada tarif situs resmi dari malam lain, supaya pembaca PDF yang hanya melihat
 * rentang tahu mengapa harga itu tidak dihitung; null bila semua tarif resmi semalam dengan lapisan OTA.
 */
export function officialOtherNightNote(hotels: Pick<HotelMatrixEntry, "name" | "roomTypes">[]): string | null {
  const parts = hotels.flatMap((h) => {
    const dates = new Set<string>();
    for (const off of h.roomTypes.map((rt) => rt.officialRate)) {
      if (off?.weekdayOtherNightPrice != null && off.weekdayCheckIn) dates.add(off.weekdayCheckIn);
      if (off?.weekendOtherNightPrice != null && off.weekendCheckIn) dates.add(off.weekendCheckIn);
    }
    return dates.size ? [`${h.name} bertanggal check-in ${[...dates].sort().map(checkInLabel).join(" dan ")}`] : [];
  });
  return parts.length
    ? `Tarif situs resmi ${parts.join("; ")} tidak sama dengan tanggal utama OTA, jadi tampil dengan tanggalnya sendiri dan tidak dihitung di rentang tarif, harga termurah, maupun selisih.`
    : null;
}

/** Titik termurah/termahal yang check-in-nya di luar jendela dibuang, supaya angka tidak lebih tua dari catatannya. */
function clipRangeToWindow(range: HotelRateRange | null, inWindow: (iso: string) => boolean): HotelRateRange | null {
  if (!range) return null;
  const NONE: DatedRate = { price: null, checkIn: null, source: null };
  const keep = (r: DatedRate): DatedRate => (r.price !== null && r.checkIn !== null && inWindow(r.checkIn) ? r : NONE);
  return {
    weekday: { nights: range.weekday.nights, min: keep(range.weekday.min), max: keep(range.weekday.max) },
    weekend: { nights: range.weekend.nights, min: keep(range.weekend.min), max: keep(range.weekend.max) },
  };
}

function summarizeHotelBreakfast(roomTypes: HotelRoomTypeMatrixSubRow[]): RoomBreakfastStatus {
  const labels = roomTypes.map((r) => r.breakfastLabel).filter((l) => l !== "Belum tercatat");
  if (!labels.length) return "Belum tercatat";
  if (labels.includes("Tersedia keduanya")) return "Tersedia keduanya";
  const hasWith = labels.includes("Termasuk sarapan");
  const hasWithout = labels.includes("Tanpa sarapan");
  if (hasWith && hasWithout) return "Tersedia keduanya";
  if (hasWith) return "Termasuk sarapan";
  if (hasWithout) return "Tanpa sarapan";
  return "Belum tercatat";
}

export interface CheapestLayerHit {
  room: HotelRoomTypeMatrixSubRow;
  layer: "official" | "ota";
  sourceName: string;
  sourceUrl: string;
  checkIn: string | null;
  breakfast: boolean | null;
}

/**
 * Sub-baris dan lapisan harga yang memberi harga tertentu. Baris OTA didahulukan karena bisa diklik ke OTA-nya, kecuali
 * situs resmi memberi harga yang sama untuk malam yang sama dan menyebut sarapan sedangkan penawaran OTA-nya tidak
 * (harga "Situs Resmi" di Google Travel berasal dari booking engine yang sama).
 */
export function cheapestLayerOf(
  roomTypes: HotelRoomTypeMatrixSubRow[],
  stay: "weekday" | "weekend",
  price: number,
): CheapestLayerHit | null {
  const wd = stay === "weekday";
  let ota: CheapestLayerHit | null = null;
  let official: CheapestLayerHit | null = null;
  for (const room of roomTypes) {
    const layer = room.otaLowest;
    if (layer && !ota && (wd ? layer.weekdayPrice : layer.weekendPrice) === price) {
      ota = {
        room,
        layer: "ota",
        sourceName: (wd ? layer.weekdayOtaName : layer.weekendOtaName) ?? layer.otaName,
        sourceUrl: (wd ? layer.weekdayOtaUrl : layer.weekendOtaUrl) ?? layer.otaUrl,
        checkIn: wd ? layer.weekdayCheckIn : layer.weekendCheckIn,
        breakfast: wd ? layer.weekdayBreakfast : layer.weekendBreakfast,
      };
    }
    const off = room.officialRate;
    if (off && !official && (wd ? off.weekdayPrice : off.weekendPrice) === price) {
      // Tarif booking engine membawa tanggal, tautan, dan sarapan per jenis hari; tarif profil kamar tidak (null).
      official = {
        room,
        layer: "official",
        sourceName: off.sourceLabel,
        sourceUrl: (wd ? off.weekdaySourceUrl : off.weekendSourceUrl) ?? off.sourceUrl,
        checkIn: wd ? off.weekdayCheckIn : off.weekendCheckIn,
        breakfast: (wd ? off.weekdayBreakfast : off.weekendBreakfast) ?? off.breakfastIncluded,
      };
    }
  }
  const officialStatesBreakfast =
    ota !== null && ota.breakfast === null && official !== null && official.breakfast !== null && official.checkIn !== null && official.checkIn === ota.checkIn;
  return officialStatesBreakfast ? official : (ota ?? official);
}

const breakfastStatusOf = (bf: boolean | null): RoomBreakfastStatus =>
  bf === true ? "Termasuk sarapan" : bf === false ? "Tanpa sarapan" : "Belum tercatat";

function buildCheapestRateComparison(hotelEntries: HotelMatrixEntry[]): CheapestRateComparison {
  const own = hotelEntries.find((h) => h.role === "sanghyang") ?? null;

  const buildForStay = (stay: "weekday" | "weekend") => {
    const stayLabel: "Hari Biasa (Weekday)" | "Akhir Pekan (Weekend)" =
      stay === "weekday" ? "Hari Biasa (Weekday)" : "Akhir Pekan (Weekend)";

    const toRow = (
      h: HotelMatrixEntry,
      ownPrice: number | null,
      rank: number,
    ): CheapestRateComparisonRow | null => {
      const price = stay === "weekday" ? h.otaRateWeekdayMin : h.otaRateWeekendMin;
      if (price === null) return null;
      const hit = cheapestLayerOf(h.roomTypes, stay, price);
      if (!hit) throw new Error(`${h.name}: harga termurah ${price} tidak ada di sub-baris tipe kamar`);

      const isOwn = h.role === "sanghyang";
      // Penawaran OTA tanpa keterangan sarapan: ditandai dan disertai penawaran kamar yang sama yang menyebut sarapan.
      const unstated = hit.layer === "ota" && hit.breakfast === null;
      const offers = unstated ? hit.room.otaLowest?.breakfastOffers[stay] ?? null : null;
      const diffAmount = !isOwn && ownPrice !== null ? price - ownPrice : null;
      const diffPercent =
        !isOwn && ownPrice !== null && ownPrice > 0
          ? Number((((price - ownPrice) / ownPrice) * 100).toFixed(1))
          : null;
      const diffLabel = isOwn
        ? "Acuan (Sanghyang)"
        : diffAmount !== null && diffPercent !== null
          ? diffAmount === 0
            ? "Setara Sanghyang (0%)"
            : `${diffAmount > 0 ? "+" : "-"}${rupiah(Math.abs(diffAmount))} (${diffPercent > 0 ? "+" : ""}${diffPercent.toLocaleString("id-ID")}%)`
          : MATRIX_NO_DATA;

      return {
        stay,
        stayLabel,
        role: isOwn ? "sanghyang" : "kompetitor",
        hotelId: h.placeId ?? h.competitorId,
        competitorId: h.competitorId,
        hotelName: h.name,
        starLabel: h.starLabel,
        roomTypeName: hit.room.name,
        areaLabel: hit.room.areaLabel,
        breakfastIncluded: hit.breakfast,
        breakfastLabel: unstated ? "Tidak disebutkan" : breakfastStatusOf(hit.breakfast),
        breakfastOffers: offers && (offers.withBreakfast || offers.withoutBreakfast) ? offers : null,
        price,
        priceLabel: rupiah(price),
        otaName: hit.sourceName,
        otaUrl: hit.sourceUrl,
        checkIn: hit.checkIn,
        diffAmount,
        diffPercent,
        diffLabel,
        rank,
      };
    };

    const ownPrice = own ? (stay === "weekday" ? own.otaRateWeekdayMin : own.otaRateWeekendMin) : null;
    const sanghyangRow = own ? toRow(own, ownPrice, 0) : null;

    const competitorCandidates = hotelEntries
      .filter((h) => h.role === "inti")
      .map((h) => ({ h, p: stay === "weekday" ? h.otaRateWeekdayMin : h.otaRateWeekendMin }))
      .filter((x): x is { h: HotelMatrixEntry; p: number } => typeof x.p === "number" && Number.isFinite(x.p) && x.p > 0)
      .sort((a, b) => a.p - b.p);

    const competitors: CheapestRateComparisonRow[] = competitorCandidates
      .map((x, i) => toRow(x.h, ownPrice, i + 1))
      .filter((r): r is CheapestRateComparisonRow => r !== null);

    return {
      sanghyang: sanghyangRow,
      cheapestCompetitor: competitors[0] ?? null,
      competitors,
    };
  };

  const weekday = buildForStay("weekday");
  const weekend = buildForStay("weekend");

  // Tabel ringkas memuat Sanghyang vs 3 kompetitor termurah pada Hari Biasa dan Akhir Pekan.
  const rows: CheapestRateComparisonRow[] = [
    ...(weekday.sanghyang ? [weekday.sanghyang] : []),
    ...weekday.competitors.slice(0, 3),
    ...(weekend.sanghyang ? [weekend.sanghyang] : []),
    ...weekend.competitors.slice(0, 3),
  ];

  return {
    title: "Perbandingan Tarif Kamar Termurah: Hari Biasa (Weekday) & Akhir Pekan (Weekend)",
    subtitle:
      "Tarif terendah Sanghyang dan tiga kompetitor termurah per jenis hari (per malam, termasuk pajak dan biaya), diambil dari sub-baris tabel di atas beserta tipe kamar, status sarapan, dan tautan sumbernya. Bila penawaran termurah tidak menyebut sarapan, harga kamar yang sama dengan dan tanpa sarapan tampil di bawahnya.",
    rows,
    weekday,
    weekend,
  };
}

function resolveSpecsForPlace(
  specsMap: Map<string, PlaceSpecs>,
  placeId: string | null,
  competitorId: string,
  name: string,
): PlaceSpecs | null {
  if (placeId && specsMap.has(placeId)) return specsMap.get(placeId)!;
  for (const sp of specsMap.values()) {
    if (sp.competitorId === competitorId || sp.name === name) return sp;
  }
  return null;
}

function resolveRoomProfileForPlace(
  roomTypesMap: Map<string, HotelRoomTypesProfile>,
  placeId: string | null,
  name: string,
): HotelRoomTypesProfile | null {
  if (placeId && roomTypesMap.has(placeId)) return roomTypesMap.get(placeId)!;
  const lower = name.trim().toLowerCase();
  for (const p of roomTypesMap.values()) {
    if (p.name.trim().toLowerCase() === lower) return p;
  }
  return getHotelRoomTypes(placeId ?? name);
}

function toFnbItems(items: CompetitorMenuItem[]): FnbItem[] {
  return items.map((i) => ({
    name: i.name,
    category: i.category,
    price: i.price,
    priceMax: i.priceMax,
    unit: i.unit,
    group: menuGroup(i),
    excluded: menuExclusion(i),
  }));
}

function buildFacilitiesSummaryForFnb(
  specs: PlaceSpecs | null,
  parentName: string | null,
  category: string | null,
): string {
  const bits: string[] = [];
  if (parentName) bits.push(`Di dalam ${parentName}`);
  else if (category) bits.push(`${category.charAt(0).toUpperCase()}${category.slice(1)} mandiri`);

  const ambience = specs?.visual?.ambience ?? specs?.facilities.designStyle ?? specs?.facilities.usp ?? null;
  if (ambience) {
    const short = clean(ambience).split(/[.;]/)[0].trim();
    if (short) bits.push(short.length <= 75 ? short : `${short.slice(0, 72).replace(/\s+\S*$/, "")}…`);
  }
  if (specs?.facilities.hotSpring) bits.push("Air panas alami Aquamedic");
  return bits.length ? bits.join(" · ") : MATRIX_NO_DATA;
}

interface MenuRangeItems {
  counted: CompetitorMenuItem[];
  excluded: CompetitorMenuItem[];
  cheapest: CompetitorMenuItem | null;
  priciest: CompetitorMenuItem | null;
}

/** Item ujung kisaran memakai aturan yang sama dengan `menuPriceRange`, jadi angka kisaran selalu bisa ditelusuri. */
function menuRangeItems(items: CompetitorMenuItem[]): MenuRangeItems {
  const top = (i: CompetitorMenuItem) => i.priceMax ?? i.price;
  const counted = items.filter(isCountedMenuItem).sort((a, b) => a.price - b.price || top(a) - top(b));
  const excluded = items.filter((i) => !isCountedMenuItem(i));
  const priciest = counted.reduce<CompetitorMenuItem | null>((best, i) => (best === null || top(i) > top(best) ? i : best), null);
  return { counted, excluded, cheapest: counted[0] ?? null, priciest };
}

/**
 * Jumlah item paket beberapa orang dan sewa ruang menurut labelnya, misalnya "3 paket 2 orang" atau "10 sewa ruang per
 * jam". PDF tidak punya dialog rincian, jadi keberadaan item di luar kisaran disebut di sel rinciannya.
 */
function outsideRangeNote(items: CompetitorMenuItem[]): string {
  const counts = new Map<string, number>();
  for (const i of items) {
    const label = servingLabel(i);
    if (!label) continue;
    const key = i.unit ? `${label} ${i.unit}` : label;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([label, n]) => `${fmtNum(n)} ${label}`).join(", ");
}

function formatMenuDetailLabel(items: CompetitorMenuItem[], checked: string[], maxSample = 4): string {
  const { counted, cheapest, priciest } = menuRangeItems(items);
  if (cheapest && priciest) {
    const ends =
      cheapest === priciest
        ? `Satu item: ${clean(cheapest.name)} (${itemPriceText(cheapest)})`
        : `Termurah: ${clean(cheapest.name)} (${itemPriceText(cheapest)}); termahal: ${clean(priciest.name)} (${itemPriceText(priciest)})`;
    const outside = outsideRangeNote(items);
    return `${ends}; dari ${fmtNum(counted.length)} item per porsi${outside ? `; di luar kisaran: ${outside}` : ""}`;
  }
  const sample = sampleItems(items, maxSample);
  if (sample.length > 0) {
    const listed = sample.map((m) => `${clean(m.name)} (${itemPriceText(m)})`).join("; ");
    const remaining = items.filter((i) => !isAddon(i)).length - sample.length;
    return remaining > 0 ? `${listed} (+${fmtNum(remaining)} item)` : listed;
  }
  if (checked.length > 0) {
    return `${MATRIX_NO_DATA} (dicek: ${clean(checked[0])})`;
  }
  return MATRIX_NO_DATA;
}

/**
 * Membangun matriks pembanding terpadu untuk seluruh 6 outlet Sanghyang (atau subset `options.outlets`).
 */
export async function buildOutletCompetitorMatrices(
  options: BuildOutletCompetitorMatricesOptions = {},
): Promise<Record<OutletKey, OutletCompetitorMatrix>> {
  const targetKeys: OutletKey[] = options.outlets?.length ? options.outlets : [...OUTLET_KEYS];

  const [marketSize, roomTypesMap, specsMap, dynamicMenusMap] = await Promise.all([
    options.marketSize ? Promise.resolve(options.marketSize) : loadResortMarketSize(),
    options.roomTypesMap ? Promise.resolve(options.roomTypesMap) : loadDynamicHotelRoomTypes(),
    options.specsMap ? Promise.resolve(options.specsMap) : loadPlaceSpecsMap(),
    options.dynamicMenusMap ? Promise.resolve(options.dynamicMenusMap) : loadDynamicCompetitorMenuItems(),
  ]);

  const compsetAudit =
    options.compsetAudit ??
    (await loadCompsetAudit(marketSize, { roomTypesMap, specsMap, dynamicMenusMap }));

  const ownNameByOutlet = new Map(OWN_OUTLETS.map((o) => [o.outletKey, o.competitorName]));
  const neededNames = new Set<string>(
    targetKeys.flatMap((k) => [ownNameByOutlet.get(k) ?? "", ...(compsetAudit[k]?.used.map((c) => c.name) ?? [])]).filter(Boolean),
  );

  const registry = await db.competitor.findMany({
    where: { name: { in: [...neededNames] } },
    select: {
      id: true,
      name: true,
      placeId: true,
      category: true,
      starRating: true,
      roomCount: true,
      roadKm: true,
      driveMinutes: true,
      distanceSource: true,
      rating: true,
      reviewCount: true,
      websiteUrl: true,
      ratesUrl: true,
      googleMapsUrl: true,
      mapsUrl: true,
      compsetRole: true,
      parent: { select: { name: true } },
    },
  });
  const byName = new Map(registry.map((r) => [r.name, r]));

  // Muat snapshot harga resort (CompetitorPriceSnapshot + SanghyangPriceSnapshot) bila 'resort' diminta
  const snapshotsByComp = new Map<string, MatrixPriceSnapshot[]>();
  const allObservedDates: Date[] = [];
  let rawResortSnaps: MatrixPriceSnapshot[] = [];

  if (targetKeys.includes("resort")) {
    const resortOwnName = ownNameByOutlet.get("resort") ?? "";
    const resortOwnId = byName.get(resortOwnName)?.id ?? null;
    const resortNames = [
      resortOwnName,
      ...(compsetAudit.resort?.used.map((c) => c.name) ?? []),
    ].filter(Boolean);
    const resortIds = resortNames.map((n) => byName.get(n)?.id).filter((id): id is string => Boolean(id));

    const dateFilter =
      options.from || options.to
        ? {
            observedAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            },
          }
        : {};

    const [compSnaps, sanghyangSnaps] = await Promise.all([
      options.priceSnapshots
        ? Promise.resolve(options.priceSnapshots)
        : resortIds.length > 0
          ? db.competitorPriceSnapshot.findMany({
              where: {
                competitorId: { in: resortIds },
                ...dateFilter,
                ...COMPARABLE_RATE_WHERE,
              },
              select: {
                competitorId: true,
                roomName: true,
                packageName: true,
                price: true,
                checkIn: true,
                source: true,
                sourceUrl: true,
                observedAt: true,
              },
              orderBy: { observedAt: "desc" },
            })
          : Promise.resolve([] as MatrixPriceSnapshot[]),
      resortOwnId
        ? db.sanghyangPriceSnapshot.findMany({
            where: { ...dateFilter, ...COMPARABLE_RATE_WHERE },
            select: {
              roomName: true,
              packageName: true,
              price: true,
              checkIn: true,
              source: true,
              sourceUrl: true,
              observedAt: true,
            },
            orderBy: { observedAt: "desc" },
            take: 60,
          })
        : Promise.resolve([]),
    ]);

    // Tarif properti paket lama (dasar harga tidak diketahui, rate-basis.ts) tidak dipakai, juga dari snapshot pemanggil.
    const combinedRawSnaps: MatrixPriceSnapshot[] = [
      ...compSnaps.filter(isComparableRate),
      ...(resortOwnId
        ? sanghyangSnaps.map((s) => ({
            competitorId: resortOwnId,
            roomName: s.roomName,
            packageName: s.packageName,
            price: s.price,
            checkIn: s.checkIn,
            source: s.source,
            sourceUrl: s.sourceUrl,
            observedAt: s.observedAt,
          }))
        : []),
    ];

    for (const s of combinedRawSnaps) {
      if (s.observedAt instanceof Date && Number.isFinite(s.observedAt.getTime())) {
        allObservedDates.push(s.observedAt);
      }
    }
    rawResortSnaps = combinedRawSnaps;
  }

  const out = {} as Record<OutletKey, OutletCompetitorMatrix>;
  // Jendela diturunkan dari data yang dipakai: crawl 14 malam terakhir yang sudah ada saat akhir periode, atau pantauan
  // harian DB di periode itu. Tarif yang check-in-nya di luar jendela tidak ikut, supaya catatan dan angka selalu cocok.
  const rateWindow = resolveRateWindow({
    snapshotObservedDates: allObservedDates,
    periodFrom: options.from,
    periodTo: options.to,
  });
  const inWindow = (iso: string) => iso >= rateWindow.firstCheckIn && iso <= rateWindow.lastCheckIn;
  const usesCrawlEvidence = rateWindow.basis === "crawl";
  const usedObservedDates: string[] = usesCrawlEvidence && rateWindow.crawlDate ? [rateWindow.crawlDate] : [];
  for (const s of rawResortSnaps) {
    const ci = (s.checkIn ?? s.observedAt).toISOString().slice(0, 10);
    if (!inWindow(ci)) continue;
    if (options.to && s.observedAt.getTime() > options.to.getTime()) continue;
    if (options.from && s.observedAt.getTime() < options.from.getTime()) continue;
    const observedDay = isoDateWib(s.observedAt);
    if (usesCrawlEvidence && rateWindow.crawlDate && observedDay < rateWindow.crawlDate) continue;
    usedObservedDates.push(observedDay);
    snapshotsByComp.set(s.competitorId, [...(snapshotsByComp.get(s.competitorId) ?? []), s]);
  }
  const latestObservedAt = usedObservedDates.length ? usedObservedDates.reduce((a, b) => (a > b ? a : b)) : null;
  const windowNote = resolvedRateWindowNote(rateWindow, latestObservedAt);
  const officialObservedLimit = options.to ? isoDateWib(options.to) : null;
  const evidenceCheckIn = { weekday: RESORT_ROOM_RATE_SOURCE.checkInWeekday, weekend: RESORT_ROOM_RATE_SOURCE.checkInWeekend };
  const officialSource = officialRoomRatesSource();
  const ownOfficialUnavailableReason = officialSource.status === "terbaca" ? null : clean(officialSource.reason) || null;

  for (const key of targetKeys) {
    const ownName = ownNameByOutlet.get(key) ?? "";
    const usedList = compsetAudit[key]?.used ?? [];
    const hasReference = usedList.some((c) => c.compsetRole === "benchmark");
    const baseRuleNote = hasReference ? `${RULE_NOTE} Acuan tampil, tetapi tidak dihitung.` : RULE_NOTE;

    if (key === "resort") {
      const orderedNames: { name: string; role: "sanghyang" | "inti" | "acuan" }[] = [
        ...(ownName ? [{ name: ownName, role: "sanghyang" as const }] : []),
        ...usedList.map((c) => ({
          name: c.name,
          role: (c.compsetRole === "benchmark" ? "acuan" : "inti") as "inti" | "acuan",
        })),
      ];

      const ownRow = byName.get(ownName);
      const ownSpecs = ownRow ? resolveSpecsForPlace(specsMap, ownRow.placeId, ownRow.id, ownName) : null;
      const ownRoomProfile = resolveRoomProfileForPlace(roomTypesMap, ownRow?.placeId ?? "sanghyang", ownName);
      const ownMarketRow = marketSize.rows.find((r) => r.hotelId === "sanghyang");

      const hotelEntries: HotelMatrixEntry[] = [];
      for (const item of orderedNames) {
        const reg = byName.get(item.name);
        if (!reg) continue;
        const specs = resolveSpecsForPlace(specsMap, reg.placeId, reg.id, reg.name);
        const roomProfile = resolveRoomProfileForPlace(roomTypesMap, reg.placeId, reg.name);
        const marketRow = reg.placeId ? marketSize.rows.find((r) => r.hotelId === reg.placeId) : undefined;
        const compsetStatic = reg.placeId ? COMPSET_HOTELS.find((h) => h.hotelId === reg.placeId) : undefined;
        const auditItem = usedList.find((c) => c.name === reg.name);

        const staticLowest =
          usesCrawlEvidence && reg.placeId
            ? RESORT_LOWEST_BY_HOTEL_ALL.find((h) => h.hotelId === reg.placeId)
            : undefined;
        const staticRange = staticLowest
          ? clipRangeToWindow(hotelRateRange(staticLowest, evidenceCheckIn), inWindow)
          : null;
        const hotelSnaps = snapshotsByComp.get(reg.id) ?? [];
        const snapRange = buildRateRangeFromSnapshots(hotelSnaps);
        const mergedPropertyRange = mergeRateRanges(staticRange, snapRange);

        const hotelEvidence =
          usesCrawlEvidence && reg.placeId ? RESORT_RATE_EVIDENCE_ALL.filter((e) => e.hotelId === reg.placeId) : [];
        const entityBaseUrl =
          reg.ratesUrl ??
          googleTravelEntityUrlFromMaps(reg.googleMapsUrl ?? reg.mapsUrl ?? compsetStatic?.mapsUrl ?? null);

        const roomTypes = buildHotelRoomSubRows({
          roomTypes: roomProfile?.roomTypes ?? [],
          evidence: hotelEvidence,
          evidenceCheckIn,
          snapshots: hotelSnaps,
          propertyRange: mergedPropertyRange,
          officialObservedLimit,
          // Tarif engine bertanggal: Exely untuk Sanghyang, be.dip.id untuk kompetitor yang engine-nya bisa dibaca.
          officialRates: reg.placeId ? [...officialRoomRatesFor(reg.placeId), ...competitorOfficialRoomRatesFor(reg.placeId)] : [],
          // Pemuat tarif resmi membaca booking engine Sanghyang; alasannya hanya berlaku untuk baris Sanghyang.
          officialUnavailableReason: item.role === "sanghyang" ? ownOfficialUnavailableReason : null,
          crawlDate: usesCrawlEvidence ? rateWindow.crawlDate : null,
          ratesObservedAt: latestObservedAt,
          windowFirstCheckIn: rateWindow.firstCheckIn,
          windowLastCheckIn: rateWindow.lastCheckIn,
          entityBaseUrl,
          websiteUrl: reg.websiteUrl,
          mapsUrl: reg.googleMapsUrl ?? reg.mapsUrl,
        });

        // Rentang ringkasan = harga terendah dan tertinggi yang dihitung di sub-baris (baris situs resmi dan baris OTA).
        // Harga situs resmi dari malam lain tetap tercetak di sub-barisnya dengan tanggal dan tanda "tidak dihitung", tetapi
        // tidak ikut rentang: rentang dan harga termurah tidak boleh mencampur dua malam untuk lapisan yang dijanjikan
        // sebanding, dan setiap angka rentang tetap bisa ditelusuri ke sub-baris yang dihitung (C12).
        // Tanpa harga di sub-baris, ringkasan "Belum ada data"; tidak ada angka ringkasan yang tidak bisa ditelusuri.
        const wdShown = shownRoomPrices(roomTypes, "weekday");
        const weShown = shownRoomPrices(roomTypes, "weekend");
        const otaRateWeekdayMin = wdShown.length ? Math.min(...wdShown) : null;
        const otaRateWeekdayMax = wdShown.length ? Math.max(...wdShown) : null;
        const otaRateWeekendMin = weShown.length ? Math.min(...weShown) : null;
        const otaRateWeekendMax = weShown.length ? Math.max(...weShown) : null;
        const otaRateLabel = formatMinMaxPair(otaRateWeekdayMin, otaRateWeekdayMax, otaRateWeekendMin, otaRateWeekendMax);

        const wdMinHit = otaRateWeekdayMin !== null ? cheapestLayerOf(roomTypes, "weekday", otaRateWeekdayMin) : null;
        const weMinHit = otaRateWeekendMin !== null ? cheapestLayerOf(roomTypes, "weekend", otaRateWeekendMin) : null;
        const dated = (price: number | null, hit: CheapestLayerHit | null): DatedRate => ({
          price,
          checkIn: hit?.checkIn ?? null,
          source: hit?.sourceName ?? null,
        });
        const datedMax = (price: number | null, stay: "weekday" | "weekend"): DatedRate =>
          dated(price, price !== null ? cheapestLayerOf(roomTypes, stay, price) : null);
        const consistentRange: HotelRateRange | null =
          otaRateWeekdayMin !== null || otaRateWeekendMin !== null
            ? {
                weekday: { nights: wdShown.length, min: dated(otaRateWeekdayMin, wdMinHit), max: datedMax(otaRateWeekdayMax, "weekday") },
                weekend: { nights: weShown.length, min: dated(otaRateWeekendMin, weMinHit), max: datedMax(otaRateWeekendMax, "weekend") },
              }
            : null;

        const rating = reg.rating != null ? Number(reg.rating.toString()) : null;
        const roomCount = reg.roomCount ?? specs?.roomCount ?? compsetStatic?.roomCount ?? null;
        const photosCount = reg.placeId
          ? galleryPhotosOf(reg.placeId).filter(isShownPhoto).length || (specs?.visual?.photoUrls.length ?? 0)
          : (specs?.visual?.photoUrls.length ?? 0);

        const auditRationale =
          item.role === "sanghyang"
            ? clean(
                sanghyangAuditSummary({
                  outlet: "resort",
                  ownAdr: ownMarketRow?.adr ?? null,
                  ownRoomCount: roomCount,
                  ownRating: rating,
                  ownReviewCount: reg.reviewCount,
                  ownSpecs,
                  ownRoomTypes: ownRoomProfile,
                }),
              )
            : clean(auditItem?.auditRationale) || MATRIX_NO_DATA;

        const propertyLowestRoom = roomTypes.find((rt) => rt.otaLowest?.isPropertyLowestRate);
        const rateConsistencyNote = propertyLowestRoom
          ? `Tarif termurah properti di jendela dipasang pada ${propertyLowestRoom.name} karena OTA tidak menyebut nama kamarnya.`
          : null;

        hotelEntries.push({
          no: hotelEntries.length + 1,
          competitorId: reg.id,
          placeId: reg.placeId,
          name: reg.name,
          role: item.role,
          starRating: reg.starRating,
          starLabel: reg.starRating ? `Bintang ${reg.starRating}` : MATRIX_NO_DATA,
          roadKm: reg.roadKm,
          driveMinutes: drivingMinutesFor(reg.distanceSource, reg.driveMinutes),
          distanceLabel: formatDistanceLabel(reg.roadKm, reg.driveMinutes, reg.distanceSource, item.role),
          distanceSource: clean(reg.distanceSource) || null,
          roomCount,
          roomCountLabel: roomCount ? String(roomCount) : MATRIX_NO_DATA,
          areaSummaryLabel: areaSummaryFromRooms(roomTypes, specs),
          hasMultiBedroomUnit: roomTypes.some((rt) => (rt.bedrooms ?? 0) >= 2) || (roomProfile?.hasMultiBedroomUnit ?? false),
          multiBedroomNote: clean(roomProfile?.multiBedroomNote) || null,
          otaRateWeekdayMin,
          otaRateWeekendMin,
          otaRateWeekdayMax,
          otaRateWeekendMax,
          otaRateLabel,
          otaRateMinText: consistentRange ? rangeCellText(consistentRange, "min") : MATRIX_NO_DATA,
          otaRateMaxText: consistentRange ? rangeCellText(consistentRange, "max") : MATRIX_NO_DATA,
          cheapestWeekdayOtaName: wdMinHit?.sourceName ?? null,
          cheapestWeekdayOtaUrl: wdMinHit?.sourceUrl ?? null,
          cheapestWeekendOtaName: weMinHit?.sourceName ?? null,
          cheapestWeekendOtaUrl: weMinHit?.sourceUrl ?? null,
          breakfastSummaryLabel: summarizeHotelBreakfast(roomTypes),
          rateConsistencyNote,
          priceVsSanghyang: marketRow?.priceVsSanghyang ?? null,
          rating,
          reviewCount: reg.reviewCount,
          ratingLabel: rating !== null ? `${fmtNum(rating)} (${reg.reviewCount ? fmtNum(reg.reviewCount) : "?"})` : MATRIX_NO_DATA,
          smartTv: specs?.facilities.smartTv ?? null,
          smartTvLabel: formatHotelSmartTv(specs?.facilities.smartTv, roomProfile?.roomTypes),
          bathtub: specs?.facilities.bathtub ?? null,
          bathtubLabel: formatBathtub(specs?.facilities.bathtub, roomProfile?.roomTypes),
          poolLabel: formatPoolLabel(specs),
          designStyleLabel: formatDesignLabel(specs),
          auditRationale,
          roomTypes,
          facilityNarrative: buildHotelFacilityNarrative({
            roomCount,
            roomCountSource: compsetStatic?.roomCountSource ?? null,
            roomTypes,
            specs,
          }),
          specs,
          photosCount,
          mapsUrl: reg.googleMapsUrl ?? reg.mapsUrl,
          websiteUrl: reg.websiteUrl,
        });
      }

      const cheapestComparison = buildCheapestRateComparison(hotelEntries);
      const otherNightNote = officialOtherNightNote(hotelEntries);

      out[key] = {
        outletKey: key,
        outletName: outletLabel(key),
        kind: "resort",
        columns: [...RESORT_MATRIX_COLUMNS],
        note: `${baseRuleNote} Tarif: ${windowNote}${otherNightNote ? ` ${otherNightNote}` : ""}`,
        ratesWindowNote: windowNote,
        ratesCheckedAt: latestObservedAt ?? rateWindow.observedAt,
        rateWindow,
        cheapestComparison,
        hotelEntries,
      };
      continue;
    }

    // 5 outlet F&B / Bar / Spa
    const ownMenuRaw = officialMenu(key);
    const ownFnbList = officialFnbItems(ownMenuRaw);
    const ownItemsAsCompetitor: CompetitorMenuItem[] = (ownMenuRaw?.items ?? []).map((i) => ({
      name: i.name,
      category: i.category,
      price: i.price,
      priceMax: null,
      unit: i.unit === "porsi" ? null : i.unit,
    }));

    const rivalMergedMenus = new Map<string, ReturnType<typeof mergeCompetitorMenu>>();
    for (const u of usedList) {
      const reg = byName.get(u.name);
      const dynRec =
        (reg?.id ? dynamicMenusMap.get(reg.id) : undefined) ??
        Array.from(dynamicMenusMap.values()).find((r) => r.competitorName === u.name);
      rivalMergedMenus.set(u.name, mergeCompetitorMenu(u.name, dynRec));
    }

    const comparisons =
      ownFnbList.length > 0
        ? compareItems(
            ownFnbList,
            usedList.map((u) => ({
              name: u.name,
              core: u.compsetRole !== "benchmark",
              items: toFnbItems(rivalMergedMenus.get(u.name)?.items ?? []),
            })),
          )
        : [];

    const itemComparisons: OutletItemComparisonRow[] = comparisons.map((c) => ({
      itemName: c.item.name,
      category: c.item.category,
      sanghyangPrice: c.item.price,
      unit: c.item.unit,
      averageCompetitorPrice: c.average,
      averageGapPercent: c.averageGapPercent,
      matches: c.matches.map((m) => ({
        rival: m.rival,
        core: m.core,
        items: m.items,
        price: m.price,
        gapPercent: m.gapPercent,
        generic: m.generic,
      })),
    }));

    const fnbEntries: FnbMatrixEntry[] = [];

    // Baris 1: Sanghyang
    const ownReg = byName.get(ownName);
    if (ownReg) {
      const ownSpecs = resolveSpecsForPlace(specsMap, ownReg.placeId, ownReg.id, ownReg.name);
      const ownRating = ownReg.rating != null ? Number(ownReg.rating.toString()) : null;
      const ownRange = menuPriceRange(ownItemsAsCompetitor);
      const ownRangeItems = menuRangeItems(ownItemsAsCompetitor);
      const ownPhotosCount = ownReg.placeId
        ? galleryPhotosOf(ownReg.placeId).filter(isShownPhoto).length || (ownSpecs?.visual?.photoUrls.length ?? 0)
        : (ownSpecs?.visual?.photoUrls.length ?? 0);

      fnbEntries.push({
        no: 1,
        competitorId: ownReg.id,
        placeId: ownReg.placeId,
        name: ownReg.name,
        role: "sanghyang",
        category: ownReg.category,
        parentName: "Sanghyang Indah Spa Resort",
        roadKm: 0,
        driveMinutes: 0,
        distanceLabel: "Titik awal",
        distanceSource: null,
        rating: ownRating,
        reviewCount: ownReg.reviewCount,
        ratingLabel: ownRating !== null ? `${fmtNum(ownRating)} (${ownReg.reviewCount ? fmtNum(ownReg.reviewCount) : "?"})` : MATRIX_NO_DATA,
        menuPriceRange: ownRange,
        perPersonRange: null,
        menuRangeLabel: ownRange ? rupiahRange(ownRange.min, ownRange.max) : MATRIX_NO_DATA,
        menuItemCount: ownItemsAsCompetitor.length,
        menuDetailLabel: formatMenuDetailLabel(ownItemsAsCompetitor, [], 5),
        rangeCheapest: ownRangeItems.cheapest,
        rangePriciest: ownRangeItems.priciest,
        countedItems: ownRangeItems.counted,
        excludedItems: ownRangeItems.excluded,
        sampleMenuItems: sampleItems(ownItemsAsCompetitor, 8),
        menuSources: ownMenuRaw ? [{ label: `${OFFICIAL_MENU_SOURCE.title} (${OFFICIAL_MENU_SOURCE.capturedAt})`, url: ownMenuRaw.sourceUrl }] : [],
        menuChecked: [],
        comparableGap: null,
        comparableItems: [],
        facilitiesLabel: buildFacilitiesSummaryForFnb(ownSpecs, "Sanghyang Indah Spa Resort", ownReg.category),
        auditRationale: clean(
          sanghyangAuditSummary({
            outlet: key,
            ownRating,
            ownReviewCount: ownReg.reviewCount,
            ownSpecs,
            ownMenuItemCount: ownItemsAsCompetitor.length,
            ownMenuRange: ownRange,
          }),
        ),
        specs: ownSpecs,
        photosCount: ownPhotosCount,
        mapsUrl: ownReg.googleMapsUrl ?? ownReg.mapsUrl,
        websiteUrl: ownReg.websiteUrl,
      });
    }

    // Baris 2..N: Kompetitor aktif
    for (const u of usedList) {
      const reg = byName.get(u.name);
      if (!reg) continue;
      const specs = resolveSpecsForPlace(specsMap, reg.placeId, reg.id, reg.name);
      const merged = rivalMergedMenus.get(u.name) ?? null;
      const items = merged?.items ?? [];
      const range = menuPriceRange(items);
      const rangeItems = menuRangeItems(items);
      const perPerson = merged?.perPerson ?? null;
      const rating = reg.rating != null ? Number(reg.rating.toString()) : null;
      const role = u.compsetRole === "benchmark" ? "acuan" : "inti";

      const menuRangeLabel = range
        ? rupiahRange(range.min, range.max)
        : perPerson
          ? `${perPersonText(perPerson)} (Google Maps)`
          : items.length > 0
            ? itemPriceText(items[0])
            : MATRIX_NO_DATA;

      const compItems: ComparableMenuItemEntry[] = comparisons.flatMap((c) => {
        const hit = c.matches.find((m) => m.rival === reg.name);
        if (!hit) return [];
        return [
          {
            ownItemName: c.item.name,
            ownPrice: c.item.price,
            ownUnit: c.item.unit,
            competitorItems: hit.items,
            competitorPrice: hit.price,
            gapPercent: hit.gapPercent,
            generic: hit.generic,
          },
        ];
      });

      const photosCount = reg.placeId
        ? galleryPhotosOf(reg.placeId).filter(isShownPhoto).length || (specs?.visual?.photoUrls.length ?? 0)
        : (specs?.visual?.photoUrls.length ?? 0);

      fnbEntries.push({
        no: fnbEntries.length + 1,
        competitorId: reg.id,
        placeId: reg.placeId,
        name: reg.name,
        role,
        category: reg.category,
        parentName: reg.parent?.name ?? null,
        roadKm: reg.roadKm,
        driveMinutes: drivingMinutesFor(reg.distanceSource, reg.driveMinutes),
        distanceLabel: formatDistanceLabel(reg.roadKm, reg.driveMinutes, reg.distanceSource, role),
        distanceSource: clean(reg.distanceSource) || null,
        rating,
        reviewCount: reg.reviewCount,
        ratingLabel: rating !== null ? `${fmtNum(rating)} (${reg.reviewCount ? fmtNum(reg.reviewCount) : "?"})` : MATRIX_NO_DATA,
        menuPriceRange: range,
        perPersonRange: perPerson,
        menuRangeLabel,
        menuItemCount: items.filter((i) => !isAddon(i)).length,
        menuDetailLabel: formatMenuDetailLabel(items, merged?.checked ?? [], 4),
        rangeCheapest: rangeItems.cheapest,
        rangePriciest: rangeItems.priciest,
        countedItems: rangeItems.counted,
        excludedItems: rangeItems.excluded,
        sampleMenuItems: sampleItems(items, 8),
        menuSources: merged ? pricedSources(merged).map((s) => ({ label: clean(s.label), url: s.url })) : [],
        menuChecked: (merged?.checked ?? []).map(clean),
        comparableGap: comparisons.length > 0 ? rivalGap(comparisons, reg.name, "all") : null,
        comparableItems: compItems,
        facilitiesLabel: buildFacilitiesSummaryForFnb(specs, reg.parent?.name ?? null, reg.category),
        auditRationale: clean(u.auditRationale) || MATRIX_NO_DATA,
        specs,
        photosCount,
        mapsUrl: reg.googleMapsUrl ?? reg.mapsUrl,
        websiteUrl: reg.websiteUrl,
      });
    }

    out[key] = {
      outletKey: key,
      outletName: outletLabel(key),
      kind: "fnb",
      columns: [...FNB_MATRIX_COLUMNS],
      note: baseRuleNote,
      fnbEntries,
      itemComparisons,
    };
  }

  return out;
}
