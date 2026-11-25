import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  classifyPromoOrEvent,
  isOwnPromoItem,
  isPromoWithinRecencyWindow,
  latestPromoCaptures,
  mergePromoCaptures,
  NOT_PROMO_CATEGORY,
  OWN_SOCIAL_POST_CATEGORY,
  ownPromosForOutlet,
  platformOf,
  PROMO_MAX_AGE_DAYS,
  promoTitleKey,
  RAW_COMPETITOR_SOCIAL_CATEGORY,
} from "../../src/lib/market/promo-radar";
import { OUTLET_KEYS, promoMatchesOutlet } from "../../src/lib/market/outlet-filters";
import { isLodging } from "../../src/lib/market/compset";
import type { SnRadarPromo } from "../../src/lib/marketing/market-intelligence-types";

const row = (over: Partial<{ competitorId: string; title: string; category: string; capturedAt: Date; active: boolean }>) => ({
  competitorId: over.competitorId ?? "marbella",
  title: over.title ?? "Christmas Package",
  category: over.category ?? "Kamar & Menginap",
  capturedAt: over.capturedAt ?? new Date("2026-11-08T10:00:00Z"),
  competitor: { active: over.active ?? true },
});

test("judul yang sama dengan beda huruf dan tanda baca dianggap satu promo", () => {
  assert.equal(promoTitleKey("3 Day 2 Night & Free Afternoon Tea!"), promoTitleKey("3 day 2 night – free afternoon tea"));
  assert.equal(promoTitleKey("Mövenpick Staycation"), "movenpick staycation");
});

test("radar hanya menyimpan tangkapan terbaru per pesaing dan judul", () => {
  const older = row({ capturedAt: new Date("2026-11-08T10:00:00Z") });
  const newer = row({ title: "christmas package", capturedAt: new Date("2026-11-13T10:00:00Z") });
  const other = row({ competitorId: "aston", capturedAt: new Date("2026-11-10T10:00:00Z") });
  const result = latestPromoCaptures([older, other, newer]);
  assert.deepEqual(result, [newer, other]);
});

test("pesaing yang diarsipkan dan postingan bukan promo tidak masuk radar", () => {
  const archived = row({ competitorId: "allisa", active: false });
  const notPromo = row({ competitorId: "aston", category: NOT_PROMO_CATEGORY });
  assert.deepEqual(latestPromoCaptures([archived, notPromo]), []);
});

test("promo kamar pesaing penginapan masuk Kamar & Resort, promo resto masuk Sunset Grill", () => {
  const hotelRoom = { competitorName: "Marbella", title: "Christmas Package", category: "Kamar & Menginap", competitorOutlets: ["resort"], competitorIsLodging: true };
  const hotelFood = { competitorName: "Aston", title: "Seafood Night", category: "F&B & Kuliner", competitorOutlets: ["resort"], competitorIsLodging: true };
  const resto = { competitorName: "Andalan", title: "Kamar murah", category: "Kamar & Menginap", competitorOutlets: ["sunset-grill", "dbistro"], competitorIsLodging: false };
  assert.equal(promoMatchesOutlet(hotelRoom, "resort"), true);
  assert.equal(promoMatchesOutlet(hotelFood, "resort"), false);
  assert.equal(promoMatchesOutlet(hotelFood, "sunset-grill"), true);
  assert.equal(promoMatchesOutlet(resto, "resort"), false, "resto bukan pembanding Kamar & Resort");
  assert.equal(promoMatchesOutlet(resto, "sunset-grill"), true);
  assert.equal(promoMatchesOutlet({ ...hotelRoom, title: "Tahun Baru" }, "dbar"), false, "\"Baru\" bukan \"bar\"");
});

