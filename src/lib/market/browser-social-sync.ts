import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadExtensionManifestInfo } from "@/lib/market/extension-zip";
import {
  evaluateSocialPromoPost,
  OFFICIAL_SOCIAL_ACCOUNTS,
  outletFromCaption,
  type OfficialSocialAccount,
  type SocialPostMetrics,
} from "@/lib/market/marketing-sosmed";
import { isOutletKey, OUTLET_PLACE_IDS, SOCIAL_POST_CATEGORY, type OutletKey } from "@/lib/market/outlet-filters";
import { OWN_SOCIAL_POST_CATEGORY } from "@/lib/market/promo-radar";
import { isVerifiedReviewSource } from "@/lib/market/resort-strategy";
import { createScrapeLog, sanitizeScrapeError } from "@/lib/market/scrape-log";
import { determineReviewSentiment, extractThemes } from "@/lib/market/scrape-new-reviews";
import { stripLoneSurrogates, truncateText } from "@/lib/text/safe-truncate";

export const MAX_POSTS_PER_SYNC_BATCH = 25;
export const MAX_COMMENTS_PER_POST = 30;
const OWN_PLACE_IDS = new Set<string>(Object.values(OUTLET_PLACE_IDS));
const FUTURE_SKEW_MS = 5 * 60_000;
const MIN_SOCIAL_EPOCH_MS = Date.UTC(2010, 0, 1);
const MIN_TIKTOK_EPOCH_MS = Date.UTC(2016, 0, 1);
const FALLBACK_START_DELTA_MS = 5_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IG_RESERVED_PATHS = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts", "directory"]);

const FORBIDDEN_SECRET_KEYS = new Set([
  "cookie",
  "cookies",
  "sessionid",
  "ds_user_id",
  "sid_tt",
  "token",
  "access_token",
  "authorization",
  "csrf",
  "csrftoken",
  "rawhtml",
  "innerhtml",
  "outerhtml",
]);

export class BrowserSyncValidationError extends Error {
  status = 422 as const;
}

export class BrowserSyncConflictError extends Error {
  status = 409 as const;
}

export interface BrowserSyncTarget {
  targetKey: string;
  targetType: "own" | "competitor";
  competitorId: string | null;
  outletKey: OutletKey | null;
  name: string;
  platform: "instagram" | "tiktok";
  handle: string;
  profileUrl: string;
}

export interface ValidatedBrowserComment {
  commentToken: string;
  text: string;
  commentAt: Date;
}

export interface ValidatedBrowserPost {
  targetType: "own" | "competitor";
  competitorId: string | null;
  outletKey: OutletKey | null;
  account: string | null;
  followers?: number | null;
  profilePostsTotal?: number | null;
  platform: "instagram" | "tiktok";
  postType: "reels" | "feed" | "carousel" | "tiktok_video" | "story";
  sourceUrl: string;
  postedAt: Date;
  postDateWritten: boolean;
  caption: string;
  imageUrl: string | null;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
  comments: ValidatedBrowserComment[];
}

export interface ValidatedBrowserSyncPayload {
  syncRunId: string | null;
  runStartedAt: Date | null;
  finalizeRun: boolean;
  posts: ValidatedBrowserPost[];
  errors: string[];
  pausedChallenge: { platform: "instagram" | "tiktok"; reason: string; url: string | null } | null;
}

export type ObservedPostMetrics = ValidatedBrowserPost["metrics"];

const finiteOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * Metrik postingan setelah sinkron ulang: angka yang terbaca kali ini menggantikan angka lama, sedangkan bidang yang
 * kali ini tidak terbaca (null, misalnya likes disembunyikan atau halaman belum selesai memuat) mempertahankan angka
 * terakhir, supaya sinkron postingan lama tidak menghapus views atau likes yang sudah tercatat.
 */
export function mergeObservedMetrics(
  previous: Partial<Record<keyof ObservedPostMetrics, unknown>> | null | undefined,
  next: ObservedPostMetrics,
): ObservedPostMetrics {
  return {
    views: next.views ?? finiteOrNull(previous?.views),
    likes: next.likes ?? finiteOrNull(previous?.likes),
    comments: next.comments ?? finiteOrNull(previous?.comments),
    shares: next.shares ?? finiteOrNull(previous?.shares),
  };
}

interface StoredPostDescription {
  outletKey?: unknown;
  postType?: unknown;
  account?: unknown;
  collabAccounts?: unknown;
  caption?: unknown;
  metrics?: Partial<Record<keyof SocialPostMetrics, unknown>> | null;
  followers?: unknown;
  profilePostsTotal?: unknown;
  postDateWritten?: unknown;
}

const PARENT_OFFICIAL_HANDLES = new Set(
  OFFICIAL_SOCIAL_ACCOUNTS.filter(
    (a) => (a.platform === "instagram" || a.platform === "tiktok") && a.outlets.length === 1 && a.outlets[0] === "resort",
  ).map((a) => `${a.platform}:${a.label.replace(/^@/, "").trim().toLowerCase()}`),
);

const SPECIFIC_OUTLET_OFFICIAL_HANDLES = new Set(
  OFFICIAL_SOCIAL_ACCOUNTS.filter(
    (a) => (a.platform === "instagram" || a.platform === "tiktok") && a.outlets.some((o) => o !== "resort"),
  ).map((a) => `${a.platform}:${a.label.replace(/^@/, "").trim().toLowerCase()}`),
);

const OFFICIAL_OUTLET_BY_HANDLE = new Map<string, OutletKey>(
  OFFICIAL_SOCIAL_ACCOUNTS.filter(
    (a) => (a.platform === "instagram" || a.platform === "tiktok") && a.outlets.some((o) => o !== "resort"),
  ).map((a) => [
    `${a.platform}:${a.label.replace(/^@/, "").trim().toLowerCase()}`,
    a.outlets.find((o) => o !== "resort") ?? "resort",
  ]),
);

