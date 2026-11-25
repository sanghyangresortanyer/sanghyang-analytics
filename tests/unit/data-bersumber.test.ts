import { test } from "node:test";
import assert from "node:assert/strict";
import { findMenuPrice, officialMenu } from "../../src/lib/market/official-menu";
import { OUTLET_MARKET_SHARE_DATA, ALL_OUTLETS_MARKET_SHARE_DATA } from "../../src/lib/market/pricing-benchmark";
import { loadCompsetAudit } from "../../src/lib/market/compset-audit";
import { compsetRationale, type RationalePlace } from "../../src/lib/market/compset-rationale";
import { loadResortMarketSize } from "../../src/lib/market/market-size";

test("menu resmi: nama harus langsung diikuti harga, satuan per ons terbaca", () => {
  // Potongan teks foto menu Sunset Grill dan D'Bistro di konten situs resmi Sanghyang.
  const sunset = "Seafood\nSOP IKAN KAKAP · 120K\nONS\nIKAN KAKAP BAKAR · 36K/Ons";
  assert.deepEqual(findMenuPrice(sunset, "IKAN KAKAP BAKAR"), { price: 36000, unit: "per ons" });
  const bistro = "SOP BUNTUT · 150K\nSOP BUNTUT GORENG · 150K\nSOTO AYAM MADURA · 40K";
  assert.deepEqual(findMenuPrice(bistro, "SOP BUNTUT"), { price: 150000, unit: "porsi" });
  assert.equal(findMenuPrice(bistro, "SOP KONRO"), null, "item yang tidak ada tidak boleh ditebak");
  assert.equal(findMenuPrice("UDANG BAKAR · 95K\nUDANG BAKAR · 132K", "UDANG BAKAR"), null, "dua harga berbeda berarti ambigu");
});

test("menu resmi: harga yang dulu keliru kini sama dengan foto menu", () => {
  const price = (outlet: string, name: string) => officialMenu(outlet)?.items.find((i) => i.name === name)?.price;
  assert.equal(price("sunset-grill", "Cumi Bakar"), 86000, "dulu tertulis Rp 75.000");
  assert.equal(price("sunset-grill", "Udang Bakar"), 132000, "dulu tertulis Rp 80.000");
  assert.equal(price("dbistro", "Sop Buntut"), 150000, "dulu tertulis Rp 85.000");
  assert.equal(price("dbistro", "Nasi Goreng Kampung"), 40000, "dulu tertulis Rp 55.000");
});

test("outlet F&B: tanpa harga pesaing bersumber, indeks harga dan proyeksi kosong", () => {
  for (const [key, o] of Object.entries(OUTLET_MARKET_SHARE_DATA)) {
    if (key === "resort") continue;
    assert.equal(o.pricePositioningIndex, null, `${key}: indeks harga tidak boleh ditebak`);
    assert.equal(o.digitalMarketingStrategy.financialProjection.targetRevenueLiftPercent, null, `${key}: kenaikan omset tanpa dasar`);
    const official = new Set(officialMenu(key)?.items.map((i) => i.name) ?? []);
    for (const item of o.menuPriceItems) {
      assert.ok(official.has(item.itemName) || /promo resmi/i.test(item.itemName), `${key}: "${item.itemName}" tidak ada di menu resmi`);
      assert.equal(item.competitorPrices.length, 0, `${key}: harga pesaing tanpa sumber`);
    }
  }
  assert.equal(ALL_OUTLETS_MARKET_SHARE_DATA.pricePositioningIndex, null);
});

test("strategi harga outlet bermenu resmi menunjuk perbandingan per item yang sudah ada, bukan klaim belum dicocokkan", () => {
  // Perbandingan per item ada di Langkah 3 Insight Pasar dan ringkasan harga tab Strategy.
  for (const key of ["sunset-grill", "dbistro"]) {
    const pricing = OUTLET_MARKET_SHARE_DATA[key].digitalMarketingStrategy.pricingOptimization;
    assert.doesNotMatch(`${pricing.currentAnalysis} ${pricing.recommendation}`, /belum dicocokkan|Cocokkan item yang sama|halaman Untuk Direksi/, key);
    assert.match(pricing.currentAnalysis, /dibandingkan per item dengan item sebanding di menu kompetitor inti/, key);
    assert.match(pricing.recommendation, /ringkasan harga tab Strategy.*tidak di bawah P25 kompetitor/, key);
  }
  assert.match(OUTLET_MARKET_SHARE_DATA.dbar.digitalMarketingStrategy.pricingOptimization.currentAnalysis, /belum tercantum di situs Sanghyang/, "outlet tanpa menu resmi tetap");
});

