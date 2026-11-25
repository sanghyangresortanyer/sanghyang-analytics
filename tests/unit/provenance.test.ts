/**
 * tests/unit/provenance.test.ts
 *
 * Pengujian Unit untuk Gelombang 1 Temuan D2, D3, D4, dan D5:
 * 1. D3: Perhitungan status promo berbasis tanggal (Zero Hardcode / No embedded promo constant).
 * 2. D5: Zero hardcoded revenue numbers di kode sumber, pemuatan omset dinamis dari DB.
 * 3. D2: Integritas data & Zero Mock pada metrik pasar, TAM, dan URL bukti observasi.
 * 4. D4: Generator insight berpijak data asli dengan confidence & prioritas dinamis.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computePromotionStatus } from "../../src/lib/market/sync-social-promos";
import {
  OUTLET_MARKET_SHARE_DATA,
  ALL_OUTLETS_MARKET_SHARE_DATA,
  getOutletMarketShare,
} from "../../src/lib/market/pricing-benchmark";
import { OUTLET_HEAD_TO_HEAD_COMPARISONS } from "../../src/lib/market/competitor-comparison";
import {
  getOutletRevenueFromDb,
  getMonthlyRevenueAllOutlets,
  BASELINE_MONTH,
} from "../../src/lib/market/revenue-baseline";
import {
  computeReviewConfidence,
  computePriceConfidence,
  isInsightStale,
  generateGroundedInsights,
  type GroundedObservationInput,
} from "../../src/lib/market/insight-generator";
import { calculatePrecisionMarketShare } from "../../src/lib/market/hotel-compset";
import { loadResortMarketSize } from "../../src/lib/market/market-size";
import { OUTLET_KEYS } from "../../src/lib/market/outlet-filters";

test("D3 - Status promo dihitung deterministik dari tanggal (Zero Hardcode)", () => {
  const now = new Date("2026-11-13T12:00:00Z");

  // Kasus 1: Promo yang tanggal selesainya sudah lewat -> expired
  const expiredPromo = computePromotionStatus(
    new Date("2026-10-01T00:00:00Z"),
    new Date("2026-10-31T23:59:59Z"),
    now
  );
  assert.equal(expiredPromo, "expired", "Promo dengan endsAt di masa lalu wajib 'expired'");

  // Kasus 2: Promo yang baru mulai di masa depan -> new
  const upcomingPromo = computePromotionStatus(
    new Date("2026-12-01T00:00:00Z"),
    new Date("2026-12-31T23:59:59Z"),
    now
  );
  assert.equal(upcomingPromo, "new", "Promo dengan startsAt di masa depan berstatus 'new'");

  // Kasus 3: Promo yang sedang berjalan -> new
  const activePromo = computePromotionStatus(
    new Date("2026-11-01T00:00:00Z"),
    new Date("2026-11-30T23:59:59Z"),
    now
  );
  assert.equal(activePromo, "new", "Promo yang sedang berjalan berstatus 'new'");

  // Kasus 4: Promo tanpa endsAt (terus berjalan) -> new jika startsAt <= now
  const ongoingPromo = computePromotionStatus(
    new Date("2026-11-01T00:00:00Z"),
    null,
    now
  );
  assert.equal(ongoingPromo, "new", "Promo tanpa endsAt berstatus 'new'");
});

test("D5 - Zero Hardcoded Revenue: Kode sumber bebas dari angka omset statis", () => {
  // Seluruh outlet pada objek inisialisasi awal wajib memiliki revenueActual === null (tipe literal null)
  for (const key of OUTLET_KEYS) {
    const outlet = OUTLET_MARKET_SHARE_DATA[key];
    assert.equal(
      outlet.revenueActual,
      null,
      `Outlet ${key} tidak boleh memiliki omset tertanam di kode sumber`
    );
  }

  assert.equal(
    ALL_OUTLETS_MARKET_SHARE_DATA.revenueActual,
    null,
    "Konsolidasi ALL_OUTLETS_MARKET_SHARE_DATA wajib null sebelum pemuatan DB"
  );
});

test("D5 - Pemuatan omset dinamis dari database (OutletMonthlyRevenue)", async () => {
  // Pemuatan struktur seluruh outlet dari DB
  const monthlyData = await getMonthlyRevenueAllOutlets(BASELINE_MONTH);
  assert.ok(monthlyData, "Fungsi wajib mengembalikan objek pemetaan outlet");

  for (const key of OUTLET_KEYS) {
    assert.ok(key in monthlyData, `Key ${key} wajib tersedia di monthlyData`);
    assert.equal(typeof monthlyData[key].name, "string", `Nama outlet untuk ${key} wajib string`);
    // Nilai omset bisa number (jika diimpor) atau null (jika belum diimpor), tapi tidak boleh undefined
    assert.ok(
      monthlyData[key].revenue === null || typeof monthlyData[key].revenue === "number",
      `Omset untuk ${key} wajib number atau null`
    );
  }

  // Pemuatan outlet individual
  const resortRev = await getOutletRevenueFromDb("resort", BASELINE_MONTH);
  assert.ok(resortRev === null || typeof resortRev === "number");
});

test("D2 - Integritas Metrik Pasar & Zero Mock (pricing-benchmark)", async () => {
  const resort = getOutletMarketShare("resort");
  // Data statis tidak boleh membawa Market Cap; angka itu dihitung server dari TPK BPS di basis data.
  assert.equal(resort.totalMarketSizeEstimated, null, "Market Cap resort tidak boleh tertanam di modul statis");

  const market = await loadResortMarketSize();
  assert.ok(market.tpk, "TPK BPS harus tersedia di MarketMacroStat");
  const recomputed = calculatePrecisionMarketShare(market.tpk.percent / 100, "all");
  const expected = recomputed.rows.filter((r) => r.countsInMarket && r.monthlyRevenue !== null).reduce((sum, r) => sum + (r.monthlyRevenue as number), 0);
  assert.equal(market.marketCapMonthly, expected, "Market Cap = jumlah kamar × 30 × TPK BPS × tarif OTA untuk Sanghyang dan pembanding inti");
  assert.ok(market.rows.every((r) => r.role !== "benchmark" || r.share === null), "Hotel acuan tidak ikut pangsa");

  // Outlet non-hotel wajib null untuk TAM (tidak ada data resmi BPS untuk warung/seafood/bar non-hotel)
  const nonHotelKeys: Array<keyof typeof OUTLET_MARKET_SHARE_DATA> = [
    "sunset-grill",
    "dragon-beach-club",
    "dbistro",
    "dbar",
    "dspa",
  ];

  for (const key of nonHotelKeys) {
    const outlet = getOutletMarketShare(key);
    assert.equal(
      outlet.totalMarketSizeEstimated,
      null,
      `Outlet non-hotel ${key} tidak boleh mengarang angka TAM`
    );
    assert.equal(
      outlet.marketSharePercentage,
      null,
      `Outlet non-hotel ${key} tidak boleh mengarang pangsa pasar`
    );
    assert.ok(
      outlet.marketRank.startsWith("Belum ada data"),
      `Peringkat outlet ${key} wajib menyatakan Belum ada data`
    );

    for (const comp of outlet.benchmarkCompetitors) {
      assert.equal(
        comp.estimatedRevenue,
        null,
        `Kompetitor non-hotel ${comp.name} tidak boleh memiliki estimasi omset tebakan`
      );
      assert.equal(
        comp.estimatedMarketShare,
        null,
        `Kompetitor non-hotel ${comp.name} tidak boleh memiliki estimasi pangsa pasar tebakan`
      );
      assert.ok(
        comp.relevanceScore === null || comp.relevanceScore === undefined,
        `Kompetitor non-hotel ${comp.name} tidak boleh memiliki skor relevansi palsu`
      );
    }
  }
});

test("D2 - Provenans Komparasi Head-to-Head (competitor-comparison)", () => {
  assert.ok(OUTLET_HEAD_TO_HEAD_COMPARISONS.length > 0, "Daftar komparasi tidak boleh kosong");

  for (const comp of OUTLET_HEAD_TO_HEAD_COMPARISONS) {
    // 1. Tautan sumber bukti wajib URL valid (http/https)
    assert.ok(comp.evidenceSourceUrl, `Komparasi ${comp.id} wajib memiliki evidenceSourceUrl`);
    assert.ok(
      comp.evidenceSourceUrl.startsWith("http://") || comp.evidenceSourceUrl.startsWith("https://"),
      `URL ${comp.evidenceSourceUrl} wajib berformat HTTP(S)`
    );

    // 2. Tidak boleh ada skor relevansi palsu tertanam
    assert.ok(
      comp.relevanceScore === null || comp.relevanceScore === undefined,
      `Komparasi ${comp.id} tidak boleh memiliki skor relevansi palsu`
    );

    // 3. Tidak boleh ada klaim audit karangan
    assert.ok(
      !comp.auditRationale || !comp.auditRationale.includes("Lolos 5 kriteria Master Prompt"),
      `Komparasi ${comp.id} memuat klaim audit karangan`
    );
  }
});

test("D4 - Generator Insight: Perhitungan keyakinan (confidence) dinamis", () => {
  const now = new Date("2026-11-13T12:00:00Z");

  // 1. Ulasan sedikit dan usang -> confidence rendah
  const oldReviewDate = new Date("2026-08-01T00:00:00Z"); // > 100 hari lalu
  const lowConfidence = computeReviewConfidence(1, oldReviewDate, now, false);
  assert.ok(lowConfidence <= 60, `Confidence ulasan sedikit & lama (${lowConfidence}) harus <= 60`);

  // 2. Ulasan banyak dan baru dengan URL terverifikasi -> confidence tinggi
  const recentReviewDate = new Date("2026-11-10T00:00:00Z"); // 3 hari lalu
  const highConfidence = computeReviewConfidence(6, recentReviewDate, now, true);
  assert.ok(highConfidence >= 85, `Confidence ulasan banyak & baru (${highConfidence}) harus >= 85`);

  // 3. Perhitungan confidence tarif hotel
  const priceConfLow = computePriceConfidence(1, oldReviewDate, now);
  const priceConfHigh = computePriceConfidence(6, recentReviewDate, now);
  assert.ok(priceConfHigh > priceConfLow, "Confidence tarif hotel harus meningkat seiring cakupan hotel dan kebaruan");

  // 4. Deteksi keusangan insight (> 30 hari)
  assert.ok(isInsightStale(new Date("2026-10-01T00:00:00Z"), 30, now), "Insight 1 Oktober harus dinilai usang");
  assert.ok(!isInsightStale(new Date("2026-11-05T00:00:00Z"), 30, now), "Insight 5 November tidak boleh dinilai usang");
});

test("D4 - Generator Insight: Menghasilkan temuan dari observasi riil (Zero Mock)", () => {
  const now = new Date("2026-11-13T12:00:00Z");

  // Fixture observasi riil
  const fixtureInput: GroundedObservationInput = {
    reviews: [
      {
        id: "rev-1",
        competitorName: "Sanghyang Indah Spa Resort",
        text: "Kamar luas dan taman asri, pemandangan laut Selat Sunda sangat menenangkan.",
        rating: 5,
        sentiment: "positive",
        sourceUrl: "https://maps.google.com/?cid=sanghyang-test",
        reviewDate: new Date("2026-11-10T10:00:00Z"),
      },
      {
        id: "rev-2",
        competitorName: "Sanghyang Indah Spa Resort",
        text: "Staf ramah dan kolam air panas alaminya sangat unik di Anyer.",
        rating: 4,
        sentiment: "positive",
        sourceUrl: "https://maps.google.com/?cid=sanghyang-test",
        reviewDate: new Date("2026-11-11T14:00:00Z"),
      },
      {
        id: "rev-3",
        competitorName: "Sanghyang Indah Spa Resort",
        text: "AC di kamar cottage kurang dingin dan keran kamar mandi agak berisik.",
        rating: 2,
        sentiment: "negative",
        sourceUrl: "https://maps.google.com/?cid=sanghyang-test",
        reviewDate: new Date("2026-11-09T09:00:00Z"),
      },
    ],
    prices: [
      {
        id: "p-1",
        competitorName: "Aston Anyer Beach Hotel",
        roomName: "Studio Room",
        price: 1200000,
        currency: "IDR",
        observedAt: new Date("2026-11-12T00:00:00Z"),
        sourceUrl: "https://travel.google.com/hotels/aston",
      },
      {
        id: "p-2",
        competitorName: "Mambruk Hotel & Convention",
        roomName: "Superior Room",
        price: 850000,
        currency: "IDR",
        observedAt: new Date("2026-11-12T00:00:00Z"),
        sourceUrl: "https://travel.google.com/hotels/mambruk",
      },
    ],
    sanghyangPrices: [
      {
        id: "sh-1",
        roomName: "Standard Room",
        price: 650000,
        currency: "IDR",
        observedAt: new Date("2026-11-12T00:00:00Z"),
      },
    ],
    promotions: [
      {
        id: "promo-1",
        competitorName: "Novus Jiva Anyer",
        title: "Sunset Serenade Dinner 15% Off",
        discount: 15,
        startsAt: new Date("2026-11-01T00:00:00Z"),
        endsAt: new Date("2026-11-30T00:00:00Z"),
        sourceUrl: "https://instagram.com/p/novus-promo",
      },
    ],
  };

  const insights = generateGroundedInsights(fixtureInput, now);
  assert.ok(insights.length >= 3, "Generator wajib menghasilkan insight ulasan, tarif, dan promo");

  // Verifikasi temuan keluhan operasional
  const operationalInsight = insights.find((i) => i.title.includes("Perbaikan Operasional"));
  assert.ok(operationalInsight, "Insight keluhan operasional ulasan wajib terbentuk");
  assert.ok(operationalInsight.evidence.length > 0, "Wajib menyertakan kutipan ulasan asli");
  assert.ok(operationalInsight.sourceReferences.length > 0, "Wajib menyertakan URL observasi asli");
  assert.ok(operationalInsight.confidence >= 50 && operationalInsight.confidence <= 95);
  assert.ok(operationalInsight.priority >= 70, "Isu keluhan wajib memiliki prioritas tinggi");

  // Verifikasi temuan dinamika tarif
  const rateInsight = insights.find((i) => i.title.includes("Dinamika Tarif Pasar"));
  assert.ok(rateInsight, "Insight dinamika tarif pasar wajib terbentuk");
  assert.ok(rateInsight.evidence.length >= 2, "Wajib memuat rincian tarif kompetitor teramati");
  assert.ok(rateInsight.confidence >= 50 && rateInsight.confidence <= 95);

  // Verifikasi temuan promo kompetitor
  const promoInsight = insights.find((i) => i.title.includes("Radar Promosi"));
  assert.ok(promoInsight, "Insight radar promosi kompetitor wajib terbentuk");
  assert.ok(promoInsight.evidence.length > 0);
});
