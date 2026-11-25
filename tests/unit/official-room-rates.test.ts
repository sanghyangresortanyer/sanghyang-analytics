/**
 * Tarif kamar resmi Sanghyang dari booking engine Exely. Fixture = jawaban asli Exely Connect produksi yang direkam dan
 * disanitasi skrip kontrak sanghyang_web (scripts/exely/contract-readonly.ts --record, 13 Okt 2026), salinan byte-identik
 * dari sanghyang_web/tests/fixtures/exely/search-room-stays.json (sha256 cd2cf94c…31e7) dan content-property.json
 * (sha256 dc12010f…134e): Search API room-stays 12-13 Nov 2026 untuk 2 dewasa, dan Content API properti.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import roomStaysFixture from "../fixtures/exely-search-room-stays-2026-10-13.json";
import contentFixture from "../fixtures/exely-content-property-2026-10-13.json";
import otaLayerFixture from "../fixtures/resort-room-rates-2026-11-10.json";
import roomTypesData from "../../src/lib/market/hotel-room-types.data.json";
import committedFile from "../../src/lib/market/official-room-rates.data.json";
import { otaStayDates } from "../../src/lib/market/official-room-rates-refresh";
import {
  bookDeepLink,
  breakfastFromMealPlan,
  buildOfficialRoomRatesFile,
  cheapestOffer,
  engineOffers,
  ExelyCredentialsMissingError,
  exelyConfigFromEnv,
  exelyPropertyContentSchema,
  exelyRoomStaysSchema,
  mapEngineRooms,
  officialRoomRatesFor,
  officialRoomRatesOf,
  officialRoomRatesSource,
  officialRoomRatesSourceOf,
  parseOfficialRoomRatesFile,
  pendingOfficialRoomRatesFile,
  validateOfficialRoomRates,
  type OfficialCrawlInput,
} from "../../src/lib/market/official-room-rates";

const content = exelyPropertyContentSchema.parse(contentFixture.response.body);
const roomStays = exelyRoomStaysSchema.parse(roomStaysFixture.response.body);
const recordedNight = {
  checkIn: roomStaysFixture.request.query.arrivalDate,
  checkOut: roomStaysFixture.request.query.departureDate,
  adults: Number(roomStaysFixture.request.query.adults),
};
const catalog = roomTypesData.hotels.find((h) => h.hotelId === "sanghyang")!.roomTypes.map((r) => r.name);
/** Tujuan pengalihan bookingFormLink yang diamati 21 Nov 2026: 308 -> 301 -> 200 di https://sanghyang.com/book. */
const BOOK_PAGE = "https://sanghyang.com/book";
const REQUEST = {
  api: "Exely Connect Search API",
  contentPath: "/api/content/v1/properties/{EXELY_PROPERTY_ID}?languageCode=en",
  searchPath: "/api/search/v1/properties/{EXELY_PROPERTY_ID}/room-stays",
  datesFrom: "tes: malam yang direkam fixture",
};
/** Malam lain dengan jawaban yang sama: semua penawaran fixture jatuh di 12-13 Nov, jadi untuk malam ini tidak ada yang cocok. */
const otherSaturday = { checkIn: "2026-11-14", checkOut: "2026-11-15", adults: 2 };

const crawlInput = (weekday: { checkIn: string; checkOut: string; adults: number }): OfficialCrawlInput => ({
  hotelId: "sanghyang",
  catalogRoomNames: catalog,
  content,
  stays: { weekday: { ...weekday, response: roomStays }, weekend: { ...otherSaturday, response: roomStays } },
  bookPageUrl: BOOK_PAGE,
  observedAt: new Date("2026-10-13T00:00:00.000Z"),
  request: REQUEST,
});

