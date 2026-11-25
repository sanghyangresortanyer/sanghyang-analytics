import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { compsetIneligibility, isEligibleCore, COMPSET_MAX_ROAD_KM } from "../../src/lib/market/compset";
import { COMPSET_HOTELS, EXCLUDED_HOTELS, calculatePrecisionMarketShare, compsetStars, countsInMarket } from "../../src/lib/market/hotel-compset";
import { isPricingCompetitor } from "../../src/lib/market/resort-room-rates";

test("aturan: penginapan bintang 3 tidak setara dengan Sanghyang bintang 4", () => {
  assert.equal(isEligibleCore({ category: "resort", starRating: 3, roadKm: 1.3 }), false);
  assert.match(compsetIneligibility({ category: "resort", starRating: 2, roadKm: 1.3 }) ?? "", /Bintang 2/);
});

test("aturan: lebih dari 25 km jarak tempuh tidak layak, tepat 25 km masih layak", () => {
  assert.equal(isEligibleCore({ category: "hotel", starRating: 4, roadKm: COMPSET_MAX_ROAD_KM }), true);
  assert.equal(isEligibleCore({ category: "hotel", starRating: 5, roadKm: 25.1 }), false);
  assert.equal(isEligibleCore({ category: "resto", starRating: null, roadKm: 34.3 }), false);
});

test("aturan: jarak atau bintang yang belum diketahui tidak dianggap layak", () => {
  assert.match(compsetIneligibility({ category: "hotel", starRating: 4, roadKm: null }) ?? "", /belum diukur/);
  assert.match(compsetIneligibility({ category: "resort", starRating: null, roadKm: 5 }) ?? "", /belum diketahui/);
  assert.equal(isEligibleCore({ category: "resto", starRating: null, roadKm: 2.1 }), true);
});

test("data harga: setiap pembanding inti memenuhi aturan, dan hotel yang dikeluarkan tidak dipakai", () => {
  for (const h of COMPSET_HOTELS.filter((x) => x.compsetRole === "inti")) {
    assert.equal(
      // Bintang dari sumber besar mana pun (Google atau OTA besar), aturan audit 17 Nov 2026.
      compsetIneligibility({ category: h.group, starRating: compsetStars(h), roadKm: h.roadKm }),
      null,
      `${h.name} berperan inti tetapi tidak memenuhi aturan`,
    );
  }
  const excluded = EXCLUDED_HOTELS.map((h) => h.hotelId).sort();
  // Penilaian holistik 21 Nov 2026: Hawaii (bintang 4 Traveloka, tarif satu segmen, unit 2 kamar tidur) kembali inti.
  assert.deepEqual(excluded, ["allisa", "movenpick", "mutiara_carita", "novus_jiva", "patra_anyer", "west_cove_anyer"]);
  for (const id of excluded) assert.equal(isPricingCompetitor(id), false, `${id} tidak boleh ikut koridor harga`);
});

test("pangsa pasar: hanya Sanghyang dan kompetitor inti satu segmen tarif; acuan tampil tanpa dihitung; Patra & Allisa dikeluarkan", () => {
  // TPK Maret 2026 dari rilis BPS Banten (47,14%), nilai nyata yang juga tersimpan di MarketMacroStat.
  const result = calculatePrecisionMarketShare(0.4714, "all");
  assert.equal(result.rows.some((r) => r.hotelId === "patra_anyer"), false, "Patra tidak ada di tabel pangsa");
  assert.equal(result.rows.some((r) => r.hotelId === "allisa"), false, "Allisa tidak lagi ada di tabel pangsa");
  assert.match(EXCLUDED_HOTELS.find((h) => h.hotelId === "patra_anyer")?.excludedReason ?? "", /bintang 3/i);
  const counted = COMPSET_HOTELS.filter(countsInMarket).map((h) => h.hotelId).sort();
  assert.deepEqual(counted, ["hawaii_anyer", "jayakarta", "marbella", "nemuru_palazo", "sanghyang"]);
  // Tarif rata-rata di luar rentang tarif termurah Sanghyang (hari biasa sampai akhir pekan): acuan, tidak dihitung.
  const benchmarks = COMPSET_HOTELS.filter((h) => h.compsetRole === "benchmark").map((h) => h.hotelId).sort();
  assert.deepEqual(benchmarks, ["aston_anyer", "mambruk", "my_pisita_anyer"]);
  for (const id of benchmarks) assert.equal(isPricingCompetitor(id), false, `${id} acuan tidak ikut koridor harga`);
  assert.equal(COMPSET_HOTELS.find((h) => h.hotelId === "mambruk")?.roomCount, 145);
  assert.equal(COMPSET_HOTELS.find((h) => h.hotelId === "nemuru_palazo")?.roomCount, null);
});

