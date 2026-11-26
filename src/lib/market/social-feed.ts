/**
 * Umpan postingan tab Marketing > Media Sosial: postingan Graph API Meta digabung dengan postingan tersimpan
 * (sinkron Ekstensi Chrome, isian tim, arsip baca 10 Nov). Satu postingan Instagram = satu kartu, dikenali dari
 * shortcode-nya karena tautan yang sama bisa berbentuk /p/KODE/, /reel/KODE/, atau /akun/p/KODE/.
 */
import type { InstagramMediaItem } from "@/lib/marketing/meta-instagram";
import { wibDay } from "./date-range";
import { instagramShortcodeFromUrl } from "./instagram-url";
import {
  evaluateSocialPromoPost,
  outletForInstagramAccount,
  type SocialPostMetrics,
  type SocialPromoPostInput,
  type SocialPromoPostRecord,
} from "./marketing-sosmed";

/** Asal data satu kartu: Graph API Meta, sinkron ekstensi, isian tim lewat formulir, atau arsip baca 10 Nov. */
export type SocialSource = "meta" | "extension" | "team" | "archive";

export interface SocialFeedPost extends SocialPromoPostRecord {
  collabAccounts?: string[];
  /** Meta selalu di depan bila ikut. */
  sources: SocialSource[];
  /** Foto atau thumbnail HTTPS; null bila tidak terbaca. */
  imageUrl: string | null;
  /** Waktu tayang lengkap dari Meta (ISO); null bila hanya tanggal tayangnya yang diketahui. */
  publishedAt: string | null;
}

/** Status sambungan Meta yang dikirim ke halaman, tanpa kunci aksesnya. */
export interface MetaFeedStatus {
  keyInstalled: boolean;
  /** Akun Instagram di portofolio bisnis Meta (huruf kecil, tanpa @). */
  connected: string[];
  /** Akun tersambung yang postingannya gagal dibaca. */
  unreadable: string[];
  /** Alasan dari pemuat Meta dalam kalimat biasa; null bila semuanya terbaca. */
  problem: string | null;
  /** Banyaknya postingan terbaru yang dibaca dari tiap akun. */
  perAccountLimit: number;
}

const META_POST_TYPE: Record<InstagramMediaItem["media_type"], SocialPromoPostInput["postType"]> = {
  IMAGE: "feed",
  VIDEO: "reels",
  CAROUSEL_ALBUM: "carousel",
};

/** Alamat gambar hanya dipakai bila HTTPS; tautan lain (javascript:, http:) tidak pernah sampai ke <img>. */
export function httpsUrlOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return new URL(raw.trim()).protocol === "https:" ? raw.trim() : null;
  } catch {
    // ZERO-FALLBACK: alamat gambar yang rusak berarti kartu tanpa foto, bukan galat halaman.
    return null;
  }
}

const countOrNull = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null);
const handleOf = (raw: string | undefined): string | null => {
  const clean = raw?.trim().replace(/^@/, "").toLowerCase();
  return clean ? clean : null;
};

/** Satu media Graph API Meta sebagai kartu; null bila waktu tayangnya tidak terbaca (tidak bisa masuk periode mana pun). */
export function metaToFeedPost(item: InstagramMediaItem): SocialFeedPost | null {
  const at = new Date(item.timestamp);
  if (Number.isNaN(at.getTime())) return null;
  const account = handleOf(item.outlet_username) ?? undefined;
  const caption = item.caption ?? "";
  const likes = countOrNull(item.like_count);
  const comments = countOrNull(item.comments_count);
  const metrics: SocialPostMetrics | null =
    likes === null && comments === null ? null : { views: null, likes, comments, shares: null, inquiriesWa: null };
  const input: SocialPromoPostInput = {
    outletKey: outletForInstagramAccount(account ?? "", caption),
    platform: "instagram",
    postType: META_POST_TYPE[item.media_type] ?? "feed",
    postedAt: wibDay(at),
    postUrl: item.permalink,
    caption,
    metrics,
    ...(account ? { account } : {}),
  };
  return {
    ...input,
    id: `meta:${item.id}`,
    createdAt: at.toISOString(),
    audit: evaluateSocialPromoPost(input),
    sources: ["meta"],
    // media_url sebuah Reels adalah berkas videonya; gambar pratinjaunya ada di thumbnail_url.
    imageUrl: httpsUrlOrNull(item.media_type === "VIDEO" ? item.thumbnail_url : (item.media_url ?? item.thumbnail_url)),
    publishedAt: at.toISOString(),
  };
}