test("jawaban Search API asli: 14 penawaran untuk malam yang diminta, harga termasuk pajak, sarapan dari paket makan", () => {
  const { offers, skipped } = engineOffers(roomStays, content, recordedNight);
  assert.equal(offers.length, 14);
  assert.equal(skipped.length, 0);
  const deluxe = offers.filter((o) => o.engineRoomTypeId === "5004758").map((o) => [o.ratePlan, o.price, o.breakfastIncluded, o.mealPlanCode, o.roomsLeft]);
  assert.deepEqual(deluxe, [
    ["Best Deal: Room Only", 475000, false, "RoomOnly", 5],
    ["Best Deal: Room Breakfast", 1710000, true, "BreakFast", 5],
  ]);
  // Okupansi jawaban harus sama dengan permintaan; selain itu harga tidak sebanding dengan lapisan OTA.
  assert.throws(() => engineOffers(roomStays, content, { ...recordedNight, adults: 4 }), /diminta 4 dewasa/);
  const withoutBestDeal = { ...content, ratePlans: content.ratePlans.filter((p) => p.id !== "10118582") };
  assert.throws(() => engineOffers(roomStays, withoutBestDeal, recordedNight), /rate plan 10118582 tidak ada di Content API/);
});

test("status sarapan hanya dari yang tertulis: BreakFast = ya, RoomOnly = tidak, kode lain = belum tercatat", () => {
  assert.equal(breakfastFromMealPlan("BreakFast", []), true);
  assert.equal(breakfastFromMealPlan(null, [null, "BreakFast"]), true);
  assert.equal(breakfastFromMealPlan("RoomOnly", [null, null]), false);
  assert.equal(breakfastFromMealPlan("Dinner", [null]), null);
});

test("ketujuh tipe kamar engine terpetakan ke nama persis katalog, termurah per tipe kamar", () => {
  const mapping = mapEngineRooms(content.roomTypes, catalog);
  assert.deepEqual(mapping.unmapped, []);
  assert.deepEqual(mapping.catalogWithoutEngine, []);
  const { offers } = engineOffers(roomStays, content, recordedNight);
  const cheapestByRoom = Object.fromEntries(
    mapping.mapped.map((m) => [m.roomName, cheapestOffer(offers.filter((o) => o.engineRoomTypeId === m.engineRoomTypeId))?.price ?? null]),
  );
  assert.deepEqual(cheapestByRoom, {
    "Sanghyang Deluxe": 475000,
    "Sanghyang Suite": 617500,
    "New Baduy Condo": 760000,
    "Krakatau Villa": 855000,
    "Krakatau Beach View": 1045000,
    "Krakatau Suite": 1235000,
    "Baduy Suite": 1900000,
  });
});

test("kamar yang namanya tidak ada di katalog dilaporkan, alias hanya bila eksplisit", () => {
  const partial = mapEngineRooms(content.roomTypes, catalog.filter((name) => name !== "Baduy Suite"));
  assert.deepEqual(partial.unmapped.map((u) => u.engineRoomName), ["Baduy Suite"]);
  assert.match(partial.unmapped[0].reason, /tidak ada di katalog/);
  // Nama Google Travel untuk kamar yang sama (bukti resort-room-rates.data.json) tidak dicocokkan secara kira-kira.
  const renamed = content.roomTypes.map((r) => (r.name === "New Baduy Condo" ? { ...r, name: "New Baduy Condo - Two Bedrooms" } : r));
  const guessed = mapEngineRooms(renamed, catalog);
  assert.deepEqual(guessed.unmapped.map((u) => u.engineRoomName), ["New Baduy Condo - Two Bedrooms"]);
  assert.deepEqual(guessed.catalogWithoutEngine, ["New Baduy Condo"]);
  const aliased = mapEngineRooms(renamed, catalog, { "New Baduy Condo - Two Bedrooms": "New Baduy Condo" });
  assert.deepEqual(aliased.unmapped, []);
  assert.equal(aliased.mapped.find((m) => m.roomName === "New Baduy Condo")?.engineRoomName, "New Baduy Condo - Two Bedrooms");
  assert.throws(() => mapEngineRooms(content.roomTypes, catalog, { "Kamar X": "Kamar Di Luar Katalog" }), /tidak ada di katalog/);
  assert.throws(() => mapEngineRooms(renamed, catalog, { "New Baduy Condo - Two Bedrooms": "Sanghyang Deluxe" }), /sama-sama dipetakan/);
});