const ALL_OFFICIAL_HANDLES = new Set([
  ...PARENT_OFFICIAL_HANDLES,
  ...SPECIFIC_OUTLET_OFFICIAL_HANDLES,
]);

function normalizeSocialHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().replace(/^@/, "").toLowerCase();
  return clean ? clean.slice(0, 80) : null;
}

/**
 * Mengekstrak shortcode Instagram (case-sensitive) dari permalink `/p/<CODE>/`, `/reel/<CODE>/`,
 * `/reels/<CODE>/`, maupun `/<handle>/(p|reel|reels)/<CODE>/`. Menolak jalur reserved Instagram sebagai handle.
 */
export function instagramShortcodeFromUrl(rawUrl: string | null | undefined): string | null {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (host !== "www.instagram.com" && host !== "instagram.com" && host !== "m.instagram.com") return null;
    const m = parsed.pathname.match(/^\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reels?)\/([A-Za-z0-9_-]+)\/?$/);
    if (!m) return null;
    if (m[1] && IG_RESERVED_PATHS.has(m[1].toLowerCase())) return null;
    return m[3];
  } catch {
    return null;
  }
}

/**
 * Mengekstrak tanggal tayang UTC dari 64-bit Snowflake ID pada URL video/photo TikTok
 * (`BigInt(id) >> 32n` = detik Unix). Mengembalikan null jika URL bukan TikTok atau di luar rentang wajar.
 */
export function tikTokPostedAtFromUrl(url: string, nowMs = Date.now()): Date | null {
  if (typeof url !== "string" || !url.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== "www.tiktok.com" && host !== "tiktok.com") return null;
  const match = parsed.pathname.match(/^\/@[A-Za-z0-9._-]+\/(?:video|photo)\/(\d+)\/?$/);
  if (!match) return null;
  try {
    const unixSeconds = Number(BigInt(match[1]) >> BigInt(32));
    if (!Number.isSafeInteger(unixSeconds)) return null;
    const ms = unixSeconds * 1000;
    if (!Number.isFinite(ms) || ms < MIN_TIKTOK_EPOCH_MS || ms > nowMs + FUTURE_SKEW_MS) return null;
    return new Date(ms);
  } catch {
    return null;
  }
}

/**
 * Menilai apakah baris postingan media sosial di DB sudah lengkap untuk dimasukkan ke `knownPostUrls`:
 * tanggal tayang sah (bukan fallback `now`) dan isi/metrik terverifikasi. Untuk Instagram, Reels/post lama
 * yang tidak menyertakan `views` atau caption tetap dianggap lengkap bila sudah memiliki sinyal isi, metrik,
 * atau `imageUrl` HTTPS; untuk TikTok video (`/video/`) tetap wajib caption dan `views`, sedangkan TikTok
 * Photo Mode (`/photo/`) boleh tanpa caption jika memiliki metrik atau `imageUrl` HTTPS.
 */
export function isCompleteKnownSocialPost(
  row: {
    sourceUrl: string | null;
    description: string | null;
    source: string;
    startsAt: Date;
    capturedAt?: Date | null;
    imageUrl?: string | null;
  },
  nowMs = Date.now(),
): boolean {
  if (!row.sourceUrl) return false;
  const desc = parseStoredPostDescription(row.description);
  if (!desc) return false;

  const isTikTok = row.source === "TikTok" || row.sourceUrl.includes("tiktok.com/");
  const startMs = row.startsAt instanceof Date ? row.startsAt.getTime() : Number.NaN;
  const minEpochMs = isTikTok ? MIN_TIKTOK_EPOCH_MS : MIN_SOCIAL_EPOCH_MS;
  if (!Number.isFinite(startMs) || startMs < minEpochMs || startMs > nowMs + FUTURE_SKEW_MS) return false;
  if (desc.postDateWritten === false) return false;
  if (row.capturedAt instanceof Date && Number.isFinite(row.capturedAt.getTime())) {
    if (Math.abs(startMs - row.capturedAt.getTime()) < FALLBACK_START_DELTA_MS) return false;
  }

  const caption = typeof desc.caption === "string" ? desc.caption.trim() : "";
  const views = finiteOrNull(desc.metrics?.views);
  const likes = finiteOrNull(desc.metrics?.likes);
  const comments = finiteOrNull(desc.metrics?.comments);
  const shares = finiteOrNull(desc.metrics?.shares);
  const hasImage = typeof row.imageUrl === "string" && row.imageUrl.trim().startsWith("https://");

  if (!isTikTok) {
    return Boolean(caption || likes !== null || views !== null || comments !== null || shares !== null || hasImage);
  }

  const isTikTokPhoto = row.sourceUrl.includes("/photo/") || desc.postType === "carousel";
  if (isTikTokPhoto) {
    return Boolean(caption || views !== null || likes !== null || comments !== null || shares !== null || hasImage);
  }

  if (!caption) return false;
  if (views === null) return false;
  return true;
}

/** Deskripsi JSON postingan yang sudah tersimpan; null bila deskripsinya teks kurasi biasa. */
function parseStoredPostDescription(description: string | null): StoredPostDescription | null {
  if (!description?.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(description) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredPostDescription) : null;
  } catch {
    // ZERO-FALLBACK: deskripsi JSON rusak diperlakukan seperti tanpa riwayat; bacaan baru tetap disimpan utuh.
    return null;
  }
}

export function profileHandleFromUrl(url: string | null | undefined, platform: "instagram" | "tiktok"): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (!seg) return null;
    if (platform === "tiktok") {
      return seg.startsWith("@") && seg.length > 1 ? seg.slice(1).toLowerCase() : null;
    }
    const clean = seg.replace(/^@/, "").toLowerCase();
    return clean && !IG_RESERVED_PATHS.has(clean) ? clean : null;
  } catch {
    return null;
  }
}

