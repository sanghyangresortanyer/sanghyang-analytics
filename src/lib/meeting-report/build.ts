/**
 * Penyusun laporan PDF Insight Pasar Sanghyang (format ringkas 3 poin per outlet: ulasan, ringkasan kompetitor dan
 * harga, promo dan event). Data dimuat dari basis data dengan jalur yang sama seperti ringkasan web
 * (app/api/market-intelligence/summary/route.ts) supaya angka PDF sama dengan halaman Insight Pasar pada periode yang
 * sama. Tanpa bab profil kompetitor, tanpa bagian rekomendasi, tanpa kolom Audit pembanding, dan tanpa nama mesin AI
 * atau nama alat pengambil data.
 */
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { stripAiModelMentions, stripDisprovenFacilityClaims } from "../ai/market-analyst";
import { buildKnowledgeGraph } from "../knowledge-graph/build";
import { buildOutletKnowledgeContext } from "../knowledge-graph/context";
import { buildOutletCompetitorMatrices, type OutletCompetitorMatrix } from "../market/competitor-matrix";
import { loadCompsetAudit } from "../market/compset-audit";
import { COMPSET_MAX_ROAD_KM, isLodging, MIN_LODGING_STARS } from "../market/compset";
import { parseDayRange, presetRange, promoInRange, promoRangeWhere, wibDay, type DayRange, type RangePreset } from "../market/date-range";
import { loadDynamicHotelRoomTypes } from "../market/hotel-room-types";
import { loadResortMarketSize } from "../market/market-size";
import { dateLabel, rupiah } from "../market/menu-format";
import { OFFICIAL_MENU_SOURCE } from "../market/official-menu";
import { loadDynamicOtaDirectory } from "../market/ota-directory.server";
import { GUEST_REVIEWS_ONLY, OUTLET_KEYS, promoMatchesOutlet, type OutletKey } from "../market/outlet-filters";
import { OWN_OUTLETS } from "../market/outlet-ratings";
import { isOwnCompetitorName, OWN_TEAM_SOURCE } from "../market/own-promos";
import { loadPlaceSpecsMap } from "../market/place-specs";
import { OUTLET_MARKET_SHARE_DATA } from "../market/pricing-benchmark";
import { EXTRACTED_SOURCE } from "../market/promo-extractor";
import { promotionTypeLabel } from "../market/promo-type";
import {
  classifyPromoOrEvent,
  isPromoWithinRecencyWindow,
  mergePromoCaptures,
  NOT_PROMO_CATEGORY,
  OWN_SOCIAL_POST_CATEGORY,
  ownPromoSourceSummary,
  ownPromosForOutlet,
  platformOf,
  PROMO_MAX_AGE_DAYS,
  promoDayLabel,
  RAW_COMPETITOR_SOCIAL_CATEGORY,
  startDateWritten,
  type PromoPlatform,
} from "../market/promo-radar";
import { loadHotelVenues } from "../market/promo-venues";
import { byText, newestFirst } from "../market/stable-order";
import { loadDynamicCompetitorMenuItems } from "../market/refresh-competitor-menus";
import { isVerifiedReviewSource } from "../market/resort-strategy";
import { outletSentiment, visibleThemes } from "../market/review-outlet-tagger";
import { WEBSITE_SOURCE } from "../market/website-promos";
import { COMPARABLE_RATE_WHERE } from "../market/rate-basis";
import {
  countSentiments,
  matrixTableFromCompetitorMatrix,
  normalizeCheckedDates,
  previousPeriodMeta,
  promoDisplayTitle,
  scrubToolMentions,
  splitReviewQuotes,
  uniqueSources,
  type PlaceReview,
} from "./sections";
import {
  NO_DATA,
  type MeetingReport,
  type OutletReportBody,
  type ReportChapter,
  type ReportKpiCard,
  type ReportMatrix,
  type ReportPromoEntry,
  type SentimentCounts,
} from "./types";

/** Batas cetak per kelompok promo/event supaya laporan tetap ringkas; sisanya disebut jumlahnya dan lengkap di web. */
const MAX_PROMOS_PER_GROUP = 10;
/** Sama dengan batas unggahan mentah kompetitor yang ditampilkan ringkasan web (DISCOVERED_POSTS_LIMIT). */
const DISCOVERED_POSTS_LIMIT = 80;
const ALL_OUTLETS_LABEL = "Semua Outlet";

const outletLabel = (key: string) => (OUTLET_MARKET_SHARE_DATA[key]?.outletName ?? key).replace(/\s*\(.*\)$/, "");
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDay = (d: Date) => promoDayLabel(d, null);

