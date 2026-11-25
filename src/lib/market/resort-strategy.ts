/**
 * Strategi pemasaran resort yang menggabungkan data tarif (workbook), reputasi (rating DB),
 * promo kompetitor (radar) dan aspek ulasan tamu. Fungsi murni tanpa akses DB agar bisa dipakai di UI & test.
 */
import {
  RESORT_LOWEST_BY_HOTEL,
  RESORT_RATE_EVIDENCE,
  RESORT_ROOM_RATES,
  SANGHYANG_HOTEL_ID,
  breakfastComparison,
  competitorGapPercent,
  isPricingCompetitor,
  percentile,
  type DayRecommendation,
  type LowestHotelRate,
  type RateEvidence,
  type RoomRateRow,
} from "./resort-room-rates";
import { getHotelRoomTypes, inferOfficialBreakfastFromHighlights } from "./hotel-room-types";
import { isKnownOtaHost } from "./ota-providers";

/**
 * Nama baris Competitor di DB untuk setiap hotel_id workbook (sumber rating Google). Hanya pembanding inti yang ikut
 * perbandingan rating; acuan dan hotel yang dikeluarkan disaring oleh isPricingCompetitor.
 */
export const RESORT_HOTEL_DB_NAMES: Record<string, string> = {
  sanghyang: "Sanghyang Indah Spa Resort",
  mambruk: "Mambruk Hotel & Convention",
  aston_anyer: "Aston Anyer Beach Hotel",
  jayakarta: "The Jayakarta Villas Anyer Beach Resort",
  marbella: "Marbella Place Anyer by Jayakarta",
  novus_jiva: "Novus Jiva Anyer Villa, Resort & Spa",
  movenpick: "Mövenpick Resort Carita",
  nemuru_palazo: "Nemuru Grand Anyer Palazo",
  hawaii_anyer: "Hawaii Resort Family Suites Anyer",
  my_pisita_anyer: "My Pisita Anyer Resort",
};

export interface ReputationSnapshot {
  sanghyang: number;
  peers: { hotelId: string; name: string; rating: number }[];
  median: number;
  /** 1 = rating tertinggi di antara Sanghyang + hotel bintang 4 pembanding. */
  rank: number;
  total: number;
  meetsMedian: boolean;
  /** Nama hotel bintang 4 di workbook yang belum punya rating di DB. */
  missing: string[];
}

/** Posisi rating Google Sanghyang terhadap hotel bintang 4 yang dibandingkan di workbook. */
export function computeReputation(
  sanghyangRating: number | null,
  ratings: { name: string; rating: number }[],
  rows: RoomRateRow[] = RESORT_ROOM_RATES,
): ReputationSnapshot | null {
  if (sanghyangRating === null) return null;
  const byName = new Map(ratings.map((r) => [r.name, r.rating]));
  const displayName = new Map(rows.map((r) => [r.hotelId, r.competitorName]));
  const ids = [...new Set(rows.filter((r) => r.cluster === "KLASTER_I_BINTANG_4" && isPricingCompetitor(r.hotelId)).map((r) => r.hotelId))];
  const peers: ReputationSnapshot["peers"] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const rating = byName.get(RESORT_HOTEL_DB_NAMES[id] ?? "");
    const name = displayName.get(id) ?? id;
    if (rating === undefined) missing.push(name);
    else peers.push({ hotelId: id, name, rating });
  }
  if (peers.length < 2) return null;
  const median = Number(percentile(peers.map((p) => p.rating).sort((a, b) => a - b), 0.5).toFixed(2));
  return {
    sanghyang: sanghyangRating,
    peers: peers.sort((a, b) => b.rating - a.rating),
    median,
    rank: peers.filter((p) => p.rating > sanghyangRating).length + 1,
    total: peers.length + 1,
    meetsMedian: sanghyangRating >= median,
    missing,
  };
}

export interface RadarPromo {
  competitorName: string;
  title: string;
  category: string;
  discount?: number | null;
  status: string;
  sourceUrl: string;
}

/** Promo kamar kompetitor yang sedang aktif (radar promo Langkah 4). */
export const activeRoomPromos = (promos: RadarPromo[]) => promos.filter((p) => p.category === "Kamar & Menginap" && p.status === "active");

