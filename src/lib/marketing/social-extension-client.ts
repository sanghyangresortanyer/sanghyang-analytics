/**
 * Klien jembatan Ekstensi Chrome Sanghyang Analytics Sync untuk halaman Marketing.
 * Menggunakan protokol pesan melalui endpoint lokal `/api/marketing-sosmed/browser-sync`
 * `/api/marketing-sosmed/browser-sync` dan `chrome.runtime.sendMessage`.
 */

export type SocialExtensionPhase =
  | "profile"
  | "reels"
  | "details"
  | "scanning_profile"
  | "scanning_reels"
  | "fetching_details"
  | "cooldown"
  | "idle"
  | string;

export interface SocialExtensionTargetProgress {
  targetKey?: string;
  name?: string;
  handle?: string;
  platform?: "instagram" | "tiktok" | string;
  collected?: number;
  profileCollected?: number | null;
  expected?: number | null;
  saved?: number;
  reelsAdded?: number;
  skippedKnown?: number;
  feedSaved?: number;
  hasNextPage?: boolean | null;
  reachedBottom?: boolean;
  rateLimited?: boolean;
  stoppedBy?: string | null;
  status?:
    | "running"
    | "ok"
    | "bottom_reached"
    | "partial"
    | "incomplete"
    | "empty"
    | "not_found"
    | "skipped"
    | "paused"
    | "blocked"
    | "held"
    | "error"
    | string;
  reason?: string | null;
  note?: string | null;
}

export interface SocialExtensionState {
  status: "idle" | "running" | "needs_human_action" | "completed" | "cancelled";
  runStartedAt: string | null;
  syncRunId?: string | null;
  finalizedOnServer?: boolean;
  totalTargets: number;
  completedTargets: number;
  currentTargetName: string | null;
  currentTargetHandle?: string | null;
  currentTargetPlatform?: "instagram" | "tiktok" | string | null;
  currentTargetCollected?: number | null;
  currentProfileCollected?: number | null;
  currentTargetExpected?: number | null;
  currentPhase?: SocialExtensionPhase | null;
  currentReelsAdded?: number | null;
  currentDetailIndex?: number | null;
  currentDetailTotal?: number | null;
  currentSkippedKnown?: number | null;
  currentFeedSaved?: number | null;
  currentHasNextPage?: boolean | null;
  currentTargetReachedBottom?: boolean | null;
  reachedBottom?: boolean | null;
  pausedReason: string | null;
  pausedKind:
    | "login"
    | "captcha"
    | "incognito"
    | "rate_limit"
    | "error_page"
    | "permission"
    | "unsupported"
    | "extension_reload"
    | null;
  pausedUrl: string | null;
  pausedTargetName: string | null;
  incognitoWarning?: string | null;
  isIncognito?: boolean;
  workerIncognito?: boolean;
  pendingCount: number;
  syncedPostsCount: number;
  syncedCommentsCount: number;
  targetResults?: SocialExtensionTargetProgress[];
  errors: string[];
}

export interface SharedSyncSnapshot {
  checking: boolean;
  extensionInstalled: boolean;
  extensionVersion: string | null;
  requiredVersion: string | null;
  needsUpdate: boolean;
  assetsMissing: boolean;
  isIncognito: boolean;
  incognitoWarning: string | null;
  meta: ExtensionMeta | null;
  state: SocialExtensionState | null;
  savingBatch: boolean;
  savedPostsTotal: number;
  savedCommentsTotal: number;
  error: string | null;
}

interface ChromeRuntimeBridge {
  sendMessage?: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void;
  lastError?: { message?: string };
}

export interface ExtensionTargetItem {
  targetKey?: string;
  targetType?: "own" | "competitor";
  outletKey?: string | null;
  platform?: "instagram" | "tiktok";
  handle?: string;
  name?: string;
  profileUrl?: string;
}

interface ExtensionMeta {
  extensionId: string;
  extensionVersion: string;
  targets: ExtensionTargetItem[];
  allowedHandles: string[];
  knownPostUrls?: string[];
}

function getChromeRuntime(): ChromeRuntimeBridge | null {
  if (typeof window === "undefined") return null;
  const runtime = (window as unknown as { chrome?: { runtime?: ChromeRuntimeBridge } }).chrome?.runtime;
  return runtime && typeof runtime.sendMessage === "function" ? runtime : null;
}

type CallResult<T> = { ok: true; data: T } | { ok: false; reason: string; transportError: boolean };

