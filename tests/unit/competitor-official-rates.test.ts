import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildHotelRoomSubRows } from "../../src/lib/market/competitor-matrix";
import {
  buildCompetitorOfficialRatesFile,
  competitorOfficialRoomRatesOf,
  DIP_ENGINE_LABEL,
  parseCompetitorOfficialRatesFile,
  type CompetitorEngineRead,
} from "../../src/lib/market/competitor-official-rates";
import { dipSearchResponseSchema } from "../../src/lib/market/dip-booking-engine";
import { getHotelRoomTypes } from "../../src/lib/market/hotel-room-types";
import type { OfficialRoomRate } from "../../src/lib/market/official-room-rates";

const response = (checkIn: string) =>
  dipSearchResponseSchema.parse(
    (JSON.parse(readFileSync(path.resolve(process.cwd(), `tests/fixtures/dip-nemuru-${checkIn}.json`), "utf8")) as { response: unknown }).response,
  );
const NOW = new Date("2026-11-27T04:00:00Z");
const DATES = { weekday: "2026-12-01", weekend: "2026-11-28" };
const NEMURU = getHotelRoomTypes("nemuru_palazo");
const BOOK_URL = "https://be.dip.id/booking/cekrooms?keyid=d77bcce9f48e18cbeb0f00493ec91f22";

const read = (responses: CompetitorEngineRead["responses"]): CompetitorEngineRead => {
  assert.ok(NEMURU, "profil kamar Nemuru ada di hotel-room-types.data.json");
  return { hotelId: "nemuru_palazo", bookUrl: BOOK_URL, catalogRooms: NEMURU.roomTypes.map((r) => r.name), responses };
};
const build = (hotel: CompetitorEngineRead) =>
  buildCompetitorOfficialRatesFile({
    observedAt: NOW.toISOString(),
    checkInWeekday: DATES.weekday,
    checkInWeekend: DATES.weekend,
    datesFrom: "lib/market/resort-room-rates.data.json (uji)",
    adults: 2,
    hotels: [hotel],
    now: NOW,
  });

test("tarif resmi Nemuru dari be.dip.id: harga jual termasuk sarapan wajib untuk tanggal lapisan OTA", () => {
  const file = parseCompetitorOfficialRatesFile(build(read({ weekday: response(DATES.weekday), weekend: response(DATES.weekend) })));
  const rates = competitorOfficialRoomRatesOf(file, "nemuru_palazo");
  assert.deepEqual(
    Object.fromEntries(rates.map((r) => [r.roomName, [r.weekdayPrice, r.weekendPrice]])),
    {
      "Town House 1 Bed Room - King Bed": [1_900_000, 1_000_000],
      "Town House 2 Bed Room - King Bed": [2_400_000, 1_500_000],
      "Wooden Cabin 1 Bed Room - King Bed": [2_050_000, 1_023_500],
      "Wooden Cabin 2 Bed Room - King Bed": [2_700_000, 1_600_000],
    },
  );
  for (const r of rates) {
    assert.equal(r.breakfastIncluded, true, `${r.roomName}: "Breakfast Included" di engine`);
    assert.equal(r.ratePlan, "ROOM BREAKFAST");
    assert.equal(r.sourceLabel, DIP_ENGINE_LABEL);
    assert.equal(r.checkInWeekday, DATES.weekday);
    assert.equal(r.checkInWeekend, DATES.weekend);
  }
  assert.deepEqual(competitorOfficialRoomRatesOf(file, "marbella"), [], "hotel tanpa engine terbaca tidak punya tarif resmi");
});

test("engine gagal dibaca untuk satu jenis hari: harga hari itu kosong dengan alasan, hari lain tetap terbaca", () => {
  const file = parseCompetitorOfficialRatesFile(build(read({ weekday: response(DATES.weekday), weekend: { error: "HTTP 503" } })));
  const [room] = file.hotels[0].rooms;
  assert.equal(room.weekend.price, null);
  assert.match(room.weekend.unavailableReason ?? "", /HTTP 503/);
  const rates = competitorOfficialRoomRatesOf(file, "nemuru_palazo");
  assert.ok(rates.every((r) => r.weekendPrice === null && r.weekdayPrice !== null));
});

test("berkas yang tanggalnya tidak sama dengan permintaan ditolak, bukan ditampilkan", () => {
  const file = build(read({ weekday: response(DATES.weekday), weekend: response(DATES.weekend) }));
  const broken = structuredClone(file);
  broken.hotels[0].rooms[0].weekday.checkIn = "2026-11-24";
  assert.throws(() => parseCompetitorOfficialRatesFile(broken), /check-in weekday 2026-11-24/);
});

/** Sub-baris Nemuru dari profil kamar statis, tanpa bukti OTA, dengan tanggal utama OTA sama dengan tanggal engine. */
const nemuruSubRows = (officialRates: OfficialRoomRate[]) => {
  assert.ok(NEMURU);
  return buildHotelRoomSubRows({
    roomTypes: NEMURU.roomTypes,
    evidence: [],
    evidenceCheckIn: DATES,
    snapshots: [],
    propertyRange: null,
    officialObservedLimit: null,
    officialRates,
    officialUnavailableReason: null,
    crawlDate: "2026-11-27",
    ratesObservedAt: "2026-11-27",
    windowFirstCheckIn: "2026-11-28",
    windowLastCheckIn: "2026-12-11",
    entityBaseUrl: null,
    websiteUrl: null,
    mapsUrl: null,
  });
};

test("laporan pemilik 27 Nov: harga riset tanpa tanggal menginap tidak lagi tampil sebagai tarif situs resmi", () => {
  const rows = nemuruSubRows([]);
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.officialRate, null, `${row.name}: harga riset ${NEMURU?.roomTypes.find((r) => r.name === row.name)?.weekdayPrice} tidak boleh tampil`);
  }
});

test("tarif engine be.dip.id pada malam yang sama dengan OTA tampil sebagai tarif situs resmi beserta sarapannya", () => {
  const file = parseCompetitorOfficialRatesFile(build(read({ weekday: response(DATES.weekday), weekend: response(DATES.weekend) })));
  const rows = nemuruSubRows(competitorOfficialRoomRatesOf(file, "nemuru_palazo"));
  const th1 = rows.find((r) => r.name === "Town House 1 Bed Room - King Bed");
  assert.ok(th1?.officialRate);
  assert.equal(th1.officialRate.weekdayPrice, 1_900_000);
  assert.equal(th1.officialRate.weekendPrice, 1_000_000);
  assert.equal(th1.officialRate.breakfastLabel, "Termasuk sarapan");
  assert.equal(th1.officialRate.sourceLabel, DIP_ENGINE_LABEL);
  assert.equal(th1.officialRate.weekdayCheckIn, DATES.weekday);
});
