import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FEED_PARSERS_PATH = path.resolve(process.cwd(), "extension/sanghyang-social-sync/feed-parsers.js");
const FEED_TAP_PATH = path.resolve(process.cwd(), "extension/sanghyang-social-sync/feed-tap.js");
const FIXED_NOW_MS = Date.parse("2026-11-25T05:00:00.000Z");

function loadFeedParsers() {
  delete require.cache[FEED_PARSERS_PATH];
  return require(FEED_PARSERS_PATH);
}

test("feed-parsers: allowlist endpoint IG & TikTok akurat, menolak endpoint non-publik, dan membersihkan query token", () => {
  const fp = loadFeedParsers();

  const igGraphql = fp.matchFeedEndpoint("https://www.instagram.com/graphql/query?doc_id=999&lsd=secret", "instagram");
  assert.equal(igGraphql.matched, true);
  assert.equal(igGraphql.platform, "instagram");
  assert.equal(igGraphql.sanitizedUrl, "https://www.instagram.com/graphql/query");

  const igFeed = fp.matchFeedEndpoint("https://www.instagram.com/api/v1/feed/user/123456789/username/?count=12", "instagram");
  assert.equal(igFeed.matched, true);
  assert.equal(igFeed.platform, "instagram");
  assert.equal(igFeed.sanitizedUrl, "https://www.instagram.com/api/v1/feed/user/123456789/username/");

  const igClips = fp.matchFeedEndpoint("https://www.instagram.com/api/v1/clips/user/", "instagram");
  assert.equal(igClips.matched, true);
  assert.equal(igClips.platform, "instagram");

  const igWebProfile = fp.matchFeedEndpoint("https://www.instagram.com/api/v1/users/web_profile_info/?username=sanghyangresort", "instagram");
  assert.equal(igWebProfile.matched, true);
  assert.equal(igWebProfile.platform, "instagram");
  assert.equal(igWebProfile.sanitizedUrl, "https://www.instagram.com/api/v1/users/web_profile_info/");

  const igRel = fp.matchFeedEndpoint("/graphql/query", "instagram");
  assert.equal(igRel.matched, true);
  assert.equal(igRel.platform, "instagram");

  const igApiGraphql = fp.matchFeedEndpoint("https://www.instagram.com/api/graphql", "instagram");
  assert.equal(igApiGraphql.matched, true);
  assert.equal(igApiGraphql.platform, "instagram");
  assert.equal(igApiGraphql.sanitizedUrl, "https://www.instagram.com/api/graphql");

  const igGraphqlRoot = fp.matchFeedEndpoint("https://www.instagram.com/graphql", "instagram");
  assert.equal(igGraphqlRoot.matched, true);
  assert.equal(igGraphqlRoot.platform, "instagram");

  const ttItemList = fp.matchFeedEndpoint(
    "https://www.tiktok.com/api/post/item_list/?secUid=abc&msToken=RAHASIA_TOKEN&X-Bogus=XYZ123",
    "tiktok",
  );
  assert.equal(ttItemList.matched, true);
  assert.equal(ttItemList.platform, "tiktok");
  assert.equal(ttItemList.sanitizedUrl, "https://www.tiktok.com/api/post/item_list/");
  assert.doesNotMatch(ttItemList.sanitizedUrl, /msToken|X-Bogus|RAHASIA/);

  const ttCreator = fp.matchFeedEndpoint("https://www.tiktok.com/api/creator/item_list/?cursor=0", "tiktok");
  assert.equal(ttCreator.matched, true);
  assert.equal(ttCreator.platform, "tiktok");

  const ttDetail = fp.matchFeedEndpoint("https://www.tiktok.com/api/item/detail/?itemId=7705662298588859700", "tiktok");
  assert.equal(ttDetail.matched, true);
  assert.equal(ttDetail.platform, "tiktok");

  const ttRel = fp.matchFeedEndpoint("/api/post/item_list/?count=30", "tiktok");
  assert.equal(ttRel.matched, true);
  assert.equal(ttRel.platform, "tiktok");

  // Endpoint yang wajib ditolak (bukan pagination publik atau domain asing / non-HTTPS)
  for (const rejected of [
    "https://www.instagram.com/api/v1/direct_v2/inbox/",
    "https://www.instagram.com/accounts/login/ajax/",
    "https://www.instagram.com/sanghyangresort/",
    "https://www.tiktok.com/api/comment/list/?aweme_id=123",
    "https://evil.example/graphql/query",
    "http://www.instagram.com/graphql/query",
    "",
  ]) {
    const res = fp.matchFeedEndpoint(rejected, "instagram");
    assert.equal(res.matched, false, `URL harus ditolak: ${rejected}`);
  }
});