function callExtensionDetailed<T>(extensionId: string, message: unknown, timeoutMs = 15_000): Promise<CallResult<T>> {
  return new Promise((resolve) => {
    const runtime = getChromeRuntime();
    if (!runtime?.sendMessage || !extensionId) {
      resolve({ ok: false, reason: "Chrome runtime tidak tersedia di tab ini.", transportError: true });
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        reason: `Ekstensi Chrome tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik.`,
        transportError: true,
      });
    }, timeoutMs);
    try {
      runtime.sendMessage(extensionId, message, (reply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (runtime.lastError) {
          resolve({
            ok: false,
            reason: `Koneksi ekstensi Chrome gagal: ${runtime.lastError.message || "koneksi terputus"}`,
            transportError: true,
          });
          return;
        }
        if (!reply || typeof reply !== "object") {
          resolve({ ok: false, reason: "Ekstensi Chrome mengembalikan jawaban kosong.", transportError: true });
          return;
        }
        const obj = reply as { ok?: boolean; error?: string };
        if (obj.ok === false) {
          resolve({ ok: false, reason: obj.error || "Perintah ke ekstensi ditolak.", transportError: false });
          return;
        }
        resolve({ ok: true, data: reply as T });
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        reason: err instanceof Error ? err.message : "Gagal memanggil ekstensi Chrome.",
        transportError: true,
      });
    }
  });
}

async function callExtension<T>(extensionId: string, message: unknown, timeoutMs = 15_000): Promise<T | null> {
  const res = await callExtensionDetailed<T>(extensionId, message, timeoutMs);
  return res.ok ? res.data : null;
}

const snapshot: SharedSyncSnapshot = {
  checking: true,
  extensionInstalled: false,
  extensionVersion: null,
  requiredVersion: null,
  needsUpdate: false,
  assetsMissing: false,
  isIncognito: false,
  incognitoWarning: null,
  meta: null,
  state: null,
  savingBatch: false,
  savedPostsTotal: 0,
  savedCommentsTotal: 0,
  error: null,
};

const uiListeners = new Set<(next: SharedSyncSnapshot) => void>();
const syncedCallbacks = new Set<() => void>();
let activeRunId: string | null = null;
let flushing = false;
let lastFlushErrorAt = 0;
let completedNotified = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function publish(patch: Partial<SharedSyncSnapshot>) {
  Object.assign(snapshot, patch);
  if (patch.state) {
    if (typeof patch.state.workerIncognito === "boolean" || typeof patch.state.isIncognito === "boolean") {
      snapshot.isIncognito = Boolean(patch.state.workerIncognito ?? patch.state.isIncognito);
    }
    if (patch.state.incognitoWarning !== undefined) snapshot.incognitoWarning = patch.state.incognitoWarning ?? null;
  }
  const copy = { ...snapshot };
  for (const fn of uiListeners) fn(copy);
  managePolling();
}

