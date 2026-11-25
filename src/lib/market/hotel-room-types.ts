/**
 * Daftar terverifikasi seluruh tipe kamar, luas (m²), konfigurasi kamar tidur,
 * fasilitas inti (Smart TV, bathtub), dan tarif untuk Sanghyang Indah Spa Resort
 * beserta 9 kompetitor aktif Kamar & Resort (radius ≤25 km).
 *
 * Aturan sumber: situs resmi hotel/resort selalu diprioritaskan atas OTA bila
 * terdapat perbedaan spesifikasi; kolom yang tidak tercatat diisi null (Zero Mock).
 */
import data from "./hotel-room-types.data.json";
import { placeIdFor } from "./hotel-compset";
import { bestMatchingRoomIndex } from "./room-name-match";

export type RoomTypeCategory = "standard" | "suite" | "villa" | "condo" | "cottage";

export type RoomSpecSourcePriority = "official" | "ota";

export interface HotelRoomTypeSpec {
  name: string;
  category: RoomTypeCategory;
  bedrooms: number | null;
  areaSqm: number | null;
  areaLabel: string | null;
  smartTv: boolean | null;
  bathtub: boolean | null;
  highlights: string[];
  weekdayPrice: number | null;
  weekendPrice: number | null;
  priceSource: string | null;
  sourcePriority: RoomSpecSourcePriority;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  conflictNote?: string | null;
}

export interface HotelRoomTypesProfile {
  hotelId: string;
  name: string;
  hasMultiBedroomUnit: boolean;
  multiBedroomNote: string | null;
  roomTypes: HotelRoomTypeSpec[];
}

export const HOTEL_ROOM_TYPES_META = {
  observedAt: data.observedAt,
  sourceRule: data.sourceRule,
};

export const HOTEL_ROOM_TYPES: HotelRoomTypesProfile[] = data.hotels as HotelRoomTypesProfile[];

const HOTEL_BY_ID = new Map<string, HotelRoomTypesProfile>(
  HOTEL_ROOM_TYPES.map((profile) => [profile.hotelId, profile]),
);

const HOTEL_ID_ALIASES: Record<string, string> = {
  movenpick_carita: "movenpick",
  movenpick_resort_carita: "movenpick",
  aston: "aston_anyer",
  my_pisita: "my_pisita_anyer",
  pisita: "my_pisita_anyer",
  nemuru: "nemuru_palazo",
  nemuru_pallazo: "nemuru_palazo",
  hawaii: "hawaii_anyer",
  novus: "novus_jiva",
  the_jayakarta_villas_anyer: "jayakarta",
};

function normalizeLookupKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Mencari profil tipe kamar berdasarkan `hotelId` kanonis, alias umum, atau nama properti.
 */
export function getHotelRoomTypes(hotelIdOrName: string): HotelRoomTypesProfile | null {
  const raw = hotelIdOrName.trim();
  if (!raw) return null;

  const exact = HOTEL_BY_ID.get(raw);
  if (exact) return exact;

  const normalized = normalizeLookupKey(raw);
  const directNormalized = HOTEL_BY_ID.get(normalized);
  if (directNormalized) return directNormalized;

  const slug = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const aliasedId = HOTEL_ID_ALIASES[normalized] ?? HOTEL_ID_ALIASES[slug];
  if (aliasedId) {
    return HOTEL_BY_ID.get(aliasedId) ?? null;
  }

  for (const profile of HOTEL_ROOM_TYPES) {
    if (normalizeLookupKey(profile.name) === normalized) {
      return profile;
    }
  }

  const matchedPlaceId = placeIdFor(raw);
  if (matchedPlaceId) {
    return HOTEL_BY_ID.get(matchedPlaceId) ?? null;
  }

  return null;
}

