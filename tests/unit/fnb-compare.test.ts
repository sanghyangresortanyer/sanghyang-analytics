import { test } from "node:test";
import assert from "node:assert/strict";
import { competitorMenu, competitorMenuCards, competitorMenuNames, menuPriceRange } from "../../src/lib/market/competitor-menu";
import { officialMenu, officialMenuComparisons, OFFICIAL_MENU_SOURCE } from "../../src/lib/market/official-menu";
import { evaluateMenuItem } from "../../src/lib/market/fnb-pricing";
import {
  GENERIC_MATCH_LABEL,
  buildCompareRows,
  compareItems,
  distanceBands,
  filterRows,
  isFnbOutlet,
  itemCount,
  menuGroup,
  officialFnbItems,
  priceRange,
  rivalGap,
  withComparisons,
  type CompareInput,
  type FnbItem,
  type RivalMenu,
} from "../../src/lib/market/fnb-compare";
import { rivalFnbItems } from "../../src/lib/market/fnb-compare-data";
import type { DynamicCompetitorMenuRecord } from "../../src/lib/market/refresh-competitor-menus";

/** Item asli dari berkas data menu pesaing (dikumpulkan 15 Nov 2026). */
function item(place: string, name: string, category?: string) {
  const found = competitorMenu(place)?.items.find((i) => i.name === name && (category === undefined || i.category === category));
  assert.ok(found, `${name} harus ada di menu ${place}`);
  return found;
}

const items = (place: string): FnbItem[] => {
  const list = rivalFnbItems(place);
  assert.ok(list, `${place} harus ada di berkas data menu`);
  return list;
};

// Pembanding Sunset Grill di registri DB lokal 16 Nov 2026, urut jarak tempuh (nama, km, rating, ulasan, hotel induk).
const SUNSET_GRILL_USED = [
  { name: "RM.MUARO", roadKm: 1.9, rating: 4.2, reviewCount: 1818, parentName: null },
  { name: "Kamalika Beach Cafe & Resto", roadKm: 2, rating: 4.5, reviewCount: 863, parentName: null },
  { name: "Andalan Beach Resto & Coffee", roadKm: 2.1, rating: 4.5, reviewCount: 99, parentName: null },
  { name: "Ikan Bakar Tanjung Pinang 88", roadKm: 2.2, rating: 4.6, reviewCount: 613, parentName: null },
  { name: "Beach Point Anyer", roadKm: 3.6, rating: 4.4, reviewCount: 868, parentName: null },
  { name: "Sunset Cafe Aston Anyer", roadKm: 11.8, rating: null, reviewCount: null, parentName: "Aston Anyer Beach Hotel" },
  { name: "Hotel Pier Aston Anyer", roadKm: 11.8, rating: null, reviewCount: null, parentName: "Aston Anyer Beach Hotel" },
  { name: "Kalani Beach Resto Anyer", roadKm: 15.1, rating: 4.6, reviewCount: 503, parentName: null },
  { name: "BM Seaside View Cafe & Resto", roadKm: 16, rating: 4.6, reviewCount: 1311, parentName: null },
  { name: "Omah Laut Cafe & Resto", roadKm: 19.3, rating: 4.8, reviewCount: 130, parentName: null },
];

const rivalsOf = (used: { name: string }[], core: (name: string) => boolean = () => true): RivalMenu[] =>
  used.map((u) => ({ name: u.name, core: core(u.name), items: rivalFnbItems(u.name) ?? [] }));

function sunsetGrillInput(): CompareInput {
  return {
    own: {
      name: "Sunset Grill",
      items: officialFnbItems(officialMenu("sunset-grill")),
      rating: null,
      reviewCount: null,
      source: { label: `Foto menu resmi di situs Sanghyang, konten ${OFFICIAL_MENU_SOURCE.capturedAt}`, url: "https://sanghyang.com/sunset-grill/" },
      photos: [],
    },
    used: SUNSET_GRILL_USED.map((u) => ({ name: u.name, roadKm: u.roadKm, rating: u.rating, reviewCount: u.reviewCount, compsetRole: "inti" as const, mapsUrl: null })),
    cards: Object.fromEntries(competitorMenuCards(SUNSET_GRILL_USED.map((u) => u.name), 8).map((c) => [c.name, c])),
    extras: Object.fromEntries(
      SUNSET_GRILL_USED.map((u) => [u.name, { parentName: u.parentName, group: "resto" as const, photos: [], items: rivalFnbItems(u.name) }]),
    ),
  };
}

