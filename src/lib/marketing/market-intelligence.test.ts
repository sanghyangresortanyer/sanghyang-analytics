import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isAuthorizedCronRequest, timingSafeSecretMatch } from "@/lib/auth/cron-secret";
import { requireMarketingApiAccess } from "@/lib/marketing/api-auth";
import { buildMarketingFilterParams } from "@/components/marketing/marketing-filter-bar";
import { SocialPromoAuditView } from "@/components/marketing/social-promo-audit";
import { SocialPostGridCard } from "@/components/marketing/media-sosial-view";
import crawled from "@/lib/market/marketing-sosmed.data.json";
import { evaluateSocialPromoPost } from "@/lib/market/marketing-sosmed";
import { SnExtensionPanel, type UseSocialExtensionSyncResult } from "@/components/marketing/sn-extension-panel";
import { RefreshProgressPanel } from "@/components/marketing/sn-update-all";
import { filterGuestReviews } from "@/components/marketing/insight-pasar-view";
import { computePromoLift, shiftDate, type PromoAuditItem } from "./social-promo";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/social-promo", () => ({
  pullPromos: vi.fn(async () => ({ ok: "ok" })),
  ignorePromoEvent: vi.fn(async () => ({ ok: "Diabaikan." })),
}));
import {
  PROMOTION_TYPES,
  PROMOTION_TYPE_INFO,
  activeRoomPromos,
  aspectHighlights,
  buildOutletActionPlan,
  channelFromSource,
  computeResortReputation,
  computeSosmedStats,
  counterStrategyFor,
  deepestCompetitorDiscount,
  groupPromosByCompetitor,
  isPromoEvent,
  knowledgeAnalysisOriginText,
  isPromotionType,
  likeRatePercent,
  metaAccountNotes,
  metaPullProblem,
  ownPromoMatchesOutletKey,
  ownPromoSourceSummary,
  postDayWib,
  postOverallScore,
  priceVerdict,
  promoMatchesOutletKey,
  promoPeriodText,
  promoPriceDiscountText,
  promotionTypeLabel,
  sanitizePublicText,
  sanitizeStrategyText,
  sentimentVerdict,
  socialPostTypeLabel,
  socialPostsInPeriod,
  socialSourceLabel,
  summarizeSocialAccountCoverage,
  verifiedFeedback,
  visibleMarketRank,
  type SnInstagramAccount,
  type SnMetaStatus,
  type SnOfficialSocialAccount,
  type SnRadarPromo,
  type SnSocialPost,
  type SnSummary,
} from "./market-intelligence-types";
import {
  countVerdicts,
  describeCounts,
  followEvent,
  friendlyScrapeIssue,
  parseSse,
  reconnectDelay,
  refreshHeadline,
  resolveDisplayRefreshSteps,
  sanitizeRefreshStepDetail,
  type RefreshState,
  type RefreshStep,
} from "./refresh-follow";
import {
  EXTENSION_SYNC_BATCH_LIMIT,
  classifyExtensionTargetStatus,
  computeExtensionProgressPercent,
  formatExtensionPhaseProgress,
  formatExtensionTargetCounts,
  selectTargetsForSync,
  summarizeExtensionTargets,
  type ExtensionTargetItem,
  type SocialExtensionState,
  type SocialExtensionTargetProgress,
} from "./social-extension-client";

