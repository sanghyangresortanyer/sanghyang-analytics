/* global SanghyangParsers, SanghyangFeedParsers, chrome */
(function () {
  "use strict";

  const FEED_EVENT_CHUNK =
    (typeof SanghyangFeedParsers === "object" && SanghyangFeedParsers?.EVENT_CHUNK) || "__sanghyang_feed_chunk__";
  const FEED_EVENT_SIGNAL =
    (typeof SanghyangFeedParsers === "object" && SanghyangFeedParsers?.EVENT_SIGNAL) || "__sanghyang_feed_signal__";
  const FEED_EVENT_REPLAY_REQ =
    (typeof SanghyangFeedParsers === "object" && SanghyangFeedParsers?.EVENT_REPLAY_REQ) || "__sanghyang_feed_replay_req__";

  const feedCapturedByKey = new Map();
  let lastHasNextPage = null;
  let feedProfileMeta = null;
  let lastRateLimited = false;
  let lastHttpErrorStatus = null;
  let lastRequireLogin = false;
  let lastGraphqlError = false;
  let activeFeedFilter = null;
  const feedChunkWakeListeners = new Set();

  function normalizeFeedPageKey(rawHref) {
    if (typeof rawHref !== "string" || !rawHref.trim()) return "";
    if (typeof SanghyangFeedParsers === "object" && typeof SanghyangFeedParsers?.sanitizePageHref === "function") {
      return SanghyangFeedParsers.sanitizePageHref(rawHref).replace(/\/+$/, "").toLowerCase();
    }
    try {
      const p = new URL(rawHref.trim());
      return `${p.origin}${p.pathname.replace(/\/+$/, "")}`.toLowerCase();
    } catch {
      return "";
    }
  }

  function feedItemMergeKey(platform, sourceUrl) {
    if (typeof sourceUrl !== "string" || !sourceUrl) return "";
    if (platform === "instagram" && typeof SanghyangParsers?.instagramShortcodeFromUrl === "function") {
      const code = SanghyangParsers.instagramShortcodeFromUrl(sourceUrl);
      if (code) return `ig:${code}`;
    }
    if (platform === "tiktok" && typeof SanghyangParsers?.tiktokVideoIdFromUrl === "function") {
      const id = SanghyangParsers.tiktokVideoIdFromUrl(sourceUrl);
      if (id) return `tt:${id}`;
    }
    return sourceUrl;
  }

  function mergeFeedCapturedItem(prev, next) {
    const postType =
      prev.postType === "reels" || next.postType === "reels"
        ? "reels"
        : prev.postType === "carousel" || next.postType === "carousel"
          ? "carousel"
          : prev.postType || next.postType;
    const prevCap = typeof prev.caption === "string" && prev.caption.trim() ? prev.caption : null;
    const nextCap = typeof next.caption === "string" && next.caption.trim() ? next.caption : null;
    return {
      ...prev,
      postType,
      postedAt: prev.postedAt || next.postedAt || null,
      caption: prevCap ?? nextCap ?? (typeof prev.caption === "string" ? prev.caption : typeof next.caption === "string" ? next.caption : ""),
      imageUrl: prev.imageUrl ?? next.imageUrl ?? null,
      gridViews: prev.gridViews ?? next.gridViews ?? null,
      gridLikes: prev.gridLikes ?? next.gridLikes ?? null,
      gridComments: prev.gridComments ?? next.gridComments ?? null,
      gridShares: prev.gridShares ?? next.gridShares ?? null,
      ownerHandle: prev.ownerHandle ?? next.ownerHandle ?? null,
      fromFeedTap: true,
    };
  }

  function parseIncomingFeedDetail(detail) {
    if (typeof SanghyangFeedParsers === "object" && SanghyangFeedParsers !== null) {
      if (typeof SanghyangFeedParsers.parseChunkEventDetail === "function") {
        const direct = SanghyangFeedParsers.parseChunkEventDetail(detail, Date.now());
        if (direct && direct.urlMatched) return direct;
      }
      if (typeof SanghyangFeedParsers.extractFeedPayload === "function") {
        let obj = detail;
        if (typeof detail === "string") {
          try {
            obj = JSON.parse(detail);
          } catch {
            return null;
          }
        }
        if (obj && typeof obj === "object" && typeof obj.url === "string") {
          const extracted = SanghyangFeedParsers.extractFeedPayload(
            obj.url,
            obj.data !== undefined ? obj.data : obj,
            obj.platform || null,
            Date.now()
          );
          if (extracted && extracted.urlMatched) {
            return {
              ...extracted,
              url: obj.url,
              pageHref: typeof obj.pageHref === "string" ? obj.pageHref : "",
            };
          }
        }
      }
    }
    return null;
  }

  function parseIncomingFeedSignal(detail) {
    if (
      typeof SanghyangFeedParsers === "object" &&
      SanghyangFeedParsers !== null &&
      typeof SanghyangFeedParsers.parseSignalEventDetail === "function"
    ) {
      return SanghyangFeedParsers.parseSignalEventDetail(detail, Date.now());
    }
    let obj = detail;
    if (typeof detail === "string") {
      try {
        obj = JSON.parse(detail);
      } catch {
        return null;
      }
    }
    if (!obj || typeof obj !== "object" || obj.__sanghyangCleanSignal !== true) return null;
    const httpStatus =
      typeof obj.httpStatus === "number" && Number.isFinite(obj.httpStatus) && obj.httpStatus >= 100 && obj.httpStatus <= 599
        ? Math.round(obj.httpStatus)
        : null;
    return {
      __sanghyangCleanSignal: true,
      version: 1,
      platform: obj.platform === "instagram" || obj.platform === "tiktok" ? obj.platform : null,
      url: typeof obj.url === "string" ? obj.url : "",
      pageHref: typeof obj.pageHref === "string" ? obj.pageHref : "",
      httpStatus,
      rateLimited: Boolean(obj.rateLimited),
      requireLogin: Boolean(obj.requireLogin),
      graphqlError: Boolean(obj.graphqlError),
    };
  }

  function ingestFeedSignalDetail(detail) {
    const parsed = parseIncomingFeedSignal(detail);
    if (!parsed) return false;

    if (activeFeedFilter) {
      if (parsed.platform && parsed.platform !== activeFeedFilter.platform) return false;
      if (parsed.pageHref && activeFeedFilter.pageKey) {
        const sigPageKey = normalizeFeedPageKey(parsed.pageHref);
        if (sigPageKey && sigPageKey !== activeFeedFilter.pageKey) return false;
      }
    }

    if (typeof parsed.httpStatus === "number" && parsed.httpStatus >= 400) {
      lastHttpErrorStatus = parsed.httpStatus;
    }
    if (parsed.rateLimited) lastRateLimited = true;
    if (parsed.requireLogin) lastRequireLogin = true;
    if (parsed.graphqlError) lastGraphqlError = true;
    return true;
  }

  function ingestFeedChunkDetail(detail) {
    const parsed = parseIncomingFeedDetail(detail);
    if (!parsed || !parsed.urlMatched) return 0;

    if (activeFeedFilter) {
      if (parsed.platform && parsed.platform !== activeFeedFilter.platform) return 0;
      if (parsed.pageHref && activeFeedFilter.pageKey) {
        const chunkPageKey = normalizeFeedPageKey(parsed.pageHref);
        if (chunkPageKey && chunkPageKey !== activeFeedFilter.pageKey) return 0;
      }
    }

    const platform = parsed.platform || activeFeedFilter?.platform || null;
    const targetHandleClean = activeFeedFilter?.targetHandle
      ? activeFeedFilter.targetHandle.replace(/^@/, "").trim().toLowerCase()
      : "";
    const chunkFeedKind = typeof parsed.feedKind === "string" ? parsed.feedKind : null;
    const chunkProfileUsername =
      typeof parsed.profileUsername === "string"
        ? parsed.profileUsername.replace(/^@/, "").trim().toLowerCase()
        : "";
    const isForeignProfileUser = Boolean(
      targetHandleClean && chunkProfileUsername && chunkProfileUsername !== targetHandleClean
    );

    if (isForeignProfileUser && (chunkFeedKind === "profile" || platform === "instagram")) {
      return 0;
    }

    const isInstagram = platform === "instagram";
    const isClipsUrl = typeof parsed.url === "string" && /\/api\/v1\/clips\/user\b/i.test(parsed.url);
    const isClipsChunk = chunkFeedKind === "clips" || (chunkFeedKind === null && isClipsUrl);
    const rejectItemsForMainGrid = Boolean(isInstagram && activeFeedFilter && !activeFeedFilter.onReelsTab && isClipsChunk);

    if (!isForeignProfileUser && parsed.profileMeta && typeof parsed.profileMeta === "object") {
      const followers = typeof parsed.profileMeta.followers === "number" ? parsed.profileMeta.followers : null;
      const posts = typeof parsed.profileMeta.posts === "number" ? parsed.profileMeta.posts : null;
      if (followers !== null || posts !== null) {
        feedProfileMeta = feedProfileMeta
          ? { followers: feedProfileMeta.followers ?? followers, posts: feedProfileMeta.posts ?? posts }
          : { followers, posts };
      }
    }

    const expectedTikTokOwner = platform === "tiktok" && targetHandleClean ? targetHandleClean : "";
    let addedCount = 0;

    if (!rejectItemsForMainGrid && Array.isArray(parsed.items)) {
      for (const rawItem of parsed.items) {
        if (!rawItem || typeof rawItem.sourceUrl !== "string" || !rawItem.sourceUrl) continue;
        if (expectedTikTokOwner) {
          const owner = String(rawItem.ownerHandle || "").replace(/^@/, "").trim().toLowerCase();
          if (owner && owner !== expectedTikTokOwner) continue;
        }
        const key = feedItemMergeKey(platform, rawItem.sourceUrl);
        if (!key) continue;
        const item = { ...rawItem, fromFeedTap: true };
        const prev = feedCapturedByKey.get(key);
        if (prev) {
          feedCapturedByKey.set(key, mergeFeedCapturedItem(prev, item));
        } else {
          feedCapturedByKey.set(key, item);
          addedCount++;
        }
      }
    }

    if (addedCount > 0 && lastRateLimited) {
      lastRateLimited = false;
    }

    let allowHasNextUpdate = true;
    if (activeFeedFilter?.platform === "instagram") {
      if (!activeFeedFilter.onReelsTab) {
        if (isClipsChunk) allowHasNextUpdate = false;
      } else if (chunkFeedKind !== null && chunkFeedKind !== "clips") {
        allowHasNextUpdate = false;
      }
    }

    if (typeof parsed.hasNextPage === "boolean") {
      if (
        allowHasNextUpdate &&
        (addedCount > 0 || parsed.items?.length > 0 || parsed.hasNextPage === false || lastHasNextPage === null)
      ) {
        lastHasNextPage = parsed.hasNextPage;
      }
    }

    if (addedCount > 0 || (allowHasNextUpdate && parsed.hasNextPage === false)) {
      for (const listener of [...feedChunkWakeListeners]) {
        try {
          listener();
        } catch {
          // Abaikan galat listener sementara.
        }
      }
    }
    return addedCount;
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function" && !globalThis.__sanghyangFeedListenerInstalled) {
    globalThis.__sanghyangFeedListenerInstalled = true;
    window.addEventListener(FEED_EVENT_CHUNK, (ev) => {
      ingestFeedChunkDetail(ev && "detail" in ev ? ev.detail : null);
    });
    window.addEventListener(FEED_EVENT_SIGNAL, (ev) => {
      ingestFeedSignalDetail(ev && "detail" in ev ? ev.detail : null);
    });
  }

  function detectLoggedOutNav() {
    if (document.querySelector('a[href*="/accounts/login"], a[href*="/accounts/emailsignup"]')) {
      return true;
    }
    const navButtons = Array.from(
      document.querySelectorAll(
        'header button, nav button, [role="banner"] button, header [role="button"], nav [role="button"], [role="banner"] [role="button"], [role="dialog"] button, [role="dialog"] [role="button"]'
      )
    );
    return navButtons.some((el) => {
      const txt = (el.innerText || el.textContent || "").trim();
      return /^(log in|sign up|masuk|daftar)$/i.test(txt);
    });
  }

  function inspectChallengeNow() {
    const rawBody = document.body?.innerText || "";
    // Ambil kepala dan ekor teks halaman agar banner bawah seperti "Tampilkan postingan lainnya dari ..."
    // atau "Show more posts from ..." tidak terpotong pada profil berbio panjang.
    const bodyText =
      rawBody.length > 7000 ? `${rawBody.slice(0, 3500)}\n${rawBody.slice(-3500)}` : rawBody;
    const dialogText = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))
      .map((el) => el.innerText || el.textContent || "")
      .join("\n")
      .slice(0, 2500);
    const hasLoginForm = Boolean(
      document.querySelector('input[name="username"], form[action*="login"], [data-e2e="login-modal"]')
    );
    const hasCaptchaDom = Boolean(
      document.querySelector(
        '.captcha_verify_container, .captcha-verify-container, .secsdk-captcha-drag-icon, [class*="secsdk-captcha"], [class*="captcha-verify"], #captcha-verify-image, [id*="captcha-verify"], #tiktok-verify-ele, [id*="tiktok-verify"], [data-e2e="captcha"], iframe[src*="captcha"], [id*="SlardarWAF"], [class*="captcha"]'
      )
    );
    return SanghyangParsers.detectSocialChallenge({
      url: window.location.href,
      title: document.title,
      bodyText,
      dialogText,
      hasLoginForm,
      hasCaptchaDom,
    });
  }

  /**
   * Menunggu simpul DOM target selesai terhidrasi memakai MutationObserver + polling berkala berbatas
   * Date.now() agar tahan terhadap throttling tab latar belakang dan interstitial singkat TikTok.
   */
  function waitForDomRendered(selectorList, maxWaitMs, extraReadyCheck) {
    return new Promise((resolve) => {
      const hasReadyNode = () =>
        selectorList.some((sel) => Boolean(document.querySelector(sel))) ||
        (typeof extraReadyCheck === "function" && Boolean(extraReadyCheck()));
      if (inspectChallengeNow().blocked || hasReadyNode()) {
        resolve();
        return;
      }

      const deadline = Date.now() + maxWaitMs;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearTimeout(hardLimit);
        clearInterval(poll);
        resolve();
      };

      const check = () => {
        if (inspectChallengeNow().blocked || hasReadyNode() || Date.now() >= deadline) {
          done();
        }
      };

      const observer = new MutationObserver(check);
      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      const poll = setInterval(check, 500);
      const hardLimit = setTimeout(done, maxWaitMs);
    });
  }

  // Grid Instagram memuat satu baris (3 kartu) atau lebih per gulir; TikTok ~15-30 item per halaman.
  // Batas putaran saat jumlah postingan profil tidak tertulis hanya pengaman untuk gulir bertahap per viewport.
  const FEED_SCAN_TUNING = { staleRounds: 7, minItemsPerRound: 3, maxRoundsUnknown: 1500 };
  // Waktu tunggu URL postingan BARU muncul saat berada di batas bawah nyata (bukan sekadar tinggi spinner loading).
  const GRID_GROWTH_WAIT_MS = 6000;
  const GRID_GROWTH_SPINNER_WAIT_MS = 9000;
  // Jeda sopan adaptif pada akun besar (>= 300 postingan) agar tidak memicu pembatasan beruntun Instagram.
  const LARGE_ACCOUNT_EXPECTED_THRESHOLD = 300;
  const LARGE_ACCOUNT_PACING_EVERY_ITEMS = 120;
  const LARGE_ACCOUNT_PACING_DELAY_MS = 1200;
  // Waktu tunggu singkat per langkah viewport saat masih menyusuri tinggi kontainer (sebelum batas bawah).
  const VIEWPORT_STEP_WAIT_MS = 450;
  const SWEEP_STEP_WAIT_MS = 90;
  const AT_BOTTOM_THRESHOLD_PX = 24;
  const IG_GRID_EXCLUDED_ANCESTORS =
    '[role="dialog"], [role="alertdialog"], nav, header, footer, aside, [data-e2e="suggested"], [aria-label*="Suggested" i], [aria-label*="Disarankan" i], [aria-label*="More posts" i], [aria-label*="Postingan lainnya" i], [aria-label*="Related" i]';

  function hasActiveLoadingIndicator() {
    return Boolean(
      document.querySelector(
        '[role="progressbar"], [data-e2e="loading"], svg[aria-label*="Loading" i], svg[aria-label*="Memuat" i]'
      )
    );
  }

  function gridAnchors(platform) {
    if (platform === "instagram") {
      const mainEl = document.querySelector("main");
      if (mainEl) {
        return Array.from(mainEl.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')).filter(
          (a) => !(typeof a.closest === "function" && a.closest(IG_GRID_EXCLUDED_ANCESTORS))
        );
      }
      return Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    }
    return Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]'));
  }

  /**
   * Menemukan kontainer gulir aktif di Instagram 2026 (`#scrollview` dengan overflow-y: auto sementara
   * documentElement.scrollHeight terkunci 100vh) dan TikTok, termasuk leluhur grid yang benar-benar dapat digulir.
   */
  function findScrollTargets(platform) {
    const targets = new Set();
    const scrollview = document.querySelector("#scrollview");
    if (scrollview instanceof HTMLElement) targets.add(scrollview);

    const anchors = gridAnchors(platform);
    const seedNode =
      anchors.length > 0
        ? anchors[anchors.length - 1].parentElement
        : document.querySelector(platform === "tiktok" ? '[data-e2e="user-post-item-list"], main' : "main");
    let cur = seedNode;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        const st = window.getComputedStyle(cur);
        if (
          (st.overflowY === "auto" || st.overflowY === "scroll" || st.overflowY === "overlay") &&
          cur.scrollHeight > cur.clientHeight + 20
        ) {
          targets.add(cur);
        }
      } catch {
        // Abaikan node tanpa computedStyle
      }
      cur = cur.parentElement;
    }

    if (document.scrollingElement instanceof HTMLElement) targets.add(document.scrollingElement);
    if (document.documentElement instanceof HTMLElement) targets.add(document.documentElement);
    if (document.body instanceof HTMLElement) targets.add(document.body);
    return Array.from(targets);
  }

  function containerViewportHeight(el) {
    const ch = Number(el?.clientHeight) || 0;
    const wh = Number(window?.innerHeight) || 0;
    return Math.max(200, ch || wh || 900);
  }

  function getScrollableContainers(platform) {
    const raw = findScrollTargets(platform).filter((el) => {
      const sh = Number(el?.scrollHeight) || 0;
      const vh = containerViewportHeight(el);
      return sh > vh + AT_BOTTOM_THRESHOLD_PX;
    });
    const scrollingEl = document.scrollingElement;
    if (scrollingEl && raw.includes(scrollingEl)) {
      return raw.filter((el) => el === scrollingEl || (el !== document.documentElement && el !== document.body));
    }
    return raw;
  }

  function isContainerAtBottom(el) {
    const top = Number(el?.scrollTop) || 0;
    const vh = containerViewportHeight(el);
    const sh = Number(el?.scrollHeight) || 0;
    return top + vh >= sh - AT_BOTTOM_THRESHOLD_PX;
  }

  function areAllContainersAtBottom(platform) {
    const scrollable = getScrollableContainers(platform);
    if (scrollable.length === 0) return true;
    return scrollable.every(isContainerAtBottom);
  }

  function dispatchScrollSignals(el, deltaY) {
    const wheelDelta = typeof deltaY === "number" && Number.isFinite(deltaY) ? deltaY : 700;
    try {
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch {
      // Abaikan target tanpa dispatchEvent
    }
    try {
      if (typeof WheelEvent === "function") {
        el.dispatchEvent(new WheelEvent("wheel", { deltaY: wheelDelta, bubbles: true }));
      }
    } catch {
      // Abaikan jika WheelEvent tidak didukung di konteks uji
    }
  }

  function setContainerScrollTop(el, nextTop, deltaY) {
    try {
      el.scrollTop = nextTop;
      dispatchScrollSignals(el, deltaY);
    } catch {
      // Abaikan kontainer read-only
    }
    if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
      try {
        window.scrollTo({ top: nextTop, behavior: "instant" });
        dispatchScrollSignals(window, deltaY);
      } catch {
        // Abaikan jika window.scrollTo tidak tersedia
      }
    }
  }

  function isLastCardAtOrAboveViewport(platform) {
    const anchors = gridAnchors(platform);
    if (anchors.length === 0) return false;
    const last = anchors[anchors.length - 1];
    if (!last || typeof last.getBoundingClientRect !== "function") return false;
    try {
      const rect = last.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.bottom) || !Number.isFinite(rect.top)) return false;
      if (rect.height <= 0 && rect.width <= 0) return false;
      const vh = Math.max(200, Number(window?.innerHeight) || 900);
      return rect.bottom <= vh + AT_BOTTOM_THRESHOLD_PX;
    } catch {
      return false;
    }
  }

  function scrollLastAnchorIntoView(platform, blockMode, deltaY) {
    const anchors = gridAnchors(platform);
    if (anchors.length === 0) return false;
    const last = anchors[anchors.length - 1];
    if (!last || typeof last.scrollIntoView !== "function") return false;
    try {
      last.scrollIntoView({ block: blockMode, behavior: "instant" });
    } catch {
      try {
        last.scrollIntoView({ block: blockMode });
      } catch {
        return false;
      }
    }
    const wheelDelta = typeof deltaY === "number" ? deltaY : 700;
    for (const el of findScrollTargets(platform)) {
      dispatchScrollSignals(el, wheelDelta);
    }
    dispatchScrollSignals(window, wheelDelta);
    return true;
  }

  /**
   * Hybrid Sentinel Scroll Driver:
   * 1. Saat menyusuri konten yang sudah ada (`!nearGridBottom`), melangkah inkremental ~72% viewport sambil
   *    menyerap mutasi DOM (`ctx.absorbNow()`) dan mengukur `moved` sejati hanya dari kenaikan `scrollTop`/`scrollY`.
   * 2. Saat tiba di dekat/batas bawah (`wasAtBottom` ATAU kartu terakhir berada di/atas viewport — misalnya tertutup
   *    `<footer>` 350–500px), memanggil `anchors[last].scrollIntoView({ block: "center", behavior: "instant" })`
   *    + `scroll` + `wheel(700)`, jeda 200ms, lalu menggeser bertahap ke batas bawah grid agar IntersectionObserver
   *    Instagram & TikTok selalu terpicu.
   * 3. Pada `stale >= 1`, melakukan osilasi sentinel multi-posisi (geser naik ~45% vh -> `start` -> `center` ->
   *    `end` + `scroll` + `wheel` + kontainer bawah) dengan jeda 220ms antar posisi.
   */
  function scrollAndWaitForGrowth(platform, ctx) {
    const stale = typeof ctx === "object" && ctx !== null ? Number(ctx.stale) || 0 : ctx ? 2 : 0;
    const hasExplicitWait = typeof ctx === "object" && ctx !== null && typeof ctx.waitMs === "number" && ctx.waitMs > 0;
    const absorbFn = typeof ctx?.absorbNow === "function" ? ctx.absorbNow : null;

    const collectRawUrls = () => {
      const urls = new Set();
      for (const a of gridAnchors(platform)) {
        const href = a.getAttribute("href");
        if (href) urls.add(href);
      }
      return urls;
    };
    const initialRawUrls = !absorbFn && typeof ctx?.hasNewItem !== "function" ? collectRawUrls() : null;
    let absorbedInStep = 0;
    const checkAndAbsorb = () => {
      if (absorbFn) {
        const added = Number(absorbFn()) || 0;
        if (added > 0) absorbedInStep += added;
        return absorbedInStep > 0;
      }
      if (typeof ctx?.hasNewItem === "function") return Boolean(ctx.hasNewItem());
      for (const href of collectRawUrls()) {
        if (!initialRawUrls.has(href)) return true;
      }
      return false;
    };

    const scrollable = getScrollableContainers(platform);
    const containersAtBottom = scrollable.length === 0 || scrollable.every(isContainerAtBottom);
    const lastCardNearOrAbove = isLastCardAtOrAboveViewport(platform);
    const nearGridBottom = containersAtBottom || lastCardNearOrAbove;

    const effectiveHasNext =
      typeof ctx?.hasNextPage === "boolean" ? ctx.hasNextPage : lastHasNextPage;

    const waitMs = hasExplicitWait
      ? ctx.waitMs
      : !nearGridBottom
        ? typeof ctx?.stepWaitMs === "number" && ctx.stepWaitMs > 0
          ? ctx.stepWaitMs
          : VIEWPORT_STEP_WAIT_MS
        : typeof ctx?.bottomWaitMs === "number" && ctx.bottomWaitMs > 0
          ? ctx.bottomWaitMs
          : (stale >= 1 && hasActiveLoadingIndicator()) || (stale >= 2 && effectiveHasNext === true)
            ? GRID_GROWTH_SPINNER_WAIT_MS
            : GRID_GROWTH_WAIT_MS;

    const activeTimers = new Set();
    const scheduleStep = (fn, delayMs) => {
      const id = setTimeout(() => {
        activeTimers.delete(id);
        fn();
      }, delayMs);
      activeTimers.add(id);
      return id;
    };

    let moved = false;
    let pendingBottomRestore = null;
    if (!nearGridBottom) {
      // Langkah inkremental bertahap (~72% viewport) — JANGAN melompat langsung ke scrollHeight dan cek moved sejati.
      for (const el of scrollable) {
        if (isContainerAtBottom(el)) continue;
        const vh = containerViewportHeight(el);
        const stepPx = Math.max(260, Math.floor(vh * 0.72));
        const prevTop = Number(el.scrollTop) || 0;
        const prevWinY = Number(window?.scrollY) || 0;
        const maxTop = Math.max(0, el.scrollHeight - vh);
        const nextTop = Math.min(maxTop, prevTop + stepPx);
        setContainerScrollTop(el, nextTop, 700);
        const actualTop = Number(el.scrollTop) || 0;
        const actualWinY = Number(window?.scrollY) || 0;
        if (actualTop > prevTop + 2 || actualWinY > prevWinY + 2) {
          moved = true;
        }
      }
      checkAndAbsorb();
    } else {
      const bottomSnapshots = scrollable.map((el) => {
        const vh = containerViewportHeight(el);
        return { el, vh, bottom: Math.max(0, el.scrollHeight - vh) };
      });
      const nudgeToKnownBottom = () => {
        pendingBottomRestore = null;
        for (const snap of bottomSnapshots) {
          const curTop = Number(snap.el.scrollTop) || 0;
          const liveMaxTop = Math.max(0, snap.el.scrollHeight - snap.vh);
          const stepPx = Math.max(260, Math.floor(snap.vh * 0.72));
          // Jika scrollHeight membesar selama jeda, maju maksimal 1 langkah viewport agar tidak melompati baris baru.
          const capTop = liveMaxTop > snap.bottom + AT_BOTTOM_THRESHOLD_PX ? curTop + stepPx : snap.bottom;
          const nextTop = Math.min(liveMaxTop, Math.max(curTop, Math.min(capTop, curTop + stepPx)));
          setContainerScrollTop(snap.el, nextTop, 700);
        }
        if (bottomSnapshots.length === 0) {
          for (const el of findScrollTargets(platform)) {
            dispatchScrollSignals(el, 700);
          }
          dispatchScrollSignals(window, 700);
        }
        checkAndAbsorb();
      };

      if (stale >= 1) {
        // Osilasi sentinel multi-posisi: tarik naik ~45% vh -> start -> center -> end + kontainer bawah.
        const oscDelayMs = Math.min(220, Math.max(1, Math.floor(waitMs / 6)));
        for (const snap of bottomSnapshots) {
          if (snap.el.scrollHeight > snap.vh + 250) {
            const back = Math.max(240, Math.round(snap.vh * 0.45));
            setContainerScrollTop(snap.el, Math.max(0, snap.bottom - back), -400);
          }
        }
        checkAndAbsorb();
        pendingBottomRestore = nudgeToKnownBottom;
        scheduleStep(() => {
          if (absorbedInStep > 0) return;
          scrollLastAnchorIntoView(platform, "start", 700);
          if (checkAndAbsorb()) return;
          scheduleStep(() => {
            if (absorbedInStep > 0) return;
            scrollLastAnchorIntoView(platform, "center", 700);
            if (checkAndAbsorb()) return;
            scheduleStep(() => {
              if (absorbedInStep > 0) return;
              scrollLastAnchorIntoView(platform, "end", 700);
              nudgeToKnownBottom();
            }, oscDelayMs);
          }, oscDelayMs);
        }, oscDelayMs);
      } else {
        // Tiba di dekat/batas bawah: tempatkan kartu terakhir & sentinel TEPAT di tengah viewport (di atas footer!),
        // kirim scroll + wheel(700), jeda 200ms, lalu geser bertahap ke batas bawah grid bila belum ada item baru.
        scrollLastAnchorIntoView(platform, "center", 700);
        if (!checkAndAbsorb()) {
          const centerPauseMs = Math.min(200, Math.max(1, Math.floor(waitMs / 4)));
          pendingBottomRestore = nudgeToKnownBottom;
          scheduleStep(() => {
            if (absorbedInStep > 0) return;
            nudgeToKnownBottom();
          }, centerPauseMs);
        }
      }
    }

    return new Promise((resolve) => {
      const startMs = Date.now();
      const midNudgeAt = startMs + Math.round(waitMs * 0.55);
      let midNudged = false;
      let finished = false;

      const done = () => {
        if (finished) return;
        finished = true;
        feedChunkWakeListeners.delete(check);
        observer.disconnect();
        clearTimeout(limit);
        clearInterval(poll);
        for (const id of activeTimers) clearTimeout(id);
        activeTimers.clear();
        if (absorbedInStep === 0 && typeof pendingBottomRestore === "function") {
          pendingBottomRestore();
        }
        checkAndAbsorb();
        resolve({
          moved,
          wasAtBottom: nearGridBottom,
          atBottom: areAllContainersAtBottom(platform),
          hasSpinner: hasActiveLoadingIndicator(),
          hasNextPage: lastHasNextPage,
        });
      };

      const check = (forceMidNudge) => {
        if (checkAndAbsorb() || inspectChallengeNow().blocked) {
          done();
          return;
        }
        const now = Date.now();
        if (now - startMs >= waitMs) {
          done();
          return;
        }
        if (nearGridBottom && !midNudged && (forceMidNudge === true || now >= midNudgeAt)) {
          midNudged = true;
          scrollLastAnchorIntoView(platform, "center", 700);
          if (checkAndAbsorb()) {
            done();
            return;
          }
          // Beri jeda 350ms agar IntersectionObserver Instagram sempat memicu pemuatan sebelum kembali ke bawah.
          const remainingMs = Math.max(1, waitMs - (now - startMs));
          const midPauseMs = remainingMs >= 380 ? 350 : Math.max(1, Math.floor(remainingMs * 0.5));
          scheduleStep(() => {
            if (finished || absorbedInStep > 0) return;
            if (checkAndAbsorb()) {
              done();
              return;
            }
            for (const el of getScrollableContainers(platform)) {
              const vh = containerViewportHeight(el);
              const curTop = Number(el.scrollTop) || 0;
              const liveMaxTop = Math.max(0, el.scrollHeight - vh);
              const stepPx = Math.max(260, Math.floor(vh * 0.72));
              const nextTop = Math.min(liveMaxTop, curTop + stepPx);
              setContainerScrollTop(el, nextTop, 700);
            }
            if (checkAndAbsorb()) done();
          }, midPauseMs);
        }
      };

      feedChunkWakeListeners.add(check);
      const observer = new MutationObserver(check);
      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      const pollIntervalMs = Math.max(15, Math.min(350, Math.floor(waitMs / 6)));
      const poll = setInterval(check, pollIntervalMs);
      if (nearGridBottom && waitMs >= 20) {
        scheduleStep(() => check(true), Math.max(1, Math.round(waitMs * 0.55)));
      }
      const limit = setTimeout(done, waitMs);
      check();
    });
  }

  /**
   * Sapuan verifikasi 1x (gap-fill sweep) dari puncak ke batas bawah dengan langkah ~65% viewport
   * ketika gulir pertama sudah mencapai batas bawah namun cakupan masih < 95% angka header.
   */
  async function gapFillSweepScroll(platform, ctx) {
    const scrollable = getScrollableContainers(platform);
    if (scrollable.length === 0) return;

    const stepWaitMs =
      typeof ctx?.sweepStepWaitMs === "number" && ctx.sweepStepWaitMs > 0 ? ctx.sweepStepWaitMs : SWEEP_STEP_WAIT_MS;
    const absorbNow = typeof ctx?.absorbNow === "function" ? ctx.absorbNow : () => 0;
    const isBlocked = typeof ctx?.isBlocked === "function" ? ctx.isBlocked : () => false;
    const collectedCount = typeof ctx?.collected === "function" ? ctx.collected : () => 0;
    const target = typeof ctx?.target === "number" ? ctx.target : Infinity;

    const settleStep = () =>
      new Promise((resolve) => {
        let doneFlag = false;
        const finish = () => {
          if (doneFlag) return;
          doneFlag = true;
          obs.disconnect();
          clearTimeout(timer);
          absorbNow();
          resolve();
        };
        const obs = new MutationObserver(() => {
          if (absorbNow() > 0 || isBlocked()) finish();
        });
        if (document.documentElement) {
          obs.observe(document.documentElement, { childList: true, subtree: true });
        }
        const timer = setTimeout(finish, stepWaitMs);
      });

    for (const el of scrollable) {
      setContainerScrollTop(el, 0);
    }
    absorbNow();
    await settleStep();

    const maxSweepSteps = 2000;
    for (let step = 0; step < maxSweepSteps; step++) {
      if (isBlocked() || collectedCount() >= target) break;
      let anyMoved = false;
      for (const el of getScrollableContainers(platform)) {
        if (isContainerAtBottom(el)) continue;
        const vh = containerViewportHeight(el);
        const stepPx = Math.max(240, Math.floor(vh * 0.65));
        const prevTop = Number(el.scrollTop) || 0;
        const prevWinY = Number(window?.scrollY) || 0;
        const maxTop = Math.max(0, el.scrollHeight - vh);
        const nextTop = Math.min(maxTop, prevTop + stepPx);
        setContainerScrollTop(el, nextTop, 700);
        if ((Number(el.scrollTop) || 0) > prevTop + 2 || (Number(window?.scrollY) || 0) > prevWinY + 2) {
          anyMoved = true;
        }
      }
      absorbNow();
      if (typeof ctx?.onProgress === "function") ctx.onProgress();
      if (!anyMoved) break;
      await settleStep();
    }
  }

  globalThis.__sanghyangContentTestHooks = {
    inspectChallengeNow,
    detectLoggedOutNav,
    findScrollTargets,
    areAllContainersAtBottom,
    scrollAndWaitForGrowth,
    gapFillSweepScroll,
    ingestFeedChunkDetail,
    ingestFeedSignalDetail,
    getFeedTapSnapshot: () => ({
      capturedCount: feedCapturedByKey.size,
      lastHasNextPage,
      profileMeta: feedProfileMeta,
      lastRateLimited,
      lastHttpErrorStatus,
      lastRequireLogin,
      lastGraphqlError,
    }),
  };

  globalThis.__sanghyangRunProfile = async function (platform, maxItems, targetHandle, allowedCollabHandles, runOpts) {
    const readySelectors =
      platform === "instagram"
        ? ['a[href*="/p/"]', 'a[href*="/reel/"]', 'input[name="username"]', 'form[action*="login"]']
        : [
            'a[href*="/video/"]',
            'a[href*="/photo/"]',
            '[data-e2e="user-post-item"]',
            ".captcha_verify_container",
            ".captcha-verify-container",
            "#captcha-verify-image",
            "#tiktok-verify-ele",
            '[id*="SlardarWAF"]',
          ];

    const extraReady =
      platform === "tiktok"
        ? () => {
            const meta = SanghyangParsers.extractTikTokProfileMeta(document, targetHandle);
            return Boolean(meta.notFound || meta.isEmptyProfile);
          }
        : null;

    await waitForDomRendered(readySelectors, platform === "tiktok" ? 20000 : 12000, extraReady);

    const challenge = inspectChallengeNow();
    const isLoggedOutNav = detectLoggedOutNav();
    if (challenge.blocked) {
      return { challenge, items: [], profile: null, scan: null, isLoggedOutNav, wasHidden: Boolean(document.hidden), hadInterstitial: false };
    }

    if (runOpts && runOpts.resetScroll === true) {
      for (const el of findScrollTargets(platform)) {
        try {
          el.scrollTop = 0;
        } catch {
          // Abaikan kontainer read-only
        }
      }
      try {
        window.scrollTo({ top: 0, behavior: "instant" });
      } catch {
        // Abaikan jika window.scrollTo tidak tersedia
      }
    }

    // Tab Reels hanya memuat sebagian postingan, jadi jumlah postingan profil bukan target gulir di sana.
    const onReelsTab = platform === "instagram" && /\/reels\/?$/.test(window.location.pathname);

    // Siapkan filter feed-tap aktif lalu minta replay seluruh chunk yang tertangkap sejak document_start di MAIN world.
    feedCapturedByKey.clear();
    lastHasNextPage = null;
    feedProfileMeta = null;
    lastRateLimited = false;
    lastHttpErrorStatus = null;
    lastRequireLogin = false;
    lastGraphqlError = false;
    activeFeedFilter = {
      platform,
      targetHandle: typeof targetHandle === "string" ? targetHandle : "",
      onReelsTab,
      pageKey: normalizeFeedPageKey(String(window.location?.href || "")),
    };
    try {
      if (typeof window?.dispatchEvent === "function" && typeof CustomEvent === "function") {
        window.dispatchEvent(
          new CustomEvent(FEED_EVENT_REPLAY_REQ, {
            detail: JSON.stringify({ pageHref: String(window.location?.href || "") }),
          })
        );
      }
    } catch {
      // Abaikan jika CustomEvent tidak tersedia pada lingkungan uji minimal.
    }

    const profile =
      platform === "instagram"
        ? SanghyangParsers.extractInstagramProfileMeta(document)
        : SanghyangParsers.extractTikTokProfileMeta(document, targetHandle);
    if (feedProfileMeta) {
      if (profile.followers === null && typeof feedProfileMeta.followers === "number") {
        profile.followers = feedProfileMeta.followers;
      }
      if (profile.posts === null && typeof feedProfileMeta.posts === "number") {
        profile.posts = feedProfileMeta.posts;
      }
    }

    if (platform === "tiktok" && (profile.notFound || profile.isEmptyProfile)) {
      activeFeedFilter = null;
      return {
        challenge: inspectChallengeNow(),
        items: [],
        profile,
        isLoggedOutNav,
        wasHidden: Boolean(document.hidden),
        hadInterstitial: false,
        scan: {
          rounds: 0,
          expected: profile.posts,
          collected: 0,
          stoppedBy: profile.notFound ? "not_found" : "expected",
          reachedBottom: !profile.notFound,
          hasNextPage: false,
          rateLimited: Boolean(lastRateLimited),
          httpErrorStatus: lastHttpErrorStatus,
          requireLogin: Boolean(lastRequireLogin),
          graphqlError: Boolean(lastGraphqlError),
          sweepRan: false,
        },
      };
    }

    let lastProgressSentAt = 0;
    let lastProgressCollected = -1;
    const emitScanProgress = (progress) => {
      if (typeof chrome === "undefined" || typeof chrome?.runtime?.sendMessage !== "function") return;
      const now = Date.now();
      if (progress.collected === lastProgressCollected && now - lastProgressSentAt < 1500) return;
      if (now - lastProgressSentAt < 750 && progress.collected - lastProgressCollected < 12) return;
      lastProgressSentAt = now;
      lastProgressCollected = progress.collected;
      try {
        chrome.runtime.sendMessage(
          {
            type: "SCAN_PROGRESS",
            phase: onReelsTab ? "reels" : "profile",
            collected: progress.collected,
            expected: progress.expected,
            hasNextPage: typeof progress.hasNextPage === "boolean" ? progress.hasNextPage : lastHasNextPage,
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
      } catch {
        // Abaikan jika runtime tidak menerima pesan progres sementara.
      }
    };

    let sawHiddenDuringScan = Boolean(document.hidden);
    const effectiveExpectedTotal = onReelsTab ? null : profile.posts;
    const isFastTestMode = typeof runOpts?.stepWaitMs === "number" && runOpts.stepWaitMs < 50;
    const enableLargeAccountPacing =
      !isFastTestMode && typeof effectiveExpectedTotal === "number" && effectiveExpectedTotal >= LARGE_ACCOUNT_EXPECTED_THRESHOLD;
    let scan;
    try {
      scan = await SanghyangParsers.collectFeedItems({
        collect: () => {
          if (document.hidden) sawHiddenDuringScan = true;
          const domItems =
            platform === "instagram"
              ? SanghyangParsers.extractInstagramProfileItems(document, 0, targetHandle, allowedCollabHandles)
              : SanghyangParsers.extractTikTokProfileItems(document, 0, targetHandle);
          if (feedCapturedByKey.size === 0) return domItems;
          return [...Array.from(feedCapturedByKey.values()), ...domItems];
        },
        advance: (ctx) => {
          if (document.hidden) sawHiddenDuringScan = true;
          return scrollAndWaitForGrowth(platform, {
            ...ctx,
            ...(typeof runOpts?.stepWaitMs === "number" ? { stepWaitMs: runOpts.stepWaitMs } : {}),
            ...(typeof runOpts?.bottomWaitMs === "number" ? { bottomWaitMs: runOpts.bottomWaitMs } : {}),
          });
        },
        gapFillSweep: (sweepCtx) => {
          if (document.hidden) sawHiddenDuringScan = true;
          return gapFillSweepScroll(platform, {
            ...sweepCtx,
            ...(typeof runOpts?.sweepStepWaitMs === "number" ? { sweepStepWaitMs: runOpts.sweepStepWaitMs } : {}),
          });
        },
        isBlocked: () => inspectChallengeNow().blocked,
        isRateLimited: () => lastRateLimited,
        isAtBottom: () => areAllContainersAtBottom(platform),
        hasSpinner: () => hasActiveLoadingIndicator(),
        getHasNextPage: () => lastHasNextPage,
        pacingEveryItems:
          typeof runOpts?.pacingEveryItems === "number"
            ? runOpts.pacingEveryItems
            : enableLargeAccountPacing
              ? LARGE_ACCOUNT_PACING_EVERY_ITEMS
              : 0,
        pacingDelayMs:
          typeof runOpts?.pacingDelayMs === "number"
            ? runOpts.pacingDelayMs
            : enableLargeAccountPacing
              ? LARGE_ACCOUNT_PACING_DELAY_MS
              : 0,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onProgress: emitScanProgress,
        maxItems,
        expectedTotal: effectiveExpectedTotal,
        ...FEED_SCAN_TUNING,
      });
    } finally {
      activeFeedFilter = null;
    }

    if (feedProfileMeta) {
      if (profile.followers === null && typeof feedProfileMeta.followers === "number") {
        profile.followers = feedProfileMeta.followers;
      }
      if (profile.posts === null && typeof feedProfileMeta.posts === "number") {
        profile.posts = feedProfileMeta.posts;
      }
    }

    const trimmedBody = (document.body?.innerText || "").trim();
    const hadInterstitial = /^\s*please wait\.{0,3}\s*$/i.test(trimmedBody) || trimmedBody.length < 25;

    return {
      challenge: inspectChallengeNow(),
      items: scan.items,
      profile,
      isLoggedOutNav,
      wasHidden: sawHiddenDuringScan,
      hadInterstitial,
      scan: {
        rounds: scan.rounds,
        expected: scan.expected ?? effectiveExpectedTotal,
        collected: scan.collected,
        stoppedBy: scan.stoppedBy,
        reachedBottom: Boolean(scan.reachedBottom),
        hasNextPage: typeof scan.hasNextPage === "boolean" ? scan.hasNextPage : lastHasNextPage,
        rateLimited: Boolean(scan.rateLimited || lastRateLimited),
        httpErrorStatus: lastHttpErrorStatus,
        requireLogin: Boolean(lastRequireLogin),
        graphqlError: Boolean(lastGraphqlError),
        sweepRan: Boolean(scan.sweepRan),
      },
    };
  };

  globalThis.__sanghyangRunPost = async function (platform, postUrl, gridStatsOrViews, allowedHandles) {
    const readySelectors =
      platform === "instagram"
        ? ["article time[datetime]", "main time[datetime]", 'svg[aria-label="Like"]', 'input[name="username"]', 'form[action*="login"]']
        : [
            '[data-e2e="like-count"]',
            '[data-e2e="browse-like-count"]',
            '[data-e2e="photo-like-count"]',
            '[data-e2e="video-desc"]',
            '[data-e2e="browse-video-desc"]',
            '[data-e2e="photo-desc"]',
            '[data-e2e="browse-photo-desc"]',
            '[data-e2e="new-desc-span"]',
            '[data-e2e="detail-photo"]',
            '[data-e2e="photo-mode-container"]',
            '[data-e2e="browse-photo"]',
            '[data-e2e="photo-detail"]',
            '.swiper-slide img[src^="https://"]',
            '[data-e2e="recommend-list-item-container"]',
            ".captcha_verify_container",
            ".captcha-verify-container",
            "#captcha-verify-image",
            "#tiktok-verify-ele",
            '[id*="SlardarWAF"]',
          ];

    const expectedTtId =
      platform === "tiktok" && typeof SanghyangParsers?.tiktokVideoIdFromUrl === "function"
        ? SanghyangParsers.tiktokVideoIdFromUrl(postUrl)
        : null;
    if (platform === "tiktok") {
      feedCapturedByKey.clear();
      activeFeedFilter = {
        platform: "tiktok",
        targetHandle: "",
        onReelsTab: false,
        pageKey: normalizeFeedPageKey(String(window.location?.href || "")),
      };
      try {
        if (typeof window?.dispatchEvent === "function" && typeof CustomEvent === "function") {
          window.dispatchEvent(
            new CustomEvent(FEED_EVENT_REPLAY_REQ, {
              detail: JSON.stringify({ pageHref: String(window.location?.href || "") }),
            }),
          );
        }
      } catch {
        // Abaikan jika CustomEvent tidak tersedia pada lingkungan uji minimal.
      }
    }

    const extraReady =
      platform === "tiktok"
        ? () => {
            if (expectedTtId && feedCapturedByKey.has(`tt:${expectedTtId}`)) return true;
            if (typeof SanghyangParsers?.readTikTokRehydrationItem === "function") {
              return Boolean(SanghyangParsers.readTikTokRehydrationItem(document, expectedTtId));
            }
            return false;
          }
        : null;

    try {
      await waitForDomRendered(readySelectors, platform === "tiktok" ? 15000 : 12000, extraReady);

      const challenge = inspectChallengeNow();
      if (challenge.blocked) {
        return { challenge, post: null };
      }

      if (platform === "instagram") {
        // Perluas komentar melampaui 1 klik (hingga 3 kali klik tombol muat komentar)
        for (let i = 0; i < 3; i++) {
          const moreBtn = document.querySelector(
            '[aria-label="Load more comments"], [aria-label="Muat komentar lainnya"], svg[aria-label="Load more comments"], svg[aria-label="Muat komentar lainnya"]'
          );
          if (moreBtn instanceof HTMLElement) {
            moreBtn.click();
            await new Promise((r) => setTimeout(r, 600));
          } else {
            break;
          }
        }
      } else if (platform === "tiktok") {
        const countTxt =
          document.querySelector('[data-e2e="comment-count"], [data-e2e="browse-comment-count"], [data-e2e="photo-comment-count"]')
            ?.textContent || "";
        const hasCount = (SanghyangParsers.parseHumanCount(countTxt) || 0) > 0;
        if (hasCount && !document.querySelector('[data-e2e="comment-level-1"]')) {
          const iconBtn = document.querySelector('[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"]');
          if (iconBtn instanceof HTMLElement) {
            iconBtn.click();
            await waitForDomRendered(['[data-e2e="comment-level-1"]'], 2000);
          }
        }
        // Scroll kontainer komentar TikTok bila ada
        const commentList = document.querySelector('[data-e2e="comment-list"]');
        if (commentList instanceof HTMLElement) {
          for (let i = 0; i < 3; i++) {
            commentList.scrollTop = commentList.scrollHeight;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      }

      let post =
        platform === "instagram"
          ? SanghyangParsers.extractInstagramPostDetail(document, postUrl, gridStatsOrViews, allowedHandles, Date.now())
          : SanghyangParsers.extractTikTokVideoDetail(document, postUrl, gridStatsOrViews, allowedHandles, Date.now());

      if (platform === "tiktok" && expectedTtId) {
        const tapped = feedCapturedByKey.get(`tt:${expectedTtId}`) || null;
        if (tapped) {
          const canonical = SanghyangParsers.canonicalizeSocialPostUrl(postUrl, "tiktok") || tapped.sourceUrl;
          if (!post) {
            const tappedViews =
              typeof gridStatsOrViews === "object" && gridStatsOrViews !== null && typeof gridStatsOrViews.gridViews === "number"
                ? gridStatsOrViews.gridViews
                : tapped.gridViews ?? null;
            post = {
              platform: "tiktok",
              postType: tapped.postType || (canonical.includes("/photo/") ? "carousel" : "tiktok_video"),
              sourceUrl: canonical,
              postedAt: tapped.postedAt || SanghyangParsers.tiktokTimestampFromVideoId(canonical, Date.now()),
              caption: typeof tapped.caption === "string" ? tapped.caption : "",
              imageUrl: tapped.imageUrl || null,
              metrics: {
                views: tappedViews,
                likes: tapped.gridLikes ?? null,
                comments: tapped.gridComments ?? null,
                shares: tapped.gridShares ?? null,
              },
              comments: [],
            };
          } else {
            const pm = post.metrics && typeof post.metrics === "object" ? post.metrics : {};
            post = {
              ...post,
              postType: post.postType || tapped.postType || (canonical.includes("/photo/") ? "carousel" : "tiktok_video"),
              postedAt: post.postedAt || tapped.postedAt || SanghyangParsers.tiktokTimestampFromVideoId(canonical, Date.now()),
              caption:
                typeof post.caption === "string" && post.caption.trim()
                  ? post.caption
                  : typeof tapped.caption === "string"
                    ? tapped.caption
                    : "",
              imageUrl: post.imageUrl || tapped.imageUrl || null,
              metrics: {
                views: pm.views ?? tapped.gridViews ?? null,
                likes: pm.likes ?? tapped.gridLikes ?? null,
                comments: pm.comments ?? tapped.gridComments ?? null,
                shares: pm.shares ?? tapped.gridShares ?? null,
              },
            };
          }
        }
      }

      return { challenge, post };
    } finally {
      if (platform === "tiktok") {
        activeFeedFilter = null;
      }
    }
  };
})();