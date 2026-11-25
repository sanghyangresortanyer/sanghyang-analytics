/**
 * Mesin pembobotan dan klasifikasi kompetitor holistik (6 dimensi berbobot, 0–100) untuk 6 outlet Sanghyang.
 *
 * Seluruh penilaian dihitung dari sinyal data bersumber (jarak jalan darat, konsep & suasana, komposisi menu atau tipe
 * kamar, fasilitas, skala ulasan Google, dan posisi harga terhadap Sanghyang) tanpa daftar nama tempat. Untuk Kamar &
 * Resort, setiap dimensi dibandingkan langsung dengan profil Sanghyang sendiri (konteks pembanding), dan ambang segmen
 * tarif diturunkan dari rentang tarif per malam Sanghyang pada jendela tanggal yang sama.
 *
 * `reclassifyRegistry` menilai ulang seluruh daftar kompetitor (dipakai langkah refresh dan skrip audit), dengan
 * menghormati keputusan pemakai/pemilik yang tercatat di kolom `retiredReason` atau `notes`. Kalimat keputusan tidak
 * pernah dibuang: bila `retiredReason` dikosongkan atau diganti, kalimat itu dipindah ke `notes`.
 */
import {
  COMPSET_MAX_ROAD_KM,
  MIN_LODGING_STARS,
  compsetIneligibility,
  isLodging,
  parseCompsetRole,
  type CompsetRole,
} from "./compset";
import { sanitizeAiModelText } from "./hotel-room-types";
import { OUTLET_KEYS, isOutletKey, type OutletKey } from "./outlet-filters";

export type HolisticDimensionKey =
  | "distance"
  | "concept"
  | "product"
  | "facilities"
  | "reputation"
  | "priceParity";

/** Bobot outlet F&B, bar, dan spa: konsep dan produk menu paling menentukan. */
export const HOLISTIC_DIMENSION_WEIGHTS: Record<HolisticDimensionKey, number> = {
  distance: 0.15,
  concept: 0.25,
  product: 0.2,
  facilities: 0.15,
  reputation: 0.1,
  priceParity: 0.15,
} as const;

/**
 * Bobot Kamar & Resort. Tamu resor membandingkan segmen tarif lebih dulu, lalu tipe kamar (unit 2 kamar tidur) dan
 * fasilitas; jarak di dalam koridor 25 km kurang menentukan karena tamu datang dari luar kota untuk memilih resor.
 */
export const HOLISTIC_LODGING_WEIGHTS: Record<HolisticDimensionKey, number> = {
  distance: 0.1,
  concept: 0.2,
  product: 0.2,
  facilities: 0.15,
  reputation: 0.1,
  priceParity: 0.25,
} as const;

export function holisticWeightsFor(outlet: OutletKey): Record<HolisticDimensionKey, number> {
  return outlet === "resort" ? HOLISTIC_LODGING_WEIGHTS : HOLISTIC_DIMENSION_WEIGHTS;
}

export const HOLISTIC_DIMENSION_LABELS: Record<HolisticDimensionKey, string> = {
  distance: "Kedekatan jarak jalan",
  concept: "Kesesuaian konsep & suasana",
  product: "Kemiripan menu & produk",
  facilities: "Fasilitas fisik & lingkungan",
  reputation: "Skala ulasan & reputasi",
  priceParity: "Kewajaran rasio harga",
} as const;

const LODGING_DIMENSION_LABELS: Record<HolisticDimensionKey, string> = {
  distance: "Kedekatan jarak jalan",
  concept: "Kesesuaian konsep resor",
  product: "Kemiripan tipe kamar",
  facilities: "Paritas fasilitas resor",
  reputation: "Skala ulasan & reputasi",
  priceParity: "Segmen tarif kamar",
} as const;

export function holisticDimensionLabel(key: HolisticDimensionKey, outlet: OutletKey): string {
  return outlet === "resort" ? LODGING_DIMENSION_LABELS[key] : HOLISTIC_DIMENSION_LABELS[key];
}

export const HOLISTIC_SCORE_THRESHOLDS = {
  core: 70,
  benchmark: 55,
} as const;

/**
 * Unit 2+ kamar tidur dianggap sebanding bila luasnya dalam ±50% rentang luas unit 2+ kamar tidur Sanghyang;
 * unit 30 m² dan unit 700 m² sama-sama bukan pengganti kondominium keluarga 60–115 m².
 */
const COMPARABLE_UNIT_AREA_TOLERANCE = 1.5;

export type HolisticDecision = "inti" | "benchmark" | "arsip";

export interface HolisticDimensionScore {
  key: HolisticDimensionKey;
  label: string;
  weight: number;
  score: number;
  weighted: number;
  reason: string;
}

export interface HolisticMenuItemSignal {
  name: string;
  category: string | null;
  price: number;
  priceMax?: number | null;
  unit?: string | null;
  /** "paket-bersama" atau "sewa-ruang" dari berkas data menu; bukan harga per porsi. */
  kind?: string;
}

export interface HolisticRoomProfileSignal {
  roomTypeCount: number;
  hasMultiBedroomUnit: boolean;
  multiBedroomCount: number;
  minAreaSqm: number | null;
  maxAreaSqm: number | null;
  hasSmartTv: boolean;
  hasBathtub: boolean;
}

/** Satu tipe kamar terverifikasi: jumlah kamar tidur dan luas (null bila sumber tidak menyebutkan). */
export interface HolisticRoomUnitSignal {
  bedrooms: number | null;
  areaSqm: number | null;
}

export interface HolisticFacilitySignal {
  smartTv?: boolean | null;
  bathtub?: boolean | null;
  infinityPool?: boolean | null;
  hotSpring?: boolean | null;
  designStyle?: string | null;
  ambience?: string | null;
  usp?: string | null;
  keyAmenities?: string[];
}

export interface HolisticCandidateInput {
  id?: string;
  name: string;
  category: string | null;
  placeId?: string | null;
  outlets?: string[];
  roadKm: number | null;
  driveMinutes?: number | null;
  starRating: number | null;
  roomCount?: number | null;
  rating: number | null;
  reviewCount: number | null;
  notes?: string | null;
  address?: string | null;
  googleType?: string | null;
  insideLodging?: boolean;
  parentName?: string | null;
  parentStarRating?: number | null;
  parentActive?: boolean | null;
  parentCompsetRole?: CompsetRole | null;
  factTexts?: string[];
  menuItems?: HolisticMenuItemSignal[];
  perPersonRange?: { min: number; max: number } | null;
  roomTypesProfile?: HolisticRoomProfileSignal | null;
  /** Rincian tipe kamar (kamar tidur & luas) untuk menghitung unit keluarga yang sebanding. */
  roomUnits?: HolisticRoomUnitSignal[] | null;
  /** Nama tipe kamar terverifikasi (mis. "Villa", "Town House"), dibaca sebagai sinyal konsep penginapan. */
  roomTypeNames?: string[];
  /** Kategori outlet di dalam penginapan ini (resto, bar, spa), dari daftar kompetitor. */
  childVenueCategories?: string[];
  facilities?: HolisticFacilitySignal | null;
  averagePriceIdr?: number | null;
  /** Tarif rata-rata terbobot dibagi tarif Sanghyang (1 = sama). */
  priceRatioVsOwn?: number | null;
}

export interface HolisticReferenceContext {
  /** Bintang hotel Sanghyang; outlet di dalamnya memakai nilai yang sama (mis. kesetaraan hotel induk D'Bistro). */
  ownStarRating?: number | null;
  ownRoomCount?: number | null;
  /** Kamar & Resort: tarif rata-rata terbobot Sanghyang; F&B: median harga menu resmi per porsi. */
  ownAveragePriceIdr?: number | null;
  ownRating?: number | null;
  ownReviewCount?: number | null;
  ownHasMultiBedroom?: boolean;
  /** Tarif OTA termurah Sanghyang per malam: hari biasa (min) dan akhir pekan (max) di jendela tanggal yang sama. */
  ownPriceBand?: { min: number; max: number } | null;
  /** Tipe kamar Sanghyang (kamar tidur & luas). */
  ownRoomUnits?: HolisticRoomUnitSignal[] | null;
  /** Fasilitas Sanghyang dari fakta situs resmi. */
  ownFacilities?: Pick<HolisticFacilitySignal, "smartTv" | "bathtub" | "infinityPool" | "hotSpring"> | null;
  /** Teks profil Sanghyang (deskripsi, konsep desain, catatan) untuk membaca sifat konsepnya. */
  ownProfileText?: string | null;
}

export interface HolisticScoreResult {
  outlet: OutletKey;
  score: number;
  decision: HolisticDecision;
  recommendedRole: CompsetRole | null;
  eligibleHardRules: boolean;
  hardRuleReason: string | null;
  dimensions: Record<HolisticDimensionKey, HolisticDimensionScore>;
  summary: string;
}

export interface ScoredCandidate {
  candidate: HolisticCandidateInput;
  result: HolisticScoreResult;
}

export interface ClassifiedOutletCompetitors {
  outlet: OutletKey;
  core: ScoredCandidate[];
  benchmark: ScoredCandidate[];
  archived: ScoredCandidate[];
  all: ScoredCandidate[];
}

export interface AutoClassifiedCandidate {
  candidate: HolisticCandidateInput;
  active: boolean;
  compsetRole: CompsetRole | null;
  outlets: OutletKey[];
  primaryOutlet: OutletKey | null;
  bestScore: number;
  retiredReason: string | null;
  scoresByOutlet: Record<OutletKey, HolisticScoreResult>;
}