/** Diskon promo kamar kompetitor terdalam yang sedang aktif (persen), null bila tidak ada promo berdiskon. */
export function deepestCompetitorDiscount(promos: RadarPromo[]): number | null {
  const discounts = activeRoomPromos(promos)
    .map((p) => p.discount)
    .filter((d): d is number => typeof d === "number" && d > 0);
  return discounts.length ? Math.max(...discounts) : null;
}

/** Diskon promo Fase 2 yang dianjurkan: menyamai promo kompetitor terdalam, tetapi tidak melewati batas lantai. */
export function phase2PromoDiscount(day: DayRecommendation, competitorDeepest: number | null): number | null {
  if (!day.phase2) return null;
  return competitorDeepest === null ? day.phase2.maxDiscountPercent : Math.min(competitorDeepest, day.phase2.maxDiscountPercent);
}

/**
 * Klaim fasilitas Sanghyang yang tidak didukung situs resmi (sanghyang.com).
 * Target respons seperti "1×24 jam" bukan klaim fasilitas.
 */
export const DISPROVEN_FACILITY_CLAIM = /belerang|sulfur|vulkanik|onsen|40 ?(°|derajat)|(?<![×x] ?)24 jam|belasan hektar|\d+\+? hektar|pasir (pantai )?putih|infinity pool party|tanpa (bebatuan )?karang|bebas karang/i;

export const DEFAULT_STRATEGY_REVIEW_WINDOW_MONTHS = 24;

/**
 * Periksa apakah ulasan berada dalam jendela waktu analisis (default 24 bulan).
 */
export function isReviewInWindow(
  reviewDate: string | Date,
  months = DEFAULT_STRATEGY_REVIEW_WINDOW_MONTHS,
  baseDate = new Date()
): boolean {
  const dateObj = typeof reviewDate === "string" ? new Date(reviewDate) : reviewDate;
  if (isNaN(dateObj.getTime())) return false;
  const cutoff = new Date(baseDate);
  cutoff.setMonth(cutoff.getMonth() - months);
  return dateObj.getTime() >= cutoff.getTime();
}

/**
 * Ulasan dari scrape Google Travel (Google, Tripadvisor, Trip.com) atau Google Maps
 * yang asal-usulnya bisa dipastikan sah secara teknis.
 * Menolak keras pola buatan (misalnya URL dengan ?cid= non-numerik).
 */
export function isVerifiedReviewSource(
  sourceUrl: string | null | undefined,
  dynamicOtaHosts?: Iterable<string>,
): boolean {
  if (!sourceUrl || !URL.canParse(sourceUrl)) return false;
  const { protocol, hostname, pathname, searchParams } = new URL(sourceUrl);
  if (protocol !== "https:") return false;

  const validHosts = ["www.google.com", "www.google.co.id", "maps.google.com", "maps.app.goo.gl"];
  if (validHosts.includes(hostname)) {
    // Menolak pola buatan ?cid=teks-nama
    const cid = searchParams.get("cid");
    if (cid !== null && !/^\d+$/.test(cid)) {
      return false;
    }

    // Google Travel resmi
    if (pathname.startsWith("/travel/hotels/entity/")) {
      return true;
    }

    // Tautan klik Google Travel yang mengarah ke domain OTA terverifikasi (pcurl)
    if (pathname === "/travel/lodging/clk") {
      const pcurl = searchParams.get("pcurl");
      if (pcurl && URL.canParse(pcurl)) {
        const target = new URL(pcurl);
        return target.protocol === "https:" && isKnownOtaHost(target.hostname, dynamicOtaHosts);
      }
      return false;
    }

    // Kartu ulasan Google Maps yang id ulasannya ikut tersimpan (reviewid)
    if (pathname.startsWith("/maps/place/") && Boolean(searchParams.get("reviewid"))) {
      return true;
    }
    return false;
  }

  // Ulasan komentar dari postingan publik Instagram & TikTok yang sah (fail-closed untuk URL profil/halaman lain).
  if (hostname === "www.instagram.com" || hostname === "instagram.com") {
    return /^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(pathname);
  }

  if (hostname === "www.tiktok.com" || hostname === "tiktok.com") {
    return /^\/@[A-Za-z0-9._-]+\/(video|photo)\/\d+\/?$/.test(pathname);
  }

  // Portal OTA resmi diturunkan secara dinamis dari temuan Google Travel dan DB runtime (tanpa daftar statis).
  return isKnownOtaHost(hostname, dynamicOtaHosts);
}

