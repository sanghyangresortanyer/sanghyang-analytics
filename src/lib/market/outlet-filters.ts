/**
 * Filter per outlet yang dipakai bersama oleh halaman Insight Pasar, summary API, dan laporan PDF,
 * supaya isi laporan selalu sama dengan yang tampil di layar.
 */

export const OUTLET_KEYS = ["sunset-grill", "dragon-beach-club", "resort", "dbistro", "dbar", "dspa"] as const;
export type OutletKey = (typeof OUTLET_KEYS)[number];

export const OUTLET_PLACE_IDS: Record<OutletKey, string> = {
  "sunset-grill": "sunset_grill_sanghyang",
  "dragon-beach-club": "dragon_beach_club_sanghyang",
  dbistro: "dbistro_sanghyang",
  dbar: "dbar_sanghyang",
  dspa: "dspa_sanghyang",
  resort: "sanghyang",
};

export const isOutletKey = (value: unknown): value is OutletKey => OUTLET_KEYS.includes(value as OutletKey);

import { isKnownOtaProvider } from "./ota-providers";

export type ReviewChannel = "google" | "ota" | "social" | "website";

export const SOCIAL_REVIEW_PLATFORMS = ["instagram", "tiktok", "facebook"] as const;

/**
 * Komentar Instagram/TikTok/Facebook dari ekstensi tersimpan di CompetitorReview, tetapi bukan ulasan tamu
 * (keputusan pemilik 27 Nov 2026). Hitungan ulasan Insight Pasar, PDF Rapat Senin, dan Knowledge Graph memakai filter ini.
 */
export const GUEST_REVIEWS_ONLY = {
  NOT: SOCIAL_REVIEW_PLATFORMS.map((platform) => ({ source: { contains: platform, mode: "insensitive" as const } })),
};

export function channelFromSource(
  source: string,
  dynamicOtaProviders?: Iterable<string>,
): ReviewChannel {
  const s = source.toLowerCase();
  if (s.includes("google") || s.includes("maps")) return "google";
  if (SOCIAL_REVIEW_PLATFORMS.some((p) => s.includes(p))) return "social";
  if (isKnownOtaProvider(source, dynamicOtaProviders)) return "ota";
  return "website";
}

/** Perbandingan head-to-head milik outlet; "all" berarti semua outlet. */
export const comparisonsForOutlet = <T extends { outlet?: string }>(list: T[], outlet: string): T[] =>
  outlet === "all" ? list : list.filter((c) => c.outlet === outlet);

/** Outlet di dalam hotel pesaing menurut registri (baris anak), beserta outlet Sanghyang pembandingnya. */
export interface PromoVenue {
  name: string;
  outlets: string[];
}

interface PromoLike {
  competitorName: string;
  category?: string;
  title: string;
  /** Outlet pembanding pesaing menurut registri (lib/market/compset.ts). */
  competitorOutlets?: string[];
  competitorIsLodging?: boolean;
  competitorVenues?: PromoVenue[];
}

const has = (text: string, ...words: string[]) => words.some((w) => text.toLowerCase().includes(w));

/** Pencocokan lama berdasarkan nama untuk data tanpa informasi registri. */
const LEGACY_MATCHERS: Record<OutletKey, (p: PromoLike) => boolean> = {
  "sunset-grill": (p) =>
    has(p.competitorName, "andalan", "omah laut") ||
    (has(p.competitorName, "aston") && p.category === "F&B & Kuliner") ||
    has(p.title, "seafood", "dining"),
  "dragon-beach-club": (p) =>
    has(p.competitorName, "novus", "upper circle", "mambruk") || p.category === "Acara & Live Music" || has(p.title, "sunset"),
  resort: (p) => ["Kamar & Menginap", "Keluarga & Anak", "Digital & Booking"].includes(p.category ?? ""),
  dspa: (p) => p.category === "Wellness & Relaksasi" || has(p.title, "yoga", "spa"),
  dbistro: (p) => p.category === "F&B & Kuliner" || has(p.title, "soto", "restaurant"),
  // Kata utuh: "bar" tidak boleh cocok dengan "Tahun Baru".
  dbar: (p) => /\b(bar|lounge|karaoke|mocktails?|cocktails?|drinks?)\b/i.test(p.title),
};

/**
 * Kata kunci judul promo per outlet (keputusan pemilik 16 Nov 2026), dicocokkan sebagai kata utuh: resto hotel, sarapan,
 * dan makan malam ke D'Bistro; grill, seafood, dan bakar ke Sunset Grill; bar, lounge, mocktail, cocktail, DJ, dan pesta
 * ke D'Bar dan/atau Dragon Beach Club; spa dan pijat ke D'Spa; kamar, menginap, dan kolam renang ke Kamar & Resort.
 * "Drink" sengaja tidak ada: paket makan resto hotel sering menyertakan minuman.
 */
