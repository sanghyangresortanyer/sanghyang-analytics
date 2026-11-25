import test from "node:test";
import assert from "node:assert/strict";
import { createSummaryGet, GET, validateSummaryParams } from "../../src/app/api/market-intelligence/summary/route";

const authedGet = createSummaryGet(async () => null);

test("U8 - Validasi Parameter Kueri Summary", () => {
  assert.equal(validateSummaryParams("30d", "all", null), true);
  assert.equal(validateSummaryParams("90d", "fnb", null), true);
  assert.equal(validateSummaryParams("year", "competitor", "Google Travel"), true);

  // Parameter tidak valid
  assert.equal(validateSummaryParams("invalid_period", "all", null), false);
  assert.equal(validateSummaryParams("30d", "invalid_segment", null), false);
  assert.equal(validateSummaryParams("30d", "all", "a".repeat(150)), false);
});

test("U8 - Endpoint Summary Menolak Permintaan Tanpa Autentikasi (401)", async () => {
  const req = new Request("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all");
  const res = await GET(req);
  assert.equal(res.status, 401, "Harus mengembalikan HTTP 401 jika belum login");
  const body = (await res.json()) as { error?: string };
  assert.ok(typeof body.error === "string" && body.error.length > 0);
});

test("U8 - Endpoint Summary Menolak Parameter Tidak Valid (400)", async () => {
  const req = new Request("http://localhost:3001/api/market-intelligence/summary?period=invalid_period&segment=all");
  const res = await authedGet(req);
  assert.equal(res.status, 400, "Harus mengembalikan HTTP 400 jika parameter tidak valid");
});

test("U8 - Kompatibilitas Payload JSON Hasil Optimasi", async () => {
  const req = new Request("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all");
  const res = await authedGet(req);
  assert.equal(res.status, 200, "Status respons harus 200");

  const data = await res.json();

  // 1. Kunci utama yang dikonsumsi klien UI dasbor & insight pasar
  const requiredKeys = [
    "counts",
    "sourceNames",
    "recentRows",
    "trend",
    "comparison",
    "priceComparison",
    "marketRateComparison",
    "marketRateHistory",
    "nightlyHeartbeat",
    "sanghyang",
    "outlets",
    "comparisons",
    "actionFindings",
    "executiveSummary",
    "syncStatus",
    "competitorSocialRadar",
    "outletMarketShare",
  ];
  for (const key of requiredKeys) {
    assert.ok(key in data, `Kunci payload "${key}" wajib ada`);
  }

  // 2. Integritas ringkasan counts
  assert.equal(typeof data.counts.marketItems, "number");
  assert.equal(typeof data.counts.competitors, "number");
  assert.equal(typeof data.counts.fnb, "number");
  assert.equal(typeof data.counts.events, "number");
  assert.equal(typeof data.counts.promotions, "number");
  assert.equal(typeof data.counts.reviews, "number");

  // 3. Multi-outlet unit bisnis Sanghyang (6 outlet)
  assert.ok(Array.isArray(data.outlets), "outlets harus berupa array");
  assert.equal(data.outlets.length, 6, "Harus memuat tepat 6 unit bisnis Sanghyang");

  const expectedOutletKeys = ["resort", "sunset-grill", "dragon-beach-club", "dbistro", "dbar", "dspa"];
  for (const key of expectedOutletKeys) {
    const found = data.outlets.find((o: { key: string }) => o.key === key);
    assert.ok(found, `Outlet "${key}" wajib ada dalam daftar outlet`);
    assert.ok(found.name, `Outlet "${key}" harus memiliki properti name`);
    assert.ok(found.channelBreakdown, `Outlet "${key}" harus memiliki channelBreakdown`);
    assert.ok(Array.isArray(found.topAspects), `Outlet "${key}" harus memiliki topAspects`);
    assert.ok(Array.isArray(found.reviews), `Outlet "${key}" harus memiliki reviews`);
    assert.equal(typeof found.verifiedReviewCount, "number");
  }

  // 4. Status sinkronisasi & observabilitas
  assert.ok(data.syncStatus, "syncStatus wajib ada");
  assert.equal(typeof data.syncStatus.totalReviews, "number");
  assert.equal(typeof data.syncStatus.verifiedReviews, "number");
  assert.ok(data.syncStatus.verifiedReviews <= data.syncStatus.totalReviews, "Ulasan terverifikasi tidak boleh lebih dari total ulasan");

  // 5. Perbandingan harga pasar (marketRateComparison)
  assert.ok(Array.isArray(data.marketRateComparison), "marketRateComparison harus berupa array");
  if (data.marketRateComparison.length > 0) {
    const firstRate = data.marketRateComparison[0];
    assert.ok(firstRate.hotel, "Tarif pasar harus memuat nama hotel");
    assert.equal(typeof firstRate.price, "number", "Tarif pasar harus memuat angka harga");
  }

  // 6. Radar sosial kompetitor
  assert.ok(Array.isArray(data.competitorSocialRadar), "competitorSocialRadar harus berupa array");

  // 7. Pangsa pasar per outlet
  assert.ok(data.outletMarketShare, "outletMarketShare wajib ada");
  assert.ok(data.outletMarketShare.all, "outletMarketShare.all wajib ada");
});