test("registri DB dan data harga memakai peran pembanding yang sama", async () => {
  const rows = await db.competitor.findMany({
    where: { placeId: { in: [...COMPSET_HOTELS, ...EXCLUDED_HOTELS].map((h) => h.hotelId) } },
    select: { placeId: true, active: true, compsetRole: true, roadKm: true, starRating: true },
  });
  const byPlace = new Map(rows.map((r) => [r.placeId, r]));
  for (const h of COMPSET_HOTELS) {
    const row = byPlace.get(h.hotelId);
    assert.ok(row, `${h.hotelId} ada di registri DB`);
    assert.equal(row.active, true, `${h.hotelId} aktif di registri`);
    assert.equal(row.compsetRole, h.compsetRole, `${h.hotelId}: peran DB dan data harga berbeda`);
    assert.equal(row.roadKm, h.roadKm, `${h.hotelId}: jarak DB dan data harga berbeda`);
  }
  for (const h of EXCLUDED_HOTELS) {
    assert.equal(byPlace.get(h.hotelId)?.active, false, `${h.hotelId} harus diarsipkan di registri`);
  }
});

test("aturan: restoran atau bar mandiri dengan ulasan Google terlalu sedikit tidak setara", () => {
  // Pondok Cirebone (4 ulasan) dan Chrysoberil (46) vs RM.MUARO (1.818): angka nyata dari job rating Google Maps.
  assert.match(compsetIneligibility({ category: "resto", starRating: null, roadKm: 1.5, reviewCount: 4 }) ?? "", /4 ulasan Google/);
  assert.equal(isEligibleCore({ category: "bar", starRating: null, roadKm: 19, reviewCount: 46 }), false);
  assert.equal(isEligibleCore({ category: "resto", starRating: null, roadKm: 1.9, reviewCount: 1818 }), true);
  assert.match(compsetIneligibility({ category: "resto", starRating: null, roadKm: 2, reviewCount: null }) ?? "", /belum terbaca/);
});

test("aturan: outlet di dalam hotel pembanding ikut kelayakan hotelnya, tanpa syarat ulasan sendiri", () => {
  assert.equal(isEligibleCore({ category: "resto", starRating: null, roadKm: 2.2, reviewCount: null, insideLodging: true }), true);
  assert.match(compsetIneligibility({ category: "spa", starRating: null, roadKm: 34, reviewCount: null, insideLodging: true }) ?? "", /di luar 25 km/);
});

test("outlet hotel: restoran di dalam hotel hanya pesaing D'Bistro walau bertema seafood, resto mandiri pesaing Sunset Grill", async () => {
  const { outletsForVenue, shortHotelName } = await import("../../src/lib/market/hotel-venues");
  // Teks fakta nyata dari situs resmi (CompetitorFact, 14 Nov 2026). Keputusan pemilik 16 Nov 2026: D'Bistro restoran
  // hotel, Sunset Grill restoran bakar seafood di pantai.
  assert.deepEqual(outletsForVenue("resto", "Infinity Restaurant", "Infinity Restaurant menyajikan makanan autentik Asia dengan sentuhan tradisional", "hotel"), ["dbistro"]);
  assert.deepEqual(outletsForVenue("resto", "Hotel Pier", "a romantic overwater restaurant perched above the sea, offering fresh seafood", "hotel"), ["dbistro"]);
  assert.deepEqual(outletsForVenue("resto", "Kalani Beach Resto Anyer", "Restoran Seafood", "mandiri"), ["sunset-grill"]);
  assert.deepEqual(outletsForVenue("bar", "Oceana Pool Bar", "Oceana Pool Bar adalah bar kolam renang di resor.", "hotel"), ["dbar"]);
  assert.equal(shortHotelName("Mambruk Hotel & Convention"), "Mambruk");
  assert.equal(shortHotelName("Aston Anyer Beach Hotel"), "Aston Anyer");
  assert.equal(shortHotelName("Novus Jiva Anyer Villa, Resort & Spa"), "Novus Jiva Anyer");
});

