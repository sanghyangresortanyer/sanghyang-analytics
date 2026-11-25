/**
 * Kompetitor hotel yang layak dibandingkan dengan Sanghyang: jarak jalan terukur dari Google Maps,
 * kelompok Resort/Hotel, tahun buka, dan foto kamar (lib/market/hotel-compset.data.json).
 * Harga diambil dari analisa tarif OTA yang sama dengan tabel kamar (resort-room-rates.ts),
 * jadi angka di sini selalu cocok dengan tabel itu. Rata-rata hanya memakai hotel dalam radius.
 */
import data from "./hotel-compset.data.json";
import { COMPETITOR_RADIUS_KM, RESORT_LOWEST_BY_HOTEL, RESORT_ROOM_RATES, SANGHYANG_HOTEL_ID, type RoomKind, type Stay } from "./resort-room-rates";
import type { CompsetRole } from "./compset";

export type HotelGroup = "resort" | "hotel";

export interface CompsetHotel {
  hotelId: string;
  name: string;
  group: HotelGroup;
  googleStars: number | null;
  roadKm: number;
  /** Null bila jaraknya bukan dari Google Maps (lihat lib/market/distance-source.ts). */
  driveMinutes: number | null;
  straightKm: number;
  address: string | null;
  mapsUrl: string;
  opened: { year: number | null; note: string; sourceUrl: string } | null;
  photos: { url: string; room: string }[];
  /** Harga tertinggi bila bukan null; null bila belum dipublikasikan resmi atau OTA. */
  roomCount: number | null;
  roomCountSource: string;
  /** Peran pembanding (lib/market/compset.ts); null untuk Sanghyang dan hotel yang dikeluarkan. */
  compsetRole: CompsetRole | null;
  /** Diisi bila hotel dikeluarkan dari pembanding, beserta alasan dan tanggal keputusan. */
  excludedReason?: string;
  /** Bintang dari sumber besar selain Google (aturan "minimal satu sumber bintang 4"), bila Google tidak mencantumkannya. */
  starRating?: number;
  starSource?: string;
  distanceSource?: string;
  /** Nama lain yang dipakai Google Travel untuk entity yang sama (judul panel), beserta sumbernya. */
  titleAliases?: string[];
  titleAliasSource?: string;
  lat: number;
  lng: number;
}

/**
 * Kelas bintang untuk aturan pembanding: bintang tertinggi dari sumber besar (Google atau OTA besar), karena aturannya
 * "minimal satu sumber besar mencantumkan bintang 4". Null bila tidak ada sumber yang mencantumkan kelas.
 */
export function compsetStars(h: Pick<CompsetHotel, "googleStars" | "starRating">): number | null {
  return Math.max(h.googleStars ?? 0, h.starRating ?? 0) || null;
}

/** Label bintang beserta sumbernya, misalnya "Bintang 3 (Google) · 4 (Traveloka)". */
export function starLabel(h: Pick<CompsetHotel, "googleStars" | "starRating" | "starSource">): string {
  const other = h.starRating && h.starRating !== h.googleStars ? `${h.starRating} (${(h.starSource ?? "sumber lain").split(/[ ,(]/)[0]})` : null;
  if (h.googleStars) return other ? `Bintang ${h.googleStars} (Google) · ${other}` : `Bintang ${h.googleStars} (Google)`;
  return other ? `Bintang ${other}` : "Bintang tidak tercatat";
}

/** Radius pembanding untuk semua outlet (resort-room-rates.ts). */
export const COMPSET_RADIUS_KM = COMPETITOR_RADIUS_KM;
/** Dibuka dalam sepuluh tahun terakhir dihitung "hotel baru". */
export const NEW_HOTEL_SINCE = 2015;

