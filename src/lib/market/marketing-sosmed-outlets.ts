/**
 * Isi halaman Media Sosial per unit bisnis yang dipilih di pemilih unit bisnis ("all" = semua outlet): akun resmi,
 * postingan, dan ringkasan angka. Angka yang belum ada ditulis null, bukan nol.
 */
import { OUTLET_KEYS, type OutletKey } from "./outlet-filters";
import {
  CRAWLED_FOLLOWERS,
  OFFICIAL_SOCIAL_ACCOUNTS,
  followerKey,
  PUBLIC_LIKES,
  captionScore,
  type OfficialSocialAccount,
  type SocialPromoPostRecord,
} from "./marketing-sosmed";

export type OutletChoice = OutletKey | "all";

export const postsForOutlet = (posts: SocialPromoPostRecord[], outlet: OutletChoice): SocialPromoPostRecord[] =>
  outlet === "all" ? posts : posts.filter((p) => p.outletKey === outlet);

export const accountsForOutlet = (outlet: OutletChoice): OfficialSocialAccount[] =>
  outlet === "all" ? OFFICIAL_SOCIAL_ACCOUNTS : OFFICIAL_SOCIAL_ACCOUNTS.filter((a) => a.outlets.includes(outlet));

/** Postingan per unit bisnis dalam urutan pemilih; outlet tanpa postingan tetap ada supaya kekosongannya terlihat. */
export const groupPostsByOutlet = (posts: SocialPromoPostRecord[]): { outlet: OutletKey; posts: SocialPromoPostRecord[] }[] =>
  OUTLET_KEYS.map((outlet) => ({ outlet, posts: posts.filter((p) => p.outletKey === outlet) }));

/** Likes isian tim bila ada, selain itu likes publik hasil crawl; null bila tidak terbaca (likes disembunyikan pemilik akun). */
export const knownLikes = (p: SocialPromoPostRecord): number | null => p.metrics?.likes ?? PUBLIC_LIKES[p.postUrl] ?? null;

const mean = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);

const handleOf = (a: OfficialSocialAccount) => a.label.replace(/^@/, "");

/**
 * Pengikut terbaru per akun resmi Instagram dan TikTok, dengan kunci followerKey(platform, akun): angka dari sinkron
 * ekstensi yang paling baru bila ada, selain itu angka crawl profil Instagram 10 Nov, selain itu null. Dihitung dari
 * semua postingan, bukan postingan satu outlet, karena satu akun bisa melayani beberapa outlet.
 */
export function latestFollowersByAccount(posts: SocialPromoPostRecord[]): Record<string, number | null> {
  const synced = new Map<string, { count: number; at: string }>();
  for (const p of posts) {
    if (!p.account || typeof p.followers !== "number" || !p.followersObservedAt) continue;
    const key = followerKey(p.platform, p.account.trim().toLowerCase());
    const prev = synced.get(key);
    if (!prev || p.followersObservedAt > prev.at) synced.set(key, { count: p.followers, at: p.followersObservedAt });
  }
  const out: Record<string, number | null> = {};
  for (const acc of OFFICIAL_SOCIAL_ACCOUNTS) {
    if (acc.platform !== "instagram" && acc.platform !== "tiktok") continue;
    const key = followerKey(acc.platform, handleOf(acc));
    const lookupKey = followerKey(acc.platform, handleOf(acc).toLowerCase());
    out[key] = synced.get(lookupKey)?.count ?? CRAWLED_FOLLOWERS[key] ?? null;
  }
  return out;
}

export interface SocialAccountCoverage {
  syncedPosts: number;
  profilePostsTotal: number | null;
  followers: number | null;
  incomplete: boolean;
  latestPostAt: string | null;
}

export type SocialCoveragePostInput = SocialPromoPostRecord & {
  collabAccounts?: string[];
};

const normalizedAccountKey = (platform: string, handleOrLabel: string): string =>
  `${platform.toLowerCase()}:${handleOrLabel.replace(/^@/, "").trim().toLowerCase()}`;