const OUTLET_NAME: Record<OutletKey, string> = {
  resort: "Kamar & Resort",
  "sunset-grill": "Sunset Grill",
  "dragon-beach-club": "Dragon Beach Club",
  dbistro: "D'Bistro",
  dbar: "D'Bar & Karaoke",
  dspa: "D'Spa & Hot Spring",
};

const TOOL_MENTION_RE = /\b(crawl4ai|playwright)\b/gi;

function cleanText(text: string): string {
  return sanitizeAiModelText(text)
    .replace(TOOL_MENTION_RE, "")
    .replace(/\bpesaing\b/gi, (m) => (m[0] === "P" ? "Kompetitor" : "kompetitor"))
    .replace(/\bregistri(?:\s+pembanding|\s+kompetitor)?\b/gi, (m) =>
      m[0] === "R" ? "Daftar kompetitor" : "daftar kompetitor",
    )
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const clamp = (val: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(val)));
const round1 = (val: number) => Math.round(val * 10) / 10;
const num = (n: number) => n.toLocaleString("id-ID");
const rupiah = (n: number) => `Rp ${num(Math.round(n))}`;
const fmtArea = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
const listOf = (items: string[]) =>
  items.length <= 2 ? items.join(" dan ") : `${items.slice(0, -1).join(", ")}, dan ${items[items.length - 1]}`;
const areaRange = (areas: number[]) => {
  const min = Math.min(...areas);
  const max = Math.max(...areas);
  return min === max ? `${fmtArea(min)} m²` : `${fmtArea(min)}–${fmtArea(max)} m²`;
};

// Pola sinyal konsep, produk, dan fasilitas berbasis domain (tanpa nama properti)
const RE_BEACH_COAST =
  /\b(pantai|beach|beachfront|seaside|tepi laut|laut|sea|samudra|ocean|pasir|dermaga|karang|pesisir|selat sunda)\b/i;
const RE_OPEN_AIR_LOUNGE =
  /\b(open[- ]?air|open space|open beach|terbuka|bean ?bag|beanbag|saung|gazebo|terrace|teras|pool bar|swim[- ]?up|lounge|daybed)\b/i;
const RE_SUNSET_VIBE =
  /\b(sunset|senja|matahari terbenam|live music|akustik|acoustic|kongkow|chill)\b/i;
const RE_CAFE_COFFEE_MOCKTAIL =
  /\b(cafe|café|kafe|coffee|kopi|espresso|latte|cappuccino|mocktail|mojito|squash|smoothie|non[- ]?coffee)\b/i;
const RE_SEAFOOD_GRILL =
  /\b(seafood|boga bahari|ikan bakar|grill|grilled|bakar|udang|cumi|calamari|kepiting|lobster|kerapu|kakap)\b/i;
const RE_ROADSIDE_WARUNG =
  /\b(warung|rm\.?|rumah makan|pondok|warteg|kedai makan)\b/i;

const RE_NIGHTLIFE_CLUB =
  /\b(beach club|klub pantai|klub malam|nightclub|nightlife|hiburan malam|dj\b|disc jockey|party|pesta|dini hari|larut malam)\b/i;
const RE_BAR_COCKTAIL =
  /\b(pool bar|rooftop.*bar|sky lounge|\bbar\b|cocktail|cocktails|koktail|spirits|whiske?y|beer|\bbir\b|wine|long drinks?|liqueur|pub)\b/i;
const RE_LOUNGE_KARAOKE =
  /\b(lounge|karaoke|ktv|bernyanyi|hiburan|live music|musik)\b/i;
const RE_FAMILY_KARAOKE_ONLY =
  /\b(family karaoke|karaoke keluarga|family ktv)\b/i;
const RE_LOBBY_ONLY = /\b(lobi|lobby)\b/i;

const RE_ALL_DAY_DINING =
  /\b(all[- ]?day dining|sepanjang hari|sarapan|breakfast|buffet|prasmanan|nusantara|indonesia|internasional|international|pan[- ]?asian|asian|western|barat|gourmet|main course|restoran utama|signature dining)\b/i;
const RE_FOOD_ALACARTE =
  /\b(a la carte|pasta|pizza|nasi|rice|soup|sup|salad|burger|sandwich|main course|appetizer|indonesian|snacks?|makanan)\b/i;
const RE_SPA_WELLNESS =
  /\b(spa|wellness|massage|pijat|relaksasi|perawatan|treatment|reflexy|refleksi|aromaterapi|body scrub|lulur|hot spring|air panas)\b/i;
/** Jenis bangunan ruko (rumah toko) di alamat atau profil; nama kota tidak dipakai sebagai sinyal. */
const RE_SHOPHOUSE = /\b(ruko|rumah toko)\b/i;

/** Kalimat keputusan pemakai/pemilik tidak ikut dibaca sebagai sinyal konsep (namanya sering menyebut outlet). */
const RE_OWNER_DECISION = /\bkeputusan\s+(?:pemakai|pemilik)\b/i;
const RE_NEGATION = /\b(tidak|tanpa|belum|bukan)\b/i;

function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Teks tanpa kalimat keputusan pemakai/pemilik (dipakai untuk semua pembacaan sinyal). */
function withoutDecisions(text: string): string {
  return splitClauses(text)
    .filter((s) => !RE_OWNER_DECISION.test(s))
    .join(" ");
}

function menuCorpusOf(c: HolisticCandidateInput): string {
  return (c.menuItems ?? []).map((m) => `${m.category ?? ""} ${m.name}`).join(" ");
}