describe("market-intelligence-types helpers", () => {
  it("mengklasifikasi promo vs event secara deterministik", () => {
    const promo: SnRadarPromo = {
      id: "1",
      competitorName: "Aston Anyer",
      platform: "website",
      title: "Diskon Kamar 20% Weekday",
      status: "active",
      startsAt: "2026-11-01",
      endsAt: "2026-11-30",
      price: 850000,
      kind: "promo",
    };
    const event: SnRadarPromo = {
      id: "2",
      competitorName: "Mambruk",
      platform: "instagram",
      title: "New Year Eve Party & Live Music",
      status: "upcoming",
      startsAt: "2026-12-31",
      endsAt: "2027-01-01",
      price: null,
      kind: "event",
    };
    expect(isPromoEvent(promo)).toBe(false);
    expect(isPromoEvent(event)).toBe(true);
  });

  it("menyaring promo kompetitor berdasarkan venue, kata kunci, dan outlet tanpa bocor antar outlet hotel", () => {
    const mandiri: SnRadarPromo = {
      id: "3",
      competitorName: "Beach Point Anyer",
      competitorOutlets: ["sunset-grill"],
      competitorIsLodging: false,
      platform: "instagram",
      title: "Sunset Mocktail Happy Hour",
      status: "active",
      startsAt: "2026-11-10",
      endsAt: null,
      price: null,
    };
    expect(promoMatchesOutletKey(mandiri, "all")).toBe(true);
    expect(promoMatchesOutletKey(mandiri, "sunset-grill")).toBe(true);
    expect(promoMatchesOutletKey(mandiri, "resort")).toBe(false);

    const roomHotelPromo: SnRadarPromo = {
      id: "4",
      competitorName: "Aston Anyer Beach Hotel",
      competitorOutlets: ["resort", "dbistro", "dbar"],
      competitorIsLodging: true,
      platform: "website",
      category: "Kamar & Menginap",
      title: "Early Bird Staycation Kamar 25% OFF",
      status: "active",
      startsAt: "2026-11-10",
      endsAt: "2026-12-10",
      price: 950000,
    };
    expect(promoMatchesOutletKey(roomHotelPromo, "resort")).toBe(true);
    expect(promoMatchesOutletKey(roomHotelPromo, "dbistro")).toBe(false);

    const venuePromo: SnRadarPromo = {
      id: "5",
      competitorName: "Mambruk Hotel & Convention",
      competitorOutlets: ["resort", "dbistro", "dbar"],
      competitorIsLodging: true,
      competitorVenues: [{ name: "Lighthouse Restaurant & Bar Mambruk", outlets: ["dbistro", "dbar"] }],
      platform: "instagram",
      category: "F&B & Kuliner",
      title: "Lighthouse Dinner Buffet Weekend",
      status: "active",
      startsAt: "2026-11-12",
      endsAt: null,
      price: 175000,
    };
    expect(promoMatchesOutletKey(venuePromo, "dbistro")).toBe(true);
    expect(promoMatchesOutletKey(venuePromo, "resort")).toBe(false);

    // Promo Sanghyang sendiri mengikuti baris outlet asalnya (tanpa menebak judul).
    const ownResortPromo: SnRadarPromo = {
      id: "own-1",
      competitorName: "Sanghyang Indah Spa Resort",
      competitorOutlets: ["resort"],
      platform: "website",
      title: "Paket Babakaran Tahun Baru",
      status: "active",
      startsAt: "2026-12-31",
      endsAt: null,
      price: 1500000,
      isOwn: true,
    };
    expect(ownPromoMatchesOutletKey(ownResortPromo, "resort")).toBe(true);
    expect(ownPromoMatchesOutletKey(ownResortPromo, "sunset-grill")).toBe(false);
  });

  it("menyembunyikan usulan Versi kita bila menyebut outlet Sanghyang lain dan merangkum sumber promo sendiri", () => {
    const p = { counterStrategy: "Tawarkan paket grill di Sunset Grill dengan harga menarik." };
    expect(counterStrategyFor(p, "sunset-grill")).toBe(p.counterStrategy);
    expect(counterStrategyFor(p, "dbistro")).toBeNull();
    expect(counterStrategyFor(p, "resort")).toBe(p.counterStrategy);
    expect(counterStrategyFor(p, "all")).toBe(p.counterStrategy);

    expect(
      ownPromoSourceSummary([
        { platform: "website" },
        { platform: "website" },
        { platform: "instagram" },
      ]),
    ).toBe("Situs resmi 2 · Instagram 1 · TikTok belum ada data");
  });

  it("mengelompokkan promo per kompetitor dengan promo aktif terbanyak di atas", () => {
    const grouped = groupPromosByCompetitor([
      {
        id: "a",
        competitorName: "Novus Jiva",
        platform: "instagram",
        title: "Promo Lama",
        status: "expired",
        startsAt: "2026-10-01",
        endsAt: "2026-10-10",
        price: null,
      },
      {
        id: "b",
        competitorName: "Aston Anyer",
        platform: "website",
        title: "Promo Aktif 1",
        status: "active",
        startsAt: "2026-11-15",
        endsAt: null,
        price: 800000,
      },
      {
        id: "c",
        competitorName: "Aston Anyer",
        platform: "instagram",
        title: "Promo Aktif 2",
        status: "active",
        startsAt: "2026-11-18",
        endsAt: null,
        price: 900000,
      },
    ]);
    expect(grouped[0].competitorName).toBe("Aston Anyer");
    expect(grouped[0].activeCount).toBe(2);
    expect(grouped[0].promos[0].id).toBe("c");
  });

  it("mengonversi tanggal postingan ISO ke tanggal WIB YYYY-MM-DD", () => {
    expect(postDayWib("2026-11-20T18:30:00Z")).toBe("2026-11-21");
    expect(postDayWib("2026-11-15")).toBe("2026-11-15");
  });

  it("memformat periode promo, harga/diskon, dan kategori promosi persis lib/market/promo-type.ts", () => {
    expect(
      promoPeriodText({
        startsAt: "2026-11-19",
        endsAt: null,
        startWritten: false,
      }),
    ).toContain("Tanpa tanggal tertulis");
    expect(promoPriceDiscountText({ price: 500000, discount: 20 })).toBe("Rp 500.000 · Diskon 20%");
    expect(promoPriceDiscountText({ price: null, discount: null })).toBe("—");

    expect(PROMOTION_TYPES).toContain("paket_bundling");
    expect(PROMOTION_TYPES).toContain("brand_awareness");
    expect(isPromotionType("potongan_harga")).toBe(true);
    expect(isPromotionType("unknown_code")).toBe(false);
    expect(promotionTypeLabel("paket_bundling")).toBe("Paket bundling");
    expect(promotionTypeLabel("brand_awareness")).toBe("Brand awareness");
    expect(PROMOTION_TYPE_INFO.harga_spesial.label).toBe("Harga spesial");
    expect(promotionTypeLabel(null)).toBe("belum ada data");
    expect(promotionTypeLabel("bukan_kode")).toBe("belum ada data");
  });

  it("menghitung skor caption menyeluruh dan penilaian sentimen/aspek (baik persen 0..100 maupun rasio 0..1) tanpa NaN", () => {
    expect(postOverallScore({ hookScore: 80, copyScore: 70, ctaScore: 60 })).toBe(71);
    expect(postOverallScore({ hookScore: 80, copyScore: 70, ctaScore: 60, overallScore: 84 })).toBe(84);

    const lowCount = sentimentVerdict(2, 3, 0);
    expect(lowCount.tone).toBe("neutral");
    const warnSent = sentimentVerdict(15, 37, 0);
    expect(warnSent.tone).toBe("warn");
    expect(warnSent.pct).toBe(41);

    // Format pecahan 0..1 (kompatibel tes lama)
    const hlFraction = aspectHighlights(
      [
        { aspect: "kamar & kebersihan", count: 8, positiveRatio: 0.9, negativeRatio: 0.05 },
        { aspect: "parkir", count: 4, positiveRatio: 0.2, negativeRatio: 0.5 },
      ],
      12,
    );
    expect(hlFraction.praised[0]).toContain("kamar & kebersihan");
    expect(hlFraction.complaints[0]).toContain("parkir");

    // Format persen 0..100 dari API summary lokal
    const hlPercent = aspectHighlights(
      [
        { aspect: "kolam air panas", count: 9, positiveRatio: 88, negativeRatio: 5 },
        { aspect: "ac kamar", count: 5, positiveRatio: 20, negativeRatio: 60 },
        { aspect: "lokasi", count: 3, positiveRatio: 40, negativeRatio: 10 },
      ],
      15,
    );
    expect(hlPercent.praised).toEqual(["kolam air panas (9 ulasan)"]);
    expect(hlPercent.complaints).toEqual(["ac kamar (5 ulasan)"]);

    expect(priceVerdict(100).tone).toBe("good");
    expect(priceVerdict(125).tone).toBe("bad");
    expect(priceVerdict(80).tone).toBe("warn");
    expect(priceVerdict(null).tone).toBe("neutral");
  });

  it("membersihkan teks publik dari penyebutan nama mesin pemrosesan dan mengenali kanal OTA dinamis", () => {
    expect(sanitizePublicText("Harga diperiksa Crawl4AI 2026-11-20 oleh Gemini")).toBe("Harga terakhir diperiksa 2026-11-20 oleh");
    expect(channelFromSource("Google Maps")).toBe("google");
    expect(channelFromSource("Instagram")).toBe("social");
    expect(channelFromSource("MyCustomOta", ["MyCustomOta"])).toBe("ota");
    expect(channelFromSource("Agoda")).toBe("ota");
  });

  it("membersihkan teks tab Strategy dari rujukan Omset/Target dan menyembunyikan marketRank berbasis omset", () => {
    const cleanedAction = sanitizeStrategyText(
      "Promo kompetitor yang terdeteksi tampil di Langkah 4 (Promo Kompetitor) dan di halaman Omset, Target dan Strategy.",
    );
    expect(cleanedAction).toBe(
      "Promo kompetitor yang terdeteksi tampil di Langkah 4 (Promo Kompetitor) dan di bagian Radar Promo di bawah.",
    );
    expect(cleanedAction).not.toMatch(/\bomset\b/i);

    const cleanedAll = sanitizeStrategyText(
      "Promo kompetitor per outlet tampil di Langkah 4 dan di halaman Omset, Target dan Strategy.",
    );
    expect(cleanedAll).toBe("Promo kompetitor per outlet tampil di Langkah 4 dan di bagian Radar Promo di bawah.");
    expect(cleanedAll).not.toMatch(/\bomset\b/i);

    expect(visibleMarketRank("Belum ada data (tidak ada data omset resmi kompetitor non-hotel)")).toBeNull();
    expect(visibleMarketRank("#4 dari 7 resort")).toBe("#4 dari 7 resort");
    expect(visibleMarketRank(null)).toBeNull();
  });

  it("memverifikasi otorisasi cron timing-safe dan guard akses API tunggal (401/403 JSON)", async () => {
    expect(timingSafeSecretMatch("cron-secret-2026", "cron-secret-2026")).toBe(true);
    expect(timingSafeSecretMatch("salah", "cron-secret-2026")).toBe(false);
    expect(timingSafeSecretMatch("", "cron-secret-2026")).toBe(false);
    expect(
      isAuthorizedCronRequest(
        new Request("http://localhost:3001/api/cron/scrape", { headers: { authorization: "Bearer rahasia-cron" } }),
        "rahasia-cron",
      ),
    ).toBe(true);
    expect(
      isAuthorizedCronRequest(
        new Request("http://localhost:3001/api/cron/scrape", { headers: { authorization: "Bearer salah" } }),
        "rahasia-cron",
      ),
    ).toBe(false);

    const refused401 = await requireMarketingApiAccess(async () => new Response("Silakan login.", { status: 401 }));
    expect(refused401?.status).toBe(401);
    expect(await refused401?.json()).toEqual({
      ok: false,
      error: "Sesi login telah berakhir. Silakan login ulang.",
    });

    const refused403 = await requireMarketingApiAccess(
      async () => new Response("Tidak ada akses ke Marketing properti ini.", { status: 403 }),
    );
    expect(refused403?.status).toBe(403);
    expect(await refused403?.json()).toEqual({
      ok: false,
      error: "Tidak ada akses ke Marketing properti ini.",
    });

    expect(await requireMarketingApiAccess(async () => null)).toBeNull();
  });

  it("menghitung cakupan akun, statistik platform, grup per outlet, dan likeRatePercent untuk Media Sosial", () => {
    const samplePosts: SnSocialPost[] = [
      {
        id: "1",
        outletKey: "dragon-beach-club",
        platform: "instagram",
        postType: "reels",
        postedAt: "2026-11-21",
        postUrl: "https://www.instagram.com/dragonbeachclub/reel/A/",
        caption: "Promo malam Dragon",
        account: "dragonbeachclub",
        followers: 5124,
        profilePostsTotal: 1350,
        metrics: { views: 1000, likes: 20, comments: 1, shares: 0, inquiriesWa: 4 },
        audit: { hookScore: 70, copyScore: 70, ctaScore: 60, statusVerdict: "high_performing" },
      },
      {
        id: "2",
        outletKey: "dragon-beach-club",
        platform: "tiktok",
        postType: "tiktok_video",
        postedAt: "2026-11-20",
        postUrl: "https://www.tiktok.com/@dragonbeachclub/video/123",
        caption: "Video Dragon",
        account: "dragonbeachclub",
        followers: 2193,
        profilePostsTotal: 116,
        metrics: { views: 3000, likes: 50, comments: 2, shares: 1, inquiriesWa: null },
        audit: { hookScore: 80, copyScore: 70, ctaScore: 50, statusVerdict: "weak_cta" },
      },
    ];
    const sampleAccounts: SnOfficialSocialAccount[] = [
      {
        platform: "instagram",
        label: "@dragonbeachclub",
        url: "https://www.instagram.com/dragonbeachclub/",
        owner: "Dragon Beach Club",
        outlets: ["dragon-beach-club", "dbar"],
      },
      {
        platform: "tiktok",
        label: "@dragonbeachclub",
        url: "https://www.tiktok.com/@dragonbeachclub",
        owner: "Dragon Beach Club (TikTok)",
        outlets: ["dragon-beach-club"],
      },
    ];

    const cov = summarizeSocialAccountCoverage(samplePosts, sampleAccounts);
    expect(cov["instagram:dragonbeachclub"]).toEqual({
      syncedPosts: 1,
      profilePostsTotal: 1350,
      followers: 5124,
      incomplete: true,
      latestPostAt: "2026-11-21",
    });
    expect(cov["tiktok:dragonbeachclub"]).toEqual({
      syncedPosts: 1,
      profilePostsTotal: 116,
      followers: 2193,
      incomplete: true,
      latestPostAt: "2026-11-20",
    });

    const sosmed = computeSosmedStats(samplePosts, sampleAccounts, cov, samplePosts);
    expect(sosmed.instagram.followers).toBe(5124);
    expect(sosmed.instagram.posts).toBe(1);
    expect(sosmed.instagram.ownAccountPosts).toBe(1);
    expect(sosmed.instagram.parentAccountPosts).toBe(0);
    expect(sosmed.instagram.latestSyncedPostAt).toBe("2026-11-21");
    expect(sosmed.instagram.views?.total).toBe(1000);
    expect(sosmed.tiktok.followers).toBe(2193);
    expect(sosmed.tiktok.likes?.total).toBe(50);
    expect(sosmed.tiktok.latestSyncedPostAt).toBe("2026-11-20");
    expect(sosmed.likes).toEqual({ total: 70, counted: 2, average: 35 });
    expect(sosmed.caption).toEqual({ hook: 75, copy: 70, cta: 55, score: 67 });
    expect(sosmed.waLeads).toEqual({ total: 4, filled: 1 });

    // Kasus nyata Sunset Grill pada filter 1 Nov – 24 Nov 2026:
    // - IG hanya punya postingan akun induk (@sanghyangresort) di periode aktif, sementara @sunset_grillsanghyang terbaru 10 Mar 2024
    // - TikTok @sunsetgrill.sanghyang punya 2 postingan tersinkron (terbaru 17 Jul 2026), 0 di periode Nov 2026
    const sunsetAllPosts: SnSocialPost[] = [
      {
        id: "sg-ig-parent",
        outletKey: "sunset-grill",
        platform: "instagram",
        postType: "reels",
        postedAt: "2026-11-21",
        postUrl: "https://www.instagram.com/sanghyangresort/reel/ParentSG/",
        caption: "Makan malam di Sunset Grill",
        account: "sanghyangresort",
        followers: 7822,
        profilePostsTotal: 1739,
        metrics: { views: 1200, likes: 45, comments: 2, shares: 1, inquiriesWa: null },
        audit: { hookScore: 80, copyScore: 70, ctaScore: 60, statusVerdict: "high_performing" },
      },
      {
        id: "sg-ig-own-old",
        outletKey: "sunset-grill",
        platform: "instagram",
        postType: "feed",
        postedAt: "2024-03-10",
        postUrl: "https://www.instagram.com/sunset_grillsanghyang/p/Old1/",
        caption: "Menu Sunset Grill",
        account: "sunset_grillsanghyang",
        followers: 165,
        profilePostsTotal: 79,
        metrics: { views: null, likes: 12, comments: 0, shares: 0, inquiriesWa: null },
        audit: { hookScore: 70, copyScore: 65, ctaScore: 50, statusVerdict: "weak_cta" },
      },
      {
        id: "sg-tt-old",
        outletKey: "sunset-grill",
        platform: "tiktok",
        postType: "tiktok_video",
        postedAt: "2026-07-17",
        postUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7662293096746552597",
        caption: "Sunset Grill vibes",
        account: "sunsetgrill.sanghyang",
        followers: 114,
        profilePostsTotal: null,
        metrics: { views: 980, likes: 30, comments: 2, shares: 1, inquiriesWa: null },
        audit: { hookScore: 75, copyScore: 65, ctaScore: 45, statusVerdict: "weak_cta" },
      },
    ];
    const sunsetAccounts: SnOfficialSocialAccount[] = [
      {
        platform: "instagram",
        label: "@sunset_grillsanghyang",
        url: "https://www.instagram.com/sunset_grillsanghyang/",
        owner: "Sunset Grill",
        outlets: ["sunset-grill"],
      },
      {
        platform: "tiktok",
        label: "@sunsetgrill.sanghyang",
        url: "https://www.tiktok.com/@sunsetgrill.sanghyang",
        owner: "Sunset Grill (TikTok)",
        outlets: ["sunset-grill"],
      },
    ];
    const sunsetCov = summarizeSocialAccountCoverage(sunsetAllPosts, sunsetAccounts);
    const novPeriodPosts = sunsetAllPosts.filter((p) => p.postedAt >= "2026-11-01" && p.postedAt <= "2026-11-24");
    const sunsetStats = computeSosmedStats(novPeriodPosts, sunsetAccounts, sunsetCov, sunsetAllPosts);

    expect(sunsetStats.instagram.posts).toBe(1);
    expect(sunsetStats.instagram.ownAccountPosts).toBe(0);
    expect(sunsetStats.instagram.parentAccountPosts).toBe(1);
    expect(sunsetStats.instagram.parentHandles).toEqual(["@sanghyangresort"]);
    expect(sunsetStats.instagram.syncedAccountPosts).toBe(1);
    expect(sunsetStats.instagram.profilePostsTotal).toBe(79);
    expect(sunsetStats.instagram.latestSyncedPostAt).toBe("2024-03-10");
    expect(sunsetStats.instagram.latestOutletPostAt).toBe("2026-11-21");

    expect(sunsetStats.tiktok.posts).toBe(0);
    expect(sunsetStats.tiktok.syncedAccountPosts).toBe(1);
    expect(sunsetStats.tiktok.outletAllPostsCount).toBe(1);
    expect(sunsetStats.tiktok.profilePostsTotal).toBeNull();
    expect(sunsetStats.tiktok.latestSyncedPostAt).toBe("2026-07-17");
    expect(sunsetStats.tiktok.followers).toBe(114);

    // Pengikut akun lama @sunset_grillsanghyang (165) tidak boleh tercampur ke akun resmi aktif @sunsetgrillsanghyang
    const activeSunsetAccounts: SnOfficialSocialAccount[] = [
      {
        platform: "instagram",
        label: "@sunsetgrillsanghyang",
        url: "https://www.instagram.com/sunsetgrillsanghyang/",
        owner: "Sunset Grill",
        outlets: ["sunset-grill"],
      },
      sunsetAccounts[1],
    ];
    const activeCov = summarizeSocialAccountCoverage(sunsetAllPosts, activeSunsetAccounts);
    expect(activeCov["instagram:sunsetgrillsanghyang"]).toEqual({
      syncedPosts: 0,
      profilePostsTotal: null,
      followers: null,
      incomplete: false,
      latestPostAt: null,
    });
    const activeStats = computeSosmedStats(sunsetAllPosts, activeSunsetAccounts, activeCov, sunsetAllPosts);
    expect(activeStats.instagram.followers).toBeNull();
    expect(activeStats.instagram.syncedAccountPosts).toBe(0);
    expect(activeStats.instagram.parentHandles).toEqual(["@sanghyangresort", "@sunset_grillsanghyang"]);

    expect(likeRatePercent(20, 5000)).toBe(0.4);
    expect(likeRatePercent(20, 0)).toBeNull();
  });

  it("menghitung postingan kolaborasi eksternal (/<collab>/p/...) ke post.account resmi dan kolaborasi internal ke cakupan kedua akun tanpa meracuni followers/total", () => {
    const accounts: SnOfficialSocialAccount[] = [
      {
        platform: "instagram",
        label: "@sanghyangresort",
        url: "https://www.instagram.com/sanghyangresort/",
        owner: "Akun induk (Resort)",
        outlets: ["resort"],
      },
      {
        platform: "instagram",
        label: "@sunsetgrillsanghyang",
        url: "https://www.instagram.com/sunsetgrillsanghyang/",
        owner: "Sunset Grill",
        outlets: ["sunset-grill"],
      },
    ];
    const collabPosts: SnSocialPost[] = [
      {
        id: "collab-ext",
        outletKey: "sunset-grill",
        platform: "instagram",
        postType: "feed",
        postedAt: "2026-11-22",
        postUrl: "https://www.instagram.com/dj_external_anyer/p/ExtCollab01/",
        caption: "Live DJ di Sunset Grill",
        account: "sunsetgrillsanghyang",
        followers: 11200,
        profilePostsTotal: 619,
        metrics: { views: null, likes: 48, comments: 3, shares: 1, inquiriesWa: null },
        audit: { hookScore: 75, copyScore: 70, ctaScore: 60, statusVerdict: "high_performing" },
      },
      {
        id: "collab-int",
        outletKey: "sunset-grill",
        platform: "instagram",
        postType: "reels",
        postedAt: "2026-11-23",
        postUrl: "https://www.instagram.com/sunsetgrillsanghyang/reel/IntCollab02/",
        caption: "Sunset Dinner kolaborasi Sanghyang Resort & Sunset Grill",
        account: "sunsetgrillsanghyang",
        collabAccounts: ["sanghyangresort"],
        followers: 11250,
        profilePostsTotal: 619,
        metrics: { views: 2500, likes: 90, comments: 5, shares: 4, inquiriesWa: null },
        audit: { hookScore: 80, copyScore: 75, ctaScore: 70, statusVerdict: "high_performing" },
      },
    ];

    const cov = summarizeSocialAccountCoverage(collabPosts, accounts);
    expect(cov["instagram:sunsetgrillsanghyang"]).toEqual({
      syncedPosts: 2,
      profilePostsTotal: 619,
      followers: 11250,
      incomplete: true,
      latestPostAt: "2026-11-23",
    });
    expect(cov["instagram:dj_external_anyer"]).toBeUndefined();
    expect(cov["instagram:sanghyangresort"]).toEqual({
      syncedPosts: 1,
      profilePostsTotal: null,
      followers: null,
      incomplete: false,
      latestPostAt: "2026-11-23",
    });

    const sgStats = computeSosmedStats(collabPosts, [accounts[1]], cov, collabPosts);
    expect(sgStats.instagram.posts).toBe(2);
    expect(sgStats.instagram.ownAccountPosts).toBe(2);
    expect(sgStats.instagram.parentAccountPosts).toBe(0);
    expect(sgStats.instagram.syncedAccountPosts).toBe(2);
    expect(sgStats.instagram.profilePostsTotal).toBe(619);
    expect(sgStats.instagram.followers).toBe(11250);
  });

  it("menyusun action plan lintas faktor, reputasi resort, promo kamar aktif, dan bukti ulasan terverifikasi", () => {
    const summary: SnSummary = {
      title: "Test Summary",
      generatedAt: "2026-11-24T00:00:00Z",
      sanghyang: { rating: 4.4, reviewCount: 1200 },
      outlets: [
        {
          id: "o1",
          key: "resort",
          name: "Sanghyang Indah Spa Resort",
          rating: 4.4,
          reviewCount: 1200,
          sentimentDistribution: { positive: 18, neutral: 4, negative: 8, total: 30 },
          topAspects: [
            { aspect: "pemandian air panas", count: 10, positiveRatio: 90, negativeRatio: 5 },
            { aspect: "kebersihan", count: 6, positiveRatio: 30, negativeRatio: 50 },
          ],
          reviews: [],
          verifiedReviews: [
            { id: "r1", externalId: "e1", source: "Google", rating: 2, reviewDate: "2026-11-10", text: "AC kamar kurang dingin", sentiment: "negative", themes: ["ac"], verified: true },
            { id: "r2", externalId: "e2", source: "Google", rating: 5, reviewDate: "2026-11-12", text: "Hot spring sangat nyaman", sentiment: "positive", themes: ["hot spring"], verified: true },
          ],
          findings: [],
        },
      ],
      comparisons: [],
      compsetAudit: {
        resort: {
          used: [
            { name: "Aston Anyer", compsetRole: "inti", rating: 4.6 },
            { name: "Mambruk Hotel", compsetRole: "inti", rating: 4.3 },
          ],
          excluded: [],
        },
      },
      competitorSocialRadar: [
        {
          id: "p1",
          competitorName: "Aston Anyer",
          competitorOutlets: ["resort"],
          competitorIsLodging: true,
          platform: "website",
          category: "Kamar & Menginap",
          title: "Early Bird 25% OFF",
          status: "active",
          startsAt: "2026-11-01",
          endsAt: "2026-12-01",
          price: 900000,
          discount: 25,
          kind: "promo",
        },
      ],
      ownPromos: [],
      outletMarketShare: {
        resort: {
          outletKey: "resort",
          outletName: "Kamar & Resort",
          activeMonth: "November 2026",
          totalMarketSizeEstimated: 5000000000,
          marketSharePercentage: 8.5,
          marketSegmentName: "Resort Bintang 4",
          marketRank: "#4 dari 7 resort",
          pricePositioningIndex: 78,
          pricePositioningCategory: "Value-Leader",
          digitalMarketingStrategy: {
            pricingOptimization: { title: "Optimasi Harga", currentAnalysis: "Di bawah koridor", recommendation: "Naikkan bertahap" },
            sentimentLeverage: { title: "Sentimen", positiveDrivers: ["Hot Spring"], negativeFriction: ["AC"], marketingAngle: "Air panas alami" },
            competitorCounterPromo: { title: "Tanggapan", competitorAction: "Diskon 25%", ourCounterStrategy: "Paket nilai tambah" },
            promoFormulation: { promoName: "Paket Relaksasi", headline: "Inap + Hot Spring", discountStructure: "Nilai tambah", targetAudience: "Keluarga", terms: "Hari biasa", crossSellingOutlet: "D'Spa" },
          },
        },
      },
      news: [],
    };

    const rep = computeResortReputation(summary);
    expect(rep?.median).toBe(4.45);
    expect(rep?.rank).toBe(2);
    expect(rep?.meetsMedian).toBe(false);

    expect(activeRoomPromos(summary.competitorSocialRadar ?? [])).toHaveLength(1);
    expect(deepestCompetitorDiscount(summary.competitorSocialRadar ?? [])).toBe(25);

    const fb = verifiedFeedback(summary.outlets[0].verifiedReviews ?? []);
    expect(fb.complaints).toHaveLength(1);
    expect(fb.praises).toHaveLength(1);

    const plan = buildOutletActionPlan(summary, "resort");
    expect(plan.some((i) => i.factor === "Kata tamu" && i.finding.includes("kebersihan"))).toBe(true);
    expect(plan.some((i) => i.factor === "Rating")).toBe(true);
    expect(plan.some((i) => i.factor === "Pasar")).toBe(true);
    expect(plan.some((i) => i.factor === "Promo kompetitor")).toBe(true);
  });
});