export function canonicalizeProfileUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== "https:") return rawUrl.trim();
    const host = u.hostname.toLowerCase();
    if (host === "instagram.com" || host === "m.instagram.com") {
      u.hostname = "www.instagram.com";
    } else if (
      host === "tiktok.com" ||
      host === "m.tiktok.com" ||
      host === "vm.tiktok.com" ||
      host === "vt.tiktok.com"
    ) {
      u.hostname = "www.tiktok.com";
    }
    return u.toString();
  } catch {
    return rawUrl.trim();
  }
}

export async function buildSocialSyncTargets(): Promise<{
  targets: BrowserSyncTarget[];
  allowedHandles: string[];
  knownPostUrls: string[];
  extensionId: string;
  extensionVersion: string;
}> {
  const { manifest, extensionId } = loadExtensionManifestInfo();
  const [rows, existingSocialRows] = await Promise.all([
    db.competitor.findMany({
      where: { active: true },
      select: { id: true, name: true, placeId: true, outlets: true, instagramUrl: true, tiktokUrl: true },
      orderBy: [{ compsetRole: "asc" }, { name: "asc" }],
    }),
    db.competitorPromotion.findMany({
      where: {
        category: { in: [OWN_SOCIAL_POST_CATEGORY, SOCIAL_POST_CATEGORY] },
        sourceUrl: { not: null },
      },
      select: { sourceUrl: true, description: true, source: true, startsAt: true, capturedAt: true, imageUrl: true },
      orderBy: { capturedAt: "desc" },
    }),
  ]);

  // Daftar URL postingan yang sudah tersimpan lengkap di DB lokal (punya caption, tanggal tayang sah, dan untuk
  // Reels/TikTok sudah punya views) dipakai ekstensi untuk melewati postingan lama (>12) saat sinkron ulang.
  const nowMs = Date.now();
  const seenSocialKeys = new Set<string>();
  const knownUrlSet = new Set<string>();
  for (const row of existingSocialRows) {
    if (!row.sourceUrl) continue;
    const dedupKey = instagramShortcodeFromUrl(row.sourceUrl) ?? row.sourceUrl;
    if (seenSocialKeys.has(dedupKey)) continue;
    seenSocialKeys.add(dedupKey);
    if (isCompleteKnownSocialPost(row, nowMs)) {
      knownUrlSet.add(row.sourceUrl);
    }
  }

  const ownIdByPlace = new Map<string, string>();
  for (const r of rows) {
    if (r.placeId && OWN_PLACE_IDS.has(r.placeId)) ownIdByPlace.set(r.placeId, r.id);
  }

  const targets: BrowserSyncTarget[] = [];
  const seenProfileUrls = new Set<string>();
  const handleSet = new Set<string>();

  const registerHandle = (h: string | null) => {
    if (h) handleSet.add(h.replace(/^@/, "").toLowerCase());
  };

  for (const acc of OFFICIAL_SOCIAL_ACCOUNTS as OfficialSocialAccount[]) {
    if (acc.platform !== "instagram" && acc.platform !== "tiktok") continue;
    const defaultOutlet: OutletKey = acc.outlets.find(isOutletKey) ?? "resort";
    const placeId = OUTLET_PLACE_IDS[defaultOutlet];
    const cleanHandle = acc.label.replace(/^@/, "");
    registerHandle(cleanHandle);
    const canonicalUrl = canonicalizeProfileUrl(acc.url);
    seenProfileUrls.add(canonicalUrl.toLowerCase());
    targets.push({
      targetKey: `own:${acc.platform}:${cleanHandle}`,
      targetType: "own",
      competitorId: ownIdByPlace.get(placeId) ?? ownIdByPlace.get(OUTLET_PLACE_IDS.resort) ?? null,
      outletKey: defaultOutlet,
      name: `${acc.owner} (${acc.label})`,
      platform: acc.platform,
      handle: cleanHandle,
      profileUrl: canonicalUrl,
    });
  }

  for (const r of rows) {
    if (r.placeId && OWN_PLACE_IDS.has(r.placeId)) continue;
    const outletKey = r.outlets.find(isOutletKey) ?? null;
    for (const [platform, rawUrl] of [
      ["instagram", r.instagramUrl],
      ["tiktok", r.tiktokUrl],
    ] as const) {
      if (!rawUrl) continue;
      const canonicalUrl = canonicalizeProfileUrl(rawUrl);
      if (seenProfileUrls.has(canonicalUrl.toLowerCase())) continue;
      const h = profileHandleFromUrl(canonicalUrl, platform);
      if (!h) continue;
      registerHandle(h);
      seenProfileUrls.add(canonicalUrl.toLowerCase());
      targets.push({
        targetKey: `comp:${r.id}:${platform}`,
        targetType: "competitor",
        competitorId: r.id,
        outletKey,
        name: r.name,
        platform,
        handle: h,
        profileUrl: canonicalUrl,
      });
    }
  }

  // Akun resmi Sanghyang dulu (Instagram lalu TikTok), baru akun kompetitor (Instagram lalu TikTok). Dulu semua Instagram
  // mendahului TikTok supaya puzzle verifikasi TikTok tidak menghalangi Instagram, tetapi tiap akun dibaca sampai postingan
  // paling awal, sehingga antrean jarang sampai ke TikTok dan akun TikTok resmi tidak pernah terbaca. Puzzle TikTok kini
  // paling cepat muncul sesudah akun Instagram resmi selesai.
  const queueRank = (t: BrowserSyncTarget) => (t.targetType === "own" ? 0 : 2) + (t.platform === "instagram" ? 0 : 1);
  targets.sort((a, b) => queueRank(a) - queueRank(b));

  return {
    targets,
    allowedHandles: [...handleSet],
    knownPostUrls: [...knownUrlSet],
    extensionId,
    extensionVersion: manifest.version,
  };
}

function assertNoForbiddenSecrets(value: unknown, depth = 0): void {
  if (depth > 5 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenSecrets(item, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SECRET_KEYS.has(k.toLowerCase())) {
      throw new BrowserSyncValidationError(`Bidang sensitif atau DOM mentah '${k}' ditolak.`);
    }
    assertNoForbiddenSecrets(v, depth + 1);
  }
}

