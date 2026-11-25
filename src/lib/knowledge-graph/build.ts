/**
 * Memuat seluruh data graf pengetahuan terpadu lintas modul dari basis data dan loader terverifikasi,
 * lalu merakitnya lewat `assemble.ts`. Dipanggil oleh `/api/knowledge-graph`, `/api/market-intelligence/summary`,
 * dan laporan PDF. Jendela waktu: promo/event <= 90 hari, berita kawasan 30 hari, ulasan aktif seluruhnya,
 * tarif Google Hotels + status sarapan, tipe kamar resmi, target & potret bulanan, galeri, serta media sosial.
 */
import type { PrismaClient } from "@prisma/client";
import { attachTpkGap, loadInternalOutletSignals, type InternalOutletSignalsMap } from "../analytics/internal-signals";
import { withCache } from "../cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "../cache/tags";
import { db } from "../db";
import { HOTEL_PACKAGE_NAME, RATE_BATCH_WINDOW_MS } from "../market/collect-rates";
import { galleryPhotosOf, isShownPhoto } from "../market/competitor-gallery";
import { loadHolisticEvaluation } from "../market/compset-audit";
import type { DayRange } from "../market/date-range";
import { promoInRange, promoRangeWhere, rangeLabel, wibDay } from "../market/date-range";
import { formatAreaSqm, loadDynamicHotelRoomTypes, type HotelRoomTypesProfile } from "../market/hotel-room-types";
import { loadResortMarketSize, type ResortMarketSize } from "../market/market-size";
import { latestCapturePerPost, OFFICIAL_SOCIAL_ACCOUNTS, parseStoredSocialPost, type SocialPromoPostRecord } from "../market/marketing-sosmed";
import { latestFollowersByAccount } from "../market/marketing-sosmed-outlets";
import { isOutletKey } from "../market/outlet-filters";
import { OWN_OUTLETS } from "../market/outlet-ratings";
import { OWN_TEAM_SOURCE } from "../market/own-promos";
import { loadPlaceSpecsMap, type PlaceSpecs } from "../market/place-specs";
import type { DynamicCompetitorMenuRecord } from "../market/refresh-competitor-menus";
import { OUTLET_MARKET_SHARE_DATA } from "../market/pricing-benchmark";
import {
  classifyPromoOrEvent,
  isPromoWithinRecencyWindow,
  NOT_PROMO_CATEGORY,
  OWN_SOCIAL_POST_CATEGORY,
  PROMO_MAX_AGE_DAYS,
} from "../market/promo-radar";
import {
  breakfastComparison,
  buildRoomRateSummaries,
  RESORT_ROOM_RATE_SOURCE,
} from "../market/resort-room-rates";
import { buildExecutiveBreakfastParity } from "../market/resort-strategy";
import { newestArticleFirst } from "../market/stable-order";
import visualInsightsData from "../market/competitor-visual-insights.data.json";
import officialMenuData from "../market/official-menu.data.json";
import competitorMenuData from "../market/competitor-menu.data.json";
import socialData from "../market/marketing-sosmed.data.json";
import { assembleGraph, type GraphInput, type HolisticScoreInput, type RateInput } from "./assemble";
import type { KnowledgeGraph } from "./types";

const DAY_MS = 86_400_000;
const NEWS_WINDOW_DAYS = 30;
/** Batas berita supaya graf tetap terbaca; yang ditampilkan adalah yang terbaru. */
const NEWS_LIMIT = 40;
const mapsOf = (row: { mapsUrl: string | null; googleMapsUrl: string | null } | null) =>
  row ? row.mapsUrl ?? row.googleMapsUrl : null;

function isDayRange(arg: unknown): arg is DayRange {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "from" in arg &&
    "to" in arg &&
    (arg as { from: unknown }).from instanceof Date &&
    (arg as { to: unknown }).to instanceof Date
  );
}

/**
 * Tarif Google Hotels putaran terakhir tiap hotel: pengamatan dalam RATE_BATCH_WINDOW_MS dari pengamatan terbaru hotel itu.
 */