describe("refresh-follow SSE dan status pembaruan", () => {
  it("mengurai aliran SSE dan menyisakan fragmen belum lengkap", () => {
    const { events, rest } = parseSse(': ping\n\ndata: {"a":1}\n\ndata: {"b":');
    expect(events).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b":');
  });

  it("membedakan state lama, berjalan, selesai, dan hilang pada followEvent", () => {
    const running: RefreshState = {
      origin: "lokal",
      startedAt: "2026-11-24T01:00:00Z",
      finishedAt: null,
      failed: null,
      steps: [{ key: "berita", label: "Berita", status: "berjalan", detail: null, startedAt: null, finishedAt: null }],
    };
    const done: RefreshState = {
      ...running,
      finishedAt: "2026-11-24T01:05:00Z",
      failed: false,
      steps: [{ key: "berita", label: "Berita", status: "berhasil", detail: "ok", startedAt: null, finishedAt: null }],
    };
    expect(followEvent(null, done).type).toBe("lama");
    expect(followEvent(null, running).type).toBe("keadaan");
    expect(followEvent(running, done).type).toBe("selesai");
    expect(followEvent(running, null).type).toBe("hilang");
    expect(reconnectDelay(1)).toBe(1000);
    expect(reconnectDelay(10)).toBe(30000);
  });

  it("merangkum status langkah dan menerjemahkan pesan kendala scraping ke bahasa awam", () => {
    const counts = countVerdicts([
      { status: "berhasil" },
      { status: "sebagian" },
      { status: "dilewati" },
    ]);
    expect(describeCounts(counts)).toBe("1 berhasil, 1 sebagian, 0 gagal, 1 dilewati");
    expect(refreshHeadline({ finishedAt: "2026-11-24T01:05:00Z", steps: [{ status: "berhasil" }] })).toBe("Pembaruan selesai");
    expect(friendlyScrapeIssue("Sosmed gagal untuk Aston Anyer: login wall")).toBe("Aston Anyer: Instagram meminta login");
  });

  it("menyaring target sinkronisasi ekstensi berdasarkan outlet dan platform tanpa menarik TikTok untuk D'Bar", () => {
    const targets: ExtensionTargetItem[] = [
      { targetKey: "own:instagram:sunsetgrillsanghyang", targetType: "own", outletKey: "sunset-grill", platform: "instagram", handle: "sunsetgrillsanghyang" },
      { targetKey: "own:tiktok:sunsetgrill.sanghyang", targetType: "own", outletKey: "sunset-grill", platform: "tiktok", handle: "sunsetgrill.sanghyang" },
      { targetKey: "own:instagram:dragonbeachclub", targetType: "own", outletKey: "dragon-beach-club", platform: "instagram", handle: "dragonbeachclub" },
      { targetKey: "own:tiktok:dragonbeachclub", targetType: "own", outletKey: "dragon-beach-club", platform: "tiktok", handle: "dragonbeachclub" },
      { targetKey: "comp:mambruk:tiktok", targetType: "competitor", outletKey: "resort", platform: "tiktok", handle: "mambruk_official" },
    ];

    expect(selectTargetsForSync(targets, { outletKey: "sunset-grill", platform: "tiktok" }).map((t) => t.targetKey)).toEqual([
      "own:tiktok:sunsetgrill.sanghyang",
    ]);
    expect(selectTargetsForSync(targets, { outletKey: "dbar" }).map((t) => t.targetKey)).toEqual([
      "own:instagram:dragonbeachclub",
    ]);
    expect(selectTargetsForSync(targets, { outletKey: "all", platform: "tiktok" }).map((t) => t.targetKey)).toEqual([
      "own:tiktok:sunsetgrill.sanghyang",
      "own:tiktok:dragonbeachclub",
    ]);
    expect(selectTargetsForSync(targets, {}).length).toBe(5);
  });

  it("memformat fase progres ekstensi v1.1.8 (profil, Reels, detail dengan konteks DB & feed-tap) dan membedakan status Lengkap, Batas bawah, Sebagian, Tertahan, dan Tidak ditemukan", () => {
    const baseState: SocialExtensionState = {
      status: "running",
      runStartedAt: "2026-11-25T00:00:00Z",
      totalTargets: 26,
      completedTargets: 2,
      currentTargetName: "Dragon Beach Club (@dragonbeachclub)",
      currentTargetHandle: "dragonbeachclub",
      currentTargetPlatform: "instagram",
      currentTargetCollected: 1348,
      currentTargetExpected: 1350,
      pausedReason: null,
      pausedKind: null,
      pausedUrl: null,
      pausedTargetName: null,
      pendingCount: 0,
      syncedPostsCount: 1228,
      syncedCommentsCount: 42,
      errors: [],
    };

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "profile",
      }),
    ).toBe("Memindai daftar postingan profil (1.348 / 1.350)");

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "scanning_profile",
      }),
    ).toBe("Memindai daftar postingan profil (1.348 / 1.350)");

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "reels",
        currentReelsAdded: 14,
      }),
    ).toBe("Memindai tab Reels (+14)");

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "scanning_reels",
        currentReelsAdded: 0,
      }),
    ).toBe("Memindai tab Reels (+0)");

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "details",
        currentDetailIndex: 45,
        currentDetailTotal: 120,
      }),
    ).toBe("Mengambil detail 45 / 120 postingan baru & terbaru · dipindai 1.348 / 1.350");

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "fetching_details",
        currentDetailIndex: 120,
        currentDetailTotal: 120,
        currentTargetCollected: null,
        currentTargetExpected: null,
      }),
    ).toBe("Mengambil detail 120 / 120 postingan baru & terbaru");

    // Konteks utuh v1.1.8 pada fase details: tidak lagi membingungkan seperti "(30 / 40)" tanpa jumlah DB & feed-tap
    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "details",
        currentDetailIndex: 30,
        currentDetailTotal: 40,
        currentTargetCollected: 400,
        currentTargetExpected: 1739,
        currentSkippedKnown: 210,
        currentFeedSaved: 150,
      }),
    ).toBe("Mengambil detail 30 / 40 postingan baru & terbaru · 210 sudah lengkap di DB · +150 tersimpan dari feed · dipindai 400 / 1.739");

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "details",
        currentDetailIndex: 30,
        currentDetailTotal: 40,
        currentTargetCollected: 250,
        currentTargetExpected: 1739,
        currentSkippedKnown: 210,
        currentFeedSaved: 0,
      }),
    ).toBe("Mengambil detail 30 / 40 postingan baru & terbaru · 210 sudah lengkap di DB · dipindai 250 / 1.739");

    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "profile",
        currentTargetCollected: 420,
        currentTargetExpected: 1739,
        currentFeedSaved: 120,
        currentHasNextPage: true,
      }),
    ).toBe("Memindai daftar postingan profil (420 / 1.739) · +120 tersimpan dari feed · halaman berikutnya masih ada");

    expect(EXTENSION_SYNC_BATCH_LIMIT).toBe(15);

    // Progres persen mulus bahkan untuk sinkron 1 akun (tidak macet di 0% saat sedang mengambil detail)
    expect(
      computeExtensionProgressPercent({
        ...baseState,
        totalTargets: 1,
        completedTargets: 0,
        currentPhase: "details",
        currentDetailIndex: 50,
        currentDetailTotal: 100,
      }),
    ).toBeGreaterThan(20);
    expect(
      computeExtensionProgressPercent({
        ...baseState,
        status: "completed",
        completedTargets: 26,
      }),
    ).toBe(100);

    // Pembedaan status targetResults (selaras kontrak v1.1.8 anti-false Batas bawah)
    const targets: SocialExtensionTargetProgress[] = [
      { targetKey: "t0", status: "ok", collected: 1348, expected: 1350, reachedBottom: true },
      { targetKey: "t1", status: "ok", collected: 116, expected: 116, reachedBottom: true },
      {
        targetKey: "t2",
        status: "partial",
        collected: 560,
        expected: 619,
        reachedBottom: true,
        hasNextPage: false,
        reason: "Mencapai batas bawah profil (560 dari 619 angka header)",
      },
      {
        targetKey: "t3",
        status: "bottom_reached",
        collected: 580,
        expected: 619,
        reachedBottom: true,
        hasNextPage: false,
      },
      {
        targetKey: "t4",
        status: "partial",
        collected: 420,
        expected: 619,
        reachedBottom: false,
        reason: "Gulir berhenti sebelum batas bawah",
      },
      { targetKey: "t5", status: "paused", collected: 12, expected: 619, reason: "Perlu login" },
      { targetKey: "t6", status: "not_found", collected: 0, expected: null, reason: "Akun tidak ditemukan" },
      { targetKey: "t7", status: "running", collected: 50, expected: 100 },
      // Kasus regresi kritis v1.1.7: 250 / 1.739 (14%) tidak boleh pernah dilabeli Batas bawah!
      {
        targetKey: "t8",
        status: "bottom_reached",
        collected: 250,
        expected: 1739,
        reachedBottom: true,
      },
      // Kasus hasNextPage === true dari server platform: tidak boleh dilabeli Batas bawah!
      {
        targetKey: "t9",
        status: "bottom_reached",
        collected: 580,
        expected: 619,
        reachedBottom: true,
        hasNextPage: true,
      },
      // Akun kecil (expected < 50) yang memang mencapai batas bawah tetap boleh Batas bawah
      {
        targetKey: "t10",
        status: "bottom_reached",
        collected: 20,
        expected: 45,
        reachedBottom: true,
        hasNextPage: false,
      },
    ];

    expect(classifyExtensionTargetStatus(targets[0])).toMatchObject({ kind: "ok", label: "Lengkap", isIssue: false });
    expect(classifyExtensionTargetStatus(targets[1])).toMatchObject({ kind: "ok", label: "Lengkap", isIssue: false });
    expect(classifyExtensionTargetStatus(targets[2])).toMatchObject({
      kind: "bottom_reached",
      label: "Batas bawah",
      isIssue: false,
      isBottomReached: true,
    });
    expect(classifyExtensionTargetStatus(targets[3])).toMatchObject({
      kind: "bottom_reached",
      label: "Batas bawah",
      isIssue: false,
      isBottomReached: true,
    });
    expect(classifyExtensionTargetStatus(targets[4])).toMatchObject({
      kind: "partial",
      label: "Sebagian",
      isIssue: true,
      isBottomReached: false,
    });
    expect(classifyExtensionTargetStatus(targets[5])).toMatchObject({ kind: "held", label: "Tertahan", isIssue: true });
    expect(classifyExtensionTargetStatus(targets[6])).toMatchObject({
      kind: "not_found",
      label: "Tidak ditemukan",
      isIssue: true,
    });
    expect(classifyExtensionTargetStatus(targets[7])).toMatchObject({ kind: "running", label: "Memeriksa…", isIssue: false });
    expect(classifyExtensionTargetStatus(targets[8])).toMatchObject({
      kind: "partial",
      label: "Sebagian (belum lengkap)",
      className: "bg-amber-100 text-amber-900",
      isIssue: true,
      isBottomReached: false,
    });
    expect(classifyExtensionTargetStatus(targets[9])).toMatchObject({
      kind: "partial",
      label: "Sebagian (belum lengkap)",
      className: "bg-amber-100 text-amber-900",
      isIssue: true,
      isBottomReached: false,
    });
    expect(classifyExtensionTargetStatus(targets[10])).toMatchObject({
      kind: "bottom_reached",
      label: "Batas bawah",
      isIssue: false,
      isBottomReached: true,
    });
    // Bahkan bila status keliru "ok" tetapi cakupan <50% pada akun besar (>=50), wajib "Sebagian (belum lengkap)"
    expect(
      classifyExtensionTargetStatus({
        targetKey: "t-bad-ok",
        status: "ok",
        collected: 250,
        expected: 1739,
        reachedBottom: true,
      }),
    ).toMatchObject({
      kind: "partial",
      label: "Sebagian (belum lengkap)",
      className: "bg-amber-100 text-amber-900",
      isIssue: true,
      isBottomReached: false,
    });

    const summary = summarizeExtensionTargets(targets);
    expect(summary).toMatchObject({
      okCount: 2,
      bottomCount: 3,
      issueCount: 5,
      runningCount: 1,
    });
  });

  it("friendlyScrapeIssue tidak pernah membocorkan env var server atau pesan Perlu login ulang di Chrome", () => {
    const leakyMessages = [
      "Dilewati: Instagram (Perlu login ulang di Chrome: selesaikan masuk akun atau tantangan Instagram langsung pada tab Chrome melalui Ekstensi Chrome Sanghyang Market Sync (jalur otomatis server tetap membutuhkan INSTAGRAM_GRAPH_ACCESS_TOKEN dan INSTAGRAM_BUSINESS_ACCOUNT_ID)).",
      "Instagram: belum dikonfigurasi, isi INSTAGRAM_GRAPH_ACCESS_TOKEN dan INSTAGRAM_BUSINESS_ACCOUNT_ID.",
      "Dilewati: Instagram (isi INSTAGRAM_GRAPH_ACCESS_TOKEN dan INSTAGRAM_BUSINESS_ACCOUNT_ID)",
      "Instagram Graph API belum tersambung: isi INSTAGRAM_GRAPH_ACCESS_TOKEN dan INSTAGRAM_BUSINESS_ACCOUNT_ID untuk mengaktifkan.",
      "Sosmed gagal untuk Aston Anyer: Perlu login ulang di Chrome karena sesi berakhir (INSTAGRAM_GRAPH_ACCESS_TOKEN)",
    ];

    for (const raw of leakyMessages) {
      const result = friendlyScrapeIssue(raw);
      expect(result).not.toContain("INSTAGRAM_GRAPH_ACCESS_TOKEN");
      expect(result).not.toContain("INSTAGRAM_BUSINESS_ACCOUNT_ID");
      expect(result.toLowerCase()).not.toContain("perlu login ulang di chrome");
      expect(result.trim().length).toBeGreaterThan(10);
    }

    // Regresi lama: login wall akun spesifik tetap diterjemahkan rapi
    expect(friendlyScrapeIssue("Sosmed gagal untuk Aston Anyer: login wall")).toBe("Aston Anyer: Instagram meminta login");
  });

  it("SnExtensionPanel membungkus status fase panjang dan error URL panjang tanpa tabular-nums (anti-overflow)", () => {
    const noop = async () => undefined;
    const longPhaseSync: UseSocialExtensionSyncResult = {
      checking: false,
      extensionInstalled: true,
      extensionVersion: "1.1.9",
      requiredVersion: "1.1.9",
      needsUpdate: false,
      assetsMissing: false,
      isIncognito: false,
      incognitoWarning: null,
      savingBatch: true,
      savedPostsTotal: 2481,
      savedCommentsTotal: 142,
      error: null,
      refreshDetection: async () => true,
      startSync: noop,
      resumeSync: noop,
      skipTarget: noop,
      focusPausedTab: noop,
      cancelSync: noop,
      flushPending: noop,
      state: {
        status: "running",
        runStartedAt: "2026-11-25T03:00:00Z",
        totalTargets: 26,
        completedTargets: 2,
        currentTargetName: "Sanghyang Indah Spa Resort",
        currentTargetHandle: "sanghyangsparesort",
        currentTargetPlatform: "tiktok",
        currentTargetCollected: 2797,
        currentTargetExpected: 2799,
        currentPhase: "details",
        currentDetailIndex: 9,
        currentDetailTotal: 267,
        currentSkippedKnown: 49,
        currentFeedSaved: 2481,
        pausedReason: null,
        pausedKind: null,
        pausedUrl: null,
        pausedTargetName: null,
        pendingCount: 0,
        syncedPostsCount: 2481,
        syncedCommentsCount: 142,
        targetResults: [
          {
            targetKey: "own:tiktok:sanghyangsparesort",
            name: "Sanghyang Indah Spa Resort",
            handle: "sanghyangsparesort",
            platform: "tiktok",
            status: "partial",
            collected: 2797,
            expected: 2799,
            feedSaved: 2481,
            skippedKnown: 49,
          },
        ],
        errors: [
          "(https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698): detail postingan kosong/tidak terbaca.",
        ],
      },
    };

    const html = renderToStaticMarkup(createElement(SnExtensionPanel, { sync: longPhaseSync, compact: true }));
    expect(html).toContain("Mengambil detail 9 / 267 postingan baru &amp; terbaru");
    expect(html).toContain("https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698");
    // globals.css menetapkan `.tabular-nums { white-space: nowrap; }`; dilarang muncul di teks panjang SnExtensionPanel
    expect(html).not.toContain("tabular-nums");
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("overflow-hidden");
  });

  it("memisahkan hitungan grid vs Reels pada formatExtensionTargetCounts, menangani fase cooldown, memakai profileCollected pada klasifikasi, dan merender tata letak 2 baris serta tombol rate_limit di SnExtensionPanel", () => {
    // 1. formatExtensionTargetCounts tidak pernah menghasilkan pembilang > penyebut seperti "1.354 / 1.350"
    expect(formatExtensionTargetCounts({ targetKey: "empty", status: "running" })).toBeNull();
    expect(
      formatExtensionTargetCounts({
        targetKey: "own:instagram:dragonbeachclub",
        collected: 1354,
        profileCollected: 1348,
        expected: 1350,
        reelsAdded: 6,
        feedSaved: 366,
        skippedKnown: 845,
      }),
    ).toBe("1.348 / 1.350 grid + 6 Reels (1.354 total) · +366 dari feed · 845 sudah di DB");
    expect(
      formatExtensionTargetCounts({
        targetKey: "own:instagram:dragon-legacy",
        collected: 1354,
        expected: 1350,
        reelsAdded: 6,
      }),
    ).toBe("1.348 / 1.350 grid + 6 Reels (1.354 total)");
    expect(
      formatExtensionTargetCounts({
        targetKey: "own:instagram:dspasanghyang",
        collected: 56,
        profileCollected: 53,
        expected: 53,
        reelsAdded: 3,
      }),
    ).toBe("53 / 53 grid + 3 Reels (56 total)");
    expect(
      formatExtensionTargetCounts({
        targetKey: "comp:pisita:instagram",
        collected: 267,
        profileCollected: 244,
        expected: 244,
        reelsAdded: 23,
      }),
    ).toBe("244 / 244 grid + 23 Reels (267 total)");
    expect(
      formatExtensionTargetCounts({
        targetKey: "grid-over-header-with-reels",
        collected: 65,
        profileCollected: 60,
        expected: 58,
        reelsAdded: 5,
      }),
    ).toBe("60 grid (header 58) + 5 Reels (65 total)");
    expect(
      formatExtensionTargetCounts({
        targetKey: "reels-no-header",
        collected: 24,
        profileCollected: 20,
        expected: null,
        reelsAdded: 4,
      }),
    ).toBe("20 grid + 4 Reels (24 total)");
    expect(
      formatExtensionTargetCounts({
        targetKey: "over-expected-no-reels",
        collected: 130,
        expected: 126,
      }),
    ).toBe("130 dipindai (header 126)");
    expect(
      formatExtensionTargetCounts({
        targetKey: "own:instagram:dbistrosanghyang",
        collected: 126,
        expected: 126,
      }),
    ).toBe("126 / 126 postingan");
    expect(
      formatExtensionTargetCounts({
        targetKey: "no-expected-no-reels",
        collected: 42,
        expected: null,
      }),
    ).toBe("42 postingan");

    // 2. formatExtensionPhaseProgress: fase cooldown dan fase details saat collected > expected + reelsAdded > 0
    const baseState: SocialExtensionState = {
      status: "running",
      runStartedAt: "2026-11-25T04:00:00Z",
      totalTargets: 26,
      completedTargets: 5,
      currentTargetName: "Mambruk Hotel & Convention",
      currentTargetHandle: "mambrukhotelanyer",
      currentTargetPlatform: "instagram",
      currentTargetCollected: null,
      currentTargetExpected: null,
      pausedReason: null,
      pausedKind: null,
      pausedUrl: null,
      pausedTargetName: null,
      pendingCount: 0,
      syncedPostsCount: 500,
      syncedCommentsCount: 20,
      errors: [],
    };
    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "cooldown",
      }),
    ).toBe("Menunggu jeda batas permintaan platform sebelum mencoba ulang…");
    expect(
      formatExtensionPhaseProgress({
        ...baseState,
        currentPhase: "cooldown",
        currentTargetCollected: 89,
        currentTargetExpected: 1295,
      }),
    ).toBe("Menunggu jeda batas permintaan platform sebelum mencoba ulang… · dipindai 89 / 1.295");
    const detailsWithReels = formatExtensionPhaseProgress({
      ...baseState,
      currentPhase: "details",
      currentDetailIndex: 12,
      currentDetailTotal: 20,
      currentProfileCollected: 1348,
      currentTargetCollected: 1354,
      currentTargetExpected: 1350,
      currentReelsAdded: 6,
    });
    expect(detailsWithReels).toBe(
      "Mengambil detail 12 / 20 postingan baru & terbaru · dipindai 1.348 / 1.350 grid + 6 Reels (1.354 total)",
    );
    expect(detailsWithReels).not.toContain("1.354 / 1.350");

    // 3. classifyExtensionTargetStatus memakai profileCollected agar Reels-only tidak menyamarkan grid yang baru terambil sebagian
    expect(
      classifyExtensionTargetStatus({
        targetKey: "reels-masked-severe",
        status: "ok",
        profileCollected: 40,
        collected: 98,
        expected: 100,
        reelsAdded: 58,
        reachedBottom: true,
      }),
    ).toMatchObject({
      kind: "partial",
      label: "Sebagian (belum lengkap)",
      isIssue: true,
      isBottomReached: false,
    });
    expect(
      classifyExtensionTargetStatus({
        targetKey: "reels-masked-gap",
        status: "ok",
        profileCollected: 80,
        collected: 100,
        expected: 100,
        reelsAdded: 20,
        reachedBottom: false,
      }),
    ).toMatchObject({
      kind: "partial",
      label: "Sebagian",
      isIssue: true,
      isBottomReached: false,
    });
    expect(
      classifyExtensionTargetStatus({
        targetKey: "dragon-complete-with-reels",
        status: "ok",
        profileCollected: 1348,
        collected: 1354,
        expected: 1350,
        reelsAdded: 6,
        reachedBottom: true,
      }),
    ).toMatchObject({
      kind: "ok",
      label: "Lengkap",
      isIssue: false,
    });

    // 4. SSR SnExtensionPanel: tidak ada "1.354 / 1.350", "56 / 53", "267 / 244"; 2 baris rapi; cooldown & tombol rate_limit tampil benar
    const noop = async () => undefined;
    const baseSync: UseSocialExtensionSyncResult = {
      checking: false,
      extensionInstalled: true,
      extensionVersion: "1.1.10",
      requiredVersion: "1.1.10",
      needsUpdate: false,
      assetsMissing: false,
      isIncognito: false,
      incognitoWarning: null,
      savingBatch: false,
      savedPostsTotal: 1677,
      savedCommentsTotal: 40,
      error: null,
      refreshDetection: async () => true,
      startSync: noop,
      resumeSync: noop,
      skipTarget: noop,
      focusPausedTab: noop,
      cancelSync: noop,
      flushPending: noop,
      state: {
        ...baseState,
        status: "running",
        currentPhase: "cooldown",
        currentTargetCollected: 89,
        currentTargetExpected: 1295,
        targetResults: [
          {
            targetKey: "own:instagram:dragonbeachclub",
            name: "Dragon Beach Club & d'Bar",
            handle: "dragonbeachclub",
            platform: "instagram",
            status: "partial",
            profileCollected: 1348,
            collected: 1354,
            expected: 1350,
            reelsAdded: 6,
            feedSaved: 366,
            skippedKnown: 845,
          },
          {
            targetKey: "own:instagram:dspasanghyang",
            name: "D'Spa Sanghyang",
            handle: "dspasanghyang",
            platform: "instagram",
            status: "partial",
            profileCollected: 53,
            collected: 56,
            expected: 53,
            reelsAdded: 3,
          },
          {
            targetKey: "comp:pisita:instagram",
            name: "My Pisita Anyer Resort",
            handle: "pisitaresortanyer",
            platform: "instagram",
            status: "partial",
            profileCollected: 244,
            collected: 267,
            expected: 244,
            reelsAdded: 23,
          },
        ],
      },
    };

    const panelHtml = renderToStaticMarkup(createElement(SnExtensionPanel, { sync: baseSync, compact: true }));
    expect(panelHtml).toContain("Menunggu jeda batas permintaan platform sebelum mencoba ulang… · dipindai 89 / 1.295");
    expect(panelHtml).toContain("1.348 / 1.350 grid + 6 Reels (1.354 total) · +366 dari feed · 845 sudah di DB");
    expect(panelHtml).toContain("53 / 53 grid + 3 Reels (56 total)");
    expect(panelHtml).toContain("244 / 244 grid + 23 Reels (267 total)");
    expect(panelHtml).not.toContain("1.354 / 1.350");
    expect(panelHtml).not.toContain("56 / 53");
    expect(panelHtml).not.toContain("267 / 244");
    expect(panelHtml).not.toContain("tabular-nums");
    expect(panelHtml).toContain("items-start justify-between gap-2");
    expect(panelHtml).toContain("mt-1 min-w-0 max-w-full space-y-0.5");

    const rateLimitSync: UseSocialExtensionSyncResult = {
      ...baseSync,
      state: {
        ...baseSync.state!,
        status: "needs_human_action",
        pausedKind: "rate_limit",
        pausedTargetName: "Mambruk Hotel & Convention (@mambrukhotelanyer)",
        pausedReason: "Instagram membatasi permintaan sementara pada akun Mambruk. Tunggu 1–2 menit lalu klik Lanjutkan.",
      },
    };
    const pausedHtml = renderToStaticMarkup(createElement(SnExtensionPanel, { sync: rateLimitSync, compact: true }));
    expect(pausedHtml).toContain("Sudah Tunggu Jeda · Lanjutkan");
    expect(pausedHtml).not.toContain("Sudah Selesai Login / CAPTCHA · Lanjutkan");
  });

  it("resolveDisplayRefreshSteps dan RefreshProgressPanel menyinkronkan langkah sosmed dengan Ekstensi Chrome tanpa bocor env var dan tanpa overflow", () => {
    const noop = async () => undefined;
    const leakyServerDetail =
      "Instagram: Perlu login ulang di Chrome: selesaikan masuk akun atau tantangan Instagram langsung pada tab Chrome melalui Ekstensi Chrome Sanghyang Market Sync (jalur otomatis server tetap membutuhkan INSTAGRAM_GRAPH_ACCESS_TOKEN dan INSTAGRAM_BUSINESS_ACCOUNT_ID). TikTok: 4 dari 4 video tercatat masih tersedia.";
    const baseSteps: RefreshStep[] = [
      {
        key: "berita",
        label: "Berita kawasan Anyer (Google News)",
        status: "berhasil",
        detail: "12 berita terbaru dibaca.",
        startedAt: "2026-11-25T03:00:00Z",
        finishedAt: "2026-11-25T03:00:20Z",
      },
      {
        key: "sosmed",
        label: "Postingan media sosial kompetitor",
        status: "dilewati",
        detail: leakyServerDetail,
        startedAt: "2026-11-25T03:00:21Z",
        finishedAt: "2026-11-25T03:00:25Z",
      },
    ];

    // 1. Tanpa ekstensi terpasang: detail disanitasi, info TikTok tetap utuh, 0 bocor env/login ulang Chrome
    const sanitizedOnly = sanitizeRefreshStepDetail(leakyServerDetail);
    expect(sanitizedOnly).not.toContain("INSTAGRAM_GRAPH_ACCESS_TOKEN");
    expect(sanitizedOnly).not.toContain("INSTAGRAM_BUSINESS_ACCOUNT_ID");
    expect(sanitizedOnly?.toLowerCase()).not.toContain("perlu login ulang di chrome");
    expect(sanitizedOnly).toContain("TikTok: 4 dari 4 video tercatat masih tersedia.");

    const withoutExt = resolveDisplayRefreshSteps(baseSteps, { extensionInstalled: false, state: null }, "2026-11-25T03:00:00Z");
    expect(withoutExt[1].status).toBe("dilewati");
    expect(withoutExt[1].detail).not.toContain("INSTAGRAM_GRAPH_ACCESS_TOKEN");
    expect(withoutExt[1].detail?.toLowerCase()).not.toContain("perlu login ulang di chrome");

    // 2. Saat ekstensi berjalan: langkah sosmed menjadi "berjalan"
    const runningExt: UseSocialExtensionSyncResult = {
      checking: false,
      extensionInstalled: true,
      extensionVersion: "1.1.9",
      requiredVersion: "1.1.9",
      needsUpdate: false,
      assetsMissing: false,
      isIncognito: false,
      incognitoWarning: null,
      savingBatch: false,
      savedPostsTotal: 0,
      savedCommentsTotal: 0,
      error: null,
      refreshDetection: async () => true,
      startSync: noop,
      resumeSync: noop,
      skipTarget: noop,
      focusPausedTab: noop,
      cancelSync: noop,
      flushPending: noop,
      state: {
        status: "running",
        runStartedAt: "2026-11-25T03:00:02Z",
        totalTargets: 26,
        completedTargets: 4,
        currentTargetName: "Aston Anyer Beach Hotel",
        currentTargetPlatform: "instagram",
        currentPhase: "details",
        currentDetailIndex: 9,
        currentDetailTotal: 267,
        currentSkippedKnown: 49,
        currentFeedSaved: 2481,
        currentTargetCollected: 2797,
        currentTargetExpected: 2799,
        pausedReason: null,
        pausedKind: null,
        pausedUrl: null,
        pausedTargetName: null,
        pendingCount: 0,
        syncedPostsCount: 2481,
        syncedCommentsCount: 84,
        errors: [
          "(https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698): detail postingan kosong/tidak terbaca.",
        ],
      },
    };

    const resolvedRunning = resolveDisplayRefreshSteps(baseSteps, runningExt, "2026-11-25T03:00:00Z");
    expect(resolvedRunning[1].status).toBe("berjalan");
    expect(resolvedRunning[1].detail).toContain("4/26 akun");
    expect(resolvedRunning[1].detail).toContain("2.481 postingan");

    // 3. Saat ekstensi selesai: langkah sosmed menjadi "berhasil" dengan ringkasan akun & postingan
    const completedExt: UseSocialExtensionSyncResult = {
      ...runningExt,
      savedPostsTotal: 1420,
      savedCommentsTotal: 96,
      state: {
        ...runningExt.state!,
        status: "completed",
        completedTargets: 26,
        totalTargets: 26,
        syncedPostsCount: 1420,
        syncedCommentsCount: 96,
        pendingCount: 0,
        errors: [],
      },
    };
    const resolvedCompleted = resolveDisplayRefreshSteps(baseSteps, completedExt, "2026-11-25T03:00:00Z");
    expect(resolvedCompleted[1].status).toBe("berhasil");
    expect(resolvedCompleted[1].detail).toContain("26/26 akun");
    expect(resolvedCompleted[1].detail).toContain("1.420 postingan");
    expect(countVerdicts(resolvedCompleted)).toEqual({ berhasil: 2, sebagian: 0, gagal: 0, dilewati: 0 });

    // 4. Saat server sudah "berhasil" (mis. data segar dari backend) dan ekstensi idle, status server tidak ditimpa
    const serverDoneSteps: RefreshStep[] = [
      {
        key: "sosmed",
        label: "Postingan media sosial kompetitor",
        status: "berhasil",
        detail: "26 akun media sosial sudah tersinkron hari ini.",
        startedAt: "2026-11-25T03:00:00Z",
        finishedAt: "2026-11-25T03:00:05Z",
      },
    ];
    const idleExt = resolveDisplayRefreshSteps(serverDoneSteps, { extensionInstalled: true, state: null }, "2026-11-25T03:00:00Z");
    expect(idleExt[0].status).toBe("berhasil");
    expect(idleExt[0].detail).toBe("26 akun media sosial sudah tersinkron hari ini.");

    // 5. Render nyata RefreshProgressPanel: overflow-x-hidden, pembungkus anti-overflow, 0 bocor env var / tabular-nums
    const progress: RefreshState = {
      origin: "lokal",
      startedAt: "2026-11-25T03:00:00Z",
      finishedAt: "2026-11-25T03:05:00Z",
      failed: false,
      steps: baseSteps,
    };
    const runningHtml = renderToStaticMarkup(
      createElement(RefreshProgressPanel, {
        progress,
        link: { kind: "tersambung" },
        extSync: runningExt,
        onClose: () => undefined,
      }),
    );
    expect(runningHtml).toContain("overflow-x-hidden");
    expect(runningHtml).toContain("min-w-0 flex-1 break-words [overflow-wrap:anywhere]");
    expect(runningHtml).toContain("Pembaruan sedang berjalan");
    expect(runningHtml).not.toContain("INSTAGRAM_GRAPH_ACCESS_TOKEN");
    expect(runningHtml).not.toContain("INSTAGRAM_BUSINESS_ACCOUNT_ID");
    expect(runningHtml.toLowerCase()).not.toContain("perlu login ulang di chrome");
    expect(runningHtml).not.toContain("tabular-nums");

    const completedHtml = renderToStaticMarkup(
      createElement(RefreshProgressPanel, {
        progress,
        link: { kind: "diam" },
        extSync: completedExt,
        onClose: () => undefined,
      }),
    );
    expect(completedHtml).toContain("2 berhasil, 0 sebagian, 0 gagal, 0 dilewati");
    expect(completedHtml).toContain("Ekstensi Chrome menyinkronkan 26/26 akun (1.420 postingan, 96 komentar).");
    expect(completedHtml).not.toContain("INSTAGRAM_GRAPH_ACCESS_TOKEN");
    expect(completedHtml).not.toContain("INSTAGRAM_BUSINESS_ACCOUNT_ID");
  });

  it("filterGuestReviews menyaring ulasan berdasarkan topik, sentimen, dan kanal tanpa memotong jendela tanggal lokal", () => {
    const sampleReviews = [
      { id: "r1", source: "Google Maps", sentiment: "positive", reviewDate: "2026-08-01", themes: ["pemandangan", "sunset"] },
      { id: "r2", source: "Agoda", sentiment: "negative", reviewDate: "2026-10-15", themes: ["kebersihan"] },
      { id: "r3", source: "Instagram", sentiment: "neutral", reviewDate: "2026-11-20", themes: ["sunset"] },
    ];

    // Seluruh tanggal dalam periode global dipertahankan (tidak dipotong oleh jendela lokal 7/30/90 hari)
    expect(
      filterGuestReviews(sampleReviews, { selectedAspect: null, sentimentFilter: "all", channelFilter: "all" }).map((r) => r.id),
    ).toEqual(["r1", "r2", "r3"]);

    expect(
      filterGuestReviews(sampleReviews, { selectedAspect: "sunset", sentimentFilter: "all", channelFilter: "all" }).map((r) => r.id),
    ).toEqual(["r1", "r3"]);

    expect(
      filterGuestReviews(sampleReviews, { selectedAspect: null, sentimentFilter: "negative", channelFilter: "ota" }).map((r) => r.id),
    ).toEqual(["r2"]);

    expect(
      filterGuestReviews(sampleReviews, { selectedAspect: null, sentimentFilter: "all", channelFilter: "google" }).map((r) => r.id),
    ).toEqual(["r1"]);
  });
});