export const COMPSET_SOURCE = { measuredAt: data.measuredAt, method: data.method, groupBasis: data.groupBasis, photoSource: data.photoSource };
const ALL_HOTELS = data.hotels as CompsetHotel[];
/** Sanghyang, pembanding inti, dan acuan. Hotel yang dikeluarkan tidak ikut perhitungan atau tampilan harga. */
export const COMPSET_HOTELS = ALL_HOTELS.filter((h) => !h.excludedReason);
/** Hotel yang dikeluarkan dari pembanding beserta alasannya (untuk halaman Metodologi). */
export const EXCLUDED_HOTELS = ALL_HOTELS.filter((h) => Boolean(h.excludedReason));

export const GROUP_LABEL: Record<HotelGroup, string> = { resort: "Resort", hotel: "Hotel" };

/** Pembanding inti: dihitung dalam rata-rata harga dan pangsa pasar. Acuan (benchmark) hanya ditampilkan. */
export const isCoreCompetitor = (h: Pick<CompsetHotel, "compsetRole">) => h.compsetRole === "inti";
/** Ikut dihitung dalam total pasar: Sanghyang sendiri dan pembanding inti. */
export const countsInMarket = (h: Pick<CompsetHotel, "hotelId" | "compsetRole">) =>
  h.hotelId === SANGHYANG_HOTEL_ID || isCoreCompetitor(h);
export const isNewHotel = (h: Pick<CompsetHotel, "opened">) => (h.opened?.year ?? 0) >= NEW_HOTEL_SINCE;

export function radiusBand(km: number): string {
  if (km > COMPSET_RADIUS_KM) return "Di luar radius";
  if (km <= 5) return "0–5 km";
  if (km <= 10) return "5–10 km";
  if (km <= 15) return "10–15 km";
  return `15–${COMPSET_RADIUS_KM} km`;
}

const lowestById = new Map(RESORT_LOWEST_BY_HOTEL.map((h) => [h.hotelId, h]));
export const lowestPrice = (hotelId: string, stay: Stay) => lowestById.get(hotelId)?.[stay].price ?? null;

/** Kompetitor (tanpa Sanghyang), terdekat lebih dulu. */
export const compsetCompetitors = () =>
  COMPSET_HOTELS.filter((h) => h.hotelId !== SANGHYANG_HOTEL_ID).sort((a, b) => a.roadKm - b.roadKm);

export interface LadderRow {
  hotelId: string;
  name: string;
  price: number;
  /** OTA yang memberi harga terendah. */
  source: string | null;
  /** false untuk hotel acuan (benchmark): tampil, tetapi tidak ikut rata-rata. */
  isCore: boolean;
  isSanghyang: boolean;
}

/** Tangga harga terendah OTA, termurah → termahal. Hotel tanpa harga tidak ditampilkan. */
export function priceLadder(stay: Stay): LadderRow[] {
  return COMPSET_HOTELS.flatMap((h) => {
    const price = lowestPrice(h.hotelId, stay);
    if (price === null) return [];
    return [{ hotelId: h.hotelId, name: h.name, price, source: lowestById.get(h.hotelId)?.[stay].source ?? null, isCore: countsInMarket(h), isSanghyang: h.hotelId === SANGHYANG_HOTEL_ID }];
  }).sort((a, b) => a.price - b.price);
}

export interface GroupAverage {
  group: HotelGroup;
  kind: RoomKind;
  stay: Stay;
  average: number | null;
  /** Hotel yang punya harga untuk sel ini. */
  hotels: string[];
}

const KINDS: RoomKind[] = ["lowest", "standard", "suite", "villa"];
const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Rata-rata harga kompetitor per kelompok × jenis kamar × hari; `scope` memilih pembanding inti atau hotel acuan. */
export function groupAverages(scope: "core" | "benchmark" = "core"): GroupAverage[] {
  const pick = new Map(compsetCompetitors().filter((h) => (scope === "core" ? isCoreCompetitor(h) : !isCoreCompetitor(h))).map((h) => [h.hotelId, h]));
  const out: GroupAverage[] = [];
  for (const group of ["resort", "hotel"] as HotelGroup[]) {
    for (const kind of KINDS) {
      for (const stay of ["weekday", "weekend"] as Stay[]) {
        const rows = RESORT_ROOM_RATES.filter((r) => r.kind === kind && pick.get(r.hotelId)?.group === group && r[stay].competitor !== null);
        out.push({ group, kind, stay, average: average(rows.map((r) => r[stay].competitor as number)), hotels: rows.map((r) => pick.get(r.hotelId)!.name) });
      }
    }
  }
  return out;
}

