/**
 * Tipe data lengkap dan helper murni untuk tab Insight Pasar, Media Sosial, dan Strategy
 * pada aplikasi tunggal Sanghyang Analytics.
 */
import type { InternalOutletSignals, InternalOutletSignalsMap } from "@/lib/analytics/internal-signals-types";
import { humanizeDashes } from "@/lib/humanize-text";

export type { InternalOutletSignals, InternalOutletSignalsMap };

export const OUTLET_KEYS = ["sunset-grill", "dragon-beach-club", "resort", "dbistro", "dbar", "dspa"] as const;
export type OutletKey = (typeof OUTLET_KEYS)[number];
export type OutletChoice = "all" | OutletKey;

export function isOutletKey(value: unknown): value is OutletKey {
  return typeof value === "string" && (OUTLET_KEYS as readonly string[]).includes(value);
}

export const OUTLET_TABS: readonly { key: OutletChoice; label: string; desc: string }[] = [
  { key: "all", label: "Semua Outlet", desc: "Konsolidasi seluruh unit bisnis" },
  { key: "sunset-grill", label: "Sunset Grill", desc: "Seafood & grill tepi dermaga" },
  { key: "dragon-beach-club", label: "Dragon Beach Club", desc: "Beach club privat & hiburan malam" },
  { key: "resort", label: "Kamar & Resort", desc: "Kamar, suite, dan vila pantai" },
  { key: "dbistro", label: "D'Bistro", desc: "Restoran hotel all-day dining" },
  { key: "dbar", label: "D'Bar & Karaoke", desc: "Karaoke keluarga & lounge" },
  { key: "dspa", label: "D'Spa & Hot Spring", desc: "Hot Spring Aquamedic & spa" },
] as const;

export const OUTLET_LABELS: Record<string, string> = Object.fromEntries(OUTLET_TABS.map((t) => [t.key, t.label]));

export const OFFICIAL_ACCOUNTS_SOURCE = "https://sanghyang.com/";

export interface SnSourceRef {
  label: string;
  url: string | null;
  observedAt?: string | null;
}

export interface SnOutletReview {
  id: string;
  externalId: string;
  source: string;
  sourceUrl?: string;
  rating: number;
  reviewDate: string;
  title?: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
  themes: string[];
  verified: boolean;
  outletName?: string;
  outletKey?: string;
}

export interface SnOutletFinding {
  id: string;
  type: string;
  title: string;
  summary: string;
  action: "maintain" | "improve" | "investigate";
  priority: "high" | "medium";
  steps: string[];
  evidenceIds: string[];
  outletName?: string;
}

export interface SnOutletInfo {
  id: string;
  key: string;
  name: string;
  location?: string | null;
  rating: number | null;
  reviewCount: number;
  websiteUrl?: string | null;
  notes?: string | null;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    total: number;
  };
  channelBreakdown?: {
    google: { count: number; positive: number; rating: number | null };
    ota: { count: number; positive: number; rating: number | null };
    social: { count: number; positive: number; positiveRatio: number | null };
    website?: { count: number; positive: number };
  };
  topAspects?: { aspect: string; count: number; positiveRatio: number; negativeRatio: number }[];
  reviews: SnOutletReview[];
  verifiedReviews?: SnOutletReview[];
  findings: SnOutletFinding[];
}

export interface SnEvidencePoint {
  text: string;
  basis?: string;
  quote?: string | null;
  sources?: SnSourceRef[];
}

export interface SnPlaceSpecs {
  placeId?: string;
  competitorId?: string;
  name?: string;
  category?: string | null;
  group?: string | null;
  outlets?: string[];
  isSanghyang?: boolean;
  compsetRole?: string | null;
  roadKm?: number | null;
  driveMinutes?: number | null;
  distanceSource?: string | null;
  starRating?: number | null;
  roomCount?: number | null;
  websiteUrl?: string | null;
  mapsUrl?: string | null;
  sources?: SnSourceRef[];
  facilitySources?: Partial<Record<string, SnSourceRef>>;
  facilities?: {
    smartTv?: boolean | null;
    smartTvNote?: string | null;
    bathtub?: boolean | null;
    bathtubNote?: string | null;
    infinityPool?: boolean | null;
    poolType?: string | null;
    hotSpring?: boolean | null;
    hotSpringNote?: string | null;
    roomSizesM2?: number[];
    roomSizeRangeLabel?: string | null;
    keyAmenities?: string[];
    designStyle?: string | null;
    usp?: string | null;
  };
  visual?: {
    designStyle?: string | null;
    ambience?: string | null;
    keyElements?: string[];
    materialsAndLighting?: string | null;
    marketingOpportunity?: string | null;
    photoUrls?: string[];
  } | null;
  reviewHighlights?: {
    topics?: Array<{ label: string; count: number } | string>;
    topThemes?: string[];
  } | null;
}

export interface SnCompetitorComparison {
  id: string;
  outlet: string;
  outletName: string;
  competitorName: string;
  name?: string;
  parentName?: string | null;
  kind?: string;
  isSanghyang?: boolean;
  compsetRole?: "inti" | "benchmark" | "acuan" | string | null;
  specs?: SnPlaceSpecs;
  evidence?: {
    observed?: SnEvidencePoint[];
    strengths?: SnEvidencePoint[];
    gaps?: SnEvidencePoint[];
    opportunities?: SnEvidencePoint[];
  };
}

export interface SnRoomOfficialLayer {
  weekdayPrice: number | null;
  weekendPrice: number | null;
  priceLabel: string;
  sourceLabel: string;
  sourceUrl: string;
  breakfastIncluded?: boolean | null;
  breakfastLabel: string;
  weekdayCheckIn: string | null;
  weekendCheckIn: string | null;
  weekdayBreakfast?: boolean | null;
  weekendBreakfast?: boolean | null;
  ratePlan?: string | null;
  weekdayUnavailableReason?: string | null;
  weekendUnavailableReason?: string | null;
  weekdaySourceUrl?: string | null;
  weekendSourceUrl?: string | null;
  weekdayOtherNightPrice?: number | null;
  weekendOtherNightPrice?: number | null;
  otaCheckInWeekday?: string | null;
  otaCheckInWeekend?: string | null;
}

export interface SnBreakfastOfferPoint {
  price: number;
  otaName: string;
  checkIn: string;
}

export interface SnStayBreakfastOffers {
  withBreakfast: SnBreakfastOfferPoint | null;
  withoutBreakfast: SnBreakfastOfferPoint | null;
}

export interface SnRoomOtaLayer {
  weekdayPrice: number | null;
  weekendPrice: number | null;
  priceLabel: string;
  otaName: string;
  otaUrl: string;
  weekdayOtaName: string | null;
  weekdayOtaUrl: string | null;
  weekdayCheckIn?: string | null;
  weekendOtaName: string | null;
  weekendOtaUrl: string | null;
  weekendCheckIn?: string | null;
  breakfastIncluded?: boolean | null;
  breakfastLabel: string;
  withBreakfastWeekdayPrice?: number | null;
  withoutBreakfastWeekdayPrice?: number | null;
  withBreakfastWeekendPrice?: number | null;
  withoutBreakfastWeekendPrice?: number | null;
  breakfastOffers?: Record<"weekday" | "weekend", SnStayBreakfastOffers>;
  weekdayBreakfast?: boolean | null;
  weekendBreakfast?: boolean | null;
  weekdayIsPropertyLowest?: boolean;
  weekendIsPropertyLowest?: boolean;
  isPropertyLowestRate?: boolean;
}

export interface SnHotelRoomSubRow {
  name: string;
  category: string;
  bedrooms: number | null;
  areaSqm?: number | null;
  areaLabel: string;
  weekdayPrice?: number | null;
  weekendPrice?: number | null;
  priceLabel: string;
  priceSource?: string | null;
  smartTv?: boolean | null;
  smartTvLabel: string;
  bathtub?: boolean | null;
  bathtubLabel: string;
  breakfastIncluded?: boolean | null;
  breakfastLabel: string;
  sourcePriority?: "official" | "ota" | string;
  sourceLabel: string;
  sourceUrl: string;
  observedAt?: string;
  highlights?: string[];
  conflictNote?: string | null;
  officialRate: SnRoomOfficialLayer | null;
  officialUnavailableReason?: string | null;
  otaLowest: SnRoomOtaLayer | null;
}

export interface SnHotelMatrixEntry {
  no: number;
  competitorId: string;
  placeId?: string | null;
  name: string;
  role: "sanghyang" | "inti" | "acuan";
  starRating?: number | null;
  starLabel: string;
  roadKm?: number | null;
  driveMinutes?: number | null;
  distanceLabel: string;
  distanceSource?: string | null;
  roomCount?: number | null;
  roomCountLabel: string;
  areaSummaryLabel: string;
  hasMultiBedroomUnit?: boolean;
  multiBedroomNote?: string | null;
  otaRateWeekdayMin?: number | null;
  otaRateWeekendMin?: number | null;
  otaRateWeekdayMax?: number | null;
  otaRateWeekendMax?: number | null;
  otaRateLabel: string;
  otaRateMinText?: string;
  otaRateMaxText?: string;
  cheapestWeekdayOtaName?: string | null;
  cheapestWeekdayOtaUrl?: string | null;
  cheapestWeekendOtaName?: string | null;
  cheapestWeekendOtaUrl?: string | null;
  breakfastSummaryLabel?: string;
  rateConsistencyNote?: string | null;
  priceVsSanghyang?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  ratingLabel: string;
  smartTv?: boolean | null;
  smartTvLabel: string;
  bathtub?: boolean | null;
  bathtubLabel: string;
  poolLabel: string;
  designStyleLabel: string;
  auditRationale: string;
  photosCount?: number;
  facilityNarrative?: { text: string; sources?: SnSourceRef[] }[];
  specs?: SnPlaceSpecs | null;
  roomTypes: SnHotelRoomSubRow[];
  websiteUrl: string | null;
  mapsUrl: string | null;
}

export interface SnCheapestRow {
  stay: "weekday" | "weekend";
  stayLabel: string;
  role: "sanghyang" | "kompetitor";
  hotelId?: string;
  competitorId?: string;
  hotelName: string;
  starLabel?: string;
  roomTypeName: string;
  areaLabel: string;
  breakfastIncluded?: boolean | null;
  breakfastLabel: string;
  breakfastOffers?: SnStayBreakfastOffers | null;
  checkIn?: string | null;
  price: number;
  priceLabel: string;
  otaName: string;
  otaUrl: string;
  diffAmount?: number | null;
  diffPercent?: number | null;
  diffLabel: string;
  rank?: number;
}