test("outlet pembanding menu: semua outlet kecuali Kamar & Resort dan gabungan", () => {
  assert.equal(isFnbOutlet("sunset-grill"), true);
  assert.equal(isFnbOutlet("dspa"), true);
  assert.equal(isFnbOutlet("resort"), false);
  assert.equal(isFnbOutlet("all"), false);
  assert.equal(isFnbOutlet(null), false);
});

test("kategori menu mengikuti judul bagian di sumbernya: kelapa di bagian dessert tetap makanan", () => {
  assert.equal(menuGroup(item("BM Seaside View Cafe & Resto", "Coconut Jelly")), "makanan");
  assert.equal(menuGroup(item("Beach Point Anyer", "FRESH COCONUT")), "minuman");
  assert.equal(menuGroup(item("Kamalika Beach Cafe & Resto", "Coconut water")), "minuman", "bagian NON - COFFEE tetap minuman");
  assert.equal(menuGroup(item("Kamalika Beach Cafe & Resto", "Ayam goreng")), "makanan", "bagian NON - SEAFOOD tetap makanan");
  // Tanpa judul bagian, nama item yang menentukan.
  assert.equal(menuGroup(item("Happy Puppy Karaoke", "Sparkling Punch")), "minuman");
  assert.equal(menuGroup(item("Serai Restaurant Novus Jiva Anyer", "Seafood Mie Goreng")), "makanan");
  assert.equal(menuGroup(item("Happy Puppy Karaoke", "Small (Minggu - Jumat)")), "sewa-ruangan");
  assert.equal(menuGroup(item("Happy Puppy Karaoke", "Small (Weekday)", "Paket Super Hemat")), "paket");
  assert.equal(menuGroup(item("Andalan Beach Resto & Coffee", "Bundling promo Iga Bakar Andalan + Pineapple Lychee (harga ++)")), "paket");

  const sunset = officialFnbItems(officialMenu("sunset-grill"));
  assert.deepEqual(
    sunset.map((i) => [i.name, i.group, i.unit]),
    [
      ["Ikan Kwe (goreng/bakar)", "makanan", null],
      ["Ikan Kakap Bakar", "makanan", "per ons"],
      ["Kerapu Bakar", "makanan", "per ons"],
      ["Cumi Bakar", "makanan", null],
      ["Udang Bakar", "makanan", null],
      ["Kelapa Muda (Young Coconut)", "minuman", null],
    ],
  );
  assert.deepEqual(officialFnbItems(officialMenu("dbar")), [], "D'Bar belum punya daftar harga resmi");
});

test("rentang semua kategori sama dengan rentang kartu menu web dan PDF untuk setiap pesaing", () => {
  for (const name of competitorMenuNames()) {
    assert.deepEqual(priceRange(items(name), "all"), menuPriceRange(competitorMenu(name)!.items), name);
  }
});

