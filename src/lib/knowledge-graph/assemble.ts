/**
 * Perakit graf pengetahuan terpadu lintas seluruh modul aplikasi (fungsi murni, tanpa akses DB).
 * Menghubungkan 6 outlet Sanghyang, tipe kamar resmi, kompetitor berbobot holistik, tarif OTA + status sarapan,
 * promo vs event terpisah, ulasan & tema sentimen, akun media sosial (IG & TikTok), galeri visual & fasilitas,
 * sinyal berita, sinyal operasional VHP bebas rupiah, serta strategi/target (`/`, `/dashboard`, `/direksi`,
 * `/market-intelligence`, `/galeri-kompetitor`, `/marketing-sosmed`, `/marketing?bagian=strategy`, `/pengaturan`).
 * Relasi ke simpul yang tidak ada langsung dilempar sebagai galat.
 */
import type { InternalOutletSignalsMap } from "../analytics/internal-signals-types";
import { parseCompsetRole } from "../market/compset";
import { HOLISTIC_SCORE_THRESHOLDS } from "../market/competitor-holistic-matcher";
import type { ResortMarketSize } from "../market/market-size";
import type { OutletKey } from "../market/outlet-filters";
import { mergePromoCaptures, promoDayLabel } from "../market/promo-radar";
import { OWN_TEAM_SOURCE } from "../market/own-promos";
import { visibleThemes } from "../market/review-outlet-tagger";
import { byText, newestArticleFirst, newestFirst } from "../market/stable-order";
import {
  APP_MODULES,
  APP_MODULE_META,
  type AppModuleKey,
  type GraphLink,
  type GraphLinkFactor,
  type GraphNode,
  type GraphSource,
  type KnowledgeGraph,
  type KnowledgeGraphModuleSummary,
  type NodeKind,
} from "./types";

export interface CompetitorInput {
  id: string;
  name: string;
  category: string | null;
  outlets: string[];
  placeId: string | null;
  roadKm: number | null;
  starRating: number | null;
  rating: number | null;
  reviewCount: number | null;
  /** Asal rating di daftar kompetitor, mis. "Google Maps"; null bila belum dibaca. */
  ratingSource: string | null;
  /** Listing yang dibaca saat rating diperbarui; untuk outlet di dalam hotel bisa berbeda dari tautan utamanya. */
  ratingSourceUrl: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  compsetRole: string | null;
  active: boolean;
  retiredReason: string | null;
  observedAt: Date | null;
  /** Hotel induk untuk restoran, bar, atau spa di dalam hotel kompetitor. */
  parentId: string | null;
  /** Tautan Google Maps hotel induk; outlet yang tautannya sama belum punya listing sendiri. */
  parentMapsUrl: string | null;
}

/** Satu tarif Google Hotels dari putaran terakhir sebuah hotel (dipilih build.ts). competitorId null = Sanghyang. */
export interface RateInput {
  competitorId: string | null;
  price: number;
  currency: string;
  guests: number;
  checkIn: Date | null;
  sourceUrl: string | null;
  observedAt: Date;
}

export interface PromoInput {
  id: string;
  competitorId: string;
  title: string;
  category: string;
  discount: number | null;
  source: string;
  sourceUrl: string | null;
  capturedAt: Date;
  /** Tanggal mulai tertulis, atau tanggal tangkap bila sumbernya tidak menulis tanggal. */
  startsAt: Date;
  endsAt: Date | null;
  imageUrl?: string | null;
  price?: unknown;
  status?: string;
  /** Promo atau event; null bila belum diklasifikasikan. */
  kind?: "promo" | "event" | null;
  details?: string[];
  competitor: { active: boolean; name: string };
}

export interface ReviewInput {
  competitorId: string;
  themes: string[];
  sentiment: string;
  source: string;
  sourceUrl: string;
  capturedAt: Date;
  /** Tanggal ulasan ditulis tamu; periode graf disaring dengan tanggal ini. */
  reviewDate: Date;
}

export interface ArticleInput {
  id: string;
  title: string;
  url: string | null;
  publisher: string;
  publishedAt: Date | null;
}

export interface FactInput {
  id: string;
  competitorId: string;
  section: string;
  key: string;
  value: unknown;
  sourceUrl: string;
  observedAt: Date;
}

/** Tipe kamar resmi Sanghyang untuk simpul `kamar` di graf pengetahuan. */
export interface OfficialRoomTypeInput {
  name: string;
  category: string;
  bedrooms: number | null;
  areaLabel: string;
  smartTv: boolean | null;
  bathtub: boolean | null;
  weekdayPrice: number | null;
  weekendPrice: number | null;
  breakfastLabel?: string | null;
  otaName?: string | null;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
}

/** Ringkasan perbandingan tarif dengan vs tanpa sarapan per hotel dari evaluasi direksi. */
export interface BreakfastRateSummaryInput {
  hotelId: string;
  hotel: string;
  stay: "weekday" | "weekend";
  withBreakfast: number | null;
  withoutBreakfast: number | null;
}

/** Ringkasan koridor harga kamar (lantai P25 / median / plafon P75) untuk modul /direksi. */
export interface RoomCorridorSummaryInput {
  kind: string;
  room: string;
  weekdaySanghyang: number | null;
  weekdayFloor: number | null;
  weekdayMedian: number | null;
  weekendSanghyang: number | null;
  weekendFloor: number | null;
  weekendMedian: number | null;
  positionWeekday: string;
  positionWeekend: string;
}

/** Target dan strategi bulanan dari tabel MarketingGoal (pengaturan target & strategi). */
export interface MarketingGoalInput {
  outletKey: string;
  month: string;
  targetRevenueGrowthPct: number | null;
  targetRating: number | null;
  strategy: string;
  decisions: string;
  filledBy: string;
  evaluation: string | null;
  updatedAt: Date;
}

/** Potret bulanan performa outlet (modul /dashboard & /marketing?bagian=strategy). */
export interface MonthlySnapshotInput {
  outletKey: string;
  month: string;
  googleRating: number | null;
  pricePositioningIndex: number | null;
  reviewsRecorded: number;
  capturedAt: Date;
}

/** Skor holistik kompetitor per pasangan (competitorId|outletKey) dari mesin holistic matcher. */
export interface HolisticScoreInput {
  competitorId: string;
  outletKey: string;
  score: number;
  factors: GraphLinkFactor[];
  summary?: string;
}

export interface GraphInput {
  now: Date;
  range?: { from: string; to: string; label: string } | null;
  ownOutlets: { outletKey: string; competitorName: string; label: string }[];
  competitors: CompetitorInput[];
  promos: PromoInput[];
  reviews: ReviewInput[];
  articles: ArticleInput[];
  tpk: { percent: number; period: string; sourceTitle: string; sourceUrl: string } | null;
  marketSize: ResortMarketSize;
  ratesCapturedAt: string;
  /** @deprecated Tidak lagi dipakai membangun simpul pasif statistik:omset:*; digantikan internalSignals VHP. */
  revenues?: { outletKey: string; month: string; sourceFile: string }[];
  /** Sinyal operasional VHP terabstraksi per outlet (tanpa nominal rupiah). */
  internalSignals?: InternalOutletSignalsMap | null;
  /** Tarif Google Hotels putaran terakhir tiap hotel. */
  rates: RateInput[];
  facts?: FactInput[];
  visualInsights?: Record<string, { designStyle: string; ambience: string; keyVisualElements: string[]; photoCount: number }>;
  galleryPhotoCounts?: Record<string, number>;
  officialMenus?: Record<string, { items: { name: string; price: number; category: string | null; unit: string | null }[] }>;
  competitorMenus?: Record<string, { items: { name: string; price: number; unit: string | null }[]; perPerson: { min: number; max: number; url: string; capturedAt: string } | null; sources: { label: string; url: string }[] }>;
  socialAccounts?: { platform: string; label: string; url: string; owner: string; outlets: string[] }[];
  socialPosts?: { account: string; url: string; postedAt: string; postType: string; caption: string; likes: number | null; platform?: string }[];
  socialFollowers?: Record<string, { followers: number }>;
  /** Tipe kamar resmi Sanghyang Resort. */
  officialRoomTypes?: OfficialRoomTypeInput[];
  /** Perbandingan tarif termasuk vs tanpa sarapan (terhubung ke /direksi). */
  breakfastRates?: BreakfastRateSummaryInput[];
  /** Ringkasan evaluasi paritas sarapan direksi (`/direksi`). */
  executiveBreakfastNote?: string | null;
  /** Koridor harga kamar bintang 4 (lantai P25 & median) untuk /direksi. */
  roomCorridors?: RoomCorridorSummaryInput[];
  /** Tujuan & strategi bulanan per outlet (/pengaturan & /marketing?bagian=strategy). */
  goals?: MarketingGoalInput[];
  /** Potret performa bulanan per outlet (/dashboard & /marketing?bagian=strategy). */
  monthlySnapshots?: MonthlySnapshotInput[];
  /** Skor & faktor holistik per pasangan (competitorId, outletKey). */
  holisticScores?: HolisticScoreInput[];
}