/** Ganti satu kata sambil mempertahankan bentuk hurufnya (PESAING -> KOMPETITOR, Pesaing -> Kompetitor). */
function replaceWord(text: string, pattern: RegExp, replacement: string): string {
  return text.replace(pattern, (word) => {
    if (word === word.toUpperCase()) return replacement.toUpperCase();
    if (word[0] === word[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
  });
}

/**
 * Pembersih setiap teks yang dicetak: tanpa nama mesin AI, tanpa nama alat atau berkas internal, tanggal pemeriksaan
 * "terakhir diperiksa DD Mmm YYYY", dan istilah awam pemilik (pesaing -> kompetitor, registri -> daftar kompetitor).
 */
export function printText(text: string | null | undefined): string {
  if (!text) return "";
  let out = normalizeCheckedDates(scrubToolMentions(stripAiModelMentions(text)));
  out = replaceWord(out, /\bregistri\s+(?:pembanding|pesaing|kompetitor)\b/gi, "daftar kompetitor");
  out = replaceWord(out, /\bregistri\b/gi, "daftar kompetitor");
  out = replaceWord(out, /\bpesaing\b/gi, "kompetitor");
  return out
    .replace(/\(\s*,?\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * printText ditambah penyaring klaim fasilitas Sanghyang yang dibantah situs resmi (belerang, pasir putih, dll.). Dipakai
 * untuk teks bebas (ulasan, catatan, narasi) dan baris Sanghyang; label terstruktur kompetitor cukup printText supaya
 * fakta kompetitor tidak ikut terhapus.
 */
export function sanitizeReportText(text: string | null | undefined): string {
  return text ? printText(stripDisprovenFacilityClaims(text)) : "";
}

/** Label sumber sama dengan lencana kartu promo web (sourceBadgeLabel); tautannya tetap ke postingan atau halaman asli. */
const PLATFORM_LABEL: Record<PromoPlatform, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", website: "Situs resmi" };

const COMPSET_RULE = `sejenis, paling jauh ${COMPSET_MAX_ROAD_KM} km jarak tempuh, penginapan minimal bintang ${MIN_LODGING_STARS}`;
const COMPSET_SELECTION = "Kompetitor dipilih menyeluruh dari konsep, produk, fasilitas, harga, reputasi, dan jarak; yang tidak lolos diarsipkan.";
const OFFICIAL_MENU_READ = promoDayLabel(new Date(`${OFFICIAL_MENU_SOURCE.capturedAt}T00:00:00+07:00`), null);

/**
 * Batas cetak dibagi bergiliran antar-tempat supaya satu tempat dengan banyak penawaran (mis. sembilan kartu situs
 * resmi) tidak menutupi tempat lain; urutan kelompok per tempat dipertahankan.
 */
function pickBalanced(list: ReportPromoEntry[], max: number): ReportPromoEntry[] {
  const queues = new Map<string, ReportPromoEntry[]>();
  for (const p of list) queues.set(p.competitorName, [...(queues.get(p.competitorName) ?? []), p]);
  const picked = new Set<ReportPromoEntry>();
  for (let round = 0; picked.size < max && [...queues.values()].some((q) => q.length > round); round++) {
    for (const q of queues.values()) if (picked.size < max && q[round]) picked.add(q[round]);
  }
  return list.filter((p) => picked.has(p));
}

/** Kategori penyimpanan unggahan sosmed bukan kategori acara, jadi dicetak sebagai jenis sumbernya. */
const printCategory = (category: string) =>
  category === OWN_SOCIAL_POST_CATEGORY || category === RAW_COMPETITOR_SOCIAL_CATEGORY ? "Media sosial" : category;

function resolveActiveRange(now: Date, options?: BuildMeetingReportOptions): { range: DayRange; label: string; isCustom: boolean } {
  const custom = parseDayRange(options?.from ?? null, options?.to ?? null);
  if (custom === "invalid") throw new Error(`Rentang tanggal laporan tidak sah: ${options?.from ?? "-"} s.d. ${options?.to ?? "-"}`);
  if (custom) {
    const label =
      options!.from === options!.to ? dateLabel(options!.from!) : `${dateLabel(options!.from!)} – ${dateLabel(options!.to!)}`;
    return { range: custom, label, isCustom: true };
  }
  const preset: RangePreset = options?.period === "90d" || options?.period === "year" ? options.period : "30d";
  const range = presetRange(preset, now);
  return { range, label: `${dateLabel(wibDay(range.from))} – ${dateLabel(wibDay(range.to))}`, isCustom: false };
}

/**
 * Saringan basis data promo dan event laporan: prefilter rentang yang sama dengan ringkasan web (promoRangeWhere), lalu
 * baris yang memang tidak pernah dicetak. Batas lama "akhir periode − 120 hari" membuang penawaran tanpa tanggal yang
 * tertangkap lebih awal tetapi masih berjalan di periode, padahal web menampilkannya.
 */
export function reportPromoWhere(range: DayRange): Prisma.CompetitorPromotionWhereInput {
  return {
    AND: [promoRangeWhere(range), { category: { not: NOT_PROMO_CATEGORY }, source: { not: OWN_TEAM_SOURCE }, competitor: { active: true } }],
  };
}

/** Kata tanggal sama dengan kartu promo web (promoDateText): tanggal tertulis, "Berlaku s.d.", atau tanggal dibaca. */
function formatPromoDate(p: { startsAt: Date; endsAt: Date | null; capturedAt: Date }): string {
  if (startDateWritten(p)) return promoDayLabel(p.startsAt, p.endsAt);
  return p.endsAt ? `Berlaku s.d. ${shortDay(p.endsAt)}` : `Tanpa tanggal tertulis (dibaca ${shortDay(p.startsAt)})`;
}

const sentimentText = (c: SentimentCounts) =>
  `${c.total} (${c.positive} positif${c.neutral > 0 ? `, ${c.neutral} netral` : ""}, ${c.negative} negatif)`;

export interface BuildMeetingReportOptions {
  from?: string;
  to?: string;
  period?: string;
}

export async function buildMeetingReport(
  outlet: OutletKey | "all",
  now = new Date(),
  options?: BuildMeetingReportOptions,
): Promise<MeetingReport> {
  const { range: activeRange, label: periodLabel, isCustom } = resolveActiveRange(now, options);
  const prevMeta = previousPeriodMeta(activeRange);
  const prevRange = prevMeta.range;

  const targetKeys: OutletKey[] = outlet === "all" ? [...OUTLET_KEYS] : [outlet];
  const ownNameByOutlet = new Map(OWN_OUTLETS.map((o) => [o.outletKey as OutletKey, o.competitorName]));
  const ownNamesList = OWN_OUTLETS.map((o) => o.competitorName);

  const [marketSize, otaDirectory, roomTypesMap, specsMap, dynamicMenusMap, venuesByHotel, kgGraph, ownRegistryRows, periodPriceSnapshots] =
    await Promise.all([
      loadResortMarketSize(),
      loadDynamicOtaDirectory(),
      loadDynamicHotelRoomTypes(),
      loadPlaceSpecsMap(),
      loadDynamicCompetitorMenuItems(),
      loadHotelVenues(),
      buildKnowledgeGraph(activeRange),
      db.competitor.findMany({
        where: { name: { in: ownNamesList } },
        select: { id: true, name: true, rating: true, reviewCount: true, googleMapsUrl: true, mapsUrl: true, instagramUrl: true, tiktokUrl: true },
      }),
      // Tarif kamar: snapshot yang diamati dalam periode, persis seperti ringkasan web.
      targetKeys.includes("resort")
        ? db.competitorPriceSnapshot.findMany({
            where: { observedAt: { gte: activeRange.from, lte: activeRange.to }, ...COMPARABLE_RATE_WHERE },
            select: { competitorId: true, roomName: true, packageName: true, price: true, checkIn: true, source: true, sourceUrl: true, observedAt: true },
            orderBy: [{ observedAt: "desc" }, { roomName: "asc" }, { packageName: "asc" }, { checkIn: "asc" }, { source: "asc" }],
          })
        : Promise.resolve([]),
    ]);

  const compsetAudit = await loadCompsetAudit(marketSize, { roomTypesMap, specsMap, dynamicMenusMap });
  // Sama dengan summary route (keputusan C15, 21 Nov 2026): tarif dan catatan jendela tarif mengikuti periode terpilih.
  const matrices = await buildOutletCompetitorMatrices({
    outlets: targetKeys,
    from: activeRange.from,
    to: activeRange.to,
    marketSize,
    compsetAudit,
    roomTypesMap,
    specsMap,
    dynamicMenusMap,
    priceSnapshots: periodPriceSnapshots.length > 0 ? periodPriceSnapshots : undefined,
  });

  const ownByName = new Map(ownRegistryRows.map((r) => [r.name, r]));
  const ownIds = ownRegistryRows.map((r) => r.id);
  const ownIdSet = new Set(ownIds);

  const [ownReviewRows, rawPromoRows, ownSocialPosts] = await Promise.all([
    // Hanya periode terpilih dan periode pembanding; ulasan di luar keduanya tidak pernah dicetak.
    db.competitorReview.findMany({
      where: { competitorId: { in: ownIds }, archivedAt: null, reviewDate: { gte: prevRange.from, lte: activeRange.to }, ...GUEST_REVIEWS_ONLY },
      select: { competitorId: true, rating: true, sentiment: true, text: true, source: true, sourceUrl: true, reviewDate: true, capturedAt: true, themes: true },
    }),
    db.competitorPromotion.findMany({
      where: reportPromoWhere(activeRange),
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
        promotionType: true,
        details: true,
        terms: true,
        competitor: { select: { id: true, name: true, active: true, outlets: true, category: true } },
      },
    }),
    db.competitorPromotion.findMany({
      where: { competitorId: { in: ownIds }, category: OWN_SOCIAL_POST_CATEGORY },
      select: { competitorId: true, startsAt: true },
    }),
  ]);

  const verifyHosts = otaDirectory.reviewHosts.length ? otaDirectory.reviewHosts : otaDirectory.hosts;
  // Tanggal ulasan relatif ("1 minggu lalu") dihitung saat dibaca, jadi banyak ulasan bertanggal sama persis dan keluar dari
  // DB dalam urutan bebas. Kutipan (empat pertama per sisi) dan tema teratas diambil dari urutan ini, jadi urutannya tetap.
  const verifiedOwnReviews = [...ownReviewRows]
    .sort(
      (a, b) =>
        newestFirst(a.reviewDate, b.reviewDate) ||
        newestFirst(a.capturedAt, b.capturedAt) ||
        byText(a.source, b.source) ||
        byText(a.sourceUrl, b.sourceUrl) ||
        byText(a.text, b.text),
    )
    .filter((r) => isVerifiedReviewSource(r.sourceUrl, verifyHosts));

  // Promo dan event mengikuti saringan ringkasan web: berlaku atau diumumkan di dalam periode, paling tua 90 hari,
  // unggahan mentah kompetitor hanya yang masih baru (maks. 80 terbaru) kecuali sudah dibaca pembaca promo, lalu
  // klasifikasi promo/event bersama. Periode kustom tetap menampilkan promo yang kini sudah berakhir.
  const readByExtractor = (p: { source: string | null; sourceUrl: string | null }) =>
    (p.source === EXTRACTED_SOURCE || p.source === WEBSITE_SOURCE) && Boolean(p.sourceUrl);
  const mergedPromos = mergePromoCaptures(
    rawPromoRows.filter((p) => promoInRange(p, activeRange, now) && isPromoWithinRecencyWindow(p, activeRange.to, PROMO_MAX_AGE_DAYS)),
  ).filter((p) => isPromoWithinRecencyWindow(p, activeRange.to, PROMO_MAX_AGE_DAYS));
  const discoveredIds = new Set(
    mergedPromos
      .filter((p) => p.category === RAW_COMPETITOR_SOCIAL_CATEGORY && p.status === "new")
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .slice(0, DISCOVERED_POSTS_LIMIT)
      .map((p) => p.id),
  );
  const radarPromos = mergedPromos.flatMap((p) => {
    const isRawPost = p.category === RAW_COMPETITOR_SOCIAL_CATEGORY && !readByExtractor(p);
    if (isRawPost && !discoveredIds.has(p.id)) return [];
    // Unggahan mentah dinilai dari judulnya saja, tanpa harga/diskon tebakan, seperti kartu "unggahan baru" di web.
    const kind = classifyPromoOrEvent(isRawPost ? { ...p, price: null, discount: null, kind: null, details: [], terms: [] } : p);
    if (!kind) return [];
    const expired = !isRawPost && (p.status === "expired" || (p.endsAt !== null && p.endsAt < now));
    if (expired && !isCustom) return [];
    return [{ ...p, classifiedKind: kind }];
  });

  const toPromoEntry = (p: (typeof radarPromos)[number]): ReportPromoEntry => {
    const isOwn = isOwnCompetitorName(p.competitor.name);
    // Penyaring klaim fasilitas yang dibantah hanya untuk unggahan Sanghyang sendiri; judul kompetitor dicetak apa adanya.
    const clean = isOwn ? sanitizeReportText : printText;
    const platform = platformOf(p.sourceUrl);
    const sourceLabel = platform ? PLATFORM_LABEL[platform] : sanitizeReportText(p.source) || "Sumber publik terverifikasi";
    const priceNum = p.price != null ? Number(p.price) : null;
    const discountNum = p.discount != null ? Number(p.discount) : null;
    return {
      competitorName: p.competitor.name,
      isOwn,
      title: clean(promoDisplayTitle({ title: p.title, description: p.description, kind: p.classifiedKind })) || NO_DATA,
      kind: p.classifiedKind,
      category: p.category,
      categoryLabel: printCategory(p.category),
      promotionType: p.promotionType,
      promotionTypeLabel: promotionTypeLabel(p.promotionType),
      dateLabel: formatPromoDate(p),
      priceText: priceNum && Number.isFinite(priceNum) ? rupiah(priceNum) : null,
      discount: discountNum && Number.isFinite(discountNum) ? discountNum : null,
      sourceLabel,
      sourceUrl: p.sourceUrl ?? null,
      platform: platform ?? "website",
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt ? p.endsAt.toISOString() : null,
      capturedAt: p.capturedAt.toISOString(),
    };
  };

  /** Kompetitor dengan butir terbanyak lebih dulu, lalu butir terbaru, seperti pengelompokan kartu web. */
  const byCompetitor = (list: ReportPromoEntry[]): ReportPromoEntry[] => {
    const count = new Map<string, number>();
    for (const p of list) count.set(p.competitorName, (count.get(p.competitorName) ?? 0) + 1);
    return [...list].sort(
      (a, b) =>
        (count.get(b.competitorName) ?? 0) - (count.get(a.competitorName) ?? 0) ||
        a.competitorName.localeCompare(b.competitorName) ||
        b.startsAt.localeCompare(a.startsAt),
    );
  };

  const buildOutletBody = async (key: OutletKey): Promise<OutletReportBody> => {
    const label = outletLabel(key);
    const ownName = ownNameByOutlet.get(key) ?? "";
    const ownRow = ownByName.get(ownName);
    const cm: OutletCompetitorMatrix = matrices[key];

    const outletReviewsAll: PlaceReview[] = verifiedOwnReviews
      .filter((r) => (ownRow && r.competitorId === ownRow.id) || (ownIdSet.has(r.competitorId) && r.themes.includes(key)))
      .map((r) => ({
        rating: Number(r.rating),
        sentiment: ownRow && r.competitorId === ownRow.id ? r.sentiment : (outletSentiment(r.themes, key) ?? r.sentiment),
        text: sanitizeReportText(r.text),
        source: printText(r.source) || NO_DATA,
        sourceUrl: r.sourceUrl,
        reviewDate: r.reviewDate.toISOString(),
        themes: visibleThemes(r.themes).filter((t) => !OUTLET_KEYS.includes(t as OutletKey)),
      }));
    const within = (r: PlaceReview, range: DayRange) => {
      const t = Date.parse(r.reviewDate);
      return t >= range.from.getTime() && t <= range.to.getTime();
    };
    const currentRevs = outletReviewsAll.filter((r) => within(r, activeRange));
    const prevRevs = outletReviewsAll.filter((r) => within(r, prevRange));
    const currentCounts = countSentiments(currentRevs);
    const prevCounts = countSentiments(prevRevs);
    const { praises, complaints } = splitReviewQuotes(currentRevs, 4);

    const themeFreq = new Map<string, number>();
    for (const r of currentRevs) for (const t of r.themes) themeFreq.set(t, (themeFreq.get(t) ?? 0) + 1);
    const topThemes = [...themeFreq.entries()]
      .sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
      .slice(0, 5)
      .map(([theme, count]) => ({ theme, count }));

    const kgCtx = buildOutletKnowledgeContext(kgGraph, key, periodLabel);
    const ownSocialForOutlet = ownRow ? ownSocialPosts.filter((p) => p.competitorId === ownRow.id) : [];
    const ownSocialInPeriod = ownSocialForOutlet.filter((p) => p.startsAt >= activeRange.from && p.startsAt <= activeRange.to);
    const socialAccounts = kgCtx.sanghyang?.social.accounts.length
      ? kgCtx.sanghyang.social.accounts.map(sanitizeReportText).filter(Boolean)
      : [
          ownRow?.instagramUrl ? `@${ownRow.instagramUrl.match(/instagram\.com\/([^/?]+)/)?.[1] ?? ""}` : "",
          ownRow?.tiktokUrl ? `@${ownRow.tiktokUrl.match(/tiktok\.com\/@([^/?]+)/)?.[1] ?? ""}` : "",
        ].filter((a) => a.length > 1);
    const socialStatus = {
      accounts: socialAccounts,
      followersText: sanitizeReportText(kgCtx.sanghyang?.social.followersText) || null,
      postsInPeriod: ownSocialInPeriod.length,
      totalPostsRecorded: ownSocialForOutlet.length,
      likesText: sanitizeReportText(kgCtx.sanghyang?.social.likesText) || null,
      note:
        ownSocialForOutlet.length > 0
          ? `${ownSocialInPeriod.length} unggahan resmi Sanghyang pada periode terpilih (${ownSocialForOutlet.length} total terarsip).`
          : "Belum ada unggahan media sosial resmi khusus outlet ini yang tercatat di arsip.",
    };

    const reviewSources = uniqueSources([
      ownRow?.googleMapsUrl || ownRow?.mapsUrl ? { label: `Google Maps: ${ownName}`, url: ownRow.googleMapsUrl ?? ownRow.mapsUrl } : null,
      ...[...praises, ...complaints].map((r) => ({ label: `Ulasan ${r.source}`, url: r.sourceUrl })),
    ]);

    const entryCount = cm.kind === "resort" ? (cm.hotelEntries?.length ?? 0) : (cm.fnbEntries?.length ?? 0);
    const ownMenuCount = cm.fnbEntries?.[0]?.menuItemCount ?? 0;
    // Dasar data tabel 2 ditulis di pengantarnya, bukan di bagian metodologi terpisah, supaya laporan satu outlet muat
    // 3 halaman A4 (papan tulis pemilik).
    const intro =
      cm.kind === "resort"
        ? `Posisi Sanghyang dan kompetitor: jumlah tipe kamar, rentang luas (m², situs resmi hotel didahulukan dibanding OTA), tarif kamar hari biasa dan akhir pekan (situs resmi dan OTA termurah), rating Google, serta fasilitas utama. ${COMPSET_SELECTION}`
        : [
            "Posisi harga menu, fasilitas, dan suasana kompetitor terhadap outlet Sanghyang.",
            ownMenuCount > 0 ? `Menu Sanghyang dari ${OFFICIAL_MENU_SOURCE.title} (dibaca ${OFFICIAL_MENU_READ}).` : null,
            "Menu kompetitor dari situs resmi, toko daring, dan foto menu Google Maps terverifikasi.",
            COMPSET_SELECTION,
          ]
            .filter(Boolean)
            .join(" ");
    const reportMatrix: ReportMatrix = {
      title: `Ringkasan Kompetitor: ${label} (${entryCount} tempat)`,
      intro: sanitizeReportText(intro),
      table: matrixTableFromCompetitorMatrix(cm),
      note: sanitizeReportText(cm.note),
      ratesWindowNote: cm.ratesWindowNote ? sanitizeReportText(cm.ratesWindowNote) : undefined,
      competitorMatrix: cm,
    };

    // Promo Sanghyang dibaca dari outlet baris daftarnya (ownPromosForOutlet, sama dengan web); kompetitor lewat pencocokan outlet bersama.
    const ownMatched = ownPromosForOutlet(
      radarPromos.filter((p) => isOwnCompetitorName(p.competitor.name)).map((p) => ({ ...p, competitorOutlets: p.competitor.outlets })),
      key,
    ).map(toPromoEntry);
    const competitorMatched = byCompetitor(
      radarPromos
        .filter(
          (p) =>
            !isOwnCompetitorName(p.competitor.name) &&
            promoMatchesOutlet(
              {
                competitorName: p.competitor.name,
                category: p.category,
                title: p.title,
                competitorOutlets: p.competitor.outlets,
                competitorIsLodging: isLodging(p.competitor.category),
                competitorVenues: venuesByHotel.get(p.competitorId) ?? [],
              },
              key,
            ),
        )
        .map(toPromoEntry),
    );
    const split = (list: ReportPromoEntry[], kind: "promo" | "event") => {
      const all = list.filter((p) => p.kind === kind);
      const shown = pickBalanced(all, MAX_PROMOS_PER_GROUP);
      return { shown, omitted: all.length - shown.length };
    };
    const ownPromos = split(ownMatched, "promo");
    const ownEvents = split(ownMatched, "event");
    const competitorPromos = split(competitorMatched, "promo");
    const competitorEvents = split(competitorMatched, "event");

    const ownRatingNum = ownRow?.rating != null ? Number(ownRow.rating) : null;
    let priceKpi: ReportKpiCard;
    if (key === "resort") {
      const shEntry = cm.hotelEntries?.[0];
      const shMarket = marketSize.rows.find((r) => r.hotelId === "sanghyang");
      priceKpi = {
        label: "Tarif Kamar Sanghyang",
        value: shEntry?.otaRateLabel ?? NO_DATA,
        sub: shMarket?.adr
          ? `Terbobot ${rupiah(Math.round(shMarket.adr))}/mlm · ${shEntry?.roomTypes.length ?? 0} tipe kamar`
          : `${shEntry?.roomTypes.length ?? 0} tipe kamar terverifikasi`,
      };
    } else {
      const shFnb = cm.fnbEntries?.[0];
      const rivals = (cm.fnbEntries ?? []).slice(1);
      priceKpi = {
        label: "Menu Resmi & Kompetitor",
        value: shFnb?.menuRangeLabel ?? NO_DATA,
        sub: `${shFnb?.menuItemCount ?? 0} menu resmi · ${rivals.filter((e) => e.menuItemCount > 0).length}/${rivals.length} kompetitor berharga item`,
      };
    }
    const ownOfferCount = ownPromos.shown.length + ownPromos.omitted + ownEvents.shown.length + ownEvents.omitted;
    const rivalOfferCount =
      competitorPromos.shown.length + competitorPromos.omitted + competitorEvents.shown.length + competitorEvents.omitted;
    const kpis: ReportKpiCard[] = [
      {
        label: "Rating Google",
        value: ownRatingNum !== null ? `${ownRatingNum.toLocaleString("id-ID")} ★` : NO_DATA,
        sub: ownRow?.reviewCount != null ? `${ownRow.reviewCount.toLocaleString("id-ID")} ulasan Google Maps` : "Listing Google Maps",
      },
      {
        label: "Ulasan Periode Terpilih",
        value: `${currentCounts.total} ulasan`,
        sub: `${currentCounts.positive} positif · ${currentCounts.negative} negatif · ${prevMeta.title}: ${prevCounts.total} ulasan`,
      },
      priceKpi,
      {
        label: "Promo & Event Berjalan",
        value: `${ownOfferCount} Sanghyang · ${rivalOfferCount} Kompetitor`,
        sub: `Berlaku dalam periode, maks. ${PROMO_MAX_AGE_DAYS} hari terakhir`,
      },
    ];

    return {
      outletKey: key,
      outletName: label,
      periodLabel,
      previousPeriodTitle: prevMeta.title,
      previousPeriodLabel: prevMeta.dateRangeLabel,
      previousPeriodCompactLabel: prevMeta.compactLabel,
      kpis,
      reviews: {
        periodLabel,
        periodDays: prevMeta.days,
        previousPeriodTitle: prevMeta.title,
        previousPeriodLabel: prevMeta.dateRangeLabel,
        previousPeriodCompactLabel: prevMeta.compactLabel,
        current: currentCounts,
        previous: prevCounts,
        praises,
        complaints,
        topThemes,
        socialStatus,
        sources: reviewSources,
      },
      matrix: reportMatrix,
      promos: {
        maxAgeDays: PROMO_MAX_AGE_DAYS,
        ownPromos: ownPromos.shown,
        ownEvents: ownEvents.shown,
        competitorPromos: competitorPromos.shown,
        competitorEvents: competitorEvents.shown,
        omitted: {
          ownPromos: ownPromos.omitted,
          ownEvents: ownEvents.omitted,
          competitorPromos: competitorPromos.omitted,
          competitorEvents: competitorEvents.omitted,
        },
        ownSourceSummary: ownPromoSourceSummary(ownMatched),
        note: `Hanya promo dan event publik yang berlaku atau diumumkan dalam periode terpilih, paling lama ${PROMO_MAX_AGE_DAYS} hari terakhir, termasuk penawaran situs resmi yang aktif tanpa tanggal tertulis. Unggahan umum yang bukan promo atau event dan catatan internal tidak dicantumkan.`,
      },
    };
  };

  const publishedAt = now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  if (outlet === "all") {
    const methodologyItems = buildMethodology(
      marketSize.tpk ? { percent: marketSize.tpk.percent, period: monthLabel(marketSize.tpk.period) } : null,
    );
    const bodies = await Promise.all(OUTLET_KEYS.map((k) => buildOutletBody(k)));
    const chapters: ReportChapter[] = bodies.map((body, idx) => ({
      outletKey: body.outletKey,
      title: `Bab ${idx + 1}: ${body.outletName}`,
      intro: `Periode ${body.periodLabel} dibandingkan dengan ${body.previousPeriodCompactLabel}.`,
      matrix: body.matrix,
      body,
      sections: [],
    }));

    const withReference = OUTLET_KEYS.some((k) => compsetAudit[k].used.some((c) => c.compsetRole === "benchmark"));
    const overviewRows = bodies.map((b) => {
      const used = compsetAudit[b.outletKey].used;
      const ownRow = ownByName.get(ownNameByOutlet.get(b.outletKey) ?? "");
      const ownCount = b.promos.ownPromos.length + b.promos.omitted.ownPromos + b.promos.ownEvents.length + b.promos.omitted.ownEvents;
      const rivalCount =
        b.promos.competitorPromos.length + b.promos.omitted.competitorPromos + b.promos.competitorEvents.length + b.promos.omitted.competitorEvents;
      return [
        b.outletName,
        ownRow?.rating != null
          ? `${Number(ownRow.rating).toLocaleString("id-ID")} (${ownRow.reviewCount?.toLocaleString("id-ID") ?? NO_DATA} ulasan)`
          : NO_DATA,
        sentimentText(b.reviews.current),
        sentimentText(b.reviews.previous),
        String(used.filter((c) => c.compsetRole === "inti").length),
        ...(withReference ? [String(used.filter((c) => c.compsetRole === "benchmark").length)] : []),
        `${ownCount} Sanghyang · ${rivalCount} Kompetitor`,
      ];
    });

    return {
      outletKey: "all",
      outletName: ALL_OUTLETS_LABEL,
      title: `Laporan Insight Pasar: ${ALL_OUTLETS_LABEL}`,
      subtitle: `Periode ${periodLabel} · dibanding ${prevMeta.compactLabel}`,
      publishedAt,
      periodLabel,
      previousPeriodTitle: prevMeta.title,
      previousPeriodLabel: prevMeta.dateRangeLabel,
      previousPeriodCompactLabel: prevMeta.compactLabel,
      from: options?.from,
      to: options?.to,
      coverage: OUTLET_KEYS.map(outletLabel),
      methodology: methodologyItems,
      structure: [
        `Ringkasan Kompetitor: ${ALL_OUTLETS_LABEL}`,
        ...chapters.map((c) => `${c.title} (Ulasan, Ringkasan Kompetitor, Promo & Event)`),
      ],
      matrix: {
        title: `Ringkasan Kompetitor: ${ALL_OUTLETS_LABEL}`,
        intro: `Reputasi, ulasan periode terpilih dibanding ${prevMeta.title.toLowerCase()}, jumlah kompetitor, serta promo dan event yang berlaku dalam periode.`,
        table: {
          head: [
            "Outlet",
            "Rating Google",
            "Ulasan Periode Terpilih",
            `Ulasan ${prevMeta.title}`,
            "Kompetitor Inti",
            ...(withReference ? ["Acuan"] : []),
            "Promo & Event",
          ],
          rows: overviewRows,
        },
        note: `Aturan daftar kompetitor: ${COMPSET_RULE}. Omset rupiah Sanghyang tidak dicetak.`,
      },
      sections: [],
      chapters,
    };
  }

  const body = await buildOutletBody(outlet);
  const cm = matrices[outlet];
  return {
    outletKey: outlet,
    outletName: body.outletName,
    title: `Laporan Insight Pasar: ${body.outletName}`,
    subtitle: `Periode ${periodLabel} · dibanding ${prevMeta.compactLabel}`,
    publishedAt,
    periodLabel,
    previousPeriodTitle: prevMeta.title,
    previousPeriodLabel: prevMeta.dateRangeLabel,
    previousPeriodCompactLabel: prevMeta.compactLabel,
    from: options?.from,
    to: options?.to,
    coverage: cm.kind === "resort" ? (cm.hotelEntries ?? []).map((e) => e.name) : (cm.fnbEntries ?? []).map((e) => e.name),
    // Laporan satu outlet memuat dasar datanya di pengantar dan catatan tiap tabel.
    methodology: [],
    structure: [
      `1. Ulasan Terbaru: Positif & Negatif (${prevMeta.title})`,
      `2. ${body.matrix.title}`,
      `3. Promo & Event Berjalan (Maks. ${PROMO_MAX_AGE_DAYS} Hari Terakhir)`,
    ],
    matrix: body.matrix,
    outletBody: body,
    sections: [],
    chapters: [],
  };
}

/** Metodologi ringkas halaman pertama laporan Semua Outlet. */
function buildMethodology(tpk: { percent: number; period: string } | null) {
  return [
    { label: "Daftar kompetitor", text: `${COMPSET_SELECTION} Jarak diukur dari Sanghyang menurut rute jalan.` },
    { label: "Tipe kamar", text: "spesifikasi dan luas (m²) mengutamakan situs resmi hotel dibanding OTA; jendela tanggal tarif tertulis di bawah tabel 2 Kamar & Resort." },
    ...(tpk ? [{ label: "BPS Banten", text: `TPK hotel bintang ${tpk.percent.toLocaleString("id-ID")}% (${tpk.period}).` }] : []),
    {
      label: "Menu",
      text: `menu Sanghyang dari ${OFFICIAL_MENU_SOURCE.title} (dibaca ${OFFICIAL_MENU_READ}); menu kompetitor dari situs resmi, toko daring, dan foto menu Google Maps terverifikasi.`,
    },
    { label: "Kejujuran data", text: "kolom tanpa sumber sah ditulis Belum ada data; omset rupiah Sanghyang tidak dicetak." },
  ].map((m) => ({ label: m.label, text: sanitizeReportText(m.text) }));
}
