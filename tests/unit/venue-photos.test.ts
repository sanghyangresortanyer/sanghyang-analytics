import { test } from "node:test";
import assert from "node:assert/strict";
import { imageMatchesVenue, pickVenueImages, venueKey, type PageImage } from "../../src/lib/market/venue-photos";

// Foto dan konteksnya disalin dari halaman resmi yang dibaca perayap pada 14 Nov 2026.
const mambruk = "https://www.mambruk.co.id/facilities";
const img = (url: string, context: string, pageUrl = mambruk, alt = "", og = false): PageImage => ({ url, alt, context, pageUrl, og });
const lighthouse = img("https://www.mambruk.co.id/file/379", "Lighthouse Restaurant & Bar Relax your mind, lay back, and groove with us! Relish an excit");
const infinityResto = img("https://www.mambruk.co.id/file/954", "Infinity Restaurant Presenting the Asian authenticity with a touch of traditional flair an");
const infinityPool = img("https://www.mambruk.co.id/file/955", "Infinity Pool Experience the serene feeling from the largest infinity pool in Anyer, locat");
const cruise = img("https://www.mambruk.co.id/file/952", "Sea Prosperity Cruise Sail away in the beauty of the sunset, accompanied by an appetizing ");

test("foto outlet hotel: nama outlet diambil tanpa nama hotel induknya", () => {
  assert.equal(venueKey("Lighthouse Restaurant & Bar Mambruk", "Mambruk Hotel & Convention"), "lighthouse restaurant bar");
  assert.equal(venueKey("El Patio Marbella", "Marbella Place Anyer by Jayakarta"), "el patio");
  assert.equal(venueKey("Hotel Pier Aston Anyer", "Aston Anyer Beach Hotel"), "hotel pier");
  assert.equal(venueKey("Daiva Spa Novus Jiva", "Novus Jiva Anyer Villa, Resort & Spa"), "daiva spa");
  assert.equal(venueKey("Bliss Spa Mövenpick Resort Carita", "Mövenpick Resort Carita"), "bliss spa");
});

test("foto outlet hotel: foto dipakai hanya bila nama outletnya tertulis di judul bagian, alt, atau nama berkas", () => {
  assert.equal(imageMatchesVenue(lighthouse, "lighthouse restaurant bar"), true);
  assert.equal(imageMatchesVenue(infinityResto, "lighthouse restaurant bar"), false);
  assert.equal(imageMatchesVenue(infinityResto, "infinity restaurant"), true);
  assert.equal(imageMatchesVenue(infinityPool, "infinity restaurant"), false, "kolam Infinity bukan restoran Infinity");
  assert.equal(imageMatchesVenue(cruise, "sunset cafe"), false, "kata sunset saja tidak cukup untuk Sunset Cafe");
  const elPatio = img("https://marbellaplaceanyer.com/wp-content/uploads/2026/05/El-Patio-Outdoor-1024x683.jpg", "", "https://marbellaplaceanyer.com/dining/el-patio/", "", true);
  assert.equal(imageMatchesVenue(elPatio, "el patio"), true);
  const campo = img("https://marbellaplaceanyer.com/wp-content/uploads/2026/05/Campo-Del-Sol-2-1024x575.jpg", "", "https://marbellaplaceanyer.com/dining/campo-del-sol-pool-bar/", "", true);
  assert.equal(imageMatchesVenue(campo, "campo del sol pool bar"), true, "nama berkas tanpa kata 'pool bar' tetap cocok");
  const serai = img("https://www.novushotels.com/img/novusjiva/facilities/serai-resto.jpg", "", "https://www.novushotels.com/novusjiva/wellness-experience-hotel-novus-anyer");
  assert.equal(imageMatchesVenue(serai, "serai restaurant"), true);
  assert.equal(imageMatchesVenue(serai, "daiva spa"), false);
  const lagoon = img("https://www.ahstatic.com/photos/c6a5_rsr001_00_p_2048x1536.jpg", "LAGOON RESTAURANT See details Lagoon Restaurant presents an elevated dining experience ins", "https://all.accor.com/hotel/C6A5/index.en.shtml");
  assert.equal(imageMatchesVenue(lagoon, "lagoon restaurant"), true);
  const room = img("https://www.ahstatic.com/photos/c6a5_rodbaov_00_p_2048x1536.jpg", "ROOM Deluxe Double Bed, Ocean View See details 3 pers. max 45 m² / 484 sq ft Bedding 1 x D", "https://all.accor.com/hotel/C6A5/index.en.shtml");
  assert.equal(imageMatchesVenue(room, "lagoon restaurant"), false);
});

test("foto outlet hotel: foto yang sama dari slider tidak diambil dua kali, dan jumlahnya dibatasi", () => {
  const clone = { ...lighthouse, url: "https://www.mambruk.co.id/file/379?v=2" };
  assert.deepEqual(pickVenueImages([lighthouse, clone, infinityResto], "lighthouse restaurant bar", 6).map((i) => i.url), ["https://www.mambruk.co.id/file/379"]);
  assert.equal(pickVenueImages([lighthouse, infinityResto], "lighthouse restaurant bar", 0).length, 0);
});

test("foto outlet hotel: foto resmi yang sama dalam ukuran atau folder lain hanya diambil sekali", () => {
  // URL nyata dari situs Novus Jiva (14 Nov 2026): satu foto Daiva Spa dipakai sebagai banner dan kartu fasilitas.
  const wellness = "https://www.novushotels.com/novusjiva/wellness-experience-hotel-novus-anyer";
  const banner = img("https://www.novushotels.com/img/novusjiva/wellness/novus-jiva-daiva-spa.jpg", "", wellness);
  const card = img("https://www.novushotels.com/img/novusjiva/facilities/daiva-spa.jpg", "", wellness);
  assert.deepEqual(pickVenueImages([banner, card], "daiva spa", 6).map((i) => i.url), [banner.url]);
  const seraiCard = img("https://www.novushotels.com/img/novusjiva/facilities/serai-resto.jpg", "", wellness);
  const seraiDining = img("https://www.novushotels.com/img/novusjiva/restaurant/serai-resto.jpg", "", "https://www.novushotels.com/novusjiva/restaurant-hotel-anyer");
  const seraiHero = img("https://www.novushotels.com/img/novusjiva/restaurant/anyer-serai-restaurant.jpg", "", "https://www.novushotels.com/novusjiva/restaurant-hotel-anyer");
  assert.deepEqual(pickVenueImages([seraiCard, seraiDining, seraiHero], "serai restaurant", 6).map((i) => i.url), [seraiCard.url, seraiHero.url]);
  // Ukuran berbeda dari WordPress (-1024x683) tetap foto yang sama.
  const wp = "https://marbellaplaceanyer.com/wp-content/uploads/2026/05/El-Patio-Outdoor";
  const page = "https://marbellaplaceanyer.com/dining/el-patio/";
  assert.equal(pickVenueImages([img(`${wp}-1024x683.jpg`, "", page, "", true), img(`${wp}.jpg`, "", page, "El Patio")], "el patio", 6).length, 1);
});
