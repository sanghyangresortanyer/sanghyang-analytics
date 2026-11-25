/**
 * Audit pembanding per outlet dari daftar kompetitor (tabel Competitor): siapa yang dipakai (inti dihitung, acuan hanya
 * ditampilkan) dan siapa yang dikeluarkan beserta alasannya. Dipakai bagian "Hasil audit & validasi pembanding" di
 * Langkah Harga, halaman Metodologi, matriks kompetitor, dan laporan PDF. Aturan kelayakan ada di compset.ts dan
 * pembobotan holistik 6 dimensi ada di competitor-holistic-matcher.ts.
 *
 * Berkas ini juga memegang satu-satunya pemuat data penilaian holistik (`loadHolisticRegistry`): langkah refresh,
 * skrip audit, dan skor yang tampil di web memakai masukan yang sama, jadi angka di layar sama dengan dasar klasifikasi.
 */
import { db } from "../db";
import { MIN_LODGING_STARS, isLodging, parseCompsetRole } from "./compset";
import {
  lodgingPriceSegment,
  reclassifyRegistry,
  scoreCompetitorHolistic,
  type HolisticCandidateInput,
  type HolisticReferenceContext,
  type HolisticRoomUnitSignal,
  type HolisticScoreResult,
  type RegistryCandidate,
  type RegistryDecision,
} from "./competitor-holistic-matcher";
import {
  competitorMenu,
  menuExclusion,
  type CompetitorMenu,
  type CompetitorMenuItem,
} from "./competitor-menu";
import { compsetRationale, type RationaleContext, type RationaleFact } from "./compset-rationale";
import { SANGHYANG_PLACE_ID } from "./competitor-repository";
import { getVisualInsight } from "./competitor-visual-insights";
import {
  compareItems,
  menuGroup,
  officialFnbItems,
  rivalGap,
  type FnbItem,
  type ItemComparison,
} from "./fnb-compare";
import { ROOM_SIZES } from "./hotel-compset";
import hotelCompsetData from "./hotel-compset.data.json";
import {
  getHotelRoomTypes,
  loadDynamicHotelRoomTypes,
  sanitizeAiModelText,
  type HotelRoomTypesProfile,
} from "./hotel-room-types";
import type { ResortMarketSize } from "./market-size";
import { officialMenu } from "./official-menu";
import { OUTLET_KEYS, OUTLET_PLACE_IDS, isOutletKey, type OutletKey } from "./outlet-filters";
import { OWN_OUTLETS } from "./outlet-ratings";
import { loadPlaceSpecsMap, summarizeFacilities, type PlaceSpecs } from "./place-specs";
import { auditStatusFromScore, type BenchmarkCompetitorItem } from "./pricing-rules";
import {
  loadDynamicCompetitorMenuItems,
  type DynamicCompetitorMenuRecord,
} from "./refresh-competitor-menus";
import resortRoomRates from "./resort-room-rates.data.json";
import { RESORT_ROOM_RATE_SOURCE } from "./resort-room-rates";

export interface ExcludedCompetitor {
  name: string;
  category: string | null;
  roadKm: number | null;
  starRating: number | null;
  reason: string;
}

export interface OutletCompsetAudit {
  used: BenchmarkCompetitorItem[];
  excluded: ExcludedCompetitor[];
}

type FactRow = { section?: string; key: string; value: unknown; observedAt: Date; sourceUrl?: string };

export type RegistryRow = {
  id?: string;
  name: string;
  category: string | null;
  outlets: string[];
  placeId: string | null;
  roadKm: number | null;
  driveMinutes: number | null;
  starRating: number | null;
  roomCount: number | null;
  rating: { toString(): string } | null;
  reviewCount: number | null;
  websiteUrl: string | null;
  googleMapsUrl: string | null;
  mapsUrl: string | null;
  distanceSource: string | null;
  compsetRole: string | null;
  active: boolean;
  retiredReason: string | null;
  notes?: string | null;
  address?: string | null;
  parentId?: string | null;
  /** Fakta situs resmi tempat ini (CompetitorFact). */
  facts: FactRow[];
  /** Hotel induk untuk outlet di dalam hotel kompetitor, beserta fakta situs resminya. */
  parent: { name: string; starRating: number | null; active?: boolean; compsetRole?: string | null; facts: FactRow[] } | null;
  /** Kategori outlet di dalam penginapan ini (resto, bar, spa). */
  venues?: { category: string | null }[];
};

/** Sanghyang sendiri, pembanding untuk kalimat alasan. */
export type OwnProperty = RationaleContext["own"];

export interface OwnOutletMeta {
  outletKey: OutletKey;
  competitorName: string;
  rating: number | null;
  reviewCount: number | null;
  specs: PlaceSpecs | null;
}

export interface CompsetAuditPreloaded {
  roomTypesMap?: Map<string, HotelRoomTypesProfile>;
  specsMap?: Map<string, PlaceSpecs>;
  dynamicMenusMap?: Map<string, DynamicCompetitorMenuRecord>;
}

const factText = (value: unknown) => String((value as { text?: unknown } | null)?.text ?? "");

const factsOf = (rows: FactRow[]): RationaleFact[] =>
  rows.map((f) => ({ key: f.key, text: factText(f.value), observedAt: f.observedAt }));

const MENU_STOP_WORDS = new Set(["the", "and", "for", "with", "per", "dan", "atau", "dari", "di", "by", "in", "of", "on", "to"]);
const COUPLE_PACKAGE_RE =
  /\b(couple|couples|per\s*pasangan|untuk\s*pasangan|pasangan|honeymoon(?:er)?|candle\s*light|candlelight|romantic\s*dinner|two\s*(?:people|persons|pax|guests?)|2\s*(?:pax|orang|people|persons|guests?)|for\s*(?:2|two)\b|untuk\s*(?:2|dua)\s*(?:orang|pax)?|berdua)\b/i;
