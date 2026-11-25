import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { createSummaryGet } from "../../src/app/api/market-intelligence/summary/route";
const getSummary = createSummaryGet(async () => null);
import { reviewsForOwnOutlet, transformMarketSummary, type SummaryRow } from "../../src/lib/market/summary";
import { loadOwnEvidence, loadCompetitorEvidence } from "../../src/lib/market/competitor-comparison";
import { loadFnbCompareData } from "../../src/lib/market/fnb-compare-data";
import { mergePromoCaptures } from "../../src/lib/market/promo-radar";
import { buildKnowledgeGraph } from "../../src/lib/knowledge-graph/build";
import { buildOutletKnowledgeContext } from "../../src/lib/knowledge-graph/context";
import { synthesizeOutletAnalysis } from "../../src/lib/ai/market-analyst";
import { parseDayRange, presetRange, rangeLabel } from "../../src/lib/market/date-range";
import { OUTLET_KEYS, promosForOutlet } from "../../src/lib/market/outlet-filters";
import { OWN_COMPETITOR_NAMES, OWN_TEAM_SOURCE } from "../../src/lib/market/own-promos";
import { PROMO_MAX_AGE_DAYS } from "../../src/lib/market/promo-radar";

const sampleRows: SummaryRow[] = [
  {
    date: "2026-10-05T08:00:00Z",
    category: "Promotions",
    source: "Instagram",
    headline: "Promo Awal Oktober",
    relevance: "Diskon 20%",
    sentiment: "positive",
    activeFrom: "2026-10-05T08:00:00Z",
  },
  {
    date: "2026-10-15T10:00:00Z",
    category: "Reviews",
    source: "Google Travel",
    headline: "Ulasan Pertengahan Oktober",
    relevance: "Pelayanan ramah",
    sentiment: "positive",
    activeFrom: "2026-10-15T10:00:00Z",
  },
  {
    date: "2026-11-05T12:00:00Z",
    category: "Promotions",
    source: "Instagram",
    headline: "Promo November Awal",
    relevance: "Paket akhir pekan",
    sentiment: "positive",
    activeFrom: "2026-11-05T12:00:00Z",
  },
  {
    date: "2026-11-15T14:00:00Z",
    category: "Reviews",
    source: "Google Maps",
    headline: "Ulasan November Terkini",
    relevance: "Makanan lezat",
    sentiment: "neutral",
    activeFrom: "2026-11-15T14:00:00Z",
  },
];

test("filter periode kustom: transformMarketSummary menyaring baris hanya dalam jendela from/to", () => {
  const rangeOct = parseDayRange("2026-10-01", "2026-10-31");
  assert.ok(rangeOct && typeof rangeOct === "object");

  const summaryOct = transformMarketSummary({
    rows: sampleRows,
    competitors: 5,
    marketItems: 2,
    period: "30d",
    from: rangeOct.from,
    to: rangeOct.to,
    customRange: rangeOct,
  });

  // Hanya 2 item Oktober yang masuk
  assert.equal(summaryOct.recentRows.length, 2);
  assert.equal(summaryOct.counts.promotions, 1);
  assert.equal(summaryOct.counts.reviews, 1);
  const headlinesOct = summaryOct.recentRows.map((r) => r.headline);
  assert.ok(headlinesOct.includes("Promo Awal Oktober"));
  assert.ok(headlinesOct.includes("Ulasan Pertengahan Oktober"));
  assert.ok(!headlinesOct.includes("Promo November Awal"));
  assert.ok(!headlinesOct.includes("Ulasan November Terkini"));

  // Sekarang periode November
  const rangeNov = parseDayRange("2026-11-01", "2026-11-30");
  assert.ok(rangeNov && typeof rangeNov === "object");

  const summaryNov = transformMarketSummary({
    rows: sampleRows,
    competitors: 5,
    marketItems: 2,
    period: "30d",
    from: rangeNov.from,
    to: rangeNov.to,
    customRange: rangeNov,
  });

  // Hanya 2 item November yang masuk
  assert.equal(summaryNov.recentRows.length, 2);
  assert.equal(summaryNov.counts.promotions, 1);
  assert.equal(summaryNov.counts.reviews, 1);
  const headlinesNov = summaryNov.recentRows.map((r) => r.headline);
  assert.ok(headlinesNov.includes("Promo November Awal"));
  assert.ok(headlinesNov.includes("Ulasan November Terkini"));
  assert.ok(!headlinesNov.includes("Promo Awal Oktober"));
  assert.ok(!headlinesNov.includes("Ulasan Pertengahan Oktober"));
});

