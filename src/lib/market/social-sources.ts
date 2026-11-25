/**
 * Status jalur resmi media sosial tanpa login ke akun Sanghyang, per sumber, untuk job sosmed dan tampilan Langkah 1.
 * Hanya nama kunci yang disebut; nilai kunci tidak pernah keluar dari server.
 *
 * Batas yang diperiksa 16 Nov 2026: robots.txt instagram.com dan facebook.com melarang semua perayap; komentar
 * Instagram hanya bisa dibaca dari akun pemilik postingan (izin instagram_manage_comments); Business Discovery memberi
 * keterangan, waktu, dan jumlah suka/komentar postingan akun bisnis lain, bukan isi komentarnya; oEmbed TikTok hanya
 * mengembalikan pemutar video.
 */
import { BUSINESS_DISCOVERY_DOCS } from "./adapters/instagram-graph";
import { TIKTOK_OEMBED_DOCS } from "./adapters/tiktok-oembed";
import { SOCIAL_POST_CATEGORY } from "./outlet-filters";
import { OWN_SOCIAL_POST_CATEGORY } from "./promo-radar";

export type SocialSourceId = "instagram-business-discovery" | "tiktok-oembed";
export type SocialSourceState = "siap" | "belum-dikonfigurasi" | "menunggu-keputusan" | "tanpa-target";

export interface SocialSourceStatus {
  id: SocialSourceId;
  label: string;
  state: SocialSourceState;
  /** Untuk pemilik: diawali keadaan sumber ("Siap", "Belum dikonfigurasi", "Belum ada target"), lalu tindakan yang dibutuhkan. */
  detail: string;
  missingEnvKeys: string[];
  /** Data yang bisa didapat dari jalur ini, supaya harapan pemilik sesuai. */
  yields: string;
  documentationUrl: string;
}

export interface ExtensionSocialSyncSummary {
  instagramPosts: number;
  tiktokPosts: number;
  totalPosts: number;
  trackedAccounts: number;
  latestSyncedAt: string | null;
  latestRunStatus: "running" | "success" | "partial" | "failed" | null;
  activeSyncRunning: boolean;
}

export interface SocialTargets {
  /** URL video TikTok yang sudah tercatat di radar promo. */
  tiktokVideos: number;
  /** Ringkasan data sinkronisasi Ekstensi Chrome di DB lokal (opsional bagi pemanggil unit tanpa DB). */
  extensionSync?: ExtensionSocialSyncSummary | null;
}

const INSTAGRAM_KEYS = ["INSTAGRAM_GRAPH_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"];
const ACTIVE_SYNC_RECENCY_MS = 15 * 60_000;

const missing = (env: Record<string, string | undefined>, keys: string[]) => keys.filter((k) => !env[k]?.trim());
const fillText = (keys: string[]) => `Belum dikonfigurasi: isi ${keys.join(" dan ")}`;

export function formatExtensionSyncDetail(ext: ExtensionSocialSyncSummary): string {
  const igFmt = ext.instagramPosts.toLocaleString("id-ID");
  const ttFmt = ext.tiktokPosts.toLocaleString("id-ID");
  const accFmt = ext.trackedAccounts.toLocaleString("id-ID");
  const runningNote = ext.activeSyncRunning ? " (sinkronisasi aktif sedang berjalan)" : "";
  return `Disinkronkan lewat Ekstensi Chrome: ${igFmt} postingan Instagram & ${ttFmt} postingan TikTok dari ${accFmt} akun terpantau di basis data lokal${runningNote}.`;
}