describe("knowledgeAnalysisOriginText", () => {
  it("menyebut waktu WIB dan periode rekomendasi, tanpa nama mesin AI", () => {
    expect(
      knowledgeAnalysisOriginText({ origin: "cache", rangeLabel: "28 Okt 2026 – 26 Nov 2026", generatedAt: "2026-11-26T18:54:10.000Z" }),
    ).toBe("Disusun 27 Nov 2026, 01.54 WIB dari semua data periode 28 Okt 2026 – 26 Nov 2026. Disusun ulang setiap Perbarui Semua Data.");
  });
  it("susunan otomatis ditulis apa adanya beserta kapan kesimpulan baru disusun", () => {
    expect(knowledgeAnalysisOriginText({ origin: "deterministic", rangeLabel: "29 Okt 2026 – 27 Nov 2026", generatedAt: null })).toBe(
      "Susunan otomatis dari semua data periode 29 Okt 2026 – 27 Nov 2026. Rekomendasi baru disusun saat Perbarui Semua Data berikutnya.",
    );
    expect(knowledgeAnalysisOriginText(null)).toBeNull();
  });
});

describe("Media Sosial: periode, label sumber, dan catatan sambungan Meta", () => {
  const audit = { hookScore: 80, copyScore: 65, ctaScore: 45, statusVerdict: "weak_cta" };
  // Shortcode dari postingan asli akun resmi (pembacaan 10 Nov 2026); tanggal dan sumber diatur per kasus.
  const post = (code: string, over: Partial<SnSocialPost>): SnSocialPost => ({
    id: code,
    outletKey: "resort",
    platform: "instagram",
    postType: "reels",
    postedAt: "2026-11-05",
    postUrl: `https://www.instagram.com/p/${code}/`,
    caption: "",
    metrics: null,
    audit,
    ...over,
  });

  it("socialPostsInPeriod hanya memuat hari WIB periode aktif dan mengurutkan dari yang terbaru", () => {
    const posts = [
      post("DfJ8WwrEl41", { postedAt: "2026-10-31" }),
      // 31 Okt 18.30 UTC = 1 Nov 01.30 WIB: masuk periode bawaan November.
      post("DfL-JyBhOvd", { postedAt: "2026-11-01", publishedAt: "2026-10-31T18:30:00.000Z" }),
      post("DfhN_oYhKUF", { postedAt: "2026-11-09" }),
      post("DfeUWFsv-pk", { postedAt: "2026-11-09", publishedAt: "2026-11-09T05:00:00.000Z" }),
      post("DfbS6tEP61Z", { postedAt: "2026-11-27" }),
    ];
    expect(socialPostsInPeriod(posts, "2026-11-01", "2026-11-26").map((p) => p.id)).toEqual(["DfeUWFsv-pk", "DfhN_oYhKUF", "DfL-JyBhOvd"]);
    expect(socialPostsInPeriod(posts, "2026-12-01", "2026-12-31")).toEqual([]);
  });

  it("socialSourceLabel dan socialPostTypeLabel memakai kata lencana kartu", () => {
    expect(socialSourceLabel(["meta", "extension"])).toBe("Meta + Ekstensi");
    expect(socialSourceLabel(["meta"])).toBe("Meta");
    expect(socialSourceLabel(["extension"])).toBe("Ekstensi");
    expect(socialSourceLabel(["meta", "team"])).toBe("Meta + Dicatat tim");
    expect(socialSourceLabel(["archive"], "2026-11-10")).toBe("Arsip 10 Nov 2026");
    expect(socialSourceLabel(undefined)).toBe("Sumber belum tercatat");
    const types: SnSocialPost["postType"][] = ["reels", "feed", "carousel", "tiktok_video"];
    expect(types.map(socialPostTypeLabel)).toEqual(["Reels", "Foto", "Carousel", "Video TikTok"]);
  });

  const igAccounts: SnInstagramAccount[] = [
    { username: "sanghyangresort", outlet: null },
    { username: "sunsetgrillsanghyang", outlet: "sunset-grill" },
    { username: "dragonbeachclub", outlet: "dragon-beach-club" },
    { username: "dbistro.anyer", outlet: "dbistro" },
    { username: "dspasanghyang", outlet: "dspa" },
  ];
  const status: SnMetaStatus = {
    keyInstalled: true,
    connected: ["sanghyangresort", "sunsetgrillsanghyang", "dspasanghyang"],
    unreadable: ["dspasanghyang"],
    problem: "@dspasanghyang tidak bisa dibaca (kode 500).",
    perAccountLimit: 25,
  };
  const feed = [
    post("DfeUWFsv-pk", { account: "sunsetgrillsanghyang", outletKey: "sunset-grill", postedAt: "2026-11-20", sources: ["meta"] }),
    post("DfhN_oYhKUF", { account: "sunsetgrillsanghyang", outletKey: "sunset-grill", postedAt: "2026-11-03", sources: ["meta", "extension"] }),
    post("DfJ8WwrEl41", { account: "sunsetgrillsanghyang", outletKey: "sunset-grill", postedAt: "2026-10-02", sources: ["extension"] }),
  ];

  it("metaAccountNotes menyebut akun yang tersambung, yang gagal dibaca, dan yang datanya dari ekstensi", () => {
    expect(metaAccountNotes({ outlet: "sunset-grill", accounts: igAccounts, meta: status, posts: feed }).map((n) => n.text)).toEqual([
      "@sunsetgrillsanghyang tersambung ke Meta: 25 postingan terbaru dibaca, paling lama 3 Nov 2026.",
      "@sanghyangresort tersambung ke Meta, belum ada postingan yang terbaca.",
    ]);
    expect(metaAccountNotes({ outlet: "dspa", accounts: igAccounts, meta: status, posts: feed })[0]).toEqual({
      handle: "dspasanghyang",
      state: "unreadable",
      text: "Akun @dspasanghyang tersambung ke Meta tetapi postingannya tidak bisa dibaca saat ini, data dari ekstensi.",
    });
    expect(metaAccountNotes({ outlet: "dbistro", accounts: igAccounts, meta: status, posts: feed })[0].text).toBe(
      "Akun @dbistro.anyer belum tersambung ke Meta, data dari ekstensi.",
    );
    expect(metaAccountNotes({ outlet: "all", accounts: igAccounts, meta: status, posts: feed }).map((n) => n.handle)).toEqual(
      igAccounts.map((a) => a.username),
    );
  });

  it("metaAccountNotes dan metaPullProblem jujur saat kunci Meta belum dipasang atau Meta tidak bisa dibaca", () => {
    const noKey: SnMetaStatus = { keyInstalled: false, connected: [], unreadable: [], problem: "Kunci akses Meta belum dipasang di aplikasi.", perAccountLimit: 25 };
    expect(metaAccountNotes({ outlet: "dspa", accounts: igAccounts, meta: noKey, posts: feed })).toEqual([
      { handle: null, state: "unavailable", text: "Kunci akses Meta belum dipasang di aplikasi. Postingan di bawah berasal dari ekstensi." },
    ]);
    expect(metaAccountNotes({ outlet: "dspa", accounts: igAccounts, meta: null, posts: feed })[0].state).toBe("unknown");
    expect(metaPullProblem(noKey)).toBe("Kunci akses Meta belum dipasang di aplikasi.");
    const allDown = { ...status, unreadable: [...status.connected], problem: "Semua akun tidak bisa dibaca (kode 500)." };
    expect(metaPullProblem(allDown)).toBe("Semua akun tidak bisa dibaca (kode 500).");
    expect(metaPullProblem(status)).toBeNull();
    expect(metaPullProblem(null)).toBeNull();
  });
});