const MULTI_PAX_RE = /\b(?:for|untuk|per|paket(?:\s+\p{L}+){0,2})?\s*(\d+)\s*(?:pax|orang|people|persons|guests?)\b/iu;
const SHARED_PACKAGE_RE =
  /\b(dining\s*package|couple\s*package|family\s*pack(?:age)?|group\s*pack(?:age)?|sharing\s*(?:package|set|platter|menu)|paket\s*(?:keluarga|rombongan|rame[\s-]*rame|berdua|bertiga|berempat|sharing|kongkow|grup|group))\b/i;

function normMenuName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function baseMenuName(name: string): string {
  return normMenuName(name.replace(/\s*\([^)]*\)\s*/g, " ")) || normMenuName(name);
}

function menuMeaningfulWords(name: string): string[] {
  return normMenuName(name)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !MENU_STOP_WORDS.has(w));
}

function normMenuKey(name: string, unit: string | null): string {
  return `${normMenuName(name)}|${unit ?? ""}`;
}

function findMatchingBaseItem(
  dyn: { name: string; price: number; unit: string | null },
  baseItems: CompetitorMenuItem[],
  usedBaseIndices: Set<number>,
): number {
  const dNorm = normMenuName(dyn.name);
  const dBase = baseMenuName(dyn.name);

  // 1. Kecocokan nama penuh dan satuan yang sama persis.
  for (let i = 0; i < baseItems.length; i++) {
    if (usedBaseIndices.has(i)) continue;
    if (normMenuName(baseItems[i].name) === dNorm && baseItems[i].unit === dyn.unit) return i;
  }

  // 2. Kecocokan nama dasar (menghapus catatan dalam tanda kurung) dengan satuan yang sama.
  // Bila ada beberapa varian durasi/ukuran, cocokkan dengan harga agar varian lain tidak hilang.
  const baseMatches: number[] = [];
  for (let i = 0; i < baseItems.length; i++) {
    if (usedBaseIndices.has(i)) continue;
    if (baseMenuName(baseItems[i].name) === dBase && baseItems[i].unit === dyn.unit) baseMatches.push(i);
  }
  if (baseMatches.length === 1) return baseMatches[0];
  if (baseMatches.length > 1) {
    const samePrice = baseMatches.find((i) => baseItems[i].price === dyn.price);
    if (samePrice !== undefined) return samePrice;
  }

  // 3. Kecocokan prefix nama dasar atau subset kata bermakna dengan harga yang sama
  // (mis. judul ringkas di situs resmi vs judul lengkap di berkas data).
  const dWords = menuMeaningfulWords(dyn.name);
  const subsetMatches: number[] = [];
  for (let i = 0; i < baseItems.length; i++) {
    if (usedBaseIndices.has(i)) continue;
    const b = baseItems[i];
    if (b.price !== dyn.price) continue;
    if (dyn.unit !== null && b.unit !== dyn.unit) continue;
    const bBase = baseMenuName(b.name);
    const prefixMatch =
      dBase.length >= 6 &&
      bBase.length >= 6 &&
      (bBase.startsWith(`${dBase} `) || dBase.startsWith(`${bBase} `));
    const bWords = new Set(menuMeaningfulWords(b.name));
    const bBaseWords = menuMeaningfulWords(bBase);
    const dWordSet = new Set(dWords);
    const subsetMatch =
      (dWords.length >= 2 && dWords.every((w) => bWords.has(w))) ||
      (bBaseWords.length >= 2 && bBaseWords.every((w) => dWordSet.has(w)));
    if (prefixMatch || subsetMatch) subsetMatches.push(i);
  }
  if (subsetMatches.length === 1) return subsetMatches[0];

  return -1;
}

function inferSharedPackage(item: {
  name: string;
  category: string | null;
  unit: string | null;
  quote?: string;
}): { kind: "paket-bersama"; pax?: number } | null {
  if (item.unit !== null) return null;
  const text = `${item.name} ${item.category ?? ""} ${item.quote ?? ""}`;
  if (COUPLE_PACKAGE_RE.test(text)) {
    return { kind: "paket-bersama", pax: 2 };
  }
  const paxMatch = text.match(MULTI_PAX_RE);
  if (paxMatch) {
    const pax = Number(paxMatch[1]);
    if (Number.isInteger(pax) && pax >= 2 && pax <= 50) {
      return { kind: "paket-bersama", pax };
    }
  }
  if (SHARED_PACKAGE_RE.test(text)) {
    return { kind: "paket-bersama" };
  }
  return null;
}

/**
 * Menggabungkan daftar menu dinamis dari `CompetitorFact` (hasil refresh/cron) dengan data dasar
 * `competitor-menu.data.json`. Data dinamis terbaru didahulukan bila nama dasar/satuan item cocok; penanda paket
 * beberapa orang atau sewa ruang yang sudah dicek di berkas data ikut dibawa dan item statis padanannya tidak
 * digandakan. Pola paket pasangan/grup umum pada item dinamis juga dideteksi agar tidak mencemari kisaran per porsi.
 */
