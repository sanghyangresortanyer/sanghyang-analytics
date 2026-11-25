/**
 * Unit test mesin pembaruan dinamis (Super App - Market Research):
 * 1. Ekstraksi & verifikasi kutipan anti-halusinasi untuk refresh-room-types & refresh-competitor-menus (0 kuota AI live)
 * 2. Aturan situs resmi selalu mengalahkan OTA saat terjadi bentrok spesifikasi
 * 3. loadDynamicHotelRoomTypes memprioritaskan fakta DB terbaru & fallback cerdas ke baseline statis
 * 4. Invalidasi cache narasi MarketInsight (`kg-narrative:*`) tanpa menghapus heartbeat
 * 5. Kontrak SSE progress langkah dinamis (`tipe_kamar`, `menu_pesaing`) dan 0 penyebutan nama mesin AI
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { db } from "../../src/lib/db";
import {
  HOTEL_ROOM_TYPES,
  loadDynamicHotelRoomTypes,
  type HotelRoomTypeSpec,
} from "../../src/lib/market/hotel-room-types";
import {
  discoverRoomLinks,
  mergeOfficialAndOtaRoomTypes,
  parseVerifiedRoomTypes,
  refreshDynamicRoomTypes,
  roomTypesRefreshOutcome,
} from "../../src/lib/market/refresh-room-types";
import {
  competitorMenusRefreshOutcome,
  discoverMenuLinks,
  loadDynamicCompetitorMenuItems,
  parseVerifiedMenuItems,
  refreshDynamicCompetitorMenus,
} from "../../src/lib/market/refresh-competitor-menus";
import { invalidateStaleNarrativeCache } from "../../src/lib/market/full-refresh";
import {
  beginRefresh,
  currentRefresh,
  endRefresh,
  REFRESH_STEPS,
  updateStep,
} from "../../src/lib/market/refresh-progress";

const AI_MODEL_PATTERN = /\b(gemini|flash[- ]?lite|claude|openai|chatgpt|gpt-?\d|llm)\b/i;

after(() => db.$disconnect());

interface RegistryFixtureRow {
  id: string;
  name: string;
  version: number;
  notes: string | null;
  retiredReason: string | null;
  input: { menuItems?: Array<{ name: string; category: string | null; price: number }> } & Record<string, unknown>;
}

/**
 * Rekaman asli daftar kompetitor DB lokal 21 Nov 2026. Rekaman dibuat sebelum holisticReferencesOf mengisi bintang hotel
 * Sanghyang untuk outlet di dalamnya (22 Nov); nilainya bintang Kamar & Resort dari rekaman yang sama.
 */
async function holisticRegistryFixture(): Promise<{ candidates: RegistryFixtureRow[]; references: Record<string, Record<string, unknown>> }> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/holistic-registry-2026-11-21.json"), "utf8")) as {
    candidates: RegistryFixtureRow[];
    references: Record<string, Record<string, unknown>>;
  };
  const ownStarRating = raw.references.resort?.ownStarRating ?? null;
  return {
    candidates: raw.candidates,
    references: Object.fromEntries(Object.entries(raw.references).map(([outlet, ref]) => [outlet, { ...ref, ownStarRating }])),
  };
}

test("discoverRoomLinks menemukan halaman kamar/akomodasi di origin yang sama dan mengabaikan aset/eksternal", () => {
  const html = `
    <html><body>
      <nav>
        <a href="/rooms">Rooms & Suites</a>
        <a href="/accomodation">Accommodation</a>
        <a href="https://hotel-contoh.co.id/villas#top">Private Villas</a>
        <a href="/dining">Dining</a>
        <a href="/files/brochure-rooms.pdf">Brochure PDF</a>
        <a href="https://instagram.com/hotelcontoh">Instagram</a>
        <a href="/rooms">Rooms duplicate</a>
      </nav>
    </body></html>
  `;
  const links = discoverRoomLinks("https://hotel-contoh.co.id/", html, 4);
  assert.deepEqual(links, [
    "https://hotel-contoh.co.id/rooms",
    "https://hotel-contoh.co.id/accomodation",
    "https://hotel-contoh.co.id/villas",
  ]);
});

test("parseVerifiedRoomTypes menolak halusinasi tanpa kutipan verbatim di halaman dan membersihkan luas karangan", () => {
  const pageText = [
    "Krakatau Villa - 70 m² - 2 Bedrooms - Garden view with pantry and dining area. LED TV available.",
    "Sanghyang Suite - 28 m² - 1 King Bed - Bathtub included in private bathroom.",
  ].join("\n");

  const aiJson = JSON.stringify({
    roomTypes: [
      {
        name: "Krakatau Villa",
        category: "villa",
        bedrooms: 2,
        areaSqm: 70,
        areaLabel: "70 m²",
        smartTv: false,
        bathtub: false,
        highlights: ["2 Bedrooms", "Garden view", "Pantry & dining area"],
        weekdayPrice: null,
        weekendPrice: null,
        quote: "Krakatau Villa - 70 m² - 2 Bedrooms - Garden view with pantry and dining area.",
      },
      {
        name: "Presidential Penthouse Karangan",
        category: "suite",
        bedrooms: 4,
        areaSqm: 500,
        areaLabel: "500 m²",
        smartTv: true,
        bathtub: true,
        highlights: ["Private helipad"],
        quote: "Presidential Penthouse 500 m² with helipad",
      },
      {
        name: "Sanghyang Suite",
        category: "suite",
        bedrooms: 1,
        areaSqm: 99,
        areaLabel: "99 m²",
        smartTv: null,
        bathtub: true,
        highlights: ["Bathtub included"],
        quote: "Sanghyang Suite - 28 m² - 1 King Bed - Bathtub included in private bathroom.",
      },
    ],
  });

  const parsed = parseVerifiedRoomTypes(
    aiJson,
    pageText,
    "https://sanghyang.com/rooms",
    "Situs resmi sanghyang.com",
    "2026-11-19",
  );

  assert.equal(parsed.roomTypes.length, 2, "Hanya tipe kamar berkutipan sah yang lolos");
  assert.equal(parsed.rejected.length, 1, "Tipe kamar karangan wajib ditolak");
  assert.equal(parsed.rejected[0].name, "Presidential Penthouse Karangan");
  assert.equal(parsed.roomTypes[0].name, "Krakatau Villa");
  assert.equal(parsed.roomTypes[0].areaSqm, 70);
  assert.equal(parsed.roomTypes[1].name, "Sanghyang Suite");
  assert.equal(
    parsed.roomTypes[1].areaSqm,
    null,
    "Luas 99 m² yang tidak muncul di halaman wajib dinullkan (anti-halusinasi)",
  );
  assert.equal(parsed.roomTypes[1].bathtub, true);
});