/** Harga Sanghyang untuk satu jenis kamar (sama di setiap baris pembanding). */
export function sanghyangPrice(kind: RoomKind, stay: Stay): number | null {
  return RESORT_ROOM_RATES.find((r) => r.kind === kind && r[stay].sanghyang !== null)?.[stay].sanghyang ?? null;
}

/** Hotel baru beserta harga terendahnya dan kelipatan terhadap Sanghyang. */
export function newHotels() {
  const base = { weekday: lowestPrice(SANGHYANG_HOTEL_ID, "weekday"), weekend: lowestPrice(SANGHYANG_HOTEL_ID, "weekend") };
  const times = (p: number | null, b: number | null) => (p !== null && b ? Math.round((p / b) * 10) / 10 : null);
  return compsetCompetitors()
    .filter(isNewHotel)
    .map((h) => {
      const weekday = lowestPrice(h.hotelId, "weekday");
      const weekend = lowestPrice(h.hotelId, "weekend");
      return { hotel: h, weekday, weekend, weekdayTimes: times(weekday, base.weekday), weekendTimes: times(weekend, base.weekend) };
    });
}

export interface CompetitorDistance {
  /** null = tempat tidak ditemukan di Google Maps. */
  km: number | null;
  minutes: number | null;
  /** Nama tempat yang diukur (outlet di dalam hotel diukur dari hotelnya). */
  place: string;
  note: string | null;
}

/** Outlet F&B, bar, dan spa di dalam hotel memakai jarak hotelnya. Urutan penting: Marbella "by Jayakarta" dicek lebih dulu. */
const PLACE_MATCHERS: [RegExp, string][] = [
  [/sanghyang/i, "sanghyang"],
  [/marbella/i, "marbella"],
  // Mövenpick lebih dulu: restorannya juga bernama "Lagoon Restaurant", jadi tidak boleh jatuh ke Jayakarta.
  [/m[öo]venpick|bliss spa|bluewave|oceana pool/i, "movenpick"],
  [/jayakarta/i, "jayakarta"],
  [/nemuru|bellezza|temu katsu/i, "nemuru_palazo"],
  [/my pisita|la villa beach turtle/i, "my_pisita_anyer"],
  [/aston|the pier/i, "aston_anyer"],
  [/mambruk|lighthouse|infinity restaurant/i, "mambruk"],
  [/novus|upper circle|daiva|sarasa|serai restaurant/i, "novus_jiva"],
  [/patra anyer/i, "patra_anyer"],
  [/west cove/i, "west_cove_anyer"],
  [/allisa/i, "allisa"],
  [/hawaii/i, "hawaii_anyer"],
  [/mutiara/i, "mutiara_carita"],
  [/andalan/i, "andalan"],
  [/omah laut/i, "omah_laut"],
  [/bm seaside/i, "bm_seaside"],
  [/dewa laut/i, "dewa_laut"],
  [/beach point/i, "beach_point"],
  [/kamalika/i, "kamalika"],
  [/kalani/i, "kalani"],
  [/anyer family ktv/i, "anyer_family_ktv"],
];
/** Baris gabungan ("... Lainnya", "Agregat", "Rata-rata") bukan satu tempat, jadi tidak punya jarak. */
const AGGREGATE = /lainnya|agregat|rata-rata|eliminasi|pesisir tradisional/i;

const PLACES = new Map<string, CompetitorDistance>([
  ...COMPSET_HOTELS.map((h) => [h.hotelId, { km: h.roadKm, minutes: h.driveMinutes, place: h.name, note: null }] as const),
  ...(data.venues as { venueId: string; name: string; roadKm: number | null; driveMinutes: number | null; note: string | null }[]).map(
    (v) => [v.venueId, { km: v.roadKm, minutes: v.driveMinutes, place: v.name, note: v.note }] as const,
  ),
]);

