/**
 * Evaluasi harga kamar untuk halaman Untuk Direksi. Semua angka diturunkan dari analisa tarif OTA yang sama dengan
 * Insight Pasar (resort-room-rates.ts): koridor pasar bintang 4 per jenis kamar, rekomendasi Fase 1 dan Fase 2, lantai
 * harga bersih, dan batas aman okupansi. Tidak ada skenario okupansi asumsi atau tarif dasar yang ditanam.
 */
import type { HotelMatrixEntry, OutletCompetitorMatrix } from "./competitor-matrix";
import { COMPSET_HOTELS, hotelWeightedAdr, isCoreCompetitor } from "./hotel-compset";
import { pricePositionCategory } from "./pricing-rules";
import {
  breakEvenOccupancyDropPercent,
  buildRoomRateSummaries,
  KIND_LABEL,
  percentile,
  resortPhase1PriceLiftPercent,
  resortPricePositioningIndex,
  RESORT_ROOM_RATE_SOURCE,
  RESORT_ROOM_RATES_ALL,
  sanghyangRateParity,
  type RoomRateSummary,
  type Stay,
} from "./resort-room-rates";
import type { ExecutiveBreakfastHotelRow, ExecutiveBreakfastStatus, ExecutiveBreakfastSummary } from "./resort-strategy";

export interface ExecutiveDirective {
  title: string;
  detail: string;
}

export interface RoomPricingExecutiveSummary {
  headline: string;
  ratesCapturedAt: string;
  sanghyangAdr: number | null;
  compsetResortAvgAdr: number | null;
  compsetHotelAvgAdr: number | null;
  pricePositioningIndex: number;
  ppiCategory: ReturnType<typeof pricePositionCategory>;
  phase1LiftPercent: number;
  breakEvenDropPercent: number;
  roomsBelowMarket: number;
  roomsTotal: number;
  directives: ExecutiveDirective[];
}

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const average = (list: number[]) => (list.length ? Math.round(list.reduce((s, x) => s + x, 0) / list.length) : null);

function adrAverage(group: "resort" | "hotel"): number | null {
  const adrs = COMPSET_HOTELS.filter((h) => isCoreCompetitor(h) && h.group === group && h.hotelId !== "sanghyang")
    .map((h) => hotelWeightedAdr(h.hotelId))
    .filter((a): a is number => a !== null && a > 0);
  return average(adrs);
}

/** Arahan rapat yang diturunkan dari koridor harga, lantai bersih, dan selisih harga antar OTA. */
function directives(summaries: RoomRateSummary[]): ExecutiveDirective[] {
  const out: ExecutiveDirective[] = [];
  const below = summaries.filter((s) => s.weekday.position === "DI_BAWAH_PASAR" && s.weekday.phase1 && s.weekday.sanghyang !== null);
  if (below.length) {
    out.push({
      title: "Bawa harga kamar ke dalam koridor pasar bintang 4 (Fase 1)",
      detail: below
        .map((s) => `${s.room} hari biasa ${rp(s.weekday.sanghyang as number)} → ${rp(s.weekday.phase1!.publish)} (${s.weekday.phase1!.changePercent > 0 ? "+" : ""}${s.weekday.phase1!.changePercent.toLocaleString("id-ID")}%)`)
        .join("; "),
    });
  }
  const floors = summaries.filter((s) => s.weekday.floor !== null || s.weekend.floor !== null);
  if (floors.length) {
    out.push({
      title: "Kunci lantai harga bersih setelah promo",
      detail: floors
        .map((s) => `${s.room}: hari biasa ${s.weekday.floor === null ? "belum ada data" : rp(s.weekday.floor)}, akhir pekan ${s.weekend.floor === null ? "belum ada data" : rp(s.weekend.floor)}`)
        .join("; "),
    });
  }
  const parity = sanghyangRateParity()[0];
  if (parity) {
    out.push({
      title: "Samakan harga kamar yang sama di semua OTA",
      detail: `${KIND_LABEL[parity.kind]} ${parity.stay === "weekday" ? "hari biasa" : "akhir pekan"} dijual ${rp(parity.min)}–${rp(parity.max)} di ${parity.providers.join(", ")} untuk tanggal yang sama.`,
    });
  }
  out.push({
    title: "Nilai tambah, bukan potongan harga",
    detail: "Saat kompetitor berpromo, tawarkan nilai tambah yang dijual terpisah, misalnya voucher Hot Spring Aquamedic D'Spa (promo resmi Buy 1 Get 1 Rp 350.000); biayanya dihitung dan disetujui manajemen.",
  });
  return out;
}

