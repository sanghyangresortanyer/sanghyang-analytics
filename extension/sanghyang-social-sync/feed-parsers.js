(function (root, factory) {
  const exportsObj = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exportsObj;
  }
  root.SanghyangFeedParsers = exportsObj;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const EVENT_CHUNK = "__sanghyang_feed_chunk__";
  const EVENT_SIGNAL = "__sanghyang_feed_signal__";
  const EVENT_REPLAY_REQ = "__sanghyang_feed_replay_req__";
  const EVENT_RESET = "__sanghyang_feed_reset__";
  const MAX_BUFFER_CHUNKS = 500;
  const MAX_JSON_CHARS = 12_000_000;
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

  function truncateGraphemeSafe(value, maxLen) {
    const clean = stripLoneSurrogates(value);
    if (clean.length <= maxLen) return clean;
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const seg = new Intl.Segmenter("id", { granularity: "grapheme" });
      let out = "";
      for (const part of seg.segment(clean)) {
        if (out.length + part.segment.length > maxLen) break;
        out += part.segment;
      }
      return out;
    }
    let safeEnd = maxLen;
    const code = clean.charCodeAt(safeEnd - 1);
    if (code >= 0xd800 && code <= 0xdbff) safeEnd -= 1;
    return clean.slice(0, safeEnd);
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
    for (const candidate of candidates) {
      const u = validHttpsUrl(candidate);
      if (u) return u;
    }
    return null;
  }

  function sanitizeOwnerHandle(raw, platform) {
    if (typeof raw !== "string") return null;
    const clean = raw.replace(/^@/, "").trim().toLowerCase();
    if (!clean) return null;
    if (platform === "instagram") {
      if (!/^[a-z0-9._]{1,30}$/.test(clean) || IG_RESERVED_PATHS.has(clean)) return null;
      return clean;
    }
    if (platform === "tiktok") {
      if (!/^[a-z0-9._-]{1,64}$/.test(clean)) return null;
      return clean;
    }
    return null;
  }

  function epochToIso(rawVal, minEpochMs, baseMs) {
    if (rawVal === null || rawVal === undefined) return null;
    let num = null;
    if (typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal > 0) {
      num = rawVal;
    } else if (typeof rawVal === "string") {
      const trimmed = rawVal.trim();
      if (!trimmed) return null;
      if (/^\d{9,17}$/.test(trimmed)) {
        num = Number(trimmed);
      } else if (/^\d{4}-\d{2}-\d{2}t/i.test(trimmed)) {
        const parsedMs = Date.parse(trimmed);
        if (Number.isFinite(parsedMs) && parsedMs >= minEpochMs && parsedMs <= baseMs + FUTURE_SKEW_MS) {
          return new Date(parsedMs).toISOString();
        }
        return null;
      }
    }
    if (num === null || !Number.isFinite(num) || num <= 0) return null;
    let ms;
    if (num >= 1e14) {
      // Instagram device_timestamp sering memakai mikrodetik (16 digit).
      ms = Math.floor(num / 1000);
    } else if (num >= 1e11) {
      ms = Math.floor(num);
    } else {
      ms = Math.floor(num * 1000);
    }
    if (!Number.isFinite(ms) || ms < minEpochMs || ms > baseMs + FUTURE_SKEW_MS) return null;
    return new Date(ms).toISOString();
  }

  function tiktokTimestampFromId(idStr, baseMs) {
    if (typeof BigInt !== "function" || typeof idStr !== "string") return null;
    const clean = idStr.trim();
    if (!/^\d{16,22}$/.test(clean)) return null;
    try {
      const sec = Number(BigInt(clean) >> BigInt(32));
      const ms = sec * 1000;
      if (!Number.isFinite(ms) || ms < MIN_TIKTOK_EPOCH_MS || ms > baseMs + FUTURE_SKEW_MS) return null;
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
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

  function matchInstagramPath(pathname) {
    if (/^\/(?:api\/graphql|graphql(?:\/query)?)(?:\/|$)/i.test(pathname)) return "ig_graphql";
    if (/^\/api\/v1\/feed\/user\//i.test(pathname)) return "ig_feed_user";
    if (/^\/api\/v1\/clips\/user(?:\/|$)/i.test(pathname)) return "ig_clips_user";
    if (/^\/api\/v1\/users\/web_profile_info(?:\/|$)/i.test(pathname)) return "ig_web_profile_info";
    return null;
  }

  function matchTikTokPath(pathname) {
    if (/^\/api\/post\/item_list(?:\/|$)/i.test(pathname)) return "tt_post_item_list";
    if (/^\/api\/creator\/item_list(?:\/|$)/i.test(pathname)) return "tt_creator_item_list";
    if (/^\/api\/item\/detail(?:\/|$)/i.test(pathname)) return "tt_item_detail";
    return null;
  }

  function matchFeedEndpoint(rawUrl, platformHint) {
    const empty = { matched: false, platform: null, endpoint: null, sanitizedUrl: null };
    if (typeof rawUrl !== "string") return empty;
    const trimmed = rawUrl.trim();
    if (!trimmed) return empty;

    let parsed = null;
    let isRelative = false;
    if (trimmed.startsWith("/")) {
      isRelative = true;
      const hint = platformHint === "tiktok" ? "tiktok" : platformHint === "instagram" ? "instagram" : null;
      const baseOrigin =
        hint === "tiktok"
          ? "https://www.tiktok.com"
          : hint === "instagram"
            ? "https://www.instagram.com"
            : matchTikTokPath(trimmed.split(/[?#]/)[0])
              ? "https://www.tiktok.com"
              : "https://www.instagram.com";
      try {
        parsed = new URL(trimmed, baseOrigin);
      } catch {
        return empty;
      }
    } else {
      try {
        parsed = new URL(trimmed);
      } catch {
        return empty;
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return empty;
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    if (IG_HOSTS.has(host) || (isRelative && platformHint === "instagram")) {
      const ep = matchInstagramPath(pathname);
      if (ep) {
        // Buang query string agar parameter pelacakan atau sesi tidak pernah tersimpan di buffer/event.
        return { matched: true, platform: "instagram", endpoint: ep, sanitizedUrl: `${parsed.origin}${pathname}` };
      }
      return empty;
    }

    if (TIKTOK_HOSTS.has(host) || (isRelative && platformHint === "tiktok")) {
      const ep = matchTikTokPath(pathname);
      if (ep) {
        return { matched: true, platform: "tiktok", endpoint: ep, sanitizedUrl: `${parsed.origin}${pathname}` };
      }
      return empty;
    }

    return empty;
  }

  function parseRawJsonObjects(jsonData) {
    if (jsonData === null || jsonData === undefined) return [];
    if (typeof jsonData === "object") return [jsonData];
    if (typeof jsonData !== "string") return [];
    if (jsonData.length === 0 || jsonData.length > MAX_JSON_CHARS) return [];

    // Meta kerap menambahkan awalan anti-XSSI "for (;;);" pada respons JSON GraphQL.
    const cleaned = jsonData.replace(/^\uFEFF/, "").replace(/^\s*for\s*\(\s*;\s*;\s*\)\s*;\s*/, "").trim();
    if (!cleaned) return [];

    try {
      const parsed = JSON.parse(cleaned);
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      if (!cleaned.includes("\n")) return [];
      // Respons Relay streaming dapat mengirim beberapa objek JSON per baris (NDJSON).
      const out = [];
      const lines = cleaned.split(/\r?\n/);
      for (const line of lines) {
        const t = line.trim();
        if (!t || (t[0] !== "{" && t[0] !== "[")) continue;
        try {
          const obj = JSON.parse(t);
          if (obj && typeof obj === "object") out.push(obj);
        } catch {
          // Lewati baris non-JSON dalam aliran NDJSON.
        }
      }
      return out;
    }
  }

  function pickInstagramImageUrl(node) {
    const candidateLists = [
      node.image_versions2?.candidates,
      Array.isArray(node.carousel_media) ? node.carousel_media[0]?.image_versions2?.candidates : null,
    ];
    for (const list of candidateLists) {
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        const u = validHttpsUrl(c?.url);
        if (u) return u;
      }
    }
    return (
      validHttpsUrl(node.display_url) ||
      validHttpsUrl(node.thumbnail_src) ||
      validHttpsUrl(node.display_uri) ||
      null
    );
  }

  function normalizeInstagramMediaNode(rawNode, defaultPostType, baseMs) {
    if (!rawNode || typeof rawNode !== "object") return null;
    const node =
      !rawNode.code && !rawNode.shortcode && rawNode.media && typeof rawNode.media === "object"
        ? rawNode.media
        : rawNode;

    const rawCode = typeof node.code === "string" ? node.code.trim() : typeof node.shortcode === "string" ? node.shortcode.trim() : "";
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(rawCode)) return null;

    const productType = typeof node.product_type === "string" ? node.product_type.trim().toLowerCase() : "";
    const typename = typeof node.__typename === "string" ? node.__typename : "";
    const mediaType = typeof node.media_type === "number" ? node.media_type : null;

    const isCarousel =
      mediaType === 8 ||
      typename === "GraphSidecar" ||
      typename === "XDTGraphSidecar" ||
      (Array.isArray(node.carousel_media) && node.carousel_media.length > 0) ||
      (Array.isArray(node.edge_sidecar_to_children?.edges) && node.edge_sidecar_to_children.edges.length > 0);
    const isReels =
      productType === "clips" ||
      (mediaType === 2 && Boolean(node.clips_metadata)) ||
      typename === "XDTClipsMedia" ||
      typename === "ClipsMedia" ||
      (defaultPostType === "reels" && !isCarousel);

    const postType = isReels ? "reels" : isCarousel ? "carousel" : "feed";
    const ownerHandle = sanitizeOwnerHandle(node.user?.username ?? node.owner?.username, "instagram");
    const pathKind = postType === "reels" ? "reel" : "p";
    const sourceUrl = ownerHandle
      ? `https://www.instagram.com/${ownerHandle}/${pathKind}/${rawCode}/`
      : `https://www.instagram.com/${pathKind}/${rawCode}/`;

    const postedAt =
      epochToIso(node.taken_at, MIN_IG_EPOCH_MS, baseMs) ??
      epochToIso(node.taken_at_timestamp, MIN_IG_EPOCH_MS, baseMs) ??
      epochToIso(node.caption?.created_at_utc, MIN_IG_EPOCH_MS, baseMs) ??
      epochToIso(node.caption?.created_at, MIN_IG_EPOCH_MS, baseMs) ??
      epochToIso(node.device_timestamp, MIN_IG_EPOCH_MS, baseMs);

    const rawCaption =
      (typeof node.caption?.text === "string" ? node.caption.text : "") ||
      (typeof node.caption === "string" ? node.caption : "") ||
      (typeof node.edge_media_to_caption?.edges?.[0]?.node?.text === "string"
        ? node.edge_media_to_caption.edges[0].node.text
        : "");

    return {
      sourceUrl,
      postType,
      postedAt,
      caption: truncateGraphemeSafe(rawCaption, 2000),
      imageUrl: pickInstagramImageUrl(node),
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
    };
  }

  function mergeCleanItem(prev, next) {
    return {
      sourceUrl: prev.sourceUrl || next.sourceUrl,
      postType: prev.postType === "feed" && next.postType !== "feed" ? next.postType : prev.postType,
      postedAt: prev.postedAt ?? next.postedAt ?? null,
      caption: prev.caption || next.caption || "",
      imageUrl: prev.imageUrl ?? next.imageUrl ?? null,
      gridViews: prev.gridViews ?? next.gridViews ?? null,
      gridLikes: prev.gridLikes ?? next.gridLikes ?? null,
      gridComments: prev.gridComments ?? next.gridComments ?? null,
      gridShares: prev.gridShares ?? next.gridShares ?? null,
      ownerHandle: prev.ownerHandle ?? next.ownerHandle ?? null,
    };
  }

  function itemDedupKey(platform, item) {
    if (platform === "instagram") {
      const m = item.sourceUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/);
      if (m) return `ig:${m[1]}`;
    } else if (platform === "tiktok") {
      const m = item.sourceUrl.match(/\/(?:video|photo)\/(\d{10,22})$/);
      if (m) return `tt:${m[1]}`;
    }
    return item.sourceUrl;
  }

  function pushItem(acc, platform, item) {
    if (!item || !item.sourceUrl) return;
    const key = itemDedupKey(platform, item);
    const prev = acc.byKey.get(key);
    acc.byKey.set(key, prev ? mergeCleanItem(prev, item) : item);
  }

  function absorbFeedKind(acc, kind) {
    if (!kind || typeof kind !== "string") return;
    if (kind === "mixed") {
      acc.kinds.add("timeline");
      acc.kinds.add("clips");
      return;
    }
    if (ALLOWED_FEED_KINDS.has(kind)) {
      acc.kinds.add(kind);
    }
  }

  function resolveFeedKind(kinds) {
    const hasTimeline = kinds.has("timeline");
    const hasClips = kinds.has("clips");
    const hasProfile = kinds.has("profile");
    if (hasTimeline && hasClips) return "mixed";
    if (hasTimeline) return "timeline";
    if (hasClips) return "clips";
    if (hasProfile) return "profile";
    return null;
  }

  function absorbProfileUsername(acc, rawUsername, platform) {
    const clean = sanitizeOwnerHandle(rawUsername, platform);
    if (clean && !acc.profileUsername) {
      acc.profileUsername = clean;
    }
  }

  function recordHasNextPage(acc, val, connKind) {
    if (typeof val !== "boolean") return;
    if (connKind === "timeline") {
      acc.timelineHasNextPage = val;
    } else if (connKind === "clips") {
      acc.clipsHasNextPage = val;
    } else {
      acc.hasNextPage = val;
    }
  }

  function absorbProfileMeta(acc, followersRaw, postsRaw) {
    const followers = nonNegativeCount(followersRaw);
    const posts = nonNegativeCount(postsRaw);
    if (followers === null && posts === null) return;
    if (!acc.profileMeta) {
      acc.profileMeta = { followers, posts };
    } else {
      acc.profileMeta = {
        followers: acc.profileMeta.followers ?? followers,
        posts: acc.profileMeta.posts ?? posts,
      };
    }
  }

  function absorbInstagramConnection(conn, defaultPostType, baseMs, acc, connKind) {
    if (!conn || typeof conn !== "object") return;
    const kind = connKind || (defaultPostType === "reels" ? "clips" : "timeline");
    const hasPageFlag =
      typeof conn.page_info?.has_next_page === "boolean" ||
      typeof conn.more_available === "boolean" ||
      typeof conn.paging_info?.more_available === "boolean";
    const hasEntries = Array.isArray(conn.edges) || Array.isArray(conn.items);
    if (hasEntries || hasPageFlag) {
      absorbFeedKind(acc, kind);
    }
    if (Array.isArray(conn.edges)) {
      for (const edge of conn.edges) {
        const node = edge && typeof edge === "object" ? edge.node : null;
        const item = normalizeInstagramMediaNode(node, defaultPostType, baseMs);
        pushItem(acc, "instagram", item);
      }
    }
    if (Array.isArray(conn.items)) {
      for (const entry of conn.items) {
        const item = normalizeInstagramMediaNode(entry, defaultPostType, baseMs);
        pushItem(acc, "instagram", item);
      }
    }
    if (typeof conn.page_info?.has_next_page === "boolean") {
      recordHasNextPage(acc, conn.page_info.has_next_page, kind);
    } else if (typeof conn.more_available === "boolean") {
      recordHasNextPage(acc, conn.more_available, kind);
    } else if (typeof conn.paging_info?.more_available === "boolean") {
      recordHasNextPage(acc, conn.paging_info.more_available, kind);
    }
  }

  function absorbInstagramUserObject(userObj, baseMs, acc, fromProfileEndpoint) {
    if (!userObj || typeof userObj !== "object") return;
    const followersRaw = userObj.edge_followed_by?.count ?? userObj.follower_count;
    const postsRaw = userObj.edge_owner_to_timeline_media?.count ?? userObj.all_media_count ?? userObj.media_count;
    const hasMeta = nonNegativeCount(followersRaw) !== null || nonNegativeCount(postsRaw) !== null;
    if (hasMeta) {
      absorbProfileMeta(acc, followersRaw, postsRaw);
    }
    const cleanUser = sanitizeOwnerHandle(userObj.username, "instagram");
    if (cleanUser) {
      absorbProfileUsername(acc, cleanUser, "instagram");
    }
    if (fromProfileEndpoint || hasMeta || cleanUser) {
      absorbFeedKind(acc, "profile");
    }
    if (userObj.edge_owner_to_timeline_media) {
      absorbInstagramConnection(userObj.edge_owner_to_timeline_media, null, baseMs, acc, "timeline");
    }
    if (userObj.edge_felix_video_timeline) {
      absorbInstagramConnection(userObj.edge_felix_video_timeline, null, baseMs, acc, "timeline");
    }
    if (userObj.polaris_ordered_timeline_connection) {
      absorbInstagramConnection(userObj.polaris_ordered_timeline_connection, null, baseMs, acc, "timeline");
    }
    if (userObj.polaris_clips_connection) {
      absorbInstagramConnection(userObj.polaris_clips_connection, "reels", baseMs, acc, "clips");
    }
  }

  function extractInstagramFromObject(obj, endpoint, baseMs, acc) {
    if (!obj || typeof obj !== "object") return;

    if (obj.data && typeof obj.data === "object") {
      for (const key of Object.keys(obj.data)) {
        const val = obj.data[key];
        if (!val || typeof val !== "object") continue;
        if (/^xdt_api__v1__feed__user_timeline/i.test(key) || key === "polaris_ordered_timeline_connection") {
          absorbInstagramConnection(val, null, baseMs, acc, "timeline");
        } else if (/^xdt_api__v1__clips__user/i.test(key) || key === "polaris_clips_connection") {
          absorbInstagramConnection(val, "reels", baseMs, acc, "clips");
        } else if (key === "user" || key === "xig_user_by_username") {
          absorbInstagramUserObject(val, baseMs, acc, endpoint === "ig_web_profile_info");
        } else if (
          key === "node" &&
          (val.polaris_ordered_timeline_connection ||
            val.polaris_clips_connection ||
            val.edge_owner_to_timeline_media ||
            val.edge_felix_video_timeline)
        ) {
          absorbInstagramUserObject(val, baseMs, acc, false);
        } else if (/^xdt_api__v1__users__.*profile/i.test(key)) {
          absorbInstagramUserObject(val.user && typeof val.user === "object" ? val.user : val, baseMs, acc, true);
        }
      }
    }

    if (endpoint === "ig_feed_user" || endpoint === "ig_clips_user" || endpoint === "ig_web_profile_info") {
      const defaultType = endpoint === "ig_clips_user" ? "reels" : null;
      const listKind = endpoint === "ig_clips_user" ? "clips" : "timeline";
      if (Array.isArray(obj.items)) {
        absorbFeedKind(acc, listKind);
        for (const entry of obj.items) {
          pushItem(acc, "instagram", normalizeInstagramMediaNode(entry, defaultType, baseMs));
        }
      }
      if (typeof obj.more_available === "boolean") {
        absorbFeedKind(acc, listKind);
        recordHasNextPage(acc, obj.more_available, listKind);
      } else if (typeof obj.paging_info?.more_available === "boolean") {
        absorbFeedKind(acc, listKind);
        recordHasNextPage(acc, obj.paging_info.more_available, listKind);
      }
      if (obj.user && typeof obj.user === "object") {
        absorbInstagramUserObject(obj.user, baseMs, acc, endpoint === "ig_web_profile_info");
      }
    }
  }

  function normalizeTikTokItem(rawItem, baseMs, acc) {
    if (!rawItem || typeof rawItem !== "object") return null;
    const id = typeof rawItem.id === "string" || typeof rawItem.id === "number" ? String(rawItem.id).trim() : "";
    if (!/^\d{10,22}$/.test(id)) return null;

    const authorRaw =
      typeof rawItem.author === "string"
        ? rawItem.author
        : typeof rawItem.author?.uniqueId === "string"
          ? rawItem.author.uniqueId
          : typeof rawItem.authorUniqueId === "string"
            ? rawItem.authorUniqueId
            : "";
    const ownerHandle = sanitizeOwnerHandle(authorRaw, "tiktok");
    if (!ownerHandle) return null;

    const isPhoto = Boolean(
      (rawItem.imagePost && (typeof rawItem.imagePost === "object" || rawItem.imagePost === true)) ||
        (rawItem.image_post_info && typeof rawItem.image_post_info === "object") ||
        rawItem.aweme_type === 150,
    );
    const pathKind = isPhoto ? "photo" : "video";
    const postType = isPhoto ? "carousel" : "tiktok_video";
    const sourceUrl = `https://www.tiktok.com/@${ownerHandle}/${pathKind}/${id}`;

    const postedAt =
      epochToIso(rawItem.createTime, MIN_TIKTOK_EPOCH_MS, baseMs) ?? tiktokTimestampFromId(id, baseMs);

    const rawDesc =
      (typeof rawItem.desc === "string" && rawItem.desc.trim() ? rawItem.desc : "") ||
      (typeof rawItem.contents?.[0]?.desc === "string" && rawItem.contents[0].desc.trim() ? rawItem.contents[0].desc : "") ||
      (typeof rawItem.imagePost?.title === "string" && rawItem.imagePost.title.trim() ? rawItem.imagePost.title : "") ||
      (typeof rawItem.image_post_info?.title === "string" && rawItem.image_post_info.title.trim()
        ? rawItem.image_post_info.title
        : "");

    const imageUrl =
      firstValidHttpsUrl(rawItem.imagePost?.cover?.imageURL?.urlList) ||
      firstValidHttpsUrl(rawItem.imagePost?.images?.[0]?.imageURL?.urlList) ||
      firstValidHttpsUrl(rawItem.image_post_info?.images?.[0]?.display_image?.url_list) ||
      validHttpsUrl(rawItem.video?.cover) ||
      validHttpsUrl(rawItem.video?.originCover) ||
      validHttpsUrl(rawItem.video?.dynamicCover) ||
      null;

    const stats = rawItem.stats && typeof rawItem.stats === "object" ? rawItem.stats : null;
    const statsV2 = rawItem.statsV2 && typeof rawItem.statsV2 === "object" ? rawItem.statsV2 : null;

    const authorStats =
      rawItem.authorStats && typeof rawItem.authorStats === "object"
        ? rawItem.authorStats
        : rawItem.authorStatsV2 && typeof rawItem.authorStatsV2 === "object"
          ? rawItem.authorStatsV2
          : null;
    if (authorStats && acc) {
      absorbProfileMeta(acc, authorStats.followerCount, authorStats.videoCount);
      absorbProfileUsername(acc, ownerHandle, "tiktok");
    }

    return {
      sourceUrl,
      postType,
      postedAt,
      caption: truncateGraphemeSafe(rawDesc, 2000),
      imageUrl,
      gridViews: nonNegativeCount(stats?.playCount) ?? nonNegativeCount(statsV2?.playCount),
      gridLikes: nonNegativeCount(stats?.diggCount) ?? nonNegativeCount(statsV2?.diggCount),
      gridComments: nonNegativeCount(stats?.commentCount) ?? nonNegativeCount(statsV2?.commentCount),
      gridShares: nonNegativeCount(stats?.shareCount) ?? nonNegativeCount(statsV2?.shareCount),
      ownerHandle,
    };
  }

  function extractTikTokFromObject(obj, endpoint, baseMs, acc) {
    if (!obj || typeof obj !== "object") return;
    const listCandidates = Array.isArray(obj.itemList)
      ? obj.itemList
      : Array.isArray(obj.data?.itemList)
        ? obj.data.itemList
        : null;

    if (listCandidates) {
      absorbFeedKind(acc, "timeline");
      for (const rawItem of listCandidates) {
        pushItem(acc, "tiktok", normalizeTikTokItem(rawItem, baseMs, acc));
      }
    }

    if (obj.itemInfo?.itemStruct && typeof obj.itemInfo.itemStruct === "object") {
      pushItem(acc, "tiktok", normalizeTikTokItem(obj.itemInfo.itemStruct, baseMs, acc));
    }

    if (obj.userInfo?.user?.uniqueId) {
      absorbProfileUsername(acc, obj.userInfo.user.uniqueId, "tiktok");
    }

    if (endpoint === "tt_post_item_list" || endpoint === "tt_creator_item_list" || listCandidates !== null) {
      if (typeof obj.hasMore === "boolean") {
        absorbFeedKind(acc, "timeline");
        recordHasNextPage(acc, obj.hasMore, "timeline");
      } else if (typeof obj.has_more === "boolean") {
        absorbFeedKind(acc, "timeline");
        recordHasNextPage(acc, obj.has_more, "timeline");
      }
    }
  }

  function revalidateCleanItem(raw, platform, baseMs) {
    if (!raw || typeof raw !== "object") return null;
    const urlStr = validHttpsUrl(raw.sourceUrl);
    if (!urlStr) return null;
    if (platform === "instagram") {
      if (!/^https:\/\/www\.instagram\.com\/(?:[A-Za-z0-9._]{1,30}\/)?(?:p|reel)\/[A-Za-z0-9_-]+\/$/.test(urlStr)) {
        return null;
      }
    } else if (platform === "tiktok") {
      if (!/^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._-]+\/(?:video|photo)\/\d{10,22}$/.test(urlStr)) {
        return null;
      }
    } else {
      return null;
    }

    const allowedTypes = platform === "instagram" ? new Set(["feed", "reels", "carousel"]) : new Set(["tiktok_video", "carousel"]);
    const postType = typeof raw.postType === "string" && allowedTypes.has(raw.postType)
      ? raw.postType
      : platform === "tiktok"
        ? urlStr.includes("/photo/")
          ? "carousel"
          : "tiktok_video"
        : urlStr.includes("/reel/")
          ? "reels"
          : "feed";

    const minEpoch = platform === "tiktok" ? MIN_TIKTOK_EPOCH_MS : MIN_IG_EPOCH_MS;
    return {
      sourceUrl: urlStr,
      postType,
      postedAt: epochToIso(raw.postedAt, minEpoch, baseMs),
      caption: truncateGraphemeSafe(typeof raw.caption === "string" ? raw.caption : "", 2000),
      imageUrl: validHttpsUrl(raw.imageUrl),
      gridViews: nonNegativeCount(raw.gridViews),
      gridLikes: nonNegativeCount(raw.gridLikes),
      gridComments: nonNegativeCount(raw.gridComments),
      gridShares: nonNegativeCount(raw.gridShares),
      ownerHandle: sanitizeOwnerHandle(raw.ownerHandle, platform),
    };
  }

  function extractFeedPayload(url, jsonData, platformHint, nowMs) {
    const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const match = matchFeedEndpoint(url, platformHint);
    if (!match.matched) {
      return {
        platform: platformHint === "instagram" || platformHint === "tiktok" ? platformHint : null,
        feedKind: null,
        profileUsername: null,
        items: [],
        hasNextPage: null,
        profileMeta: null,
        urlMatched: false,
      };
    }

    const objects = parseRawJsonObjects(jsonData);
    const acc = {
      byKey: new Map(),
      hasNextPage: null,
      timelineHasNextPage: null,
      clipsHasNextPage: null,
      profileMeta: null,
      profileUsername: null,
      kinds: new Set(),
    };

    for (const obj of objects) {
      if (obj && obj.__sanghyangCleanChunk === true) {
        if (typeof obj.feedKind === "string") {
          absorbFeedKind(acc, obj.feedKind);
        }
        if (typeof obj.profileUsername === "string") {
          absorbProfileUsername(acc, obj.profileUsername, match.platform);
        }
        if (Array.isArray(obj.items)) {
          for (const rawItem of obj.items) {
            pushItem(acc, match.platform, revalidateCleanItem(rawItem, match.platform, baseMs));
          }
        }
        if (typeof obj.hasNextPage === "boolean") {
          acc.hasNextPage = obj.hasNextPage;
        }
        if (obj.profileMeta && typeof obj.profileMeta === "object") {
          absorbProfileMeta(acc, obj.profileMeta.followers, obj.profileMeta.posts);
        }
        continue;
      }

      if (match.platform === "instagram") {
        extractInstagramFromObject(obj, match.endpoint, baseMs, acc);
      } else if (match.platform === "tiktok") {
        extractTikTokFromObject(obj, match.endpoint, baseMs, acc);
      }
    }

    const resolvedHasNext =
      acc.timelineHasNextPage !== null
        ? acc.timelineHasNextPage
        : acc.clipsHasNextPage !== null
          ? acc.clipsHasNextPage
          : acc.hasNextPage;

    return {
      platform: match.platform,
      feedKind: resolveFeedKind(acc.kinds),
      profileUsername: acc.profileUsername,
      items: Array.from(acc.byKey.values()),
      hasNextPage: resolvedHasNext,
      profileMeta: acc.profileMeta,
      urlMatched: true,
    };
  }

  function parseChunkEventDetail(detail, nowMs) {
    let raw = null;
    if (typeof detail === "string") {
      if (!detail || detail.length > MAX_JSON_CHARS) return null;
      try {
        raw = JSON.parse(detail);
      } catch {
        return null;
      }
    } else if (detail && typeof detail === "object") {
      raw = detail;
    }
    if (!raw || typeof raw !== "object") return null;

    const url = typeof raw.url === "string" ? raw.url : "";
    const platformHint = raw.platform === "instagram" || raw.platform === "tiktok" ? raw.platform : null;
    const payload = extractFeedPayload(url, raw, platformHint, nowMs);
    if (!payload.urlMatched) return null;

    return {
      platform: payload.platform,
      feedKind: payload.feedKind,
      profileUsername: payload.profileUsername,
      url: matchFeedEndpoint(url, platformHint).sanitizedUrl,
      pageHref: sanitizePageHref(typeof raw.pageHref === "string" ? raw.pageHref : ""),
      capturedAt: typeof raw.capturedAt === "number" && Number.isFinite(raw.capturedAt) ? raw.capturedAt : Date.now(),
      replayed: Boolean(raw.replayed),
      items: payload.items,
      hasNextPage: payload.hasNextPage,
      profileMeta: payload.profileMeta,
      urlMatched: true,
    };
  }

  function detectFeedErrorSignal(status, rawBody, platform) {
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

    const objects = parseRawJsonObjects(rawBody);
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
      const head = rawBody.slice(0, 4096);
      inspectText(head);
    }

    if (!isHttpError && !rateLimited && !requireLogin && !graphqlError) {
      return null;
    }

    return {
      httpStatus,
      rateLimited: Boolean(rateLimited),
      requireLogin: Boolean(requireLogin),
      graphqlError: Boolean(graphqlError),
    };
  }

  function parseSignalEventDetail(detail, nowMs) {
    const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    let raw = null;
    if (typeof detail === "string") {
      if (!detail || detail.length > MAX_JSON_CHARS) return null;
      try {
        raw = JSON.parse(detail);
      } catch {
        return null;
      }
    } else if (detail && typeof detail === "object") {
      raw = detail;
    }
    if (!raw || typeof raw !== "object") return null;

    const url = typeof raw.url === "string" ? raw.url : "";
    const platformHint = raw.platform === "instagram" || raw.platform === "tiktok" ? raw.platform : null;
    const match = matchFeedEndpoint(url, platformHint);
    if (!match.matched) return null;

    const httpStatus =
      typeof raw.httpStatus === "number" && Number.isFinite(raw.httpStatus) && raw.httpStatus >= 100 && raw.httpStatus <= 599
        ? Math.round(raw.httpStatus)
        : null;
    const rateLimited = Boolean(raw.rateLimited);
    const requireLogin = Boolean(raw.requireLogin);
    const graphqlError = Boolean(raw.graphqlError);
    const isHttpError =
      httpStatus !== null &&
      (httpStatus === 429 || httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || httpStatus >= 500);
    if (!isHttpError && !rateLimited && !requireLogin && !graphqlError) return null;

    return {
      __sanghyangCleanSignal: true,
      version: 1,
      platform: match.platform,
      url: match.sanitizedUrl,
      pageHref: sanitizePageHref(typeof raw.pageHref === "string" ? raw.pageHref : ""),
      capturedAt: typeof raw.capturedAt === "number" && Number.isFinite(raw.capturedAt) ? raw.capturedAt : baseMs,
      replayed: Boolean(raw.replayed),
      httpStatus,
      rateLimited,
      requireLogin,
      graphqlError,
    };
  }

  return {
    EVENT_CHUNK,
    EVENT_SIGNAL,
    EVENT_REPLAY_REQ,
    EVENT_RESET,
    MAX_BUFFER_CHUNKS,
    sanitizePageHref,
    matchFeedEndpoint,
    extractFeedPayload,
    parseChunkEventDetail,
    detectFeedErrorSignal,
    parseSignalEventDetail,
  };
});