async function fetchServerMeta(): Promise<ExtensionMeta | null> {
  try {
    const res = await fetch("/api/marketing-sosmed/browser-sync", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as ExtensionMeta;
    snapshot.meta = json;
    return json;
  } catch {
    return null;
  }
}

export const EXTENSION_SYNC_BATCH_LIMIT = 15;

async function flushPendingBatches(extensionId: string) {
  if (flushing) return;
  flushing = true;
  let anySaved = false;
  let batchLimit = EXTENSION_SYNC_BATCH_LIMIT;
  try {
    let hasMore = true;
    while (hasMore) {
      type PeekPayload = {
        ok?: boolean;
        posts?: unknown[];
        ackCount?: number;
        syncRunId?: string | null;
        finalizedOnServer?: boolean;
        runStartedAt?: string | null;
        finalizeRun?: boolean;
        errors?: string[];
        state?: SocialExtensionState;
      };
      let peekRes = await callExtensionDetailed<PeekPayload>(extensionId, { type: "PEEK_PENDING_BATCH", limit: batchLimit });
      if (!peekRes.ok && peekRes.transportError) {
        await callExtensionDetailed(extensionId, { type: "PING" }, 5_000);
        if (batchLimit > 1) batchLimit = 1;
        peekRes = await callExtensionDetailed<PeekPayload>(extensionId, { type: "PEEK_PENDING_BATCH", limit: batchLimit });
      }
      if (!peekRes.ok) throw new Error(peekRes.reason);
      const peek = peekRes.data;
      if (peek.syncRunId && !activeRunId) activeRunId = peek.syncRunId;
      if (peek.state) publish({ state: peek.state });

      const batchPosts = Array.isArray(peek.posts) ? peek.posts : [];
      const ackCount = Math.max(0, peek.ackCount ?? batchPosts.length);
      const needsFinalClose = Boolean(
        peek.finalizeRun && !peek.finalizedOnServer && (activeRunId || (peek.errors && peek.errors.length > 0)),
      );
      if (batchPosts.length === 0 && !needsFinalClose) {
        hasMore = false;
        break;
      }

      publish({ savingBatch: true, error: null });
      const postRes = await fetch("/api/marketing-sosmed/browser-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncRunId: activeRunId,
          runStartedAt: peek.runStartedAt,
          finalizeRun: peek.finalizeRun,
          posts: batchPosts,
          errors: peek.errors ?? [],
        }),
      });
      if (postRes.status === 413 && batchLimit > 1) {
        batchLimit = 1;
        continue;
      }
      const postJson = (await postRes.json().catch(() => ({}))) as {
        error?: string;
        syncRunId?: string;
        postsSaved?: number;
        commentsInserted?: number;
      };
      if (!postRes.ok) {
        throw new Error(postJson.error ?? `Server menjawab ${postRes.status}`);
      }
      if (postJson.syncRunId) activeRunId = postJson.syncRunId;
      if ((postJson.postsSaved ?? 0) > 0 || (postJson.commentsInserted ?? 0) > 0) {
        anySaved = true;
      }

      if (ackCount > 0 || activeRunId || peek.finalizeRun) {
        const acked = await callExtension<{ ok?: boolean; state?: SocialExtensionState }>(extensionId, {
          type: "ACK_PENDING_BATCH",
          count: ackCount,
          syncRunId: activeRunId,
          finalized: Boolean(peek.finalizeRun),
        });
        if (acked?.ok && acked.state) {
          publish({ state: acked.state });
        }
      }
      if (peek.finalizeRun) activeRunId = null;
      publish({
        savedPostsTotal: snapshot.savedPostsTotal + (postJson.postsSaved ?? 0),
        savedCommentsTotal: snapshot.savedCommentsTotal + (postJson.commentsInserted ?? 0),
      });
      hasMore = (snapshot.state?.pendingCount ?? 0) > 0;
    }
    lastFlushErrorAt = 0;
    const latestState = snapshot.state;
    if (anySaved && latestState?.status === "completed" && latestState.pendingCount === 0 && !completedNotified) {
      completedNotified = true;
      activeRunId = null;
      for (const cb of syncedCallbacks) cb();
    } else if (anySaved && !pollTimer) {
      for (const cb of syncedCallbacks) cb();
    }
  } catch (err) {
    lastFlushErrorAt = Date.now();
    publish({ error: err instanceof Error ? err.message : "Gagal menyimpan data ekstensi." });
  } finally {
    flushing = false;
    publish({ savingBatch: false });
  }
}

function managePolling() {
  const extId = snapshot.meta?.extensionId;
  const s = snapshot.state;
  const active = Boolean(
    extId &&
      snapshot.extensionInstalled &&
      s &&
      (s.status === "running" ||
        s.status === "needs_human_action" ||
        s.pendingCount > 0 ||
        (s.status === "completed" && !s.finalizedOnServer && (activeRunId !== null || s.errors.length > 0))),
  );

  if (!active) {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    return;
  }

  if (pollTimer !== null) return;
  pollTimer = setInterval(async () => {
    const id = snapshot.meta?.extensionId;
    if (!id) return;
    const res = await callExtension<{ ok?: boolean; state?: SocialExtensionState }>(id, { type: "GET_STATE" });
    if (!res?.ok || !res.state) return;
    publish({ state: res.state });
    if (
      Date.now() - lastFlushErrorAt >= 6000 &&
      (res.state.pendingCount > 0 ||
        (res.state.status === "completed" &&
          !res.state.finalizedOnServer &&
          (activeRunId !== null || res.state.errors.length > 0)))
    ) {
      await flushPendingBatches(id);
    }
    const latestState = snapshot.state ?? res.state;
    if (latestState.status === "completed" && latestState.pendingCount === 0 && !completedNotified) {
      completedNotified = true;
      activeRunId = null;
      for (const cb of syncedCallbacks) cb();
    }
  }, 1500);
}

