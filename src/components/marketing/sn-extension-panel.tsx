"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  SkipForward,
  X,
} from "lucide-react";
import {
  classifyExtensionTargetStatus,
  computeExtensionProgressPercent,
  formatExtensionPhaseProgress,
  formatExtensionTargetCounts,
  socialExtensionClient,
  summarizeExtensionTargets,
  type SharedSyncSnapshot,
  type SocialExtensionState,
} from "@/lib/marketing/social-extension-client";
import { cn } from "@/lib/utils";

export const EXTENSION_DOWNLOAD_URL = "/api/admin/social-extension/download";
const COLLAPSED_ERRORS_LIMIT = 3;
const COLLAPSED_TARGETS_LIMIT = 3;

function formatPlatformLabel(platform: string | null | undefined): string | null {
  if (!platform) return null;
  const p = platform.toLowerCase();
  if (p === "instagram") return "Instagram";
  if (p === "tiktok") return "TikTok";
  return platform;
}

export interface UseSocialExtensionSyncResult {
  checking: boolean;
  extensionInstalled: boolean;
  extensionVersion: string | null;
  requiredVersion: string | null;
  needsUpdate: boolean;
  assetsMissing: boolean;
  isIncognito: boolean;
  incognitoWarning: string | null;
  state: SocialExtensionState | null;
  savingBatch: boolean;
  savedPostsTotal: number;
  savedCommentsTotal: number;
  error: string | null;
  refreshDetection: () => Promise<boolean>;
  startSync: (options?: { maxPostsPerTarget?: number; outletKey?: string; platform?: "instagram" | "tiktok" }) => Promise<void>;
  resumeSync: () => Promise<void>;
  skipTarget: () => Promise<void>;
  focusPausedTab: () => Promise<void>;
  cancelSync: () => Promise<void>;
  flushPending: () => Promise<void>;
}

export function useSocialExtensionSync(onSynced?: () => void): UseSocialExtensionSyncResult {
  const [snap, setSnap] = useState<SharedSyncSnapshot>(() => socialExtensionClient.getSnapshot());

  useEffect(() => socialExtensionClient.subscribe(setSnap, onSynced), [onSynced]);

  return {
    checking: snap.checking,
    extensionInstalled: snap.extensionInstalled,
    extensionVersion: snap.extensionVersion,
    requiredVersion: snap.requiredVersion,
    needsUpdate: snap.needsUpdate,
    assetsMissing: snap.assetsMissing,
    isIncognito: snap.isIncognito,
    incognitoWarning: snap.incognitoWarning,
    state: snap.state,
    savingBatch: snap.savingBatch,
    savedPostsTotal: snap.savedPostsTotal,
    savedCommentsTotal: snap.savedCommentsTotal,
    error: snap.error,
    refreshDetection: socialExtensionClient.refreshDetection,
    startSync: socialExtensionClient.startSync,
    resumeSync: socialExtensionClient.resumeSync,
    skipTarget: socialExtensionClient.skipTarget,
    focusPausedTab: socialExtensionClient.focusPausedTab,
    cancelSync: socialExtensionClient.cancelSync,
    flushPending: socialExtensionClient.flushPending,
  };
}

/**
 * Panel status dan kendali Ekstensi Chrome Sanghyang Analytics Sync.
 * Mendeteksi ekstensi terpasang lewat chrome.runtime, mengunduh arsip ZIP dari server lokal,
 * dan menjalankan sinkronisasi Instagram serta TikTok langsung dari sesi peramban pengguna.
 */
