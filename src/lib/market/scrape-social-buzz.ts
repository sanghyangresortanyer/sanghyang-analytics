import type { Browser } from "puppeteer";
import { PromotionStatus } from "@prisma/client";
import { db } from "../db";
import { SOCIAL_POST_CATEGORY } from "./outlet-filters";
import { InstagramGraphAdapter } from "./adapters/instagram-graph";
import { checkTikTokVideo, isTikTokVideoUrl } from "./adapters/tiktok-oembed";
import {
  countSocialTargets,
  formatExtensionSyncDetail,
  socialSourceStatuses,
  type ExtensionSocialSyncSummary,
  type SocialSourceStatus,
} from "./social-sources";
import type { StepOutcome } from "./refresh-outcome";

export type SocialAccountTarget = {
  competitorId: string;
  name: string;
  username: string;
  url: string;
};

export type DiscoveredSocialPost = {
  competitorId: string;
  username: string;
  url: string;
  captionSnippet: string;
  /** Tanggal posting dari teks alt Instagram ("... on November 04, 2026."), null bila tidak tercantum. */
  postedAt: Date | null;
};

/** Ambil tanggal posting dari teks alt Instagram berbahasa Inggris. */
export function parseInstagramAltDate(alt: string): Date | null {
  const m = alt.match(/ on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} 00:00:00 GMT+0700`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type SocialScrapeResult = {
  attempted: number;
  totalDiscovered: number;
  newPosts: number;
  /** Akun yang dialihkan Instagram ke halaman login (butuh sesi/izin resmi). */
  blocked: string[];
  failures: string[];
  /** Diisi bila tidak ada sumber pengumpul data yang berjalan, misalnya semua kunci jalur resmi masih kosong. */
  skippedReason?: string;
  /** Status tiap jalur resmi saat langkah berjalan. */
  sources: SocialSourceStatus[];
  /** Hasil pemeriksaan oEmbed untuk video TikTok yang sudah tercatat; failures = permintaan yang tidak terjawab. */
  tiktok: { checked: number; available: number; unavailable: string[]; failures: string[] } | null;
  /** Ringkasan data Instagram & TikTok yang sudah disinkronkan lewat Ekstensi Chrome di DB lokal. */
  extensionSync?: ExtensionSocialSyncSummary | null;
};

export type InstagramCollectionStatus = { runDomScraper: false; label: "Tersambung" | "Belum tersambung"; reason: string };

/**
 * ADR-004 / ADR-012: Scraping DOM headless Instagram dihentikan. Pengumpulan media sosial dilakukan lewat
 * Instagram Graph API (Business Discovery) atau Ekstensi Chrome Sanghyang Market Sync dari peramban staf.
 */
export function instagramCollectionStatus(env: Record<string, string | undefined> = process.env): InstagramCollectionStatus {
  const keys = new InstagramGraphAdapter().requiredEnvKeys;
  const connected = keys.every((key) => Boolean(env[key]?.trim()));
  return connected
    ? { runDomScraper: false, label: "Tersambung", reason: "Instagram Graph API tersambung: postingan publik akun bisnis kompetitor dibaca lewat Business Discovery di job sosmed." }
    : { runDomScraper: false, label: "Belum tersambung", reason: "Instagram Graph API belum tersambung: sinkronisasi postingan dan komentar dikelola lewat Ekstensi Chrome Sanghyang Market Sync." };
}

/** Kategori untuk postingan baru yang belum diverifikasi sebagai promo. */
export { SOCIAL_POST_CATEGORY };
const POSTS_PER_ACCOUNT = 5;
const INSTAGRAM_PROFILE = /instagram\.com\/([A-Za-z0-9._]+)\/?$/;

/** Target diambil dari kompetitor aktif yang punya URL profil Instagram di DB. */
export async function loadSocialTargets(): Promise<SocialAccountTarget[]> {
  const competitors = await db.competitor.findMany({
    where: { active: true, instagramUrl: { contains: "instagram.com/" } },
    select: { id: true, name: true, instagramUrl: true },
    orderBy: { name: "asc" },
  });
  return competitors.flatMap((c) => {
    const username = c.instagramUrl?.match(INSTAGRAM_PROFILE)?.[1];
    return username
      ? [{ competitorId: c.id, name: c.name, username, url: `https://www.instagram.com/${username}/` }]
      : [];
  });
}