export function getRoomPricingExecutiveSummary(): RoomPricingExecutiveSummary {
  const summaries = buildRoomRateSummaries();
  const ppi = resortPricePositioningIndex();
  const lift = resortPhase1PriceLiftPercent(summaries);
  const priced = summaries.filter((s) => s.weekday.sanghyang !== null);
  const below = priced.filter((s) => s.weekday.position === "DI_BAWAH_PASAR").length;
  return {
    headline: `Harga kamar Sanghyang sekitar ${Math.round(ppi)}% dari harga kamar setara di pembanding bintang 4; ${below} dari ${priced.length} jenis kamar di bawah koridor pasar pada hari biasa.`,
    ratesCapturedAt: RESORT_ROOM_RATE_SOURCE.capturedAt,
    sanghyangAdr: hotelWeightedAdr("sanghyang"),
    compsetResortAvgAdr: adrAverage("resort"),
    compsetHotelAvgAdr: adrAverage("hotel"),
    pricePositioningIndex: ppi,
    ppiCategory: pricePositionCategory(ppi),
    phase1LiftPercent: lift,
    breakEvenDropPercent: breakEvenOccupancyDropPercent(lift),
    roomsBelowMarket: below,
    roomsTotal: priced.length,
    directives: directives(summaries),
  };
}

// Evaluasi Direksi dari matriks Insight Pasar: daftar hotel = kompetitor aktif di DB (peran inti/acuan dari DB), harga
// = harga yang tercetak di sub-baris tipe kamar, sarapan = status penawaran per jenis hari. Tidak ada daftar statis.

export interface ExecutiveRoomSummary {
  headline: string;
  ratesNote: string;
  competitorCount: number;
  coreCompetitorCount: number;
  sanghyangAdr: number | null;
  compsetResortAvgAdr: number | null;
  compsetHotelAvgAdr: number | null;
  pricePositioningIndex: number | null;
  ppiCategory: ReturnType<typeof pricePositionCategory> | null;
  phase1LiftPercent: number | null;
  breakEvenDropPercent: number | null;
  roomsBelowMarket: number;
  roomsTotal: number;
  directives: ExecutiveDirective[];
}

export interface ExecutiveRoomEvaluation {
  summary: ExecutiveRoomSummary;
  breakfast: ExecutiveBreakfastSummary;
  /** Nama kompetitor aktif sesuai urutan matriks (tanpa Sanghyang). */
  competitorNames: string[];
  roomSummaries: RoomRateSummary[];
}

const validPrice = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const minOrNull = (values: (number | null | undefined)[]) => {
  const ok = values.filter(validPrice);
  return ok.length ? Math.min(...ok) : null;
};
const medianOrNull = (values: number[]) => {
  if (!values.length) return null;
  return Math.round(percentile([...values].sort((a, b) => a - b), 0.5));
};
const pctGap = (own: number | null, other: number | null) =>
  own !== null && other !== null && own > 0 ? Number((((other - own) / own) * 100).toFixed(1)) : null;

/** ADR terbobot satu minggu (5 malam hari biasa + 2 akhir pekan) dari tarif terendah di baris ringkasan. */
const weightedAdrOf = (h: HotelMatrixEntry): number | null => {
  const wd = h.otaRateWeekdayMin;
  const we = h.otaRateWeekendMin;
  if (wd !== null && we !== null) return Math.round((5 * wd + 2 * we) / 7);
  return wd ?? we;
};

function statusFrom(withBf: number | null, withoutBf: number | null, officialBf: boolean | null): ExecutiveBreakfastStatus {
  if (withBf !== null && withoutBf !== null) return "Tersedia keduanya";
  if (withBf !== null) return "Termasuk sarapan";
  if (withoutBf !== null) return "Tanpa sarapan";
  if (officialBf === true) return "Termasuk sarapan";
  if (officialBf === false) return "Tanpa sarapan";
  return "Belum tercatat";
}

