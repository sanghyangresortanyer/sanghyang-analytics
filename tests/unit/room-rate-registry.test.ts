import { after, test } from "node:test";
import assert from "node:assert/strict";
import compset from "../../src/lib/market/hotel-compset.data.json";
import { db } from "../../src/lib/db";
import { getHotelCompset } from "../../src/lib/market/competitor-repository";
import { hotelTitleNames, isOfficialProvider, mapsPlaceName, pricesUrl, ROOM_RATE_HOTELS } from "../../src/lib/market/room-offers";

after(() => db.$disconnect());

const registryHotel = (hotelId: string) => compset.hotels.find((h) => h.hotelId === hotelId);

test("crawler tarif per tipe kamar: setiap hotel yang dirayapi punya alamat entity dan nama dari registri untuk memeriksa judul panel", () => {
  assert.ok(ROOM_RATE_HOTELS.length > 1);
  for (const hotelId of ROOM_RATE_HOTELS) {
    assert.match(pricesUrl(hotelId, "2026-11-18", "2026-11-19"), /^https:\/\/www\.google\.com\/travel\/hotels\/entity\/[^/]+\/prices\?/, hotelId);
    // crawlSample memeriksa judul panel Google Travel dengan nama ini; tanpa nama, setiap sampel hotel itu gagal.
    const names = hotelTitleNames(hotelId);
    const hotel = registryHotel(hotelId);
    assert.ok(hotel, hotelId);
    assert.ok(names.includes(hotel.name), `${hotelId}: nama registri`);
    const placeName = mapsPlaceName(hotel.mapsUrl);
    if (placeName) assert.ok(names.includes(placeName), `${hotelId}: nama tempat Google Maps`);
    // Situs resmi hotel itu sendiri dikenali dari nama registrinya dan tidak dihitung sebagai harga OTA.
    assert.equal(isOfficialProvider(hotel.name, hotelId), true, hotelId);
  }
  assert.throws(() => hotelTitleNames("hotel-di-luar-registri"), /tidak ada di daftar kompetitor/);
});

test("nama tempat Google Maps dibaca dari URL registri apa adanya", () => {
  // URL asli dari hotel-compset.data.json dan registri DB (17 Nov 2026): tanda + = spasi, %26 = &, %C3%B6 = ö.
  assert.equal(
    mapsPlaceName("https://www.google.com/maps/place/Novus+Jiva+Villa,+Resort+%26+Spa/@-6.2182816,105.8343906,17z/data=!4m9!3m8!1s0x2e422bcc4167b369:0x72e84d86701355f6!5m2!4m1!1i2!8m2!3d-6.2182816!4d105.8343906!16s%2Fg%2F11h247gj2j"),
    "Novus Jiva Villa, Resort & Spa",
  );
  assert.equal(
    mapsPlaceName("https://www.google.com/maps/place/M%C3%B6venpick+Resort+Carita/@-6.2399725,105.8270948,17z/data=!4m9!3m8!1s0x2e422b47b93a4645:0x30d753f6ff816db6!5m2!4m1!1i2!8m2!3d-6.2399725!4d105.8270948!16s%2Fg%2F11z2c2q0_l"),
    "Mövenpick Resort Carita",
  );
  // Tautan pencarian Kalani Beach Resto di kolom websiteUrl registri bukan halaman tempat.
  assert.equal(mapsPlaceName("https://www.google.com/maps/search/?api=1&query=Kalani+Beach+Resto+Anyer"), null);
  assert.equal(mapsPlaceName(null), null);
});

test("registri: hotel yang dirayapi tarif per tipe kamar sama dengan penginapan pembanding aktif di registri DB", async () => {
  // Job room-rates GitHub tidak punya akses DB, jadi crawler membaca hotel-compset.data.json. Tes ini menjaga keduanya sama.
  const registry = (await getHotelCompset()).map((h) => h.placeId ?? h.name).sort();
  assert.deepEqual([...ROOM_RATE_HOTELS].sort(), registry);
});

test("pemeriksa judul panel menerima nama Google Travel yang tercatat sebagai alias di data kompset", async () => {
  const { hotelTitleNames, titleScore } = await import("../../src/lib/market/room-offers");
  // Crawl 17 Nov 2026: entity Marbella (dibentuk dari ID tempat Google Maps-nya) berjudul panel berikut, sehingga semua
  // sampel Marbella ditolak dan Marbella hilang dari resort-room-rates.data.json.
  const panel = "Marbella Hotel, Convention & Spa Anyer";
  assert.ok(titleScore(panel, hotelTitleNames("marbella")) >= 0.6, hotelTitleNames("marbella").join(" | "));
  // Alias tidak melonggarkan hotel lain: panel Marbella tetap ditolak untuk Jayakarta.
  assert.ok(titleScore(panel, hotelTitleNames("jayakarta")) < 0.6);
});
