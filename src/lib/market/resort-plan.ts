/**
 * Isi strategi pemasaran resort (diagnosis, syarat Fase 2, langkah per pilar, paritas OTA, KPI) sebagai data murni,
 * dipakai bersama oleh halaman web (components/market-intelligence/marketing-strategy.tsx) dan laporan PDF supaya isinya selalu sama.
 */
import {
  buildRoomRateSummaries,
  KIND_LABEL,
  lowestRateRank,
  netAfterDiscount,
  RANKED_LOWEST_BY_HOTEL,
  RESORT_LOWEST_BY_HOTEL,
  resortPricePositioningIndex,
  SANGHYANG_HOTEL_ID,
  sanghyangRateParity,
} from "./resort-room-rates";
import {
  activeRoomPromos,
  computeReputation,
  deepestCompetitorDiscount,
  phase2PromoDiscount,
  verifiedFeedback,
  type RadarPromo,
  type ReputationSnapshot,
  type VerifiedReview,
} from "./resort-strategy";

const STAY_LABEL = { weekday: "hari biasa", weekend: "akhir pekan" } as const;
const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
export const decimal = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
/** Dua kata pertama nama hotel, cukup untuk label ringkas ("Aston Anyer", "Novus Jiva"). */
export const shortName = (name: string) => name.split(" ").slice(0, 2).join(" ");

export interface ResortPlanInput {
  sanghyangRating: number | null;
  competitorRatings: { name: string; rating: number }[];
  promos: RadarPromo[];
  verifiedReviews: VerifiedReview[];
  breakEvenOccupancyDropPercent?: number;
  periodLowestByHotel?: Array<{
    hotelId: string;
    hotelName: string;
    weekday: { price: number | null };
    weekend: { price: number | null };
  }>;
}

export interface ResortPlan {
  reputation: ReputationSnapshot | null;
  deepestCompetitorDiscount: number | null;
  diagnosis: { icon: string; title: string; text: string }[];
  phase2Requirements: string[];
  reputationSteps: string[];
  roomPromos: RadarPromo[];
  phase2Example: { room: string; publish: number; promo: number; net: number; floor: number } | null;
  valueAddOnlyRooms: string[];
  parityLines: string[];
  channelSteps: string[];
  kpi: string;
}