test("rentang dan jumlah item per kategori: sewa ruangan karaoke per jam, tambahan tidak dihitung, paket promo dihitung tanpa harga", () => {
  const puppy = items("Happy Puppy Karaoke");
  assert.deepEqual(priceRange(puppy, "sewa-ruangan"), { min: 35000, max: 120000 });
  assert.equal(itemCount(puppy, "sewa-ruangan"), 10);
  // Paket Triple Delight dan Super Hemat adalah paket ruang karaoke (keputusan pemilik 22 Nov 2026): tercatat, tanpa kisaran per porsi.
  assert.equal(priceRange(puppy, "paket"), null);
  assert.equal(itemCount(puppy, "paket"), 16);
  assert.deepEqual(priceRange(puppy, "minuman"), { min: 20000, max: 80000 });

  // Beach Point: 100 item, 5 di antaranya tambahan (ADD. DRINK) dan biaya kemasan (TAKE AWAY).
  const beach = items("Beach Point Anyer");
  assert.equal(itemCount(beach, "all"), 95);
  assert.deepEqual(priceRange(beach, "minuman"), { min: 11000, max: 28000 });

  const andalan = items("Andalan Beach Resto & Coffee");
  assert.equal(itemCount(andalan, "all"), 1);
  assert.equal(priceRange(andalan, "all"), null, "paket promo (harga ++) bukan patokan harga menu");

  const sunset = officialFnbItems(officialMenu("sunset-grill"));
  assert.deepEqual(priceRange(sunset, "all"), { min: 20000, max: 132000 }, "harga per ons kakap dan kerapu tidak masuk rentang per porsi");
  assert.deepEqual(priceRange(sunset, "makanan"), { min: 86000, max: 132000 });
  assert.equal(itemCount(sunset, "all"), 6);
});

test("perbandingan per item Sunset Grill: bahan utama dan satuan sama, harga tengah untuk rentang di sumber", () => {
  const comps = compareItems(officialFnbItems(officialMenu("sunset-grill")), rivalsOf(SUNSET_GRILL_USED));
  const byName = new Map(comps.map((c) => [c.item.name, c]));
  const prices = (name: string) => byName.get(name)!.matches.map((m) => [m.rival, m.price]);

  // RM.MUARO menjual udang per ons, jadi tidak dibandingkan dengan udang bakar per porsi.
  assert.deepEqual(prices("Udang Bakar"), [
    ["Kamalika Beach Cafe & Resto", 70000],
    ["Beach Point Anyer", 42000],
    ["Kalani Beach Resto Anyer", 65000],
    ["BM Seaside View Cafe & Resto", 71500],
  ]);
  assert.equal(byName.get("Udang Bakar")!.average, 62125);
  assert.equal(byName.get("Udang Bakar")!.averageGapPercent, -53);
  // Kalani mencantumkan "BAKAR" di bagian UDANG / Porsi seharga 60.000-70.000: dihitung 65.000.
  const kalaniUdang = byName.get("Udang Bakar")!.matches.find((m) => m.rival === "Kalani Beach Resto Anyer")!;
  assert.equal(kalaniUdang.items.length, 8);
  assert.ok(kalaniUdang.items.includes("BAKAR (UDANG / Porsi)"), "nama item yang hanya cara masak diberi judul bagiannya");
  assert.ok(kalaniUdang.items.includes("Udang Bakar"));
  assert.equal(kalaniUdang.gapPercent, -51);

  // "Oseng Cumi Asin" adalah lauk asin, dan "Cumi" RM.MUARO dijual per ons.
  assert.ok(!prices("Cumi Bakar").some(([rival]) => rival === "RM.MUARO"));
  assert.equal(byName.get("Cumi Bakar")!.average, 61500);
  assert.equal(byName.get("Cumi Bakar")!.averageGapPercent, -28);

  // Kamalika (dan Kalani untuk kerapu) masuk lewat padanan umum ikan bakar per ons; rinciannya di tes padanan umum.
  assert.deepEqual(prices("Ikan Kakap Bakar"), [["RM.MUARO", 15500], ["Kamalika Beach Cafe & Resto", 17000], ["Kalani Beach Resto Anyer", 13000]]);
  assert.equal(byName.get("Ikan Kakap Bakar")!.averageGapPercent, -58);
  assert.deepEqual(prices("Kerapu Bakar"), [["RM.MUARO", 16000], ["Kamalika Beach Cafe & Resto", 17000], ["Kalani Beach Resto Anyer", 13750]]);
  assert.equal(byName.get("Kerapu Bakar")!.averageGapPercent, -70);

  // Ikan kwe Sanghyang per porsi; pesaing (Kalani "IKAN KUE") menjualnya per ons.
  assert.deepEqual(byName.get("Ikan Kwe (goreng/bakar)")!.matches, []);
  assert.equal(byName.get("Ikan Kwe (goreng/bakar)")!.average, null);

  // "Coconut Jelly" BM Seaside ada di bagian dessert, bukan minuman kelapa.
  assert.deepEqual(prices("Kelapa Muda (Young Coconut)"), [
    ["RM.MUARO", 16000],
    ["Kamalika Beach Cafe & Resto", 21000],
    ["Beach Point Anyer", 23000],
    ["Kalani Beach Resto Anyer", 15000],
  ]);
  assert.equal(byName.get("Kelapa Muda (Young Coconut)")!.averageGapPercent, -6);
});