async function loadLatestRates(client: PrismaClient): Promise<RateInput[]> {
  const where = { packageName: HOTEL_PACKAGE_NAME };
  const since = (newest: Date) => ({ gt: new Date(newest.getTime() - RATE_BATCH_WINDOW_MS) });
  const select = { price: true, currency: true, guests: true, checkIn: true, sourceUrl: true, observedAt: true } as const;
  const [newestPerCompetitor, newestOwn] = await Promise.all([
    client.competitorPriceSnapshot.groupBy({ by: ["competitorId"], where, _max: { observedAt: true } }),
    client.sanghyangPriceSnapshot.aggregate({ where, _max: { observedAt: true } }),
  ]);
  const batches = newestPerCompetitor.flatMap((g) => (g._max.observedAt ? [{ competitorId: g.competitorId, observedAt: since(g._max.observedAt) }] : []));
  const [competitorRows, ownRows] = await Promise.all([
    batches.length ? client.competitorPriceSnapshot.findMany({ where: { ...where, OR: batches }, select: { ...select, competitorId: true } }) : [],
    newestOwn._max.observedAt ? client.sanghyangPriceSnapshot.findMany({ where: { ...where, observedAt: since(newestOwn._max.observedAt) }, select }) : [],
  ]);
  return [
    ...competitorRows.map((r) => ({ ...r, price: Number(r.price) })),
    ...ownRows.map((r) => ({ ...r, competitorId: null, price: Number(r.price) })),
  ];
}

export interface BuildKnowledgeGraphOptions {
  client?: PrismaClient;
  marketSize?: ResortMarketSize;
  internalSignals?: InternalOutletSignalsMap | null;
  roomTypesMap?: Map<string, HotelRoomTypesProfile>;
  specsMap?: Map<string, PlaceSpecs>;
  dynamicMenusMap?: Map<string, DynamicCompetitorMenuRecord>;
}

