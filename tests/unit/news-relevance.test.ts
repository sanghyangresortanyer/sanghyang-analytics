import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import hotelData from "../../src/lib/market/hotel-compset.data.json";
import { parseDayRange } from "../../src/lib/market/date-range";
import {
  EVENT_HORIZON_DAYS,
  NEWS_RADIUS_KM,
  judgeDistance,
  judgeLocation,
  newsInPeriod,
  parseNewsReadings,
  provinceOf,
  regencyOf,
  splitNewsTitle,
  type NewsReading,
} from "../../src/lib/market/news-relevance";
import { newsOutcome } from "../../src/lib/market/refresh-outcome";

const own = (hotelData as { hotels: { hotelId: string; name: string; address?: string; lat?: number; lng?: number }[] }).hotels.find((h) => h.hotelId === "sanghyang")!;
const site = { name: own.name, address: own.address!, lat: own.lat!, lng: own.lng! };
const reading = (over: Partial<NewsReading>): NewsReading => ({
  id: "x",
  ringkasan: "",
  isEvent: false,
  kind: "destination",
  eventStart: null,
  eventEnd: null,
  lokasi: null,
  dampak: "tamu",
  outlets: ["resort"],
  alasan: "",
  ...over,
});

test("judul RSS Google News dipisah menjadi judul artikel dan nama penerbit", () => {
  // Judul asli di DB lokal (Google News, 17 Nov 2026).
  assert.deepEqual(splitNewsTitle("notyourwife Bawa Misi Kenalkan Musik Indonesia ke Ajang The New Colossus Festival 2027 di New York City - Lensa Banten"), {
    title: "notyourwife Bawa Misi Kenalkan Musik Indonesia ke Ajang The New Colossus Festival 2027 di New York City",
    publisher: "Lensa Banten",
  });
  assert.deepEqual(splitNewsTitle("GI Tourism, Kemenkum Banten Angkat Produk Khas Daerah Jadi Daya Tarik Wisata - bisnisbanten.com"), {
    title: "GI Tourism, Kemenkum Banten Angkat Produk Khas Daerah Jadi Daya Tarik Wisata",
    publisher: "bisnisbanten.com",
  });
});

test("provinsi dan kabupaten Sanghyang dibaca dari alamat registri, bukan konstanta", () => {
  assert.equal(provinceOf(site.address), "banten");
  assert.equal(regencyOf(site.address), "kabupaten serang");
});

test("lokasi di luar negeri atau di luar provinsi Sanghyang langsung di luar radius tanpa pencarian koordinat", () => {
  const nyc = judgeLocation(reading({ isEvent: true, lokasi: { nama: "New York City", jenis: "tempat", provinsi: "New York", negara: "Amerika Serikat" } }), site);
  assert.equal(nyc.status, "di_luar_radius");
  const tangerang = judgeLocation(reading({ lokasi: { nama: "Gading Serpong, Tangerang", jenis: "tempat", provinsi: "Banten", negara: "Indonesia" } }), site);
  assert.equal(tangerang.status, "perlu_koordinat", "tempat di provinsi yang sama diukur dari koordinatnya");
  const jakarta = judgeLocation(reading({ lokasi: { nama: "Jakarta Pusat", jenis: "tempat", provinsi: "DKI Jakarta", negara: "Indonesia" } }), site);
  assert.equal(jakarta.status, "di_luar_radius");
  assert.equal(judgeLocation(reading({ lokasi: null }), site).status, "lokasi_tidak_jelas");
});

