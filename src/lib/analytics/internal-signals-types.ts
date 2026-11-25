/**
 * Kontrak tipe sinyal operasional internal VHP yang aman untuk klien, Knowledge Graph,
 * rekomendasi strategi, prompt AI, dan PDF.
 *
 * ZERO RUPIAH LEAK BY TYPE CONTRACT:
 * Tidak ada satu pun field nominal rupiah (omset, target rupiah, lodging, ARR, atau nilai transaksi)
 * di dalam tipe ini. Seluruh metrik keuangan hanya dinyatakan sebagai persentase, arah, rasio,
 * status progres, atau peringkat.
 */
import type { OutletKey } from "../market/outlet-filters";

export type PerformanceStatus = "tercapai" | "on_track" | "tertinggal";
export type TargetScope = "outlet" | "gabungan_dbar_dbc";

export interface InternalPerformanceSignal {
  /** Bulan pengukuran utama (YYYY-MM). */
  month: string;
  /** Tanggal data VHP terakhir pada bulan pengukuran (YYYY-MM-DD). */
  dataThrough: string;
  /** Pertumbuhan terhadap tanggal setara bulan sebelumnya (%); null bila belum ada pembanding. */
  momGrowthPct: number | null;
  /** Capaian terhadap target bulanan (%); null bila belum ada target aktif (> 0). */
  targetAchievementPct: number | null;
  /** Sumber target: baris tabel outlet_targets ("db"), standar bawaan mergeTargets ("bawaan"), atau null. */
  targetSource: "db" | "bawaan" | null;
  /** Target berdiri sendiri untuk outlet ini atau target gabungan d'Bar Karaoke & DBC. */
  targetScope: TargetScope;
  /** Kontribusi terhadap total 6 outlet utama pada periode yang sama (%). */
  contributionSharePct: number | null;
  /** Khusus dragon-beach-club dan dbar: porsi dari total menu gabungan d'Bar Karaoke & DBC (%). */
  dbarPartSharePct?: number | null;
  /** Khusus dragon-beach-club dan dbar: porsi diskon gabungan terhadap penjualan menu bruto (%). */
  dbarDiscountPct?: number | null;
  /** Jumlah hari beroperasi dengan transaksi tercatat pada bulan berjalan. */
  openDays?: number | null;
  /** Status progres dibanding laju kalender bulan berjalan. */
  status: PerformanceStatus | null;
}

export interface InternalResortStaySignal {
  /** Okupansi (OCC %) pada bulan berjalan: kamar terjual / (61 × malam terdata) × 100. */
  occPct: number | null;
  /** Okupansi pada periode tanggal setara bulan sebelumnya (%). */
  prevOccPct: number | null;
  /** Selisih okupansi dalam poin persentase (occPct - prevOccPct). */
  occDeltaPts: number | null;
  /** Selisih okupansi Sanghyang terhadap TPK hotel bintang Banten BPS (poin persentase). */
  tpkGapPts: number | null;
  /** Jumlah malam yang tercatat di F/O Journal pada periode aktif. */
  nightsObserved: number;
  /** Porsi malam kamar dari segmen retail (FIT + WALK IN + FIT-TA) terhadap total kamar terjual (%). */
  retailSegmentsOccSharePct: number | null;
  /** Rasio malam kamar tamu langsung (FIT + WALK IN) dibanding OTA (FIT-TA); null bila OTA = 0. */
  directVsOtaRatio: number | null;
  /** Komposisi malam kamar per kelompok segmen (%). */
  segmentMixPct: {
    fit: number;
    walkIn: number;
    ota: number;
    corp: number;
    other: number;
  };
  /** Sebaran tipe kamar dalam persentase malam kamar dan porsi kontribusi kamar (tanpa nominal rupiah). */
  roomTypesByShare: {
    code: string | null;
    name: string;
    nightsSharePct: number;
    revenueSharePct: number;
  }[];
}

export interface InternalMenuHealthSignal {
  /** Tanggal data POS terakhir yang dibaca (YYYY-MM-DD). */
  lastDataDay: string;
  /** Daftar menu unggulan berdasarkan porsi kontribusi penjualan POS (%) tanpa rupiah. */
  topMenus: {
    description: string;
    qty: number;
    salesSharePct: number;
  }[];
  /** Jumlah menu lambat (1–5 porsi dalam 90 hari terakhir, sudah bukan menu baru 30 hari). */
  slowMenuCount: number;
  /** Jumlah menu mati (pernah terjual dalam 12 bulan terakhir, 0 porsi dalam 90 hari terakhir). */
  deadMenuCount: number;
  /** Sampel menu dengan porsi paling sedikit dalam 90 hari terakhir. */
  slowestSamples: {
    description: string;
    windowQty: number;
    lastSold: string;
    lastQty?: number;
  }[];
  /** Sampel menu tanpa penjualan selama 90 hari terakhir. */
  deadSamples: {
    description: string;
    lastSold: string;
  }[];
}

export interface InternalPromoAuditSignal {
  totalAudited: number;
  naikCount: number;
  naikTipisCount: number;
  tidakNaikCount: number;
  sedikitCount: number;
  menungguDataCount: number;
  topLifts: { title: string; keyword: string; qtyPct: number | null; postDate: string }[];
  noLiftSamples: { title: string; keyword: string; qtyPct: number | null; postDate: string }[];
}

export interface InternalAcquisitionSignal {
  waClosingCount: number;
  waTotalChats: number | null;
  waClosingRatePct: number | null;
  periodRange: { from: string; to: string } | null;
  adsContactDeltaPct: number | null;
  campaignVerdicts: { campaign: string; guests: number; verdict: string }[];
}

export interface InternalOutletSignals {
  outletKey: OutletKey;
  source: "vhp";
  dataThrough: string | null;
  performance: InternalPerformanceSignal | null;
  resortStay: InternalResortStaySignal | null;
  menuHealth: InternalMenuHealthSignal | null;
  promoAudit: InternalPromoAuditSignal | null;
  acquisition: InternalAcquisitionSignal | null;
}

export type InternalOutletSignalsMap = Record<OutletKey, InternalOutletSignals>;
