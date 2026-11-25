import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTopicChips } from "../../src/lib/market/review-topics";
import {
  listingFromMenu,
  mergeVenueMapsCards,
  parseVenueMapsPage,
  scrapeReviewsFromGoogle,
  validateVenueMapsRead,
  venueReviewTargets,
  type VenueMapsPage,
} from "../../src/lib/market/scrape-new-reviews";
import { buildVenueFactPrompt, normalizeForQuote, sectionForKey, textFromHtml } from "../../src/lib/market/competitor-facts";
import { competitorMenu } from "../../src/lib/market/competitor-menu";
import { OWN_OUTLETS } from "../../src/lib/market/outlet-ratings";
import type { EvidenceDataset } from "../../src/lib/market/competitor-comparison";

// Tab Ulasan Google Maps RM.MUARO seperti tampil untuk perayap jujur, 16 Nov 2026 (lihat _sumber di fixture).
const maps = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/maps-venue-reviews-2026-11-16.json"), "utf8")) as {
  places: (VenueMapsPage & { url: string; observedAt: string })[];
};
const registry = (JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/competitor-evidence-2026-11-16.json"), "utf8")) as EvidenceDataset).registry;
const muaro = maps.places[0];

test("topik ulasan Google Maps: label dan jumlah dari tombol topik, tanpa tombol Semua dan Lihat lainnya", () => {
  const topics = parseTopicChips(muaro.chipLabels);
  assert.equal(topics.length, 10);
  assert.deepEqual(topics[0], { label: "lalat", count: 41 });
  assert.deepEqual(topics.at(-1), { label: "relatif", count: 9 });
  assert.ok(topics.every((t) => !/semua|lihat/i.test(t.label)));
});

test("halaman Google Maps tempat: rating, jumlah ulasan, topik, dan ulasan bersumber reviewid", () => {
  const now = new Date(muaro.observedAt);
  const page = parseVenueMapsPage(muaro, muaro.url, now);
  assert.equal(page.rating, 4.2);
  assert.equal(page.reviewCount, 1818);
  assert.equal(page.topics.length, 10);
  assert.equal(page.reviews.length, 5);
  for (const r of page.reviews) {
    assert.equal(r.source, "Google Maps");
    assert.match(r.sourceUrl, /reviewid=/);
    assert.ok(r.reviewDate.getTime() <= now.getTime());
  }
  const oneStar = page.reviews.find((r) => r.rating === 1);
  assert.ok(oneStar && /Kangkung tua/.test(oneStar.text), "ulasan bintang 1 soal kangkung terbaca");
  // "4 bulan lalu" berarti sekitar 120 hari sebelum halaman dibaca.
  const days = (now.getTime() - oneStar.reviewDate.getTime()) / 86_400_000;
  assert.ok(days > 100 && days < 140, `${days} hari`);
});

test("halaman Google Maps tanpa blok rating tidak menghasilkan angka rating", () => {
  const page = parseVenueMapsPage({ ...muaro, ratingBlock: null }, muaro.url, new Date(muaro.observedAt));
  assert.equal(page.rating, null);
  assert.equal(page.reviewCount, null);
});

test("target ulasan venue: listing sendiri dari registri atau data menu, bukan listing hotel induk", () => {
  const targets = venueReviewTargets(registry, OWN_OUTLETS, (name) => listingFromMenu(competitorMenu(name)));
  const names = targets.map((t) => t.name).sort();
  assert.ok(names.includes("RM.MUARO"));
  assert.ok(names.includes("Kamalika Beach Cafe & Resto"));
  // Outlet di dalam hotel hanya masuk bila listing Google Maps-nya sendiri tercatat (data menu 15 Nov 2026).
  assert.ok(names.includes("Sunset Cafe Aston Anyer"));
  assert.ok(names.includes("El Patio Marbella"));
  assert.ok(names.includes("Campo del Sol Pool Bar Marbella"));
  for (const excluded of ["Hotel Pier Aston Anyer", "Infinity Restaurant Mambruk", "Lighthouse Restaurant & Bar Mambruk", "The Upper Circle Novus Jiva"]) {
    assert.equal(names.includes(excluded), false, `${excluded} tidak punya listing sendiri`);
  }
  for (const t of targets) {
    assert.match(t.mapsUrl, /^https:\/\/www\.google\.com\/maps\/place\//);
    assert.equal(/hotel|resort/.test(registry.find((r) => r.name === t.name)?.category ?? ""), false, `${t.name} adalah hotel`);
    assert.equal(OWN_OUTLETS.some((o) => o.competitorName === t.name), false, `${t.name} outlet Sanghyang`);
  }
  const sunsetCafe = targets.find((t) => t.name === "Sunset Cafe Aston Anyer");
  assert.match(sunsetCafe?.mapsUrl ?? "", /Sunset\+Cafe\+Aston/);
  assert.equal(sunsetCafe?.isVenue, true);
});

test("prompt fakta outlet: hanya tentang outlet itu, kunci khas restoran, bar, dan spa, dan halaman sebagai data", () => {
  const prompt = buildVenueFactPrompt("Hotel Pier Aston Anyer", "Aston Anyer Beach Hotel", "https://llms.archipelagointernational.com/x.md", "Teks halaman.");
  assert.match(prompt, /Hanya fakta tentang "Hotel Pier Aston Anyer"/);
  assert.match(prompt, /Aston Anyer Beach Hotel/);
  for (const key of ["masakan", "jam_buka", "suasana", "kapasitas", "kode_pakaian", "perawatan", "hiburan"]) assert.match(prompt, new RegExp(key));
  assert.match(prompt, /<UNTRUSTED_PAGE>[\s\S]*<\/UNTRUSTED_PAGE>/);
  assert.doesNotMatch(prompt, /jaringan/i);
});

test("bagian fakta outlet diturunkan dari kuncinya", () => {
  for (const key of ["masakan", "minuman", "jam_buka", "suasana", "kapasitas", "kode_pakaian", "reservasi", "perawatan", "hiburan"]) {
    assert.equal(sectionForKey(key), "fasilitas", key);
  }
  assert.equal(sectionForKey("lokasi_outlet"), "lokasi");
  assert.equal(sectionForKey("deskripsi"), "profil");
  assert.equal(sectionForKey("segmen"), "segmen");
  assert.equal(sectionForKey("restoran:Hotel Pier"), "fasilitas");
  assert.equal(sectionForKey("tipe:Suite"), "kamar");
  assert.equal(sectionForKey("tidak_dikenal"), null);
});

test("teks halaman dari HTML yang diambil tanpa peramban memuat kutipan fakta yang dulu dibaca peramban", () => {
  // Halaman dining Novus Jiva diambil dengan fetch biasa 16 Nov 2026; kutipannya tersimpan 14 Nov dari Chrome.
  const html = readFileSync(path.resolve(process.cwd(), "tests/fixtures/novus-jiva-dining-2026-11-16.html"), "utf8");
  const text = textFromHtml(html);
  assert.doesNotMatch(text, /<[a-z]/i, "tag HTML tidak boleh tersisa");
  assert.doesNotMatch(text, /function\s*\(|gtag\(/, "isi skrip tidak boleh ikut");
  const facts = (JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/competitor-evidence-2026-11-16.json"), "utf8")) as EvidenceDataset).facts
    .filter((f) => f.sourceUrl === "https://www.novushotels.com/novusjiva/restaurant-hotel-anyer");
  assert.ok(facts.length >= 3);
  const page = normalizeForQuote(text);
  for (const f of facts) assert.ok(page.includes(normalizeForQuote(f.quote)), `${f.key}: kutipan tidak ditemukan`);
});

test("ulasan Google Travel tanpa alamat entity ditolak sebelum membuka peramban: /travel/search dilarang robots.txt", async () => {
  // robots.txt google.com (dibaca 16 Nov 2026) memuat "Disallow: /travel/search" untuk semua perayap.
  await assert.rejects(scrapeReviewsFromGoogle({ competitorName: "Hotel tanpa entity", query: "Hotel tanpa entity" }), /robots\.txt/);
});

test("venue Google Maps dengan ulasan rating bintang tanpa teks komentar (seperti Alta Spa 5,0 / 1 ulasan) dihitung terbaca tanpa data tiruan", () => {
  // Bentuk DOM nyata Alta Spa Marbella Anyer di Google Maps (25 Nov 2026): 1 ulasan bintang 5 tanpa komentar.
  const altaPage: VenueMapsPage = {
    ratingBlock: "5,0\n(1)",
    tabOpened: true,
    chipLabels: [],
    cards: [
      {
        id: "ChZDSUhNMG9nS0VJQ0FnSUNIOHBlbllREAE",
        author: "Kang Nash",
        stars: "5 bintang",
        date: "2 tahun lalu",
        text: "",
      },
    ],
  };
  const parsed = parseVenueMapsPage(altaPage, "https://www.google.com/maps/place/Spa/@-6.1057531,105.8817945,17z", new Date("2026-11-25T03:00:00Z"));
  assert.equal(parsed.rating, 5);
  assert.equal(parsed.reviewCount, 1);
  assert.equal(parsed.ratedCardsCount, 1);
  assert.equal(parsed.reviews.length, 0, "tidak mengarang teks ulasan untuk rating bintang saja");
  assert.equal(validateVenueMapsRead(altaPage, parsed), null, "tab Ulasan dan kartu bintang terbaca valid");

  // Tampilan terbatas (tab Ulasan hilang padahal reviewCount 17) tetap ditolak sebagai gagal baca.
  const limitedPage: VenueMapsPage = { ratingBlock: "4,9\n(17)", tabOpened: false, chipLabels: [], cards: [] };
  const parsedLimited = parseVenueMapsPage(limitedPage, "https://www.google.com/maps/place/Angel+Karaoke", new Date("2026-11-25T03:00:00Z"));
  assert.match(validateVenueMapsRead(limitedPage, parsedLimited) ?? "", /tab Ulasan tidak tampil/);

  // Tab terbuka tapi 0 kartu padahal reviewCount > 0 tetap gagal baca.
  const emptyTab: VenueMapsPage = { ratingBlock: "4,6\n(109)", tabOpened: true, chipLabels: [], cards: [] };
  const parsedEmpty = parseVenueMapsPage(emptyTab, "https://www.google.com/maps/place/Andalan", new Date("2026-11-25T03:00:00Z"));
  assert.match(validateVenueMapsRead(emptyTab, parsedEmpty) ?? "", /tidak menampilkan kartu ulasan/);
});

test("parseVenueMapsPage juga mendukung label bintang bahasa Inggris jika Google Maps mengembalikan locale en", () => {
  const enPage: VenueMapsPage = {
    ratingBlock: "4.6\n(109)",
    tabOpened: true,
    chipLabels: [],
    cards: [
      {
        id: "Ci9DQUlRQUNvZENodHljRjlvT21aaE1DMVZlbXRKWnpSYU5rOXBRMnBKUkhCeFYyYxAB",
        author: "Zovi Monawati",
        stars: "4 stars",
        date: "1 month ago",
        text: "Tempatnya cukup enak dengan view laut untuk hangout keluarga.",
      },
    ],
  };
  const parsed = parseVenueMapsPage(enPage, "https://www.google.com/maps/place/Andalan", new Date("2026-11-25T03:00:00Z"));
  assert.equal(parsed.rating, 4.6);
  assert.equal(parsed.reviewCount, 109);
  assert.equal(parsed.ratedCardsCount, 1);
  assert.equal(parsed.reviews.length, 1);
  assert.equal(parsed.reviews[0].rating, 4);
});

test("mergeVenueMapsCards: mengutamakan kartu tab Ulasan, memakai kartu asli panel Ringkasan bila tab Ulasan kosong sementara, dan tetap kosong jika keduanya kosong", () => {
  const overviewCards = [
    { id: "rev-1", author: "Uri aja.10", stars: "4 bintang", date: "2 tahun lalu", text: "Sangat seru bisa nongki sambil karaoke" },
    { id: "rev-2", author: "Adin Frz", stars: "5 bintang", date: "3 tahun lalu", text: "Nyaman" },
  ];
  const tabCards = [
    ...overviewCards,
    { id: "rev-3", author: "Tamu 3", stars: "5 bintang", date: "sebulan lalu", text: "Pemandangan laut sangat bagus" },
  ];
  assert.equal(mergeVenueMapsCards(tabCards, overviewCards).length, 3, "utamakan kartu dari tab Ulasan bila terisi");
  assert.equal(mergeVenueMapsCards([], overviewCards).length, 2, "pakai kartu asli Ringkasan bila tab Ulasan sedang kosong");
  assert.equal(mergeVenueMapsCards([], []).length, 0, "tetap 0 bila keduanya kosong (Zero Fallback)");
});
