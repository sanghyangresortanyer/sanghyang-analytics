import { test } from "node:test";
import assert from "node:assert/strict";
import { googleTravelEntityToken, googleTravelEntityUrlFromMaps, mapsPlaceIds } from "../../src/lib/market/google-travel-entity";

// Data nyata: URL Google Maps dari registri (lib/market/hotel-compset.data.json) dan token entity yang dipakai
// Google Travel untuk hotel yang sama (ratesUrl Mambruk di registri; tautan hasil pencarian Google Travel Hawaii).
const HAWAII_MAPS =
  "https://www.google.com/maps/place/Hawaii+Resort+Family+Suites+Anyer/@-6.1949547,105.8399882,17z/data=!4m9!3m8!1s0x2e422b9fa948ac57:0x3150333dc243bf53!5m2!4m1!1i2!8m2!3d-6.1949547!4d105.8399882!16s%2Fg%2F1tj555s_";
const MAMBRUK_MAPS =
  "https://www.google.com/maps/place/Mambruk+Hotel+%26+Convention/@-6.0730137,105.8845296,17z/data=!4m9!3m8!1s0x2e422a6bf3e2279d:0x7352b852bda8d71e!5m2!4m1!1i2!8m2!3d-6.0730137!4d105.8845296!16s%2Fg%2F11b6d59cr7";

test("cid dan kgmid terbaca dari URL Google Maps", () => {
  assert.deepEqual(mapsPlaceIds(HAWAII_MAPS), { cidHex: "0x3150333dc243bf53", kgmid: "/g/1tj555s_" });
  assert.equal(mapsPlaceIds("https://www.google.com/maps/place/Hanya+Nama/@-6.1,105.8,17z"), null);
  assert.equal(mapsPlaceIds(null), null);
});

test("token entity sama persis dengan token Google Travel yang diketahui", () => {
  assert.equal(
    googleTravelEntityToken({ cidHex: "0x3150333dc243bf53", kgmid: "/g/1tj555s_" }),
    "ChcI0_6OktznjKgxGgsvZy8xdGo1NTVzXxAB",
  );
  assert.equal(googleTravelEntityToken({ cidHex: "0x7352b852bda8d71e", kgmid: null }), "CgoInq6j7auKrqlzEAE");
});

test("URL entity langsung dari URL Google Maps registri", () => {
  assert.equal(googleTravelEntityUrlFromMaps(HAWAII_MAPS), "https://www.google.com/travel/hotels/entity/ChcI0_6OktznjKgxGgsvZy8xdGo1NTVzXxAB");
  assert.match(googleTravelEntityUrlFromMaps(MAMBRUK_MAPS) ?? "", /^https:\/\/www\.google\.com\/travel\/hotels\/entity\/[A-Za-z0-9_-]+$/);
});