export interface SnFnbMenuItem {
  name: string;
  category?: string | null;
  price: number;
  priceMax?: number | null;
  unit?: string | null;
  kind?: "paket-bersama" | "sewa-ruang" | string;
  pax?: number;
  photo?: number;
}

export interface SnComparableMenuItemEntry {
  ownItemName: string;
  ownPrice: number;
  ownUnit: string | null;
  competitorItems: string[];
  competitorPrice: number;
  gapPercent: number;
  generic?: boolean;
}

export interface SnFnbMatrixEntry {
  no: number;
  competitorId: string;
  placeId?: string | null;
  name: string;
  role: "sanghyang" | "inti" | "acuan";
  category?: string | null;
  parentName?: string | null;
  roadKm?: number | null;
  driveMinutes?: number | null;
  distanceLabel: string;
  distanceSource?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  ratingLabel: string;
  menuPriceRange?: { min: number; max: number } | null;
  menuRangeLabel: string;
  menuDetailLabel: string;
  facilitiesLabel: string;
  auditRationale: string;
  menuItemCount: number;
  comparableGap?: { percent: number; items: number } | null;
  comparableItems?: SnComparableMenuItemEntry[];
  perPersonRange?: { min: number; max: number; reporters?: number | null; url?: string; capturedAt?: string } | null;
  countedItems?: SnFnbMenuItem[];
  excludedItems?: SnFnbMenuItem[];
  sampleMenuItems?: SnFnbMenuItem[];
  menuSources?: { label: string; url: string }[];
  menuChecked?: string[];
  rangeCheapest?: SnFnbMenuItem | null;
  rangePriciest?: SnFnbMenuItem | null;
  photosCount?: number;
  specs?: SnPlaceSpecs | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
}

export interface SnItemComparisonRow {
  itemName: string;
  category?: string | null;
  sanghyangPrice: number;
  unit: string | null;
  averageCompetitorPrice: number | null;
  averageGapPercent: number | null;
  matches: {
    rival: string;
    core?: boolean;
    items: string[];
    price: number;
    gapPercent: number;
    generic?: boolean;
  }[];
}

export interface SnOutletMatrix {
  outletKey: string;
  outletName: string;
  kind: "resort" | "fnb";
  columns: string[];
  note: string;
  ratesWindowNote?: string;
  ratesCheckedAt?: string;
  rateWindow?: {
    nights?: number;
    firstCheckIn?: string | null;
    lastCheckIn?: string | null;
    checkInWeekday?: string | null;
    checkInWeekend?: string | null;
    observedAt?: string | null;
    window?: string | null;
  };
  cheapestComparison?: {
    title: string;
    subtitle: string;
    rows: SnCheapestRow[];
    weekday?: { sanghyang: SnCheapestRow | null; cheapestCompetitor: SnCheapestRow | null; competitors?: SnCheapestRow[] };
    weekend?: { sanghyang: SnCheapestRow | null; cheapestCompetitor: SnCheapestRow | null; competitors?: SnCheapestRow[] };
  };
  hotelEntries?: SnHotelMatrixEntry[];
  fnbEntries?: SnFnbMatrixEntry[];
  itemComparisons?: SnItemComparisonRow[];
}

export interface SnPromoVenue {
  name: string;
  outlets: string[];
}

export interface SnRadarPromo {
  id: string;
  competitorName: string;
  competitorOutlets?: string[];
  competitorIsLodging?: boolean;
  competitorVenues?: SnPromoVenue[];
  competitorRoadKm?: number | null;
  competitorHandle?: string | null;
  handle?: string;
  platform: "website" | "instagram" | "tiktok" | "facebook" | string;
  source?: string;
  sources?: { platform: string; url: string; label?: string }[];
  title: string;
  category?: string;
  promotionType?: string | null;
  description?: string | null;
  status: string;
  startsAt: string;
  endsAt: string | null;
  startWritten?: boolean;
  price: number | null;
  originalPrice?: number | null;
  discount?: number | string | null;
  discountText?: string | null;
  imageUrl?: string | null;
  counterStrategy?: string;
  sourceUrl?: string;
  kind?: "promo" | "event" | null;
  details?: string[];
  terms?: string[];
  metrics?: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null } | null;
  isOwn?: boolean;
  outlet?: string;
}

export interface SnBenchmarkCompetitor {
  name: string;
  compsetRole?: "inti" | "benchmark" | string;
  starRating?: number | null;
  roadKm?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  auditRationale?: string;
  estimatedRevenue?: number | null;
  estimatedMarketShare?: number | null;
  priceLevel?: string;
  evidenceSourceUrl?: string | null;
  websiteUrl?: string | null;
  mapsUrl?: string | null;
}

export interface SnOutletMarketShare {
  outletKey: string;
  outletName: string;
  activeMonth: string;
  totalMarketSizeEstimated: number | null;
  marketSharePercentage: number | null;
  marketSegmentName: string;
  marketRank: string;
  pricePositioningIndex: number | null;
  pricePositioningCategory: string | null;
  benchmarkCompetitors?: SnBenchmarkCompetitor[];
  menuPriceItems?: Array<{
    itemName: string;
    category: string;
    sanghyangPrice: number;
    competitorPrices: { competitorName: string; price: number; differencePercent: number; note?: string }[];
    portionValueNote: string;
  }>;
  digitalMarketingStrategy: {
    pricingOptimization: {
      title: string;
      currentAnalysis: string;
      recommendation: string;
      /** Langkah per tipe kamar, satu baris per jenis hari dan fase (resort); kosong untuk outlet F&B. */
      recommendationItems?: { room: string; lines: string[] }[];
      suggestedPriceChange?: string;
    };
    sentimentLeverage: {
      title: string;
      positiveDrivers: string[];
      negativeFriction: string[];
      marketingAngle: string;
    };
    competitorCounterPromo: {
      title: string;
      competitorAction: string;
      ourCounterStrategy: string;
    };
    promoFormulation: {
      promoName: string;
      headline: string;
      discountStructure: string;
      targetAudience: string;
      terms: string;
      crossSellingOutlet: string;
    };
    financialProjection?: {
      targetRevenueLiftPercent: number | null;
      projectedMonthlyRevenue: number | null;
      projectedMarketShare: number | null;
      paybackPeriodWeeks?: number;
      breakEvenOccupancyDropPercent?: number;
    };
  };
}

export interface SnResortMarketSize {
  daysPerMonth: number;
  ratesCapturedAt: string | null;
  marketCapMonthly: number | null;
  tpk: { percent: number; period: string; sourceUrl: string } | null;
  sanghyang: {
    actual: { month: string; sourceFile: string; share: number | null } | null;
    estimatedShare: number | null;
    rank: number | null;
    rankOf: number | null;
  };
  rows: {
    hotelId: string;
    name: string;
    role: "sanghyang" | "inti" | "benchmark" | string;
    stars: number | null;
    roadKm: number;
    roomCount: number | null;
    roomCountSource?: string;
    estimatedMonthlyRevenue: number | null;
    share: number | null;
    priceVsSanghyang: number | null;
  }[];
}

export interface SnReviewShareRow {
  name: string;
  isSanghyang: boolean;
  roadKm: number | null;
  rating: number | null;
  reviewCount: number;
  share: number | null;
}

export interface SnHeadToHeadNarrative {
  summary?: string;
  teramati?: string[];
  disimpulkan?: string[];
  implikasi?: string[];
}

export interface SnNewsItem {
  title: string;
  source: string;
  url: string | null;
  date: string;
  category: string;
  outlets: string[];
  summary: string | null;
  reason: string | null;
  location: string | null;
  distanceKm?: number | null;
  eventStart?: string | null;
  eventEnd?: string | null;
}

export interface SnCompsetAudit {
  used: SnBenchmarkCompetitor[];
  excluded: { name: string; roadKm?: number | null; starRating?: number | null; category?: string; reason?: string }[];
}

export interface SnCompetitorMenuCard {
  name: string;
  range?: { min: number; max: number } | null;
  itemCount?: number;
  sources?: { label: string; url: string }[];
  items?: SnFnbMenuItem[];
}

export interface SnSummary {
  title: string;
  generatedAt: string;
  executiveSummary?: string | null;
  sanghyang?: { rating: number | null; reviewCount: number | null };
  outlets: SnOutletInfo[];
  comparisons: SnCompetitorComparison[];
  ownEvidence?: Record<string, SnCompetitorComparison | null>;
  outletAnalyses?: Record<
    string,
    {
      /** "live"/"cache" = kesimpulan model dari Knowledge Graph; "deterministic" = susunan otomatis dari graf yang sama. */
      origin?: "deterministic" | "cache" | "live";
      /** Periode yang dipakai saat kesimpulan disusun; bisa berbeda dari periode tampilan bila memakai kesimpulan terbaru. */
      rangeLabel?: string;
      generatedAt?: string | null;
      headToHeadNarrative?: SnHeadToHeadNarrative | null;
      periodRecommendations?: Array<{
        factor: string;
        aarrrStage?: string;
        horizon?: string;
        finding: string;
        action: string;
        metricToWatch: string;
        priority: string;
        evidenceSources: string[];
      }>;
    } | null
  >;
  competitorRatings?: { name: string; rating: number | null; reviewCount?: number | null }[];
  competitorSocialRadar?: SnRadarPromo[];
  ownPromos?: SnRadarPromo[];
  outletMarketShare?: Record<string, SnOutletMarketShare>;
  internalSignals?: InternalOutletSignalsMap | null;
  marketSize?: SnResortMarketSize;
  reviewShares?: Record<string, SnReviewShareRow[]>;
  otaDirectory?: {
    providers: string[];
    reviewProviders?: string[];
    byHotel: Record<string, string[]>;
    reviewSourcesByHotel?: Record<string, string[]>;
  };
  compsetAudit?: Record<string, SnCompsetAudit>;
  competitorMatrix?: Record<string, SnOutletMatrix>;
  competitorMenus?: Record<string, SnCompetitorMenuCard>;
  news?: SnNewsItem[];
  range?: { from: string; to: string; label: string; custom: boolean };
  syncStatus?: {
    lastSyncAt: string | null;
    latestReviewDate?: string | null;
    totalReviews: number;
    verifiedReviews: number;
    totalCompetitors?: number;
    schedule?: string;
    heartbeatSummary?: string | null;
  };
}

