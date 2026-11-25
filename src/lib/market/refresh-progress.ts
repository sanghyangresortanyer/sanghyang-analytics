/**
 * Progres "Perbarui Semua Data" per langkah, dibagi antara proses pembaruan (full-refresh.ts), API tombol,
 * dan aliran SSE yang dibaca halaman. Disimpan di memori proses (globalThis) karena pembaruan lokal berjalan di
 * proses server yang sama; di Vercel pembaruan berjalan di GitHub Actions dan statusnya dibaca dari ScrapeRun.
 */
import { EventEmitter } from "node:events";

export type RefreshStepStatus = "menunggu" | "berjalan" | "berhasil" | "sebagian" | "gagal" | "dilewati";

export interface RefreshStep {
  key: RefreshStepKey;
  label: string;
  status: RefreshStepStatus;
  /** Ringkasan satu kalimat untuk tim pemasaran, tanpa galat teknis mentah. */
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RefreshState {
  origin: "lokal" | "github";
  startedAt: string;
  finishedAt: string | null;
  failed: boolean | null;
  steps: RefreshStep[];
}

export const REFRESH_STEPS = [
  { key: "berita", label: "Berita kawasan Anyer (Google News)" },
  { key: "tarif", label: "Tarif kamar kompetitor 14 malam & sarapan (Google Hotels)" },
  { key: "ulasan", label: "Ulasan kompetitor semua outlet (Google Travel dan Google Maps)" },
  { key: "sosmed", label: "Postingan media sosial kompetitor" },
  { key: "promo", label: "Status promo dan acara kompetitor" },
  { key: "situs", label: "Promo dan event di situs resmi kompetitor" },
  { key: "rating", label: "Rating dan ulasan 6 outlet Sanghyang (Google Maps)" },
  { key: "penandaan", label: "Penandaan outlet di ulasan resort" },
  { key: "makro", label: "Tingkat hunian hotel bintang Banten (BPS)" },
] as const;

/** Langkah dinamis tambahan untuk pembaruan spesifikasi kamar, daftar menu kompetitor, & klasifikasi holistik. */
export const DYNAMIC_REFRESH_STEPS = [
  { key: "tipe_kamar", label: "Spesifikasi tipe kamar & luas (situs resmi & OTA)" },
  { key: "menu_pesaing", label: "Daftar menu & harga kompetitor (F&B, Bar, Spa)" },
  { key: "klasifikasi_kompetitor", label: "Klasifikasi & verifikasi kompetitor holistik (6 outlet)" },
  { key: "analisis_graf", label: "Analisis kesimpulan dari Knowledge Graph (6 outlet)" },
] as const;

export const ALL_REFRESH_STEPS = [...REFRESH_STEPS, ...DYNAMIC_REFRESH_STEPS] as const;

export type RefreshStepKey = (typeof ALL_REFRESH_STEPS)[number]["key"];

interface Store {
  state: RefreshState | null;
  events: EventEmitter;
}

const holder = globalThis as unknown as { __sanghyangRefresh?: Store };

function store(): Store {
  holder.__sanghyangRefresh ??= { state: null, events: new EventEmitter() };
  return holder.__sanghyangRefresh;
}

const snapshot = (state: RefreshState): RefreshState => structuredClone(state);

export function currentRefresh(): RefreshState | null {
  const { state } = store();
  return state ? snapshot(state) : null;
}

export const isRefreshRunning = () => {
  const { state } = store();
  return state !== null && state.finishedAt === null;
};

export function beginRefresh(origin: RefreshState["origin"]): RefreshState {
  const s = store();
  s.state = {
    origin,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    failed: null,
    steps: REFRESH_STEPS.map((step) => ({ ...step, status: "menunggu", detail: null, startedAt: null, finishedAt: null })),
  };
  s.events.emit("update", snapshot(s.state));
  return snapshot(s.state);
}

export function updateStep(key: RefreshStepKey, status: RefreshStepStatus, detail: string | null = null) {
  const s = store();
  if (!s.state) return;
  let step = s.state.steps.find((x) => x.key === key);
  if (!step) {
    const dynamicMeta = DYNAMIC_REFRESH_STEPS.find((x) => x.key === key);
    if (!dynamicMeta) return;
    step = { ...dynamicMeta, status: "menunggu", detail: null, startedAt: null, finishedAt: null };
    s.state.steps.push(step);
  }
  const now = new Date().toISOString();
  if (status === "berjalan") step.startedAt = now;
  else step.finishedAt = now;
  step.status = status;
  step.detail = detail;
  s.events.emit("update", snapshot(s.state));
}

/** Menutup progres; langkah yang belum selesai ditandai gagal, dan satu langkah gagal membuat pembaruan berstatus gagal. */
export function endRefresh(failed: boolean) {
  const s = store();
  if (!s.state) return;
  s.state.finishedAt = new Date().toISOString();
  for (const step of s.state.steps) {
    if (step.status === "menunggu" || step.status === "berjalan") {
      step.status = "gagal";
      step.detail ??= "Langkah berhenti sebelum selesai.";
    }
  }
  s.state.failed = failed || s.state.steps.some((step) => step.status === "gagal");
  s.events.emit("update", snapshot(s.state));
}

/** Berlangganan perubahan progres; kembalikan fungsi untuk berhenti berlangganan. */
export function subscribeRefresh(listener: (state: RefreshState) => void): () => void {
  const { events } = store();
  events.on("update", listener);
  return () => events.off("update", listener);
}

/** Pelapor progres yang diteruskan ke runFullRefresh; versi kosong dipakai GitHub Actions dan tes. */
export interface RefreshReporter {
  step(key: RefreshStepKey, status: RefreshStepStatus, detail?: string | null): void;
}

export const storeReporter: RefreshReporter = {
  step: (key, status, detail = null) => updateStep(key, status, detail),
};

export const silentReporter: RefreshReporter = { step: () => undefined };
