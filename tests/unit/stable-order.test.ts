import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { assembleGraph } from "../../src/lib/knowledge-graph/assemble";
import { loadGraphInput } from "../../src/lib/knowledge-graph/build";
import { presetRange, promoRangeWhere } from "../../src/lib/market/date-range";
import { mergePromoCaptures } from "../../src/lib/market/promo-radar";

after(() => db.$disconnect());

// Baris dari DB datang menurut letak fisiknya, yang berbeda antara Postgres lokal dan Supabase, sehingga web, PDF, dan
// Knowledge Graph yang sama berbeda antara localhost dan produksi. Setiap tes membalik urutan baris asli dari DB lokal;
// hasil yang tampil harus tetap sama.

test("kartu promo sama walau urutan baris dari DB berbeda: kartu utama, poster, sumber, dan urutan kartu", async () => {
  const rows = await db.competitorPromotion.findMany({
    where: promoRangeWhere(presetRange("90d", new Date())),
    include: { competitor: { select: { id: true, name: true, placeId: true, outlets: true, active: true } } },
  });
  assert.ok(rows.length > 20, "baris promo asli dari DB lokal");
  assert.deepEqual(mergePromoCaptures([...rows].reverse()), mergePromoCaptures(rows));
});

test("Knowledge Graph sama walau urutan baris dari DB berbeda: sumber simpul tema, urutan outlet, simpul tarif, dan urutan simpul", async () => {
  const input = await loadGraphInput(presetRange("30d", new Date()));
  assert.ok(input.reviews.length > 10 && input.facts && input.facts.length > 10 && input.rates.length > 1, "ulasan, fakta, dan tarif asli dari DB lokal");
  const reversed = {
    ...input,
    competitors: [...input.competitors].reverse(),
    promos: [...input.promos].reverse(),
    reviews: [...input.reviews].reverse(),
    articles: [...input.articles].reverse(),
    facts: [...input.facts].reverse(),
    rates: [...input.rates].reverse(),
    holisticScores: input.holisticScores && [...input.holisticScores].reverse(),
    socialPosts: input.socialPosts && [...input.socialPosts].reverse(),
  };
  assert.deepEqual(assembleGraph(reversed), assembleGraph(input));
});
