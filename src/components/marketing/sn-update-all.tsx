"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  CloudUpload,
  Loader2,
  MinusCircle,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import {
  JOB_LABEL,
  REFRESH_CHANNEL,
  countVerdicts,
  describeCounts,
  followRefresh,
  friendlyScrapeIssue,
  isRefreshEnded,
  refreshHeadline,
  resolveDisplayRefreshSteps,
  type FollowEvent,
  type RefreshEnded,
  type RefreshState,
  type RefreshStepStatus,
} from "@/lib/marketing/refresh-follow";
import {
  SESSION_EXPIRED_MESSAGE,
  formatMarketingClientError,
  marketingApiErrorFromResponse,
} from "@/lib/marketing/market-intelligence-types";
import { SnExtensionPanel, useSocialExtensionSync, type UseSocialExtensionSyncResult } from "./sn-extension-panel";

const PROGRESS_URL = "/api/admin/scraping/progress";

export type ProgressLink =
  | { kind: "diam" }
  | { kind: "tersambung" }
  | { kind: "menyambung"; note: string }
  | { kind: "terputus"; note: string };

type PanelInfo = { manualRunAvailable: boolean; refresh: RefreshState | null };

type JobStatus = {
  job: string;
  status: "success" | "partial" | "failed" | "running" | "never_run" | "skipped";
  lastRun: { finishedAt: string | null; itemsSaved: number } | null;
  recentErrors: Array<{ id: string; message: string }>;
};

const JOB_TONE: Record<JobStatus["status"], { label: string; className: string }> = {
  success: { label: "Berhasil", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  partial: { label: "Sebagian", className: "border-amber-200 bg-amber-50 text-amber-800" },
  failed: { label: "Gagal", className: "border-red-200 bg-red-50 text-red-800" },
  running: { label: "Berjalan", className: "border-sky-200 bg-sky-50 text-sky-800" },
  never_run: { label: "Belum pernah", className: "border-cream-300 bg-cream-100 text-navy-600" },
  skipped: { label: "Dilewati", className: "border-cream-300 bg-cream-100 text-navy-600" },
};

const STEP_ICON: Record<RefreshStepStatus, { icon: typeof Circle; className: string; label: string }> = {
  menunggu: { icon: Circle, className: "text-navy-400", label: "Menunggu" },
  berjalan: { icon: Loader2, className: "animate-spin text-navy-800", label: "Berjalan" },
  berhasil: { icon: CheckCircle2, className: "text-emerald-700", label: "Berhasil" },
  sebagian: { icon: AlertTriangle, className: "text-amber-600", label: "Sebagian" },
  gagal: { icon: XCircle, className: "text-red-700", label: "Gagal" },
  dilewati: { icon: MinusCircle, className: "text-navy-500", label: "Dilewati" },
};

const wib = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) + " WIB";

const endedFrom = (state: RefreshState, lost: boolean): RefreshEnded => ({
  type: "pembaruan-berakhir",
  startedAt: state.startedAt,
  finishedAt: state.finishedAt,
  failed: state.failed,
  lost,
});

function announce(ended: RefreshEnded) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(REFRESH_CHANNEL);
  channel.postMessage(ended);
  channel.close();
}

function useRefreshEnded(onEnded: (ended: RefreshEnded) => void) {
  const handled = useRef(new Set<string>());
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const deliver = useCallback((ended: RefreshEnded) => {
    if (handled.current.has(ended.startedAt)) return;
    handled.current.add(ended.startedAt);
    onEndedRef.current(ended);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(REFRESH_CHANNEL);
    channel.onmessage = (message: MessageEvent<unknown>) => {
      if (isRefreshEnded(message.data)) deliver(message.data);
    };
    return () => channel.close();
  }, [deliver]);

  return deliver;
}

