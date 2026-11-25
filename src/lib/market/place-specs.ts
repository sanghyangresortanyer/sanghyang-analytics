/**
 * Agregator spesifikasi tempat, fasilitas, visual, dan ulasan terstruktur (Fase P6).
 * Menggabungkan registri Competitor, CompetitorFact, ROOM_SIZES, VisualInsight,
 * dan reviewTopicsOf dalam satu kontrak data bersih dengan ketertelusuran sumber (provenance).
 */
import { cache } from "react";
import { withCachedMap } from "../cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "../cache/tags";
import { db } from "../db";
import { loadFacts, type StoredFact } from "./competitor-facts";
import { ROOM_SIZES, type RoomSize } from "./hotel-compset";
import { getVisualInsight } from "./competitor-visual-insights";
import { reviewTopicsOf } from "./review-topics";
import type { OutletKey } from "./outlet-filters";

export interface PlaceFacilitySummary {
  /** Smart TV (Android/Google TV dengan aplikasi streaming); false jika TV biasa/flat-screen tanpa smart, null jika belum ada data. */
  smartTv: boolean | null;
  /** Catatan pembuktian spesifikasi TV. */
  smartTvNote: string | null;
  /** Ketersediaan fasilitas bathtub/kolam rendam pribadi di kamar; null jika belum ada data. */
  bathtub: boolean | null;
  /** Catatan tipe kamar atau pembuktian bathtub. */
  bathtubNote: string | null;
  /** Ketersediaan kolam renang infinity / sea pool; null jika belum ada data. */
  infinityPool: boolean | null;
  /** Jenis kolam renang (misal: "Infinity pool tebing", "Sea pool", "Lagoon outdoor"). */
  poolType: string | null;
  /** Ketersediaan pemandian air panas alami (natural hot spring); null jika belum ada data. */
  hotSpring: boolean | null;
  /** Catatan pembuktian fasilitas pemandian air panas. */
  hotSpringNote: string | null;
  /** Daftar ukuran kamar terverifikasi dalam m² (terurut naik). */
  roomSizesM2: number[];
  /** Label rentang luas kamar, misal "24–125 m²" atau null bila data kosong. */
  roomSizeRangeLabel: string | null;
  /** Daftar fasilitas unggulan kamar dan resor. */
  keyAmenities: string[];
  /** Konsep arsitektur atau gaya desain tempat usaha. */
  designStyle: string | null;
  /** Pembeda utama (USP) menurut pembacaan grounding resmi. */
  usp: string | null;
}

/** Rujukan sumber satu fakta; `url` null bila sumbernya catatan tanpa tautan, `observedAt` null bila tanggalnya tidak tercatat. */
export interface SourceRef {
  label: string;
  url: string | null;
  observedAt: string | null;
}

export type FacilitySourceKey = "roomCount" | "roomSize" | "smartTv" | "bathtub" | "pool" | "hotSpring" | "amenities" | "design";

/** Kunci fakta CompetitorFact yang menjadi dasar tiap fasilitas di ringkasan. */
const FACILITY_FACT_KEYS: Record<FacilitySourceKey, string[]> = {
  roomCount: ["jumlah_kamar"],
  roomSize: ["luas_kamar"],
  smartTv: ["smart_tv"],
  bathtub: ["bathtub"],
  pool: ["infinity_pool"],
  hotSpring: ["hot_spring"],
  amenities: ["fasilitas_kamar"],
  design: ["konsep_desain"],
};

const OTA_HOST = /(booking|agoda|traveloka|tiket|trip|expedia|hotels|klook|bluepillow|hometogo|priceline|vio|tripadvisor)\./i;
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : url);

/** Label sumber dari alamatnya: situs resmi tempat itu, OTA, Google Maps, atau nama domain lain. */
export function sourceLabelForUrl(url: string, websiteUrl: string | null): string {
  const host = hostOf(url);
  if (websiteUrl && URL.canParse(websiteUrl) && host === hostOf(websiteUrl)) return `Situs resmi ${host}`;
  if (/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url)) return "Google Maps";
  if (OTA_HOST.test(host)) return `OTA ${host}`;
  return host;
}