test("isolasi ulasan: ulasan kompetitor dilarang bocor ke ulasan outlet Sanghyang", () => {
  const ownOutletIds = new Set(["sanghyang-sunset-grill-id", "sanghyang-resort-id"]);
  const outletKey = "sunset-grill";
  const outletId = "sanghyang-sunset-grill-id";

  const rawReviews = [
    // Ulasan asli milik Sanghyang Sunset Grill
    {
      id: "rev-own-1",
      competitorId: "sanghyang-sunset-grill-id",
      themes: ["sunset-grill", "seafood"],
      rating: 5,
      source: "Google Maps",
      sentiment: "positive",
      text: "Ikan bakar lezat di Sunset Grill",
    },
    // Ulasan resort Sanghyang yang menyebut tema sunset-grill
    {
      id: "rev-own-2",
      competitorId: "sanghyang-resort-id",
      themes: ["sunset-grill", "sarapan"],
      rating: 4,
      source: "Google Travel",
      sentiment: "positive",
      text: "Sarapan di resto tepi pantai",
    },
    // Ulasan KOMPETITOR (Aston) yang menyebut tema sunset-grill (DILARANG BOCOR!)
    {
      id: "rev-competitor-leak",
      competitorId: "competitor-aston-id",
      themes: ["sunset-grill", "pantai"],
      rating: 1,
      source: "TikTok",
      sentiment: "negative",
      text: "Pelayanan di resto kompetitor lambat",
    },
  ];

  // Aturan yang sama dengan summary route (lib/market/summary.ts reviewsForOwnOutlet).
  const filteredOutletReviews = reviewsForOwnOutlet(
    rawReviews.map((r) => ({ ...r, sourceUrl: null })),
    { id: outletId, key: outletKey },
    ownOutletIds,
  );

  assert.equal(filteredOutletReviews.length, 2);
  assert.ok(filteredOutletReviews.some((r) => r.id === "rev-own-1"));
  assert.ok(filteredOutletReviews.some((r) => r.id === "rev-own-2"));
  assert.ok(!filteredOutletReviews.some((r) => r.id === "rev-competitor-leak"));
});

test("integrasi fasilitas: loadOwnEvidence dan loadCompetitorEvidence memuat spesifikasi fasilitas asli", async () => {
  const [ownEvidence, competitorEvidence] = await Promise.all([
    loadOwnEvidence(),
    loadCompetitorEvidence(),
  ]);

  // Seluruh 6 outlet Sanghyang tersedia di ownEvidence
  const ownKeys = Object.keys(ownEvidence);
  assert.equal(ownKeys.length, 6);
  assert.ok(ownKeys.includes("resort"));
  assert.ok(ownKeys.includes("sunset-grill"));
  assert.ok(ownKeys.includes("dragon-beach-club"));
  assert.ok(ownKeys.includes("dbar"));
  assert.ok(ownKeys.includes("dspa"));
  assert.ok(ownKeys.includes("dbistro"));

  // Resort memuat spesifikasi fasilitas air panas alami dan ukuran kamar
  const resortEvidence = ownEvidence.resort;
  assert.ok(resortEvidence);
  assert.ok(resortEvidence.specs);
  assert.equal(resortEvidence.specs?.facilities.hotSpring, true);
  assert.ok(resortEvidence.specs?.facilities.roomSizeRangeLabel);

  // Competitor evidence menyertakan spesifikasi fasilitas
  assert.ok(competitorEvidence.length > 0);
  const withSpecs = competitorEvidence.filter((c) => c.specs !== null && c.specs !== undefined);
  assert.ok(withSpecs.length > 0);
});