export interface VerifiedReview {
  rating: number;
  text: string;
  source: string;
  reviewDate: string;
  sentiment?: string;
}

/**
 * Kelompokkan ulasan terverifikasi jadi keluhan (nilai ≤ 3) dan pujian (nilai ≥ 4), terbaru dulu.
 * Secara bawaan menyaring ulasan dalam jendela waktu 24 bulan terakhir untuk analisis relevan.
 */
export function verifiedFeedback(
  reviews: VerifiedReview[],
  options?: { monthsWindow?: number; baseDate?: Date }
) {
  const months = options?.monthsWindow ?? DEFAULT_STRATEGY_REVIEW_WINDOW_MONTHS;
  const base = options?.baseDate ?? new Date();

  // Saring ulasan ke dalam rentang jendela waktu
  const inWindow = reviews.filter((r) => isReviewInWindow(r.reviewDate, months, base));
  const newestFirst = [...inWindow].sort((a, b) => b.reviewDate.localeCompare(a.reviewDate));

  return {
    totalAllTime: reviews.length,
    total: inWindow.length,
    windowMonths: months,
    complaints: newestFirst.filter((r) => (r.rating > 0 ? r.rating <= 3 : r.sentiment === "negative")),
    praises: newestFirst.filter((r) => (r.rating > 0 ? r.rating >= 4 : r.sentiment === "positive")),
  };
}

/**
 * Pembeda metrik ulasan antara listing publik Google vs database sistem.
 */
export interface OutletReviewBreakdown {
  outletKey: string;
  outletName: string;
  /** Total ulasan yang tercatat di profil publik Google Maps / Google Travel */
  totalOnGoogle: number;
  /** Jumlah baris ulasan riil yang tersimpan di database sistem */
  savedInSystem: number;
  /** Jumlah ulasan tersimpan yang memenuhi jendela waktu aktif (default 24 bulan) */
  inWindowSaved: number;
}

export function formatReviewComparisonLabels(breakdown: OutletReviewBreakdown): {
  googleListingLabel: string;
  systemDatabaseLabel: string;
} {
  return {
    googleListingLabel: `Total ulasan di Google: ${breakdown.totalOnGoogle}`,
    systemDatabaseLabel: `Ulasan tersimpan di sistem: ${breakdown.savedInSystem} (${breakdown.inWindowSaved} dalam ${DEFAULT_STRATEGY_REVIEW_WINDOW_MONTHS} bulan terakhir)`,
  };
}

export type ExecutiveBreakfastStatus =
  | "Termasuk sarapan"
  | "Tanpa sarapan"
  | "Tersedia keduanya"
  | "Belum tercatat";

export interface ExecutiveBreakfastHotelRow {
  hotelId: string;
  hotelName: string;
  isSanghyang: boolean;
  starRating: number;
  isCoreCompetitor: boolean;
  weekdayWithBreakfast: number | null;
  weekdayWithoutBreakfast: number | null;
  weekdayStatus: ExecutiveBreakfastStatus;
  weekdayBreakfastPremium: number | null;
  weekendWithBreakfast: number | null;
  weekendWithoutBreakfast: number | null;
  weekendStatus: ExecutiveBreakfastStatus;
  weekendBreakfastPremium: number | null;
  overallStatus: ExecutiveBreakfastStatus;
  gapWithBreakfastWeekdayPct: number | null;
  gapWithBreakfastWeekendPct: number | null;
  gapWithoutBreakfastWeekdayPct: number | null;
  gapWithoutBreakfastWeekendPct: number | null;
  sourceNote: string;
}