export interface PlaceSpecs {
  /** Pengenal unik tempat (placeId kanonis, misal: 'sanghyang', 'aston_anyer', 'sunset_grill_sanghyang'). */
  placeId: string;
  /** Nama resmi tempat usaha. */
  name: string;
  /** UUID baris di basis data. */
  competitorId: string;
  /** Kategori usaha ('resort', 'hotel', 'resto', 'bar', 'spa'). */
  category: string | null;
  /** Kelompok usaha ('resort', 'resto', 'bar', 'spa'). */
  group: string | null;
  /** Daftar outlet Sanghyang yang beririsan dengan tempat ini. */
  outlets: string[];
  /** Apakah ini properti internal Sanghyang. */
  isSanghyang: boolean;
  /** Peran compset ('inti', 'benchmark', atau null). */
  compsetRole: string | null;
  /** Kelas bintang hotel (jika penginapan, null jika non-penginapan). */
  starRating: number | null;
  /** Jumlah kamar total (jika tercatat resmi). */
  roomCount: number | null;
  /** Jarak jalan darat dalam km dari Sanghyang. */
  roadKm: number | null;
  /** Waktu tempuh berkendara mobil dalam menit. */
  driveMinutes: number | null;
  /** Keterangan asal pengukuran jarak. */
  distanceSource: string | null;
  /** Tautan situs resmi tempat usaha. */
  websiteUrl: string | null;
  /** Tautan profil Google Maps. */
  mapsUrl: string | null;
  /** Ringkasan fasilitas terstruktur hasil grounding multi-sumber. */
  facilities: PlaceFacilitySummary;
  /** Wawasan visual arsitektur, suasana, dan foto galeri terverifikasi. */
  visual: {
    designStyle: string | null;
    ambience: string | null;
    keyElements: string[];
    materialsAndLighting: string | null;
    marketingOpportunity: string | null;
    photoUrls: string[];
  } | null;
  /** Ringkasan ulasan pengunjung Google Maps. */
  reviewHighlights: {
    topics: { label: string; count: number }[];
    topThemes: string[];
  };
  /** Daftar sumber data berprovenans sah (Zero Mock). */
  sources: { label: string; url: string; observedAt: string }[];
  /** Sumber per fasilitas di ringkasan (dari URL fakta yang mendasarinya). */
  facilitySources: Partial<Record<FacilitySourceKey, SourceRef>>;
}

/**
 * Memetakan daftar fakta mentah dan ukuran kamar menjadi ringkasan fasilitas terstruktur.
 */
