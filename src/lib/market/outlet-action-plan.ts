/**
 * Rekomendasi per outlet untuk bagian "Apa yang ingin dicapai" di halaman Omset, Target dan Strategy. Setiap butir
 * menyebut faktornya (kata tamu, rating, harga atau pasar, promo Sanghyang, promo kompetitor, berita) dan temuan dari
 * data summary, lalu usulan langkahnya. Tidak ada angka target karangan: yang tidak ada datanya tidak dijadikan rekomendasi.
 */
import type { InternalOutletSignals } from "@/lib/analytics/internal-signals-types";
import type { OutletKey, SnSummary as Summary } from "@/lib/marketing/market-intelligence-types";
import { officialMenu } from "./official-menu";
import { promosForOutlet } from "./outlet-filters";
import {
  classifyPromoOrEvent,
  isOwnPromoItem,
  ownPromoSourceSummary,
  ownPromosForOutlet,
  type PromoPlatform,
} from "./promo-radar";
import { rupiahRange } from "./menu-format";

export interface ActionItem {
  factor: "Operasional" | "Kata tamu" | "Rating" | "Harga" | "Pasar" | "Promo Sanghyang" | "Promo kompetitor" | "Berita";
  finding: string;
  action: string;
}

/** Format pertumbuhan MoM tanpa memunculkan angka persen >100% yang menyesatkan di ringkasan singkat. */
function formatGrowthPhrase(momGrowthPct: number): string {
  if (momGrowthPct > 100) {
    const mult = (1 + momGrowthPct / 100).toLocaleString("id-ID", { maximumFractionDigits: 1 });
    return `naik ${mult}x dibanding periode setara bulan lalu`;
  }
  if (momGrowthPct < 0) {
    return `turun ${Math.abs(Math.round(momGrowthPct))}% dibanding periode setara bulan lalu`;
  }
  return `naik ${Math.round(momGrowthPct)}% dibanding periode setara bulan lalu`;
}

/** Format capaian target bulanan tanpa memunculkan persen >100% atau nominal rupiah. */
function formatTargetPhrase(achievedPct: number, scope: "outlet" | "gabungan_dbar_dbc"): string {
  const scopeLabel = scope === "gabungan_dbar_dbc" ? "target gabungan d'Bar & DBC" : "target bulanan";
  if (achievedPct > 100) return `${scopeLabel} telah terlampaui (di atas 100%)`;
  return `capaian ${Math.round(achievedPct)}% dari ${scopeLabel}`;
}