const GENERIC_WORDS = new Set(["hotel", "resort", "villas", "villa", "beach", "anyer", "carita", "banten", "family", "suites", "place", "convention", "spa"]);
const fold = (text: string) => text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const isWordChar = (c: string | undefined) => c !== undefined && /[a-z0-9]/.test(c);
function containsWord(text: string, word: string): boolean {
  for (let from = text.indexOf(word); from >= 0; from = text.indexOf(word, from + 1)) {
    if (!isWordChar(text[from - 1]) && !isWordChar(text[from + word.length])) return true;
  }
  return false;
}
const juta = (n: number) => (n >= 1e9 ? `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M` : `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Jt`);
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
const slug = (text: string) => fold(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function withoutPublisher(title: string): string {
  const cut = title.lastIndexOf(" - ");
  return cut > 0 && title.length - cut <= 48 ? title.slice(0, cut) : title;
}

function siteSource(url: string | null): GraphSource | null {
  if (!url || !URL.canParse(url)) return null;
  const { hostname, pathname } = new URL(url);
  if (/^(www\.)?google\./.test(hostname) && pathname.startsWith("/maps/search")) return null;
  const cleanHost = hostname.replace(/^www\./, "");
  if (cleanHost.endsWith("instagram.com")) return { label: "Instagram resmi", url };
  if (cleanHost.endsWith("tiktok.com")) return { label: "TikTok resmi", url };
  return { label: "Situs resmi", url };
}

const LODGING = new Set(["hotel", "resort"]);
const NO_RATE_DATA = "Tarif Google Hotels belum ada data";
const dayLabel = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const money = (amount: number, currency: string) => `${currency === "IDR" ? "Rp" : currency} ${amount.toLocaleString("id-ID")}`;

const DISPROVEN_FACILITY = /belerang|sulfur|vulkanik|onsen|40 ?(°|derajat)|(?<![×x] ?)24 jam|belasan hektar|\d+\+? hektar|pasir (pantai )?putih|infinity pool party|tanpa (bebatuan )?karang|bebas karang/i;
const AI_AND_TOOL_LEAK = /\b(gemini\s+[\d.]+(?:\s+flash[- ]lite)?|gemini|flash[- ]lite|flash\s+lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm|crawl4ai|playwright)\b/gi;

function sanitizeVisibleText(raw: string): string {
  return raw
    .replace(/\(\s*(?:crawl|diperiksa)\s+Crawl4AI\s*,?\s*/gi, "(terakhir diperiksa ")
    .replace(/\bdiperiksa\s+Crawl4AI\b/gi, "terakhir diperiksa")
    .replace(/\bcrawl\s+Crawl4AI\b/gi, "terakhir diperiksa")
    .replace(AI_AND_TOOL_LEAK, "")
    .replace(/\bRegistri\s+pesaing\b/g, "Daftar kompetitor")
    .replace(/\bregistri\s+pesaing\b/g, "daftar kompetitor")
    .replace(/\bRegistri\s+pembanding\b/g, "Daftar kompetitor")
    .replace(/\bregistri\s+pembanding\b/g, "daftar kompetitor")
    .replace(/\bRegistri\b/g, "Daftar kompetitor")
    .replace(/\bregistri\b/g, "daftar kompetitor")
    .replace(/\bSitus resmi pesaing\b/g, "Situs resmi kompetitor")
    .replace(/\bPesaing\b/g, "Kompetitor")
    .replace(/\bpesaing\b/g, "kompetitor")
    .replace(/\(\s*,?\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type RatingFields = Pick<CompetitorInput, "rating" | "reviewCount" | "ratingSource" | "ratingSourceUrl" | "mapsUrl" | "parentMapsUrl">;
const ratedOnMaps = (c: RatingFields) => c.rating !== null && /^Google Maps/.test(c.ratingSource ?? "");
const ownListing = (c: RatingFields) => (c.mapsUrl && c.mapsUrl !== c.parentMapsUrl ? c.mapsUrl : null);
function mapsSource(c: RatingFields): GraphSource | null {
  if (ratedOnMaps(c)) return { label: "Google Maps", url: c.ratingSourceUrl ?? ownListing(c) };
  const listing = ownListing(c);
  return listing ? { label: "Google Maps", url: listing } : null;
}
function ratingFact(c: RatingFields): string {
  if (c.rating === null) return "Rating Google belum terbaca";
  const count = c.reviewCount ? ` dari ${c.reviewCount.toLocaleString("id-ID")} ulasan` : "";
  return ratedOnMaps(c)
    ? `Rating Google ${c.rating.toLocaleString("id-ID")}${count}`
    : `Rating ${c.rating.toLocaleString("id-ID")}${count} (sumber: ${sanitizeVisibleText(c.ratingSource ?? "tidak tercatat")})`;
}

/**
 * Masukan dengan urutan baris yang sama di setiap DB. Simpul tema mengambil tiga sumber ulasan pertama, simpul fasilitas
 * delapan fakta pertama, dan urutan simpul (termasuk simpul tarif per penginapan) mengikuti urutan baris, sedangkan baris
 * dari DB datang menurut letak fisiknya (berbeda di Postgres lokal dan Supabase). Kompetitor diurutkan menurut nama,
 * bukan UUID yang berbeda per DB. Promo diurutkan oleh mergePromoCaptures.
 */
function inStableOrder(input: GraphInput): GraphInput {
  const names = new Map(input.competitors.map((c) => [c.id, c.name]));
  // competitorId null = tarif Sanghyang sendiri.
  const nameOf = (competitorId: string | null) => (competitorId === null ? "" : (names.get(competitorId) ?? ""));
  return {
    ...input,
    competitors: [...input.competitors].sort((a, b) => byText(a.name, b.name)),
    rates: [...input.rates].sort(
      (a, b) =>
        byText(nameOf(a.competitorId), nameOf(b.competitorId)) ||
        newestFirst(a.checkIn, b.checkIn) ||
        a.price - b.price ||
        a.guests - b.guests ||
        newestFirst(a.observedAt, b.observedAt) ||
        byText(a.sourceUrl, b.sourceUrl),
    ),
    reviews: [...input.reviews].sort(
      (a, b) =>
        newestFirst(a.reviewDate, b.reviewDate) ||
        newestFirst(a.capturedAt, b.capturedAt) ||
        byText(nameOf(a.competitorId), nameOf(b.competitorId)) ||
        byText(a.source, b.source) ||
        byText(a.sourceUrl, b.sourceUrl) ||
        byText(a.sentiment, b.sentiment) ||
        byText(a.themes.join("|"), b.themes.join("|")),
    ),
    articles: [...input.articles].sort(newestArticleFirst),
    facts:
      input.facts &&
      [...input.facts].sort(
        (a, b) =>
          byText(nameOf(a.competitorId), nameOf(b.competitorId)) ||
          byText(a.section, b.section) ||
          byText(a.key, b.key) ||
          newestFirst(a.observedAt, b.observedAt) ||
          byText(a.sourceUrl, b.sourceUrl) ||
          byText(JSON.stringify(a.value), JSON.stringify(b.value)),
      ),
  };
}

export function assembleGraph(rows: GraphInput): KnowledgeGraph {
  const input = inStableOrder(rows);
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const add = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return node.id;
  };
  const link = (
    source: string,
    target: string,
    label: string,
    meta?: { weight?: number; factors?: GraphLinkFactor[]; modules?: AppModuleKey[] },
  ) => {
    if (!nodes.has(source) || !nodes.has(target)) throw new Error(`Relasi ke simpul yang tidak ada: ${source} -> ${target}`);
    const srcMods = nodes.get(source)?.modules ?? [];
    const tgtMods = nodes.get(target)?.modules ?? [];
    const sharedMods = srcMods.filter((m) => tgtMods.includes(m));
    const derivedModules =
      meta?.modules ??
      (sharedMods.length ? sharedMods : [...new Set([...srcMods, ...tgtMods])].slice(0, 3));
    links.push({
      source,
      target,
      label,
      ...(meta?.weight !== undefined ? { weight: clampScore(meta.weight) } : {}),
      ...(meta?.factors?.length ? { factors: meta.factors } : {}),
      ...(derivedModules.length ? { modules: derivedModules } : {}),
    });
  };
  const structural = (kind: NodeKind, label: string, weight: number, modules: AppModuleKey[]) =>
    add({ id: `${kind}:${slug(label)}`, kind, label, detail: [], sources: [], observedAt: null, outlets: [], weight, modules });
  const platform = (label: string, modules: AppModuleKey[] = ["market-intelligence", "dashboard"]) =>
    structural("sumber", label, 3, modules);
  const area = structural("kawasan", "Kawasan Anyer–Carita", 8, ["dashboard", "market-intelligence"]);

  const ownKeys = new Set(input.ownOutlets.map((o) => o.outletKey));
  const holderByCompetitorId = new Map<string, string>();
  const placeName = new Map<string, string>();
  let ownLodging: string | undefined;
  const tokens: { nodeId: string; words: string[] }[] = [];
  const hasRates = new Set(input.rates.map((r) => r.competitorId));

  const holisticByPair = new Map<string, HolisticScoreInput>();
  for (const hs of input.holisticScores ?? []) {
    holisticByPair.set(`${hs.competitorId}|${hs.outletKey}`, hs);
  }

  // 1. Enam Outlet Sanghyang — terhubung ke seluruh modul aplikasi
  for (const own of input.ownOutlets) {
    const row = input.competitors.find((c) => c.name === own.competitorName);
    const sources = [siteSource(row?.websiteUrl ?? null), row ? mapsSource(row) : null].filter((s): s is GraphSource => s !== null);
    const lodging = LODGING.has(row?.category ?? "");
    const id = add({
      id: `outlet:${own.outletKey}`,
      kind: "outlet",
      label: own.label,
      detail: [row ? ratingFact(row) : "Rating Google belum terbaca", ...(lodging && !hasRates.has(null) ? [NO_RATE_DATA] : [])],
      sources,
      observedAt: row?.observedAt?.toISOString() ?? null,
      outlets: [own.outletKey],
      weight: 10,
      modules: ["operasional", "dashboard", "direksi", "market-intelligence", "galeri-kompetitor", "marketing-sosmed", "omset-strategi"],
      href: `/market-intelligence?outlet=${own.outletKey}`,
    });
    link(id, area, "berada di", { weight: 90, modules: ["dashboard", "market-intelligence", "operasional"] });
    placeName.set(id, own.competitorName);
    if (lodging) ownLodging = id;
    if (row) holderByCompetitorId.set(row.id, id);
    if (row && ratedOnMaps(row)) {
      link(id, platform("Google Maps", ["dashboard", "market-intelligence"]), "rating dibaca dari", {
        weight: 85,
        modules: ["dashboard", "market-intelligence"],
      });
    }
    const phrase = own.outletKey === "resort" ? "sanghyang" : fold(own.label);
    tokens.push({ nodeId: id, words: [phrase] });
  }

  // 2. Tipe Kamar Resmi Sanghyang (terhubung ke /direksi & /market-intelligence)
  if (input.officialRoomTypes?.length && nodes.has("outlet:resort")) {
    for (const rt of input.officialRoomTypes) {
      const rid = add({
        id: `kamar:sanghyang:${slug(rt.name)}`,
        kind: "kamar",
        label: `${rt.name} (Sanghyang)`,
        detail: [
          `Kategori ${rt.category}${rt.bedrooms ? ` · ${rt.bedrooms} kamar tidur` : ""}`,
          `Luas: ${rt.areaLabel}`,
          rt.smartTv !== null ? `Smart TV: ${rt.smartTv ? "Ada" : "TV Biasa"}` : "Smart TV: belum tercatat",
          rt.bathtub !== null ? `Bathtub: ${rt.bathtub ? "Ada" : "Tidak"}` : "Bathtub: belum tercatat",
          ...(rt.weekdayPrice !== null || rt.weekendPrice !== null
            ? [
                `Tarif: ${rt.weekdayPrice !== null ? money(rt.weekdayPrice, "IDR") : "—"} (biasa) / ${rt.weekendPrice !== null ? money(rt.weekendPrice, "IDR") : "—"} (akhir pekan)${rt.otaName ? ` via ${rt.otaName}` : ""}`,
              ]
            : []),
          ...(rt.breakfastLabel ? [`Sarapan: ${rt.breakfastLabel}`] : []),
        ],
        sources: [{ label: rt.sourceLabel || "Situs resmi Sanghyang", url: rt.sourceUrl }],
        observedAt: /^\d{4}-\d{2}-\d{2}/.test(rt.observedAt) ? `${rt.observedAt.slice(0, 10)}T00:00:00.000Z` : input.now.toISOString(),
        outlets: ["resort"],
        weight: 3.8,
        modules: ["direksi", "market-intelligence", "dashboard"],
        href: "/direksi?outlet=resort",
      });
      const completeness =
        (rt.areaLabel && rt.areaLabel !== "Belum ada data" ? 30 : 0) +
        (rt.weekdayPrice !== null || rt.weekendPrice !== null ? 35 : 0) +
        (rt.breakfastLabel ? 20 : 0) +
        (rt.smartTv !== null || rt.bathtub !== null ? 15 : 0);
      link("outlet:resort", rid, "tipe kamar resmi", {
        weight: Math.max(50, completeness),
        factors: [
          { key: "spesifikasi", label: "Kelengkapan spesifikasi kamar", score: Math.max(50, completeness), weight: 1 },
        ],
        modules: ["direksi", "market-intelligence"],
      });
      link(rid, platform("Situs resmi Sanghyang", ["direksi", "market-intelligence"]), "spesifikasi dari", {
        weight: 80,
        modules: ["direksi", "market-intelligence"],
      });
    }
  }

  // 3. Kompetitor dengan bobot relevansi holistik
  for (const c of input.competitors) {
    if (holderByCompetitorId.has(c.id)) continue;
    const role = parseCompsetRole(c.compsetRole);
    const kind: NodeKind | null = c.active
      ? role === "inti"
        ? "pesaing"
        : role === "benchmark"
          ? "acuan"
          : null
      : c.retiredReason
        ? "dikeluarkan"
        : null;
    if (!kind) continue;
    const outlets = c.outlets.filter((k) => ownKeys.has(k));
    if (!outlets.length) continue;
    const tracked = kind !== "dikeluarkan";

    const hasVisual = Boolean((c.placeId && input.visualInsights?.[c.placeId]) || input.visualInsights?.[slug(c.name)]);

    // Skor hanya dari mesin holistik bersama (build.ts); pasangan tanpa skor mesin tampil tanpa skor, bukan skor buatan.
    const outletHolistics = outlets.map((oKey) => {
      const external = holisticByPair.get(`${c.id}|${oKey}`);
      return external
        ? { outletKey: oKey, score: clampScore(external.score) as number | null, factors: external.factors, summary: external.summary }
        : { outletKey: oKey, score: null as number | null, factors: undefined, summary: undefined };
    });
    const bestHolistic = outletHolistics
      .filter((h): h is typeof h & { score: number } => h.score !== null)
      .sort((a, b) => b.score - a.score)[0];
    // Bobot tampilan relasi tanpa skor mesin = ambang peran di mesin yang sama (inti >= 70, acuan >= 55).
    const roleFloor = kind === "pesaing" ? HOLISTIC_SCORE_THRESHOLDS.core : HOLISTIC_SCORE_THRESHOLDS.benchmark;

    const facts = [
      c.category ? `Kategori ${c.category}` : null,
      c.starRating ? `Bintang ${c.starRating}` : null,
      c.roadKm !== null ? `${c.roadKm.toLocaleString("id-ID")} km jarak tempuh dari Sanghyang` : null,
      tracked && bestHolistic ? `Skor relevansi holistik: ${bestHolistic.score}/100` : null,
      tracked && bestHolistic?.summary ? bestHolistic.summary : null,
      tracked || c.rating !== null ? ratingFact(c) : null,
      tracked && c.mapsUrl && !ownListing(c) && !ratedOnMaps(c)
        ? "Belum punya listing Google Maps sendiri; tautan utamanya adalah listing hotel induk"
        : null,
      tracked && LODGING.has(c.category ?? "") && !hasRates.has(c.id) ? NO_RATE_DATA : null,
      kind === "dikeluarkan" ? `Dikeluarkan: ${c.retiredReason}` : null,
    ].filter((f): f is string => f !== null);

    const sources = [siteSource(c.websiteUrl), mapsSource(c)].filter((s): s is GraphSource => s !== null);
    const compModules: AppModuleKey[] = tracked
      ? ["market-intelligence", "dashboard", ...(LODGING.has(c.category ?? "") ? (["direksi"] as AppModuleKey[]) : []), ...(hasVisual ? (["galeri-kompetitor"] as AppModuleKey[]) : [])]
      : ["market-intelligence"];
    const nodeWeight =
      kind === "pesaing"
        ? Number((3.5 + ((bestHolistic?.score ?? roleFloor) / 100) * 4.5).toFixed(2))
        : kind === "acuan"
          ? 3.8
          : 2.2;

    const id = add({
      id: `tempat:${c.id}`,
      kind,
      label: c.name,
      detail: facts,
      sources: sources.length ? sources : [{ label: "Daftar kompetitor (keputusan pemilik)", url: null }],
      observedAt: c.observedAt?.toISOString() ?? null,
      outlets,
      weight: nodeWeight,
      modules: compModules,
      href: `/market-intelligence?outlet=${outlets[0]}`,
      holisticScore: tracked ? (bestHolistic?.score ?? null) : null,
      holisticFactors: tracked ? bestHolistic?.factors : undefined,
    });

    for (const oh of outletHolistics) {
      const relLabel =
        kind === "pesaing"
          ? "kompetitor inti"
          : kind === "acuan"
            ? "kompetitor acuan"
            : "dikeluarkan dari daftar kompetitor";
      link(`outlet:${oh.outletKey}`, id, relLabel, {
        weight: tracked ? oh.score ?? roleFloor : 15,
        ...(oh.factors ? { factors: oh.factors } : {}),
        modules: compModules,
      });
    }
    if (tracked) {
      holderByCompetitorId.set(c.id, id);
      placeName.set(id, c.name);
      if (ratedOnMaps(c)) {
        link(id, platform("Google Maps", ["dashboard", "market-intelligence"]), "rating dibaca dari", {
          weight: 75,
          modules: ["dashboard", "market-intelligence"],
        });
      }
      const words = fold(c.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !GENERIC_WORDS.has(w));
      if (LODGING.has(c.category ?? "")) tokens.push({ nodeId: id, words });
    }
  }

  // Outlet di dalam hotel kompetitor terhubung ke hotel induknya
  for (const c of input.competitors) {
    const venue = `tempat:${c.id}`;
    const parent = c.parentId ? `tempat:${c.parentId}` : null;
    if (parent && nodes.has(venue) && nodes.has(parent)) {
      link(venue, parent, "berada di dalam", { weight: 88, modules: ["market-intelligence", "galeri-kompetitor"] });
    }
  }

  // 4. Tarif Google Hotels + Status Sarapan (terhubung ke /direksi Evaluasi Harga)
  const breakfastByHotelId = new Map<string, BreakfastRateSummaryInput[]>();
  for (const b of input.breakfastRates ?? []) {
    breakfastByHotelId.set(b.hotelId, [...(breakfastByHotelId.get(b.hotelId) ?? []), b]);
  }
  const placeIdByHolder = new Map<string, string>();
  if (ownLodging) placeIdByHolder.set(ownLodging, "sanghyang");
  for (const c of input.competitors) {
    const h = holderByCompetitorId.get(c.id);
    if (h && c.placeId) placeIdByHolder.set(h, c.placeId);
  }

  const ratesByHolder = new Map<string, RateInput[]>();
  for (const r of input.rates) {
    const holder = r.competitorId === null ? ownLodging : holderByCompetitorId.get(r.competitorId);
    if (holder) ratesByHolder.set(holder, [...(ratesByHolder.get(holder) ?? []), r]);
  }
  for (const [holder, rates] of ratesByHolder) {
    const sorted = [...rates].sort((a, b) => (a.checkIn?.getTime() ?? 0) - (b.checkIn?.getTime() ?? 0) || a.price - b.price);
    const day = (r: RateInput) => (r.checkIn ? dayLabel(r.checkIn) : null);
    const sources = new Map(sorted.map((r) => [`${day(r)}|${r.sourceUrl}`, { label: day(r) ? `Google Hotels, check-in ${day(r)}` : "Google Hotels", url: r.sourceUrl }]));
    const pid = placeIdByHolder.get(holder);
    const bfRows = pid ? (breakfastByHotelId.get(pid) ?? []) : [];
    const bfLines = bfRows.map((b) => {
      const stayText = b.stay === "weekend" ? "Akhir pekan" : "Hari biasa";
      const withText = b.withBreakfast !== null ? `dengan sarapan ${money(b.withBreakfast, "IDR")}` : null;
      const withoutText = b.withoutBreakfast !== null ? `tanpa sarapan ${money(b.withoutBreakfast, "IDR")}` : null;
      return `Status sarapan (${stayText}): ${[withText, withoutText].filter(Boolean).join(" · ")}`;
    });

    const id = add({
      id: `statistik:tarif:${holder}`,
      kind: "statistik",
      label: `Tarif OTA & Sarapan ${placeName.get(holder) ?? nodes.get(holder)?.label}`,
      detail: [
        ...new Set(
          sorted.map(
            (r) =>
              `${day(r) ? `Check-in ${day(r)}` : "Tanggal check-in tidak tercatat"}: ${money(r.price, r.currency)} per malam, ${r.guests} tamu`,
          ),
        ),
        ...bfLines,
      ],
      sources: [...sources.values()],
      observedAt: new Date(Math.max(...sorted.map((r) => r.observedAt.getTime()))).toISOString(),
      outlets: nodes.get(holder)?.outlets ?? [],
      weight: 3.5,
      modules: ["direksi", "market-intelligence", "dashboard"],
      href: "/direksi?outlet=resort",
    });
    const rateWeight = clampScore(55 + Math.min(30, sorted.length * 2.5) + (bfLines.length > 0 ? 15 : 0));
    link(holder, id, "tarif kamar", {
      weight: rateWeight,
      factors: [
        { key: "cakupan_malam", label: "Cakupan malam jendela 14 hari", score: clampScore(Math.min(100, sorted.length * 8)), weight: 0.7 },
        { key: "sarapan", label: "Ketersediaan data sarapan", score: bfLines.length > 0 ? 100 : 35, weight: 0.3 },
      ],
      modules: ["direksi", "market-intelligence", "dashboard"],
    });
    link(id, platform("Google Hotels", ["direksi", "market-intelligence"]), "dibaca dari", {
      weight: 80,
      modules: ["direksi", "market-intelligence"],
    });
  }

  // 5. Promo vs Event terpisah (<= 90 hari, bebas noise)
  for (const p of mergePromoCaptures(input.promos)) {
    const holder = holderByCompetitorId.get(p.competitorId);
    if (!holder) continue;
    const own = holder.startsWith("outlet:");
    const fromTeam = own && p.source === OWN_TEAM_SOURCE;
    if (!p.sourceUrl && !fromTeam) continue;
    if (own && (p.status === "expired" || (p.endsAt && p.endsAt < input.now))) continue;
    const viaInstagram = /instagram/i.test(p.source);
    const viaTikTok = /tiktok/i.test(p.source);
    const sourceLabel = fromTeam
      ? OWN_TEAM_SOURCE
      : viaInstagram
        ? "Postingan Instagram"
        : viaTikTok
          ? "Postingan TikTok"
          : own
            ? "Halaman penawaran situs resmi Sanghyang"
            : "Halaman promo situs resmi";
    const isEvent = p.kind === "event";
    const ageDays = Math.max(0, Math.round((input.now.getTime() - p.capturedAt.getTime()) / 86_400_000));
    const recencyScore = clampScore(100 - ageDays * 0.9);
    const commercialScore = p.discount ? 92 : p.price ? 84 : isEvent ? 76 : 65;
    const promoWeight = clampScore(recencyScore * 0.55 + commercialScore * 0.45);
    const promoModules: AppModuleKey[] = ["market-intelligence", "omset-strategi", ...(viaInstagram || viaTikTok ? (["marketing-sosmed"] as AppModuleKey[]) : [])];
    const holderOutlets = nodes.get(holder)?.outlets ?? [];

    const id = add({
      id: `promo:${p.id}`,
      kind: own ? (isEvent ? "event-sanghyang" : "promo-sanghyang") : isEvent ? "event" : "promo",
      label: p.title.length > 90 ? `${p.title.slice(0, 89)}…` : p.title,
      detail: [
        `Jenis: ${isEvent ? "Event & Kegiatan" : "Promo Penawaran"}`,
        `Kategori ${p.category}`,
        ...(isEvent ? [`Tanggal acara ${promoDayLabel(p.startsAt, p.endsAt)}`] : []),
        ...(p.discount ? [`Diskon ${p.discount.toLocaleString("id-ID")}%`] : []),
        ...(p.details ?? []).slice(0, 6),
      ],
      sources: [{ label: sourceLabel, url: p.sourceUrl }],
      observedAt: p.capturedAt.toISOString(),
      outlets: holderOutlets,
      weight: isEvent ? 2.4 : 2.6,
      modules: promoModules,
      href: holderOutlets[0] ? `/marketing?bagian=strategy&outlet=${holderOutlets[0]}` : "/marketing?bagian=strategy",
    });
    link(holder, id, own ? (isEvent ? "menggelar" : "menawarkan") : isEvent ? "menggelar event" : "menjalankan promo", {
      weight: promoWeight,
      factors: [
        { key: "kebaruan", label: "Kebaruan (<= 90 hari)", score: recencyScore, weight: 0.55 },
        { key: "nilai_tawaran", label: "Kejelasan penawaran/acara", score: commercialScore, weight: 0.45 },
      ],
      modules: promoModules,
    });
    link(
      id,
      platform(
        fromTeam
          ? OWN_TEAM_SOURCE
          : viaInstagram
            ? "Instagram"
            : viaTikTok
              ? "TikTok"
              : own
                ? "Situs resmi Sanghyang"
                : "Situs resmi kompetitor",
        promoModules,
      ),
      fromTeam ? "dilaporkan oleh" : "dibaca dari",
      { weight: 70, modules: promoModules },
    );
  }

  // 6. Ulasan tamu & tema sentimen (Google Maps, OTA, Media Sosial)
  interface ThemeStat {
    total: number;
    positive: number;
    negative: number;
    sources: GraphSource[];
    observedAt: Date;
    holders: Map<string, { n: number; pos: number; neg: number }>;
  }
  const themeStats = new Map<string, ThemeStat>();
  for (const r of input.reviews) {
    const holder = holderByCompetitorId.get(r.competitorId);
    if (!holder) continue;
    for (const theme of visibleThemes(r.themes).filter((t) => !ownKeys.has(t))) {
      const t: ThemeStat = themeStats.get(theme) ?? { total: 0, positive: 0, negative: 0, sources: [], observedAt: r.capturedAt, holders: new Map() };
      const h = t.holders.get(holder) ?? { n: 0, pos: 0, neg: 0 };
      h.n++;
      t.total++;
      if (r.sentiment === "positive") {
        h.pos++;
        t.positive++;
      } else if (r.sentiment === "negative") {
        h.neg++;
        t.negative++;
      }
      if (t.sources.length < 3 && !t.sources.some((s) => s.url === r.sourceUrl)) {
        t.sources.push({ label: `Ulasan ${r.source}`, url: r.sourceUrl });
      }
      if (r.capturedAt > t.observedAt) t.observedAt = r.capturedAt;
      t.holders.set(holder, h);
      themeStats.set(theme, t);
    }
  }
  for (const [theme, t] of themeStats) {
    const outlets = [...new Set([...t.holders.keys()].flatMap((h) => nodes.get(h)?.outlets ?? []))];
    const id = add({
      id: `tema:${slug(theme)}`,
      kind: "tema",
      label: theme,
      detail: [`${t.total} ulasan tersimpan menyebut tema ini (${t.positive} positif, ${t.negative} negatif)`],
      sources: t.sources,
      observedAt: t.observedAt.toISOString(),
      outlets,
      weight: 2 + Math.log2(1 + t.total),
      modules: ["market-intelligence", "dashboard"],
      href: outlets[0] ? `/market-intelligence?outlet=${outlets[0]}` : "/dashboard",
    });
    for (const [holder, h] of t.holders) {
      const volScore = clampScore(Math.min(100, Math.log2(1 + h.n) * 28));
      const negRatio = h.n > 0 ? clampScore((h.neg / h.n) * 100) : 0;
      const edgeWeight = clampScore(volScore * 0.65 + negRatio * 0.35);
      link(holder, id, `${h.n} ulasan, ${h.neg} negatif`, {
        weight: edgeWeight,
        factors: [
          { key: "volume", label: "Frekuensi penyebutan", score: volScore, weight: 0.65 },
          { key: "urgensi_negatif", label: "Proporsi keluhan", score: negRatio, weight: 0.35 },
        ],
        modules: ["market-intelligence", "dashboard"],
      });
    }
  }

  // 7. Sinyal Berita Kawasan (/dashboard & /market-intelligence)
  for (const a of input.articles) {
    if (!a.url) continue;
    const title = fold(a.title);
    const matched = tokens.filter((t) => t.words.some((w) => containsWord(title, w))).map((t) => t.nodeId);
    const outlets = [...new Set(matched.flatMap((m) => nodes.get(m)?.outlets ?? []))];
    const id = add({
      id: `berita:${a.id}`,
      kind: "berita",
      label: withoutPublisher(a.title),
      detail: [a.publishedAt ? `Terbit ${a.publishedAt.toISOString().slice(0, 10)}` : "Tanggal terbit tidak tercantum"],
      sources: [{ label: a.publisher, url: a.url }],
      observedAt: a.publishedAt?.toISOString() ?? null,
      outlets,
      weight: matched.length ? 2.2 : 1.6,
      modules: ["dashboard", "market-intelligence"],
      href: "/dashboard",
    });
    if (matched.length) {
      for (const m of matched) {
        link(id, m, "menyebut", { weight: 78, modules: ["dashboard", "market-intelligence"] });
      }
    } else {
      link(id, area, "tentang kawasan", { weight: 52, modules: ["dashboard", "market-intelligence"] });
    }
    link(id, platform("Google News", ["dashboard", "market-intelligence"]), "ditemukan lewat", {
      weight: 60,
      modules: ["dashboard", "market-intelligence"],
    });
  }

  // 8. Statistik Makro Pasar (BPS TPK + Market Cap)
  if (input.tpk) {
    const tpk = add({
      id: "statistik:tpk",
      kind: "statistik",
      label: `TPK hotel bintang Banten ${input.tpk.percent.toLocaleString("id-ID")}% (${monthLabel(input.tpk.period)})`,
      detail: [input.tpk.sourceTitle],
      sources: [{ label: "Rilis BPS Banten", url: input.tpk.sourceUrl }],
      observedAt: `${input.tpk.period}-01T00:00:00.000Z`,
      outlets: ["resort"],
      weight: 6,
      modules: ["dashboard", "direksi", "market-intelligence"],
      href: "/direksi?outlet=resort",
    });
    link(tpk, platform("BPS", ["dashboard", "direksi"]), "dirilis oleh", { weight: 95, modules: ["dashboard", "direksi"] });
    const ms = input.marketSize;
    if (ms.marketCapMonthly !== null) {
      const cap = add({
        id: "statistik:market-cap",
        kind: "statistik",
        label: `Market Cap kamar resort ${juta(ms.marketCapMonthly)}/bln`,
        detail: [`Kamar × ${ms.daysPerMonth} hari × TPK × tarif OTA terbobot, perkiraan kasar`, `Tarif Google Travel terakhir diperiksa ${input.ratesCapturedAt}`],
        sources: [
          { label: "Rilis BPS Banten", url: input.tpk.sourceUrl },
          { label: `Tarif OTA Google Travel (${input.ratesCapturedAt})`, url: null },
        ],
        observedAt: input.now.toISOString(),
        outlets: ["resort"],
        weight: 7,
        modules: ["dashboard", "direksi", "market-intelligence"],
        href: "/direksi?outlet=resort",
      });
      link(tpk, cap, "dipakai menghitung", { weight: 90, modules: ["dashboard", "direksi"] });
      link(cap, platform("Google Travel", ["direksi", "market-intelligence"]), "tarif dibaca dari", {
        weight: 85,
        modules: ["direksi", "market-intelligence"],
      });
      const share = ms.sanghyang.actual?.share ?? ms.sanghyang.estimatedShare;
      if (nodes.has("outlet:resort")) {
        link(cap, "outlet:resort", share === null ? "pangsa belum ada data" : `pangsa ${share.toLocaleString("id-ID")}%`, {
          weight: 88,
          modules: ["dashboard", "direksi"],
        });
      }
      for (const row of ms.rows) {
        if (row.role === "sanghyang" || row.estimatedMonthlyRevenue === null) continue;
        const holder = input.competitors.find((c) => c.placeId === row.hotelId && c.active);
        const holderId = holder ? holderByCompetitorId.get(holder.id) : undefined;
        if (holderId) {
          link(
            cap,
            holderId,
            `${juta(row.estimatedMonthlyRevenue)}/bln${row.share === null ? ", acuan" : `, pangsa ${row.share.toLocaleString("id-ID")}%`}`,
            { weight: row.share !== null ? clampScore(40 + row.share * 2) : 45, modules: ["direksi", "market-intelligence"] },
          );
        }
      }
    }
  }

  // 9. Strategi, Evaluasi Harga Direksi, Target Bulanan, Potret & Sinyal Operasional VHP
  if (input.roomCorridors?.length && nodes.has("outlet:resort")) {
    const corridorDetails = input.roomCorridors.map((c) => {
      const wd = c.weekdayFloor !== null ? `Lantai P25 hari biasa ${money(c.weekdayFloor, "IDR")} (median ${c.weekdayMedian ? money(c.weekdayMedian, "IDR") : "—"})` : "Koridor hari biasa belum cukup sampel";
      const we = c.weekendFloor !== null ? `akhir pekan ${money(c.weekendFloor, "IDR")}` : "";
      return `${c.room}: ${wd}${we ? `, ${we}` : ""}`;
    });
    const bfCount = (input.breakfastRates ?? []).length;
    if (input.executiveBreakfastNote) {
      corridorDetails.push(input.executiveBreakfastNote.slice(0, 220));
    } else if (bfCount > 0) {
      corridorDetails.push(`${bfCount} pasangan tarif dengan vs tanpa sarapan terpantau untuk evaluasi setara direksi`);
    }
    const sid = add({
      id: "strategi:direksi:resort",
      kind: "strategi",
      label: "Evaluasi Harga Kamar & Sarapan (Direksi)",
      detail: corridorDetails.slice(0, 6),
      sources: [{ label: `Evaluasi Tarif OTA (${input.ratesCapturedAt})`, url: null }],
      observedAt: input.now.toISOString(),
      outlets: ["resort"],
      weight: 5.5,
      modules: ["direksi", "dashboard", "omset-strategi", "operasional"],
      href: "/direksi?outlet=resort",
    });
    link("outlet:resort", sid, "evaluasi koridor harga", {
      weight: 92,
      factors: [
        { key: "koridor_p25", label: "Kepatuhan lantai harga P25", score: 95, weight: 0.6 },
        { key: "paritas_sarapan", label: "Kesetaraan status sarapan", score: bfCount > 0 ? 90 : 50, weight: 0.4 },
      ],
      modules: ["direksi", "dashboard", "operasional"],
    });
    if (nodes.has("statistik:tarif:outlet:resort")) {
      link("statistik:tarif:outlet:resort", sid, "dasar evaluasi direksi", {
        weight: 88,
        modules: ["direksi"],
      });
    }
  }

  for (const g of input.goals ?? []) {
    const outletId = `outlet:${g.outletKey}`;
    if (!nodes.has(outletId)) continue;
    const details = [
      `Bulan ${monthLabel(g.month.slice(0, 7))} (diisi ${g.filledBy})`,
      ...(g.targetRevenueGrowthPct !== null ? [`Target pertumbuhan omset: ${g.targetRevenueGrowthPct > 0 ? "+" : ""}${g.targetRevenueGrowthPct}%`] : []),
      ...(g.targetRating !== null ? [`Target rating Google: ${g.targetRating}`] : []),
      ...(g.strategy ? [`Strategi: ${g.strategy.slice(0, 140)}`] : []),
      ...(g.decisions ? [`Keputusan: ${g.decisions.slice(0, 140)}`] : []),
    ];
    const gid = add({
      id: `strategi:target:${g.outletKey}`,
      kind: "strategi",
      label: `Target & Strategi ${nodes.get(outletId)?.label} (${monthLabel(g.month.slice(0, 7))})`,
      detail: details,
      sources: [{ label: `Target tim pemasaran (${g.filledBy})`, url: null }],
      observedAt: g.updatedAt.toISOString(),
      outlets: [g.outletKey],
      weight: 4.5,
      modules: ["omset-strategi", "dashboard"],
      href: "/pengaturan",
    });
    link(outletId, gid, "target & strategi bulanan", { weight: 86, modules: ["omset-strategi", "dashboard"] });
  }

  for (const snap of input.monthlySnapshots ?? []) {
    const outletId = `outlet:${snap.outletKey}`;
    if (!nodes.has(outletId)) continue;
    const sid = add({
      id: `strategi:snapshot:${snap.outletKey}`,
      kind: "strategi",
      label: `Potret Bulanan ${nodes.get(outletId)?.label} (${monthLabel(snap.month.slice(0, 7))})`,
      detail: [
        snap.googleRating !== null ? `Rating Google saat dipotret: ${snap.googleRating.toLocaleString("id-ID")}` : "Rating Google belum tercatat",
        ...(snap.pricePositioningIndex !== null ? [`Indeks posisi harga: ${snap.pricePositioningIndex.toLocaleString("id-ID")}`] : []),
        `${snap.reviewsRecorded} ulasan tercatat`,
      ],
      sources: [{ label: "Potret bulanan otomatis", url: null }],
      observedAt: snap.capturedAt.toISOString(),
      outlets: [snap.outletKey],
      weight: 3.5,
      modules: ["dashboard", "omset-strategi"],
      href: `/dashboard?outlet=${snap.outletKey}`,
    });
    link(outletId, sid, "potret performa bulanan", { weight: 76, modules: ["dashboard", "omset-strategi"] });
  }

  // 9b. Sinyal Operasional Internal VHP (5 keluarga simpul terabstraksi, 0 nominal rupiah)
  if (input.internalSignals) {
    const fmtPct = (v: number) => `${v.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
    const statusText = (s: "tercapai" | "on_track" | "tertinggal") =>
      s === "tercapai" ? "Tercapai" : s === "on_track" ? "Sesuai laju" : "Perlu percepatan";
    const vhpPlatform = platform("Operasional VHP", ["operasional", "omset-strategi", "dashboard"]);

    for (const own of input.ownOutlets) {
      const key = own.outletKey as OutletKey;
      const outletId = `outlet:${key}`;
      if (!nodes.has(outletId)) continue;
      const sig = input.internalSignals[key];
      if (!sig) continue;

      // (1) operasional:kinerja:${key}
      if (sig.performance) {
        const perf = sig.performance;
        const details: string[] = [
          `Data VHP terabstraksi s.d. ${perf.dataThrough} (tanpa nominal rupiah)`,
        ];
        if (perf.targetAchievementPct !== null) {
          const scopeLabel = perf.targetScope === "gabungan_dbar_dbc" ? "target gabungan d'Bar & DBC" : "target bulanan";
          const sourceNote = perf.targetSource === "db" ? "target Pengaturan" : "target bawaan standar";
          details.push(
            `Capaian ${scopeLabel}: ${fmtPct(perf.targetAchievementPct)}${perf.status ? ` (${statusText(perf.status)})` : ""} · ${sourceNote}`,
          );
        }
        if (perf.momGrowthPct !== null) {
          details.push(
            `Pertumbuhan MoM (tanggal setara): ${perf.momGrowthPct >= 0 ? "+" : ""}${fmtPct(perf.momGrowthPct)}`,
          );
        }
        if (perf.contributionSharePct !== null) {
          details.push(`Kontribusi ke total 6 outlet: ${fmtPct(perf.contributionSharePct)}`);
        }
        if (perf.dbarPartSharePct != null) {
          const partName = key === "dragon-beach-club" ? "DBC" : "d'Bar & Karaoke";
          details.push(`Porsi ${partName} pada gabungan d'Bar & DBC: ${fmtPct(perf.dbarPartSharePct)}`);
        }
        if (perf.dbarDiscountPct != null) {
          details.push(`Porsi diskon gabungan d'Bar & DBC: ${fmtPct(perf.dbarDiscountPct)}`);
        }
        if (perf.openDays != null) {
          details.push(`Hari beroperasi tercatat: ${perf.openDays} hari`);
        }

        const targetDeviation = perf.targetAchievementPct !== null ? Math.abs(100 - Math.min(130, perf.targetAchievementPct)) : 30;
        const momMagnitude = perf.momGrowthPct !== null ? Math.min(50, Math.abs(perf.momGrowthPct)) : 15;
        const perfEdgeWeight = clampScore(55 + targetDeviation * 0.45 + momMagnitude * 0.4);
        const perfNodeWeight = Number((3.6 + (perfEdgeWeight / 100) * 3.2).toFixed(2));
        const kid = add({
          id: `operasional:kinerja:${key}`,
          kind: "operasional",
          label: `Kinerja VHP ${own.label} (${monthLabel(perf.month)})`,
          detail: details,
          sources: [{ label: `Data operasional VHP s.d. ${perf.dataThrough}`, url: null }],
          observedAt: `${perf.dataThrough}T00:00:00.000Z`,
          outlets: [key],
          weight: perfNodeWeight,
          modules: ["operasional", "omset-strategi", "dashboard"],
          href: perf.targetAchievementPct !== null ? "/pengaturan" : "/",
        });
        link(outletId, kid, "kinerja operasional VHP", {
          weight: perfEdgeWeight,
          factors: [
            { key: "deviasi_target", label: "Jarak terhadap target bulanan", score: clampScore(50 + targetDeviation), weight: 0.6 },
            { key: "momentum_mom", label: "Dinamika pertumbuhan MoM", score: clampScore(50 + momMagnitude), weight: 0.4 },
          ],
          modules: ["operasional", "omset-strategi", "dashboard"],
        });
        link(kid, vhpPlatform, "diolah dari", { weight: 88, modules: ["operasional", "omset-strategi"] });
      }

      // (2) operasional:okupansi:resort
      const resortOccPct = key === "resort" ? sig.resortStay?.occPct : null;
      if (key === "resort" && sig.resortStay && resortOccPct !== null && resortOccPct !== undefined) {
        const stay = sig.resortStay;
        const details: string[] = [
          `Okupansi (OCC): ${fmtPct(resortOccPct)} (${stay.nightsObserved} malam terdata)`,
        ];
        if (stay.prevOccPct !== null && stay.occDeltaPts !== null) {
          details.push(
            `Perubahan OCC MoM: ${stay.occDeltaPts >= 0 ? "+" : ""}${stay.occDeltaPts.toLocaleString("id-ID")} poin (sebelumnya ${fmtPct(stay.prevOccPct)})`,
          );
        }
        if (stay.tpkGapPts !== null) {
          details.push(
            `Selisih OCC vs TPK BPS Banten: ${stay.tpkGapPts >= 0 ? "+" : ""}${stay.tpkGapPts.toLocaleString("id-ID")} poin`,
          );
        }
        details.push(
          `Komposisi segmen: OTA ${fmtPct(stay.segmentMixPct.ota)}, Walk-In ${fmtPct(stay.segmentMixPct.walkIn)}, FIT ${fmtPct(stay.segmentMixPct.fit)}, Korporat ${fmtPct(stay.segmentMixPct.corp)}`,
        );
        if (stay.directVsOtaRatio !== null) {
          details.push(`Rasio tamu langsung (FIT + Walk-In) dibanding OTA: ${stay.directVsOtaRatio.toLocaleString("id-ID")}x`);
        }
        if (stay.roomTypesByShare.length > 0) {
          const topRm = stay.roomTypesByShare[0];
          const lowRm = stay.roomTypesByShare[stay.roomTypesByShare.length - 1];
          details.push(
            `Tipe kamar terpadat: ${topRm.name} (${fmtPct(topRm.nightsSharePct)} malam kamar); terendah: ${lowRm.name} (${fmtPct(lowRm.nightsSharePct)})`,
          );
        }

        const tpkGapAbs = stay.tpkGapPts !== null ? Math.min(40, Math.abs(stay.tpkGapPts)) : 15;
        const otaWeight = Math.min(100, stay.segmentMixPct.ota);
        const occEdgeWeight = clampScore(60 + tpkGapAbs * 0.7 + otaWeight * 0.2);
        const oid = add({
          id: "operasional:okupansi:resort",
          kind: "operasional",
          label: `Okupansi & Segmen Kamar (${fmtPct(resortOccPct)})`,
          detail: details,
          sources: [{ label: `F/O Journal VHP s.d. ${sig.dataThrough ?? input.now.toISOString().slice(0, 10)}`, url: null }],
          observedAt: sig.dataThrough ? `${sig.dataThrough}T00:00:00.000Z` : input.now.toISOString(),
          outlets: ["resort"],
          weight: Number((4.2 + (occEdgeWeight / 100) * 3).toFixed(2)),
          modules: ["operasional", "direksi", "omset-strategi", "dashboard"],
          href: "/",
        });
        link("outlet:resort", oid, "okupansi & segmen kamar", {
          weight: occEdgeWeight,
          factors: [
            { key: "selisih_tpk", label: "Selisih OCC vs TPK BPS", score: clampScore(50 + tpkGapAbs), weight: 0.55 },
            { key: "ketergantungan_ota", label: "Porsi segmen OTA", score: clampScore(otaWeight), weight: 0.45 },
          ],
          modules: ["operasional", "direksi", "omset-strategi"],
        });
        if (nodes.has("statistik:tpk")) {
          link(oid, "statistik:tpk", "dibandingkan dengan TPK BPS", {
            weight: 85,
            modules: ["operasional", "direksi", "dashboard"],
          });
        }
        link(oid, vhpPlatform, "diolah dari", { weight: 88, modules: ["operasional", "direksi"] });
      }

      // (3) operasional:menu:${key}
      if (sig.menuHealth && (sig.menuHealth.topMenus.length > 0 || sig.menuHealth.slowMenuCount > 0 || sig.menuHealth.deadMenuCount > 0)) {
        const mh = sig.menuHealth;
        const details: string[] = [`Data kasir POS VHP s.d. ${mh.lastDataDay}`];
        if (mh.topMenus.length > 0) {
          details.push(
            `Menu terlaris: ${mh.topMenus
              .slice(0, 3)
              .map((m) => `${m.description} (${fmtPct(m.salesSharePct)}, ${m.qty} porsi)`)
              .join("; ")}`,
          );
        }
        details.push(`Menu lambat (90 hari): ${mh.slowMenuCount} item · Menu mati (0 porsi 90 hari): ${mh.deadMenuCount} item`);
        if (mh.slowestSamples.length > 0) {
          details.push(
            `Contoh menu lambat: ${mh.slowestSamples
              .slice(0, 3)
              .map((m) => `${m.description} (${m.windowQty} porsi)`)
              .join(", ")}`,
          );
        }
        const issueScore = clampScore(45 + Math.min(55, mh.slowMenuCount * 1.5 + mh.deadMenuCount * 2));
        const mid = add({
          id: `operasional:menu:${key}`,
          kind: "operasional",
          label: `Kesehatan Menu ${own.label} (${mh.slowMenuCount} lambat, ${mh.deadMenuCount} mati)`,
          detail: details,
          sources: [{ label: `Kasir POS VHP s.d. ${mh.lastDataDay}`, url: null }],
          observedAt: `${mh.lastDataDay}T00:00:00.000Z`,
          outlets: [key],
          weight: Number((3.4 + (issueScore / 100) * 2.8).toFixed(2)),
          modules: ["operasional", "direksi", "omset-strategi"],
          href: "/",
        });
        link(outletId, mid, "kesehatan menu kasir VHP", {
          weight: issueScore,
          factors: [
            { key: "menu_lambat_mati", label: "Beban menu lambat & mati 90 hari", score: issueScore, weight: 1 },
          ],
          modules: ["operasional", "direksi", "omset-strategi"],
        });
        link(mid, vhpPlatform, "diolah dari", { weight: 82, modules: ["operasional"] });
      }

      // (4) operasional:audit-promo:${key} (hanya bila ada event teraudit > 0)
      if (sig.promoAudit && sig.promoAudit.totalAudited > 0) {
        const pa = sig.promoAudit;
        const details: string[] = [
          `${pa.totalAudited} promo diaudit terhadap kasir VHP (7 hari sebelum vs sesudah)`,
          `Hasil: ${pa.naikCount} NAIK · ${pa.naikTipisCount} NAIK_TIPIS · ${pa.tidakNaikCount} TIDAK_NAIK`,
        ];
        if (pa.topLifts.length > 0) {
          details.push(
            `Promo naik tertinggi: ${pa.topLifts
              .slice(0, 2)
              .map((p) => `${p.keyword}${p.qtyPct !== null ? ` (+${p.qtyPct}%)` : ""}`)
              .join(", ")}`,
          );
        }
        if (pa.noLiftSamples.length > 0) {
          details.push(`Promo tidak naik: ${pa.noLiftSamples.slice(0, 2).map((p) => p.keyword).join(", ")}`);
        }
        const effectiveRate = pa.naikCount + pa.tidakNaikCount > 0 ? (pa.naikCount / (pa.naikCount + pa.tidakNaikCount)) * 100 : 50;
        const paWeight = clampScore(55 + Math.min(40, pa.totalAudited * 5) + (100 - effectiveRate) * 0.15);
        const paid = add({
          id: `operasional:audit-promo:${key}`,
          kind: "operasional",
          label: `Audit Promo ${own.label} (${pa.naikCount} NAIK · ${pa.tidakNaikCount} TIDAK_NAIK)`,
          detail: details,
          sources: [{ label: "Audit Promo kasir VHP", url: null }],
          observedAt: sig.dataThrough ? `${sig.dataThrough}T00:00:00.000Z` : input.now.toISOString(),
          outlets: [key],
          weight: 3.6,
          modules: ["operasional", "marketing-sosmed", "omset-strategi"],
          href: `/marketing?bagian=strategy&outlet=${key}`,
        });
        link(outletId, paid, "audit efektivitas promo", {
          weight: paWeight,
          factors: [
            { key: "rasio_naik", label: "Rasio promo NAIK vs TIDAK_NAIK", score: clampScore(effectiveRate), weight: 1 },
          ],
          modules: ["operasional", "marketing-sosmed", "omset-strategi"],
        });
        link(paid, vhpPlatform, "diolah dari", { weight: 80, modules: ["operasional", "marketing-sosmed"] });
      }

      // (5) operasional:akuisisi:resort (hanya bila data WA closing/kampanye tersedia)
      if (key === "resort" && sig.acquisition && (sig.acquisition.waClosingCount > 0 || sig.acquisition.waClosingRatePct !== null || sig.acquisition.campaignVerdicts.length > 0)) {
        const acq = sig.acquisition;
        const details: string[] = [
          `WA closing tercatat: ${acq.waClosingCount} reservasi${acq.waClosingRatePct !== null ? ` (closing rate ${fmtPct(acq.waClosingRatePct)})` : ""}`,
        ];
        if (acq.periodRange) {
          details.push(`Periode pencatatan WA: ${acq.periodRange.from} s.d. ${acq.periodRange.to}`);
        }
        const aid = add({
          id: "operasional:akuisisi:resort",
          kind: "operasional",
          label: `Akuisisi & Closing WA Resort${acq.waClosingRatePct !== null ? ` (${fmtPct(acq.waClosingRatePct)})` : ""}`,
          detail: details,
          sources: [{ label: "Catatan closing WhatsApp CS", url: null }],
          observedAt: acq.periodRange ? `${acq.periodRange.to}T00:00:00.000Z` : input.now.toISOString(),
          outlets: ["resort"],
          weight: 3.4,
          modules: ["operasional", "marketing-sosmed", "omset-strategi"],
          href: "/marketing",
        });
        link("outlet:resort", aid, "akuisisi & closing reservasi", {
          weight: clampScore(60 + (acq.waClosingRatePct ?? 20) * 0.4),
          modules: ["operasional", "marketing-sosmed", "omset-strategi"],
        });
        link(aid, vhpPlatform, "dicatat bersama", { weight: 76, modules: ["operasional", "marketing-sosmed"] });
      }
    }
  }

  // 10. Simpul Fasilitas & Kamar
  if (input.facts?.length) {
    const factsByComp = new Map<string, FactInput[]>();
    for (const f of input.facts) {
      factsByComp.set(f.competitorId, [...(factsByComp.get(f.competitorId) ?? []), f]);
    }
    for (const [compId, compFacts] of factsByComp) {
      const holder = holderByCompetitorId.get(compId);
      if (!holder || !nodes.has(holder)) continue;
      const validFacts = compFacts.filter((f) => f.sourceUrl && URL.canParse(f.sourceUrl));
      if (!validFacts.length) continue;
      const detailLines: string[] = [];
      for (const f of validFacts) {
        let val = typeof f.value === "object" && f.value !== null && "text" in f.value ? String((f.value as { text: unknown }).text) : "";
        if (!val || DISPROVEN_FACILITY.test(val)) continue;
        val = sanitizeVisibleText(val);
        if (val) detailLines.push(val.slice(0, 160));
        if (detailLines.length >= 8) break;
      }
      if (!detailLines.length) continue;
      const maxObserved = new Date(Math.max(...validFacts.map((f) => f.observedAt.getTime()))).toISOString();
      const sourcesMap = new Map<string, GraphSource>();
      for (const f of validFacts) {
        if (!sourcesMap.has(f.sourceUrl)) {
          sourcesMap.set(f.sourceUrl, { label: "Situs resmi", url: f.sourceUrl });
        }
      }
      const holderOutlets = nodes.get(holder)?.outlets ?? [];
      const fid = add({
        id: `fasilitas:${holder}`,
        kind: "fasilitas",
        label: `Fasilitas & Kamar ${placeName.get(holder) ?? nodes.get(holder)?.label}`,
        detail: detailLines,
        sources: [...sourcesMap.values()].slice(0, 3),
        observedAt: maxObserved,
        outlets: holderOutlets,
        weight: 3.5,
        modules: ["market-intelligence", "galeri-kompetitor", "direksi"],
        href: holderOutlets[0] ? `/market-intelligence?outlet=${holderOutlets[0]}` : "/market-intelligence",
      });
      const facWeight = clampScore(50 + Math.min(45, detailLines.length * 7));
      link(holder, fid, "fasilitas & kamar", {
        weight: facWeight,
        factors: [{ key: "jumlah_fakta", label: "Fakta fasilitas terverifikasi", score: facWeight, weight: 1 }],
        modules: ["market-intelligence", "galeri-kompetitor", "direksi"],
      });
      link(fid, platform("Situs resmi", ["market-intelligence", "galeri-kompetitor"]), "tercatat di", {
        weight: 78,
        modules: ["market-intelligence", "galeri-kompetitor"],
      });
    }
  }

  // 11. Simpul Gaya Visual & Galeri (/galeri-kompetitor)
  if (input.visualInsights) {
    for (const c of input.competitors) {
      const holder = holderByCompetitorId.get(c.id);
      if (!holder || !nodes.has(holder)) continue;
      const insight = (c.placeId ? input.visualInsights[c.placeId] : undefined) ?? input.visualInsights[slug(c.name)];
      if (!insight) continue;
      const galleryUrl = c.mapsUrl ?? "https://maps.google.com";
      const shownPhotos = (c.placeId ? input.galleryPhotoCounts?.[c.placeId] : undefined) ?? insight.photoCount;
      const vid = add({
        id: `visual:${holder}`,
        kind: "visual",
        label: `Gaya Visual & Suasana ${placeName.get(holder) ?? nodes.get(holder)?.label}`,
        detail: [
          `Gaya: ${insight.designStyle}`,
          `Suasana: ${insight.ambience}`,
          `${shownPhotos} foto galeri terverifikasi`,
          ...(insight.keyVisualElements ?? []).slice(0, 3),
        ],
        sources: [{ label: `Galeri foto Google Maps (${shownPhotos} foto)`, url: galleryUrl }],
        observedAt: "2026-11-15T00:00:00.000Z",
        outlets: nodes.get(holder)?.outlets ?? [],
        weight: 3.2,
        modules: ["galeri-kompetitor", "market-intelligence"],
        href: "/galeri-kompetitor",
      });
      const visWeight = clampScore(45 + Math.min(50, shownPhotos * 5));
      link(holder, vid, "gaya visual & suasana", {
        weight: visWeight,
        factors: [{ key: "foto_galeri", label: "Jumlah foto terverifikasi", score: visWeight, weight: 1 }],
        modules: ["galeri-kompetitor", "market-intelligence"],
      });
      link(vid, platform("Google Maps", ["galeri-kompetitor", "market-intelligence"]), "dibaca dari", {
        weight: 72,
        modules: ["galeri-kompetitor"],
      });
    }
  }

  // 12. Simpul Harga Menu & F&B (/direksi & /market-intelligence)
  if (input.officialMenus) {
    for (const [key, menu] of Object.entries(input.officialMenus)) {
      const outletId = `outlet:${key}`;
      if (!nodes.has(outletId) || !menu?.items?.length) continue;
      const prices = menu.items.map((i) => i.price).filter((p) => p > 0);
      const minP = prices.length ? Math.min(...prices) : 0;
      const maxP = prices.length ? Math.max(...prices) : 0;
      const mid = add({
        id: `menu:${outletId}`,
        kind: "menu",
        label: `Menu Resmi ${nodes.get(outletId)?.label ?? key}`,
        detail: [
          `${menu.items.length} item menu resmi tercatat`,
          `Rentang harga: Rp ${minP.toLocaleString("id-ID")} – Rp ${maxP.toLocaleString("id-ID")}`,
          ...menu.items.slice(0, 3).map((i) => `${i.name}: Rp ${i.price.toLocaleString("id-ID")}${i.unit ? ` (${i.unit})` : ""}`),
        ],
        sources: [{ label: "Situs resmi Sanghyang", url: "https://sanghyang.com/" }],
        observedAt: "2026-11-14T09:55:00.000Z",
        outlets: [key],
        weight: 3.5,
        modules: ["direksi", "market-intelligence", "dashboard"],
        href: `/direksi?outlet=${key}`,
      });
      link(outletId, mid, "menu resmi", { weight: 90, modules: ["direksi", "market-intelligence"] });
      link(mid, platform("Situs resmi Sanghyang", ["direksi", "market-intelligence"]), "dipublikasikan di", {
        weight: 85,
        modules: ["direksi", "market-intelligence"],
      });
    }
  }
  if (input.competitorMenus) {
    for (const [compName, p] of Object.entries(input.competitorMenus)) {
      const c = input.competitors.find((comp) => comp.name === compName || slug(comp.name) === slug(compName));
      if (!c) continue;
      const holder = holderByCompetitorId.get(c.id);
      if (!holder || !nodes.has(holder) || (!p.items?.length && !p.perPerson)) continue;
      const mid = `menu:${holder}`;
      if (nodes.has(mid)) continue;
      const details: string[] = [];
      if (p.items?.length) details.push(`${p.items.length} item menu tercatat`);
      if (p.perPerson) details.push(`Perkiraan per orang: Rp ${p.perPerson.min.toLocaleString("id-ID")} – Rp ${p.perPerson.max.toLocaleString("id-ID")}`);
      for (const item of (p.items ?? []).slice(0, 3)) {
        details.push(`${item.name}: Rp ${item.price.toLocaleString("id-ID")}${item.unit ? ` (${item.unit})` : ""}`);
      }
      const rawSources = p.sources?.length ? p.sources : [{ label: "Google Maps", url: c.mapsUrl ?? "https://maps.google.com" }];
      const sources: GraphSource[] = rawSources.map((s) => ({
        label: sanitizeVisibleText(s.label) || "Google Maps",
        url: s.url,
      }));
      const holderOutlets = nodes.get(holder)?.outlets ?? [];
      add({
        id: mid,
        kind: "menu",
        label: `Harga Menu & F&B ${placeName.get(holder) ?? nodes.get(holder)?.label}`,
        detail: details,
        sources,
        observedAt: p.perPerson?.capturedAt ? `${p.perPerson.capturedAt}T00:00:00.000Z` : null,
        outlets: holderOutlets,
        weight: 2.8,
        modules: ["direksi", "market-intelligence"],
        href: holderOutlets[0] ? `/direksi?outlet=${holderOutlets[0]}` : "/direksi",
      });
      const menuWeight = clampScore(45 + Math.min(50, (p.items?.length ?? 0) * 3) + (p.perPerson ? 10 : 0));
      link(holder, mid, "daftar harga menu", {
        weight: menuWeight,
        factors: [{ key: "item_menu", label: "Kelengkapan item harga", score: menuWeight, weight: 1 }],
        modules: ["direksi", "market-intelligence"],
      });
      link(mid, platform("Google Maps", ["direksi", "market-intelligence"]), "dibaca dari", {
        weight: 70,
        modules: ["direksi", "market-intelligence"],
      });
    }
  }

  // 13. Simpul Performa Media Sosial (Instagram & TikTok -> /marketing-sosmed)
  if (input.socialAccounts?.length) {
    for (const own of input.ownOutlets) {
      const outletId = `outlet:${own.outletKey}`;
      if (!nodes.has(outletId)) continue;
      const accounts = input.socialAccounts.filter(
        (a) => a.outlets.includes(own.outletKey) && (a.platform === "instagram" || a.platform === "tiktok" || a.platform === "facebook"),
      );
      if (!accounts.length) continue;
      const usernames = accounts.map((a) => a.label.replace(/^@/, "").toLowerCase());
      const posts = (input.socialPosts ?? []).filter((p) => usernames.some((u) => p.account.toLowerCase().includes(u)));
      let totalLikes = 0;
      for (const p of posts) if (p.likes) totalLikes += p.likes;
      const latestPostDay = posts.reduce<string | null>((best, p) => (!best || p.postedAt > best ? p.postedAt : best), null);
      let totalFollowers = 0;
      if (input.socialFollowers) {
        // Kunci platform:akun, karena Instagram dan TikTok @dragonbeachclub adalah dua akun dengan pengikut berbeda.
        for (const a of accounts) {
          const f = input.socialFollowers[`${a.platform}:${a.label.replace(/^@/, "")}`]?.followers;
          if (f) totalFollowers += f;
        }
      }
      const hasIg = accounts.some((a) => a.platform === "instagram");
      const hasTt = accounts.some((a) => a.platform === "tiktok");
      const details: string[] = [
        `Akun resmi: ${accounts.map((a) => `${a.label} (${a.platform === "tiktok" ? "TikTok" : a.platform === "facebook" ? "Facebook" : "Instagram"})`).join(", ")}`,
        totalFollowers > 0 ? `${totalFollowers.toLocaleString("id-ID")} total pengikut` : "Pengikut belum terbaca",
        posts.length > 0 ? `${posts.length} postingan resmi tercatat` : "Belum ada postingan baru",
      ];
      if (totalLikes > 0) details.push(`${totalLikes.toLocaleString("id-ID")} total suka`);
      const sources: GraphSource[] = accounts.map((a) => ({
        label: a.platform === "tiktok" ? "TikTok resmi" : a.platform === "facebook" ? "Facebook resmi" : "Instagram resmi",
        url: a.url,
      }));
      const sid = add({
        id: `sosmed:${outletId}`,
        kind: "sosmed",
        label: `Media Sosial ${own.label}`,
        detail: details,
        sources,
        observedAt: latestPostDay ? `${latestPostDay}T00:00:00.000Z` : null,
        outlets: [own.outletKey],
        weight: 3.4,
        modules: ["marketing-sosmed", "dashboard", "market-intelligence"],
        href: `/marketing-sosmed?outlet=${own.outletKey}`,
      });
      const channelScore = hasIg && hasTt ? 92 : 68;
      const activityScore = clampScore(Math.min(100, posts.length * 10 + (totalFollowers > 0 ? 35 : 0)));
      const sosmedWeight = clampScore(channelScore * 0.45 + activityScore * 0.55);
      link(outletId, sid, "performa media sosial", {
        weight: sosmedWeight,
        factors: [
          { key: "kanal_sosmed", label: "Cakupan kanal IG & TikTok", score: channelScore, weight: 0.45 },
          { key: "aktivitas_konten", label: "Aktivitas & pengikut", score: activityScore, weight: 0.55 },
        ],
        modules: ["marketing-sosmed", "dashboard", "market-intelligence"],
      });
      if (hasIg) {
        link(sid, platform("Instagram", ["marketing-sosmed", "market-intelligence"]), "dipantau di", {
          weight: 80,
          modules: ["marketing-sosmed"],
        });
      }
      if (hasTt) {
        link(sid, platform("TikTok", ["marketing-sosmed", "market-intelligence"]), "dipantau di", {
          weight: 78,
          modules: ["marketing-sosmed"],
        });
      }
    }
  }

  // Sanitasi akhir seluruh teks yang tampil ke pengguna: 0 mesin AI, 0 Crawl4AI/Playwright, 0 registri, 0 pesaing
  for (const n of nodes.values()) {
    n.label = sanitizeVisibleText(n.label);
    n.detail = n.detail.map((d) => sanitizeVisibleText(d)).filter(Boolean);
    n.sources = n.sources.map((s) => ({
      ...s,
      label: sanitizeVisibleText(s.label) || "Sumber data",
    }));
  }
  for (const l of links) {
    l.label = sanitizeVisibleText(l.label);
  }

  // Ringkasan keterhubungan lintas modul aplikasi
  const nodeList = [...nodes.values()];
  const moduleSummary: KnowledgeGraphModuleSummary[] = APP_MODULES.map((mod) => {
    const meta = APP_MODULE_META[mod];
    const modNodes = nodeList.filter((n) => n.modules?.includes(mod));
    const modNodeIds = new Set(modNodes.map((n) => n.id));
    const modLinks = links.filter(
      (l) => l.modules?.includes(mod) || (modNodeIds.has(l.source) && modNodeIds.has(l.target)),
    );
    const weighted = modLinks.map((l) => l.weight).filter((w): w is number => typeof w === "number");
    const avgLinkWeight = weighted.length
      ? Math.round((weighted.reduce((sum, w) => sum + w, 0) / weighted.length) * 10) / 10
      : null;
    return {
      module: mod,
      label: meta.label,
      shortLabel: meta.shortLabel,
      href: meta.href,
      nodeCount: modNodes.length,
      linkCount: modLinks.length,
      avgLinkWeight,
    };
  });

  return {
    generatedAt: input.now.toISOString(),
    range: input.range ?? null,
    nodes: nodeList,
    links,
    moduleSummary,
    internalSignals: input.internalSignals ?? null,
  };
}