describe("SocialPromoAuditView di tab Media Sosial dan MarketingFilterBar", () => {
  const makeSales = (from: string, perDay: number[]) =>
    perDay.map((qty, i) => ({ saleDate: shiftDate(from, i), qty, amount: qty * 50_000 }));

  const audits: PromoAuditItem[] = [
    {
      event: {
        id: "ev-nov",
        post_date: "2026-11-12",
        platform: "instagram",
        outlet_name: "Sunset Grill",
        promo_title: "Promo Seafood Bakar Senja",
        menu_keyword: "Seafood",
        post_url: "https://www.instagram.com/p/promo-nov/",
        source_post_id: "src-nov",
      },
      lift: computePromoLift(
        "2026-11-12",
        [...makeSales("2026-11-05", [2, 2, 2, 2, 2, 2, 2]), ...makeSales("2026-11-12", [4, 4, 4, 4, 4, 4, 4])],
        "2026-11-24",
      ),
      menus: ["Seafood Platter", "Ikan Bakar"],
    },
    {
      event: {
        id: "ev-oct",
        post_date: "2026-10-10",
        platform: "instagram",
        outlet_name: "d'Bistro",
        promo_title: "Promo Kopi Pagi Oktober",
        menu_keyword: "Kopi",
        post_url: "https://www.instagram.com/p/promo-oct/",
        source_post_id: "src-oct",
      },
      lift: computePromoLift(
        "2026-10-10",
        [...makeSales("2026-10-03", [3, 3, 3, 3, 3, 3, 3]), ...makeSales("2026-10-10", [3, 3, 3, 3, 3, 3, 3])],
        "2026-11-24",
      ),
      menus: ["Kopi Susu"],
    },
    {
      event: {
        id: "ev-dbc",
        post_date: "2026-11-20",
        platform: "instagram",
        outlet_name: "Dragon Beach Club (Indoor)",
        // Kalimat promo asli DBC 21 Nov (promo-detect.test.ts).
        promo_title: "All item Disc 20% + Free Cocktail untuk Grey Goose, Herradura, dan Macallan.",
        menu_keyword: "GREYGOOSE",
        post_url: "https://www.instagram.com/p/promo-dbc/",
        source_post_id: "src-dbc",
      },
      lift: computePromoLift("2026-11-20", makeSales("2026-11-13", [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]), "2026-11-24"),
      menus: ["DBC GREYGOOSE VODKA BOTTLE"],
    },
  ];
  const render = (props: Partial<Parameters<typeof SocialPromoAuditView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(SocialPromoAuditView, {
        audits,
        problem: null,
        dataUntil: "2026-11-24",
        startDate: "2026-11-01",
        endDate: "2026-11-24",
        outlet: "sunset-grill",
        outletLabel: "Sunset Grill",
        ...props,
      }),
    );

  it("menampilkan audit outlet terpilih pada periode aktif beserta Tarik data, Abaikan, data kasir, dan grafik 14 hari", () => {
    const html = render({ problem: "Sebagian penjualan kasir tidak bisa dibaca." });
    expect(html).toContain("Audit Promo Outlet");
    expect(html).toContain("Sunset Grill · 1–24 Nov 2026");
    expect(html).toContain("Tarik data");
    expect(html).toContain("Abaikan");
    expect(html).toContain("24 Nov 2026");
    expect(html).toContain("Sebagian penjualan kasir tidak bisa dibaca.");
    expect(html).toContain("Promo Seafood Bakar Senja");
    expect(html).not.toContain("Promo Kopi Pagi Oktober");
    expect(html).not.toContain("Grey Goose, Herradura");
    expect(html).toContain("Penjualan naik");
    expect(html).toContain('role="img"');
  });

  it("audit Dragon Beach Club (Indoor) tampil di Dragon Beach Club dan D'Bar karena kasirnya sama", () => {
    for (const outlet of ["dragon-beach-club", "dbar"] as const) {
      const html = render({ outlet, outletLabel: outlet });
      expect(html, outlet).toContain("Grey Goose, Herradura");
      expect(html, outlet).not.toContain("Promo Seafood Bakar Senja");
    }
    const all = render({ outlet: "all", outletLabel: "Semua Outlet" });
    expect(all).toContain("Promo Seafood Bakar Senja");
    expect(all).toContain("Grey Goose, Herradura");
    expect(all).not.toContain("Promo Kopi Pagi Oktober");
  });

  it("outlet tanpa audit pada periode aktif menulis Belum ada data beserta rentang tanggalnya", () => {
    const outside = render({ outlet: "dbistro", outletLabel: "Bistro" });
    expect(outside).toContain("Belum ada data pada 1–24 Nov 2026");
    expect(outside).toContain("Ada 1 audit promo di luar rentang ini");
    expect(outside).not.toContain("Promo Kopi Pagi Oktober");

    const resort = render({ outlet: "resort", outletLabel: "Kamar dan Resort" });
    expect(resort).toContain("Belum ada data pada 1–24 Nov 2026");
    expect(resort).toContain("menu kasir");
    expect(resort).toContain("Sunset Grill");
    expect(resort).not.toContain("Promo Seafood Bakar Senja");

    const empty = render({ audits: [] });
    expect(empty).toContain("Belum ada data pada 1–24 Nov 2026");
    expect(empty).toContain("Tekan Tarik data");
  });

  it("menyebut alasan Meta di samping Tarik data tanpa menyembunyikan tombolnya", () => {
    const html = render({ metaProblem: "Kunci akses Meta belum dipasang di aplikasi." });
    expect(html).toContain("Kunci akses Meta belum dipasang di aplikasi.");
    expect(html).toContain("Tarik data");
    expect(render()).not.toContain("Kunci akses Meta");
  });

  it("buildMarketingFilterParams tidak menempelkan lihat/outlet lama pada Google Ads satu-laporan, dan tetap mempertahankannya di tab bersub-tab", () => {
    const googleParams = buildMarketingFilterParams({
      section: "google",
      view: "chat",
      outlet: "resort",
      range: { startDate: "2026-11-01", endDate: "2026-11-24" },
    });
    expect(googleParams.toString()).toBe("bagian=google&startDate=2026-11-01&endDate=2026-11-24");

    const insightParams = buildMarketingFilterParams({
      section: "insight-pasar",
      view: "harga",
      outlet: "sunset-grill",
      range: { startDate: "2026-11-01", endDate: "2026-11-24" },
    });
    expect(insightParams.toString()).toBe(
      "bagian=insight-pasar&lihat=harga&outlet=sunset-grill&startDate=2026-11-01&endDate=2026-11-24",
    );

    const mediaReset = buildMarketingFilterParams({
      section: "media-sosial",
      view: "sunset-grill",
      outlet: "resort",
      range: null,
    });
    expect(mediaReset.toString()).toBe("bagian=media-sosial&lihat=sunset-grill");

    // Tab Sosmed Sanghyang sudah dilebur ke Media Sosial: lihat lama tidak ikut lagi, halaman mengalihkannya.
    const legacySosmed = buildMarketingFilterParams({
      section: "sosmed",
      view: "audit",
      outlet: "resort",
      range: null,
    });
    expect(legacySosmed.toString()).toBe("bagian=sosmed");
  });
});

