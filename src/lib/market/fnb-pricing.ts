/**
 * Evaluasi Pricing F&B: komparasi harga menu Sanghyang vs kompetitor (halaman Untuk Direksi)
 *
 * Mengolah MenuItemComparison menjadi metrik evaluasi harga presisi:
 * - Rata-rata harga pasar Anyer (≤25 km)
 * - Selisih nominal (Rp) dan persentase (%)
 * - Klasifikasi posisi harga (cheaper | balanced | premium)
 * - Rekomendasi aksi taktis (promosi digital / potensi re-pricing margin)
 *
 * Menerapkan "The 4 Zeros": Zero Mock Data, Zero Hardcoded Dates, Zero Fallback, Zero Data Loss.
 */

import type { MenuItemComparison } from "./pricing-rules";

/** "no-data": belum ada harga pesaing yang bersumber untuk item ini, jadi posisinya tidak dinilai. */
export type FnbPricingStance = "cheaper" | "balanced" | "premium" | "no-data";

export interface EvaluatedCompetitorPrice {
  competitorName: string;
  price: number;
  differenceRp: number;
  differencePercent: number; // Positif jika kompetitor lebih mahal (Sanghyang lebih murah)
  note?: string;
}

export interface EvaluatedMenuItem {
  itemName: string;
  category: string;
  sanghyangPrice: number;
  competitors: EvaluatedCompetitorPrice[];
  portionValueNote: string;
  averageCompetitorPrice: number | null;
  minCompetitorPrice: number | null;
  maxCompetitorPrice: number | null;
  priceDiffFromAvgRp: number | null; // Negatif jika Sanghyang lebih murah dari rata-rata
  priceDiffFromAvgPct: number | null; // Negatif jika Sanghyang lebih murah dari rata-rata
  stance: FnbPricingStance;
  stanceLabel: string;
  aiRecommendation: string;
}

export interface FnbPricingEvaluationSummary {
  outletKey: string;
  outletName: string;
  totalMenuItems: number;
  overallAvgDiffPct: number; // Negatif = Sanghyang lebih hemat secara keseluruhan
  cheaperCount: number;
  balancedCount: number;
  premiumCount: number;
  noDataCount: number;
  bestValueItem: EvaluatedMenuItem | null;
  repriceOpportunityItem: EvaluatedMenuItem | null;
  executiveSummary: string;
  items: EvaluatedMenuItem[];
}

/** Menghitung evaluasi menu satuan terhadap kompetitor. */
export function evaluateMenuItem(item: MenuItemComparison): EvaluatedMenuItem {
  const validCompetitors = item.competitorPrices.filter((cp) => cp.price > 0);

  const competitors: EvaluatedCompetitorPrice[] = item.competitorPrices.map((cp) => ({
    competitorName: cp.competitorName,
    price: cp.price,
    differenceRp: cp.price > 0 ? item.sanghyangPrice - cp.price : 0,
    differencePercent: cp.price > 0
      ? Math.round(((cp.price - item.sanghyangPrice) / cp.price) * 1000) / 10
      : 0,
    note: cp.note,
  }));

  if (validCompetitors.length === 0) {
    return {
      itemName: item.itemName,
      category: item.category,
      sanghyangPrice: item.sanghyangPrice,
      competitors,
      portionValueNote: item.portionValueNote,
      averageCompetitorPrice: null,
      minCompetitorPrice: null,
      maxCompetitorPrice: null,
      priceDiffFromAvgRp: null,
      priceDiffFromAvgPct: null,
      stance: "no-data",
      stanceLabel: "Belum ada pembanding",
      aiRecommendation: "Kumpulkan harga menu pesaing inti untuk item yang sama, beserta sumber dan tanggalnya.",
    };
  }

  const prices = validCompetitors.map((cp) => cp.price);
  const avgPrice = Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // Selisih Sanghyang terhadap rata-rata pasar: negatif = Sanghyang lebih murah
  const diffRp = item.sanghyangPrice - avgPrice;
  const diffPct = Math.round(((item.sanghyangPrice - avgPrice) / avgPrice) * 1000) / 10;

  let stance: FnbPricingStance;
  let stanceLabel: string;
  let aiRecommendation: string;

  if (diffPct <= -5) {
    stance = "cheaper";
    const hematPct = Math.abs(diffPct);
    const hematRp = Math.abs(diffRp);
    stanceLabel = `Lebih Hemat ${hematPct.toLocaleString("id-ID")}% (-Rp ${hematRp.toLocaleString("id-ID")})`;

    if (diffPct <= -20) {
      aiRecommendation = `Senjata utama promosi digital! Harga Sanghyang ${hematPct.toLocaleString("id-ID")}% di bawah rata-rata Anyer. Sangat kuat untuk materi headline sosmed/iklan. Ada peluang re-pricing bertahap (+5% s.d. +8%) untuk menaikkan margin tanpa kehilangan tamu.`;
    } else {
      aiRecommendation = `Posisi harga sangat kompetitif (Sweet-spot). Lebih hemat Rp ${hematRp.toLocaleString("id-ID")} dari rata-rata pesaing; pertahankan rasa autentik bumbu rempah dan porsi.`;
    }
  } else if (diffPct >= 5) {
    stance = "premium";
    const selisihRp = Math.abs(diffRp);
    stanceLabel = `Premium (+${diffPct.toLocaleString("id-ID")}%) (+Rp ${selisihRp.toLocaleString("id-ID")})`;
    aiRecommendation = `Harga berada di atas rata-rata pasar (+Rp ${selisihRp.toLocaleString("id-ID")}). Wajib diimbangi dengan presentasi plating mewah, porsi royal, atau bonus pelengkap (sambal/lalapan/es teh) agar tamu merasa sebanding.`;
  } else {
    stance = "balanced";
    stanceLabel = `Setara Rata-rata Pasar (±${Math.abs(diffPct).toLocaleString("id-ID")}%)`;
    aiRecommendation = "Harga selaras dengan pasar Anyer. Daya saing ditentukan oleh keunggulan lokasi tepi pantai, kecepatan pelayanan, dan kebersihan meja.";
  }

  return {
    itemName: item.itemName,
    category: item.category,
    sanghyangPrice: item.sanghyangPrice,
    competitors,
    portionValueNote: item.portionValueNote,
    averageCompetitorPrice: avgPrice,
    minCompetitorPrice: minPrice,
    maxCompetitorPrice: maxPrice,
    priceDiffFromAvgRp: diffRp,
    priceDiffFromAvgPct: diffPct,
    stance,
    stanceLabel,
    aiRecommendation,
  };
}