const PROMO_KEYWORDS: Record<OutletKey, string[]> = {
  resort: ["kamar", "menginap", "inap", "staycation", "kolam renang", "kolam", "pool", "room", "rooms"],
  dbistro: ["restoran", "restaurant", "resto", "sarapan", "breakfast", "brunch", "dinner", "makan malam", "lunch", "makan siang", "buffet", "menu", "kuliner", "f&b", "dining", "soto", "nasi"],
  "sunset-grill": ["grill", "seafood", "bakar", "bbq", "barbecue", "ikan", "udang", "cumi", "kerapu", "kakap", "lobster", "kepiting"],
  dbar: ["bar", "lounge", "karaoke", "mocktail", "mocktails", "cocktail", "cocktails", "koktail"],
  "dragon-beach-club": ["dj", "party", "pesta", "beach club", "klub malam", "nightclub"],
  dspa: ["spa", "pijat", "massage", "yoga", "wellness", "relaksasi", "treatment", "refleksi"],
};
const FNB_CATEGORIES = new Set(["F&B & Kuliner", "F&B Hemat"]);
/** Kata umum nama outlet hotel; nama yang hanya berisi kata ini ("Sunset Cafe") harus disebut utuh di judul. */
const GENERIC_VENUE_WORDS = new Set(
  "restaurant restoran resto dining cafe café kafe bistro grill bar lounge pub spa pool kolam renang beach pantai rooftop coffee shop main utama all day sunset the & and dan".split(" "),
);

const tokensOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
const phraseAt = (tokens: string[], phrase: string[]) =>
  phrase.length ? tokens.findIndex((_, i) => phrase.every((w, j) => tokens[i + j] === w)) : -1;

/** Kata nama outlet tanpa kata nama hotelnya: "Lighthouse Restaurant & Bar Mambruk" menjadi lighthouse restaurant & bar. */
function venueWords(venueName: string, hotelName: string): string[] {
  const hotel = new Set(tokensOf(hotelName));
  return tokensOf(venueName).filter((w) => !hotel.has(w));
}

function venueNamed(words: string[], titleTokens: string[]): boolean {
  const distinctive = words.filter((w) => !GENERIC_VENUE_WORDS.has(w));
  return distinctive.length ? distinctive.every((w) => titleTokens.includes(w)) : phraseAt(titleTokens, words) >= 0;
}

/** Outlet bawaan menurut kategori bila judul tidak menyebut venue atau kata kunci; promo F&B hotel ada di restorannya. */
function categoryOutlets(category: string, lodging: boolean): OutletKey[] {
  if (FNB_CATEGORIES.has(category)) return lodging ? ["dbistro"] : ["sunset-grill", "dbistro"];
  if (category === "Acara & Live Music") return ["dragon-beach-club", "dbar"];
  if (category === "Wellness & Relaksasi") return ["dspa"];
  return ["resort"];
}

const inOrder = (outlets: Iterable<string>): OutletKey[] => {
  const set = new Set(outlets);
  return OUTLET_KEYS.filter((k) => set.has(k));
};

/**
 * Outlet Sanghyang tempat promo pesaing relevan.
 * - Pesaing penginapan: bila judul menyebut outlet di dalam hotel itu (registri), promo ikut outlet venue tersebut yang
 *   juga cocok dengan kata kunci judul; kata nama venue tidak dihitung sebagai kata kunci, jadi "Restaurant" di
 *   "Lighthouse Restaurant" tidak menyeret promo kolam renang ke D'Bistro. Kamar dan kolam renang adalah produk hotel,
 *   jadi tetap ikut. Tanpa venue: kata kunci judul, lalu kategori promo.
 * - Pesaing mandiri hanya dibandingkan dengan outlet registrinya; kata kunci atau kategori mempersempitnya bila ia
 *   pembanding beberapa outlet (Kamalika: pesta Halloween ke Dragon Beach Club, bukan Sunset Grill).
 */
export function promoOutlets(p: PromoLike): OutletKey[] {
  if (!p.competitorOutlets) return OUTLET_KEYS.filter((k) => LEGACY_MATCHERS[k](p));
  let tokens = tokensOf(p.title);
  const hotelAt = phraseAt(tokens, tokensOf(p.competitorName));
  if (hotelAt >= 0) tokens = [...tokens.slice(0, hotelAt), ...tokens.slice(hotelAt + tokensOf(p.competitorName).length)];
  const venueOutlets = new Set<string>();
  for (const venue of p.competitorVenues ?? []) {
    const words = venueWords(venue.name, p.competitorName);
    if (!venueNamed(words, tokens)) continue;
    venue.outlets.forEach((o) => venueOutlets.add(o));
    tokens = tokens.filter((w) => !words.includes(w));
  }
  const keywords = OUTLET_KEYS.filter((k) => PROMO_KEYWORDS[k].some((kw) => phraseAt(tokens, kw.split(" ")) >= 0));

  if (p.competitorIsLodging) {
    if (venueOutlets.size) {
      const atVenue = keywords.filter((k) => venueOutlets.has(k));
      if (atVenue.length) return inOrder([...atVenue, ...keywords.filter((k) => k === "resort")]);
      return keywords.length ? keywords : inOrder(venueOutlets);
    }
    return keywords.length ? keywords : categoryOutlets(p.category ?? "", true);
  }
  const registry = inOrder(p.competitorOutlets);
  const wanted = keywords.length ? keywords : categoryOutlets(p.category ?? "", false);
  const narrowed = registry.filter((k) => wanted.includes(k));
  return narrowed.length ? narrowed : registry;
}