/** Postingan tersimpan sebagai kartu. Sinkron ekstensi selalu mencatat akun pemiliknya, isian tim tidak. */
export function storedFeedPost(post: SocialPromoPostRecord, extra: { imageUrl: unknown; collabAccounts?: string[] }): SocialFeedPost {
  return {
    ...post,
    ...(extra.collabAccounts && extra.collabAccounts.length > 0 ? { collabAccounts: extra.collabAccounts } : {}),
    sources: [post.account ? "extension" : "team"],
    imageUrl: httpsUrlOrNull(extra.imageUrl),
    publishedAt: null,
  };
}

/** Postingan arsip baca 10 Nov (tanpa foto dan tanpa jam tayang). */
export function archiveFeedPost(post: SocialPromoPostRecord): SocialFeedPost {
  return { ...post, sources: ["archive"], imageUrl: null, publishedAt: null };
}

const feedKey = (p: Pick<SocialFeedPost, "platform" | "postUrl">): string => {
  const code = p.platform === "instagram" ? instagramShortcodeFromUrl(p.postUrl) : null;
  return code ? `ig:${code}` : `url:${p.postUrl}`;
};

const pick = (a: number | null | undefined, b: number | null | undefined): number | null => a ?? b ?? null;

function combine(meta: SocialFeedPost, stored: SocialFeedPost): SocialFeedPost {
  const m = meta.metrics;
  const s = stored.metrics;
  const metrics: SocialPostMetrics | null =
    m || s
      ? {
          views: pick(m?.views, s?.views),
          likes: pick(m?.likes, s?.likes),
          comments: pick(m?.comments, s?.comments),
          shares: pick(m?.shares, s?.shares),
          inquiriesWa: pick(m?.inquiriesWa, s?.inquiriesWa),
        }
      : null;
  // Outlet dan akun dari data tersimpan menang: di sana tercatat pilihan tim dan aturan kolaborasi ekstensi.
  const account = stored.account ?? meta.account;
  const collab = new Set(stored.collabAccounts ?? []);
  for (const h of [meta.account, ...(meta.collabAccounts ?? [])]) if (h && h !== account) collab.add(h);
  const input: SocialPromoPostInput = {
    outletKey: stored.outletKey,
    platform: "instagram",
    postType: meta.postType,
    postedAt: meta.postedAt,
    postUrl: meta.postUrl,
    caption: meta.caption.trim() ? meta.caption : stored.caption,
    metrics,
    ...(account ? { account } : {}),
  };
  return {
    ...stored,
    ...input,
    collabAccounts: collab.size > 0 ? [...collab].sort() : undefined,
    // Skor dihitung ulang karena angka gabungan (suka Meta, views ekstensi) mengubah tingkat interaksi.
    audit: evaluateSocialPromoPost(input),
    sources: ["meta", ...stored.sources.filter((src) => src !== "meta")],
    // URL CDN Meta baru ditandatangani; tautan simpanan ekstensi bisa sudah kedaluwarsa.
    imageUrl: meta.imageUrl ?? stored.imageUrl,
    publishedAt: meta.publishedAt,
  };
}

/**
 * Gabungan postingan Meta dan tersimpan, satu kartu per postingan. Suka dan komentar Meta diutamakan; views,
 * shares, dan chat WA dari data tersimpan melengkapi. Urutan data tersimpan dipertahankan, postingan yang hanya ada
 * di Meta menyusul; halaman mengurutkan ulang menurut periode.
 */
export function mergeSocialFeeds(metaPosts: readonly SocialFeedPost[], storedPosts: readonly SocialFeedPost[]): SocialFeedPost[] {
  // Postingan kolaborasi bisa terbaca dari dua akun di portofolio: simpan sekali, akun kedua menjadi kolaborator.
  const metaByKey = new Map<string, SocialFeedPost>();
  for (const post of metaPosts) {
    const key = feedKey(post);
    const prev = metaByKey.get(key);
    if (!prev) {
      metaByKey.set(key, post);
      continue;
    }
    if (post.account && post.account !== prev.account) {
      metaByKey.set(key, { ...prev, collabAccounts: [...new Set([...(prev.collabAccounts ?? []), post.account])].sort() });
    }
  }

  const used = new Set<string>();
  const merged = storedPosts.map((stored) => {
    const key = feedKey(stored);
    const meta = metaByKey.get(key);
    if (!meta || used.has(key)) return stored;
    used.add(key);
    return combine(meta, stored);
  });
  const metaOnly = [...metaByKey.entries()].filter(([key]) => !used.has(key)).map(([, post]) => post);
  return [...merged, ...metaOnly];
}