/**
 * Merangkum cakupan postingan tersinkron per akun resmi (selaras dengan `summarizeSocialAccountCoverage`).
 * Postingan kolaborasi eksternal (`/<collab>/p/...` dengan `post.account` eksplisit) dihitung ke akun resmi
 * `post.account`, bukan handle `<collab>`, dan `collabAccounts` menambah hitungan tersinkron akun rekan
 * tanpa mencampur `followers` atau `profilePostsTotal`.
 */
export function summarizeSocialAccountCoverage(
  posts: readonly SocialCoveragePostInput[],
  accounts: readonly OfficialSocialAccount[] = OFFICIAL_SOCIAL_ACCOUNTS,
): Record<string, SocialAccountCoverage> {
  const out: Record<string, SocialAccountCoverage> = {};
  for (const acc of accounts) {
    if (acc.platform !== "instagram" && acc.platform !== "tiktok") continue;
    out[normalizedAccountKey(acc.platform, acc.label)] = {
      syncedPosts: 0,
      profilePostsTotal: null,
      followers: null,
      incomplete: false,
      latestPostAt: null,
    };
  }
  const latestObs = new Map<string, string>();
  for (const post of posts) {
    if (post.platform !== "instagram" && post.platform !== "tiktok") continue;
    const primaryHandle = post.account?.replace(/^@/, "").trim().toLowerCase() ?? "";
    if (!primaryHandle) continue;
    const key = normalizedAccountKey(post.platform, primaryHandle);
    const entry = (out[key] ??= {
      syncedPosts: 0,
      profilePostsTotal: null,
      followers: null,
      incomplete: false,
      latestPostAt: null,
    });
    entry.syncedPosts += 1;

    const day = typeof post.postedAt === "string" ? post.postedAt.slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!entry.latestPostAt || day > entry.latestPostAt)) {
      entry.latestPostAt = day;
    }

    const obsAt = post.followersObservedAt ?? post.postedAt ?? "";
    const prevObs = latestObs.get(key) ?? "";
    const fol = typeof post.followers === "number" && Number.isFinite(post.followers) ? post.followers : null;
    if (fol !== null && (entry.followers === null || obsAt >= prevObs)) {
      entry.followers = fol;
      latestObs.set(key, obsAt);
    }
    if (typeof post.profilePostsTotal === "number" && Number.isFinite(post.profilePostsTotal) && post.profilePostsTotal >= 0) {
      entry.profilePostsTotal =
        entry.profilePostsTotal === null ? post.profilePostsTotal : Math.max(entry.profilePostsTotal, post.profilePostsTotal);
    }

    if (Array.isArray(post.collabAccounts)) {
      const seenCollab = new Set<string>();
      for (const rawCollab of post.collabAccounts) {
        const cleanCollab = rawCollab.replace(/^@/, "").trim().toLowerCase();
        if (!cleanCollab || cleanCollab === primaryHandle || seenCollab.has(cleanCollab)) continue;
        seenCollab.add(cleanCollab);
        const collabKey = normalizedAccountKey(post.platform, cleanCollab);
        const collabEntry = out[collabKey];
        if (!collabEntry) continue;
        collabEntry.syncedPosts += 1;
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && (!collabEntry.latestPostAt || day > collabEntry.latestPostAt)) {
          collabEntry.latestPostAt = day;
        }
      }
    }
  }
  for (const entry of Object.values(out)) {
    entry.incomplete = entry.profilePostsTotal !== null && entry.syncedPosts < entry.profilePostsTotal;
  }
  return out;
}

export interface PlatformSosmedStats {
  accounts: number;
  /** Akun resmi platform ini untuk outlet terpilih, misalnya "@sanghyangsparesort". */
  handles: string[];
  followers: number | null;
  posts: number;
  views: { total: number; average: number } | null;
  likes: { total: number; counted: number; average: number } | null;
}