test("tautan sumber = halaman /book dengan parameter engine, tanpa bahasa bawaan Rusia dan atribusi kanal", () => {
  const link = roomStays.roomStays[0].bookingFormLink;
  assert.match(link, /tl-lng=ru.*utm_source=connectivity-hub/);
  assert.equal(
    bookDeepLink(link, BOOK_PAGE),
    "https://sanghyang.com/book?hotel_id=500776&tl-cur=IDR&tl-adults=2&tl-children-age=&tl-room=5004758&tl-offer=10118582&tl-nights=1&tl-date=2026-11-12",
  );
  assert.equal(bookDeepLink(link, BOOK_PAGE, true), "https://sanghyang.com/book?hotel_id=500776&tl-cur=IDR&tl-adults=2&tl-children-age=&tl-nights=1&tl-date=2026-11-12");
});

test("berkas data: harga per tanggal, kamar tanpa penawaran = null beserta alasan, kontrak baca lapisan resmi", () => {
  const file = buildOfficialRoomRatesFile(crawlInput(recordedNight));
  assert.equal(file.status, "terbaca");
  assert.equal(file.sourceLabel, "Situs resmi sanghyang.com/book");
  assert.equal(file.bookUrl, BOOK_PAGE);
  assert.deepEqual([file.request?.checkInWeekday, file.request?.checkInWeekend, file.request?.adults, file.request?.nights], ["2026-11-12", "2026-11-14", 2, 1]);
  assert.equal(file.hotels[0].skippedOffers.length, 14);
  assert.deepEqual(validateOfficialRoomRates(file), []);

  const rates = officialRoomRatesOf(file, "sanghyang");
  assert.deepEqual(rates.map((r) => r.roomName), catalog);
  const deluxe = rates.find((r) => r.roomName === "Sanghyang Deluxe")!;
  assert.deepEqual(
    [deluxe.weekdayPrice, deluxe.weekendPrice, deluxe.breakfastIncluded, deluxe.ratePlan, deluxe.checkInWeekday, deluxe.checkInWeekend],
    [475000, null, false, "Best Deal: Room Only", "2026-11-12", "2026-11-14"],
  );
  assert.equal(deluxe.sourceUrl, bookDeepLink(roomStays.roomStays[0].bookingFormLink, BOOK_PAGE));
  assert.equal(deluxe.observedAt, "2026-10-13T00:00:00.000Z");
  assert.match(deluxe.weekend.unavailableReason ?? "", /^Tidak ditawarkan booking engine untuk check-in 2026-11-14, 1 malam, 2 dewasa/);
  // Tidak ada satu penawaran pun untuk malam itu, jadi tautannya halaman booking tanpa parameter.
  assert.equal(deluxe.weekend.sourceUrl, BOOK_PAGE);
  assert.deepEqual(officialRoomRatesOf(file, "marbella_place_anyer"), []);
  assert.equal(officialRoomRatesSourceOf(file).checkInWeekend, "2026-11-14");
});

test("engine yang tidak menawarkan satu kamar pun di kedua tanggal tidak menimpa data", () => {
  const nothing = buildOfficialRoomRatesFile(crawlInput({ checkIn: "2026-11-17", checkOut: "2026-11-18", adults: 2 }));
  assert.match(validateOfficialRoomRates(nothing).join("; "), /tidak menawarkan satu kamar pun untuk 2026-11-17 maupun 2026-11-14/);
});

test("berkas rusak ditolak dengan nama kolomnya; status 'belum ada data' wajib beralasan dan tanpa tarif", () => {
  const file = buildOfficialRoomRatesFile(crawlInput(recordedNight));
  const broken = structuredClone(file);
  broken.hotels[0].rooms[0].weekday.unavailableReason = null;
  broken.hotels[0].rooms[0].weekday.price = null;
  assert.throws(() => parseOfficialRoomRatesFile(broken), /harus berisi harga atau alasan/);
  assert.throws(() => parseOfficialRoomRatesFile({ ...file, observedAt: "kemarin" }), /observedAt/);
  assert.throws(() => parseOfficialRoomRatesFile({ ...file, status: "belum ada data", reason: "uji" }), /tidak boleh memuat/);

  const pending = pendingOfficialRoomRatesFile("alasan uji", "Situs resmi (booking engine hotel)");
  assert.deepEqual(officialRoomRatesOf(pending, "sanghyang"), []);
  assert.deepEqual(officialRoomRatesSourceOf(pending), {
    status: "belum ada data",
    reason: "alasan uji",
    sourceLabel: "Situs resmi (booking engine hotel)",
    bookUrl: null,
    observedAt: null,
    checkInWeekday: null,
    checkInWeekend: null,
  });
  assert.throws(() => pendingOfficialRoomRatesFile("", "label"), /reason/);
});