export interface SnSocialPostAudit {
  hookScore: number;
  copyScore: number;
  ctaScore: number;
  overallScore?: number;
  statusVerdict: "high_performing" | "weak_cta" | "needs_hook_revision" | "low_traction" | string;
  verdictLabel?: string;
  hookFeedback?: string;
  copyFeedback?: string;
  ctaFeedback?: string;
  actionDirective?: string;
  recommendedRevisionHeadline?: string;
  engagementRatePercent?: number | null;
  engagementHealth?: string;
}

export interface SnSocialPost {
  id: string;
  outletKey: OutletKey;
  platform: "instagram" | "tiktok" | "facebook";
  postType: "reels" | "feed" | "carousel" | "tiktok_video" | "story";
  postedAt: string;
  postUrl: string;
  caption: string;
  account?: string;
  collabAccounts?: string[];
  followers?: number | null;
  followersObservedAt?: string | null;
  profilePostsTotal?: number | null;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    inquiriesWa: number | null;
    followers?: number | null;
  } | null;
  audit: SnSocialPostAudit;
  /** Asal data kartu (lihat `socialSourceLabel`); Meta selalu di depan bila ikut. */
  sources?: SnSocialSource[];
  /** Foto atau thumbnail HTTPS; null bila tidak terbaca. */
  imageUrl?: string | null;
  /** Waktu tayang lengkap dari Meta (ISO); null bila hanya tanggal tayangnya yang diketahui. */
  publishedAt?: string | null;
}

/** Graph API Meta, sinkron Ekstensi Chrome, isian tim lewat formulir, atau arsip baca akun resmi. */
export type SnSocialSource = "meta" | "extension" | "team" | "archive";

/** Status sambungan Meta dari /api/marketing-sosmed (tanpa kunci aksesnya). */
export interface SnMetaStatus {
  keyInstalled: boolean;
  /** Akun Instagram di portofolio bisnis Meta (huruf kecil, tanpa @). */
  connected: string[];
  /** Akun tersambung yang postingannya gagal dibaca. */
  unreadable: string[];
  problem: string | null;
  perAccountLimit: number;
}

/** Akun Instagram resmi; outlet null = akun induk yang outlet postingannya dibaca dari caption. */
export interface SnInstagramAccount {
  username: string;
  outlet: OutletKey | null;
}

export interface SnSocialAccountCoverage {
  syncedPosts: number;
  profilePostsTotal: number | null;
  followers: number | null;
  incomplete: boolean;
  /** Tanggal tayang terbaru (YYYY-MM-DD WIB) yang tersinkron di basis data untuk akun ini; null bila belum ada. */
  latestPostAt: string | null;
}

export interface SnOfficialSocialAccount {
  platform: string;
  label: string;
  url: string;
  owner: string;
  outlets: string[];
}

export interface SnSocialApiResponse {
  success: boolean;
  posts: SnSocialPost[];
  officialAccounts?: SnOfficialSocialAccount[];
  accounts?: SnInstagramAccount[];
  /** null bila Meta tidak ikut dibaca (status belum diketahui). */
  meta?: SnMetaStatus | null;
  crawledSource?: { crawledAt?: string };
}

export interface SnGeneratedDraft {
  generatedAt?: string;
  competitorContext?: {
    competitorName?: string;
    promoTitle?: string;
    promoCategory?: string;
    counterStrategy?: string;
  };
  reels?: {
    headline: string;
    hook3Sec: string;
    visualDirection: string;
    caption: string;
    audioRecommendation: string;
    callToAction: string;
    hashtags?: string[];
  };
  tiktok?: {
    headline: string;
    hookPOV: string;
    storyline?: string[];
    caption: string;
    soundTrend: string;
    callToAction: string;
    hashtags?: string[];
  };
  carousel?: {
    headline: string;
    slides?: { slideNo: number; title: string; description: string; visualNote: string }[];
    caption: string;
    promoOffer: string;
    hashtags?: string[];
  };
}

export function socialAccountKey(platform: string, handleOrLabel: string): string {
  return `${platform.toLowerCase()}:${handleOrLabel.replace(/^@/, "").trim().toLowerCase()}`;
}

/**
 * Merangkum kelengkapan sinkronisasi per akun resmi (jumlah postingan tersinkron vs total postingan profil asli
 * dan pengikut terakhir yang terbaca ekstensi) tanpa angka cadangan.
 */
export function summarizeSocialAccountCoverage(
  posts: readonly SnSocialPost[],
  accounts: readonly SnOfficialSocialAccount[],
): Record<string, SnSocialAccountCoverage> {
  const out: Record<string, SnSocialAccountCoverage> = {};
  for (const acc of accounts) {
    if (acc.platform !== "instagram" && acc.platform !== "tiktok") continue;
    const key = socialAccountKey(acc.platform, acc.label);
    out[key] = { syncedPosts: 0, profilePostsTotal: null, followers: null, incomplete: false, latestPostAt: null };
  }
  const latestObs = new Map<string, string>();
  for (const post of posts) {
    if (post.platform !== "instagram" && post.platform !== "tiktok") continue;
    // Ketika post.account diisi eksplisit (termasuk postingan kolaborasi eksternal ber-URL /<collab>/p/...),
    // selalu hitung ke akun resmi di post.account — tidak pernah jatuh ke handle kolaborator pada postUrl.
    const primaryHandle = post.account?.replace(/^@/, "").trim().toLowerCase() ?? "";
    if (!primaryHandle) continue;
    const key = socialAccountKey(post.platform, primaryHandle);
    const entry = (out[key] ??= { syncedPosts: 0, profilePostsTotal: null, followers: null, incomplete: false, latestPostAt: null });
    entry.syncedPosts += 1;

    const day = postDayWib(post.postedAt);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!entry.latestPostAt || day > entry.latestPostAt)) {
      entry.latestPostAt = day;
    }

    const obsAt = post.followersObservedAt ?? post.postedAt ?? "";
    const prevObs = latestObs.get(key) ?? "";
    const fol =
      typeof post.followers === "number" && Number.isFinite(post.followers)
        ? post.followers
        : typeof post.metrics?.followers === "number" && Number.isFinite(post.metrics.followers)
          ? post.metrics.followers
          : null;
    if (fol !== null && (entry.followers === null || obsAt >= prevObs)) {
      entry.followers = fol;
      latestObs.set(key, obsAt);
    }
    if (typeof post.profilePostsTotal === "number" && Number.isFinite(post.profilePostsTotal) && post.profilePostsTotal >= 0) {
      entry.profilePostsTotal =
        entry.profilePostsTotal === null ? post.profilePostsTotal : Math.max(entry.profilePostsTotal, post.profilePostsTotal);
    }

    if (Array.isArray(post.collabAccounts)) {
      const seenCollab = new Set<string>();
      for (const rawCollab of post.collabAccounts) {
        const cleanCollab = rawCollab.replace(/^@/, "").trim().toLowerCase();
        if (!cleanCollab || cleanCollab === primaryHandle || seenCollab.has(cleanCollab)) continue;
        seenCollab.add(cleanCollab);
        const collabKey = socialAccountKey(post.platform, cleanCollab);
        const collabEntry = out[collabKey];
        if (!collabEntry) continue;
        collabEntry.syncedPosts += 1;
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!collabEntry.latestPostAt || day > collabEntry.latestPostAt)) {
          collabEntry.latestPostAt = day;
        }
      }
    }
  }
  for (const entry of Object.values(out)) {
    entry.incomplete = entry.profilePostsTotal !== null && entry.syncedPosts < entry.profilePostsTotal;
  }
  return out;
}

export interface SnPlatformSosmedStats {
  accounts: number;
  handles: string[];
  followers: number | null;
  posts: number;
  /** Jumlah postingan periode aktif yang berasal langsung dari akun resmi outlet ini (atau input manual). */
  ownAccountPosts: number;
  /** Jumlah postingan periode aktif yang berasal dari akun induk (mis. @sanghyangresort) yang menyebut outlet ini. */
  parentAccountPosts: number;
  /** Daftar handle akun induk yang menyumbang postingan periode aktif ke outlet ini. */
  parentHandles: string[];
  /** Total postingan akun resmi platform ini yang tersinkron di DB lokal lintas semua tanggal. */
  syncedAccountPosts: number;
  /** Total postingan outlet ini di platform ini lintas semua tanggal (termasuk mention akun induk). */
  outletAllPostsCount: number;
  profilePostsTotal: number | null;
  /** Tanggal tayang terbaru (YYYY-MM-DD WIB) pada akun resmi platform ini di DB lokal. */
  latestSyncedPostAt: string | null;
  /** Tanggal tayang terbaru (YYYY-MM-DD WIB) pada semua postingan outlet + platform ini di DB lokal. */
  latestOutletPostAt: string | null;
  views: { total: number; average: number } | null;
  likes: { total: number; counted: number; average: number } | null;
}

export interface SnSosmedStats {
  posts: number;
  likes: { total: number; counted: number; average: number } | null;
  caption: { hook: number; copy: number; cta: number; score: number } | null;
  waLeads: { total: number; filled: number } | null;
  instagram: SnPlatformSosmedStats;
  tiktok: SnPlatformSosmedStats;
}

const meanNumbers = (values: readonly number[]) =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

/**
 * Menghitung statistik ringkasan Media Sosial per platform dan gabungan yang 100% setara dengan
 * `lib/market/marketing-sosmed-outlets.ts` (skor caption berbobot dari rata-rata tak dibulatkan,
 * likes terpantau + rata-rata per postingan, rasio tersinkron vs total profil, serta pemisahan
 * postingan akun outlet sendiri vs kontribusi akun induk).
 */