test("U8 - Dukungan Rentang Periode Kueri (30d, 90d, year)", async () => {
  for (const period of ["30d", "90d", "year"] as const) {
    const req = new Request(`http://localhost:3001/api/market-intelligence/summary?period=${period}&segment=all`);
    const res = await authedGet(req);
    assert.equal(res.status, 200, `Periode ${period} harus mengembalikan status 200`);
    const data = await res.json();
    assert.ok(data.counts, `Counts harus ada pada periode ${period}`);
    assert.ok(Array.isArray(data.recentRows), `recentRows harus array pada periode ${period}`);
  }
});

test("U8 - Benchmark Performa Latensi Kueri Summary (Target p95 < 1,5 detik pada DB lokal)", async () => {
  const iterations = 15;
  const durations: number[] = [];

  // Pemanasan (warmup 1 run)
  const warmupReq = new Request("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all");
  const warmupRes = await authedGet(warmupReq);
  assert.equal(warmupRes.status, 200);
  await warmupRes.json();

  // Pengukuran berulang
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const req = new Request("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all");
    const res = await authedGet(req);
    assert.equal(res.status, 200);
    await res.json();
    durations.push(performance.now() - start);
  }

  durations.sort((a, b) => a - b);
  const min = durations[0];
  const max = durations[durations.length - 1];
  const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
  const p95 = durations[p95Index];

  console.log(`\n=== HASIL BENCHMARK PERFORMA SUMMARY ENDPOINT (U8) ===`);
  console.log(`Jumlah Run: ${iterations}`);
  console.log(`Min Latensi: ${min.toFixed(2)} ms`);
  console.log(`Avg Latensi: ${avg.toFixed(2)} ms`);
  console.log(`p50 Latensi: ${p50.toFixed(2)} ms`);
  console.log(`p95 Latensi: ${p95.toFixed(2)} ms`);
  console.log(`Max Latensi: ${max.toFixed(2)} ms`);
  console.log(`Target SLA:  < 1500.00 ms`);
  console.log(`Status SLA:  ${p95 < 1500 ? "LULUS (TERPENUHI)" : "GAGAL"}`);
  console.log(`======================================================\n`);

  assert.ok(
    p95 < 1500,
    `Latensi p95 (${p95.toFixed(2)} ms) harus di bawah 1500 ms (1,5 detik) sesuai definisi selesai U8`
  );
});

test("Summary: rentang tanggal kustom divalidasi dan menyaring promo pesaing", async () => {
  const inverted = await authedGet(new Request("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all&from=2026-10-10&to=2026-10-01"));
  assert.equal(inverted.status, 400, "rentang terbalik ditolak");

  const res = await authedGet(new Request("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all&from=2026-10-01&to=2026-10-10"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.range, { from: "2026-10-01", to: "2026-10-10", label: "1 Okt 2026 – 10 Okt 2026", custom: true });
  const radar = data.competitorSocialRadar as { title: string; competitorName: string; startsAt: string }[];
  // Poster Instagram Marbella "Year End Special Christmas" diumumkan 5 Nov dan berlaku 24 Nov–25 Des 2026.
  assert.ok(!radar.some((p) => p.competitorName === "Marbella Place Anyer by Jayakarta" && p.title === "Year End Special Christmas"), "promo November tidak tampil di rentang 1–10 Oktober");
  // Semua tangkapan promo di DB lokal terjadi November 2026, jadi yang boleh tampil di 1–10 Oktober hanya promo yang
  // memang berlaku di rentang itu, bukan promo yang diumumkan atau dimulai sesudahnya.
  assert.ok(radar.every((p) => p.startsAt.slice(0, 10) <= "2026-10-10"), "tidak ada promo yang baru mulai sesudah rentang");
});
