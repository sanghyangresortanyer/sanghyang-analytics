import { describe, expect, it } from "vitest";
import type { InstagramMediaItem } from "@/lib/marketing/meta-instagram";
import crawled from "./marketing-sosmed.data.json";
import { evaluateSocialPromoPost, parseStoredSocialPost } from "./marketing-sosmed";
import { archiveFeedPost, mergeSocialFeeds, metaToFeedPost, storedFeedPost, type SocialFeedPost } from "./social-feed";

// Postingan asli dari pembacaan akun resmi 10 Nov 2026 (marketing-sosmed.data.json), dicari lewat shortcode-nya.
type CrawledPost = (typeof crawled.posts)[number];
function real(code: string): CrawledPost {
  const post = crawled.posts.find((p) => p.url.includes(`/${code}/`));
  if (!post) throw new Error(`postingan ${code} tidak ada di data baca 10 Nov`);
  return post;
}
const accountOf = (p: CrawledPost) => ("account" in p && p.account ? p.account : "sanghyangresort");

/** Bentuk satu media dari Graph API Meta untuk postingan asli itu, tayang pukul 10.00 WIB. */
function metaFrom(code: string, over: Partial<InstagramMediaItem> = {}): InstagramMediaItem {
  const p = real(code);
  const video = p.postType === "reels";
  return {
    id: `ig-${code}`,
    caption: p.caption,
    media_type: video ? "VIDEO" : "IMAGE",
    permalink: `https://www.instagram.com/${video ? "reel" : "p"}/${code}/`,
    timestamp: `${p.postedAt}T03:00:00+0000`,
    like_count: p.likes ?? undefined,
    comments_count: 0,
    outlet_username: accountOf(p),
    ...(video
      ? { thumbnail_url: `https://scontent.cdninstagram.com/${code}-thumb.jpg`, media_url: `https://scontent.cdninstagram.com/${code}.mp4` }
      : { media_url: `https://scontent.cdninstagram.com/${code}.jpg` }),
    ...over,
  };
}

/** Baris "Postingan Sosmed Tayang" seperti yang disimpan sinkron ekstensi (akun tercatat) atau isian tim (tanpa akun). */
function stored(
  code: string,
  { account, metrics = null, outletKey, url, imageUrl = null }: { account?: string; metrics?: Record<string, number | null> | null; outletKey?: string; url?: string; imageUrl?: string | null } = {},
): SocialFeedPost {
  const p = real(code);
  const parsed = parseStoredSocialPost({
    id: `row-${code}`,
    title: `[${p.postType.toUpperCase()}] ${p.caption.slice(0, 80)}`,
    description: JSON.stringify({
      outletKey: outletKey ?? "resort",
      platform: "instagram",
      postType: p.postType,
      caption: p.caption,
      metrics,
      ...(account ? { account } : {}),
    }),
    startsAt: new Date(`${p.postedAt}T00:00:00+07:00`),
    source: "Instagram",
    sourceUrl: url ?? p.url,
    createdAt: new Date("2026-11-20T02:00:00Z"),
    capturedAt: new Date("2026-11-20T02:00:00Z"),
  });
  if (!parsed) throw new Error("baris tanpa tautan");
  return storedFeedPost(parsed, { imageUrl });
}

