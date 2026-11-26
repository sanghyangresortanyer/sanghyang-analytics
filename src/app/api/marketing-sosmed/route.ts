import { NextRequest, NextResponse } from "next/server";
import { invalidateTags, withCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL, INVALIDATION_GROUPS, PRIVATE_CACHE_CONTROL } from "@/lib/cache/tags";
import { db } from "@/lib/db";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";
import { getMetaConfig, loadAllInstagramPosts, META_RECENT_POSTS_PER_ACCOUNT } from "@/lib/marketing/meta-instagram";
import { findExistingSocialPromotion, instagramShortcodeFromUrl } from "@/lib/market/browser-social-sync";
import {
  CRAWLED_POSTS,
  CRAWLED_POSTS_SOURCE,
  INSTAGRAM_ACCOUNTS,
  OFFICIAL_SOCIAL_ACCOUNTS,
  evaluateSocialPromoPost,
  latestCapturePerPost,
  parseStoredSocialPost,
  type SocialPromoPostRecord,
} from "@/lib/market/marketing-sosmed";
import { isOutletKey, OUTLET_PLACE_IDS, type OutletKey } from "@/lib/market/outlet-filters";
import {
  archiveFeedPost,
  mergeSocialFeeds,
  metaToFeedPost,
  storedFeedPost,
  type MetaFeedStatus,
  type SocialFeedPost,
} from "@/lib/market/social-feed";

export const dynamic = "force-dynamic";

/** Postingan Instagram dari Graph API Meta beserta status sambungannya. */
interface MetaFeed {
  posts: SocialFeedPost[];
  status: MetaFeedStatus;
}

function parseCollabAccounts(description: string | null): string[] {
  if (!description?.trim().startsWith("{")) return [];
  try {
    const parsed = JSON.parse(description) as { collabAccounts?: unknown };
    if (!Array.isArray(parsed.collabAccounts)) return [];
    return parsed.collabAccounts
      .filter((h): h is string => typeof h === "string" && Boolean(h.trim()))
      .map((h) => h.trim().replace(/^@/, "").toLowerCase());
  } catch {
    return [];
  }
}

function dedupePostsByShortcode(rows: SocialFeedPost[]): SocialFeedPost[] {
  const byKey = new Map<string, SocialFeedPost>();
  const order: string[] = [];
  for (const post of rows) {
    const code = post.platform === "instagram" ? instagramShortcodeFromUrl(post.postUrl) : null;
    const key = code ? `ig:${code}` : post.postUrl;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, post);
      order.push(key);
      continue;
    }
    const mergedCollab = new Set<string>([...(prev.collabAccounts ?? []), ...(post.collabAccounts ?? [])]);
    const prevAcc = prev.account?.trim().replace(/^@/, "").toLowerCase();
    const curAcc = post.account?.trim().replace(/^@/, "").toLowerCase();
    if (curAcc && curAcc !== prevAcc) mergedCollab.add(curAcc);
    if (prevAcc) mergedCollab.delete(prevAcc);
    if (mergedCollab.size > 0) {
      prev.collabAccounts = [...mergedCollab].sort();
    }
  }
  return order.map((k) => byKey.get(k)!);
}

/**
 * Batas per entri Next.js Data Cache adalah 2 MB; 400 postingan ≈ 640 KB tanpa gambar. Tautan gambar dipotong 1.000
 * karakter saat sinkron, jadi tambahannya paling banyak 400 KB per potongan dan seluruh potongan tetap lolos cache.
 */
const SOSMED_CHUNK_SIZE = 400;
/** Bentuk data cache berubah (sumber, gambar, jam tayang): entri lama dengan kunci tanpa versi tidak dibaca lagi. */
const SOSMED_CACHE_VERSION = "feed-v2";