export function mergeCompetitorMenu(
  name: string,
  dynamicRecord: DynamicCompetitorMenuRecord | null | undefined,
): CompetitorMenu | null {
  const base = competitorMenu(name);
  if (!dynamicRecord || dynamicRecord.items.length === 0) return base;

  const baseItems = base?.items ?? [];
  const mergedItems: CompetitorMenuItem[] = [];
  const seen = new Set<string>();
  const usedBaseIndices = new Set<number>();

  for (const item of dynamicRecord.items) {
    const baseIdx = findMatchingBaseItem(item, baseItems, usedBaseIndices);
    const matched = baseIdx >= 0 ? baseItems[baseIdx] : undefined;
    const resolvedUnit = item.unit ?? matched?.unit ?? null;
    const key = normMenuKey(item.name, resolvedUnit);
    if (seen.has(key)) continue;
    seen.add(key);
    if (baseIdx >= 0) usedBaseIndices.add(baseIdx);

    const inferred = inferSharedPackage({ ...item, unit: resolvedUnit });
    const kind = matched?.kind ?? inferred?.kind;
    const pax = matched?.pax ?? inferred?.pax;

    mergedItems.push({
      name: item.name,
      category: item.category,
      price: item.price,
      priceMax: item.priceMax,
      unit: resolvedUnit,
      ...(kind ? { kind } : {}),
      ...(pax ? { pax } : {}),
    });
  }

  for (let i = 0; i < baseItems.length; i++) {
    if (usedBaseIndices.has(i)) continue;
    const item = baseItems[i];
    const key = normMenuKey(item.name, item.unit);
    if (seen.has(key)) continue;
    seen.add(key);
    mergedItems.push(item);
  }

  const dynSource = {
    kind: "situs-resmi" as const,
    label: dynamicRecord.sourceLabel,
    url: dynamicRecord.sourceUrl,
    capturedAt: dynamicRecord.observedAt.slice(0, 10),
  };
  const baseSources = base?.sources ?? [];
  const sources = baseSources.some((s) => s.url === dynSource.url)
    ? baseSources
    : [dynSource, ...baseSources];

  return {
    items: mergedItems,
    sources,
    perPerson: base?.perPerson ?? null,
    checked: base?.checked ?? [],
    readBy: base?.readBy ?? null,
  };
}

function toFnbItems(menu: CompetitorMenu | null): FnbItem[] {
  if (!menu) return [];
  return menu.items.map((i) => ({
    name: i.name,
    category: i.category,
    price: i.price,
    priceMax: i.priceMax,
    unit: i.unit,
    group: menuGroup(i),
    excluded: menuExclusion(i),
  }));
}

function resolveSpecs(
  specsMap: Map<string, PlaceSpecs> | undefined,
  placeId: string | null,
  competitorId: string | undefined,
  name: string,
): PlaceSpecs | null {
  if (!specsMap) return null;
  if (placeId && specsMap.has(placeId)) return specsMap.get(placeId)!;
  for (const sp of specsMap.values()) {
    if ((competitorId && sp.competitorId === competitorId) || sp.name === name) return sp;
  }
  return null;
}

function resolveDynamicMenu(
  dynamicMenusMap: Map<string, DynamicCompetitorMenuRecord> | undefined,
  competitorId: string | undefined,
  name: string,
): DynamicCompetitorMenuRecord | null {
  if (!dynamicMenusMap) return null;
  if (competitorId && dynamicMenusMap.has(competitorId)) return dynamicMenusMap.get(competitorId)!;
  for (const rec of dynamicMenusMap.values()) {
    if (rec.competitorName === name) return rec;
  }
  return null;
}

function resolveRoomProfile(
  roomTypesMap: Map<string, HotelRoomTypesProfile> | undefined,
  placeId: string | null,
  name: string,
): HotelRoomTypesProfile | null {
  if (roomTypesMap) {
    if (placeId && roomTypesMap.has(placeId)) return roomTypesMap.get(placeId)!;
    const normalizedName = name.trim().toLowerCase();
    for (const prof of roomTypesMap.values()) {
      if (prof.name.trim().toLowerCase() === normalizedName) return prof;
    }
  }
  return getHotelRoomTypes(placeId ?? name);
}

const GOOGLE_TYPE_BY_VENUE_NAME = new Map<string, string>(
  Object.values(hotelCompsetData.outletVenues as Record<string, { name: string; category?: string | null }[]>)
    .flat()
    .filter((v): v is { name: string; category: string } => Boolean(v.name && v.category))
    .map((v) => [v.name.trim().toLowerCase(), v.category]),
);

const cleanAuditField = (text: string): string =>
  sanitizeAiModelText(text)
    .replace(/\b(crawl4ai|playwright)\b/gi, "")
    .replace(/\bpesaing\b/gi, (m) => (m[0] === "P" ? "Kompetitor" : "kompetitor"))
    .replace(/\bregistri(?:\s+pembanding|\s+kompetitor)?\b/gi, (m) =>
      m[0] === "R" ? "Daftar kompetitor" : "daftar kompetitor",
    )
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

// ---------------------------------------------------------------------------------------------------------------
// Pemuat data penilaian holistik bersama
// ---------------------------------------------------------------------------------------------------------------

interface DatedPrice {
  price: number | null;
}

/** Baris `lowestByHotel` di resort-room-rates.data.json (semua hotel yang dirayapi, termasuk yang sedang diarsipkan). */
export interface RawLowestRate {
  hotelId: string;
  weekday: DatedPrice;
  weekend: DatedPrice;
  range?: {
    weekday?: { min?: DatedPrice; max?: DatedPrice };
    weekend?: { min?: DatedPrice; max?: DatedPrice };
  };
}

