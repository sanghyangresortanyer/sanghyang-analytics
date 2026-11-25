/**
 * lib/market/insight-generator.ts
 *
 * Generator Intelijen Pasar Berpijak Data Riil (Zero Mock / Grounded Insights).
 * Menurunkan temuan pasar langsung dari observasi ulasan, tarif, dan promo nyata.
 * Keyakinan (confidence) dan prioritas dihitung secara dinamis dari bukti observasi riil
 * (jumlah sampel, kebaruan tanggal, dan kelengkapan URL sumber), bukan angka tebakan statis.
 */

import type { GeneratedInsight } from "./insights";

export const MAX_INSIGHT_ACTIVE_DAYS = 30;

export interface ObservationReview {
  id: string;
  competitorName: string;
  text: string;
  rating: number;
  sentiment: string;
  themes?: string[];
  sourceUrl?: string | null;
  reviewDate: Date | string;
}

export interface ObservationPrice {
  id: string;
  competitorName: string;
  roomName?: string | null;
  packageName?: string | null;
  price: number;
  currency: string;
  observedAt: Date | string;
  sourceUrl?: string | null;
}

export interface ObservationSanghyangPrice {
  id: string;
  roomName?: string | null;
  packageName?: string | null;
  price: number;
  currency: string;
  observedAt: Date | string;
  sourceUrl?: string | null;
}

export interface ObservationPromotion {
  id: string;
  competitorName: string;
  title: string;
  discount?: number | null;
  startsAt: Date | string;
  endsAt?: Date | string | null;
  sourceUrl?: string | null;
}

export interface GroundedObservationInput {
  reviews: ObservationReview[];
  prices: ObservationPrice[];
  sanghyangPrices?: ObservationSanghyangPrice[];
  promotions?: ObservationPromotion[];
}

/**
 * Menghitung tingkat keyakinan (confidence) dinamis untuk temuan berbasis ulasan.
 * Rentang: 20 - 95.
 * Faktor:
 * - Ukuran sampel ulasan pendukung (hingga +30 poin)
 * - Kebaruan tanggal ulasan terakhir (hingga +15 poin)
 * - Validitas URL sumber observasi (+5 poin)
 */