export function computeSosmedStats(
  periodPosts: readonly SnSocialPost[],
  visibleAccounts: readonly SnOfficialSocialAccount[],
  coverage: Record<string, SnSocialAccountCoverage>,
  outletAllPosts: readonly SnSocialPost[] = periodPosts,
): SnSosmedStats {
  const buildPlatform = (plat: "instagram" | "tiktok"): SnPlatformSosmedStats => {
    const platAccounts = visibleAccounts.filter((a) => a.platform === plat);
    const platHandleSet = new Set(platAccounts.map((a) => a.label.replace(/^@/, "").trim().toLowerCase()));
    const platPosts = periodPosts.filter((p) => p.platform === plat);
    const platAllOutletPosts = outletAllPosts.filter((p) => p.platform === plat);

    let ownAccountPosts = 0;
    let parentAccountPosts = 0;
    const parentHandleSet = new Set<string>();
    for (const p of platPosts) {
      const handle = p.account?.replace(/^@/, "").trim().toLowerCase() ?? "";
      const collabMatchesOwn =
        Array.isArray(p.collabAccounts) &&
        p.collabAccounts.some((h) => platHandleSet.has(h.replace(/^@/, "").trim().toLowerCase()));
      if (handle && !platHandleSet.has(handle) && !collabMatchesOwn) {
        parentAccountPosts += 1;
        parentHandleSet.add(`@${handle}`);
      } else {
        ownAccountPosts += 1;
      }
    }

    let followersSum = 0;
    let hasFollowers = false;
    let syncedAccPosts = 0;
    let profileTotalSum = 0;
    let profileTotalAccounts = 0;
    let latestSyncedPostAt: string | null = null;

    for (const acc of platAccounts) {
      const cov = coverage[socialAccountKey(acc.platform, acc.label)];
      if (!cov) continue;
      syncedAccPosts += cov.syncedPosts;
      if (cov.followers !== null) {
        followersSum += cov.followers;
        hasFollowers = true;
      }
      if (cov.profilePostsTotal !== null) {
        profileTotalSum += cov.profilePostsTotal;
        profileTotalAccounts += 1;
      }
      if (cov.latestPostAt && (!latestSyncedPostAt || cov.latestPostAt > latestSyncedPostAt)) {
        latestSyncedPostAt = cov.latestPostAt;
      }
    }
    const allHaveProfileTotal = platAccounts.length > 0 && profileTotalAccounts === platAccounts.length;

    let latestOutletPostAt: string | null = null;
    for (const p of platAllOutletPosts) {
      const day = postDayWib(p.postedAt);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!latestOutletPostAt || day > latestOutletPostAt)) {
        latestOutletPostAt = day;
      }
    }

    const likes = platPosts
      .map((p) => p.metrics?.likes)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    const views = platPosts
      .map((p) => p.metrics?.views)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

    return {
      accounts: platAccounts.length,
      handles: platAccounts.map((a) => a.label),
      followers: hasFollowers ? followersSum : null,
      posts: platPosts.length,
      ownAccountPosts,
      parentAccountPosts,
      parentHandles: [...parentHandleSet],
      syncedAccountPosts: syncedAccPosts,
      outletAllPostsCount: platAllOutletPosts.length,
      profilePostsTotal: allHaveProfileTotal ? profileTotalSum : null,
      latestSyncedPostAt,
      latestOutletPostAt,
      views: views.length > 0 ? { total: views.reduce((s, n) => s + n, 0), average: Math.round(meanNumbers(views)) } : null,
      likes:
        likes.length > 0
          ? { total: likes.reduce((s, n) => s + n, 0), counted: likes.length, average: Math.round(meanNumbers(likes)) }
          : null,
    };
  };

  const instagram = buildPlatform("instagram");
  const tiktok = buildPlatform("tiktok");

  const allLikes = periodPosts
    .map((p) => p.metrics?.likes)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const waValues = periodPosts
    .map((p) => p.metrics?.inquiriesWa)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  const audits = periodPosts.map((p) => p.audit);
  const avgHook = audits.length > 0 ? meanNumbers(audits.map((a) => a.hookScore)) : 0;
  const avgCopy = audits.length > 0 ? meanNumbers(audits.map((a) => a.copyScore)) : 0;
  const avgCta = audits.length > 0 ? meanNumbers(audits.map((a) => a.ctaScore)) : 0;

  return {
    posts: periodPosts.length,
    likes:
      allLikes.length > 0
        ? { total: allLikes.reduce((s, n) => s + n, 0), counted: allLikes.length, average: Math.round(meanNumbers(allLikes)) }
        : null,
    caption:
      audits.length > 0
        ? {
            hook: Math.round(avgHook),
            copy: Math.round(avgCopy),
            cta: Math.round(avgCta),
            score: Math.round(avgHook * 0.35 + avgCopy * 0.35 + avgCta * 0.3),
          }
        : null,
    waLeads: waValues.length > 0 ? { total: waValues.reduce((s, n) => s + n, 0), filled: waValues.length } : null,
    instagram,
    tiktok,
  };
}

/** Persentase likes terhadap jumlah pengikut (2 desimal), null bila data tidak lengkap atau pengikut <= 0. */
export function likeRatePercent(likes: number | null | undefined, followers: number | null | undefined): number | null {
  if (typeof likes !== "number" || typeof followers !== "number" || !Number.isFinite(likes) || !Number.isFinite(followers) || followers <= 0) {
    return null;
  }
  return Number(((likes / followers) * 100).toFixed(2));
}

/**
 * Postingan yang tayang pada hari WIB startDate sampai endDate (keduanya termasuk), terbaru dulu. Pada hari yang
 * sama, postingan berjam tayang (Meta) diurutkan menurut jamnya dan yang hanya bertanggal menyusul.
 */
export function socialPostsInPeriod<T extends Pick<SnSocialPost, "postedAt" | "postUrl" | "publishedAt">>(
  posts: readonly T[],
  startDate: string,
  endDate: string,
): T[] {
  return posts
    .map((post) => ({ post, day: postDayWib(post.postedAt) }))
    .filter(({ day }) => day >= startDate && day <= endDate)
    .sort((a, b) => {
      if (a.day !== b.day) return a.day < b.day ? 1 : -1;
      const ta = a.post.publishedAt ?? "";
      const tb = b.post.publishedAt ?? "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.post.postUrl.localeCompare(b.post.postUrl);
    })
    .map(({ post }) => post);
}

const SOURCE_LABELS: Record<SnSocialSource, string> = {
  meta: "Meta",
  extension: "Ekstensi",
  team: "Dicatat tim",
  archive: "Arsip",
};

/** "Meta + Ekstensi", "Ekstensi", "Arsip 10 Nov 2026", ... untuk lencana sumber kartu. */
export function socialSourceLabel(sources: readonly SnSocialSource[] | undefined, archiveDate?: string | null): string {
  if (!sources || sources.length === 0) return "Sumber belum tercatat";
  return sources.map((src) => (src === "archive" && archiveDate ? `${SOURCE_LABELS.archive} ${fmtDateShort(archiveDate)}` : SOURCE_LABELS[src])).join(" + ");
}

const POST_TYPE_LABELS: Record<SnSocialPost["postType"], string> = {
  reels: "Reels",
  feed: "Foto",
  carousel: "Carousel",
  tiktok_video: "Video TikTok",
  story: "Story",
};

export const socialPostTypeLabel = (postType: SnSocialPost["postType"]): string => POST_TYPE_LABELS[postType] ?? postType;

const NO_META_ACCOUNT = "Belum ada akun Instagram yang tersambung ke Meta.";

export interface SnMetaNote {
  /** Akun yang dibahas; null untuk catatan yang berlaku bagi semua akun. */
  handle: string | null;
  state: "meta" | "unreadable" | "not_connected" | "unavailable" | "unknown";
  text: string;
}

/**
 * Catatan sumber postingan per akun Instagram outlet: tersambung ke Meta (dan sejak kapan postingannya terbaca), gagal
 * dibaca, atau belum tersambung sehingga datanya dari ekstensi. Akun outlet itu sendiri didahulukan, lalu akun induk
 * yang postingannya ikut masuk bila menyebut outlet tersebut.
 */
export function metaAccountNotes({
  outlet,
  accounts,
  meta,
  posts,
}: {
  outlet: OutletChoice;
  accounts: readonly SnInstagramAccount[];
  meta: SnMetaStatus | null | undefined;
  posts: readonly Pick<SnSocialPost, "account" | "postedAt" | "sources">[];
}): SnMetaNote[] {
  if (!meta) {
    return [{ handle: null, state: "unknown", text: "Status sambungan Meta belum terbaca. Postingan di bawah berasal dari data yang tersimpan di aplikasi." }];
  }
  if (!meta.keyInstalled || meta.connected.length === 0) {
    const reason = meta.problem ?? NO_META_ACCOUNT;
    return [{ handle: null, state: "unavailable", text: `${reason} Postingan di bawah berasal dari ekstensi.` }];
  }
  const own = accounts.filter((a) => outlet === "all" || a.outlet === outlet);
  const parents = outlet === "all" ? [] : accounts.filter((a) => a.outlet === null);
  const handles = [...new Set([...own, ...parents].map((a) => a.username.replace(/^@/, "").toLowerCase()))];
  const connected = new Set(meta.connected);
  const unreadable = new Set(meta.unreadable);
  return handles.map((handle): SnMetaNote => {
    if (unreadable.has(handle)) {
      return { handle, state: "unreadable", text: `Akun @${handle} tersambung ke Meta tetapi postingannya tidak bisa dibaca saat ini, data dari ekstensi.` };
    }
    if (!connected.has(handle)) {
      return { handle, state: "not_connected", text: `Akun @${handle} belum tersambung ke Meta, data dari ekstensi.` };
    }
    const oldest = posts
      .filter((p) => p.sources?.includes("meta") && p.account?.replace(/^@/, "").toLowerCase() === handle)
      .map((p) => postDayWib(p.postedAt))
      .sort()[0];
    return {
      handle,
      state: "meta",
      text: oldest
        ? `@${handle} tersambung ke Meta: ${meta.perAccountLimit} postingan terbaru dibaca, paling lama ${fmtDateShort(oldest)}.`
        : `@${handle} tersambung ke Meta, belum ada postingan yang terbaca.`,
    };
  });
}

/** Alasan "Tarik data" Audit Promo belum bisa membaca Meta (kunci belum dipasang, semua akun gagal); null bila bisa. */
export function metaPullProblem(meta: SnMetaStatus | null | undefined): string | null {
  if (!meta) return null;
  const nothingReadable = !meta.keyInstalled || meta.connected.length === 0 || meta.connected.every((h) => meta.unreadable.includes(h));
  return nothingReadable ? (meta.problem ?? NO_META_ACCOUNT) : null;
}

export function postOverallScore(audit: Pick<SnSocialPostAudit, "hookScore" | "copyScore" | "ctaScore" | "overallScore">): number {
  if (typeof audit.overallScore === "number" && Number.isFinite(audit.overallScore)) {
    return Math.round(audit.overallScore);
  }
  const hook = Number.isFinite(audit.hookScore) ? audit.hookScore : 0;
  const copy = Number.isFinite(audit.copyScore) ? audit.copyScore : 0;
  const cta = Number.isFinite(audit.ctaScore) ? audit.ctaScore : 0;
  return Math.round(hook * 0.35 + copy * 0.35 + cta * 0.3);
}