export interface ExecutiveBreakfastSummary {
  rows: ExecutiveBreakfastHotelRow[];
  sanghyangWeekdayWithBreakfast: number | null;
  sanghyangWeekdayWithoutBreakfast: number | null;
  sanghyangWeekendWithBreakfast: number | null;
  sanghyangWeekendWithoutBreakfast: number | null;
  peerMedianWeekdayWithBreakfast: number | null;
  peerMedianWeekdayWithoutBreakfast: number | null;
  peerMedianWeekendWithBreakfast: number | null;
  peerMedianWeekendWithoutBreakfast: number | null;
  sanghyangVsPeerWithBreakfastWeekdayPct: number | null;
  sanghyangVsPeerWithoutBreakfastWeekdayPct: number | null;
  executiveNote: string;
  parityDirective: { title: string; detail: string };
}

function resolveBreakfastStatus(withBf: number | null, withoutBf: number | null, officialBf: boolean | null): ExecutiveBreakfastStatus {
  if (withBf !== null && withoutBf !== null) return "Tersedia keduanya";
  if (withBf !== null) return "Termasuk sarapan";
  if (withoutBf !== null) return "Tanpa sarapan";
  if (officialBf === true) return "Termasuk sarapan";
  if (officialBf === false) return "Tanpa sarapan";
  return "Belum tercatat";
}

function mergeOverallBreakfastStatus(wd: ExecutiveBreakfastStatus, we: ExecutiveBreakfastStatus): ExecutiveBreakfastStatus {
  if (wd === "Tersedia keduanya" || we === "Tersedia keduanya") return "Tersedia keduanya";
  if ((wd === "Termasuk sarapan" && we === "Tanpa sarapan") || (wd === "Tanpa sarapan" && we === "Termasuk sarapan")) {
    return "Tersedia keduanya";
  }
  if (wd === "Termasuk sarapan" || we === "Termasuk sarapan") return "Termasuk sarapan";
  if (wd === "Tanpa sarapan" || we === "Tanpa sarapan") return "Tanpa sarapan";
  return "Belum tercatat";
}

function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(percentile(sorted, 0.5));
}

const rpStrategy = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/**
 * Evaluasi kesetaraan tarif kamar Termasuk Sarapan vs Tanpa Sarapan untuk halaman Untuk Direksi (`/direksi`).
 * Seluruh angka berasal dari bukti penawaran OTA (`RESORT_RATE_EVIDENCE`), `RESORT_LOWEST_BY_HOTEL`, dan
 * profil resmi `HOTEL_ROOM_TYPES` (Zero Mock: hotel tanpa bukti sarapan ditulis "Belum tercatat").
 */