test("integrasi F&B: loadFnbCompareData menyertakan spesifikasi fasilitas Sanghyang dan pesaing", async () => {
  const fnbData = await loadFnbCompareData("sunset-grill");
  assert.equal(fnbData.outlet, "sunset-grill");
  assert.ok(fnbData.sanghyangSpecs, "sanghyangSpecs harus ada");
  assert.equal(fnbData.sanghyangSpecs?.name, "Sunset Grill (Sanghyang)");
  assert.equal(fnbData.sanghyangSpecs?.isSanghyang, true);

  // Rivals membawa spesifikasi fasilitas masing-masing
  const rivalNames = Object.keys(fnbData.rivals);
  assert.ok(rivalNames.length > 0);
  const rivalWithSpecs = rivalNames.filter((name) => fnbData.rivals[name].specs !== null);
  assert.ok(rivalWithSpecs.length > 0);
});

test("penayangan promo Sanghyang: mergePromoCaptures mempertahankan promo Sanghyang berjalan", () => {
  const dummyPromos = [
    {
      id: "promo-sanghyang-offers",
      competitorId: "sanghyang-comp-id",
      title: "Weekend Getaway 365K",
      category: "Kamar & Menginap",
      description: "Penawaran akhir pekan di Sanghyang",
      startsAt: new Date("2026-11-01"),
      endsAt: new Date("2026-11-30"),
      price: 365000,
      originalPrice: null,
      discount: null,
      source: "Situs resmi Sanghyang (penawaran)",
      sourceUrl: "https://sanghyang.com/offers",
      imageUrl: null,
      capturedAt: new Date("2026-11-15"),
      status: "active",
      kind: "promo" as const,
      details: ["Termasuk sarapan"],
      terms: ["Non-refundable"],
      competitor: {
        name: "Sanghyang Indah Spa Resort",
        instagramUrl: "https://instagram.com/sanghyangresort",
        tiktokUrl: null,
        websiteUrl: "https://sanghyang.com",
        googleMapsUrl: null,
        active: true,
        outlets: ["resort"],
        category: "resort",
        compsetRole: null,
        roadKm: 0,
      },
    },
    {
      id: "promo-competitor-mambruk",
      competitorId: "mambruk-id",
      title: "Seafood Saturday",
      category: "F&B & Kuliner",
      description: "Buffet seafood malam minggu",
      startsAt: new Date("2026-11-01"),
      endsAt: new Date("2026-11-30"),
      price: 250000,
      originalPrice: null,
      discount: null,
      source: "Instagram",
      sourceUrl: "https://instagram.com/p/mambruk1",
      imageUrl: null,
      capturedAt: new Date("2026-11-15"),
      status: "active",
      kind: "promo" as const,
      details: [],
      terms: [],
      competitor: {
        name: "Hotel Mambruk Anyer",
        instagramUrl: "https://instagram.com/mambrukanyer",
        tiktokUrl: null,
        websiteUrl: "https://mambruk.co.id",
        googleMapsUrl: null,
        active: true,
        outlets: ["dbistro", "sunset-grill"],
        category: "hotel",
        compsetRole: null,
        roadKm: 12,
      },
    },
  ];

  const merged = mergePromoCaptures(dummyPromos);
  assert.equal(merged.length, 2);
  const titles = merged.map((p) => p.title);
  assert.ok(titles.includes("Weekend Getaway 365K"));
  assert.ok(titles.includes("Seafood Saturday"));
});

test("rekomendasi dinamis: synthesizeOutletAnalysis menghasilkan rekomendasi berbasis periode tanpa nama model AI", async () => {
  const range = presetRange("30d", new Date());
  const kgGraph = await buildKnowledgeGraph(range);
  const ctx = buildOutletKnowledgeContext(kgGraph, "resort", rangeLabel(range));
  const analysis = await synthesizeOutletAnalysis(ctx, { deterministicOnly: true });

  assert.equal(analysis.outletKey, "resort");
  assert.ok(analysis.periodRecommendations.length >= 1);

  // Pastikan rekomendasi merujuk pada label rentang waktu
  const firstRec = analysis.periodRecommendations[0];
  assert.ok(firstRec.finding.length > 10);
  assert.ok(firstRec.action.length > 10);
  assert.ok(firstRec.metricToWatch.length > 5);

  // ZERO nama model AI
  const aiModelRegex = /\b(gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm)\b/i;
  for (const rec of analysis.periodRecommendations) {
    assert.ok(!aiModelRegex.test(rec.finding), `Finding dilarang menyebut nama AI: ${rec.finding}`);
    assert.ok(!aiModelRegex.test(rec.action), `Action dilarang menyebut nama AI: ${rec.action}`);
  }
});