async function detectOnce(forceReloadMeta = false): Promise<boolean> {
  try {
    const m = forceReloadMeta || !snapshot.meta ? await fetchServerMeta() : snapshot.meta;
    if (!m?.extensionId) {
      publish({ checking: false, extensionInstalled: false });
      return false;
    }
    const expectedVersion = m.extensionVersion;
    if (!expectedVersion) {
      publish({ checking: false, error: "Versi ekstensi dari server tidak terbaca; muat ulang halaman ini." });
      return false;
    }
    const ping = await callExtension<{
      ok?: boolean;
      version?: string;
      protocolVersion?: number;
      assetsOk?: boolean;
      isIncognito?: boolean;
      incognitoWarning?: string | null;
      state?: SocialExtensionState;
    }>(m.extensionId, { type: "PING" });
    if (ping?.ok) {
      if (ping.state?.syncRunId && !activeRunId) {
        activeRunId = ping.state.syncRunId;
      }
      const missingAssets = ping.assetsOk === false;
      const isOutdated =
        missingAssets || (Boolean(ping.version) && ping.version !== expectedVersion) || (ping.protocolVersion ?? 1) < 2;
      publish({
        checking: false,
        extensionInstalled: true,
        extensionVersion: ping.version ?? null,
        requiredVersion: expectedVersion,
        needsUpdate: isOutdated,
        assetsMissing: missingAssets,
        isIncognito: Boolean(ping.isIncognito ?? ping.state?.workerIncognito ?? ping.state?.isIncognito),
        incognitoWarning: ping.incognitoWarning ?? ping.state?.incognitoWarning ?? null,
        ...(isOutdated
          ? {
              error: missingAssets
                ? `Folder ekstensi di komputer tidak terbaca lagi (dipindah atau dihapus), sehingga Chrome tidak bisa memuat parsers.js. Kembalikan folder itu atau unduh ulang paket v${expectedVersion} (.zip), ekstrak ke folder tetap, lalu muat lewat chrome://extensions.`
                : `Ekstensi perlu diperbarui ke v${expectedVersion}. Unduh paket .zip terbaru lalu muat ulang di chrome://extensions.`,
            }
          : { error: null }),
        ...(ping.state ? { state: ping.state } : {}),
      });
      if (
        (ping.state?.pendingCount ?? 0) > 0 ||
        (ping.state?.status === "completed" &&
          !ping.state.finalizedOnServer &&
          (Boolean(ping.state.syncRunId) || (ping.state.errors?.length ?? 0) > 0))
      ) {
        void flushPendingBatches(m.extensionId);
      }
      return true;
    }
    publish({ checking: false, extensionInstalled: false });
    return false;
  } catch {
    publish({ checking: false, extensionInstalled: false });
    return false;
  }
}

/**
 * Menyaring daftar target sinkronisasi ekstensi berdasarkan outlet dan/atau platform.
 * Jika keduanya kosong (atau outletKey = "all" tanpa platform), mengembalikan seluruh target (akun sendiri + kompetitor).
 */
export function selectTargetsForSync(
  targets: readonly ExtensionTargetItem[],
  options?: { outletKey?: string; platform?: "instagram" | "tiktok" },
): ExtensionTargetItem[] {
  const requestedOutlet = options?.outletKey && options.outletKey !== "all" ? options.outletKey : null;
  const requestedPlatform = options?.platform ?? null;
  if (!requestedOutlet && !requestedPlatform) return [...targets];

  return targets.filter((t) => {
    if (t.targetType !== "own") return false;
    if (requestedPlatform && t.platform !== requestedPlatform) return false;
    if (!requestedOutlet) return true;
    if (requestedOutlet === "dbar") {
      // Akun bersama @dragonbeachclub yang melayani D'Bar & Karaoke hanya Instagram, bukan TikTok.
      return t.outletKey === "dbar" || (t.outletKey === "dragon-beach-club" && t.platform === "instagram");
    }
    return t.outletKey === requestedOutlet;
  });
}

const fmtIdInt = (n: number) => Math.max(0, Math.round(n)).toLocaleString("id-ID");

function formatPhaseScannedSummary(
  collected: number | null,
  expected: number | null,
  profileCollected: number | null,
  reelsAdded: number | null,
): string | null {
  if (collected === null || collected <= 0) return null;
  const reels = reelsAdded !== null && reelsAdded > 0 ? reelsAdded : 0;
  const gridCount =
    profileCollected !== null && profileCollected >= 0
      ? profileCollected
      : reels > 0
        ? Math.max(0, collected - reels)
        : collected;

  if (reels > 0 && expected !== null) {
    return gridCount <= expected
      ? `dipindai ${fmtIdInt(gridCount)} / ${fmtIdInt(expected)} grid + ${fmtIdInt(reels)} Reels (${fmtIdInt(collected)} total)`
      : `dipindai ${fmtIdInt(gridCount)} grid (header ${fmtIdInt(expected)}) + ${fmtIdInt(reels)} Reels (${fmtIdInt(collected)} total)`;
  }
  if (reels > 0) {
    return `dipindai ${fmtIdInt(gridCount)} grid + ${fmtIdInt(reels)} Reels (${fmtIdInt(collected)} total)`;
  }
  if (expected !== null && collected > expected) {
    return `dipindai ${fmtIdInt(collected)} (header ${fmtIdInt(expected)})`;
  }
  return expected !== null ? `dipindai ${fmtIdInt(collected)} / ${fmtIdInt(expected)}` : `dipindai ${fmtIdInt(collected)}`;
}