test("baris promo lama yang sudah diganti atau ditandai duplikat tidak masuk radar", async () => {
  // Label sumber ini dipakai pembersihan data sebelumnya untuk mengarsipkan tangkapan situs resmi versi lama.
  const superseded = { ...row({ title: "Stay More Pay Less" }), source: "Situs resmi (versi lama, diganti)" };
  const duplicate = { ...row({ title: "Honeymoon Package" }), source: "Situs resmi (duplikat)" };
  const current = { ...row({ title: "Year End Escape" }), source: "Situs resmi (dibaca Gemini)" };
  assert.deepEqual(latestPromoCaptures([superseded, duplicate, current]), [current]);

  // Data lokal nyata: tidak satu pun baris berlabel arsip lolos penyaring.
  const { db } = await import("../../src/lib/db");
  const rows = await db.competitorPromotion.findMany({
    select: { competitorId: true, title: true, category: true, capturedAt: true, source: true, competitor: { select: { active: true } } },
  });
  assert.ok(latestPromoCaptures(rows).every((p) => !/\((versi lama|duplikat)/i.test(p.source)));
});

// Baris CompetitorPromotion Marbella Place Anyer by Jayakarta di DB lokal (tangkapan 5, 7, dan 8 Nov 2026).
const marbella = (over: { title: string; source: string; sourceUrl: string; capturedAt: string; startsAt: string; endsAt: string | null; imageUrl: string | null; price: number | null }) => ({
  competitorId: "marbella",
  category: "Kamar & Menginap",
  competitor: { active: true, name: "Marbella Place Anyer by Jayakarta" },
  title: over.title,
  source: over.source,
  sourceUrl: over.sourceUrl,
  capturedAt: new Date(`${over.capturedAt}T10:00:00Z`),
  startsAt: new Date(`${over.startsAt}T00:00:00Z`),
  endsAt: over.endsAt ? new Date(`${over.endsAt}T23:59:59Z`) : null,
  imageUrl: over.imageUrl,
  price: over.price,
});
const IG_CHRISTMAS = marbella({ title: "Year End Special Christmas", source: "Instagram (dibaca Gemini)", sourceUrl: "https://www.instagram.com/marbellaplaceanyer/p/DfTxAQ9hugH/", capturedAt: "2026-11-05", startsAt: "2026-11-24", endsAt: "2026-12-25", imageUrl: "https://scontent.cdninstagram.com/v/t51.82787-15/887750986_18499343512097238_3576216247479578419_n.webp?stp=c288.0.864.864a_dst-jpg_e35_s640x640_tt6&_nc_cat=106&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiRkVFRC5iZXN0X2ltYWdlX3VybGdlbi5DMyJ9&_nc_ohc=afe33Y1tNqYQ7kNvwHLp9Ma&_nc_oc=AdqRnQ1OsjCcPqv9u5Ka79P_2XVXLBDexeFTXSbxNeYiJMND1HkWVMI2NwRqkjFraZQ&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=fCyd56IQZ8vHRDpa_GAikw&_nc_ss=7f689&oh=00_AQQrxnWC73I8-xMX8CGVpD_Og-H0D4PtKT8pSfFiOhEuAw&oe=6AF57995", price: 1100000 });
const IG_YEAR_END = marbella({ title: "Year End Special 2026", source: "Instagram (dibaca Gemini)", sourceUrl: "https://www.instagram.com/marbellaplaceanyer/p/DfY9szAh5fF/", capturedAt: "2026-11-07", startsAt: "2026-11-04", endsAt: null, imageUrl: "https://scontent.cdninstagram.com/v/t51.82787-15/888558422_18499796029097238_7280705982693218696_n.webp?stp=c288.0.864.864a_dst-jpg_e35_s640x640_tt6&_nc_cat=104&ccb=7-5&_nc_sid=18de74&efg=eyJlZmdfdGFnIjoiRkVFRC5iZXN0X2ltYWdlX3VybGdlbi5DMyJ9&_nc_ohc=dOEdCsJdo0MQ7kNvwFtsrEm&_nc_oc=AdpQovWwnCTSCASvgNK9d7wtlkztVJ7xs1Wov9fMSz9C7QCK-BgA3tGrRV7g4RZfL4A&_nc_zt=23&_nc_ht=scontent.cdninstagram.com&_nc_gid=SUYqyno6RX-tVlbfb8roZg&_nc_ss=7f689&oh=00_AQSHLC9-MLdeCa7vQHVHd34tjc_bdsvdPPax9MA67QuE6w&oe=6AF58889", price: null });
const SITE_CHRISTMAS = marbella({ title: "Year End Special Christmas", source: "Situs resmi (dibaca Gemini)", sourceUrl: "https://marbellaplaceanyer.com/offers/", capturedAt: "2026-11-08", startsAt: "2026-11-08", endsAt: null, imageUrl: null, price: 1100000 });
const SITE_PACKAGE = marbella({ title: "Christmas Package", source: "Situs resmi (dibaca Gemini)", sourceUrl: "https://marbellaplaceanyer.com/offers/", capturedAt: "2026-11-08", startsAt: "2026-11-08", endsAt: null, imageUrl: null, price: 1350000 });

test("platform sumber promo dibaca dari alamat URL, bukan dari label", () => {
  assert.equal(platformOf("https://www.instagram.com/marbellaplaceanyer/p/DfTxAQ9hugH/"), "instagram");
  assert.equal(platformOf("https://marbellaplaceanyer.com/offers/"), "website");
  assert.equal(platformOf("https://www.tiktok.com/@novusjiva/video/1"), "tiktok");
  assert.equal(platformOf(null), null);
});

test("penawaran yang sama dari Instagram dan situs resmi menjadi satu kartu dengan semua sumbernya", () => {
  const cards = mergePromoCaptures([IG_CHRISTMAS, IG_YEAR_END, SITE_CHRISTMAS, SITE_PACKAGE]);
  const christmas = cards.find((c) => c.title === "Year End Special Christmas");
  assert.ok(christmas, "kartu Year End Special Christmas ada");
  assert.deepEqual(
    christmas.sources.map((s) => [s.platform, s.url]),
    [
      ["instagram", "https://www.instagram.com/marbellaplaceanyer/p/DfTxAQ9hugH/"],
      ["website", "https://marbellaplaceanyer.com/offers/"],
    ],
    "tautan postingan Instagram tidak hilang walau situs resmi ditangkap belakangan",
  );
  assert.equal(christmas.sourceUrl, "https://www.instagram.com/marbellaplaceanyer/p/DfTxAQ9hugH/");
  assert.equal(christmas.startsAt.toISOString().slice(0, 10), "2026-11-24", "tanggal yang tertulis di poster, bukan tanggal tangkap situs");
  assert.equal(christmas.endsAt?.toISOString().slice(0, 10), "2026-12-25");
  assert.equal(christmas.imageUrl, IG_CHRISTMAS.imageUrl);
  assert.deepEqual(
    cards.map((c) => c.title).sort(),
    ["Christmas Package", "Year End Special 2026", "Year End Special Christmas"],
    "dua postingan Instagram yang berbeda dan paket lain tetap terpisah",
  );
  assert.deepEqual(cards.find((c) => c.title === "Christmas Package")?.sources.map((s) => s.platform), ["website"]);
});

test("jendela kebaruan 90 hari menolak promo bertanggal lama (> 3 bulan) namun mempertahankan promo situs tanpa tanggal tertulis", () => {
  assert.equal(PROMO_MAX_AGE_DAYS, 90);
  const nov2026 = new Date("2026-11-19T23:59:59+07:00");

  // Postingan Instagram lama > 90 hari (kasus nyata Gambar 1: 8 Okt 2023 & 10 Mar 2024, serta 19 Agu 2026)
  assert.equal(
    isPromoWithinRecencyWindow(
      {
        startsAt: new Date("2023-10-08T10:00:00Z"),
        endsAt: null,
        capturedAt: new Date("2026-11-18T10:00:00Z"),
        sourceUrl: "https://www.instagram.com/sunset_grillsanghyang/p/CyIdznprM0w/",
        status: "new",
      },
      nov2026,
    ),
    false,
    "postingan IG 8 Okt 2023 harus ditolak",
  );
  assert.equal(
    isPromoWithinRecencyWindow(
      {
        startsAt: new Date("2024-03-10T10:00:00Z"),
        endsAt: null,
        capturedAt: new Date("2026-11-18T10:00:00Z"),
        sourceUrl: "https://www.instagram.com/sunset_grillsanghyang/p/C4U7Mxbr-c6/",
        status: "changed",
      },
      nov2026,
    ),
    false,
    "postingan IG 10 Mar 2024 harus ditolak",
  );
  assert.equal(
    isPromoWithinRecencyWindow(
      {
        startsAt: new Date("2026-08-19T10:00:00Z"),
        endsAt: null,
        capturedAt: new Date("2026-11-18T10:00:00Z"),
        sourceUrl: "https://www.instagram.com/dragonbeachclub/reel/DcOPxZbhJ9-/",
        status: "new",
      },
      nov2026,
    ),
    false,
    "postingan IG 92 hari lalu harus ditolak",
  );

  // Postingan IG dalam 90 hari tetap masuk
  assert.equal(
    isPromoWithinRecencyWindow(
      {
        startsAt: new Date("2026-09-01T10:00:00Z"),
        endsAt: null,
        capturedAt: new Date("2026-11-18T10:00:00Z"),
        sourceUrl: "https://www.instagram.com/dragonbeachclub/reel/DcvANyshgMv/",
        status: "new",
      },
      nov2026,
    ),
    true,
    "postingan IG 79 hari lalu tetap diterima",
  );

  // Promo tahunan dengan endsAt masih aktif memakai endsAt sebagai acuan
  assert.equal(
    isPromoWithinRecencyWindow(
      {
        startsAt: new Date("2026-01-20T00:00:00Z"),
        endsAt: new Date("2026-12-31T23:59:59Z"),
        capturedAt: new Date("2026-01-20T00:00:00Z"),
        sourceUrl: "https://www.instagram.com/thejayakartaanyer/p/DTuWHTjk8/",
        status: "new",
      },
      nov2026,
    ),
    true,
    "promo dengan endsAt Des 2026 tetap diterima",
  );

  // Kartu penawaran situs web tanpa tanggal tertulis tetap diterima selama belum expired
  assert.equal(
    isPromoWithinRecencyWindow(
      {
        startsAt: new Date("2026-05-01T10:00:00Z"),
        endsAt: null,
        capturedAt: new Date("2026-05-01T10:00:00Z"),
        startWritten: false,
        sourceUrl: "https://sanghyang.com/offers",
        platform: "website",
        status: "active",
      },
      nov2026,
    ),
    true,
    "promo situs resmi tanpa tanggal tertulis tetap diterima selama aktif",
  );
  assert.equal(
    isPromoWithinRecencyWindow(
      {
        startsAt: new Date("2026-11-19T10:00:00Z"),
        endsAt: null,
        capturedAt: new Date("2026-11-19T10:00:00Z"),
        startWritten: false,
        sourceUrl: "https://sanghyang.com/offers",
        platform: "website",
        status: "expired",
      },
      nov2026,
    ),
    false,
    "promo situs tanpa tanggal tertulis yang sudah expired tidak ditampilkan",
  );

  // Periode kustom lama: hitung 90 hari mundur dari tanggal akhir rentang yang dipilih
  const mar2024 = new Date("2024-03-31T23:59:59+07:00");
  assert.equal(
    isPromoWithinRecencyWindow(
      { startsAt: "2024-03-10T10:00:00Z", endsAt: null, startWritten: true, platform: "instagram", status: "active" },
      mar2024,
    ),
    true,
    "postingan Mar 2024 relevan saat pemakai sengaja memilih periode Mar 2024",
  );
  assert.equal(
    isPromoWithinRecencyWindow(
      { startsAt: "2023-10-08T10:00:00Z", endsAt: null, startWritten: true, platform: "instagram", status: "active" },
      mar2024,
    ),
    false,
    "postingan Okt 2023 (> 90 hari sebelum Mar 2024) tetap ditolak",
  );
});

test("sabuk pengaman isOwnPromoItem mencegah outlet Sanghyang masuk daftar Promo/Event Kompetitor", () => {
  assert.equal(isOwnPromoItem({ isOwn: true, competitorName: "Apapun" }), true);
  assert.equal(isOwnPromoItem({ isOwn: false, competitorName: "Sunset Grill (Sanghyang)" }), true);
  assert.equal(isOwnPromoItem({ isOwn: false, competitorName: "Andalan Beach Resto & Coffee" }), false);
});

// Baris asli DB lokal dan keluaran GET summary 30 hari sebelum perbaikan (21 Nov 2026), lihat _sumber di fixture.
interface FixturePromoRow {
  id: string;
  title: string;
  category: string;
  description: string | null;
  kind: string | null;
  source: string;
  sourceUrl: string | null;
  price: string | null;
  discount: string | null;
  details: string[];
  terms: string[];
  startsAt: string;
  endsAt: string | null;
  capturedAt: string;
  status: string;
  competitor: { name: string; outlets: string[]; category: string | null };
}
const promoFixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "tests/fixtures/promo-ulasan-sanghyang-2026-11-21.json"), "utf8"),
) as { promoRows: FixturePromoRow[]; summary: { ownPromos: SnRadarPromo[]; competitorSocialRadar: SnRadarPromo[] } };
const dbRow = (titleStart: string) => {
  const found = promoFixture.promoRows.find((r) => r.title.startsWith(titleStart));
  assert.ok(found, `baris "${titleStart}" ada di fixture`);
  return found;
};