function useRefreshProgress(url: string, onEnded: (ended: RefreshEnded) => void) {
  const [progress, setProgress] = useState<RefreshState | null>(null);
  const [link, setLink] = useState<ProgressLink>({ kind: "diam" });
  const stopRef = useRef<(() => void) | null>(null);
  const deliver = useRefreshEnded(onEnded);

  const follow = useCallback(
    (startedAt?: string) => {
      stopRef.current?.();
      const finished = (state: RefreshState) => {
        setProgress(state);
        setLink({ kind: "diam" });
        const ended = endedFrom(state, false);
        deliver(ended);
        announce(ended);
      };
      stopRef.current = followRefresh(url, (event: FollowEvent) => {
        switch (event.type) {
          case "keadaan":
            setProgress(event.state);
            setLink({ kind: "tersambung" });
            return;
          case "lama":
            if (startedAt && event.state.startedAt === startedAt) return finished(event.state);
            setProgress(event.state);
            setLink({ kind: "diam" });
            return;
          case "kosong":
            setLink({ kind: "diam" });
            return;
          case "selesai":
            return finished(event.state);
          case "hilang": {
            setLink({
              kind: "terputus",
              note: "Server lokal tidak lagi menyimpan status pembaruan ini (kemungkinan dimulai ulang). Hasil per sumber ada di Rincian pembaruan terakhir.",
            });
            const ended = endedFrom(event.last, true);
            deliver(ended);
            announce(ended);
            return;
          }
          case "menyambung":
            setLink({
              kind: "menyambung",
              note: `Sambungan progres terputus (${event.reason}); menyambung ulang dalam ${Math.ceil(event.delayMs / 1000)} detik.`,
            });
            return;
          case "berhenti":
            setLink({
              kind: "terputus",
              note:
                event.reason === "server menjawab 401"
                  ? SESSION_EXPIRED_MESSAGE
                  : `Progres tidak dapat diikuti (${event.reason}). Muat ulang halaman lalu periksa server lokal.`,
            });
            return;
        }
      });
    },
    [url, deliver],
  );

  useEffect(() => {
    follow();
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [follow]);

  return { progress, link, follow };
}

export function RefreshProgressPanel({
  progress,
  link,
  extSync,
  onClose,
}: {
  progress: RefreshState | null;
  link: ProgressLink;
  extSync: UseSocialExtensionSyncResult;
  onClose: () => void;
}) {
  const lost = link.kind === "terputus";
  const displaySteps = progress ? resolveDisplayRefreshSteps(progress.steps, extSync, progress.startedAt) : [];
  const extActive =
    extSync.state?.status === "running" ||
    extSync.savingBatch ||
    extSync.state?.status === "needs_human_action";
  const effectiveFinishedAt = progress?.finishedAt && !extActive ? progress.finishedAt : null;

  return (
    <div className="skeuo-card absolute right-0 z-30 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] overflow-x-hidden p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-navy-900">
            {progress
              ? lost
                ? "Status pembaruan terputus"
                : refreshHeadline({ finishedAt: effectiveFinishedAt, steps: displaySteps })
              : "Sinkronisasi Media Sosial Chrome"}
          </p>
          {progress && (
            <p className="break-words text-xs text-navy-600">
              Mulai {wib(progress.startedAt)}
              {effectiveFinishedAt ? ` · ${describeCounts(countVerdicts(displaySteps))}` : ""}
            </p>
          )}
          {(link.kind === "menyambung" || link.kind === "terputus") && (
            <p role="status" className="mt-1 break-words [overflow-wrap:anywhere] text-xs text-amber-800">
              {link.note}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup panel progres"
          className="shrink-0 rounded-full p-1 text-navy-600 hover:bg-cream-200"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {progress && (
        <ol className="mt-3 max-h-72 min-w-0 space-y-2 overflow-y-auto overflow-x-hidden pr-1">
          {displaySteps.map((step) => {
            const meta = STEP_ICON[step.status];
            const Icon = meta.icon;
            return (
              <li key={step.key} className="flex min-w-0 max-w-full gap-2 text-xs">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} aria-label={meta.label} />
                <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                  <p className="break-words font-semibold text-navy-900">{step.label}</p>
                  {step.detail && <p className="break-words [overflow-wrap:anywhere] text-navy-600">{step.detail}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {(extSync.extensionInstalled || extSync.state?.status === "needs_human_action") && (
        <div className={progress ? "mt-3 min-w-0 max-w-full" : "mt-2 min-w-0 max-w-full"}>
          <SnExtensionPanel sync={extSync} compact />
        </div>
      )}
    </div>
  );
}

/**
 * Tombol "Perbarui Semua Data" lengkap dengan dialog konfirmasi 6 outlet, panel Ekstensi Chrome,
 * pembaruan lokal SSE (13 langkah), dan pemicu otomatis sinkronisasi Ekstensi Chrome bila terpasang.
 */
export function SnUpdateAllButton({ onFinished }: { onFinished: () => void }) {
  const [info, setInfo] = useState<PanelInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const { progress, link, follow } = useRefreshProgress(PROGRESS_URL, onFinished);
  const extSync = useSocialExtensionSync(onFinished);
  const showProgressPanel =
    (panelOpen && Boolean(progress || extSync.state)) || extSync.state?.status === "needs_human_action";

  useEffect(() => {
    let live = true;
    fetch("/api/admin/scraping", { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as (PanelInfo & { error?: string }) | null;
        if (!r.ok || !json) throw marketingApiErrorFromResponse(r.status, json?.error);
        return json;
      })
      .then((json) => {
        if (!live) return;
        setInfo({ manualRunAvailable: json.manualRunAvailable, refresh: json.refresh });
        if (json.refresh && !json.refresh.finishedAt) setPanelOpen(true);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(formatMarketingClientError(err, (detail) => `Status pembaruan lokal tidak dapat dibaca (${detail}).`));
      });
    return () => {
      live = false;
    };
  }, []);

  const lost = link.kind === "terputus";
  const extRunning = extSync.state?.status === "running" || extSync.state?.status === "needs_human_action";
  const running = (Boolean(progress && !progress.finishedAt) && !lost) || extRunning;

  const start = async () => {
    if (!info) return;
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      // Di mode lokal selalu menjalankan local-all ke DB PostgreSQL lokal (tidak pernah memicu remote production).
      const job = info.manualRunAvailable ? "local-all" : "remote";
      const res = await fetch("/api/admin/scraping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; refresh?: RefreshState };
      if (!res.ok) throw marketingApiErrorFromResponse(res.status, json.error);
      setConfirming(false);
      if (job === "local-all") {
        setPanelOpen(true);
        follow(json.refresh?.startedAt);
      } else {
        setMessage("Permintaan dikirim ke antrean pembaruan. Data baru masuk setelah proses selesai.");
      }
      if (extSync.extensionInstalled) {
        setPanelOpen(true);
        void extSync.startSync();
      }
    } catch (err) {
      setError(formatMarketingClientError(err, (detail) => `Pembaruan belum bisa dimulai: ${detail}`));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (running ? setPanelOpen(true) : setConfirming((v) => !v))}
        disabled={!info || sending}
        aria-expanded={confirming || panelOpen}
        className="skeuo-pill-dark inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-50"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        <span>{running ? "Sedang memperbarui…" : "Perbarui Semua Data"}</span>
      </button>

      {confirming && !running && (
        <div
          role="dialog"
          aria-label="Konfirmasi pembaruan data"
          className="skeuo-card absolute right-0 z-30 mt-2 w-[23rem] max-w-[calc(100vw-2rem)] overflow-x-hidden p-4 text-sm"
        >
          <p className="font-semibold text-navy-900">Perbarui semua data (6 outlet) sekarang?</p>
          <p className="mt-1.5 text-xs leading-relaxed text-navy-600">
            {info?.manualRunAvailable
              ? "Komputer lokal ini akan memperbarui seluruh 6 outlet (Kamar & Resort, Sunset Grill, Dragon Beach Club, D'Bistro, D'Bar & Karaoke, D'Spa & Hot Spring) ke PostgreSQL lokal: berita, tarif OTA 14 malam & sarapan, spesifikasi kamar, menu kompetitor, ulasan, promo/event, klasifikasi kompetitor holistik, serta rating outlet."
              : "Server akan menjalankan pembaruan menyeluruh lintas 6 outlet yang sama dengan jadwal malam."}
          </p>

          <div className="mt-2.5 min-w-0 max-w-full">
            <SnExtensionPanel sync={extSync} compact />
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="skeuo-pill-light rounded-full px-3.5 py-1.5 text-xs font-semibold"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => void start()}
              disabled={sending}
              className="skeuo-pill-dark inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CloudUpload className="h-3.5 w-3.5" aria-hidden />}
              Mulai
            </button>
          </div>
        </div>
      )}

      {(message || error) && (
        <p role="status" className={`mt-2 max-w-sm text-xs ${error ? "text-red-700" : "text-emerald-800"}`}>
          {error ?? message}
        </p>
      )}

      {showProgressPanel && (
        <RefreshProgressPanel progress={progress} link={link} extSync={extSync} onClose={() => setPanelOpen(false)} />
      )}
    </div>
  );
}

/** Rincian pembaruan terakhir per sumber (`/api/admin/scraping/status`) dengan bahasa awam. */
export function SnLastUpdateDetails() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useRefreshEnded(
    useCallback(() => {
      setJobs(null);
      setError(null);
    }, []),
  );

  useEffect(() => {
    if (!open || jobs) return;
    let live = true;
    fetch("/api/admin/scraping/status", { cache: "no-store" })
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as ({ jobs?: JobStatus[]; error?: string }) | null;
        if (!r.ok || !json || !Array.isArray(json.jobs)) throw marketingApiErrorFromResponse(r.status, json?.error);
        return { jobs: json.jobs };
      })
      .then((json) => {
        if (live) setJobs(json.jobs.filter((j) => j.status !== "never_run"));
      })
      .catch((err: unknown) => {
        if (live) setError(formatMarketingClientError(err, (detail) => `Rincian tidak dapat dimuat (${detail}).`));
      });
    return () => {
      live = false;
    };
  }, [open, jobs]);

  const count = (status: JobStatus["status"]) => jobs?.filter((j) => j.status === status).length ?? 0;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-semibold text-navy-800 hover:underline"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        Rincian pembaruan terakhir
      </button>
      {open && (
        <div className="mt-2 max-w-3xl overflow-x-hidden rounded-2xl border border-cream-300 bg-white p-3.5 shadow-xs">
          {error && <p className="break-words text-red-700">{error}</p>}
          {!jobs && !error && <p className="text-navy-600">Memuat…</p>}
          {jobs && (
            <>
              <p className="mb-2 text-navy-600">
                {count("success")} dari {jobs.length} sumber berhasil
                {count("skipped") ? `, ${count("skipped")} dilewati` : ""} pada pembaruan terakhir.
              </p>
              <ul className="space-y-2">
                {jobs.map((j) => (
                  <li key={j.job} className="flex min-w-0 flex-wrap items-start gap-2">
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${JOB_TONE[j.status].className}`}>
                      {JOB_TONE[j.status].label}
                    </span>
                    <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
                      <p className="font-semibold text-navy-900">
                        {JOB_LABEL[j.job] ?? j.job}
                        {j.lastRun?.finishedAt ? <span className="font-normal text-navy-500"> · {wib(j.lastRun.finishedAt)}</span> : null}
                      </p>
                      {j.status !== "success" && j.recentErrors.length > 0 && (
                        <ul className="mt-0.5 min-w-0 list-disc pl-4 text-navy-600 break-words [overflow-wrap:anywhere]">
                          {[...new Set(j.recentErrors.map((e) => friendlyScrapeIssue(e.message)))].slice(0, 6).map((line) => (
                            <li key={line} className="break-words [overflow-wrap:anywhere]">
                              {line}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
