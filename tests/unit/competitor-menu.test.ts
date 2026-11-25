import { test } from "node:test";
import assert from "node:assert/strict";
import {
  competitorMenu,
  competitorMenuCards,
  competitorMenuNames,
  isAddon,
  isCountedMenuItem,
  isPromo,
  menuPriceRange,
  normalizeMenuItems,
  sampleItems,
} from "../../src/lib/market/competitor-menu";
import { itemPriceText, rupiahRange } from "../../src/lib/market/menu-format";

test("format harga menu: satu harga tidak ditulis sebagai rentang, satuan ikut tercetak", () => {
  assert.equal(rupiahRange(99000, 99000), "Rp 99.000");
  assert.equal(rupiahRange(11000, 100000), "Rp 11.000 – Rp 100.000");
  assert.equal(itemPriceText({ price: 20000, priceMax: 22000, unit: "per ons" }), "Rp 20.000 – Rp 22.000 per ons");
  assert.equal(itemPriceText({ price: 25000, priceMax: null, unit: null }), "Rp 25.000");
});

test("kartu menu web: ringkasan per pesaing tanpa URL foto, tempat baru ditandai belum diperiksa", () => {
  const names = ["Beach Point Anyer", "Kalani Beach Resto Anyer", "Lagoon Restaurant Mövenpick", "Tempat Baru Belum Diperiksa"];
  const cards = competitorMenuCards(names, 8);
  assert.deepEqual(cards.map((c) => c.name), names);
  const [beach, kalani, lagoon, fresh] = cards;
  assert.equal(beach.itemCount, 100);
  // PAKET KONGKOW (1 makanan + 2–3 minuman) adalah paket beberapa orang, jadi batas atasnya hidangan termahal per porsi.
  assert.deepEqual(beach.range, { min: 11000, max: 66000 });
  assert.equal(beach.sample.length, 8);
  assert.match(beach.sources[0].url, /^https:\/\/beachpointanyer\.isellershop\.com\//);
  assert.match(beach.sources[0].label, /diambil 15 November 2026/);
  // Kalani bersumber foto menu Google Maps: labelnya menyebut jumlah foto, tetapi URL fotonya tidak ikut ke browser.
  assert.match(kalani.sources[0].label, /\(4 foto\)/);
  assert.ok(!JSON.stringify(cards).includes("googleusercontent"), "URL foto menu tidak dikirim ke browser");
  assert.equal(lagoon.itemCount, 0);
  assert.equal(lagoon.sources.length, 0);
  assert.ok(lagoon.checked.length >= 3, "tempat tanpa harga membawa sumber yang sudah diperiksa");
  assert.equal(fresh.checked.length, 0);
  assert.equal(fresh.listed, false, "pesaing baru yang belum ada di berkas data ditandai belum diperiksa, bukan tanpa harga");
});

// Potongan menu toko daring resmi Beach Point (iSeller), dibaca 15 Nov 2026.
const BEACH_POINT = [
  { name: "ONION RING", category: "APPETIZER", price: 25000, priceMax: null, unit: null },
  { name: "WINGS PLATTER", category: "APPETIZER", price: 57000, priceMax: null, unit: null },
  { name: "BUNTUT SAPI BAKAR", category: "SOUP", price: 66000, priceMax: null, unit: null },
  { name: "REGULAR TEA", category: "CHILL TEA", price: 11000, priceMax: null, unit: null },
  { name: "SUSU KENTAL MANIS", category: "ADD. DRINK", price: 3000, priceMax: null, unit: null },
  { name: "PACKAGING (TAKE AWAY/DELIVERY)", category: "TAKE AWAY", price: 3000, priceMax: null, unit: null },
];

test("menu pesaing: tambahan, biaya kemasan, dan paket promo tidak masuk rentang harga menu", () => {
  assert.ok(isAddon(BEACH_POINT[4]), "kategori ADD. DRINK adalah tambahan");
  assert.ok(isAddon(BEACH_POINT[5]), "biaya kemasan bukan item menu");
  assert.ok(!isAddon(BEACH_POINT[0]));
  // Baris "Add saus 15K" di bagian IKAN pada foto menu Kalani (Google Maps, dibaca 15 Nov 2026).
  assert.ok(isAddon({ name: "Add saus", category: "IKAN" }), "baris tambahan di dalam kategori hidangan");
  assert.ok(!isAddon({ name: "CHIZ SPICY WINGS", category: "APPETIZER" }));
  assert.deepEqual(menuPriceRange(BEACH_POINT), { min: 11000, max: 66000 });
  // RM.MUARO menjual ikan per ons; harga itu tidak sebanding dengan harga porsi.
  const perOns = { name: "Kue Bakar/Goreng/Sop/Pindang Kuning/Rica-rica", category: "MENU UTAMA", price: 15000, priceMax: null, unit: "per ons" };
  assert.deepEqual(menuPriceRange([...BEACH_POINT, perOns]), { min: 11000, max: 66000 }, "harga per ons tidak sebanding dengan harga porsi");
  // Unggahan Instagram resmi Andalan 9 Nov 2026: paket promo berharga ++ (belum termasuk pajak dan layanan).
  const promo = { name: "Bundling promo Iga Bakar Andalan + Pineapple Lychee (harga ++)", category: "Paket promo", price: 99000, priceMax: null, unit: null };
  assert.ok(isPromo(promo));
  assert.equal(menuPriceRange([promo]), null, "satu paket promo bukan rentang harga menu");
  assert.equal(menuPriceRange([]), null);
});

test("keputusan pemilik 22 Nov 2026: paket beberapa orang dan sewa ruang bertanda di data, di luar kisaran per porsi, tetap tercatat berlabel", () => {
  // Penanda dibaca dari berkas data, bukan ditebak dari nama: daftar lengkapnya dicocokkan per tempat.
  const marked: Record<string, Record<string, number>> = {};
  for (const place of competitorMenuNames()) {
    for (const i of competitorMenu(place)!.items) {
      if (!i.kind) continue;
      marked[place] ??= {};
      marked[place][i.kind] = (marked[place][i.kind] ?? 0) + 1;
    }
  }
  assert.deepEqual(marked, {
    "Beach Point Anyer": { "paket-bersama": 3 },
    "Happy Puppy Karaoke": { "sewa-ruang": 26 },
    "Infinity Restaurant Mambruk": { "paket-bersama": 3 },
    "Anang Family Karaoke": { "sewa-ruang": 8 },
    "Alta Spa Marbella Anyer": { "paket-bersama": 1 },
  });

  // Situs resmi Mambruk (mambruk.co.id/offers): "Starting from 950k / couple (2 pax)".
  const mambruk = competitorMenu("Infinity Restaurant Mambruk")!;
  const candle = mambruk.items.find((i) => i.name === "Seaside Candlelight Dinner (per pasangan / 2 pax)")!;
  assert.equal(candle.kind, "paket-bersama");
  assert.equal(candle.pax, 2);
  assert.equal(itemPriceText(candle), "Rp 950.000, paket 2 orang");
  assert.ok(!isCountedMenuItem(candle));
  // Batas atas turun dari Rp 950.000 ke The Mambruk Sizzling Grill, yang sumbernya tidak menyebut jumlah orang.
  assert.deepEqual(menuPriceRange(mambruk.items), { min: 30000, max: 250000 });

  // Foto menu Happy Puppy: "Paket Triple Delight, free room 3 jam dengan transaksi makanan dan minuman" per ukuran ruang.
  const puppy = competitorMenu("Happy Puppy Karaoke")!;
  const royal = puppy.items.find((i) => i.name === "Royal Suite (Weekend)" && i.category === "Paket Triple Delight")!;
  assert.equal(royal.kind, "sewa-ruang");
  assert.equal(itemPriceText(royal), "Rp 1.300.000, paket sewa ruang");
  const hourly = puppy.items.find((i) => i.name === "Royal Suite (Sabtu & Mbl)")!;
  assert.equal(itemPriceText(hourly), "Rp 120.000 per jam, sewa ruang");
  assert.deepEqual(menuPriceRange(puppy.items), { min: 20000, max: 80000 }, "tinggal minuman per gelas atau pitcher");
  const [card] = competitorMenuCards(["Happy Puppy Karaoke"], 8);
  assert.equal(card.itemCount, 65, "paket dan sewa ruang tetap tercatat sebagai informasi");
  assert.deepEqual(card.range, { min: 20000, max: 80000 });

  // Toko daring resmi Beach Point: PAKET KONGKOW 50K = Point Fries + Thai Tea + Lemon Tea; jumlah orang tidak disebut.
  const kongkow = competitorMenu("Beach Point Anyer")!.items.find((i) => i.name === "PAKET KONGKOW 100K")!;
  assert.equal(kongkow.pax, undefined);
  assert.equal(itemPriceText(kongkow), "Rp 100.000, paket beberapa orang");
  assert.deepEqual(menuPriceRange(competitorMenu("Alta Spa Marbella Anyer")!.items), { min: 150000, max: 750000 }, "Honeymooner 2 orang di luar kisaran");
  // Paket perawatan satu orang (Belia "paket lengkap") dan paket bersantap tanpa jumlah orang tidak ditandai.
  assert.ok(isCountedMenuItem(competitorMenu("Belia Spa and Reflexy Cilegon")!.items.find((i) => i.name === "Paket Cantik Belia")!));
  assert.ok(isCountedMenuItem(mambruk.items.find((i) => i.name.startsWith("The Mambruk Sizzling Grill"))!));
});

test("menu pesaing: hasil baca foto divalidasi, item sama dari dua versi menu digabung jadi rentang", () => {
  // Nilai mengikuti hasil baca Gemini 15 Nov 2026: Kalani (dua versi menu cumi), RM.MUARO, dan Happy Puppy.
  const { items, rejected } = normalizeMenuItems([
    { name: "Bakar", category: "CUMI / Porsi", price: 70000, unit: null, photo: 3 },
    { name: "Bakar", category: "CUMI 60K/Porsi", price: 60000, unit: null, photo: 4 },
    { name: "Kue Bakar/Goreng/Sop/Pindang Kuning/Rica-rica", category: "MENU UTAMA", price: 15000, unit: "/Ons", photo: 1 },
    { name: "Es Teh Manis", category: "MINUMAN", price: 7000, unit: "gelas", photo: 4 },
    { name: "Ayam Kampung Bakar/Goreng/Rica-rica", category: "MENU UTAMA", price: 35000, priceMax: 65, unit: null, photo: 1 },
    { name: "Kratingdaeng", category: "Minuman", price: null, unit: null, photo: 2 },
    // "15k/Ons" yang angkanya tidak dikali seribu, dan satuan berpengali seperti paket 2 jam karaoke.
    { name: "Kue", category: "MENU UTAMA", price: 15, unit: "per ons", photo: 1 },
    { name: "Small (Weekday)", category: "Paket Super Hemat", price: 230000, unit: "per 2 jam", photo: 2 },
  ]);
  assert.deepEqual(
    items.map((i) => [i.category, i.name, i.price, i.priceMax, i.unit, i.photo]),
    [
      ["CUMI / Porsi", "Bakar", 60000, 70000, null, 3],
      ["MENU UTAMA", "Kue Bakar/Goreng/Sop/Pindang Kuning/Rica-rica", 15000, null, "per ons", 1],
      ["MINUMAN", "Es Teh Manis", 7000, null, null, 4],
      ["MENU UTAMA", "Ayam Kampung Bakar/Goreng/Rica-rica", 35000, null, null, 1],
    ],
    "kategori dibandingkan tanpa token harga; batas atas yang belum dikali seribu diabaikan",
  );
  assert.deepEqual(
    rejected.map((r) => r.name),
    ["Kratingdaeng", "Kue", "Small (Weekday)"],
    "harga kosong, angka ribuan yang belum dikali, dan satuan berpengali ditolak",
  );
  assert.throws(() => normalizeMenuItems({ items: [] }), /harus berupa array/, "bentuk jawaban salah menghentikan pembacaan");
  assert.throws(() => normalizeMenuItems(undefined), /harus berupa array/);
});

test("menu pesaing: nama sama di paket berbeda tetap terpisah, rentang yang tertulis di menu disimpan", () => {
  // Foto Happy Puppy Cilegon: ruang Small ada di paket Triple Delight dan paket Super Hemat. RM.MUARO menulis "35-65K/Porsi".
  const { items } = normalizeMenuItems([
    { name: "Small (Weekday)", category: "Paket Triple Delight", price: 350000, unit: null },
    { name: "Small (Weekday)", category: "Paket Super Hemat", price: 230000, unit: null },
    { name: "Ayam Kampung Bakar/Goreng/Rica-rica", category: "MENU UTAMA", price: 35000, priceMax: 65000, unit: null },
  ]);
  assert.deepEqual(
    items.map((i) => [i.category, i.name, i.price, i.priceMax]),
    [
      ["Paket Triple Delight", "Small (Weekday)", 350000, null],
      ["Paket Super Hemat", "Small (Weekday)", 230000, null],
      ["MENU UTAMA", "Ayam Kampung Bakar/Goreng/Rica-rica", 35000, 65000],
    ],
  );
});

test("menu pesaing: hidangan yang persis sama di dua versi menu tidak tercatat dua kali", () => {
  // Dua versi menu RM.MUARO (Google Maps, 15 Nov 2026) memberi judul bagian berbeda untuk sayur yang sama.
  // Nasi per bakul BM Seaside adalah harga per item, bukan satuan yang tidak dikenal.
  const { items, rejected } = normalizeMenuItems([
    { name: "Karedok", category: "ANEKA SAYUR & SAMBAL", price: 15000, unit: null },
    { name: "Karedok", category: "ANEKA SAYUR DAN LALAPAN", price: 15000, unit: null },
    { name: "Nasi Putih", category: "OTHERS LAIN-LAIN", price: 27000, unit: "per bakul" },
  ]);
  assert.deepEqual(
    items.map((i) => [i.category, i.name, i.price, i.unit]),
    [
      ["ANEKA SAYUR & SAMBAL", "Karedok", 15000, null],
      ["OTHERS LAIN-LAIN", "Nasi Putih", 27000, null],
    ],
  );
  assert.equal(rejected.length, 0);
});

test("menu pesaing: tabel contoh diambil bergilir dari kategori menu, tanpa tambahan", () => {
  const sample = sampleItems(BEACH_POINT, 3);
  assert.deepEqual(
    sample.map((i) => i.name),
    ["ONION RING", "BUNTUT SAPI BAKAR", "REGULAR TEA"],
  );
  assert.equal(sampleItems(BEACH_POINT, 10).length, 4, "dua tambahan tidak pernah dicetak sebagai contoh");
});

test("menu pesaing: setiap tempat di berkas data membawa harga bersumber, kisaran per orang, atau catatan pemeriksaan", () => {
  const names = competitorMenuNames();
  assert.ok(names.length >= 24, `berkas data memuat ${names.length} tempat`);
  for (const name of names) {
    const menu = competitorMenu(name);
    assert.ok(menu, name);
    if (menu.items.length) assert.ok(menu.sources.length > 0, `${name}: item tanpa sumber`);
    else assert.ok(menu.perPerson !== null || menu.checked.length > 0, `${name}: tanpa harga dan tanpa catatan pemeriksaan`);
    for (const s of menu.sources) assert.match(s.url, /^https:\/\//, `${name}: sumber tanpa URL`);
  }
  const beachPoint = competitorMenu("Beach Point Anyer");
  assert.ok(beachPoint && beachPoint.items.length === 100 && beachPoint.sources[0].kind === "toko-daring");
  const mambruk = competitorMenu("Infinity Restaurant Mambruk");
  assert.ok(mambruk && mambruk.items.length >= 50 && mambruk.sources[0].url === "https://online.fliphtml5.com/mnhlb/xine/");
  assert.equal(competitorMenu("Tempat yang tidak ada"), null);
});