test("padanan umum B2 (keputusan pemilik 22 Nov 2026): ikan bakar per ons tanpa jenis ikan membandingi kakap dan kerapu bakar per ons, berlabel", () => {
  const comps = compareItems(officialFnbItems(officialMenu("sunset-grill")), rivalsOf(SUNSET_GRILL_USED));
  const byName = new Map(comps.map((c) => [c.item.name, c]));
  const rows = (name: string) => byName.get(name)!.matches.map((m) => [m.rival, m.price, m.gapPercent, m.generic, m.items]);

  // Kamalika "Ikan bakar madu/manado" dan Kalani "Ikan Bakar" serta "BAKAR" di bagian IKAN: cara masak dan satuan sama,
  // jenis ikan tidak disebut. Kalani "Ikan Goreng" dan BM Seaside "Ikan Steam" beda cara masak, jadi tidak dipakai.
  assert.deepEqual(rows("Kerapu Bakar"), [
    ["RM.MUARO", 16000, -69, false, ["Kakap Merah/ Kerapu"]],
    ["Kamalika Beach Cafe & Resto", 17000, -67, true, ["Ikan bakar madu/manado"]],
    ["Kalani Beach Resto Anyer", 13750, -74, true, ["Ikan Bakar", "BAKAR (IKAN)"]],
  ]);
  assert.equal(byName.get("Kerapu Bakar")!.average, 15583);
  // Item yang menyebut jenis ikannya tetap didahulukan: Kalani punya IKAN KAKAP, jadi padanan umumnya tidak dipakai untuk kakap.
  assert.deepEqual(rows("Ikan Kakap Bakar"), [
    ["RM.MUARO", 15500, -57, false, ["Kakap Merah/ Kerapu", "Gurame/ Kakap Putih"]],
    ["Kamalika Beach Cafe & Resto", 17000, -53, true, ["Ikan bakar madu/manado"]],
    ["Kalani Beach Resto Anyer", 13000, -64, false, ["IKAN KAKAP"]],
  ]);
  assert.equal(byName.get("Ikan Kakap Bakar")!.average, 15167);
  // Padanan umum hanya untuk harga per ons: ikan kwe per porsi dan udang tetap memakai aturan bahan utama yang sama.
  assert.deepEqual(byName.get("Ikan Kwe (goreng/bakar)")!.matches, []);
  assert.deepEqual(comps.filter((c) => c.matches.some((m) => m.generic)).map((c) => c.item.name), ["Ikan Kakap Bakar", "Kerapu Bakar"]);

  // Ringkasan selisih per kompetitor tetap dari item yang jenisnya sama, supaya padanan perkiraan tidak menggeser angka ringkasan.
  assert.deepEqual(rivalGap(comps, "Kamalika Beach Cafe & Resto", "all"), { percent: -20, items: 3 });
  assert.deepEqual(rivalGap(comps, "Kalani Beach Resto Anyer", "all"), { percent: -41, items: 4 });

  // Untuk Direksi: harga padanan umum ikut dinilai dengan label yang sama.
  assert.equal(GENERIC_MATCH_LABEL, "padanan umum: jenis ikan tidak disebut");
  const kerapu = withComparisons(officialMenuComparisons("sunset-grill"), comps).find((r) => r.itemName === "Kerapu Bakar")!;
  assert.deepEqual(
    kerapu.competitorPrices.map((p) => [p.competitorName, p.price, p.note]),
    [
      ["RM.MUARO", 16000, "Kakap Merah/ Kerapu"],
      ["Kamalika Beach Cafe & Resto", 17000, "Ikan bakar madu/manado · padanan umum: jenis ikan tidak disebut"],
      ["Kalani Beach Resto Anyer", 13750, "Ikan Bakar; BAKAR (IKAN) · padanan umum: jenis ikan tidak disebut"],
    ],
  );
});