export function summarizeFacilities(facts: StoredFact[], roomSizes: RoomSize[]): PlaceFacilitySummary {
  const factByKey = new Map<string, StoredFact>();
  for (const f of facts) {
    factByKey.set(f.key, f);
  }

  // 1. Smart TV
  let smartTv: boolean | null = null;
  let smartTvNote: string | null = null;
  const tvFact = factByKey.get("smart_tv");
  if (tvFact) {
    smartTvNote = tvFact.text;
    const lower = tvFact.text.toLowerCase();
    if (lower.includes("tidak ada") || lower.includes("tidak tersedia") || lower.includes("tidak disediakan")) {
      smartTv = false;
    } else if (lower.includes("smart tv") && !lower.includes("tidak disebut") && !lower.includes("bukan smart")) {
      smartTv = true;
    } else if (lower.includes("flat-screen") || lower.includes("layar datar") || lower.includes("tv kabel") || lower.includes("tv satelit") || lower.includes("televisi")) {
      smartTv = false;
    }
  }

  // 2. Bathtub
  let bathtub: boolean | null = null;
  let bathtubNote: string | null = null;
  const bathFact = factByKey.get("bathtub");
  if (bathFact) {
    bathtubNote = bathFact.text;
    const lower = bathFact.text.toLowerCase();
    if (lower.includes("tidak tersedia") || lower.includes("tidak disediakan") || lower.includes("hanya shower")) {
      bathtub = false;
    } else if (lower.includes("tersedia") || lower.includes("ada") || lower.includes("dilengkapi bathtub") || lower.includes("memiliki bathtub") || lower.includes("soaking bathtub")) {
      bathtub = true;
    }
  }

  // 3. Infinity Pool / Pool
  let infinityPool: boolean | null = null;
  let poolType: string | null = null;
  const poolFact = factByKey.get("infinity_pool");
  if (poolFact) {
    poolType = poolFact.text;
    const lower = poolFact.text.toLowerCase();
    if (lower.includes("tidak ada kolam")) {
      infinityPool = false;
    } else if (lower.includes("infinity") || lower.includes("sea pool") || lower.includes("tebing")) {
      infinityPool = true;
    } else if (lower.includes("kolam renang") || lower.includes("swimming pool") || lower.includes("lagoon")) {
      infinityPool = false;
    }
  }

  // 4. Hot Spring
  let hotSpring: boolean | null = null;
  let hotSpringNote: string | null = null;
  const hotFact = factByKey.get("hot_spring");
  if (hotFact) {
    hotSpringNote = hotFact.text;
    const lower = hotFact.text.toLowerCase();
    if (lower.includes("tidak ada") || lower.includes("tidak memiliki") || lower.includes("tidak tersedia")) {
      hotSpring = false;
    } else if (lower.includes("memiliki") || lower.includes("tersedia") || lower.includes("satu-satunya") || lower.includes("air panas") || lower.includes("hot spring")) {
      hotSpring = true;
    }
  }

  // 5. Luas Kamar (m²)
  const sizesSet = new Set<number>();
  for (const r of roomSizes) {
    if (r.sizeM2 && r.sizeM2 > 0) sizesSet.add(r.sizeM2);
  }
  const luasFact = factByKey.get("luas_kamar");
  if (luasFact) {
    const matches = luasFact.text.matchAll(/(\d{2,3})\s*(?:m²|m2|sqm)/gi);
    for (const m of matches) {
      const val = Number.parseInt(m[1], 10);
      if (val >= 10 && val <= 1000) sizesSet.add(val);
    }
  }
  const roomSizesM2 = Array.from(sizesSet).sort((a, b) => a - b);
  let roomSizeRangeLabel: string | null = null;
  if (roomSizesM2.length === 1) {
    roomSizeRangeLabel = `${roomSizesM2[0]} m²`;
  } else if (roomSizesM2.length > 1) {
    roomSizeRangeLabel = `${roomSizesM2[0]}–${roomSizesM2[roomSizesM2.length - 1]} m²`;
  }

  // 6. Fasilitas Kamar & Key Amenities
  const amenitiesSet = new Set<string>();
  const amFact = factByKey.get("fasilitas_kamar");
  if (amFact) {
    const rawItems = amFact.text.replace(/^Fasilitas kamar(?:\s*tercatat)?:\s*/i, "").split(/[,;]\s*/);
    for (const item of rawItems) {
      const trimmed = item.trim();
      if (trimmed && trimmed.length > 1) amenitiesSet.add(trimmed);
    }
  }
  // Tambahkan fasilitas spesifik jika ada
  if (hotSpring) amenitiesSet.add("Natural Hot Spring Aquamedic");
  if (bathtub) amenitiesSet.add("Bathtub");
  if (infinityPool) amenitiesSet.add("Infinity / Sea Pool");

  // 7. Desain & USP
  const designFact = factByKey.get("konsep_desain");
  const designStyle = designFact?.text ?? null;
  const uspFact = factByKey.get("review_menu") ?? factByKey.get("suasana");
  const usp = uspFact?.text ?? designStyle;

  return {
    smartTv,
    smartTvNote,
    bathtub,
    bathtubNote,
    infinityPool,
    poolType,
    hotSpring,
    hotSpringNote,
    roomSizesM2,
    roomSizeRangeLabel,
    keyAmenities: Array.from(amenitiesSet),
    designStyle,
    usp,
  };
}