function profileCorpusOf(c: HolisticCandidateInput): string {
  const factText = (c.factTexts ?? []).join(" ");
  const facText = [
    c.facilities?.designStyle,
    c.facilities?.ambience,
    c.facilities?.usp,
    ...(c.facilities?.keyAmenities ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return withoutDecisions([c.name, c.googleType, c.notes, c.address, factText, facText].filter(Boolean).join(" "));
}

/**
 * Pemeriksaan kecocokan domain struktural antara kandidat dan outlet target sebelum menghitung skor dimensi.
 */
function domainIneligibility(c: HolisticCandidateInput, outlet: OutletKey): string | null {
  const cat = (c.category ?? "").toLowerCase();
  const profile = profileCorpusOf(c);
  const menuText = menuCorpusOf(c);
  const full = `${profile} ${menuText}`;

  if (outlet === "resort") {
    if (!isLodging(cat)) return `Kategori "${c.category ?? "non-hotel"}" bukan properti penginapan Kamar & Resort.`;
    if (c.starRating !== null && c.starRating < MIN_LODGING_STARS) {
      return `Bintang ${c.starRating}, di bawah standar minimum bintang ${MIN_LODGING_STARS} penginapan sejenis Sanghyang.`;
    }
    if (/\b(timeshare|vacation club|keanggotaan)\b/i.test(profile)) {
      return "Properti keanggotaan timeshare/klub liburan bukan hotel/resor komersial sejenis.";
    }
    return null;
  }

  if (isLodging(cat)) {
    return "Properti induk penginapan dinilai pada Kamar & Resort, bukan sebagai venue F&B/Bar/Spa.";
  }

  if (outlet === "dspa") {
    if (cat === "spa") return null;
    if (cat === null || cat === "") {
      const ownNameType = [c.name, c.googleType].filter(Boolean).join(" ");
      if (/\b(spa|massage|pijat|reflexy|refleksi|hot spring)\b/i.test(ownNameType)) return null;
    }
    return `Bukan venue spa atau relaksasi untuk dibandingkan dengan ${OUTLET_NAME.dspa}.`;
  }

  if (cat === "spa") {
    return "Venue spa hanya dibandingkan dengan D'Spa & Hot Spring.";
  }

  if (outlet === "dbistro") {
    if (!c.insideLodging) {
      return "Tempat mandiri di luar hotel tidak dibandingkan dengan D'Bistro (restoran utama di dalam hotel).";
    }
    const isDining =
      cat === "resto" || /\b(restaurant|restoran|resto|dining|cafe|café|bistro)\b/i.test(`${c.name} ${c.notes ?? ""}`);
    if (!isDining) {
      return "Venue hotel ini bukan restoran tempat makan (all-day dining) pembanding D'Bistro.";
    }
    return null;
  }

  if (outlet === "sunset-grill") {
    if (c.insideLodging) {
      if (cat === "resto") {
        return "Restoran di dalam hotel merupakan kompetitor D'Bistro, bukan Sunset Grill.";
      }
      // Bar kolam/pantai terbuka di dalam resor hanya masuk Sunset Grill bila punya konsep open-air pool/beach bar + sajian makanan/a la carte
      const isOpenAirPoolFoodBar =
        cat === "bar" &&
        /\b(pool bar|swim[- ]?up|beach bar)\b/i.test(profile) &&
        (RE_FOOD_ALACARTE.test(full) || (c.menuItems?.length ?? 0) >= 15);
      if (!isOpenAirPoolFoodBar) {
        return "Bar/lounge hotel tanpa konsep open-air pool/beach dining & menu a la carte tidak masuk Sunset Grill.";
      }
      return null;
    }
    if (cat !== "resto" && !(cat === "bar" && RE_BEACH_COAST.test(profile) && RE_FOOD_ALACARTE.test(full))) {
      return "Bukan restoran, beach cafe, atau sunset lounge yang sejenis dengan Sunset Grill.";
    }
    return null;
  }

  if (outlet === "dragon-beach-club") {
    if (c.insideLodging && cat === "resto") {
      return "Restoran all-day dining di dalam hotel merupakan kompetitor D'Bistro, bukan Dragon Beach Club.";
    }
    if (cat === "resto") {
      // Restoran/kafe mandiri hanya masuk DBC bila daftar kompetitor, fakta resmi, atau menunya menyebut klub malam/bar
      // alkohol. Label gaya dari pembacaan foto ("tropical beach club") tidak cukup: kafe pantai tanpa alkohol tetap
      // kompetitor Sunset Grill (keputusan pemakai 20 Nov 2026).
      const factual = withoutDecisions(
        [c.name, c.googleType, c.notes, ...(c.factTexts ?? [])].filter(Boolean).join(" "),
      );
      const hasTrueClubOrBar =
        RE_NIGHTLIFE_CLUB.test(factual) ||
        /\b(cocktails?|koktail|spirits|whiske?y|beer|\bbir\b|wine)\b/i.test(`${factual} ${menuText}`);
      if (!hasTrueClubOrBar) {
        return "Restoran/kafe pantai tanpa fasilitas bar koktail atau hiburan klub malam diklasifikasikan ke Sunset Grill.";
      }
    }
    if (cat === "bar") {
      if (c.insideLodging) {
        return "Bar/lounge di dalam hotel merupakan fasilitas tamu hotel yang diklasifikasikan ke D'Bar & Karaoke atau D'Bistro, bukan klub malam/beach club mandiri kompetitor Dragon Beach Club.";
      }
      const hasNightlifeOrBeachClub =
        RE_NIGHTLIFE_CLUB.test(profile) ||
        RE_BEACH_COAST.test(profile) ||
        /\b(pool bar|rooftop|beach club)\b/i.test(profile);
      if (!hasNightlifeOrBeachClub) {
        return "Venue karaoke/bar perkotaan tanpa konsep klub malam atau pantai diklasifikasikan ke D'Bar & Karaoke.";
      }
    }
    if (cat !== "bar" && cat !== "resto") {
      return "Bukan venue beach club, bar, atau hiburan malam.";
    }
    return null;
  }

  if (outlet === "dbar") {
    if (cat !== "bar") {
      return "Bukan venue bar, lounge, atau karaoke pembanding D'Bar & Karaoke.";
    }
    return null;
  }

  return null;
}

function scoreDistance(roadKm: number | null): { score: number; reason: string } {
  if (roadKm === null || !Number.isFinite(roadKm)) {
    return { score: 0, reason: "Jarak tempuh jalan darat belum terukur." };
  }
  if (roadKm > COMPSET_MAX_ROAD_KM) {
    return { score: 0, reason: `Jarak ${num(roadKm)} km melampaui radius ${COMPSET_MAX_ROAD_KM} km.` };
  }
  let raw = 100;
  if (roadKm <= 3) {
    raw = 100;
  } else if (roadKm <= 8) {
    raw = 100 - ((roadKm - 3) / 5) * 10; // 100 -> 90
  } else if (roadKm <= 15) {
    raw = 90 - ((roadKm - 8) / 7) * 15; // 90 -> 75
  } else if (roadKm <= 20) {
    raw = 75 - ((roadKm - 15) / 5) * 20; // 75 -> 55
  } else {
    raw = 55 - ((roadKm - 20) / 5) * 20; // 55 -> 35
  }
  const score = clamp(raw);
  const band = roadKm <= 5 ? "sangat dekat" : roadKm <= 12 ? "dekat" : roadKm <= 20 ? "menengah" : "batas luar koridor";
  return {
    score,
    reason: `Jarak jalan ${num(roadKm)} km (${band}, <= ${COMPSET_MAX_ROAD_KM} km).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Kamar & Resort: setiap dimensi dibandingkan dengan profil Sanghyang sendiri.
// ---------------------------------------------------------------------------------------------------------------

interface LodgingTraitSource {
  text: string;
  hotSpring: boolean | null;
  hasPoolFact: boolean;
  childVenueCategories: string[];
}

/** Pemetaan sifat konsep resor; sifat dibaca dari kalimat positif saja (kalimat berisi "tidak/tanpa" diabaikan). */
const LODGING_TRAITS: { key: string; label: string; has: (s: LodgingTraitSource) => boolean }[] = [
  {
    key: "pantai",
    label: "tepi pantai",
    has: (s) => /\b(pantai|beach|beachfront|tepi laut|pesisir|seaside|selat sunda|ocean|samudra)\b/i.test(s.text),
  },
  {
    key: "vila",
    label: "unit vila/kondominium keluarga",
    has: (s) =>
      /\b(vila|villa|villas|cottage|cottages|condo|kondominium|apartemen|apartment|town ?house|kabin|cabin|bungalow|family suites?)\b/i.test(
        s.text,
      ),
  },
  {
    key: "alam",
    label: "taman tropis asri",
    has: (s) => /\b(tropis|tropical|asri|hijau|pohon|kelapa|jati|taman|garden|rindang|hektar)\b/i.test(s.text),
  },
  {
    key: "airPanas",
    label: "air panas alami",
    has: (s) => s.hotSpring === true || /\b(air panas alami|mata air panas|natural hot spring)\b/i.test(s.text),
  },
  {
    key: "spa",
    label: "spa",
    has: (s) => s.childVenueCategories.includes("spa") || /\b(spa|wellness)\b/i.test(s.text),
  },
  {
    key: "kolam",
    label: "kolam renang/laguna",
    has: (s) => s.hasPoolFact || /\b(kolam|pool|laguna|lagoon)\b/i.test(s.text),
  },
];

function positiveText(text: string): string {
  return splitClauses(withoutDecisions(text))
    .filter((s) => !RE_NEGATION.test(s))
    .join(" ");
}

function lodgingTraitsOf(source: LodgingTraitSource): Set<string> {
  return new Set(LODGING_TRAITS.filter((t) => t.has(source)).map((t) => t.key));
}

function candidateTraitSource(c: HolisticCandidateInput): LodgingTraitSource {
  return {
    text: positiveText([profileCorpusOf(c), ...(c.roomTypeNames ?? [])].join(". ")),
    hotSpring: c.facilities?.hotSpring ?? null,
    hasPoolFact: c.facilities?.infinityPool !== null && c.facilities?.infinityPool !== undefined,
    childVenueCategories: c.childVenueCategories ?? [],
  };
}

function ownTraitSource(ref: HolisticReferenceContext): LodgingTraitSource {
  return {
    text: positiveText(ref.ownProfileText ?? ""),
    hotSpring: ref.ownFacilities?.hotSpring ?? null,
    hasPoolFact: ref.ownFacilities?.infinityPool !== null && ref.ownFacilities?.infinityPool !== undefined,
    childVenueCategories: [],
  };
}

const traitLabel = (key: string) => LODGING_TRAITS.find((t) => t.key === key)?.label ?? key;

function scoreLodgingConcept(c: HolisticCandidateInput, ref?: HolisticReferenceContext): { score: number; reason: string } {
  const notes: string[] = [];
  let score: number;
  const own = ref?.ownProfileText ? lodgingTraitsOf(ownTraitSource(ref)) : new Set<string>();
  if (own.size === 0) {
    score = 60;
    notes.push("profil konsep Sanghyang belum dimuat, jadi kesamaan konsep dinilai netral");
  } else {
    const cand = lodgingTraitsOf(candidateTraitSource(c));
    const shared = [...own].filter((k) => cand.has(k));
    const missing = [...own].filter((k) => !cand.has(k));
    score = 40 + (60 * shared.length) / own.size;
    if (shared.length) notes.push(`sama-sama ${listOf(shared.map(traitLabel))}`);
    if (missing.length) notes.push(`tanpa ${listOf(missing.map(traitLabel))} seperti Sanghyang`);
  }
  const ownStar = ref?.ownStarRating ?? null;
  if (ownStar !== null && c.starRating !== null && c.starRating > ownStar) {
    score -= 25;
    notes.push(`kelas bintang ${c.starRating} di atas bintang ${ownStar} Sanghyang`);
  }
  return { score: clamp(score), reason: `Konsep resor: ${notes.join("; ")}.` };
}

function multiBedroomUnits(units: HolisticRoomUnitSignal[]): HolisticRoomUnitSignal[] {
  return units.filter((u) => (u.bedrooms ?? 0) >= 2);
}

function ownComparableAreaBounds(ref?: HolisticReferenceContext): { min: number; max: number } | null {
  const areas = multiBedroomUnits(ref?.ownRoomUnits ?? [])
    .map((u) => u.areaSqm)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  if (!areas.length) return null;
  return {
    min: Math.min(...areas) / COMPARABLE_UNIT_AREA_TOLERANCE,
    max: Math.max(...areas) * COMPARABLE_UNIT_AREA_TOLERANCE,
  };
}

function scoreLodgingProduct(c: HolisticCandidateInput, ref?: HolisticReferenceContext): { score: number; reason: string } {
  const units =
    c.roomUnits && c.roomUnits.length > 0
      ? c.roomUnits
      : null;
  const ownUnits = ref?.ownRoomUnits ?? [];
  const ownMulti = multiBedroomUnits(ownUnits);
  if (!units) {
    const rt = c.roomTypesProfile;
    if (!rt || rt.roomTypeCount === 0) return { score: 60, reason: "Rincian tipe kamar belum ada di sumber resmi maupun OTA." };
    if (!rt.hasMultiBedroomUnit) {
      return { score: 40, reason: `Hanya kamar 1 ruang (${rt.roomTypeCount} tipe), tanpa unit 2 kamar tidur seperti Sanghyang.` };
    }
    return { score: 60, reason: `${rt.multiBedroomCount} dari ${rt.roomTypeCount} tipe kamar adalah unit 2+ kamar tidur; luasnya belum tercatat.` };
  }
  const multi = multiBedroomUnits(units);
  if (multi.length === 0) {
    return { score: 40, reason: `Hanya kamar 1 ruang (${units.length} tipe), tanpa unit 2 kamar tidur seperti Sanghyang.` };
  }
  const bounds = ownComparableAreaBounds(ref);
  const comparable = bounds
    ? multi.filter((u) => u.areaSqm !== null && u.areaSqm >= bounds.min && u.areaSqm <= bounds.max)
    : multi;
  const ownShare = ownUnits.length > 0 ? ownMulti.length / ownUnits.length : null;
  const ownNote = ownShare !== null ? ` (Sanghyang ${ownMulti.length} dari ${ownUnits.length} tipe)` : "";
  if (comparable.length === 0) {
    const areas = multi.map((u) => u.areaSqm).filter((n): n is number => n !== null);
    const areaNote = areas.length ? ` seluas ${areaRange(areas)}` : " tanpa luas tercatat";
    return {
      score: 50,
      reason: `Punya ${multi.length} unit 2+ kamar tidur${areaNote}, tidak sebanding dengan unit keluarga Sanghyang${ownNote}.`,
    };
  }
  const share = comparable.length / units.length;
  const ratio = ownShare && ownShare > 0 ? Math.min(1, share / ownShare) : 1;
  const areas = comparable.map((u) => u.areaSqm).filter((n): n is number => n !== null);
  const areaNote = areas.length ? ` seluas ${areaRange(areas)}` : "";
  return {
    score: clamp(45 + 55 * ratio),
    reason: `${comparable.length} dari ${units.length} tipe kamar adalah unit 2+ kamar tidur${areaNote} yang sebanding${ownNote}.`,
  };
}

const LODGING_FACILITY_LABELS: Record<"hotSpring" | "infinityPool" | "bathtub" | "smartTv" | "beach", string> = {
  hotSpring: "air panas alami",
  infinityPool: "kolam infinity/laut",
  bathtub: "bathtub",
  smartTv: "Smart TV",
  beach: "akses pantai",
};

function scoreLodgingFacilities(c: HolisticCandidateInput, ref?: HolisticReferenceContext): { score: number; reason: string } {
  const ownFac = ref?.ownFacilities ?? null;
  const ownBeach = ref?.ownProfileText ? lodgingTraitsOf(ownTraitSource(ref)).has("pantai") : null;
  const candBeach = lodgingTraitsOf(candidateTraitSource(c)).has("pantai");
  const pairs: { key: keyof typeof LODGING_FACILITY_LABELS; own: boolean | null; cand: boolean | null }[] = [
    { key: "hotSpring", own: ownFac?.hotSpring ?? null, cand: c.facilities?.hotSpring ?? null },
    { key: "infinityPool", own: ownFac?.infinityPool ?? null, cand: c.facilities?.infinityPool ?? null },
    { key: "bathtub", own: ownFac?.bathtub ?? null, cand: c.facilities?.bathtub ?? c.roomTypesProfile?.hasBathtub ?? null },
    { key: "smartTv", own: ownFac?.smartTv ?? null, cand: c.facilities?.smartTv ?? null },
    { key: "beach", own: ownBeach, cand: candBeach },
  ];
  const known = pairs.filter((p) => p.own !== null && p.cand !== null);
  if (known.length === 0) return { score: 60, reason: "Fakta fasilitas belum cukup untuk dibandingkan dengan Sanghyang." };
  const same = known.filter((p) => p.own === p.cand && p.own === true).map((p) => LODGING_FACILITY_LABELS[p.key]);
  const lacks = known.filter((p) => p.own === true && p.cand === false).map((p) => LODGING_FACILITY_LABELS[p.key]);
  const extra = known.filter((p) => p.own === false && p.cand === true).map((p) => LODGING_FACILITY_LABELS[p.key]);
  const matches = known.filter((p) => p.own === p.cand).length;
  const parts: string[] = [];
  if (same.length) parts.push(`sama-sama punya ${listOf(same)}`);
  if (lacks.length) parts.push(`tanpa ${listOf(lacks)}`);
  if (extra.length) parts.push(`punya ${listOf(extra)} yang belum dimiliki Sanghyang`);
  return {
    score: clamp(40 + (60 * matches) / known.length),
    reason: `Fasilitas: ${parts.join("; ") || "setara"}.`,
  };
}

export interface LodgingPriceSegment {
  position: "dalam" | "di atas" | "di bawah";
  ratio: number;
  /** Batas bawah dan atas segmen sebagai rasio terhadap tarif rata-rata Sanghyang. */
  low: number;
  high: number;
}

/** Posisi tarif rata-rata kandidat terhadap rentang tarif termurah Sanghyang sendiri; null bila datanya belum ada. */
export function lodgingPriceSegment(
  ratio: number | null | undefined,
  ref?: HolisticReferenceContext,
): LodgingPriceSegment | null {
  const band = ref?.ownPriceBand;
  const own = ref?.ownAveragePriceIdr;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) return null;
  if (!band || !own || band.min <= 0 || band.max < band.min) return null;
  const low = band.min / own;
  const high = band.max / own;
  return { position: ratio > high ? "di atas" : ratio < low ? "di bawah" : "dalam", ratio, low, high };
}

function scoreLodgingPrice(c: HolisticCandidateInput, ref?: HolisticReferenceContext): { score: number; reason: string } {
  const ratio = c.priceRatioVsOwn ?? null;
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) {
    return { score: 60, reason: "Tarif OTA tempat ini belum terbaca, jadi segmen tarifnya belum bisa dibandingkan." };
  }
  const pct = Math.round(ratio * 100);
  const seg = lodgingPriceSegment(ratio, ref);
  if (!seg || !ref?.ownPriceBand) {
    return { score: 60, reason: `Tarif rata-rata ${pct}% dari Sanghyang; rentang tarif Sanghyang belum terbaca.` };
  }
  const lnR = Math.log(ratio);
  const upWidth = Math.log(seg.high);
  const downWidth = -Math.log(seg.low);
  const segmentWidth = Math.log(seg.high / seg.low);
  let score: number;
  if (seg.position === "dalam") {
    const side = lnR >= 0 ? upWidth : downWidth;
    score = side > 0 ? 100 - (20 * Math.abs(lnR)) / side : 100;
  } else {
    const excess = seg.position === "di atas" ? lnR - upWidth : -lnR - downWidth;
    score = segmentWidth > 0 ? 80 * (1 - excess / segmentWidth) : 0;
  }
  const band = `${rupiah(ref.ownPriceBand.min)}–${rupiah(ref.ownPriceBand.max)}`;
  return {
    score: clamp(score),
    reason: `Tarif rata-rata ${pct}% dari Sanghyang, ${seg.position} rentang tarif termurah Sanghyang hari biasa–akhir pekan (${band}).`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Outlet F&B, bar, dan spa
// ---------------------------------------------------------------------------------------------------------------

function scoreConcept(
  c: HolisticCandidateInput,
  outlet: OutletKey,
  ref?: HolisticReferenceContext,
): { score: number; reason: string } {
  if (outlet === "resort") return scoreLodgingConcept(c, ref);

  const profile = profileCorpusOf(c);
  const menuText = menuCorpusOf(c);
  const full = `${profile} ${menuText}`;

  if (outlet === "sunset-grill") {
    let score = 34;
    const cues: string[] = [];
    const hasBeach = RE_BEACH_COAST.test(profile);
    const hasOpenAir = RE_OPEN_AIR_LOUNGE.test(profile);
    const hasSunset = RE_SUNSET_VIBE.test(profile);
    const hasCafe = RE_CAFE_COFFEE_MOCKTAIL.test(full);
    const hasSeafood = RE_SEAFOOD_GRILL.test(full);
    const isRoadsideWarung = RE_ROADSIDE_WARUNG.test(c.name) && !hasOpenAir && !hasCafe;

    if (hasBeach) {
      score += 24;
      cues.push("lokasi tepi pantai/laut");
    }
    if (hasOpenAir) {
      score += 20;
      cues.push("konsep open-air/lounge/pool bar");
    }
    if (hasSunset) {
      score += 12;
      cues.push("suasana sunset/live music");
    }
    if (hasCafe) {
      score += 10;
      cues.push("sajian kafe/kopi/mocktail");
    }
    if (hasSeafood) {
      score += 8;
      cues.push("boga bahari/grill");
    }
    if (isRoadsideWarung) {
      score -= 14;
      cues.push("format rumah makan/warung konvensional tanpa beach lounge");
    }

    return {
      score: clamp(score),
      reason: cues.length
        ? `Konsep terhadap Sunset Grill: ${cues.join(", ")}.`
        : "Restoran pesisir tanpa sinyal open-air sunset lounge.",
    };
  }

  if (outlet === "dragon-beach-club") {
    let score = 26;
    const cues: string[] = [];
    const hasNightlife = RE_NIGHTLIFE_CLUB.test(profile);
    const hasBarCocktail = RE_BAR_COCKTAIL.test(full);
    const hasLoungeKaraoke = RE_LOUNGE_KARAOKE.test(profile);
    const hasCoastalOpen = RE_BEACH_COAST.test(profile) || RE_OPEN_AIR_LOUNGE.test(profile) || /\b(rooftop|360)\b/i.test(profile);
    const isFamilyKtvOnly = RE_FAMILY_KARAOKE_ONLY.test(profile) && !hasNightlife && !hasCoastalOpen;
    const isLobbyLoungeOnly = RE_LOBBY_ONLY.test(profile) && !hasNightlife && !/\b(pool|beach|rooftop|karaoke)\b/i.test(profile);

    if (hasNightlife) {
      score += 34;
      cues.push("hiburan malam/klub/DJ");
    }
    if (hasBarCocktail) {
      score += 24;
      cues.push("bar/pool bar & minuman racikan");
    }
    if (hasLoungeKaraoke) {
      score += 14;
      cues.push("lounge & hiburan musik/karaoke");
    }
    if (hasCoastalOpen) {
      score += 14;
      cues.push("area pantai/kolam/rooftop");
    }
    if (isFamilyKtvOnly) {
      score -= 22;
      cues.push("karaoke keluarga ruko/kota (lebih spesifik ke D'Bar)");
    }
    if (isLobbyLoungeOnly) {
      score -= 18;
      cues.push("lounge lobi hotel tenang");
    }

    return {
      score: clamp(score),
      reason: cues.length
        ? `Konsep terhadap Dragon Beach Club: ${cues.join(", ")}.`
        : "Kurang memiliki karakter beach club, bar koktail, atau hiburan malam.",
    };
  }

  if (outlet === "dbistro") {
    let score = 68;
    const cues: string[] = ["restoran di dalam hotel kompetitor"];
    if (RE_ALL_DAY_DINING.test(full)) {
      score += 20;
      cues.push("all-day dining Nusantara/Asia/Barat");
    }
    const ownStar = ref?.ownStarRating ?? null;
    if (ownStar !== null && c.parentStarRating === ownStar) {
      score += 8;
      cues.push(`hotel induk bintang ${ownStar} setara`);
    }
    return {
      score: clamp(score),
      reason: `Konsep terhadap D'Bistro: ${cues.join(", ")}.`,
    };
  }

  if (outlet === "dbar") {
    let score = 50;
    const cues: string[] = [];
    if (/\b(karaoke|ktv)\b/i.test(full)) {
      score += 26;
      cues.push("fasilitas ruang karaoke");
    }
    if (/\b(lounge|bar|pool bar|rooftop|klub malam)\b/i.test(profile)) {
      score += 20;
      cues.push("bar & lounge santai");
    }
    if (c.insideLodging) {
      score += 8;
      cues.push("terintegrasi di dalam resor/hotel");
    }
    return {
      score: clamp(score),
      reason: cues.length ? `Konsep terhadap D'Bar & Karaoke: ${cues.join(", ")}.` : "Venue bar/hiburan.",
    };
  }

  // dspa
  let score = 52;
  const cues: string[] = [];
  if (RE_SPA_WELLNESS.test(full)) {
    score += 24;
    cues.push("layanan spa & pijat relaksasi");
  }
  if (c.insideLodging) {
    score += 18;
    cues.push("spa resor/hotel");
  } else if (RE_SHOPHOUSE.test(profile)) {
    score -= 8;
    cues.push("spa/refleksi ruko perkotaan");
  }
  return {
    score: clamp(score),
    reason: cues.length ? `Konsep terhadap D'Spa: ${cues.join(", ")}.` : "Layanan spa & kebugaran.",
  };
}

function scoreProduct(
  c: HolisticCandidateInput,
  outlet: OutletKey,
  ref?: HolisticReferenceContext,
): { score: number; reason: string } {
  if (outlet === "resort") return scoreLodgingProduct(c, ref);

  const profile = profileCorpusOf(c);
  const menuText = menuCorpusOf(c);
  const full = `${profile} ${menuText}`;
  const itemCount = c.menuItems?.length ?? 0;

  if (outlet === "sunset-grill") {
    const hasCoffeeOrMocktail = RE_CAFE_COFFEE_MOCKTAIL.test(full);
    const hasSeafoodOrGrill = RE_SEAFOOD_GRILL.test(full);
    const hasAlaCarte = RE_FOOD_ALACARTE.test(full);

    if (itemCount > 0) {
      let score = 60 + Math.min(16, Math.round(itemCount / 5));
      const parts: string[] = [`${itemCount} menu tercatat`];
      if (hasCoffeeOrMocktail) {
        score += 12;
        parts.push("kopi/mocktail/minuman kafe");
      }
      if (hasSeafoodOrGrill || hasAlaCarte) {
        score += 10;
        parts.push(hasSeafoodOrGrill ? "boga bahari/grill" : "hidangan a la carte");
      }
      return { score: clamp(score), reason: `Produk menu: ${parts.join(", ")}.` };
    }

    let score = 40;
    const parts: string[] = [];
    if (hasCoffeeOrMocktail) {
      score += 20;
      parts.push("kopi/minuman kafe");
    }
    if (hasSeafoodOrGrill || hasAlaCarte || (RE_BEACH_COAST.test(profile) && /\b(kuliner|resto|cafe)\b/i.test(profile))) {
      score += 16;
      parts.push("sajian kuliner pantai/seafood");
    }
    if (c.perPersonRange) {
      score += 8;
      parts.push("kisaran harga Maps tercatat");
    }
    return {
      score: clamp(score),
      reason: parts.length ? `Indikasi produk: ${parts.join(", ")}.` : "Belum ada bukti daftar menu kopi/mocktail/seafood terpublikasi.",
    };
  }

  if (outlet === "dragon-beach-club") {
    const hasCocktailsOrAlcohol = /\b(cocktails?|koktail|spirits|whiske?y|beer|\bbir\b|wine|long drinks?|minuman kreatif|minuman racikan)\b/i.test(full);
    const hasMocktailOrDrinks = /\b(mocktails?|mojito|minuman|beverages?|drinks?)\b/i.test(full);
    const hasSnacksOrPizza = /\b(snacks?|camilan|pizza|pasta|light bites|bar|restoran|resto)\b/i.test(full);
    const hasMusicOrKaraoke = /\b(dj|live music|musik|karaoke|hiburan malam|klub malam)\b/i.test(full);

    let score = 42;
    const parts: string[] = [];
    if (hasCocktailsOrAlcohol) {
      score += 26;
      parts.push("koktail/minuman bar");
    } else if (hasMocktailOrDrinks || RE_NIGHTLIFE_CLUB.test(full)) {
      score += 16;
      parts.push("minuman lounge/klub");
    }
    if (hasMusicOrKaraoke) {
      score += 20;
      parts.push("hiburan musik/karaoke/malam");
    }
    if (hasSnacksOrPizza) {
      score += 10;
      parts.push("sajian makanan/camilan bar");
    }
    if (itemCount >= 10) {
      score += 8;
      parts.push(`${itemCount} item menu`);
    } else if (c.perPersonRange) {
      score += 6;
      parts.push("kisaran belanja tercatat");
    }
    return {
      score: clamp(score),
      reason: parts.length ? `Produk hiburan & bar: ${parts.join(", ")}.` : "Produk belum mencerminkan sajian beach club / bar malam.",
    };
  }

  if (outlet === "dbistro") {
    let score = 62;
    const parts: string[] = [];
    if (itemCount > 0) {
      score += Math.min(24, 10 + Math.round(itemCount / 3));
      parts.push(`${itemCount} item menu terpublikasi`);
    } else if (c.perPersonRange) {
      score += 10;
      parts.push("kisaran belanja per orang tercatat");
    }
    if (RE_ALL_DAY_DINING.test(full)) {
      score += 12;
      parts.push("masakan Nusantara/Asia/Barat");
    }
    return {
      score: clamp(score),
      reason: parts.length ? `Produk restoran hotel: ${parts.join(", ")}.` : "Menu restoran hotel.",
    };
  }

  if (outlet === "dbar") {
    let score = 56;
    const parts: string[] = [];
    if (/\b(sewa ruang|karaoke|paket)\b/i.test(full)) {
      score += 20;
      parts.push("paket ruang karaoke/hiburan");
    }
    if (/\b(cocktails?|koktail|mocktails?|coffee|kopi|minuman|beverages?)\b/i.test(full)) {
      score += 14;
      parts.push("minuman bar/lounge");
    }
    if (itemCount > 0) {
      score += Math.min(12, Math.round(itemCount / 5));
      parts.push(`${itemCount} item menu`);
    }
    return {
      score: clamp(score),
      reason: parts.length ? `Produk bar & karaoke: ${parts.join(", ")}.` : "Layanan bar & karaoke.",
    };
  }

  // dspa
  let score = 58;
  const parts: string[] = [];
  if (itemCount > 0) {
    score += Math.min(26, 12 + itemCount);
    parts.push(`${itemCount} paket perawatan tercatat`);
  }
  if (/\b(massage|pijat|ritual|wellness|relaksasi|aromaterapi|lulur)\b/i.test(full)) {
    score += 14;
    parts.push("perawatan tubuh & pijat tradisional");
  }
  return {
    score: clamp(score),
    reason: parts.length ? `Produk perawatan spa: ${parts.join(", ")}.` : "Layanan perawatan spa.",
  };
}

function scoreFacilities(
  c: HolisticCandidateInput,
  outlet: OutletKey,
  ref?: HolisticReferenceContext,
): { score: number; reason: string } {
  if (outlet === "resort") return scoreLodgingFacilities(c, ref);

  const profile = profileCorpusOf(c);

  if (outlet === "sunset-grill") {
    let score = 32;
    const list: string[] = [];
    if (RE_BEACH_COAST.test(profile)) {
      score += 28;
      list.push("area tepi pantai/laut");
    }
    if (RE_OPEN_AIR_LOUNGE.test(profile)) {
      score += 24;
      list.push("tempat duduk terbuka/bean bag/gazebo/pool bar");
    }
    if (RE_SUNSET_VIBE.test(profile)) {
      score += 14;
      list.push("panggung live music/panorama sunset");
    }
    return {
      score: clamp(score),
      reason: list.length ? `Fasilitas fisik: ${list.join(", ")}.` : "Bangunan rumah makan biasa tanpa area terbuka tepi pantai.",
    };
  }

  if (outlet === "dragon-beach-club") {
    let score = 44;
    const list: string[] = [];
    if (RE_BEACH_COAST.test(profile) || /\b(pool|kolam|rooftop|360)\b/i.test(profile)) {
      score += 24;
      list.push("area pantai/kolam/rooftop");
    }
    if (/\b(lounge|bar|klub malam|karaoke|live music|dj)\b/i.test(profile)) {
      score += 26;
      list.push("area lounge/bar/panggung hiburan");
    }
    if (c.insideLodging) {
      score += 8;
      list.push("fasilitas resor terpadu");
    }
    return {
      score: clamp(score),
      reason: list.length ? `Fasilitas hiburan: ${list.join(", ")}.` : "Fasilitas standar tempat makan/minum.",
    };
  }

  if (outlet === "dbistro") {
    let score = 74;
    const list: string[] = ["ruang makan hotel/resor"];
    if (RE_BEACH_COAST.test(profile) || /\b(overwater|ocean|samudra|lagoon)\b/i.test(profile)) {
      score += 12;
      list.push("pemandangan laut/laguna");
    }
    if (/\b(400 kursi|buffet|indoor|teras)\b/i.test(profile)) {
      score += 8;
      list.push("kapasitas keluarga & grup");
    }
    return { score: clamp(score), reason: `Fasilitas restoran: ${list.join(", ")}.` };
  }

  if (outlet === "dbar") {
    let score = 64;
    const list: string[] = [];
    if (/\b(karaoke|ktv)\b/i.test(profile)) {
      score += 18;
      list.push("ruang karaoke");
    }
    if (/\b(lounge|bar|pool bar|rooftop)\b/i.test(profile)) {
      score += 14;
      list.push("area duduk lounge/bar");
    }
    return {
      score: clamp(score),
      reason: list.length ? `Fasilitas fisik: ${list.join(", ")}.` : "Fasilitas bar & hiburan.",
    };
  }

  // dspa
  let score = 58;
  const list: string[] = [];
  if (c.insideLodging) {
    score += 26;
    list.push("ruang perawatan spa di dalam kawasan resor/hotel");
  } else {
    score -= 6;
    list.push("ruang pijat/refleksi mandiri di luar resor");
  }
  return { score: clamp(score), reason: `Fasilitas spa: ${list.join(", ")}.` };
}

function scoreReputation(
  c: HolisticCandidateInput,
  ref?: HolisticReferenceContext,
): { score: number; reason: string } {
  const rev = c.reviewCount;
  const rating = c.rating;

  if ((rev === null || rev === undefined || rev < 10) && c.insideLodging) {
    const parentBonus = (c.parentStarRating ?? 0) >= MIN_LODGING_STARS ? 6 : 0;
    return {
      score: 70 + parentBonus,
      reason: `Mengikuti reputasi hotel induk${c.parentName ? ` (${c.parentName})` : ""}; listing ulasan terpisah tidak diwajibkan.`,
    };
  }

  if (rev === null || rev === undefined || rev <= 0) {
    return { score: 45, reason: "Jumlah ulasan Google belum tercatat." };
  }

  // Skala logaritmik: 50 ulasan -> ~60, 150 -> ~72, 500 -> ~85, 2000+ -> ~96
  const scaleScore = 18 * Math.log10(Math.max(10, rev)) + 28;
  let ratingAdj = 0;
  if (rating !== null && Number.isFinite(rating)) {
    if (rating >= 4.6) ratingAdj = 8;
    else if (rating >= 4.3) ratingAdj = 4;
    else if (rating < 4.0) ratingAdj = -10;
    if (ref?.ownRating && rating >= ref.ownRating) ratingAdj += 2;
  }

  const score = clamp(scaleScore + ratingAdj);
  const ratingStr = rating !== null ? `rating ${num(rating)}` : "tanpa rating";
  return {
    score,
    reason: `${num(rev)} ulasan Google (${ratingStr}).`,
  };
}

function resolveCandidatePriceIdr(c: HolisticCandidateInput): number | null {
  if (typeof c.averagePriceIdr === "number" && Number.isFinite(c.averagePriceIdr) && c.averagePriceIdr > 0) {
    return c.averagePriceIdr;
  }
  // Paket untuk beberapa orang dan sewa ruang bukan harga per porsi, jadi tidak ikut menentukan segmen harga.
  const items = (c.menuItems ?? []).filter((i) => !i.unit && !i.kind && i.price > 0);
  if (items.length > 0) {
    const sorted = items
      .map((i) => (i.priceMax && i.priceMax > i.price ? Math.round((i.price + i.priceMax) / 2) : i.price))
      .sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  if (c.perPersonRange && c.perPersonRange.min > 0 && c.perPersonRange.max >= c.perPersonRange.min) {
    return Math.round((c.perPersonRange.min + c.perPersonRange.max) / 2);
  }
  return null;
}

function scorePriceParity(
  c: HolisticCandidateInput,
  outlet: OutletKey,
  ref?: HolisticReferenceContext,
): { score: number; reason: string } {
  if (outlet === "resort") return scoreLodgingPrice(c, ref);

  let ratio =
    typeof c.priceRatioVsOwn === "number" && Number.isFinite(c.priceRatioVsOwn) && c.priceRatioVsOwn > 0
      ? c.priceRatioVsOwn
      : null;

  if (ratio === null) {
    const rivalPrice = resolveCandidatePriceIdr(c);
    const ownPrice = ref?.ownAveragePriceIdr ?? null;
    if (rivalPrice !== null && ownPrice !== null && ownPrice > 0) {
      ratio = rivalPrice / ownPrice;
    }
  }

  if (ratio === null) {
    return { score: 66, reason: "Data harga sebanding belum terpublikasi (netral, tanpa angka tebakan)." };
  }

  const pct = Math.round(ratio * 100);
  let score: number;

  if (ratio >= 0.7 && ratio <= 1.45) {
    score = 96 - Math.abs(ratio - 1) * 15;
  } else if (ratio >= 0.45 && ratio < 0.7) {
    score = 68 + ((ratio - 0.45) / 0.25) * 20;
  } else if (ratio > 1.45 && ratio <= 2.3) {
    score = 88 - ((ratio - 1.45) / 0.85) * 22;
  } else if (ratio > 2.3 && ratio <= 3.8) {
    score = 56 - ((ratio - 2.3) / 1.5) * 28;
  } else if (ratio > 3.8) {
    score = Math.max(10, 24 - (ratio - 3.8) * 10);
  } else {
    score = Math.max(25, 65 * (ratio / 0.45));
  }

  const tierLabel =
    ratio > 3.8
      ? "segmen jauh di atas Sanghyang"
      : ratio > 2.3
        ? "segmen di atas koridor utama"
        : ratio >= 0.7 && ratio <= 1.45
          ? "satu segmen harga dengan Sanghyang"
          : "masih beririsan dengan segmen pasar Sanghyang";

  return {
    score: clamp(score),
    reason: `Rasio harga ${pct}% terhadap Sanghyang (${tierLabel}).`,
  };
}

/**
 * Menghitung skor kecocokan holistik (0–100) satu kandidat terhadap satu outlet Sanghyang dari 6 dimensi berbobot.
 */
export function scoreCompetitorHolistic(
  candidate: HolisticCandidateInput,
  outlet: OutletKey,
  reference?: HolisticReferenceContext,
): HolisticScoreResult {
  // Aturan keras ADR-008 berlaku penuh: jarak, kelas bintang, dan minimal 50 ulasan Google untuk tempat mandiri.
  const rawHardRule =
    candidate.insideLodging && candidate.parentActive === false
      ? `Berada di dalam ${candidate.parentName ?? "hotel induk"} yang tidak lagi berstatus kompetitor aktif.`
      : compsetIneligibility({
          category: candidate.category,
          starRating: candidate.starRating,
          roadKm: candidate.roadKm,
          reviewCount: candidate.reviewCount,
          insideLodging: candidate.insideLodging,
        });

  const domainRule = domainIneligibility(candidate, outlet);
  const fatalReason = rawHardRule ?? domainRule;
  const weights = holisticWeightsFor(outlet);

  const dDist = scoreDistance(candidate.roadKm);
  const dConcept = scoreConcept(candidate, outlet, reference);
  const dProduct = scoreProduct(candidate, outlet, reference);
  const dFac = scoreFacilities(candidate, outlet, reference);
  const dRep = scoreReputation(candidate, reference);
  const dPrice = scorePriceParity(candidate, outlet, reference);

  const rawMap: Record<HolisticDimensionKey, { score: number; reason: string }> = {
    distance: dDist,
    concept: dConcept,
    product: dProduct,
    facilities: dFac,
    reputation: dRep,
    priceParity: dPrice,
  };

  const dimensions = {} as Record<HolisticDimensionKey, HolisticDimensionScore>;
  let totalWeighted = 0;

  for (const key of Object.keys(weights) as HolisticDimensionKey[]) {
    const weight = weights[key];
    const item = rawMap[key];
    totalWeighted += item.score * weight;
    dimensions[key] = {
      key,
      label: holisticDimensionLabel(key, outlet),
      weight,
      score: item.score,
      weighted: round1(item.score * weight),
      reason: cleanText(item.reason),
    };
  }

  if (outlet !== "resort") {
    // Penalti koherensi konsep: tempat dengan konsep sangat tidak sejenis (< 45) tidak boleh terangkat hanya oleh jarak dekat
    if (dConcept.score < 45 && dProduct.score < 55) {
      totalWeighted = Math.min(totalWeighted, 52);
    }
    // Sunset Grill: rumah makan/warung konvensional tanpa fasilitas pantai/terbuka dan tanpa daftar menu tidak masuk daftar aktif
    if (
      outlet === "sunset-grill" &&
      dConcept.score < 45 &&
      dFac.score < 45 &&
      (candidate.menuItems?.length ?? 0) === 0
    ) {
      totalWeighted = Math.min(totalWeighted, 52);
    }
    // Sunset Grill: rumah makan konvensional dengan banyak menu & ulasan tetap dibatasi maksimal sebagai acuan
    if (
      outlet === "sunset-grill" &&
      RE_ROADSIDE_WARUNG.test(candidate.name) &&
      !RE_BEACH_COAST.test(profileCorpusOf(candidate)) &&
      !RE_OPEN_AIR_LOUNGE.test(profileCorpusOf(candidate))
    ) {
      totalWeighted = Math.min(totalWeighted, HOLISTIC_SCORE_THRESHOLDS.core - 2);
    }
  }

  // Tempat yang beda jenis (domain) tidak punya skor kemiripan; yang sejenis tetapi gugur aturan keras tetap diberi skor
  // kemiripannya supaya alasan "mirip, tetapi pasarnya terlalu kecil/jauh" terbaca, walau keputusannya tetap arsip.
  const finalScore = domainRule ? 0 : clamp(totalWeighted);
  const segment = outlet === "resort" ? lodgingPriceSegment(candidate.priceRatioVsOwn, reference) : null;

  let decision: HolisticDecision = "arsip";
  if (!fatalReason) {
    if (finalScore >= HOLISTIC_SCORE_THRESHOLDS.core) decision = "inti";
    else if (finalScore >= HOLISTIC_SCORE_THRESHOLDS.benchmark) decision = "benchmark";
    // Inti Kamar & Resort ikut dihitung di pangsa pasar dan koridor harga, jadi tarifnya wajib terbaca dan satu segmen
    // dengan Sanghyang; tanpa tarif, paling tinggi acuan.
    if (decision === "inti" && outlet === "resort" && (!segment || segment.position !== "dalam")) decision = "benchmark";
    // Venue di dalam hotel acuan ikut maksimal acuan supaya segmen hotel induk dan outletnya konsisten.
    if (candidate.insideLodging && candidate.parentCompsetRole === "benchmark" && decision === "inti") decision = "benchmark";
  }
  const recommendedRole: CompsetRole | null = decision === "arsip" ? null : decision;

  const roleText =
    decision === "inti"
      ? `Kompetitor inti ${OUTLET_NAME[outlet]}`
      : decision === "benchmark"
        ? `Kompetitor acuan ${OUTLET_NAME[outlet]}`
        : `Tidak masuk daftar kompetitor ${OUTLET_NAME[outlet]}`;

  const keyReasons =
    outlet === "resort" ? [dPrice.reason, dProduct.reason, dConcept.reason] : [dConcept.reason, dProduct.reason, dPrice.reason];
  const summary = cleanText(
    fatalReason
      ? `${roleText}${domainRule ? "" : ` (skor kemiripan ${finalScore}/100)`}: ${fatalReason}`
      : `${roleText} (skor holistik ${finalScore}/100): ${keyReasons.join(" ")}`,
  );

  return {
    outlet,
    score: finalScore,
    decision,
    recommendedRole,
    eligibleHardRules: rawHardRule === null,
    hardRuleReason: fatalReason ? cleanText(fatalReason) : null,
    dimensions,
    summary,
  };
}

/**
 * Mengelompokkan dan mengurutkan daftar kandidat untuk satu outlet menjadi kompetitor inti, acuan (benchmark), dan arsip.
 */
export function classifyOutletCompetitors(
  candidates: HolisticCandidateInput[],
  outlet: OutletKey,
  reference?: HolisticReferenceContext,
): ClassifiedOutletCompetitors {
  const scored: ScoredCandidate[] = candidates
    .map((candidate) => ({
      candidate,
      result: scoreCompetitorHolistic(candidate, outlet, reference),
    }))
    .sort(
      (a, b) =>
        b.result.score - a.result.score ||
        (a.candidate.roadKm ?? Number.POSITIVE_INFINITY) - (b.candidate.roadKm ?? Number.POSITIVE_INFINITY) ||
        a.candidate.name.localeCompare(b.candidate.name, "id"),
    );

  return {
    outlet,
    core: scored.filter((s) => s.result.decision === "inti"),
    benchmark: scored.filter((s) => s.result.decision === "benchmark"),
    archived: scored.filter((s) => s.result.decision === "arsip"),
    all: scored,
  };
}

/** Outlet paling relevan untuk menjelaskan alasan arsip sebuah kandidat. */
function relevantOutletFor(candidate: HolisticCandidateInput): OutletKey {
  if (isLodging(candidate.category)) return "resort";
  if (candidate.category === "spa") return "dspa";
  if (candidate.category === "bar") return candidate.insideLodging ? "dbar" : "dragon-beach-club";
  return candidate.insideLodging ? "dbistro" : "sunset-grill";
}

function archiveReasonOf(candidate: HolisticCandidateInput, scoresByOutlet: Record<OutletKey, HolisticScoreResult>): string {
  const hardRule =
    candidate.insideLodging && candidate.parentActive === false
      ? `Hotel induk (${candidate.parentName ?? "penginapan"}) tidak lagi berstatus kompetitor aktif.`
      : compsetIneligibility({
          category: candidate.category,
          starRating: candidate.starRating,
          roadKm: candidate.roadKm,
          reviewCount: candidate.reviewCount,
          insideLodging: candidate.insideLodging,
        });
  if (hardRule) return cleanText(hardRule);
  // Jelaskan lewat outlet yang paling mendekati lolos; bila semua ditolak domain, pakai outlet bawaan kategorinya.
  const closest = OUTLET_KEYS.map((k) => scoresByOutlet[k])
    .filter((r) => !r.hardRuleReason)
    .sort((a, b) => b.score - a.score)[0];
  const res = closest ?? scoresByOutlet[relevantOutletFor(candidate)];
  const outlet = res.outlet;
  if (res.hardRuleReason) return cleanText(res.hardRuleReason);
  const reasons =
    outlet === "resort"
      ? [res.dimensions.priceParity.reason, res.dimensions.concept.reason]
      : [res.dimensions.concept.reason, res.dimensions.product.reason];
  return cleanText(
    `Skor kecocokan holistik ${res.score}/100 di bawah ambang ${HOLISTIC_SCORE_THRESHOLDS.benchmark} untuk ${OUTLET_NAME[outlet]}: ${reasons.join(" ")}`,
  );
}

/**
 * Mengevaluasi daftar kandidat lintas seluruh 6 outlet Sanghyang dan menentukan `outlets`, `compsetRole`, `active`,
 * serta alasan `retiredReason`.
 */
export function autoClassifyNewCandidates(
  candidates: HolisticCandidateInput[],
  referencesByOutlet?: Partial<Record<OutletKey, HolisticReferenceContext>>,
): AutoClassifiedCandidate[] {
  return candidates.map((candidate) => {
    const scoresByOutlet = {} as Record<OutletKey, HolisticScoreResult>;
    const matchedOutlets: { outlet: OutletKey; score: number; role: CompsetRole }[] = [];

    for (const outlet of OUTLET_KEYS) {
      const res = scoreCompetitorHolistic(candidate, outlet, referencesByOutlet?.[outlet]);
      scoresByOutlet[outlet] = res;
      if (res.recommendedRole !== null) {
        matchedOutlets.push({ outlet, score: res.score, role: res.recommendedRole });
      }
    }

    matchedOutlets.sort((a, b) => b.score - a.score);
    const bestAny = Object.values(scoresByOutlet).sort((a, b) => b.score - a.score)[0];
    const active = matchedOutlets.length > 0;
    const compsetRole: CompsetRole | null = !active
      ? null
      : matchedOutlets.some((m) => m.role === "inti")
        ? "inti"
        : "benchmark";
    const matchedSet = new Set(matchedOutlets.map((m) => m.outlet));

    return {
      candidate,
      active,
      compsetRole,
      outlets: OUTLET_KEYS.filter((k) => matchedSet.has(k)),
      primaryOutlet: matchedOutlets[0]?.outlet ?? null,
      bestScore: matchedOutlets[0]?.score ?? bestAny?.score ?? 0,
      retiredReason: active ? null : archiveReasonOf(candidate, scoresByOutlet),
      scoresByOutlet,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Klasifikasi ulang seluruh daftar kompetitor dengan perlindungan keputusan pemakai/pemilik
// ---------------------------------------------------------------------------------------------------------------

/** Pemetaan sebutan outlet di kalimat keputusan ke kunci outlet. */
const OUTLET_MENTIONS: Record<OutletKey, RegExp> = {
  resort: /\bkamar\s*(?:&|dan)\s*resort\b/i,
  "sunset-grill": /\bsunset grill\b/i,
  "dragon-beach-club": /\bdragon beach club\b/i,
  dbistro: /\bd['’]?\s?bistro\b/i,
  dbar: /\bd['’]?\s?bar\b/i,
  dspa: /\bd['’]?\s?spa\b/i,
};

export interface OwnerDecision {
  /** Kalimat keputusan apa adanya. */
  text: string;
  /** Outlet yang diputuskan; "semua" bila kalimatnya tidak menyebut outlet tertentu (seluruh baris dikunci). */
  scope: OutletKey[] | "semua";
}

/**
 * Keputusan pemakai/pemilik yang tercatat di `retiredReason` atau `notes` ("Keputusan pemakai 13 Nov 2026 ...").
 * Kalimat yang menyebut outlet hanya mengunci outlet itu; kalimat tanpa outlet mengunci seluruh baris.
 */
export function ownerDecisionOf(row: { retiredReason: string | null; notes: string | null }): OwnerDecision | null {
  const sentences = [...decisionSentencesOf(row.retiredReason), ...decisionSentencesOf(row.notes)];
  if (sentences.length === 0) return null;
  const scoped = new Set<OutletKey>();
  let whole = false;
  for (const s of sentences) {
    const mentioned = OUTLET_KEYS.filter((k) => OUTLET_MENTIONS[k].test(s));
    if (mentioned.length === 0) whole = true;
    for (const k of mentioned) scoped.add(k);
  }
  return {
    text: sentences.join(" "),
    scope: whole ? "semua" : OUTLET_KEYS.filter((k) => scoped.has(k)),
  };
}

function decisionSentencesOf(text: string | null): string[] {
  return text ? splitClauses(text).filter((s) => RE_OWNER_DECISION.test(s)) : [];
}

/** Batas kalimat dijaga supaya withoutDecisions hanya membuang kalimat keputusan, bukan isi catatan sebelumnya. */
function appendSentence(text: string | null, sentence: string): string {
  const base = text?.trimEnd();
  if (!base) return sentence;
  return `${base}${/[.;!?]$/.test(base) ? " " : "\n"}${sentence}`;
}

/**
 * `notes` sesudah penilaian. Kalimat keputusan yang hilang dari `retiredReason` (mis. baris diaktifkan outlet lain yang
 * tidak dikunci) dipindah ke `notes` sekali saja, supaya ownerDecisionOf tetap menemukannya pada putaran berikutnya.
 */
function notesKeepingDecisions(notes: string | null, reasonBefore: string | null, reasonAfter: string | null): string | null {
  const kept = new Set([...decisionSentencesOf(notes), ...decisionSentencesOf(reasonAfter)]);
  return decisionSentencesOf(reasonBefore)
    .filter((s) => !kept.has(s))
    .reduce<string | null>(appendSentence, notes);
}

export interface RegistryCandidate {
  id: string;
  version: number;
  name: string;
  category: string | null;
  active: boolean;
  compsetRole: string | null;
  outlets: string[];
  retiredReason: string | null;
  notes: string | null;
  parentId: string | null;
  input: HolisticCandidateInput;
}

export interface RegistryState {
  active: boolean;
  compsetRole: CompsetRole | null;
  outlets: OutletKey[];
  retiredReason: string | null;
  notes: string | null;
}

export interface RegistryDecision {
  id: string;
  version: number;
  name: string;
  category: string | null;
  before: RegistryState;
  after: RegistryState;
  changed: boolean;
  /** Keputusan pemakai/pemilik yang dihormati, atau null bila seluruh baris diputuskan mesin. */
  protectedBy: OwnerDecision | null;
  scoresByOutlet: Record<OutletKey, HolisticScoreResult>;
  bestOutlet: OutletKey | null;
  bestScore: number;
}

function stateOf(row: RegistryCandidate): RegistryState {
  return {
    active: row.active,
    compsetRole: parseCompsetRole(row.compsetRole),
    outlets: OUTLET_KEYS.filter((k) => row.outlets.includes(k)),
    retiredReason: row.retiredReason,
    notes: row.notes,
  };
}

function sameState(a: RegistryState, b: RegistryState): boolean {
  return (
    a.active === b.active &&
    a.compsetRole === b.compsetRole &&
    a.outlets.join(",") === b.outlets.join(",") &&
    (a.retiredReason ?? null) === (b.retiredReason ?? null) &&
    (a.notes ?? null) === (b.notes ?? null)
  );
}

function decideRow(
  row: RegistryCandidate,
  input: HolisticCandidateInput,
  refs: Partial<Record<OutletKey, HolisticReferenceContext>>,
): RegistryDecision {
  const before = stateOf(row);
  const auto = autoClassifyNewCandidates([input], refs)[0];
  const decision = ownerDecisionOf(row);
  const roleRank = (r: CompsetRole | null) => (r === "inti" ? 2 : r === "benchmark" ? 1 : 0);

  // Penginapan yang sudah pernah diputuskan tetapi tarifnya belum terbaca (mis. tidak lagi dirayapi setelah diarsipkan)
  // dipertahankan statusnya: ketiadaan data tarif bukan alasan untuk mengubah peran.
  const lodgingWithoutTariff =
    isLodging(row.category) &&
    lodgingPriceSegment(input.priceRatioVsOwn, refs.resort) === null &&
    auto.scoresByOutlet.resort.eligibleHardRules &&
    (before.compsetRole !== null || before.retiredReason !== null);

  let after: RegistryState;
  if (decision?.scope === "semua" || lodgingWithoutTariff) {
    after = before;
  } else {
    const locked = new Set<OutletKey>(decision ? decision.scope : []);
    const outlets: OutletKey[] = [];
    let role: CompsetRole | null = null;
    for (const outlet of OUTLET_KEYS) {
      const outletRole = locked.has(outlet)
        ? before.active && before.outlets.includes(outlet)
          ? before.compsetRole
          : null
        : auto.scoresByOutlet[outlet].recommendedRole;
      if (outletRole === null) continue;
      outlets.push(outlet);
      if (roleRank(outletRole) > roleRank(role)) role = outletRole;
    }
    const active = outlets.length > 0;
    // Alasan arsip yang sudah tercatat dipertahankan selama baris tetap arsip, supaya jejak keputusan lama tidak hilang.
    // Mesin tidak memberi alasan arsip bila ia merekomendasikan outlet yang dikunci keputusan; keputusan itulah alasannya.
    const retiredReason = active
      ? null
      : !before.active && before.retiredReason
        ? before.retiredReason
        : (auto.retiredReason ?? decision?.text ?? null);
    after = {
      active,
      compsetRole: active ? role : null,
      outlets: active ? outlets : before.outlets,
      retiredReason,
      notes: notesKeepingDecisions(before.notes, before.retiredReason, retiredReason),
    };
  }

  const scored = OUTLET_KEYS.map((k) => ({ outlet: k, score: auto.scoresByOutlet[k].score }))
    .filter((s) => after.outlets.includes(s.outlet) || after.outlets.length === 0)
    .sort((a, b) => b.score - a.score);
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    category: row.category,
    before,
    after,
    changed: !sameState(before, after),
    protectedBy: decision,
    scoresByOutlet: auto.scoresByOutlet,
    bestOutlet: scored[0]?.outlet ?? null,
    bestScore: scored[0]?.score ?? 0,
  };
}

/**
 * Menilai ulang seluruh baris daftar kompetitor: penginapan lebih dulu, lalu outlet di dalamnya memakai status hotel
 * induk hasil penilaian yang sama. Fungsi murni; penulisan ke basis data dilakukan pemanggil dengan OCC.
 */
export function reclassifyRegistry(
  rows: RegistryCandidate[],
  refs: Partial<Record<OutletKey, HolisticReferenceContext>>,
): RegistryDecision[] {
  const lodging = rows.filter((r) => isLodging(r.category));
  const venues = rows.filter((r) => !isLodging(r.category));
  const decisions = new Map<string, RegistryDecision>();
  for (const row of lodging) decisions.set(row.id, decideRow(row, row.input, refs));
  for (const row of venues) {
    const parent = row.parentId ? decisions.get(row.parentId) : undefined;
    const input: HolisticCandidateInput = parent
      ? { ...row.input, parentActive: parent.after.active, parentCompsetRole: parent.after.compsetRole }
      : row.input;
    decisions.set(row.id, decideRow(row, input, refs));
  }
  return rows.map((r) => decisions.get(r.id) as RegistryDecision);
}

/** Outlet sebuah kunci, aman untuk masukan string bebas. */
export function outletLabel(key: string): string {
  return isOutletKey(key) ? OUTLET_NAME[key] : key;
}