describe("metaToFeedPost: postingan Graph API Meta menjadi kartu Media Sosial", () => {
  it("memetakan akun lewat INSTAGRAM_ACCOUNTS, menebak outlet postingan akun induk dari caption, dan menilai caption", () => {
    const spaPromo = metaToFeedPost(metaFrom("DfYxoUkPW4k"));
    expect(spaPromo).not.toBeNull();
    expect(spaPromo).toMatchObject({
      id: "meta:ig-DfYxoUkPW4k",
      // @sanghyangresort adalah akun induk: outletnya dibaca dari caption yang menyebut d’Spa.
      outletKey: "dspa",
      platform: "instagram",
      postType: "feed",
      postedAt: "2026-11-05",
      publishedAt: "2026-11-05T03:00:00.000Z",
      postUrl: "https://www.instagram.com/p/DfYxoUkPW4k/",
      account: "sanghyangresort",
      sources: ["meta"],
      imageUrl: "https://scontent.cdninstagram.com/DfYxoUkPW4k.jpg",
      metrics: { views: null, likes: 1, comments: 0, shares: null, inquiriesWa: null },
    });
    expect(spaPromo!.audit).toEqual(
      evaluateSocialPromoPost({
        outletKey: "dspa",
        platform: "instagram",
        postType: "feed",
        postedAt: "2026-11-05",
        postUrl: "https://www.instagram.com/p/DfYxoUkPW4k/",
        caption: real("DfYxoUkPW4k").caption,
        metrics: { views: null, likes: 1, comments: 0, shares: null, inquiriesWa: null },
        account: "sanghyangresort",
      }),
    );

    // Akun outlet tetap ke outletnya sendiri walau caption tidak menyebut nama outlet.
    const bistroReel = metaToFeedPost(metaFrom("DfhN_oYhKUF"));
    expect(bistroReel).toMatchObject({ outletKey: "dbistro", postType: "reels", account: "dbistro.anyer" });
    // Reels memakai thumbnail, bukan berkas videonya.
    expect(bistroReel!.imageUrl).toBe("https://scontent.cdninstagram.com/DfhN_oYhKUF-thumb.jpg");
    expect(metaToFeedPost(metaFrom("DfL-JyBhOvd"))!.outletKey).toBe("dragon-beach-club");
    // Akun lama @sunset_grillsanghyang tetap milik Sunset Grill.
    expect(metaToFeedPost(metaFrom("DfL-JyBhOvd", { outlet_username: "sunset_grillsanghyang", caption: "Live music malam ini" }))!.outletKey).toBe(
      "sunset-grill",
    );
  });

  it("memakai tanggal tayang WIB, jenis carousel, dan null untuk angka yang disembunyikan pemilik akun", () => {
    const lateNight = metaToFeedPost(metaFrom("DfYxoUkPW4k", { timestamp: "2026-11-04T18:30:00+0000" }));
    expect(lateNight!.postedAt).toBe("2026-11-05");
    expect(metaToFeedPost(metaFrom("DfYxoUkPW4k", { media_type: "CAROUSEL_ALBUM" }))!.postType).toBe("carousel");
    const hidden = metaToFeedPost(metaFrom("DfYxoUkPW4k", { like_count: undefined, comments_count: undefined }));
    expect(hidden!.metrics).toBeNull();
    expect(metaToFeedPost(metaFrom("DfYxoUkPW4k", { media_url: "http://scontent.cdninstagram.com/x.jpg" }))!.imageUrl).toBeNull();
    expect(metaToFeedPost(metaFrom("DfYxoUkPW4k", { timestamp: "bukan tanggal" }))).toBeNull();
  });
});

describe("storedFeedPost dan archiveFeedPost: label sumber data tersimpan", () => {
  it("baris dengan akun dari ekstensi, baris tanpa akun dari isian tim, gambar hanya HTTPS", () => {
    const synced = stored("DfYxoUkPW4k", { account: "sanghyangresort", imageUrl: "https://scontent.cdninstagram.com/lama.jpg" });
    expect(synced.sources).toEqual(["extension"]);
    expect(synced.imageUrl).toBe("https://scontent.cdninstagram.com/lama.jpg");
    expect(synced.publishedAt).toBeNull();
    const typed = stored("DfYxoUkPW4k", { imageUrl: "javascript:alert(1)" });
    expect(typed.sources).toEqual(["team"]);
    expect(typed.imageUrl).toBeNull();
    const archive = archiveFeedPost({ ...synced, id: real("DfYxoUkPW4k").url });
    expect(archive.sources).toEqual(["archive"]);
    expect(archive.imageUrl).toBeNull();
  });
});