export interface SosmedStats {
  posts: number;
  instagramAccounts: number;
  /** Pengikut akun Instagram outlet yang terbaca; null bila belum ada. */
  followers: number | null;
  likes: { total: number; counted: number; average: number } | null;
  /** Rata-rata skor tiap pilar dan Skor Mutu Caption berbobot; null bila belum ada postingan. */
  caption: { hook: number; copy: number; cta: number; score: number } | null;
  /** Chat WhatsApp dari postingan yang angkanya sudah diisi tim; null bila belum ada isian. */
  waLeads: { total: number; filled: number } | null;
  /** Rincian metrik khusus platform Instagram */
  instagram: PlatformSosmedStats;
  /** Rincian metrik khusus platform TikTok */
  tiktok: PlatformSosmedStats;
}

function platformStats(
  accounts: OfficialSocialAccount[],
  posts: SocialPromoPostRecord[],
  followers: Record<string, number | null>,
): PlatformSosmedStats {
  const followerCounts = accounts.map((a) => followers[followerKey(a.platform, handleOf(a))]).filter((n): n is number => typeof n === "number");
  const likes = posts.map(knownLikes).filter((n): n is number => n !== null);
  const views = posts.map((p) => p.metrics?.views).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return {
    accounts: accounts.length,
    handles: accounts.map((a) => a.label),
    followers: followerCounts.length ? followerCounts.reduce((sum, n) => sum + n, 0) : null,
    posts: posts.length,
    views: views.length ? { total: views.reduce((sum, n) => sum + n, 0), average: Math.round(mean(views)) } : null,
    likes: likes.length ? { total: likes.reduce((sum, n) => sum + n, 0), counted: likes.length, average: Math.round(mean(likes)) } : null,
  };
}

/**
 * Ringkasan angka unit bisnis terpilih. `followers` = pengikut per akun dengan kunci followerKey
 * (latestFollowersByAccount); bawaannya angka crawl profil Instagram 10 Nov.
 */
export function sosmedStats(
  posts: SocialPromoPostRecord[],
  outlet: OutletChoice,
  followers: Record<string, number | null> = CRAWLED_FOLLOWERS,
): SosmedStats {
  const accounts = accountsForOutlet(outlet);
  const instagram = accounts.filter((a) => a.platform === "instagram");
  const igStats = platformStats(instagram, posts.filter((p) => p.platform === "instagram"), followers);
  const ttStats = platformStats(
    accounts.filter((a) => a.platform === "tiktok"),
    posts.filter((p) => p.platform === "tiktok"),
    followers,
  );

  const likes = posts.map(knownLikes).filter((n): n is number => n !== null);
  const filled = posts.flatMap((p) => (p.metrics ? [p.metrics] : []));
  const audits = posts.map((p) => p.audit);
  // Skor berbobot dihitung dari rata-rata yang belum dibulatkan, supaya sama dengan rumus untuk satu postingan.
  const avg = audits.length
    ? { hookScore: mean(audits.map((a) => a.hookScore)), copyScore: mean(audits.map((a) => a.copyScore)), ctaScore: mean(audits.map((a) => a.ctaScore)) }
    : null;
  const withWa = filled.filter((m): m is typeof m & { inquiriesWa: number } => typeof m.inquiriesWa === "number" && Number.isFinite(m.inquiriesWa));

  return {
    posts: posts.length,
    instagramAccounts: instagram.length,
    followers: igStats.followers,
    likes: likes.length ? { total: likes.reduce((sum, n) => sum + n, 0), counted: likes.length, average: Math.round(mean(likes)) } : null,
    caption: avg
      ? { hook: Math.round(avg.hookScore), copy: Math.round(avg.copyScore), cta: Math.round(avg.ctaScore), score: captionScore(avg) }
      : null,
    waLeads: withWa.length ? { total: withWa.reduce((sum, m) => sum + m.inquiriesWa, 0), filled: withWa.length } : null,
    instagram: igStats,
    tiktok: ttStats,
  };
}