test("mergeOfficialAndOtaRoomTypes selalu memenangkan situs resmi atas OTA saat bentrok dan melengkapi harga OTA", () => {
  const official: Partial<HotelRoomTypeSpec>[] = [
    {
      name: "Krakatau Villa",
      category: "villa",
      bedrooms: 2,
      areaSqm: 70,
      areaLabel: "70 m²",
      smartTv: false,
      bathtub: false,
      highlights: ["2 kamar tidur", "Taman tropis"],
      sourcePriority: "official",
      sourceLabel: "Situs resmi sanghyang.com",
      sourceUrl: "https://sanghyang.com/rooms/krakatau-villa",
      observedAt: "2026-11-19",
    },
  ];
  const ota: Partial<HotelRoomTypeSpec>[] = [
    {
      name: "Krakatau Villa",
      category: "villa",
      bedrooms: 2,
      areaSqm: 85,
      areaLabel: "85 m²",
      smartTv: true,
      bathtub: true,
      highlights: ["Villa 2BR"],
      weekdayPrice: 1350000,
      weekendPrice: 1950000,
      priceSource: "Booking.com",
      sourcePriority: "ota",
      sourceLabel: "Booking.com",
      sourceUrl: "https://www.booking.com/hotel/id/sanghyang-indah-spa-resort.html",
      observedAt: "2026-11-19",
    },
  ];

  const merged = mergeOfficialAndOtaRoomTypes(official, ota);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourcePriority, "official");
  assert.equal(merged[0].areaSqm, 70, "Luas resmi 70 m² wajib mengalahkan OTA 85 m²");
  assert.equal(merged[0].smartTv, false, "Spesifikasi Smart TV resmi wajib menang atas OTA");
  assert.equal(merged[0].bathtub, false, "Spesifikasi bathtub resmi wajib menang atas OTA");
  assert.equal(merged[0].weekdayPrice, 1350000, "Harga OTA boleh melengkapi kolom harga yang kosong di situs resmi");
  assert.equal(merged[0].weekendPrice, 1950000);
  assert.ok(merged[0].conflictNote?.includes("85") && merged[0].conflictNote?.includes("70"));
});

test("refreshDynamicRoomTypes mematuhi robots.txt, staleAfterDays, OCC upsert, dan 0 kuota live saat stub", async () => {
  const savedFacts: Array<{ competitorId: string; section: string; key: string; value: unknown; sourceUrl: string }> = [];
  const recordedRuns: Array<{ domain: string; status: string; saved: number }> = [];
  let generateCalls = 0;

  const now = new Date("2026-11-19T12:00:00.000Z");
  const freshDate = new Date("2026-11-18T12:00:00.000Z");
  const staleDate = new Date("2026-11-01T12:00:00.000Z");

  const fakeRoomTx = {
    competitor: {
      findMany: async () => [
        { id: "c-stale", name: "Resort Uji Stale", placeId: "resort_stale", category: "resort", websiteUrl: "https://stale-resort.test/" },
        { id: "c-fresh", name: "Resort Uji Fresh", placeId: "resort_fresh", category: "hotel", websiteUrl: "https://fresh-resort.test/" },
        { id: "c-blocked", name: "Resort Uji Blocked", placeId: "resort_blocked", category: "hotel", websiteUrl: "https://blocked-resort.test/" },
      ],
    },
    competitorFact: {
      findMany: async () => [
        { id: "f-stale", competitorId: "c-stale", section: "kamar", key: "tipe_kamar_terstruktur", observedAt: staleDate, version: 1 },
        { id: "f-fresh", competitorId: "c-fresh", section: "kamar", key: "tipe_kamar_terstruktur", observedAt: freshDate, version: 1 },
      ],
      findUnique: async ({ where }: { where: { competitorId_section_key: { competitorId: string } } }) =>
        where.competitorId_section_key.competitorId === "c-stale" ? { id: "f-stale", version: 1 } : null,
      updateMany: async ({ data }: { data: { value: unknown; sourceUrl: string } }) => {
        savedFacts.push({ competitorId: "c-stale", section: "kamar", key: "tipe_kamar_terstruktur", value: data.value, sourceUrl: data.sourceUrl });
        return { count: 1 };
      },
      create: async ({ data }: { data: { competitorId: string; section: string; key: string; value: unknown; sourceUrl: string } }) => {
        savedFacts.push(data);
        return { id: "new-fact" };
      },
    },
    competitorPriceSnapshot: {
      findMany: async () => [
        {
          competitorId: "c-stale",
          roomName: "Deluxe Ocean",
          price: 950000,
          checkIn: new Date("2026-11-24T00:00:00.000Z"), // Selasa (weekday)
          source: "Booking.com",
          sourceUrl: "https://www.booking.com/hotel/id/stale-resort.html",
          observedAt: now,
        },
        {
          competitorId: "c-stale",
          roomName: "Deluxe Ocean",
          price: 1450000,
          checkIn: new Date("2026-11-21T00:00:00.000Z"), // Sabtu (weekend)
          source: "Booking.com",
          sourceUrl: "https://www.booking.com/hotel/id/stale-resort.html",
          observedAt: now,
        },
      ],
    },
    source: {
      upsert: async ({ create }: { create: { domain: string } }) => ({ id: "src-1", domain: create.domain }),
      update: async () => ({ id: "src-1" }),
    },
    scrapeRun: {
      create: async () => ({ id: "run-1", sourceId: "src-1" }),
      findUnique: async () => ({ id: "run-1", sourceId: "src-1", errors: 0 }),
      update: async ({ data }: { data: { status?: string; recordsSaved?: number } }) => {
        if (data.status) recordedRuns.push({ domain: "tipe_kamar_dinamis", status: data.status, saved: data.recordsSaved ?? 0 });
        return { id: "run-1", sourceId: "src-1" };
      },
    },
    scrapeError: {
      create: async () => ({ id: "err-1" }),
    },
  };
  const fakeClient = {
    ...fakeRoomTx,
    $transaction: async <T>(fn: (tx: typeof fakeRoomTx) => Promise<T>): Promise<T> => fn(fakeRoomTx),
  };

  const result = await refreshDynamicRoomTypes({
    staleAfterDays: 7,
    now,
    client: fakeClient as never,
    checkRobots: async (url) => !url.includes("blocked-resort.test"),
    fetchPage: async (url) => {
      if (url === "https://stale-resort.test/") {
        return {
          url,
          html: `<html><body><a href="/rooms">Rooms</a><p>Welcome to Resort Uji Stale Anyer beachfront resort with spacious rooms and villas.</p></body></html>`,
        };
      }
      return {
        url,
        html: `<html><body>
          <h1>Rooms & Suites</h1>
          <p>Deluxe Ocean - 42 m² - 1 King Bed - Smart TV 55 inch & Bathtub - Panoramic sea view balcony for two guests.</p>
          <p>Family Villa 2BR - 110 m² - 2 Bedrooms - Private terrace and kitchenette for four guests.</p>
        </body></html>`,
      };
    },
    generate: async () => {
      generateCalls++;
      return JSON.stringify({
        roomTypes: [
          {
            name: "Deluxe Ocean",
            category: "standard",
            bedrooms: 1,
            areaSqm: 42,
            areaLabel: "42 m²",
            smartTv: true,
            bathtub: true,
            highlights: ["Smart TV 55 inch", "Bathtub", "Panoramic sea view"],
            quote: "Deluxe Ocean - 42 m² - 1 King Bed - Smart TV 55 inch & Bathtub - Panoramic sea view",
          },
          {
            name: "Family Villa 2BR",
            category: "villa",
            bedrooms: 2,
            areaSqm: 110,
            areaLabel: "110 m²",
            smartTv: null,
            bathtub: null,
            highlights: ["2 Bedrooms", "Private terrace"],
            quote: "Family Villa 2BR - 110 m² - 2 Bedrooms - Private terrace and kitchenette",
          },
        ],
      });
    },
  });

  assert.equal(generateCalls, 1, "Hanya properti basi & lolos robots.txt yang memanggil generator");
  assert.equal(result.freshSkipped, 1, "Resort fresh (< 7 hari) wajib dilewati");
  assert.equal(result.updated, 1);
  assert.equal(result.failures.length, 1, "Resort yang diblokir robots.txt dicatat sebagai kendala");
  assert.equal(savedFacts.length, 1);
  const stored = savedFacts[0].value as { roomTypes: HotelRoomTypeSpec[]; hasMultiBedroomUnit: boolean; text: string };
  assert.equal(stored.roomTypes.length, 2);
  assert.equal(stored.hasMultiBedroomUnit, true);
  assert.equal(stored.roomTypes[0].weekdayPrice, 950000, "Tarif weekday OTA DB digabung ke tipe kamar cocok");
  assert.equal(stored.roomTypes[0].weekendPrice, 1450000, "Tarif weekend OTA DB digabung ke tipe kamar cocok");
  assert.doesNotMatch(JSON.stringify(stored), AI_MODEL_PATTERN);
  assert.equal(recordedRuns.length, 1, "ScrapeRun wajib tercatat");
  assert.equal(recordedRuns[0].domain, "tipe_kamar_dinamis");
});

