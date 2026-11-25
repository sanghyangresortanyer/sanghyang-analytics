import test from "node:test";
import assert from "node:assert/strict";
import {
  getCompsetRateCoverage,
  getHotelRateTargets,
} from "../../src/lib/market/competitor-repository";

test("Cakupan Tarif C5 - Seluruh properti compset terdata dalam laporan cakupan", async () => {
  const coverage = await getCompsetRateCoverage();
  assert.ok(coverage.length >= 7, `Laporan cakupan harus mencakup Sanghyang dan enam pembanding inti (ditemukan: ${coverage.length})`);

  const names = coverage.map((c) => c.name.toLowerCase());
  assert.ok(names.some((n) => n.includes("sanghyang")), "Sanghyang harus ada dalam cakupan");
  assert.ok(names.some((n) => n.includes("aston")), "Aston Anyer harus ada dalam cakupan");
  assert.ok(names.some((n) => n.includes("mambruk")), "Mambruk harus ada dalam cakupan");
  assert.ok(names.some((n) => n.includes("nemuru")), "Nemuru harus ada dalam cakupan");
  assert.ok(names.some((n) => n.includes("marbella")), "Marbella harus ada dalam cakupan");
  assert.ok(names.some((n) => n.includes("pisita")), "My Pisita harus ada dalam cakupan");
  assert.ok(names.some((n) => n.includes("jayakarta")), "Jayakarta harus ada dalam cakupan");
  assert.ok(!names.some((n) => n.includes("patra")), "Patra Anyer (bintang 3 di semua sumber) tidak dirayapi");
  assert.ok(!names.some((n) => n.includes("allisa")), "Allisa sudah dikeluarkan dari kompset");
  assert.ok(!names.some((n) => n.includes("mutiara carita")), "Mutiara Carita sudah dikeluarkan dari kompset");
});

test("Cakupan Tarif C5 - Properti yang belum teramati memberikan alasan jujur (Zero Mock)", async () => {
  const coverage = await getCompsetRateCoverage();

  // Jumlah properti yang belum teramati bergantung pada hasil crawl terakhir (bisa nol). Invariannya: yang belum
  // teramati tidak punya harga buatan dan punya alasan, dan yang teramati punya harga.
  const unobserved = coverage.filter((c) => !c.isObserved);
  for (const item of coverage.filter((c) => c.isObserved)) {
    assert.ok(item.lastPrice !== null, `${item.name} teramati tetapi tanpa harga`);
  }

  for (const item of unobserved) {
    assert.equal(item.isObserved, false, `Item ${item.name} harus bernilai isObserved: false`);
    assert.equal(item.lastPrice, null, `Item ${item.name} yang belum diobservasi tidak boleh memiliki lastPrice buatan`);
    assert.ok(
      typeof item.unobservedReason === "string" && item.unobservedReason.length > 0,
      `Item ${item.name} harus memiliki unobservedReason yang jelas dan jujur`
    );
  }

  // Khusus Mövenpick: jelaskan ketiadaan di Google Travel
  const movenpick = coverage.find((c) => c.name.toLowerCase().includes("mövenpick") || c.name.toLowerCase().includes("movenpick"));
  if (movenpick && !movenpick.isObserved) {
    assert.match(movenpick.unobservedReason ?? "", /Google Travel|resmi|belum/i);
  }
});

test("Cakupan Tarif C5 - Properti teramati memiliki tanggal, harga, dan sumber observasi asli", async () => {
  const coverage = await getCompsetRateCoverage();
  const observed = coverage.filter((c) => c.isObserved);

  assert.ok(observed.length > 0, "Harus ada properti yang telah teramati dari snapshot database");

  for (const item of observed) {
    assert.ok(item.lastObservedAt instanceof Date, `lastObservedAt untuk ${item.name} harus berupa Date asli`);
    assert.ok(typeof item.lastPrice === "number" && item.lastPrice > 0, `lastPrice untuk ${item.name} harus > 0`);
    assert.ok(typeof item.lastSource === "string" && item.lastSource.length > 0, `lastSource untuk ${item.name} harus terisi`);
    assert.equal(item.unobservedReason, null, `Properti teramati ${item.name} tidak boleh memiliki unobservedReason`);
  }
});

test("Cakupan Tarif C5 - Sasaran pengumpulan tarif diambil dari registri DB", async () => {
  const targets = await getHotelRateTargets();
  assert.ok(targets.length > 0, "Sasaran tarif tidak boleh kosong");

  for (const t of targets) {
    assert.ok(t.name, "Setiap target harus memiliki nama");
    assert.ok(t.url.startsWith("http"), "Setiap target harus memiliki url Google Travel valid");
  }
});

test("Cakupan pembanding F&B - resto hotel hanya di D'Bistro, Sunset Grill hanya resto mandiri & open-air pool bar", async () => {
  const { getVenuesForOutlet } = await import("../../src/lib/market/competitor-repository");
  // Baris milik Sanghyang (compsetRole kosong) ikut terbaca getVenuesForOutlet; yang diuji hanya kompetitor.
  const rivals = async (outlet: string) => (await getVenuesForOutlet(outlet)).filter((v) => v.compsetRole !== null);
  const sunsetGrill = await rivals("sunset-grill");
  const dbistro = await rivals("dbistro");
  assert.ok(sunsetGrill.length >= 4, `kompetitor Sunset Grill: ${sunsetGrill.length}`);
  assert.ok(dbistro.length >= 7, `kompetitor D'Bistro: ${dbistro.length}`);
  for (const v of sunsetGrill.filter((x) => x.category === "resto")) {
    assert.equal(v.parentId, null, `${v.name} restoran di dalam hotel, bukan kompetitor Sunset Grill`);
  }
  assert.ok(sunsetGrill.some((v) => v.name === "Campo del Sol Pool Bar Marbella"), "Campo del Sol Pool Bar Marbella termasuk kompetitor Sunset Grill");
  for (const v of dbistro) assert.notEqual(v.parentId, null, `${v.name} resto mandiri, bukan kompetitor D'Bistro`);
});
