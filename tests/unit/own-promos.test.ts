import { test } from "node:test";
import assert from "node:assert/strict";
import { offerNumbers, offersFromCards, TEAM_PROMOS } from "../../src/lib/market/own-promos";
import { OUTLET_KEYS } from "../../src/lib/market/outlet-filters";
import { PROMO_CATEGORIES } from "../../src/lib/market/promo-extractor";

// Kartu penawaran asli di https://sanghyang.com/offers (blok CMS heading dan body), dibaca perayap 14 Nov 2026.
const SITE_CARDS = [
  { heading: "Meeting & Outing Package", body: "Meeting and outing packages for groups, from half-day meetings to residential packages. Contact our sales team for package details and current prices." },
  { heading: "Sunset Grill Promo", body: "Golden hour, golden peace: grilled lobster, pizza, crab and more seafood by the jetty at sunset." },
  { heading: "Hot Spring Refresh", body: "A relaxing, rejuvenating spa experience with a choice of massages, body treatments and other spa rituals. Current D'Spa offers: 30% off the Hotspring Spa and a Buy 1 Get 1 Aquamedic at IDR 350,000." },
  { heading: "Paket Babakaran", body: "A private BBQ in front of your villa: charcoal and grill, corn and sauces, meat and sausages, plus seafood. Promo price IDR 850,000." },
];

test("penawaran situs Sanghyang: tiap kartu masuk ke outlet yang benar beserta harga dan diskonnya", () => {
  const offers = offersFromCards(SITE_CARDS);
  assert.deepEqual(
    offers.map((o) => [o.title, o.outletKey, o.price, o.discount]),
    [
      ["Meeting & Outing Package", "resort", null, null],
      ["Sunset Grill Promo", "sunset-grill", null, null],
      ["Hot Spring Refresh", "dspa", 350000, 30],
      ["Paket Babakaran", "resort", 850000, null],
    ],
  );
  for (const o of offers) assert.ok((PROMO_CATEGORIES as readonly string[]).includes(o.category), `${o.title}: kategori promo sah`);
});

test("penawaran situs Sanghyang: angka rupiah dengan K, titik ribuan, dan persen dibaca benar", () => {
  assert.deepEqual(offerNumbers("2 Bottle Smirnof / Captain morgan 1.800K"), { price: 1800000, discount: null });
  assert.deepEqual(offerNumbers("Promo Room 365K"), { price: 365000, discount: null });
  assert.deepEqual(offerNumbers("Disc 20% for member"), { price: null, discount: 20 });
  assert.deepEqual(offerNumbers("Buy 5 get 1 free"), { price: null, discount: null }, "angka beli-gratis bukan harga");
});

test("promo tim marketing: setiap butir punya outlet, jenis, kategori, dan status verifikasi yang sah", () => {
  assert.ok(TEAM_PROMOS.items.length > 0);
  assert.match(TEAM_PROMOS.source, /tim/i);
  assert.ok(Date.parse(TEAM_PROMOS.period.start) <= Date.parse(TEAM_PROMOS.period.end));
  for (const item of TEAM_PROMOS.items) {
    assert.ok((OUTLET_KEYS as readonly string[]).includes(item.outlet), `${item.title}: outlet dikenal`);
    assert.ok(["promo", "program"].includes(item.kind), `${item.title}: jenis promo atau program`);
    assert.ok(["situs-resmi", "sebagian", "belum"].includes(item.verification.status), `${item.title}: status verifikasi`);
    assert.ok(item.verification.note.trim().length > 0, `${item.title}: alasan verifikasi tertulis`);
    if (item.kind === "promo") assert.ok((PROMO_CATEGORIES as readonly string[]).includes(item.category), `${item.title}: kategori promo sah`);
    // Harga dan diskon tersimpan sama dengan yang tertulis di judul, bukan angka tambahan.
    assert.deepEqual({ price: item.price, discount: item.discount }, offerNumbers(item.title), `${item.title}: angka sesuai teks`);
  }
});
