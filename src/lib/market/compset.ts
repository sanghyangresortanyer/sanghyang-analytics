/**
 * Aturan pembanding kompetitor (keputusan pemakai 13 Nov 2026, ADR-008).
 *
 * Kompetitor inti dihitung dalam pangsa pasar dan koridor harga. Syaratnya: sejenis dengan outlet Sanghyang,
 * jarak tempuh mobil dari Sanghyang paling jauh 25 km, untuk penginapan minimal bintang 4 (Sanghyang bintang 4), dan
 * untuk restoran atau bar yang berdiri sendiri minimal 50 ulasan Google (tanda pasar yang cukup besar untuk dibandingkan;
 * tempat dengan segelintir ulasan hampir pasti beromset kecil). Outlet di dalam hotel kompetitor ikut kelayakan hotelnya.
 * Acuan (benchmark) hanya ditampilkan sebagai referensi; perannya diputuskan pemilik dan dicatat di kolom `compsetRole`.
 */

export const COMPSET_MAX_ROAD_KM = 25;
export const MIN_LODGING_STARS = 4;
/** Ulasan Google minimal untuk restoran atau bar mandiri (keputusan 14 Nov 2026 atas wewenang dari pemakai). */
export const MIN_STANDALONE_REVIEWS = 50;

export type CompsetRole = "inti" | "benchmark";

const LODGING_CATEGORIES = new Set(["hotel", "resort"]);

export const isLodging = (category: string | null | undefined) =>
  category !== null && category !== undefined && LODGING_CATEGORIES.has(category);

export interface CompsetCandidate {
  category: string | null;
  starRating: number | null;
  roadKm: number | null;
  /** Jumlah ulasan Google; syarat pasar minimum hanya diperiksa bila nilai ini diberikan (null = belum terbaca). */
  reviewCount?: number | null;
  /** true untuk restoran, bar, atau spa di dalam hotel pembanding: tidak punya listing sendiri. */
  insideLodging?: boolean;
}

/** Alasan sebuah tempat tidak layak menjadi pembanding inti, atau null bila layak. */
export function compsetIneligibility(candidate: CompsetCandidate): string | null {
  if (candidate.roadKm === null) return "Jarak tempuh belum diukur.";
  if (candidate.roadKm > COMPSET_MAX_ROAD_KM) {
    return `Jarak tempuh ${candidate.roadKm.toLocaleString("id-ID")} km, di luar ${COMPSET_MAX_ROAD_KM} km.`;
  }
  if (isLodging(candidate.category)) {
    if (candidate.starRating === null) return "Kelas bintang belum diketahui.";
    if (candidate.starRating < MIN_LODGING_STARS) {
      return `Bintang ${candidate.starRating}, di bawah bintang ${MIN_LODGING_STARS} Sanghyang.`;
    }
    return null;
  }
  if (candidate.insideLodging || candidate.reviewCount === undefined) return null;
  if (candidate.reviewCount === null) return "Jumlah ulasan Google belum terbaca.";
  if (candidate.reviewCount < MIN_STANDALONE_REVIEWS) {
    return `${candidate.reviewCount.toLocaleString("id-ID")} ulasan Google, di bawah ${MIN_STANDALONE_REVIEWS}: pasarnya terlalu kecil untuk dibandingkan.`;
  }
  return null;
}

export const isEligibleCore = (candidate: CompsetCandidate) => compsetIneligibility(candidate) === null;

export function parseCompsetRole(value: string | null | undefined): CompsetRole | null {
  return value === "inti" || value === "benchmark" ? value : null;
}

/** Label pendek untuk kartu dan tabel. */
export const COMPSET_ROLE_LABEL: Record<CompsetRole, string> = {
  inti: "Pembanding",
  benchmark: "Acuan",
};