export function stripCommentPiiServer(text: string, allowedHandles: Iterable<string>): string {
  const allowed = new Set([...allowedHandles].map((h) => h.replace(/^@/, "").trim().toLowerCase()).filter(Boolean));
  const scrubbed = stripLoneSurrogates(text)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]")
    .replace(/(?:\+?62\s?|0)8[1-9](?:[0-9\-\s.]{6,14}\d)\b/g, "[telepon]")
    .replace(/(?:\+?62\s?|0)[2-9]\d{1,3}[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, "[telepon]")
    .replace(/\b\d{13,19}\b/g, "[angka-pribadi]")
    .replace(/(?<![A-Za-z0-9._%+-])(?:@[A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)+/g, (chain) =>
      chain.replace(/@([A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?)/g, (_, handle: string) =>
        allowed.has(handle.toLowerCase()) ? `@${handle}` : "@[pengguna]",
      ),
    )
    .replace(/\s+/g, " ")
    .trim();
  return truncateText(scrubbed, 1500);
}

export function canonicalizeVerifiedSocialUrl(rawUrl: unknown, platform: "instagram" | "tiktok"): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new BrowserSyncValidationError("URL postingan media sosial wajib berupa string HTTPS.");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new BrowserSyncValidationError("URL postingan media sosial tidak valid.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new BrowserSyncValidationError("URL postingan wajib HTTPS tanpa kredensial.");
  }
  const canonical =
    platform === "instagram"
      ? (() => {
          const m = parsed.pathname.match(/^\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reels?)\/([A-Za-z0-9_-]+)\/?$/);
          if (!m || !["www.instagram.com", "instagram.com", "m.instagram.com"].includes(parsed.hostname.toLowerCase())) {
            return null;
          }
          if (m[1] && IG_RESERVED_PATHS.has(m[1].toLowerCase())) return null;
          const kind = m[2] === "p" ? "p" : "reel";
          return `https://www.instagram.com/${m[1] ? `${m[1].toLowerCase()}/` : ""}${kind}/${m[3]}/`;
        })()
      : (() => {
          const m = parsed.pathname.match(/^\/(@[A-Za-z0-9._-]+)\/(video|photo)\/(\d+)\/?$/);
          if (!m || !["www.tiktok.com", "tiktok.com", "m.tiktok.com"].includes(parsed.hostname.toLowerCase())) {
            return null;
          }
          return `https://www.tiktok.com/${m[1]}/${m[2]}/${m[3]}`;
        })();

  if (!canonical || !isVerifiedReviewSource(canonical)) {
    throw new BrowserSyncValidationError(`Tautan postingan bukan permalink ${platform} yang terverifikasi.`);
  }
  return canonical;
}

function parseNullableNonNegInt(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
    throw new BrowserSyncValidationError("Nilai metrik media sosial harus angka non-negatif atau null.");
  }
  return Math.round(val);
}

function parseSafePastDate(raw: unknown, nowMs: number): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") {
    throw new BrowserSyncValidationError("Tanggal media sosial harus string ISO-8601 atau null.");
  }
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts) || ts > nowMs + FUTURE_SKEW_MS) {
    throw new BrowserSyncValidationError("Tanggal media sosial tidak valid atau berada di masa depan.");
  }
  return new Date(ts);
}

function parseOptionalUuid(val: unknown, label: string): string | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val !== "string" || !UUID_RE.test(val.trim())) {
    throw new BrowserSyncValidationError(`${label} tidak valid (bukan UUID).`);
  }
  return val.trim();
}