describe("SocialPostGridCard: kartu grid Evaluasi efektivitas konten", () => {
  // Postingan promo d’Spa asli di @sanghyangresort, 5 Nov 2026 (pembacaan 10 Nov), seperti terbaca dari Meta dan ekstensi.
  const real = crawled.posts.find((p) => p.url.includes("/DfYxoUkPW4k/"))!;
  const input = {
    outletKey: "dspa" as const,
    platform: "instagram" as const,
    postType: "feed" as const,
    postedAt: real.postedAt,
    postUrl: "https://www.instagram.com/p/DfYxoUkPW4k/",
    caption: real.caption,
    metrics: { views: null, likes: real.likes ?? null, comments: 0, shares: null, inquiriesWa: null },
  };
  const post: SnSocialPost = {
    ...input,
    id: "row-DfYxoUkPW4k",
    account: "sanghyangresort",
    sources: ["meta", "extension"],
    imageUrl: "https://scontent.cdninstagram.com/DfYxoUkPW4k.jpg",
    publishedAt: `${real.postedAt}T03:00:00.000Z`,
    audit: evaluateSocialPromoPost(input),
  };

  it("memuat foto no-referrer beralt, jenis, tanggal dan jam WIB, caption 3 baris, angka, sumber, skor, status, dan saran", () => {
    const html = renderToStaticMarkup(createElement(SocialPostGridCard, { post, followers: null, archiveDate: null }));
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('alt="Pratinjau Foto @sanghyangresort, tayang 5 Nov 2026"');
    expect(html).toContain(">Foto<");
    expect(html).toContain("Tayang 5 Nov 2026, 10.00 WIB");
    expect(html).toContain("line-clamp-3");
    expect(html).toContain("Meta + Ekstensi");
    expect(html).toContain(">Suka<");
    expect(html).toContain(">Komentar<");
    expect(html).toContain(">Views<");
    // Views tidak dibaca Meta dan belum disinkron ekstensi: ditulis apa adanya, bukan nol.
    expect(html).toContain("Belum ada data");
    expect(html).toContain(`Skor ${postOverallScore(post.audit)}/100`);
    for (const label of [">Hook<", ">Copy<", ">CTA<"]) expect(html).toContain(label);
    expect(html).toContain(post.audit.actionDirective!.slice(0, 20));
    expect(html).toContain('href="https://www.instagram.com/p/DfYxoUkPW4k/"');
  });

  it("tanpa foto dan tanpa angka tetap rapi dan jujur", () => {
    const bare: SnSocialPost = { ...post, imageUrl: null, metrics: null, sources: ["archive"], publishedAt: null };
    const html = renderToStaticMarkup(createElement(SocialPostGridCard, { post: bare, followers: null, archiveDate: "2026-11-10" }));
    expect(html).not.toContain("<img");
    expect(html).toContain("Belum ada foto pratinjau");
    expect(html.match(/Belum ada data/g)).toHaveLength(3);
    expect(html).toContain("Arsip 10 Nov 2026");
    expect(html).toContain("Tayang 5 Nov 2026<");
  });
});