test("feed-parsers: Instagram GraphQL modern (timeline v2 + clips v2 + collab eksternal + NDJSON + anti-XSSI)", () => {
  const fp = loadFeedParsers();

  const timelinePayload = {
    data: {
      xdt_api__v1__feed__user_timeline_graphql_connection: {
        edges: [
          {
            node: {
              code: "C_Photo001",
              media_type: 1,
              product_type: "feed",
              taken_at: 1763596800, // 2025-11-20T00:00:00.000Z
              caption: { text: "Sarapan tepi pantai di D'Bistro \ud800rusak" },
              image_versions2: {
                candidates: [{ url: "https://scontent.cdninstagram.com/v/photo1.jpg" }],
              },
              like_count: 148,
              comment_count: 12,
              reshare_count: 4,
              user: { username: "sanghyangresort" },
            },
          },
          {
            node: {
              code: "C_Reel002",
              media_type: 2,
              product_type: "clips",
              clips_metadata: { music_info: {} },
              taken_at: 1763683200,
              caption: { text: "Sunset Grill live music setiap Sabtu" },
              image_versions2: {
                candidates: [{ url: "https://scontent.cdninstagram.com/v/reel2.jpg" }],
              },
              play_count: 0,
              like_count: -1, // disembunyikan penulis -> wajib null
              comment_count: 0,
              share_count: 7,
              user: { username: "sanghyangresort" },
            },
          },
          {
            node: {
              code: "C_Caro003",
              media_type: 8,
              product_type: "carousel_container",
              taken_at: 1763769600,
              caption: { text: "Paket wedding eksternal kolaborasi" },
              carousel_media: [
                {
                  image_versions2: {
                    candidates: [{ url: "https://scontent.cdninstagram.com/v/collab3.jpg" }],
                  },
                },
              ],
              like_count: 320,
              comment_count: 19,
              user: { username: "wedding_partner_anyer" },
              coauthor_producers: [{ username: "sanghyangresort" }],
            },
          },
        ],
        page_info: { has_next_page: true, end_cursor: "CUR_1" },
      },
    },
  };

  const out = fp.extractFeedPayload(
    "https://www.instagram.com/graphql/query",
    `for (;;);${JSON.stringify(timelinePayload)}`,
    "instagram",
    FIXED_NOW_MS,
  );

  assert.equal(out.urlMatched, true);
  assert.equal(out.platform, "instagram");
  assert.equal(out.hasNextPage, true);
  assert.equal(out.items.length, 3);

  assert.deepEqual(out.items[0], {
    sourceUrl: "https://www.instagram.com/sanghyangresort/p/C_Photo001/",
    postType: "feed",
    postedAt: new Date(1763596800 * 1000).toISOString(),
    caption: "Sarapan tepi pantai di D'Bistro rusak",
    imageUrl: "https://scontent.cdninstagram.com/v/photo1.jpg",
    gridViews: null,
    gridLikes: 148,
    gridComments: 12,
    gridShares: 4,
    ownerHandle: "sanghyangresort",
  });

  assert.equal(out.items[1].sourceUrl, "https://www.instagram.com/sanghyangresort/reel/C_Reel002/");
  assert.equal(out.items[1].postType, "reels");
  assert.equal(out.items[1].gridViews, 0, "nilai views 0 valid wajib dipertahankan");
  assert.equal(out.items[1].gridLikes, null, "like_count -1 (disembunyikan) wajib jadi null");
  assert.equal(out.items[1].gridComments, 0);
  assert.equal(out.items[1].gridShares, 7);

  // Kolaborasi eksternal wajib diterima utuh dengan ownerHandle milik partner
  assert.equal(out.items[2].sourceUrl, "https://www.instagram.com/wedding_partner_anyer/p/C_Caro003/");
  assert.equal(out.items[2].postType, "carousel");
  assert.equal(out.items[2].imageUrl, "https://scontent.cdninstagram.com/v/collab3.jpg");
  assert.equal(out.items[2].ownerHandle, "wedding_partner_anyer");

  // Clips GraphQL v2 (node.media) + NDJSON + halaman terakhir (has_next_page: false)
  const clipsChunk1 = JSON.stringify({
    data: {
      xdt_api__v1__clips__user__connection_v2: {
        edges: [
          {
            node: {
              media: {
                code: "ClipV2_001",
                media_type: 2,
                product_type: "clips",
                taken_at: 1763856000,
                caption: { text: "Promo Grill malam Minggu" },
                image_versions2: { candidates: [{ url: "https://scontent.cdninstagram.com/v/clip1.jpg" }] },
                ig_play_count: 8420,
                like_count: 215,
                comment_count: 11,
                reshare_count: 18,
                user: { username: "sunsetgrillsanghyang" },
              },
            },
          },
        ],
        page_info: { has_next_page: false },
      },
    },
  });
  const unrelatedChunk2 = JSON.stringify({
    data: {
      xdt_api__v1__feed__reels_tray: { tray: [{ id: "story1" }] },
    },
  });

  const clipsOut = fp.extractFeedPayload(
    "https://www.instagram.com/graphql/query",
    `${clipsChunk1}\n${unrelatedChunk2}`,
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(clipsOut.hasNextPage, false);
  assert.equal(clipsOut.items.length, 1);
  assert.equal(clipsOut.items[0].sourceUrl, "https://www.instagram.com/sunsetgrillsanghyang/reel/ClipV2_001/");
  assert.equal(clipsOut.items[0].postType, "reels");
  assert.equal(clipsOut.items[0].gridViews, 8420);
  assert.equal(clipsOut.items[0].gridShares, 18);

  // Query GraphQL tidak terkait (notifikasi / discover / viewer) tidak boleh mencemari hasil atau hasNextPage
  const noiseOut = fp.extractFeedPayload(
    "https://www.instagram.com/graphql/query",
    {
      data: {
        xdt_api__v1__discover__chaining: {
          edges: [{ node: { code: "NOISE12345", user: { username: "orang_asing" } } }],
          page_info: { has_next_page: false },
        },
      },
    },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(noiseOut.urlMatched, true);
  assert.equal(noiseOut.items.length, 0);
  assert.equal(noiseOut.hasNextPage, null);
  assert.equal(noiseOut.profileMeta, null);
});

test("feed-parsers: Instagram Polaris 2026 (/api/graphql: polaris_ordered_timeline_connection, polaris_clips_connection, anti-lox_highlights, & TikTok 0-byte)", () => {
  const fp = loadFeedParsers();

  // 1. Feed profil Polaris 2026: data.xig_user_by_username.polaris_ordered_timeline_connection + all_media_count
  const polarisFeedJson = {
    data: {
      xig_user_by_username: {
        username: "sanghyangresort",
        follower_count: 15800,
        all_media_count: 1739,
        polaris_ordered_timeline_connection: {
          edges: [
            {
              node: {
                __typename: "XIGPolarisVideoMedia",
                code: "PolarisVid01",
                pk: "3500000000001",
                id: "POLARIS_3500000000001",
                media_type: 2,
                product_type: "clips",
                taken_at: 1763900000,
                caption: { text: "Pantai Sanghyang sore hari" },
                display_uri: "https://scontent.cdninstagram.com/v/polaris1.jpg",
                play_count: 12300,
                like_count: 410,
                comment_count: 23,
                user: { username: "sanghyangresort" },
              },
            },
          ],
          page_info: { has_next_page: true, end_cursor: "POL_CUR_1" },
        },
        // Story highlights di payload yang sama tidak boleh mencemari item maupun hasNextPage
        lox_highlights_connection: {
          edges: [{ node: { id: "highlight:1", title: "Rooms" } }],
          page_info: { has_next_page: false },
        },
      },
    },
  };

  const polarisFeedOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    polarisFeedJson,
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(polarisFeedOut.urlMatched, true);
  assert.equal(polarisFeedOut.hasNextPage, true, "hasNextPage wajib ikut polaris_ordered_timeline_connection, bukan lox_highlights_connection");
  assert.deepEqual(polarisFeedOut.profileMeta, { followers: 15800, posts: 1739 });
  assert.equal(polarisFeedOut.items.length, 1);
  assert.equal(polarisFeedOut.items[0].sourceUrl, "https://www.instagram.com/sanghyangresort/reel/PolarisVid01/");
  assert.equal(polarisFeedOut.items[0].postType, "reels");
  assert.equal(polarisFeedOut.items[0].imageUrl, "https://scontent.cdninstagram.com/v/polaris1.jpg");
  assert.equal(polarisFeedOut.items[0].gridViews, 12300);

  // 2. Tab Reels live POST /api/graphql: data.node.polaris_clips_connection (tanpa media_type & tanpa user.username!)
  const polarisReelsJson = {
    data: {
      node: {
        __typename: "User",
        polaris_clips_connection: {
          edges: [
            {
              node: {
                code: "PolReelNoUser1",
                pk: "3500000000002",
                product_type: "clips",
                play_count: 4920,
                like_count: 132,
                comment_count: 8,
                display_uri: "https://scontent.cdninstagram.com/v/polaris_reel.jpg",
                user: { pk: "123456", user_dict: { views_on_grid_status: "VISIBLE" } },
              },
            },
          ],
          page_info: { has_next_page: false, end_cursor: "REEL_END" },
        },
      },
    },
  };
  const polarisReelsOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    polarisReelsJson,
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(polarisReelsOut.urlMatched, true);
  assert.equal(polarisReelsOut.hasNextPage, false);
  assert.equal(polarisReelsOut.items.length, 1, "item polaris_clips_connection tanpa user.username tidak boleh dibuang");
  assert.equal(polarisReelsOut.items[0].sourceUrl, "https://www.instagram.com/reel/PolReelNoUser1/");
  assert.equal(polarisReelsOut.items[0].postType, "reels");
  assert.equal(polarisReelsOut.items[0].ownerHandle, null);
  assert.equal(polarisReelsOut.items[0].gridViews, 4920);
  assert.equal(polarisReelsOut.items[0].gridLikes, 132);
  assert.equal(polarisReelsOut.items[0].gridComments, 8);
  assert.equal(polarisReelsOut.items[0].imageUrl, "https://scontent.cdninstagram.com/v/polaris_reel.jpg");

  // 3. Query Story Highlights murni (lox_highlights_connection saja) wajib diabaikan 100%
  const highlightsOnlyOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    {
      data: {
        xig_user_by_username: {
          lox_highlights_connection: {
            edges: [{ node: { code: "NotAPost99", title: "Promo" } }],
            page_info: { has_next_page: true },
          },
        },
      },
    },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(highlightsOnlyOut.items.length, 0);
  assert.equal(highlightsOnlyOut.hasNextPage, null, "lox_highlights_connection tidak boleh menyentuh hasNextPage");

  // 4. TikTok HTTP 200 dengan body 0 byte saat CAPTCHA aktif -> aman, items kosong, hasNextPage null
  const emptyTt = fp.extractFeedPayload("https://www.tiktok.com/api/post/item_list/?count=30", "", "tiktok", FIXED_NOW_MS);
  assert.equal(emptyTt.urlMatched, true);
  assert.deepEqual(emptyTt.items, []);
  assert.equal(emptyTt.hasNextPage, null);
});

test("feed-parsers: Instagram GraphQL klasik (web_profile_info) dan REST v1 (feed/user & clips/user)", () => {
  const fp = loadFeedParsers();

  const webProfileJson = {
    data: {
      user: {
        username: "sanghyangresort",
        edge_followed_by: { count: 14250 },
        edge_owner_to_timeline_media: {
          count: 1739,
          page_info: { has_next_page: true, end_cursor: "END1" },
          edges: [
            {
              node: {
                __typename: "GraphSidecar",
                shortcode: "ClassicCaro1",
                taken_at_timestamp: 1763510400,
                display_url: "https://scontent.cdninstagram.com/v/classic1.jpg",
                edge_media_to_caption: { edges: [{ node: { text: "Galeri kamar deluxe" } }] },
                edge_liked_by: { count: 95 },
                edge_media_to_comment: { count: 6 },
                owner: { username: "sanghyangresort" },
              },
            },
            {
              node: {
                __typename: "GraphVideo",
                shortcode: "ClassicClip2",
                product_type: "clips",
                taken_at_timestamp: 1763424000,
                thumbnail_src: "https://scontent.cdninstagram.com/v/classic2.jpg",
                edge_media_to_caption: { edges: [{ node: { text: "Tur kolam renang" } }] },
                video_view_count: 5400,
                edge_media_preview_like: { count: 180 },
                edge_media_to_comment: { count: 14 },
                owner: { username: "sanghyangresort" },
              },
            },
          ],
        },
      },
    },
  };

  const wpOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/v1/users/web_profile_info/?username=sanghyangresort",
    webProfileJson,
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(wpOut.urlMatched, true);
  assert.equal(wpOut.hasNextPage, true);
  assert.deepEqual(wpOut.profileMeta, { followers: 14250, posts: 1739 });
  assert.equal(wpOut.items.length, 2);
  assert.equal(wpOut.items[0].postType, "carousel");
  assert.equal(wpOut.items[0].sourceUrl, "https://www.instagram.com/sanghyangresort/p/ClassicCaro1/");
  assert.equal(wpOut.items[0].gridLikes, 95);
  assert.equal(wpOut.items[1].postType, "reels");
  assert.equal(wpOut.items[1].sourceUrl, "https://www.instagram.com/sanghyangresort/reel/ClassicClip2/");
  assert.equal(wpOut.items[1].gridViews, 5400);
  assert.equal(wpOut.items[1].gridLikes, 180);

  // REST /api/v1/feed/user/ dengan device_timestamp mikrodetik & tanpa ownerHandle
  const restFeedJson = {
    items: [
      {
        code: "RestPost01",
        media_type: 1,
        device_timestamp: 1763337600123456, // mikrodetik -> 1763337600123 ms
        caption: { text: "Pemandangan Selat Sunda" },
        image_versions2: { candidates: [{ url: "http://insecure.example/x.jpg" }, { url: "https://cdn.instagram.com/safe.jpg" }] },
        like_count: 42,
        comment_count: 3,
      },
    ],
    more_available: false,
    user: { follower_count: 3100, media_count: 240 },
  };
  const restFeedOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/v1/feed/user/998877/username/",
    restFeedJson,
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(restFeedOut.hasNextPage, false);
  assert.deepEqual(restFeedOut.profileMeta, { followers: 3100, posts: 240 });
  assert.equal(restFeedOut.items.length, 1);
  assert.equal(restFeedOut.items[0].sourceUrl, "https://www.instagram.com/p/RestPost01/");
  assert.equal(restFeedOut.items[0].postedAt, new Date(1763337600123).toISOString());
  assert.equal(restFeedOut.items[0].imageUrl, "https://cdn.instagram.com/safe.jpg", "harus lewati URL http non-HTTPS dan ambil kandidat HTTPS");

  // REST /api/v1/clips/user/ dengan item.media & paging_info.more_available
  const restClipsJson = {
    items: [
      {
        media: {
          code: "RestClip99",
          media_type: 2,
          taken_at: 1763251200,
          caption: { text: "Reels Sunset" },
          view_count: 9100,
          like_count: 310,
          comment_count: 22,
          user: { username: "sanghyangresort" },
        },
      },
    ],
    paging_info: { more_available: true, max_id: "MAX_1" },
  };
  const restClipsOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/v1/clips/user/",
    restClipsJson,
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(restClipsOut.hasNextPage, true);
  assert.equal(restClipsOut.items.length, 1);
  assert.equal(restClipsOut.items[0].postType, "reels");
  assert.equal(restClipsOut.items[0].sourceUrl, "https://www.instagram.com/sanghyangresort/reel/RestClip99/");
  assert.equal(restClipsOut.items[0].gridViews, 9100);
});

test("feed-parsers: TikTok item_list, creator/item_list, item/detail, photo carousel, Snowflake fallback, dan hasMore boolean ketat", () => {
  const fp = loadFeedParsers();

  const itemListJson = {
    hasMore: true,
    cursor: "1763000000000",
    itemList: [
      {
        id: "7705662298588859700",
        desc: "Sunset di Anyer hari ini #sanghyang",
        createTime: 1762578312,
        author: { uniqueId: "sunsetgrill.sanghyang" },
        authorStats: { followerCount: 4820, videoCount: 87 },
        video: { cover: "https://p16-sign-sg.tiktokcdn.com/cover1.jpeg" },
        stats: { playCount: 15200, diggCount: 640, commentCount: 28, shareCount: 51 },
      },
      {
        id: "7705662298588859701",
        desc: "Slide foto menu baru D'Bistro",
        // Tanpa createTime -> wajib jatuh ke Snowflake (BigInt(id) >> 32n = 1794114312 -> 2026-11-08T05:05:12.000Z)
        author: { uniqueId: "sunsetgrill.sanghyang" },
        imagePost: {
          cover: { imageURL: { urlList: ["https://p16-sign-sg.tiktokcdn.com/photo-cover.jpeg"] } },
          images: [{ imageURL: { urlList: ["https://p16-sign-sg.tiktokcdn.com/photo1.jpeg"] } }],
        },
        statsV2: { playCount: "3400", diggCount: "120", commentCount: "0", shareCount: "9" },
      },
    ],
  };

  const ttOut = fp.extractFeedPayload(
    "https://www.tiktok.com/api/post/item_list/?count=30&msToken=SENSITIVE",
    itemListJson,
    "tiktok",
    FIXED_NOW_MS,
  );
  assert.equal(ttOut.urlMatched, true);
  assert.equal(ttOut.platform, "tiktok");
  assert.equal(ttOut.hasNextPage, true);
  assert.deepEqual(ttOut.profileMeta, { followers: 4820, posts: 87 });
  assert.equal(ttOut.items.length, 2);

  assert.deepEqual(ttOut.items[0], {
    sourceUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
    postType: "tiktok_video",
    postedAt: new Date(1762578312 * 1000).toISOString(),
    caption: "Sunset di Anyer hari ini #sanghyang",
    imageUrl: "https://p16-sign-sg.tiktokcdn.com/cover1.jpeg",
    gridViews: 15200,
    gridLikes: 640,
    gridComments: 28,
    gridShares: 51,
    ownerHandle: "sunsetgrill.sanghyang",
  });

  assert.equal(ttOut.items[1].sourceUrl, "https://www.tiktok.com/@sunsetgrill.sanghyang/photo/7705662298588859701");
  assert.equal(ttOut.items[1].postType, "carousel");
  assert.equal(ttOut.items[1].postedAt, "2026-11-08T05:05:12.000Z");
  assert.equal(ttOut.items[1].imageUrl, "https://p16-sign-sg.tiktokcdn.com/photo-cover.jpeg");
  assert.equal(ttOut.items[1].gridViews, 3400);
  assert.equal(ttOut.items[1].gridLikes, 120);
  assert.equal(ttOut.items[1].gridComments, 0);
  assert.equal(ttOut.items[1].gridShares, 9);

  // hasMore: false -> hasNextPage: false; hasMore tidak ada -> hasNextPage: null (JANGAN pernah false diam-diam)
  const lastPage = fp.extractFeedPayload(
    "https://www.tiktok.com/api/creator/item_list/?cursor=999",
    { hasMore: false, itemList: [] },
    "tiktok",
    FIXED_NOW_MS,
  );
  assert.equal(lastPage.hasNextPage, false);

  const unknownMore = fp.extractFeedPayload(
    "https://www.tiktok.com/api/post/item_list/",
    { itemList: [] },
    "tiktok",
    FIXED_NOW_MS,
  );
  assert.equal(unknownMore.hasNextPage, null);

  // /api/item/detail/
  const detailOut = fp.extractFeedPayload(
    "https://www.tiktok.com/api/item/detail/?itemId=7705662298588859700",
    {
      itemInfo: {
        itemStruct: {
          id: "7705662298588859700",
          desc: "Detail video resmi",
          createTime: "1762578312",
          author: { uniqueId: "mambruk_official" },
          video: { cover: "https://p16-sign-sg.tiktokcdn.com/detail.jpeg" },
          stats: { playCount: 880, diggCount: 40, commentCount: 2, shareCount: 5 },
        },
      },
    },
    "tiktok",
    FIXED_NOW_MS,
  );
  assert.equal(detailOut.hasNextPage, null);
  assert.equal(detailOut.items.length, 1);
  assert.equal(detailOut.items[0].sourceUrl, "https://www.tiktok.com/@mambruk_official/video/7705662298588859700");
  assert.equal(detailOut.items[0].gridViews, 880);

  // TikTok Photo Mode 2026: desc kosong tapi imagePost.title terisi + gambar hanya di imagePost.images[0].imageURL.urlList
  const photoModeOut = fp.extractFeedPayload(
    "https://www.tiktok.com/api/item/detail/?itemId=7703084124281703698",
    {
      itemInfo: {
        itemStruct: {
          id: "7703084124281703698",
          desc: "",
          author: { uniqueId: "sanghyangsparesort" },
          imagePost: {
            title: "Suasana Pagi Pantai Sanghyang Anyer",
            images: [
              { imageURL: { urlList: ["http://insecure.example/skip.jpg", "https://p16-sign-sg.tiktokcdn.com/slide1.jpeg"] } },
            ],
          },
          statsV2: { playCount: "2150", diggCount: "88", commentCount: "4", shareCount: "6" },
        },
      },
    },
    "tiktok",
    FIXED_NOW_MS,
  );
  assert.equal(photoModeOut.items.length, 1);
  assert.equal(photoModeOut.items[0].sourceUrl, "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698");
  assert.equal(photoModeOut.items[0].postType, "carousel");
  assert.equal(photoModeOut.items[0].caption, "Suasana Pagi Pantai Sanghyang Anyer");
  assert.equal(photoModeOut.items[0].imageUrl, "https://p16-sign-sg.tiktokcdn.com/slide1.jpeg");
  assert.ok(photoModeOut.items[0].postedAt, "postedAt wajib jatuh ke Snowflake ID 64-bit ketika createTime kosong");
  assert.equal(photoModeOut.items[0].gridViews, 2150);
  assert.equal(photoModeOut.items[0].gridLikes, 88);
});

test("feed-parsers: tahan JSON rusak/berbahaya, bebas kunci rahasia/rawHtml, dan mendukung clean chunk re-validation", () => {
  const fp = loadFeedParsers();

  // JSON rusak tidak melempar error
  const broken = fp.extractFeedPayload("https://www.instagram.com/graphql/query", "{bukan json valid", "instagram", FIXED_NOW_MS);
  assert.equal(broken.urlMatched, true);
  assert.deepEqual(broken.items, []);
  assert.equal(broken.hasNextPage, null);

  // Payload penuh bidang rahasia/rawHtml -> tidak boleh ada satu pun yang tembus ke keluaran
  const adversarial = {
    cookie: "sessionid=SENSITIVE_COOKIE",
    authorization: "Bearer SECRET_BEARER",
    csrftoken: "SECRET_CSRF",
    rawHtml: "<html><body>RAHASIA</body></html>",
    data: {
      xdt_api__v1__feed__user_timeline_graphql_connection: {
        edges: [
          {
            node: {
              code: "SafeCode01",
              media_type: 1,
              taken_at: 1763596800,
              caption: { text: "Aman" },
              image_versions2: { candidates: [{ url: "https://scontent.cdninstagram.com/safe.jpg" }] },
              like_count: 10,
              comment_count: 1,
              user: { username: "sanghyangresort", sessionid: "LEAK", token: "LEAK" },
              rawHtml: "<div>NO</div>",
            },
          },
        ],
        page_info: { has_next_page: false },
      },
    },
  };
  const safeOut = fp.extractFeedPayload("https://www.instagram.com/graphql/query", adversarial, "instagram", FIXED_NOW_MS);
  const serialized = JSON.stringify(safeOut);
  assert.doesNotMatch(serialized, /SENSITIVE_COOKIE|SECRET_BEARER|SECRET_CSRF|rawHtml|sessionid|authorization|csrftoken|LEAK/i);
  assert.equal(safeOut.items.length, 1);

  // Re-validasi clean chunk dari feed-tap.js lewat extractFeedPayload & parseChunkEventDetail
  const cleanChunk = {
    __sanghyangCleanChunk: true,
    version: 1,
    platform: "instagram",
    url: "https://www.instagram.com/graphql/query",
    pageHref: "https://www.instagram.com/sanghyangresort/",
    capturedAt: FIXED_NOW_MS,
    hasNextPage: true,
    profileMeta: { followers: 14000, posts: 1739 },
    items: safeOut.items,
    cookie: "SHOULD_BE_DROPPED",
    rawHtml: "<p>DROP</p>",
  };
  const revalidated = fp.extractFeedPayload(cleanChunk.url, cleanChunk, "instagram", FIXED_NOW_MS);
  assert.equal(revalidated.urlMatched, true);
  assert.equal(revalidated.hasNextPage, true);
  assert.deepEqual(revalidated.profileMeta, { followers: 14000, posts: 1739 });
  assert.equal(revalidated.items.length, 1);
  assert.equal(revalidated.items[0].sourceUrl, "https://www.instagram.com/sanghyangresort/p/SafeCode01/");
  assert.doesNotMatch(JSON.stringify(revalidated), /SHOULD_BE_DROPPED|rawHtml|cookie/i);

  const parsedDetail = fp.parseChunkEventDetail(JSON.stringify(cleanChunk), FIXED_NOW_MS);
  assert.ok(parsedDetail);
  assert.equal(parsedDetail.pageHref, "https://www.instagram.com/sanghyangresort/");
  assert.equal(parsedDetail.items.length, 1);
  assert.doesNotMatch(JSON.stringify(parsedDetail), /SHOULD_BE_DROPPED|rawHtml|cookie/i);
});

test("feed-tap.js: pengamat pasif fetch & XHR di MAIN world, replay terfilter pageHref, reset, batas 500 chunk, idempoten, & audit keamanan statis", async () => {
  const tapSrc = fs.readFileSync(FEED_TAP_PATH, "utf8");
  const parsersSrc = fs.readFileSync(FEED_PARSERS_PATH, "utf8");

  // 1. Audit keamanan statis bebas BOM & bebas akses rahasia/HTML mentah
  for (const [label, fullPath, src] of [
    ["feed-tap.js", FEED_TAP_PATH, tapSrc],
    ["feed-parsers.js", FEED_PARSERS_PATH, parsersSrc],
  ]) {
    const rawBytes = fs.readFileSync(fullPath);
    assert.equal(rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf, false, `${label} wajib bebas UTF-8 BOM`);
    assert.doesNotMatch(
      src,
      /document\.cookie|authorization|x-csrftoken|getResponseHeader|getAllResponseHeaders|rawHtml|innerHTML|outerHTML|\beval\s*\(|new\s+Function/i,
      `${label} tidak boleh mengakses cookie/header rahasia/rawHtml/eval`,
    );
  }

  // 2. Simulasi lingkungan MAIN world Chrome
  const eventTarget = new EventTarget();
  const receivedEvents: Array<{ type: string; detail: unknown }> = [];
  eventTarget.addEventListener("__sanghyang_feed_chunk__", (ev) => {
    const ce = ev as CustomEvent;
    receivedEvents.push({ type: ce.type, detail: ce.detail });
  });

  const fetchCalls: Array<{ input: unknown; init: unknown; cloned: boolean }> = [];
  const nextFetchPayloads = new Map<string, { ok: boolean; body: string }>();

  const origFetch = async (input: unknown, init?: unknown) => {
    const urlStr = typeof input === "string" ? input : String((input as { url?: string })?.url || "");
    const record = { input, init, cloned: false };
    fetchCalls.push(record);
    const entry = nextFetchPayloads.get(urlStr) || { ok: true, body: "{}" };
    const makeResp = () => ({
      ok: entry.ok,
      status: entry.ok ? 200 : 500,
      text: async () => entry.body,
      json: async () => JSON.parse(entry.body),
      clone: () => {
        record.cloned = true;
        return makeResp();
      },
    });
    return makeResp();
  };

  const xhrOpenCalls: unknown[][] = [];
  const xhrSendCalls: unknown[][] = [];
  class FakeXMLHttpRequest extends EventTarget {
    status = 200;
    responseType = "";
    responseText = "";
    response: unknown = null;
    private _url = "";
    open(method: string, url: string, ...rest: unknown[]) {
      this._url = url;
      xhrOpenCalls.push([method, url, ...rest]);
    }
    send(body?: unknown) {
      xhrSendCalls.push([body]);
      const entry = nextFetchPayloads.get(this._url);
      if (entry) {
        this.status = entry.ok ? 200 : 500;
        this.responseText = entry.body;
        this.dispatchEvent(new Event("load"));
      }
    }
  }

  class FakeCustomEvent extends Event {
    detail: unknown;
    constructor(type: string, opts?: { detail?: unknown }) {
      super(type);
      this.detail = opts?.detail;
    }
  }

  const sandboxWindow: Record<string, unknown> = {
    location: { href: "https://www.instagram.com/sanghyangresort/?hl=id", origin: "https://www.instagram.com", hostname: "www.instagram.com", pathname: "/sanghyangresort/" },
    fetch: origFetch,
    XMLHttpRequest: FakeXMLHttpRequest,
    CustomEvent: FakeCustomEvent,
    Event,
    URL,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  };
  sandboxWindow.window = sandboxWindow;
  sandboxWindow.self = sandboxWindow;
  sandboxWindow.globalThis = sandboxWindow;

  const ctx = vm.createContext(sandboxWindow);
  vm.runInContext(tapSrc, ctx);
  // Jalankan ulang sekali lagi untuk membuktikan idempoten (tidak double-wrap)
  vm.runInContext(tapSrc, ctx);

  // a. Fetch endpoint non-allowlist tidak boleh disentuh maupun di-clone
  const ignoredInit = { method: "POST", headers: { "x-test": "1" }, body: "raw-body" };
  nextFetchPayloads.set("https://www.instagram.com/api/v1/direct_v2/inbox/", { ok: true, body: '{"inbox":{}}' });
  const ignoredRes = await (sandboxWindow.fetch as typeof origFetch)(
    "https://www.instagram.com/api/v1/direct_v2/inbox/",
    ignoredInit,
  );
  assert.equal(await ignoredRes.text(), '{"inbox":{}}');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init, ignoredInit, "init fetch tidak boleh dimodifikasi/diganti");
  assert.equal(fetchCalls[0].cloned, false, "endpoint non-allowlist tidak boleh di-clone");
  assert.equal(receivedEvents.length, 0);

  // b. Fetch endpoint IG /graphql/query (sebelum content-social.js siap -> masuk buffer & pancarkan JSON string)
  const graphqlBody = JSON.stringify({
    data: {
      xdt_api__v1__feed__user_timeline_graphql_connection: {
        edges: [
          {
            node: {
              code: "TapIG_001",
              media_type: 1,
              taken_at: 1763596800,
              caption: { text: "Tangkapan pasif pertama" },
              image_versions2: { candidates: [{ url: "https://scontent.cdninstagram.com/tap1.jpg" }] },
              like_count: 55,
              comment_count: 4,
              user: { username: "sanghyangresort" },
            },
          },
        ],
        page_info: { has_next_page: true },
      },
    },
  });
  const graphqlInit = { method: "POST", body: "variables=%7B%7D" };
  nextFetchPayloads.set("https://www.instagram.com/graphql/query?doc_id=1", { ok: true, body: graphqlBody });
  const gqlRes = await (sandboxWindow.fetch as typeof origFetch)("https://www.instagram.com/graphql/query?doc_id=1", graphqlInit);
  // Pemanggil asli tetap menerima body utuh
  assert.equal(await gqlRes.text(), graphqlBody);
  assert.equal(fetchCalls[1].init, graphqlInit, "argumen fetch harus diteruskan utuh tanpa modifikasi");
  // Tunggu microtask clone().text()
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(receivedEvents.length, 1, "idempoten: harus memancarkan tepat 1 event, bukan 2");
  assert.equal(typeof receivedEvents[0].detail, "string", "detail wajib string JSON agar aman lintas MAIN <-> ISOLATED");
  const parsedEv1 = JSON.parse(receivedEvents[0].detail as string);
  assert.equal(parsedEv1.platform, "instagram");
  assert.equal(parsedEv1.url, "https://www.instagram.com/graphql/query");
  assert.equal(parsedEv1.pageHref, "https://www.instagram.com/sanghyangresort/");
  assert.equal(parsedEv1.hasNextPage, true);
  assert.equal(parsedEv1.items.length, 1);
  assert.equal(parsedEv1.items[0].sourceUrl, "https://www.instagram.com/sanghyangresort/p/TapIG_001/");
  assert.equal((sandboxWindow.__sanghyangFeedBuffer as unknown[]).length, 1);

  // b2. Fetch POST /api/graphql Polaris 2026 (polaris_clips_connection) juga tertangkap di feed-tap.js
  const polarisApiBody = JSON.stringify({
    data: {
      node: {
        __typename: "User",
        polaris_clips_connection: {
          edges: [
            {
              node: {
                code: "TapPolaris01",
                product_type: "clips",
                play_count: 7777,
                like_count: 99,
                comment_count: 5,
                display_uri: "https://scontent.cdninstagram.com/tap_polaris.jpg",
              },
            },
          ],
          page_info: { has_next_page: true },
        },
      },
    },
  });
  nextFetchPayloads.set("https://www.instagram.com/api/graphql", { ok: true, body: polarisApiBody });
  const polRes = await (sandboxWindow.fetch as typeof origFetch)("https://www.instagram.com/api/graphql", { method: "POST" });
  assert.equal(await polRes.text(), polarisApiBody);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(receivedEvents.length, 2, "POST /api/graphql Polaris wajib memancarkan chunk bersih");
  const parsedPol = JSON.parse(receivedEvents[1].detail as string);
  assert.equal(parsedPol.url, "https://www.instagram.com/api/graphql");
  assert.equal(parsedPol.items[0].sourceUrl, "https://www.instagram.com/reel/TapPolaris01/");
  assert.equal(parsedPol.items[0].gridViews, 7777);

  // c. XHR pasif pada halaman TikTok (termasuk pembersihan msToken dari URL & body 0 byte aman diabaikan)
  sandboxWindow.location = {
    href: "https://www.tiktok.com/@sunsetgrill.sanghyang?lang=id",
    origin: "https://www.tiktok.com",
    hostname: "www.tiktok.com",
    pathname: "/@sunsetgrill.sanghyang",
  };
  const ttEmptyUrl = "https://www.tiktok.com/api/post/item_list/?count=30&captcha=1";
  nextFetchPayloads.set(ttEmptyUrl, { ok: true, body: "" });
  const emptyXhr = new (sandboxWindow.XMLHttpRequest as typeof FakeXMLHttpRequest)();
  emptyXhr.open("GET", ttEmptyUrl, true);
  emptyXhr.send(null);
  assert.equal(receivedEvents.length, 2, "body 0 byte TikTok saat CAPTCHA tidak boleh memancarkan event atau crash");

  const ttBody = JSON.stringify({
    hasMore: false,
    itemList: [
      {
        id: "7705662298588859700",
        desc: "TikTok pasif XHR",
        createTime: 1762578312,
        author: { uniqueId: "sunsetgrill.sanghyang" },
        video: { cover: "https://p16-sign-sg.tiktokcdn.com/xhr1.jpeg" },
        stats: { playCount: 999, diggCount: 80, commentCount: 5, shareCount: 3 },
      },
    ],
  });
  const ttUrl = "https://www.tiktok.com/api/post/item_list/?count=30&msToken=SHOULD_STRIP";
  nextFetchPayloads.set(ttUrl, { ok: true, body: ttBody });
  const xhr = new (sandboxWindow.XMLHttpRequest as typeof FakeXMLHttpRequest)();
  xhr.open("GET", ttUrl, true);
  xhr.send(null);

  assert.equal(xhrOpenCalls.length, 2);
  assert.equal(xhrOpenCalls[1][1], ttUrl, "XHR open URL asli tidak boleh diubah");
  assert.equal(xhr.responseText, ttBody, "XHR responseText asli tetap utuh");
  assert.equal(receivedEvents.length, 3);
  const parsedEv2 = JSON.parse(receivedEvents[2].detail as string);
  assert.equal(parsedEv2.platform, "tiktok");
  assert.equal(parsedEv2.url, "https://www.tiktok.com/api/post/item_list/");
  assert.doesNotMatch(JSON.stringify(parsedEv2), /SHOULD_STRIP|msToken/);
  assert.equal(parsedEv2.hasNextPage, false);
  assert.equal(parsedEv2.items[0].sourceUrl, "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700");

  // d. Replay handshake (__sanghyang_feed_replay_req__) hanya memutar ulang chunk yang cocok pageHref saat ini!
  receivedEvents.length = 0;
  eventTarget.dispatchEvent(new FakeCustomEvent("__sanghyang_feed_replay_req__"));
  assert.equal(receivedEvents.length, 1, "hanya chunk milik halaman TikTok aktif yang di-replay (bukan chunk IG sebelumnya)");
  const replayed = JSON.parse(receivedEvents[0].detail as string);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.platform, "tiktok");
  assert.equal(replayed.items[0].sourceUrl, "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700");

  // e. Reset handshake (__sanghyang_feed_reset__) mengosongkan buffer
  eventTarget.dispatchEvent(new FakeCustomEvent("__sanghyang_feed_reset__"));
  assert.equal((sandboxWindow.__sanghyangFeedBuffer as unknown[]).length, 0);
  receivedEvents.length = 0;
  eventTarget.dispatchEvent(new FakeCustomEvent("__sanghyang_feed_replay_req__"));
  assert.equal(receivedEvents.length, 0);

  // f. Batas buffer maksimal 500 chunk (FIFO eviction)
  sandboxWindow.location = {
    href: "https://www.instagram.com/sanghyangresort/",
    origin: "https://www.instagram.com",
    hostname: "www.instagram.com",
    pathname: "/sanghyangresort/",
  };
  for (let i = 0; i < 515; i++) {
    const code = `BufPost_${String(i).padStart(4, "0")}`;
    const body = JSON.stringify({
      items: [{ code, media_type: 1, taken_at: 1763596800, caption: { text: `Post ${i}` }, like_count: i, comment_count: 0, user: { username: "sanghyangresort" } }],
      more_available: true,
    });
    const u = `https://www.instagram.com/api/v1/feed/user/111/username/?i=${i}`;
    nextFetchPayloads.set(u, { ok: true, body });
    const req = new (sandboxWindow.XMLHttpRequest as typeof FakeXMLHttpRequest)();
    req.open("GET", u, true);
    req.send(null);
  }
  const buf = sandboxWindow.__sanghyangFeedBuffer as Array<{ items: Array<{ sourceUrl: string }> }>;
  assert.equal(buf.length, 500, "buffer wajib dibatasi tepat maksimal 500 chunk");
  assert.match(buf[0].items[0].sourceUrl, /BufPost_0015/, "15 chunk tertua wajib tergeser FIFO");
  assert.match(buf[499].items[0].sourceUrl, /BufPost_0514/, "chunk terbaru wajib dipertahankan di ekor");
});

test("v1.1.10 TDD feed-parsers: klasifikasi feedKind (timeline/clips/profile/mixed/null), profileUsername, dan anti-timpa hasNextPage clips", () => {
  const fp = loadFeedParsers();

  // 1. Timeline GraphQL v2
  const tlOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    {
      data: {
        xdt_api__v1__feed__user_timeline_graphql_connection: {
          edges: [
            {
              node: {
                code: "TlKind001",
                media_type: 1,
                taken_at: 1763596800,
                user: { username: "mambrukhotelanyer" },
              },
            },
          ],
          page_info: { has_next_page: true },
        },
      },
    },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(tlOut.feedKind, "timeline");
  assert.equal(tlOut.profileUsername, null);
  assert.equal(tlOut.hasNextPage, true);

  // 2. Clips GraphQL Polaris
  const clipsOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    {
      data: {
        node: {
          __typename: "User",
          polaris_clips_connection: {
            edges: [
              {
                node: {
                  code: "ClipKind001",
                  product_type: "clips",
                  play_count: 520,
                },
              },
            ],
            page_info: { has_next_page: false },
          },
        },
      },
    },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(clipsOut.feedKind, "clips");
  assert.equal(clipsOut.hasNextPage, false);

  // 3. Profile-only (xig_user_by_username & ig_web_profile_info tanpa timeline edges)
  const profOnlyOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/v1/users/web_profile_info/?username=mambrukhotelanyer",
    {
      data: {
        user: {
          username: "MambrukHotelAnyer",
          edge_followed_by: { count: 24500 },
          edge_owner_to_timeline_media: { count: 1295 },
        },
      },
    },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(profOnlyOut.feedKind, "profile");
  assert.equal(profOnlyOut.profileUsername, "mambrukhotelanyer");
  assert.deepEqual(profOnlyOut.profileMeta, { followers: 24500, posts: 1295 });

  // 4. xig_user_by_username dengan timeline edges -> feedKind "timeline" + profileUsername
  const profTimelineOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    {
      data: {
        xig_user_by_username: {
          username: "andalanbeach",
          follower_count: 3200,
          all_media_count: 58,
          polaris_ordered_timeline_connection: {
            edges: [{ node: { code: "Andalan01", media_type: 1, taken_at: 1763596800, user: { username: "andalanbeach" } } }],
            page_info: { has_next_page: true },
          },
        },
      },
    },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(profTimelineOut.feedKind, "timeline");
  assert.equal(profTimelineOut.profileUsername, "andalanbeach");

  // 5. Mixed (timeline has_next_page=true + clips has_next_page=false) -> feedKind "mixed" dan hasNextPage tetap true!
  const mixedOut = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    {
      data: {
        xig_user_by_username: {
          username: "beachpoint.anyer",
          follower_count: 9100,
          all_media_count: 375,
          polaris_ordered_timeline_connection: {
            edges: [{ node: { code: "BpFeed01", media_type: 1, taken_at: 1763596800, user: { username: "beachpoint.anyer" } } }],
            page_info: { has_next_page: true },
          },
          polaris_clips_connection: {
            edges: [{ node: { code: "BpClip01", product_type: "clips", play_count: 800 } }],
            page_info: { has_next_page: false },
          },
        },
      },
    },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(mixedOut.feedKind, "mixed");
  assert.equal(mixedOut.profileUsername, "beachpoint.anyer");
  assert.equal(mixedOut.hasNextPage, true, "hasNextPage timeline (true) tidak boleh tertimpa false oleh clips dalam payload mixed");

  // 6. REST endpoints
  const restFeed = fp.extractFeedPayload(
    "https://www.instagram.com/api/v1/feed/user/123/username/",
    { items: [{ code: "RfKind01", media_type: 1, taken_at: 1763596800 }], more_available: true },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(restFeed.feedKind, "timeline");

  const restClips = fp.extractFeedPayload(
    "https://www.instagram.com/api/v1/clips/user/",
    { items: [{ media: { code: "RcKind01", media_type: 2, taken_at: 1763596800 } }], paging_info: { more_available: false } },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(restClips.feedKind, "clips");

  // 7. Noise GraphQL -> feedKind null, profileUsername null
  const noise = fp.extractFeedPayload(
    "https://www.instagram.com/api/graphql",
    { data: { xig_user_by_username: { lox_highlights_connection: { edges: [], page_info: { has_next_page: false } } } } },
    "instagram",
    FIXED_NOW_MS,
  );
  assert.equal(noise.feedKind, null);
  assert.equal(noise.profileUsername, null);

  // 8. Re-validasi clean chunk lewat parseChunkEventDetail mempertahankan feedKind & profileUsername
  const detail = fp.parseChunkEventDetail(
    JSON.stringify({
      __sanghyangCleanChunk: true,
      version: 1,
      platform: "instagram",
      url: "https://www.instagram.com/api/graphql",
      pageHref: "https://www.instagram.com/mambrukhotelanyer/",
      capturedAt: FIXED_NOW_MS,
      feedKind: "clips",
      profileUsername: "MambrukHotelAnyer",
      hasNextPage: false,
      profileMeta: null,
      items: [],
    }),
    FIXED_NOW_MS,
  );
  assert.ok(detail);
  assert.equal(detail.feedKind, "clips");
  assert.equal(detail.profileUsername, "mambrukhotelanyer");
});

test("v1.1.10 TDD feed-parsers: EVENT_SIGNAL, detectFeedErrorSignal (429/400/401/403/5xx + body JSON 200), dan parseSignalEventDetail bebas rahasia", () => {
  const fp = loadFeedParsers();

  assert.equal(fp.EVENT_SIGNAL, "__sanghyang_feed_signal__");
  assert.equal(typeof fp.detectFeedErrorSignal, "function");
  assert.equal(typeof fp.parseSignalEventDetail, "function");

  // 1. HTTP 429
  const s429 = fp.detectFeedErrorSignal(429, '{"message":"Please wait a few minutes before you try again.","status":"fail"}', "instagram");
  assert.deepEqual(s429, {
    httpStatus: 429,
    rateLimited: true,
    requireLogin: false,
    graphqlError: true,
  });

  // 2. HTTP 200 dengan pesan rate-limit GraphQL + anti-XSSI
  const s200Rate = fp.detectFeedErrorSignal(
    200,
    'for (;;);{"errors":[{"message":"Please wait a few minutes before you try again.","code":1675004}]}',
    "instagram",
  );
  assert.deepEqual(s200Rate, {
    httpStatus: 200,
    rateLimited: true,
    requireLogin: false,
    graphqlError: true,
  });

  // 3. HTTP 200 feedback_required / throttled
  const sFeedback = fp.detectFeedErrorSignal(200, '{"message":"feedback_required","status":"fail"}', "instagram");
  assert.equal(sFeedback?.rateLimited, true);
  assert.equal(sFeedback?.graphqlError, true);

  // 4. HTTP 200 require_login & checkpoint_required
  const sLogin = fp.detectFeedErrorSignal(200, '{"require_login":true,"status":"fail"}', "instagram");
  assert.equal(sLogin?.requireLogin, true);
  assert.equal(sLogin?.rateLimited, false);

  const sCheckpoint = fp.detectFeedErrorSignal(200, '{"message":"checkpoint_required","checkpoint_url":"/challenge/"}', "instagram");
  assert.equal(sCheckpoint?.requireLogin, true);

  // 5. HTTP 400 / 401 / 403 / 500 / 503
  assert.equal(fp.detectFeedErrorSignal(400, "{}", "instagram")?.httpStatus, 400);
  const s401 = fp.detectFeedErrorSignal(401, "", "instagram");
  assert.equal(s401?.httpStatus, 401);
  assert.equal(s401?.requireLogin, true);
  assert.equal(fp.detectFeedErrorSignal(403, "", "instagram")?.httpStatus, 403);
  assert.equal(fp.detectFeedErrorSignal(502, "Bad Gateway", "instagram")?.httpStatus, 502);

  // 6. Respons sukses 200 normal atau body kosong -> null
  assert.equal(fp.detectFeedErrorSignal(200, '{"data":{"user":{"username":"ok"}}}', "instagram"), null);
  assert.equal(fp.detectFeedErrorSignal(200, "", "tiktok"), null);

  // 7. parseSignalEventDetail membersihkan URL & membuang bidang rahasia
  const parsedSig = fp.parseSignalEventDetail(
    JSON.stringify({
      __sanghyangCleanSignal: true,
      version: 1,
      platform: "instagram",
      url: "https://www.instagram.com/api/graphql?lsd=SECRET_TOKEN",
      pageHref: "https://www.instagram.com/mambrukhotelanyer/?hl=id",
      capturedAt: FIXED_NOW_MS,
      httpStatus: 429,
      rateLimited: true,
      requireLogin: false,
      graphqlError: true,
      cookie: "sessionid=MUST_DROP",
      rawHtml: "<html>DROP</html>",
    }),
    FIXED_NOW_MS,
  );
  assert.ok(parsedSig);
  assert.equal(parsedSig.__sanghyangCleanSignal, true);
  assert.equal(parsedSig.version, 1);
  assert.equal(parsedSig.platform, "instagram");
  assert.equal(parsedSig.url, "https://www.instagram.com/api/graphql");
  assert.equal(parsedSig.pageHref, "https://www.instagram.com/mambrukhotelanyer/");
  assert.equal(parsedSig.httpStatus, 429);
  assert.equal(parsedSig.rateLimited, true);
  assert.equal(parsedSig.requireLogin, false);
  assert.equal(parsedSig.graphqlError, true);
  assert.doesNotMatch(JSON.stringify(parsedSig), /SECRET_TOKEN|MUST_DROP|rawHtml|cookie/i);

  // Endpoint di luar allowlist wajib ditolak
  assert.equal(
    fp.parseSignalEventDetail(
      {
        __sanghyangCleanSignal: true,
        version: 1,
        platform: "instagram",
        url: "https://evil.example/api/graphql",
        httpStatus: 429,
        rateLimited: true,
      },
      FIXED_NOW_MS,
    ),
    null,
  );
});

test("v1.1.10 TDD feed-tap.js: sinyal error fetch/XHR (429, 200 rate-limit, 503), feedKind/profileUsername, replay sinyal, & sinkron TikTok image_post_info", async () => {
  const tapSrc = fs.readFileSync(FEED_TAP_PATH, "utf8");
  const eventTarget = new EventTarget();
  const receivedChunks: Array<Record<string, unknown>> = [];
  const receivedSignals: Array<Record<string, unknown>> = [];

  eventTarget.addEventListener("__sanghyang_feed_chunk__", (ev) => {
    receivedChunks.push(JSON.parse(String((ev as CustomEvent).detail)));
  });
  eventTarget.addEventListener("__sanghyang_feed_signal__", (ev) => {
    receivedSignals.push(JSON.parse(String((ev as CustomEvent).detail)));
  });

  const responses = new Map<string, { status: number; body: string }>();
  const origFetch = async (input: unknown) => {
    const urlStr = typeof input === "string" ? input : String((input as { url?: string })?.url || "");
    const entry = responses.get(urlStr) || { status: 200, body: "{}" };
    const makeResp = () => ({
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      text: async () => entry.body,
      clone: () => makeResp(),
    });
    return makeResp();
  };

  class FakeXHR extends EventTarget {
    status = 200;
    responseType = "";
    responseText = "";
    response: unknown = null;
    private _url = "";
    open(_method: string, url: string) {
      this._url = url;
    }
    send() {
      const entry = responses.get(this._url);
      if (entry) {
        this.status = entry.status;
        this.responseText = entry.body;
        this.dispatchEvent(new Event("load"));
      }
    }
  }

  class FakeCustomEvent extends Event {
    detail: unknown;
    constructor(type: string, opts?: { detail?: unknown }) {
      super(type);
      this.detail = opts?.detail;
    }
  }

  const sandboxWindow: Record<string, unknown> = {
    location: {
      href: "https://www.instagram.com/mambrukhotelanyer/",
      origin: "https://www.instagram.com",
      hostname: "www.instagram.com",
      pathname: "/mambrukhotelanyer/",
    },
    fetch: origFetch,
    XMLHttpRequest: FakeXHR,
    CustomEvent: FakeCustomEvent,
    Event,
    URL,
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  };
  sandboxWindow.window = sandboxWindow;
  sandboxWindow.self = sandboxWindow;
  sandboxWindow.globalThis = sandboxWindow;
  vm.runInContext(tapSrc, vm.createContext(sandboxWindow));

  // 1. Fetch HTTP 429 pada /api/graphql -> respons asli tetap utuh & memancarkan sinyal bersih
  const url429 = "https://www.instagram.com/api/graphql?lsd=RAHASIA_429";
  responses.set(url429, { status: 429, body: '{"message":"Please wait a few minutes before you try again.","status":"fail"}' });
  const r429 = await (sandboxWindow.fetch as typeof origFetch)(url429);
  assert.equal(r429.status, 429, "respons asli fetch 429 tidak boleh diubah");
  assert.match(await r429.text(), /Please wait a few minutes/);
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(receivedSignals.length, 1);
  assert.equal(receivedChunks.length, 0);
  assert.equal(receivedSignals[0].__sanghyangCleanSignal, true);
  assert.equal(receivedSignals[0].httpStatus, 429);
  assert.equal(receivedSignals[0].rateLimited, true);
  assert.equal(receivedSignals[0].graphqlError, true);
  assert.equal(receivedSignals[0].url, "https://www.instagram.com/api/graphql");
  assert.doesNotMatch(JSON.stringify(receivedSignals[0]), /RAHASIA_429|cookie|rawHtml/i);

  // 2. Fetch HTTP 200 dengan body rate-limit GraphQL -> memancarkan sinyal rateLimited tanpa chunk kosong
  const url200Err = "https://www.instagram.com/graphql/query?doc_id=999";
  responses.set(url200Err, { status: 200, body: 'for (;;);{"message":"feedback_required","status":"fail"}' });
  await (sandboxWindow.fetch as typeof origFetch)(url200Err);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(receivedSignals.length, 2);
  assert.equal(receivedSignals[1].httpStatus, 200);
  assert.equal(receivedSignals[1].rateLimited, true);
  assert.equal(receivedChunks.length, 0);

  // 3. XHR HTTP 503 -> memancarkan sinyal bersih
  const url503 = "https://www.instagram.com/api/v1/feed/user/123/username/";
  responses.set(url503, { status: 503, body: "Service Unavailable" });
  const xhr503 = new (sandboxWindow.XMLHttpRequest as typeof FakeXHR)();
  xhr503.open("GET", url503);
  xhr503.send();
  assert.equal(receivedSignals.length, 3);
  assert.equal(receivedSignals[2].httpStatus, 503);
  assert.equal(receivedSignals[2].rateLimited, false);

  // 4. Chunk Polaris clips & timeline menyertakan feedKind + profileUsername
  const urlClips = "https://www.instagram.com/api/graphql?q=clips";
  responses.set(urlClips, {
    status: 200,
    body: JSON.stringify({
      data: {
        xig_user_by_username: {
          username: "mambrukhotelanyer",
          polaris_clips_connection: {
            edges: [{ node: { code: "TapClipKind1", product_type: "clips", play_count: 1100 } }],
            page_info: { has_next_page: false },
          },
        },
      },
    }),
  });
  await (sandboxWindow.fetch as typeof origFetch)(urlClips);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(receivedChunks.length, 1);
  assert.equal(receivedChunks[0].feedKind, "clips");
  assert.equal(receivedChunks[0].profileUsername, "mambrukhotelanyer");

  // 5. Replay memutar ulang sinyal halaman aktif & reset mengosongkannya
  receivedSignals.length = 0;
  eventTarget.dispatchEvent(new FakeCustomEvent("__sanghyang_feed_replay_req__"));
  assert.equal(receivedSignals.length, 3, "replay wajib memutar ulang sinyal error untuk pageHref aktif");
  assert.equal(receivedSignals[0].replayed, true);

  eventTarget.dispatchEvent(new FakeCustomEvent("__sanghyang_feed_reset__"));
  receivedSignals.length = 0;
  eventTarget.dispatchEvent(new FakeCustomEvent("__sanghyang_feed_replay_req__"));
  assert.equal(receivedSignals.length, 0, "reset wajib mengosongkan buffer sinyal");

  // 6. Sinkronisasi TikTok Photo Mode (image_post_info / aweme_type === 150) di feed-tap.js standalone
  sandboxWindow.location = {
    href: "https://www.tiktok.com/@sanghyangsparesort",
    origin: "https://www.tiktok.com",
    hostname: "www.tiktok.com",
    pathname: "/@sanghyangsparesort",
  };
  const ttPhotoUrl = "https://www.tiktok.com/api/post/item_list/?count=30";
  responses.set(ttPhotoUrl, {
    status: 200,
    body: JSON.stringify({
      hasMore: false,
      itemList: [
        {
          id: "7703084124281703698",
          desc: "",
          aweme_type: 150,
          author: { uniqueId: "sanghyangsparesort" },
          image_post_info: {
            title: "Galeri Sunset Sanghyang",
            images: [{ display_image: { url_list: ["https://p16-sign-sg.tiktokcdn.com/tap-photo-info.jpeg"] } }],
          },
          stats: { playCount: 1850, diggCount: 74, commentCount: 5, shareCount: 9 },
        },
      ],
    }),
  });
  receivedChunks.length = 0;
  const xhrTt = new (sandboxWindow.XMLHttpRequest as typeof FakeXHR)();
  xhrTt.open("GET", ttPhotoUrl);
  xhrTt.send();
  assert.equal(receivedChunks.length, 1);
  const ttItems = receivedChunks[0].items as Array<Record<string, unknown>>;
  assert.equal(ttItems[0].sourceUrl, "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698");
  assert.equal(ttItems[0].postType, "carousel");
  assert.equal(ttItems[0].caption, "Galeri Sunset Sanghyang");
  assert.equal(ttItems[0].imageUrl, "https://p16-sign-sg.tiktokcdn.com/tap-photo-info.jpeg");
});

test("v1.1.10 TDD parsers.js collectFeedItems: stop cepat rate_limited dalam 2 putaran, pemulihan bila item baru masuk, dan pacing adaptif", async () => {
  const parsers = require(path.resolve(process.cwd(), "extension/sanghyang-social-sync/parsers.js"));

  // 1. isRateLimited() === true + 0 item baru -> berhenti bersih tepat 2 putaran dengan stoppedBy="rate_limited", reachedBottom=false, sweepRan=false
  let sweepCalled = false;
  const baseItems = Array.from({ length: 48 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/andalanbeach/p/Andalan_${i + 1}/`,
    postType: "feed",
  }));
  const resRl = await parsers.collectFeedItems({
    collect: () => baseItems,
    advance: async () => ({ moved: false, wasAtBottom: true, atBottom: true, hasSpinner: false }),
    gapFillSweep: async () => {
      sweepCalled = true;
    },
    isAtBottom: () => true,
    hasSpinner: () => false,
    getHasNextPage: () => true,
    isRateLimited: () => true,
    maxItems: 0,
    expectedTotal: 58,
    staleRounds: 7,
    minItemsPerRound: 3,
    maxRoundsUnknown: 50,
  });
  assert.equal(resRl.stoppedBy, "rate_limited");
  assert.equal(resRl.reachedBottom, false);
  assert.equal(resRl.rateLimited, true);
  assert.equal(resRl.rounds, 2, `rate_limited wajib berhenti tepat dalam 2 putaran tanpa item baru (dapat ${resRl.rounds})`);
  assert.equal(sweepCalled, false, "gapFillSweep tidak boleh berjalan saat rate_limited");

  // 2. Rate-limit sempat true di putaran 1, lalu pulih & item baru masuk di putaran 2 -> lanjut sampai selesai
  let recovered = false;
  const growing = baseItems.slice(0, 10);
  const resRecover = await parsers.collectFeedItems({
    collect: () => growing,
    advance: async ({ round }: { round: number }) => {
      if (round >= 2) {
        recovered = true;
        growing.push({
          sourceUrl: `https://www.instagram.com/andalanbeach/p/Recovered_${round}/`,
          postType: "feed",
        });
      }
      return { moved: false, wasAtBottom: true, atBottom: true, hasSpinner: false };
    },
    isAtBottom: () => true,
    hasSpinner: () => false,
    isRateLimited: () => !recovered,
    maxItems: 0,
    expectedTotal: 12,
    staleRounds: 5,
    minItemsPerRound: 1,
    maxRoundsUnknown: 20,
  });
  assert.equal(resRecover.stoppedBy, "expected");
  assert.equal(resRecover.reachedBottom, true);
  assert.equal(resRecover.rateLimited, false);
  assert.equal(resRecover.collected, 12);

  // 3. Pacing adaptif setiap 120 item baru -> panggil sleep(1200)
  const sleepCalls: number[] = [];
  const bigPool: Array<{ sourceUrl: string; postType: string }> = [];
  let cursor = 0;
  const pushBatch = (n: number) => {
    for (let i = 0; i < n; i++) {
      cursor++;
      bigPool.push({ sourceUrl: `https://www.instagram.com/astonanyer/p/Big_${cursor}/`, postType: "feed" });
    }
  };
  pushBatch(30);
  const resPaced = await parsers.collectFeedItems({
    collect: () => bigPool,
    advance: async () => {
      pushBatch(Math.min(60, 300 - cursor));
      return { moved: true, wasAtBottom: false, atBottom: false, hasSpinner: false };
    },
    isAtBottom: () => false,
    hasSpinner: () => false,
    pacingEveryItems: 120,
    pacingDelayMs: 1200,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
    maxItems: 0,
    expectedTotal: 300,
    staleRounds: 5,
    minItemsPerRound: 3,
    maxRoundsUnknown: 50,
  });
  assert.equal(resPaced.collected, 300);
  assert.equal(resPaced.stoppedBy, "expected");
  assert.deepEqual(sleepCalls, [1200, 1200], "wajib memanggil jeda 1200ms setiap ~120 item sebelum mencapai target 300");
});