export function sanitizeBrowserSyncPayload(raw: unknown, allowedHandles: Iterable<string>, now = new Date()): ValidatedBrowserSyncPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BrowserSyncValidationError("Payload sinkronisasi harus berupa objek JSON.");
  }
  assertNoForbiddenSecrets(raw);

  const body = raw as Record<string, unknown>;
  const nowMs = now.getTime();
  const postsRaw = Array.isArray(body.posts) ? body.posts : [];
  if (postsRaw.length > MAX_POSTS_PER_SYNC_BATCH) {
    throw new BrowserSyncValidationError(`Maksimal ${MAX_POSTS_PER_SYNC_BATCH} postingan per batch.`);
  }

  const posts: ValidatedBrowserPost[] = postsRaw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BrowserSyncValidationError("Setiap item postingan harus berupa objek.");
    }
    const p = item as Record<string, unknown>;
    const platform = p.platform === "instagram" || p.platform === "tiktok" ? p.platform : null;
    if (!platform) throw new BrowserSyncValidationError("Platform hanya mendukung instagram atau tiktok.");

    const targetType = p.targetType === "own" || p.targetType === "competitor" ? p.targetType : null;
    if (!targetType) throw new BrowserSyncValidationError("targetType harus own atau competitor.");

    const competitorId = parseOptionalUuid(p.competitorId, "competitorId");
    if (targetType === "competitor" && !competitorId) {
      throw new BrowserSyncValidationError("competitorId wajib diisi untuk postingan pembanding.");
    }

    const postType =
      p.postType === "reels" || p.postType === "feed" || p.postType === "carousel" || p.postType === "tiktok_video" || p.postType === "story"
        ? p.postType
        : platform === "tiktok"
          ? "tiktok_video"
          : "feed";

    const sourceUrl = canonicalizeVerifiedSocialUrl(p.sourceUrl, platform);
    const parsedDate = parseSafePastDate(p.postedAt, nowMs);
    const resolvedDate = parsedDate ?? (platform === "tiktok" ? tikTokPostedAtFromUrl(sourceUrl, nowMs) : null);
    const caption = truncateText(stripLoneSurrogates(typeof p.caption === "string" ? p.caption : ""), 2000);

    let imageUrl: string | null = null;
    if (typeof p.imageUrl === "string" && p.imageUrl.trim()) {
      try {
        const u = new URL(p.imageUrl.trim());
        if (u.protocol === "https:") imageUrl = u.toString().slice(0, 1000);
      } catch {
        imageUrl = null;
      }
    }

    const rawMetrics = p.metrics && typeof p.metrics === "object" && !Array.isArray(p.metrics) ? (p.metrics as Record<string, unknown>) : {};
    const commentsRaw = Array.isArray(p.comments) ? p.comments.slice(0, MAX_COMMENTS_PER_POST) : [];
    const comments: ValidatedBrowserComment[] = [];

    for (const c of commentsRaw) {
      if (!c || typeof c !== "object" || Array.isArray(c)) continue;
      const cm = c as Record<string, unknown>;
      const commentAt = parseSafePastDate(cm.commentAt, nowMs);
      if (!commentAt) continue; // Zero Mock: tolak komentar tanpa tanggal valid
      const cleanText = stripCommentPiiServer(typeof cm.text === "string" ? cm.text : "", allowedHandles);
      if (cleanText.length < 2) continue;
      const commentToken = truncateText(stripLoneSurrogates(typeof cm.commentToken === "string" ? cm.commentToken : ""), 80);
      comments.push({ commentToken, text: cleanText, commentAt });
    }

    return {
      targetType,
      competitorId,
      outletKey: isOutletKey(p.outletKey) ? p.outletKey : null,
      account: typeof p.account === "string" && p.account.trim() ? p.account.trim().replace(/^@/, "").slice(0, 80) : null,
      followers: parseNullableNonNegInt(p.followers),
      profilePostsTotal: parseNullableNonNegInt(p.profilePostsTotal),
      platform,
      postType,
      sourceUrl,
      postedAt: resolvedDate ?? now,
      postDateWritten: resolvedDate !== null,
      caption,
      imageUrl,
      metrics: {
        views: parseNullableNonNegInt(rawMetrics.views),
        likes: parseNullableNonNegInt(rawMetrics.likes),
        comments: parseNullableNonNegInt(rawMetrics.comments),
        shares: parseNullableNonNegInt(rawMetrics.shares),
      },
      comments,
    };
  });

  const errors = Array.isArray(body.errors)
    ? body.errors.filter((e): e is string => typeof e === "string").map((e) => sanitizeScrapeError(e)).slice(0, 50)
    : [];

  let pausedChallenge: ValidatedBrowserSyncPayload["pausedChallenge"] = null;
  if (body.pausedChallenge && typeof body.pausedChallenge === "object" && !Array.isArray(body.pausedChallenge)) {
    const ch = body.pausedChallenge as Record<string, unknown>;
    const chPlatform = ch.platform === "tiktok" ? "tiktok" : "instagram";
    pausedChallenge = {
      platform: chPlatform,
      reason: sanitizeScrapeError(String(ch.reason || "Membutuhkan login/verifikasi manusia")),
      url: typeof ch.url === "string" && /^https:\/\//.test(ch.url) ? ch.url.slice(0, 500) : null,
    };
  }

  return {
    syncRunId: parseOptionalUuid(body.syncRunId, "syncRunId"),
    runStartedAt: parseSafePastDate(body.runStartedAt, nowMs),
    finalizeRun: Boolean(body.finalizeRun),
    posts,
    errors,
    pausedChallenge,
  };
}

export function buildAnonymizedSocialExternalId(source: "Instagram" | "TikTok", postUrl: string, c: ValidatedBrowserComment): string {
  const dayKey = c.commentAt.toISOString().slice(0, 10);
  const fingerprint = c.commentToken ? c.commentToken : c.text.toLowerCase();
  const digest = crypto.createHash("sha256").update(`social:${source}:${postUrl}:${dayKey}:${fingerprint}`).digest("hex");
  return `social:${digest.slice(0, 28)}`;
}

type SocialDbClient = typeof db | Prisma.TransactionClient;

const SOCIAL_SYNC_LOCK_NAMESPACE = 20261125;

async function resolveCompetitorIdForOutlet(
  outletKey: OutletKey,
  client: SocialDbClient = db,
): Promise<string | null> {
  const placeId = OUTLET_PLACE_IDS[outletKey];
  const row = await client.competitor.findFirst({
    where: { placeId, active: true },
    select: { id: true },
  });
  if (row) return row.id;
  const fallbackRow = await client.competitor.findFirst({
    where: { placeId: OUTLET_PLACE_IDS.resort, active: true },
    select: { id: true },
  });
  return fallbackRow?.id ?? null;
}

/**
 * Mencari baris postingan media sosial yang sudah tersimpan: cocok berdasarkan `sourceUrl` persis maupun shortcode
 * Instagram yang sama agar variasi `/p/<CODE>/`, `/<target>/p/<CODE>/`, dan `/<collab>/p/<CODE>/` tidak menduplikasi baris.
 */
export async function findExistingSocialPromotion(
  params: {
    sourceUrl: string;
    platform: "instagram" | "tiktok";
    category?: string;
    competitorId?: string;
  },
  client: SocialDbClient = db,
) {
  const baseWhere: { category?: string; competitorId?: string } = {};
  if (params.category) baseWhere.category = params.category;
  if (params.competitorId) baseWhere.competitorId = params.competitorId;

  const shortcode = params.platform === "instagram" ? instagramShortcodeFromUrl(params.sourceUrl) : null;
  if (!shortcode) {
    return client.competitorPromotion.findFirst({
      where: { ...baseWhere, sourceUrl: params.sourceUrl },
      orderBy: [{ capturedAt: "desc" }, { version: "desc" }],
    });
  }

  const candidates = await client.competitorPromotion.findMany({
    where: {
      ...baseWhere,
      OR: [
        { sourceUrl: params.sourceUrl },
        { sourceUrl: { endsWith: `/p/${shortcode}/` } },
        { sourceUrl: { endsWith: `/reel/${shortcode}/` } },
        { sourceUrl: { endsWith: `/p/${shortcode}` } },
        { sourceUrl: { endsWith: `/reel/${shortcode}` } },
      ],
    },
    orderBy: [{ capturedAt: "desc" }, { version: "desc" }],
  });

  const matched = candidates.filter(
    (row) => row.sourceUrl === params.sourceUrl || instagramShortcodeFromUrl(row.sourceUrl) === shortcode,
  );
  return matched.find((row) => row.sourceUrl === params.sourceUrl) ?? matched[0] ?? null;
}