after(() => db.$disconnect());

test("zero nama mesin AI di JSON /api/market-intelligence/summary: semua label sumber bersih dan sourceNames terdeduplikasi", async () => {
  const res = await getSummary(
    new Request("http://127.0.0.1:3001/api/market-intelligence/summary?period=30d&segment=all"),
  );
  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    sourceNames: string[];
    recentRows: { source: string }[];
    competitorSocialRadar: { source: string; sources?: { label: string }[]; counterStrategy?: string }[];
    ownPromos: { source: string; sources?: { label: string }[] }[];
    comparison: { source: string }[];
    priceComparison: { source: string }[];
    marketRateComparison: { source: string }[];
    news: { source: string }[];
    outlets: { reviews: { source: string }[] }[];
  };

  const aiSourceRegex = /\b(gemini|flash[- ]lite|flash\s+lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm)\b/i;

  assert.equal(new Set(data.sourceNames).size, data.sourceNames.length, "sourceNames tidak boleh duplikat");
  for (const name of data.sourceNames) {
    assert.doesNotMatch(name, aiSourceRegex, `sourceNames mengandung nama mesin AI: ${name}`);
  }
  for (const row of data.recentRows) {
    assert.doesNotMatch(row.source, aiSourceRegex, `recentRows[].source mengandung nama mesin AI: ${row.source}`);
  }
  for (const item of [...data.competitorSocialRadar, ...data.ownPromos]) {
    assert.doesNotMatch(item.source, aiSourceRegex, `promo.source mengandung nama mesin AI: ${item.source}`);
    for (const s of item.sources ?? []) {
      assert.doesNotMatch(s.label, aiSourceRegex, `promo.sources[].label mengandung nama mesin AI: ${s.label}`);
    }
  }
  for (const item of [...data.comparison, ...data.priceComparison, ...data.marketRateComparison, ...data.news]) {
    assert.doesNotMatch(item.source, aiSourceRegex, `label sumber mengandung nama mesin AI: ${item.source}`);
  }
  for (const outlet of data.outlets) {
    for (const rev of outlet.reviews) {
      assert.doesNotMatch(rev.source, aiSourceRegex, `review.source mengandung nama mesin AI: ${rev.source}`);
    }
  }
  // Pastikan klasifikasi promo hasil pembacaan DB tetap berjalan (counterStrategy dari OUR_VERSION_MARKER tidak hilang)
  assert.ok(
    data.competitorSocialRadar.some((p) => (p.counterStrategy ?? "").length > 0),
    "promo hasil ekstraksi tetap mempertahankan counterStrategy",
  );
  // Label sumber bersih ("Situs resmi" / "Instagram") menggantikan label lama berakhiran "(dibaca Gemini)"
  assert.ok(
    data.competitorSocialRadar.some((p) => p.source === "Situs resmi" || p.source === "Instagram"),
    "label sumber bersih harus muncul di competitorSocialRadar",
  );
});

