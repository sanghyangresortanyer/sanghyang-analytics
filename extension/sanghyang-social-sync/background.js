/* global chrome */
"use strict";

const STATE_KEY = "sanghyang_sync_state";
const ALLOWED_APP_ORIGINS = new Set([
  "https://sanghyang-analytics.vercel.app",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);
const ALLOWED_TARGET_HOSTS = new Set([
  "www.instagram.com",
  "instagram.com",
  "m.instagram.com",
  "www.tiktok.com",
  "tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
]);

function defaultState() {
  return {
    status: "idle",
    runStartedAt: null,
    syncRunId: null,
    finalizedOnServer: false,
    targets: [],
    allowedHandles: [],
    knownPostUrls: [],
    maxPostsPerTarget: 3,
    targetIndex: 0,
    currentTargetItems: null,
    currentItemIndex: 0,
    completedTargets: 0,
    workerTabId: null,
    workerIncognito: false,
    dashboardWindowId: null,
    dashboardTabId: null,
    pausedReason: null,
    pausedKind: null,
    pausedUrl: null,
    pausedTargetName: null,
    pendingPosts: [],
    syncedPostsCount: 0,
    syncedCommentsCount: 0,
    currentLabel: null,
    currentTargetHandle: null,
    currentTargetPlatform: null,
    currentProfileCollected: null,
    currentTargetCollected: null,
    currentTargetExpected: null,
    currentPhase: null,
    currentDetailIndex: null,
    currentDetailTotal: null,
    currentReelsAdded: null,
    currentTargetReachedBottom: null,
    currentSkippedKnown: null,
    currentFeedSaved: null,
    currentHasNextPage: null,
    lastCompletedTargetMeta: null,
    targetResults: [],
    lastDashboardOrigin: null,
    errors: [],
  };
}

let queueRunning = false;
let stateMutex = Promise.resolve();

function withLockedState(mutator) {
  const op = stateMutex.then(async () => {
    const res = await chrome.storage.local.get(STATE_KEY);
    const current = { ...defaultState(), ...(res[STATE_KEY] || {}) };
    const result = await mutator(current);
    if (result && result.nextState) {
      await chrome.storage.local.set({ [STATE_KEY]: result.nextState });
      return result.value !== undefined ? result.value : result.nextState;
    }
    return result;
  });
  stateMutex = op.catch(() => undefined);
  return op;
}

async function readState() {
  return withLockedState((s) => s);
}

async function writeState(patchOrFn) {
  return withLockedState((current) => {
    const patch = typeof patchOrFn === "function" ? patchOrFn(current) : patchOrFn;
    const nextState = { ...current, ...patch };
    return { nextState, value: nextState };
  });
}

function upsertTargetResult(list, entry) {
  const prev = Array.isArray(list) ? list : [];
  const idx = prev.findIndex((x) => x && x.targetKey === entry.targetKey);
  if (idx >= 0) {
    const next = prev.slice();
    next[idx] = { ...prev[idx], ...entry };
    return next;
  }
  return [...prev, entry];
}

function summarizeState(s) {
  return {
    status: s.status,
    runStartedAt: s.runStartedAt,
    syncRunId: s.syncRunId || null,
    finalizedOnServer: Boolean(s.finalizedOnServer),
    totalTargets: s.targets.length,
    completedTargets: s.completedTargets,
    currentTargetName: s.currentLabel,
    currentTargetHandle: s.currentTargetHandle || null,
    currentTargetPlatform: s.currentTargetPlatform || null,
    currentProfileCollected: typeof s.currentProfileCollected === "number" ? s.currentProfileCollected : null,
    currentTargetCollected: typeof s.currentTargetCollected === "number" ? s.currentTargetCollected : null,
    currentTargetExpected: typeof s.currentTargetExpected === "number" ? s.currentTargetExpected : null,
    currentPhase: s.currentPhase || null,
    currentDetailIndex: typeof s.currentDetailIndex === "number" ? s.currentDetailIndex : null,
    currentDetailTotal: typeof s.currentDetailTotal === "number" ? s.currentDetailTotal : null,
    currentReelsAdded: typeof s.currentReelsAdded === "number" ? s.currentReelsAdded : null,
    currentTargetReachedBottom: typeof s.currentTargetReachedBottom === "boolean" ? s.currentTargetReachedBottom : null,
    currentSkippedKnown: typeof s.currentSkippedKnown === "number" ? s.currentSkippedKnown : null,
    currentFeedSaved: typeof s.currentFeedSaved === "number" ? s.currentFeedSaved : null,
    currentHasNextPage: typeof s.currentHasNextPage === "boolean" ? s.currentHasNextPage : null,
    pausedReason: s.pausedReason,
    pausedKind: s.pausedKind,
    pausedUrl: s.pausedUrl,
    pausedTargetName: s.pausedTargetName,
    workerIncognito: Boolean(s.workerIncognito),
    lastDashboardOrigin: s.lastDashboardOrigin,
    pendingCount: s.pendingPosts.length,
    syncedPostsCount: s.syncedPostsCount,
    syncedCommentsCount: s.syncedCommentsCount,
    targetResults: Array.isArray(s.targetResults) ? s.targetResults : [],
    errors: s.errors,
  };
}

function isAllowedTargetProfileUrl(rawUrl) {
  if (typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "https:" && ALLOWED_TARGET_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeUrlComparable(u) {
  try {
    const p = new URL(u);
    return `${p.hostname.replace(/^www\./, "").toLowerCase()}${p.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function instagramShortcodeFromUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  try {
    const p = new URL(rawUrl.trim());
    const m = p.pathname.match(/^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel)\/([A-Za-z0-9_-]+)\/?$/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function postMergeKey(platform, rawUrl) {
  if (platform === "instagram") {
    const code = instagramShortcodeFromUrl(rawUrl);
    if (code) return `ig:${code}`;
  }
  if (platform === "tiktok" && typeof rawUrl === "string") {
    const m = rawUrl.match(/\/(?:video|photo)\/(\d{10,22})(?:[/?#]|$)/);
    if (m) return `tt:${m[1]}`;
  }
  return normalizeUrlComparable(rawUrl).toLowerCase() || String(rawUrl || "").toLowerCase();
}

async function pickNonIncognitoWindowId() {
  try {
    if (typeof chrome?.windows?.getAll !== "function") return undefined;
    const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const normal = wins.find((w) => w && !w.incognito && typeof w.id === "number");
    return normal?.id;
  } catch {
    return undefined;
  }
}

const PROFILE_NAV_TIMEOUT_MS = 35_000;
const REELS_NAV_TIMEOUT_MS = 35_000;
const POST_NAV_TIMEOUT_MS = 35_000;
const INTERACTIVE_MIN_ELAPSED_MS = 9_000;
const INTERACTIVE_POLL_MS = 2_500;

function probeTabInteractiveReady() {
  const rs = document.readyState;
  if (rs === "loading") return false;
  const body = (document.body?.innerText || "").trim();
  if (/^please wait\.{0,3}$/i.test(body)) return false;
  // Jangan anggap siap hanya karena <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"> ada; tunggu simpul konten/CAPTCHA nyata.
  const hasContent = Boolean(
    document.querySelector(
      'a[href*="/p/"], a[href*="/reel/"], a[href*="/video/"], a[href*="/photo/"], [data-e2e="user-post-item"], [data-e2e="like-count"], [data-e2e="browse-like-count"], [data-e2e="photo-like-count"], [data-e2e="video-desc"], [data-e2e="browse-video-desc"], [data-e2e="photo-desc"], [data-e2e="browse-photo-desc"], [data-e2e="new-desc-span"], [data-e2e="detail-photo"], [data-e2e="photo-mode-container"], [data-e2e="browse-photo"], input[name="username"], .captcha_verify_container, .captcha-verify-container, #tiktok-verify-ele, [id*="SlardarWAF"]'
    )
  );
  return hasContent || (rs === "complete" && body.length > 0);
}

async function navigateAndWaitComplete(existingTabId, targetUrl, timeoutMs, navOpts) {
  let tabId = existingTabId;
  let needCreate = typeof tabId !== "number";
  if (!needCreate) {
    try {
      const existingTab = await chrome.tabs.get(tabId);
      // Jika tab pekerja lama di Incognito tetapi jendela Chrome biasa kini tersedia, pindahkan ke jendela biasa.
      if (existingTab?.incognito) {
        const normalWindowId = await pickNonIncognitoWindowId();
        if (typeof normalWindowId === "number") {
          await closeWorkerTab(tabId);
          tabId = null;
          needCreate = true;
        }
      }
    } catch {
      needCreate = true;
    }
  }

  return new Promise(async (resolve, reject) => {
    let settled = false;
    let sawLoading = needCreate;
    const expectedPath = normalizeUrlComparable(targetUrl);
    const startedAt = Date.now();
    const interactiveMinElapsedMs =
      typeof navOpts?.interactiveMinElapsedMs === "number" ? navOpts.interactiveMinElapsedMs : INTERACTIVE_MIN_ELAPSED_MS;
    const interactivePollMs =
      typeof navOpts?.interactivePollMs === "number" ? navOpts.interactivePollMs : INTERACTIVE_POLL_MS;
    let pollTimer = null;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      if (pollTimer !== null) clearInterval(pollTimer);
    };

    const finishSuccess = () => {
      if (settled || typeof tabId !== "number") return;
      settled = true;
      cleanup();
      resolve(tabId);
    };

    const isCompleteMatch = (tab) => {
      if (!tab || tab.status !== "complete") return false;
      const curPath = normalizeUrlComparable(tab.url || "");
      // Hindari salah cocok jalur induk (misalnya /dragonbeachclub cocok terhadap /dragonbeachclub/reels).
      if (!sawLoading && expectedPath && curPath !== expectedPath && !curPath.startsWith(`${expectedPath}/`)) return false;
      return true;
    };

    const onUpdated = (updatedTabId, info, tab) => {
      if (typeof tabId !== "number" || updatedTabId !== tabId) return;
      if (info.status === "loading") {
        sawLoading = true;
        return;
      }
      if (info.status === "complete" && isCompleteMatch({ status: "complete", url: tab?.url || "" })) {
        finishSuccess();
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new Error("Batas waktu muat halaman terlampaui.");
      if (typeof tabId === "number") err.tabId = tabId;
      reject(err);
    }, timeoutMs);

    try {
      // Pasang listener SEBELUM tabs.create/update agar status "complete" cepat tidak terlewat.
      chrome.tabs.onUpdated.addListener(onUpdated);

      if (needCreate) {
        const normalWindowId = await pickNonIncognitoWindowId();
        const dashboardWindowId = typeof navOpts?.dashboardWindowId === "number" ? navOpts.dashboardWindowId : null;
        // Jika tab pekerja di jendela Chrome normal berbeda dari jendela dashboard, jadikan tab aktif di jendela itu
        // agar Chrome tidak membekukan IntersectionObserver & rAF (tidak memindahkan fokus dari jendela dashboard).
        const activeInSeparateWindow =
          typeof normalWindowId === "number" && dashboardWindowId !== null && normalWindowId !== dashboardWindowId;
        const createOpts = { url: targetUrl, active: activeInSeparateWindow };
        if (typeof normalWindowId === "number") createOpts.windowId = normalWindowId;
        const created = await chrome.tabs.create(createOpts);
        tabId = created?.id;
        if (typeof tabId !== "number") {
          cleanup();
          reject(new Error("Chrome tidak dapat membuka tab pekerja."));
          return;
        }
      } else {
        await chrome.tabs.update(tabId, { url: targetUrl });
      }

      // Periksa status tab segera setelah create/update untuk menutup race condition saat tab sudah "complete".
      try {
        const immediate = await chrome.tabs.get(tabId);
        if (isCompleteMatch(immediate)) {
          finishSuccess();
          return;
        }
      } catch {
        // Tab akan dipantau oleh listener/poll.
      }

      pollTimer = setInterval(async () => {
        if (settled || typeof tabId !== "number") return;
        try {
          const cur = await chrome.tabs.get(tabId);
          if (isCompleteMatch(cur)) {
            finishSuccess();
            return;
          }
          // TikTok kerap tetap status="loading" (readyState="interactive") melampaui 20 detik meski daftar video
          // sudah terrender di DOM karena preload stream latar belakang; cek kesiapan DOM nyata sebelum timeout.
          if (Date.now() - startedAt >= interactiveMinElapsedMs && cur.status === "loading") {
            const curPath = normalizeUrlComparable(cur.url || "");
            const pathMatches = !expectedPath || curPath === expectedPath || curPath.startsWith(`${expectedPath}/`);
            if (pathMatches && typeof chrome?.scripting?.executeScript === "function") {
              const probe = await chrome.scripting.executeScript({
                target: { tabId },
                func: probeTabInteractiveReady,
              });
              if (probe?.[0]?.result === true) {
                finishSuccess();
              }
            }
          }
        } catch {
          // Abaikan galat sementara saat tab sedang transisi navigasi.
        }
      }, interactivePollMs);
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }
  });
}

async function navigateWithRetry(existingTabId, targetUrl, timeoutMs, navOpts) {
  let currentTabId = existingTabId;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await navigateAndWaitComplete(currentTabId, targetUrl, timeoutMs, navOpts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = /Batas waktu muat halaman terlampaui/i.test(msg);
      if (!isTimeout || attempt === 1) throw err;
      if (typeof currentTabId !== "number" && err && typeof err.tabId === "number") {
        currentTabId = err.tabId;
      }
    }
  }
  throw new Error("Batas waktu muat halaman terlampaui.");
}

async function focusTabForHuman(tabId) {
  if (typeof tabId !== "number") return;
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab && typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // Tab sudah ditutup pengguna.
  }
}

async function closeWorkerTab(tabId) {
  if (typeof tabId !== "number") return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Tab sudah tertutup.
  }
}

// Jeda sopan antar halaman detail video TikTok agar tidak memicu pembatasan HTTP 403 dari edge TikTok.
const TIKTOK_DETAIL_PACING_MS = 2500;

async function runExtractorOnTab(tabId, fnName, args) {
  if (typeof tabId !== "number") return null;

  // Lindungi terhadap redirect pasca-navigasi (login, chrome-error, atau domain tidak didukung)
  let currentUrl = "";
  let isIncognito = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    currentUrl = tab?.url || "";
    isIncognito = Boolean(tab?.incognito);
  } catch {
    return null;
  }

  const errorPageReason = (detail) => {
    const isTikTok = /tiktok\.com/i.test(currentUrl);
    if (isIncognito) {
      return `${isTikTok ? "TikTok" : "Halaman media sosial"} menolak akses (HTTP 403 / halaman galat) karena tab terbuka di mode Incognito tanpa sesi login. Buka dashboard di jendela Chrome biasa (bukan Incognito) yang sudah masuk ke akun ${isTikTok ? "TikTok" : "media sosial"}, atau klik Lewati Akun Ini.`;
    }
    if (isTikTok) {
      return `TikTok menolak akses sementara (HTTP 403 / halaman galat: ${detail}). Muat ulang tab TikTok tersebut atau masuk ke akun TikTok di Chrome lalu tekan Lanjutkan, atau klik Lewati Akun Ini.`;
    }
    return `Halaman peramban gagal dimuat (${detail}). Periksa koneksi atau muat ulang tab tersebut lalu tekan Lanjutkan, atau klik Lewati Akun Ini.`;
  };

  if (/^chrome-error:\/\/|^chrome:\/\/|^about:blank/i.test(currentUrl)) {
    return {
      challenge: {
        blocked: true,
        kind: "error_page",
        reason: errorPageReason(currentUrl),
      },
      items: [],
      post: null,
    };
  }

  if (
    currentUrl.includes("/accounts/login") ||
    currentUrl.includes("/login") ||
    currentUrl.includes("accounts.google") ||
    currentUrl.includes("facebook.com/login")
  ) {
    return {
      challenge: {
        blocked: true,
        kind: "login",
        reason: "Halaman diarahkan ke proses login akun media sosial. Silakan masuk di tab Chrome tersebut lalu tekan Lanjutkan.",
      },
      items: [],
      post: null,
    };
  }

  try {
    const parsed = new URL(currentUrl);
    if (!ALLOWED_TARGET_HOSTS.has(parsed.hostname.toLowerCase())) {
      return {
        challenge: {
          blocked: true,
          kind: "unsupported",
          reason: `Halaman diarahkan ke domain luar yang tidak didukung (${parsed.hostname}).`,
        },
        items: [],
        post: null,
      };
    }
  } catch {
    // Abaikan kegagalan parse URL
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Pastikan pengamat pasif feed-tap.js aktif di MAIN world tab ini (injeksi cadangan bila belum terpasang).
      try {
        const tapProbe = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (flagName) => Boolean(globalThis[flagName]),
          args: ["__sanghyangFeedTapInstalled"],
        });
        if (!tapProbe?.[0]?.result) {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            files: ["feed-tap.js"],
          });
        }
      } catch {
        // Jangan gagalkan ekstraksi DOM jika browser tidak mengizinkan injeksi ulang MAIN world secara sementara.
      }

      // Periksa apakah content_scripts sudah memuat SanghyangFeedParsers, SanghyangParsers, dan fungsi ekstraktor di isolated world.
      const probe = await chrome.scripting.executeScript({
        target: { tabId },
        func: (name) =>
          typeof globalThis[name] === "function" &&
          typeof globalThis.SanghyangParsers === "object" &&
          globalThis.SanghyangParsers !== null &&
          typeof globalThis.SanghyangFeedParsers === "object" &&
          globalThis.SanghyangFeedParsers !== null,
        args: [fnName],
      });
      const alreadyLoaded = Boolean(probe?.[0]?.result);
      if (!alreadyLoaded) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["feed-parsers.js", "parsers.js", "content-social.js"],
        });
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (name, callArgs) => {
          const fn = globalThis[name];
          if (typeof fn !== "function") {
            return { challenge: { blocked: false }, items: [], post: null };
          }
          return fn.apply(null, callArgs);
        },
        args: [fnName, args],
      });
      return results?.[0]?.result || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/could not load file|feed-tap\.js|feed-parsers\.js|parsers\.js|content-social\.js/i.test(msg)) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        return {
          challenge: {
            blocked: true,
            kind: "extension_reload",
            reason:
              "Chrome tidak bisa membaca berkas skrip ekstensi (parsers.js / feed-parsers.js) karena folder ekstensi di komputer sudah dipindah atau dihapus. Kembalikan folder itu dari Tempat Sampah ke lokasi semula, atau unduh ulang paket .zip dari dashboard, ekstrak ke folder tetap, lalu muat lewat chrome://extensions (Load unpacked). Setelah itu tekan Lanjutkan.",
          },
          items: [],
          post: null,
        };
      }
      if (/showing error page|error page|chrome-error|net::err_/i.test(msg)) {
        return {
          challenge: {
            blocked: true,
            kind: "error_page",
            reason: errorPageReason(msg),
          },
          items: [],
          post: null,
        };
      }
      if (/permission|host|cannot access/i.test(msg)) {
        return {
          challenge: {
            blocked: true,
            kind: "permission",
            reason: `Ekstensi tidak memiliki izin akses host (${msg}).`,
          },
          items: [],
          post: null,
        };
      }
      if (attempt === 0 && /destroyed|navigat|frame/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function verifyPackagedAssets() {
  if (typeof chrome?.runtime?.getURL !== "function" || typeof fetch !== "function") {
    return true;
  }
  try {
    for (const file of ["feed-tap.js", "feed-parsers.js", "parsers.js", "content-social.js"]) {
      const res = await fetch(chrome.runtime.getURL(file), { cache: "no-store" });
      if (!res.ok) return false;
      const text = await res.text();
      if (!text || text.length < 100) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function pauseOnChallenge(tabId, target, challenge, pageUrl) {
  await writeState({
    status: "needs_human_action",
    pausedReason: challenge.reason,
    pausedKind: challenge.kind || "login",
    pausedUrl: pageUrl,
    pausedTargetName: `${target.name} (${target.platform})`,
    currentLabel: `${target.name} · menunggu verifikasi`,
  });
  await focusTabForHuman(tabId);
}

const RECENT_REFRESH_WINDOW = 15;
const DETAIL_COMMENT_WINDOW = 25;
const COMPETITOR_DETAIL_COMMENT_WINDOW = 15;
const INTER_TARGET_PACING_MS = 2500;
const HEAVY_TARGET_PACING_MS = 5000;
const HEAVY_TAB_ROTATE_THRESHOLD = 200;
const RATE_LIMIT_COOLDOWN_MS = 35_000;
const COOLDOWN_CHECK_STEP_MS = 1_500;

async function waitInterruptible(totalMs, stepMs = COOLDOWN_CHECK_STEP_MS) {
  let remaining = Math.max(0, Number(totalMs) || 0);
  while (remaining > 0) {
    const slice = Math.min(remaining, stepMs);
    await new Promise((r) => setTimeout(r, slice));
    remaining -= slice;
    const st = await readState();
    if (st.status !== "running") return false;
  }
  return true;
}

function isScanRateLimited(res) {
  return Boolean(res?.scan?.rateLimited === true || res?.scan?.stoppedBy === "rate_limited");
}

function shouldRetryProfileScan(profileRes, platform) {
  if (!profileRes || typeof profileRes !== "object") return false;
  const initialExpected =
    typeof profileRes?.scan?.expected === "number"
      ? profileRes.scan.expected
      : typeof profileRes?.profile?.posts === "number"
        ? profileRes.profile.posts
        : null;
  const initialCollected = typeof profileRes?.scan?.collected === "number" ? profileRes.scan.collected : 0;
  const initialHasNextPage =
    typeof profileRes?.scan?.hasNextPage === "boolean" ? profileRes.scan.hasNextPage : null;
  const initialSevereGap =
    initialExpected !== null && initialExpected >= 50 && initialCollected < Math.floor(initialExpected * 0.5);
  const rateLimited = isScanRateLimited(profileRes);
  const needProfileRetry =
    !profileRes?.isLoggedOutNav &&
    (rateLimited ||
      (profileRes?.scan?.stoppedBy === "stale" &&
        (initialHasNextPage === true ||
          initialSevereGap ||
          (initialExpected !== null &&
            initialExpected > 14 &&
            initialCollected < Math.floor(initialExpected * 0.95) &&
            !profileRes?.scan?.reachedBottom))));
  const needTikTokZeroRetry =
    platform === "tiktok" &&
    initialCollected === 0 &&
    profileRes?.profile?.isEmptyProfile !== true &&
    profileRes?.profile?.notFound !== true;
  return needProfileRetry || needTikTokZeroRetry;
}

function evaluateTargetCompleteness({
  platform,
  name,
  maxPostsPerTarget,
  profileCollected,
  mergedCollected,
  reelsAdded = 0,
  expected,
  profileStoppedBy = null,
  profileReachedBottom = false,
  profileHasNextPage = null,
  reelsReachedBottom = true,
  reelsHasNextPage = null,
  rateLimited = false,
}) {
  const safeProfileCollected = typeof profileCollected === "number" && Number.isFinite(profileCollected) ? profileCollected : 0;
  const safeMergedCollected = typeof mergedCollected === "number" && Number.isFinite(mergedCollected) ? mergedCollected : safeProfileCollected;
  const safeReelsAdded = typeof reelsAdded === "number" && Number.isFinite(reelsAdded) ? reelsAdded : 0;
  const safeExpected = typeof expected === "number" && Number.isFinite(expected) ? expected : null;

  // Untuk Instagram, angka header profil hanya menghitung postingan di grid utama (bukan Reels-only).
  // Cek kelengkapan 95% terhadap `profileCollected` agar Reels-only tidak menyamarkan grid yang baru separuh tergulir.
  const effectiveCoverageCount = platform === "instagram" ? safeProfileCollected : safeMergedCollected;
  const combinedHasNextPage =
    profileHasNextPage === true || (platform === "instagram" && reelsHasNextPage === true)
      ? true
      : profileHasNextPage === false && (platform !== "instagram" || reelsHasNextPage !== true)
        ? false
        : null;
  const severeCoverageGap =
    safeExpected !== null && safeExpected >= 50 && effectiveCoverageCount < Math.floor(safeExpected * 0.5);
  const combinedReachedBottom =
    !severeCoverageGap &&
    combinedHasNextPage !== true &&
    (platform === "instagram" ? profileReachedBottom && reelsReachedBottom : profileReachedBottom);

  let partialScanNote = null;
  let scanStatus = "ok";
  let shouldRecordError = false;
  if (
    maxPostsPerTarget === 0 &&
    safeExpected !== null &&
    safeExpected > 0 &&
    profileStoppedBy !== "limit"
  ) {
    const threshold95 = Math.floor(safeExpected * 0.95);
    if (effectiveCoverageCount >= threshold95) {
      scanStatus = "ok";
      partialScanNote = null;
    } else if (combinedReachedBottom) {
      scanStatus = "partial";
      const countDesc =
        platform === "instagram" && safeReelsAdded > 0
          ? `${safeProfileCollected} grid (+${safeReelsAdded} Reels) dari ${safeExpected} angka header`
          : `${effectiveCoverageCount} dari ${safeExpected} angka header`;
      partialScanNote = `${name} (${platform}): mencapai batas bawah profil (${countDesc}; sisanya kemungkinan postingan kolaborasi tersembunyi/arsip/dibatasi platform).`;
    } else {
      scanStatus = "partial";
      const stopLabel =
        rateLimited || profileStoppedBy === "rate_limited"
          ? "dibatasi sementara oleh platform (rate limit)"
          : profileStoppedBy === "maxRounds"
            ? "batas putaran"
            : "gulir berhenti lebih awal";
      const countDesc =
        platform === "instagram" && safeReelsAdded > 0
          ? `${safeProfileCollected} grid (+${safeReelsAdded} Reels)`
          : `${effectiveCoverageCount}`;
      partialScanNote = `${name} (${platform}): baru terbaca ${countDesc} dari ${safeExpected} postingan profil (${stopLabel}).`;
      shouldRecordError = true;
    }
  }

  return {
    profileCollected: safeProfileCollected,
    collected: safeMergedCollected,
    reelsAdded: safeReelsAdded,
    expected: safeExpected,
    combinedHasNextPage,
    severeCoverageGap,
    combinedReachedBottom,
    scanStatus,
    partialScanNote,
    shouldRecordError,
    rateLimited: Boolean(rateLimited),
  };
}

function mergeScannedItem(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  const postType =
    prev.postType === "reels" || next.postType === "reels"
      ? "reels"
      : prev.postType === "carousel" || next.postType === "carousel"
        ? "carousel"
        : prev.postType || next.postType;
  const prevCap = typeof prev.caption === "string" && prev.caption.trim().length > 0 ? prev.caption : null;
  const nextCap = typeof next.caption === "string" && next.caption.trim().length > 0 ? next.caption : null;
  return {
    ...prev,
    postType,
    gridViews: next.gridViews ?? prev.gridViews ?? null,
    gridLikes: next.gridLikes ?? prev.gridLikes ?? null,
    gridComments: next.gridComments ?? prev.gridComments ?? null,
    gridShares: next.gridShares ?? prev.gridShares ?? null,
    imageUrl: next.imageUrl || prev.imageUrl || null,
    postedAt: next.postedAt || prev.postedAt || null,
    caption: nextCap ?? prevCap ?? (typeof prev.caption === "string" ? prev.caption : typeof next.caption === "string" ? next.caption : undefined),
    ownerHandle: next.ownerHandle || prev.ownerHandle || null,
    ...(prev.fromFeedTap || next.fromFeedTap ? { fromFeedTap: true } : {}),
  };
}

function inferItemPostType(item, platform) {
  if (item && typeof item.postType === "string" && item.postType.trim()) {
    return item.postType.trim();
  }
  const url = typeof item?.sourceUrl === "string" ? item.sourceUrl : "";
  if (platform === "tiktok") {
    return url.includes("/photo/") ? "carousel" : "tiktok_video";
  }
  return url.includes("/reel/") ? "reels" : "feed";
}

function hasVerifiedScannedMetadata(item) {
  if (!item || typeof item !== "object" || typeof item.sourceUrl !== "string" || !item.sourceUrl) return false;
  const hasPostedAt = typeof item.postedAt === "string" && Number.isFinite(Date.parse(item.postedAt));
  const hasCaption = typeof item.caption === "string" && item.caption.trim().length > 0;
  const hasMetric = [item.gridViews, item.gridLikes, item.gridComments, item.gridShares].some(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
  const hasImage = typeof item.imageUrl === "string" && item.imageUrl.startsWith("https://");
  if (item.fromFeedTap === true) {
    return hasPostedAt || hasCaption || hasMetric || hasImage;
  }
  return hasPostedAt && (hasCaption || hasMetric || hasImage);
}

function buildVerifiedPostFromScannedItem(target, item) {
  return {
    targetKey: target.targetKey,
    targetType: target.targetType,
    competitorId: target.competitorId || null,
    outletKey: target.outletKey || null,
    account: target.handle || null,
    followers: typeof target.followers === "number" ? target.followers : null,
    profilePostsTotal: typeof target.profilePostsTotal === "number" ? target.profilePostsTotal : null,
    platform: target.platform,
    postType: inferItemPostType(item, target.platform),
    sourceUrl: item.sourceUrl,
    postedAt: item.postedAt || null,
    caption: typeof item.caption === "string" ? item.caption : "",
    imageUrl: typeof item.imageUrl === "string" && item.imageUrl.startsWith("https://") ? item.imageUrl : null,
    metrics: {
      views: typeof item.gridViews === "number" && Number.isFinite(item.gridViews) ? item.gridViews : null,
      likes: typeof item.gridLikes === "number" && Number.isFinite(item.gridLikes) ? item.gridLikes : null,
      comments: typeof item.gridComments === "number" && Number.isFinite(item.gridComments) ? item.gridComments : null,
      shares: typeof item.gridShares === "number" && Number.isFinite(item.gridShares) ? item.gridShares : null,
    },
    comments: [],
  };
}

function isCompleteFeedItem(item, platform) {
  if (!item || typeof item !== "object") return false;
  if (typeof item.postedAt !== "string" || !item.postedAt.trim() || !Number.isFinite(Date.parse(item.postedAt))) {
    return false;
  }
  const postType = inferItemPostType(item, platform);
  const hasCaption = typeof item.caption === "string" && item.caption.trim().length > 0;
  const hasImage = typeof item.imageUrl === "string" && item.imageUrl.startsWith("https://");
  const hasAnyMetric = [item.gridViews, item.gridLikes, item.gridComments, item.gridShares].some(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );

  // Instagram dari passive feed-tap: anggap lengkap bila tanggal tayang sah dan ada caption, gambar HTTPS,
  // atau minimal satu metrik non-null (jangan menolak Reels/video lama hanya karena gridViews === null).
  if (platform === "instagram" && item.fromFeedTap === true) {
    return hasCaption || hasImage || hasAnyMetric;
  }

  // TikTok Photo Mode (/photo/) dari feed-tap tetap sah tanpa caption bila sudah membawa gambar atau metrik asli.
  const isVerifiedCaptionlessTikTokPhoto =
    platform === "tiktok" &&
    postType === "carousel" &&
    item.fromFeedTap === true &&
    (hasImage ||
      (typeof item.gridViews === "number" && Number.isFinite(item.gridViews) && item.gridViews >= 0) ||
      (typeof item.gridLikes === "number" && Number.isFinite(item.gridLikes) && item.gridLikes >= 0));
  if (!hasCaption && !isVerifiedCaptionlessTikTokPhoto) {
    return false;
  }
  if (postType === "reels" || postType === "tiktok_video") {
    if (typeof item.gridViews !== "number" || !Number.isFinite(item.gridViews) || item.gridViews < 0) {
      return false;
    }
  }
  return true;
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (true) {
      const state = await readState();
      if (state.status !== "running") break;
      if (state.targetIndex >= state.targets.length) {
        await closeWorkerTab(state.workerTabId);
        await writeState({
          status: "completed",
          workerTabId: null,
          currentTargetItems: null,
          currentItemIndex: 0,
          currentLabel: "Selesai",
          currentTargetHandle: null,
          currentTargetPlatform: null,
          currentProfileCollected: null,
          currentTargetCollected: null,
          currentTargetExpected: null,
          currentPhase: null,
          currentDetailIndex: null,
          currentDetailTotal: null,
          currentReelsAdded: null,
          currentTargetReachedBottom: null,
          currentSkippedKnown: null,
          currentFeedSaved: null,
          currentHasNextPage: null,
          lastCompletedTargetMeta: null,
          pausedReason: null,
          pausedKind: null,
          pausedUrl: null,
          pausedTargetName: null,
        });
        break;
      }

      const target = state.targets[state.targetIndex];
      const resumingDetails = Array.isArray(state.currentTargetItems);
      let tabId = state.workerTabId;

      // Sebelum memulai target baru sesudah target sebelumnya selesai: rotasi tab pekerja untuk akun berat
      // (>= HEAVY_TAB_ROTATE_THRESHOLD) atau pasca rate-limit, dan beri jeda sopan antar akun Instagram.
      if (!resumingDetails && state.lastCompletedTargetMeta) {
        const prevMeta = state.lastCompletedTargetMeta;
        await writeState({ lastCompletedTargetMeta: null });
        const shouldRotateTab =
          (prevMeta.platform === "instagram" && (prevMeta.scannedCount || 0) >= HEAVY_TAB_ROTATE_THRESHOLD) ||
          prevMeta.rateLimited === true;
        if (shouldRotateTab && typeof tabId === "number") {
          await closeWorkerTab(tabId);
          tabId = null;
          await writeState({ workerTabId: null });
        }
        let interTargetPacingMs = 0;
        if (prevMeta.rateLimited === true || (prevMeta.scannedCount || 0) >= 400) {
          interTargetPacingMs = HEAVY_TARGET_PACING_MS;
        } else if (prevMeta.platform === "instagram" && target.platform === "instagram") {
          interTargetPacingMs = INTER_TARGET_PACING_MS;
        }
        if (interTargetPacingMs > 0) {
          const stillRunningAfterPace = await waitInterruptible(interTargetPacingMs);
          if (!stillRunningAfterPace) break;
        }
      }

      await writeState({
        currentLabel: `${target.name} (${target.platform})`,
        currentTargetHandle: target.handle || null,
        currentTargetPlatform: target.platform || null,
        currentPhase: resumingDetails ? "details" : "profile",
        currentDetailIndex: resumingDetails ? state.currentItemIndex : null,
        currentDetailTotal: resumingDetails ? state.currentTargetItems.length : null,
        currentReelsAdded: resumingDetails ? state.currentReelsAdded : null,
        currentTargetReachedBottom: resumingDetails ? state.currentTargetReachedBottom : null,
        currentSkippedKnown: resumingDetails ? state.currentSkippedKnown : null,
        currentFeedSaved: resumingDetails ? state.currentFeedSaved : null,
        currentHasNextPage: resumingDetails ? state.currentHasNextPage : null,
        currentProfileCollected: resumingDetails
          ? typeof state.currentProfileCollected === "number"
            ? state.currentProfileCollected
            : null
          : 0,
        currentTargetCollected: resumingDetails
          ? typeof state.currentTargetCollected === "number"
            ? state.currentTargetCollected
            : state.currentTargetItems.length
          : 0,
        currentTargetExpected:
          typeof target.profilePostsTotal === "number"
            ? target.profilePostsTotal
            : resumingDetails
              ? state.currentTargetExpected
              : null,
        pausedReason: null,
        pausedKind: null,
      });

      const navOpts = { dashboardWindowId: state.dashboardWindowId };

      if (!Array.isArray(state.currentTargetItems)) {
        try {
          tabId = await navigateWithRetry(tabId, target.profileUrl, PROFILE_NAV_TIMEOUT_MS, navOpts);
          await writeState({ workerTabId: tabId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await writeState((cur) => ({
            targetIndex: cur.targetIndex + 1,
            completedTargets: cur.completedTargets + 1,
            currentTargetItems: null,
            currentItemIndex: 0,
            targetResults: upsertTargetResult(cur.targetResults, {
              targetKey: target.targetKey,
              name: target.name,
              handle: target.handle || "",
              platform: target.platform,
              collected: 0,
              expected: null,
              status: "error",
              reason: msg,
            }),
            errors: [...cur.errors, `${target.name}: ${msg}`],
          }));
          continue;
        }

        // Jeda segera jika tab pekerja berada di mode Incognito agar tidak membuang 20 menit mengunduh ~12 postingan saja.
        try {
          const workerTab = await chrome.tabs.get(tabId);
          if (workerTab?.incognito) {
            await writeState({ workerIncognito: true });
            await pauseOnChallenge(
              tabId,
              target,
              {
                blocked: true,
                kind: "incognito",
                reason:
                  "Tab pekerja terbuka di mode Incognito sehingga tidak memiliki sesi login Instagram & TikTok (profil dibatasi ~12 postingan atau ditolak). Buka satu jendela Chrome biasa yang sudah masuk ke akun Instagram & TikTok (atau buka dashboard di jendela Chrome biasa), lalu klik Lanjutkan — atau klik Lewati Akun Ini.",
              },
              target.profileUrl,
            );
            break;
          }
          await writeState({ workerIncognito: false });
        } catch {
          // Lanjut ke pemeriksaan tab di runExtractorOnTab.
        }

        const freshAfterNav = await readState();
        if (freshAfterNav.status !== "running") break;

        const ownInstagramHandles = freshAfterNav.targets
          .filter((t) => t && t.targetType === "own" && t.platform === "instagram" && t.handle)
          .map((t) => t.handle);
        const collabHandles = target.targetType === "own" && target.platform === "instagram" ? ownInstagramHandles : [];

        let profileRes;
        try {
          profileRes = await runExtractorOnTab(tabId, "__sanghyangRunProfile", [
            target.platform,
            freshAfterNav.maxPostsPerTarget,
            target.handle || "",
            collabHandles,
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await writeState((cur) => ({
            targetIndex: cur.targetIndex + 1,
            completedTargets: cur.completedTargets + 1,
            currentTargetItems: null,
            currentItemIndex: 0,
            targetResults: upsertTargetResult(cur.targetResults, {
              targetKey: target.targetKey,
              name: target.name,
              handle: target.handle || "",
              platform: target.platform,
              collected: 0,
              expected: null,
              status: "error",
              reason: msg,
            }),
            errors: [...cur.errors, `${target.name}: ${msg}`],
          }));
          continue;
        }

        if (profileRes?.challenge?.blocked) {
          await pauseOnChallenge(tabId, target, profileRes.challenge, target.profileUrl);
          break;
        }

        // Pemulihan profil: aktif bila terkena rate-limit, berhenti stale dengan hasNextPage/celah parah/<95% belum mencapai bawah,
        // atau TikTok 0 item padahal bukan profil kosong/404. Jika rate-limit terdeteksi, tunggu cooldown 35 detik bertahap,
        // lalu tutup tab pekerja lama dan buka tab BARU agar state React/Relay 100% segar.
        const initialExpected =
          typeof profileRes?.scan?.expected === "number"
            ? profileRes.scan.expected
            : typeof profileRes?.profile?.posts === "number"
              ? profileRes.profile.posts
              : null;
        const initialCollected = typeof profileRes?.scan?.collected === "number" ? profileRes.scan.collected : 0;
        const initialHasNextPage =
          typeof profileRes?.scan?.hasNextPage === "boolean" ? profileRes.scan.hasNextPage : null;
        const initialRateLimited = isScanRateLimited(profileRes);
        const needProfileRetry = shouldRetryProfileScan(profileRes, target.platform);
        let profileRateLimitedAfterRetry = false;
        let targetHadRateLimit = initialRateLimited;

        if (needProfileRetry) {
          if (initialRateLimited) {
            await writeState({ currentPhase: "cooldown" });
            const stillRunning = await waitInterruptible(RATE_LIMIT_COOLDOWN_MS);
            if (!stillRunning) break;
            await writeState({ currentPhase: "profile" });
          }

          let retryAborted = false;
          try {
            await closeWorkerTab(tabId);
            tabId = null;
            await writeState({ workerTabId: null });
            tabId = await navigateWithRetry(null, target.profileUrl, PROFILE_NAV_TIMEOUT_MS, navOpts);
            await writeState({ workerTabId: tabId });
            await chrome.tabs.update(tabId, { active: true });

            const freshBeforeRetry = await readState();
            if (freshBeforeRetry.status !== "running") {
              retryAborted = true;
            } else {
              const retryRes = await runExtractorOnTab(tabId, "__sanghyangRunProfile", [
                target.platform,
                freshAfterNav.maxPostsPerTarget,
                target.handle || "",
                collabHandles,
                { resetScroll: true },
              ]);
              if (retryRes?.challenge?.blocked) {
                profileRes = retryRes;
              } else if (retryRes && Array.isArray(retryRes.items)) {
                profileRateLimitedAfterRetry = isScanRateLimited(retryRes);
                targetHadRateLimit = targetHadRateLimit || profileRateLimitedAfterRetry;
                const mergedByKey = new Map(
                  (Array.isArray(profileRes.items) ? profileRes.items : []).map((x) => [
                    postMergeKey(target.platform, x.sourceUrl),
                    x,
                  ]),
                );
                for (const item of retryRes.items) {
                  const k = postMergeKey(target.platform, item.sourceUrl);
                  const prev = mergedByKey.get(k);
                  mergedByKey.set(k, prev ? mergeScannedItem(prev, item) : item);
                }
                const mergedItems = Array.from(mergedByKey.values());
                const preservedPosts =
                  typeof retryRes.profile?.posts === "number"
                    ? retryRes.profile.posts
                    : typeof profileRes.profile?.posts === "number"
                      ? profileRes.profile.posts
                      : null;
                const preservedExpected =
                  typeof retryRes.scan?.expected === "number"
                    ? retryRes.scan.expected
                    : initialExpected ?? preservedPosts;
                const retryHasNextPage =
                  typeof retryRes.scan?.hasNextPage === "boolean"
                    ? retryRes.scan.hasNextPage
                    : initialHasNextPage;
                profileRes = {
                  ...retryRes,
                  profile: {
                    ...(profileRes.profile || {}),
                    ...(retryRes.profile || {}),
                    followers:
                      typeof retryRes.profile?.followers === "number"
                        ? retryRes.profile.followers
                        : typeof profileRes.profile?.followers === "number"
                          ? profileRes.profile.followers
                          : null,
                    posts: preservedPosts,
                    isEmptyProfile: Boolean(retryRes.profile?.isEmptyProfile ?? profileRes.profile?.isEmptyProfile),
                    notFound: Boolean(retryRes.profile?.notFound ?? profileRes.profile?.notFound),
                  },
                  items: mergedItems,
                  scan: {
                    ...(profileRes.scan || {}),
                    ...(retryRes.scan || {}),
                    expected: preservedExpected,
                    collected: Math.max(mergedItems.length, retryRes.scan?.collected || 0, initialCollected),
                    hasNextPage: retryHasNextPage,
                    rateLimited: profileRateLimitedAfterRetry,
                    reachedBottom:
                      !profileRateLimitedAfterRetry &&
                      retryHasNextPage !== true &&
                      Boolean(retryRes.scan?.reachedBottom || retryRes.scan?.stoppedBy === "expected"),
                  },
                };
              }
            }
          } catch {
            // Gunakan hasil awal bila pembukaan ulang tab segar sementara gagal.
          } finally {
            if (typeof freshAfterNav.dashboardTabId === "number") {
              try {
                await chrome.tabs.update(freshAfterNav.dashboardTabId, { active: true });
              } catch {
                // Abaikan bila tab dashboard sudah ditutup.
              }
            }
          }
          if (retryAborted) break;
          if (profileRes?.challenge?.blocked) {
            await pauseOnChallenge(tabId, target, profileRes.challenge, target.profileUrl);
            break;
          }

          const postRetryExpected =
            typeof profileRes?.scan?.expected === "number"
              ? profileRes.scan.expected
              : typeof profileRes?.profile?.posts === "number"
                ? profileRes.profile.posts
                : null;
          const postRetryCollected =
            Array.isArray(profileRes?.items) && profileRes.items.length > 0
              ? profileRes.items.length
              : typeof profileRes?.scan?.collected === "number"
                ? profileRes.scan.collected
                : 0;
          const postRetryHasNext =
            typeof profileRes?.scan?.hasNextPage === "boolean" ? profileRes.scan.hasNextPage : null;
          const postRetrySevereGap =
            postRetryExpected !== null &&
            postRetryExpected >= 50 &&
            postRetryCollected < Math.floor(postRetryExpected * 0.5);
          if (profileRateLimitedAfterRetry && (postRetryHasNext === true || postRetrySevereGap)) {
            const platformLabel = target.platform === "tiktok" ? "TikTok" : "Instagram";
            const countInfo =
              postRetryExpected !== null
                ? ` (${postRetryCollected.toLocaleString("id-ID")} dari ${postRetryExpected.toLocaleString("id-ID")} postingan)`
                : "";
            await writeState({
              currentProfileCollected: postRetryCollected,
              currentTargetCollected: postRetryCollected,
              currentTargetExpected: postRetryExpected,
            });
            await pauseOnChallenge(
              tabId,
              target,
              {
                blocked: true,
                kind: "rate_limit",
                reason: `${platformLabel} membatasi permintaan sementara pada akun ${target.name}${countInfo}. Tunggu 1–2 menit lalu klik Lanjutkan, atau klik Lewati Akun Ini.`,
              },
              target.profileUrl,
            );
            break;
          }
        }

        if (typeof profileRes?.profile?.followers === "number") {
          target.followers = profileRes.profile.followers;
        }
        if (typeof profileRes?.profile?.posts === "number") {
          target.profilePostsTotal = profileRes.profile.posts;
        }

        const expectedTotal =
          typeof profileRes?.scan?.expected === "number"
            ? profileRes.scan.expected
            : typeof profileRes?.profile?.posts === "number"
              ? profileRes.profile.posts
              : null;
        const collectedCount = typeof profileRes?.scan?.collected === "number" ? profileRes.scan.collected : 0;

        await writeState({
          currentProfileCollected: collectedCount,
          currentTargetCollected: collectedCount,
          currentTargetExpected: expectedTotal,
        });

        // Akun TikTok tidak ditemukan (statusCode 10221 / halaman 404): catat error eksplisit lalu lanjut akun berikutnya.
        if (target.platform === "tiktok" && profileRes?.profile?.notFound === true) {
          const notFoundMsg = `${target.name} (${target.platform}): akun @${target.handle || "?"} tidak ditemukan di TikTok (tautan akun kemungkinan keliru atau telah berubah).`;
          await writeState((cur) => ({
            targetIndex: cur.targetIndex + 1,
            completedTargets: cur.completedTargets + 1,
            currentTargetItems: null,
            currentItemIndex: 0,
            targetResults: upsertTargetResult(cur.targetResults, {
              targetKey: target.targetKey,
              name: target.name,
              handle: target.handle || "",
              platform: target.platform,
              collected: 0,
              expected: null,
              reelsAdded: 0,
              reachedBottom: false,
              status: "not_found",
              reason: notFoundMsg,
            }),
            errors: [...cur.errors, notFoundMsg],
          }));
          continue;
        }

        const isConfirmedEmptyTikTok =
          target.platform === "tiktok" &&
          (profileRes?.profile?.isEmptyProfile === true || expectedTotal === 0);

        // Jangan pernah melewati akun TikTok 0 item diam-diam (meski followers terbaca & expectedTotal null) kecuali
        // profil benar-benar terkonfirmasi kosong (videoCount === 0 atau teks kosong nyata).
        const unhydratedZero =
          collectedCount === 0 &&
          ((expectedTotal !== null && expectedTotal > 0) ||
            Boolean(profileRes?.hadInterstitial) ||
            (target.platform === "tiktok" && !isConfirmedEmptyTikTok));
        if (unhydratedZero) {
          const totalLabel = expectedTotal ? `${expectedTotal.toLocaleString("id-ID")} postingan` : "daftar video/postingan";
          await pauseOnChallenge(
            tabId,
            target,
            {
              blocked: true,
              kind: target.platform === "tiktok" ? "captcha" : "login",
              reason: `Profil ${target.name} belum memuat ${totalLabel} (0 postingan terbaca di tab Chrome — kemungkinan tertahan verifikasi/interstitial, mode Incognito, atau belum login). Buka tab tersebut, tunggu hingga daftar video/postingan tampil atau selesaikan verifikasi, lalu klik Lanjutkan — atau klik Lewati Akun Ini.`,
            },
            target.profileUrl,
          );
          break;
        }

        if (isConfirmedEmptyTikTok && collectedCount === 0) {
          await writeState((cur) => ({
            targetIndex: cur.targetIndex + 1,
            completedTargets: cur.completedTargets + 1,
            currentTargetItems: null,
            currentItemIndex: 0,
            targetResults: upsertTargetResult(cur.targetResults, {
              targetKey: target.targetKey,
              name: target.name,
              handle: target.handle || "",
              platform: target.platform,
              collected: 0,
              expected: 0,
              reelsAdded: 0,
              reachedBottom: true,
              status: "empty",
              reason: "Profil TikTok belum memiliki video publik.",
            }),
          }));
          continue;
        }

        // Jika Instagram belum login (navigasi Masuk/Daftar tampil) dan hanya terbaca ~12 postingan padahal profil punya lebih banyak,
        // jeda segera agar pengguna membuka jendela Chrome biasa yang sudah login alih-alih diam-diam menyimpan 10–12 postingan.
        if (
          target.platform === "instagram" &&
          profileRes?.isLoggedOutNav &&
          ((expectedTotal && expectedTotal > 12 && collectedCount <= 14) ||
            (expectedTotal === null && collectedCount > 0 && collectedCount <= 14))
        ) {
          const totalDesc = expectedTotal ? ` dari ${expectedTotal.toLocaleString("id-ID")}` : "";
          await pauseOnChallenge(
            tabId,
            target,
            {
              blocked: true,
              kind: "login",
              reason: `Instagram hanya menampilkan ${collectedCount}${totalDesc} postingan ${target.name} karena tab Chrome belum masuk akun Instagram (atau sedang dalam mode Incognito). Buka dashboard di jendela Chrome biasa yang sudah login Instagram, atau login di tab Chrome ini lalu klik Lanjutkan — atau klik Lewati Akun Ini.`,
            },
            target.profileUrl,
          );
          break;
        }

        const effectiveExpected = expectedTotal ?? (typeof target.profilePostsTotal === "number" ? target.profilePostsTotal : null);
        let items = Array.isArray(profileRes?.items) ? profileRes.items : [];
        const profileUniqueMap = new Map(items.map((x) => [postMergeKey(target.platform, x.sourceUrl), x]));
        let profileCollectedCount = profileUniqueMap.size > 0 ? profileUniqueMap.size : collectedCount;
        const profileHasNextPage = typeof profileRes?.scan?.hasNextPage === "boolean" ? profileRes.scan.hasNextPage : null;
        const profileReachedBottom =
          !profileRateLimitedAfterRetry &&
          profileHasNextPage !== true &&
          (Boolean(profileRes?.scan?.reachedBottom) || profileRes?.scan?.stoppedBy === "expected");
        let reelsReachedBottom = true;
        let reelsHasNextPage = null;
        let reelsAddedCount = 0;
        let reelsRateLimitedAfterRetry = false;

        if (target.platform === "instagram" && target.handle) {
          await writeState({
            currentPhase: "reels",
            currentReelsAdded: 0,
            currentProfileCollected: profileCollectedCount,
            currentTargetCollected: profileCollectedCount,
            currentTargetExpected: effectiveExpected,
            currentHasNextPage: profileHasNextPage,
          });
          let reelsAborted = false;
          try {
            const reelsUrl = `https://www.instagram.com/${target.handle}/reels/`;
            tabId = await navigateWithRetry(tabId, reelsUrl, REELS_NAV_TIMEOUT_MS, navOpts);
            await writeState({ workerTabId: tabId });
            let reelsRes = await runExtractorOnTab(tabId, "__sanghyangRunProfile", [
              "instagram",
              freshAfterNav.maxPostsPerTarget,
              target.handle,
              collabHandles,
            ]);
            if (reelsRes?.challenge?.blocked) {
              await pauseOnChallenge(tabId, target, reelsRes.challenge, reelsUrl);
              reelsAborted = true;
            }
            if (!reelsAborted) {
              const profileHasReels = items.some((x) => x.postType === "reels");
              const reelsInitialCount = Array.isArray(reelsRes?.items) ? reelsRes.items.length : 0;
              const reelsInitialRateLimited = isScanRateLimited(reelsRes);
              if (reelsInitialRateLimited) targetHadRateLimit = true;
              const needReelsRetry =
                !reelsRes?.isLoggedOutNav &&
                (reelsInitialRateLimited ||
                  (reelsInitialCount === 0 && (reelsRes?.wasHidden === true || profileHasReels)) ||
                  (reelsRes?.wasHidden === true && reelsRes?.scan?.stoppedBy === "stale" && !reelsRes?.scan?.reachedBottom) ||
                  (reelsRes?.scan?.hasNextPage === true && reelsRes?.scan?.stoppedBy === "stale"));

              if (needReelsRetry) {
                if (reelsInitialRateLimited) {
                  await writeState({ currentPhase: "cooldown" });
                  const stillRunning = await waitInterruptible(RATE_LIMIT_COOLDOWN_MS);
                  if (!stillRunning) {
                    reelsAborted = true;
                  } else {
                    await writeState({ currentPhase: "reels" });
                  }
                }
                if (!reelsAborted) {
                  try {
                    await closeWorkerTab(tabId);
                    tabId = null;
                    await writeState({ workerTabId: null });
                    tabId = await navigateWithRetry(null, reelsUrl, REELS_NAV_TIMEOUT_MS, navOpts);
                    await writeState({ workerTabId: tabId });
                    await chrome.tabs.update(tabId, { active: true });

                    const freshBeforeReelsRetry = await readState();
                    if (freshBeforeReelsRetry.status !== "running") {
                      reelsAborted = true;
                    } else {
                      const retryReels = await runExtractorOnTab(tabId, "__sanghyangRunProfile", [
                        "instagram",
                        freshAfterNav.maxPostsPerTarget,
                        target.handle,
                        collabHandles,
                        { resetScroll: true },
                      ]);
                      if (retryReels?.challenge?.blocked) {
                        reelsRes = retryReels;
                      } else if (retryReels && Array.isArray(retryReels.items)) {
                        reelsRateLimitedAfterRetry = isScanRateLimited(retryReels);
                        targetHadRateLimit = targetHadRateLimit || reelsRateLimitedAfterRetry;
                        const mergedReels = new Map(
                          (Array.isArray(reelsRes?.items) ? reelsRes.items : []).map((x) => [
                            postMergeKey("instagram", x.sourceUrl),
                            x,
                          ]),
                        );
                        for (const r of retryReels.items) {
                          const rk = postMergeKey("instagram", r.sourceUrl);
                          const prevR = mergedReels.get(rk);
                          mergedReels.set(rk, prevR ? mergeScannedItem(prevR, r) : r);
                        }
                        const retryReelsHasNext =
                          typeof retryReels.scan?.hasNextPage === "boolean"
                            ? retryReels.scan.hasNextPage
                            : typeof reelsRes?.scan?.hasNextPage === "boolean"
                              ? reelsRes.scan.hasNextPage
                              : null;
                        reelsRes = {
                          ...retryReels,
                          items: Array.from(mergedReels.values()),
                          scan: {
                            ...(reelsRes?.scan || {}),
                            ...(retryReels.scan || {}),
                            collected: mergedReels.size,
                            hasNextPage: retryReelsHasNext,
                            rateLimited: reelsRateLimitedAfterRetry,
                            reachedBottom:
                              !reelsRateLimitedAfterRetry &&
                              retryReelsHasNext !== true &&
                              Boolean(retryReels.scan?.reachedBottom || retryReels.scan?.stoppedBy === "expected"),
                          },
                        };
                      }
                    }
                  } catch {
                    // Gunakan hasil tab Reels awal bila pembukaan ulang tab segar sementara gagal.
                  } finally {
                    if (typeof freshAfterNav.dashboardTabId === "number") {
                      try {
                        await chrome.tabs.update(freshAfterNav.dashboardTabId, { active: true });
                      } catch {
                        // Abaikan bila tab dashboard sudah ditutup.
                      }
                    }
                  }
                }
                if (!reelsAborted && reelsRes?.challenge?.blocked) {
                  await pauseOnChallenge(tabId, target, reelsRes.challenge, reelsUrl);
                  reelsAborted = true;
                }
              }

              if (!reelsAborted) {
                reelsHasNextPage = typeof reelsRes?.scan?.hasNextPage === "boolean" ? reelsRes.scan.hasNextPage : null;
                const reelsItems = Array.isArray(reelsRes?.items) ? reelsRes.items : [];
                if (reelsRateLimitedAfterRetry && (reelsHasNextPage === true || (reelsItems.length === 0 && profileHasReels))) {
                  await pauseOnChallenge(
                    tabId,
                    target,
                    {
                      blocked: true,
                      kind: "rate_limit",
                      reason: `Instagram membatasi permintaan sementara pada tab Reels akun ${target.name}. Tunggu 1–2 menit lalu klik Lanjutkan, atau klik Lewati Akun Ini.`,
                    },
                    reelsUrl,
                  );
                  reelsAborted = true;
                } else {
                  reelsReachedBottom =
                    !reelsRateLimitedAfterRetry &&
                    reelsHasNextPage !== true &&
                    (Boolean(reelsRes?.scan?.reachedBottom) || reelsRes?.scan?.stoppedBy === "expected");
                  const byKey = new Map(profileUniqueMap);
                  const maxPosts = freshAfterNav.maxPostsPerTarget;
                  for (const rItem of reelsItems) {
                    const mergeKey = postMergeKey("instagram", rItem.sourceUrl);
                    const prev = byKey.get(mergeKey);
                    if (prev) {
                      byKey.set(mergeKey, mergeScannedItem(prev, rItem));
                    } else if (maxPosts === 0 || byKey.size < maxPosts) {
                      byKey.set(mergeKey, rItem);
                      reelsAddedCount++;
                    }
                  }
                  items = maxPosts === 0 ? Array.from(byKey.values()) : Array.from(byKey.values()).slice(0, maxPosts);
                }
              }
            }
          } catch (err) {
            reelsReachedBottom = false;
            const reelsErrMsg = err instanceof Error ? err.message : String(err);
            await writeState((cur) => ({
              errors: [...cur.errors, `${target.name} (tab Reels): gagal memuat tab Reels (${reelsErrMsg}).`],
            }));
          }
          if (reelsAborted) break;
        }

        // Pisahkan `profileCollected` (grid utama) vs `reelsAdded` vs `collected` (total unik) lalu evaluasi kelengkapan.
        const mergedCollectedCount = items.length > 0 ? items.length : collectedCount;
        if (profileCollectedCount > mergedCollectedCount) {
          profileCollectedCount = mergedCollectedCount;
        }
        const combinedRateLimited = Boolean(profileRateLimitedAfterRetry || reelsRateLimitedAfterRetry || targetHadRateLimit);
        const completeness = evaluateTargetCompleteness({
          platform: target.platform,
          name: target.name,
          maxPostsPerTarget: freshAfterNav.maxPostsPerTarget,
          profileCollected: profileCollectedCount,
          mergedCollected: mergedCollectedCount,
          reelsAdded: reelsAddedCount,
          expected: effectiveExpected,
          profileStoppedBy: profileRes?.scan?.stoppedBy || null,
          profileReachedBottom,
          profileHasNextPage,
          reelsReachedBottom,
          reelsHasNextPage,
          rateLimited: combinedRateLimited,
        });
        const combinedHasNextPage = completeness.combinedHasNextPage;
        const combinedReachedBottom = completeness.combinedReachedBottom;
        const partialScanNote = completeness.partialScanNote;
        const scanStatus = completeness.scanStatus;
        if (completeness.shouldRecordError && partialScanNote) {
          await writeState((cur) => ({
            errors: [...cur.errors, partialScanNote],
          }));
        }

        // Sinkronisasi inkremental + Fast-Save Feed-Tap:
        // - Postingan yang sudah ada di DB lokal di luar 15 teratas dilewati (`skippedKnownCount`).
        // - Akun sendiri membuka detail 25 terbaru (`DETAIL_COMMENT_WINDOW`); kompetitor membuka 15 terbaru
        //   (`COMPETITOR_DETAIL_COMMENT_WINDOW`), plus postingan baru yang belum lengkap metadata JSON-nya.
        // - Postingan historis baru di luar jendela detail yang sudah lengkap dari passive feed-tap langsung
        //   masuk `pendingPosts` (`feedSavedCount`) tanpa membuka ratusan tab satu per satu.
        const detailCommentWindow =
          target.targetType === "competitor" ? COMPETITOR_DETAIL_COMMENT_WINDOW : DETAIL_COMMENT_WINDOW;
        const knownKeys = new Set(
          (Array.isArray(freshAfterNav.knownPostUrls) ? freshAfterNav.knownPostUrls : []).map((u) =>
            postMergeKey(target.platform, u),
          ),
        );
        const unseenDetailItems = [];
        const recentKnownItems = [];
        const feedFastSavePosts = [];
        let skippedKnownCount = 0;

        for (let idx = 0; idx < items.length; idx++) {
          const it = items[idx];
          const key = postMergeKey(target.platform, it.sourceUrl);
          const isKnown = knownKeys.size > 0 && knownKeys.has(key);
          if (isKnown) {
            if (idx < RECENT_REFRESH_WINDOW) {
              recentKnownItems.push(it);
            } else {
              skippedKnownCount++;
            }
          } else if (idx < detailCommentWindow || !isCompleteFeedItem(it, target.platform)) {
            unseenDetailItems.push(it);
          } else {
            feedFastSavePosts.push(buildVerifiedPostFromScannedItem(target, it));
          }
        }
        items = [...unseenDetailItems, ...recentKnownItems];
        const feedSavedCount = feedFastSavePosts.length;

        await writeState((cur) => {
          const updatedTargets = cur.targets.map((t, idx) =>
            idx === cur.targetIndex
              ? {
                  ...t,
                  ...(typeof target.followers === "number" ? { followers: target.followers } : {}),
                  ...(typeof target.profilePostsTotal === "number" ? { profilePostsTotal: target.profilePostsTotal } : {}),
                  ...(partialScanNote ? { partialScanNote } : { partialScanNote: null }),
                  profileCollected: profileCollectedCount,
                  scannedCount: mergedCollectedCount,
                  reelsAdded: reelsAddedCount,
                  rateLimited: combinedRateLimited,
                  reachedBottom: combinedReachedBottom,
                  skippedKnown: skippedKnownCount,
                  feedSaved: feedSavedCount,
                  hasNextPage: combinedHasNextPage,
                  scanStatus,
                }
              : t,
          );
          return {
            targets: updatedTargets,
            currentPhase: "details",
            currentTargetItems: items,
            currentItemIndex: 0,
            currentDetailIndex: 0,
            currentDetailTotal: items.length,
            currentProfileCollected: profileCollectedCount,
            currentTargetCollected: mergedCollectedCount,
            currentTargetExpected: effectiveExpected,
            currentReelsAdded: target.platform === "instagram" ? reelsAddedCount : null,
            currentTargetReachedBottom: combinedReachedBottom,
            currentSkippedKnown: skippedKnownCount,
            currentFeedSaved: feedSavedCount,
            currentHasNextPage: combinedHasNextPage,
            ...(feedFastSavePosts.length > 0
              ? {
                  pendingPosts: [...cur.pendingPosts, ...feedFastSavePosts],
                  syncedPostsCount: cur.syncedPostsCount + feedFastSavePosts.length,
                }
              : {}),
            targetResults: upsertTargetResult(cur.targetResults, {
              targetKey: target.targetKey,
              name: target.name,
              handle: target.handle || "",
              platform: target.platform,
              profileCollected: profileCollectedCount,
              collected: mergedCollectedCount,
              expected: effectiveExpected,
              reelsAdded: reelsAddedCount,
              rateLimited: combinedRateLimited,
              reachedBottom: combinedReachedBottom,
              skippedKnown: skippedKnownCount,
              feedSaved: feedSavedCount,
              hasNextPage: combinedHasNextPage,
              status: scanStatus === "partial" ? "partial" : "running",
              reason: partialScanNote,
            }),
          };
        });
      }

      let targetAbortedByPauseOrStop = false;
      while (true) {
        const cur = await readState();
        if (cur.status !== "running") {
          targetAbortedByPauseOrStop = true;
          break;
        }
        const items = Array.isArray(cur.currentTargetItems) ? cur.currentTargetItems : [];
        if (cur.currentItemIndex >= items.length) break;

        const item = items[cur.currentItemIndex];
        // Jeda sopan antar video TikTok agar tidak memicu HTTP 403 beruntun dari server TikTok.
        if (target.platform === "tiktok" && cur.currentItemIndex > 0) {
          await new Promise((r) => setTimeout(r, TIKTOK_DETAIL_PACING_MS));
          const afterWait = await readState();
          if (afterWait.status !== "running") {
            targetAbortedByPauseOrStop = true;
            break;
          }
        }
        try {
          tabId = await navigateWithRetry(cur.workerTabId, item.sourceUrl, POST_NAV_TIMEOUT_MS, navOpts);
          await writeState({ workerTabId: tabId });
          const detailRes = await runExtractorOnTab(tabId, "__sanghyangRunPost", [
            target.platform,
            item.sourceUrl,
            {
              gridViews: item.gridViews ?? null,
              gridLikes: item.gridLikes ?? null,
              gridComments: item.gridComments ?? null,
              gridShares: item.gridShares ?? null,
            },
            cur.allowedHandles,
          ]);
          if (detailRes?.challenge?.blocked) {
            await pauseOnChallenge(tabId, target, detailRes.challenge, item.sourceUrl);
            targetAbortedByPauseOrStop = true;
            break;
          }

          if (detailRes?.post) {
            const detailMetrics =
              detailRes.post.metrics && typeof detailRes.post.metrics === "object" ? detailRes.post.metrics : {};
            const enrichedPost = {
              targetKey: target.targetKey,
              targetType: target.targetType,
              competitorId: target.competitorId || null,
              outletKey: target.outletKey || null,
              account: target.handle || null,
              followers: typeof target.followers === "number" ? target.followers : null,
              profilePostsTotal: typeof target.profilePostsTotal === "number" ? target.profilePostsTotal : null,
              platform: target.platform,
              postType: detailRes.post.postType || inferItemPostType(item, target.platform),
              sourceUrl: detailRes.post.sourceUrl,
              postedAt: detailRes.post.postedAt || item.postedAt || null,
              caption:
                (typeof detailRes.post.caption === "string" && detailRes.post.caption.trim()
                  ? detailRes.post.caption
                  : typeof item.caption === "string"
                    ? item.caption
                    : "") || "",
              imageUrl: detailRes.post.imageUrl || item.imageUrl || null,
              metrics: {
                views: detailMetrics.views ?? item.gridViews ?? null,
                likes: detailMetrics.likes ?? item.gridLikes ?? null,
                comments: detailMetrics.comments ?? item.gridComments ?? null,
                shares: detailMetrics.shares ?? item.gridShares ?? null,
              },
              comments: detailRes.post.comments || [],
            };
            const commentCnt = enrichedPost.comments.length;
            await writeState((s) => ({
              currentItemIndex: s.currentItemIndex + 1,
              currentDetailIndex: s.currentItemIndex + 1,
              pendingPosts: [...s.pendingPosts, enrichedPost],
              syncedPostsCount: s.syncedPostsCount + 1,
              syncedCommentsCount: s.syncedCommentsCount + commentCnt,
            }));
          } else if (hasVerifiedScannedMetadata(item)) {
            // Data asli terverifikasi sudah tersedia dari feed-tap / JSON profil; simpan utuh tanpa memfabrikasi angka.
            const verifiedPost = buildVerifiedPostFromScannedItem(target, item);
            await writeState((s) => ({
              currentItemIndex: s.currentItemIndex + 1,
              currentDetailIndex: s.currentItemIndex + 1,
              pendingPosts: [...s.pendingPosts, verifiedPost],
              syncedPostsCount: s.syncedPostsCount + 1,
            }));
          } else {
            await writeState((s) => ({
              currentItemIndex: s.currentItemIndex + 1,
              currentDetailIndex: s.currentItemIndex + 1,
              errors: [...s.errors, `${target.name} (${item.sourceUrl}): detail postingan kosong/tidak terbaca.`],
            }));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/Batas waktu muat halaman terlampaui/i.test(msg) && hasVerifiedScannedMetadata(item)) {
            const verifiedPost = buildVerifiedPostFromScannedItem(target, item);
            await writeState((s) => ({
              currentItemIndex: s.currentItemIndex + 1,
              currentDetailIndex: s.currentItemIndex + 1,
              pendingPosts: [...s.pendingPosts, verifiedPost],
              syncedPostsCount: s.syncedPostsCount + 1,
            }));
          } else {
            await writeState((s) => ({
              currentItemIndex: s.currentItemIndex + 1,
              currentDetailIndex: s.currentItemIndex + 1,
              errors: [...s.errors, `${target.name} (${item.sourceUrl}): ${msg}`],
            }));
          }
        }
      }

      if (targetAbortedByPauseOrStop) break;

      await writeState((cur) => {
        const doneTarget = cur.targets[cur.targetIndex] || target;
        const scannedCount =
          typeof doneTarget?.scannedCount === "number"
            ? doneTarget.scannedCount
            : typeof cur.currentTargetCollected === "number"
              ? cur.currentTargetCollected
              : 0;
        const profileCollected =
          typeof doneTarget?.profileCollected === "number"
            ? doneTarget.profileCollected
            : typeof cur.currentProfileCollected === "number"
              ? cur.currentProfileCollected
              : scannedCount;
        const expected =
          typeof doneTarget?.profilePostsTotal === "number"
            ? doneTarget.profilePostsTotal
            : cur.currentTargetExpected;
        const partialNote = typeof doneTarget?.partialScanNote === "string" ? doneTarget.partialScanNote : null;
        const reachedBottom =
          typeof doneTarget?.reachedBottom === "boolean"
            ? doneTarget.reachedBottom
            : Boolean(cur.currentTargetReachedBottom);
        const reelsAdded = typeof doneTarget?.reelsAdded === "number" ? doneTarget.reelsAdded : 0;
        const rateLimited = Boolean(doneTarget?.rateLimited);
        const skippedKnown =
          typeof doneTarget?.skippedKnown === "number"
            ? doneTarget.skippedKnown
            : typeof cur.currentSkippedKnown === "number"
              ? cur.currentSkippedKnown
              : 0;
        const feedSaved =
          typeof doneTarget?.feedSaved === "number"
            ? doneTarget.feedSaved
            : typeof cur.currentFeedSaved === "number"
              ? cur.currentFeedSaved
              : 0;
        const hasNextPage =
          typeof doneTarget?.hasNextPage === "boolean"
            ? doneTarget.hasNextPage
            : typeof cur.currentHasNextPage === "boolean"
              ? cur.currentHasNextPage
              : null;
        const finalStatus =
          doneTarget?.scanStatus === "partial" || Boolean(partialNote) ? "partial" : "ok";
        return {
          targetIndex: cur.targetIndex + 1,
          completedTargets: cur.completedTargets + 1,
          currentTargetItems: null,
          currentItemIndex: 0,
          currentPhase: null,
          currentDetailIndex: null,
          currentDetailTotal: null,
          currentProfileCollected: null,
          currentReelsAdded: null,
          currentTargetReachedBottom: null,
          currentSkippedKnown: null,
          currentFeedSaved: null,
          currentHasNextPage: null,
          lastCompletedTargetMeta: {
            platform: doneTarget.platform,
            scannedCount,
            profileCollected,
            rateLimited,
          },
          targetResults: upsertTargetResult(cur.targetResults, {
            targetKey: doneTarget.targetKey,
            name: doneTarget.name,
            handle: doneTarget.handle || "",
            platform: doneTarget.platform,
            profileCollected,
            collected: scannedCount,
            expected: typeof expected === "number" ? expected : null,
            reelsAdded,
            rateLimited,
            reachedBottom,
            skippedKnown,
            feedSaved,
            hasNextPage,
            status: finalStatus,
            reason: partialNote,
          }),
        };
      });
    }
  } finally {
    queueRunning = false;
  }
}