function mergeOwnPostIdentity(
  post: ValidatedBrowserPost,
  prevJson: StoredPostDescription | null,
  existingSourceUrl: string | null,
  effectiveCaption: string,
): {
  outletKey: OutletKey;
  account: string | null;
  collabAccounts: string[];
  postType: ValidatedBrowserPost["postType"];
  sourceUrl: string;
  followers: number | null;
  profilePostsTotal: number | null;
} {
  const prevOutletKey = isOutletKey(prevJson?.outletKey) ? prevJson.outletKey : null;
  const prevAccount = normalizeSocialHandle(prevJson?.account);
  const incomingAccount = normalizeSocialHandle(post.account);
  const urlHandle = profileHandleFromUrl(post.sourceUrl, post.platform);
  const urlOfficialKey = urlHandle ? `${post.platform}:${urlHandle}` : null;
  const urlOfficialOutlet = urlOfficialKey ? (OFFICIAL_OUTLET_BY_HANDLE.get(urlOfficialKey) ?? null) : null;
  const urlIsOfficialHandle = Boolean(urlOfficialKey && ALL_OFFICIAL_HANDLES.has(urlOfficialKey));

  const prevIsSpecific =
    prevAccount !== null && SPECIFIC_OUTLET_OFFICIAL_HANDLES.has(`${post.platform}:${prevAccount}`);
  const incomingIsSpecific =
    incomingAccount !== null && SPECIFIC_OUTLET_OFFICIAL_HANDLES.has(`${post.platform}:${incomingAccount}`);
  const incomingIsParent =
    incomingAccount !== null && PARENT_OFFICIAL_HANDLES.has(`${post.platform}:${incomingAccount}`);

  // Akun outlet khusus selalu menang atas akun induk; postingan kolaborasi yang sudah milik outlet spesifik
  // (atau URL pemiliknya adalah akun resmi outlet spesifik) tidak boleh mundur ke "resort" maupun tertimpa akun induk.
  let outletKey: OutletKey;
  if (post.outletKey && post.outletKey !== "resort") {
    outletKey = post.outletKey;
  } else if (prevOutletKey && prevOutletKey !== "resort") {
    outletKey = prevOutletKey;
  } else if (urlOfficialOutlet) {
    outletKey = urlOfficialOutlet;
  } else {
    outletKey = outletFromCaption(effectiveCaption);
  }

  let account: string | null;
  if (incomingIsSpecific) {
    account = incomingAccount;
  } else if (prevIsSpecific && (!incomingAccount || incomingIsParent)) {
    account = prevAccount;
  } else {
    account = incomingAccount ?? prevAccount;
  }

  const collabSet = new Set<string>();
  if (Array.isArray(prevJson?.collabAccounts)) {
    for (const raw of prevJson.collabAccounts) {
      const clean = normalizeSocialHandle(raw);
      if (clean && clean !== account) collabSet.add(clean);
    }
  }
  if (prevAccount && prevAccount !== account) collabSet.add(prevAccount);
  if (incomingAccount && incomingAccount !== account) collabSet.add(incomingAccount);
  if (urlIsOfficialHandle && urlHandle && urlHandle !== account) collabSet.add(urlHandle);
  const collabAccounts = [...collabSet].sort();

  const incomingMatchesAccount = !account || incomingAccount === account;
  const prevMatchesAccount = !account || prevAccount === account;
  const followers =
    (incomingMatchesAccount ? post.followers ?? null : null) ??
    (prevMatchesAccount ? finiteOrNull(prevJson?.followers) : null);
  const profilePostsTotal =
    (incomingMatchesAccount ? post.profilePostsTotal ?? null : null) ??
    (prevMatchesAccount ? finiteOrNull(prevJson?.profilePostsTotal) : null);

  const postType: ValidatedBrowserPost["postType"] =
    post.platform === "instagram" && prevJson?.postType === "reels" && post.postType === "feed"
      ? "reels"
      : post.postType;

  let sourceUrl = post.sourceUrl;
  if (existingSourceUrl) {
    if (!incomingMatchesAccount) {
      sourceUrl = existingSourceUrl;
    } else if (
      post.platform === "instagram" &&
      existingSourceUrl.includes("/reel/") &&
      post.sourceUrl.includes("/p/")
    ) {
      sourceUrl = existingSourceUrl;
    }
  }

  return {
    outletKey,
    account,
    collabAccounts,
    postType,
    sourceUrl,
    followers,
    profilePostsTotal,
  };
}

async function resolveActiveRun(syncRunId: string | null) {
  const log = createScrapeLog(db);
  if (syncRunId) {
    const existing = await db.scrapeRun.findUnique({ where: { id: syncRunId } });
    if (existing && !existing.finishedAt) {
      return { log, run: existing };
    }
  }
  const run = await log.startJobRun("social");
  return { log, run };
}