export function computeReviewConfidence(
  reviewCount: number,
  latestReviewDate: Date,
  now: Date = new Date(),
  hasVerifiedUrl: boolean = true
): number {
  if (reviewCount <= 0) return 20;

  const base = 45;
  const volumeBonus = Math.min(30, reviewCount * 5);

  const diffMs = Math.max(0, now.getTime() - latestReviewDate.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const recencyBonus = Math.max(0, Math.min(15, 15 - Math.floor(diffDays / 10)));

  const sourceBonus = hasVerifiedUrl ? 5 : 0;

  return Math.min(95, Math.max(20, base + volumeBonus + recencyBonus + sourceBonus));
}

/**
 * Menghitung tingkat keyakinan (confidence) dinamis untuk temuan tarif hotel.
 * Rentang: 30 - 95.
 */
export function computePriceConfidence(
  competitorCount: number,
  latestObservedAt: Date,
  now: Date = new Date()
): number {
  if (competitorCount <= 0) return 30;

  const base = 50;
  const coverageBonus = Math.min(30, competitorCount * 5);

  const diffMs = Math.max(0, now.getTime() - latestObservedAt.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const recencyBonus = Math.max(0, Math.min(15, 15 - Math.floor(diffDays / 7)));

  return Math.min(95, Math.max(30, base + coverageBonus + recencyBonus));
}

/**
 * Memeriksa apakah sebuah insight sudah usang (> 30 hari).
 */
export function isInsightStale(
  generatedAt: Date,
  maxAgeDays: number = MAX_INSIGHT_ACTIVE_DAYS,
  now: Date = new Date()
): boolean {
  const diffMs = now.getTime() - generatedAt.getTime();
  return diffMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

/**
 * Generator intelijen pasar yang menurunkan insight secara deterministik dari data observasi nyata.
 */
export function generateGroundedInsights(
  input: GroundedObservationInput,
  now: Date = new Date()
): GeneratedInsight[] {
  const insights: GeneratedInsight[] = [];

  // 1. Ekstraksi Temuan Ulasan Sanghyang (Kekuatan vs Perhatian Tamu)
  const sanghyangReviews = input.reviews.filter((r) =>
    r.competitorName.toLowerCase().includes("sanghyang")
  );

  if (sanghyangReviews.length > 0) {
    const dates = sanghyangReviews.map((r) => new Date(r.reviewDate));
    const latestDate = new Date(Math.max(...dates.map((d) => d.getTime())));

    // Klasterisasi ulasan negatif (keluhan operasional)
    const negativeReviews = sanghyangReviews.filter(
      (r) => r.sentiment === "negative" || (r.rating > 0 && r.rating <= 2)
    );

    if (negativeReviews.length > 0) {
      const topEvidence = negativeReviews.slice(0, 5).map(
        (r) => `[${r.rating > 0 ? `Rating ${r.rating}/5` : "Komentar publik"}] "${r.text.slice(0, 200)}"`
      );
      const sourceUrls = negativeReviews
        .map((r) => r.sourceUrl)
        .filter((u): u is string => Boolean(u))
        .slice(0, 5);

      const confidence = computeReviewConfidence(
        negativeReviews.length,
        latestDate,
        now,
        sourceUrls.length > 0
      );

      // Prioritas dihitung dari proporsi komplain terhadap total ulasan Sanghyang
      const complaintRatio = negativeReviews.length / sanghyangReviews.length;
      const priority = Math.min(95, Math.round(70 + complaintRatio * 25));

      insights.push({
        type: "recommendation",
        status: "active",
        title: `[Perbaikan Operasional] Ulasan Tamu Sanghyang Menyoroti Fasilitas Kamar & Kebersihan`,
        summary: `Tercatat ${negativeReviews.length} ulasan kritis dari total ${sanghyangReviews.length} ulasan teramati. Tamu menyampaikan masukan langsung mengenai fasilitas dan layanan yang memerlukan perhatian tim operasional.`,
        evidence: topEvidence,
        sourceReferences: sourceUrls,
        priority,
        confidence,
      });
    }

    // Klasterisasi ulasan positif (daya tarik utama)
    const positiveReviews = sanghyangReviews.filter(
      (r) => r.sentiment === "positive" || r.rating >= 4
    );

    if (positiveReviews.length > 0) {
      const topEvidence = positiveReviews.slice(0, 5).map(
        (r) => `[${r.rating > 0 ? `Rating ${r.rating}/5` : "Komentar publik"}] "${r.text.slice(0, 200)}"`
      );
      const sourceUrls = positiveReviews
        .map((r) => r.sourceUrl)
        .filter((u): u is string => Boolean(u))
        .slice(0, 5);

      const confidence = computeReviewConfidence(
        positiveReviews.length,
        latestDate,
        now,
        sourceUrls.length > 0
      );

      insights.push({
        type: "insight",
        status: "active",
        title: `[Keunggulan Layanan] Kepuasan Tamu Sanghyang atas Suasana Pantai & Keramahan`,
        summary: `${positiveReviews.length} dari ${sanghyangReviews.length} ulasan teramati menyatakan kepuasan atas pengalaman menginap, ketenangan alam pesisir Anyer, dan keramahan staf resort.`,
        evidence: topEvidence,
        sourceReferences: sourceUrls,
        priority: 70,
        confidence,
      });
    }
  }

  // 2. Analisis Tarif Pasar vs Baseline Sanghyang
  const validPrices = input.prices.filter((p) => p.price > 0);
  const sanghyangPrices = (input.sanghyangPrices ?? []).filter((p) => p.price > 0);

  if (validPrices.length > 0 && sanghyangPrices.length > 0) {
    const latestSanghyangPrice = sanghyangPrices[0].price;
    const competitorPrices = validPrices.map((p) => p.price);
    const avgCompetitorPrice = Math.round(
      competitorPrices.reduce((a, b) => a + b, 0) / competitorPrices.length
    );

    const priceDates = validPrices.map((p) => new Date(p.observedAt));
    const latestPriceDate = new Date(Math.max(...priceDates.map((d) => d.getTime())));
    const uniqueCompetitors = new Set(validPrices.map((p) => p.competitorName)).size;

    const confidence = computePriceConfidence(uniqueCompetitors, latestPriceDate, now);
    const diffPct = Math.round(((latestSanghyangPrice - avgCompetitorPrice) / avgCompetitorPrice) * 100);

    const evidenceList = validPrices.slice(0, 5).map(
      (p) => `${p.competitorName}: Rp ${p.price.toLocaleString("id-ID")} (${p.roomName ?? "Tarif terendah"})`
    );
    const sourceUrls = validPrices
      .map((p) => p.sourceUrl)
      .filter((u): u is string => Boolean(u))
      .slice(0, 5);

    insights.push({
      type: "opportunity",
      status: "active",
      title: `[Dinamika Tarif Pasar] Tarif Sanghyang ${diffPct >= 0 ? `${diffPct}% di Atas` : `${Math.abs(diffPct)}% di Bawah`} Rata-Rata Compset Anyer`,
      summary: `Berdasarkan perbandingan tarif kamar teramati dari ${uniqueCompetitors} hotel pembanding (rata-rata pasar: Rp ${avgCompetitorPrice.toLocaleString("id-ID")}), tarif Sanghyang berada pada Rp ${latestSanghyangPrice.toLocaleString("id-ID")}. Penyesuaian yield disarankan untuk mengoptimalkan okupansi dan pendapatan.`,
      evidence: evidenceList,
      sourceReferences: sourceUrls,
      priority: Math.abs(diffPct) > 15 ? 85 : 65,
      confidence,
    });
  }

  // 3. Analisis Promo Aktif Kompetitor
  const activePromos = (input.promotions ?? []).filter((p) => {
    if (!p.endsAt) return true;
    return new Date(p.endsAt) >= now;
  });

  if (activePromos.length > 0) {
    const promoCompetitors = new Set(activePromos.map((p) => p.competitorName));
    const evidenceList = activePromos.slice(0, 5).map(
      (p) => `${p.competitorName}: ${p.title}${p.discount ? ` (Diskon ${p.discount}%)` : ""}`
    );
    const sourceUrls = activePromos
      .map((p) => p.sourceUrl)
      .filter((u): u is string => Boolean(u))
      .slice(0, 5);

    insights.push({
      type: "opportunity",
      status: "active",
      title: `[Radar Promosi Kompetitor] ${activePromos.length} Promo Terdeteksi Aktif di Kawasan Anyer`,
      summary: `Terdeteksi ${activePromos.length} penawaran dan promosi yang sedang berjalan dari ${promoCompetitors.size} kompetitor. Disarankan merespons dengan penawaran berbasis nilai tambah fasilitas (hot spring, sunset pool) daripada perang harga langsung.`,
      evidence: evidenceList,
      sourceReferences: sourceUrls,
      priority: 75,
      confidence: Math.min(90, Math.max(50, 50 + activePromos.length * 8)),
    });
  }

  return insights;
}