const positive = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Tarif rata-rata terbobot satu minggu (5 malam hari biasa + 2 malam akhir pekan), rumus yang sama dengan pangsa pasar. */
export function weightedAdrOf(rate: RawLowestRate | undefined): number | null {
  if (!rate) return null;
  const wd = rate.weekday?.price ?? null;
  const we = rate.weekend?.price ?? null;
  if (positive(wd) && positive(we)) return Math.round((5 * wd + 2 * we) / 7);
  if (positive(wd)) return wd;
  if (positive(we)) return we;
  return null;
}

/**
 * Rentang segmen tarif sebuah hotel: tarif termurah hari biasa sampai tarif termurah akhir pekan di jendela 14 malam.
 * Harga termahal sengaja tidak dipakai karena satu malam puncak (libur panjang) bisa melebarkan rentang dua kali lipat;
 * tarif termurah adalah harga yang benar-benar bisa dibeli tamu pada tiap jenis hari.
 */
export function nightlyBandOf(rate: RawLowestRate | undefined): { min: number; max: number } | null {
  if (!rate) return null;
  const floorOf = (...prices: (number | null | undefined)[]) => {
    const valid = prices.filter(positive);
    return valid.length ? Math.min(...valid) : null;
  };
  const weekday = floorOf(rate.range?.weekday?.min?.price, rate.weekday?.price);
  const weekend = floorOf(rate.range?.weekend?.min?.price, rate.weekend?.price);
  if (weekday === null || weekend === null) return null;
  return { min: Math.min(weekday, weekend), max: Math.max(weekday, weekend) };
}

export interface HolisticDataContext {
  roomTypesMap: Map<string, HotelRoomTypesProfile>;
  dynamicMenusMap: Map<string, DynamicCompetitorMenuRecord>;
  ratesByHotel: Map<string, RawLowestRate>;
  ownWeightedAdr: number | null;
  ownPriceBand: { min: number; max: number } | null;
}

export function buildHolisticDataContext(
  roomTypesMap: Map<string, HotelRoomTypesProfile>,
  dynamicMenusMap: Map<string, DynamicCompetitorMenuRecord>,
  rates: RawLowestRate[] = resortRoomRates.lowestByHotel as RawLowestRate[],
): HolisticDataContext {
  const ratesByHotel = new Map(rates.map((r) => [r.hotelId, r]));
  const own = ratesByHotel.get(SANGHYANG_PLACE_ID);
  return {
    roomTypesMap,
    dynamicMenusMap,
    ratesByHotel,
    ownWeightedAdr: weightedAdrOf(own),
    ownPriceBand: nightlyBandOf(own),
  };
}

/** Baris Competitor yang dibutuhkan untuk menyusun masukan penilaian holistik. */
export interface HolisticSourceRow {
  id: string;
  version: number;
  name: string;
  category: string | null;
  placeId: string | null;
  outlets: string[];
  roadKm: number | null;
  driveMinutes: number | null;
  starRating: number | null;
  roomCount: number | null;
  rating: { toString(): string } | number | null;
  reviewCount: number | null;
  notes: string | null;
  address: string | null;
  active: boolean;
  compsetRole: string | null;
  retiredReason: string | null;
  parentId: string | null;
  facts: FactRow[];
  parent: { name: string; starRating: number | null; active: boolean; compsetRole: string | null } | null;
  venues: { category: string | null }[];
}

const TOOL_NOTE_RE = /\s*\(?(?:terverifikasi|diperiksa)\s+(?:crawl4ai|playwright)[^)]*\)?/gi;

function cleanSignalText(text: string | null): string | null {
  if (!text) return null;
  const cleaned = sanitizeAiModelText(text.replace(TOOL_NOTE_RE, "")).replace(/\b(crawl4ai|playwright)\b/gi, "").trim();
  return cleaned || null;
}

function storedFactsOf(rows: FactRow[]) {
  return rows.map((f) => ({
    section: (f.section ?? "profil") as "profil",
    key: f.key,
    text: factText(f.value),
    quote: factText(f.value),
    sourceUrl: f.sourceUrl ?? "",
    observedAt: f.observedAt.toISOString(),
  }));
}

function roomSizesFor(placeId: string | null) {
  return placeId ? ROOM_SIZES.filter((r) => r.hotelId === placeId) : [];
}

function roomUnitsOf(profile: HotelRoomTypesProfile | null): HolisticRoomUnitSignal[] | null {
  if (!profile || profile.roomTypes.length === 0) return null;
  return profile.roomTypes.map((r) => ({ bedrooms: r.bedrooms, areaSqm: r.areaSqm }));
}

function facilitiesOf(row: Pick<HolisticSourceRow, "placeId" | "facts">) {
  const summary = summarizeFacilities(storedFactsOf(row.facts), roomSizesFor(row.placeId));
  const visual = row.placeId ? getVisualInsight(row.placeId) : null;
  return {
    smartTv: summary.smartTv,
    bathtub: summary.bathtub,
    infinityPool: summary.infinityPool,
    hotSpring: summary.hotSpring,
    designStyle: summary.designStyle ?? visual?.designStyle ?? null,
    ambience: visual?.ambience ?? null,
    usp: summary.usp,
    keyAmenities: summary.keyAmenities,
  };
}