/**
 * Memformat hitungan per akun pada `targetResults` dengan memisahkan grid profil utama vs Reels-only
 * agar pembilang tidak tampak melampaui angka header platform (mis. 1.348 / 1.350 grid + 6 Reels).
 */
export function formatExtensionTargetCounts(item: SocialExtensionTargetProgress): string | null {
  if (typeof item.collected !== "number") return null;
  const reels = typeof item.reelsAdded === "number" && item.reelsAdded > 0 ? item.reelsAdded : 0;
  const expected = typeof item.expected === "number" && item.expected > 0 ? item.expected : null;
  const gridCount =
    typeof item.profileCollected === "number" && item.profileCollected >= 0
      ? item.profileCollected
      : reels > 0
        ? Math.max(0, item.collected - reels)
        : item.collected;

  let main: string;
  if (reels > 0 && expected !== null) {
    main =
      gridCount <= expected
        ? `${fmtIdInt(gridCount)} / ${fmtIdInt(expected)} grid + ${fmtIdInt(reels)} Reels (${fmtIdInt(item.collected)} total)`
        : `${fmtIdInt(gridCount)} grid (header ${fmtIdInt(expected)}) + ${fmtIdInt(reels)} Reels (${fmtIdInt(item.collected)} total)`;
  } else if (reels > 0) {
    main = `${fmtIdInt(gridCount)} grid + ${fmtIdInt(reels)} Reels (${fmtIdInt(item.collected)} total)`;
  } else if (expected !== null && item.collected > expected) {
    main = `${fmtIdInt(item.collected)} dipindai (header ${fmtIdInt(expected)})`;
  } else if (expected !== null) {
    main = `${fmtIdInt(item.collected)} / ${fmtIdInt(expected)} postingan`;
  } else {
    main = `${fmtIdInt(item.collected)} postingan`;
  }

  const parts: string[] = [main];
  if (typeof item.feedSaved === "number" && item.feedSaved > 0) {
    parts.push(`+${fmtIdInt(item.feedSaved)} dari feed`);
  }
  if (typeof item.skippedKnown === "number" && item.skippedKnown > 0) {
    parts.push(`${fmtIdInt(item.skippedKnown)} sudah di DB`);
  }
  return parts.join(" · ");
}

/**
 * Menerjemahkan fase aktif ekstensi menjadi label jelas berbahasa Indonesia agar pengguna dapat
 * melihat total postingan yang dipindai, jeda batas permintaan, yang sudah lengkap di DB, yang disimpan cepat dari feed, dan detail terbaru.
 */