function mergeStatus(a: ExecutiveBreakfastStatus, b: ExecutiveBreakfastStatus): ExecutiveBreakfastStatus {
  if (a === "Tersedia keduanya" || b === "Tersedia keduanya") return "Tersedia keduanya";
  const set = new Set([a, b]);
  if (set.has("Termasuk sarapan") && set.has("Tanpa sarapan")) return "Tersedia keduanya";
  if (set.has("Termasuk sarapan")) return "Termasuk sarapan";
  if (set.has("Tanpa sarapan")) return "Tanpa sarapan";
  return "Belum tercatat";
}

/** Paket dengan dan tanpa sarapan per hotel, diambil dari penawaran yang tercetak di sub-baris matriks. */
export function breakfastParityFromMatrix(entries: HotelMatrixEntry[]): ExecutiveBreakfastSummary {
  const own = entries.find((h) => h.role === "sanghyang") ?? null;
  const raw = entries.map((h) => {
    const rooms = h.roomTypes;
    const officialFlags = rooms.map((rt) => rt.officialRate?.breakfastIncluded ?? null).filter((v): v is boolean => v !== null);
    const officialBf = officialFlags.length && officialFlags.every((v) => v) ? true : officialFlags.length && officialFlags.every((v) => !v) ? false : null;
    const officialWith = (stay: Stay) =>
      rooms.map((rt) => (rt.officialRate?.breakfastIncluded === true ? (stay === "weekday" ? rt.officialRate.weekdayPrice : rt.officialRate.weekendPrice) : null));
    const officialWithout = (stay: Stay) =>
      rooms.map((rt) => (rt.officialRate?.breakfastIncluded === false ? (stay === "weekday" ? rt.officialRate.weekdayPrice : rt.officialRate.weekendPrice) : null));
    const weekdayWithBreakfast = minOrNull([...rooms.map((rt) => rt.otaLowest?.withBreakfastWeekdayPrice), ...officialWith("weekday")]);
    const weekdayWithoutBreakfast = minOrNull([...rooms.map((rt) => rt.otaLowest?.withoutBreakfastWeekdayPrice), ...officialWithout("weekday")]);
    const weekendWithBreakfast = minOrNull([...rooms.map((rt) => rt.otaLowest?.withBreakfastWeekendPrice), ...officialWith("weekend")]);
    const weekendWithoutBreakfast = minOrNull([...rooms.map((rt) => rt.otaLowest?.withoutBreakfastWeekendPrice), ...officialWithout("weekend")]);
    const weekdayStatus = statusFrom(weekdayWithBreakfast, weekdayWithoutBreakfast, officialBf);
    const weekendStatus = statusFrom(weekendWithBreakfast, weekendWithoutBreakfast, officialBf);
    const hasOfferFlag = [weekdayWithBreakfast, weekdayWithoutBreakfast, weekendWithBreakfast, weekendWithoutBreakfast].some((v) => v !== null);
    return {
      hotelId: h.placeId ?? h.competitorId,
      hotelName: h.name,
      isSanghyang: h.role === "sanghyang",
      starRating: h.starRating ?? 0,
      isCoreCompetitor: h.role === "inti",
      weekdayWithBreakfast,
      weekdayWithoutBreakfast,
      weekdayStatus,
      weekdayBreakfastPremium: weekdayWithBreakfast !== null && weekdayWithoutBreakfast !== null ? weekdayWithBreakfast - weekdayWithoutBreakfast : null,
      weekendWithBreakfast,
      weekendWithoutBreakfast,
      weekendStatus,
      weekendBreakfastPremium: weekendWithBreakfast !== null && weekendWithoutBreakfast !== null ? weekendWithBreakfast - weekendWithoutBreakfast : null,
      overallStatus: mergeStatus(weekdayStatus, weekendStatus),
      sourceNote: hasOfferFlag
        ? "Penawaran OTA dan situs resmi di tabel Langkah 3"
        : officialBf !== null
          ? "Keterangan paket di situs resmi"
          : "Status sarapan belum tercantum di penawaran",
    };
  });

  const ownRow = raw.find((r) => r.isSanghyang) ?? null;
  const rows: ExecutiveBreakfastHotelRow[] = raw.map((r) => ({
    ...r,
    gapWithBreakfastWeekdayPct: r.isSanghyang ? null : pctGap(ownRow?.weekdayWithBreakfast ?? null, r.weekdayWithBreakfast),
    gapWithBreakfastWeekendPct: r.isSanghyang ? null : pctGap(ownRow?.weekendWithBreakfast ?? null, r.weekendWithBreakfast),
    gapWithoutBreakfastWeekdayPct: r.isSanghyang ? null : pctGap(ownRow?.weekdayWithoutBreakfast ?? null, r.weekdayWithoutBreakfast),
    gapWithoutBreakfastWeekendPct: r.isSanghyang ? null : pctGap(ownRow?.weekendWithoutBreakfast ?? null, r.weekendWithoutBreakfast),
  }));

  // Pembanding setara: kompetitor inti aktif dengan kelas bintang yang sama dengan Sanghyang.
  const peers = rows.filter((r) => r.isCoreCompetitor && own?.starRating != null && r.starRating === own.starRating);
  const med = (pick: (r: ExecutiveBreakfastHotelRow) => number | null) => medianOrNull(peers.map(pick).filter((n): n is number => n !== null));
  const peerMedianWeekdayWithBreakfast = med((r) => r.weekdayWithBreakfast);
  const peerMedianWeekdayWithoutBreakfast = med((r) => r.weekdayWithoutBreakfast);
  const peerMedianWeekendWithBreakfast = med((r) => r.weekendWithBreakfast);
  const peerMedianWeekendWithoutBreakfast = med((r) => r.weekendWithoutBreakfast);
  const ownWdWith = ownRow?.weekdayWithBreakfast ?? null;
  const ownWdWithout = ownRow?.weekdayWithoutBreakfast ?? null;
  const ownWeWith = ownRow?.weekendWithBreakfast ?? null;
  const ownWeWithout = ownRow?.weekendWithoutBreakfast ?? null;
  const vs = (ownValue: number | null, peer: number | null) =>
    ownValue !== null && peer !== null ? Number((((ownValue - peer) / peer) * 100).toFixed(1)) : null;
  const sanghyangVsPeerWithBreakfastWeekdayPct = vs(ownWdWith, peerMedianWeekdayWithBreakfast);
  const sanghyangVsPeerWithoutBreakfastWeekdayPct = vs(ownWdWithout, peerMedianWeekdayWithoutBreakfast);

  const starText = own?.starRating ? `bintang ${own.starRating}` : "sekelas";
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("id-ID")}%`;
  const bits: string[] = [];
  if (ownWdWith !== null && ownWdWithout !== null) {
    bits.push(`Hari biasa Sanghyang menjual paket tanpa sarapan ${rp(ownWdWithout)} dan termasuk sarapan ${rp(ownWdWith)} (selisih ${rp(ownWdWith - ownWdWithout)}).`);
  }
  if (sanghyangVsPeerWithBreakfastWeekdayPct !== null && peerMedianWeekdayWithBreakfast !== null) {
    bits.push(`Paket termasuk sarapan hari biasa: median ${peers.length} kompetitor inti ${starText} ${rp(peerMedianWeekdayWithBreakfast)} (Sanghyang ${signed(sanghyangVsPeerWithBreakfastWeekdayPct)}).`);
  }
  const weGap = vs(ownWeWith, peerMedianWeekendWithBreakfast);
  if (weGap !== null && peerMedianWeekendWithBreakfast !== null && ownWeWith !== null) {
    bits.push(`Akhir pekan termasuk sarapan: Sanghyang ${rp(ownWeWith)} vs median ${rp(peerMedianWeekendWithBreakfast)} (${signed(weGap)}).`);
  }
  const withBfPeers = peers.filter((r) => r.weekdayWithBreakfast !== null || r.weekendWithBreakfast !== null).length;

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
    executiveNote:
      bits.join(" ") ||
      "Bandingkan tarif termasuk sarapan dengan termasuk sarapan, dan tanpa sarapan dengan tanpa sarapan, agar evaluasi antarhotel setara.",
    parityDirective: {
      title: "Evaluasi tarif berdasarkan kesetaraan paket sarapan",
      detail:
        ownWdWith !== null && ownWdWithout !== null && peerMedianWeekdayWithBreakfast !== null
          ? `${withBfPeers} dari ${peers.length} kompetitor inti ${starText} menampilkan paket termasuk sarapan (median hari biasa ${rp(peerMedianWeekdayWithBreakfast)}). Pisahkan paket tanpa sarapan Sanghyang (${rp(ownWdWithout)}) dari paket termasuk sarapan (${rp(ownWdWith)}) saat menilai rate card.`
          : "Pisahkan pembandingan tarif termasuk sarapan dan tanpa sarapan saat menetapkan koridor rate card di OTA.",
    },
  };
}

export function buildExecutiveRoomEvaluation(matrix: OutletCompetitorMatrix): ExecutiveRoomEvaluation {
  const entries = matrix.hotelEntries ?? [];
  const own = entries.find((h) => h.role === "sanghyang") ?? null;
  const competitors = entries.filter((h) => h.role !== "sanghyang");
  const corePlaceIds = new Set(competitors.filter((h) => h.role === "inti" && h.placeId).map((h) => h.placeId as string));
  const activePlaceIds = new Set(competitors.filter((h) => h.placeId).map((h) => h.placeId as string));
  const isPricing = (hotelId: string) => corePlaceIds.has(hotelId);

  // Baris tarif per jenis kamar dari crawl yang sama, hanya untuk hotel aktif; koridor hanya dari kompetitor inti.
  const rows = RESORT_ROOM_RATES_ALL.filter((r) => activePlaceIds.has(r.hotelId));
  const roomSummaries = buildRoomRateSummaries(rows, isPricing);

  const ratios = rows
    .filter((r) => r.cluster === "KLASTER_I_BINTANG_4" && isPricing(r.hotelId))
    .flatMap((r) => [r.weekday, r.weekend])
    .filter((d): d is { sanghyang: number; competitor: number } => d.sanghyang !== null && d.competitor !== null)
    .map((d) => (d.sanghyang / d.competitor) * 100)
    .sort((a, b) => a - b);
  const ppi = ratios.length ? Number(percentile(ratios, 0.5).toFixed(1)) : null;

  const lowest = roomSummaries.find((s) => s.kind === "lowest");
  const wk = lowest?.weekday.phase1;
  const we = lowest?.weekend.phase1;
  const lift = wk && we ? Number(((wk.changePercent * 5 + we.changePercent * 2) / 7).toFixed(1)) : null;

  const groupAdr = (group: "resort" | "hotel") => {
    const adrs = competitors
      .filter((h) => h.role === "inti" && h.specs?.category === group)
      .map(weightedAdrOf)
      .filter((a): a is number => a !== null);
    return average(adrs);
  };

  const priced = roomSummaries.filter((s) => s.weekday.sanghyang !== null);
  const below = priced.filter((s) => s.weekday.position === "DI_BAWAH_PASAR").length;
  const coreCount = corePlaceIds.size;
  const headline =
    ppi !== null
      ? `Harga kamar Sanghyang sekitar ${Math.round(ppi)}% dari harga kamar setara di ${coreCount} kompetitor inti aktif; ${below} dari ${priced.length} jenis kamar di bawah koridor pasar pada hari biasa.`
      : `Belum ada pasangan harga kamar Sanghyang dan ${coreCount} kompetitor inti aktif pada crawl yang sama, jadi indeks harga belum bisa dihitung.`;

  return {
    summary: {
      headline,
      ratesNote: matrix.ratesWindowNote ?? "",
      competitorCount: competitors.length,
      coreCompetitorCount: coreCount,
      sanghyangAdr: own ? weightedAdrOf(own) : null,
      compsetResortAvgAdr: groupAdr("resort"),
      compsetHotelAvgAdr: groupAdr("hotel"),
      pricePositioningIndex: ppi,
      ppiCategory: ppi !== null ? pricePositionCategory(ppi) : null,
      phase1LiftPercent: lift,
      breakEvenDropPercent: lift !== null ? breakEvenOccupancyDropPercent(lift) : null,
      roomsBelowMarket: below,
      roomsTotal: priced.length,
      directives: directives(roomSummaries),
    },
    breakfast: breakfastParityFromMatrix(entries),
    competitorNames: competitors.map((h) => h.name),
    roomSummaries,
  };
}