async function queryCombinedSosmedPosts(): Promise<SocialFeedPost[]> {
  // 1. Postingan akun resmi yang tersimpan: sinkron ekstensi (dengan angka pengikut saat itu) dan isian tim.
  const dbPosts = await db.competitorPromotion.findMany({
    where: { category: "Postingan Sosmed Tayang" },
    orderBy: [{ startsAt: "desc" }, { capturedAt: "desc" }],
    select: { id: true, title: true, description: true, startsAt: true, source: true, sourceUrl: true, imageUrl: true, createdAt: true, capturedAt: true },
  });
  const parsedWithCollab: SocialFeedPost[] = [];
  for (const row of latestCapturePerPost(dbPosts)) {
    const parsed = parseStoredSocialPost(row);
    if (!parsed) continue;
    parsedWithCollab.push(storedFeedPost(parsed, { imageUrl: row.imageUrl, collabAccounts: parseCollabAccounts(row.description) }));
  }
  const parsedDbPosts = dedupePostsByShortcode(parsedWithCollab);

  // 2. Gabungkan postingan tersimpan dari DB di urutan teratas, diikuti data crawl riil (dedup URL & shortcode IG)
  const dbUrls = new Set(parsedDbPosts.map((p) => p.postUrl));
  const dbIgCodes = new Set(
    parsedDbPosts.map((p) => instagramShortcodeFromUrl(p.postUrl)).filter((c): c is string => Boolean(c)),
  );
  return [
    ...parsedDbPosts,
    ...CRAWLED_POSTS.filter((p) => {
      if (dbUrls.has(p.postUrl)) return false;
      const code = instagramShortcodeFromUrl(p.postUrl);
      return !code || !dbIgCodes.has(code);
    }).map(archiveFeedPost),
  ];
}

async function loadCachedSosmedPosts(): Promise<SocialFeedPost[]> {
  // Singleflight lokal per permintaan: saat cache miss, DB tetap hanya dikueri 1 kali untuk mengisi seluruh chunk.
  let freshPromise: Promise<SocialFeedPost[]> | null = null;
  const getFresh = () => (freshPromise ??= queryCombinedSosmedPosts());

  const meta = await withCache(
    async () => ({ chunkCount: Math.ceil((await getFresh()).length / SOSMED_CHUNK_SIZE) }),
    ["mi-marketing-sosmed-meta", SOSMED_CACHE_VERSION],
    { tags: [CACHE_TAGS.marketingSosmed], revalidate: CACHE_TTL.marketingSosmed },
  );
  if (meta.chunkCount === 0) return [];
  const chunks = await Promise.all(
    Array.from({ length: meta.chunkCount }, (_, idx) =>
      withCache(
        async () => (await getFresh()).slice(idx * SOSMED_CHUNK_SIZE, (idx + 1) * SOSMED_CHUNK_SIZE),
        ["mi-marketing-sosmed-chunk", SOSMED_CACHE_VERSION, String(idx)],
        { tags: [CACHE_TAGS.marketingSosmed], revalidate: CACHE_TTL.marketingSosmed },
      ),
    ),
  );
  return chunks.flat();
}

/** Postingan terbaru tiap akun di portofolio Meta. Gagal baca menjadi `status.problem`, tidak pernah dilempar. */
async function loadMetaFeed(): Promise<MetaFeed> {
  const result = await loadAllInstagramPosts(process.env, { limit: META_RECENT_POSTS_PER_ACCOUNT });
  return {
    posts: result.posts.map(metaToFeedPost).filter((p): p is SocialFeedPost => p !== null),
    status: {
      keyInstalled: Boolean(getMetaConfig().token),
      connected: result.accounts.map((a) => a.username.toLowerCase()),
      unreadable: result.unreadable,
      problem: result.problem,
      perAccountLimit: META_RECENT_POSTS_PER_ACCOUNT,
    },
  };
}

// Route ini force-dynamic, jadi fetch Meta tidak tersimpan di cache fetch; tanpa cache ini setiap buka tab Media Sosial
// memanggil Graph API untuk daftar akun dan untuk tiap akun. Sinkron ekstensi dan isian tim mematikan tag yang sama.
const loadCachedMetaFeed = (): Promise<MetaFeed> =>
  withCache(loadMetaFeed, ["mi-marketing-sosmed-meta-feed", SOSMED_CACHE_VERSION], {
    tags: [CACHE_TAGS.marketingSosmed],
    revalidate: CACHE_TTL.marketingSosmed,
  });