function formatNumberId(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

/**
 * Memformat luas kamar menjadi label ringkas (mis. "70 m²", "42,2 m²", atau "Belum ada data").
 */
export function formatAreaSqm(rt: Pick<HotelRoomTypeSpec, "areaSqm" | "areaLabel">): string {
  // Superskrip ² di situs resmi sering terbaca sebagai "m 2" atau "m2" ("36 m 2", "90m 2"); satuan ditulis seragam "m²".
  const label = rt.areaLabel?.trim().replace(/(\d)\s*m\s*(?:2|²)(?!\d)/gi, "$1 m²");
  if (label) return label;
  if (typeof rt.areaSqm === "number" && Number.isFinite(rt.areaSqm) && rt.areaSqm > 0) {
    return `${formatNumberId(rt.areaSqm)} m²`;
  }
  return "Belum ada data";
}

function hasValue<T>(v: T | null | undefined): v is T {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

/**
 * Menggabungkan data situs resmi dan OTA dengan aturan tegas:
 * bila situs resmi dan OTA berbeda pada suatu kolom, nilai situs resmi selalu menang
 * dan perbedaan dicatat pada `conflictNote`. Kolom kosong di situs resmi boleh
 * dilengkapi dari OTA tanpa menimpa fakta resmi.
 */
export function resolveRoomTypeSpec(
  official: Partial<HotelRoomTypeSpec> | null | undefined,
  ota: Partial<HotelRoomTypeSpec> | null | undefined,
): HotelRoomTypeSpec {
  const hasOfficial = Boolean(
    official && (hasValue(official.name) || hasValue(official.sourceUrl) || hasValue(official.areaSqm)),
  );
  const hasOta = Boolean(
    ota && (hasValue(ota.name) || hasValue(ota.sourceUrl) || hasValue(ota.areaSqm)),
  );

  if (!hasOfficial && !hasOta) {
    throw new Error("Minimal satu sumber (situs resmi atau OTA) wajib tersedia untuk resolveRoomTypeSpec.");
  }

  const primary = hasOfficial ? official! : ota!;
  const secondary = hasOfficial ? (ota ?? null) : null;

  const pick = <K extends keyof HotelRoomTypeSpec>(
    key: K,
    fallback: HotelRoomTypeSpec[K],
  ): HotelRoomTypeSpec[K] => {
    const pVal = primary[key];
    if (hasValue(pVal)) return pVal as HotelRoomTypeSpec[K];
    const sVal = secondary?.[key];
    if (hasValue(sVal)) return sVal as HotelRoomTypeSpec[K];
    return fallback;
  };

  const name = pick("name", "");
  const sourceUrl = pick("sourceUrl", "");
  if (!name || !sourceUrl) {
    throw new Error("Nama tipe kamar dan sourceUrl wajib tersedia pada sumber resmi atau OTA.");
  }

  const conflicts: string[] = [];
  if (hasOfficial && secondary) {
    const otaLabel = secondary.sourceLabel?.trim() || "OTA";
    if (hasValue(primary.name) && hasValue(secondary.name) && primary.name.trim().toLowerCase() !== secondary.name.trim().toLowerCase()) {
      conflicts.push(`nama di ${otaLabel} "${secondary.name}" vs resmi "${primary.name}"`);
    }
    if (hasValue(primary.areaSqm) && hasValue(secondary.areaSqm) && primary.areaSqm !== secondary.areaSqm) {
      conflicts.push(
        `luas di ${otaLabel} ${formatNumberId(secondary.areaSqm)} m² vs resmi ${formatNumberId(primary.areaSqm)} m²`,
      );
    }
    if (hasValue(primary.bedrooms) && hasValue(secondary.bedrooms) && primary.bedrooms !== secondary.bedrooms) {
      conflicts.push(`jumlah kamar tidur di ${otaLabel} ${secondary.bedrooms} vs resmi ${primary.bedrooms}`);
    }
    if (primary.smartTv !== null && primary.smartTv !== undefined && secondary.smartTv !== null && secondary.smartTv !== undefined && primary.smartTv !== secondary.smartTv) {
      conflicts.push(`Smart TV di ${otaLabel} (${secondary.smartTv ? "Ada" : "Tidak"}) vs resmi (${primary.smartTv ? "Ada" : "Tidak"})`);
    }
    if (primary.bathtub !== null && primary.bathtub !== undefined && secondary.bathtub !== null && secondary.bathtub !== undefined && primary.bathtub !== secondary.bathtub) {
      conflicts.push(`bathtub di ${otaLabel} (${secondary.bathtub ? "Ada" : "Tidak"}) vs resmi (${primary.bathtub ? "Ada" : "Tidak"})`);
    }
  }

  const explicitNote = primary.conflictNote?.trim() || null;
  const generatedNote =
    conflicts.length > 0 ? `Dipakai data situs resmi (${conflicts.join("; ")}).` : null;
  const conflictNote =
    explicitNote && generatedNote
      ? `${explicitNote} ${generatedNote}`
      : (explicitNote ?? generatedNote);

  const primaryHighlights = Array.isArray(primary.highlights) ? primary.highlights.filter((h) => h.trim().length > 0) : [];
  const secondaryHighlights = Array.isArray(secondary?.highlights) ? secondary.highlights.filter((h) => h.trim().length > 0) : [];
  const highlights = (primaryHighlights.length > 0 ? primaryHighlights : secondaryHighlights).slice(0, 3);

  const areaSqm = pick("areaSqm", null);
  const areaLabel = hasValue(primary.areaLabel)
    ? primary.areaLabel.trim()
    : hasValue(primary.areaSqm)
      ? `${formatNumberId(primary.areaSqm)} m²`
      : hasValue(secondary?.areaLabel)
        ? secondary.areaLabel.trim()
        : areaSqm !== null
          ? `${formatNumberId(areaSqm)} m²`
          : null;

  return {
    name: name.trim(),
    category: pick("category", "standard"),
    bedrooms: pick("bedrooms", null),
    areaSqm,
    areaLabel,
    smartTv: pick("smartTv", null),
    bathtub: pick("bathtub", null),
    highlights,
    weekdayPrice: pick("weekdayPrice", null),
    weekendPrice: pick("weekendPrice", null),
    priceSource: pick("priceSource", null),
    sourcePriority: hasOfficial ? "official" : "ota",
    sourceLabel: pick("sourceLabel", hasOfficial ? "Situs resmi" : "OTA"),
    sourceUrl: sourceUrl.trim(),
    observedAt: pick("observedAt", HOTEL_ROOM_TYPES_META.observedAt),
    conflictNote,
  };
}

export const ROOM_TYPES_FACT_SECTION = "kamar" as const;
export const ROOM_TYPES_FACT_KEY = "tipe_kamar_terstruktur" as const;

const VALID_ROOM_CATEGORIES = new Set<RoomTypeCategory>(["standard", "suite", "villa", "condo", "cottage"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AI_ENGINE_MENTION =
  /\(\s*(?:dibaca|hasil|saran|laporan|menurut|sumber(?:\s+foto\s+menu)?\s+dibaca|sumber)?\s*(?:oleh\s+)?(?:gemini\s+[\d.]+(?:\s+flash[- ]lite)?|gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm)[^)]*\)|\b(?:oleh|dari|menurut|saran|hasil|laporan)\s+(?:gemini\s+[\d.]+(?:\s+flash[- ]lite)?|gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm)\b|\b(?:gemini\s+[\d.]+(?:\s+flash[- ]lite)?|gemini|flash[- ]lite|claude\s+[\d.]+|claude|openai|chatgpt|gpt-?[\d\w]*|llm)\b/gi;

/** Membersihkan penyebutan nama mesin/model AI serta alat perayap (seperti Crawl4AI) dari teks publik. */
export function sanitizeAiModelText(text: string): string {
  return text
    .replace(AI_ENGINE_MENTION, "")
    .replace(/\(\s*(?:crawl\s+)?diperiksa\s+crawl4ai\s+([^)]+)\)/gi, "(terakhir diperiksa $1)")
    .replace(/\(\s*crawl\s+crawl4ai\s*,?\s*([^)]+)\)/gi, "(terakhir diperiksa $1)")
    .replace(/\bdiperiksa\s+crawl4ai\b/gi, "terakhir diperiksa")
    .replace(/\bcrawl4ai\b/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Membersihkan teks publik untuk UI dan PDF: menghapus nama mesin AI & alat perayap,
 * mengganti "registri" -> "daftar kompetitor", dan "pesaing" -> "kompetitor".
 */
export function sanitizePublicText(text: string): string {
  return sanitizeAiModelText(text)
    // Sama dengan saringan PDF (lib/meeting-report/sections.ts scrubToolMentions): jarak dari server rute terbuka ditulis
    // "estimasi rute" tanpa nama alatnya, dan nama berkas internal tidak ditampilkan.
    .replace(/\bRute\s+OSRM\b/g, "Estimasi rute")
    .replace(/\brute\s+OSRM\b/g, "estimasi rute")
    .replace(/\(\s*OSRM\s*\)/g, "(estimasi rute)")
    .replace(/\s*\/\s*OSRM\b/g, "")
    .replace(/\bOSRM\b/g, "perhitungan rute")
    .replace(/\(\s*[\w-]+\.(?:json|csv|ts|js|py)\s*\)/gi, "")
    .replace(/\b[\w-]+\.(?:json|csv|py)\b/gi, "")
    .replace(/\bRegistri\s+(?:pesaing|pembanding|kompetitor)\b/g, "Daftar kompetitor")
    .replace(/\bregistri\s+(?:pesaing|pembanding|kompetitor)\b/gi, "daftar kompetitor")
    .replace(/\bRegistri\b/g, "Daftar kompetitor")
    .replace(/\bregistri\b/gi, "daftar kompetitor")
    .replace(/\bPesaing\b/g, "Kompetitor")
    .replace(/\bpesaing\b/gi, "kompetitor")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Membaca status sarapan eksplisit dari poin spesifikasi situs resmi (hanya bila tertulis jelas, tanpa tebakan).
 */
export function inferOfficialBreakfastFromHighlights(highlights: string[]): boolean | null {
  const joined = highlights.join(" ");
  if (!joined.trim()) return null;
  if (/tanpa\s+sarapan|room\s+only|no\s+breakfast|hanya\s+kamar/i.test(joined)) return false;
  if (/termasuk\s+sarapan|\bsarapan\s+\d+\s+orang\b|free\s+breakfast|breakfast\s+included/i.test(joined)) return true;
  return null;
}

export interface StoredRoomTypesPayload {
  hotelId?: string;
  roomTypes: HotelRoomTypeSpec[];
  hasMultiBedroomUnit: boolean;
  multiBedroomNote: string | null;
  text: string;
  sourceRule?: string;
  updatedFrom?: string;
  seededFrom?: string;
}

/** Ringkasan satu kalimat Bahasa Indonesia untuk simpul Knowledge Graph (bebas nama mesin AI). */
export function buildRoomTypesSummaryText(profile: Pick<HotelRoomTypesProfile, "name" | "roomTypes" | "hasMultiBedroomUnit">): string {
  const sizes = profile.roomTypes
    .map((r) => r.areaSqm)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const sizePart =
    sizes.length === 0
      ? "luas belum tercatat"
      : sizes[0] === sizes[sizes.length - 1]
        ? `luas ${formatNumberId(sizes[0])} m²`
        : `luas ${formatNumberId(sizes[0])}–${formatNumberId(sizes[sizes.length - 1])} m²`;
  const multiPart = profile.hasMultiBedroomUnit ? "tersedia unit 2+ kamar tidur" : "seluruh unit 1 kamar/studio";
  const sampleNames = profile.roomTypes
    .slice(0, 3)
    .map((r) => sanitizeAiModelText(r.name))
    .filter(Boolean)
    .join(", ");
  return sanitizeAiModelText(
    `${profile.name}: ${profile.roomTypes.length} tipe kamar terverifikasi (${sizePart}, ${multiPart}${sampleNames ? `; a.l. ${sampleNames}` : ""}).`,
  );
}

export function parseStoredRoomType(raw: unknown, fallbackUrl: string, fallbackObservedAt: string): HotelRoomTypeSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? sanitizeAiModelText(r.name) : "";
  if (!name) return null;
  const categoryRaw = typeof r.category === "string" ? r.category.trim().toLowerCase() : "standard";
  const category: RoomTypeCategory = VALID_ROOM_CATEGORIES.has(categoryRaw as RoomTypeCategory)
    ? (categoryRaw as RoomTypeCategory)
    : "standard";
  const bedrooms = typeof r.bedrooms === "number" && Number.isFinite(r.bedrooms) && r.bedrooms > 0 ? Math.round(r.bedrooms) : null;
  const areaSqm = typeof r.areaSqm === "number" && Number.isFinite(r.areaSqm) && r.areaSqm > 0 ? r.areaSqm : null;
  const areaLabelRaw = typeof r.areaLabel === "string" ? sanitizeAiModelText(r.areaLabel) : "";
  const areaLabel = areaLabelRaw || (areaSqm !== null ? `${formatNumberId(areaSqm)} m²` : null);
  const smartTv = typeof r.smartTv === "boolean" ? r.smartTv : null;
  const bathtub = typeof r.bathtub === "boolean" ? r.bathtub : null;
  const highlights = Array.isArray(r.highlights)
    ? r.highlights
        .filter((h): h is string => typeof h === "string")
        .map((h) => sanitizeAiModelText(h))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const weekdayPrice = typeof r.weekdayPrice === "number" && Number.isFinite(r.weekdayPrice) && r.weekdayPrice > 0 ? Math.round(r.weekdayPrice) : null;
  const weekendPrice = typeof r.weekendPrice === "number" && Number.isFinite(r.weekendPrice) && r.weekendPrice > 0 ? Math.round(r.weekendPrice) : null;
  const priceSource = typeof r.priceSource === "string" && sanitizeAiModelText(r.priceSource) ? sanitizeAiModelText(r.priceSource) : null;
  const sourcePriority: RoomSpecSourcePriority = r.sourcePriority === "ota" ? "ota" : "official";
  const sourceLabelRaw = typeof r.sourceLabel === "string" ? sanitizeAiModelText(r.sourceLabel) : "";
  const sourceLabel = sourceLabelRaw || (sourcePriority === "official" ? "Situs resmi" : "OTA");
  const sourceUrl = typeof r.sourceUrl === "string" && URL.canParse(r.sourceUrl.trim()) ? r.sourceUrl.trim() : fallbackUrl;
  if (!sourceUrl) return null;
  const observedAtRaw = typeof r.observedAt === "string" ? r.observedAt.trim() : "";
  const observedAt = /^\d{4}-\d{2}-\d{2}$/.test(observedAtRaw) ? observedAtRaw : fallbackObservedAt;
  const conflictNote = typeof r.conflictNote === "string" && sanitizeAiModelText(r.conflictNote) ? sanitizeAiModelText(r.conflictNote) : null;

  return {
    name,
    category,
    bedrooms,
    areaSqm,
    areaLabel,
    smartTv,
    bathtub,
    highlights,
    weekdayPrice,
    weekendPrice,
    priceSource: weekdayPrice !== null || weekendPrice !== null ? (priceSource ?? sourceLabel) : null,
    sourcePriority,
    sourceLabel,
    sourceUrl,
    observedAt,
    conflictNote,
  };
}

export interface DynamicRoomTypesFactRow {
  competitorId: string;
  section: string;
  key: string;
  value: unknown;
  sourceUrl: string;
  observedAt: Date;
  competitor?: { id: string; name: string; placeId: string | null } | null;
}

export type DynamicRoomTypesDbClient = {
  competitorFact: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: { competitor: { select: { id: true; name: true; placeId: true } } };
      orderBy?: { observedAt: "desc" | "asc" };
    }): Promise<DynamicRoomTypesFactRow[]>;
  };
};