test("v1.1.10 TDD content-social.js: anti-kontaminasi clips/profileUsername, EVENT_SIGNAL + pemulihan, jeda midNudgeAt 350ms, tunggu 9000ms saat hasNextPage=true & stale>=2, pacing akun besar, & audit keamanan", async () => {
  const parsers = require(path.resolve(process.cwd(), "extension/sanghyang-social-sync/parsers.js"));
  const feedParsers = loadFeedParsers();
  const contentPath = path.resolve(process.cwd(), "extension/sanghyang-social-sync/content-social.js");
  const contentSrc = fs.readFileSync(contentPath, "utf8");

  // 1. Audit keamanan statis content-social.js bebas BOM & bebas cookie/token/rawHtml
  const rawBytes = fs.readFileSync(contentPath);
  assert.equal(rawBytes[0] === 0xef && rawBytes[1] === 0xbb && rawBytes[2] === 0xbf, false, "content-social.js wajib bebas UTF-8 BOM");
  assert.doesNotMatch(
    contentSrc,
    /document\.cookie|authorization|x-csrftoken|getResponseHeader|getAllResponseHeaders|rawHtml|innerHTML|outerHTML|\beval\s*\(|new\s+Function/i,
    "content-social.js tidak boleh mengakses cookie/header rahasia/rawHtml/eval",
  );

  // Helper pembuat sandbox content-social.js
  function createContentSandbox(opts: {
    pathname: string;
    expectedPosts: number;
    initialHref?: string;
    onCenterScroll?: () => void;
    onScrollTopChange?: (nextTop: number) => void;
    onSetTimeout?: (delayMs: number) => void;
    fastTimers?: boolean;
  }) {
    const listeners = new Map<string, Array<(ev: unknown) => void>>();
    const scrollTopEvents: Array<{ at: number; top: number }> = [];
    const centerEvents: number[] = [];

    class StubEl {
      tagName: string;
      id = "";
      attrs: Record<string, string>;
      textContent = "";
      innerText = "";
      parentElement: StubEl | null = null;
      children: StubEl[] = [];
      scrollHeight = 1800;
      clientHeight = 900;
      private _scrollTop = 900;
      constructor(tag: string, attrs: Record<string, string> = {}, text = "") {
        this.tagName = tag.toUpperCase();
        this.attrs = attrs;
        this.textContent = text;
        this.innerText = text;
      }
      get scrollTop() {
        return this._scrollTop;
      }
      set scrollTop(v: number) {
        this._scrollTop = v;
        scrollTopEvents.push({ at: Date.now(), top: v });
        opts.onScrollTopChange?.(v);
      }
      getAttribute(k: string) {
        return this.attrs[k] ?? null;
      }
      appendChild(ch: StubEl) {
        ch.parentElement = this;
        this.children.push(ch);
        return ch;
      }
      getBoundingClientRect() {
        return { top: 400, bottom: 700, width: 300, height: 300 };
      }
      scrollIntoView(arg?: { block?: string }) {
        if (arg?.block === "center") {
          centerEvents.push(Date.now());
          opts.onCenterScroll?.();
        }
      }
      dispatchEvent() {
        return true;
      }
      closest() {
        return null;
      }
      querySelectorAll(sel: string): StubEl[] {
        const out: StubEl[] = [];
        const walk = (n: StubEl) => {
          for (const c of n.children) {
            if (
              (sel.includes('a[href*="/p/"]') && c.tagName === "A" && (c.attrs.href || "").includes("/p/")) ||
              (sel.includes('a[href*="/reel/"]') && c.tagName === "A" && (c.attrs.href || "").includes("/reel/"))
            ) {
              out.push(c);
            }
            walk(c);
          }
        };
        walk(this);
        return out;
      }
      querySelector(sel: string): StubEl | null {
        return this.querySelectorAll(sel)[0] ?? null;
      }
    }

    const scrollview = new StubEl("DIV", { id: "scrollview" });
    scrollview.id = "scrollview";
    const mainEl = new StubEl("MAIN");
    const gridDiv = new StubEl("DIV");
    gridDiv.appendChild(new StubEl("A", { href: opts.initialHref || "/mambrukhotelanyer/p/BaseDom001/" }));
    mainEl.appendChild(gridDiv);
    scrollview.appendChild(mainEl);
    const bodyEl = new StubEl("BODY", {}, `mambrukhotelanyer\n${opts.expectedPosts} kiriman\n24.500 pengikut`);
    bodyEl.appendChild(scrollview);

    class StubObs {
      observe() {}
      disconnect() {}
    }

    const recordedTimeouts: number[] = [];
    const wrappedSetTimeout = (fn: (...a: unknown[]) => void, ms?: number) => {
      const delay = Number(ms) || 0;
      recordedTimeouts.push(delay);
      opts.onSetTimeout?.(delay);
      return setTimeout(fn, opts.fastTimers ? Math.min(delay, 5) : delay);
    };

    const sb: Record<string, unknown> = {
      SanghyangParsers: parsers,
      SanghyangFeedParsers: feedParsers,
      document: {
        title: "Mambruk (@mambrukhotelanyer)",
        hidden: false,
        readyState: "complete",
        location: { pathname: opts.pathname },
        body: bodyEl,
        documentElement: { scrollHeight: 900, clientHeight: 900, scrollTop: 0 },
        scrollingElement: scrollview,
        querySelector: (sel: string) => {
          if (sel === "#scrollview") return scrollview;
          if (sel === "main") return mainEl;
          if (sel.includes('a[href*="/p/"]')) return gridDiv.children[0] ?? null;
          return null;
        },
        querySelectorAll: (sel: string) => bodyEl.querySelectorAll(sel),
      },
      window: {
        location: {
          href: `https://www.instagram.com${opts.pathname}`,
          origin: "https://www.instagram.com",
          hostname: "www.instagram.com",
          pathname: opts.pathname,
        },
        innerHeight: 900,
        scrollY: 0,
        scrollTo: () => {},
        getComputedStyle: () => ({ overflowY: "auto" }),
        addEventListener: (type: string, fn: (ev: unknown) => void) => {
          const list = listeners.get(type) ?? [];
          list.push(fn);
          listeners.set(type, list);
        },
        removeEventListener: () => {},
        dispatchEvent: (ev: { type: string; detail?: unknown }) => {
          for (const fn of [...(listeners.get(ev.type) ?? [])]) fn(ev);
          return true;
        },
      },
      HTMLElement: StubEl,
      MutationObserver: StubObs,
      CustomEvent: class {
        type: string;
        detail: unknown;
        constructor(t: string, init?: { detail?: unknown }) {
          this.type = t;
          this.detail = init?.detail;
        }
      },
      Event: class {
        type: string;
        constructor(t: string) {
          this.type = t;
        }
      },
      WheelEvent: class {
        type: string;
        constructor(t: string) {
          this.type = t;
        }
      },
      setTimeout: wrappedSetTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Promise,
      Set,
      Map,
      Array,
      Math,
      Boolean,
      Number,
      String,
      RegExp,
      URL,
      JSON,
      globalThis: {} as Record<string, unknown>,
    };
    sb.globalThis = sb;
    vm.runInNewContext(contentSrc, sb);
    return {
      sb,
      scrollview,
      centerEvents,
      scrollTopEvents,
      recordedTimeouts,
      dispatch: (type: string, detail: unknown) => {
        for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, detail });
      },
      hooks: sb.__sanghyangContentTestHooks as {
        scrollAndWaitForGrowth: (platform: string, ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;
        ingestFeedChunkDetail: (detail: unknown) => number;
        ingestFeedSignalDetail: (detail: unknown) => boolean;
        getFeedTapSnapshot: () => Record<string, unknown>;
      },
      runProfile: sb.__sanghyangRunProfile as (
        platform: string,
        maxItems: number,
        targetHandle: string,
        allowedCollabHandles: string[],
        runOpts?: Record<string, unknown>,
      ) => Promise<{
        items: Array<{ sourceUrl: string; ownerHandle?: string | null }>;
        profile: { followers: number | null; posts: number | null };
        scan: {
          rounds: number;
          collected: number;
          stoppedBy: string;
          reachedBottom: boolean;
          hasNextPage: boolean | null;
          rateLimited: boolean;
          httpErrorStatus: number | null;
          requireLogin: boolean;
          graphqlError: boolean;
        };
      }>,
    };
  }

  // 2. Uji anti-kontaminasi clips preload + hover card akun lain + kolaborasi + rate-limit 429 pada profil utama
  const mainEnv = createContentSandbox({ pathname: "/mambrukhotelanyer/", expectedPosts: 1295 });
  assert.equal(typeof mainEnv.hooks.ingestFeedSignalDetail, "function", "__sanghyangContentTestHooks wajib mengekspor ingestFeedSignalDetail");

  let replayFired = false;
  (mainEnv.sb.window as { addEventListener: (t: string, fn: () => void) => void }).addEventListener(
    "__sanghyang_feed_replay_req__",
    () => {
      replayFired = true;
      // a) Chunk timeline milik target (termasuk 1 kolaborasi eksternal) -> hasNextPage=true
      mainEnv.dispatch(
        "__sanghyang_feed_chunk__",
        JSON.stringify({
          __sanghyangCleanChunk: true,
          version: 1,
          platform: "instagram",
          url: "https://www.instagram.com/api/graphql",
          pageHref: "https://www.instagram.com/mambrukhotelanyer/",
          capturedAt: FIXED_NOW_MS,
          feedKind: "timeline",
          profileUsername: "mambrukhotelanyer",
          hasNextPage: true,
          profileMeta: { followers: 24500, posts: 1295 },
          items: [
            {
              sourceUrl: "https://www.instagram.com/mambrukhotelanyer/p/Mambruk001/",
              postType: "feed",
              postedAt: "2026-11-20T00:00:00.000Z",
              caption: "Promo kamar Mambruk",
              ownerHandle: "mambrukhotelanyer",
            },
            {
              sourceUrl: "https://www.instagram.com/partner_wedding_anyer/p/CollabMambruk002/",
              postType: "carousel",
              postedAt: "2026-11-19T00:00:00.000Z",
              caption: "Kolaborasi wedding sah di grid Mambruk",
              ownerHandle: "partner_wedding_anyer",
            },
          ],
        }),
      );
      // b) Chunk preload clips tab pada halaman profil utama -> hasNextPage=false WAJIB diabaikan!
      mainEnv.dispatch(
        "__sanghyang_feed_chunk__",
        JSON.stringify({
          __sanghyangCleanChunk: true,
          version: 1,
          platform: "instagram",
          url: "https://www.instagram.com/api/graphql",
          pageHref: "https://www.instagram.com/mambrukhotelanyer/",
          capturedAt: FIXED_NOW_MS,
          feedKind: "clips",
          profileUsername: "mambrukhotelanyer",
          hasNextPage: false,
          profileMeta: null,
          items: [
            {
              sourceUrl: "https://www.instagram.com/mambrukhotelanyer/reel/PreloadClipOnly99/",
              postType: "reels",
              postedAt: "2026-11-18T00:00:00.000Z",
              caption: "Reels preload bukan grid utama",
              ownerHandle: "mambrukhotelanyer",
            },
          ],
        }),
      );
      // c) Hover card / saran akun asing -> profileUsername !== targetHandle WAJIB diabaikan 100%!
      mainEnv.dispatch(
        "__sanghyang_feed_chunk__",
        JSON.stringify({
          __sanghyangCleanChunk: true,
          version: 1,
          platform: "instagram",
          url: "https://www.instagram.com/api/graphql",
          pageHref: "https://www.instagram.com/mambrukhotelanyer/",
          capturedAt: FIXED_NOW_MS,
          feedKind: "profile",
          profileUsername: "akun_saran_asing",
          hasNextPage: false,
          profileMeta: { followers: 12, posts: 3 },
          items: [
            {
              sourceUrl: "https://www.instagram.com/akun_saran_asing/p/Asing999/",
              postType: "feed",
              postedAt: "2026-11-17T00:00:00.000Z",
              caption: "Bukan milik target",
              ownerHandle: "akun_saran_asing",
            },
          ],
        }),
      );
      // d) Sinyal rate-limit 429 masuk -> scan harus berhenti bersih dalam 2 putaran dengan stoppedBy="rate_limited"
      mainEnv.dispatch(
        "__sanghyang_feed_signal__",
        JSON.stringify({
          __sanghyangCleanSignal: true,
          version: 1,
          platform: "instagram",
          url: "https://www.instagram.com/api/graphql",
          pageHref: "https://www.instagram.com/mambrukhotelanyer/",
          capturedAt: FIXED_NOW_MS,
          httpStatus: 429,
          rateLimited: true,
          requireLogin: false,
          graphqlError: true,
        }),
      );
    },
  );

  const runRes = await mainEnv.runProfile("instagram", 0, "mambrukhotelanyer", ["mambrukhotelanyer"], {
    stepWaitMs: 5,
    bottomWaitMs: 25,
    sweepStepWaitMs: 5,
  });
  assert.equal(replayFired, true);
  assert.equal(runRes.scan.hasNextPage, true, "clips preload hasNextPage=false tidak boleh menimpa timeline hasNextPage=true");
  assert.equal(runRes.scan.stoppedBy, "rate_limited");
  assert.equal(runRes.scan.reachedBottom, false);
  assert.equal(runRes.scan.rateLimited, true);
  assert.equal(runRes.scan.httpErrorStatus, 429);
  assert.equal(runRes.scan.graphqlError, true);
  assert.equal(runRes.scan.rounds, 2, "wajib berhenti dalam 2 putaran saat rateLimited aktif tanpa item baru");
  assert.ok(runRes.items.some((x) => x.sourceUrl.includes("CollabMambruk002")), "postingan kolaborasi di dalam timeline target wajib diterima");
  assert.equal(runRes.items.some((x) => x.sourceUrl.includes("PreloadClipOnly99")), false, "item clips preload tidak boleh masuk grid utama");
  assert.equal(runRes.items.some((x) => x.sourceUrl.includes("Asing999")), false, "item akun asing dari hover card wajib ditolak");
  assert.equal(runRes.profile.posts, 1295, "profileMeta akun asing tidak boleh menimpa posts target");

  // 3. Uji pemulihan rateLimited: saat sinyal 429 datang lalu chunk baru membawa item baru, lastRateLimited kembali false!
  mainEnv.hooks.ingestFeedSignalDetail(
    JSON.stringify({
      __sanghyangCleanSignal: true,
      version: 1,
      platform: "instagram",
      url: "https://www.instagram.com/api/graphql",
      pageHref: "https://www.instagram.com/mambrukhotelanyer/",
      capturedAt: FIXED_NOW_MS,
      httpStatus: 429,
      rateLimited: true,
      requireLogin: false,
      graphqlError: false,
    }),
  );
  assert.equal(mainEnv.hooks.getFeedTapSnapshot().lastRateLimited, true);
  mainEnv.hooks.ingestFeedChunkDetail(
    JSON.stringify({
      __sanghyangCleanChunk: true,
      version: 1,
      platform: "instagram",
      url: "https://www.instagram.com/api/graphql",
      pageHref: "https://www.instagram.com/mambrukhotelanyer/",
      capturedAt: FIXED_NOW_MS,
      feedKind: "timeline",
      hasNextPage: true,
      items: [
        {
          sourceUrl: "https://www.instagram.com/mambrukhotelanyer/p/PulihSetelah429/",
          postType: "feed",
          postedAt: "2026-11-21T00:00:00.000Z",
          caption: "Pulih",
          ownerHandle: "mambrukhotelanyer",
        },
      ],
    }),
  );
  assert.equal(
    mainEnv.hooks.getFeedTapSnapshot().lastRateLimited,
    false,
    "ketika item baru berhasil masuk setelah 429, lastRateLimited wajib pulih menjadi false",
  );

  // 4. Uji tab /reels/ (onReelsTab=true): hanya clips/untagged yang boleh mengubah lastHasNextPage
  const reelsEnv = createContentSandbox({ pathname: "/mambrukhotelanyer/reels/", expectedPosts: 1295 });
  (reelsEnv.sb.window as { addEventListener: (t: string, fn: () => void) => void }).addEventListener(
    "__sanghyang_feed_replay_req__",
    () => {
      reelsEnv.dispatch(
        "__sanghyang_feed_chunk__",
        JSON.stringify({
          __sanghyangCleanChunk: true,
          version: 1,
          platform: "instagram",
          url: "https://www.instagram.com/api/graphql",
          pageHref: "https://www.instagram.com/mambrukhotelanyer/reels/",
          capturedAt: FIXED_NOW_MS,
          feedKind: "clips",
          hasNextPage: false,
          items: [
            {
              sourceUrl: "https://www.instagram.com/mambrukhotelanyer/reel/TabReels001/",
              postType: "reels",
              postedAt: "2026-11-20T00:00:00.000Z",
              ownerHandle: "mambrukhotelanyer",
            },
          ],
        }),
      );
      // Chunk timeline stray di tab reels dengan hasNextPage: true tidak boleh menimpa false dari clips
      reelsEnv.dispatch(
        "__sanghyang_feed_chunk__",
        JSON.stringify({
          __sanghyangCleanChunk: true,
          version: 1,
          platform: "instagram",
          url: "https://www.instagram.com/api/graphql",
          pageHref: "https://www.instagram.com/mambrukhotelanyer/reels/",
          capturedAt: FIXED_NOW_MS,
          feedKind: "timeline",
          hasNextPage: true,
          items: [],
        }),
      );
    },
  );
  const reelsRes = await reelsEnv.runProfile("instagram", 0, "mambrukhotelanyer", ["mambrukhotelanyer"], {
    stepWaitMs: 5,
    bottomWaitMs: 25,
    sweepStepWaitMs: 5,
  });
  assert.equal(reelsRes.scan.hasNextPage, false, "pada tab /reels/, chunk timeline tidak boleh menimpa lastHasNextPage=false milik clips");

  // 5. Uji jeda midNudgeAt 350ms: setelah scrollIntoView("center") pada midNudgeAt, scrollTop tidak langsung ditimpa di 0ms!
  const midEnv = createContentSandbox({ pathname: "/mambrukhotelanyer/", expectedPosts: 50 });
  midEnv.scrollview.scrollHeight = 1800;
  midEnv.scrollview.scrollTop = 900;
  await midEnv.hooks.scrollAndWaitForGrowth("instagram", {
    stale: 0,
    hasNewItem: () => false,
    waitMs: 1100,
  });
  // Harus ada minimal 2 center trigger (awal + midNudgeAt), dan pada midNudgeAt jeda antara center dan set scrollTop berikutnya >= 280ms
  assert.ok(midEnv.centerEvents.length >= 2, `midNudgeAt wajib memanggil scrollIntoView("center") (tercatat ${midEnv.centerEvents.length}x)`);
  const midCenterAt = midEnv.centerEvents[1];
  const scrollAfterMid = midEnv.scrollTopEvents.find((e) => e.at >= midCenterAt);
  assert.ok(scrollAfterMid, "setelah jeda 350ms midNudgeAt, gulir bawah wajib tetap dijalankan");
  const deltaMidMs = scrollAfterMid.at - midCenterAt;
  assert.ok(
    deltaMidMs >= 280,
    `jeda antara scrollIntoView("center") dan penggeseran ke bawah pada midNudgeAt wajib ~350ms, bukan 0ms (terukur ${deltaMidMs}ms)`,
  );

  // 6. Uji hasNextPage === true && stale >= 2 memperpanjang tunggu bottom menjadi 9000ms (GRID_GROWTH_SPINNER_WAIT_MS)
  const slowEnv = createContentSandbox({ pathname: "/mambrukhotelanyer/", expectedPosts: 100, fastTimers: true });
  slowEnv.scrollview.scrollHeight = 1800;
  slowEnv.scrollview.scrollTop = 900;
  await slowEnv.hooks.scrollAndWaitForGrowth("instagram", {
    stale: 2,
    hasNextPage: true,
    hasNewItem: () => false,
  });
  assert.ok(
    slowEnv.recordedTimeouts.includes(9000),
    `saat hasNextPage===true dan stale>=2 tanpa spinner, tunggu bottom wajib diperpanjang ke 9000ms (tercatat: ${slowEnv.recordedTimeouts.join(",")})`,
  );

  // 7. Uji pacing adaptif akun besar (expected >= 300): aktif 1200ms bila bukan mode uji cepat (stepWaitMs < 50)
  const paceEnv = createContentSandbox({
    pathname: "/astonanyer/",
    expectedPosts: 350,
    initialHref: "/astonanyer/p/AstonInit_1/",
    fastTimers: true,
  });
  let batchIdx = 0;
  (paceEnv.sb.window as { addEventListener: (t: string, fn: () => void) => void }).addEventListener(
    "__sanghyang_feed_replay_req__",
    () => {
      // Kirim batch awal 30 item
      paceEnv.dispatch(
        "__sanghyang_feed_chunk__",
        JSON.stringify({
          __sanghyangCleanChunk: true,
          version: 1,
          platform: "instagram",
          url: "https://www.instagram.com/api/graphql",
          pageHref: "https://www.instagram.com/astonanyer/",
          capturedAt: FIXED_NOW_MS,
          feedKind: "timeline",
          hasNextPage: true,
          profileMeta: { followers: 50000, posts: 350 },
          items: Array.from({ length: 30 }, (_, i) => ({
            sourceUrl: `https://www.instagram.com/astonanyer/p/AstonInit_${i + 1}/`,
            postType: "feed",
            postedAt: "2026-11-20T00:00:00.000Z",
            ownerHandle: "astonanyer",
          })),
        }),
      );
    },
  );
  // Setiap kali center scroll dipicu, kirim 120 item baru hingga 350 tercapai
  const origCenter = paceEnv.scrollview.children[0].children[0].children[0].scrollIntoView;
  paceEnv.scrollview.children[0].children[0].children[0].scrollIntoView = function (arg?: { block?: string }) {
    origCenter.call(this, arg);
    if (arg?.block === "center" && batchIdx < 3) {
      batchIdx++;
      const start = 30 + (batchIdx - 1) * 120;
      const count = Math.min(120, 350 - start);
      if (count > 0) {
        paceEnv.dispatch(
          "__sanghyang_feed_chunk__",
          JSON.stringify({
            __sanghyangCleanChunk: true,
            version: 1,
            platform: "instagram",
            url: "https://www.instagram.com/api/graphql",
            pageHref: "https://www.instagram.com/astonanyer/",
            capturedAt: FIXED_NOW_MS,
            feedKind: "timeline",
            hasNextPage: start + count < 350,
            items: Array.from({ length: count }, (_, i) => ({
              sourceUrl: `https://www.instagram.com/astonanyer/p/AstonBatch_${start + i + 1}/`,
              postType: "feed",
              postedAt: "2026-11-19T00:00:00.000Z",
              ownerHandle: "astonanyer",
            })),
          }),
        );
      }
    }
  };
  const paceRes = await paceEnv.runProfile("instagram", 0, "astonanyer", ["astonanyer"], {
    stepWaitMs: 60,
    bottomWaitMs: 60,
    sweepStepWaitMs: 60,
  });
  assert.equal(paceRes.items.length, 350);
  assert.ok(
    paceEnv.recordedTimeouts.includes(1200),
    `akun besar (expected >= 300) dengan stepWaitMs >= 50 wajib memicu jeda sopan 1200ms setiap ~120 item (tercatat: ${paceEnv.recordedTimeouts.filter((t) => t >= 500).join(",")})`,
  );
});