/**
 * `loadMeta` kosong = GET tanpa Graph API Meta (uji route memakai DB lokal saja dan tidak boleh memanggil Meta).
 * Ekspor GET halaman memasang pemuat Meta ber-cache.
 */
export function createMarketingSosmedHandlers(checkAccess?: MarketingApiAccessGuard, loadMeta?: () => Promise<MetaFeed>) {
  return {
    async GET() {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      try {
        const [storedPosts, metaFeed] = await Promise.all([loadCachedSosmedPosts(), loadMeta ? loadMeta() : null]);
        return NextResponse.json(
          {
            success: true,
            posts: metaFeed ? mergeSocialFeeds(metaFeed.posts, storedPosts) : storedPosts,
            meta: metaFeed?.status ?? null,
            crawledSource: CRAWLED_POSTS_SOURCE,
            accounts: INSTAGRAM_ACCOUNTS,
            officialAccounts: OFFICIAL_SOCIAL_ACCOUNTS,
          },
          { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL.standard } },
        );
      } catch (error) {
        console.error("[api/marketing-sosmed] Galat GET postingan sosmed:", error);
        return NextResponse.json(
          {
            success: false,
            error: "Gagal mengambil data postingan media sosial.",
            detail: (error as Error).message,
          },
          { status: 500 }
        );
      }
    },

    async POST(request: NextRequest) {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload tidak valid." }, { status: 400 });
    }

    const {
      outletKey,
      platform = "instagram",
      postType = "reels",
      postedAt,
      postUrl,
      caption,
      metrics,
    } = body;

    if (!caption || typeof caption !== "string" || !caption.trim()) {
      return NextResponse.json(
        { error: "Caption postingan wajib diisi." },
        { status: 400 }
      );
    }

    // Tautan adalah identitas postingan (pembaruan OCC mencarinya) dan tombol "Buka" di kartu; tautan buatan tidak dipakai.
    if (typeof postUrl !== "string" || !/^https?:\/\/\S+$/.test(postUrl.trim())) {
      return NextResponse.json(
        { error: "Tautan postingan wajib diisi, misalnya https://www.instagram.com/p/..." },
        { status: 400 }
      );
    }
    const validatedOutlet: OutletKey = isOutletKey(outletKey) ? outletKey : "resort";
    const cleanPostUrl = postUrl.trim();
    const cleanPostedAt =
      typeof postedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(postedAt)
        ? postedAt
        : new Date().toISOString().slice(0, 10);

    const optMetric = (val: unknown) =>
      val === undefined || val === null || val === ""
        ? null
        : Number.isFinite(Number(val))
          ? Math.max(0, Math.round(Number(val)))
          : null;
    const candidateMetrics = {
      views: optMetric(metrics?.views),
      likes: optMetric(metrics?.likes),
      comments: optMetric(metrics?.comments),
      shares: optMetric(metrics?.shares),
      inquiriesWa: optMetric(metrics?.inquiriesWa),
    };
    const hasAnyMetric = Object.values(candidateMetrics).some((v) => v !== null);
    const safeMetrics = hasAnyMetric ? candidateMetrics : null;

    // Evaluasi skor copywriting dan hook secara transparan
    const audit = evaluateSocialPromoPost({
      outletKey: validatedOutlet,
      platform,
      postType,
      postedAt: cleanPostedAt,
      postUrl: cleanPostUrl,
      caption: caption.trim(),
      metrics: safeMetrics,
    });

    // Baris registri outlet itu sendiri. Pencarian nama "Sanghyang" dulu selalu mengembalikan baris resort.
    const competitor = await db.competitor.findFirst({
      where: { placeId: OUTLET_PLACE_IDS[validatedOutlet] },
    });

    if (!competitor) {
      return NextResponse.json(
        { error: `Kompetitor atau unit bisnis Sanghyang untuk outlet '${validatedOutlet}' tidak ditemukan di DB.` },
        { status: 404 }
      );
    }

    const existing =
      platform === "instagram" || platform === "tiktok"
        ? await findExistingSocialPromotion({
            sourceUrl: cleanPostUrl,
            platform,
            category: "Postingan Sosmed Tayang",
          })
        : await db.competitorPromotion.findFirst({
            where: { sourceUrl: cleanPostUrl, category: "Postingan Sosmed Tayang" },
            orderBy: [{ capturedAt: "desc" }, { version: "desc" }],
          });

    let prevMeta: Record<string, unknown> = {};
    if (existing?.description?.trim().startsWith("{")) {
      try {
        prevMeta = JSON.parse(existing.description) as Record<string, unknown>;
      } catch {
        prevMeta = {};
      }
    }
    const payloadDescription = JSON.stringify({
      ...(typeof prevMeta.account === "string" && prevMeta.account ? { account: prevMeta.account } : {}),
      ...(Array.isArray(prevMeta.collabAccounts) && prevMeta.collabAccounts.length > 0
        ? { collabAccounts: prevMeta.collabAccounts }
        : {}),
      ...(typeof prevMeta.followers === "number" ? { followers: prevMeta.followers } : {}),
      ...(typeof prevMeta.profilePostsTotal === "number" ? { profilePostsTotal: prevMeta.profilePostsTotal } : {}),
      outletKey: validatedOutlet,
      platform,
      postType,
      caption: caption.trim(),
      metrics: safeMetrics,
      audit,
    });

    let savedPromotion;
    if (existing) {
      // OCC Update dengan guard versi atomik
      const updated = await db.competitorPromotion.updateMany({
        where: { id: existing.id, version: existing.version },
        data: {
          competitorId: competitor.id,
          title: `[${postType.toUpperCase()}] ${caption.slice(0, 90).trim()}`,
          category: "Postingan Sosmed Tayang",
          description: payloadDescription,
          startsAt: new Date(`${cleanPostedAt}T00:00:00Z`),
          source: String(platform).charAt(0).toUpperCase() + String(platform).slice(1),
          sourceUrl: cleanPostUrl,
          capturedAt: new Date(),
          status: "changed",
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        return NextResponse.json(
          { success: false, error: "Konflik versi (OCC): postingan baru saja diubah pengguna lain. Muat ulang dan coba lagi." },
          { status: 409 },
        );
      }
      savedPromotion = await db.competitorPromotion.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      // OCC Insert: version 1
      savedPromotion = await db.competitorPromotion.create({
        data: {
          competitorId: competitor.id,
          title: `[${postType.toUpperCase()}] ${caption.slice(0, 90).trim()}`,
          category: "Postingan Sosmed Tayang",
          description: payloadDescription,
          startsAt: new Date(`${cleanPostedAt}T00:00:00Z`),
          source: String(platform).charAt(0).toUpperCase() + String(platform).slice(1),
          sourceUrl: cleanPostUrl,
          capturedAt: new Date(),
          status: "new",
          version: 1,
        },
      });
    }

    const savedRecord: SocialPromoPostRecord = {
      id: savedPromotion.id,
      outletKey: validatedOutlet,
      platform,
      postType,
      postedAt: cleanPostedAt,
      postUrl: cleanPostUrl,
      caption: caption.trim(),
      metrics: safeMetrics,
      createdAt: savedPromotion.createdAt.toISOString(),
      audit,
    };

    invalidateTags(INVALIDATION_GROUPS.forMarketingSosmedMutation());

    return NextResponse.json({
      success: true,
      message: "Postingan tayang berhasil disimpan secara permanen ke database.",
      post: savedRecord,
      version: savedPromotion.version,
    });
  } catch (error) {
    console.error("[api/marketing-sosmed] Galat POST simpan postingan sosmed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Gagal menyimpan postingan tayang ke database.",
        detail: (error as Error).message,
      },
      { status: 500 }
    );
  }
    },
  };
}

const handlers = createMarketingSosmedHandlers(undefined, loadCachedMetaFeed);
export const GET = handlers.GET;
export const POST = handlers.POST;