const AI_OR_TOOL_MENTION =
  /\b(?:gemini(?:\s*\d+(?:\.\d+)?(?:\s*(?:pro|flash|ultra|nano|lite))?)?|gpt-?\d[\w.-]*|chatgpt|openai|claude(?:\s*\d+(?:\.\d+)?)?|anthropic|vertex\s*ai|google\s*ai|llm|ai\s+model|model\s+ai)\b/gi;

/** Membersihkan teks publik dari penyebutan nama alat internal, mesin pemrosesan, berkas, dan istilah lama. */
export function sanitizePublicText(text: string): string {
  if (!text) return "";
  const cleaned = text
    .replace(AI_OR_TOOL_MENTION, "")
    .replace(/\(\s*(?:crawl\s+)?diperiksa\s+crawl4ai\s+([^)]+)\)/gi, "(terakhir diperiksa $1)")
    .replace(/\(\s*crawl\s+crawl4ai\s*,?\s*([^)]+)\)/gi, "(terakhir diperiksa $1)")
    .replace(/\b(?:diperiksa|crawl)\s+crawl4ai\b/gi, "terakhir diperiksa")
    .replace(/\bcrawl4ai\b/gi, "")
    .replace(/\bplaywright\b/gi, "")
    .replace(/\bRute\s+OSRM\b/g, "Estimasi rute")
    .replace(/\brute\s+OSRM\b/g, "estimasi rute")
    .replace(/\(\s*OSRM\s*\)/g, "(estimasi rute)")
    .replace(/\s*\/\s*OSRM\b/g, "")
    .replace(/\bOSRM\b/g, "perhitungan rute")
    .replace(/\(\s*[\w-]+\.(?:json|csv|ts|js|py)\s*\)/gi, "")
    .replace(/\b[\w-]+\.(?:json|csv|py)\b/gi, "")
    .replace(/\bRegistri\s+(?:pesaing|pembanding|kompetitor)\b/g, "Daftar kompetitor")
    .replace(/\bregistri\s+(?:pesaing|pembanding|kompetitor)\b/g, "daftar kompetitor")
    .replace(/\bRegistri\b/g, "Daftar kompetitor")
    .replace(/\bregistri\b/g, "daftar kompetitor")
    .replace(/\bPesaing\b/g, "Kompetitor")
    .replace(/\bpesaing\b/g, "kompetitor")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return humanizeDashes(cleaned);
}

export const SESSION_EXPIRED_MESSAGE = "Sesi login telah berakhir. Silakan login ulang.";

export class MarketingApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MarketingApiError";
    this.status = status;
  }
}

export function marketingApiErrorFromResponse(status: number, payloadError?: string | null): MarketingApiError {
  const detail = typeof payloadError === "string" && payloadError.trim() ? payloadError.trim() : null;
  if (status === 401) {
    return new MarketingApiError(401, detail && /sesi/i.test(detail) ? detail : SESSION_EXPIRED_MESSAGE);
  }
  return new MarketingApiError(status, detail ?? `Server menjawab ${status}`);
}

export function formatMarketingClientError(err: unknown, fallbackMessage: (detail: string) => string): string {
  if (err instanceof MarketingApiError && err.status === 401) {
    return err.message;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return fallbackMessage(detail);
}

/** Membersihkan teks tab Strategy dari rujukan halaman lama agar fokus murni pada strategi pemasaran. */
/**
 * Asal kesimpulan Knowledge Graph untuk teks kecil di bawah judul: kapan dan untuk periode apa kesimpulan itu disusun.
 * Kesimpulan model disusun langkah analisis_graf (Perbarui Semua Data dan jadwal malam); susunan otomatis dipakai selama
 * belum ada kesimpulan untuk outlet itu. Nama mesin AI tidak disebut.
 */
export function knowledgeAnalysisOriginText(
  analysis: { origin?: "deterministic" | "cache" | "live"; rangeLabel?: string; generatedAt?: string | null } | null | undefined,
): string | null {
  if (!analysis?.origin) return null;
  const period = analysis.rangeLabel ? ` periode ${analysis.rangeLabel}` : "";
  if (analysis.origin === "deterministic" || !analysis.generatedAt) {
    return `Susunan otomatis dari semua data${period}. Rekomendasi baru disusun saat Perbarui Semua Data berikutnya.`;
  }
  const at = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(analysis.generatedAt));
  return `Disusun ${at} WIB dari semua data${period}. Disusun ulang setiap Perbarui Semua Data.`;
}