export function buildResortPlan(input: ResortPlanInput): ResortPlan {
  const { sanghyangRating, competitorRatings, promos, verifiedReviews, breakEvenOccupancyDropPercent: breakEven } = input;
  const summaries = buildRoomRateSummaries();
  const parityGaps = sanghyangRateParity();
  const ppi = resortPricePositioningIndex();
  const rank = { weekday: lowestRateRank("weekday"), weekend: lowestRateRank("weekend") };
  const lowestList = input.periodLowestByHotel ?? RESORT_LOWEST_BY_HOTEL;
  const pricedHotels = lowestList.filter((h) => h.weekday.price !== null).length || RANKED_LOWEST_BY_HOTEL.filter((h) => h.weekday.price !== null).length;
  const sanghyangLowest = lowestList.find((h) => h.hotelId === SANGHYANG_HOTEL_ID) ?? RESORT_LOWEST_BY_HOTEL.find((h) => h.hotelId === SANGHYANG_HOTEL_ID);
  const reputation = computeReputation(sanghyangRating, competitorRatings);
  // Postingan yang sama bisa tertangkap dari Instagram dan situs; tampilkan sekali per pesaing dan judul.
  const roomPromos = [...new Map(activeRoomPromos(promos).map((p) => [`${p.competitorName}|${p.title}`, p])).values()];
  // Satu pesaing bisa punya beberapa postingan promo; diagnosis cukup menyebut diskon terdalamnya.
  const deepestByCompetitor = new Map<string, number>();
  for (const p of roomPromos) {
    if (typeof p.discount !== "number" || p.discount <= 0) continue;
    const name = shortName(p.competitorName);
    deepestByCompetitor.set(name, Math.max(deepestByCompetitor.get(name) ?? 0, p.discount));
  }
  const discountedPromos = [...deepestByCompetitor].map(([name, discount]) => ({ name, discount })).sort((a, b) => b.discount - a.discount);
  const deepest = deepestCompetitorDiscount(promos);
  const feedback = verifiedFeedback(verifiedReviews);

  const diagnosis: ResortPlan["diagnosis"] = [];
  if (sanghyangLowest?.weekday.price != null && sanghyangLowest.weekend.price != null) {
    diagnosis.push({
      icon: "💸",
      title: "Harga termurah di pasar",
      text: `Penawaran OTA termurah Sanghyang ${rupiah(sanghyangLowest.weekday.price)} (hari biasa) dan ${rupiah(sanghyangLowest.weekend.price)} (akhir pekan): termurah #${rank.weekday.get(SANGHYANG_HOTEL_ID)} dan #${rank.weekend.get(SANGHYANG_HOTEL_ID)} dari ${pricedHotels} hotel. Indeks harga ${ppi}: harga Sanghyang sekitar ${Math.round(ppi)}% harga kamar setara di hotel bintang 4.`,
    });
  }
  if (reputation) {
    diagnosis.push({
      icon: "⭐",
      title: reputation.meetsMedian ? "Kualitas setara pasar, harga tidak" : "Kualitas mendekati pasar, harga jauh di bawahnya",
      text: `Rating Google ${decimal(reputation.sanghyang)} di peringkat ${reputation.rank} dari ${reputation.total} hotel bintang 4 (median ${decimal(reputation.median)}). Selisih kualitas kecil tidak sebanding dengan selisih harga, sehingga ada ruang menaikkan harga.`,
    });
  }
  if (feedback.complaints.length) {
    diagnosis.push({
      icon: "🛠️",
      title: "Keluhan nyata harus dibereskan sebelum harga naik",
      text: `${feedback.complaints.length} dari ${feedback.total} ulasan terbaru yang terverifikasi bernilai 3 ke bawah, antara lain soal kebersihan kamar, kondisi bangunan, dan respons staf. Menaikkan harga tanpa perbaikan ini berisiko menurunkan rating.`,
    });
  }
  if (parityGaps.length) {
    const g = parityGaps[0];
    diagnosis.push({
      icon: "🔀",
      title: "Harga tidak konsisten antar OTA",
      text: `${KIND_LABEL[g.kind]} ${STAY_LABEL[g.stay]} dijual ${rupiah(g.min)}–${rupiah(g.max)} di ${g.providers.join(" & ")} untuk tanggal yang sama. Tamu melihat harga termurah, sehingga posisi harga ditentukan kanal paling murah.`,
    });
  }
  if (discountedPromos.length) {
    diagnosis.push({
      icon: "🏷️",
      title: "Kompetitor sedang berpromo diskon",
      text: `${discountedPromos.map((p) => `${p.name} diskon hingga ${p.discount}%`).join(", ")}. Membalas dengan diskon kamar membuat harga bersih Sanghyang makin jauh di bawah pasar bintang 4.`,
    });
  }

  const example = summaries
    .map((s) => ({ s, promo: phase2PromoDiscount(s.weekday, deepest) }))
    .find(({ s, promo }) => s.weekday.phase2 && s.weekday.floor !== null && promo !== null && promo > 0 && s.kind !== "lowest");

  return {
    reputation,
    deepestCompetitorDiscount: deepest,
    diagnosis,
    phase2Requirements: [
      reputation
        ? `Rating Google ≥ ${decimal(reputation.median)} (median hotel bintang 4; sekarang ${decimal(reputation.sanghyang)}): hasil Pilar 2.`
        : "Rating Google naik setelah keluhan di Pilar 2 dituntaskan.",
      ...(breakEven !== undefined ? [`Okupansi setelah Fase 1 tidak turun lebih dari ${breakEven.toLocaleString("id-ID")}% (batas aman omset).`] : []),
      "Harga tiap tipe kamar sudah sama di semua OTA (Pilar 5).",
    ],
    reputationSteps: [
      "Tuntaskan keluhan di atas sebelum Fase 2: daftar periksa housekeeping harian, perawatan bangunan dan kolam, serta SOP respons staf.",
      "Balas setiap ulasan negatif di Google & OTA maksimal 1×24 jam dengan solusi konkret, bukan template.",
      reputation
        ? `Minta ulasan dari tamu puas saat check-out (QR Google Review) untuk mendorong rating ke ≥ ${decimal(reputation.median)}.`
        : "Minta ulasan dari tamu puas saat check-out (QR Google Review).",
    ],
    roomPromos,
    phase2Example:
      example && example.s.weekday.phase2 && example.promo !== null && example.s.weekday.floor !== null
        ? {
            room: example.s.room,
            publish: example.s.weekday.phase2.publish,
            promo: example.promo,
            net: netAfterDiscount(example.s.weekday.phase2.publish, example.promo),
            floor: example.s.weekday.floor,
          }
        : null,
    valueAddOnlyRooms: summaries.filter((s) => s.weekday.phase2 && s.weekday.phase2.maxDiscountPercent === 0).map((s) => s.room),
    parityLines: parityGaps.map((g) => `${KIND_LABEL[g.kind]} ${STAY_LABEL[g.stay]}: ${rupiah(g.min)}–${rupiah(g.max)} (${g.offers} penawaran, ${g.providers.join(", ")})`),
    channelSteps: [
      "Samakan harga tiap tipe kamar di semua OTA lewat channel manager; tutup penawaran yang lebih murah dari harga Fase 1.",
      "Reservasi langsung (WhatsApp/website) memakai harga yang sama dengan OTA plus nilai tambah (voucher Hot Spring Aquamedic, late check-out), bukan potongan harga.",
      "Perbarui listing OTA per tipe kamar: foto kamar terbaru, deskripsi Hot Spring Aquamedic dan fasilitas resmi, serta balasan ulasan agar konversi tetap naik saat harga naik.",
    ],
    kpi: `Harga bersih tiap tipe kamar ≥ lantai di semua OTA · okupansi tidak turun >${breakEven !== undefined ? `${breakEven.toLocaleString("id-ID")}%` : " batas aman"} · rating Google ${reputation ? `menuju ≥ ${decimal(reputation.median)}` : "naik"} · selisih harga kamar yang sama antar OTA = Rp 0.`,
  };
}