test("isolasi promo pesaing & jendela kebaruan <= 90 hari di /api/market-intelligence/summary untuk seluruh 6 outlet + all", async () => {
  const res = await getSummary(
    new Request("http://127.0.0.1:3001/api/market-intelligence/summary?period=30d&segment=all"),
  );
  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    range: { from: string; to: string };
    competitorSocialRadar: {
      id: string;
      competitorName: string;
      competitorOutlets?: string[];
      competitorIsLodging?: boolean;
      title: string;
      category: string;
      source: string;
      platform: string;
      startsAt: string;
      endsAt: string | null;
      startWritten?: boolean;
      status: string;
      isOwn?: boolean;
    }[];
    ownPromos: {
      id: string;
      competitorName: string;
      competitorOutlets?: string[];
      competitorIsLodging?: boolean;
      title: string;
      category: string;
      source: string;
      platform: string;
      startsAt: string;
      endsAt: string | null;
      startWritten?: boolean;
      status: string;
      isOwn?: boolean;
    }[];
  };

  const ownSet = new Set<string>(OWN_COMPETITOR_NAMES);
  const cutoffMs = Date.parse(`${data.range.to}T23:59:59.999+07:00`) - PROMO_MAX_AGE_DAYS * 86_400_000;

  // 1. ZERO outlet Sanghyang boleh masuk ke competitorSocialRadar (Promo Pesaing) di semua 6 outlet + all
  for (const outlet of [...OUTLET_KEYS, "all"]) {
    const compList = promosForOutlet(data.competitorSocialRadar, outlet);
    const leaked = compList.filter((p) => p.isOwn || ownSet.has(p.competitorName) || /sanghyang/i.test(p.competitorName));
    assert.deepEqual(
      leaked.map((p) => `${p.competitorName}: ${p.title}`),
      [],
      `Outlet ${outlet}: competitorSocialRadar tidak boleh memuat outlet Sanghyang`,
    );
  }

  // 2. ownPromos hanya milik Sanghyang dan tidak memuat promo manual internal yang belum terverifikasi publik
  assert.ok(data.ownPromos.length > 0, "ownPromos harus memuat penawaran resmi Sanghyang");
  for (const p of data.ownPromos) {
    assert.equal(p.isOwn, true, `ownPromos hanya milik Sanghyang: ${p.competitorName}`);
    assert.notEqual(p.source, OWN_TEAM_SOURCE, `promo internal manual "${p.title}" tidak boleh tampil di ownPromos publik`);
  }

  // 3. Promo bertanggal > 90 hari (termasuk postingan IG 2023/2024 & Agu 2026) dilarang masuk baik ownPromos maupun competitorSocialRadar
  for (const p of [...data.ownPromos, ...data.competitorSocialRadar]) {
    const isSocial = p.platform === "instagram" || p.platform === "tiktok" || p.platform === "facebook";
    const hasWrittenDate = p.startWritten === true || p.endsAt !== null || isSocial;
    if (hasWrittenDate) {
      const anchor = Date.parse(p.endsAt ?? p.startsAt);
      assert.ok(
        anchor >= cutoffMs,
        `Promo bertanggal > ${PROMO_MAX_AGE_DAYS} hari bocor: ${p.competitorName} — ${p.title} (startsAt=${p.startsAt}, endsAt=${p.endsAt})`,
      );
    }
  }

  // 4. Kartu penawaran situs resmi Sanghyang tanpa tanggal tertulis (startWritten === false) tetap tampil
  const sunsetOwn = promosForOutlet(data.ownPromos, "sunset-grill");
  assert.ok(
    sunsetOwn.some((p) => p.title === "Sunset Grill Promo" && p.startWritten === false),
    "Sunset Grill Promo (situs resmi tanpa tanggal tertulis) wajib tetap tampil di ownPromos",
  );
  const dspaOwn = promosForOutlet(data.ownPromos, "dspa");
  assert.ok(
    dspaOwn.some((p) => p.title === "Hot Spring Refresh" && p.startWritten === false),
    "Hot Spring Refresh (situs resmi tanpa tanggal tertulis) tidak boleh terhapus/tercemar postingan IG 2023",
  );

  // 5. Periode kustom lama (Mar 2024): hitung 90 hari mundur dari range.to sehingga postingan Mar 2024 tetap bisa ditinjau, namun Okt 2023 ditolak
  const resMar2024 = await getSummary(
    new Request("http://127.0.0.1:3001/api/market-intelligence/summary?period=30d&segment=all&from=2024-03-01&to=2024-03-31"),
  );
  assert.equal(resMar2024.status, 200);
  const mar2024 = (await resMar2024.json()) as {
    competitorSocialRadar: { competitorName: string; isOwn?: boolean; startsAt: string }[];
    ownPromos: { competitorName: string; startsAt: string }[];
  };
  assert.equal(
    mar2024.competitorSocialRadar.filter((p) => p.isOwn || ownSet.has(p.competitorName) || /sanghyang/i.test(p.competitorName)).length,
    0,
    "periode kustom Mar 2024: competitorSocialRadar tetap bebas outlet Sanghyang",
  );
  assert.ok(
    mar2024.ownPromos.some((p) => p.startsAt.startsWith("2024-03-10")),
    "periode kustom Mar 2024 tetap dapat meninjau postingan Mar 2024 (dalam 90 hari dari 31 Mar 2024)",
  );
  assert.ok(
    !mar2024.ownPromos.some((p) => p.startsAt.startsWith("2023-10-08")),
    "periode kustom Mar 2024 tetap menolak postingan Okt 2023 (> 90 hari sebelum 31 Mar 2024)",
  );
});
