/**
 * Unit test untuk spesifikasi tipe kamar 10 properti Kamar & Resort (Sanghyang + 9 pembanding inti).
 * Menegakkan Zero Mock Data, aturan prioritas situs resmi atas OTA, kelengkapan data Sanghyang,
 * dan 0 penyebutan nama mesin/model AI.
 *
 * Jalankan:
 * node --env-file-if-exists=.env.development.local node_modules/tsx/dist/cli.mjs --test tests/unit/hotel-room-types.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { COMPSET_HOTELS } from "../../src/lib/market/hotel-compset";
import {
  HOTEL_ROOM_TYPES,
  formatAreaSqm,
  getHotelRoomTypes,
  inferOfficialBreakfastFromHighlights,
  resolveRoomTypeSpec,
  sanitizeAiModelText,
  sanitizePublicText,
  type HotelRoomTypeSpec,
} from "../../src/lib/market/hotel-room-types";

const AI_MODEL_PATTERN = /\b(gemini|flash[- ]?lite|claude|openai|chatgpt|gpt-?\d|llm)\b/i;
const VALID_CATEGORIES = new Set(["standard", "suite", "villa", "condo", "cottage"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

test("setiap properti di hotel-compset.data.json punya profil tipe kamar dengan >= 2 tipe terverifikasi", () => {
  // Daftar properti mengikuti penataan kompetitor (bisa bertambah atau berkurang), jadi jumlahnya tidak ditulis tetap.
  const expectedIds = COMPSET_HOTELS.map((h) => h.hotelId);
  assert.ok(expectedIds.length >= 2, `minimal Sanghyang dan satu kompetitor (ditemukan ${expectedIds.length})`);
  assert.ok(HOTEL_ROOM_TYPES.length >= expectedIds.length, "setiap properti punya profil tipe kamar");

  for (const hotelId of expectedIds) {
    const profile = getHotelRoomTypes(hotelId);
    assert.ok(profile, `Profil tipe kamar untuk ${hotelId} tidak ditemukan`);
    assert.equal(profile.hotelId, hotelId);
    assert.ok(profile.roomTypes.length >= 2, `${hotelId} wajib punya >= 2 tipe kamar (ada ${profile.roomTypes.length})`);

    for (const rt of profile.roomTypes) {
      assert.ok(rt.name.trim().length > 0, `${hotelId}: nama tipe kamar kosong`);
      assert.ok(VALID_CATEGORIES.has(rt.category), `${hotelId}/${rt.name}: kategori tidak sah (${rt.category})`);
      assert.match(rt.sourceUrl, /^https?:\/\/.+/, `${hotelId}/${rt.name}: sourceUrl tidak sah (${rt.sourceUrl})`);
      assert.ok(rt.sourceLabel.trim().length > 0, `${hotelId}/${rt.name}: sourceLabel kosong`);
      assert.ok(rt.sourcePriority === "official" || rt.sourcePriority === "ota", `${hotelId}/${rt.name}: sourcePriority tidak sah`);
      assert.match(rt.observedAt, ISO_DATE, `${hotelId}/${rt.name}: observedAt harus YYYY-MM-DD`);
      assert.ok(rt.highlights.length <= 3, `${hotelId}/${rt.name}: highlights maksimal 3 poin`);
      if (rt.areaSqm !== null) {
        assert.ok(rt.areaSqm > 0, `${hotelId}/${rt.name}: areaSqm harus positif jika bukan null`);
      }
      if (rt.weekdayPrice !== null) {
        assert.ok(rt.weekdayPrice > 0, `${hotelId}/${rt.name}: weekdayPrice harus positif`);
        assert.ok(rt.priceSource && rt.priceSource.trim().length > 0, `${hotelId}/${rt.name}: priceSource wajib diisi bila ada harga`);
      }
      if (rt.weekendPrice !== null) {
        assert.ok(rt.weekendPrice > 0, `${hotelId}/${rt.name}: weekendPrice harus positif`);
        assert.ok(rt.priceSource && rt.priceSource.trim().length > 0, `${hotelId}/${rt.name}: priceSource wajib diisi bila ada harga`);
      }
    }

    const has2Br = profile.roomTypes.some((rt) => (rt.bedrooms ?? 0) >= 2);
    assert.equal(
      profile.hasMultiBedroomUnit,
      has2Br,
      `${hotelId}: hasMultiBedroomUnit (${profile.hasMultiBedroomUnit}) harus konsisten dengan bedrooms >= 2 (${has2Br})`,
    );
  }
});

test("Sanghyang Indah Spa Resort memuat seluruh 7 tipe kamar resmi sanghyang.com termasuk Krakatau Villa 70 m² dan New Baduy Condo 2 kamar", () => {
  const sh = getHotelRoomTypes("sanghyang");
  assert.ok(sh, "Profil Sanghyang tidak ditemukan");
  assert.equal(sh.roomTypes.length, 7, "sanghyang.com/rooms resmi memiliki 7 tipe kamar");
  assert.equal(sh.hasMultiBedroomUnit, true);

  const krakatauVilla = sh.roomTypes.find((r) => /krakatau villa/i.test(r.name));
  assert.ok(krakatauVilla, "Krakatau Villa wajib tercatat");
  assert.equal(krakatauVilla.areaSqm, 70, "Krakatau Villa di sanghyang.com resmi berukuran 70 m²");
  assert.equal(formatAreaSqm(krakatauVilla), "70 m²");
  assert.equal(krakatauVilla.sourcePriority, "official");
  assert.match(krakatauVilla.sourceUrl, /^https:\/\/sanghyang\.com\/rooms/);

  const baduyCondo = sh.roomTypes.find((r) => /baduy condo/i.test(r.name));
  assert.ok(baduyCondo, "New Baduy Condo wajib tercatat");
  assert.equal(baduyCondo.bedrooms, 2, "New Baduy Condo memiliki 2 kamar tidur di lantai atas");
  assert.equal(baduyCondo.areaSqm, 60, "New Baduy Condo resmi berukuran 60 m²");
  assert.equal(baduyCondo.category, "condo");

  const deluxe = sh.roomTypes.find((r) => /sanghyang deluxe/i.test(r.name));
  assert.ok(deluxe, "Sanghyang Deluxe wajib tercatat");
  assert.equal(deluxe.areaSqm, 25, "Sanghyang Deluxe di sanghyang.com resmi berukuran 25 m²");

  const suite = sh.roomTypes.find((r) => /sanghyang suite/i.test(r.name));
  assert.ok(suite, "Sanghyang Suite wajib tercatat");
  assert.equal(suite.areaSqm, 28, "Sanghyang Suite resmi berukuran 28 m²");
  assert.equal(suite.bathtub, true, "Sanghyang Suite memiliki bathtub menurut sanghyang.com");
});

test("getHotelRoomTypes mendukung pencarian berdasarkan hotelId, alias, dan nama properti", () => {
  assert.equal(getHotelRoomTypes("movenpick")?.hotelId, "movenpick");
  assert.equal(getHotelRoomTypes("movenpick_carita")?.hotelId, "movenpick");
  assert.equal(getHotelRoomTypes("Mövenpick Resort Carita")?.hotelId, "movenpick");
  assert.equal(getHotelRoomTypes("Movenpick Resort Carita")?.hotelId, "movenpick");
  assert.equal(getHotelRoomTypes("The Jayakarta Villas Anyer Beach Resort")?.hotelId, "jayakarta");
  assert.equal(getHotelRoomTypes("Novus Jiva Anyer Villa, Resort & Spa")?.hotelId, "novus_jiva");
  assert.equal(getHotelRoomTypes("tidak_ada_hotel_ini"), null);
});

test("resolveRoomTypeSpec selalu memenangkan situs resmi atas OTA saat terjadi bentrok dan mencatat conflictNote", () => {
  const official: Partial<HotelRoomTypeSpec> = {
    name: "Krakatau Villa",
    category: "villa",
    bedrooms: 2,
    areaSqm: 70,
    areaLabel: "70 m²",
    smartTv: false,
    bathtub: false,
    highlights: ["2 kamar tidur", "Taman tropis", "Pantry dapur"],
    sourcePriority: "official",
    sourceLabel: "Situs resmi sanghyang.com",
    sourceUrl: "https://sanghyang.com/rooms/krakatau-villa",
    observedAt: "2026-11-19",
  };
  const ota: Partial<HotelRoomTypeSpec> = {
    name: "Krakatau Cottage Villa",
    category: "cottage",
    bedrooms: 2,
    areaSqm: 85,
    areaLabel: "85 m²",
    smartTv: true,
    bathtub: true,
    highlights: ["Villa 2 kamar"],
    weekdayPrice: 1450000,
    weekendPrice: 2100000,
    priceSource: "Booking.com",
    sourcePriority: "ota",
    sourceLabel: "Booking.com",
    sourceUrl: "https://www.booking.com/hotel/id/sanghyang-indah-spa-resort.html",
    observedAt: "2026-11-19",
  };

  const merged = resolveRoomTypeSpec(official, ota);
  assert.equal(merged.name, "Krakatau Villa");
  assert.equal(merged.category, "villa");
  assert.equal(merged.areaSqm, 70);
  assert.equal(merged.areaLabel, "70 m²");
  assert.equal(merged.smartTv, false);
  assert.equal(merged.bathtub, false);
  assert.equal(merged.sourcePriority, "official");
  assert.equal(merged.sourceUrl, "https://sanghyang.com/rooms/krakatau-villa");
  // Kolom kosong di situs resmi (harga OTA) boleh dilengkapi dari OTA tanpa menimpa fakta resmi
  assert.equal(merged.weekdayPrice, 1450000);
  assert.equal(merged.weekendPrice, 2100000);
  assert.equal(merged.priceSource, "Booking.com");
  assert.ok(merged.conflictNote && merged.conflictNote.includes("85") && merged.conflictNote.includes("70"));
});

test("resolveRoomTypeSpec memakai OTA bila situs resmi tidak tersedia, dan gagal cepat bila keduanya kosong", () => {
  const otaOnly = resolveRoomTypeSpec(null, {
    name: "Karang Bolong",
    category: "cottage",
    bedrooms: 2,
    areaSqm: 32,
    areaLabel: "32–33 m²",
    smartTv: null,
    bathtub: false,
    highlights: ["2 kamar tidur", "Tepi pantai"],
    weekdayPrice: null,
    weekendPrice: null,
    priceSource: null,
    sourcePriority: "ota",
    sourceLabel: "Traveloka",
    sourceUrl: "https://www.traveloka.com/id-id/hotel/indonesia/my-pisita-anyer-resort",
    observedAt: "2026-11-19",
  });
  assert.equal(otaOnly.sourcePriority, "ota");
  assert.equal(otaOnly.areaSqm, 32);

  assert.throws(() => resolveRoomTypeSpec(null, null), /sumber|wajib/i);
});

test("formatAreaSqm memformat luas resmi atau menampilkan 'Belum ada data' saat kosong", () => {
  assert.equal(formatAreaSqm({ areaSqm: 70, areaLabel: "70 m²" }), "70 m²");
  assert.equal(formatAreaSqm({ areaSqm: 42.2, areaLabel: null }), "42,2 m²");
  assert.equal(formatAreaSqm({ areaSqm: 32, areaLabel: "32–33 m²" }), "32–33 m²");
  assert.equal(formatAreaSqm({ areaSqm: null, areaLabel: null }), "Belum ada data");
});

test("0 penyebutan nama mesin atau model AI di seluruh hotel-room-types.data.json", () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "src/lib/market/hotel-room-types.data.json"),
    "utf8",
  );
  const match = raw.match(AI_MODEL_PATTERN);
  assert.equal(match, null, `Ditemukan penyebutan nama mesin AI di JSON: ${match?.[0]}`);
});

test("konsistensi data resmi 9 pembanding aktif (multi-kamar, luas resmi, Smart TV, dan tanpa duplikasi nama)", () => {
  const seenHotelIds = new Set<string>();
  for (const h of HOTEL_ROOM_TYPES) {
    assert.equal(seenHotelIds.has(h.hotelId), false, `Duplikat hotelId: ${h.hotelId}`);
    seenHotelIds.add(h.hotelId);
    const seenRooms = new Set<string>();
    for (const r of h.roomTypes) {
      const k = r.name.toLowerCase();
      assert.equal(seenRooms.has(k), false, `Duplikat tipe kamar ${r.name} pada ${h.hotelId}`);
      seenRooms.add(k);
    }
  }

  const mambruk = getHotelRoomTypes("mambruk")!;
  assert.equal(mambruk.roomTypes.find((r) => r.name === "Villa")?.areaSqm, 207);
  assert.equal(mambruk.roomTypes.find((r) => r.name === "Presidential Suite")?.areaSqm, 715);

  const aston = getHotelRoomTypes("aston_anyer")!;
  assert.equal(aston.hasMultiBedroomUnit, false);
  assert.equal(aston.roomTypes.every((r) => r.smartTv === true), true);
  assert.equal(aston.roomTypes.find((r) => r.name === "Aquavillas")?.areaSqm, 125);

  const movenpick = getHotelRoomTypes("movenpick")!;
  assert.equal(movenpick.hasMultiBedroomUnit, false);
  assert.equal(movenpick.roomTypes.find((r) => /deluxe double/i.test(r.name))?.areaSqm, 45);
  assert.equal(movenpick.roomTypes.find((r) => /junior suite/i.test(r.name))?.areaSqm, 70);
  assert.equal(movenpick.roomTypes.every((r) => r.smartTv === true), true);

  const novus = getHotelRoomTypes("novus_jiva")!;
  assert.equal(novus.hasMultiBedroomUnit, true);
  assert.equal(novus.roomTypes.find((r) => r.name === "Bluewave Pool Villa")?.areaSqm, 142);

  const marbella = getHotelRoomTypes("marbella")!;
  assert.equal(marbella.roomTypes.find((r) => r.name === "Executive Suite")?.bedrooms, 2);
  assert.equal(marbella.roomTypes.find((r) => r.name === "Four Bedroom Suite")?.areaSqm, 240);

  const jayakarta = getHotelRoomTypes("jayakarta")!;
  assert.equal(jayakarta.roomTypes.find((r) => /samudra pasifik/i.test(r.name))?.areaSqm, 66);
  assert.equal(jayakarta.roomTypes.find((r) => /samudra indonesia/i.test(r.name))?.areaSqm, 110);

  const nemuru = getHotelRoomTypes("nemuru_palazo")!;
  assert.equal(nemuru.roomTypes.length, 4);
  assert.equal(nemuru.roomTypes.every((r) => r.smartTv === true), true);

  const hawaii = getHotelRoomTypes("hawaii_anyer")!;
  assert.equal(hawaii.roomTypes.find((r) => r.name === "Studio Standard")?.areaSqm, 22.5);
  assert.equal(hawaii.roomTypes.find((r) => r.name === "Two Bedroom Standard")?.areaSqm, 58.5);
  assert.equal(hawaii.roomTypes.find((r) => r.name === "Presidential Suites")?.areaSqm, 325.5);

  const pisita = getHotelRoomTypes("my_pisita_anyer")!;
  assert.equal(pisita.roomTypes.length, 6);
  assert.equal(pisita.roomTypes.find((r) => r.name === "Maisonette")?.areaSqm, null);
  assert.equal(formatAreaSqm(pisita.roomTypes.find((r) => r.name === "Maisonette")!), "Belum ada data");
  assert.equal(
    inferOfficialBreakfastFromHighlights(pisita.roomTypes[0].highlights),
    true,
    "My Pisita mencantumkan Termasuk sarapan di poin spesifikasi resmi",
  );

  assert.equal(
    sanitizeAiModelText("Listing Google Maps RM 195 Seafood (diperiksa Crawl4AI 17 Nov 2026)"),
    "Listing Google Maps RM 195 Seafood (terakhir diperiksa 17 Nov 2026)",
  );
  assert.equal(
    sanitizePublicText("Data dari registri pesaing aktif (diperiksa Crawl4AI 17 Nov 2026)"),
    "Data dari daftar kompetitor aktif (terakhir diperiksa 17 Nov 2026)",
  );
});