export function buildInternalOperationalActionItems(sig: InternalOutletSignals | null | undefined, outletName: string): ActionItem[] {
  if (!sig) return [];
  const items: ActionItem[] = [];

  if (sig.performance) {
    const perf = sig.performance;
    const parts: string[] = [];
    if (perf.targetAchievementPct !== null) {
      parts.push(formatTargetPhrase(perf.targetAchievementPct, perf.targetScope));
    }
    if (perf.momGrowthPct !== null) {
      parts.push(formatGrowthPhrase(perf.momGrowthPct));
    }
    if (perf.contributionSharePct !== null) {
      parts.push(`menyumbang ${Math.round(perf.contributionSharePct)}% total 6 outlet`);
    }
    if (perf.dbarPartSharePct != null) {
      parts.push(`porsi ${Math.round(perf.dbarPartSharePct)}% di gabungan d'Bar & DBC`);
    }
    if (parts.length > 0) {
      items.push({
        factor: "Operasional",
        finding: `Sinyal VHP ${outletName} (s.d. ${perf.dataThrough}): ${parts.join(", ")}.`,
        action:
          perf.status === "tertinggal" || (perf.momGrowthPct !== null && perf.momGrowthPct < 0)
            ? `Fokuskan promo bernilai tambah dan dorong kunjungan hari biasa untuk mempercepat laju capaian ${outletName} tanpa memotong harga bersih di bawah P25.`
            : `Pertahankan ritme operasional ${outletName} dan arahkan penjualan silang ke outlet Sanghyang lain yang lajunya masih tertinggal.`,
      });
    }
  }

  const resortOccPct = sig.resortStay?.occPct;
  if (sig.resortStay && resortOccPct !== null && resortOccPct !== undefined) {
    const stay = sig.resortStay;
    const topRoom = stay.roomTypesByShare[0];
    const lowRoom = stay.roomTypesByShare.length > 1 ? stay.roomTypesByShare[stay.roomTypesByShare.length - 1] : null;
    items.push({
      factor: "Operasional",
      finding: `Okupansi VHP ${Math.round(resortOccPct)}% (${stay.nightsObserved} malam${stay.tpkGapPts !== null ? `, selisih ${stay.tpkGapPts >= 0 ? "+" : ""}${Math.round(stay.tpkGapPts)} poin vs TPK BPS` : ""}); segmen OTA ${Math.round(stay.segmentMixPct.ota)}%, Walk-In ${Math.round(stay.segmentMixPct.walkIn)}%, FIT ${Math.round(stay.segmentMixPct.fit)}%${topRoom && lowRoom ? `; terpadat ${topRoom.name}, terendah ${lowRoom.name}` : ""}.`,
      action:
        stay.segmentMixPct.ota >= 50
          ? `Kurangi ketergantungan OTA dengan paket reservasi langsung hari biasa (nilai tambah sarapan/Hot Spring Aquamedic) khusus tipe kamar berokupansi rendah${lowRoom ? ` (${lowRoom.name})` : ""}.`
          : `Jaga bauran tamu langsung dan korporat sambil mempertahankan disiplin lantai harga P25 di seluruh kanal OTA.`,
    });
  }

  if (sig.menuHealth && (sig.menuHealth.slowMenuCount > 0 || sig.menuHealth.deadMenuCount > 0 || sig.menuHealth.topMenus.length > 0)) {
    const mh = sig.menuHealth;
    const top = mh.topMenus[0];
    const slowSample = mh.slowestSamples.slice(0, 2).map((m) => m.description).join(", ");
    items.push({
      factor: "Operasional",
      finding: `Kasir POS VHP ${outletName} (90 hari terakhir): ${mh.slowMenuCount} menu lambat dan ${mh.deadMenuCount} menu mati${top ? `; menu terlaris ${top.description} (${Math.round(top.salesSharePct)}% porsi penjualan)` : ""}.`,
      action:
        mh.slowMenuCount > 0 || mh.deadMenuCount > 0
          ? `Evaluasi atau pangkas menu mati 90 hari, lalu paketkan menu lambat${slowSample ? ` (${slowSample})` : ""} bersama menu terlaris agar perputaran bahan lebih efisien.`
          : `Pertahankan ketersediaan bahan menu terlaris dan jadikan andalan konten promosi bulanan.`,
    });
  }

  if (sig.promoAudit && sig.promoAudit.totalAudited > 0) {
    const pa = sig.promoAudit;
    items.push({
      factor: "Operasional",
      finding: `Audit Promo kasir VHP ${outletName}: ${pa.naikCount} NAIK, ${pa.naikTipisCount} NAIK_TIPIS, dan ${pa.tidakNaikCount} TIDAK_NAIK dari ${pa.totalAudited} promo teraudit.`,
      action:
        pa.topLifts.length > 0
          ? `Ulangi format penawaran yang terbukti NAIK (${pa.topLifts[0].keyword}) dan hentikan mekanisme promo yang tidak menggerakkan porsi.`
          : `Tinjau ulang penawaran dan visibilitas promo di kasir karena belum terlihat kenaikan porsi yang jelas dalam 7 hari setelah tayang.`,
    });
  }

  if (sig.acquisition && (sig.acquisition.waClosingCount > 0 || sig.acquisition.waClosingRatePct !== null)) {
    const acq = sig.acquisition;
    items.push({
      factor: "Operasional",
      finding: `Akuisisi WhatsApp ${outletName}: ${acq.waClosingCount} closing tercatat${acq.waClosingRatePct !== null ? ` (closing rate ${Math.round(acq.waClosingRatePct)}%)` : ""}.`,
      action: `Percepat waktu respons CS WhatsApp dan sertakan rincian fasilitas serta tarif resmi agar tingkat closing reservasi langsung meningkat.`,
    });
  }

  return items;
}