test("wilayah administratif dihitung dalam radius hanya bila kabupaten/kota itu memuat Sanghyang; provinsi terlalu luas", () => {
  const area = (nama: string, jenis: "tempat" | "wilayah", isEvent = false) =>
    judgeLocation(reading({ isEvent, lokasi: { nama, jenis, provinsi: "Banten", negara: "Indonesia" } }), site);
  const regency = area("Kabupaten Serang", "wilayah");
  assert.equal(regency.status, "relevan");
  assert.equal(regency.status === "relevan" ? regency.distanceKm : null, 0);
  // Pembacaan 18 Nov 2026 sempat menulis kabupaten sebagai "tempat"; titik Google Maps kabupaten hanyalah pusatnya.
  assert.equal(area("Kab. Serang, Banten", "tempat").status, "relevan", "nama kabupaten diperlakukan sebagai wilayah");
  assert.equal(area("Kota Cilegon", "wilayah").status, "di_luar_radius");
  // Pernyataan Gubernur tentang pariwisata Provinsi Banten (18 Nov 2026): tingkat provinsi bukan radius 25 km.
  assert.equal(area("Provinsi Banten", "wilayah").status, "di_luar_radius");
  assert.equal(area("Banten", "tempat").status, "di_luar_radius");
  // Webinar GI Tourism Kemenkum Banten (18 Nov 2026): acara yang lokasinya hanya wilayah belum diketahui tempatnya.
  assert.equal(area("Banten", "wilayah", true).status, "lokasi_tidak_jelas");
  assert.equal(area("Kabupaten Serang", "wilayah", true).status, "lokasi_tidak_jelas");
  assert.equal(area("Anyer-Cinangka, Kabupaten Serang", "tempat").status, "perlu_koordinat", "kawasan bernama diukur dari koordinatnya");
});

test("jarak dari koordinat: paling jauh 25 km garis lurus", () => {
  assert.equal(NEWS_RADIUS_KM, 25);
  // Batas radius diuji tepat di ambangnya; jarak nyata tiap tempat diukur dari koordinat Google Maps saat berjalan.
  assert.equal(judgeDistance("titik di ambang radius", NEWS_RADIUS_KM).status, "relevan");
  assert.equal(judgeDistance("titik tepat di luar radius", NEWS_RADIUS_KM + 0.1).status, "di_luar_radius");
  assert.equal(judgeDistance("tempat tanpa hasil pencarian", null).status, "lokasi_tidak_jelas");
});

test("acara tampil bila tanggalnya di periode atau paling lambat sebulan sesudahnya; acara Maret 2027 tidak tampil di periode November 2026", () => {
  assert.equal(EVENT_HORIZON_DAYS, 30);
  const range = parseDayRange("2026-10-20", "2026-11-18");
  assert.ok(range && range !== "invalid");
  const published = new Date("2026-11-16T17:00:00Z");
  const event = (start: string, end?: string) => ({
    kind: "event",
    startsAt: new Date(`${start}T00:00:00+07:00`),
    endsAt: end ? new Date(`${end}T23:59:59+07:00`) : null,
    publishedAt: published,
  });
  assert.equal(newsInPeriod(event("2027-03-01"), range), false, "acara Maret 2027 jauh di luar periode");
  assert.equal(newsInPeriod(event("2026-12-15"), range), true, "27 hari sesudah akhir periode");
  assert.equal(newsInPeriod(event("2026-12-19"), range), false, "31 hari sesudah akhir periode");
  assert.equal(newsInPeriod(event("2026-10-01", "2026-10-19"), range), false, "sudah selesai sebelum periode");
  assert.equal(newsInPeriod({ kind: "event", startsAt: null, endsAt: null, publishedAt: published }, range), false, "acara tanpa tanggal tertulis");
  assert.equal(newsInPeriod({ kind: "destination", startsAt: null, endsAt: null, publishedAt: published }, range), true, "berita biasa: tanggal terbit di periode");
  assert.equal(newsInPeriod({ kind: "destination", startsAt: null, endsAt: null, publishedAt: new Date("2026-09-30T00:00:00Z") }, range), false);
});

test("hasil langkah berita menyebut hasil pembacaan isi dan turun menjadi sebagian bila ada yang belum selesai", () => {
  const counts = { relevan: 5, tidak_relevan: 20, di_luar_radius: 7, lokasi_tidak_jelas: 2, tidak_terbaca: 6 };
  const done = newsOutcome("success", { candidates: 40, read: 34, counts, failures: [] });
  assert.equal(done.status, "berhasil");
  assert.match(done.detail ?? "", /40 berita kandidat dibaca isinya: 5 relevan, 20 tidak terkait outlet, 7 di luar radius 25 km/);
  const partial = newsOutcome("success", { candidates: 40, read: 30, counts, failures: ["pembacaan berita: kuota habis"] });
  assert.equal(partial.status, "sebagian");
  assert.ok(partial.issue);
  const crashed = newsOutcome("success", { error: "GEMINI_API_KEY kosong" });
  assert.equal(crashed.status, "sebagian");
  assert.equal(newsOutcome("success").status, "berhasil", "tanpa hasil pembacaan perilakunya tetap seperti dulu");
});