export async function scrapeAccount(browser: Browser, target: SocialAccountTarget, limit = POSTS_PER_ACCOUNT): Promise<DiscoveredSocialPost[] | "blocked"> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(target.url, { waitUntil: "networkidle2", timeout: 60_000 });
    if (page.url().includes("/accounts/login") || (await page.$("input[name='username']"))) return "blocked";
    await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 30_000 }).catch(async () => {
      throw new Error(`tidak ada postingan di ${page.url()} (judul halaman: "${await page.title()}")`);
    });
    const posts = await page.evaluate((limit, username) => {
      const seen = new Set<string>();
      const out: { url: string; caption: string }[] = [];
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/p/'], a[href*='/reel/']"))) {
        const url = a.href.split("?")[0];
        const owner = new URL(url).pathname.split("/").filter(Boolean)[0];
        // Path "/<user>/p/<id>" milik akun lain = postingan kolaborasi/tag, bukan konten akun ini.
        if (owner !== "p" && owner !== "reel" && owner.toLowerCase() !== username.toLowerCase()) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, caption: a.querySelector("img")?.getAttribute("alt")?.trim() ?? "" });
        if (out.length >= limit) break;
      }
      return out;
    }, limit, target.username);
    return posts.map((p) => ({
      competitorId: target.competitorId,
      username: target.username,
      url: p.url,
      captionSnippet: p.caption,
      postedAt: parseInstagramAltDate(p.caption),
    }));
  } finally {
    await page.close();
  }
}

/** Simpan postingan yang belum pernah tercatat sebagai CompetitorPromotion status "new" (dedup by sourceUrl). */
export async function recordDiscoveredSocialPosts(posts: DiscoveredSocialPost[]): Promise<number> {
  if (posts.length === 0) return 0;
  const existing = await db.competitorPromotion.findMany({
    where: { sourceUrl: { in: posts.map((p) => p.url) } },
    select: { sourceUrl: true },
  });
  const known = new Set(existing.map((e) => e.sourceUrl));
  const fresh = posts.filter((p) => !known.has(p.url));
  if (fresh.length === 0) return 0;
  const now = new Date();
  await db.competitorPromotion.createMany({
    data: fresh.map((p) => ({
      competitorId: p.competitorId,
      title: `Postingan baru @${p.username}`,
      category: SOCIAL_POST_CATEGORY,
      description: p.captionSnippet || null,
      startsAt: p.postedAt ?? now,
      source: "Instagram",
      sourceUrl: p.url,
      capturedAt: now,
      status: PromotionStatus.new,
    })),
  });
  return fresh.length;
}

const SOURCE_SHORT: Record<SocialSourceStatus["id"], string> = {
  "instagram-business-discovery": "Instagram",
  "tiktok-oembed": "TikTok",
};
const MAX_TIKTOK_OEMBED_CHECK = 10;

function formatTikTokAvailability(tiktok: NonNullable<SocialScrapeResult["tiktok"]>): string {
  return `TikTok: ${tiktok.available} dari ${tiktok.checked} video tercatat masih tersedia${tiktok.unavailable.length ? ` (tidak tersedia: ${tiktok.unavailable.length})` : ""}.`;
}

/**
 * Status langkah sosmed dari hasil jalur resmi maupun sinkronisasi Ekstensi Chrome di DB lokal.
 * Pesan untuk pemilik memakai bahasa awam bersih tanpa nama variabel lingkungan teknis.
 */
export function socialStepOutcome(r: SocialScrapeResult): StepOutcome {
  const problems = [...r.failures, ...(r.tiktok?.failures ?? [])];
  const problemText = problems.length
    ? `sosmed gagal untuk ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` dan ${problems.length - 5} lainnya` : ""}`
    : null;
  const tiktokLine = r.tiktok ? formatTikTokAvailability(r.tiktok) : null;

  if (r.extensionSync && r.extensionSync.totalPosts > 0 && !r.skippedReason) {
    const status = problems.length === 0 ? "berhasil" : "sebagian";
    const detailParts = [formatExtensionSyncDetail(r.extensionSync), tiktokLine].filter(Boolean);
    return { status, detail: detailParts.join(" "), issue: problemText };
  }

  const perSource = r.sources
    .map((s) => {
      if (s.id === "tiktok-oembed" && tiktokLine) return tiktokLine;
      if (s.state === "belum-dikonfigurasi") {
        return `${SOURCE_SHORT[s.id]}: belum ada sinkronisasi Ekstensi Chrome di basis data; jalankan Sinkron Sosmed via Chrome dari peramban staf.`;
      }
      if (s.state === "menunggu-keputusan") return `${SOURCE_SHORT[s.id]}: penyimpanan menunggu keputusan pemilik.`;
      if (s.state === "tanpa-target") return `${SOURCE_SHORT[s.id]}: belum ada target yang tercatat.`;
      return null;
    })
    .filter((x): x is string => x !== null);

  if (r.skippedReason) {
    const detail = perSource.join(" ") || "Belum ada data media sosial yang disinkronkan lewat Ekstensi Chrome.";
    return { status: "dilewati", detail, issue: [`sosmed dilewati: ${r.skippedReason}`, problemText].filter(Boolean).join("; ") };
  }

  const igReached = Math.max(0, r.attempted - r.failures.length - r.blocked.length);
  const unreachable = r.failures.length + r.blocked.length;
  const status = unreachable === 0 && (r.tiktok?.failures.length ?? 0) === 0 ? "berhasil" : igReached === 0 && (r.tiktok?.available ?? 0) === 0 ? "gagal" : "sebagian";
  const detailParts = [
    r.sources.some((s) => s.id === "instagram-business-discovery" && s.state === "siap")
      ? `Instagram: ${r.newPosts} postingan baru, ${igReached} dari ${r.attempted} akun terbaca.`
      : null,
    ...perSource,
  ].filter(Boolean);
  return {
    status,
    detail: detailParts.join(" "),
    issue: problemText,
  };
}