/** Aspek ulasan baru dianggap pola bila disebut paling sedikit dua ulasan. */
const MIN_ASPECT_MENTIONS = 2;
/** Aspek dengan sepertiga sebutan negatif sudah layak diperbaiki lebih dulu (rasio aspek di summary berupa persen 0-100). */
const COMPLAINT_PERCENT = 30;
const MAX_NEWS = 2;

const pct = (percent: number) => `${Math.round(percent)}%`;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const oneDecimal = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function buildOutletActionPlan(summary: Summary, outletKey: string): ActionItem[] {
  const plan: ActionItem[] = [];
  const outlet = summary.outlets.find((o) => o.key === outletKey);
  const outletName = outlet?.name ?? outletKey;
  const rivals = summary.compsetAudit?.[outletKey]?.used ?? [];

  const internalSig = summary.internalSignals?.[outletKey as OutletKey];
  plan.push(...buildInternalOperationalActionItems(internalSig, outletName));

  const aspects = (outlet?.topAspects ?? []).filter((a) => a.count >= MIN_ASPECT_MENTIONS);
  const complaint = [...aspects].sort((a, b) => b.negativeRatio - a.negativeRatio)[0];
  const praise = [...aspects].sort((a, b) => b.positiveRatio - a.positiveRatio)[0];
  if (complaint && complaint.negativeRatio >= COMPLAINT_PERCENT) {
    plan.push({
      factor: "Kata tamu",
      finding: `Aspek yang paling sering dikeluhkan: ${complaint.aspect} (${pct(complaint.negativeRatio)} dari ${complaint.count} ulasan yang menyebutnya bernada negatif).`,
      action: `Perbaiki ${complaint.aspect} lebih dulu, lalu balas ulasan yang menyebutnya supaya calon tamu melihat tindak lanjutnya.`,
    });
  }
  if (praise && praise.positiveRatio > 0) {
    plan.push({
      factor: "Kata tamu",
      finding: `Aspek yang paling dipuji: ${praise.aspect} (${pct(praise.positiveRatio)} dari ${praise.count} ulasan yang menyebutnya bernada positif).`,
      action: `Jadikan ${praise.aspect} pesan utama di konten dan materi promosi bulan ini.`,
    });
  }
  if (!complaint && !praise) {
    const reviewCount = outlet?.sentimentDistribution?.total ? outlet.sentimentDistribution.total : (outlet?.reviewCount ?? 0);
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

  const rivalRatings = rivals.map((c) => c.rating).filter((r): r is number => typeof r === "number");
  if (outlet?.rating != null && rivalRatings.length) {
    const mid = median(rivalRatings);
    plan.push({
      factor: "Rating",
      finding: `Rating Google ${oneDecimal(outlet.rating)} dibanding median kompetitor ${oneDecimal(mid)} (${rivalRatings.length} kompetitor).`,
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
    const ranges = rivals.map((c) => summary.competitorMenus?.[c.name]?.range).filter((r): r is { min: number; max: number } => Boolean(r));
    if (ranges.length) {
      const low = Math.min(...ranges.map((r) => r.min));
      const high = Math.max(...ranges.map((r) => r.max));
      const own = officialMenu(outletKey)?.items.filter((i) => i.unit === "porsi").map((i) => i.price) ?? [];
      const ownText = own.length ? ` Menu resmi ${outletName}: ${rupiahRange(Math.min(...own), Math.max(...own))}.` : "";
      plan.push({
        factor: "Harga",
        finding: `${ranges.length} dari ${rivals.length} kompetitor punya harga per porsi: ${rupiahRange(low, high)}.${ownText}`,
        action: !own.length
          ? `Cantumkan daftar harga resmi ${outletName} di situs supaya bisa dibandingkan dengan kompetitor.`
          : Math.max(...own) > high
            ? "Harga tertinggi Sanghyang di atas semua kompetitor; tonjolkan alasan nilainya (lokasi, porsi, bahan) atau siapkan paket hemat."
            : "Harga Sanghyang masih di dalam rentang kompetitor; bandingkan item yang sama sebelum mengubah harga.",
      });
    }
  }

  // Promo Sanghyang yang berjalan untuk outlet ini (situs resmi dan media sosial resmi), dipetakan dari baris sumbernya.
  const ownLive = ownPromosForOutlet(summary.ownPromos ?? [], outletKey).filter((p) => p.status !== "expired" && classifyPromoOrEvent(p) !== null);
  const ownEventCount = ownLive.filter((p) => classifyPromoOrEvent(p) === "event").length;
  const ownPlatforms: { platform: PromoPlatform }[] = ownLive.map((p) => ({
    platform:
      p.platform === "instagram" || p.platform === "tiktok" || p.platform === "facebook"
        ? p.platform
        : "website",
  }));
  plan.push(
    ownLive.length
      ? {
          factor: "Promo Sanghyang",
          finding: `${ownLive.length - ownEventCount} promo dan ${ownEventCount} event Sanghyang berjalan untuk ${outletName} (sumber: ${ownPromoSourceSummary(ownPlatforms)}).`,
          action: "Pastikan promo yang berjalan tampil sama di situs resmi dan media sosial, lalu bandingkan nilainya dengan promo kompetitor di bagian Strategi promo.",
        }
      : {
          factor: "Promo Sanghyang",
          finding: `Belum ada promo atau event Sanghyang yang berjalan untuk ${outletName} di situs resmi maupun media sosial pada periode ini.`,
          action: "Siapkan satu penawaran yang bisa diumumkan bersamaan di situs resmi dan media sosial outlet ini.",
        },
  );

  const rivalLive = promosForOutlet(summary.competitorSocialRadar ?? [], outletKey).filter(
    (p) => p.status !== "expired" && !isOwnPromoItem(p) && classifyPromoOrEvent(p) !== null,
  );
  const rivalEventCount = rivalLive.filter((p) => classifyPromoOrEvent(p) === "event").length;
  const rivalNames = [...new Set(rivalLive.map((p) => p.competitorName))];
  plan.push(
    rivalLive.length
      ? {
          factor: "Promo kompetitor",
          finding: `${rivalLive.length - rivalEventCount} promo dan ${rivalEventCount} event kompetitor berjalan, antara lain dari ${rivalNames.slice(0, 3).join(", ")}.`,
          action: "Siapkan tanggapan di bagian Strategi promo: tawarkan nilai tambah yang tidak dimiliki kompetitor, bukan sekadar potongan harga.",
        }
      : {
          factor: "Promo kompetitor",
          finding: "Belum ada promo atau event kompetitor yang tertangkap untuk outlet ini di periode ini.",
          action: `Manfaatkan jeda ini untuk kampanye ${outletName} sendiri.`,
        },
  );

  for (const n of (summary.news ?? []).filter((item) => item.outlets.includes(outletKey)).slice(0, MAX_NEWS)) {
    plan.push({
      factor: "Berita",
      finding: `Berita terkait: "${n.title}" (${n.source}).`,
      action: `Kaitkan konten minggu ini dengan topik ini bila relevan untuk tamu ${outletName}.`,
    });
  }
  return plan;
}