test("rekaman menu dinamis bernama sama tidak menghapus penanda paket beberapa orang dari berkas data", () => {
  // Bentuk rekaman refresh dari halaman penawaran resmi Mambruk (kutipan situs 22 Nov 2026), seperti hasil loadDynamicCompetitorMenuItems.
  const record: DynamicCompetitorMenuRecord = {
    competitorId: "cf6b4631-895b-4cea-bce0-71e68b34c50d",
    competitorName: "Infinity Restaurant Mambruk",
    placeId: "infinity_restaurant_mambruk",
    category: "resto",
    items: [
      {
        name: "Seaside Candlelight Dinner (per pasangan / 2 pax)",
        category: "Paket Dining",
        price: 950000,
        priceMax: null,
        unit: null,
        quote: "Starting from 950k / couple (2 pax), our romantic candlelight dinner",
      },
    ],
    sourceUrl: "https://mambruk.co.id/offers",
    sourceLabel: "Halaman penawaran dining resmi Mambruk Hotel & Convention",
    observedAt: "2026-11-22T00:00:00.000Z",
  };
  const merged = rivalFnbItems("Infinity Restaurant Mambruk", record)!;
  const candle = merged.filter((i) => i.name.startsWith("Seaside Candlelight Dinner"));
  assert.equal(candle.length, 1, "rekaman dinamis menggantikan item berkas data yang sama, tidak menggandakannya");
  assert.equal(candle[0].excluded, "paket-bersama");
  assert.deepEqual(priceRange(merged, "all"), { min: 30000, max: 250000 });
});

test("perbandingan per item D'Bistro: pesaing bisa lebih mahal, gurame per porsi belum ada pembanding", () => {
  const used = [{ name: "Kalani Beach Resto Anyer" }, { name: "BM Seaside View Cafe & Resto" }, { name: "Serai Restaurant Novus Jiva Anyer" }, { name: "Campo del Sol Pool Bar Marbella" }];
  const comps = compareItems(officialFnbItems(officialMenu("dbistro")), rivalsOf(used));
  const soto = comps.find((c) => c.item.name === "Soto Ayam Madura")!;
  assert.deepEqual(soto.matches.map((m) => [m.rival, m.price, m.gapPercent]), [
    ["Serai Restaurant Novus Jiva Anyer", 58000, 45],
    ["Campo del Sol Pool Bar Marbella", 45000, 13],
  ]);
  assert.equal(soto.average, 51500);
  assert.equal(soto.averageGapPercent, 29);
  assert.deepEqual(comps.find((c) => c.item.name === "Gurame Bakar")!.matches, []);
  assert.equal(comps.find((c) => c.item.name === "Sop Buntut")!.average, 95000);
});

test("rata-rata hanya dari pesaing inti; pesaing acuan tetap tampil di daftar pembanding", () => {
  const comps = compareItems(
    officialFnbItems(officialMenu("sunset-grill")),
    rivalsOf(SUNSET_GRILL_USED, (name) => name !== "Kalani Beach Resto Anyer"),
  );
  const udang = comps.find((c) => c.item.name === "Udang Bakar")!;
  assert.equal(udang.average, 61167);
  assert.equal(udang.matches.find((m) => m.rival === "Kalani Beach Resto Anyer")?.core, false);
});