/** Id tempat (hotelId/venueId) dari nama kompetitor; null untuk baris gabungan atau nama yang belum dipetakan. */
export function placeIdFor(name: string): string | null {
  if (AGGREGATE.test(name)) return null;
  return PLACE_MATCHERS.find(([re]) => re.test(name))?.[1] ?? null;
}

/** Jarak jalan kompetitor dari Sanghyang menurut namanya; null untuk baris gabungan atau nama yang belum dipetakan. */
export function distanceFor(name: string): CompetitorDistance | null {
  const id = placeIdFor(name);
  return id ? (PLACES.get(id) ?? null) : null;
}

/** "inside" / "outside" radius, atau "unknown" bila jaraknya belum ada. */
export function radiusStatus(name: string): "inside" | "outside" | "unknown" {
  const d = distanceFor(name);
  if (!d || d.km === null) return "unknown";
  return d.km <= COMPSET_RADIUS_KM ? "inside" : "outside";
}

export interface NearbyVenue {
  name: string;
  category: string | null;
  rating: number | null;
  roadKm: number;
  driveMinutes: number | null;
  mapsUrl: string;
}

export const NEARBY_VENUES_SOURCE = data.outletVenuesSource;

/** Tempat sejenis di sekitar Sanghyang (scan Google Maps, ≤25 km, dipilih manual) untuk outlet non-hotel; terdekat dulu. */
export function nearbyVenues(outletKey: string): NearbyVenue[] {
  return ((data.outletVenues as Record<string, NearbyVenue[]>)[outletKey] ?? []).filter((v) => v.roadKm <= COMPSET_RADIUS_KM);
}

/** Jenis kamar dari nama (aturan pelabelan workbook 05 Nov 2026): villa/cottage/condo/bedroom = villa, suite = suite. */
export function classifyRoom(name: string): Exclude<RoomKind, "lowest"> {
  if (/villa|cottage|condo|bungalow|bedroom|kamar tidur|house|rumah|family suite/i.test(name) && !/junior suite/i.test(name)) return "villa";
  if (/suite/i.test(name)) return "suite";
  return "standard";
}