export function sanitizeStrategyText(text: string): string {
  if (!text) return "";
  return sanitizePublicText(text)
    .replace(/\s+dan\s+(?:di\s+)?halaman\s+Untuk\s+Direksi\b/gi, "")
    .replace(/\bhalaman\s+Untuk\s+Direksi\b/gi, "tab Insight Pasar (Harga)")
    .replace(/\s+dan\s+di\s+halaman\s+Omset,\s*Target\s+dan\s+Strategy\b/gi, " dan di bagian Radar Promo di bawah")
    .replace(/\bhalaman\s+Omset,\s*Target\s+dan\s+Strategy\b/gi, "bagian Radar Promo di bawah")
    .replace(/\b(?:data\s+)?omset\b/gi, "kinerja pasar")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Menyaring label peringkat pasar untuk tab Strategy; menyembunyikan catatan ketiadaan omset non-hotel. */
export function visibleMarketRank(rank: string | null | undefined): string | null {
  const clean = typeof rank === "string" ? rank.trim() : "";
  if (!clean || /\bomset\b/i.test(clean)) return null;
  return clean;
}

export function fmtRupiah(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export function fmtCompactRupiah(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "Belum ada data";
  return n >= 1e9
    ? `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`
    : `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Jt`;
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00+07:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}

export function checkInLabel(iso: string | null | undefined): string {
  return fmtDateShort(iso);
}

export function promoPeriodText(p: Pick<SnRadarPromo, "startsAt" | "endsAt" | "startWritten">): string {
  const end = p.endsAt ? fmtDateShort(p.endsAt) : null;
  if (p.startWritten === false) return end ? `Berlaku s.d. ${end}` : `Tanpa tanggal tertulis (dibaca ${fmtDateShort(p.startsAt)})`;
  const start = fmtDateShort(p.startsAt);
  return !end || end === start ? start : `${start} – ${end}`;
}

export function promoPriceDiscountText(p: Pick<SnRadarPromo, "price" | "discount" | "discountText">): string {
  const parts: string[] = [];
  if (typeof p.price === "number" && p.price > 0) parts.push(fmtRupiah(p.price));
  if (typeof p.discount === "number" && p.discount > 0) parts.push(`Diskon ${p.discount}%`);
  else if (typeof p.discount === "string" && p.discount.trim()) parts.push(p.discount.trim());
  else if (p.discountText) parts.push(p.discountText);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function isPromoEvent(p: SnRadarPromo): boolean {
  if (p.kind === "event") return true;
  if (p.kind === "promo") return false;
  return /\b(event|festival|live music|dj|new year|tahun baru|party|pesta|gathering|fun games|cooking class|yoga)\b/i.test(
    `${p.title} ${p.category ?? ""}`,
  );
}

/** Kata kunci judul promo per outlet (paritas penuh dengan lib/market/outlet-filters.ts). */
const PROMO_KEYWORDS: Record<OutletKey, string[]> = {
  resort: ["kamar", "menginap", "inap", "staycation", "kolam renang", "kolam", "pool", "room", "rooms"],
  dbistro: ["restoran", "restaurant", "resto", "sarapan", "breakfast", "brunch", "dinner", "makan malam", "lunch", "makan siang", "buffet", "menu", "kuliner", "f&b", "dining", "soto", "nasi"],
  "sunset-grill": ["grill", "seafood", "bakar", "bbq", "barbecue", "ikan", "udang", "cumi", "kerapu", "kakap", "lobster", "kepiting"],
  dbar: ["bar", "lounge", "karaoke", "mocktail", "mocktails", "cocktail", "cocktails", "koktail"],
  "dragon-beach-club": ["dj", "party", "pesta", "beach club", "klub malam", "nightclub"],
  dspa: ["spa", "pijat", "massage", "yoga", "wellness", "relaksasi", "treatment", "refleksi"],
};
const FNB_CATEGORIES = new Set(["F&B & Kuliner", "F&B Hemat"]);
const GENERIC_VENUE_WORDS = new Set(
  "restaurant restoran resto dining cafe café kafe bistro grill bar lounge pub spa pool kolam renang beach pantai rooftop coffee shop main utama all day sunset the & and dan".split(" "),
);
const tokensOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
const phraseAt = (tokens: string[], phrase: string[]) =>
  phrase.length ? tokens.findIndex((_, i) => phrase.every((w, j) => tokens[i + j] === w)) : -1;

function venueWords(venueName: string, hotelName: string): string[] {
  const hotel = new Set(tokensOf(hotelName));
  return tokensOf(venueName).filter((w) => !hotel.has(w));
}

function venueNamed(words: string[], titleTokens: string[]): boolean {
  const distinctive = words.filter((w) => !GENERIC_VENUE_WORDS.has(w));
  return distinctive.length ? distinctive.every((w) => titleTokens.includes(w)) : phraseAt(titleTokens, words) >= 0;
}

function categoryOutlets(category: string | undefined, lodging: boolean): OutletKey[] {
  if (category && FNB_CATEGORIES.has(category)) return lodging ? ["dbistro"] : ["sunset-grill", "dbistro"];
  if (category === "Acara & Live Music") return ["dragon-beach-club", "dbar"];
  if (category === "Wellness & Relaksasi") return ["dspa"];
  return ["resort"];
}

function outletsInOrder(outlets: Iterable<string>): OutletKey[] {
  const set = new Set(outlets);
  return OUTLET_KEYS.filter((k) => set.has(k));
}

/**
 * Menentukan outlet Sanghyang yang relevan untuk promo kompetitor (nama venue di judul -> kata kunci -> kategori),
 * setara 100% dengan `promoOutlets()` di `lib/market/outlet-filters.ts`.
 */
export function promoOutletsFor(p: SnRadarPromo): OutletKey[] {
  if (p.outlet && isOutletKey(p.outlet)) return [p.outlet];
  if (!Array.isArray(p.competitorOutlets) || p.competitorOutlets.length === 0) return [];
  let tokens = tokensOf(p.title);
  const hotelTokens = tokensOf(p.competitorName);
  const hotelAt = phraseAt(tokens, hotelTokens);
  if (hotelAt >= 0) tokens = [...tokens.slice(0, hotelAt), ...tokens.slice(hotelAt + hotelTokens.length)];

  const venueOutlets = new Set<string>();
  for (const venue of p.competitorVenues ?? []) {
    const words = venueWords(venue.name, p.competitorName);
    if (!venueNamed(words, tokens)) continue;
    venue.outlets.forEach((o) => venueOutlets.add(o));
    tokens = tokens.filter((w) => !words.includes(w));
  }
  const keywords = OUTLET_KEYS.filter((k) => PROMO_KEYWORDS[k].some((kw) => phraseAt(tokens, kw.split(" ")) >= 0));

  if (p.competitorIsLodging) {
    if (venueOutlets.size > 0) {
      const atVenue = keywords.filter((k) => venueOutlets.has(k));
      if (atVenue.length > 0) return outletsInOrder([...atVenue, ...keywords.filter((k) => k === "resort")]);
      return keywords.length > 0 ? keywords : outletsInOrder(venueOutlets);
    }
    return keywords.length > 0 ? keywords : categoryOutlets(p.category, true);
  }
  const registry = outletsInOrder(p.competitorOutlets);
  const wanted = keywords.length > 0 ? keywords : categoryOutlets(p.category, false);
  const narrowed = registry.filter((k) => wanted.includes(k));
  return narrowed.length > 0 ? narrowed : registry;
}

export function promoMatchesOutletKey(p: SnRadarPromo, outlet: string): boolean {
  if (outlet === "all") return true;
  if (!isOutletKey(outlet)) return false;
  return promoOutletsFor(p).includes(outlet);
}

/** Promo Sanghyang sendiri mengikuti baris outlet asalnya di basis data (`competitorOutlets`), tanpa menebak judul. */
export function ownPromoMatchesOutletKey(p: SnRadarPromo, outlet: string): boolean {
  if (outlet === "all") return true;
  if (p.outlet && p.outlet === outlet) return true;
  return Array.isArray(p.competitorOutlets) && p.competitorOutlets.includes(outlet);
}

/** Ringkasan asal promo/event Sanghyang: "Situs resmi X · Instagram Y · TikTok Z". */
export function ownPromoSourceSummary(items: readonly Pick<SnRadarPromo, "platform">[]): string {
  const count = (plat: string) => items.filter((p) => p.platform === plat).length;
  const base: [string, string][] = [
    ["website", "Situs resmi"],
    ["instagram", "Instagram"],
    ["tiktok", "TikTok"],
  ];
  const parts = base.map(([plat, label]) => (count(plat) > 0 ? `${label} ${count(plat)}` : `${label} belum ada data`));
  if (count("facebook") > 0) parts.push(`Facebook ${count("facebook")}`);
  return parts.join(" · ");
}

const OWN_PROPERTY = /sanghyang indah spa resort/giu;
const COUNTER_MENTIONS: Record<Exclude<OutletKey, "resort">, RegExp> = {
  "sunset-grill": /(?<![\p{L}\p{N}])sunset grill(?![\p{L}\p{N}])/iu,
  "dragon-beach-club": /(?<![\p{L}\p{N}])dragon beach club(?![\p{L}\p{N}])/iu,
  dbistro: /(?<![\p{L}\p{N}])d['’]?\s?bistro(?![\p{L}\p{N}])/iu,
  dbar: /(?<![\p{L}\p{N}])(d['’]?\s?bar|karaoke)(?![\p{L}\p{N}])/iu,
  dspa: /(?<![\p{L}\p{N}])(d['’]?\s?spa|spa|hot spring|aquamedic)(?![\p{L}\p{N}])/iu,
};

/** Menyembunyikan usulan "Versi kita" bila menyebut nama outlet Sanghyang lain (setara lib/market/outlet-filters.ts). */
export function counterStrategyFor(p: { counterStrategy?: string }, outlet: string): string | null {
  const text = p.counterStrategy?.trim();
  if (!text) return null;
  if (!isOutletKey(outlet) || outlet === "resort") return text;
  const about = text.replace(OWN_PROPERTY, "");
  const named = (Object.keys(COUNTER_MENTIONS) as (keyof typeof COUNTER_MENTIONS)[]).filter((k) => COUNTER_MENTIONS[k].test(about));
  return named.length === 0 || named.includes(outlet) ? text : null;
}

const PROMO_STATUS_ORDER: Record<string, number> = { active: 0, upcoming: 1, expired: 2 };

export function groupPromosByCompetitor<T extends SnRadarPromo>(list: readonly T[]): {
  competitorName: string;
  handle: string;
  roadKm: number | null;
  activeCount: number;
  promos: T[];
}[] {
  const groups = new Map<string, T[]>();
  for (const p of list) {
    const arr = groups.get(p.competitorName) ?? [];
    arr.push(p);
    groups.set(p.competitorName, arr);
  }
  return [...groups.entries()]
    .map(([competitorName, promos]) => {
      const sorted = [...promos].sort(
        (a, b) =>
          (PROMO_STATUS_ORDER[a.status] ?? 9) - (PROMO_STATUS_ORDER[b.status] ?? 9) ||
          b.startsAt.localeCompare(a.startsAt),
      );
      return {
        competitorName,
        handle: sorted.find((p) => p.competitorHandle || p.handle)?.competitorHandle ?? sorted[0]?.handle ?? "",
        roadKm: sorted[0]?.competitorRoadKm ?? null,
        activeCount: sorted.filter((p) => p.status === "active").length,
        promos: sorted,
      };
    })
    .sort((a, b) => b.activeCount - a.activeCount || a.competitorName.localeCompare(b.competitorName, "id"));
}

/** Klasifikasi kanal ulasan yang sadar penyedia OTA dinamis dari summary API. */
export function channelFromSource(
  source: string,
  dynamicOtaProviders?: Iterable<string>,
): "google" | "ota" | "social" | "website" {
  const s = source.toLowerCase();
  if (s.includes("google") || s.includes("maps")) return "google";
  if (s.includes("instagram") || s.includes("tiktok") || s.includes("facebook") || s.includes("sosmed")) return "social";
  if (dynamicOtaProviders) {
    for (const p of dynamicOtaProviders) {
      if (p && s.includes(p.toLowerCase())) return "ota";
    }
  }
  if (/(agoda|traveloka|booking\.com|tiket\.com|trip\.com|tripadvisor|expedia|hotels\.com|klook|pegipegi|trivago|ota)/i.test(s)) {
    return "ota";
  }
  return "website";
}

export function postDayWib(isoOrDay: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDay)) return isoOrDay;
  const d = new Date(isoOrDay);
  if (Number.isNaN(d.getTime())) return isoOrDay.slice(0, 10);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(d)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const PROMOTION_TYPES = [
  "kerja_sama_mitra",
  "program_member",
  "kontes_hadiah",
  "potongan_harga",
  "bonus_tambahan",
  "paket_bundling",
  "harga_spesial",
  "produk_baru",
  "brand_awareness",
] as const;

export type PromotionTypeKey = (typeof PROMOTION_TYPES)[number];

/** Kunci dan definisi kategori promosi identik dengan `src/lib/market/promo-type.ts`. */
export const PROMOTION_TYPE_INFO: Record<PromotionTypeKey, { label: string; definition: string }> = {
  kerja_sama_mitra: {
    label: "Kerja sama mitra",
    definition: "Manfaatnya hanya berlaku lewat mitra: bank, kartu kredit, dompet digital, aplikasi, atau merek lain.",
  },
  program_member: {
    label: "Program member",
    definition: "Hanya untuk anggota, pemegang poin, tamu langganan, atau lewat referral.",
  },
  kontes_hadiah: {
    label: "Kontes & hadiah",
    definition: "Giveaway, kuis, undian, atau lomba berhadiah untuk mendorong interaksi.",
  },
  potongan_harga: {
    label: "Potongan harga",
    definition: "Harga dipotong dari harga normal yang tertulis: persen, nominal, harga coret, early bird, last minute, flash sale.",
  },
  bonus_tambahan: {
    label: "Bonus tambahan",
    definition: "Tambahan tanpa biaya saat membeli: beli 1 gratis 1, gratis upgrade, anak gratis, malam gratis, welcome drink gratis.",
  },
  paket_bundling: {
    label: "Paket bundling",
    definition: "Beberapa layanan yang biasanya dijual terpisah ditawarkan sebagai satu paket berharga tunggal, mis. kamar + makan malam atau paket rapat.",
  },
  harga_spesial: {
    label: "Harga spesial",
    definition: "Harga yang disebut promo, spesial, hemat, atau terbatas waktu, tanpa pembanding harga normal.",
  },
  produk_baru: {
    label: "Produk baru",
    definition: "Mengumumkan menu, layanan, atau fasilitas yang baru diluncurkan.",
  },
  brand_awareness: {
    label: "Brand awareness",
    definition:
      "Memperkenalkan fasilitas, suasana, atau pengalaman tanpa insentif harga; harga biasa boleh tercantum, tetapi tidak ada potongan, bonus, atau sebutan promo.",
  },
};

export function isPromotionType(value: unknown): value is PromotionTypeKey {
  return typeof value === "string" && (PROMOTION_TYPES as readonly string[]).includes(value);
}

export function promotionTypeLabel(code: string | null | undefined): string {
  return isPromotionType(code) ? PROMOTION_TYPE_INFO[code].label : "belum ada data";
}

export const MIN_REVIEWS_FOR_VERDICT = 5;

export function sentimentVerdict(
  positive: number,
  total: number,
  negative: number,
): { pct: number | null; tone: "good" | "warn" | "bad" | "neutral"; label: string; sentence: string } {
  if (total < MIN_REVIEWS_FOR_VERDICT) {
    return {
      pct: total > 0 ? Math.round((positive / total) * 100) : null,
      tone: "neutral",
      label: "Belum bisa disimpulkan",
      sentence:
        total === 0
          ? "Belum ada ulasan tercatat pada periode terpilih."
          : `Baru ada ${total} ulasan pada periode ini (minimal ${MIN_REVIEWS_FOR_VERDICT} untuk menyimpulkan tren).`,
    };
  }
  const posPct = Math.round((positive / total) * 100);
  const negPct = Math.round((negative / total) * 100);
  const neuPct = Math.max(0, 100 - posPct - negPct);
  const sentence = `${posPct} dari 100 ulasan memuji kita, ${neuPct} dari 100 netral dan ${negPct} dari 100 berisi keluhan.`;
  if (negPct >= 20 || posPct < 40) return { pct: posPct, tone: "bad", label: "Perlu tindakan", sentence };
  if (negPct >= 10 || posPct < 70) return { pct: posPct, tone: "warn", label: "Perlu diperhatikan", sentence };
  return { pct: posPct, tone: "good", label: "Baik", sentence };
}

/** Menormalkan rasio aspek: API mengirim persen 0..100, sementara sebagian pemanggil menguji pecahan 0..1. */
const toAspectPercent = (value: number): number => (value > 0 && value <= 1 ? value * 100 : value);

export function aspectHighlights(
  topAspects: { aspect: string; count: number; positiveRatio: number; negativeRatio: number }[] | undefined,
  totalReviews: number,
): { praised: string[]; complaints: string[] } {
  if (!topAspects || totalReviews < MIN_REVIEWS_FOR_VERDICT) return { praised: [], complaints: [] };
  const praised = topAspects
    .filter((a) => a.count >= 2 && toAspectPercent(a.positiveRatio) >= 60)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((a) => `${a.aspect} (${a.count} ulasan)`);
  const complaints = topAspects
    .filter((a) => a.count >= 2 && toAspectPercent(a.negativeRatio) >= 30)
    .sort((a, b) => toAspectPercent(b.negativeRatio) * b.count - toAspectPercent(a.negativeRatio) * a.count)
    .slice(0, 3)
    .map((a) => `${a.aspect} (${a.count} ulasan)`);
  return { praised, complaints };
}

export function priceVerdict(index: number | null | undefined): { tone: "good" | "warn" | "bad" | "neutral"; label: string; sentence: string } {
  if (index === null || index === undefined) {
    return { tone: "neutral", label: "Belum ada data", sentence: "Indeks posisi harga belum tersedia untuk outlet ini." };
  }
  if (index > 110) return { tone: "bad", label: "Lebih mahal dari pasar", sentence: `Harga kita sekitar ${Math.round(index - 100)}% di atas rata-rata kompetitor.` };
  if (index < 90) return { tone: "warn", label: "Lebih murah dari pasar", sentence: `Harga kita sekitar ${Math.round(100 - index)}% di bawah rata-rata kompetitor.` };
  return { tone: "good", label: "Wajar / seimbang", sentence: `Indeks harga ${index} berada di koridor wajar terhadap rata-rata kompetitor (100).` };
}

export interface SnVerifiedFeedbackResult {
  total: number;
  windowMonths: number;
  complaints: SnOutletReview[];
  praises: SnOutletReview[];
}

/** Mengelompokkan ulasan terverifikasi menjadi keluhan nyata (rating <= 3) dan pujian nyata (rating >= 4). */
export function verifiedFeedback(
  reviews: readonly SnOutletReview[],
  windowMonths = 24,
): SnVerifiedFeedbackResult {
  const newestFirst = [...reviews].sort((a, b) => b.reviewDate.localeCompare(a.reviewDate));
  return {
    total: newestFirst.length,
    windowMonths,
    complaints: newestFirst.filter((r) => (r.rating > 0 ? r.rating <= 3 : r.sentiment === "negative")),
    praises: newestFirst.filter((r) => (r.rating > 0 ? r.rating >= 4 : r.sentiment === "positive")),
  };
}

export interface SnReputationSnapshot {
  sanghyang: number;
  peers: { name: string; rating: number }[];
  median: number;
  rank: number;
  total: number;
  meetsMedian: boolean;
}

function numericMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Menghitung posisi rating Google Sanghyang dibanding kompetitor inti penginapan (untuk Strategy Resort). */
export function computeResortReputation(summary: SnSummary): SnReputationSnapshot | null {
  const resortOutlet = summary.outlets.find((o) => o.key === "resort");
  const sanghyang = summary.sanghyang?.rating ?? resortOutlet?.rating ?? null;
  if (sanghyang === null) return null;

  const coreRivals = (summary.compsetAudit?.resort?.used ?? []).filter((r) => r.compsetRole !== "benchmark");
  const ratingByName = new Map(
    (summary.competitorRatings ?? [])
      .filter((r): r is { name: string; rating: number } => typeof r.rating === "number")
      .map((r) => [r.name, r.rating]),
  );

  const peers = coreRivals
    .map((r) => ({ name: r.name, rating: typeof r.rating === "number" ? r.rating : (ratingByName.get(r.name) ?? null) }))
    .filter((p): p is { name: string; rating: number } => p.rating !== null)
    .sort((a, b) => b.rating - a.rating);

  if (peers.length < 2) return null;
  const median = Number(numericMedian(peers.map((p) => p.rating)).toFixed(2));
  return {
    sanghyang,
    peers,
    median,
    rank: peers.filter((p) => p.rating > sanghyang).length + 1,
    total: peers.length + 1,
    meetsMedian: sanghyang >= median,
  };
}

export function activeRoomPromos(promos: readonly SnRadarPromo[]): SnRadarPromo[] {
  const dedup = new Map<string, SnRadarPromo>();
  for (const p of promos) {
    if (p.isOwn || p.status !== "active") continue;
    if (p.category === "Kamar & Menginap" || promoMatchesOutletKey(p, "resort")) {
      const key = `${p.competitorName}|${p.title}`;
      if (!dedup.has(key)) dedup.set(key, p);
    }
  }
  return [...dedup.values()];
}

export function deepestCompetitorDiscount(promos: readonly SnRadarPromo[]): number | null {
  const discounts = activeRoomPromos(promos)
    .map((p) => (typeof p.discount === "number" ? p.discount : null))
    .filter((d): d is number => d !== null && d > 0);
  return discounts.length > 0 ? Math.max(...discounts) : null;
}

export interface SnOutletActionItem {
  factor: "Operasional" | "Kata tamu" | "Rating" | "Harga" | "Pasar" | "Promo Sanghyang" | "Promo kompetitor" | "Berita";
  finding: string;
  action: string;
}

function formatInternalGrowth(momGrowthPct: number): string {
  if (momGrowthPct > 100) {
    const mult = (1 + momGrowthPct / 100).toLocaleString("id-ID", { maximumFractionDigits: 1 });
    return `naik ${mult}x dibanding periode setara bulan lalu`;
  }
  if (momGrowthPct < 0) {
    return `turun ${Math.abs(Math.round(momGrowthPct))}% dibanding periode setara bulan lalu`;
  }
  return `naik ${Math.round(momGrowthPct)}% dibanding periode setara bulan lalu`;
}

function formatInternalTarget(achievedPct: number, scope: "outlet" | "gabungan_dbar_dbc"): string {
  const scopeLabel = scope === "gabungan_dbar_dbc" ? "target gabungan d'Bar & DBC" : "target bulanan";
  if (achievedPct > 100) return `${scopeLabel} telah terlampaui (di atas 100%)`;
  return `capaian ${Math.round(achievedPct)}% dari ${scopeLabel}`;
}

/**
 * Rekomendasi strategis dari semua faktor per outlet (setara `lib/market/outlet-action-plan.ts`),
 * diturunkan 100% dari data summary + sinyal operasional VHP bebas rupiah tanpa angka target atau omset karangan.
 */
export function buildOutletActionPlan(summary: SnSummary, outletKey: string): SnOutletActionItem[] {
  const plan: SnOutletActionItem[] = [];
  const outlet = summary.outlets.find((o) => o.key === outletKey);
  const outletName = outlet?.name ?? OUTLET_LABELS[outletKey] ?? outletKey;
  const rivals = summary.compsetAudit?.[outletKey]?.used ?? [];

  const sig: InternalOutletSignals | undefined = isOutletKey(outletKey) ? summary.internalSignals?.[outletKey] : undefined;
  if (sig?.performance) {
    const perf = sig.performance;
    const parts: string[] = [];
    if (perf.targetAchievementPct !== null) parts.push(formatInternalTarget(perf.targetAchievementPct, perf.targetScope));
    if (perf.momGrowthPct !== null) parts.push(formatInternalGrowth(perf.momGrowthPct));
    if (perf.contributionSharePct !== null) parts.push(`menyumbang ${Math.round(perf.contributionSharePct)}% total 6 outlet`);
    if (perf.dbarPartSharePct != null) parts.push(`porsi ${Math.round(perf.dbarPartSharePct)}% di gabungan d'Bar & DBC`);
    if (parts.length > 0) {
      plan.push({
        factor: "Operasional",
        finding: `Sinyal VHP ${outletName} (s.d. ${perf.dataThrough}): ${parts.join(", ")}.`,
        action:
          perf.status === "tertinggal" || (perf.momGrowthPct !== null && perf.momGrowthPct < 0)
            ? `Fokuskan promo bernilai tambah dan dorong kunjungan hari biasa untuk mempercepat laju capaian ${outletName} tanpa memotong harga bersih di bawah P25.`
            : `Pertahankan ritme operasional ${outletName} dan arahkan penjualan silang ke outlet Sanghyang lain yang lajunya masih tertinggal.`,
      });
    }
  }
  const resortOccPct = sig?.resortStay?.occPct;
  if (sig?.resortStay && resortOccPct !== null && resortOccPct !== undefined) {
    const stay = sig.resortStay;
    const topRoom = stay.roomTypesByShare[0];
    const lowRoom = stay.roomTypesByShare.length > 1 ? stay.roomTypesByShare[stay.roomTypesByShare.length - 1] : null;
    plan.push({
      factor: "Operasional",
      finding: `Okupansi VHP ${Math.round(resortOccPct)}% (${stay.nightsObserved} malam${stay.tpkGapPts !== null ? `, selisih ${stay.tpkGapPts >= 0 ? "+" : ""}${Math.round(stay.tpkGapPts)} poin vs TPK BPS` : ""}); segmen OTA ${Math.round(stay.segmentMixPct.ota)}%, Walk-In ${Math.round(stay.segmentMixPct.walkIn)}%, FIT ${Math.round(stay.segmentMixPct.fit)}%${topRoom && lowRoom ? `; terpadat ${topRoom.name}, terendah ${lowRoom.name}` : ""}.`,
      action:
        stay.segmentMixPct.ota >= 50
          ? `Kurangi ketergantungan OTA dengan paket reservasi langsung hari biasa (nilai tambah sarapan/Hot Spring Aquamedic) khusus tipe kamar berokupansi rendah${lowRoom ? ` (${lowRoom.name})` : ""}.`
          : `Jaga bauran tamu langsung dan korporat sambil mempertahankan disiplin lantai harga P25 di seluruh kanal OTA.`,
    });
  }
  if (sig?.menuHealth && (sig.menuHealth.slowMenuCount > 0 || sig.menuHealth.deadMenuCount > 0 || sig.menuHealth.topMenus.length > 0)) {
    const mh = sig.menuHealth;
    const top = mh.topMenus[0];
    const slowSample = mh.slowestSamples.slice(0, 2).map((m) => m.description).join(", ");
    plan.push({
      factor: "Operasional",
      finding: `Kasir POS VHP ${outletName} (90 hari terakhir): ${mh.slowMenuCount} menu lambat dan ${mh.deadMenuCount} menu mati${top ? `; menu terlaris ${top.description} (${Math.round(top.salesSharePct)}% porsi penjualan)` : ""}.`,
      action:
        mh.slowMenuCount > 0 || mh.deadMenuCount > 0
          ? `Evaluasi atau pangkas menu mati 90 hari, lalu paketkan menu lambat${slowSample ? ` (${slowSample})` : ""} bersama menu terlaris agar perputaran bahan lebih efisien.`
          : `Pertahankan ketersediaan bahan menu terlaris dan jadikan andalan konten promosi bulanan.`,
    });
  }
  if (sig?.promoAudit && sig.promoAudit.totalAudited > 0) {
    const pa = sig.promoAudit;
    plan.push({
      factor: "Operasional",
      finding: `Audit Promo kasir VHP ${outletName}: ${pa.naikCount} NAIK, ${pa.naikTipisCount} NAIK_TIPIS, dan ${pa.tidakNaikCount} TIDAK_NAIK dari ${pa.totalAudited} promo teraudit.`,
      action:
        pa.topLifts.length > 0
          ? `Ulangi format penawaran yang terbukti NAIK (${pa.topLifts[0].keyword}) dan hentikan mekanisme promo yang tidak menggerakkan porsi.`
          : `Tinjau ulang penawaran dan visibilitas promo di kasir karena belum terlihat kenaikan porsi yang jelas dalam 7 hari setelah tayang.`,
    });
  }
  if (sig?.acquisition && (sig.acquisition.waClosingCount > 0 || sig.acquisition.waClosingRatePct !== null)) {
    const acq = sig.acquisition;
    plan.push({
      factor: "Operasional",
      finding: `Akuisisi WhatsApp ${outletName}: ${acq.waClosingCount} closing tercatat${acq.waClosingRatePct !== null ? ` (closing rate ${Math.round(acq.waClosingRatePct)}%)` : ""}.`,
      action: `Percepat waktu respons CS WhatsApp dan sertakan rincian fasilitas serta tarif resmi agar tingkat closing reservasi langsung meningkat.`,
    });
  }

  const aspects = (outlet?.topAspects ?? []).filter((a) => a.count >= 2);
  const complaint = [...aspects].sort((a, b) => toAspectPercent(b.negativeRatio) - toAspectPercent(a.negativeRatio))[0];
  const praise = [...aspects].sort((a, b) => toAspectPercent(b.positiveRatio) - toAspectPercent(a.positiveRatio))[0];
  if (complaint && toAspectPercent(complaint.negativeRatio) >= 30) {
    plan.push({
      factor: "Kata tamu",
      finding: `Aspek yang paling sering dikeluhkan: ${complaint.aspect} (${Math.round(toAspectPercent(complaint.negativeRatio))}% dari ${complaint.count} ulasan bernada negatif).`,
      action: `Perbaiki ${complaint.aspect} lebih dulu, lalu balas ulasan yang menyebutnya supaya calon tamu melihat tindak lanjutnya.`,
    });
  }
  if (praise && toAspectPercent(praise.positiveRatio) > 0) {
    plan.push({
      factor: "Kata tamu",
      finding: `Aspek yang paling dipuji: ${praise.aspect} (${Math.round(toAspectPercent(praise.positiveRatio))}% dari ${praise.count} ulasan bernada positif).`,
      action: `Jadikan ${praise.aspect} pesan utama di konten dan materi promosi bulan ini.`,
    });
  }
  if (!complaint && !praise) {
    const reviewCount = outlet?.sentimentDistribution?.total || outlet?.reviewCount || 0;
    plan.push({
      factor: "Kata tamu",
      finding: `Ulasan terverifikasi ${outletName} baru ${reviewCount}, belum cukup untuk membaca pola keluhan dan pujian.`,
      action: "Minta ulasan Google dari tamu yang puas, misalnya lewat kartu QR di meja atau kasir.",
    });
  }
  if (outlet?.channelBreakdown?.social && outlet.channelBreakdown.social.count > 0) {
    plan.push({
      factor: "Kata tamu",
      finding: `${outlet.channelBreakdown.social.count} komentar media sosial terdata untuk ${outletName} (${outlet.channelBreakdown.social.positiveRatio ?? 0}% bernada positif).`,
      action: "Tanggapi komentar publik dengan ramah dan arahkan pertanyaan fasilitas ke kanal WhatsApp resmi.",
    });
  }

  const ratingByName = new Map(
    (summary.competitorRatings ?? [])
      .filter((r): r is { name: string; rating: number } => typeof r.rating === "number")
      .map((r) => [r.name, r.rating]),
  );
  const rivalRatings = rivals
    .map((c) => (typeof c.rating === "number" ? c.rating : (ratingByName.get(c.name) ?? null)))
    .filter((r): r is number => r !== null);
  if (outlet?.rating != null && rivalRatings.length > 0) {
    const mid = numericMedian(rivalRatings);
    const fmtDec = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    plan.push({
      factor: "Rating",
      finding: `Rating Google ${fmtDec(outlet.rating)} dibanding median kompetitor ${fmtDec(mid)} (${rivalRatings.length} kompetitor).`,
      action:
        outlet.rating < mid
          ? "Tutup selisih rating: tanggapi keluhan terbanyak dan minta ulasan dari tamu yang puas."
          : "Rating sudah di atas median kompetitor; tampilkan di materi promosi dan halaman pemesanan.",
    });
  }

  if (outletKey === "resort") {
    const market = summary.outletMarketShare?.resort;
    if (market?.marketSharePercentage != null) {
      plan.push({
        factor: "Pasar",
        finding: `Perkiraan pangsa pasar kamar ${market.marketSharePercentage.toLocaleString("id-ID")}% (${market.marketRank}).`,
        action: "Kejar okupansi hari biasa lewat paket menginap yang menonjolkan fasilitas khas dan pemesanan langsung di situs resmi.",
      });
    }
  } else {
    const ranges = rivals
      .map((c) => summary.competitorMenus?.[c.name]?.range)
      .filter((r): r is { min: number; max: number } => Boolean(r));
    if (ranges.length > 0) {
      const low = Math.min(...ranges.map((r) => r.min));
      const high = Math.max(...ranges.map((r) => r.max));
      const ownMatrix = summary.competitorMatrix?.[outletKey]?.fnbEntries?.find((e) => e.role === "sanghyang");
      const ownText = ownMatrix?.menuPriceRange
        ? ` Menu resmi ${outletName}: ${fmtRupiah(ownMatrix.menuPriceRange.min)}–${fmtRupiah(ownMatrix.menuPriceRange.max)}.`
        : "";
      plan.push({
        factor: "Harga",
        finding: `${ranges.length} dari ${rivals.length} kompetitor punya harga per porsi: ${fmtRupiah(low)}–${fmtRupiah(high)}.${ownText}`,
        action: !ownMatrix?.menuPriceRange
          ? `Cantumkan daftar harga resmi ${outletName} di situs supaya bisa dibandingkan dengan kompetitor.`
          : ownMatrix.menuPriceRange.max > high
            ? "Harga tertinggi Sanghyang di atas semua kompetitor; tonjolkan alasan nilainya (lokasi, porsi, bahan) atau siapkan paket hemat."
            : "Harga Sanghyang masih di dalam rentang kompetitor; bandingkan item yang sama sebelum mengubah harga.",
      });
    }
  }

  const ownLive = (summary.ownPromos ?? []).filter(
    (p) => ownPromoMatchesOutletKey(p, outletKey) && p.status !== "expired",
  );
  const ownEventCount = ownLive.filter((p) => isPromoEvent(p)).length;
  plan.push(
    ownLive.length > 0
      ? {
          factor: "Promo Sanghyang",
          finding: `${ownLive.length - ownEventCount} promo dan ${ownEventCount} event Sanghyang berjalan untuk ${outletName} (sumber: ${ownPromoSourceSummary(ownLive)}).`,
          action: "Pastikan promo yang berjalan tampil sama di situs resmi dan media sosial, lalu bandingkan nilainya dengan promo kompetitor di bagian Radar Promo.",
        }
      : {
          factor: "Promo Sanghyang",
          finding: `Belum ada promo atau event Sanghyang yang berjalan untuk ${outletName} di situs resmi maupun media sosial pada periode ini.`,
          action: "Siapkan satu penawaran yang bisa diumumkan bersamaan di situs resmi dan media sosial outlet ini.",
        },
  );

  const rivalLive = (summary.competitorSocialRadar ?? []).filter(
    (p) => !p.isOwn && p.status !== "expired" && promoMatchesOutletKey(p, outletKey),
  );
  const rivalEventCount = rivalLive.filter((p) => isPromoEvent(p)).length;
  const rivalNames = [...new Set(rivalLive.map((p) => p.competitorName))];
  plan.push(
    rivalLive.length > 0
      ? {
          factor: "Promo kompetitor",
          finding: `${rivalLive.length - rivalEventCount} promo dan ${rivalEventCount} event kompetitor berjalan, antara lain dari ${rivalNames.slice(0, 3).join(", ")}.`,
          action: "Siapkan tanggapan di bagian Radar Promo: tawarkan nilai tambah yang tidak dimiliki kompetitor, bukan sekadar potongan harga.",
        }
      : {
          factor: "Promo kompetitor",
          finding: "Belum ada promo atau event kompetitor yang tertangkap untuk outlet ini di periode ini.",
          action: `Manfaatkan jeda ini untuk kampanye ${outletName} sendiri.`,
        },
  );

  for (const n of (summary.news ?? []).filter((item) => item.outlets.includes(outletKey)).slice(0, 2)) {
    plan.push({
      factor: "Berita",
      finding: `Berita terkait: "${n.title}" (${n.source}).`,
      action: `Kaitkan konten minggu ini dengan topik ini bila relevan untuk tamu ${outletName}.`,
    });
  }

  return plan;
}