test("selisih per pesaing = rata-rata selisih item sebanding terhadap harga Sanghyang", () => {
  const comps = compareItems(officialFnbItems(officialMenu("sunset-grill")), rivalsOf(SUNSET_GRILL_USED));
  assert.deepEqual(rivalGap(comps, "Kalani Beach Resto Anyer", "all"), { percent: -41, items: 4 });
  assert.deepEqual(rivalGap(comps, "Kalani Beach Resto Anyer", "minuman"), { percent: -25, items: 1 });
  assert.deepEqual(rivalGap(comps, "BM Seaside View Cafe & Resto", "all"), { percent: -31, items: 2 });
  assert.deepEqual(rivalGap(comps, "Kamalika Beach Cafe & Resto", "all"), { percent: -20, items: 3 });
  assert.equal(rivalGap(comps, "Andalan Beach Resto & Coffee", "all"), null);
});

test("baris tabel: Sanghyang lebih dulu, pesaing urut registri, filter pita jarak dan jenis pesaing", () => {
  const input = sunsetGrillInput();
  const rows = buildCompareRows(input, "all");
  assert.equal(rows[0].sanghyang, true);
  assert.deepEqual(rows[0].range, { min: 20000, max: 132000 });
  assert.equal(rows[0].itemCount, 6);
  assert.equal(rows[0].gap, null);
  assert.deepEqual(rows.slice(1).map((r) => r.name), SUNSET_GRILL_USED.map((u) => u.name));

  const kalani = rows.find((r) => r.name === "Kalani Beach Resto Anyer")!;
  assert.equal(kalani.band, "15–25 km");
  assert.equal(kalani.placement, "mandiri");
  assert.deepEqual(kalani.gap, { percent: -41, items: 4 });
  assert.deepEqual(kalani.range, { min: 5000, max: 240000 });
  assert.equal(kalani.itemCount, 55);
  assert.ok(kalani.perPerson, "kisaran per orang Google Maps ikut dari kartu menu");

  const aston = rows.find((r) => r.name === "Sunset Cafe Aston Anyer")!;
  assert.equal(aston.placement, "hotel");
  assert.equal(aston.parentName, "Aston Anyer Beach Hotel");
  assert.equal(aston.band, "10–15 km");
  assert.equal(aston.itemCount, 6, "harga menu nyata Sunset Cafe Aston Anyer tercatat dari liputan publik terverifikasi");
  assert.deepEqual(aston.range, { min: 48000, max: 88000 });
  assert.equal(aston.gap, null);

  const pier = rows.find((r) => r.name === "Hotel Pier Aston Anyer")!;
  assert.equal(pier.placement, "hotel");
  assert.equal(pier.itemCount, 0, "sumber sudah diperiksa, belum ada harga per item terpisah");
  assert.equal(pier.range, null);
  assert.equal(pier.gap, null);

  assert.deepEqual(distanceBands(rows), ["0–5 km", "10–15 km", "15–25 km"]);
  const names = (list: typeof rows) => list.map((r) => r.name);
  assert.deepEqual(names(filterRows(rows, { band: "10–15 km", placement: "all" })), [rows[0].name, "Sunset Cafe Aston Anyer", "Hotel Pier Aston Anyer"]);
  assert.deepEqual(names(filterRows(rows, { band: "all", placement: "hotel" })), [rows[0].name, "Sunset Cafe Aston Anyer", "Hotel Pier Aston Anyer"]);
  assert.deepEqual(names(filterRows(rows, { band: "0–5 km", placement: "hotel" })), [rows[0].name], "Sanghyang selalu tampil sebagai acuan");

  const drinks = buildCompareRows(input, "minuman");
  assert.deepEqual(drinks.find((r) => r.name === "Kalani Beach Resto Anyer")!.range, { min: 7000, max: 28000 });
  assert.deepEqual(drinks.find((r) => r.name === "Kalani Beach Resto Anyer")!.gap, { percent: -25, items: 1 });
  assert.deepEqual(drinks[0].range, { min: 20000, max: 20000 });
});