test("discoverMenuLinks menemukan halaman menu/dining/spa dari situs outlet dan situs hotel induk", () => {
  const html = `
    <html><body>
      <a href="/dining/lagoon-restaurant">Lagoon Restaurant Menu</a>
      <a href="/spa/treatment-pricelist">Spa Treatment Pricelist</a>
      <a href="/contact">Contact Us</a>
      <a href="https://instagram.com/hotel">IG</a>
    </body></html>
  `;
  const restoLinks = discoverMenuLinks("https://hotel.test/", html, "Lagoon Restaurant", "resto", 3);
  assert.equal(restoLinks[0], "https://hotel.test/dining/lagoon-restaurant");

  const spaLinks = discoverMenuLinks("https://hotel.test/", html, "Bliss Spa", "spa", 3);
  assert.equal(spaLinks[0], "https://hotel.test/spa/treatment-pricelist");
});

test("parseVerifiedMenuItems mewajibkan kutipan verbatim memuat nama item dan angka harga yang cocok", () => {
  const pageText = [
    "INDONESIAN FAVORITES",
    "Sop Buntut Spesial - Rp 125.000 / porsi",
    "Nasi Goreng Kampung - 85K",
    "Gurame Bakar Jimbaran - IDR 145.000",
    "Traditional Balinese Massage 60 Min - Rp 350.000 / jam",
  ].join("\n");

  const aiJson = JSON.stringify({
    items: [
      {
        name: "Sop Buntut Spesial",
        price: 125000,
        category: "Indonesian Favorites",
        unit: null,
        quote: "Sop Buntut Spesial - Rp 125.000 / porsi",
      },
      {
        name: "Nasi Goreng Kampung",
        price: 85000,
        category: "Indonesian Favorites",
        unit: null,
        quote: "Nasi Goreng Kampung - 85K",
      },
      {
        name: "Traditional Balinese Massage 60 Min",
        price: 350000,
        category: "Spa Treatment",
        unit: "per jam",
        quote: "Traditional Balinese Massage 60 Min - Rp 350.000 / jam",
      },
      {
        // Harga tidak cocok dengan kutipan (halusinasi angka!)
        name: "Gurame Bakar Jimbaran",
        price: 99000,
        category: "Indonesian Favorites",
        unit: null,
        quote: "Gurame Bakar Jimbaran - IDR 145.000",
      },
      {
        // Item fiktif dengan kutipan yang tidak ada di halaman
        name: "Lobster Thermidor Fiktif",
        price: 450000,
        category: "Seafood",
        unit: null,
        quote: "Lobster Thermidor Fiktif - Rp 450.000",
      },
    ],
  });

  const parsed = parseVerifiedMenuItems(aiJson, pageText);
  assert.equal(parsed.items.length, 3, "Hanya 3 item berkutipan nama + harga cocok yang lolos");
  assert.equal(parsed.rejected.length, 2, "Item dengan harga salah dan kutipan karangan wajib ditolak");
  assert.equal(parsed.items[0].price, 125000);
  assert.equal(parsed.items[1].price, 85000);
  assert.equal(parsed.items[2].unit, "per jam");
});