test("C16 gambar 9: unggahan umum Aston bukan promo maupun event di outlet mana pun; penawaran 25% OFF yang dibaca tetap promo", () => {
  const appAnnouncement = dbRow("Just say the number");
  const calendarCaption = dbRow("Let’s put something else on the calendar");
  assert.equal(classifyPromoOrEvent(appAnnouncement), null, "pengumuman aplikasi bukan promo");
  assert.equal(classifyPromoOrEvent(calendarCaption), null, "postingan mentah berjudul takarir umum bukan promo maupun event");
  assert.equal(classifyPromoOrEvent(dbRow("Year-End Staycation 25% OFF")), "promo", "penawaran 25% OFF Aston yang sudah dibaca tetap promo");
});

test("C3 gambar 2: dokumentasi rombongan Sanghyang adalah event; unggahan suasana umum tetap tidak masuk", () => {
  assert.equal(classifyPromoOrEvent(dbRow("[REELS] Eat together")), "event", "Eat together, laugh together (kotak merah gambar 2)");
  assert.equal(classifyPromoOrEvent(dbRow("[REELS] Building stronger teams")), "event", "Building stronger teams (kotak merah gambar 2)");
  assert.equal(classifyPromoOrEvent(dbRow("[REELS] Welcome PT. Hon Chuan")), "event");
  assert.equal(classifyPromoOrEvent(dbRow("[REELS] Lunch Group EO Wanderis")), "event");
  assert.equal(classifyPromoOrEvent(dbRow("[FEED] Nikmati kekayaan cita rasa khas Banten")), "promo", "menu dengan FREE ICE TEA adalah promo");
  assert.equal(classifyPromoOrEvent(dbRow("[REELS] Baduy Suite")), null, "ajakan berkomentar tentang kamar bukan promo maupun event");
  assert.equal(classifyPromoOrEvent(dbRow("[REELS] NASI GORENG KECOMBRANG")), null, "resep masakan rumahan bukan promo");
});