/**
 * Memuat profil tipe kamar secara dinamis dari `CompetitorFact` (`kamar/tipe_kamar_terstruktur`)
 * lalu menggabungkannya dengan baseline `HOTEL_ROOM_TYPES`.
 * Aturan prioritas: fakta DB yang lebih baru (atau sama barunya) mengalahkan baseline statis;
 * properti baru di DB ikut tampil otomatis; properti tanpa fakta DB tetap memakai baseline terverifikasi.
 */
/**
 * Melengkapi kolom kosong `primary` dengan nilai `secondary` tanpa mengubah prioritas dan asal sumbernya. Dipakai untuk
 * dua bacaan dari jenis sumber yang sama (bacaan situs resmi terbaru dan data riset, atau dua bacaan OTA).
 */
function fillMissingFields(primary: HotelRoomTypeSpec, secondary: HotelRoomTypeSpec): HotelRoomTypeSpec {
  const pick = <K extends keyof HotelRoomTypeSpec>(key: K): HotelRoomTypeSpec[K] => (hasValue(primary[key]) ? primary[key] : secondary[key]);
  // Luas m² dan labelnya berasal dari sumber yang sama supaya rentang ("38–42 m²") tidak tercampur angka lain.
  const areaFromPrimary = hasValue(primary.areaSqm) || hasValue(primary.areaLabel);
  return {
    ...primary,
    bedrooms: pick("bedrooms"),
    areaSqm: areaFromPrimary ? primary.areaSqm : secondary.areaSqm,
    areaLabel: areaFromPrimary ? primary.areaLabel : secondary.areaLabel,
    smartTv: pick("smartTv"),
    bathtub: pick("bathtub"),
    highlights: [...(primary.highlights.length > 0 ? primary.highlights : secondary.highlights)],
    weekdayPrice: pick("weekdayPrice"),
    weekendPrice: pick("weekendPrice"),
    priceSource: pick("priceSource"),
    conflictNote: pick("conflictNote"),
  };
}