/**
 * Memuat peta spesifikasi lengkap seluruh tempat usaha, opsional disaring per outletKey.
 * @param outletKey Filter outlet tertentu ('resort', 'sunset-grill', 'dbistro', 'dbar', 'dragon-beach-club', 'dspa')
 */
export const loadPlaceSpecsMap = cache(async (outletKey?: OutletKey | string): Promise<Map<string, PlaceSpecs>> => {
  const normalizedOutlet = outletKey && outletKey !== "all" ? String(outletKey) : "all";
  return withCachedMap(
    () => fetchPlaceSpecsMap(normalizedOutlet === "all" ? undefined : normalizedOutlet),
    ["mi-place-specs", normalizedOutlet],
    { tags: [CACHE_TAGS.marketSpecs, CACHE_TAGS.marketCompetitors], revalidate: CACHE_TTL.marketIntelligence },
  );
});

async function fetchPlaceSpecsMap(outletKey?: OutletKey | string): Promise<Map<string, PlaceSpecs>> {
  const where: Record<string, unknown> = {
    active: true,
    placeId: { not: null },
  };

  if (outletKey && outletKey !== "all") {
    where.outlets = { has: outletKey };
  }

  const competitors = await db.competitor.findMany({
    where,
    orderBy: [{ group: "asc" }, { roadKm: "asc" }, { name: "asc" }],
  });

  const competitorIds = competitors.map((c) => c.id);
  const factsByCompetitor = await loadFacts(competitorIds);

  const resultMap = new Map<string, PlaceSpecs>();

  for (const c of competitors) {
    const placeId = c.placeId as string;
    const isSanghyang = placeId === "sanghyang" || placeId.endsWith("_sanghyang");
    const facts = factsByCompetitor.get(c.id) ?? [];

    // Ambil ukuran kamar dari ROOM_SIZES
    const hotelSizes = ROOM_SIZES.filter(
      (r) => r.hotelId === placeId || (placeId === "aston_anyer" && r.hotelId === "aston") || (placeId === "novus_jiva" && r.hotelId === "novus_jiva"),
    );

    const facilities = summarizeFacilities(facts, hotelSizes);

    // Visual insights
    const vi = getVisualInsight(placeId);
    const visual = vi
      ? {
          designStyle: vi.designStyle ?? null,
          ambience: vi.ambience ?? null,
          keyElements: vi.keyVisualElements ?? [],
          materialsAndLighting: vi.materialsAndLighting ?? null,
          marketingOpportunity: vi.marketingOpportunity ?? null,
          photoUrls: vi.photoUrls ?? [],
        }
      : null;

    // Review highlights dari reviewTopicsOf
    const reviewData = reviewTopicsOf(c.name);
    const reviewHighlights = {
      topics: reviewData?.topics ?? [],
      topThemes: (reviewData?.topics ?? []).slice(0, 5).map((t) => t.label),
    };

    // Susun sumber data (Zero Mock provenance). Tanggal pengamatan yang tidak tercatat tidak diganti tanggal hari ini.
    const sourcesMap = new Map<string, { label: string; url: string; observedAt: string }>();
    const latestFactDateFrom = (url: string | null) => {
      if (!url || !URL.canParse(url)) return null;
      const host = hostOf(url);
      const dates = facts.filter((f) => f.sourceUrl && hostOf(f.sourceUrl) === host).map((f) => f.observedAt.slice(0, 10));
      return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    };

    // Tanggal situs resmi = fakta terbaru yang dibaca dari host situs itu. verifiedAt adalah tanggal periksa daftar
    // kompetitor, bukan tanggal situsnya dibaca.
    const websiteObserved = latestFactDateFrom(c.websiteUrl);
    if (c.websiteUrl && websiteObserved) {
      sourcesMap.set(c.websiteUrl, {
        label: isSanghyang ? "Situs resmi Sanghyang" : sourceLabelForUrl(c.websiteUrl, c.websiteUrl),
        url: c.websiteUrl,
        observedAt: websiteObserved,
      });
    }

    if (c.mapsUrl && c.ratingObservedAt) {
      sourcesMap.set(c.mapsUrl, {
        label: "Profil Google Maps",
        url: c.mapsUrl,
        observedAt: c.ratingObservedAt.toISOString().slice(0, 10),
      });
    }

    for (const f of facts) {
      if (f.sourceUrl && !sourcesMap.has(f.sourceUrl)) {
        sourcesMap.set(f.sourceUrl, {
          label: sourceLabelForUrl(f.sourceUrl, c.websiteUrl),
          url: f.sourceUrl,
          observedAt: f.observedAt,
        });
      }
    }

    if (reviewData?.url && !sourcesMap.has(reviewData.url)) {
      sourcesMap.set(reviewData.url, {
        label: "Topik ulasan Google Maps",
        url: reviewData.url,
        observedAt: reviewData.observedAt,
      });
    }

    for (const hs of hotelSizes) {
      if (hs.sourceUrl && !sourcesMap.has(hs.sourceUrl)) {
        sourcesMap.set(hs.sourceUrl, {
          label: `Luas kamar ${hs.room} (${sourceLabelForUrl(hs.sourceUrl, c.websiteUrl)})`,
          url: hs.sourceUrl,
          observedAt: hs.checkedAt,
        });
      }
    }

    const facilitySources: Partial<Record<FacilitySourceKey, SourceRef>> = {};
    for (const [key, factKeys] of Object.entries(FACILITY_FACT_KEYS) as [FacilitySourceKey, string[]][]) {
      const fact = facts.find((f) => factKeys.includes(f.key) && f.sourceUrl);
      if (fact) {
        facilitySources[key] = { label: sourceLabelForUrl(fact.sourceUrl, c.websiteUrl), url: fact.sourceUrl, observedAt: fact.observedAt.slice(0, 10) };
      }
    }
    const sizeSource = hotelSizes.find((hs) => hs.sourceUrl);
    if (!facilitySources.roomSize && sizeSource?.sourceUrl) {
      facilitySources.roomSize = { label: sourceLabelForUrl(sizeSource.sourceUrl, c.websiteUrl), url: sizeSource.sourceUrl, observedAt: sizeSource.checkedAt };
    }
    if (!facilitySources.design && vi?.designStyle) {
      const galleryOutlet = c.outlets[0];
      facilitySources.design = {
        label: "Galeri foto Google Maps",
        url: galleryOutlet ? `/galeri-kompetitor?outlet=${encodeURIComponent(galleryOutlet)}` : null,
        observedAt: null,
      };
    }

    const specs: PlaceSpecs = {
      placeId,
      name: c.name,
      competitorId: c.id,
      category: c.category,
      group: c.group,
      outlets: c.outlets,
      isSanghyang,
      compsetRole: c.compsetRole,
      starRating: c.starRating,
      roomCount: c.roomCount,
      roadKm: c.roadKm,
      driveMinutes: c.driveMinutes,
      distanceSource: c.distanceSource,
      websiteUrl: c.websiteUrl,
      mapsUrl: c.mapsUrl,
      facilities,
      visual,
      reviewHighlights,
      sources: Array.from(sourcesMap.values()),
      facilitySources,
    };

    resultMap.set(placeId, specs);
  }

  return resultMap;
}

/**
 * Mengambil spesifikasi satu tempat usaha berdasarkan placeId atau nama.
 */
export async function getPlaceSpecs(placeIdOrName: string, outletKey?: OutletKey | string): Promise<PlaceSpecs | null> {
  const map = await loadPlaceSpecsMap(outletKey);
  const byId = map.get(placeIdOrName);
  if (byId) return byId;

  // Coba pencarian toleran berdasarkan nama atau lowercase placeId
  const lower = placeIdOrName.toLowerCase().trim();
  for (const specs of map.values()) {
    if (specs.placeId.toLowerCase() === lower || specs.name.toLowerCase() === lower) {
      return specs;
    }
  }
  return null;
}