/** Menghasilkan evaluasi komprehensif pricing F&B untuk satu outlet. */
export function evaluateOutletFnbPricing(
  outletKey: string,
  outletName: string,
  menuItems: MenuItemComparison[]
): FnbPricingEvaluationSummary {
  const evaluatedItems = menuItems.map(evaluateMenuItem);
  const itemsWithCompetitors = evaluatedItems.filter((i) => i.priceDiffFromAvgPct !== null);

  const cheaperCount = evaluatedItems.filter((i) => i.stance === "cheaper").length;
  const balancedCount = evaluatedItems.filter((i) => i.stance === "balanced").length;
  const premiumCount = evaluatedItems.filter((i) => i.stance === "premium").length;
  const noDataCount = evaluatedItems.filter((i) => i.stance === "no-data").length;

  const overallAvgDiffPct = itemsWithCompetitors.length > 0
    ? Math.round(
        (itemsWithCompetitors.reduce((sum, i) => sum + (i.priceDiffFromAvgPct ?? 0), 0) /
          itemsWithCompetitors.length) *
          10
      ) / 10
    : 0;

  // Best value: item dengan persentase lebih murah paling besar
  const bestValueItem = itemsWithCompetitors.length > 0
    ? [...itemsWithCompetitors].sort((a, b) => (a.priceDiffFromAvgPct ?? 0) - (b.priceDiffFromAvgPct ?? 0))[0]
    : null;

  // Reprice opportunity: item yang lebih murah >= 12% dan punya selisih nominal signifikan
  const repriceCandidates = itemsWithCompetitors
    .filter((i) => (i.priceDiffFromAvgPct ?? 0) <= -12)
    .sort((a, b) => (a.priceDiffFromAvgRp ?? 0) - (b.priceDiffFromAvgRp ?? 0));
  const repriceOpportunityItem = repriceCandidates.length > 0 ? repriceCandidates[0] : null;

  let executiveSummary = "";
  if (overallAvgDiffPct < -5) {
    executiveSummary = `Secara keseluruhan, harga menu ${outletName} rata-rata ${Math.abs(overallAvgDiffPct).toLocaleString("id-ID")}% lebih hemat dibanding kompetitor sebanding di Anyer. Sangat menguntungkan untuk penetrasi pasar rombongan keluarga & event.`;
  } else if (overallAvgDiffPct > 5) {
    executiveSummary = `Harga menu ${outletName} rata-rata ${overallAvgDiffPct.toLocaleString("id-ID")}% lebih tinggi dari pasar. Fokuskan diferensiasi pada kualitas bahan premium dan suasana eksklusif.`;
  } else {
    executiveSummary = `Struktur harga ${outletName} sangat seimbang dengan rata-rata pasar Anyer (selisih ${Math.abs(overallAvgDiffPct).toLocaleString("id-ID")}%).`;
  }

  return {
    outletKey,
    outletName,
    totalMenuItems: evaluatedItems.length,
    overallAvgDiffPct,
    cheaperCount,
    balancedCount,
    premiumCount,
    noDataCount,
    bestValueItem,
    repriceOpportunityItem,
    executiveSummary,
    items: evaluatedItems,
  };
}