export function formatExtensionPhaseProgress(state: SocialExtensionState | null | undefined): string | null {
  if (!state) return null;
  const phase = (state.currentPhase ?? "").toLowerCase();
  const collected = typeof state.currentTargetCollected === "number" ? state.currentTargetCollected : null;
  const profileCollected = typeof state.currentProfileCollected === "number" ? state.currentProfileCollected : null;
  const expected = typeof state.currentTargetExpected === "number" && state.currentTargetExpected > 0 ? state.currentTargetExpected : null;
  const detailIdx = typeof state.currentDetailIndex === "number" ? state.currentDetailIndex : null;
  const detailTotal = typeof state.currentDetailTotal === "number" && state.currentDetailTotal > 0 ? state.currentDetailTotal : null;
  const reelsAdded = typeof state.currentReelsAdded === "number" ? state.currentReelsAdded : null;
  const skippedKnown = typeof state.currentSkippedKnown === "number" && state.currentSkippedKnown > 0 ? state.currentSkippedKnown : null;
  const feedSaved = typeof state.currentFeedSaved === "number" && state.currentFeedSaved > 0 ? state.currentFeedSaved : null;

  if (phase === "cooldown") {
    const parts: string[] = ["Menunggu jeda batas permintaan platform sebelum mencoba ulang…"];
    const scannedSummary = formatPhaseScannedSummary(collected, expected, profileCollected, reelsAdded);
    if (scannedSummary) parts.push(scannedSummary);
    return parts.join(" · ");
  }

  if (phase === "reels" || phase === "scanning_reels") {
    const parts: string[] = [];
    if (reelsAdded !== null) parts.push(`Memindai tab Reels (+${fmtIdInt(reelsAdded)})`);
    else if (collected !== null && expected !== null) parts.push(`Memindai tab Reels (${fmtIdInt(collected)} / ${fmtIdInt(expected)})`);
    else parts.push("Memindai tab Reels");
    if (feedSaved !== null) parts.push(`+${fmtIdInt(feedSaved)} tersimpan dari feed`);
    return parts.join(" · ");
  }

  if (phase === "details" || phase === "fetching_details" || (!phase && detailTotal !== null)) {
    const parts: string[] = [];
    if (detailTotal !== null) {
      const shownIdx = Math.min(detailTotal, Math.max(0, detailIdx ?? 0));
      parts.push(`Mengambil detail ${fmtIdInt(shownIdx)} / ${fmtIdInt(detailTotal)} postingan baru & terbaru`);
    } else if (detailIdx !== null && detailIdx > 0) {
      parts.push(`Mengambil detail ${fmtIdInt(detailIdx)} postingan baru & terbaru`);
    } else {
      parts.push("Mengambil detail postingan baru & terbaru");
    }
    if (skippedKnown !== null) parts.push(`${fmtIdInt(skippedKnown)} sudah lengkap di DB`);
    if (feedSaved !== null) parts.push(`+${fmtIdInt(feedSaved)} tersimpan dari feed`);
    const scannedSummary = formatPhaseScannedSummary(collected, expected, profileCollected, reelsAdded);
    if (scannedSummary) parts.push(scannedSummary);
    return parts.join(" · ");
  }

  if (phase === "profile" || phase === "scanning_profile" || state.status === "running") {
    const parts: string[] = [];
    if (collected !== null && expected !== null) {
      parts.push(
        collected > expected
          ? `Memindai daftar postingan profil (${fmtIdInt(collected)} dipindai, header ${fmtIdInt(expected)})`
          : `Memindai daftar postingan profil (${fmtIdInt(collected)} / ${fmtIdInt(expected)})`,
      );
    } else if (collected !== null && collected > 0) {
      parts.push(`Memindai daftar postingan profil (${fmtIdInt(collected)} ditemukan)`);
    } else {
      parts.push("Memindai daftar postingan profil");
    }
    if (feedSaved !== null) parts.push(`+${fmtIdInt(feedSaved)} tersimpan dari feed`);
    if (state.currentHasNextPage === true) parts.push("halaman berikutnya masih ada");
    return parts.join(" · ");
  }

  return null;
}

/** Menghitung persentase progres bar sinkronisasi termasuk progres di dalam akun yang sedang berjalan. */
export function computeExtensionProgressPercent(state: SocialExtensionState | null | undefined): number {
  if (!state) return 0;
  if (state.status === "completed") return 100;
  if (state.totalTargets <= 0) return 0;

  let intra = 0;
  if (state.status === "running") {
    const phase = (state.currentPhase ?? "").toLowerCase();
    const detailTotal = typeof state.currentDetailTotal === "number" && state.currentDetailTotal > 0 ? state.currentDetailTotal : null;
    const detailIdx = typeof state.currentDetailIndex === "number" ? state.currentDetailIndex : 0;
    const expected = typeof state.currentTargetExpected === "number" && state.currentTargetExpected > 0 ? state.currentTargetExpected : null;
    const collected = typeof state.currentTargetCollected === "number" ? state.currentTargetCollected : 0;

    if ((phase === "details" || phase === "fetching_details") && detailTotal !== null) {
      intra = 0.35 + 0.65 * Math.min(1, Math.max(0, detailIdx / detailTotal));
    } else if (phase === "reels" || phase === "scanning_reels") {
      intra = 0.3;
    } else if (expected !== null) {
      intra = 0.25 * Math.min(1, Math.max(0, collected / expected));
    }
  }

  const rawPct = Math.round(((state.completedTargets + intra) / state.totalTargets) * 100);
  return Math.max(0, Math.min(state.status === "running" ? 99 : 100, rawPct));
}

export type ExtensionTargetStatusKind =
  | "running"
  | "ok"
  | "bottom_reached"
  | "partial"
  | "held"
  | "not_found"
  | "skipped"
  | "error"
  | "empty";

export interface ExtensionTargetStatusInfo {
  kind: ExtensionTargetStatusKind;
  label: string;
  className: string;
  isIssue: boolean;
  isBottomReached: boolean;
}

const HELD_TARGET_STATUSES = new Set(["paused", "blocked", "held"]);
const ERROR_TARGET_STATUSES = new Set(["error", "failed", "timeout"]);
const PARTIAL_TARGET_STATUSES = new Set(["partial", "incomplete"]);