test("outlet hotel: fakta fasilitas yang bernama spa, restoran, atau bar juga dikenali sebagai outlet", async () => {
  const { planHotelVenues } = await import("../../src/lib/market/hotel-venues");
  // Fakta nyata situs resmi Novus Jiva (CompetitorFact, 14 Nov 2026): Gemini menulis Daiva Spa sebagai fasilitas:, bukan spa:.
  const wellness = "https://www.novushotels.com/novusjiva/wellness-experience-hotel-novus-anyer";
  const hotel = { id: "novus_jiva", name: "Novus Jiva Anyer Villa, Resort & Spa", placeId: "novus_jiva", compsetRole: "inti" };
  const facts = [
    { key: "fasilitas:Daiva Spa", text: "Daiva Spa menawarkan perawatan spa untuk membantu relaksasi, mengurangi stres, dan menyegarkan tubuh serta jiwa.", sourceUrl: wellness },
    { key: "fasilitas:Gym", text: "Fasilitas gym menyediakan berbagai peralatan untuk membantu mencapai latihan harian agar tubuh tetap bugar dan sehat.", sourceUrl: wellness },
    { key: "fasilitas:Barefoot Beach", text: "Area pantai yang digunakan untuk aktivitas seperti yoga, api unggun, tarian api, dan permainan.", sourceUrl: "https://www.novushotels.com/novusjiva/" },
  ].map((f) => ({ ...f, hotelId: hotel.id }));
  assert.deepEqual(
    planHotelVenues([hotel], facts).map((p) => [p.name, p.category, p.outlets]),
    [["Daiva Spa Novus Jiva Anyer", "spa", ["dspa"]]],
  );
});

test("outlet hotel: rencana registri dari fakta restoran hotel bertema seafood tidak memasukkan Sunset Grill", async () => {
  const { planHotelVenues } = await import("../../src/lib/market/hotel-venues");
  // Fakta nyata situs resmi Aston (CompetitorFact, 14 Nov 2026); dulu kata "seafood" dan "sunset" menyeretnya ke Sunset Grill.
  const hotel = { id: "aston_anyer", name: "Aston Anyer Beach Hotel", placeId: "aston_anyer", compsetRole: "inti" };
  const dining = "https://llms.archipelagointernational.com/brands/aston/properties/aston-anyer-beach-hotel/dining";
  const facts = [
    { key: "restoran:Hotel Pier", text: "Hotel Pier is Aston Anyer Beach Hotel's signature dining destination—a romantic overwater restaurant perched above the sea, offering fresh seafood", sourceUrl: `${dining}/hotel-pier.md` },
    { key: "restoran:Sunset Cafe", text: "Sunset Café is Aston Anyer Beach Hotel's premier all-day dining destination, offering a perfect blend of pan-Asian and international cuisine", sourceUrl: `${dining}/sunset-cafe.md` },
  ].map((f) => ({ ...f, hotelId: hotel.id }));
  assert.deepEqual(
    planHotelVenues([hotel], facts).map((p) => [p.name, p.outlets]),
    [
      ["Hotel Pier Aston Anyer", ["dbistro"]],
      ["Sunset Cafe Aston Anyer", ["dbistro"]],
    ],
  );
});

test("registri: outlet resto ditukar menurut letaknya, outlet lain (Dragon Beach Club) tetap", async () => {
  const { restoOutlets } = await import("../../src/lib/market/hotel-venues");
  // Isi kolom outlets di DB lokal sebelum perbaikan 16 Nov 2026.
  assert.deepEqual(restoOutlets(["dbistro", "sunset-grill"], "hotel"), ["dbistro"], "Hotel Pier Aston Anyer");
  assert.deepEqual(restoOutlets(["sunset-grill", "dbistro"], "mandiri"), ["sunset-grill"], "Andalan Beach Resto & Coffee");
  assert.deepEqual(restoOutlets(["sunset-grill", "dragon-beach-club"], "mandiri"), ["sunset-grill", "dragon-beach-club"], "Kamalika Beach Cafe & Resto");
  assert.deepEqual(restoOutlets(["dbistro"], "hotel"), ["dbistro"], "El Patio Marbella sudah benar");
});

test("outlet hotel: nama fasilitas yang hanya kata umum (mis. Pool Bar) tidak dijadikan pesaing bernama", async () => {
  const { venueKindFromFacilityName } = await import("../../src/lib/market/hotel-venues");
  assert.equal(venueKindFromFacilityName("Daiva Spa"), "spa");
  assert.equal(venueKindFromFacilityName("Serai Restaurant"), "resto");
  assert.equal(venueKindFromFacilityName("Bluewave Lounge"), "bar");
  assert.equal(venueKindFromFacilityName("Pool Bar"), null);
  assert.equal(venueKindFromFacilityName("Gym"), null);
  assert.equal(venueKindFromFacilityName("Barefoot Beach"), null);
});