/** Video TikTok terbaru yang tercatat di basis data, diperiksa ketersediaannya lewat oEmbed resmi. */
async function checkKnownTikTokVideos(): Promise<NonNullable<SocialScrapeResult["tiktok"]>> {
  const rows = await db.competitorPromotion.findMany({
    where: { sourceUrl: { contains: "tiktok.com/@" }, AND: { sourceUrl: { contains: "/video/" } } },
    select: { sourceUrl: true },
    orderBy: { capturedAt: "desc" },
    take: MAX_TIKTOK_OEMBED_CHECK * 3,
  });
  const urls = [...new Set(rows.map((r) => r.sourceUrl).filter((u): u is string => Boolean(u && isTikTokVideoUrl(u))))].slice(
    0,
    MAX_TIKTOK_OEMBED_CHECK,
  );
  const out = { checked: 0, available: 0, unavailable: [] as string[], failures: [] as string[] };
  for (const url of urls) {
    try {
      const res = await checkTikTokVideo(url);
      out.checked++;
      if (res.available) out.available++;
      else out.unavailable.push(`${url} (HTTP ${res.status})`);
    } catch (error) {
      out.failures.push(`TikTok oEmbed ${url}: ${(error as Error).message}`);
    }
  }
  return out;
}

/**
 * Radar media sosial pesaing: memakai data sinkronisasi Ekstensi Chrome di DB lokal atau jalur resmi
 * Instagram Business Discovery, dilengkapi pemeriksaan ketersediaan video TikTok lewat oEmbed.
 */
export async function scrapeSocialBuzz(env: Record<string, string | undefined> = process.env): Promise<SocialScrapeResult> {
  const targetsSummary = await countSocialTargets();
  const sources = socialSourceStatuses(env, targetsSummary);
  const instagram = sources.find((s) => s.id === "instagram-business-discovery");
  const extensionSync = targetsSummary.extensionSync ?? null;
  const tiktokReady = sources.some((s) => s.id === "tiktok-oembed" && s.state === "siap");
  const tiktok = tiktokReady ? await checkKnownTikTokVideos() : null;
  const failures: string[] = [];

  const instagramReady =
    Boolean(env.INSTAGRAM_GRAPH_ACCESS_TOKEN?.trim() && env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim()) &&
    instagram?.state === "siap";
  if (!instagramReady) {
    if (extensionSync && extensionSync.totalPosts > 0) {
      console.log(`[scrape-social] ${formatExtensionSyncDetail(extensionSync)}`);
      return { attempted: 0, totalDiscovered: 0, newPosts: 0, blocked: [], failures, sources, tiktok, extensionSync };
    }
    const reason = "Belum ada data media sosial yang disinkronkan lewat Ekstensi Chrome.";
    console.log(`[scrape-social] Dilewati: ${reason}`);
    return { attempted: 0, totalDiscovered: 0, newPosts: 0, blocked: [], failures, skippedReason: reason, sources, tiktok, extensionSync };
  }

  const targets = await loadSocialTargets();
  console.log(`[scrape-social] Business Discovery untuk ${targets.length} akun Instagram kompetitor...`);
  const adapter = new InstagramGraphAdapter();
  const discovered: DiscoveredSocialPost[] = [];
  for (const target of targets) {
    try {
      const posts = await adapter.fetchBusinessDiscoveryPosts(target.username, POSTS_PER_ACCOUNT);
      discovered.push(
        ...posts.map((p) => ({ competitorId: target.competitorId, username: target.username, url: p.permalink, captionSnippet: p.caption, postedAt: p.postedAt })),
      );
      console.log(`[scrape-social] @${target.username}: ${posts.length} postingan terbaru.`);
    } catch (err) {
      failures.push(`@${target.username}: ${(err as Error).message}`);
      console.error(`[scrape-social] GAGAL @${target.username}: ${(err as Error).message}`);
    }
  }
  const newPosts = await recordDiscoveredSocialPosts(discovered);
  return { attempted: targets.length, totalDiscovered: discovered.length, newPosts, blocked: [], failures, sources, tiktok, extensionSync };
}
