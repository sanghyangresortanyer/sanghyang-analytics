/**
 * Tipe dan aturan murni benchmark harga yang aman dipakai komponen klien.
 * Data omset ada di pricing-benchmark.ts dan hanya boleh sampai ke browser lewat API yang wajib login,
 * karena file JS di _next/static bisa diambil tanpa login.
 */

export type CompetitorAuditStatus = "APPROVED" | "BENCHMARK" | "NEEDS_REVIEW" | "REJECTED";

/** Ambang skor Master Prompt. NEEDS_REVIEW khusus entri agregat (bukan satu properti). */
export const AUDIT_SCORE_THRESHOLDS = { approved: 80, benchmark: 60 } as const;

export function auditStatusFromScore(score: number): CompetitorAuditStatus {
  if (score >= AUDIT_SCORE_THRESHOLDS.approved) return "APPROVED";
  if (score >= AUDIT_SCORE_THRESHOLDS.benchmark) return "BENCHMARK";
  return "REJECTED";
}

export interface BenchmarkCompetitorItem {
  name: string;
  handle?: string;
  estimatedRevenue?: number | null;
  estimatedMarketShare?: number | null;
  priceLevel: string;
  relevanceScore?: number | null;
  auditStatus?: CompetitorAuditStatus;
  auditRationale?: string;
  evidenceSource?: string;
  evidenceSourceUrl?: string;
  starRating?: number;
  cluster?: "KLASTER_I_BINTANG_4" | "KLASTER_II_BINTANG_5";
  /** Peran di registri pesaing: inti dihitung, acuan hanya ditampilkan. */
  compsetRole?: "inti" | "benchmark";
  /** Jarak tempuh mobil dari Sanghyang (Google Maps). */
  roadKm?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  websiteUrl?: string | null;
  mapsUrl?: string | null;
}

export interface MenuItemComparison {
  itemName: string;
  category: string;
  sanghyangPrice: number;
  competitorPrices: {
    competitorName: string;
    price: number;
    differencePercent: number;
    note?: string;
  }[];
  portionValueNote: string;
}

export interface OutletMarketShareData {
  outletKey: string;
  outletName: string;
  activeMonth: string;
  /** Selalu null di modul statis (Zero Hardcode) dan dihapus seluruhnya sebelum keluar di /api/market-intelligence/summary. */
  revenueActual: null;
  totalMarketSizeEstimated: number | null;
  marketSegmentName: string;
  marketSharePercentage: number | null;
  marketRank: string;
  /** null bila harga pesaing yang bersumber belum ada (semua outlet F&B saat ini). */
  pricePositioningIndex: number | null;
  pricePositioningCategory: "Value-Leader" | "Competitive-Mid" | "Premium-Luxury" | null;
  benchmarkCompetitors: BenchmarkCompetitorItem[];
  menuPriceItems: MenuItemComparison[];
  digitalMarketingStrategy: {
    pricingOptimization: {
      title: string;
      currentAnalysis: string;
      recommendation: string;
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
    financialProjection: {
      /** null bila tidak ada dasar angka (biaya program dan omset outlet belum diketahui). */
      targetRevenueLiftPercent: number | null;
      projectedMonthlyRevenue: number | null;
      projectedMarketShare: number | null;
      /** Hanya diisi bila biaya program diketahui; resort memakai batas aman okupansi sebagai gantinya. */
      paybackPeriodWeeks?: number;
      /** Penurunan okupansi maksimal (persen) sebelum omset turun akibat kenaikan harga. */
      breakEvenOccupancyDropPercent?: number;
    };
  };
}

/** Kategori posisi harga dari indeks harga (100 = setara kompetitor). */
export const pricePositionCategory = (index: number): NonNullable<OutletMarketShareData["pricePositioningCategory"]> =>
  index > 110 ? "Premium-Luxury" : index < 90 ? "Value-Leader" : "Competitive-Mid";