test("pesaing yang belum ada di berkas data menu ditandai belum diperiksa, bukan nol item", () => {
  const input = sunsetGrillInput();
  const fresh = "Tempat Baru Belum Diperiksa";
  input.used = [...input.used, { name: fresh, roadKm: 4, rating: null, reviewCount: null, compsetRole: "inti", mapsUrl: null }];
  input.cards[fresh] = competitorMenuCards([fresh], 8)[0];
  input.extras[fresh] = { parentName: null, group: "resto", photos: [], items: rivalFnbItems(fresh) };
  const row = buildCompareRows(input, "all").find((r) => r.name === fresh)!;
  assert.equal(row.itemCount, null);
  assert.equal(row.range, null);
});

test("outlet tanpa daftar harga resmi: baris Sanghyang dan selisih tanpa angka", () => {
  const input = sunsetGrillInput();
  input.own = { ...input.own, items: officialFnbItems(officialMenu("dbar")), source: null };
  const rows = buildCompareRows(input, "all");
  assert.equal(rows[0].range, null);
  assert.equal(rows[0].itemCount, 0);
  assert.ok(rows.slice(1).every((r) => r.gap === null));
});

test("baris menu Untuk Direksi memakai harga pesaing inti yang sama dengan tabel Insight Pasar", () => {
  const comps = compareItems(officialFnbItems(officialMenu("sunset-grill")), rivalsOf(SUNSET_GRILL_USED));
  const rows = withComparisons(officialMenuComparisons("sunset-grill"), comps);
  const udang = rows.find((r) => r.itemName === "Udang Bakar")!;
  assert.equal(udang.competitorPrices.length, 4);
  assert.equal(evaluateMenuItem(udang).averageCompetitorPrice, 62125);
  assert.equal(evaluateMenuItem(udang).stance, "premium");
  assert.match(udang.competitorPrices[0].note ?? "", /Udang bakar madu\/manado/);
  assert.equal(evaluateMenuItem(rows.find((r) => r.itemName === "Ikan Kwe (goreng/bakar)")!).stance, "no-data");
});

test("item menu untuk browser tanpa nomor foto, URL foto menu, atau nama mesin pembaca", () => {
  for (const name of competitorMenuNames()) {
    const text = JSON.stringify(rivalFnbItems(name));
    assert.ok(!/googleusercontent|gemini|"photo"/i.test(text), name);
  }
  assert.equal(rivalFnbItems("Tempat Baru Belum Diperiksa"), null);
});

test("perbandingan D'Bistro dengan compset restoran hotel nyata (Mambruk, Serai, Jayakarta, Aston)", () => {
  const used = [
    { name: "Infinity Restaurant Mambruk" },
    { name: "Serai Restaurant Novus Jiva Anyer" },
    { name: "Lagoon Restaurant Jayakarta" },
    { name: "Sunset Cafe Aston Anyer" },
  ];
  const comps = compareItems(officialFnbItems(officialMenu("dbistro")), rivalsOf(used));
  const byName = new Map(comps.map((c) => [c.item.name, c]));

  // Sop Buntut: Mambruk Rp 180.000 (+20%); Yellow Oxtail Fried Rice Serai tidak ikut dicocokkan ke sop buntut.
  const buntut = byName.get("Sop Buntut")!;
  assert.deepEqual(
    buntut.matches.map((m) => [m.rival, m.price, m.gapPercent]),
    [["Infinity Restaurant Mambruk", 180000, 20]],
  );

  // Soto Ayam Madura: Mambruk Rp 70.000, Serai Rp 58.000, Lagoon Jayakarta Rp 40.000.
  const soto = byName.get("Soto Ayam Madura")!;
  assert.deepEqual(
    soto.matches.map((m) => [m.rival, m.price, m.gapPercent]),
    [
      ["Infinity Restaurant Mambruk", 70000, 75],
      ["Serai Restaurant Novus Jiva Anyer", 58000, 45],
      ["Lagoon Restaurant Jayakarta", 40000, 0],
    ],
  );

  // Udang Bakar: Mambruk (Udang Goreng saus padang 100K & Udang Telur Asin 150K -> median 125K); pasta udang Serai tidak ikut.
  const udang = byName.get("Udang Bakar")!;
  assert.deepEqual(
    udang.matches.map((m) => [m.rival, m.price, m.gapPercent]),
    [["Infinity Restaurant Mambruk", 125000, 32]],
  );

  // Nasi Goreng Kampung: Mambruk Rp 95.000, Serai (88K & 168K -> median Rp 128.000).
  const nasgor = byName.get("Nasi Goreng Kampung")!;
  assert.deepEqual(
    nasgor.matches.map((m) => [m.rival, m.price, m.gapPercent]),
    [
      ["Infinity Restaurant Mambruk", 95000, 138],
      ["Serai Restaurant Novus Jiva Anyer", 128000, 220],
    ],
  );

  // Kategori minuman Mambruk (NON-ALCOHOL & BEER) masuk minuman, bukan makanan.
  assert.equal(menuGroup(item("Infinity Restaurant Mambruk", "Aqua Reflections")), "minuman");
  assert.equal(menuGroup(item("Infinity Restaurant Mambruk", "Bali Hai")), "minuman");
  assert.equal(menuGroup(item("Infinity Restaurant Mambruk", "Seaside Candlelight Dinner (per pasangan / 2 pax)")), "paket");
});

