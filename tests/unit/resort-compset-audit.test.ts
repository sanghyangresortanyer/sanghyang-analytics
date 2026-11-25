import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { COMPSET_HOTELS, placeIdFor } from "../../src/lib/market/hotel-compset";
import hotelData from "../../src/lib/market/hotel-compset.data.json";
import { RESORT_HOTEL_DB_NAMES } from "../../src/lib/market/resort-strategy";

// Audit pesaing Kamar & Resort 17 Nov 2026 (riset swarm, bukti di laporan koordinator): aturan yang sama dengan keputusan
// Nemuru dipakai untuk semua penginapan dalam 25 km, yaitu produk sejenis dan minimal satu sumber besar bintang 4.
const RESORT_PRIMA_ENTITY = "ChgI_9neisz9vOACGgwvZy8xcHpwaGt4MnMQAQ";
const JAYAKARTA_ENTITY = "ChgI6fi0t9v9_-hkGgwvZy8xcHp2cm41MDQQAQ";

test("Jayakarta: tautan tarif menunjuk listing Jayakarta, bukan Resort Prima Anyer", async () => {
  const jayakarta = await db.competitor.findFirstOrThrow({ where: { placeId: "jayakarta" }, select: { id: true, ratesUrl: true } });
  assert.ok(jayakarta.ratesUrl?.includes(JAYAKARTA_ENTITY), String(jayakarta.ratesUrl));
  const pricesFromPrima = await db.competitorPriceSnapshot.count({ where: { competitorId: jayakarta.id, sourceUrl: { contains: RESORT_PRIMA_ENTITY } } });
  const reviewsFromPrima = await db.competitorReview.count({
    where: { competitorId: jayakarta.id, sourceUrl: { contains: RESORT_PRIMA_ENTITY }, archivedAt: null },
  });
  assert.equal(pricesFromPrima, 0, "harga Resort Prima tidak lagi tercatat sebagai Jayakarta");
  assert.equal(reviewsFromPrima, 0, "ulasan Resort Prima tidak lagi tampil sebagai Jayakarta");
});

test("Kamar & Resort: Nemuru, Hawaii, dan My Pisita pembanding aktif; Patra dan Resort Prima berjarak OSRM yang benar", async () => {
  const rows = await db.competitor.findMany({
    where: { placeId: { in: ["nemuru_palazo", "hawaii_anyer", "my_pisita_anyer", "patra_anyer", "prima_anyer"] } },
    select: { placeId: true, active: true, compsetRole: true, outlets: true, roadKm: true, ratesUrl: true, category: true },
  });
  const by = new Map(rows.map((r) => [r.placeId, r]));
  // Penilaian holistik 21 Nov 2026: Nemuru dan Hawaii satu segmen tarif (inti); My Pisita di bawah tarif termurah
  // Sanghyang, jadi acuan. Ketiganya tetap aktif dan dirayapi tarifnya.
  const expectedRole: Record<string, string> = { nemuru_palazo: "inti", hawaii_anyer: "inti", my_pisita_anyer: "benchmark" };
  for (const [id, role] of Object.entries(expectedRole)) {
    const row = by.get(id);
    assert.ok(row?.active && row.compsetRole === role && row.outlets.includes("resort"), `${id} pembanding aktif Kamar & Resort (${role})`);
    assert.ok(row.ratesUrl?.includes("/travel/hotels/entity/"), `${id} punya alamat entity Google Hotels`);
  }
  assert.equal(by.get("nemuru_palazo")?.category, "resort");
  assert.equal(by.get("patra_anyer")?.roadKm, 4.4);
  assert.equal(by.get("prima_anyer")?.roadKm, 21.6);
});

test("data hotel JSON, pencocok nama, dan nama DB reputasi mengikuti registri", () => {
  for (const id of ["nemuru_palazo", "my_pisita_anyer"]) {
    assert.ok(COMPSET_HOTELS.some((h) => h.hotelId === id), `${id} pembanding di hotel-compset.data.json`);
    assert.ok(RESORT_HOTEL_DB_NAMES[id], `${id} punya nama DB untuk reputasi`);
  }
  for (const id of ["patra_anyer", "west_cove_anyer"]) {
    const hotel = (hotelData.hotels as { hotelId: string; excludedReason?: string }[]).find((h) => h.hotelId === id);
    assert.ok(hotel?.excludedReason, `${id} tercatat dengan alasan dikeluarkan`);
  }
  assert.equal(placeIdFor("Lagoon Restaurant Mövenpick"), "movenpick", "Lagoon Mövenpick tidak mendapat jarak Jayakarta");
  assert.equal(placeIdFor("Lagoon Restaurant Jayakarta"), "jayakarta");
  assert.equal(placeIdFor("TEMU KATSU RESTO Nemuru Palazo"), "nemuru_palazo");
  assert.equal(placeIdFor("My Pisita Anyer Resort"), "my_pisita_anyer");
});