test("refreshDynamicCompetitorMenus memakai parent.websiteUrl, dedup fetch, dan loadDynamicCompetitorMenuItems membaca hasilnya", async () => {
  const storedRows: Array<{
    competitorId: string;
    section: string;
    key: string;
    value: unknown;
    sourceUrl: string;
    observedAt: Date;
    competitor: { id: string; name: string; placeId: string | null; category: string | null };
  }> = [];
  let fetchCount = 0;

  const fakeMenuTx = {
    competitor: {
      findMany: async () => [
        {
          id: "v-1",
          name: "Serai Restaurant Uji",
          placeId: "serai_uji",
          category: "resto",
          websiteUrl: null,
          parent: { id: "h-1", name: "Hotel Induk Uji", websiteUrl: "https://hotel-induk.test/" },
        },
        {
          id: "v-2",
          name: "Daiva Spa Uji",
          placeId: "daiva_uji",
          category: "spa",
          websiteUrl: null,
          parent: { id: "h-1", name: "Hotel Induk Uji", websiteUrl: "https://hotel-induk.test/" },
        },
      ],
    },
    competitorFact: {
      findMany: async () => storedRows,
      findUnique: async () => null,
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }: { data: { competitorId: string; section: string; key: string; value: unknown; sourceUrl: string; observedAt: Date } }) => {
        storedRows.push({
          ...data,
          competitor: data.competitorId === "v-1"
            ? { id: "v-1", name: "Serai Restaurant Uji", placeId: "serai_uji", category: "resto" }
            : { id: "v-2", name: "Daiva Spa Uji", placeId: "daiva_uji", category: "spa" },
        });
        return { id: `fact-${storedRows.length}` };
      },
    },
    source: {
      upsert: async () => ({ id: "src-menu", domain: "menu_pesaing_dinamis" }),
      update: async () => ({ id: "src-menu" }),
    },
    scrapeRun: {
      create: async () => ({ id: "run-menu", sourceId: "src-menu" }),
      findUnique: async () => ({ id: "run-menu", sourceId: "src-menu", errors: 0 }),
      update: async () => ({ id: "run-menu", sourceId: "src-menu" }),
    },
    scrapeError: {
      create: async () => ({ id: "err-menu" }),
    },
  };
  const fakeClient = {
    ...fakeMenuTx,
    $transaction: async <T>(fn: (tx: typeof fakeMenuTx) => Promise<T>): Promise<T> => fn(fakeMenuTx),
  };

  const run = await refreshDynamicCompetitorMenus({
    staleAfterDays: 7,
    client: fakeClient as never,
    checkRobots: async () => true,
    fetchPage: async (url) => {
      fetchCount++;
      return {
        url,
        html: `<html><body>
          <h1>Dining & Wellness Hotel Induk Uji</h1>
          <p>Serai Restaurant Uji: Sop Buntut Spesial Rp 135.000, Nasi Goreng Kampung Rp 85.000, Gurame Bakar Rp 145.000.</p>
          <p>Daiva Spa Uji: Aromatherapy Massage 60 min Rp 320.000 / jam, Body Scrub Rp 260.000.</p>
        </body></html>`,
      };
    },
    generate: async (prompt) => {
      if (prompt.startsWith('Kamu membaca halaman resmi untuk "Serai Restaurant Uji"')) {
        return JSON.stringify({
          items: [
            { name: "Sop Buntut Spesial", price: 135000, category: "Main Course", unit: null, quote: "Sop Buntut Spesial Rp 135.000" },
            { name: "Nasi Goreng Kampung", price: 85000, category: "Main Course", unit: null, quote: "Nasi Goreng Kampung Rp 85.000" },
          ],
        });
      }
      return JSON.stringify({
        items: [
          { name: "Aromatherapy Massage 60 min", price: 320000, category: "Massage", unit: "per jam", quote: "Aromatherapy Massage 60 min Rp 320.000 / jam" },
        ],
      });
    },
  });

  assert.equal(fetchCount, 1, "Halaman hotel induk yang dipakai 2 outlet hanya di-fetch satu kali");
  assert.equal(run.updated, 2);
  assert.equal(run.itemsSaved, 3);

  const loaded = await loadDynamicCompetitorMenuItems(["v-1", "v-2"], { client: fakeClient as never });
  assert.equal(loaded.size, 2);
  assert.equal(loaded.get("v-1")?.items.length, 2);
  assert.equal(loaded.get("v-1")?.items[0].price, 135000);
  assert.equal(loaded.get("v-2")?.items[0].unit, "per jam");
  assert.doesNotMatch(JSON.stringify([...loaded.values()]), AI_MODEL_PATTERN);
});

test("loadDynamicHotelRoomTypes memprioritaskan fakta DB lebih baru, mempertahankan baseline bila DB lebih lama, dan memuat properti baru", async () => {
  const newerDate = new Date("2026-12-01T00:00:00.000Z");
  const olderDate = new Date("2026-01-01T00:00:00.000Z");

  const fakeClient = {
    competitorFact: {
      findMany: async () => [
        {
          competitorId: "uuid-sanghyang",
          section: "kamar",
          key: "tipe_kamar_terstruktur",
          sourceUrl: "https://sanghyang.com/rooms",
          observedAt: newerDate,
          competitor: { id: "uuid-sanghyang", name: "Sanghyang Indah Spa Resort", placeId: "sanghyang" },
          value: {
            hotelId: "sanghyang",
            hasMultiBedroomUnit: true,
            multiBedroomNote: "Diperbarui dari situs resmi (termasuk Ocean Pool Villa baru).",
            roomTypes: [
              {
                name: "Krakatau Villa",
                category: "villa",
                bedrooms: 2,
                areaSqm: 72,
                areaLabel: "72 m²",
                smartTv: true,
                bathtub: false,
                highlights: ["2 kamar tidur", "Renovasi 2026"],
                weekdayPrice: 1200000,
                weekendPrice: 1850000,
                priceSource: "Situs resmi",
                sourcePriority: "official",
                sourceLabel: "Situs resmi sanghyang.com (dibaca Gemini)",
                sourceUrl: "https://sanghyang.com/rooms/krakatau-villa",
                observedAt: "2026-12-01",
                conflictNote: null,
              },
            ],
          },
        },
        {
          competitorId: "uuid-mambruk",
          section: "kamar",
          key: "tipe_kamar_terstruktur",
          sourceUrl: "https://www.mambruk.co.id/accomodation",
          observedAt: olderDate,
          competitor: { id: "uuid-mambruk", name: "Mambruk Hotel & Convention", placeId: "mambruk" },
          value: {
            hotelId: "mambruk",
            hasMultiBedroomUnit: false,
            multiBedroomNote: null,
            roomTypes: [
              {
                name: "Old Room",
                category: "standard",
                bedrooms: 1,
                areaSqm: 20,
                areaLabel: "20 m²",
                smartTv: false,
                bathtub: false,
                highlights: [],
                weekdayPrice: null,
                weekendPrice: null,
                priceSource: null,
                sourcePriority: "official",
                sourceLabel: "Situs lama",
                sourceUrl: "https://www.mambruk.co.id/accomodation",
                observedAt: "2026-01-01",
                conflictNote: null,
              },
            ],
          },
        },
        {
          competitorId: "uuid-baru",
          section: "kamar",
          key: "tipe_kamar_terstruktur",
          sourceUrl: "https://resort-baru.test/rooms",
          observedAt: newerDate,
          competitor: { id: "uuid-baru", name: "Resort Baru Anyer", placeId: "resort_baru_anyer" },
          value: {
            hotelId: "resort_baru_anyer",
            hasMultiBedroomUnit: true,
            multiBedroomNote: "1 unit vila 2 kamar tidur.",
            roomTypes: [
              {
                name: "Sunset Villa 2BR",
                category: "villa",
                bedrooms: 2,
                areaSqm: 95,
                areaLabel: "95 m²",
                smartTv: true,
                bathtub: true,
                highlights: ["2 kamar tidur", "Private pool"],
                weekdayPrice: null,
                weekendPrice: null,
                priceSource: null,
                sourcePriority: "official",
                sourceLabel: "Situs resmi resort-baru.test",
                sourceUrl: "https://resort-baru.test/rooms",
                observedAt: "2026-12-01",
                conflictNote: null,
              },
            ],
          },
        },
      ],
    },
  };

  const merged = await loadDynamicHotelRoomTypes(undefined, { client: fakeClient as never });
  assert.equal(merged.size, HOTEL_ROOM_TYPES.length + 1, "10 baseline + 1 properti baru dari DB");

  const sanghyang = merged.get("sanghyang");
  assert.ok(sanghyang);
  assert.equal(sanghyang.roomTypes[0].areaSqm, 72, "Fakta DB lebih baru harus mengalahkan baseline statis 70 m²");
  assert.doesNotMatch(JSON.stringify(sanghyang), AI_MODEL_PATTERN, "Nama mesin AI wajib dibersihkan");

  const mambruk = merged.get("mambruk");
  assert.ok(mambruk);
  assert.equal(mambruk.roomTypes.length, 5, "Fakta DB yang lebih lama dari baseline tidak boleh menimpa baseline terbaru");

  const baru = merged.get("resort_baru_anyer");
  assert.ok(baru);
  assert.equal(baru.roomTypes[0].name, "Sunset Villa 2BR");
});

