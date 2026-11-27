import { NextResponse } from 'next/server';
import { withCache } from '@/lib/cache/cached';
import { CACHE_TAGS, CACHE_TTL, PRIVATE_CACHE_CONTROL } from '@/lib/cache/tags';
import { EXTRACTED_SOURCE, OUR_VERSION_MARKER } from '@/lib/market/promo-extractor';
import { outletSentiment, visibleThemes } from '@/lib/market/review-outlet-tagger';
import { WEBSITE_SOURCE } from '@/lib/market/website-promos';
import { db } from '@/lib/db';
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from '@/lib/marketing/api-auth';
import { reviewsForOwnOutlet, transformMarketSummary, type SummaryPeriod, type SummaryRow } from '@/lib/market/summary';
import { matchComparablePrices, type PriceSnapshot } from '@/lib/market/price-scraper';
import { SOCIAL_POST_CATEGORY } from '@/lib/market/scrape-social-buzz';
import { DISPROVEN_FACILITY_CLAIM, isVerifiedReviewSource } from '@/lib/market/resort-strategy';
import { loadDynamicOtaDirectory } from '@/lib/market/ota-directory.server';
import { channelFromSource, GUEST_REVIEWS_ONLY, type PromoVenue } from '@/lib/market/outlet-filters';
import {
  classifyPromoOrEvent,
  isGenuinePromoOrEvent,
  isOwnPromoItem,
  isPromoWithinRecencyWindow,
  mergePromoCaptures,
  platformOf,
  startDateWritten,
  type PromoPlatform,
} from '@/lib/market/promo-radar';
import { isOwnCompetitorName, OWN_TEAM_SOURCE } from '@/lib/market/own-promos';
import type { PromotionTypeKey } from '@/lib/market/promo-type';
import { isLodging } from '@/lib/market/compset';
import { groundedComparisons, loadEvidenceBundle } from '@/lib/market/competitor-comparison';
import { buildKnowledgeGraph } from '@/lib/knowledge-graph/build';
import { buildOutletKnowledgeContext } from '@/lib/knowledge-graph/context';
import { stripAiModelMentions, synthesizeOutletAnalysis, type OutletAnalysisResult } from '@/lib/ai/market-analyst';
import { OUTLET_MARKET_SHARE_DATA, ALL_OUTLETS_MARKET_SHARE_DATA } from '@/lib/market/pricing-benchmark';
import { loadResortMarketSize, loadReviewShares } from '@/lib/market/market-size';
import { loadCompsetAudit, mergeCompetitorMenu } from '@/lib/market/compset-audit';
import { buildOutletCompetitorMatrices } from '@/lib/market/competitor-matrix';
import { COMPARABLE_RATE_WHERE, isPropertyRatePackage, PROPERTY_RATE_PACKAGE } from '@/lib/market/rate-basis';
import { loadDynamicHotelRoomTypes } from '@/lib/market/hotel-room-types';
import { loadPlaceSpecsMap } from '@/lib/market/place-specs';
import { loadDynamicCompetitorMenuItems } from '@/lib/market/refresh-competitor-menus';
import { loadHotelVenues } from '@/lib/market/promo-venues';
import { competitorMenuCards } from '@/lib/market/competitor-menu';
import { EVENT_HORIZON_DAYS, newsInPeriod, splitNewsTitle } from '@/lib/market/news-relevance';
import { parseDayRange, presetRange, promoInRange, promoRangeWhere, rangeLabel, wibDay, type DayRange } from '@/lib/market/date-range';
import { OUTLET_KEYS, type OutletKey } from '@/lib/market/outlet-filters';

/** Jumlah postingan sosmed baru yang ikut ditampilkan di Langkah 4. */
const DISCOVERED_POSTS_LIMIT = 80;
/** Contoh item menu per kompetitor di Langkah 3; menu lengkap ada di sumbernya, laporan PDF memuat paling banyak 12. */
const MENU_SAMPLE_ITEMS = 8;
/** Berita terbaru yang dikirim ke Insight Pasar; cukup untuk beberapa minggu tanpa membengkakkan respons. */
const MAX_NEWS = 80;
/** Tanggal di teks dibentuk dalam WIB: server Vercel berjalan di UTC, mesin kerja di WIB. */
const WIB: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Jakarta' };

/** Membersihkan label sumber publik dari penyebutan nama mesin/model AI maupun nama alat teknis tanpa mengubah nilai kueri DB. */
function cleanSourceLabel(label: string, fallback = 'Sumber terverifikasi'): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  const cleaned = stripAiModelMentions(trimmed)
    .replace(/\b(?:diperiksa|crawl)\s+Crawl4AI\b/gi, 'terakhir diperiksa')
    .replace(/\bCrawl4AI\b/gi, '')
    .replace(/\bPlaywright\b/gi, '')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || fallback;
}

const periods = new Set<SummaryPeriod>(['30d', '90d', 'year']);
/** Batas pengaman ukuran respons; sekarang tiap outlet punya jauh di bawah ini. */
const MAX_REVIEWS_PER_OUTLET = 500;
const segments = new Set(['all', 'fnb', 'event', 'entertainment', 'destination', 'competitor', 'promotion', 'review']);

export function createSummaryGet(checkAccess?: MarketingApiAccessGuard) {
  return async function GET(request: Request) {
    const refused = await requireMarketingApiAccess(checkAccess);
    if (refused) return refused;

    const params = new URL(request.url).searchParams;
    const period = (params.get('period') ?? '30d') as SummaryPeriod;
    const segment = params.get('segment') ?? 'all';
    const source = params.get('source');
    // Rentang kustom (hari WIB) menggantikan preset period; tanpa from/to dipakai preset.
    const customRange = parseDayRange(params.get('from'), params.get('to'));

    if (!validateSummaryParams(period, segment, source) || customRange === 'invalid') {
      return NextResponse.json({ error: 'invalid summary filters' }, { status: 400 });
    }

    const now = new Date();
    const todayWib = wibDay(now);
    const customFrom = customRange ? wibDay(customRange.from) : '';
    const customTo = customRange ? wibDay(customRange.to) : '';

    const payload = await withCache(
      () => buildSummaryPayload({ period, segment, source, customRange, now }),
      ['mi-summary', period, segment, source ?? '', customFrom, customTo, todayWib],
      {
        tags: [
          CACHE_TAGS.marketSummary,
          CACHE_TAGS.knowledgeGraph,
          CACHE_TAGS.internalSignals,
          CACHE_TAGS.marketCompetitors,
          CACHE_TAGS.marketingSosmed,
        ],
        revalidate: CACHE_TTL.marketIntelligence,
      },
    );

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': PRIVATE_CACHE_CONTROL.standard },
    });
  };
}