export function socialSourceStatuses(env: Record<string, string | undefined>, targets: SocialTargets): SocialSourceStatus[] {
  const sessionMode = env.SOCIAL_RESEARCH_SESSION?.trim();
  const hasGraphKeys = INSTAGRAM_KEYS.every((k) => Boolean(env[k]?.trim()));
  const igMissing = missing(env, INSTAGRAM_KEYS);
  const extSync = targets.extensionSync ?? null;
  const hasExtensionData = Boolean(extSync && extSync.totalPosts > 0);
  const hasExplicitEmptyExtension = extSync !== null && extSync.totalPosts === 0;
  const isResearchSessionNote = !hasGraphKeys && (sessionMode === "needs_login" || sessionMode === "active");

  const instagramStatus: SocialSourceStatus = hasGraphKeys
    ? {
        id: "instagram-business-discovery",
        label: "Instagram (Business Discovery)",
        state: "siap",
        detail: "Siap: postingan publik akun bisnis kompetitor dibaca tiap malam.",
        missingEnvKeys: [],
        yields: "Postingan publik akun bisnis kompetitor: keterangan, waktu, jumlah suka dan komentar. Isi komentar tidak tersedia.",
        documentationUrl: BUSINESS_DISCOVERY_DOCS,
      }
    : hasExtensionData && extSync
      ? {
          id: "instagram-business-discovery",
          label: "Instagram & TikTok (Ekstensi Chrome)",
          state: "siap",
          detail: formatExtensionSyncDetail(extSync),
          missingEnvKeys: [],
          yields: "Postingan publik, metrik tayang/suka/komentar, dan komentar tamu anonim yang disinkronkan lewat Ekstensi Chrome Sanghyang Market Sync.",
          documentationUrl: BUSINESS_DISCOVERY_DOCS,
        }
      : isResearchSessionNote || hasExplicitEmptyExtension
        ? {
            id: "instagram-business-discovery",
            label: "Instagram (Ekstensi Chrome)",
            state: "belum-dikonfigurasi",
            detail:
              "Sinkronisasi postingan dan komentar media sosial dikelola langsung dari peramban staf melalui Ekstensi Chrome Sanghyang Market Sync.",
            missingEnvKeys: [],
            yields: "Isi komentar tamu dan postingan publik dibaca lewat Ekstensi Chrome Sanghyang Market Sync dari peramban staf.",
            documentationUrl: BUSINESS_DISCOVERY_DOCS,
          }
        : {
            id: "instagram-business-discovery",
            label: "Instagram (Business Discovery)",
            state: "belum-dikonfigurasi",
            detail: `${fillText(igMissing)}. Token boleh dari akun Instagram profesional mana pun yang tersambung ke halaman Facebook.`,
            missingEnvKeys: igMissing,
            yields: "Postingan publik akun bisnis kompetitor: keterangan, waktu, jumlah suka dan komentar. Isi komentar tidak tersedia.",
            documentationUrl: BUSINESS_DISCOVERY_DOCS,
          };

  return [
    instagramStatus,
    {
      id: "tiktok-oembed",
      label: "TikTok oEmbed",
      state: targets.tiktokVideos ? "siap" : "tanpa-target",
      detail: targets.tiktokVideos
        ? `Siap tanpa kunci: ${targets.tiktokVideos} video yang tercatat diperiksa masih tersedia atau tidak.${sessionMode === "needs_login" ? " Pembaruan postingan dan komentar TikTok dikelola lewat Ekstensi Chrome Sanghyang Market Sync." : ""}`
        : "Belum ada target: tanpa kunci, tetapi belum ada URL video TikTok yang tercatat untuk diperiksa.",
      missingEnvKeys: [],
      yields: "Pemeriksaan video yang sudah tercatat masih tersedia. Keterangan, jumlah tonton, dan komentar tidak tersedia lewat oEmbed.",
      documentationUrl: TIKTOK_OEMBED_DOCS,
    },
  ];
}

function accountKeyFromPost(row: {
  source: string;
  competitorId: string;
  sourceUrl: string | null;
  description: string | null;
}): string {
  if (row.description?.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(row.description) as { account?: unknown };
      if (typeof parsed.account === "string" && parsed.account.trim()) {
        return `${row.source}:${parsed.account.trim().replace(/^@/, "").toLowerCase()}`;
      }
    } catch {
      // Abaikan deskripsi non-JSON; lanjut ekstrak handle dari URL sumber.
    }
  }
  if (row.sourceUrl) {
    const igMatch = row.sourceUrl.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/(?:p|reels?)\//i);
    if (igMatch) return `Instagram:${igMatch[1].toLowerCase()}`;
    const ttMatch = row.sourceUrl.match(/tiktok\.com\/@([A-Za-z0-9._-]+)\/(?:video|photo)\//i);
    if (ttMatch) return `TikTok:${ttMatch[1].toLowerCase()}`;
  }
  return `${row.source}:${row.competitorId}`;
}

/** Hitungan target dan ringkasan sinkronisasi Ekstensi Chrome dari DB lokal untuk socialSourceStatuses & scrapeSocialBuzz. */
export async function countSocialTargets(): Promise<SocialTargets> {
  const { db } = await import("../db");
  const [tiktokVideos, syncedPosts, latestSocialRun] = await Promise.all([
    db.competitorPromotion.count({
      where: { sourceUrl: { contains: "tiktok.com/@" }, AND: { sourceUrl: { contains: "/video/" } } },
    }),
    db.competitorPromotion.findMany({
      where: {
        category: { in: [OWN_SOCIAL_POST_CATEGORY, SOCIAL_POST_CATEGORY] },
        source: { in: ["Instagram", "TikTok"] },
      },
      select: { source: true, competitorId: true, sourceUrl: true, capturedAt: true, description: true },
    }),
    db.scrapeRun.findFirst({
      where: { job: "social", recordsSaved: { gt: 0 } },
      orderBy: { startedAt: "desc" },
      select: { status: true, startedAt: true, finishedAt: true },
    }),
  ]);

  let instagramPosts = 0;
  let tiktokPosts = 0;
  let latestCapturedMs = 0;
  const accounts = new Set<string>();
  for (const row of syncedPosts) {
    if (row.source === "Instagram") instagramPosts++;
    else if (row.source === "TikTok") tiktokPosts++;
    accounts.add(accountKeyFromPost(row));
    const ts = row.capturedAt.getTime();
    if (Number.isFinite(ts) && ts > latestCapturedMs) latestCapturedMs = ts;
  }

  const runTimeMs = latestSocialRun
    ? (latestSocialRun.finishedAt ?? latestSocialRun.startedAt).getTime()
    : 0;
  const newestMs = Math.max(latestCapturedMs, runTimeMs);
  const activeSyncRunning =
    latestSocialRun?.status === "running" &&
    newestMs > 0 &&
    Date.now() - newestMs <= ACTIVE_SYNC_RECENCY_MS;

  return {
    tiktokVideos,
    extensionSync: {
      instagramPosts,
      tiktokPosts,
      totalPosts: instagramPosts + tiktokPosts,
      trackedAccounts: accounts.size,
      latestSyncedAt: newestMs > 0 ? new Date(newestMs).toISOString() : null,
      latestRunStatus: latestSocialRun?.status ?? null,
      activeSyncRunning,
    },
  };
}