describe("mergeSocialFeeds: satu kartu per postingan IG, Meta diutamakan", () => {
  it("menggabungkan tautan /akun/p/KODE/ ekstensi dengan permalink Meta, memakai suka dan komentar Meta, views dari ekstensi", () => {
    const ext = stored("DfYxoUkPW4k", {
      account: "sanghyangresort",
      outletKey: "dspa",
      metrics: { views: 512, likes: 0, comments: 0, shares: 2, inquiriesWa: 3 },
      imageUrl: "https://scontent.cdninstagram.com/kedaluwarsa.jpg",
    });
    const meta = metaToFeedPost(metaFrom("DfYxoUkPW4k", { like_count: 9, comments_count: 4 }))!;
    const [merged, ...rest] = mergeSocialFeeds([meta], [ext]);
    expect(rest).toEqual([]);
    expect(merged).toMatchObject({
      id: "row-DfYxoUkPW4k",
      sources: ["meta", "extension"],
      postUrl: "https://www.instagram.com/p/DfYxoUkPW4k/",
      postedAt: "2026-11-05",
      publishedAt: "2026-11-05T03:00:00.000Z",
      imageUrl: "https://scontent.cdninstagram.com/DfYxoUkPW4k.jpg",
      metrics: { views: 512, likes: 9, comments: 4, shares: 2, inquiriesWa: 3 },
    });
    // Skor dihitung ulang dengan angka gabungan: interaksi (9 + 4 + 2) dibagi 512 views.
    expect(merged.audit.engagementRatePercent).toBe(2.9);
    expect(merged.audit).toEqual(
      evaluateSocialPromoPost({
        outletKey: merged.outletKey,
        platform: "instagram",
        postType: merged.postType,
        postedAt: merged.postedAt,
        postUrl: merged.postUrl,
        caption: merged.caption,
        metrics: merged.metrics,
        account: merged.account,
      }),
    );
  });

  it("mempertahankan outlet dan akun dari data tersimpan, menyimpan gambar lama bila Meta tidak punya, dan tetap memuat yang hanya ada di satu sumber", () => {
    const ext = stored("DfL-JyBhOvd", {
      account: "dragonbeachclub",
      outletKey: "dbar",
      url: "https://www.instagram.com/dragonbeachclub/reel/DfL-JyBhOvd/",
      imageUrl: "https://scontent.cdninstagram.com/dbc.jpg",
    });
    const meta = metaToFeedPost(metaFrom("DfL-JyBhOvd", { thumbnail_url: undefined }))!;
    const extOnly = stored("DfeUWFsv-pk", { account: "sanghyangresort" });
    const metaOnly = metaToFeedPost(metaFrom("DfhN_oYhKUF"))!;
    const feed = mergeSocialFeeds([meta, metaOnly], [ext, extOnly]);
    expect(feed.map((p) => [p.id, p.sources.join("+")])).toEqual([
      ["row-DfL-JyBhOvd", "meta+extension"],
      ["row-DfeUWFsv-pk", "extension"],
      ["meta:ig-DfhN_oYhKUF", "meta"],
    ]);
    expect(feed[0]).toMatchObject({ outletKey: "dbar", account: "dragonbeachclub", imageUrl: "https://scontent.cdninstagram.com/dbc.jpg" });
  });

  it("satu postingan kolaborasi yang muncul di dua akun Meta menjadi satu kartu dengan akun kolaborator", () => {
    const owner = metaToFeedPost(metaFrom("DfhN_oYhKUF"))!;
    const collab = metaToFeedPost(metaFrom("DfhN_oYhKUF", { id: "ig-DfhN_oYhKUF-b", outlet_username: "sanghyangresort" }))!;
    const feed = mergeSocialFeeds([owner, collab], []);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ account: "dbistro.anyer", collabAccounts: ["sanghyangresort"], sources: ["meta"] });
  });

  it("isian tim yang juga terbaca di Meta berlabel Meta dan isian tim", () => {
    const typed = stored("DfYxoUkPW4k", { outletKey: "dspa" });
    const [merged] = mergeSocialFeeds([metaToFeedPost(metaFrom("DfYxoUkPW4k"))!], [typed]);
    expect(merged.sources).toEqual(["meta", "team"]);
    expect(merged.account).toBe("sanghyangresort");
  });
});