export function buildExecutiveBreakfastParity(
  evidence: RateEvidence[] = RESORT_RATE_EVIDENCE,
  hotels: LowestHotelRate[] = RESORT_LOWEST_BY_HOTEL,
): ExecutiveBreakfastSummary {
  const gaps = breakfastComparison(evidence, hotels);
  const byHotelStay = new Map(gaps.map((g) => [`${g.hotelId}|${g.stay}`, g]));

  const own = hotels.find((h) => h.hotelId === SANGHYANG_HOTEL_ID);
  const ordered = [...(own ? [own] : []), ...hotels.filter((h) => h !== own)];

  const rawRows = ordered.map((h) => {
    const wdGap = byHotelStay.get(`${h.hotelId}|weekday`);
    const weGap = byHotelStay.get(`${h.hotelId}|weekend`);
    const profile = getHotelRoomTypes(h.hotelId);
    const officialBfFlags = (profile?.roomTypes ?? [])
      .map((rt) => inferOfficialBreakfastFromHighlights(rt.highlights))
      .filter((v): v is boolean => v !== null);
    const officialBf: boolean | null =
      officialBfFlags.length > 0 && officialBfFlags.every((v) => v === true)
        ? true
        : officialBfFlags.length > 0 && officialBfFlags.every((v) => v === false)
          ? false
          : null;

    // Jika tidak ada bukti OTA per kamar namun situs resmi menyatakan semua paket termasuk sarapan (mis. My Pisita),
    // tandai tarif mulai properti sebagai paket Termasuk sarapan dengan catatan sumber situs resmi.
    const weekdayWithBreakfast = wdGap?.withBreakfast ?? (officialBf === true ? h.weekday.price : null);
    const weekdayWithoutBreakfast = wdGap?.withoutBreakfast ?? null;
    const weekendWithBreakfast = weGap?.withBreakfast ?? (officialBf === true ? h.weekend.price : null);
    const weekendWithoutBreakfast = weGap?.withoutBreakfast ?? null;

    const weekdayStatus = resolveBreakfastStatus(weekdayWithBreakfast, weekdayWithoutBreakfast, officialBf);
    const weekendStatus = resolveBreakfastStatus(weekendWithBreakfast, weekendWithoutBreakfast, officialBf);
    const overallStatus = mergeOverallBreakfastStatus(weekdayStatus, weekendStatus);

    const hasOtaBf = Boolean(wdGap || weGap);
    const sourceNote = hasOtaBf
      ? "Bukti paket OTA (Google Travel)"
      : officialBf !== null
        ? `Keterangan paket ${profile?.roomTypes[0]?.sourceLabel ?? "situs resmi"}`
        : "Status sarapan belum tercantum di bukti OTA";

    return {
      hotelId: h.hotelId,
      hotelName: h.hotel,
      isSanghyang: h.hotelId === SANGHYANG_HOTEL_ID,
      starRating: h.starRating,
      isCoreCompetitor: h.hotelId !== SANGHYANG_HOTEL_ID && isPricingCompetitor(h.hotelId),
      weekdayWithBreakfast,
      weekdayWithoutBreakfast,
      weekdayStatus,
      weekdayBreakfastPremium:
        weekdayWithBreakfast !== null && weekdayWithoutBreakfast !== null
          ? weekdayWithBreakfast - weekdayWithoutBreakfast
          : null,
      weekendWithBreakfast,
      weekendWithoutBreakfast,
      weekendStatus,
      weekendBreakfastPremium:
        weekendWithBreakfast !== null && weekendWithoutBreakfast !== null
          ? weekendWithBreakfast - weekendWithoutBreakfast
          : null,
      overallStatus,
      sourceNote,
    };
  });

  const ownRow = rawRows.find((r) => r.isSanghyang);
  const ownWdWith = ownRow?.weekdayWithBreakfast ?? null;
  const ownWdWithout = ownRow?.weekdayWithoutBreakfast ?? null;
  const ownWeWith = ownRow?.weekendWithBreakfast ?? null;
  const ownWeWithout = ownRow?.weekendWithoutBreakfast ?? null;

  const rows: ExecutiveBreakfastHotelRow[] = rawRows.map((r) => ({
    ...r,
    gapWithBreakfastWeekdayPct: r.isSanghyang
      ? null
      : competitorGapPercent({ sanghyang: ownWdWith, competitor: r.weekdayWithBreakfast }),
    gapWithBreakfastWeekendPct: r.isSanghyang
      ? null
      : competitorGapPercent({ sanghyang: ownWeWith, competitor: r.weekendWithBreakfast }),
    gapWithoutBreakfastWeekdayPct: r.isSanghyang
      ? null
      : competitorGapPercent({ sanghyang: ownWdWithout, competitor: r.weekdayWithoutBreakfast }),
    gapWithoutBreakfastWeekendPct: r.isSanghyang
      ? null
      : competitorGapPercent({ sanghyang: ownWeWithout, competitor: r.weekendWithoutBreakfast }),
  }));

  const peers4 = rows.filter((r) => r.isCoreCompetitor && r.starRating === 4);
  const peerMedianWeekdayWithBreakfast = medianOf(
    peers4.map((r) => r.weekdayWithBreakfast).filter((n): n is number => n !== null),
  );
  const peerMedianWeekdayWithoutBreakfast = medianOf(
    peers4.map((r) => r.weekdayWithoutBreakfast).filter((n): n is number => n !== null),
  );
  const peerMedianWeekendWithBreakfast = medianOf(
    peers4.map((r) => r.weekendWithBreakfast).filter((n): n is number => n !== null),
  );
  const peerMedianWeekendWithoutBreakfast = medianOf(
    peers4.map((r) => r.weekendWithoutBreakfast).filter((n): n is number => n !== null),
  );

  const sanghyangVsPeerWithBreakfastWeekdayPct =
    ownWdWith !== null && peerMedianWeekdayWithBreakfast !== null
      ? Number((((ownWdWith - peerMedianWeekdayWithBreakfast) / peerMedianWeekdayWithBreakfast) * 100).toFixed(1))
      : null;
  const sanghyangVsPeerWithoutBreakfastWeekdayPct =
    ownWdWithout !== null && peerMedianWeekdayWithoutBreakfast !== null
      ? Number((((ownWdWithout - peerMedianWeekdayWithoutBreakfast) / peerMedianWeekdayWithoutBreakfast) * 100).toFixed(1))
      : null;

  const bits: string[] = [];
  if (ownWdWith !== null && ownWdWithout !== null) {
    bits.push(
      `Hari biasa Sanghyang tersedia paket Tanpa sarapan (${rpStrategy(ownWdWithout)}) dan Termasuk sarapan (${rpStrategy(ownWdWith)}, selisih +${rpStrategy(ownWdWith - ownWdWithout)}).`,
    );
  }
  if (peerMedianWeekdayWithBreakfast !== null && ownWdWith !== null) {
    const gap = sanghyangVsPeerWithBreakfastWeekdayPct ?? 0;
    bits.push(
      `Pada paket setara Termasuk sarapan hari biasa, median kompetitor bintang 4 berada di ${rpStrategy(peerMedianWeekdayWithBreakfast)} (Sanghyang ${gap > 0 ? `+${gap}` : gap}%).`,
    );
  }
  if (peerMedianWeekendWithBreakfast !== null && ownWeWith !== null) {
    const weGap = Number((((ownWeWith - peerMedianWeekendWithBreakfast) / peerMedianWeekendWithBreakfast) * 100).toFixed(1));
    bits.push(
      `Akhir pekan Termasuk sarapan Sanghyang ${rpStrategy(ownWeWith)} vs median kompetitor bintang 4 ${rpStrategy(peerMedianWeekendWithBreakfast)} (${weGap > 0 ? `+${weGap}` : weGap}%).`,
    );
  }

  const executiveNote =
    bits.join(" ") ||
    "Bandingkan tarif Termasuk sarapan dengan Termasuk sarapan, dan Tanpa sarapan dengan Tanpa sarapan agar evaluasi antarhotel setara.";

  const withBfPeers = peers4.filter((r) => r.weekdayWithBreakfast !== null || r.weekendWithBreakfast !== null).length;
  const parityDirective = {
    title: "Evaluasi tarif berdasarkan kesetaraan paket sarapan (Termasuk vs Tanpa Sarapan)",
    detail:
      ownWdWith !== null && ownWdWithout !== null && peerMedianWeekdayWithBreakfast !== null
        ? `${withBfPeers} dari ${peers4.length} kompetitor bintang 4 menampilkan tarif paket Termasuk sarapan (median hari biasa ${rpStrategy(peerMedianWeekdayWithBreakfast)}). Pastikan evaluasi rate card memisahkan paket Tanpa sarapan Sanghyang (${rpStrategy(ownWdWithout)}) dari paket Termasuk sarapan (${rpStrategy(ownWdWith)}) agar tidak tampak terlalu murah atau mahal secara semu.`
        : "Pisahkan pembandingan tarif Termasuk sarapan dan Tanpa sarapan saat menetapkan koridor rate card di OTA.",
  };

  return {
    rows,
    sanghyangWeekdayWithBreakfast: ownWdWith,
    sanghyangWeekdayWithoutBreakfast: ownWdWithout,
    sanghyangWeekendWithBreakfast: ownWeWith,
    sanghyangWeekendWithoutBreakfast: ownWeWithout,
    peerMedianWeekdayWithBreakfast,
    peerMedianWeekdayWithoutBreakfast,
    peerMedianWeekendWithBreakfast,
    peerMedianWeekendWithoutBreakfast,
    sanghyangVsPeerWithBreakfastWeekdayPct,
    sanghyangVsPeerWithoutBreakfastWeekdayPct,
    executiveNote,
    parityDirective,
  };
}
