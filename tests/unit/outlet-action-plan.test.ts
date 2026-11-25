import test from "node:test";
import assert from "node:assert/strict";
import { createSummaryGet } from "../../src/app/api/market-intelligence/summary/route";
import { buildOutletActionPlan } from "../../src/lib/market/outlet-action-plan";

type Summary = Parameters<typeof buildOutletActionPlan>[0];
const authedGet = createSummaryGet(async () => null);

async function loadSummary(): Promise<Summary> {
  const res = await authedGet(new Request("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all"));
  assert.equal(res.status, 200);
  return (await res.json()) as Summary;
}

test("rekomendasi outlet: setiap butir menyebut faktor dan temuan dari data, untuk semua outlet", async () => {
  const summary = await loadSummary();
  for (const key of ["resort", "sunset-grill", "dragon-beach-club", "dbistro", "dbar", "dspa"]) {
    const plan = buildOutletActionPlan(summary, key);
    assert.ok(plan.length > 0, `${key}: ada rekomendasi`);
    for (const item of plan) {
      assert.ok(item.factor && item.finding && item.action, `${key}: butir lengkap`);
      assert.doesNotMatch(`${item.finding} ${item.action}`, /gemini|flash-lite/i, "tanpa nama mesin AI");
      // Rasio aspek dari summary sudah berupa persen 0-100 (route.ts: Math.round(positive / count * 100)).
      for (const m of item.finding.matchAll(/(\d+)%/g)) assert.ok(Number(m[1]) <= 100, `${key}: persen tidak masuk akal: ${item.finding}`);
    }
  }
});

test("rekomendasi Sunset Grill memakai harga menu pesaing dan rating pembanding yang sebenarnya", async () => {
  const summary = await loadSummary();
  const plan = buildOutletActionPlan(summary, "sunset-grill");
  const price = plan.find((p) => p.factor === "Harga");
  assert.ok(price, "ada butir harga");
  // Pembanding Sunset Grill pasca-audit holistik 20 Nov 2026 berjumlah 4 tempat aktif (Beach Point, Kamalika, Campo del Sol, Andalan).
  // Yang punya harga per porsi: Campo del Sol Pool Bar Marbella, Kamalika, Beach Point (3 dari 4).
  assert.match(price.finding, /3 dari 4 (?:pesaing|kompetitor)/);
  const rating = plan.find((p) => p.factor === "Rating");
  assert.ok(rating && /median (?:pesaing|kompetitor)/.test(rating.finding), "rating dibandingkan dengan median pembanding");
});

test("rekomendasi membaca promo Sanghyang yang berjalan dan memakai istilah kompetitor (fixture DB lokal 21 Nov 2026)", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/promo-ulasan-sanghyang-2026-11-21.json"), "utf8")) as {
    summary: Pick<Summary, "ownPromos" | "competitorSocialRadar">;
  };
  const summary = { outlets: [], ...fixture.summary } as unknown as Summary;
  const resort = buildOutletActionPlan(summary, "resort");
  const own = resort.find((p) => p.factor === "Promo Sanghyang");
  assert.ok(own, "ada butir promo Sanghyang");
  assert.match(own.finding, /^3 promo dan 3 event Sanghyang berjalan/, "Meeting & Outing, ROOM PROMO, Paket Babakaran + tiga event Instagram");
  assert.match(own.finding, /Situs resmi 3 · Instagram 3 · TikTok belum ada data/);
  const dbar = buildOutletActionPlan(summary, "dbar").find((p) => p.factor === "Promo Sanghyang");
  assert.match(dbar?.finding ?? "", /^Belum ada promo atau event Sanghyang yang berjalan/);
  for (const key of ["resort", "sunset-grill", "dragon-beach-club", "dbistro", "dbar", "dspa"]) {
    for (const item of buildOutletActionPlan(summary, key)) {
      assert.doesNotMatch(`${item.factor} ${item.finding} ${item.action}`, /pesaing|registri/i, `${key}: istilah awam kompetitor`);
    }
  }
});
