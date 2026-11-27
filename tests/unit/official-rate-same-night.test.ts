import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import {
  buildHotelRoomSubRows,
  buildOutletCompetitorMatrices,
  cheapestLayerOf,
  officialOtherNightNote,
  shownRoomPrices,
  type HotelRoomTypeMatrixSubRow,
} from "../../src/lib/market/competitor-matrix";
import { loadDynamicHotelRoomTypes } from "../../src/lib/market/hotel-room-types";
import { officialRoomRatesFor, officialRoomRatesSource, type OfficialRoomRate } from "../../src/lib/market/official-room-rates";
import { checkInLabel, crawlCapturedAtMs, isoDateWib, RESORT_RATE_EVIDENCE_ALL, RESORT_ROOM_RATE_SOURCE } from "../../src/lib/market/resort-room-rates";

after(() => db.$disconnect());

type Stay = "weekday" | "weekend";
const STAYS: Stay[] = ["weekday", "weekend"];
const OWN_HOTEL_ID = "sanghyang";
const valid = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const engineDate = (r: OfficialRoomRate, stay: Stay) => (stay === "weekday" ? r.checkInWeekday : r.checkInWeekend);
const enginePrice = (r: OfficialRoomRate, stay: Stay) => (stay === "weekday" ? r.weekdayPrice : r.weekendPrice);
const otaPrice = (rt: HotelRoomTypeMatrixSubRow, stay: Stay) => (stay === "weekday" ? rt.otaLowest?.weekdayPrice : rt.otaLowest?.weekendPrice) ?? null;

/**
 * Sub-baris Sanghyang dari data asli: profil kamar, bukti OTA crawl, dan berkas tarif resmi. Yang divariasikan hanya
 * tanggal utama lapisan OTA, yaitu keadaan saat crawl OTA bergeser sementara langkah tarif resmi dilewati.
 */
async function ownSubRows() {
  const source = officialRoomRatesSource();
  if (source.status !== "terbaca" || !source.checkInWeekday || !source.checkInWeekend) return null;
  const officialDates = { weekday: source.checkInWeekday, weekend: source.checkInWeekend };
  const engine = officialRoomRatesFor(OWN_HOTEL_ID);
  const profile = (await loadDynamicHotelRoomTypes()).get(OWN_HOTEL_ID);
  assert.ok(profile, "profil kamar Sanghyang ada");
  const crawlDate = isoDateWib(new Date(crawlCapturedAtMs(RESORT_ROOM_RATE_SOURCE.capturedAt)));
  // Jendela uji memuat tanggal resmi dan tanggal OTA sehari sesudahnya; jendela crawl OTA hari ini bisa sudah melewati
  // tanggal berkas resmi yang tertinggal, jadi jendelanya diturunkan dari tanggal resmi dengan panjang jendela crawl.
  const first = [officialDates.weekday, officialDates.weekend].sort()[0];
  const nights = RESORT_ROOM_RATE_SOURCE.window?.nights ?? 14;
  const build = (otaCheckIn: Record<Stay, string>) =>
    buildHotelRoomSubRows({
      roomTypes: profile.roomTypes,
      evidence: RESORT_RATE_EVIDENCE_ALL.filter((e) => e.hotelId === OWN_HOTEL_ID),
      evidenceCheckIn: otaCheckIn,
      snapshots: [],
      propertyRange: null,
      officialObservedLimit: null,
      officialRates: engine,
      officialUnavailableReason: null,
      crawlDate,
      ratesObservedAt: crawlDate,
      windowFirstCheckIn: first,
      windowLastCheckIn: addDays(first, nights - 1),
      entityBaseUrl: null,
      websiteUrl: null,
      mapsUrl: null,
    });
  const shiftedDates = { weekday: addDays(officialDates.weekday, 1), weekend: addDays(officialDates.weekend, 1) };
  return { engine, officialDates, shiftedDates, sameNight: build(officialDates), otherNight: build(shiftedDates) };
}