test("outcome langkah dinamis dan SSE progress tidak menyebut nama mesin AI serta menjaga 9 langkah inti", () => {
  const skippedRooms = roomTypesRefreshOutcome({
    attempted: 0,
    updated: 0,
    roomTypesSaved: 0,
    freshSkipped: 10,
    failures: [],
    staleAfterDays: 7,
  });
  assert.equal(skippedRooms.status, "dilewati");
  assert.doesNotMatch(`${skippedRooms.detail} ${skippedRooms.issue ?? ""}`, AI_MODEL_PATTERN);

  const noKeyMenus = competitorMenusRefreshOutcome({
    attempted: 0,
    updated: 0,
    itemsSaved: 0,
    freshSkipped: 0,
    failures: [],
    staleAfterDays: 7,
    skippedReason: "Kunci layanan ekstraksi otomatis belum tersedia.",
  });
  assert.equal(noKeyMenus.status, "dilewati");
  assert.doesNotMatch(`${noKeyMenus.detail} ${noKeyMenus.issue ?? ""}`, AI_MODEL_PATTERN);

  // Uji kontrak SSE progress: beginRefresh tetap mulai dari 9 langkah inti, lalu updateStep menambahkan langkah dinamis
  beginRefresh("lokal");
  assert.equal(currentRefresh()?.steps.length, REFRESH_STEPS.length);
  for (const step of REFRESH_STEPS) updateStep(step.key, "berhasil", "Selesai.");
  updateStep("tipe_kamar", "berjalan");
  updateStep("tipe_kamar", "dilewati", skippedRooms.detail);
  updateStep("menu_pesaing", "berjalan");
  updateStep("menu_pesaing", "dilewati", noKeyMenus.detail);
  endRefresh(false);

  const finalState = currentRefresh();
  assert.ok(finalState);
  assert.equal(finalState.failed, false);
  assert.equal(finalState.steps.length, REFRESH_STEPS.length + 2);
  assert.equal(finalState.steps.find((s) => s.key === "tipe_kamar")?.status, "dilewati");
  assert.equal(finalState.steps.find((s) => s.key === "menu_pesaing")?.status, "dilewati");
});

test("invalidateStaleNarrativeCache menghapus cache kg-narrative:* di DB lokal tanpa menyentuh baris lain", async () => {
  const testFp = `kg-narrative:unit-test-${Date.now()}`;
  const sentinelFp = `non-narrative-sentinel-${Date.now()}`;
  await db.marketInsight.create({
    data: {
      fingerprint: testFp,
      activeFingerprint: testFp,
      type: "insight",
      title: "Cache Narasi Uji",
      summary: "Sementara",
      evidence: {},
      sourceReferences: [],
      priority: 1,
      confidence: 80,
      status: "active",
    },
  });
  await db.marketInsight.create({
    data: {
      fingerprint: sentinelFp,
      activeFingerprint: sentinelFp,
      type: "insight",
      title: "Sentinel Non-Narasi Uji",
      summary: "Tidak boleh terhapus",
      evidence: {},
      sourceReferences: [],
      priority: 1,
      confidence: 80,
      status: "active",
    },
  });

  try {
    const deleted = await invalidateStaleNarrativeCache();
    assert.ok(deleted >= 1, "Minimal 1 baris kg-narrative:* harus terhapus");
    const gone = await db.marketInsight.findFirst({ where: { fingerprint: testFp } });
    assert.equal(gone, null, "Baris kg-narrative:* harus sudah dibersihkan");
    const kept = await db.marketInsight.findFirst({ where: { fingerprint: sentinelFp } });
    assert.ok(kept, "Baris selain kg-narrative:* tidak boleh ikut terhapus");
  } finally {
    await db.marketInsight.deleteMany({ where: { fingerprint: { in: [testFp, sentinelFp] } } });
  }
});

test("tanpa GEMINI_API_KEY kedua mesin refresh dilewati secara jujur tanpa menyebut nama mesin AI", async () => {
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const roomRes = await refreshDynamicRoomTypes({ recordRun: false });
    assert.equal(roomRes.attempted, 0);
    assert.ok(roomRes.skippedReason);
    assert.doesNotMatch(roomRes.skippedReason, AI_MODEL_PATTERN);

    const menuRes = await refreshDynamicCompetitorMenus({ recordRun: false });
    assert.equal(menuRes.attempted, 0);
    assert.ok(menuRes.skippedReason);
    assert.doesNotMatch(menuRes.skippedReason, AI_MODEL_PATTERN);
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  }
});