test("pencocokan item sebanding lintas bahasa Inggris & variasi ejaan restoran hotel", () => {
  const englishRival: RivalMenu = {
    name: "Hotel Resto Uji",
    core: true,
    items: [
      { name: "Oxtail Soup", category: "Soup", price: 175000, priceMax: null, unit: null, group: "makanan", excluded: null },
      { name: "Chicken Soto", category: "Indonesian", price: 65000, priceMax: null, unit: null, group: "makanan", excluded: null },
      { name: "Grilled Gouramy", category: "Seafood", price: 120000, priceMax: null, unit: null, group: "makanan", excluded: null },
      { name: "Grilled Prawn", category: "Seafood", price: 130000, priceMax: null, unit: null, group: "makanan", excluded: null },
      { name: "Signature Fried Rice", category: "Rice", price: 85000, priceMax: null, unit: null, group: "makanan", excluded: null },
      { name: "Prawn Carbonara Pasta", category: "Pasta", price: 110000, priceMax: null, unit: null, group: "makanan", excluded: null },
    ],
  };
  const comps = compareItems(officialFnbItems(officialMenu("dbistro")), [englishRival]);
  const hitPrice = (name: string) => comps.find((c) => c.item.name === name)!.matches[0]?.price ?? null;
  assert.equal(hitPrice("Sop Buntut"), 175000);
  assert.equal(hitPrice("Soto Ayam Madura"), 65000);
  assert.equal(hitPrice("Gurame Bakar"), 120000);
  assert.equal(hitPrice("Udang Bakar"), 130000, "pasta udang tidak ikut mencampuri harga udang bakar");
  assert.equal(hitPrice("Nasi Goreng Kampung"), 85000);
});

test("data harga nyata lintas outlet: D'Spa (Alta Spa & Belia Spa) dan D'Bar (Anang Family Karaoke & Upper Circle)", () => {
  // Honeymooner (2 orang, Rp 850.000) adalah paket beberapa orang, jadi batas atasnya Bali Bungah satu orang.
  assert.deepEqual(priceRange(items("Alta Spa Marbella Anyer"), "all"), { min: 150000, max: 750000 });
  assert.equal(itemCount(items("Alta Spa Marbella Anyer"), "all"), 13);
  assert.deepEqual(priceRange(items("Belia Spa and Reflexy Cilegon"), "all"), { min: 45000, max: 250000 });
  assert.equal(itemCount(items("Belia Spa and Reflexy Cilegon"), "all"), 7);
  assert.deepEqual(priceRange(items("Anang Family Karaoke"), "sewa-ruangan"), { min: 65000, max: 135000 });
  assert.equal(itemCount(items("Anang Family Karaoke"), "sewa-ruangan"), 8);
  assert.equal(itemCount(items("The Upper Circle Novus Jiva"), "all"), 1);
});