test("A4: promo Sanghyang dipetakan ke outlet baris sumbernya (sama dengan laporan PDF), bukan ditebak seperti promo kompetitor", () => {
  const own = promoFixture.summary.ownPromos;
  const titles = (outlet: string) => ownPromosForOutlet(own, outlet).map((p) => p.title);
  assert.ok(titles("resort").includes("Paket Babakaran"), "kartu situs resmi Paket Babakaran milik baris resort");
  assert.ok(!titles("dbistro").includes("Paket Babakaran"), "Paket Babakaran tidak pindah ke D'Bistro karena kategorinya F&B");
  assert.deepEqual(titles("dbar"), [], "D'Bar belum punya promo atau event sendiri");
  assert.equal(ownPromosForOutlet(own, "all").length, own.length, "Semua Outlet memuat semua promo Sanghyang");
  for (const outlet of OUTLET_KEYS) {
    for (const p of ownPromosForOutlet(own, outlet)) assert.ok(p.competitorOutlets?.includes(outlet), `${outlet}: ${p.title}`);
  }
  assert.equal(isLodging("resort"), true);
  assert.equal(platformOf("https://www.instagram.com/sanghyangresort/p/abc/"), "instagram");
});

test("mergePromoCaptures tidak menggabungkan postingan sosmed mentah dengan kartu situs resmi maupun menggabungkan promo dengan event", () => {
  const officialSunsetPromo = {
    competitorId: "sunset-grill-id",
    category: "F&B & Kuliner",
    competitor: { active: true, name: "Sunset Grill (Sanghyang)" },
    title: "Sunset Grill Promo",
    description: "Penawaran resmi Sunset Grill di sanghyang.com/offers",
    source: "Situs resmi Sanghyang (penawaran)",
    sourceUrl: "https://sanghyang.com/offers",
    capturedAt: new Date("2026-11-24T09:23:40Z"),
    startsAt: new Date("2026-11-24T09:23:40Z"),
    endsAt: null,
    imageUrl: null,
    price: null,
    kind: "promo",
  };
  const halloweenReels = {
    competitorId: "sunset-grill-id",
    category: OWN_SOCIAL_POST_CATEGORY,
    competitor: { active: true, name: "Sunset Grill (Sanghyang)" },
    title: "[REELS] Yuk Halloween di Sunset Grill. #anyerbeach",
    description: JSON.stringify({ caption: "Yuk Halloween di Sunset Grill! Live music & dinner seru." }),
    source: "Instagram",
    sourceUrl: "https://www.instagram.com/sunsetgrillsanghyang/reel/DbHalloween1/",
    capturedAt: new Date("2026-11-24T16:46:00Z"),
    startsAt: new Date("2026-10-30T10:00:00Z"),
    endsAt: null,
    imageUrl: null,
    price: null,
    kind: null,
  };
  const sunsetRawPromoPost = {
    competitorId: "sunset-grill-id",
    category: OWN_SOCIAL_POST_CATEGORY,
    competitor: { active: true, name: "Sunset Grill (Sanghyang)" },
    title: "[FEED] Promo spesial akhir pekan Sunset Grill hemat 15%",
    description: JSON.stringify({ caption: "Promo spesial akhir pekan Sunset Grill hemat 15%!" }),
    source: "Instagram",
    sourceUrl: "https://www.instagram.com/sunsetgrillsanghyang/p/DbPromo15/",
    capturedAt: new Date("2026-11-24T16:47:00Z"),
    startsAt: new Date("2026-11-20T10:00:00Z"),
    endsAt: null,
    imageUrl: null,
    price: null,
    kind: null,
  };
  const compSitePromo = {
    competitorId: "comp-1",
    category: "F&B & Kuliner",
    competitor: { active: true, name: "Andalan Beach Resto" },
    title: "Andalan Seafood Promo",
    description: "Diskon seafood 20% situs resmi",
    source: "Situs resmi",
    sourceUrl: "https://andalanbeach.example/promo",
    capturedAt: new Date("2026-11-24T08:00:00Z"),
    startsAt: new Date("2026-11-24T08:00:00Z"),
    endsAt: null,
    imageUrl: null,
    price: null,
    kind: "promo",
  };
  const compRawSocial = {
    competitorId: "comp-1",
    category: RAW_COMPETITOR_SOCIAL_CATEGORY,
    competitor: { active: true, name: "Andalan Beach Resto" },
    title: "Promo Andalan Seafood malam minggu",
    description: JSON.stringify({ caption: "Promo Andalan Seafood malam minggu" }),
    source: "Instagram",
    sourceUrl: "https://www.instagram.com/andalanbeach/p/CompRaw1/",
    capturedAt: new Date("2026-11-24T16:00:00Z"),
    startsAt: new Date("2026-11-22T10:00:00Z"),
    endsAt: null,
    imageUrl: null,
    price: null,
    kind: null,
  };

  const curatedSitePromo = {
    competitorId: "comp-2",
    category: "Kamar & Menginap",
    competitor: { active: true, name: "Mambruk Hotel" },
    title: "New Year Sunset Package",
    description: "Paket menginap akhir tahun diskon 20%",
    source: "Situs resmi (dibaca Gemini)",
    sourceUrl: "https://mambruk.example/offers",
    capturedAt: new Date("2026-11-24T08:00:00Z"),
    startsAt: new Date("2026-11-24T08:00:00Z"),
    endsAt: null,
    imageUrl: null,
    price: null,
    kind: "promo",
  };
  const curatedIgEvent = {
    competitorId: "comp-2",
    category: "Acara & Live Music",
    competitor: { active: true, name: "Mambruk Hotel" },
    title: "New Year Sunset Live Music",
    description: "Pesta kembang api & live music",
    source: "Instagram (dibaca Gemini)",
    sourceUrl: "https://www.instagram.com/mambruk/p/Evt1/",
    capturedAt: new Date("2026-11-24T12:00:00Z"),
    startsAt: new Date("2026-12-31T10:00:00Z"),
    endsAt: null,
    imageUrl: null,
    price: null,
    kind: "event",
  };

  const merged = mergePromoCaptures([
    officialSunsetPromo,
    halloweenReels,
    sunsetRawPromoPost,
    compSitePromo,
    compRawSocial,
    curatedSitePromo,
    curatedIgEvent,
  ]);
  assert.equal(merged.length, 7, "kartu situs resmi dan postingan sosmed mentah/event tidak boleh saling menelan");
  const keptOfficial = merged.find((c) => c.title === "Sunset Grill Promo");
  assert.ok(keptOfficial, "kartu situs resmi Sunset Grill Promo wajib tetap berdiri utuh");
  assert.equal(keptOfficial.sourceUrl, "https://sanghyang.com/offers");
  assert.ok(merged.some((c) => c.title === "Andalan Seafood Promo"), "kartu situs resmi kompetitor tidak boleh ditelan sosmed mentah");
  assert.ok(merged.some((c) => c.title === "New Year Sunset Package"), "promo terkurasi tidak boleh digabung dengan event terkurasi");
  assert.ok(merged.some((c) => c.title === "New Year Sunset Live Music"), "event terkurasi tetap berdiri terpisah");
});