async function buildSummaryPayload({
  period,
  segment,
  source,
  customRange,
  now,
}: {
  period: SummaryPeriod;
  segment: string;
  source: string | null;
  customRange: DayRange | null;
  now: Date;
}) {
  const cleanHtmlText = (str: string) => {
    if (!str) return '';
    return str
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const range: DayRange = customRange ?? presetRange(period, now);
  const periodStart = range.from;
  const periodEnd = range.to;

  // Kueri paralel penuh sejak awal (menghilangkan waterfall serial & menggabungkan evidence/sub-loader ter-cache).
  const [
    items,
    competitors,
    prices,
    sanghyangPrices,
    promotionRows,
    storedReviews,
    storedInsights,
    nightlyHeartbeat,
    otaDirectory,
    marketSize,
    evidenceBundle,
    venuesByHotel,
    reviewShares,
    roomTypesMap,
    specsMap,
    dynamicMenusMap,
  ] = await Promise.all([
    // 1. Market items: terbit di periode, atau acaranya berlangsung di periode sampai sebulan sesudahnya
    db.marketItem.findMany({
      where: {
        OR: [
          { createdAt: { gte: periodStart, lte: periodEnd } },
          { article: { publishedAt: { gte: periodStart, lte: periodEnd } } },
          { startsAt: { gte: periodStart, lte: new Date(periodEnd.getTime() + EVENT_HORIZON_DAYS * 86_400_000) } },
          { endsAt: { gte: periodStart, lte: periodEnd } },
        ],
      },
      select: {
        kind: true,
        brand: true,
        description: true,
        startsAt: true,
        endsAt: true,
        tags: true,
        createdAt: true,
        readStatus: true,
        readNote: true,
        readSummary: true,
        outlets: true,
        articleUrl: true,
        location: true,
        distanceKm: true,
        article: {
          select: {
            title: true,
            publishedAt: true,
            canonicalUrl: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { article: { canonicalUrl: 'asc' } }],
    }),

    // 2. Competitors aktif: proyeksi kolom yang dibutuhkan modul ringkasan & komparasi
    db.competitor.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        location: true,
        rating: true,
        reviewCount: true,
        ratingSource: true,
        ratingSourceUrl: true,
        ratingObservedAt: true,
        notes: true,
        websiteUrl: true,
        instagramUrl: true,
        tiktokUrl: true,
        googleMapsUrl: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    }),

    // 3. Snapshot harga kompetitor: saring per periode observasi; tarif properti paket lama tidak sebanding (rate-basis.ts)
    db.competitorPriceSnapshot.findMany({
      where: {
        observedAt: { gte: periodStart, lte: periodEnd },
        ...COMPARABLE_RATE_WHERE,
      },
      select: {
        id: true,
        competitorId: true,
        roomName: true,
        packageName: true,
        price: true,
        currency: true,
        guests: true,
        checkIn: true,
        checkOut: true,
        source: true,
        sourceUrl: true,
        observedAt: true,
        competitor: {
          select: {
            name: true,
            instagramUrl: true,
            tiktokUrl: true,
            websiteUrl: true,
            googleMapsUrl: true,
          },
        },
      },
      orderBy: [{ observedAt: 'desc' }, { roomName: 'asc' }, { packageName: 'asc' }, { checkIn: 'asc' }, { source: 'asc' }],
    }),

    // 4. Snapshot harga baseline Sanghyang: saring per periode observasi, tanpa tarif properti paket lama
    db.sanghyangPriceSnapshot.findMany({
      where: {
        observedAt: { gte: periodStart, lte: periodEnd },
        ...COMPARABLE_RATE_WHERE,
      },
      select: {
        id: true,
        roomName: true,
        packageName: true,
        price: true,
        currency: true,
        guests: true,
        checkIn: true,
        checkOut: true,
        source: true,
        sourceUrl: true,
        observedAt: true,
      },
      orderBy: [{ observedAt: 'desc' }, { roomName: 'asc' }, { packageName: 'asc' }, { checkIn: 'asc' }, { source: 'asc' }],
    }),

    // 5. Promosi kompetitor & Sanghyang yang mungkin berjalan atau segera datang di rentang; disaring tepat dengan
    //    promoInRange sesudah kueri.
    db.competitorPromotion.findMany({
      where: promoRangeWhere(range),
      select: {
        id: true,
        competitorId: true,
        title: true,
        category: true,
        description: true,
        startsAt: true,
        endsAt: true,
        price: true,
        originalPrice: true,
        discount: true,
        source: true,
        sourceUrl: true,
        imageUrl: true,
        capturedAt: true,
        status: true,
        kind: true,
        promotionType: true,
        details: true,
        terms: true,
        createdAt: true,
        competitor: {
          select: {
            name: true,
            instagramUrl: true,
            tiktokUrl: true,
            websiteUrl: true,
            googleMapsUrl: true,
            active: true,
            outlets: true,
            category: true,
            compsetRole: true,
            roadKm: true,
          },
        },
      },
      // Tanpa ORDER BY: urutan judul di SQL mengikuti collation yang beda antara lokal dan Supabase. Baris ini hanya dipakai
      // lewat mergePromoCaptures, yang menyusun urutan tetap sendiri (lib/market/stable-order.ts).
    }),

    // 6. Ulasan yang tidak diarsipkan dan bertanggal di dalam periode terpilih (hari WIB), supaya Langkah 1 dan
    //    hitungan sentimen mengikuti pemilih periode (keputusan pemakai 18 Nov 2026).
    db.competitorReview.findMany({
      where: { archivedAt: null, reviewDate: { gte: periodStart, lte: periodEnd }, ...GUEST_REVIEWS_ONLY },
      select: {
        id: true,
        externalId: true,
        competitorId: true,
        source: true,
        sourceUrl: true,
        rating: true,
        reviewDate: true,
        title: true,
        text: true,
        sentiment: true,
        themes: true,
        capturedAt: true,
        createdAt: true,
        competitor: {
          select: {
            name: true,
            instagramUrl: true,
            tiktokUrl: true,
            websiteUrl: true,
            googleMapsUrl: true,
          },
        },
      },
      orderBy: [{ reviewDate: 'desc' }, { source: 'asc' }, { externalId: 'asc' }],
    }),

    // 7. Market insights aktif
    db.marketInsight.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        type: true,
        title: true,
        summary: true,
        evidence: true,
        priority: true,
        fingerprint: true,
        generatedAt: true,
      },
      orderBy: [{ priority: 'desc' }, { fingerprint: 'asc' }],
    }),

    // 8. Heartbeat sinkronisasi malam (paralel)
    db.marketInsight.findFirst({
      where: { fingerprint: 'nightly-sync-heartbeat' },
      select: { title: true, summary: true, evidence: true, generatedAt: true },
    }),

    // 9-16. Sub-loader pasar ter-cache dimuat serentak sejak awal (tanpa waterfall serial maupun duplikasi kueri)
    loadDynamicOtaDirectory(),
    loadResortMarketSize(),
    loadEvidenceBundle(),
    loadHotelVenues(),
    loadReviewShares({
      'sunset-grill': 'Sunset Grill (Sanghyang)',
      'dragon-beach-club': 'Dragon Beach Club (Sanghyang)',
      dbistro: "D'Bistro (Sanghyang)",
      dbar: "D'Bar & Karaoke (Sanghyang)",
      dspa: "D'Spa & Hot Spring Aquamedic (Sanghyang)",
    }),
    loadDynamicHotelRoomTypes(),
    loadPlaceSpecsMap(),
    loadDynamicCompetitorMenuItems(),
  ]);
  const { ownEvidence, competitorEvidence } = evidenceBundle;
  // Promo manual internal ("Tim marketing Sanghyang") tidak masuk radar publik agar analisis memakai data eksternal terverifikasi.
  // Saring usia <= 90 hari sebelum penggabungan supaya postingan sosmed lama tidak mencemari kartu situs resmi tanpa tanggal.
  const promotions = promotionRows.filter(
    (p) =>
      p.source !== OWN_TEAM_SOURCE &&
      promoInRange(p, range, now) &&
      isPromoWithinRecencyWindow(p, range.to),
  );
  // mergePromoCaptures menyusun urutan tangkapan yang sama di setiap DB (lib/market/stable-order.ts) sebelum digabung.
  const mergedPromotions = mergePromoCaptures(promotions).filter((p) =>
    isPromoWithinRecencyWindow(p, range.to),
  );

  // ORDER BY fingerprint mengikuti collation basis data (lokal dan Supabase berbeda), jadi urutannya disusun ulang di sini.
  const insights = storedInsights
    .filter((i) => !DISPROVEN_FACILITY_CLAIM.test(`${i.title} ${i.summary} ${JSON.stringify(i.evidence)}`))
    .sort((a, b) => b.priority - a.priority || a.fingerprint.localeCompare(b.fingerprint, 'id'));
  const otaVerifyHosts = otaDirectory.reviewHosts.length ? otaDirectory.reviewHosts : otaDirectory.hosts;
  const reviews = storedReviews.filter((r) => isVerifiedReviewSource(r.sourceUrl, otaVerifyHosts) || !DISPROVEN_FACILITY_CLAIM.test(`${r.title ?? ''} ${r.text}`));

  if (insights.length < storedInsights.length || reviews.length < storedReviews.length) {
    console.warn(`[market-intelligence] Disembunyikan karena memuat klaim fasilitas yang tidak didukung situs resmi: ${storedInsights.length - insights.length} insight, ${storedReviews.length - reviews.length} ulasan belum terverifikasi.`);
  }

  // Pre-mapping kompetitor untuk pencarian cepat tanpa perulangan lowercasing berulang
  const compLookups = competitors.map((c) => ({
    name: c.name,
    nameLower: c.name.toLowerCase(),
    instagramUrl: c.instagramUrl,
    tiktokUrl: c.tiktokUrl,
    websiteUrl: c.websiteUrl,
    googleMapsUrl: c.googleMapsUrl,
  }));
  const compNameById = new Map(competitors.map((c) => [c.id, c.name]));

  // Berita dan item pasar hanya yang isinya sudah dibaca dan dinilai relevan untuk outlet dengan lokasi dalam radius
  // 25 km (lib/market/news-relevance.ts); yang belum dibaca tidak tampil.
  const relevantItems = items.filter((x) => x.readStatus === 'relevan');
  const NEWS_CATEGORY: Record<string, string> = { fnb: 'F&B', event: 'Acara', entertainment: 'Hiburan', destination: 'Destinasi' };
  const news = relevantItems
    .filter((x) => newsInPeriod({ kind: x.kind, startsAt: x.startsAt, endsAt: x.endsAt, publishedAt: x.article.publishedAt ?? x.createdAt }, range))
    .map((x) => ({
      title: splitNewsTitle(x.article.title).title,
      source: cleanSourceLabel(newsSourceLabel(x)),
      url: x.articleUrl ?? x.article.canonicalUrl,
      date: (x.article.publishedAt ?? x.createdAt).toISOString(),
      category: NEWS_CATEGORY[x.kind] ?? 'Destinasi',
      outlets: x.outlets,
      summary: x.readSummary,
      reason: x.readNote,
      location: x.location,
      distanceKm: x.distanceKm,
      eventStart: x.kind === 'event' && x.startsAt ? x.startsAt.toISOString() : null,
      eventEnd: x.kind === 'event' && x.endsAt ? x.endsAt.toISOString() : null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title) || (a.url ?? '').localeCompare(b.url ?? ''))
    .slice(0, MAX_NEWS);

  const requestedSource = source ? cleanSourceLabel(source) : null;

  const rows: SummaryRow[] = [
    ...competitors.map((x) => ({
      date: (x.ratingObservedAt ?? x.updatedAt).toISOString(),
      category: 'Competitors',
      source: cleanSourceLabel(x.ratingSource ?? 'Daftar kompetitor'),
      sourceUrl: x.ratingSourceUrl ?? x.websiteUrl ?? x.instagramUrl ?? undefined,
      headline: `${x.name} · ${x.location ?? 'Anyer–Carita–Cilegon'}${x.rating == null ? '' : ` · ${Number(x.rating).toFixed(1)}/5 · ${x.reviewCount?.toLocaleString('id-ID') ?? '?'} ulasan`}`,
      relevance: x.notes ?? 'Bandingkan reputasi publik dan posisi Sanghyang terhadap resort sekitar.',
      sentiment: 'neutral' as const,
      socialUrls: {
        instagram: x.instagramUrl ?? undefined,
        tiktok: x.tiktokUrl ?? undefined,
        website: x.websiteUrl ?? undefined,
        maps: x.googleMapsUrl ?? undefined,
      },
    })),
    ...relevantItems.map((x) => {
      const category = x.kind === 'fnb' ? 'F&B' : x.kind === 'event' ? 'Events' : x.kind === 'entertainment' ? 'Entertainment' : 'Destinations';
      const cleanDesc = cleanHtmlText(x.description ?? '');
      const textToScan = `${x.article.title} ${cleanDesc}`.toLowerCase();
      const mentions: string[] = [];
      for (let i = 0; i < compLookups.length; i++) {
        if (textToScan.includes(compLookups[i].nameLower)) {
          mentions.push(compLookups[i].name);
        }
      }

      const tagsObj = (x.tags && typeof x.tags === 'object' && !Array.isArray(x.tags)) ? (x.tags as Record<string, unknown>) : null;
      const tagSocial = {
        instagram: (tagsObj?.instagramUrl as string) ?? undefined,
        tiktok: (tagsObj?.tiktokUrl as string) ?? undefined,
        website: (tagsObj?.websiteUrl as string) ?? undefined,
        maps: (tagsObj?.googleMapsUrl as string) ?? undefined,
      };

      let matchedComp = compLookups.find((c) => mentions.includes(c.name));
      if (!matchedComp && x.brand) {
        const brandLower = x.brand.toLowerCase();
        matchedComp = compLookups.find((c) => c.nameLower.includes(brandLower));
      }

      const socialUrls = {
        instagram: tagSocial.instagram ?? matchedComp?.instagramUrl ?? undefined,
        tiktok: tagSocial.tiktok ?? matchedComp?.tiktokUrl ?? undefined,
        website: tagSocial.website ?? matchedComp?.websiteUrl ?? undefined,
        maps: tagSocial.maps ?? matchedComp?.googleMapsUrl ?? undefined,
      };

      const rowSource = newsSourceLabel(x);

      return {
        date: (x.article.publishedAt ?? x.createdAt).toISOString(),
        category,
        source: cleanSourceLabel(rowSource),
        sourceUrl: x.article.canonicalUrl ?? socialUrls.instagram ?? socialUrls.website ?? undefined,
        headline: x.article.title,
        relevance: `${cleanDesc ? `${cleanDesc} ` : ''}${mentions.length ? `Kaitan kompetitor: ${mentions.join(', ')}.` : ''}`.trim(),
        sentiment: 'positive' as const,
        activeFrom: (x.startsAt ?? x.article.publishedAt ?? x.createdAt).toISOString(),
        activeTo: x.endsAt ? x.endsAt.toISOString() : undefined,
        socialUrls: (socialUrls.instagram || socialUrls.tiktok || socialUrls.website || socialUrls.maps) ? socialUrls : undefined,
      };
    }),
    ...prices.map((x) => {
      const hotelName = x.competitor?.name ?? 'Kompetitor';
      const label = x.roomName ? `${hotelName} · ${x.roomName}` : (x.packageName ? `${hotelName} · ${x.packageName}` : `${hotelName} · Tarif terendah`);
      return {
        date: x.observedAt.toISOString(),
        category: 'Competitors',
        source: cleanSourceLabel(x.source),
        sourceUrl: x.sourceUrl ?? undefined,
        headline: `${label} · ${Number(x.price).toLocaleString('id-ID')} ${x.currency}`,
        relevance: `Bandingkan tarif ${hotelName} dengan baseline Sanghyang untuk tanggal, tipe kamar, dan tamu yang sama.`,
        sentiment: 'neutral' as const,
        socialUrls: {
          instagram: x.competitor?.instagramUrl ?? undefined,
          tiktok: x.competitor?.tiktokUrl ?? undefined,
          website: x.competitor?.websiteUrl ?? undefined,
          maps: x.competitor?.googleMapsUrl ?? undefined,
        },
      };
    }),
    ...sanghyangPrices.map((x) => ({
      date: x.observedAt.toISOString(),
      category: 'Competitors',
      source: cleanSourceLabel(x.source),
      sourceUrl: x.sourceUrl ?? undefined,
      headline: `Sanghyang Indah Spa Resort · ${x.roomName} · ${Number(x.price).toLocaleString('id-ID')} ${x.currency}`,
      relevance: 'Baseline harga resmi Sanghyang untuk perbandingan dengan snapshot kompetitor yang setara.',
      sentiment: 'neutral' as const,
    })),
    ...mergedPromotions
      .filter((x) => !isOwnCompetitorName(x.competitor.name) && isGenuinePromoOrEvent(x))
      .map((x) => {
      const postedDate = x.capturedAt ?? x.startsAt ?? x.createdAt;
      const promoDetails = [
        x.discount != null ? `diskon ${Number(x.discount)}%` : null,
        x.price != null ? `mulai IDR ${Number(x.price).toLocaleString('id-ID')}` : null,
        x.endsAt != null ? `periode ${x.startsAt.toLocaleDateString('id-ID', WIB)}–${x.endsAt.toLocaleDateString('id-ID', WIB)}` : null,
      ].filter(Boolean).join(', ');

      const relevanceSummary = promoDetails ? `Promo kompetitor (${promoDetails}).` : 'Promo kompetitor.';

      return {
        date: postedDate.toISOString(),
        category: 'Promotions',
        source: cleanSourceLabel(x.source),
        sourceUrl: x.sourceUrl ?? x.competitor?.instagramUrl ?? x.competitor?.websiteUrl ?? undefined,
        headline: `${x.competitor?.name ?? 'Kompetitor'} · ${x.title}`,
        relevance: `${x.description ? `${x.description} ` : ''}${relevanceSummary}`,
        sentiment: 'neutral' as const,
        activeFrom: x.startsAt.toISOString(),
        activeTo: x.endsAt ? x.endsAt.toISOString() : undefined,
        socialUrls: {
          instagram: x.competitor?.instagramUrl ?? undefined,
          tiktok: x.competitor?.tiktokUrl ?? undefined,
          website: x.competitor?.websiteUrl ?? undefined,
          maps: x.competitor?.googleMapsUrl ?? undefined,
        },
      };
    }),
    ...reviews.map((x) => ({
      date: (x.reviewDate ?? x.capturedAt ?? x.createdAt).toISOString(),
      reviewDate: x.reviewDate.toISOString(),
      category: 'Reviews',
      source: cleanSourceLabel(x.source),
      sourceUrl: x.sourceUrl ?? x.competitor?.googleMapsUrl ?? x.competitor?.websiteUrl ?? undefined,
      headline: `${x.competitor?.name ?? 'Kompetitor'} · ${x.title ?? x.text}`,
      relevance: `${x.text} (${Number(x.rating) > 0 ? `Ulasan ${Number(x.rating).toFixed(1)}/5` : 'Komentar publik'} dari ${x.competitor?.name ?? 'kompetitor'}${x.themes?.length ? `; tema: ${visibleThemes(x.themes).join(', ')}` : ''}).`,
      sentiment: x.sentiment as SummaryRow['sentiment'],
      activeFrom: (x.reviewDate ?? x.capturedAt).toISOString(),
      socialUrls: {
        instagram: x.competitor?.instagramUrl ?? undefined,
        tiktok: x.competitor?.tiktokUrl ?? undefined,
        website: x.competitor?.websiteUrl ?? undefined,
        maps: x.competitor?.googleMapsUrl ?? undefined,
      },
    })),
  ].filter((row) => !requestedSource || row.source === requestedSource).filter((row) => segment === 'all' || ({ fnb: 'F&B', event: 'Events', entertainment: 'Entertainment', destination: 'Destinations', competitor: 'Competitors', promotion: 'Promotions', review: 'Reviews' } as Record<string, string>)[segment] === row.category);

  const summary = transformMarketSummary({
    rows,
    competitors: competitors.length,
    marketItems: relevantItems.length,
    period,
    from: range.from,
    to: range.to,
    customRange: customRange !== null ? range : null,
  });

  const isSanghyangOutlet = (name: string) => name.toLowerCase().includes('sanghyang');
  const sanghyangMain = competitors.find((c) => c.name === 'Sanghyang Indah Spa Resort') ?? competitors.find((c) => isSanghyangOutlet(c.name));
  // Tanpa rating terbaca, nilainya null; angka cadangan akan tampil seolah data asli.
  const sanghyangRating = sanghyangMain?.rating != null ? Number(sanghyangMain.rating) : null;
  const sanghyangReviewCount = sanghyangMain?.reviewCount ?? null;

  const comparison = competitors
    .filter((x) => x.rating != null && x.reviewCount != null && !isSanghyangOutlet(x.name))
    .map((x) => ({
      name: x.name,
      rating: Number(x.rating),
      reviewCount: x.reviewCount ?? 0,
      difference: sanghyangRating === null ? null : Number((Number(x.rating) - sanghyangRating).toFixed(1)),
      source: cleanSourceLabel(x.ratingSource ?? 'Public source'),
      sourceUrl: x.ratingSourceUrl ?? x.websiteUrl ?? x.instagramUrl ?? undefined,
      instagramUrl: x.instagramUrl ?? undefined,
      tiktokUrl: x.tiktokUrl ?? undefined,
      websiteUrl: x.websiteUrl ?? undefined,
      googleMapsUrl: x.googleMapsUrl ?? undefined,
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount);

  const comparable = matchComparablePrices(
    sanghyangPrices.filter((x) => !isPropertyRatePackage(x.packageName)).filter((x): x is typeof x & { roomName: string; checkIn: Date; checkOut: Date } => Boolean(x.roomName && x.checkIn && x.checkOut)).map((x) => ({ roomName: x.roomName, price: Number(x.price), currency: x.currency, guests: x.guests, checkIn: x.checkIn, checkOut: x.checkOut, source: x.source, sourceUrl: x.sourceUrl ?? '' } satisfies PriceSnapshot)),
    prices.filter((x) => !isPropertyRatePackage(x.packageName)).filter((x): x is typeof x & { roomName: string; checkIn: Date; checkOut: Date } => Boolean(x.roomName && x.checkIn && x.checkOut)).map((x) => ({ roomName: x.roomName, price: Number(x.price), currency: x.currency, guests: x.guests, checkIn: x.checkIn, checkOut: x.checkOut, source: x.source, sourceUrl: x.sourceUrl ?? '', competitorId: x.competitorId } satisfies PriceSnapshot)),
  );

  const priceRows = comparable.map(({ baseline, competitor: x, difference }) => ({
    competitor: compNameById.get(x.competitorId) ?? 'Kompetitor',
    roomName: x.roomName,
    currency: x.currency,
    guests: x.guests,
    checkIn: x.checkIn.toISOString(),
    checkOut: x.checkOut.toISOString(),
    sanghyangPrice: baseline.price,
    competitorPrice: x.price,
    difference,
    source: cleanSourceLabel(x.source),
    sourceUrl: x.sourceUrl || undefined,
  }));

  const latestSanghyangRate = sanghyangPrices.find((x) => x.packageName === PROPERTY_RATE_PACKAGE);
  const latestCompetitorRatesMap = new Map<string, typeof prices[0]>();
  for (const p of prices) {
    if (p.packageName === PROPERTY_RATE_PACKAGE && !latestCompetitorRatesMap.has(p.competitorId)) {
      latestCompetitorRatesMap.set(p.competitorId, p);
    }
  }

  const activeMarketRates = [
    ...(latestSanghyangRate ? [{
      hotel: 'Sanghyang',
      price: Number(latestSanghyangRate.price),
      currency: latestSanghyangRate.currency,
      guests: latestSanghyangRate.guests,
      checkIn: latestSanghyangRate.checkIn.toISOString(),
      checkOut: latestSanghyangRate.checkOut.toISOString(),
      observedAt: latestSanghyangRate.observedAt.toISOString(),
      source: cleanSourceLabel(latestSanghyangRate.source),
      sourceUrl: latestSanghyangRate.sourceUrl ?? undefined,
    }] : []),
    ...Array.from(latestCompetitorRatesMap.values()).map((x) => ({
      hotel: compNameById.get(x.competitorId) ?? 'Kompetitor',
      price: Number(x.price),
      currency: x.currency,
      guests: x.guests,
      checkIn: x.checkIn?.toISOString() ?? '',
      checkOut: x.checkOut?.toISOString() ?? '',
      observedAt: x.observedAt.toISOString(),
      source: cleanSourceLabel(x.source),
      sourceUrl: x.sourceUrl ?? undefined,
    })),
  ];

  const marketBaseline = activeMarketRates.find((x) => x.hotel === 'Sanghyang')?.price;
  const marketRateComparison = activeMarketRates.map((x) => ({
    ...x,
    difference: marketBaseline == null ? null : Number((x.price - marketBaseline).toFixed(2)),
  }));

  const marketRateHistory = [
    ...sanghyangPrices.filter((x) => x.packageName === PROPERTY_RATE_PACKAGE).map((x) => ({
      hotel: 'Sanghyang',
      price: Number(x.price),
      currency: x.currency,
      checkIn: x.checkIn.toISOString(),
      checkOut: x.checkOut.toISOString(),
      observedAt: x.observedAt.toISOString(),
    })),
    ...prices.filter((x) => x.packageName === PROPERTY_RATE_PACKAGE).map((x) => ({
      hotel: compNameById.get(x.competitorId) ?? 'Kompetitor',
      price: Number(x.price),
      currency: x.currency,
      checkIn: x.checkIn?.toISOString() ?? '',
      checkOut: x.checkOut?.toISOString() ?? '',
      observedAt: x.observedAt.toISOString(),
    })),
  ].sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());

  // Outlet-Level Intelligence breakdown
  // Daftar kompetitor diurutkan ORDER BY nama di basis data, yang hasilnya bergantung collation (apostrof "D'Spa" diabaikan
  // di Postgres lokal, tidak di Supabase), jadi urutan outlet Sanghyang disusun di sini dengan aturan tetap.
  const sanghyangOutlets = competitors
    .filter((c) => isSanghyangOutlet(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const ownOutletIds = new Set(sanghyangOutlets.map((o) => o.id));
  const outletKeyMap: Record<string, string> = {
    'Sanghyang Indah Spa Resort': 'resort',
    'Sunset Grill (Sanghyang)': 'sunset-grill',
    'Dragon Beach Club (Sanghyang)': 'dragon-beach-club',
    "D'Bistro (Sanghyang)": 'dbistro',
    "D'Bar & Karaoke (Sanghyang)": 'dbar',
    "D'Spa & Hot Spring Aquamedic (Sanghyang)": 'dspa',
  };

  // Sintesis rekomendasi dinamis berbasis Knowledge Graph lokal + audit compset secara paralel (tanpa duplikasi sub-loader)
  const [kgGraph, compsetAudit] = await Promise.all([
    buildKnowledgeGraph(range, { marketSize, roomTypesMap, specsMap, dynamicMenusMap }),
    loadCompsetAudit(marketSize, { roomTypesMap, specsMap, dynamicMenusMap }),
  ]);

  const outletAnalysisMap = new Map<string, OutletAnalysisResult>();
  const [competitorMatrix] = await Promise.all([
    // Periode terpilih ikut dikirim supaya catatan jendela tarif dan angkanya mengikuti periode; laporan PDF memakai
    // nilai yang sama (keputusan koordinator C15, 21 Nov 2026) sehingga angka web = PDF.
    buildOutletCompetitorMatrices({
      marketSize,
      compsetAudit,
      roomTypesMap,
      specsMap,
      dynamicMenusMap,
      priceSnapshots: prices.length > 0 ? prices : undefined,
      from: periodStart,
      to: periodEnd,
    }),
    ...sanghyangOutlets.map(async (outlet) => {
      const key = outletKeyMap[outlet.name] ?? outlet.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      try {
        const ctx = buildOutletKnowledgeContext(kgGraph, key, rangeLabel(range));
        const analysis = await synthesizeOutletAnalysis(ctx, { deterministicOnly: true });
        outletAnalysisMap.set(key, analysis);
      } catch (error) {
        // ZERO-FALLBACK: outlet yang analisisnya gagal disusun tampil tanpa rekomendasi dinamis, sementara outlet lain dan
        // bagian summary lain tetap dikirim. Galatnya dicatat di log server supaya bisa ditelusuri.
        console.error(`[market-intelligence] analisis outlet ${key} gagal disusun:`, error);
      }
    }),
  ]);

  const outlets = sanghyangOutlets.map((outlet) => {
    const key = outletKeyMap[outlet.name] ?? outlet.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const outletReviews = reviewsForOwnOutlet(reviews, { id: outlet.id, key }, ownOutletIds)
      .map((r) => ({
        id: r.id,
        externalId: r.externalId,
        source: cleanSourceLabel(r.source),
        sourceUrl: r.sourceUrl,
        rating: Number(r.rating),
        reviewDate: r.reviewDate.toISOString(),
        title: r.title,
        text: r.text,
        sentiment: r.competitorId === outlet.id ? r.sentiment : (outletSentiment(r.themes, key) ?? r.sentiment),
        themes: visibleThemes(r.themes).filter((t) => !OUTLET_KEYS.includes(t as OutletKey)),
        own: ownOutletIds.has(r.competitorId),
        verified: isVerifiedReviewSource(r.sourceUrl, otaVerifyHosts),
      }));

    let posCount = 0;
    let neuCount = 0;
    let negCount = 0;
    let verifiedCount = 0;
    const verifiedReviewsList: (typeof outletReviews)[0][] = [];

    const channelStats = {
      google: { count: 0, positive: 0, ratingSum: 0 },
      ota: { count: 0, positive: 0, ratingSum: 0 },
      social: { count: 0, positive: 0 },
      website: { count: 0, positive: 0 },
    };

    const aspectMap: Record<string, { count: number; positive: number; negative: number }> = {};

    for (const r of outletReviews) {
      if (r.sentiment === 'positive') posCount++;
      else if (r.sentiment === 'neutral') neuCount++;
      else if (r.sentiment === 'negative') negCount++;

      if (r.verified) {
        verifiedCount++;
        if (verifiedReviewsList.length < 30) {
          verifiedReviewsList.push(r);
        }
      }

      const ch = channelFromSource(r.source, otaDirectory.providers);
      channelStats[ch].count++;
      if (r.sentiment === 'positive') channelStats[ch].positive++;
      if ('ratingSum' in channelStats[ch]) {
        (channelStats[ch] as { count: number; positive: number; ratingSum: number }).ratingSum += r.rating;
      }

      for (const t of r.own ? r.themes : []) {
        if (['business', 'resort', 'sunset-grill', 'dragon-beach-club', 'dbistro', 'dbar', 'dspa'].includes(t)) continue;
        if (!aspectMap[t]) aspectMap[t] = { count: 0, positive: 0, negative: 0 };
        aspectMap[t].count++;
        if (r.sentiment === 'positive') aspectMap[t].positive++;
        if (r.sentiment === 'negative') aspectMap[t].negative++;
      }
    }

    const topAspects = Object.entries(aspectMap)
      .map(([aspect, stats]) => ({
        aspect,
        count: stats.count,
        positiveRatio: stats.count > 0 ? Math.round((stats.positive / stats.count) * 100) : 0,
        negativeRatio: stats.count > 0 ? Math.round((stats.negative / stats.count) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const outletNameLower = outlet.name.toLowerCase();
    const outletAnalysis = outletAnalysisMap.get(key);
    const dynamicFindings = (outletAnalysis?.periodRecommendations ?? []).map((r, idx) => ({
      id: `dynamic-${key}-${r.factor}-${idx}`,
      type: 'recommendation',
      title: `[${r.factor.toUpperCase()}] ${r.finding}`,
      summary: `${r.action} (Metrik pantau: ${r.metricToWatch})`,
      action: (r.priority === 'tinggi' ? 'improve' : 'maintain') as 'maintain' | 'improve',
      priority: (r.priority === 'tinggi' ? 'high' : 'medium') as 'high' | 'medium',
      steps: [r.action, `Pantau: ${r.metricToWatch}`],
      evidenceIds: r.evidenceSources,
    }));

    const dbFindings = insights
      .filter((i) => {
        const ev = i.evidence as Record<string, unknown> | null;
        return ev?.outlet === key || i.title.toLowerCase().includes(outletNameLower) || (key === 'resort' && i.title.includes('Sanghyang Indah Spa Resort') && !i.title.includes('('));
      })
      .map((i) => {
        const ev = (i.evidence as Record<string, unknown>) || {};
        return {
          id: i.id,
          type: i.type,
          title: i.title,
          summary: i.summary,
          action: (ev.action as string) || (i.type === 'recommendation' ? 'maintain' : 'improve'),
          priority: (ev.priority as string) || (i.priority >= 90 ? 'high' : 'medium'),
          steps: (ev.steps as string[]) || [],
          evidenceIds: (ev.evidenceIds as string[]) || [],
        };
      });

    const findings = [...dynamicFindings, ...dbFindings];

    return {
      id: outlet.id,
      key,
      name: outlet.name,
      location: outlet.location,
      rating: outlet.rating != null ? Number(outlet.rating) : null,
      reviewCount: outlet.reviewCount ?? null,
      websiteUrl: outlet.websiteUrl,
      notes: outlet.notes,
      sentimentDistribution: {
        positive: posCount,
        neutral: neuCount,
        negative: negCount,
        total: outletReviews.length,
      },
      channelBreakdown: {
        google: {
          count: channelStats.google.count,
          positive: channelStats.google.positive,
          rating: channelStats.google.count > 0 ? Number((channelStats.google.ratingSum / channelStats.google.count).toFixed(1)) : null,
        },
        ota: {
          count: channelStats.ota.count,
          positive: channelStats.ota.positive,
          rating: channelStats.ota.count > 0 ? Number((channelStats.ota.ratingSum / channelStats.ota.count).toFixed(1)) : null,
        },
        social: {
          count: channelStats.social.count,
          positive: channelStats.social.positive,
          positiveRatio: channelStats.social.count > 0 ? Math.round((channelStats.social.positive / channelStats.social.count) * 100) : null,
        },
      },
      topAspects,
      findings,
      reviews: outletReviews.slice(0, MAX_REVIEWS_PER_OUTLET),
      verifiedReviewCount: verifiedCount,
      verifiedReviews: verifiedReviewsList,
    };
  });

  // Langkah 2 hanya memuat butir bersumber; catatan perbandingan lama tanpa sumber per butir tidak dikirim lagi.
  const comparisons = groundedComparisons(competitorEvidence);

  // Peta analisis terisi menurut urutan selesainya pekerjaan paralel per outlet, jadi temuan disusun menurut kunci outlet.
  const dynamicActionFindings = Array.from(outletAnalysisMap.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'id'))
    .flatMap(([key, analysis]) => {
    const outlet = sanghyangOutlets.find((o) => (outletKeyMap[o.name] ?? o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) === key);
    return (analysis.periodRecommendations ?? []).map((r, idx) => ({
      id: `dynamic-${key}-${r.factor}-${idx}`,
      outlet: key,
      outletName: outlet?.name ?? 'Sanghyang Indah Spa Resort',
      action: (r.priority === 'tinggi' ? 'improve' : 'maintain') as 'maintain' | 'improve',
      priority: (r.priority === 'tinggi' ? 'high' : 'medium') as 'high' | 'medium',
      title: `[${r.factor.toUpperCase()}] ${r.finding}`,
      summary: `${r.action} (Metrik: ${r.metricToWatch})`,
      steps: [r.action, `Pantau: ${r.metricToWatch}`],
      evidenceIds: r.evidenceSources,
    }));
  });

  const dbActionFindings = insights
    .filter((i) => {
      const ev = i.evidence as Record<string, unknown> | null;
      return ev?.action === 'maintain' || ev?.action === 'improve';
    })
    .map((i) => {
      const ev = (i.evidence as Record<string, unknown>) || {};
      return {
        id: i.id,
        outlet: (ev.outlet as string) || 'resort',
        outletName: (ev.outletName as string) || 'Sanghyang Indah Spa Resort',
        action: (ev.action as string) || (i.type === 'recommendation' ? 'maintain' : 'improve'),
        priority: (ev.priority as string) || (i.priority >= 90 ? 'high' : 'medium'),
        title: i.title,
        summary: i.summary,
        steps: (ev.steps as string[]) || [],
        evidenceIds: (ev.evidenceIds as string[]) || [],
      };
    });

  const actionFindings = [...dynamicActionFindings, ...dbActionFindings];

  let verifiedReviewsTotal = 0;
  let sanghyangReviewTotal = 0;
  for (const r of reviews) {
    if (isVerifiedReviewSource(r.sourceUrl, otaVerifyHosts)) {
      verifiedReviewsTotal++;
    }
    if (isSanghyangOutlet(r.competitor?.name ?? '')) {
      sanghyangReviewTotal++;
    }
  }

  const heartbeatInsight = nightlyHeartbeat ?? insights.find((i) => i.fingerprint === 'nightly-sync-heartbeat');
  const heartbeatSyncedAt = (heartbeatInsight?.evidence as { syncedAt?: string } | null)?.syncedAt;
  const syncStatus = {
    lastSyncAt: heartbeatSyncedAt ?? heartbeatInsight?.generatedAt?.toISOString() ?? null,
    latestReviewDate: reviews[0]?.reviewDate?.toISOString() || null,
    totalReviews: reviews.length,
    verifiedReviews: verifiedReviewsTotal,
    totalCompetitors: competitors.length,
    schedule: 'Setiap malam via GitHub Actions Cron',
    heartbeatSummary: heartbeatInsight?.summary ?? null,
  };

  const executiveSummary = syncStatus.lastSyncAt
    ? `Data per ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(syncStatus.lastSyncAt))} WIB: ${syncStatus.totalReviews} ulasan tercatat, ${sanghyangReviewTotal} untuk ${outlets.length} unit bisnis Sanghyang dan ${syncStatus.totalReviews - sanghyangReviewTotal} untuk kompetitor. Baru ${syncStatus.verifiedReviews} ulasan yang terverifikasi dari scrape Google Travel; sisanya data riset lama yang sumbernya belum bisa dipastikan, termasuk dasar sebagian rekomendasi. Tarif Google Hotels terbaru tersedia untuk ${marketRateComparison.length} hotel.`
    : null;

  // Helper parsing metrik media sosial (likes, views, comments, shares)
  const parseSocialMetrics = (description: string | null) => {
    let text = description;
    let metrics: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null } | null = null;
    if (description && description.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(description);
        if (parsed.caption) text = parsed.caption;
        if (parsed.metrics) {
          metrics = {
            views: parsed.metrics.views ?? null,
            likes: parsed.metrics.likes ?? null,
            comments: parsed.metrics.comments ?? null,
            shares: parsed.metrics.shares ?? null,
          };
        }
      } catch (error) {
        // ZERO-FALLBACK: deskripsi berawalan "{" yang bukan JSON sah dibaca sebagai teks caption tanpa metrik; postingan
        // tetap tampil dengan tautan aslinya. Dicatat supaya baris rusaknya bisa ditelusuri.
        console.warn(`[market-intelligence] deskripsi promo bukan JSON sah, dibaca sebagai teks: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { text, metrics };
  };

  const isOwnPromo = (name: string) => isOwnCompetitorName(name);

  // Optimasi proses promosi dalam satu loop
  type SocialRadarItem = {
    id: string;
    competitorName: string;
    /** Outlet Sanghyang yang dibandingkan dengan pesaing ini (registri), untuk mencocokkan promo ke outlet. */
    competitorOutlets: string[];
    competitorIsLodging: boolean;
    /** Outlet di dalam hotel pesaing (registri), supaya promo yang menyebut venue itu masuk outlet yang benar. */
    competitorVenues: PromoVenue[];
    competitorRoadKm: number | null;
    competitorHandle: string;
    platform: PromoPlatform;
    sources?: { platform: PromoPlatform; url: string; label: string }[];
    title: string;
    category: string;
    description: string | null;
    startsAt: string;
    endsAt: string | null;
    price: number | null;
    originalPrice: number | null;
    discount: number | null;
    source: string;
    sourceUrl: string;
    imageUrl: string | null;
    status: 'active' | 'upcoming' | 'expired';
    counterStrategy: string;
    /** Promo atau event menurut pembacaan AI; null bila belum dibaca (tampil sebagai promo). */
    kind: 'promo' | 'event' | null;
    /** Kategori promosi (lib/market/promo-type.ts); null bila belum dibaca dan tampil "belum ada data". */
    promotionType: PromotionTypeKey | null;
    /** Isi paket atau rangkaian acara, disalin dari sumber. */
    details: string[];
    terms: string[];
    /** false bila sumber tidak menulis tanggal mulai (startsAt = tanggal baca). */
    startWritten: boolean;
    isOwn?: boolean;
    metrics?: { views?: number | null; likes?: number | null; comments?: number | null; shares?: number | null } | null;
  };

  const competitorSocialRadar: SocialRadarItem[] = [];
  const discoveredSocialPostsRaw: typeof promotions = [];
  const extractedPromos: SocialRadarItem[] = [];

  // Satu baris per promo (tangkapan terbaru) dari pesaing aktif & Sanghyang; promo hasil ekstraksi tetap memakai pencocokan konstanta DB mentah.
  for (const p of mergedPromotions) {
    const sources = p.sources.map((s) => ({
      platform: s.platform,
      url: s.url,
      label: cleanSourceLabel(s.label, s.platform === 'website' ? 'Situs resmi' : s.platform),
    }));
    const readByExtractor = (p.source === EXTRACTED_SOURCE || p.source === WEBSITE_SOURCE) && Boolean(p.sourceUrl);
    const publicSource = cleanSourceLabel(p.source);
    const { text: descText, metrics: parsedMetrics } = parseSocialMetrics(p.description);
    const isOwn = isOwnPromo(p.competitor.name);

    if (p.category !== SOCIAL_POST_CATEGORY && !readByExtractor) {
      let status: 'active' | 'upcoming' | 'expired' = 'active';
      if (p.status === 'expired' || (p.endsAt && p.endsAt < now)) {
        status = 'expired';
      } else if (p.startsAt > now) {
        status = 'upcoming';
      }

      const igHandle = p.competitor.instagramUrl ? `@${p.competitor.instagramUrl.match(/instagram\.com\/([^/]+)/)?.[1] ?? ''}` : '';

      competitorSocialRadar.push({
        id: p.id,
        competitorName: p.competitor.name,
        competitorOutlets: p.competitor.outlets,
        competitorIsLodging: isLodging(p.competitor.category),
        competitorVenues: venuesByHotel.get(p.competitorId) ?? [],
        competitorRoadKm: p.competitor.roadKm,
        competitorHandle: igHandle,
        platform: platformOf(p.sourceUrl) ?? 'website',
        sources,
        title: p.title,
        category: p.category,
        description: descText,
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt ? p.endsAt.toISOString() : null,
        price: p.price ? Number(p.price) : null,
        originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
        discount: p.discount ? Number(p.discount) : null,
        source: publicSource,
        sourceUrl: p.sourceUrl || '',
        imageUrl: p.imageUrl || null,
        status,
        counterStrategy: '',
        kind: p.kind ?? null,
        promotionType: p.promotionType ?? null,
        details: p.details ?? [],
        terms: p.terms ?? [],
        startWritten: startDateWritten(p),
        isOwn,
        metrics: parsedMetrics,
      });
    }

    if (p.category === SOCIAL_POST_CATEGORY && p.status === 'new') {
      discoveredSocialPostsRaw.push(p);
    }

    if (readByExtractor) {
      const [summaryText, ourVersion] = (descText ?? '').split(OUR_VERSION_MARKER);
      const status: 'active' | 'upcoming' | 'expired' =
        p.status === 'expired' || (p.endsAt && p.endsAt < now) ? 'expired' : p.startsAt > now ? 'upcoming' : 'active';
      extractedPromos.push({
        id: p.id,
        competitorName: p.competitor.name,
        competitorOutlets: p.competitor.outlets,
        competitorIsLodging: isLodging(p.competitor.category),
        competitorVenues: venuesByHotel.get(p.competitorId) ?? [],
        competitorRoadKm: p.competitor.roadKm,
        competitorHandle: `@${p.competitor.instagramUrl?.match(/instagram\.com\/([^/]+)/)?.[1] ?? ''}`,
        platform: platformOf(p.sourceUrl) ?? 'website',
        sources,
        title: p.title,
        category: p.category,
        description: summaryText,
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt ? p.endsAt.toISOString() : null,
        price: p.price ? Number(p.price) : null,
        originalPrice: p.originalPrice ? Number(p.originalPrice) : null,
        discount: p.discount ? Number(p.discount) : null,
        source: publicSource,
        sourceUrl: p.sourceUrl as string,
        imageUrl: p.imageUrl,
        status,
        // Tanpa usulan dari pembacaan promo, "Versi kita" kosong (tidak ditampilkan), bukan kalimat umum.
        counterStrategy: ourVersion?.trim() ?? '',
        kind: p.kind ?? null,
        promotionType: p.promotionType ?? null,
        details: p.details ?? [],
        terms: p.terms ?? [],
        startWritten: startDateWritten(p),
        isOwn,
        metrics: parsedMetrics,
      });
    }
  }

  const discoveredSocialPosts: SocialRadarItem[] = discoveredSocialPostsRaw
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, DISCOVERED_POSTS_LIMIT)
    .map((p) => {
      const detectedPlatform = platformOf(p.sourceUrl) ?? 'instagram';
      const handleMatch =
        detectedPlatform === 'tiktok'
          ? p.competitor.tiktokUrl?.match(/tiktok\.com\/@([^/?]+)/)?.[1]
          : p.competitor.instagramUrl?.match(/instagram\.com\/([^/]+)/)?.[1];
      const { text: descText, metrics: parsedMetrics } = parseSocialMetrics(p.description);
      const isOwn = isOwnPromo(p.competitor.name);
      return {
        id: p.id,
        competitorName: p.competitor.name,
        competitorOutlets: p.competitor.outlets,
        competitorIsLodging: isLodging(p.competitor.category),
        competitorVenues: venuesByHotel.get(p.competitorId) ?? [],
        competitorRoadKm: p.competitor.roadKm,
        competitorHandle: `@${handleMatch ?? ''}`,
        platform: detectedPlatform,
        title: p.title,
        category: p.category,
        description: descText ?? '',
        startsAt: p.startsAt.toISOString(),
        endsAt: null,
        price: null,
        originalPrice: null,
        discount: null,
        source: cleanSourceLabel(p.source),
        sourceUrl: p.sourceUrl as string,
        imageUrl: p.imageUrl,
        status: 'active' as const,
        counterStrategy: '',
        kind: null,
        promotionType: p.promotionType ?? null,
        details: [],
        terms: [],
        // Tanggal posting adalah tanggal yang tertulis di postingan.
        startWritten: true,
        isOwn,
        metrics: parsedMetrics,
      };
    });

  const allRadarPromos: SocialRadarItem[] = [];
  for (const item of [...competitorSocialRadar, ...extractedPromos, ...discoveredSocialPosts]) {
    if (!isPromoWithinRecencyWindow(item, range.to)) continue;
    const classifiedKind = classifyPromoOrEvent(item);
    if (!classifiedKind) continue;
    allRadarPromos.push({ ...item, kind: classifiedKind });
  }
  const ownPromos = allRadarPromos.filter((p) => isOwnPromoItem(p));
  const competitorOnlySocialRadar = allRadarPromos.filter((p) => !isOwnPromoItem(p));

  // Hanya outlet F&B, bar, dan spa; hotel resort dan gabungan "all" tidak menampilkan daftar harga menu.
  const menuRivals = [...new Set(OUTLET_KEYS.filter((k) => k !== "resort").flatMap((k) => compsetAudit[k]?.used.map((c) => c.name) ?? []))];
  const dynamicMenusByName = new Map(
    [...dynamicMenusMap.values()].map((rec) => [rec.competitorName.trim().toLowerCase(), rec]),
  );
  const competitorMenus = Object.fromEntries(
    competitorMenuCards(menuRivals, MENU_SAMPLE_ITEMS, (name) =>
      mergeCompetitorMenu(name, dynamicMenusByName.get(name.trim().toLowerCase())),
    ).map((card) => [card.name, card]),
  );
  const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const internalSignals = kgGraph.internalSignals ?? null;
  const withoutRevenueActual = <T extends { revenueActual?: unknown }>(entry: T): Omit<T, 'revenueActual'> => {
    const clone = { ...entry };
    delete clone.revenueActual;
    return clone;
  };

  const outletShares = Object.fromEntries(
    Object.entries(OUTLET_MARKET_SHARE_DATA).map(([key, base]) => {
      const perfMonth = internalSignals?.[key as OutletKey]?.performance?.month ?? null;
      return [
        key,
        {
          ...withoutRevenueActual(base),
          activeMonth: perfMonth ? monthLabel(perfMonth) : base.activeMonth,
          benchmarkCompetitors: compsetAudit[key]?.used ?? [],
        },
      ];
    }),
  );

  const resortStatic = outletShares.resort;
  const resortLive = {
    ...resortStatic,
    activeMonth: marketSize.sanghyang.actual
      ? monthLabel(marketSize.sanghyang.actual.month)
      : resortStatic.activeMonth,
    totalMarketSizeEstimated: marketSize.marketCapMonthly,
    marketSharePercentage: marketSize.sanghyang.actual?.share ?? marketSize.sanghyang.estimatedShare,
    marketRank: marketSize.sanghyang.rank ? `#${marketSize.sanghyang.rank} dari ${marketSize.sanghyang.rankOf} resort yang dihitung` : 'Belum ada data',
  };

  const activeMonths = OUTLET_KEYS.map((k) => internalSignals?.[k]?.performance?.month).filter((m): m is string => Boolean(m));
  const latestMonth = activeMonths.sort().at(-1) ?? marketSize.sanghyang.actual?.month ?? null;
  const sameMonthCount = latestMonth ? activeMonths.filter((m) => m === latestMonth).length : 0;
  const consolidated = {
    ...withoutRevenueActual(ALL_OUTLETS_MARKET_SHARE_DATA),
    activeMonth: latestMonth
      ? `${monthLabel(latestMonth)}${sameMonthCount > 0 && sameMonthCount < OUTLET_KEYS.length ? ` (${sameMonthCount} dari ${OUTLET_KEYS.length} outlet)` : ''}`
      : ALL_OUTLETS_MARKET_SHARE_DATA.activeMonth,
    // Hanya pasar kamar yang bisa diperkirakan dari sumber resmi; outlet F&B belum punya data kapasitas & belanja.
    totalMarketSizeEstimated: marketSize.marketCapMonthly,
    benchmarkCompetitors: compsetAudit.all.used,
  };

  return {
    ...summary,
    comparison,
    priceComparison: priceRows,
    marketRateComparison,
    marketRateHistory,
    nightlyHeartbeat,
    sanghyang: { rating: sanghyangRating, reviewCount: sanghyangReviewCount },
    outlets,
    comparisons,
    ownEvidence,
    actionFindings,
    executiveSummary,
    syncStatus,
    competitorSocialRadar: competitorOnlySocialRadar,
    ownPromos,
    outletAnalyses: Object.fromEntries(outletAnalysisMap.entries()),
    outletMarketShare: { ...outletShares, resort: resortLive, all: consolidated },
    internalSignals,
    marketSize,
    reviewShares,
    compsetAudit,
    competitorMatrix,
    competitorMenus,
    news,
    otaDirectory: {
      providers: otaDirectory.providers,
      reviewProviders: otaDirectory.reviewProviders,
      byHotel: otaDirectory.byHotel,
      reviewSourcesByHotel: otaDirectory.reviewSourcesByHotel,
    },
    range: { from: wibDay(range.from), to: wibDay(range.to), label: rangeLabel(range), custom: customRange !== null },
    competitorRatings: competitors
      .filter((c) => c.rating != null && !isSanghyangOutlet(c.name))
      .map((c) => ({ name: c.name, rating: Number(c.rating) })),
  };
}

export const GET = createSummaryGet();

/** Label sumber berita: akun TikTok/Instagram, nama penerbit Google News, atau merek yang disebut. */
function newsSourceLabel(x: { brand: string | null; article: { canonicalUrl: string | null; title: string } }): string {
  const url = x.article.canonicalUrl ?? '';
  if (url.includes('tiktok.com')) {
    const username = url.match(/@([^/?#]+)/);
    return username ? `TikTok @${username[1]}` : x.brand ? `TikTok ${x.brand}` : 'TikTok Trend';
  }
  if (url.includes('instagram.com')) {
    const account = url.match(/instagram\.com\/([^/?#]+)/);
    if (account && account[1] !== 'p' && account[1] !== 'reel') return `Instagram @${account[1]}`;
    return x.brand ?? 'Berita pasar';
  }
  if (url.includes('news.google.com')) {
    const publisher = x.article.title.match(/-\s*([^-\n]+)$/);
    return publisher ? publisher[1].trim() : x.brand ?? 'Berita pasar';
  }
  return x.brand ?? 'Berita pasar';
}

export function validateSummaryParams(period: string, segment: string, source: string | null) {
  return periods.has(period as SummaryPeriod) && segments.has(segment) && (source === null || (source.length > 0 && source.length <= 120));
}