/** Masukan penilaian holistik satu baris daftar kompetitor, dari data bersumber yang sama untuk semua pemanggil. */
export function holisticInputOf(row: HolisticSourceRow, ctx: HolisticDataContext): HolisticCandidateInput {
  const lodging = isLodging(row.category);
  const menu = lodging ? null : mergeCompetitorMenu(row.name, resolveDynamicMenu(ctx.dynamicMenusMap, row.id, row.name));
  const profile = lodging ? resolveRoomProfile(ctx.roomTypesMap, row.placeId, row.name) : null;
  const areas = (profile?.roomTypes ?? []).map((r) => r.areaSqm).filter(positive);
  const adr = lodging && row.placeId ? weightedAdrOf(ctx.ratesByHotel.get(row.placeId)) : null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    placeId: row.placeId,
    outlets: row.outlets,
    roadKm: row.roadKm,
    driveMinutes: row.driveMinutes,
    starRating: row.starRating,
    roomCount: row.roomCount,
    rating: row.rating === null ? null : Number(row.rating.toString()),
    reviewCount: row.reviewCount,
    notes: cleanSignalText(row.notes),
    address: row.address,
    googleType: GOOGLE_TYPE_BY_VENUE_NAME.get(row.name.trim().toLowerCase()) ?? null,
    insideLodging: row.parentId !== null,
    parentName: row.parent?.name ?? null,
    parentStarRating: row.parent?.starRating ?? null,
    parentActive: row.parent ? row.parent.active : null,
    parentCompsetRole: parseCompsetRole(row.parent?.compsetRole),
    factTexts: row.facts.map((f) => factText(f.value)).filter(Boolean),
    menuItems: menu?.items ?? [],
    perPersonRange: menu?.perPerson ? { min: menu.perPerson.min, max: menu.perPerson.max } : null,
    roomTypesProfile: profile
      ? {
          roomTypeCount: profile.roomTypes.length,
          hasMultiBedroomUnit: profile.hasMultiBedroomUnit,
          multiBedroomCount: profile.roomTypes.filter((r) => (r.bedrooms ?? 0) >= 2).length,
          minAreaSqm: areas.length ? Math.min(...areas) : null,
          maxAreaSqm: areas.length ? Math.max(...areas) : null,
          hasSmartTv: profile.roomTypes.some((r) => r.smartTv === true),
          hasBathtub: profile.roomTypes.some((r) => r.bathtub === true),
        }
      : null,
    roomUnits: roomUnitsOf(profile),
    roomTypeNames: (profile?.roomTypes ?? []).map((r) => r.name),
    childVenueCategories: row.venues.map((v) => v.category).filter((c): c is string => Boolean(c)),
    facilities: facilitiesOf(row),
    priceRatioVsOwn: adr !== null && ctx.ownWeightedAdr ? adr / ctx.ownWeightedAdr : null,
  };
}

/** Baris Sanghyang dan outletnya sendiri, untuk konteks pembanding. */
export interface OwnSourceRow {
  id: string;
  name: string;
  placeId: string | null;
  notes: string | null;
  starRating: number | null;
  roomCount: number | null;
  rating: { toString(): string } | number | null;
  reviewCount: number | null;
  facts: FactRow[];
}

function medianPorsiPrice(outlet: OutletKey): number | null {
  const prices = (officialMenu(outlet)?.items ?? [])
    .filter((i) => i.unit === "porsi" && i.price > 0)
    .map((i) => i.price)
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
}

const OWN_NAMES = new Set(OWN_OUTLETS.map((o) => o.competitorName));
const OWN_PLACE_IDS = new Set(Object.values(OUTLET_PLACE_IDS));

export const isOwnRow = (row: { name: string; placeId: string | null }) =>
  (row.placeId !== null && OWN_PLACE_IDS.has(row.placeId)) || OWN_NAMES.has(row.name);

/** Konteks pembanding per outlet dari data Sanghyang sendiri; nilai yang belum bersumber dibiarkan null. */
export function holisticReferencesOf(
  ownRows: OwnSourceRow[],
  ctx: HolisticDataContext,
): Partial<Record<OutletKey, HolisticReferenceContext>> {
  const refs: Partial<Record<OutletKey, HolisticReferenceContext>> = {};
  const rowFor = (outlet: OutletKey) => {
    const meta = OWN_OUTLETS.find((o) => o.outletKey === outlet);
    return ownRows.find((r) => r.placeId === OUTLET_PLACE_IDS[outlet] || (meta && r.name === meta.competitorName)) ?? null;
  };
  const resort = rowFor("resort");
  const ownProfile = resolveRoomProfile(ctx.roomTypesMap, SANGHYANG_PLACE_ID, resort?.name ?? "");
  const ownFac = resort ? facilitiesOf({ placeId: SANGHYANG_PLACE_ID, facts: resort.facts }) : null;
  refs.resort = {
    ownStarRating: resort?.starRating ?? null,
    ownRoomCount: resort?.roomCount ?? null,
    ownAveragePriceIdr: ctx.ownWeightedAdr,
    ownPriceBand: ctx.ownPriceBand,
    ownRating: resort?.rating == null ? null : Number(resort.rating.toString()),
    ownReviewCount: resort?.reviewCount ?? null,
    ownHasMultiBedroom: ownProfile?.hasMultiBedroomUnit ?? false,
    ownRoomUnits: roomUnitsOf(ownProfile),
    ownFacilities: ownFac
      ? { smartTv: ownFac.smartTv, bathtub: ownFac.bathtub, infinityPool: ownFac.infinityPool, hotSpring: ownFac.hotSpring }
      : null,
    ownProfileText: resort
      ? [resort.name, resort.notes, ...resort.facts.map((f) => factText(f.value)), ...(ownProfile?.roomTypes ?? []).map((r) => r.name)]
          .filter(Boolean)
          .join(". ")
      : null,
  };
  for (const outlet of OUTLET_KEYS) {
    if (outlet === "resort") continue;
    const own = rowFor(outlet);
    refs[outlet] = {
      // Outlet berada di dalam hotel Sanghyang, jadi kelas hotelnya sama dengan Kamar & Resort.
      ownStarRating: resort?.starRating ?? null,
      ownAveragePriceIdr: medianPorsiPrice(outlet),
      ownRating: own?.rating == null ? null : Number(own.rating.toString()),
      ownReviewCount: own?.reviewCount ?? null,
    };
  }
  return refs;
}

