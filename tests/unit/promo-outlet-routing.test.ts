import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { isLodging } from "../../src/lib/market/compset";
import { counterStrategyFor, promoMatchesOutlet, promoOutlets } from "../../src/lib/market/outlet-filters";
import { loadHotelVenues } from "../../src/lib/market/promo-venues";
import { OUR_VERSION_MARKER } from "../../src/lib/market/promo-extractor";

/** Promo asli di DB lokal dalam bentuk yang dikirim summary API ke Insight Pasar, Omset, dan rencana aksi. */
async function realPromo(competitor: string, title: string) {
  const row = await db.competitorPromotion.findFirst({
    where: { title, competitor: { name: competitor } },
    select: { title: true, category: true, description: true, competitorId: true, competitor: { select: { name: true, category: true, outlets: true } } },
    orderBy: { capturedAt: "desc" },
  });
  assert.ok(row, `promo "${title}" milik ${competitor} ada di DB lokal`);
  const venues = await loadHotelVenues();
  return {
    competitorName: row.competitor.name,
    competitorOutlets: row.competitor.outlets,
    competitorIsLodging: isLodging(row.competitor.category),
    competitorVenues: venues.get(row.competitorId) ?? [],
    title: row.title,
    category: row.category,
    counterStrategy: row.description?.split(OUR_VERSION_MARKER)[1]?.trim() ?? "",
  };
}

const outletsOf = async (competitor: string, title: string) => [...promoOutlets(await realPromo(competitor, title))].sort();

test("promo kolam renang di Lighthouse Restaurant masuk Kamar & Resort, bukan D'Bistro karena kata restaurant", async () => {
  assert.deepEqual(await outletsOf("Mambruk Hotel & Convention", "Viral Sea Pool Kolam Air Laut Alami & Sunset di Lighthouse Restaurant"), ["resort"]);
});

test("promo mocktail di The Upper Circle masuk bar, bukan D'Bistro", async () => {
  assert.deepEqual(await outletsOf("Novus Jiva Anyer Villa, Resort & Spa", "Golden Hour Sunset Chill & Signature Mocktails The Upper Circle"), ["dbar"]);
  assert.deepEqual(
    await outletsOf("Novus Jiva Anyer Villa, Resort & Spa", "Skyline Serenade Dinner & Pesta Kembang Api di Rooftop The Upper Circle"),
    ["dbistro", "dragon-beach-club"],
    "dinner masuk dbistro, pesta kembang api sejenis acara Dragon Beach Club",
  );
});

test("promo grill dan seafood hotel masuk Sunset Grill, sarapan dan menu restoran hotel masuk D'Bistro", async () => {
  const mambruk = "Mambruk Hotel & Convention";
  assert.deepEqual(await outletsOf(mambruk, "The Mambruk Sizzling Grill"), ["sunset-grill"]);
  assert.deepEqual(await outletsOf(mambruk, "Seafood Grill by the sea"), ["sunset-grill"]);
  assert.deepEqual(await outletsOf(mambruk, "Floating Breakfast"), ["dbistro"]);
  // Lagoon Restaurant di registri milik Mövenpick; promo Jayakarta tidak boleh tercocokkan ke venue hotel lain.
  assert.deepEqual(await outletsOf("The Jayakarta Villas Anyer Beach Resort", "Special Promo Lagoon Restaurant: Soto Palangka Rp 40K & Carbo Drink Rp 35K"), ["dbistro"]);
  assert.deepEqual(await outletsOf(mambruk, "Breathe Again: Sesi Seaside Yoga & Relaksasi Tepi Laut"), ["dspa"]);
});

