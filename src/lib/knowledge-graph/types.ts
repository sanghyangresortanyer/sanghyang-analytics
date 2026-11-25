import type { InternalOutletSignalsMap } from "../analytics/internal-signals-types";

/**
 * Bentuk data graf pengetahuan terpadu lintas seluruh modul aplikasi Sanghyang Analytics.
 * Setiap simpul data membawa sumber, waktu pengamatan, modul aplikasi terkait, dan bobot;
 * setiap relasi membawa bobot kekuatan (`weight`) serta rincian faktor pembentuknya (`factors`).
 */
export const APP_MODULES = [
  "operasional",
  "dashboard",
  "direksi",
  "market-intelligence",
  "galeri-kompetitor",
  "marketing-sosmed",
  "omset-strategi",
] as const;
export type AppModuleKey = (typeof APP_MODULES)[number];

export const APP_MODULE_META: Record<
  AppModuleKey,
  { label: string; shortLabel: string; href: string; description: string }
> = {
  operasional: {
    label: "Operasional VHP",
    shortLabel: "Operasional",
    href: "/",
    description: "Sinyal kinerja harian VHP (capaian target %, MoM %, okupansi OCC, kesehatan menu, dan audit promo) tanpa nominal rupiah",
  },
  dashboard: {
    label: "Ringkasan",
    shortLabel: "Ringkasan",
    href: "/dashboard",
    description: "Ikhtisar performa 6 outlet, ulasan tamu, berita kawasan, dan sinyal pasar",
  },
  direksi: {
    label: "Untuk Direksi",
    shortLabel: "Direksi",
    href: "/direksi",
    description: "Evaluasi tarif kamar OTA + status sarapan, koridor P25/median, dan perbandingan harga menu",
  },
  "market-intelligence": {
    label: "Insight Pasar",
    shortLabel: "Insight Pasar",
    href: "/market-intelligence",
    description: "Daftar kompetitor holistik 6 outlet, ulasan, matriks harga, dan radar promo & event",
  },
  "galeri-kompetitor": {
    label: "Galeri Kompetitor",
    shortLabel: "Galeri",
    href: "/galeri-kompetitor",
    description: "Wawasan visual, galeri foto terverifikasi, gaya desain, dan fasilitas fisik",
  },
  "marketing-sosmed": {
    label: "Media Sosial",
    shortLabel: "Sosmed",
    href: "/marketing-sosmed",
    description: "Performa akun resmi Instagram & TikTok, interaksi, dan kualitas konten",
  },
  "omset-strategi": {
    label: "Target & Strategi",
    shortLabel: "Strategi",
    href: "/marketing?bagian=strategy",
    description: "Target bulanan (/pengaturan), potret performa, dan strategi tanggapan promo",
  },
};

export const NODE_KINDS = [
  "outlet",
  "kamar",
  "promo-sanghyang",
  "event-sanghyang",
  "pesaing",
  "acuan",
  "dikeluarkan",
  "promo",
  "event",
  "tema",
  "berita",
  "statistik",
  "operasional",
  "strategi",
  "fasilitas",
  "visual",
  "menu",
  "sosmed",
  "sumber",
  "kawasan",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const DATA_KINDS: readonly NodeKind[] = [
  "outlet",
  "kamar",
  "promo-sanghyang",
  "event-sanghyang",
  "pesaing",
  "acuan",
  "dikeluarkan",
  "promo",
  "event",
  "tema",
  "berita",
  "statistik",
  "operasional",
  "strategi",
  "fasilitas",
  "visual",
  "menu",
  "sosmed",
];

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  outlet: "Outlet Sanghyang",
  kamar: "Tipe Kamar Resmi",
  "promo-sanghyang": "Promo Sanghyang",
  "event-sanghyang": "Event Sanghyang",
  pesaing: "Kompetitor Inti",
  acuan: "Kompetitor Acuan",
  dikeluarkan: "Dikeluarkan",
  promo: "Promo Kompetitor",
  event: "Event Kompetitor",
  tema: "Tema Ulasan",
  berita: "Berita Kawasan",
  statistik: "Tarif OTA & Statistik Pasar",
  operasional: "Sinyal Operasional VHP",
  strategi: "Strategi & Target",
  fasilitas: "Fasilitas & Kamar",
  visual: "Gaya Visual & Galeri",
  menu: "Harga Menu & F&B",
  sosmed: "Media Sosial (IG & TikTok)",
  sumber: "Platform Sumber",
  kawasan: "Kawasan",
};

export interface GraphSource {
  label: string;
  /** null untuk sumber tanpa tautan publik, misalnya impor pembukuan pemilik. */
  url: string | null;
}

/** Satu dimensi pembentuk bobot holistik atau kekuatan relasi graf (0–100). */
export interface GraphLinkFactor {
  key: string;
  label: string;
  /** Skor dimensi pada skala 0–100. */
  score: number;
  /** Proporsi bobot dimensi (0–1). */
  weight: number;
  detail?: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  detail: string[];
  sources: GraphSource[];
  observedAt: string | null;
  /** Kunci outlet Sanghyang yang terkait, untuk fokus per outlet. */
  outlets: string[];
  /** Ukuran simpul di tampilan 3D. */
  weight: number;
  /** Modul aplikasi yang terhubung ke simpul ini. */
  modules?: AppModuleKey[];
  /** Tautan langsung ke halaman modul aplikasi terkait. */
  href?: string;
  /** Skor relevansi holistik (0–100) untuk simpul kompetitor. */
  holisticScore?: number | null;
  /** Rincian faktor bobot holistik (jarak, konsep, menu, fasilitas, reputasi, harga). */
  holisticFactors?: GraphLinkFactor[];
}

export interface GraphLink {
  source: string;
  target: string;
  label: string;
  /** Bobot kekuatan relasi (0–100) untuk analisis sintesis dan ketebalan garis 3D. */
  weight?: number;
  /** Rincian faktor pembentuk bobot relasi. */
  factors?: GraphLinkFactor[];
  /** Modul aplikasi yang memanfaatkan relasi ini. */
  modules?: AppModuleKey[];
}

export interface KnowledgeGraphModuleSummary {
  module: AppModuleKey;
  label: string;
  shortLabel: string;
  href: string;
  nodeCount: number;
  linkCount: number;
  avgLinkWeight: number | null;
}

export interface KnowledgeGraph {
  generatedAt: string;
  range?: { from: string; to: string; label: string } | null;
  nodes: GraphNode[];
  links: GraphLink[];
  /** Ringkasan keterhubungan simpul dan relasi lintas seluruh modul aplikasi. */
  moduleSummary?: KnowledgeGraphModuleSummary[];
  /** Sinyal operasional VHP terabstraksi per outlet (tanpa nominal rupiah). */
  internalSignals?: InternalOutletSignalsMap | null;
}