export async function persistBrowserSyncBatch(payload: ValidatedBrowserSyncPayload): Promise<{
  syncRunId: string;
  postsSaved: number;
  commentsInserted: number;
  commentsSkipped: number;
}> {
  const { log, run } = await resolveActiveRun(payload.syncRunId);
  let itemsFound = 0;
  let postsSaved = 0;
  let commentsInserted = 0;
  let commentsSkipped = 0;
  let batchErrors = 0;

  try {
    for (const post of payload.posts) {
      itemsFound += 1 + post.comments.length;
      const sourceLabel = post.platform === "tiktok" ? "TikTok" : "Instagram";
      let targetCompetitorId: string | null = post.competitorId;
      let commentSourceUrl = post.sourceUrl;

      if (post.targetType === "own") {
        const lockKey = `own:${post.platform}:${instagramShortcodeFromUrl(post.sourceUrl) ?? post.sourceUrl}`;
        const ownResult = await db.$transaction(async (tx) => {
          // Kunci transaksi per shortcode/URL mencegah dua tab browser menyisipkan baris ganda secara bersamaan.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SOCIAL_SYNC_LOCK_NAMESPACE}::int4, hashtext(${lockKey}))`;

          const existing = await findExistingSocialPromotion(
            {
              sourceUrl: post.sourceUrl,
              platform: post.platform,
              category: OWN_SOCIAL_POST_CATEGORY,
            },
            tx,
          );

          const prevJson = existing ? parseStoredPostDescription(existing.description) : null;
          const existingVersion = existing?.version ?? 1;
          const prevCaption = typeof prevJson?.caption === "string" ? prevJson.caption : "";
          const effectiveCaption = post.caption || prevCaption;

          const merged = mergeOwnPostIdentity(post, prevJson, existing?.sourceUrl ?? null, effectiveCaption);
          const ownCompetitorId = await resolveCompetitorIdForOutlet(merged.outletKey, tx);
          if (!ownCompetitorId) return null;

          // Chat WA diisi tim, bukan hasil sinkron, jadi selalu dipertahankan.
          const preservedWa = finiteOrNull(prevJson?.metrics?.inquiriesWa);
          const observed = mergeObservedMetrics(prevJson?.metrics, post.metrics);

          const hasAnyMetric = Object.values(observed).some((v) => v !== null) || preservedWa !== null;
          const metrics: SocialPostMetrics | null = hasAnyMetric ? { ...observed, inquiriesWa: preservedWa } : null;

          const effectiveStartAt = existing && !post.postDateWritten ? existing.startsAt : post.postedAt;
          const hasValidDate = post.postDateWritten || (existing ? prevJson?.postDateWritten !== false : false);
          const postedAtDay = effectiveStartAt.toISOString().slice(0, 10);
          const audit = evaluateSocialPromoPost({
            outletKey: merged.outletKey,
            platform: post.platform,
            postType: merged.postType,
            postedAt: postedAtDay,
            postUrl: merged.sourceUrl,
            caption: effectiveCaption,
            metrics,
          });

          const payloadDescription = JSON.stringify({
            outletKey: merged.outletKey,
            platform: post.platform,
            postType: merged.postType,
            caption: effectiveCaption,
            metrics,
            audit,
            ...(hasValidDate ? {} : { postDateWritten: false }),
            ...(merged.account ? { account: merged.account } : {}),
            ...(merged.collabAccounts.length > 0 ? { collabAccounts: merged.collabAccounts } : {}),
            ...(merged.followers !== null ? { followers: merged.followers } : {}),
            ...(merged.profilePostsTotal !== null ? { profilePostsTotal: merged.profilePostsTotal } : {}),
          });

          const titleSeed = effectiveCaption.replace(/\s+/g, " ").trim() || `${sourceLabel} (${postedAtDay})`;
          const title = `[${merged.postType.toUpperCase()}] ${truncateText(titleSeed, 80)}`;

          if (existing) {
            const updated = await tx.competitorPromotion.updateMany({
              where: { id: existing.id, version: existingVersion },
              data: {
                competitorId: ownCompetitorId,
                title,
                category: "Postingan Sosmed Tayang",
                description: payloadDescription,
                startsAt: effectiveStartAt,
                source: sourceLabel,
                sourceUrl: merged.sourceUrl,
                imageUrl: post.imageUrl ?? existing.imageUrl,
                capturedAt: new Date(),
                status: "changed",
                version: { increment: 1 },
              },
            });
            if (updated.count === 0) {
              throw new BrowserSyncConflictError("Konflik versi (OCC) saat memperbarui postingan Sanghyang.");
            }
          } else {
            await tx.competitorPromotion.create({
              data: {
                competitorId: ownCompetitorId,
                title,
                category: "Postingan Sosmed Tayang",
                description: payloadDescription,
                startsAt: effectiveStartAt,
                source: sourceLabel,
                sourceUrl: merged.sourceUrl,
                imageUrl: post.imageUrl,
                capturedAt: new Date(),
                status: "new",
                version: 1,
              },
            });
          }
          return { competitorId: ownCompetitorId, sourceUrl: merged.sourceUrl };
        });
        if (!ownResult) continue;
        targetCompetitorId = ownResult.competitorId;
        commentSourceUrl = ownResult.sourceUrl;
        postsSaved++;
      } else if (post.competitorId) {
        const compLockKey = `comp:${post.competitorId}:${post.platform}:${instagramShortcodeFromUrl(post.sourceUrl) ?? post.sourceUrl}`;
        const compResult = await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SOCIAL_SYNC_LOCK_NAMESPACE}::int4, hashtext(${compLockKey}))`;

          const comp = await tx.competitor.findFirst({
            where: { id: post.competitorId!, active: true },
            select: { id: true, outlets: true },
          });
          if (!comp) return null;

          const existing = await findExistingSocialPromotion(
            {
              sourceUrl: post.sourceUrl,
              platform: post.platform,
              competitorId: comp.id,
            },
            tx,
          );
          const now = new Date();

          const prevJson = existing ? parseStoredPostDescription(existing.description) : null;
          const prevCompCaption = typeof prevJson?.caption === "string" ? prevJson.caption : "";
          const effectiveCompCaption = post.caption || prevCompCaption;
          const firstLine = effectiveCompCaption
            ? truncateText(effectiveCompCaption.split("\n")[0]?.trim() || effectiveCompCaption, 90)
            : `Postingan ${sourceLabel}`;
          const compHasValidDate = post.postDateWritten || (existing ? prevJson?.postDateWritten !== false : false);
          const compFollowers = post.followers ?? finiteOrNull(prevJson?.followers);
          const compProfilePostsTotal = post.profilePostsTotal ?? finiteOrNull(prevJson?.profilePostsTotal);
          const compPayloadDescription = JSON.stringify({
            platform: post.platform,
            postType: post.postType,
            caption: effectiveCompCaption,
            metrics: mergeObservedMetrics(prevJson?.metrics, post.metrics),
            ...(compHasValidDate ? {} : { postDateWritten: false }),
            ...(compFollowers !== null ? { followers: compFollowers } : {}),
            ...(compProfilePostsTotal !== null ? { profilePostsTotal: compProfilePostsTotal } : {}),
            ...(post.account ? { account: post.account } : {}),
          });

          if (existing) {
            const isCuratedPromo =
              existing.category !== SOCIAL_POST_CATEGORY ||
              existing.kind !== null ||
              existing.source.toLowerCase().includes("gemini");
            const updated = await tx.competitorPromotion.updateMany({
              where: { id: existing.id, version: existing.version },
              data: isCuratedPromo
                ? {
                    imageUrl: post.imageUrl ?? existing.imageUrl,
                    capturedAt: now,
                    version: { increment: 1 },
                  }
                : {
                    title: firstLine,
                    description: compPayloadDescription,
                    imageUrl: post.imageUrl ?? existing.imageUrl,
                    startsAt: post.postDateWritten ? post.postedAt : existing.startsAt,
                    capturedAt: now,
                    status: "changed",
                    version: { increment: 1 },
                  },
            });
            if (updated.count === 0) {
              throw new BrowserSyncConflictError("Konflik versi (OCC) saat memperbarui postingan pembanding.");
            }
          } else {
            await tx.competitorPromotion.create({
              data: {
                competitorId: comp.id,
                title: firstLine,
                category: SOCIAL_POST_CATEGORY,
                description: compPayloadDescription,
                startsAt: post.postDateWritten ? post.postedAt : now,
                source: sourceLabel,
                sourceUrl: post.sourceUrl,
                imageUrl: post.imageUrl,
                capturedAt: now,
                status: "new",
                version: 1,
              },
            });
          }
          return { sourceUrl: existing?.sourceUrl ?? post.sourceUrl };
        });
        if (!compResult) continue;
        commentSourceUrl = compResult.sourceUrl;
        postsSaved++;
      }

      if (targetCompetitorId && post.comments.length > 0) {
        const candidates = post.comments.map((c) => ({
          comment: c,
          externalId: buildAnonymizedSocialExternalId(sourceLabel, commentSourceUrl, c),
        }));
        const existingMatches = await db.competitorReview.findMany({
          where: {
            competitorId: targetCompetitorId,
            source: sourceLabel,
            OR: [
              { externalId: { in: candidates.map((x) => x.externalId) } },
              { sourceUrl: commentSourceUrl, text: { in: candidates.map((x) => x.comment.text) } },
            ],
          },
          select: { externalId: true, text: true },
        });
        const existingIds = new Set(existingMatches.map((m) => m.externalId));
        const existingTexts = new Set(existingMatches.map((m) => m.text));
        const toInsert = candidates.filter(
          ({ externalId, comment }) => !existingIds.has(externalId) && !existingTexts.has(comment.text),
        );
        const alreadySkipped = candidates.length - toInsert.length;
        commentsSkipped += alreadySkipped;

        if (toInsert.length > 0) {
          const inserted = await db.competitorReview.createMany({
            data: toInsert.map(({ externalId, comment }) => ({
              competitorId: targetCompetitorId,
              externalId,
              source: sourceLabel,
              sourceUrl: commentSourceUrl,
              rating: 0,
              reviewDate: comment.commentAt,
              text: comment.text,
              sentiment: determineReviewSentiment(comment.text),
              themes: extractThemes(comment.text),
              capturedAt: new Date(),
            })),
            skipDuplicates: true,
          });
          commentsInserted += inserted.count;
          commentsSkipped += toInsert.length - inserted.count;
        }
      }
    }

    if (payload.pausedChallenge) {
      batchErrors++;
      await log.recordScrapeError({
        runId: run.id,
        sourceId: run.sourceId,
        stage: "fetch",
        message: payload.pausedChallenge.reason,
        url: payload.pausedChallenge.url ?? undefined,
      });
    }
    for (const errMsg of payload.errors) {
      batchErrors++;
      await log.recordScrapeError({
        runId: run.id,
        sourceId: run.sourceId,
        stage: "parse",
        message: errMsg,
      });
    }

    const totalSavedThisBatch = postsSaved + commentsInserted;
    if (payload.finalizeRun || payload.pausedChallenge) {
      const status =
        run.errors + batchErrors === 0
          ? "success"
          : run.recordsSaved + totalSavedThisBatch > 0 || run.duplicates + commentsSkipped > 0
            ? "partial"
            : "failed";
      await log.finishRun(run.id, {
        status,
        itemsFound: run.recordsDiscovered + itemsFound,
        itemsSaved: run.recordsSaved + totalSavedThisBatch,
        itemsDuplicate: run.duplicates + commentsSkipped,
        errorsCount: run.errors + batchErrors,
      });
    } else {
      await db.scrapeRun.update({
        where: { id: run.id },
        data: {
          recordsDiscovered: { increment: itemsFound },
          recordsSaved: { increment: totalSavedThisBatch },
          duplicates: { increment: commentsSkipped },
          errors: { increment: batchErrors },
        },
      });
    }

    return { syncRunId: run.id, postsSaved, commentsInserted, commentsSkipped };
  } catch (error) {
    await log.recordScrapeError({
      runId: run.id,
      sourceId: run.sourceId,
      stage: "persist",
      message: sanitizeScrapeError(error instanceof Error ? error.message : String(error)),
    });
    await log.finishRun(run.id, {
      status: "failed",
      itemsFound: run.recordsDiscovered + itemsFound,
      itemsSaved: run.recordsSaved + postsSaved + commentsInserted,
      itemsDuplicate: run.duplicates + commentsSkipped,
      errorsCount: run.errors + batchErrors + 1,
    });
    throw error;
  }
}