test("DB lokal memuat seluruh properti kamar di CompetitorFact dan loadDynamicHotelRoomTypes membacanya bersih", async () => {
  const rows = await db.competitorFact.findMany({
    where: { section: "kamar", key: "tipe_kamar_terstruktur" },
    select: {
      competitorId: true,
      value: true,
      sourceUrl: true,
      competitor: { select: { name: true, placeId: true } },
    },
  });
  assert.ok(
    rows.length >= HOTEL_ROOM_TYPES.length,
    `Harus ada minimal ${HOTEL_ROOM_TYPES.length} properti tersimpan di CompetitorFact lokal (aktual: ${rows.length})`,
  );
  let totalInDb = 0;
  for (const r of rows) {
    const val = r.value as { roomTypes?: Array<{ name?: unknown; sourceUrl?: unknown }> } | null;
    assert.ok(Array.isArray(val?.roomTypes) && val.roomTypes.length >= 3, `${r.competitor.name}: minimal 3 tipe kamar di CompetitorFact`);
    for (const rt of val.roomTypes) {
      assert.ok(typeof rt.name === "string" && rt.name.trim().length > 0, `${r.competitor.name}: nama tipe kamar wajib terisi`);
    }
    totalInDb += val.roomTypes.length;
  }
  assert.ok(totalInDb > 0, "Total tipe kamar terverifikasi di CompetitorFact lokal harus > 0");

  const dynamicMap = await loadDynamicHotelRoomTypes();
  assert.equal(dynamicMap.size, rows.length, "Jumlah properti hasil loadDynamicHotelRoomTypes sama dengan DB lokal");
  for (const baseline of HOTEL_ROOM_TYPES) {
    const loaded = dynamicMap.get(baseline.hotelId);
    assert.ok(loaded && loaded.roomTypes.length > 0, `Properti ${baseline.hotelId} terbaca dari loadDynamicHotelRoomTypes`);
  }
  const totalLoaded = [...dynamicMap.values()].reduce((sum, p) => sum + p.roomTypes.length, 0);
  assert.ok(totalLoaded >= totalInDb, `Hasil gabungan tipe kamar (${totalLoaded}) tidak boleh kurang dari isi DB (${totalInDb})`);
  const sanghyang = dynamicMap.get("sanghyang");
  assert.ok(sanghyang);
  assert.equal(sanghyang.roomTypes.length, 7);
  assert.equal(sanghyang.roomTypes.find((r) => /krakatau villa/i.test(r.name))?.areaSqm, 70);
  assert.doesNotMatch(JSON.stringify([...dynamicMap.values()]), AI_MODEL_PATTERN);
});

test("aplikasi tunggal Sanghyang Analytics bebas fitur PPTX dan menampung unduhan PDF Insight Pasar di src/", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = process.cwd();

  assert.equal(fs.existsSync(path.join(root, "src/app/(app)/page.tsx")), true, "halaman utama src/app/(app)/page.tsx wajib ada");
  assert.equal(fs.existsSync(path.join(root, "src/app/api/market-intelligence/export-pptx")), false, "endpoint export-pptx harus terhapus");
  assert.equal(fs.existsSync(path.join(root, "src/lib/presentation")), false, "folder presentation harus terhapus");
  assert.equal(fs.existsSync(path.join(root, "tests/unit/presentation-pptx.test.ts")), false, "tes presentation-pptx harus terhapus");

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  assert.equal(pkg.dependencies?.pptxgenjs, undefined, "pptxgenjs harus terhapus dari package.json");

  const insightViewSrc = fs.readFileSync(path.join(root, "src/components/marketing/insight-pasar-view.tsx"), "utf8");
  assert.doesNotMatch(insightViewSrc, /pptx/i, "insight-pasar-view.tsx bebas PPTX");
  assert.match(insightViewSrc, /Download Report/, "tombol unduh PDF tersedia di InsightPasarView");
});