export function SnExtensionPanel({
  sync,
  compact = false,
  outletKey,
  outletLabel,
}: {
  sync: UseSocialExtensionSyncResult;
  compact?: boolean;
  outletKey?: string;
  outletLabel?: string;
}) {
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [targetsExpanded, setTargetsExpanded] = useState(false);

  const s = sync.state;
  const paused = s?.status === "needs_human_action";
  const running = s?.status === "running" || sync.savingBatch;
  const done = s?.status === "completed";
  const canSyncSingleOutlet = Boolean(outletKey && outletKey !== "all");
  const incognitoAlert =
    sync.incognitoWarning ??
    s?.incognitoWarning ??
    (sync.isIncognito || s?.workerIncognito || s?.isIncognito || s?.pausedKind === "incognito"
      ? "Peramban sedang berada di mode Incognito tanpa sesi login Instagram/TikTok, sehingga daftar postingan dibatasi sekitar 12 item per akun. Buka halaman ini di jendela Chrome biasa yang sudah masuk ke Instagram dan TikTok."
      : null);

  const allErrors = s?.errors ?? [];
  const visibleErrors = errorsExpanded ? allErrors : allErrors.slice(0, COLLAPSED_ERRORS_LIMIT);
  const hiddenErrorCount = Math.max(0, allErrors.length - COLLAPSED_ERRORS_LIMIT);

  const targetResults = Array.isArray(s?.targetResults) ? s.targetResults : [];
  const { okCount, bottomCount, issueCount, issueTargets, bottomTargets } = summarizeExtensionTargets(targetResults);
  const previewTargets = targetsExpanded
    ? targetResults
    : issueTargets.length > 0
      ? issueTargets.slice(0, COLLAPSED_TARGETS_LIMIT)
      : bottomTargets.slice(0, COLLAPSED_TARGETS_LIMIT);
  const activePlatformLabel = formatPlatformLabel(s?.currentTargetPlatform);
  const activePhaseLabel = formatExtensionPhaseProgress(s);
  const progressPct = computeExtensionProgressPercent(s);
  const activeHandleSuffix =
    s?.currentTargetHandle && !(s.currentTargetName ?? "").toLowerCase().includes(s.currentTargetHandle.replace(/^@/, "").toLowerCase())
      ? ` (@${s.currentTargetHandle.replace(/^@/, "")})`
      : "";

  const resumeLabel =
    s?.pausedKind === "rate_limit"
      ? "Sudah Tunggu Jeda · Lanjutkan"
      : s?.pausedKind === "error_page"
        ? "Sudah Dimuat Ulang · Lanjutkan"
        : s?.pausedKind === "incognito"
          ? "Sudah Buka Chrome Biasa · Lanjutkan"
          : "Sudah Selesai Login / CAPTCHA · Lanjutkan";

  return (
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-2xl border p-3.5 text-xs break-words",
        paused ? "border-amber-400 bg-amber-50 text-amber-950" : "border-cream-300 bg-cream-50 text-navy-900",
        compact ? "space-y-2" : "space-y-2.5",
      )}
    >
      <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 max-w-full flex-1 space-y-0.5">
          <div className="flex min-w-0 items-start gap-1.5 font-semibold text-navy-900">
            {running && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-navy-800" aria-hidden />}
            {paused && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />}
            {done && !paused && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />}
            <span className="min-w-0 break-words">
              Sinkronisasi Instagram &amp; TikTok (Ekstensi Chrome
              {sync.extensionInstalled && sync.extensionVersion ? ` v${sync.extensionVersion}` : ""})
            </span>
          </div>

          {!sync.extensionInstalled && !sync.checking && (
            <p className="break-words text-[11px] leading-relaxed text-navy-600">
              Ekstensi Chrome belum terpasang di peramban ini. Unduh paket ekstensi (.zip), ekstrak ke folder tetap
              (misalnya di Dokumen), lalu muat lewat{" "}
              <code className="rounded bg-cream-200 px-1 py-0.5 text-[10px] text-navy-900">chrome://extensions</code>{" "}
              (Mode Developer / Load unpacked). Jangan hapus atau pindahkan folder itu selama ekstensi dipakai.
            </p>
          )}

          {sync.extensionInstalled && sync.needsUpdate && (
            <div
              role="alert"
              className="mt-1 min-w-0 max-w-full overflow-hidden rounded-xl border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-950 break-words [overflow-wrap:anywhere]"
            >
              <p className="font-semibold">
                {sync.assetsMissing
                  ? "Folder ekstensi di komputer tidak ditemukan."
                  : `Ekstensi perlu diperbarui${sync.requiredVersion ? ` ke v${sync.requiredVersion}` : ""}.`}
              </p>
              {sync.error && <p className="mt-0.5 break-words [overflow-wrap:anywhere] text-navy-700">{sync.error}</p>}
            </div>
          )}
        </div>

        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          {!sync.extensionInstalled || sync.needsUpdate ? (
            <>
              <a
                href={EXTENSION_DOWNLOAD_URL}
                download
                className="skeuo-pill-dark inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                <span>
                  {sync.needsUpdate && sync.requiredVersion ? `Unduh v${sync.requiredVersion} (.zip)` : "Unduh Ekstensi (.zip)"}
                </span>
              </a>
              <button
                type="button"
                onClick={() => void sync.refreshDetection()}
                className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                <span>Cek Ulang</span>
              </button>
            </>
          ) : running ? (
            <button
              type="button"
              onClick={() => void sync.cancelSync()}
              className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold"
            >
              <X className="h-3 w-3" aria-hidden />
              <span>Hentikan</span>
            </button>
          ) : paused ? null : (
            <>
              {canSyncSingleOutlet && (
                <button
                  type="button"
                  onClick={() => void sync.startSync({ outletKey })}
                  className="skeuo-pill-light inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  <span>Sinkron {outletLabel ?? "Outlet Ini"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void sync.startSync()}
                className="skeuo-pill-dark inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                <span>{canSyncSingleOutlet ? "Sinkron Semua Akun" : "Sinkron Sosmed via Chrome"}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {incognitoAlert && !paused && (
        <div
          role="status"
          className="flex min-w-0 max-w-full items-start gap-2 overflow-hidden rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
          <p className="min-w-0 flex-1 break-words leading-relaxed">{incognitoAlert}</p>
        </div>
      )}

      {running && s && (
        <div className="min-w-0 max-w-full space-y-1.5 text-[11px] text-navy-600">
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
              <span>Akun aktif:</span>
              {activePlatformLabel && (
                <span className="shrink-0 rounded-full border border-cream-300 bg-white px-2 py-0.5 text-[10px] font-bold text-navy-800">
                  {activePlatformLabel}
                </span>
              )}
              <strong className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-navy-900">
                {s.currentTargetName ?? "Mempersiapkan…"}
                {activeHandleSuffix}
              </strong>
            </span>
            <span className="min-w-0 max-w-full whitespace-normal break-words">
              {s.completedTargets}/{s.totalTargets} akun selesai · {s.syncedPostsCount.toLocaleString("id-ID")} postingan diproses ·{" "}
              {s.syncedCommentsCount.toLocaleString("id-ID")} komentar
            </span>
          </div>
          {activePhaseLabel && (
            <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2 overflow-hidden rounded-lg border border-cream-200 bg-white/80 px-2.5 py-1.5 text-[11px]">
              <span className="min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] font-semibold leading-snug text-navy-800">
                {activePhaseLabel}
              </span>
              {sync.savingBatch && (
                <span className="min-w-0 whitespace-normal break-words text-[10px] font-medium text-navy-600">
                  Menyimpan ke basis data lokal…
                </span>
              )}
            </div>
          )}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-cream-200">
            <div
              className="h-full bg-navy-800 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {paused && s && (
        <div className="min-w-0 max-w-full space-y-2 overflow-hidden rounded-xl border border-amber-300 bg-white p-2.5 text-[11px] break-words [overflow-wrap:anywhere]">
          <p className="break-words font-semibold text-amber-900">
            Terjeda di {s.pausedTargetName ?? "halaman media sosial"}:
          </p>
          <p className="break-words [overflow-wrap:anywhere] leading-relaxed text-navy-800">{s.pausedReason}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void sync.focusPausedTab()}
              className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
            >
              <ExternalLink className="h-3 w-3" aria-hidden />
              <span>Buka Tab Verifikasi</span>
            </button>
            <button
              type="button"
              onClick={() => void sync.resumeSync()}
              className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
            >
              <Play className="h-3 w-3" aria-hidden />
              <span>{resumeLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => void sync.skipTarget()}
              className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
            >
              <SkipForward className="h-3 w-3" aria-hidden />
              <span>Lewati Akun Ini</span>
            </button>
            <button
              type="button"
              onClick={() => void sync.cancelSync()}
              className="rounded-full px-2 py-1 text-xs text-navy-600 hover:underline"
            >
              Batalkan
            </button>
          </div>
        </div>
      )}

      {done && !paused && s && (
        <div className="min-w-0 max-w-full space-y-1.5 text-[11px] break-words">
          <p className={cn("min-w-0 max-w-full whitespace-normal break-words", s.pendingCount > 0 ? "text-amber-900" : "text-emerald-800")}>
            Sinkronisasi selesai ({s.completedTargets}/{s.totalTargets} akun):{" "}
            {sync.savedPostsTotal > 0 ? (
              <>
                {sync.savedPostsTotal.toLocaleString("id-ID")} postingan tersimpan ke basis data lokal,{" "}
                {sync.savedCommentsTotal.toLocaleString("id-ID")} komentar diproses.
              </>
            ) : (
              <>
                {s.syncedPostsCount.toLocaleString("id-ID")} postingan diamati
                {s.finalizedOnServer ? " (tersimpan di basis data lokal)" : " (belum terkirim ke basis data)"}, {" "}
                {s.syncedCommentsCount.toLocaleString("id-ID")} komentar diproses.
              </>
            )}
          </p>
          {s.pendingCount > 0 && (
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-amber-900">
              <span className="min-w-0 break-words">{s.pendingCount.toLocaleString("id-ID")} postingan di antrean ekstensi belum masuk basis data.</span>
              <button
                type="button"
                onClick={() => void sync.flushPending()}
                className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-950 hover:bg-amber-200"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                <span>Kirim Antrean ({s.pendingCount})</span>
              </button>
            </div>
          )}
        </div>
      )}

      {targetResults.length > 0 && (
        <div
          role="status"
          className={cn(
            "min-w-0 max-w-full space-y-1.5 overflow-hidden rounded-xl border px-3 py-2 text-[11px]",
            issueCount > 0
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-cream-300 bg-white text-navy-800",
          )}
        >
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 max-w-full flex-1 break-words font-semibold">
              {issueCount > 0
                ? `Ringkasan per akun: ${okCount} lengkap${bottomCount > 0 ? ` · ${bottomCount} batas bawah` : ""} · ${issueCount} sebagian / tertahan (dari ${targetResults.length} akun)`
                : bottomCount > 0
                  ? `Ringkasan per akun: ${okCount} lengkap · ${bottomCount} batas bawah (gulir selesai; selisih dari angka header platform)`
                  : `Ringkasan per akun: ${targetResults.length} akun lengkap diperiksa`}
            </p>
            <button
              type="button"
              aria-expanded={targetsExpanded}
              onClick={() => setTargetsExpanded((v) => !v)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold",
                issueCount > 0
                  ? "border-amber-400 bg-white text-amber-950 hover:bg-amber-100"
                  : "border-cream-300 bg-cream-50 text-navy-800 hover:bg-cream-100",
              )}
            >
              {targetsExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" aria-hidden />
                  Ringkas per akun
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" aria-hidden />
                  Lihat rincian ({targetResults.length})
                </>
              )}
            </button>
          </div>
          {previewTargets.length > 0 && (
            <ul className="min-w-0 max-w-full space-y-1 overflow-hidden">
              {previewTargets.map((item, idx) => {
                const plat = formatPlatformLabel(item.platform);
                const badge = classifyExtensionTargetStatus(item);
                const countLabel = formatExtensionTargetCounts(item);
                const effectiveCollected =
                  typeof item.profileCollected === "number" && item.profileCollected >= 0
                    ? item.profileCollected
                    : item.collected;
                const severeShortfall =
                  typeof item.expected === "number" &&
                  item.expected >= 50 &&
                  typeof effectiveCollected === "number" &&
                  effectiveCollected < Math.floor(item.expected * 0.5);
                const detailReason =
                  item.reason?.trim() ||
                  item.note?.trim() ||
                  (badge.isBottomReached
                    ? "Gulir mencapai batas bawah profil; selisih berasal dari angka header platform."
                    : item.rateLimited === true && badge.isIssue
                      ? "Permintaan sempat dibatasi sementara oleh platform; ulangi sinkronisasi setelah jeda singkat."
                      : item.hasNextPage === true
                        ? "Platform masih menandakan halaman berikutnya tersedia; gulir berhenti sebelum selesai."
                        : badge.kind === "partial" && severeShortfall
                          ? "Baru terbaca sebagian kecil dari total postingan profil; ulangi sinkronisasi untuk akun ini."
                          : null);
                const handleText = item.handle ? `@${item.handle.replace(/^@/, "")}` : null;
                const displayName = item.name || handleText || `Akun #${idx + 1}`;
                const showHandle = handleText && !displayName.toLowerCase().includes(handleText.slice(1).toLowerCase());
                return (
                  <li
                    key={item.targetKey ?? `${item.platform ?? "soc"}-${item.handle ?? idx}`}
                    className="min-w-0 max-w-full overflow-hidden rounded-lg border border-cream-200 bg-white/90 px-2.5 py-2 text-navy-900"
                  >
                    <div className="flex min-w-0 max-w-full items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 break-words">
                        {plat && (
                          <span className="shrink-0 rounded bg-cream-100 px-1.5 py-0.5 text-[10px] font-bold text-navy-700">
                            {plat}
                          </span>
                        )}
                        <span className="min-w-0 break-words [overflow-wrap:anywhere] font-semibold leading-snug">
                          {displayName}
                          {showHandle ? ` (${handleText})` : ""}
                        </span>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", badge.className)}>
                        {badge.label}
                      </span>
                    </div>
                    {(countLabel || detailReason) && (
                      <div className="mt-1 min-w-0 max-w-full space-y-0.5">
                        {countLabel && (
                          <p className="min-w-0 max-w-full whitespace-normal break-words text-[11px] leading-snug text-navy-600">
                            {countLabel}
                          </p>
                        )}
                        {detailReason && (
                          <p className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-[10px] leading-snug text-navy-600">
                            {detailReason}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!targetsExpanded && issueTargets.length > COLLAPSED_TARGETS_LIMIT && (
            <p className="break-words text-[10px] opacity-80">
              …dan {issueTargets.length - COLLAPSED_TARGETS_LIMIT} akun lainnya belum lengkap. Klik &ldquo;Lihat rincian&rdquo; untuk membaca semua.
            </p>
          )}
          {!targetsExpanded && issueTargets.length === 0 && bottomTargets.length > COLLAPSED_TARGETS_LIMIT && (
            <p className="break-words text-[10px] opacity-80">
              …dan {bottomTargets.length - COLLAPSED_TARGETS_LIMIT} akun batas bawah lainnya. Klik &ldquo;Lihat rincian&rdquo; untuk membaca semua.
            </p>
          )}
        </div>
      )}

      {allErrors.length > 0 && (
        <div
          role="status"
          className="min-w-0 max-w-full space-y-1.5 overflow-hidden rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950"
        >
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 break-words font-semibold">
              {allErrors.length} catatan sinkronisasi belum lengkap / terkendala:
            </p>
            {hiddenErrorCount > 0 && (
              <button
                type="button"
                aria-expanded={errorsExpanded}
                onClick={() => setErrorsExpanded((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-amber-950 hover:bg-amber-100"
              >
                {errorsExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" aria-hidden />
                    Ringkas catatan
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" aria-hidden />
                    Tampilkan semua ({allErrors.length})
                  </>
                )}
              </button>
            )}
          </div>
          <ul className="min-w-0 max-w-full list-disc space-y-0.5 overflow-hidden pl-4 leading-relaxed break-words [overflow-wrap:anywhere]">
            {visibleErrors.map((msg, idx) => (
              <li key={`${idx}-${msg.slice(0, 32)}`} className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
                {msg}
              </li>
            ))}
          </ul>
          {!errorsExpanded && hiddenErrorCount > 0 && (
            <p className="break-words text-[10px] opacity-80">
              …dan {hiddenErrorCount} catatan lainnya. Klik &ldquo;Tampilkan semua&rdquo; untuk membaca seluruh daftar akun.
            </p>
          )}
        </div>
      )}

      {sync.error && !(sync.extensionInstalled && sync.needsUpdate) && (
        <p role="alert" className="min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-[11px] font-medium text-red-700">
          {sync.error}
        </p>
      )}
    </div>
  );
}
