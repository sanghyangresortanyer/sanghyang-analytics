/**
 * Kontrak struktur laporan PDF Insight Pasar Sanghyang (format ringkas 3 poin per outlet):
 * - Sampul dan KPI, lalu "1. Ulasan Terbaru" dibanding periode sebelumnya yang setara (portrait).
 * - "2. Ringkasan Kompetitor": baris ringkasan tanpa kolom Audit pembanding, ditambah tarif termurah hari biasa dan
 *   akhir pekan (Kamar & Resort) atau perbandingan item sebanding (F&B, bar, spa) (landscape).
 * - "3. Promo & Event Berjalan": promo dan event dipisah untuk Sanghyang dan kompetitor (portrait).
 */
import type { OutletCompetitorMatrix } from "../market/competitor-matrix";
import type { OutletKey } from "../market/outlet-filters";
import type { PromoPlatform } from "../market/promo-radar";
import type { PromotionTypeKey } from "../market/promo-type";

export const NO_DATA = "Belum ada data";

export interface ReportSource {
  label: string;
  /** null untuk sumber tanpa tautan publik, misalnya impor pembukuan pemilik. */
  url: string | null;
}

export interface ReportTable {
  head: string[];
  rows: string[][];
}

export interface ReportSubsection {
  title: string;
  paragraphs: string[];
  bullets: string[];
  table: ReportTable | null;
  sources: ReportSource[];
}

export interface PlaceSection {
  number: number;
  name: string;
  role: "sanghyang" | "inti" | "acuan";
  subtitle: string;
  identity: { label: string; value: string }[];
  subsections: ReportSubsection[];
}

export interface ReportMatrix {
  title: string;
  intro: string;
  table: ReportTable;
  note: string;
  /** Keterangan jendela tanggal tarif 14 malam yang dihitung dinamis. */
  ratesWindowNote?: string;
  /** Sumber kebenaran matriks untuk render tabel ringkasan dan perbandingan tarif/item di PDF. */
  competitorMatrix?: OutletCompetitorMatrix;
}

export interface ReportKpiCard {
  label: string;
  value: string;
  sub: string;
}

export interface SentimentCounts {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
}

export interface ReportReviewQuote {
  rating: number;
  sentiment: "positive" | "neutral" | "negative";
  text: string;
  source: string;
  sourceUrl: string;
  reviewDate: string;
  themes: string[];
}

export interface ReportSocialStatus {
  accounts: string[];
  followersText: string | null;
  postsInPeriod: number;
  totalPostsRecorded: number;
  likesText: string | null;
  note: string;
}

export interface ReportReviewSection {
  periodLabel: string;
  periodDays: number;
  previousPeriodTitle: string;
  previousPeriodLabel: string;
  previousPeriodCompactLabel: string;
  current: SentimentCounts;
  previous: SentimentCounts;
  praises: ReportReviewQuote[];
  complaints: ReportReviewQuote[];
  topThemes: { theme: string; count: number }[];
  socialStatus: ReportSocialStatus;
  sources: ReportSource[];
}

export interface ReportPromoEntry {
  competitorName: string;
  isOwn: boolean;
  title: string;
  kind: "promo" | "event";
  category: string;
  /** Kategori yang dicetak di tabel event (kategori penyimpanan unggahan sosmed diganti jenis sumbernya). */
  categoryLabel: string;
  /** Kategori promosi (lib/market/promo-type.ts); null bila belum dibaca. */
  promotionType: PromotionTypeKey | null;
  /** Label kolom "Kategori Promosi"; null tertulis "belum ada data". */
  promotionTypeLabel: string;
  dateLabel: string;
  priceText: string | null;
  discount: number | null;
  sourceLabel: string;
  sourceUrl: string | null;
  platform: PromoPlatform;
  /** Tanggal mentah (ISO) untuk menelusuri kecocokan butir dengan periode terpilih. */
  startsAt: string;
  endsAt: string | null;
  capturedAt: string;
}

export interface ReportPromoSection {
  maxAgeDays: number;
  /** Promo penawaran resmi Sanghyang (kind = "promo"). */
  ownPromos: ReportPromoEntry[];
  /** Event & kegiatan resmi Sanghyang (kind = "event"). */
  ownEvents: ReportPromoEntry[];
  /** Promo kompetitor (kind = "promo"). */
  competitorPromos: ReportPromoEntry[];
  /** Event & kegiatan kompetitor (kind = "event"). */
  competitorEvents: ReportPromoEntry[];
  /** Butir yang tidak muat di batas cetak per kelompok; jumlahnya ditulis di PDF, daftar lengkap ada di web. */
  omitted: { ownPromos: number; ownEvents: number; competitorPromos: number; competitorEvents: number };
  /** Asal promo dan event Sanghyang per platform, mis. "Situs resmi 3 · Instagram 3 · TikTok belum ada data". */
  ownSourceSummary: string;
  note: string;
}

export interface OutletReportBody {
  outletKey: OutletKey;
  outletName: string;
  periodLabel: string;
  previousPeriodTitle: string;
  previousPeriodLabel: string;
  previousPeriodCompactLabel: string;
  kpis: ReportKpiCard[];
  reviews: ReportReviewSection;
  matrix: ReportMatrix;
  promos: ReportPromoSection;
}

/** Satu bab outlet di laporan "Semua Outlet" memakai struktur ringkas 3 poin yang sama. */
export interface ReportChapter {
  outletKey: string;
  title: string;
  intro: string;
  matrix: ReportMatrix;
  body: OutletReportBody;
  /** Kosong pada format ringkas (tanpa bab profil satu-per-satu kompetitor). */
  sections: PlaceSection[];
}

export interface MeetingReport {
  outletKey: string;
  outletName: string;
  title: string;
  subtitle: string;
  publishedAt: string;
  periodLabel?: string;
  previousPeriodTitle?: string;
  previousPeriodLabel?: string;
  previousPeriodCompactLabel?: string;
  from?: string;
  to?: string;
  coverage: string[];
  methodology: { label: string; text: string }[];
  structure: string[];
  matrix: ReportMatrix;
  /** Isi ringkas 3 poin untuk laporan satu outlet; undefined untuk "all" (memakai `chapters`). */
  outletBody?: OutletReportBody;
  /** Kosong pada format ringkas (tanpa bab profil satu-per-satu kompetitor). */
  sections: PlaceSection[];
  /** Hanya "Semua Outlet": enam bab outlet berurutan memakai format ringkas 3 poin. */
  chapters: ReportChapter[];
}