test("Perbarui Semua Data mencakup 6 outlet, jendela tarif 14 malam WIB + sarapan, klasifikasi holistik, dan endpoint /api/market-intelligence/refresh", async () => {
  const { getDynamicStayWindowPairs } = await import("../../src/lib/market/collect-rates");
  const {
    ALL_REFRESH_OUTLETS,
    holisticClassificationOutcome,
    syncHolisticCompetitorClassification,
    syncRoomRatesWindow14ToDb,
  } = await import("../../src/lib/market/full-refresh");
  const { createRefreshHandlers, GET: REFRESH_GET_UNAUTH } = await import("../../src/app/api/market-intelligence/refresh/route");

  assert.deepEqual([...ALL_REFRESH_OUTLETS].sort(), ["dbar", "dbistro", "dragon-beach-club", "dspa", "resort", "sunset-grill"]);
  assert.equal(ALL_REFRESH_OUTLETS.length, 6);

  // 14 malam H+1..H+14 mulai hari ini WIB
  const base = new Date("2026-11-20T12:00:00.000Z"); // 20 Nov 2026 19:00 WIB
  const window14 = getDynamicStayWindowPairs(base, 14);
  assert.equal(window14.length, 14);
  assert.equal(window14[0].checkIn.toISOString().slice(0, 10), "2026-11-21");
  assert.equal(window14[13].checkIn.toISOString().slice(0, 10), "2026-12-04");
  assert.equal(window14[0].label, "weekend", "Sabtu 21 Nov 2026 = weekend");
  assert.equal(window14[1].label, "weekday", "Minggu 22 Nov 2026 = weekday");

  // syncRoomRatesWindow14ToDb dengan crawl stub + DB palsu
  const savedSanghyang: Array<{ packageName: string; observedAt: Date }> = [];
  const savedComp: Array<{ packageName: string; observedAt: Date }> = [];
  const fakeRateDb = {
    competitor: {
      findMany: async () => [{ id: "comp-mambruk", placeId: "mambruk" }],
    },
    sanghyangPriceSnapshot: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }: { data: { packageName: string; observedAt: Date } }) => {
        savedSanghyang.push(data);
        return {};
      },
    },
    competitorPriceSnapshot: {
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }: { data: { packageName: string; observedAt: Date } }) => {
        savedComp.push(data);
        return {};
      },
    },
  };
  const winSync = await syncRoomRatesWindow14ToDb({
    now: base,
    hotelIds: ["sanghyang", "mambruk"],
    writeJsonFile: false,
    client: fakeRateDb,
    crawl: async () => [
      {
        hotelId: "sanghyang",
        weekday: {
          url: "https://www.google.com/travel/hotels/entity/test-sh",
          offers: [{ provider: "Agoda", price: 475000 }],
          rooms: [
            { provider: "Agoda", room: "Deluxe Room", detail: "Free breakfast", price: 665000 },
            { provider: "Agoda", room: "Deluxe Room", detail: "Room only", price: 475000 },
          ],
        },
        weekend: null,
        nights: [],
      },
      {
        hotelId: "mambruk",
        weekday: {
          url: "https://www.google.com/travel/hotels/entity/test-mb",
          offers: [{ provider: "Booking.com", price: 950000 }],
          rooms: [{ provider: "Booking.com", room: "Superior Room", detail: "Breakfast included", price: 950000 }],
        },
        weekend: null,
        nights: [],
      },
    ],
  });
  assert.equal(winSync.windowStart, "2026-11-21");
  assert.equal(winSync.windowEnd, "2026-12-04");
  assert.equal(winSync.snapshotsSaved, 3);
  assert.equal(winSync.breakfastTagged, 2);
  assert.ok(savedSanghyang.some((s) => s.packageName === "Termasuk sarapan" && s.observedAt.getTime() === base.getTime()));
  assert.ok(savedSanghyang.some((s) => s.packageName === "Tanpa sarapan"));
  assert.ok(savedComp.some((s) => s.packageName === "Termasuk sarapan"));

  // syncHolisticCompetitorClassification menilai ulang SEMUA kompetitor (bukan hanya kandidat baru) dari rekaman asli
  // daftar kompetitor DB lokal 21 Nov 2026, menulis dengan OCC, tidak pernah menghapus, dan menghormati keputusan pemakai.
  const registry = await holisticRegistryFixture();
  // Fixture direkam sesudah audit 21 Nov; status beberapa baris dikembalikan ke isi DB sebelum audit itu.
  const PRE_AUDIT: Record<string, Record<string, unknown>> = {
    "Mambruk Hotel & Convention": { active: true, compsetRole: "inti", outlets: ["resort"], retiredReason: null },
    "Aston Anyer Beach Hotel": { active: true, compsetRole: "inti", outlets: ["resort"], retiredReason: null },
    "My Pisita Anyer Resort": { active: true, compsetRole: "inti", outlets: ["resort"], retiredReason: null },
    "Infinity Restaurant Mambruk": { active: true, compsetRole: "inti", outlets: ["dbistro"], retiredReason: null },
    "Hawaii Resort Family Suites Anyer": {
      active: false,
      compsetRole: null,
      outlets: ["resort"],
      retiredReason: "Properti timeshare/keanggotaan bintang 3 di 18,2 km, di bawah standar minimum bintang 4 penginapan sejenis Sanghyang.",
    },
  };
  registry.candidates = registry.candidates.map((c) => ({ ...c, ...(PRE_AUDIT[c.name] ?? {}) }));
  const idOf = (name: string) => registry.candidates.find((c) => c.name === name)?.id as string;
  const conflictId = idOf("Aston Anyer Beach Hotel");
  const holisticUpdates: Array<{ where: { id?: unknown; version?: unknown }; data: Record<string, unknown> }> = [];
  const fakeHolisticDb = {
    competitor: {
      updateMany: async (args: { where: { id?: unknown; version?: unknown }; data: Record<string, unknown> }) => {
        holisticUpdates.push(args);
        // Baris Aston dianggap sudah disunting proses lain: versi tidak cocok, 0 baris berubah.
        return { count: args.where.version !== undefined && args.where.id === conflictId ? 0 : 1 };
      },
    },
  };
  const hRes = await syncHolisticCompetitorClassification({
    client: fakeHolisticDb,
    load: async () => ({ candidates: registry.candidates, references: registry.references }) as never,
  });
  assert.equal(hRes.evaluated, registry.candidates.length, "seluruh baris daftar kompetitor dinilai ulang");
  const occUpdates = holisticUpdates.filter((u) => u.where.version !== undefined);
  assert.ok(occUpdates.length >= 5, `kompetitor lama ikut dihitung ulang (${occUpdates.length} pembaruan)`);
  for (const u of occUpdates) {
    assert.equal(typeof u.where.id, "string");
    assert.deepEqual(u.data.version, { increment: 1 }, "OCC: versi naik satu");
  }
  const mambrukUpdate = occUpdates.find((u) => u.where.id === idOf("Mambruk Hotel & Convention"));
  assert.equal(mambrukUpdate?.data.compsetRole, "benchmark", "Mambruk (tarif 213% Sanghyang) dihitung ulang menjadi acuan");
  assert.equal(occUpdates.find((u) => u.where.id === idOf("Hawaii Resort Family Suites Anyer"))?.data.active, true);
  for (const name of ["Allisa Resort Anyer", "Anyer Wonderland", "Sunset Bar & Lounge ASTON"]) {
    assert.ok(!occUpdates.some((u) => u.where.id === idOf(name)), `${name}: keputusan pemakai tidak ditimpa`);
  }
  assert.ok(hRes.failures.some((f) => f.startsWith("Aston Anyer Beach Hotel") && /OCC/.test(f)), "konflik versi dilaporkan, tidak ditelan");
  assert.ok(hRes.changed >= 4 && hRes.protectedRows >= 3);
  assert.equal(hRes.applied, true);
  // Menilai ulang bukan membaca situs: tanggal periksa (verifiedAt) tidak disentuh, dan tidak ada tulisan massal tanpa OCC.
  for (const u of holisticUpdates) {
    assert.equal("verifiedAt" in u.data, false, `langkah klasifikasi tidak menulis verifiedAt (${String(u.where.id)})`);
    assert.notEqual(u.where.version, undefined, "setiap tulisan memakai OCC");
  }
  const hOutcome = holisticClassificationOutcome(hRes);
  assert.equal(hOutcome.status, "sebagian", "satu konflik OCC membuat langkah berstatus sebagian");
  assert.match(hOutcome.detail, /dinilai ulang/);
  assert.doesNotMatch(hOutcome.detail, AI_MODEL_PATTERN);
  assert.doesNotMatch(hOutcome.detail, /\bpesaing\b|\bregistri\b|crawl4ai|playwright/i);

  // Endpoint /api/market-intelligence/refresh wajib autentikasi & selalu mencakup semua 6 outlet
  const unauth = await REFRESH_GET_UNAUTH();
  assert.equal(unauth.status, 401);
  const { GET: REFRESH_GET } = createRefreshHandlers({ checkAccess: async () => null });
  const authRes = await REFRESH_GET();
  assert.equal(authRes.status, 200);
  const body = (await authRes.json()) as { scope: string; outlets: string[] };
  assert.equal(body.scope, "all-outlets");
  assert.equal(body.outlets.length, 6);
});

test("keputusan pemakai di retiredReason ikut dipindah ke notes dalam pembaruan OCC yang sama saat baris diaktifkan", async () => {
  const { syncHolisticCompetitorClassification } = await import("../../src/lib/market/full-refresh");
  const registry = await holisticRegistryFixture();
  const NAME = "BM Seaside View Cafe & Resto";
  // Menu dinamis tempat ini mendapat satu minuman beralkohol (baris bir dari rekaman yang sama), sehingga DBC yang tidak
  // dikunci merekomendasikannya, padahal keputusan Sunset Grill-nya tersimpan di retiredReason.
  const beer = registry.candidates.find((c) => c.name === "Campo del Sol Pool Bar Marbella")?.input.menuItems?.find((m) => m.category === "BEER");
  assert.ok(beer);
  const candidates = registry.candidates.map((c) =>
    c.name === NAME ? { ...c, input: { ...c.input, menuItems: [...(c.input.menuItems ?? []), beer] } } : c,
  );
  const bm = candidates.find((c) => c.name === NAME)!;
  assert.match(bm.retiredReason ?? "", /^Keputusan pemakai 20 Nov 2026: bukan kompetitor Sunset Grill\./);
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const fakeDb = {
    competitor: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(args);
        return { count: 1 };
      },
    },
  };
  const res = await syncHolisticCompetitorClassification({
    client: fakeDb,
    load: async () => ({ candidates, references: registry.references }) as never,
  });
  assert.equal(res.failures.length, 0);
  const update = updates.find((u) => u.where.id === bm.id);
  assert.ok(update, "baris BM Seaside ditulis");
  assert.deepEqual(update.where, { id: bm.id, version: bm.version });
  assert.equal(update.data.active, true);
  assert.equal(update.data.retiredReason, null);
  const notes = String(update.data.notes);
  assert.ok(notes.startsWith(bm.notes ?? ""), "isi notes lama tetap utuh");
  assert.equal(notes.split("Keputusan pemakai 20 Nov 2026: bukan kompetitor Sunset Grill.").length - 1, 1, notes);
  assert.equal("verifiedAt" in update.data, false);
});