/**
 * Mengklasifikasikan status setiap akun pada `targetResults` secara jujur:
 * membedakan `Lengkap`, `Batas bawah` (gulir benar-benar mentok bawah tanpa selisih ekstrem dan tanpa halaman lanjutan),
 * `Sebagian` / `Sebagian (belum lengkap)`, `Tertahan`, dan `Tidak ditemukan`.
 */
export function classifyExtensionTargetStatus(item: SocialExtensionTargetProgress): ExtensionTargetStatusInfo {
  const status = (item.status ?? "").toLowerCase();
  const effectiveCount =
    typeof item.profileCollected === "number" && item.profileCollected >= 0
      ? item.profileCollected
      : typeof item.collected === "number"
        ? item.collected
        : null;
  const hasSignificantGap =
    typeof item.expected === "number" &&
    item.expected > 0 &&
    effectiveCount !== null &&
    effectiveCount < Math.floor(item.expected * 0.95);
  const hasAnyHeaderGap =
    typeof item.expected === "number" &&
    item.expected > 0 &&
    effectiveCount !== null &&
    effectiveCount < item.expected;
  const hasSevereUnderCollection =
    typeof item.expected === "number" &&
    item.expected >= 50 &&
    effectiveCount !== null &&
    effectiveCount < Math.floor(item.expected * 0.5);
  const hasMorePagesConfirmed = item.hasNextPage === true;
  const reachedBottom = item.reachedBottom === true || status === "bottom_reached";
  const canClaimBottomReached = reachedBottom && !hasSevereUnderCollection && !hasMorePagesConfirmed;

  if (status === "running") {
    return { kind: "running", label: "Memeriksa…", className: "bg-sky-100 text-sky-900", isIssue: false, isBottomReached: false };
  }
  if (status === "not_found") {
    return { kind: "not_found", label: "Tidak ditemukan", className: "bg-red-100 text-red-800", isIssue: true, isBottomReached: false };
  }
  if (HELD_TARGET_STATUSES.has(status)) {
    return { kind: "held", label: "Tertahan", className: "bg-amber-200 text-amber-950", isIssue: true, isBottomReached: false };
  }
  if (status === "skipped") {
    return { kind: "skipped", label: "Dilewati", className: "bg-cream-200 text-navy-700", isIssue: true, isBottomReached: false };
  }
  if (ERROR_TARGET_STATUSES.has(status)) {
    return { kind: "error", label: "Gagal", className: "bg-red-100 text-red-800", isIssue: true, isBottomReached: false };
  }
  if (status === "empty") {
    return { kind: "empty", label: "Kosong", className: "bg-cream-200 text-navy-700", isIssue: false, isBottomReached: false };
  }

  // Jangan pernah melabeli Lengkap atau Batas bawah saat cakupan <50% pada akun besar (>=50) atau server masih punya halaman berikutnya.
  if (hasSevereUnderCollection || hasMorePagesConfirmed) {
    return {
      kind: "partial",
      label: "Sebagian (belum lengkap)",
      className: "bg-amber-100 text-amber-900",
      isIssue: true,
      isBottomReached: false,
    };
  }

  // status "ok" dengan cakupan >=95% (atau lengkap) tetap tampil "Lengkap"
  if (status === "ok" && !hasSignificantGap) {
    return { kind: "ok", label: "Lengkap", className: "bg-emerald-100 text-emerald-800", isIssue: false, isBottomReached: false };
  }

  if (canClaimBottomReached && (status === "bottom_reached" || PARTIAL_TARGET_STATUSES.has(status) || hasAnyHeaderGap)) {
    return {
      kind: "bottom_reached",
      label: "Batas bawah",
      className: "bg-sky-100 text-sky-900",
      isIssue: false,
      isBottomReached: true,
    };
  }

  const hasNoteOrReason = Boolean(item.reason?.trim() || item.note?.trim());
  if (PARTIAL_TARGET_STATUSES.has(status) || hasAnyHeaderGap || (status !== "ok" && hasNoteOrReason)) {
    return {
      kind: "partial",
      label: "Sebagian",
      className: "bg-amber-100 text-amber-900",
      isIssue: true,
      isBottomReached: false,
    };
  }

  return { kind: "ok", label: "Lengkap", className: "bg-emerald-100 text-emerald-800", isIssue: false, isBottomReached: false };
}