async function handleCommand(msg, callerOrigin, senderTab) {
  const type = msg && typeof msg.type === "string" ? msg.type : "";
  const callerWindowId = typeof senderTab?.windowId === "number" ? senderTab.windowId : null;
  const callerTabId = typeof senderTab?.id === "number" ? senderTab.id : null;
  if (type === "PING") {
    const state = await readState();
    const assetsOk = await verifyPackagedAssets();
    if (state.status === "running" && !queueRunning) processQueue();
    return {
      ok: true,
      version: chrome.runtime.getManifest().version,
      protocolVersion: 2,
      assetsOk,
      commands: [
        "PING",
        "GET_STATE",
        "START_SYNC",
        "RESUME_SYNC",
        "SKIP_TARGET",
        "FOCUS_PAUSED_TAB",
        "PEEK_PENDING_BATCH",
        "ACK_PENDING_BATCH",
        "CANCEL_SYNC",
      ],
      state: summarizeState(state),
    };
  }

  if (type === "SCAN_PROGRESS" && callerOrigin === null) {
    const phase = msg.phase === "reels" ? "reels" : "profile";
    const collected = typeof msg.collected === "number" && Number.isFinite(msg.collected) ? msg.collected : null;
    const expected = typeof msg.expected === "number" && Number.isFinite(msg.expected) ? msg.expected : null;
    const hasNextPage = typeof msg.hasNextPage === "boolean" ? msg.hasNextPage : null;
    await writeState((cur) => {
      if (cur.status !== "running" || cur.currentPhase !== phase) return cur;
      if (phase === "reels") {
        return {
          ...(collected !== null ? { currentReelsAdded: collected } : {}),
          ...(hasNextPage !== null ? { currentHasNextPage: hasNextPage } : {}),
        };
      }
      return {
        ...(collected !== null ? { currentProfileCollected: collected, currentTargetCollected: collected } : {}),
        ...(expected !== null ? { currentTargetExpected: expected } : {}),
        ...(hasNextPage !== null ? { currentHasNextPage: hasNextPage } : {}),
      };
    });
    return { ok: true };
  }

  if (type === "GET_STATE") {
    const state = await readState();
    if (state.status === "running" && !queueRunning) processQueue();
    return { ok: true, state: summarizeState(state) };
  }

  if (type === "START_SYNC") {
    const rawTargets = Array.isArray(msg.targets) ? msg.targets : [];
    const targets = rawTargets.filter((t) => t && isAllowedTargetProfileUrl(t.profileUrl));
    const allowedHandles = Array.isArray(msg.allowedHandles) ? msg.allowedHandles : [];
    const knownPostUrls = Array.isArray(msg.knownPostUrls)
      ? msg.knownPostUrls.filter((u) => typeof u === "string" && u.trim())
      : [];
    const rawMax = Number(msg.maxPostsPerTarget);
    // 0 = mode dinamis penuh tanpa batas keras; >0 = batas maksimum item
    const maxPostsPerTarget = rawMax === 0 ? 0 : Math.min(500, Math.max(1, rawMax || 3));
    const current = await readState();
    if (current.workerTabId) {
      await closeWorkerTab(current.workerTabId);
    }
    const next = await writeState({
      ...defaultState(),
      status: targets.length > 0 ? "running" : "completed",
      runStartedAt: new Date().toISOString(),
      targets,
      allowedHandles,
      knownPostUrls,
      maxPostsPerTarget,
      dashboardWindowId: callerWindowId,
      dashboardTabId: callerTabId,
      lastDashboardOrigin: callerOrigin || current.lastDashboardOrigin,
      currentLabel: targets[0] ? `${targets[0].name} (${targets[0].platform})` : "Tidak ada target",
      currentTargetHandle: targets[0]?.handle || null,
      currentTargetPlatform: targets[0]?.platform || null,
      currentProfileCollected: targets[0] ? 0 : null,
      currentTargetCollected: targets[0] ? 0 : null,
      currentTargetExpected: null,
      lastCompletedTargetMeta: null,
      targetResults: [],
    });
    if (targets.length > 0) {
      processQueue();
    }
    return { ok: true, state: summarizeState(next) };
  }

  if (type === "RESUME_SYNC") {
    const next = await writeState((cur) => {
      if (cur.status !== "needs_human_action") return cur;
      return {
        status: "running",
        pausedReason: null,
        pausedKind: null,
        pausedUrl: null,
        dashboardWindowId: callerWindowId ?? cur.dashboardWindowId,
        dashboardTabId: callerTabId ?? cur.dashboardTabId,
        lastDashboardOrigin: callerOrigin || cur.lastDashboardOrigin,
      };
    });
    if (next.status === "running") processQueue();
    return { ok: true, state: summarizeState(next) };
  }

  if (type === "SKIP_TARGET") {
    const next = await writeState((cur) => {
      if (cur.status !== "needs_human_action" && cur.status !== "running") return cur;
      const skipped = cur.targets[cur.targetIndex];
      const skipNote = skipped
        ? `${skipped.name} (${skipped.platform}): dilewati (${cur.pausedReason || "dibatasi sementara"})`
        : null;
      return {
        status: "running",
        targetIndex: cur.targetIndex + 1,
        completedTargets: Math.min(cur.targets.length, cur.completedTargets + 1),
        currentTargetItems: null,
        currentItemIndex: 0,
        currentPhase: null,
        currentDetailIndex: null,
        currentDetailTotal: null,
        currentProfileCollected: null,
        currentReelsAdded: null,
        currentTargetReachedBottom: null,
        currentSkippedKnown: null,
        currentFeedSaved: null,
        currentHasNextPage: null,
        lastCompletedTargetMeta: skipped
          ? {
              platform: skipped.platform,
              scannedCount: typeof cur.currentTargetCollected === "number" ? cur.currentTargetCollected : 0,
              profileCollected: typeof cur.currentProfileCollected === "number" ? cur.currentProfileCollected : 0,
              rateLimited: cur.pausedKind === "rate_limit",
            }
          : cur.lastCompletedTargetMeta,
        pausedReason: null,
        pausedKind: null,
        pausedUrl: null,
        pausedTargetName: null,
        lastDashboardOrigin: callerOrigin || cur.lastDashboardOrigin,
        targetResults: skipped
          ? upsertTargetResult(cur.targetResults, {
              targetKey: skipped.targetKey,
              name: skipped.name,
              handle: skipped.handle || "",
              platform: skipped.platform,
              profileCollected: typeof cur.currentProfileCollected === "number" ? cur.currentProfileCollected : 0,
              collected: typeof cur.currentTargetCollected === "number" ? cur.currentTargetCollected : 0,
              expected: typeof cur.currentTargetExpected === "number" ? cur.currentTargetExpected : null,
              rateLimited: cur.pausedKind === "rate_limit",
              status: "skipped",
              reason: cur.pausedReason || "dibatasi sementara",
            })
          : cur.targetResults,
        errors: skipNote ? [...cur.errors, skipNote] : cur.errors,
      };
    });
    if (next.status === "running") processQueue();
    return { ok: true, state: summarizeState(next) };
  }

  if (type === "FOCUS_PAUSED_TAB") {
    const state = await readState();
    if (typeof state.workerTabId === "number") {
      await focusTabForHuman(state.workerTabId);
    }
    return { ok: true, state: summarizeState(state) };
  }

  if (type === "PEEK_PENDING_BATCH") {
    const state = await readState();
    const maxPosts = Math.min(25, Math.max(1, Number(msg && msg.limit) || 5));
    const list = Array.isArray(state.pendingPosts) ? state.pendingPosts : [];
    const posts = list.slice(0, maxPosts).map((p) => ({
      targetKey: p?.targetKey || "",
      targetType: p?.targetType === "own" ? "own" : "competitor",
      competitorId: p?.competitorId || null,
      outletKey: p?.outletKey || null,
      account: p?.account || null,
      followers: typeof p?.followers === "number" ? p.followers : null,
      profilePostsTotal: typeof p?.profilePostsTotal === "number" ? p.profilePostsTotal : null,
      platform: p?.platform === "tiktok" ? "tiktok" : "instagram",
      postType: p?.postType || "feed",
      sourceUrl: p?.sourceUrl || "",
      postedAt: p?.postedAt || null,
      caption: typeof p?.caption === "string" ? p.caption : "",
      imageUrl: typeof p?.imageUrl === "string" ? p.imageUrl : null,
      metrics: p?.metrics && typeof p.metrics === "object" ? p.metrics : {},
      comments: Array.isArray(p?.comments) ? p.comments : [],
    }));
    const willBeFinal =
      !state.finalizedOnServer && state.status === "completed" && posts.length >= list.length;
    return {
      ok: true,
      posts,
      ackCount: posts.length,
      syncRunId: state.syncRunId || null,
      finalizedOnServer: Boolean(state.finalizedOnServer),
      runStartedAt: state.runStartedAt,
      finalizeRun: willBeFinal,
      errors: willBeFinal ? (Array.isArray(state.errors) ? state.errors.slice(-50) : []) : [],
      state: summarizeState(state),
    };
  }

  if (type === "ACK_PENDING_BATCH") {
    const count = Math.max(0, Number(msg.count) || 0);
    const nextRunId = typeof msg.syncRunId === "string" && msg.syncRunId ? msg.syncRunId : undefined;
    const finalized = Boolean(msg.finalized);
    const next = await writeState((cur) => ({
      pendingPosts: cur.pendingPosts.slice(count),
      ...(nextRunId ? { syncRunId: nextRunId } : {}),
      ...(finalized ? { finalizedOnServer: true } : {}),
    }));
    return { ok: true, state: summarizeState(next) };
  }

  if (type === "CANCEL_SYNC") {
    const current = await readState();
    if (current.workerTabId) {
      await closeWorkerTab(current.workerTabId);
    }
    const next = await writeState({
      ...defaultState(),
      status: "cancelled",
      syncedPostsCount: current.syncedPostsCount,
      syncedCommentsCount: current.syncedCommentsCount,
      lastDashboardOrigin: current.lastDashboardOrigin,
      errors: current.errors,
    });
    return { ok: true, state: summarizeState(next) };
  }

  return { ok: false, error: "Perintah ekstensi tidak dikenal." };
}

globalThis.__sanghyangBackgroundTestHooks = {
  ALLOWED_APP_ORIGINS,
  PROFILE_NAV_TIMEOUT_MS,
  REELS_NAV_TIMEOUT_MS,
  POST_NAV_TIMEOUT_MS,
  DETAIL_COMMENT_WINDOW,
  COMPETITOR_DETAIL_COMMENT_WINDOW,
  INTER_TARGET_PACING_MS,
  HEAVY_TARGET_PACING_MS,
  HEAVY_TAB_ROTATE_THRESHOLD,
  RATE_LIMIT_COOLDOWN_MS,
  isCompleteFeedItem,
  shouldRetryProfileScan,
  evaluateTargetCompleteness,
  navigateAndWaitComplete,
  navigateWithRetry,
  handleCommand,
  readState,
  writeState,
};

if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    if (!sender || !sender.origin || !ALLOWED_APP_ORIGINS.has(sender.origin)) {
      sendResponse({ ok: false, error: "Origin tidak diizinkan." });
      return false;
    }
    handleCommand(msg, sender.origin, sender.tab || null)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleCommand(msg, null, sender?.tab || null)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  });
}