test("berkas data repo lolos validasi dan kontrak bacanya konsisten dengan statusnya", () => {
  const file = parseOfficialRoomRatesFile(committedFile);
  const source = officialRoomRatesSource();
  assert.equal(source.status, file.status);
  const rates = officialRoomRatesFor("sanghyang");
  if (file.status === "belum ada data") {
    assert.ok(source.reason);
    assert.deepEqual(rates, []);
    return;
  }
  assert.equal(source.reason, null);
  assert.ok(rates.length > 0);
  for (const rate of rates) {
    assert.ok(catalog.includes(rate.roomName), rate.roomName);
    assert.equal(rate.checkInWeekday, file.request?.checkInWeekday);
    assert.equal(rate.checkInWeekend, file.request?.checkInWeekend);
    assert.match(rate.sourceUrl, /^https:\/\//);
  }
});

test("tanggal menginap dibaca dari berkas lapisan OTA, 1 malam 2 dewasa; tanggal lewat atau jenis hari salah = galat", () => {
  // Berkas lapisan OTA 10 Nov 2026 (crawl-room-rates.ts): hari biasa Rabu 11 Nov, akhir pekan Sabtu 14 Nov.
  const dates = otaStayDates(otaLayerFixture, "2026-11-10");
  assert.deepEqual(dates.weekday, { checkIn: "2026-11-11", checkOut: "2026-11-12", adults: 2 });
  assert.deepEqual(dates.weekend, { checkIn: "2026-11-14", checkOut: "2026-11-15", adults: 2 });
  assert.equal(dates.capturedAt, "2026-11-10 06:56 WIB");
  assert.throws(() => otaStayDates(otaLayerFixture, "2026-11-12"), /2026-11-11 sudah lewat/);
  assert.throws(() => otaStayDates({ ...otaLayerFixture, checkInWeekday: otaLayerFixture.checkInWeekend }, "2026-11-10"), /bukan malam hari biasa/);
  assert.throws(() => otaStayDates({}, "2026-11-10"), /tidak memuat/);
});

test("kredensial Exely hanya dari env: kosong atau salah bentuk = galat yang menyebut nama variabel, bukan nilainya", () => {
  const isMissing = (keys: string[]) => (error: unknown) =>
    error instanceof ExelyCredentialsMissingError && /^kredensial Exely belum dipasang/.test(error.message) && keys.every((k) => error.message.includes(k));
  assert.throws(() => exelyConfigFromEnv({}), isMissing(["EXELY_API_BASE_URL", "EXELY_CLIENT_ID", "EXELY_CLIENT_SECRET", "EXELY_PROPERTY_ID"]));
  const wrongShape = { EXELY_API_BASE_URL: "http://contoh.invalid", EXELY_CLIENT_ID: "isi-uji-id", EXELY_CLIENT_SECRET: "isi-uji-rahasia", EXELY_PROPERTY_ID: "bukan-angka" };
  assert.throws(
    () => exelyConfigFromEnv(wrongShape),
    (error: unknown) => isMissing(["EXELY_API_BASE_URL", "EXELY_PROPERTY_ID"])(error) && !/isi-uji|contoh\.invalid|bukan-angka/.test((error as Error).message),
  );
});

test("inti pembaruan tarif resmi ada di lib; kode aplikasi tidak mengimpor skrip operasional", () => {
  const root = process.cwd();
  const sources = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? sources(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
    );
  const importsScripts = [...sources("src/lib"), ...sources("src/app")].filter((file) =>
    /(?:from\s+|import\()\s*["'][^"']*scripts\/ops\//.test(readFileSync(path.join(root, file), "utf8")),
  );
  assert.deepEqual(importsScripts, [], "src/lib/ dan src/app/ tidak bergantung pada scripts/ops");
  const cli = readFileSync(path.join(root, "scripts/ops/crawl-official-room-rates.ts"), "utf8");
  assert.match(cli, /from "(?:@\/|\.\.\/\.\.\/src\/)lib\/market\/official-room-rates-refresh"/, "CLI memakai inti yang sama dengan langkah refresh");
});