export function summarizeExtensionTargets(items: readonly SocialExtensionTargetProgress[]): {
  okCount: number;
  bottomCount: number;
  issueCount: number;
  runningCount: number;
  issueTargets: SocialExtensionTargetProgress[];
  bottomTargets: SocialExtensionTargetProgress[];
} {
  let okCount = 0;
  let bottomCount = 0;
  let runningCount = 0;
  const issueTargets: SocialExtensionTargetProgress[] = [];
  const bottomTargets: SocialExtensionTargetProgress[] = [];

  for (const item of items) {
    const cls = classifyExtensionTargetStatus(item);
    if (cls.kind === "running") {
      runningCount += 1;
    } else if (cls.isIssue) {
      issueTargets.push(item);
    } else if (cls.isBottomReached) {
      bottomCount += 1;
      bottomTargets.push(item);
    } else {
      okCount += 1;
    }
  }

  return {
    okCount,
    bottomCount,
    issueCount: issueTargets.length,
    runningCount,
    issueTargets,
    bottomTargets,
  };
}

export const socialExtensionClient = {
  getSnapshot: (): SharedSyncSnapshot => ({ ...snapshot }),
  subscribe(listener: (next: SharedSyncSnapshot) => void, onSynced?: () => void) {
    uiListeners.add(listener);
    if (onSynced) syncedCallbacks.add(onSynced);
    if (!initialized) {
      initialized = true;
      void detectOnce(false);
    }
    return () => {
      uiListeners.delete(listener);
      if (onSynced) syncedCallbacks.delete(onSynced);
    };
  },
  refreshDetection: async () => {
    publish({ checking: true });
    return detectOnce(true);
  },
  startSync: async (options?: { maxPostsPerTarget?: number; outletKey?: string; platform?: "instagram" | "tiktok" }) => {
    activeRunId = null;
    completedNotified = false;
    publish({ error: null, savedPostsTotal: 0, savedCommentsTotal: 0 });
    const freshMeta = await fetchServerMeta();
    if (!freshMeta?.extensionId) {
      publish({ error: "Gagal membaca daftar akun media sosial dari server lokal." });
      return;
    }
    const maxPosts = options?.maxPostsPerTarget !== undefined ? options.maxPostsPerTarget : 0;
    const requestedOutlet = options?.outletKey && options.outletKey !== "all" ? options.outletKey : null;
    const requestedPlatform = options?.platform ?? null;
    const selectedTargets = selectTargetsForSync(freshMeta.targets, {
      outletKey: requestedOutlet ?? undefined,
      platform: requestedPlatform ?? undefined,
    });
    if ((requestedOutlet || requestedPlatform) && selectedTargets.length === 0) {
      publish({ error: "Tidak ada akun media sosial resmi yang cocok untuk outlet atau platform yang dipilih." });
      return;
    }
    const res = await callExtension<{ ok?: boolean; state?: SocialExtensionState; error?: string }>(freshMeta.extensionId, {
      type: "START_SYNC",
      targets: selectedTargets,
      allowedHandles: freshMeta.allowedHandles,
      knownPostUrls: freshMeta.knownPostUrls ?? [],
      maxPostsPerTarget: maxPosts,
    });
    if (!res?.ok || !res.state) {
      publish({
        extensionInstalled: false,
        error: res?.error ?? "Ekstensi Chrome Sanghyang Market Sync belum terdeteksi di peramban ini.",
      });
      return;
    }
    publish({ extensionInstalled: true, state: res.state });
  },
  resumeSync: async () => {
    const extId = snapshot.meta?.extensionId;
    if (!extId) return;
    publish({ error: null });
    const res = await callExtension<{ ok?: boolean; state?: SocialExtensionState }>(extId, { type: "RESUME_SYNC" });
    if (res?.ok && res.state) publish({ state: res.state });
  },
  skipTarget: async () => {
    const extId = snapshot.meta?.extensionId;
    if (!extId) return;
    publish({ error: null });
    const res = await callExtension<{ ok?: boolean; state?: SocialExtensionState }>(extId, { type: "SKIP_TARGET" });
    if (res?.ok && res.state) publish({ state: res.state });
  },
  focusPausedTab: async () => {
    const extId = snapshot.meta?.extensionId;
    if (!extId) return;
    await callExtension(extId, { type: "FOCUS_PAUSED_TAB" });
  },
  cancelSync: async () => {
    const extId = snapshot.meta?.extensionId;
    if (!extId) return;
    const res = await callExtension<{ ok?: boolean; state?: SocialExtensionState }>(extId, { type: "CANCEL_SYNC" });
    activeRunId = null;
    if (res?.ok && res.state) publish({ state: res.state });
  },
  flushPending: async () => {
    const extId = snapshot.meta?.extensionId;
    if (!extId) return;
    lastFlushErrorAt = 0;
    publish({ error: null });
    await flushPendingBatches(extId);
  },
};