export const promoMatchesOutlet = (p: PromoLike, outlet: OutletKey): boolean => promoOutlets(p).includes(outlet);

/** Nama resor dibuang sebelum mencari nama outlet di usulan, karena "Sanghyang Indah Spa Resort" memuat kata Spa. */
const OWN_PROPERTY = /sanghyang indah spa resort/giu;
const COUNTER_MENTIONS: Record<Exclude<OutletKey, "resort">, RegExp> = {
  "sunset-grill": /(?<![\p{L}\p{N}])sunset grill(?![\p{L}\p{N}])/iu,
  "dragon-beach-club": /(?<![\p{L}\p{N}])dragon beach club(?![\p{L}\p{N}])/iu,
  dbistro: /(?<![\p{L}\p{N}])d['’]?\s?bistro(?![\p{L}\p{N}])/iu,
  dbar: /(?<![\p{L}\p{N}])(d['’]?\s?bar|karaoke)(?![\p{L}\p{N}])/iu,
  dspa: /(?<![\p{L}\p{N}])(d['’]?\s?spa|spa|hot spring|aquamedic)(?![\p{L}\p{N}])/iu,
};

/**
 * Usulan "Versi kita" untuk outlet terpilih, atau null bila usulannya untuk outlet lain. Gemini menulis satu usulan per
 * promo tanpa tahu outletnya; usulan yang menyebut outlet lain (mis. Sunset Grill pada promo yang tampil di D'Bistro)
 * tidak ditampilkan. Usulan tanpa nama outlet tetap tampil. Kamar & Resort dan Semua Outlet menampilkan usulannya karena
 * paket menginap memang menyebut outlet lain sebagai bonus.
 */
export function counterStrategyFor(p: { counterStrategy?: string }, outlet: string): string | null {
  const text = p.counterStrategy?.trim();
  if (!text) return null;
  if (!isOutletKey(outlet) || outlet === "resort") return text;
  const about = text.replace(OWN_PROPERTY, "");
  const named = (Object.keys(COUNTER_MENTIONS) as (keyof typeof COUNTER_MENTIONS)[]).filter((k) => COUNTER_MENTIONS[k].test(about));
  return named.length === 0 || named.includes(outlet) ? text : null;
}

export const promosForOutlet = <T extends PromoLike>(list: T[], outlet: string): T[] =>
  isOutletKey(outlet) ? list.filter((p) => promoMatchesOutlet(p, outlet)) : list;

/** Promo yang sudah lewat tetap disimpan dan ditampilkan sebagai riwayat; scrape berikutnya memperbarui baris yang sama. */
export const PROMO_STATUS_LABEL: Record<string, string> = { active: "Aktif", upcoming: "Segera datang", expired: "Sudah berakhir" };
const STATUS_ORDER: Record<string, number> = { active: 0, upcoming: 1, expired: 2 };

export const sortPromos = <T extends { status: string; startsAt: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.startsAt.localeCompare(a.startsAt));

/** Kelompok promo per kompetitor: kompetitor dengan promo aktif terbanyak lebih dulu, promo aktif di atas riwayat. */
export function groupPromosByCompetitor<T extends PromoLike & { status: string; startsAt: string; competitorHandle?: string }>(list: T[]) {
  const groups = new Map<string, T[]>();
  for (const p of list) groups.set(p.competitorName, [...(groups.get(p.competitorName) ?? []), p]);
  return [...groups.entries()]
    .map(([competitorName, promos]) => ({
      competitorName,
      handle: promos.find((p) => p.competitorHandle)?.competitorHandle ?? "",
      promos: sortPromos(promos),
      activeCount: promos.filter((p) => p.status === "active").length,
    }))
    .sort((a, b) => b.activeCount - a.activeCount || a.competitorName.localeCompare(b.competitorName));
}

/** Kategori postingan Instagram mentah dari radar (belum dibaca isinya), lihat scrape-social-buzz.ts. */
export const SOCIAL_POST_CATEGORY = "Postingan Sosmed Baru";
/** Postingan mentah belum tentu promo: ditampilkan terpisah dari promo hasil kurasi. */
export const isRawSocialPost = (p: { category: string }) => p.category === SOCIAL_POST_CATEGORY;
export const RAW_POST_LABEL = "Postingan baru · perlu ditinjau";