test("jawaban asli pembacaan 18 Nov 2026: notyourwife (New York, Maret 2027) ditolak dari tiga sisi, dampak lainnya mengosongkan outlet", () => {
  // Fixture: jawaban asli pembacaan empat berita yang isinya dibaca dari situs penerbit; teks artikel tidak disimpan.
  const fixture = JSON.parse(readFileSync("tests/fixtures/news-reading-2026-11-18.json", "utf8")) as {
    artikel: { id: string; title: string; publisher: string; publishedDay: string }[];
    jawaban: string;
  };
  const articles = fixture.artikel.map((a) => ({ ...a, text: "" }));
  const readings = parseNewsReadings(fixture.jawaban, articles);
  assert.equal(readings.size, articles.length);
  const byTitle = (prefix: string) => {
    const a = articles.find((x) => x.title.startsWith(prefix));
    assert.ok(a, prefix);
    return readings.get(a.id)!;
  };

  const notyourwife = byTitle("notyourwife");
  assert.equal(notyourwife.isEvent, true);
  assert.equal(notyourwife.eventStart, "2027-03-09");
  assert.equal(notyourwife.dampak, null, "dampak lainnya");
  assert.deepEqual(notyourwife.outlets, [], "tidak terkait outlet mana pun");
  assert.equal(judgeLocation(notyourwife, site).status, "di_luar_radius", "New York di luar radius");
  const range = parseDayRange("2026-10-20", "2026-11-18");
  assert.ok(range && range !== "invalid");
  const days = { startsAt: new Date(`${notyourwife.eventStart}T00:00:00+07:00`), endsAt: new Date(`${notyourwife.eventEnd}T23:59:59+07:00`) };
  assert.equal(newsInPeriod({ kind: "event", ...days, publishedAt: new Date("2026-11-16T17:00:00Z") }, range), false, "acara Maret 2027 di luar periode");

  const hotel = byTitle("Forbis Hotel");
  assert.equal(hotel.dampak, "pesaing");
  assert.equal(hotel.lokasi?.jenis, "tempat", "usaha tertentu diukur dari tempatnya, bukan dari kabupatennya");
  assert.deepEqual(judgeLocation(hotel, site), { status: "perlu_koordinat", query: `${hotel.lokasi!.nama}, Banten` });

  const policy = byTitle("Sambut Libur Nataru");
  assert.equal(policy.isEvent, false);
  assert.ok(policy.dampak !== null);
  assert.ok(policy.outlets.includes("resort"));
  assert.equal(judgeLocation(policy, site).status, "perlu_koordinat");

  const school = byTitle("SMKN 1 Cinangka");
  assert.equal(school.dampak, null, "kegiatan sekolah berdampak lainnya");
  assert.deepEqual(school.outlets, [], "dampak lainnya mengosongkan outlet");
});

test("ringkasan dan alasan pembacaan berita tanpa em dash: jawaban yang memakai em dash kembali ke tulisan aslinya", () => {
  const fixture = JSON.parse(readFileSync("tests/fixtures/news-reading-2026-11-18.json", "utf8")) as {
    artikel: { id: string; title: string; publisher: string; publishedDay: string }[];
    jawaban: string;
  };
  const articles = fixture.artikel.map((a) => ({ ...a, text: "" }));
  const original = parseNewsReadings(fixture.jawaban, articles);
  // Jawaban asli yang koma pertamanya diganti em dash, gaya tulisan mesin yang tidak boleh tampil ke staf.
  const answer = JSON.parse(fixture.jawaban) as { items: { ringkasan: string; alasan: string }[] };
  for (const item of answer.items) {
    item.ringkasan = item.ringkasan.replace(", ", " — ");
    item.alasan = item.alasan.replace(", ", " — ");
  }
  assert.match(JSON.stringify(answer), /—/, "fixture memuat koma yang bisa diganti em dash");
  const dashed = parseNewsReadings(JSON.stringify(answer), articles);
  assert.equal(dashed.size, original.size);
  for (const [id, reading] of original) {
    assert.equal(dashed.get(id)?.ringkasan, reading.ringkasan);
    assert.equal(dashed.get(id)?.alasan, reading.alasan);
  }
});