export interface HolisticRegistry {
  candidates: RegistryCandidate[];
  references: Partial<Record<OutletKey, HolisticReferenceContext>>;
  ownRowIds: string[];
  ctx: HolisticDataContext;
}

const HOLISTIC_FACT_SELECT = { select: { section: true, key: true, value: true, observedAt: true, sourceUrl: true } } as const;

/** Memuat seluruh daftar kompetitor beserta masukan penilaian holistik dan konteks Sanghyang dari DB dan berkas data. */
export async function loadHolisticRegistry(preloaded?: CompsetAuditPreloaded): Promise<HolisticRegistry> {
  const [rows, roomTypesMap, dynamicMenusMap] = await Promise.all([
    db.competitor.findMany({
      select: {
        id: true,
        version: true,
        name: true,
        category: true,
        placeId: true,
        outlets: true,
        roadKm: true,
        driveMinutes: true,
        starRating: true,
        roomCount: true,
        rating: true,
        reviewCount: true,
        notes: true,
        address: true,
        active: true,
        compsetRole: true,
        retiredReason: true,
        parentId: true,
        facts: HOLISTIC_FACT_SELECT,
        parent: { select: { name: true, starRating: true, active: true, compsetRole: true } },
        venues: { select: { category: true } },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    preloaded?.roomTypesMap ? Promise.resolve(preloaded.roomTypesMap) : loadDynamicHotelRoomTypes(),
    preloaded?.dynamicMenusMap ? Promise.resolve(preloaded.dynamicMenusMap) : loadDynamicCompetitorMenuItems(),
  ]);
  const ctx = buildHolisticDataContext(roomTypesMap, dynamicMenusMap);
  const own = rows.filter(isOwnRow);
  const others = rows.filter((r) => !isOwnRow(r));
  return {
    candidates: others.map((r) => ({
      id: r.id,
      version: r.version,
      name: r.name,
      category: r.category,
      active: r.active,
      compsetRole: r.compsetRole,
      outlets: r.outlets,
      retiredReason: r.retiredReason,
      notes: r.notes,
      parentId: r.parentId,
      input: holisticInputOf(r, ctx),
    })),
    references: holisticReferencesOf(own, ctx),
    ownRowIds: own.map((r) => r.id),
    ctx,
  };
}

export interface HolisticEvaluation {
  registry: HolisticRegistry;
  /** Satu keputusan per baris daftar kompetitor: skor & faktor per outlet, peran sesudah penilaian, dan keputusan pemakai. */
  decisions: RegistryDecision[];
}

/**
 * Penilaian holistik lengkap yang sama dengan langkah refresh dan skrip audit, tanpa menulis ke basis data.
 * Dipakai Knowledge Graph dan halaman lain supaya skor, faktor, dan peran kompetitor sama di seluruh aplikasi.
 */
export async function loadHolisticEvaluation(preloaded?: CompsetAuditPreloaded): Promise<HolisticEvaluation> {
  const registry = await loadHolisticRegistry(preloaded);
  return { registry, decisions: reclassifyRegistry(registry.candidates, registry.references) };
}

// ---------------------------------------------------------------------------------------------------------------
// Audit pembanding untuk web dan PDF
// ---------------------------------------------------------------------------------------------------------------

interface BuildAuditExtras {
  roomTypesMap?: Map<string, HotelRoomTypesProfile>;
  specsMap?: Map<string, PlaceSpecs>;
  dynamicMenusMap?: Map<string, DynamicCompetitorMenuRecord>;
  ownByOutlet?: Map<string, OwnOutletMeta>;
  /** Konteks penilaian holistik; tanpa ini skor dihitung dari baris saja (tanpa tarif dan profil Sanghyang). */
  holistic?: { ctx: HolisticDataContext; references: Partial<Record<OutletKey, HolisticReferenceContext>> };
}

function sourceRowOf(row: RegistryRow): HolisticSourceRow {
  return {
    id: row.id ?? row.name,
    version: 1,
    name: row.name,
    category: row.category,
    placeId: row.placeId,
    outlets: row.outlets,
    roadKm: row.roadKm,
    driveMinutes: row.driveMinutes,
    starRating: row.starRating,
    roomCount: row.roomCount,
    rating: row.rating,
    reviewCount: row.reviewCount,
    notes: row.notes ?? null,
    address: row.address ?? null,
    active: row.active,
    compsetRole: row.compsetRole,
    retiredReason: row.retiredReason,
    parentId: row.parentId ?? null,
    facts: row.facts,
    parent: row.parent
      ? { name: row.parent.name, starRating: row.parent.starRating, active: row.parent.active ?? true, compsetRole: row.parent.compsetRole ?? null }
      : null,
    venues: row.venues ?? [],
  };
}

function usedItem(
  row: RegistryRow,
  marketSize: ResortMarketSize,
  outlet: string,
  own: OwnProperty,
  extras?: BuildAuditExtras,
  outletComparisons?: ItemComparison[],
): BenchmarkCompetitorItem {
  const market = row.placeId ? marketSize.rows.find((r) => r.hotelId === row.placeId) : undefined;
  const rating = row.rating === null ? null : Number(row.rating.toString());
  const role = parseCompsetRole(row.compsetRole) ?? undefined;
  const stars = row.starRating ?? undefined;
  const lodging = isLodging(row.category);

  const dynMenu = resolveDynamicMenu(extras?.dynamicMenusMap ?? extras?.holistic?.ctx.dynamicMenusMap, row.id, row.name);
  const mergedMenu = lodging ? null : mergeCompetitorMenu(row.name, dynMenu);
  const specs = resolveSpecs(extras?.specsMap, row.placeId, row.id, row.name);
  const roomTypesMap = extras?.roomTypesMap ?? extras?.holistic?.ctx.roomTypesMap;
  const roomTypesProfile = lodging ? resolveRoomProfile(roomTypesMap, row.placeId, row.name) : null;

  const targetOutlet: OutletKey = isOutletKey(outlet)
    ? outlet
    : lodging
      ? "resort"
      : ((row.outlets.find(isOutletKey) ?? "sunset-grill") as OutletKey);
  const ownMeta = extras?.ownByOutlet?.get(targetOutlet);
  const ownSpecs =
    ownMeta?.specs ??
    (lodging ? resolveSpecs(extras?.specsMap, SANGHYANG_PLACE_ID, undefined, "Sanghyang Indah Spa Resort") : null);
  const ownRoomTypes = lodging ? resolveRoomProfile(roomTypesMap, SANGHYANG_PLACE_ID, "Sanghyang Indah Spa Resort") : null;
  const comparableGap = !lodging && outletComparisons ? rivalGap(outletComparisons, row.name, "all") : null;

  const ctx =
    extras?.holistic?.ctx ??
    buildHolisticDataContext(roomTypesMap ?? new Map(), extras?.dynamicMenusMap ?? new Map());
  const holisticInput = holisticInputOf(sourceRowOf(row), ctx);
  const holistic: HolisticScoreResult = scoreCompetitorHolistic(
    holisticInput,
    targetOutlet,
    extras?.holistic?.references[targetOutlet],
  );
  const resortRef = extras?.holistic?.references.resort;
  const segment = lodging ? lodgingPriceSegment(holisticInput.priceRatioVsOwn, resortRef) : null;
  const priceSegment =
    segment && resortRef?.ownPriceBand
      ? { position: segment.position, ratio: segment.ratio, bandMin: resortRef.ownPriceBand.min, bandMax: resortRef.ownPriceBand.max }
      : null;

  return {
    name: row.name,
    estimatedRevenue: market?.estimatedMonthlyRevenue ?? null,
    estimatedMarketShare: market?.share ?? null,
    priceLevel:
      market?.priceVsSanghyang != null
        ? `${market.priceVsSanghyang}% dari tarif Sanghyang (tarif OTA terbobot)`
        : "Belum ada data harga yang bersumber",
    relevanceScore: holistic.score,
    auditStatus: role === "benchmark" ? "BENCHMARK" : auditStatusFromScore(holistic.score),
    starRating: stars,
    cluster: isLodging(row.category) && stars !== undefined && stars >= MIN_LODGING_STARS ? (stars >= 5 ? "KLASTER_II_BINTANG_5" : "KLASTER_I_BINTANG_4") : undefined,
    compsetRole: role,
    roadKm: row.roadKm,
    rating,
    reviewCount: row.reviewCount,
    websiteUrl: row.websiteUrl,
    mapsUrl: row.googleMapsUrl ?? row.mapsUrl,
    auditRationale: compsetRationale(
      {
        name: row.name,
        placeId: row.placeId,
        category: row.category,
        outlets: row.outlets,
        starRating: row.starRating,
        roomCount: row.roomCount,
        roadKm: row.roadKm,
        driveMinutes: row.driveMinutes,
        distanceSource: row.distanceSource,
        rating,
        reviewCount: row.reviewCount,
        compsetRole: row.compsetRole,
        facts: factsOf(row.facts),
        parent: row.parent ? { name: row.parent.name, starRating: row.parent.starRating, facts: factsOf(row.parent.facts) } : null,
        specs,
        roomTypesProfile,
      },
      outlet,
      {
        own,
        market: market ? { stars: market.stars, roomCountSource: market.roomCountSource, priceVsSanghyang: market.priceVsSanghyang } : null,
        rates: { source: RESORT_ROOM_RATE_SOURCE.source, capturedAt: marketSize.ratesCapturedAt },
        menu: mergedMenu,
        ownSpecs,
        ownRoomTypes,
        ownRating: ownMeta?.rating ?? null,
        ownReviewCount: ownMeta?.reviewCount ?? null,
        comparableGap,
        holistic,
        priceSegment,
      },
    ),
    evidenceSource: row.distanceSource ? cleanAuditField(`Jarak: ${row.distanceSource}`) : "Daftar kompetitor",
    evidenceSourceUrl: row.websiteUrl ?? row.googleMapsUrl ?? row.mapsUrl ?? undefined,
  };
}

// Nama menjadi penentu terakhir: tempat dengan skor dan jarak sama (hotel dan bar di dalamnya) harus tampil berurutan
// sama di DB lokal dan produksi, yang urutan barisnya berbeda.
const byRoleThenScoreThenDistance = (a: BenchmarkCompetitorItem, b: BenchmarkCompetitorItem) =>
  (a.compsetRole === b.compsetRole ? 0 : a.compsetRole === "inti" ? -1 : 1) ||
  ((b.relevanceScore ?? 0) - (a.relevanceScore ?? 0)) ||
  ((a.roadKm ?? Infinity) - (b.roadKm ?? Infinity)) ||
  a.name.localeCompare(b.name, "id");

export function buildCompsetAudit(
  rows: RegistryRow[],
  marketSize: ResortMarketSize,
  own: OwnProperty,
  extras?: BuildAuditExtras,
): Record<string, OutletCompsetAudit> {
  const used = rows.filter((r) => r.active && parseCompsetRole(r.compsetRole) !== null);
  const excluded = rows.filter((r) => !r.active && r.retiredReason);
  const toExcluded = (r: RegistryRow): ExcludedCompetitor => ({
    name: r.name,
    category: r.category,
    roadKm: r.roadKm,
    starRating: r.starRating,
    reason: cleanAuditField(r.retiredReason as string),
  });
  const dynamicMenusMap = extras?.dynamicMenusMap ?? extras?.holistic?.ctx.dynamicMenusMap;

  const audit: Record<string, OutletCompsetAudit> = {};
  for (const key of OUTLET_KEYS) {
    const outletUsed = used.filter((r) => r.outlets.includes(key));
    let comparisons: ItemComparison[] | undefined;
    if (key !== "resort") {
      const ownItems = officialFnbItems(officialMenu(key));
      if (ownItems.length > 0) {
        comparisons = compareItems(
          ownItems,
          outletUsed.map((r) => ({
            name: r.name,
            core: parseCompsetRole(r.compsetRole) !== "benchmark",
            items: toFnbItems(mergeCompetitorMenu(r.name, resolveDynamicMenu(dynamicMenusMap, r.id, r.name))),
          })),
        );
      }
    }
    audit[key] = {
      used: outletUsed.map((r) => usedItem(r, marketSize, key, own, extras, comparisons)).sort(byRoleThenScoreThenDistance),
      excluded: excluded.filter((r) => r.outlets.includes(key)).map(toExcluded).sort((a, b) => a.name.localeCompare(b.name, "id")),
    };
  }
  audit.all = {
    used: used.map((r) => usedItem(r, marketSize, "all", own, extras)).sort(byRoleThenScoreThenDistance),
    excluded: excluded.map(toExcluded).sort((a, b) => a.name.localeCompare(b.name, "id")),
  };
  return audit;
}

const FACT_SELECT = { select: { section: true, key: true, value: true, observedAt: true, sourceUrl: true } } as const;
/** Situs resmi Sanghyang menyebut resornya di tepi laut ("A SEASIDE RESORT"); dipakai alasan pembanding penginapan. */
const SEASIDE = /(?<![\p{L}])(tepi laut|tepi pantai|pantai|seaside|beach)(?![\p{L}])/iu;

export async function loadCompsetAudit(
  marketSize: ResortMarketSize,
  preloaded?: CompsetAuditPreloaded,
): Promise<Record<string, OutletCompsetAudit>> {
  const ownNames = OWN_OUTLETS.map((o) => o.competitorName);
  const [rows, ownRows, holisticRegistry, specsMap] = await Promise.all([
    db.competitor.findMany({
      where: { OR: [{ active: true, compsetRole: { not: null } }, { active: false, retiredReason: { not: null } }] },
      select: {
        id: true,
        name: true,
        category: true,
        outlets: true,
        placeId: true,
        roadKm: true,
        driveMinutes: true,
        starRating: true,
        roomCount: true,
        rating: true,
        reviewCount: true,
        websiteUrl: true,
        googleMapsUrl: true,
        mapsUrl: true,
        distanceSource: true,
        compsetRole: true,
        active: true,
        retiredReason: true,
        notes: true,
        address: true,
        parentId: true,
        facts: FACT_SELECT,
        parent: { select: { name: true, starRating: true, active: true, compsetRole: true, facts: FACT_SELECT } },
        venues: { select: { category: true } },
      },
    }),
    db.competitor.findMany({
      where: { OR: [{ placeId: SANGHYANG_PLACE_ID }, { name: { in: ownNames } }] },
      select: {
        id: true,
        name: true,
        placeId: true,
        starRating: true,
        rating: true,
        reviewCount: true,
        facts: { where: { key: "deskripsi" }, ...FACT_SELECT },
      },
    }),
    loadHolisticRegistry(preloaded),
    preloaded?.specsMap ? Promise.resolve(preloaded.specsMap) : loadPlaceSpecsMap(),
  ]);
  const { roomTypesMap, dynamicMenusMap } = holisticRegistry.ctx;

  const ownResortRow = ownRows.find((r) => r.placeId === SANGHYANG_PLACE_ID) ?? ownRows[0] ?? null;
  const ownDescription = ownResortRow ? factsOf(ownResortRow.facts).map((f) => f.text).join(" ") : "";

  const ownByOutlet = new Map<string, OwnOutletMeta>();
  for (const meta of OWN_OUTLETS) {
    const matched = ownRows.find((r) => r.name === meta.competitorName);
    const sp = resolveSpecs(specsMap, matched?.placeId ?? null, matched?.id, meta.competitorName);
    ownByOutlet.set(meta.outletKey, {
      outletKey: meta.outletKey as OutletKey,
      competitorName: meta.competitorName,
      rating: matched?.rating != null ? Number(matched.rating.toString()) : null,
      reviewCount: matched?.reviewCount ?? null,
      specs: sp,
    });
  }

  return buildCompsetAudit(
    rows,
    marketSize,
    { starRating: ownResortRow?.starRating ?? null, seaside: SEASIDE.test(ownDescription) },
    {
      roomTypesMap,
      specsMap,
      dynamicMenusMap,
      ownByOutlet,
      holistic: { ctx: holisticRegistry.ctx, references: holisticRegistry.references },
    },
  );
}
