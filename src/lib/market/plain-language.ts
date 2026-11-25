/**
 * Kalimat dan label sederhana untuk tim digital marketing, dipakai bersama oleh halaman web dan PDF
 * agar keduanya selalu berkata sama. Satu kalimat = satu ide; setiap angka disertai artinya.
 */
import type { OutletGoals } from "./goals";

/** Indeks harga 100 = setara rata-rata pesaing; di luar rentang ini harga dianggap lebih murah / lebih mahal. */
export const FAIR_PRICE_BAND = { low: 90, high: 110 } as const;
/** Di bawah jumlah ulasan ini, persen sentimen belum bisa dinilai (satu ulasan bisa menggeser puluhan persen). */
export const MIN_REVIEWS_FOR_VERDICT = 10;
/** Porsi ulasan negatif setinggi ini berarti cukup banyak tamu kecewa. */
export const UNHAPPY_SHARE_PERCENT = 25;
/** Diskon pesaing setinggi ini memancing perang harga; kita tidak ikut memotong harga sedalam itu. */
export const DEEP_DISCOUNT_PERCENT = 20;

export type Tone = "good" | "warn" | "bad" | "neutral";

const id = (n: number) => n.toLocaleString("id-ID");

export function priceVerdict(ppi: number | null): { label: string; sentence: string; tone: Tone } {
  if (ppi === null) return { label: "Belum ada data", sentence: "Harga kompetitor belum cukup untuk dibandingkan.", tone: "neutral" };
  const gap = Math.round(Math.abs(100 - ppi));
  if (ppi < FAIR_PRICE_BAND.low) {
    return { label: "Lebih murah", sentence: `Harga kita sekitar ${gap}% lebih murah dari rata-rata kompetitor.`, tone: "warn" };
  }
  if (ppi > FAIR_PRICE_BAND.high) {
    return { label: "Lebih mahal", sentence: `Harga kita sekitar ${gap}% lebih mahal dari rata-rata kompetitor.`, tone: "bad" };
  }
  return { label: "Setara", sentence: "Harga kita setara dengan rata-rata kompetitor.", tone: "good" };
}

export function sentimentVerdict(positive: number, total: number, negative = 0): { pct: number | null; sentence: string; tone: Tone } {
  if (total === 0) return { pct: null, sentence: "Belum ada ulasan tamu yang tercatat.", tone: "neutral" };
  const pct = Math.round((positive / total) * 100);
  if (total < MIN_REVIEWS_FOR_VERDICT) {
    return { pct, sentence: `Baru ada ${id(total)} ulasan tercatat, jadi belum bisa disimpulkan.`, tone: "neutral" };
  }
  const unhappy = Math.round((negative / total) * 100);
  // "Kecewa" diukur dari ulasan negatif, bukan dari kurangnya pujian: ulasan netral bukan keluhan.
  const tone: Tone = unhappy >= UNHAPPY_SHARE_PERCENT ? "bad" : pct >= 75 ? "good" : "warn";
  const mood =
    tone === "bad" ? `${unhappy} dari 100 ulasan berisi keluhan, jadi cukup banyak tamu yang kecewa.`
    : tone === "good" ? "Kebanyakan tamu puas."
    : `${Math.max(0, 100 - pct - unhappy)} dari 100 netral dan ${unhappy} dari 100 berisi keluhan.`;
  return { pct, sentence: `${pct} dari 100 ulasan memuji kita. ${mood}`, tone };
}

/** Toleransi "hampir tercapai": 2 poin persen untuk kenaikan omset, 0,1 untuk rating. */
export const NEAR_GOAL = { growthPoints: 2, rating: 0.1 } as const;

/** Status tujuan: target dibanding hasil, makin besar makin baik. */
export function goalStatus(target: number | null, actual: number | null, tolerance: number): { label: string; tone: Tone } {
  if (target === null) return { label: "Belum ada target", tone: "neutral" };
  if (actual === null) return { label: "Belum ada data", tone: "neutral" };
  if (actual >= target) return { label: "Tercapai", tone: "good" };
  if (actual >= target - tolerance) return { label: "Hampir tercapai", tone: "warn" };
  return { label: "Belum tercapai", tone: "bad" };
}

export interface AspectStat { aspect: string; count: number; positiveRatio: number; negativeRatio: number }

/** Tiga hal paling dipuji dan paling dikeluhkan; kosong bila ulasan terlalu sedikit untuk disimpulkan. */
export function aspectHighlights(aspects: AspectStat[] | undefined, totalReviews: number): { praised: string[]; complaints: string[] } {
  if (!aspects || totalReviews < MIN_REVIEWS_FOR_VERDICT) return { praised: [], complaints: [] };
  return {
    praised: aspects.filter((a) => a.positiveRatio >= 60).sort((a, b) => b.count - a.count).slice(0, 3).map((a) => a.aspect),
    complaints: aspects.filter((a) => a.negativeRatio >= 30).sort((a, b) => b.negativeRatio * b.count - a.negativeRatio * a.count).slice(0, 3).map((a) => a.aspect),
  };
}

/** Target rating otomatis: naik 0,1 dari rating Google sekarang (maksimal 5). */
export function suggestedRatingTarget(rating: number | null): number | null {
  return rating === null ? null : Math.min(5, Math.round((rating + 0.1) * 10) / 10);
}

/**
 * Target yang berlaku: isian tim bila ada, selain itu target otomatis. Target rating otomatis dihitung dari
 * rating bulan lalu (bila ada) agar tidak ikut bergeser setiap kali rating hari ini berubah.
 */
export function effectiveGoal(g: OutletGoals | undefined, currentRating: number | null) {
  const ratingBase = g?.previousSnapshot?.googleRating ?? currentRating;
  return {
    targetRevenueGrowthPct: g?.goal?.targetRevenueGrowthPct ?? g?.suggested.targetRevenueGrowthPct ?? null,
    growthAuto: g?.goal?.targetRevenueGrowthPct == null,
    targetRating: g?.goal?.targetRating ?? suggestedRatingTarget(ratingBase),
    ratingAuto: g?.goal?.targetRating == null,
    strategy: g?.goal?.strategy || g?.suggested.strategy || "",
    strategyAuto: !g?.goal?.strategy,
    basis: g?.suggested.basis ?? "",
  };
}
