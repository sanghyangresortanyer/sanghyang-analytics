(function () {
  "use strict";

  if (typeof window === "undefined") return;
  if (window.__sanghyangFeedTapInstalled === true) return;
  window.__sanghyangFeedTapInstalled = true;

  const EVENT_CHUNK = "__sanghyang_feed_chunk__";
  const EVENT_SIGNAL = "__sanghyang_feed_signal__";
  const EVENT_REPLAY_REQ = "__sanghyang_feed_replay_req__";
  const EVENT_RESET = "__sanghyang_feed_reset__";
  const MAX_BUFFER_CHUNKS = 500;
  const MAX_BUFFER_SIGNALS = 50;
  const MAX_RESPONSE_CHARS = 12_000_000;
  const FUTURE_SKEW_MS = 5 * 60_000;
  const MIN_IG_EPOCH_MS = Date.UTC(2010, 0, 1);
  const MIN_TIKTOK_EPOCH_MS = Date.UTC(2016, 0, 1);
  const ALLOWED_FEED_KINDS = new Set(["timeline", "clips", "profile", "mixed"]);
  const RATE_LIMIT_MESSAGE_RE =
    /please wait a few minutes|rate[_\s-]?limit|feedback[_\s-]?required|throttl(?:ed|ing)|too many requests|try again later|action blocked/i;
  const REQUIRE_LOGIN_MESSAGE_RE =
    /\b(?:login_required|require_login|checkpoint_required|challenge_required|not logged in)\b/i;
  const RATE_LIMIT_GRAPHQL_CODES = new Set([4, 17, 32, 613, 1675004]);

  const IG_HOSTS = new Set(["www.instagram.com", "instagram.com", "m.instagram.com", "i.instagram.com"]);
  const TIKTOK_HOSTS = new Set(["www.tiktok.com", "tiktok.com", "m.tiktok.com"]);
  const IG_RESERVED_PATHS = new Set([
    "p",
    "reel",
    "reels",
    "explore",
    "stories",
    "tv",
    "accounts",
    "directory",
  ]);

  const feedBuffer = Array.isArray(window.__sanghyangFeedBuffer) ? window.__sanghyangFeedBuffer : [];
  window.__sanghyangFeedBuffer = feedBuffer;
  const signalBuffer = [];

  function currentPagePlatform() {
    const host = String(window.location?.hostname || "").toLowerCase();
    if (IG_HOSTS.has(host)) return "instagram";
    if (TIKTOK_HOSTS.has(host)) return "tiktok";
    return null;
  }

  function sanitizePageHref(rawHref) {
    if (typeof rawHref !== "string" || !rawHref.trim()) return "";
    try {
      const parsed = new URL(rawHref.trim());
      if (parsed.protocol !== "https:") return "";
      const pathClean = parsed.pathname.replace(/\/+$/, "") || "/";
      const trailing = IG_HOSTS.has(parsed.hostname.toLowerCase()) && pathClean !== "/" ? `${pathClean}/` : pathClean;
      return `${parsed.origin}${trailing}`;
    } catch {
      return "";
    }
  }

  function normalizePageKey(rawHref) {
    const clean = sanitizePageHref(rawHref);
    return clean.replace(/\/+$/, "").toLowerCase();
  }

  function stripLoneSurrogates(value) {
    if (typeof value !== "string") return "";
    let out = "";
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += value[i] + value[i + 1];
          i++;
        }
      } else if (code < 0xdc00 || code > 0xdfff) {
        out += value[i];
      }
    }
    return out.trim();
  }

  function truncateCaption(value) {
    const clean = stripLoneSurrogates(value);
    if (clean.length <= 2000) return clean;
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const seg = new Intl.Segmenter("id", { granularity: "grapheme" });
      let out = "";
      for (const part of seg.segment(clean)) {
        if (out.length + part.segment.length > 2000) break;
        out += part.segment;
      }
      return out;
    }
    let end = 2000;
    const code = clean.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    return clean.slice(0, end);
  }

  function nonNegativeCount(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
      }
    }
    return null;
  }

  function validHttpsUrl(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 2048 || !trimmed.startsWith("https://")) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  function firstValidHttpsUrl(candidates) {
    if (!Array.isArray(candidates)) return null;
    for (const c of candidates) {
      const u = validHttpsUrl(c);
      if (u) return u;
    }
    return null;
  }

  function sanitizeHandle(raw, platform) {
    if (typeof raw !== "string") return null;
    const clean = raw.replace(/^@/, "").trim().toLowerCase();
    if (!clean) return null;
    if (platform === "instagram") {
      return /^[a-z0-9._]{1,30}$/.test(clean) && !IG_RESERVED_PATHS.has(clean) ? clean : null;
    }
    if (platform === "tiktok") {
      return /^[a-z0-9._-]{1,64}$/.test(clean) ? clean : null;
    }
    return null;
  }

  function epochToIso(rawVal, minEpochMs, baseMs) {
    if (rawVal === null || rawVal === undefined) return null;
    let num = null;
    if (typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal > 0) {
      num = rawVal;
    } else if (typeof rawVal === "string") {
      const t = rawVal.trim();
      if (/^\d{9,17}$/.test(t)) num = Number(t);
    }
    if (num === null) return null;
    const ms = num >= 1e14 ? Math.floor(num / 1000) : num >= 1e11 ? Math.floor(num) : Math.floor(num * 1000);
    if (!Number.isFinite(ms) || ms < minEpochMs || ms > baseMs + FUTURE_SKEW_MS) return null;
    return new Date(ms).toISOString();
  }

  function tiktokTimestampFromId(idStr, baseMs) {
    if (typeof BigInt !== "function" || !/^\d{16,22}$/.test(idStr)) return null;
    try {
      const ms = Number(BigInt(idStr) >> BigInt(32)) * 1000;
      if (!Number.isFinite(ms) || ms < MIN_TIKTOK_EPOCH_MS || ms > baseMs + FUTURE_SKEW_MS) return null;
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
  }

  function matchEndpoint(rawUrl) {
    if (typeof rawUrl !== "string") return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    let parsed;
    try {
      const base = window.location?.origin && String(window.location.origin).startsWith("https://")
        ? window.location.origin
        : "https://www.instagram.com";
      parsed = trimmed.startsWith("/") ? new URL(trimmed, base) : new URL(trimmed);
    } catch {
      return null;
    }

    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (IG_HOSTS.has(host)) {
      let endpoint = null;
      if (/^\/(?:api\/graphql|graphql(?:\/query)?)(?:\/|$)/i.test(pathname)) endpoint = "ig_graphql";
      else if (/^\/api\/v1\/feed\/user\//i.test(pathname)) endpoint = "ig_feed_user";
      else if (/^\/api\/v1\/clips\/user(?:\/|$)/i.test(pathname)) endpoint = "ig_clips_user";
      else if (/^\/api\/v1\/users\/web_profile_info(?:\/|$)/i.test(pathname)) endpoint = "ig_web_profile_info";
      if (!endpoint) return null;
      return { platform: "instagram", endpoint, sanitizedUrl: `${parsed.origin}${pathname}` };
    }

    if (TIKTOK_HOSTS.has(host)) {
      let endpoint = null;
      if (/^\/api\/post\/item_list(?:\/|$)/i.test(pathname)) endpoint = "tt_post_item_list";
      else if (/^\/api\/creator\/item_list(?:\/|$)/i.test(pathname)) endpoint = "tt_creator_item_list";
      else if (/^\/api\/item\/detail(?:\/|$)/i.test(pathname)) endpoint = "tt_item_detail";
      if (!endpoint) return null;
      return { platform: "tiktok", endpoint, sanitizedUrl: `${parsed.origin}${pathname}` };
    }

    return null;
  }

  function parseJsonPayload(rawInput) {
    if (rawInput && typeof rawInput === "object") return [rawInput];
    if (typeof rawInput !== "string" || !rawInput || rawInput.length > MAX_RESPONSE_CHARS) return [];
    const cleaned = rawInput.replace(/^\uFEFF/, "").replace(/^\s*for\s*\(\s*;\s*;\s*\)\s*;\s*/, "").trim();
    if (!cleaned) return [];
    try {
      const parsed = JSON.parse(cleaned);
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      if (!cleaned.includes("\n")) return [];
      const out = [];
      for (const line of cleaned.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || (t[0] !== "{" && t[0] !== "[")) continue;
        try {
          const obj = JSON.parse(t);
          if (obj && typeof obj === "object") out.push(obj);
        } catch {
          // Lewati baris non-JSON pada aliran NDJSON.
        }
      }
      return out;
    }
  }

  function pickIgImage(node) {
    const lists = [
      node.image_versions2?.candidates,
      Array.isArray(node.carousel_media) ? node.carousel_media[0]?.image_versions2?.candidates : null,
    ];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        const u = validHttpsUrl(c?.url);
        if (u) return u;
      }
    }
    return validHttpsUrl(node.display_url) || validHttpsUrl(node.thumbnail_src) || validHttpsUrl(node.display_uri) || null;
  }

  function extractCleanPayload(match, rawInput, nowMs) {
    // Jika SanghyangFeedParsers tersedia di realm yang sama, pakai langsung agar kontrak tunggal.
    if (
      typeof globalThis.SanghyangFeedParsers === "object" &&
      globalThis.SanghyangFeedParsers !== null &&
      typeof globalThis.SanghyangFeedParsers.extractFeedPayload === "function"
    ) {
      return globalThis.SanghyangFeedParsers.extractFeedPayload(match.sanitizedUrl, rawInput, match.platform, nowMs);
    }

    const objects = parseJsonPayload(rawInput);
    const byKey = new Map();
    const kinds = new Set();
    let hasNextPage = null;
    let timelineHasNextPage = null;
    let clipsHasNextPage = null;
    let profileMeta = null;
    let profileUsername = null;

    const addKind = (kind) => {
      if (!kind || typeof kind !== "string") return;
      if (kind === "mixed") {
        kinds.add("timeline");
        kinds.add("clips");
      } else if (ALLOWED_FEED_KINDS.has(kind)) {
        kinds.add(kind);
      }
    };

    const resolveKind = () => {
      const hasTimeline = kinds.has("timeline");
      const hasClips = kinds.has("clips");
      const hasProfile = kinds.has("profile");
      if (hasTimeline && hasClips) return "mixed";
      if (hasTimeline) return "timeline";
      if (hasClips) return "clips";
      if (hasProfile) return "profile";
      return null;
    };

    const setNextPage = (val, connKind) => {
      if (typeof val !== "boolean") return;
      if (connKind === "timeline") timelineHasNextPage = val;
      else if (connKind === "clips") clipsHasNextPage = val;
      else hasNextPage = val;
    };

    const addProfileUser = (rawName, platform) => {
      const clean = sanitizeHandle(rawName, platform);
      if (clean && !profileUsername) profileUsername = clean;
    };

    const addMeta = (followersRaw, postsRaw) => {
      const followers = nonNegativeCount(followersRaw);
      const posts = nonNegativeCount(postsRaw);
      if (followers === null && posts === null) return false;
      profileMeta = profileMeta
        ? { followers: profileMeta.followers ?? followers, posts: profileMeta.posts ?? posts }
        : { followers, posts };
      return true;
    };

    const addItem = (key, item) => {
      if (!item || !item.sourceUrl) return;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, item);
      } else {
        byKey.set(key, {
          sourceUrl: prev.sourceUrl || item.sourceUrl,
          postType: prev.postType === "feed" && item.postType !== "feed" ? item.postType : prev.postType,
          postedAt: prev.postedAt ?? item.postedAt ?? null,
          caption: prev.caption || item.caption || "",
          imageUrl: prev.imageUrl ?? item.imageUrl ?? null,
          gridViews: prev.gridViews ?? item.gridViews ?? null,
          gridLikes: prev.gridLikes ?? item.gridLikes ?? null,
          gridComments: prev.gridComments ?? item.gridComments ?? null,
          gridShares: prev.gridShares ?? item.gridShares ?? null,
          ownerHandle: prev.ownerHandle ?? item.ownerHandle ?? null,
        });
      }
    };

    const parseIgNode = (rawNode, defaultType) => {
      if (!rawNode || typeof rawNode !== "object") return;
      const node = !rawNode.code && !rawNode.shortcode && rawNode.media && typeof rawNode.media === "object" ? rawNode.media : rawNode;
      const code = typeof node.code === "string" ? node.code.trim() : typeof node.shortcode === "string" ? node.shortcode.trim() : "";
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) return;
      const prodType = typeof node.product_type === "string" ? node.product_type.toLowerCase() : "";
      const tname = typeof node.__typename === "string" ? node.__typename : "";
      const mtype = typeof node.media_type === "number" ? node.media_type : null;
      const isCaro =
        mtype === 8 ||
        tname === "GraphSidecar" ||
        tname === "XDTGraphSidecar" ||
        (Array.isArray(node.carousel_media) && node.carousel_media.length > 0) ||
        (Array.isArray(node.edge_sidecar_to_children?.edges) && node.edge_sidecar_to_children.edges.length > 0);
      const isReels =
        prodType === "clips" ||
        (mtype === 2 && Boolean(node.clips_metadata)) ||
        tname === "XDTClipsMedia" ||
        tname === "ClipsMedia" ||
        (defaultType === "reels" && !isCaro);
      const postType = isReels ? "reels" : isCaro ? "carousel" : "feed";
      const ownerHandle = sanitizeHandle(node.user?.username ?? node.owner?.username, "instagram");
      const kind = postType === "reels" ? "reel" : "p";
      const sourceUrl = ownerHandle
        ? `https://www.instagram.com/${ownerHandle}/${kind}/${code}/`
        : `https://www.instagram.com/${kind}/${code}/`;
      const rawCap =
        (typeof node.caption?.text === "string" ? node.caption.text : "") ||
        (typeof node.caption === "string" ? node.caption : "") ||
        (typeof node.edge_media_to_caption?.edges?.[0]?.node?.text === "string" ? node.edge_media_to_caption.edges[0].node.text : "");

      addItem(`ig:${code}`, {
        sourceUrl,
        postType,
        postedAt:
          epochToIso(node.taken_at, MIN_IG_EPOCH_MS, nowMs) ??
          epochToIso(node.taken_at_timestamp, MIN_IG_EPOCH_MS, nowMs) ??
          epochToIso(node.caption?.created_at_utc, MIN_IG_EPOCH_MS, nowMs) ??
          epochToIso(node.caption?.created_at, MIN_IG_EPOCH_MS, nowMs) ??
          epochToIso(node.device_timestamp, MIN_IG_EPOCH_MS, nowMs),
        caption: truncateCaption(rawCap),
        imageUrl: pickIgImage(node),
        gridViews:
          nonNegativeCount(node.play_count) ??
          nonNegativeCount(node.ig_play_count) ??
          nonNegativeCount(node.view_count) ??
          nonNegativeCount(node.video_view_count) ??
          nonNegativeCount(node.video_play_count),
        gridLikes:
          nonNegativeCount(node.like_count) ??
          nonNegativeCount(node.edge_liked_by?.count) ??
          nonNegativeCount(node.edge_media_preview_like?.count),
        gridComments:
          nonNegativeCount(node.comment_count) ??
          nonNegativeCount(node.edge_media_to_comment?.count) ??
          nonNegativeCount(node.edge_media_to_parent_comment?.count) ??
          nonNegativeCount(node.edge_media_preview_comment?.count),
        gridShares:
          nonNegativeCount(node.reshare_count) ??
          nonNegativeCount(node.share_count) ??
          nonNegativeCount(node.fb_aggregated_share_count),
        ownerHandle,
      });
    };

    const parseIgConn = (conn, defaultType, connKind) => {
      if (!conn || typeof conn !== "object") return;
      const kind = connKind || (defaultType === "reels" ? "clips" : "timeline");
      const hasPageFlag =
        typeof conn.page_info?.has_next_page === "boolean" ||
        typeof conn.more_available === "boolean" ||
        typeof conn.paging_info?.more_available === "boolean";
      if (Array.isArray(conn.edges) || Array.isArray(conn.items) || hasPageFlag) {
        addKind(kind);
      }
      if (Array.isArray(conn.edges)) {
        for (const e of conn.edges) parseIgNode(e?.node, defaultType);
      }
      if (Array.isArray(conn.items)) {
        for (const it of conn.items) parseIgNode(it, defaultType);
      }
      if (typeof conn.page_info?.has_next_page === "boolean") setNextPage(conn.page_info.has_next_page, kind);
      else if (typeof conn.more_available === "boolean") setNextPage(conn.more_available, kind);
      else if (typeof conn.paging_info?.more_available === "boolean") setNextPage(conn.paging_info.more_available, kind);
    };

    const parseIgUser = (u, fromProfileEndpoint) => {
      if (!u || typeof u !== "object") return;
      const hasMeta = addMeta(
        u.edge_followed_by?.count ?? u.follower_count,
        u.edge_owner_to_timeline_media?.count ?? u.all_media_count ?? u.media_count,
      );
      const cleanUser = sanitizeHandle(u.username, "instagram");
      if (cleanUser) addProfileUser(cleanUser, "instagram");
      if (fromProfileEndpoint || hasMeta || cleanUser) addKind("profile");
      if (u.edge_owner_to_timeline_media) parseIgConn(u.edge_owner_to_timeline_media, null, "timeline");
      if (u.edge_felix_video_timeline) parseIgConn(u.edge_felix_video_timeline, null, "timeline");
      if (u.polaris_ordered_timeline_connection) parseIgConn(u.polaris_ordered_timeline_connection, null, "timeline");
      if (u.polaris_clips_connection) parseIgConn(u.polaris_clips_connection, "reels", "clips");
    };

    const parseTtItem = (rawItem) => {
      if (!rawItem || typeof rawItem !== "object") return;
      const id = typeof rawItem.id === "string" || typeof rawItem.id === "number" ? String(rawItem.id).trim() : "";
      if (!/^\d{10,22}$/.test(id)) return;
      const authorRaw =
        typeof rawItem.author === "string"
          ? rawItem.author
          : typeof rawItem.author?.uniqueId === "string"
            ? rawItem.author.uniqueId
            : typeof rawItem.authorUniqueId === "string"
              ? rawItem.authorUniqueId
              : "";
      const ownerHandle = sanitizeHandle(authorRaw, "tiktok");
      if (!ownerHandle) return;
      const isPhoto = Boolean(
        (rawItem.imagePost && (typeof rawItem.imagePost === "object" || rawItem.imagePost === true)) ||
          (rawItem.image_post_info && typeof rawItem.image_post_info === "object") ||
          rawItem.aweme_type === 150,
      );
      const kind = isPhoto ? "photo" : "video";
      const stats = rawItem.stats && typeof rawItem.stats === "object" ? rawItem.stats : null;
      const statsV2 = rawItem.statsV2 && typeof rawItem.statsV2 === "object" ? rawItem.statsV2 : null;
      const aStats = rawItem.authorStats || rawItem.authorStatsV2 || null;
      if (aStats && typeof aStats === "object") {
        addMeta(aStats.followerCount, aStats.videoCount);
        addProfileUser(ownerHandle, "tiktok");
      }

      const rawDesc =
        (typeof rawItem.desc === "string" && rawItem.desc.trim() ? rawItem.desc : "") ||
        (typeof rawItem.contents?.[0]?.desc === "string" && rawItem.contents[0].desc.trim() ? rawItem.contents[0].desc : "") ||
        (typeof rawItem.imagePost?.title === "string" && rawItem.imagePost.title.trim() ? rawItem.imagePost.title : "") ||
        (typeof rawItem.image_post_info?.title === "string" && rawItem.image_post_info.title.trim()
          ? rawItem.image_post_info.title
          : "");

      addItem(`tt:${id}`, {
        sourceUrl: `https://www.tiktok.com/@${ownerHandle}/${kind}/${id}`,
        postType: isPhoto ? "carousel" : "tiktok_video",
        postedAt: epochToIso(rawItem.createTime, MIN_TIKTOK_EPOCH_MS, nowMs) ?? tiktokTimestampFromId(id, nowMs),
        caption: truncateCaption(rawDesc),
        imageUrl:
          firstValidHttpsUrl(rawItem.imagePost?.cover?.imageURL?.urlList) ||
          firstValidHttpsUrl(rawItem.imagePost?.images?.[0]?.imageURL?.urlList) ||
          firstValidHttpsUrl(rawItem.image_post_info?.images?.[0]?.display_image?.url_list) ||
          validHttpsUrl(rawItem.video?.cover) ||
          validHttpsUrl(rawItem.video?.originCover) ||
          validHttpsUrl(rawItem.video?.dynamicCover) ||
          null,
        gridViews: nonNegativeCount(stats?.playCount) ?? nonNegativeCount(statsV2?.playCount),
        gridLikes: nonNegativeCount(stats?.diggCount) ?? nonNegativeCount(statsV2?.diggCount),
        gridComments: nonNegativeCount(stats?.commentCount) ?? nonNegativeCount(statsV2?.commentCount),
        gridShares: nonNegativeCount(stats?.shareCount) ?? nonNegativeCount(statsV2?.shareCount),
        ownerHandle,
      });
    };

    for (const obj of objects) {
      if (match.platform === "instagram") {
        if (obj.data && typeof obj.data === "object") {
          for (const key of Object.keys(obj.data)) {
            const val = obj.data[key];
            if (!val || typeof val !== "object") continue;
            if (/^xdt_api__v1__feed__user_timeline/i.test(key) || key === "polaris_ordered_timeline_connection") {
              parseIgConn(val, null, "timeline");
            } else if (/^xdt_api__v1__clips__user/i.test(key) || key === "polaris_clips_connection") {
              parseIgConn(val, "reels", "clips");
            } else if (key === "user" || key === "xig_user_by_username") {
              parseIgUser(val, match.endpoint === "ig_web_profile_info");
            } else if (
              key === "node" &&
              (val.polaris_ordered_timeline_connection ||
                val.polaris_clips_connection ||
                val.edge_owner_to_timeline_media ||
                val.edge_felix_video_timeline)
            ) {
              parseIgUser(val, false);
            } else if (/^xdt_api__v1__users__.*profile/i.test(key)) {
              parseIgUser(val.user && typeof val.user === "object" ? val.user : val, true);
            }
          }
        }
        if (match.endpoint !== "ig_graphql") {
          const defType = match.endpoint === "ig_clips_user" ? "reels" : null;
          const listKind = match.endpoint === "ig_clips_user" ? "clips" : "timeline";
          if (Array.isArray(obj.items)) {
            addKind(listKind);
            for (const it of obj.items) parseIgNode(it, defType);
          }
          if (typeof obj.more_available === "boolean") {
            addKind(listKind);
            setNextPage(obj.more_available, listKind);
          } else if (typeof obj.paging_info?.more_available === "boolean") {
            addKind(listKind);
            setNextPage(obj.paging_info.more_available, listKind);
          }
          if (obj.user && typeof obj.user === "object") parseIgUser(obj.user, match.endpoint === "ig_web_profile_info");
        }
      } else if (match.platform === "tiktok") {
        const list = Array.isArray(obj.itemList) ? obj.itemList : Array.isArray(obj.data?.itemList) ? obj.data.itemList : null;
        if (list) {
          addKind("timeline");
          for (const it of list) parseTtItem(it);
        }
        if (obj.itemInfo?.itemStruct) parseTtItem(obj.itemInfo.itemStruct);
        if (obj.userInfo?.user?.uniqueId) addProfileUser(obj.userInfo.user.uniqueId, "tiktok");
        if (match.endpoint !== "tt_item_detail" || list !== null) {
          if (typeof obj.hasMore === "boolean") {
            addKind("timeline");
            setNextPage(obj.hasMore, "timeline");
          } else if (typeof obj.has_more === "boolean") {
            addKind("timeline");
            setNextPage(obj.has_more, "timeline");
          }
        }
      }
    }

    const resolvedHasNext =
      timelineHasNextPage !== null ? timelineHasNextPage : clipsHasNextPage !== null ? clipsHasNextPage : hasNextPage;

    return {
      platform: match.platform,
      feedKind: resolveKind(),
      profileUsername,
      items: Array.from(byKey.values()),
      hasNextPage: resolvedHasNext,
      profileMeta,
      urlMatched: true,
    };
  }

  function detectErrorSignal(status, rawBody, platform) {
    if (
      typeof globalThis.SanghyangFeedParsers === "object" &&
      globalThis.SanghyangFeedParsers !== null &&
      typeof globalThis.SanghyangFeedParsers.detectFeedErrorSignal === "function"
    ) {
      return globalThis.SanghyangFeedParsers.detectFeedErrorSignal(status, rawBody, platform);
    }

    const httpStatus = typeof status === "number" && Number.isFinite(status) ? Math.round(status) : null;
    const isHttpError =
      httpStatus !== null &&
      (httpStatus === 429 || httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || httpStatus >= 500);

    let rateLimited = httpStatus === 429;
    let requireLogin = httpStatus === 401;
    let graphqlError = false;

    const inspectText = (val) => {
      if (typeof val !== "string" || !val) return;
      if (RATE_LIMIT_MESSAGE_RE.test(val)) rateLimited = true;
      if (REQUIRE_LOGIN_MESSAGE_RE.test(val)) requireLogin = true;
    };

    const objects = parseJsonPayload(rawBody);
    for (const obj of objects) {
      if (!obj || typeof obj !== "object") continue;
      if (
        obj.require_login === true ||
        obj.login_required === true ||
        obj.checkpoint_required === true ||
        obj.challenge_required === true ||
        (typeof obj.checkpoint_url === "string" && obj.checkpoint_url.trim().length > 0)
      ) {
        requireLogin = true;
      }
      if (obj.feedback_required === true || obj.spam === true) {
        rateLimited = true;
      }
      if (typeof obj.status === "string" && obj.status.trim().toLowerCase() === "fail") {
        graphqlError = true;
      }
      if (obj.error && typeof obj.error === "object") {
        graphqlError = true;
        inspectText(obj.error.message);
        inspectText(obj.error.summary);
        inspectText(obj.error.description);
        if (typeof obj.error.code === "number" && RATE_LIMIT_GRAPHQL_CODES.has(obj.error.code)) {
          rateLimited = true;
        }
      }
      if (
        (platform === "tiktok" || obj.statusCode !== undefined || obj.status_code !== undefined) &&
        (obj.statusCode === 10201 || obj.status_code === 10201)
      ) {
        rateLimited = true;
      }
      inspectText(obj.message);
      inspectText(obj.error);
      inspectText(obj.error_title);
      inspectText(obj.feedback_title);
      inspectText(obj.feedback_message);
      inspectText(obj.description);
      inspectText(obj.status_msg);

      if (Array.isArray(obj.errors) && obj.errors.length > 0) {
        graphqlError = true;
        for (const err of obj.errors) {
          if (typeof err === "string") {
            inspectText(err);
            continue;
          }
          if (!err || typeof err !== "object") continue;
          if (typeof err.code === "number" && RATE_LIMIT_GRAPHQL_CODES.has(err.code)) {
            rateLimited = true;
          }
          if (err.require_login === true || err.login_required === true) {
            requireLogin = true;
          }
          inspectText(err.message);
          inspectText(err.summary);
          inspectText(err.description);
          inspectText(err.severity);
          inspectText(err.extensions?.code);
        }
      }
    }

    if (isHttpError && typeof rawBody === "string" && rawBody.length > 0) {
      inspectText(rawBody.slice(0, 4096));
    }

    if (!isHttpError && !rateLimited && !requireLogin && !graphqlError) return null;

    return {
      httpStatus,
      rateLimited: Boolean(rateLimited),
      requireLogin: Boolean(requireLogin),
      graphqlError: Boolean(graphqlError),
    };
  }

  function dispatchChunk(chunk) {
    try {
      // Serialisasi string JSON agar payload melewati batas MAIN <-> ISOLATED world Chrome MV3 secara utuh.
      const detail = JSON.stringify(chunk);
      window.dispatchEvent(new CustomEvent(EVENT_CHUNK, { detail }));
    } catch {
      // ZERO-FALLBACK: Pengamat pasif di MAIN world tidak boleh mengganggu eksekusi halaman tuan rumah.
    }
  }

  function dispatchSignal(signal) {
    try {
      const detail = JSON.stringify(signal);
      window.dispatchEvent(new CustomEvent(EVENT_SIGNAL, { detail }));
    } catch {
      // ZERO-FALLBACK: Pengamat pasif di MAIN world tidak boleh mengganggu eksekusi halaman tuan rumah.
    }
  }

  function emitSignalIfError(match, status, rawBody) {
    try {
      const detected = detectErrorSignal(status, rawBody, match.platform);
      if (!detected) return;
      const nowMs = Date.now();
      const signal = {
        __sanghyangCleanSignal: true,
        version: 1,
        platform: match.platform,
        url: match.sanitizedUrl,
        pageHref: sanitizePageHref(String(window.location?.href || "")),
        capturedAt: nowMs,
        httpStatus: detected.httpStatus,
        rateLimited: detected.rateLimited,
        requireLogin: detected.requireLogin,
        graphqlError: detected.graphqlError,
      };
      if (signalBuffer.length >= MAX_BUFFER_SIGNALS) {
        signalBuffer.shift();
      }
      signalBuffer.push(signal);
      dispatchSignal(signal);
    } catch {
      // ZERO-FALLBACK: Isolasi kesalahan inspeksi sinyal agar halaman tuan rumah tidak terpengaruh.
    }
  }

  function processMatchedResponse(match, rawBody) {
    try {
      const nowMs = Date.now();
      const extracted = extractCleanPayload(match, rawBody, nowMs);
      if (!extracted || !extracted.urlMatched) return;
      if (extracted.items.length === 0 && extracted.hasNextPage === null && extracted.profileMeta === null) {
        return;
      }

      const chunk = {
        __sanghyangCleanChunk: true,
        version: 1,
        platform: extracted.platform,
        feedKind: extracted.feedKind ?? null,
        profileUsername: extracted.profileUsername ?? null,
        url: match.sanitizedUrl,
        pageHref: sanitizePageHref(String(window.location?.href || "")),
        capturedAt: nowMs,
        hasNextPage: extracted.hasNextPage,
        profileMeta: extracted.profileMeta,
        items: extracted.items,
      };

      if (feedBuffer.length >= MAX_BUFFER_CHUNKS) {
        feedBuffer.shift();
      }
      feedBuffer.push(chunk);
      dispatchChunk(chunk);
    } catch {
      // ZERO-FALLBACK: Kesalahan parsing respons pihak ketiga di MAIN world diisolasi agar halaman tidak rusak.
    }
  }

  function requestUrlFromFetchInput(input) {
    if (typeof input === "string") return input;
    if (typeof URL !== "undefined" && input instanceof URL) return input.href;
    if (input && typeof input === "object" && typeof input.url === "string") return input.url;
    return "";
  }

  // Bungkus window.fetch secara pasif (baca-saja): argumen dan promise asli dikembalikan 100% utuh.
  if (typeof window.fetch === "function") {
    const origFetch = window.fetch;
    window.fetch = function (...args) {
      const promise = origFetch.apply(this, args);
      const rawUrl = requestUrlFromFetchInput(args[0]);
      const match = matchEndpoint(rawUrl);
      if (match && (!currentPagePlatform() || currentPagePlatform() === match.platform) && promise && typeof promise.then === "function") {
        promise.then(
          (response) => {
            if (!response) return;
            const status = typeof response.status === "number" ? response.status : null;
            const isHttpErr =
              status !== null && (status === 429 || status === 400 || status === 401 || status === 403 || status >= 500);
            if (!response.ok && !isHttpErr) return;
            if (typeof response.clone !== "function") {
              if (isHttpErr) emitSignalIfError(match, status, "");
              return;
            }
            try {
              const cloned = response.clone();
              if (cloned && typeof cloned.text === "function") {
                cloned.text().then(
                  (text) => {
                    const safeText = typeof text === "string" && text.length <= MAX_RESPONSE_CHARS ? text : "";
                    emitSignalIfError(match, status, safeText);
                    if (response.ok && safeText.length > 0) {
                      processMatchedResponse(match, safeText);
                    }
                  },
                  () => {
                    if (isHttpErr) emitSignalIfError(match, status, "");
                  },
                );
              } else if (isHttpErr) {
                emitSignalIfError(match, status, "");
              }
            } catch {
              if (isHttpErr) emitSignalIfError(match, status, "");
            }
          },
          () => {
            // ZERO-FALLBACK: Kegagalan jaringan asli tetap ditangani pemanggil asli, bukan pengamat pasif.
          },
        );
      }
      return promise;
    };
  }

  // Bungkus XMLHttpRequest secara pasif (baca-saja): tidak menyentuh header, body, atau properti publik XHR.
  if (typeof window.XMLHttpRequest === "function" && window.XMLHttpRequest.prototype) {
    const xhrMatchMap = new WeakMap();
    const origOpen = window.XMLHttpRequest.prototype.open;
    const origSend = window.XMLHttpRequest.prototype.send;

    if (typeof origOpen === "function" && typeof origSend === "function") {
      window.XMLHttpRequest.prototype.open = function (...args) {
        const rawUrl = typeof args[1] === "string" ? args[1] : args[1] != null ? String(args[1]) : "";
        const match = matchEndpoint(rawUrl);
        if (match && (!currentPagePlatform() || currentPagePlatform() === match.platform)) {
          xhrMatchMap.set(this, match);
        } else {
          xhrMatchMap.delete(this);
        }
        return origOpen.apply(this, args);
      };

      window.XMLHttpRequest.prototype.send = function (...args) {
        const match = xhrMatchMap.get(this);
        if (match && typeof this.addEventListener === "function") {
          this.addEventListener(
            "load",
            () => {
              const status = typeof this.status === "number" ? this.status : null;
              const isOk = status !== null && status >= 200 && status < 300;
              const isHttpErr =
                status !== null && (status === 429 || status === 400 || status === 401 || status === 403 || status >= 500);
              if (!isOk && !isHttpErr) return;
              let payload = "";
              try {
                if (!this.responseType || this.responseType === "text") {
                  const txt = this.responseText;
                  if (typeof txt === "string" && txt.length <= MAX_RESPONSE_CHARS) {
                    payload = txt;
                  }
                } else if (this.responseType === "json" && this.response && typeof this.response === "object") {
                  payload = this.response;
                }
              } catch {
                payload = "";
              }
              emitSignalIfError(match, status, payload);
              if (isOk && (typeof payload === "object" || payload.length > 0)) {
                processMatchedResponse(match, payload);
              }
            },
            { once: true },
          );
        }
        return origSend.apply(this, args);
      };
    }
  }

  // Handshake replay lintas world (ISOLATED -> MAIN): putar ulang chunk dan sinyal error untuk pageHref aktif.
  window.addEventListener(EVENT_REPLAY_REQ, (ev) => {
    let requestedHref = "";
    try {
      const detail = ev && "detail" in ev ? ev.detail : null;
      if (typeof detail === "string" && detail.trim()) {
        const parsed = JSON.parse(detail);
        if (parsed && typeof parsed.pageHref === "string") requestedHref = parsed.pageHref;
      } else if (detail && typeof detail === "object" && typeof detail.pageHref === "string") {
        requestedHref = detail.pageHref;
      }
    } catch {
      // ZERO-FALLBACK: Gunakan lokasi halaman aktif jika detail replay tidak berformat JSON.
    }

    const targetKey = normalizePageKey(requestedHref || String(window.location?.href || ""));
    for (const chunk of feedBuffer) {
      if (!chunk || typeof chunk !== "object") continue;
      if (targetKey && normalizePageKey(chunk.pageHref) !== targetKey) continue;
      dispatchChunk({ ...chunk, replayed: true });
    }
    for (const sig of signalBuffer) {
      if (!sig || typeof sig !== "object") continue;
      if (targetKey && normalizePageKey(sig.pageHref) !== targetKey) continue;
      dispatchSignal({ ...sig, replayed: true });
    }
  });

  // Handshake reset antar-navigasi SPA.
  window.addEventListener(EVENT_RESET, () => {
    feedBuffer.length = 0;
    signalBuffer.length = 0;
  });
})();