test("promo menginap tetap di Kamar & Resort; paket yang juga menyebut makan di venue hotel ikut D'Bistro", async () => {
  assert.deepEqual(await outletsOf("Marbella Place Anyer by Jayakarta", "Christmas Package"), ["resort"]);
  assert.deepEqual(await outletsOf("Aston Anyer Beach Hotel", "Early Bird 25% OFF Tahun Baru 2027"), ["resort"], "\"Baru\" bukan \"bar\"");
  assert.deepEqual(await outletsOf("Aston Anyer Beach Hotel", "Sensasi Menginap Overwater Aquavillas & Sunset Dining The Pier di TikTok"), ["dbistro", "resort"]);
});

test("promo pesaing mandiri tetap di outlet registrinya, dipersempit menurut jenisnya", async () => {
  assert.deepEqual(await outletsOf("Kamalika Beach Cafe & Resto", "Halloween at Kamalika"), ["sunset-grill"], "Kamalika kini pembanding Sunset Grill (kafe & resto pantai)");
  assert.deepEqual(await outletsOf("Andalan Beach Resto & Coffee", "Promo Spesial Boat Trip dan Paket Makan"), ["sunset-grill"]);
  assert.deepEqual(await outletsOf("Beach Point Anyer", "Happy Hour"), ["sunset-grill"], "Beach Point pembanding Sunset Grill");
});

test("tidak ada promo pesaing aktif yang hilang dari semua outlet", async () => {
  const venues = await loadHotelVenues();
  const rows = await db.competitorPromotion.findMany({
    where: { competitor: { active: true, compsetRole: { not: null } } },
    select: { title: true, category: true, competitorId: true, competitor: { select: { name: true, category: true, outlets: true } } },
  });
  assert.ok(rows.length > 50, `promo pesaing di DB lokal: ${rows.length}`);
  for (const r of rows) {
    const promo = {
      competitorName: r.competitor.name,
      competitorOutlets: r.competitor.outlets,
      competitorIsLodging: isLodging(r.competitor.category),
      competitorVenues: venues.get(r.competitorId) ?? [],
      title: r.title,
      category: r.category,
    };
    assert.ok(promoOutlets(promo).length > 0, `${r.competitor.name}: "${r.title}" tidak masuk outlet mana pun`);
  }
});

test("Versi kita hanya tampil untuk outlet yang disebut usulannya", async () => {
  const sizzling = await realPromo("Mambruk Hotel & Convention", "The Mambruk Sizzling Grill");
  assert.equal(promoMatchesOutlet(sizzling, "sunset-grill"), true);
  assert.equal(promoMatchesOutlet(sizzling, "dbistro"), false);
  const sunsetProposal = /Sunset Grill/i.test(sizzling.counterStrategy)
    ? sizzling
    : { counterStrategy: "Luncurkan paket sore di Sunset Grill." };
  assert.equal(counterStrategyFor(sunsetProposal, "dbistro"), null, "usulan Sunset Grill tidak tampil di D'Bistro");
  assert.equal(counterStrategyFor(sunsetProposal, "sunset-grill"), sunsetProposal.counterStrategy);

  const breakfast = await realPromo("Mambruk Hotel & Convention", "Floating Breakfast");
  assert.equal(counterStrategyFor(breakfast, "dbistro"), breakfast.counterStrategy, "usulan tanpa nama outlet tetap tampil untuk outlet promonya");

  const halloween = await realPromo("Aston Anyer Beach Hotel", "Halloween Fiesta");
  assert.deepEqual(promoOutlets(halloween), ["dbistro"]);
  assert.equal(counterStrategyFor(halloween, "dbistro"), null, "usulan Halloween di Sunset Grill bukan untuk D'Bistro");

  // Paket menginap boleh menyebut outlet lain sebagai bonus.
  const escapes = await realPromo("Mövenpick Resort Carita", "Signature Escapes - Diskon 25%");
  assert.equal(counterStrategyFor(escapes, "resort"), escapes.counterStrategy);
  assert.equal(counterStrategyFor(escapes, "all"), escapes.counterStrategy);
  assert.equal(counterStrategyFor({ counterStrategy: "" }, "dbistro"), null);
});
