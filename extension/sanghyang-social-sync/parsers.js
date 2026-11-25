(function (root, factory) {
  const exportsObj = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exportsObj;
  }
  root.SanghyangParsers = exportsObj;
})(typeof globalThis !== "undefined" ? globalThis : self, function () {
  "use strict";

  const MONTHS_MAP = {
    jan: 0, januari: 0, january: 0,
    feb: 1, februari: 1, february: 1,
    mar: 2, maret: 2, march: 2,
    apr: 3, april: 3,
    mei: 4, may: 4,
    jun: 5, juni: 5, june: 5,
    jul: 6, juli: 6, july: 6,
    agu: 7, agt: 7, agustus: 7, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    okt: 9, oktober: 9, oct: 9, october: 9,
    nov: 10, november: 10,
    des: 11, desember: 11, dec: 11, december: 11,
  };

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

  function stableHashToken(input) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    const str = String(input || "");
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= c + i;
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }

  function parseHumanCount(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).replace(/\u00a0/g, " ").trim().toLowerCase();
    if (!text) return null;

    const unitMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(k|rb|ribu|m|jt|juta|b)\b/i);
    if (unitMatch) {
      const base = Number(unitMatch[1].replace(",", "."));
      if (!Number.isFinite(base) || base < 0) return null;
      const unit = unitMatch[2].toLowerCase();
      const mult = unit === "b" ? 1e9 : unit === "m" || unit === "jt" || unit === "juta" ? 1e6 : 1e3;
      return Math.round(base * mult);
    }

    const groupedMatch = text.match(/\b\d{1,3}(?:[.,]\d{3})+\b/);
    if (groupedMatch) {
      const parsed = Number(groupedMatch[0].replace(/[.,]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }

    const plainMatch = text.match(/\b\d+\b/);
    if (!plainMatch) return null;
    const num = Number(plainMatch[0]);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }

  function instagramShortcodeFromUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
    try {
      const parsed = new URL(rawUrl.trim());
      const host = parsed.hostname.toLowerCase();
      if (host !== "www.instagram.com" && host !== "instagram.com" && host !== "m.instagram.com") return null;
      const match = parsed.pathname.match(/^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel)\/([A-Za-z0-9_-]+)\/?$/);
      return match ? match[2] : null;
    } catch {
      return null;
    }
  }

  function canonicalizeSocialPostUrl(rawUrl, platform) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
    let parsed;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    const p = parsed.pathname;

    if (platform === "instagram") {
      if (host !== "www.instagram.com" && host !== "instagram.com" && host !== "m.instagram.com") return null;
      const match = p.match(/^\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reel)\/([A-Za-z0-9_-]+)\/?$/);
      if (!match) return null;
      const accountSeg = match[1] ? `${match[1]}/` : "";
      return `https://www.instagram.com/${accountSeg}${match[2]}/${match[3]}/`;
    }

    if (platform === "tiktok") {
      if (host !== "www.tiktok.com" && host !== "tiktok.com" && host !== "m.tiktok.com") return null;
      const match = p.match(/^\/(@[A-Za-z0-9._-]+)\/(video|photo)\/(\d+)\/?$/);
      if (!match) return null;
      return `https://www.tiktok.com/${match[1]}/${match[2]}/${match[3]}`;
    }

    return null;
  }

  const TIKTOK_MIN_EPOCH_MS = Date.UTC(2016, 0, 1);
  const TIKTOK_FUTURE_SKEW_MS = 5 * 60_000;

  function tiktokVideoIdFromUrl(rawUrlOrId) {
    if (typeof rawUrlOrId !== "string") return null;
    const trimmed = rawUrlOrId.trim();
    if (!trimmed) return null;
    if (/^\d{10,22}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(/\/(?:video|photo)\/(\d{10,22})(?:[/?#]|$)/);
    return m ? m[1] : null;
  }

  /**
   * 32 bit teratas ID video/photo TikTok 64-bit menyimpan Unix epoch (detik UTC) saat ID dibuat.
   * Dipakai sebagai sumber tanggal terverifikasi ketika DOM & createTime JSON kosong, dengan batas rentang wajar.
   */
  function tiktokTimestampFromVideoId(videoUrlOrId, nowMs) {
    if (typeof BigInt !== "function") return null;
    const idStr = tiktokVideoIdFromUrl(videoUrlOrId);
    if (!idStr || idStr.length < 16) return null;
    try {
      const sec = Number(BigInt(idStr) >> BigInt(32));
      const ms = sec * 1000;
      const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
      if (!Number.isFinite(ms) || ms < TIKTOK_MIN_EPOCH_MS || ms > baseMs + TIKTOK_FUTURE_SKEW_MS) {
        return null;
      }
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
  }

  function stripCommentPii(text, allowedHandles) {
    const allowed = new Set(
      (Array.isArray(allowedHandles) ? allowedHandles : [])
        .map((h) => String(h || "").replace(/^@/, "").trim().toLowerCase())
        .filter(Boolean),
    );
    const cleaned = stripLoneSurrogates(text)
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
      .replace(/(?:\+?62\s?|0)8[1-9](?:[0-9\-\s.]{6,14}\d)\b/g, "[telepon]")
      .replace(/(?:\+?62\s?|0)[2-9]\d{1,3}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, "[telepon]")
      .replace(/\b\d{13,19}\b/g, "[angka-pribadi]")
      .replace(/(?<![A-Za-z0-9._%+-])(?:@[A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)+/g, function (chain) {
        return chain.replace(/@([A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)/g, function (_, handle) {
          return allowed.has(handle.toLowerCase()) ? `@${handle}` : "@[pengguna]";
        });
      })
      .replace(/\s+/g, " ")
      .trim();
    return truncateGraphemeSafe(cleaned, 1500);
  }

  function detectSocialChallenge(signals) {
    const url = String(signals?.url || "").toLowerCase();
    const bodyText = String(signals?.bodyText || "").toLowerCase();
    const dialogText = String(signals?.dialogText || "").toLowerCase();
    const combinedText = dialogText ? `${bodyText}\n${dialogText}` : bodyText;
    const title = String(signals?.title || "").toLowerCase();
    const hasLoginForm = Boolean(signals?.hasLoginForm);
    const hasCaptchaDom = Boolean(signals?.hasCaptchaDom);
    const hasLoggedOutWall = Boolean(signals?.hasLoggedOutWall);
    const isIncognito = Boolean(signals?.isIncognito);

    const isInstagram = url.includes("instagram.com");
    const isTikTok = url.includes("tiktok.com");

    if (isIncognito) {
      return {
        blocked: true,
        kind: "incognito",
        reason:
          "Tab pekerja terbuka di mode Incognito sehingga tidak memiliki sesi login Instagram & TikTok (profil dibatasi ~12 postingan atau ditolak). Buka satu jendela Chrome biasa yang sudah login Instagram & TikTok, lalu klik Lanjutkan — atau klik Lewati Akun Ini.",
      };
    }

    if (
      /\bhttp error 403\b|\b403 forbidden\b|access to [^\s]+ was denied|you don't have authorization to view this page|akses ke [^\s]+ ditolak|anda tidak memiliki otorisasi|\bhttp error 429\b|\b429 too many requests\b|too many requests|terlalu banyak permintaan|\baccess denied\b/i.test(
        `${title}\n${combinedText}`
      )
    ) {
      return {
        blocked: true,
        kind: "error_page",
        reason: isTikTok
          ? "TikTok menolak akses sementara (HTTP 403 / pembatasan permintaan). Pastikan Chrome tidak berada di mode Incognito dan sudah masuk ke akun TikTok, lalu muat ulang tab tersebut dan tekan Lanjutkan — atau klik Lewati Akun Ini."
          : "Halaman media sosial menolak akses sementara (HTTP 403/429). Pastikan Anda memakai jendela Chrome biasa (bukan Incognito), muat ulang tab tersebut, lalu tekan Lanjutkan — atau klik Lewati Akun Ini.",
      };
    }

    if (hasCaptchaDom) {
      return {
        blocked: true,
        kind: "captcha",
        reason: isTikTok
          ? "TikTok menampilkan verifikasi CAPTCHA/puzzle pada tab Chrome. Selesaikan verifikasi langsung di tab Chrome tersebut lalu tekan Lanjutkan."
          : "Platform menampilkan pemeriksaan CAPTCHA keamanan. Selesaikan langsung di tab Chrome tersebut lalu tekan Lanjutkan.",
      };
    }

    if (
      url.includes("/accounts/login") ||
      url.includes("/challenge/") ||
      url.includes("/checkpoint/") ||
      url.includes("/two_factor/") ||
      (isTikTok && (url.includes("/login") || url.includes("/verify")))
    ) {
      const kind = url.includes("/challenge/") || url.includes("/checkpoint/") || url.includes("/verify") ? "captcha" : "login";
      return {
        blocked: true,
        kind,
        reason:
          kind === "captcha"
            ? "Platform meminta verifikasi keamanan/tantangan. Selesaikan verifikasi di tab Chrome yang terbuka lalu tekan Lanjutkan."
            : "Sesi belum masuk atau diminta login ulang. Masuk terlebih dahulu di tab Chrome yang terbuka lalu tekan Lanjutkan.",
      };
    }

    if (
      combinedText.includes("slardarwaf") ||
      combinedText.includes("drag the slider") ||
      combinedText.includes("fit the puzzle") ||
      combinedText.includes("slide to complete the puzzle") ||
      combinedText.includes("puzzle verification") ||
      combinedText.includes("seret penggeser") ||
      combinedText.includes("selesaikan teka-teki") ||
      combinedText.includes("geser untuk menyelesaikan") ||
      combinedText.includes("verify to continue") ||
      combinedText.includes("verifikasi untuk melanjutkan") ||
      combinedText.includes("confirm you're not a robot")
    ) {
      return {
        blocked: true,
        kind: "captcha",
        reason: "Verifikasi puzzle/CAPTCHA terdeteksi pada halaman. Selesaikan di tab Chrome yang terbuka lalu tekan Lanjutkan.",
      };
    }

    // Instagram 2026 tanpa sesi login (termasuk mode Incognito) memotong profil di ~12 postingan dengan banner
    // "Show more posts from ..." / "Tampilkan postingan lainnya dari ..." atau dialog "See photos, videos and more" /
    // "Lihat foto, video, dan banyak lagi" tanpa menampilkan <input name="username">.
    const igGuestWall =
      isInstagram &&
      (hasLoggedOutWall ||
        /see photos,?\s*videos and more from|sign up and never miss a post|show more posts from|log in to see more|tampilkan postingan lainnya(?:\s+dari)?|lihat postingan lainnya(?:\s+dari)?|lihat foto,?\s*video,?\s*dan (?:banyak lagi|lainnya)|daftar dan jangan lewatkan postingan|daftar untuk melihat foto dan video|log in to see photos and videos|masuk untuk melihat foto dan video|masuk untuk melihat lebih banyak/i.test(
          combinedText
        ));
    if (igGuestWall) {
      return {
        blocked: true,
        kind: "login",
        reason:
          "Instagram membatasi tampilan profil hanya ~12 postingan karena tab Chrome belum login akun Instagram (atau terbuka di mode Incognito). Buka dashboard di jendela Chrome biasa yang sudah login Instagram, atau login di tab Chrome ini lalu klik Lanjutkan — atau klik Lewati Akun Ini.",
      };
    }

    if (
      hasLoginForm ||
      (isInstagram && (title.startsWith("login") || combinedText.includes("log in to continue") || combinedText.includes("masuk untuk melanjutkan"))) ||
      (isTikTok && (title.includes("log in") || combinedText.includes("log in to tiktok")))
    ) {
      return {
        blocked: true,
        kind: "login",
        reason: "Halaman meminta login akun media sosial. Silakan masuk di tab Chrome tersebut lalu tekan Lanjutkan.",
      };
    }

    return { blocked: false, kind: null, reason: null };
  }

  function resolveMonthDayYear(day, monthIdx, yearRaw, baseMs) {
    if (!Number.isFinite(day) || day < 1 || day > 31 || monthIdx < 0 || monthIdx > 11) return null;
    let year = yearRaw ? Number(yearRaw) : new Date(baseMs).getUTCFullYear();
    let candidate = Date.UTC(year, monthIdx, day, 5, 0, 0);
    if (!yearRaw && candidate > baseMs + 86_400_000) {
      year -= 1;
      candidate = Date.UTC(year, monthIdx, day, 5, 0, 0);
    }
    return Number.isFinite(candidate) ? new Date(candidate).toISOString() : null;
  }

  function parseSocialDateCore(raw, baseMs) {
    if (!raw) return null;

    if (/^\d{4}-\d{2}-\d{2}t/i.test(raw)) {
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    }
    const ymdMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymdMatch) {
      const yr = Number(ymdMatch[1]);
      const mo = Number(ymdMatch[2]);
      const dy = Number(ymdMatch[3]);
      if (yr >= 2000 && yr <= 2100 && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
        return resolveMonthDayYear(dy, mo - 1, yr, baseMs);
      }
      return null;
    }

    const mmDdMatch = raw.match(/^(\d{1,2})-(\d{1,2})$/);
    if (mmDdMatch) {
      return resolveMonthDayYear(Number(mmDdMatch[2]), Number(mmDdMatch[1]) - 1, null, baseMs);
    }

    const lower = raw.toLowerCase();
    if (/^(baru saja|just now|sekarang)$/.test(lower)) {
      return new Date(baseMs).toISOString();
    }

    const relMatch = lower.match(/^(\d+)\s*(dtk|detik|s|sec|secs|m|mnt|menit|min|mins|j|jam|h|hr|hrs|hari|d|day|days|mgg|minggu|w|wk|wks|bln|bulan|mo|mos|thn|tahun|y|yr|yrs)\b(?:\s+(?:yang\s+)?lalu|\s+ago)?$/i);
    if (relMatch) {
      const amount = Number(relMatch[1]);
      const unit = relMatch[2].toLowerCase();
      let ms = 0;
      if (["dtk", "detik", "s", "sec", "secs"].includes(unit)) ms = amount * 1000;
      else if (["m", "mnt", "menit", "min", "mins"].includes(unit)) ms = amount * 60_000;
      else if (["j", "jam", "h", "hr", "hrs"].includes(unit)) ms = amount * 3_600_000;
      else if (["hari", "d", "day", "days"].includes(unit)) ms = amount * 86_400_000;
      else if (["mgg", "minggu", "w", "wk", "wks"].includes(unit)) ms = amount * 7 * 86_400_000;
      else if (["bln", "bulan", "mo", "mos"].includes(unit)) ms = amount * 30 * 86_400_000;
      else ms = amount * 365 * 86_400_000;
      return new Date(baseMs - ms).toISOString();
    }

    const namedDateDM = lower.match(/^(\d{1,2})\s+([a-z]+)(?:,?\s+(\d{4}))?$/);
    if (namedDateDM && Object.prototype.hasOwnProperty.call(MONTHS_MAP, namedDateDM[2])) {
      return resolveMonthDayYear(Number(namedDateDM[1]), MONTHS_MAP[namedDateDM[2]], namedDateDM[3], baseMs);
    }

    const namedDateMD = lower.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
    if (namedDateMD && Object.prototype.hasOwnProperty.call(MONTHS_MAP, namedDateMD[1])) {
      return resolveMonthDayYear(Number(namedDateMD[2]), MONTHS_MAP[namedDateMD[1]], namedDateMD[3], baseMs);
    }

    return null;
  }

  function parseSocialDateText(rawText, nowMs) {
    if (typeof rawText !== "string" || !rawText.trim()) return null;
    const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const trimmed = rawText.replace(/^[\s·•\-]+|[\s·•\-]+$/g, "").trim();
    if (!trimmed) return null;

    const direct = parseSocialDateCore(trimmed, baseMs);
    if (direct) return direct;

    // TikTok 2026 sering menyatukan nama/handle dan tanggal dalam satu simpul ("sunsetgrill.sanghyang · 11-8" atau "Nama\n\n· 11-8").
    if (/[·•]/.test(rawText)) {
      const segments = rawText
        .split(/[·•]/)
        .map((seg) => seg.replace(/^[\s\-]+|[\s\-]+$/g, "").trim())
        .filter(Boolean);
      for (let i = segments.length - 1; i >= 0; i--) {
        const parsed = parseSocialDateCore(segments[i], baseMs);
        if (parsed) return parsed;
      }
    }

    return null;
  }

  function extractGridOverlayNumbers(anchor) {
    let explicitViews = null;
    const viewIcons = Array.from(
      anchor.querySelectorAll?.(
        'svg[aria-label*="View Count" i], svg[aria-label*="Play" i], svg[aria-label*="Tayangan" i], svg[aria-label*="Putar" i]',
      ) || [],
    );
    for (const icon of viewIcons) {
      let cur = icon.parentElement;
      for (let depth = 0; depth < 3 && cur && cur !== anchor; depth++) {
        const iconSpans = Array.from(cur.querySelectorAll?.("span") || []);
        for (const sp of iconSpans) {
          if (sp.querySelectorAll && sp.querySelectorAll("span").length > 0) continue;
          const t = (sp.textContent || "").trim();
          if (!t || t.length > 20 || !/^\d/.test(t)) continue;
          const n = parseHumanCount(t);
          if (n !== null) {
            explicitViews = n;
            break;
          }
        }
        if (explicitViews !== null) break;
        cur = cur.parentElement;
      }
      if (explicitViews !== null) break;
    }

    const spans = Array.from(anchor.querySelectorAll?.("span") || []);
    const rawVals = [];
    for (const sp of spans) {
      if (sp.querySelectorAll && sp.querySelectorAll("span").length > 0) continue;
      const t = (sp.textContent || "").trim();
      if (!t || t.length > 20) continue;
      const n = parseHumanCount(t);
      if (n !== null && /^\d/.test(t)) rawVals.push(n);
    }
    const dedup = [];
    for (let i = 0; i < rawVals.length; i++) {
      if (i % 2 === 1 && rawVals[i] === rawVals[i - 1]) continue;
      dedup.push(rawVals[i]);
    }
    if (dedup.length >= 3) {
      return { gridLikes: dedup[0], gridComments: dedup[1], gridViews: explicitViews ?? dedup[dedup.length - 1] };
    }
    if (dedup.length === 2) {
      if (explicitViews !== null) {
        const other = dedup[0] === explicitViews ? dedup[1] : dedup[0];
        return { gridLikes: other === explicitViews ? null : other, gridComments: null, gridViews: explicitViews };
      }
      return { gridLikes: dedup[0], gridComments: dedup[1], gridViews: null };
    }
    if (dedup.length === 1) {
      return { gridLikes: null, gridComments: null, gridViews: explicitViews ?? dedup[0] };
    }
    const text = (anchor.innerText || anchor.textContent || "").trim();
    const lines = text.split(/\n+/).map((x) => parseHumanCount(x)).filter((x) => x !== null);
    if (lines.length >= 3) {
      return { gridLikes: lines[0], gridComments: lines[1], gridViews: explicitViews ?? lines[lines.length - 1] };
    }
    if (lines.length === 2) {
      if (explicitViews !== null) {
        const other = lines[0] === explicitViews ? lines[1] : lines[0];
        return { gridLikes: other === explicitViews ? null : other, gridComments: null, gridViews: explicitViews };
      }
      return { gridLikes: lines[0], gridComments: lines[1], gridViews: null };
    }
    return { gridLikes: null, gridComments: null, gridViews: explicitViews ?? lines[0] ?? (text ? parseHumanCount(text) : null) };
  }

  const COUNT_TOKEN = "(\\d[\\d.,]*\\s*(?:[kmb]|rb|ribu|jt|juta)?)";
  const FOLLOWERS_RE = new RegExp(`${COUNT_TOKEN}\\s*(?:followers?|pengikut)\\b`, "i");
  const POSTS_RE = new RegExp(`${COUNT_TOKEN}\\s*(?:posts?|postingan|kiriman)\\b`, "i");

  function countFromTexts(texts, pattern) {
    for (const txt of texts) {
      const m = String(txt || "").match(pattern);
      if (!m) continue;
      const parsed = parseHumanCount(m[1]);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  function instagramFollowersFromDom(doc) {
    const followerLink = doc.querySelector?.('a[href*="/followers"]');
    if (!followerLink) return null;
    const titled = followerLink.querySelector?.("span[title]") || followerLink;
    const titleVal = titled.getAttribute?.("title") || "";
    const fromTitle = titleVal ? parseHumanCount(titleVal) : null;
    if (fromTitle !== null) return fromTitle;
    return parseHumanCount(followerLink.innerText || followerLink.textContent || "");
  }

  /**
   * Pengikut dan jumlah postingan profil Instagram. Jumlah postingan dipakai sebagai target gulir supaya sinkron
   * berhenti tepat di postingan paling awal; null bila profil tidak menuliskannya.
   */
  function extractInstagramProfileMeta(doc) {
    const metaTexts = ['meta[property="og:description"]', 'meta[name="description"]'].map(
      (sel) => doc.querySelector?.(sel)?.getAttribute?.("content") || "",
    );
    const headerTexts = Array.from(doc.querySelectorAll?.("header li, header span") || [])
      .map((node) => (node.innerText || node.textContent || "").trim())
      .filter((txt) => txt && txt.length <= 60);

    const followers = countFromTexts(metaTexts, FOLLOWERS_RE) ?? instagramFollowersFromDom(doc) ?? countFromTexts(headerTexts, FOLLOWERS_RE);
    const posts = countFromTexts(metaTexts, POSTS_RE) ?? countFromTexts(headerTexts, POSTS_RE);
    return { followers, posts };
  }

  const IG_GRID_EXCLUDED_ANCESTORS =
    '[role="dialog"], [role="alertdialog"], nav, header, footer, aside, [data-e2e="suggested"], [aria-label*="Suggested" i], [aria-label*="Disarankan" i], [aria-label*="More posts" i], [aria-label*="Postingan lainnya" i], [aria-label*="Related" i]';

  function extractInstagramProfileItems(doc, maxItems, targetHandle, allowedCollabHandles) {
    const limit = typeof maxItems === "number" && Number.isFinite(maxItems) && maxItems > 0 ? maxItems : Infinity;
    const expectedOwner = typeof targetHandle === "string" ? targetHandle.replace(/^@/, "").trim().toLowerCase() : "";
    const allowedOwners = new Set();
    if (expectedOwner) allowedOwners.add(expectedOwner);
    if (Array.isArray(allowedCollabHandles)) {
      for (const h of allowedCollabHandles) {
        const clean = typeof h === "string" ? h.replace(/^@/, "").trim().toLowerCase() : "";
        if (clean) allowedOwners.add(clean);
      }
    }

    // Pada halaman profil Instagram nyata, grid profil utama selalu berada di dalam <main>.
    // Terima seluruh postingan (termasuk kolaborasi eksternal /<partner>/(p|reel)/<code>/) di dalam grid <main>,
    // sambil mengecualikan modal, navigasi, header, footer, aside, dan bagian saran. Pertahankan filter handle ketat
    // bila dokumen bukan grid profil utama (misalnya /tagged/ atau dokumen tanpa <main>).
    const mainEl = typeof doc?.querySelector === "function" ? doc.querySelector("main") : null;
    const pathname = String(doc?.location?.pathname || "").toLowerCase();
    const isNonPrimaryGridPath =
      /\/(?:tagged|explore)\/?(?:$|\?)|^\/(?:[a-z0-9._]{1,30}\/)?(?:p|reel)\//i.test(pathname);
    const useMainProfileGrid = Boolean(mainEl) && !isNonPrimaryGridPath;
    const scopeRoot = useMainProfileGrid ? mainEl : doc;
    const links = Array.from(scopeRoot.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    const byKey = new Map();
    for (const anchor of links) {
      if (useMainProfileGrid && typeof anchor.closest === "function" && anchor.closest(IG_GRID_EXCLUDED_ANCESTORS)) {
        continue;
      }
      const href = anchor.getAttribute("href") || "";
      const fullUrl = href.startsWith("http") ? href : `https://www.instagram.com${href.startsWith("/") ? "" : "/"}${href}`;
      const canonical = canonicalizeSocialPostUrl(fullUrl, "instagram");
      if (!canonical) continue;
      if (!useMainProfileGrid && expectedOwner) {
        try {
          const seg0 = new URL(canonical).pathname.split("/").filter(Boolean)[0] || "";
          if (seg0 !== "p" && seg0 !== "reel" && !allowedOwners.has(seg0.toLowerCase())) continue;
        } catch {
          continue;
        }
      }
      const img = anchor.querySelector("img");
      const overlay = extractGridOverlayNumbers(anchor);
      const postType = canonical.includes("/reel/") ? "reels" : "feed";
      const gridViews = postType === "reels" ? overlay.gridViews : null;
      const dedupKey = instagramShortcodeFromUrl(canonical) || canonical;
      if (!byKey.has(dedupKey)) {
        byKey.set(dedupKey, {
          sourceUrl: canonical,
          postType,
          gridViews,
          gridLikes: overlay.gridLikes,
          gridComments: overlay.gridComments,
          imageUrl: img?.src && img.src.startsWith("https://") ? img.src : null,
        });
      }
      if (byKey.size >= limit) break;
    }
    return Array.from(byKey.values());
  }

  function parseInstagramMetaDescription(metaDesc) {
    const out = { likes: null, comments: null, caption: "" };
    if (typeof metaDesc !== "string" || !metaDesc.trim()) return out;
    const likesMatch = metaDesc.match(/^(\d[\d.,]*\s*(?:[km]|rb|ribu|jt|juta)?)\s+(?:likes?|suka)\b/i);
    if (likesMatch) out.likes = parseHumanCount(likesMatch[1]);
    const commentsMatch = metaDesc.match(/,\s*(\d[\d.,]*\s*(?:[km]|rb|ribu|jt|juta)?)\s+(?:comments?|komentar)\b/i);
    if (commentsMatch) out.comments = parseHumanCount(commentsMatch[1]);
    const colonIdx = metaDesc.indexOf(":");
    const rawCap = (colonIdx >= 0 ? metaDesc.slice(colonIdx + 1) : metaDesc).trim();
    out.caption = stripLoneSurrogates(rawCap.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+\.?\s*$/g, "").trim());
    return out;
  }

  function extractCountNearAriaIcon(doc, pattern) {
    const nodes = Array.from(doc.querySelectorAll("svg[aria-label], [aria-label]"));
    for (const el of nodes) {
      const label = el.getAttribute?.("aria-label") || "";
      if (!pattern.test(label)) continue;
      let cur = el.parentElement;
      for (let depth = 0; depth < 4 && cur; depth++) {
        if (cur.querySelectorAll && cur.querySelectorAll("svg[aria-label]").length > 1) break;
        const directSpans = Array.from(cur.querySelectorAll?.("span") || []);
        for (const sp of directSpans) {
          const t = (sp.textContent || "").trim();
          if (t && t.length <= 16 && /^\d[\d.,\s]*(?:[km]|rb|ribu|jt|juta)?$/i.test(t)) {
            const parsed = parseHumanCount(t);
            if (parsed !== null) return parsed;
          }
        }
        const whole = (cur.innerText || cur.textContent || "").trim();
        if (whole && whole.length <= 24 && /^\d/.test(whole)) {
          const parsed = parseHumanCount(whole);
          if (parsed !== null) return parsed;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  function extractInstagramComments(doc, postUrl, caption, allowedHandles, postedAt, nowMs) {
    const UI_WORDS = new Set(["like", "unlike", "suka", "reply", "balas", "see translation", "lihat terjemahan", "edited", "disunting"]);
    const comments = [];
    const seenComments = new Set();

    const pushComment = (rawText, authorHandle, commentAtRaw) => {
      const commentAt = parseSocialDateText(commentAtRaw || "", nowMs) || postedAt;
      if (!commentAt) return;
      let cleaned = stripLoneSurrogates(rawText);
      if (authorHandle) {
        const escaped = authorHandle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        cleaned = cleaned.replace(new RegExp(`^${escaped}\\b\\s*`, "i"), "");
      }
      cleaned = cleaned
        .replace(/\b(?:like|reply|balas|see translation|lihat terjemahan|view replies|lihat balasan(?:\s*\(\d+\))?)\b/gi, " ")
        .replace(/^\d+\s*(?:dtk|detik|s|m|mnt|j|jam|h|hari|d|mgg|w|bln|mo|thn|y)\b\s*/i, "");
      const text = stripCommentPii(cleaned, allowedHandles);
      if (!text || text.length < 3 || /^\d+$/.test(text) || UI_WORDS.has(text.toLowerCase())) return;
      if (caption && (text === caption || caption.startsWith(text))) return;
      const tokenKey = `${postUrl}:${commentAt.slice(0, 10)}:${text}`;
      if (seenComments.has(tokenKey)) return;
      seenComments.add(tokenKey);
      comments.push({ commentToken: stableHashToken(tokenKey), text, commentAt });
    };

    // 1. Legacy <ul><li> komentar bila ada
    const legacyNodes = Array.from(doc.querySelectorAll("article ul ul li, main ul ul li, [data-sanghyang-comment]"));
    for (const node of legacyNodes) {
      const timeNode = node.querySelector("time[datetime]") || node.querySelector("time");
      const dt = timeNode?.getAttribute("datetime") || timeNode?.textContent || "";
      const cloned = node.cloneNode ? node.cloneNode(true) : null;
      let rawText = "";
      if (cloned) {
        cloned.querySelectorAll?.("a[href], h2, h3, time, button").forEach((el) => el.remove());
        rawText = cloned.textContent || "";
      } else {
        rawText = node.textContent || "";
      }
      pushComment(rawText, "", dt);
    }

    // 2. React <div> modern Instagram (tautan komentar /c/<id>/ + <time datetime>)
    const commentAnchors = Array.from(doc.querySelectorAll('a[href*="/c/"]'));
    for (const cLink of commentAnchors) {
      const timeNode = cLink.querySelector?.("time[datetime]") || cLink.querySelector?.("time");
      const dt = timeNode?.getAttribute?.("datetime") || timeNode?.textContent || cLink.textContent || "";
      let container = cLink.parentElement;
      for (let d = 0; d < 5 && container; d++) {
        const subComments = container.querySelectorAll?.('a[href*="/c/"]') || [];
        if (subComments.length > 1) {
          container = container === cLink.parentElement ? container : null;
          break;
        }
        const authorLink = Array.from(container.querySelectorAll?.('a[href^="/"]') || []).find((a) => {
          const href = a.getAttribute("href") || "";
          return !href.includes("/c/") && !href.includes("/p/") && !href.includes("/reel/") && !href.includes("/explore/");
        });
        const spans = Array.from(container.querySelectorAll?.('span[dir="auto"], span') || [])
          .map((s) => (s.innerText || s.textContent || "").trim())
          .filter((t) => t.length >= 3 && !UI_WORDS.has(t.toLowerCase()) && !/^\d+[dhwmy]$/.test(t));
        const authorHandle = (authorLink?.textContent || "").trim();
        const bodyCandidates = spans.filter((t) => !authorHandle || t.toLowerCase() !== authorHandle.toLowerCase());
        if (authorLink && bodyCandidates.length > 0) {
          pushComment(bodyCandidates.join(" "), authorHandle, dt);
          break;
        }
        container = container.parentElement;
      }
    }

    return comments;
  }

  function extractInstagramPostDetail(doc, postUrl, gridStatsOrViews, allowedHandles, nowMs) {
    const canonical = canonicalizeSocialPostUrl(postUrl, "instagram");
    if (!canonical) return null;

    const gridStats =
      typeof gridStatsOrViews === "object" && gridStatsOrViews !== null
        ? {
            gridViews: gridStatsOrViews.gridViews ?? gridStatsOrViews.views ?? null,
            gridLikes: gridStatsOrViews.gridLikes ?? gridStatsOrViews.likes ?? null,
            gridComments: gridStatsOrViews.gridComments ?? gridStatsOrViews.comments ?? null,
          }
        : { gridViews: gridStatsOrViews, gridLikes: null, gridComments: null };

    const postCode = instagramShortcodeFromUrl(canonical);
    const timeEls = Array.from(doc.querySelectorAll("time[datetime]"));
    const isCommentTime = (t) => Boolean(t.closest?.('a[href*="/c/"], ul ul li, [data-sanghyang-comment]'));
    const isPermalinkTime = (t) => {
      if (isCommentTime(t)) return false;
      const a = t.closest?.('a[href*="/p/"], a[href*="/reel/"]');
      if (!a) return false;
      const href = a.getAttribute?.("href") || "";
      return !href.includes("/c/");
    };
    const exactCodeTime = postCode
      ? timeEls.find((t) => {
          if (!isPermalinkTime(t)) return false;
          const a = t.closest?.('a[href*="/p/"], a[href*="/reel/"]');
          return (a?.getAttribute?.("href") || "").includes(`/${postCode}`);
        }) || null
      : null;
    let postTimeEl = exactCodeTime || timeEls.find(isPermalinkTime) || null;
    if (!postTimeEl) {
      const nonCommentTimes = timeEls.filter((t) => !isCommentTime(t));
      if (nonCommentTimes.length <= 1) {
        postTimeEl = nonCommentTimes[0] || timeEls[0] || null;
      } else {
        // Komentar selalu ditulis setelah postingan; pilih stempel waktu paling awal di luar blok komentar.
        let earliestEl = nonCommentTimes[0];
        let earliestMs = Infinity;
        for (const t of nonCommentTimes) {
          const iso = parseSocialDateText(t.getAttribute("datetime") || t.textContent || "", nowMs);
          const ms = iso ? Date.parse(iso) : NaN;
          if (Number.isFinite(ms) && ms < earliestMs) {
            earliestMs = ms;
            earliestEl = t;
          }
        }
        postTimeEl = earliestEl;
      }
    }
    const postedAt = parseSocialDateText(postTimeEl?.getAttribute("datetime") || postTimeEl?.textContent || "", nowMs);

    const ogImg = doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || null;
    const domImg = doc.querySelector("article img[src], main img[src]")?.getAttribute("src") || null;
    const imageUrl = [ogImg, domImg].find((u) => typeof u === "string" && u.startsWith("https://")) || null;

    const h1Text = doc.querySelector("article h1, main h1")?.textContent || "";
    const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const parsedMeta = parseInstagramMetaDescription(metaDesc);
    const caption = stripLoneSurrogates(h1Text) || parsedMeta.caption;

    let likes = extractCountNearAriaIcon(doc, /^(like|unlike|suka)$/i);
    let views = typeof gridStats.gridViews === "number" && Number.isFinite(gridStats.gridViews) ? gridStats.gridViews : null;
    let commentsCount = extractCountNearAriaIcon(doc, /^(comment|komentar)$/i);
    const shares = extractCountNearAriaIcon(doc, /^(share|bagikan|repost)$/i);

    const statNodes = Array.from(doc.querySelectorAll('a[href*="/liked_by"] span, section span, article span'));
    for (const node of statNodes) {
      const txt = (node.textContent || "").trim();
      if (!txt || txt.length > 48) continue;
      if (/likes|suka/i.test(txt) && likes === null) {
        const parsed = parseHumanCount(txt);
        if (parsed !== null) likes = parsed;
      } else if (/views|plays|tayangan|ditayangkan/i.test(txt) && views === null) {
        const parsed = parseHumanCount(txt);
        if (parsed !== null) views = parsed;
      } else if (/comments|komentar/i.test(txt) && commentsCount === null) {
        const parsed = parseHumanCount(txt);
        if (parsed !== null) commentsCount = parsed;
      }
    }

    if (likes === null) likes = parsedMeta.likes !== null ? parsedMeta.likes : typeof gridStats.gridLikes === "number" ? gridStats.gridLikes : null;
    if (commentsCount === null) commentsCount = parsedMeta.comments !== null ? parsedMeta.comments : typeof gridStats.gridComments === "number" ? gridStats.gridComments : null;

    const comments = extractInstagramComments(doc, canonical, caption, allowedHandles, postedAt, nowMs);

    return {
      platform: "instagram",
      postType: canonical.includes("/reel/") ? "reels" : "feed",
      sourceUrl: canonical,
      postedAt,
      caption: truncateGraphemeSafe(caption, 2000),
      imageUrl,
      metrics: {
        views,
        likes,
        comments: commentsCount !== null ? commentsCount : comments.length > 0 ? comments.length : null,
        shares,
      },
      comments: comments.slice(0, 80),
    };
  }

  function readTikTokRehydrationScope(doc) {
    try {
      const raw = doc.querySelector?.("#__UNIVERSAL_DATA_FOR_REHYDRATION__")?.textContent;
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data?.__DEFAULT_SCOPE__ || null;
    } catch {
      return null;
    }
  }

  function readTikTokSigiState(doc) {
    try {
      const raw = doc.querySelector?.("#SIGI_STATE")?.textContent;
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const nonNegativeCount = (value) => {
    const num = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    return typeof num === "number" && Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
  };

  const TIKTOK_VIDEOS_RE = new RegExp(`${COUNT_TOKEN}\\s*(?:videos?|video)\\b`, "i");
  const TIKTOK_NOT_FOUND_RE =
    /tidak dapat menemukan akun ini|couldn['’]?t find this account|account not found|user not found|akun tidak ditemukan/i;
  const TIKTOK_EMPTY_PROFILE_RE =
    /\b(?:no content|no videos yet|this user has not published any videos|belum ada video|belum ada konten|pengguna ini belum mempublikasikan video)\b/i;

  /**
   * Pengikut, jumlah video (target gulir), status profil kosong nyata (`isEmptyProfile`), dan akun tidak ditemukan
   * (`notFound`, misalnya statusCode 10221) profil TikTok.
   */
  function extractTikTokProfileMeta(doc, targetHandle) {
    const expectedOwner = typeof targetHandle === "string" ? targetHandle.replace(/^@/, "").trim().toLowerCase() : "";
    const userDetail = readTikTokRehydrationScope(doc)?.["webapp.user-detail"] ?? null;
    const rehydratedHandle = String(userDetail?.userInfo?.user?.uniqueId || "")
      .replace(/^@/, "")
      .trim()
      .toLowerCase();
    // Jika SPA navigation TikTok menyisakan JSON rehydration akun sebelumnya, abaikan stats yang tidak cocok handle.
    const handleMatches = !expectedOwner || !rehydratedHandle || rehydratedHandle === expectedOwner;
    const userInfo = handleMatches ? (userDetail?.userInfo ?? null) : null;
    const stats = userInfo?.stats ?? null;
    const statsV2 = userInfo?.statsV2 ?? null;

    const sigi = readTikTokSigiState(doc);
    let sigiStats = null;
    if (sigi?.UserModule?.stats && typeof sigi.UserModule.stats === "object") {
      if (expectedOwner && sigi.UserModule.stats[expectedOwner]) {
        sigiStats = sigi.UserModule.stats[expectedOwner];
      } else {
        const key = Object.keys(sigi.UserModule.stats).find((k) => !expectedOwner || k.toLowerCase() === expectedOwner);
        if (key) sigiStats = sigi.UserModule.stats[key];
      }
    }

    const metaTexts = ['meta[name="description"]', 'meta[property="og:description"]'].map(
      (sel) => doc.querySelector?.(sel)?.getAttribute?.("content") || "",
    );
    const bodyText = String(doc?.body?.innerText || doc?.body?.textContent || "").slice(0, 4000);
    const statusCode = typeof userDetail?.statusCode === "number" ? userDetail.statusCode : null;
    const notFound =
      (handleMatches && (statusCode === 10221 || statusCode === 10202 || statusCode === 10222)) ||
      TIKTOK_NOT_FOUND_RE.test(bodyText);

    const followers =
      parseHumanCount(doc.querySelector?.('[data-e2e="followers-count"]')?.textContent || "") ??
      nonNegativeCount(stats?.followerCount) ??
      nonNegativeCount(statsV2?.followerCount) ??
      nonNegativeCount(sigiStats?.followerCount) ??
      countFromTexts(metaTexts, FOLLOWERS_RE);
    const posts =
      nonNegativeCount(stats?.videoCount) ??
      nonNegativeCount(statsV2?.videoCount) ??
      nonNegativeCount(sigiStats?.videoCount) ??
      countFromTexts(metaTexts, TIKTOK_VIDEOS_RE);
    const isEmptyProfile = !notFound && (posts === 0 || (posts === null && TIKTOK_EMPTY_PROFILE_RE.test(bodyText)));

    return { followers, posts, isEmptyProfile, notFound };
  }

  function mergeGridItem(prev, next) {
    const prevType = prev.postType;
    const nextType = next.postType;
    const postType =
      prevType === "reels" || nextType === "reels"
        ? "reels"
        : prevType === "carousel" || nextType === "carousel"
          ? "carousel"
          : prevType || nextType;
    const merged = {
      ...prev,
      postType,
      gridViews: prev.gridViews ?? next.gridViews ?? null,
      gridLikes: prev.gridLikes ?? next.gridLikes ?? null,
      gridComments: prev.gridComments ?? next.gridComments ?? null,
      imageUrl: prev.imageUrl ?? next.imageUrl ?? null,
    };
    if (prev.gridShares !== undefined || next.gridShares !== undefined) {
      merged.gridShares = prev.gridShares ?? next.gridShares ?? null;
    }
    const postedAt = prev.postedAt || next.postedAt || null;
    if (postedAt !== null || prev.postedAt !== undefined || next.postedAt !== undefined) {
      merged.postedAt = postedAt;
    }
    const prevCap = typeof prev.caption === "string" && prev.caption.trim().length > 0 ? prev.caption : null;
    const nextCap = typeof next.caption === "string" && next.caption.trim().length > 0 ? next.caption : null;
    if (prevCap || nextCap || prev.caption !== undefined || next.caption !== undefined) {
      merged.caption =
        prevCap ??
        nextCap ??
        (typeof prev.caption === "string" ? prev.caption : typeof next.caption === "string" ? next.caption : null);
    }
    if (prev.ownerHandle || next.ownerHandle) {
      merged.ownerHandle = prev.ownerHandle || next.ownerHandle;
    }
    if (prev.fromFeedTap || next.fromFeedTap) {
      merged.fromFeedTap = true;
    }
    return merged;
  }

  /**
   * Mengumpulkan item grid profil sambil menggulir sampai postingan paling awal. Item diserap kontinu di setiap
   * mutasi DOM & langkah gulir (`ctx.absorbNow()`) karena React virtualizer langsung me-unmount baris lama.
   * `stale` hanya bertambah saat kontainer sudah berada di batas bawah nyata (`atBottom`) atau gagal bergerak.
   * Bila mencapai batas bawah namun cakupan < 95% expected, menjalankan 1x `gapFillSweep` sebelum menyimpulkan.
   * Mendukung sinyal pagination resmi `getHasNextPage()` (`true | false | null`) dari passive feed-tap:
   * - `hasNextPage === true`: tambah kesabaran/osilasi dan `reachedBottom` WAJIB `false`.
   * - `hasNextPage === false`: selesai bersih dalam 2 putaran stale di batas bawah tanpa menunggu 7 putaran.
   * - Cakupan parah (`expected >= 50 && collected < floor(expected * 0.5)`): `reachedBottom` WAJIB `false`.
   */
  async function collectFeedItems(opts) {
    const limit = typeof opts.maxItems === "number" && opts.maxItems > 0 ? opts.maxItems : Infinity;
    const expected = typeof opts.expectedTotal === "number" && opts.expectedTotal > 0 ? opts.expectedTotal : null;
    const target = expected === null ? limit : Math.min(expected, limit);
    const staleLimit = Math.max(1, opts.staleRounds);
    const hasNextPageExtraRounds =
      typeof opts.hasNextPageExtraRounds === "number" && opts.hasNextPageExtraRounds >= 0
        ? opts.hasNextPageExtraRounds
        : 3;
    const minRateRounds =
      expected !== null && opts.minItemsPerRound > 0 ? Math.ceil(expected / opts.minItemsPerRound) + staleLimit : 0;
    const minMaxRounds = typeof opts.minMaxRounds === "number" && opts.minMaxRounds > 0 ? opts.minMaxRounds : 600;
    const maxRounds =
      expected === null
        ? opts.maxRoundsUnknown
        : Math.max(minMaxRounds, Math.ceil(expected * 2.5) + staleLimit + hasNextPageExtraRounds, minRateRounds);
    const isBlocked = typeof opts.isBlocked === "function" ? opts.isBlocked : () => false;
    const isRateLimited = typeof opts.isRateLimited === "function" ? opts.isRateLimited : () => false;
    const pacingEveryItems =
      typeof opts.pacingEveryItems === "number" && Number.isFinite(opts.pacingEveryItems) && opts.pacingEveryItems > 0
        ? Math.floor(opts.pacingEveryItems)
        : 0;
    const pacingDelayMs =
      typeof opts.pacingDelayMs === "number" && Number.isFinite(opts.pacingDelayMs) && opts.pacingDelayMs > 0
        ? Math.floor(opts.pacingDelayMs)
        : 0;
    const sleepFn = typeof opts.sleep === "function" ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
    const readHasNextPage = () => {
      if (typeof opts.getHasNextPage !== "function") return null;
      const val = opts.getHasNextPage();
      return typeof val === "boolean" ? val : null;
    };
    const defaultItemKey = (item) => {
      const u = item.sourceUrl;
      if (typeof u === "string" && !u.includes("?")) {
        const igCode = instagramShortcodeFromUrl(u);
        if (igCode) return `ig:${igCode}`;
        const ttId = tiktokVideoIdFromUrl(u);
        if (ttId) return `tt:${ttId}`;
      }
      return u;
    };
    const getItemKey = typeof opts.getItemKey === "function" ? opts.getItemKey : defaultItemKey;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

    const byUrl = new Map();
    let addedInCurrentRound = 0;
    const absorb = () => {
      let added = 0;
      for (const item of opts.collect() || []) {
        if (!item || !item.sourceUrl) continue;
        const key = getItemKey(item) || item.sourceUrl;
        const prev = byUrl.get(key);
        if (prev) {
          byUrl.set(key, mergeGridItem(prev, item));
        } else {
          byUrl.set(key, item);
          added++;
          addedInCurrentRound++;
        }
      }
      return added;
    };
    const hasNewItem = () => {
      for (const item of opts.collect() || []) {
        if (!item || !item.sourceUrl) continue;
        const key = getItemKey(item) || item.sourceUrl;
        if (!byUrl.has(key)) return true;
      }
      return false;
    };

    absorb();
    let rounds = 0;
    let stale = 0;
    let rateLimitedNoNewRounds = 0;
    let stoppedBy = null;
    let lastAtBottom = false;
    let lastHasSpinner = false;
    let lastHasNextPage = readHasNextPage();
    let nextPacingAt = pacingEveryItems > 0 && pacingDelayMs > 0 ? byUrl.size + pacingEveryItems : Infinity;
    if (onProgress) onProgress({ collected: byUrl.size, expected, rounds, hasNextPage: lastHasNextPage });

    while (stoppedBy === null) {
      const polledNext = readHasNextPage();
      if (typeof polledNext === "boolean") lastHasNextPage = polledNext;
      const currentlyRateLimited = Boolean(isRateLimited());
      const effectiveStaleLimit =
        lastHasNextPage === false && lastAtBottom && !lastHasSpinner
          ? Math.min(staleLimit, 2)
          : lastHasNextPage === true
            ? staleLimit + hasNextPageExtraRounds
            : staleLimit;

      if (byUrl.size >= target) stoppedBy = byUrl.size >= limit ? "limit" : "expected";
      else if (isBlocked()) stoppedBy = "blocked";
      else if (currentlyRateLimited && rateLimitedNoNewRounds >= 2) stoppedBy = "rate_limited";
      else if (stale >= effectiveStaleLimit) {
        stoppedBy = lastHasNextPage === false && lastAtBottom && !lastHasSpinner ? "end_of_feed" : "stale";
      } else if (rounds >= maxRounds) stoppedBy = "maxRounds";
      else {
        rounds++;
        addedInCurrentRound = 0;
        const advRes = await opts.advance({
          round: rounds,
          stale,
          collected: byUrl.size,
          expected,
          hasNextPage: lastHasNextPage,
          seenUrls: byUrl,
          hasNewItem,
          absorbNow: absorb,
        });
        absorb();
        if (advRes && typeof advRes.atBottom === "boolean") lastAtBottom = advRes.atBottom;
        if (advRes && typeof advRes.hasSpinner === "boolean") lastHasSpinner = advRes.hasSpinner;
        const afterNext = readHasNextPage();
        if (typeof afterNext === "boolean") lastHasNextPage = afterNext;
        else if (advRes && typeof advRes.hasNextPage === "boolean") lastHasNextPage = advRes.hasNextPage;

        if (addedInCurrentRound > 0) {
          stale = 0;
          rateLimitedNoNewRounds = 0;
        } else {
          if (isRateLimited()) {
            rateLimitedNoNewRounds++;
          } else {
            rateLimitedNoNewRounds = 0;
          }
          if (advRes && advRes.moved === true && advRes.wasAtBottom !== true) {
            // Masih melangkah bertahap menyusuri kontainer (belum mentok batas bawah); jangan naikkan stale.
          } else {
            stale++;
          }
        }
        if (onProgress) onProgress({ collected: byUrl.size, expected, rounds, hasNextPage: lastHasNextPage });
        if (
          addedInCurrentRound > 0 &&
          byUrl.size >= nextPacingAt &&
          byUrl.size < target &&
          !isBlocked() &&
          !isRateLimited()
        ) {
          nextPacingAt = byUrl.size + pacingEveryItems;
          await sleepFn(pacingDelayMs);
        }
      }
    }

    if (typeof opts.isAtBottom === "function") lastAtBottom = Boolean(opts.isAtBottom());
    if (typeof opts.hasSpinner === "function") lastHasSpinner = Boolean(opts.hasSpinner());
    const finalNextSignal = readHasNextPage();
    if (typeof finalNextSignal === "boolean") lastHasNextPage = finalNextSignal;

    let sweepRan = false;
    const shouldGapFillSweep =
      (stoppedBy === "stale" || stoppedBy === "end_of_feed") &&
      !isBlocked() &&
      !isRateLimited() &&
      lastAtBottom &&
      !lastHasSpinner &&
      expected !== null &&
      expected > 0 &&
      byUrl.size < Math.floor(expected * 0.95) &&
      byUrl.size < limit &&
      typeof opts.gapFillSweep === "function";

    if (shouldGapFillSweep) {
      sweepRan = true;
      await opts.gapFillSweep({
        absorbNow: absorb,
        isBlocked,
        collected: () => byUrl.size,
        expected,
        target,
        onProgress: () => {
          if (onProgress) onProgress({ collected: byUrl.size, expected, rounds, hasNextPage: lastHasNextPage });
        },
      });
      absorb();
      if (byUrl.size >= target) {
        stoppedBy = byUrl.size >= limit ? "limit" : "expected";
      } else if (isBlocked()) {
        stoppedBy = "blocked";
      }
      if (typeof opts.isAtBottom === "function") lastAtBottom = Boolean(opts.isAtBottom());
      if (typeof opts.hasSpinner === "function") lastHasSpinner = Boolean(opts.hasSpinner());
      const afterSweepNext = readHasNextPage();
      if (typeof afterSweepNext === "boolean") lastHasNextPage = afterSweepNext;
      if (onProgress) onProgress({ collected: byUrl.size, expected, rounds, hasNextPage: lastHasNextPage });
    }

    const finalRateLimited = Boolean(isRateLimited());
    const severeCoverageGap = expected !== null && expected >= 50 && byUrl.size < Math.floor(expected * 0.5);
    const reachedBottom =
      !isBlocked() &&
      stoppedBy !== "rate_limited" &&
      (stoppedBy === "expected" ||
        (!finalRateLimited &&
          !severeCoverageGap &&
          lastHasNextPage !== true &&
          !lastHasSpinner &&
          (stoppedBy === "end_of_feed" || (stoppedBy === "stale" && lastAtBottom))));

    const items = Array.from(byUrl.values());
    return {
      items: limit === Infinity ? items : items.slice(0, limit),
      rounds,
      expected,
      collected: byUrl.size,
      stoppedBy,
      reachedBottom,
      hasNextPage: lastHasNextPage,
      rateLimited: finalRateLimited,
      sweepRan,
    };
  }

  function firstHttpsUrl(candidates) {
    if (!Array.isArray(candidates)) return null;
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().startsWith("https://")) {
        return candidate.trim();
      }
    }
    return null;
  }

  function pickTikTokItemImageUrl(item) {
    if (!item || typeof item !== "object") return null;
    const candidates = [
      ...(Array.isArray(item.imagePost?.cover?.imageURL?.urlList) ? item.imagePost.cover.imageURL.urlList : []),
      ...(Array.isArray(item.imagePost?.images?.[0]?.imageURL?.urlList) ? item.imagePost.images[0].imageURL.urlList : []),
      ...(Array.isArray(item.image_post_info?.images?.[0]?.display_image?.url_list)
        ? item.image_post_info.images[0].display_image.url_list
        : []),
      item.video?.cover,
      item.video?.originCover,
      item.video?.dynamicCover,
    ];
    return firstHttpsUrl(candidates);
  }

  function tikTokCreateTimeToIso(createTime, baseMs) {
    if (createTime === undefined || createTime === null || createTime === "") return null;
    const rawNum = Number(createTime);
    if (!Number.isFinite(rawNum) || rawNum <= 0) return null;
    const ms = rawNum >= 1e11 ? rawNum : rawNum * 1000;
    if (!Number.isFinite(ms) || ms < TIKTOK_MIN_EPOCH_MS || ms > baseMs + TIKTOK_FUTURE_SKEW_MS) return null;
    return new Date(ms).toISOString();
  }

  function tikTokItemCaption(item) {
    if (!item || typeof item !== "object") return "";
    const desc = stripLoneSurrogates(typeof item.desc === "string" ? item.desc : "");
    if (desc) return desc;
    const contentDesc = stripLoneSurrogates(typeof item.contents?.[0]?.desc === "string" ? item.contents[0].desc : "");
    if (contentDesc) return contentDesc;
    const photoTitle = stripLoneSurrogates(
      typeof item.imagePost?.title === "string"
        ? item.imagePost.title
        : typeof item.image_post_info?.title === "string"
          ? item.image_post_info.title
          : "",
    );
    return photoTitle;
  }

  function extractTikTokProfileItems(doc, maxItems, targetHandle) {
    const limit = typeof maxItems === "number" && Number.isFinite(maxItems) && maxItems > 0 ? maxItems : Infinity;
    const expectedOwner = typeof targetHandle === "string" ? targetHandle.replace(/^@/, "").trim().toLowerCase() : "";
    const links = Array.from(doc.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]'));
    const byUrl = new Map();
    const pushItem = (candidate) => {
      if (!candidate || !candidate.sourceUrl) return;
      const prev = byUrl.get(candidate.sourceUrl);
      if (prev) {
        byUrl.set(candidate.sourceUrl, mergeGridItem(prev, candidate));
      } else if (byUrl.size < limit) {
        byUrl.set(candidate.sourceUrl, candidate);
      }
    };

    for (const anchor of links) {
      const href = anchor.getAttribute("href") || "";
      const fullUrl = href.startsWith("http") ? href : `https://www.tiktok.com${href.startsWith("/") ? "" : "/"}${href}`;
      const canonical = canonicalizeSocialPostUrl(fullUrl, "tiktok");
      if (!canonical) continue;
      if (expectedOwner) {
        try {
          const seg0 = (new URL(canonical).pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "").toLowerCase();
          if (seg0 && seg0 !== expectedOwner) continue;
        } catch {
          continue;
        }
      }
      const card = anchor.closest('[data-e2e="user-post-item"]') || anchor.parentElement || anchor;
      const viewsText = card?.querySelector?.('[data-e2e="video-views"]')?.textContent || "";
      const img = card?.querySelector?.("img");
      const postType = canonical.includes("/photo/") ? "carousel" : "tiktok_video";
      pushItem({
        sourceUrl: canonical,
        postType,
        gridViews: parseHumanCount(viewsText),
        imageUrl: img?.src && img.src.startsWith("https://") ? img.src : null,
      });
      if (byUrl.size >= limit) break;
    }

    // Tambahan item dari JSON rehydration / SIGI_STATE bila DOM baru merender sebagian.
    const scope = readTikTokRehydrationScope(doc);
    const sigi = readTikTokSigiState(doc);
    const jsonCandidates = [];
    const userItemList = scope?.["webapp.user-detail"]?.itemList;
    if (Array.isArray(userItemList)) jsonCandidates.push(...userItemList);
    if (scope?.ItemModule && typeof scope.ItemModule === "object") {
      jsonCandidates.push(...Object.values(scope.ItemModule));
    }
    if (sigi?.ItemModule && typeof sigi.ItemModule === "object") {
      jsonCandidates.push(...Object.values(sigi.ItemModule));
    }

    const nowMs = Date.now();
    for (const rawItem of jsonCandidates) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const id = String(rawItem.id || "").trim();
      if (!/^\d{10,22}$/.test(id)) continue;
      const authorRaw =
        typeof rawItem.author === "string"
          ? rawItem.author
          : String(rawItem.author?.uniqueId || rawItem.authorUniqueId || "");
      const authorHandle = authorRaw.replace(/^@/, "").trim() || expectedOwner;
      if (!authorHandle) continue;
      if (expectedOwner && authorHandle.toLowerCase() !== expectedOwner) continue;
      const isPhoto = Boolean(rawItem.imagePost || rawItem.image_post_info || rawItem.aweme_type === 150);
      const kind = isPhoto ? "photo" : "video";
      const canonical = canonicalizeSocialPostUrl(`https://www.tiktok.com/@${authorHandle}/${kind}/${id}`, "tiktok");
      if (!canonical) continue;
      const cover = pickTikTokItemImageUrl(rawItem);
      const caption = truncateGraphemeSafe(tikTokItemCaption(rawItem), 2000);
      const postedAt = tikTokCreateTimeToIso(rawItem.createTime, nowMs) || tiktokTimestampFromVideoId(id, nowMs);
      pushItem({
        sourceUrl: canonical,
        postType: kind === "photo" ? "carousel" : "tiktok_video",
        ...(postedAt ? { postedAt } : {}),
        ...(caption ? { caption } : {}),
        gridViews: nonNegativeCount(rawItem.stats?.playCount) ?? nonNegativeCount(rawItem.statsV2?.playCount),
        gridLikes: nonNegativeCount(rawItem.stats?.diggCount) ?? nonNegativeCount(rawItem.statsV2?.diggCount),
        gridComments: nonNegativeCount(rawItem.stats?.commentCount) ?? nonNegativeCount(rawItem.statsV2?.commentCount),
        gridShares: nonNegativeCount(rawItem.stats?.shareCount) ?? nonNegativeCount(rawItem.statsV2?.shareCount),
        imageUrl: cover,
        ownerHandle: authorHandle.toLowerCase(),
      });
      if (byUrl.size >= limit) break;
    }

    return Array.from(byUrl.values());
  }

  function readTikTokRehydrationItem(doc, expectedVideoId) {
    const matchesExpected = (candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      if (!expectedVideoId) return true;
      if (candidate.id === undefined || candidate.id === null || candidate.id === "") return true;
      return String(candidate.id) === expectedVideoId;
    };

    const scope = readTikTokRehydrationScope(doc);
    if (scope && typeof scope === "object") {
      const directKeys = [
        "webapp.video-detail",
        "webapp.photo-detail",
        "webapp.reflow.video.detail",
        "webapp.reflow.photo.detail",
        "webapp.item-detail",
      ];
      for (const key of directKeys) {
        const entry = scope[key];
        if (!entry || typeof entry !== "object") continue;
        const struct = entry.itemInfo?.itemStruct || entry.itemStruct || null;
        if (struct && matchesExpected(struct)) {
          return struct;
        }
      }

      // Pindai key dinamis pada __DEFAULT_SCOPE__ untuk varian Photo Mode TikTok 2026 tanpa mencampur ID lama.
      for (const [key, entry] of Object.entries(scope)) {
        if (!entry || typeof entry !== "object") continue;
        const struct = entry.itemInfo?.itemStruct || entry.itemStruct || null;
        if (struct && typeof struct === "object") {
          if (expectedVideoId) {
            if (struct.id && String(struct.id) === expectedVideoId) return struct;
          } else if (/detail|photo|video|item/i.test(key)) {
            return struct;
          }
        }
        if (expectedVideoId && Array.isArray(entry.itemList)) {
          const hit = entry.itemList.find((x) => x && typeof x === "object" && String(x.id || "") === expectedVideoId);
          if (hit) return hit;
        }
      }

      if (scope.ItemModule && typeof scope.ItemModule === "object") {
        if (expectedVideoId && scope.ItemModule[expectedVideoId]) {
          return scope.ItemModule[expectedVideoId];
        }
        if (!expectedVideoId) {
          const first = Object.values(scope.ItemModule)[0];
          if (first && typeof first === "object") return first;
        }
      }
    }

    const sigi = readTikTokSigiState(doc);
    if (sigi?.ItemModule && typeof sigi.ItemModule === "object") {
      if (expectedVideoId && sigi.ItemModule[expectedVideoId]) {
        return sigi.ItemModule[expectedVideoId];
      }
      if (!expectedVideoId) {
        const first = Object.values(sigi.ItemModule)[0];
        if (first && typeof first === "object") return first;
      }
    }
    return null;
  }

  function extractTikTokVideoDetail(doc, videoUrl, gridStatsOrViews, allowedHandles, nowMs) {
    const canonical = canonicalizeSocialPostUrl(videoUrl, "tiktok");
    if (!canonical) return null;

    const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    const expectedVideoId = tiktokVideoIdFromUrl(canonical);
    const gridViews = typeof gridStatsOrViews === "object" && gridStatsOrViews !== null ? gridStatsOrViews.gridViews : gridStatsOrViews;
    const item = readTikTokRehydrationItem(doc, expectedVideoId);

    const descEl = doc.querySelector(
      '[data-e2e="browse-video-desc"], [data-e2e="video-desc"], [data-e2e="photo-desc"], [data-e2e="browse-photo-desc"], [data-e2e="new-desc-span"], [data-e2e="detail-photo"] h1, [data-e2e="photo-mode-container"] h1',
    );
    const domDesc = stripLoneSurrogates((descEl?.textContent || "").replace(/\s*\n{2,}\s*/g, " "));
    const itemDesc = tikTokItemCaption(item);
    const caption = itemDesc || domDesc;

    const likeEl = doc.querySelector('[data-e2e="like-count"], [data-e2e="browse-like-count"], [data-e2e="photo-like-count"]');
    const commentEl = doc.querySelector(
      '[data-e2e="comment-count"], [data-e2e="browse-comment-count"], [data-e2e="photo-comment-count"]',
    );
    const shareEl = doc.querySelector(
      '[data-e2e="share-count"], [data-e2e="browse-share-count"], [data-e2e="photo-share-count"]',
    );
    const dateNode = doc.querySelector(
      '[data-e2e="browser-nickname"] span:last-child, [data-e2e="video-create-time"], [data-e2e="browser-nickname"]',
    );

    let domOrItemPostedAt = tikTokCreateTimeToIso(item?.createTime, baseMs);
    if (!domOrItemPostedAt) {
      domOrItemPostedAt = parseSocialDateText(dateNode?.textContent || "", baseMs);
    }
    if (!domOrItemPostedAt) {
      const headerTxt =
        doc.querySelector(
          '[data-e2e="recommend-list-item-container"], [data-e2e="feed-video"], [data-e2e="detail-photo"], [data-e2e="photo-mode-container"], [data-e2e="browse-photo"]',
        )?.textContent || "";
      const relHit = headerTxt.match(
        /[·•]\s*([0-9]+\s*(?:dtk|detik|s|sec|secs|m|mnt|menit|min|mins|j|jam|h|hr|hrs|hari|d|day|days|mgg|minggu|w|wk|wks|bln|bulan|mo|mos|thn|tahun|y|yr|yrs)(?:\s*(?:ago|(?:yang\s+)?lalu))?|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2})/i,
      );
      if (relHit) domOrItemPostedAt = parseSocialDateText(relHit[1], baseMs);
    }
    if (!domOrItemPostedAt) {
      const spans = Array.from(doc.querySelectorAll?.("span") || []);
      for (const sp of spans) {
        const txt = (sp?.textContent || "").trim();
        if (!txt || txt.length > 48 || !/[·•]/.test(txt)) continue;
        const parsed = parseSocialDateText(txt, baseMs);
        if (parsed) {
          domOrItemPostedAt = parsed;
          break;
        }
      }
    }

    const photoImgEl = doc.querySelector?.(
      '[data-e2e="detail-photo"] img[src], [data-e2e="photo-mode-container"] img[src], [data-e2e="browse-photo"] img[src], [data-e2e="photo-detail"] img[src], .swiper-slide img[src]',
    );
    const photoDomImg = firstHttpsUrl([photoImgEl?.getAttribute?.("src") || photoImgEl?.src || null]);
    const ogImg = firstHttpsUrl([
      doc.querySelector?.('meta[property="og:image"]')?.getAttribute?.("content") || null,
      pickTikTokItemImageUrl(item),
      photoDomImg,
    ]);

    const stats = item?.stats ?? null;
    const statsV2 = item?.statsV2 ?? null;
    const views =
      typeof gridViews === "number" && Number.isFinite(gridViews)
        ? gridViews
        : nonNegativeCount(stats?.playCount) ?? nonNegativeCount(statsV2?.playCount);
    const likes =
      parseHumanCount(likeEl?.textContent) ??
      nonNegativeCount(stats?.diggCount) ??
      nonNegativeCount(statsV2?.diggCount);
    const commentsCount =
      parseHumanCount(commentEl?.textContent) ??
      nonNegativeCount(stats?.commentCount) ??
      nonNegativeCount(statsV2?.commentCount);
    const shares =
      parseHumanCount(shareEl?.textContent) ??
      nonNegativeCount(stats?.shareCount) ??
      nonNegativeCount(statsV2?.shareCount);

    const commentBlocks = Array.from(doc.querySelectorAll('[data-e2e="comment-level-1"], [data-sanghyang-comment]'));

    // ZERO-FALLBACK: jika halaman error/403 tidak memuat JSON rehydration maupun DOM video/photo, jangan fabrikasi postingan kosong.
    if (
      !item &&
      !caption &&
      !domOrItemPostedAt &&
      !photoDomImg &&
      likes === null &&
      commentsCount === null &&
      shares === null &&
      commentBlocks.length === 0
    ) {
      return null;
    }

    // Sumber tanggal terverifikasi dari 32 bit atas Snowflake ID 64-bit ketika DOM & createTime kosong.
    const postedAt = domOrItemPostedAt || tiktokTimestampFromVideoId(canonical, baseMs);

    const comments = [];
    const seen = new Set();
    commentBlocks.forEach((block) => {
      const parentCard = block.closest('[data-e2e="comment-item"]') || block.parentElement || block;
      const timeText = parentCard?.querySelector?.('[data-e2e="comment-time-1"], [data-e2e="comment-time"]')?.textContent || "";
      const commentAt = parseSocialDateText(timeText, baseMs) || postedAt || new Date(baseMs).toISOString();
      const rawText = block.textContent || "";
      const text = stripCommentPii(rawText, allowedHandles);
      if (!text || text.length < 3) return;
      const tokenKey = `${canonical}:${commentAt.slice(0, 10)}:${text}`;
      if (seen.has(tokenKey)) return;
      seen.add(tokenKey);
      comments.push({
        commentToken: stableHashToken(tokenKey),
        text,
        commentAt,
      });
    });

    const isPhotoPost = canonical.includes("/photo/") || Boolean(item?.imagePost || item?.image_post_info || item?.aweme_type === 150);

    return {
      platform: "tiktok",
      postType: isPhotoPost ? "carousel" : "tiktok_video",
      sourceUrl: canonical,
      postedAt,
      caption: truncateGraphemeSafe(caption, 2000),
      imageUrl: ogImg,
      metrics: {
        views,
        likes,
        comments: commentsCount !== null ? commentsCount : comments.length > 0 ? comments.length : null,
        shares,
      },
      comments: comments.slice(0, 20),
    };
  }

  return {
    stripLoneSurrogates,
    truncateGraphemeSafe,
    parseHumanCount,
    instagramShortcodeFromUrl,
    canonicalizeSocialPostUrl,
    tiktokVideoIdFromUrl,
    tiktokTimestampFromVideoId,
    stripCommentPii,
    detectSocialChallenge,
    parseSocialDateText,
    extractInstagramProfileItems,
    extractInstagramProfileMeta,
    extractInstagramPostDetail,
    extractTikTokProfileItems,
    extractTikTokProfileMeta,
    readTikTokRehydrationItem,
    extractTikTokVideoDetail,
    collectFeedItems,
  };
});