/**
 * Tipe kamar satu hotel dari data riset (berkas data: situs resmi diutamakan, celahnya dilengkapi OTA) dan hasil
 * penyegaran otomatis (bacaan situs resmi terbaru serta nama dan harga kamar OTA), digabung per tipe kamar dan per kolom:
 * - situs resmi dulu: bacaan terbaru, dilengkapi data riset untuk tipe kamar yang sama;
 * - OTA hanya mengisi kolom yang masih kosong; bila keduanya ada dan berbeda, situs resmi dipakai dan selisihnya dicatat
 *   (resolveRoomTypeSpec);
 * - tipe kamar yang hanya ada di satu sumber tetap tampil.
 * Bacaan yang gagal membaca situs resmi atau hanya membawa nama kamar OTA tidak menghapus luas, fasilitas, dan catatan
 * yang sudah diketahui.
 */
export function mergeRoomTypeLayers(baseline: HotelRoomTypeSpec[], fresh: HotelRoomTypeSpec[]): HotelRoomTypeSpec[] {
  const isOfficial = (rt: HotelRoomTypeSpec) => rt.sourcePriority === "official";
  const copy = (rt: HotelRoomTypeSpec): HotelRoomTypeSpec => ({ ...rt, highlights: [...rt.highlights] });

  const merged = fresh.filter(isOfficial).map(copy);
  for (const rt of baseline.filter(isOfficial)) {
    const idx = bestMatchingRoomIndex(rt.name, merged);
    if (idx < 0) merged.push(copy(rt));
    else merged[idx] = fillMissingFields(merged[idx], rt);
  }

  for (const rt of [...fresh.filter((r) => !isOfficial(r)), ...baseline.filter((r) => !isOfficial(r))]) {
    const idx = bestMatchingRoomIndex(rt.name, merged);
    if (idx < 0) merged.push(copy(rt));
    else merged[idx] = isOfficial(merged[idx]) ? resolveRoomTypeSpec(merged[idx], rt) : fillMissingFields(merged[idx], rt);
  }
  return merged;
}