test("teks strategi bebas angka dan klaim pesaing karangan lama", () => {
  const text = JSON.stringify([OUTLET_MARKET_SHARE_DATA, ALL_OUTLETS_MARKET_SHARE_DATA]);
  for (const fabricated of [/AOV/, /Rp 180\.000/, /diskon 16%/i, /Share of Wallet/i, /Bale-Bale/, /The Pier/, /09[.:]00\s*-\s*22[.:]00/]) {
    assert.doesNotMatch(text, fabricated);
  }
});

test("kalimat audit: acuan menyebut alasan tidak dihitung, pembanding inti menyebut alasan bersaing", () => {
  // Hawaii Resort (data kompset) dan Andalan Beach Resto & Coffee (registri DB lokal).
  const base: Omit<RationalePlace, "name" | "category" | "outlets" | "starRating" | "roomCount" | "roadKm" | "driveMinutes" | "compsetRole"> = {
    distanceSource: null,
    rating: null,
    reviewCount: null,
    facts: [],
    parent: null,
  };
  const ctx = { own: { starRating: 4, seaside: true }, market: null, rates: null, menu: null };
  const acuan = compsetRationale(
    { ...base, name: "Hawaii Resort Family Suites Anyer", category: "resort", outlets: ["resort"], starRating: 3, roomCount: 73, roadKm: 18.2, driveMinutes: 24, compsetRole: "benchmark" },
    "resort",
    ctx,
  );
  assert.match(acuan, /Acuan harga, tidak dihitung di pangsa pasar: Bintang 3/);
  const inti = compsetRationale(
    { ...base, name: "Andalan Beach Resto & Coffee", category: "resto", outlets: ["sunset-grill"], starRating: null, roomCount: null, roadKm: 2.1, driveMinutes: 4, compsetRole: "inti" },
    "sunset-grill",
    ctx,
  );
  assert.match(inti, /^Resto mandiri, 2,1 km atau 4 menit berkendara dari Sanghyang\./);
  assert.match(inti, /Kompetitor inti Sunset Grill/);
  assert.doesNotMatch(inti, /Memenuhi aturan/);
});

test("audit pembanding dari registri: Bale-Bale dan Allisa hanya muncul sebagai yang dikeluarkan", async () => {
  const audit = await loadCompsetAudit(await loadResortMarketSize());
  const usedNames = audit.all.used.map((c) => c.name);
  assert.ok(!usedNames.some((n) => /Bale-Bale|Allisa|Mutiara/.test(n)), "tempat yang dikeluarkan tidak boleh dipakai");
  assert.ok(audit.dspa.excluded.some((c) => c.name === "Bale-Bale Spa ASTON"), "Bale-Bale tercatat dikeluarkan beserta alasannya");
  assert.ok(audit.resort.excluded.some((c) => /Allisa/.test(c.name)));
  for (const c of audit.all.used) {
    assert.ok(c.roadKm !== null && c.roadKm !== undefined && c.roadKm <= 25, `${c.name}: jarak di luar aturan`);
  }
  // Audit 17 Nov membalik keputusan 14 Nov: Hawaii bintang 4 di Traveloka, Trip.com, dan Kayak, lalu lolos penilaian holistik.
  assert.ok(audit.resort.used.some((c) => /Hawaii/.test(c.name)), "Hawaii dipakai di daftar kompetitor aktif");
  assert.ok(!audit.resort.used.some((c) => /Patra/.test(c.name)), "Patra (bintang 3) tidak dipakai");
  assert.match(audit.resort.excluded.find((c) => /Patra/.test(c.name))?.reason ?? "", /bintang 3/i, "Patra tercatat dikeluarkan beserta alasannya");
});