export async function loadGraphInput(rangeOrNow?: DayRange | Date, options?: BuildKnowledgeGraphOptions): Promise<GraphInput> {
  const client = options?.client ?? db;
  const range = isDayRange(rangeOrNow) ? rangeOrNow : null;
  const now = range ? range.to : rangeOrNow instanceof Date ? rangeOrNow : new Date();

  const [
    competitors,
    promos,
    ownSocialDbPosts,
    reviews,
    articles,
    marketSize,
    rawInternalSignals,
    goals,
    monthlySnapshots,
    rates,
    facts,
    roomTypesMap,
    specsMap,
  ] = await Promise.all([
    client.competitor.findMany({
      where: { OR: [{ active: true }, { active: false, retiredReason: { not: null } }] },
      select: {
        id: true,
        name: true,
        category: true,
        outlets: true,
        placeId: true,
        roadKm: true,
        driveMinutes: true,
        starRating: true,
        roomCount: true,
        rating: true,
        reviewCount: true,
        ratingSource: true,
        ratingSourceUrl: true,
        websiteUrl: true,
        googleMapsUrl: true,
        mapsUrl: true,
        compsetRole: true,
        active: true,
        retiredReason: true,
        ratingObservedAt: true,
        verifiedAt: true,
        updatedAt: true,
        notes: true,
        address: true,
        parentId: true,
        parent: { select: { name: true, starRating: true, active: true, compsetRole: true, mapsUrl: true, googleMapsUrl: true } },
      },
    }),
    client.competitorPromotion.findMany({
      where: {
        category: { not: NOT_PROMO_CATEGORY },
        source: { not: OWN_TEAM_SOURCE },
        ...(range
          ? promoRangeWhere(range)
          : { capturedAt: { gte: new Date(now.getTime() - PROMO_MAX_AGE_DAYS * DAY_MS) } }),
      },
      select: {
        id: true,
        competitorId: true,
        title: true,
        category: true,
        description: true,
        discount: true,
        price: true,
        source: true,
        sourceUrl: true,
        imageUrl: true,
        capturedAt: true,
        startsAt: true,
        endsAt: true,
        status: true,
        kind: true,
        details: true,
        terms: true,
        competitor: { select: { active: true, name: true } },
      },
    }),
    // Semua postingan akun resmi: angka pengikut terbaru per akun bisa berada di postingan lama yang ikut disinkron ulang.
    client.competitorPromotion.findMany({
      where: { category: OWN_SOCIAL_POST_CATEGORY },
      select: {
        id: true,
        title: true,
        description: true,
        source: true,
        sourceUrl: true,
        startsAt: true,
        createdAt: true,
        capturedAt: true,
      },
      orderBy: { startsAt: "desc" },
    }),
    // Periode mengikuti tanggal ulasan, sama dengan Insight Pasar; tanggal tangkap hanya kapan crawler membacanya.
    client.competitorReview.findMany({
      where: {
        archivedAt: null,
        ...(range ? { reviewDate: { gte: range.from, lte: range.to } } : {}),
      },
      select: { competitorId: true, themes: true, sentiment: true, source: true, sourceUrl: true, capturedAt: true, reviewDate: true },
    }),
    client.article.findMany({
      where: {
        publishedAt: range
          ? { gte: range.from, lte: range.to }
          : { gte: new Date(now.getTime() - NEWS_WINDOW_DAYS * DAY_MS) },
        marketItem: { is: { readStatus: "relevan" } },
      },
      // Tanpa LIMIT di SQL: tanggal terbit RSS tersimpan per hari, dan seri di batas potong keluar dalam urutan bebas yang
      // berbeda per DB. Berita relevan dalam periode berjumlah puluhan; diurutkan dan dipotong NEWS_LIMIT di bawah.
      select: { id: true, title: true, canonicalUrl: true, publishedAt: true, source: { select: { name: true } }, marketItem: { select: { articleUrl: true } } },
    }),
    options?.marketSize ? Promise.resolve(options.marketSize) : loadResortMarketSize({ client }),
    options?.internalSignals !== undefined
      ? Promise.resolve(options.internalSignals)
      : loadInternalOutletSignals({ client, asOf: range?.to ?? null }),
    client.marketingGoal.findMany({ orderBy: [{ outletKey: "asc" }, { month: "desc" }], distinct: ["outletKey"] }),
    client.outletMonthlySnapshot.findMany({ orderBy: [{ outletKey: "asc" }, { month: "desc" }], distinct: ["outletKey"] }),
    loadLatestRates(client),
    client.competitorFact.findMany({
      select: {
        id: true,
        competitorId: true,
        section: true,
        key: true,
        value: true,
        sourceUrl: true,
        observedAt: true,
      },
    }),
    options?.roomTypesMap ? Promise.resolve(options.roomTypesMap) : loadDynamicHotelRoomTypes(),
    options?.specsMap ? Promise.resolve(options.specsMap) : loadPlaceSpecsMap(),
  ]);
  const internalSignals = attachTpkGap(rawInternalSignals, marketSize.tpk?.percent ?? null);

  const activePromos = promos
    .filter((p) => {
      if (!isPromoWithinRecencyWindow(p, now, PROMO_MAX_AGE_DAYS)) return false;
      return range ? promoInRange(p, range, now) : true;
    })
    .map((p) => {
      const classified = classifyPromoOrEvent(p);
      return classified ? { ...p, kind: classified } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // Skor holistik dari mesin yang sama dengan Insight Pasar (lib/market/compset-audit.ts loadHolisticEvaluation), lengkap
  // dengan konteks Sanghyang per outlet; tanpa konteks itu skor penginapan menjadi netral dan tidak sebanding.
  const evaluation = await loadHolisticEvaluation({
    roomTypesMap,
    specsMap,
    dynamicMenusMap: options?.dynamicMenusMap,
  });
  const decisionById = new Map(evaluation.decisions.map((d) => [d.id, d]));
  const holisticScores: HolisticScoreInput[] = [];
  for (const c of competitors) {
    const decision = decisionById.get(c.id);
    if (!decision) continue;
    for (const outletKey of c.outlets.filter(isOutletKey)) {
      const result = decision.scoresByOutlet[outletKey];
      if (!result) continue;
      holisticScores.push({
        competitorId: c.id,
        outletKey,
        score: result.score,
        summary: result.summary,
        factors: Object.values(result.dimensions).map((d) => ({
          key: d.key,
          label: d.label,
          score: d.score,
          weight: d.weight,
          detail: d.reason,
        })),
      });
    }
  }

  // Tipe kamar resmi Sanghyang Resort
  const sanghyangRoomProfile = roomTypesMap.get("sanghyang");
  const officialRoomTypes = (sanghyangRoomProfile?.roomTypes ?? []).map((rt) => ({
    name: rt.name,
    category: rt.category,
    bedrooms: rt.bedrooms,
    areaLabel: formatAreaSqm(rt),
    smartTv: rt.smartTv,
    bathtub: rt.bathtub,
    weekdayPrice: rt.weekdayPrice,
    weekendPrice: rt.weekendPrice,
    sourceLabel: rt.sourceLabel,
    sourceUrl: rt.sourceUrl,
    observedAt: rt.observedAt,
  }));

  // Perbandingan sarapan & koridor harga untuk modul /direksi (sinkron dengan buildExecutiveBreakfastParity)
  const executiveBreakfast = buildExecutiveBreakfastParity();
  const baseBreakfastRates = breakfastComparison();
  const seenBfKey = new Set(baseBreakfastRates.map((b) => `${b.hotelId}|${b.stay}`));
  const breakfastRates = [...baseBreakfastRates];
  for (const row of executiveBreakfast.rows) {
    if ((row.weekdayWithBreakfast !== null || row.weekdayWithoutBreakfast !== null) && !seenBfKey.has(`${row.hotelId}|weekday`)) {
      seenBfKey.add(`${row.hotelId}|weekday`);
      breakfastRates.push({
        hotelId: row.hotelId,
        hotel: row.hotelName,
        stay: "weekday",
        withBreakfast: row.weekdayWithBreakfast,
        withoutBreakfast: row.weekdayWithoutBreakfast,
      });
    }
    if ((row.weekendWithBreakfast !== null || row.weekendWithoutBreakfast !== null) && !seenBfKey.has(`${row.hotelId}|weekend`)) {
      seenBfKey.add(`${row.hotelId}|weekend`);
      breakfastRates.push({
        hotelId: row.hotelId,
        hotel: row.hotelName,
        stay: "weekend",
        withBreakfast: row.weekendWithBreakfast,
        withoutBreakfast: row.weekendWithoutBreakfast,
      });
    }
  }
  const sanghyangBfRow = executiveBreakfast.rows.find((r) => r.isSanghyang);
  const enrichedOfficialRoomTypes = officialRoomTypes.map((rt) => ({
    ...rt,
    breakfastLabel: sanghyangBfRow?.overallStatus && sanghyangBfRow.overallStatus !== "Belum tercatat" ? sanghyangBfRow.overallStatus : null,
  }));
  const roomCorridors = buildRoomRateSummaries().map((s) => ({
    kind: s.kind,
    room: s.room,
    weekdaySanghyang: s.weekday.sanghyang,
    weekdayFloor: s.weekday.floor,
    weekdayMedian: s.weekday.median,
    weekendSanghyang: s.weekend.sanghyang,
    weekendFloor: s.weekend.floor,
    weekendMedian: s.weekend.median,
    positionWeekday: s.weekday.position,
    positionWeekend: s.weekend.position,
  }));

  // Jumlah foto galeri terverifikasi per placeId (/galeri-kompetitor)
  const galleryPhotoCounts: Record<string, number> = {};
  for (const c of competitors) {
    if (c.placeId) {
      const count = galleryPhotosOf(c.placeId).filter(isShownPhoto).length;
      if (count > 0) galleryPhotoCounts[c.placeId] = count;
    }
  }

  // Postingan akun resmi: hasil sinkron ekstensi dan isian tim di DB lebih baru daripada crawl 10 Nov, jadi DB didahulukan
  // dan crawl hanya mengisi tautan yang belum ada di DB.
  const storedOwnPosts = latestCapturePerPost(ownSocialDbPosts)
    .map(parseStoredSocialPost)
    .filter((p): p is SocialPromoPostRecord => p !== null);
  const storedUrls = new Set(storedOwnPosts.map((p) => p.postUrl));
  const handleFromUrl = (url: string) => {
    const seg = new URL(url).pathname.split("/").filter(Boolean)[0] ?? "";
    return seg && !["p", "reel", "reels", "tv"].includes(seg) ? seg.replace(/^@/, "") : "";
  };
  const basePosts = (socialData.posts as { account: string; url: string; postedAt: string; postType: string; caption: string; likes: number | null; platform?: string }[]) ?? [];
  const mergedSocialPosts = [
    ...storedOwnPosts.map((p) => ({
      account: p.account ?? handleFromUrl(p.postUrl),
      url: p.postUrl,
      postedAt: p.postedAt,
      postType: p.postType,
      caption: p.caption,
      likes: p.metrics?.likes ?? null,
      platform: p.platform,
    })),
    ...basePosts.filter((p) => !storedUrls.has(p.url)),
  ];
  const socialFollowers = Object.fromEntries(
    Object.entries(latestFollowersByAccount(storedOwnPosts)).flatMap(([key, count]) =>
      typeof count === "number" ? [[key, { followers: count }]] : [],
    ),
  );

  return {
    now,
    range: range ? { from: wibDay(range.from), to: wibDay(range.to), label: rangeLabel(range) } : null,
    ownOutlets: OWN_OUTLETS.map((o) => ({
      outletKey: o.outletKey,
      competitorName: o.competitorName,
      label: (OUTLET_MARKET_SHARE_DATA[o.outletKey]?.outletName ?? o.competitorName).replace(/\s*\(.*\)$/, ""),
    })),
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      outlets: c.outlets,
      placeId: c.placeId,
      roadKm: c.roadKm,
      starRating: c.starRating,
      rating: c.rating === null ? null : Number(c.rating),
      reviewCount: c.reviewCount,
      ratingSource: c.ratingSource,
      ratingSourceUrl: c.ratingSourceUrl,
      websiteUrl: c.websiteUrl,
      mapsUrl: mapsOf(c),
      compsetRole: c.compsetRole,
      active: c.active,
      retiredReason: c.retiredReason,
      observedAt: c.ratingObservedAt ?? c.verifiedAt ?? c.updatedAt,
      parentId: c.parentId,
      parentMapsUrl: mapsOf(c.parent),
    })),
    promos: activePromos.map((p) => ({ ...p, discount: p.discount === null ? null : Number(p.discount) })),
    reviews,
    articles: articles
      .map((a) => ({ id: a.id, title: a.title, url: a.marketItem?.articleUrl ?? a.canonicalUrl, publisher: a.source.name, publishedAt: a.publishedAt }))
      .sort(newestArticleFirst)
      .slice(0, NEWS_LIMIT),
    tpk: marketSize.tpk,
    marketSize,
    ratesCapturedAt: RESORT_ROOM_RATE_SOURCE.capturedAt,
    internalSignals,
    rates,
    facts: facts.map((f) => ({
      id: f.id,
      competitorId: f.competitorId,
      section: f.section,
      key: f.key,
      value: f.value,
      sourceUrl: f.sourceUrl,
      observedAt: f.observedAt,
    })),
    visualInsights: (visualInsightsData.insights as Record<string, { designStyle: string; ambience: string; keyVisualElements: string[]; photoCount: number }>) ?? {},
    galleryPhotoCounts,
    officialMenus: (officialMenuData.outlets as Record<string, { items: { name: string; price: number; category: string | null; unit: string | null }[] }>) ?? {},
    competitorMenus: (competitorMenuData.places as Record<string, { items: { name: string; price: number; unit: string | null }[]; perPerson: { min: number; max: number; url: string; capturedAt: string } | null; sources: { label: string; url: string }[] }>) ?? {},
    socialAccounts: OFFICIAL_SOCIAL_ACCOUNTS,
    socialPosts: mergedSocialPosts,
    socialFollowers,
    officialRoomTypes: enrichedOfficialRoomTypes,
    breakfastRates,
    executiveBreakfastNote: executiveBreakfast.executiveNote,
    roomCorridors,
    goals: goals.map((g) => ({
      outletKey: g.outletKey,
      month: g.month.toISOString().slice(0, 10),
      targetRevenueGrowthPct: g.targetRevenueGrowthPct !== null ? Number(g.targetRevenueGrowthPct) : null,
      targetRating: g.targetRating !== null ? Number(g.targetRating) : null,
      strategy: g.strategy,
      decisions: g.decisions,
      filledBy: g.filledBy,
      evaluation: g.evaluation,
      updatedAt: g.updatedAt,
    })),
    monthlySnapshots: monthlySnapshots.map((s) => ({
      outletKey: s.outletKey,
      month: s.month.toISOString().slice(0, 10),
      googleRating: s.googleRating !== null ? Number(s.googleRating) : null,
      pricePositioningIndex: s.pricePositioningIndex !== null ? Number(s.pricePositioningIndex) : null,
      reviewsRecorded: s.reviewsRecorded,
      capturedAt: s.capturedAt,
    })),
    holisticScores,
  };
}

export async function buildKnowledgeGraph(rangeOrNow?: DayRange | Date, options?: BuildKnowledgeGraphOptions): Promise<KnowledgeGraph> {
  if (options?.client || options?.internalSignals !== undefined) {
    return assembleGraph(await loadGraphInput(rangeOrNow, options));
  }
  const range = isDayRange(rangeOrNow) ? rangeOrNow : null;
  const now = range ? range.to : rangeOrNow instanceof Date ? rangeOrNow : new Date();
  const key = range ? `range:${wibDay(range.from)}..${wibDay(range.to)}` : `asof:${wibDay(now)}`;
  return withCache(
    async () => assembleGraph(await loadGraphInput(rangeOrNow, options)),
    ["knowledge-graph", key],
    {
      tags: [
        CACHE_TAGS.knowledgeGraph,
        CACHE_TAGS.internalSignals,
        CACHE_TAGS.marketCompetitors,
        CACHE_TAGS.marketingSosmed,
        CACHE_TAGS.marketingGoals,
      ],
      revalidate: CACHE_TTL.marketIntelligence,
    },
  );
}