test("Temuan 5: tarif resmi semalam dengan lapisan OTA ikut harga sub-baris, rentang, dan harga termurah", async (t) => {
  const s = await ownSubRows();
  if (!s) {
    t.skip("berkas tarif resmi belum terbaca, skenario tidak bisa dibangun dari data asli");
    return;
  }
  let checked = 0;
  for (const rate of s.engine) {
    const rt: HotelRoomTypeMatrixSubRow | undefined = s.sameNight.find((r) => r.name === rate.roomName);
    assert.ok(rt, `${rate.roomName} ada di sub-baris`);
    for (const stay of STAYS) {
      const price = enginePrice(rate, stay);
      if (price === null) continue;
      checked++;
      const off: HotelRoomTypeMatrixSubRow["officialRate"] = rt.officialRate;
      assert.equal(stay === "weekday" ? off?.weekdayPrice : off?.weekendPrice, price, `${rt.name} ${stay}: harga resmi dihitung`);
      assert.equal(stay === "weekday" ? off?.weekdayOtherNightPrice : off?.weekendOtherNightPrice, null, `${rt.name} ${stay}: bukan malam lain`);
      const ota = otaPrice(rt, stay);
      assert.equal(stay === "weekday" ? rt.weekdayPrice : rt.weekendPrice, ota === null ? price : Math.min(ota, price), `${rt.name} ${stay}: harga sub-baris = min(OTA, resmi)`);
      assert.ok(shownRoomPrices(s.sameNight, stay).includes(price), `${rt.name} ${stay}: harga resmi masuk rentang`);
      assert.equal(cheapestLayerOf([rt], stay, price)?.layer, ota === price ? "ota" : "official", `${rt.name} ${stay}: harga resmi bisa ditelusuri`);
    }
  }
  assert.ok(checked >= 1, "berkas resmi memuat minimal satu harga");
  assert.equal(officialOtherNightNote([{ name: "Sanghyang Indah Spa Resort", roomTypes: s.sameNight }]), null, "tanpa malam lain, catatan tidak bertambah");
});

test("Temuan 5: tarif resmi 24/28 Nov saat OTA 25/29 Nov tampil dengan tanggalnya, tetapi tidak dihitung di harga, rentang, termurah, atau selisih", async (t) => {
  const s = await ownSubRows();
  if (!s) {
    t.skip("berkas tarif resmi belum terbaca, skenario tidak bisa dibangun dari data asli");
    return;
  }
  let checked = 0;
  for (const rate of s.engine) {
    const rt: HotelRoomTypeMatrixSubRow | undefined = s.otherNight.find((r) => r.name === rate.roomName);
    assert.ok(rt, `${rate.roomName} ada di sub-baris`);
    for (const stay of STAYS) {
      const price = enginePrice(rate, stay);
      if (price === null) continue;
      checked++;
      const off: HotelRoomTypeMatrixSubRow["officialRate"] = rt.officialRate;
      assert.ok(off, `${rt.name}: lapisan situs resmi tetap tampil`);
      assert.equal(stay === "weekday" ? off.weekdayPrice : off.weekendPrice, null, `${rt.name} ${stay}: harga resmi malam lain tidak dihitung`);
      assert.equal(stay === "weekday" ? off.weekdayOtherNightPrice : off.weekendOtherNightPrice, price, `${rt.name} ${stay}: harga resmi tampil sebagai malam lain`);
      assert.equal(stay === "weekday" ? off.weekdayCheckIn : off.weekendCheckIn, engineDate(rate, stay), `${rt.name} ${stay}: tanggal check-in resmi ikut tampil`);
      assert.equal(stay === "weekday" ? off.otaCheckInWeekday : off.otaCheckInWeekend, s.shiftedDates[stay], `${rt.name} ${stay}: tanggal OTA pembandingnya tercatat`);
      const ota = otaPrice(rt, stay);
      assert.equal(stay === "weekday" ? rt.weekdayPrice : rt.weekendPrice, ota, `${rt.name} ${stay}: harga sub-baris hanya dari OTA`);
      const otaShown = s.otherNight.map((r) => otaPrice(r, stay)).filter(valid).sort((a, b) => a - b);
      assert.deepEqual([...shownRoomPrices(s.otherNight, stay)].sort((a, b) => a - b), otaShown, `${stay}: rentang ringkasan hanya dari harga yang dihitung`);
      if (!otaShown.includes(price)) assert.equal(cheapestLayerOf(s.otherNight, stay, price), null, `${rt.name} ${stay}: harga resmi malam lain tidak bisa menjadi harga termurah atau dasar selisih`);
    }
  }
  assert.ok(checked >= 1, "berkas resmi memuat minimal satu harga");

  const note = officialOtherNightNote([{ name: "Sanghyang Indah Spa Resort", roomTypes: s.otherNight }]);
  assert.ok(note, "catatan matriks menjelaskan tarif resmi malam lain");
  for (const stay of STAYS) assert.ok(note.includes(checkInLabel(s.officialDates[stay])), `catatan menyebut ${checkInLabel(s.officialDates[stay])}`);
  assert.match(note, /tidak dihitung di rentang tarif, harga termurah, maupun selisih/);
});

test("Temuan 5: catatan matriks menjelaskan tarif resmi malam lain hanya bila datanya memang begitu", async (t) => {
  const s = await ownSubRows();
  if (!s) {
    t.skip("berkas tarif resmi belum terbaca, skenario tidak bisa dibangun dari data asli");
    return;
  }
  const { resort } = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  const entries = resort.hotelEntries ?? [];
  const hasOtherNight = entries.some((h) =>
    h.roomTypes.some((rt) => rt.officialRate && (rt.officialRate.weekdayOtherNightPrice !== null || rt.officialRate.weekendOtherNightPrice !== null)),
  );
  assert.equal(resort.note.includes("tidak sama dengan tanggal utama OTA"), hasOtherNight, "catatan matriks mengikuti data hari ini");
});