export interface RoomSize { hotelId: string; room: string; sizeM2: number; sourceUrl: string; checkedAt: string }
/** Luas kamar dari situs resmi tiap hotel (scripts/research-room-sizes.ts). Hotel tanpa luas tertulis tidak ada di sini. */
export const ROOM_SIZES = (data as { roomSizes?: RoomSize[] }).roomSizes ?? [];

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", satu: "1", dua: "2", tiga: "3", empat: "4" };
const SIZE_STOP = new Set(["room", "rooms", "kamar", "with", "and", "or", "the", "a", "view", "double", "twin", "bed", "beds", "size", "king", "super", "partial"]);
const roomTokens = (name: string) =>
  new Set(name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").map((w) => NUMBER_WORDS[w] ?? w.replace(/s$/, "")).filter((w) => w && !SIZE_STOP.has(w)));

/**
 * Luas kamar OTA ("Deluxe Room, Balcony") dari daftar situs resmi ("DELUXE WITH BALCONY"): kata penting sama ≥ 60% dan
 * jenis kamar sama; bila beberapa sama cocoknya, yang paling mirip secara keseluruhan (Jaccard) menang.
 * Hasilnya null (tidak ditebak) bila kandidat teratas luasnya berbeda, atau nama gabungan OTA "Studio - Executive Suite"
 * berisi dua jenis kamar.
 */
export function roomSize(hotelId: string, otaRoom: string, sizes: RoomSize[] = ROOM_SIZES): RoomSize | null {
  if (new Set(otaRoom.split(/\s+-\s+/).map(classifyRoom)).size > 1) return null;
  const a = roomTokens(otaRoom);
  const kind = classifyRoom(otaRoom);
  const scored = sizes
    .filter((s) => s.hotelId === hotelId && classifyRoom(s.room) === kind)
    .map((s) => {
      const b = roomTokens(s.room);
      const shared = [...a].filter((w) => b.has(w)).length;
      return { s, overlap: a.size && b.size ? shared / Math.min(a.size, b.size) : 0, jaccard: shared / (new Set([...a, ...b]).size || 1) };
    })
    .filter((x) => x.overlap >= 0.6);
  const best = Math.max(0, ...scored.map((x) => x.jaccard));
  const top = scored.filter((x) => x.jaccard === best);
  return top.length && new Set(top.map((x) => x.s.sizeM2)).size === 1 ? top[0].s : null;
}

export const pricePerM2 = (price: number | null, size: RoomSize | null) => (price === null || !size ? null : Math.round(price / size.sizeM2));

/** Perkiraan per bulan memakai 30 hari; TPK dibaca dari rilis BPS di basis data (lib/market/bps-tpk.ts), bukan konstanta. */
export const DAYS_PER_MONTH = 30;

/** ADR terbobot 1 minggu: (5 malam hari biasa + 2 malam akhir pekan) / 7. */
export function hotelWeightedAdr(hotelId: string): number | null {
  const wd = lowestPrice(hotelId, "weekday");
  const we = lowestPrice(hotelId, "weekend");
  if (wd !== null && we !== null) {
    return Math.round((5 * wd + 2 * we) / 7);
  }
  if (wd !== null) return wd;
  if (we !== null) return we;
  return null;
}

export interface PrecisionMarketShareRow {
  hotelId: string;
  name: string;
  group: HotelGroup;
  /** Kelas bintang pembanding (compsetStars). */
  stars: number | null;
  roadKm: number;
  driveMinutes: number | null;
  /** Sanghyang atau pembanding inti: ikut dihitung dalam total pasar. */
  countsInMarket: boolean;
  compsetRole: CompsetRole | null;
  isSanghyang: boolean;
  /** Harga tertinggi bila bukan null; null bila belum dipublikasikan resmi atau OTA. */
  roomCount: number | null;
  roomCountSource: string;
  weekdayPrice: number | null;
  weekendPrice: number | null;
  adr: number | null;
  monthlyRevenue: number | null;
  marketShareGroupPct: number | null;
  marketShareTotalPct: number | null;
}

export interface PrecisionMarketShareResult {
  /** null bila TPK BPS belum pernah diambil: semua perkiraan omset ikut null. */
  tpkRate: number | null;
  daysPerMonth: number;
  filter: "all" | "resort" | "hotel";
  rows: PrecisionMarketShareRow[];
  totals: {
    resortRooms: number;
    resortMonthlyRevenue: number;
    hotelRooms: number;
    hotelMonthlyRevenue: number;
    overallRooms: number;
    overallMonthlyRevenue: number;
    sanghyangMonthlyRevenue: number;
    sanghyangResortSharePct: number;
    sanghyangTotalSharePct: number;
  };
}

/**
 * Menghitung estimasi omset dan pangsa pasar presisi berdasarkan standar perhotelan:
 * Omset = Kamar × 30 Hari × TPK BPS × ADR Terbobot.
 * Mendukung filter 2 grup (Resort vs Hotel) serta total gabungan kawasan Anyer (≤25 km).
 */
export function calculatePrecisionMarketShare(
  tpkRate: number | null,
  groupFilter: "all" | "resort" | "hotel" = "all"
): PrecisionMarketShareResult {
  const calculated = COMPSET_HOTELS.map((h) => {
    const wd = lowestPrice(h.hotelId, "weekday");
    const we = lowestPrice(h.hotelId, "weekend");
    const adr = hotelWeightedAdr(h.hotelId);
    const monthlyRevenue = h.roomCount !== null && adr !== null && tpkRate !== null ? Math.round(h.roomCount * DAYS_PER_MONTH * tpkRate * adr) : null;
    return {
      hotelId: h.hotelId,
      name: h.name,
      group: h.group,
      stars: compsetStars(h),
      roadKm: h.roadKm,
      driveMinutes: h.driveMinutes,
      countsInMarket: countsInMarket(h),
      compsetRole: h.compsetRole,
      isSanghyang: h.hotelId === SANGHYANG_HOTEL_ID,
      roomCount: h.roomCount,
      roomCountSource: h.roomCountSource,
      weekdayPrice: wd,
      weekendPrice: we,
      adr,
      monthlyRevenue,
    };
  });

  // Hanya Sanghyang dan pembanding inti yang masuk perhitungan total pasar; acuan tidak dihitung.
  const resortInside = calculated.filter((r) => r.countsInMarket && r.group === "resort" && r.monthlyRevenue !== null);
  const hotelInside = calculated.filter((r) => r.countsInMarket && r.group === "hotel" && r.monthlyRevenue !== null);
  const allInside = calculated.filter((r) => r.countsInMarket && r.monthlyRevenue !== null);

  const resortTotalRevenue = resortInside.reduce((sum, r) => sum + (r.monthlyRevenue ?? 0), 0);
  const resortTotalRooms = resortInside.reduce((sum, r) => sum + (r.roomCount ?? 0), 0);

  const hotelTotalRevenue = hotelInside.reduce((sum, r) => sum + (r.monthlyRevenue ?? 0), 0);
  const hotelTotalRooms = hotelInside.reduce((sum, r) => sum + (r.roomCount ?? 0), 0);

  const overallTotalRevenue = allInside.reduce((sum, r) => sum + (r.monthlyRevenue ?? 0), 0);
  const overallTotalRooms = allInside.reduce((sum, r) => sum + (r.roomCount ?? 0), 0);

  const sanghyangRow = calculated.find((r) => r.hotelId === SANGHYANG_HOTEL_ID);
  const sanghyangMonthlyRevenue = sanghyangRow?.monthlyRevenue ?? 0;
  const sanghyangResortSharePct = resortTotalRevenue > 0 ? Math.round((sanghyangMonthlyRevenue / resortTotalRevenue) * 10000) / 100 : 0;
  const sanghyangTotalSharePct = overallTotalRevenue > 0 ? Math.round((sanghyangMonthlyRevenue / overallTotalRevenue) * 10000) / 100 : 0;

  const allRows: PrecisionMarketShareRow[] = calculated.map((r) => {
    let marketShareGroupPct: number | null = null;
    let marketShareTotalPct: number | null = null;

    if (r.countsInMarket && r.monthlyRevenue !== null) {
      const groupPool = r.group === "resort" ? resortTotalRevenue : hotelTotalRevenue;
      marketShareGroupPct = groupPool > 0 ? Math.round((r.monthlyRevenue / groupPool) * 10000) / 100 : null;
      marketShareTotalPct = overallTotalRevenue > 0 ? Math.round((r.monthlyRevenue / overallTotalRevenue) * 10000) / 100 : null;
    }

    return {
      ...r,
      marketShareGroupPct,
      marketShareTotalPct,
    };
  });

  const filteredRows = groupFilter === "all" ? allRows : allRows.filter((r) => r.group === groupFilter);

  return {
    tpkRate,
    daysPerMonth: DAYS_PER_MONTH,
    filter: groupFilter,
    rows: filteredRows,
    totals: {
      resortRooms: resortTotalRooms,
      resortMonthlyRevenue: resortTotalRevenue,
      hotelRooms: hotelTotalRooms,
      hotelMonthlyRevenue: hotelTotalRevenue,
      overallRooms: overallTotalRooms,
      overallMonthlyRevenue: overallTotalRevenue,
      sanghyangMonthlyRevenue,
      sanghyangResortSharePct,
      sanghyangTotalSharePct,
    },
  };
}

export {
  getHotelCompset,
  getActiveCompetitors,
  getHotelRateTargets,
  getReviewTargets,
  getCompsetRateCoverage,
  getVenuesForOutlet,
  getCompetitorByPlaceId,
  getCompetitorById,
  type HotelCompsetItem,
  type CompsetRateCoverage,
  type HotelRateTarget,
  type ReviewTarget,
} from "./competitor-repository";