test("klasifikasi kompetitor hanya diterapkan dari mesin kerja lokal; CI dan produksi memakai mode laporan tanpa menulis", async () => {
  const { holisticClassificationStep, isLocalWorkstationRun, syncHolisticCompetitorClassification } = await import("../../src/lib/market/full-refresh");
  assert.equal(isLocalWorkstationRun("lokal", {}), true);
  assert.equal(isLocalWorkstationRun("lokal", { GITHUB_ACTIONS: "true" }), false);
  assert.equal(isLocalWorkstationRun("github", { CI: "true", GITHUB_ACTIONS: "true" }), false);

  const registry = await holisticRegistryFixture();
  // Status Mambruk sebelum audit 21 Nov (inti), supaya ada perubahan yang akan terjadi bila diterapkan.
  const candidates = registry.candidates.map((c) =>
    c.name === "Mambruk Hotel & Convention" ? { ...c, compsetRole: "inti" } : c,
  );
  const writes: unknown[] = [];
  const fakeDb = {
    competitor: {
      updateMany: async (args: unknown) => {
        writes.push(args);
        return { count: 1 };
      },
    },
  };
  const load = async () => ({ candidates, references: registry.references }) as never;
  const sync = (options: { apply: boolean }) => syncHolisticCompetitorClassification({ ...options, client: fakeDb, load });

  for (const run of [
    { origin: "github" as const, env: { CI: "true", GITHUB_ACTIONS: "true" } },
    { origin: "lokal" as const, env: { GITHUB_ACTIONS: "true" } },
  ]) {
    const outcome = await holisticClassificationStep({ ...run, writableDb: true, sync });
    assert.equal(writes.length, 0, `${run.origin}: mode laporan tidak menulis apa pun`);
    assert.equal(outcome.status, "berhasil");
    assert.equal(outcome.issue, null);
    assert.match(outcome.detail, /^Mode laporan/);
    assert.match(outcome.detail, /1 akan berubah bila diterapkan dari mesin kerja lokal/);
    assert.match(outcome.detail, /tidak menulis/);
    assert.doesNotMatch(outcome.detail, AI_MODEL_PATTERN);
    assert.doesNotMatch(outcome.detail, /\bpesaing\b|\bregistri\b|ADR/i);
  }
  // Mode laporan hanya membaca, jadi tetap berjalan walau DB baca-saja.
  const readOnlyReport = await holisticClassificationStep({ origin: "github", env: { GITHUB_ACTIONS: "true" }, writableDb: false, sync });
  assert.match(readOnlyReport.detail, /^Mode laporan/);
  assert.equal(writes.length, 0);

  const local = await holisticClassificationStep({ origin: "lokal", env: {}, writableDb: true, sync });
  assert.equal(writes.length, 1, "mesin kerja lokal menerapkan perubahan dengan OCC");
  assert.doesNotMatch(local.detail, /Mode laporan/);
  assert.match(local.detail, /1 berubah/);

  const readOnly = await holisticClassificationStep({ origin: "lokal", env: {}, writableDb: false, sync });
  assert.equal(readOnly.status, "dilewati");
  const skipped = await holisticClassificationStep({ origin: "lokal", env: {}, writableDb: true, skip: true, sync });
  assert.equal(skipped.status, "dilewati");
  assert.equal(writes.length, 1);
});

test("snapshot tarif jendela 14 malam: sumber tidak diketahui disimpan null, dan pembaruan memakai OCC", async () => {
  const { syncRoomRatesWindow14ToDb } = await import("../../src/lib/market/full-refresh");
  const base = new Date("2026-11-20T12:00:00.000Z");
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ table: string; where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const fakeDb = {
    competitor: { findMany: async () => [{ id: "comp-mambruk", placeId: "mambruk" }] },
    sanghyangPriceSnapshot: {
      // Snapshot Sanghyang yang sama sudah ada di jendela batch ini: diperbarui, bukan dibuat ganda.
      findFirst: async () => ({ id: "snap-sh", version: 3 }),
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updated.push({ table: "sanghyang", ...args });
        return { count: 1 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {};
      },
    },
    competitorPriceSnapshot: {
      findFirst: async () => ({ id: "snap-mb", version: 7 }),
      // Proses lain sudah mengubah snapshot ini sejak dibaca: 0 baris, harus dilaporkan.
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updated.push({ table: "competitor", ...args });
        return { count: 0 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {};
      },
    },
  };
  const res = await syncRoomRatesWindow14ToDb({
    now: base,
    hotelIds: ["sanghyang", "mambruk"],
    writeJsonFile: false,
    client: fakeDb,
    crawl: async () => [
      {
        hotelId: "sanghyang",
        weekday: { url: "", offers: [{ provider: "Agoda", price: 475000 }], rooms: [{ provider: "Agoda", room: "Deluxe Room", detail: "Room only", price: 475000 }] },
        weekend: null,
        nights: [],
      },
      {
        hotelId: "mambruk",
        weekday: {
          url: "https://www.google.com/travel/hotels/entity/test-mb",
          offers: [{ provider: "Booking.com", price: 950000 }],
          rooms: [{ provider: "Booking.com", room: "Superior Room", detail: "Breakfast included", price: 950000 }],
        },
        weekend: null,
        nights: [],
      },
    ],
  });
  assert.equal(created.length, 0);
  const sh = updated.find((u) => u.table === "sanghyang");
  assert.ok(sh);
  assert.deepEqual(sh.where, { id: "snap-sh", version: 3 });
  assert.deepEqual(sh.data.version, { increment: 1 });
  assert.equal(sh.data.sourceUrl, null, "sumber yang tidak tercatat = null, bukan URL umum Google Travel");
  const mb = updated.find((u) => u.table === "competitor");
  assert.deepEqual(mb?.where, { id: "snap-mb", version: 7 });
  assert.equal(mb?.data.sourceUrl, "https://www.google.com/travel/hotels/entity/test-mb");
  assert.equal(res.snapshotsSaved, 1, "snapshot yang kalah OCC tidak dihitung tersimpan");
  assert.ok(res.failures.some((f) => /OCC/.test(f) && /Superior Room/.test(f)), res.failures.join("; "));
});