export async function loadDynamicHotelRoomTypes(
  competitorIds?: string[],
  options?: { client?: DynamicRoomTypesDbClient },
): Promise<Map<string, HotelRoomTypesProfile>> {
  if (!options?.client && (!competitorIds || competitorIds.length === 0)) {
    const [{ withCachedMap }, { CACHE_TAGS, CACHE_TTL }] = await Promise.all([
      import("../cache/cached"),
      import("../cache/tags"),
    ]);
    return withCachedMap(
      () => fetchDynamicHotelRoomTypes(undefined, undefined),
      ["mi-hotel-room-types", "all"],
      { tags: [CACHE_TAGS.marketRoomTypes, CACHE_TAGS.marketCompetitors], revalidate: CACHE_TTL.marketIntelligence },
    );
  }
  return fetchDynamicHotelRoomTypes(competitorIds, options);
}

async function fetchDynamicHotelRoomTypes(
  competitorIds?: string[],
  options?: { client?: DynamicRoomTypesDbClient },
): Promise<Map<string, HotelRoomTypesProfile>> {
  const baselineMs = Date.parse(`${HOTEL_ROOM_TYPES_META.observedAt}T00:00:00.000Z`);
  const result = new Map<string, HotelRoomTypesProfile>();

  const filterList = competitorIds?.map((s) => s.trim()).filter(Boolean) ?? [];
  const filterUuids = filterList.filter((id) => UUID_PATTERN.test(id));
  const filterSlugs = new Set(
    filterList
      .filter((id) => !UUID_PATTERN.test(id))
      .map((id) => getHotelRoomTypes(id)?.hotelId ?? normalizeLookupKey(id)),
  );

  for (const profile of HOTEL_ROOM_TYPES) {
    if (filterList.length === 0 || filterSlugs.has(profile.hotelId)) {
      result.set(profile.hotelId, {
        ...profile,
        roomTypes: profile.roomTypes.map((rt) => ({ ...rt, highlights: [...rt.highlights] })),
      });
    }
  }

  const dbClient = options?.client ?? ((await import("../db")).db as unknown as DynamicRoomTypesDbClient);
  const where: Record<string, unknown> = {
    section: ROOM_TYPES_FACT_SECTION,
    key: ROOM_TYPES_FACT_KEY,
  };
  if (filterList.length > 0) {
    const orClauses: Record<string, unknown>[] = [];
    if (filterUuids.length > 0) orClauses.push({ competitorId: { in: filterUuids } });
    if (filterSlugs.size > 0) orClauses.push({ competitor: { placeId: { in: [...filterSlugs] } } });
    if (orClauses.length > 0) where.OR = orClauses;
  }

  const rows = await dbClient.competitorFact.findMany({
    where,
    include: { competitor: { select: { id: true, name: true, placeId: true } } },
    orderBy: { observedAt: "desc" },
  });

  for (const row of rows) {
    const payload = row.value as Partial<StoredRoomTypesPayload> | null;
    if (!payload || !Array.isArray(payload.roomTypes) || payload.roomTypes.length === 0) continue;

    const compName = row.competitor?.name ?? "";
    const baselineMatch =
      (row.competitor?.placeId ? getHotelRoomTypes(row.competitor.placeId) : null) ??
      (typeof payload.hotelId === "string" ? getHotelRoomTypes(payload.hotelId) : null) ??
      (compName ? getHotelRoomTypes(compName) : null);

    const hotelId =
      row.competitor?.placeId?.trim() ||
      (typeof payload.hotelId === "string" && payload.hotelId.trim()) ||
      baselineMatch?.hotelId ||
      row.competitorId;

    const observedMs = row.observedAt instanceof Date ? row.observedAt.getTime() : Date.parse(String(row.observedAt));
    // Jika baseline ada dan lebih baru daripada fakta DB, pertahankan baseline.
    if (baselineMatch && Number.isFinite(baselineMs) && Number.isFinite(observedMs) && observedMs < baselineMs) {
      if (!result.has(baselineMatch.hotelId)) {
        result.set(baselineMatch.hotelId, {
          ...baselineMatch,
          roomTypes: baselineMatch.roomTypes.map((rt) => ({ ...rt, highlights: [...rt.highlights] })),
        });
      }
      continue;
    }

    const fallbackObserved = Number.isFinite(observedMs)
      ? new Date(observedMs).toISOString().slice(0, 10)
      : HOTEL_ROOM_TYPES_META.observedAt;
    const parsedRooms = payload.roomTypes
      .map((rt) => parseStoredRoomType(rt, row.sourceUrl, fallbackObserved))
      .filter((rt): rt is HotelRoomTypeSpec => rt !== null);
    if (parsedRooms.length === 0) continue;

    // Hasil penyegaran digabung dengan profil yang sudah ada (data riset), bukan menggantikannya.
    const existing = result.get(hotelId) ?? (baselineMatch ? result.get(baselineMatch.hotelId) : undefined);
    const roomTypes = existing ? mergeRoomTypeLayers(existing.roomTypes, parsedRooms) : parsedRooms;
    const hasMultiBedroomUnit = roomTypes.some((rt) => (rt.bedrooms ?? 0) >= 2);
    const multiBedroomNoteRaw = typeof payload.multiBedroomNote === "string" ? sanitizeAiModelText(payload.multiBedroomNote) : "";

    result.set(hotelId, {
      hotelId,
      name: sanitizeAiModelText(compName || baselineMatch?.name || hotelId),
      hasMultiBedroomUnit,
      multiBedroomNote: multiBedroomNoteRaw || existing?.multiBedroomNote || null,
      roomTypes,
    });
  }

  return result;
}
