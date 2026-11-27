import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "../../src/lib/db";
import { HOTEL_PACKAGE_NAME } from "../../src/lib/market/collect-rates";
import {
  buildHotelRoomSubRows,
  buildOutletCompetitorMatrices,
  cheapestLayerOf,
  type HotelMatrixEntry,
  type MatrixPriceSnapshot,
} from "../../src/lib/market/competitor-matrix";
import { googleHotelPricesUrl, parseDisplayedRate, priceModeAction, TOTAL_PER_NIGHT_MODE } from "../../src/lib/market/google-hotel-rate";
import { getHotelRoomTypes } from "../../src/lib/market/hotel-room-types";
import type { OfficialRoomRate } from "../../src/lib/market/official-room-rates";
import {
  COMPARABLE_RATE_WHERE,
  isComparableRate,
  LEGACY_PROPERTY_RATE_PACKAGE,
  PROPERTY_RATE_PACKAGE,
} from "../../src/lib/market/rate-basis";
import {
  crawlCapturedAtMs,
  RESORT_LOWEST_BY_HOTEL_ALL,
  RESORT_RATE_EVIDENCE_ALL,
  RESORT_ROOM_RATE_SOURCE,
} from "../../src/lib/market/resort-room-rates";

after(() => db.$disconnect());

type Stay = "weekday" | "weekend";
const STAYS: Stay[] = ["weekday", "weekend"];

/** Teks tab Prices Google Travel Sanghyang untuk check-in 24 Nov 2026, dibaca 23 Nov 2026 dari komputer lokal (hl=id, gl=id). */
const PAGE = readFileSync("tests/fixtures/google-travel-sanghyang-2026-11-24.txt", "utf8");

interface FixtureRow {
  hotel: string;
  placeId: string | null;
  competitorId: string | null;
  roomName: string;
  packageName: string;
  price: number;
  checkIn: string | null;
  source: string;
  sourceUrl: string | null;
  observedAt: string;
  readBy: string;
}
/**
 * Baris tarif asli DB untuk check-in 24-28 Nov 2026 beserta pembacanya (run GitHub Actions atau komputer lokal), dan tarif
 * booking engine resmi Sanghyang Deluxe pada hari yang sama.
 */
const FIXTURE = JSON.parse(readFileSync("tests/fixtures/tarif-dasar-harga-2026-11-23.json", "utf8")) as {
  rows: FixtureRow[];
  officialSanghyangDeluxe: OfficialRoomRate;
};

const context = {
  hotelName: "Sanghyang Indah Spa Resort",
  checkIn: new Date("2026-11-24T00:00:00.000Z"),
  checkOut: new Date("2026-11-25T00:00:00.000Z"),
  guests: 2,
  sourceUrl: "https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/prices",
};

const toSnapshot = (r: FixtureRow, competitorId: string): MatrixPriceSnapshot => ({
  competitorId,
  roomName: r.roomName,
  packageName: r.packageName,
  price: r.price,
  checkIn: r.checkIn ? new Date(r.checkIn) : null,
  source: r.source,
  sourceUrl: r.sourceUrl,
  observedAt: new Date(r.observedAt),
});

test("tarif properti Google Travel: termurah dari penawaran hotel itu sendiri (baris bertombol Buka situs, termasuk situs resmi)", () => {
  assert.equal(parseDisplayedRate(PAGE, context)?.price, 361792);
});

test("tarif properti Google Travel: harga di blok hotel serupa milik hotel lain dan tidak pernah dipakai", () => {
  const similar = PAGE.slice(PAGE.indexOf("Bersponsor·Hotel serupa"));
  assert.match(similar, /Rp\s353\.456/, "blok hotel serupa memuat harga hotel lain");
  assert.equal(parseDisplayedRate(similar, context), null);
});

test("pilihan tampilan harga: dipastikan Total per malam (termasuk pajak + biaya) lewat kode pilihan, bukan label tombol", () => {
  // Pilihan dialog "Harga yang ditampilkan" yang terbaca 23 Nov 2026 sebelum dan sesudah memilih Total menginap (2 malam).
  // Label tombol tetap "Total per malam" sesudah diganti, jadi hanya aria-checked pilihan yang menunjukkan mode.
  const awal = [
    { value: "displayNightlyFullPrice", checked: true },
    { value: "displayStayFullPrice", checked: false },
  ];
  const sesudahMenginap = [
    { value: "displayNightlyFullPrice", checked: false },
    { value: "displayStayFullPrice", checked: true },
  ];
  assert.equal(TOTAL_PER_NIGHT_MODE, "displayNightlyFullPrice");
  assert.deepEqual(priceModeAction(awal), { action: "keep" });
  assert.deepEqual(priceModeAction(sesudahMenginap), { action: "switch", from: "displayStayFullPrice" });
  assert.throws(() => priceModeAction([{ value: "displayStayFullPrice", checked: true }]), /Total per malam/);
});

test("alamat tab Prices memakai wilayah Indonesia dan rupiah, sama dengan perayap tarif per kamar", () => {
  const url = new URL(googleHotelPricesUrl("https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB", context.checkIn, context.checkOut, 2));
  assert.match(url.pathname, /\/entity\/[^/]+\/prices$/);
  assert.equal(url.searchParams.get("hl"), "id");
  assert.equal(url.searchParams.get("gl"), "id");
  assert.equal(url.searchParams.get("curr"), "IDR");
  assert.equal(url.searchParams.get("checkin"), "2026-11-24");
  assert.equal(url.searchParams.get("checkout"), "2026-11-25");
});

test("tarif properti baru berpaket total per malam; paket lama (CI tanpa pajak dan lokal bercampur) tidak sebanding", () => {
  assert.equal(HOTEL_PACKAGE_NAME, PROPERTY_RATE_PACKAGE);
  assert.notEqual(PROPERTY_RATE_PACKAGE, LEGACY_PROPERTY_RATE_PACKAGE);
  const legacy = FIXTURE.rows.filter((r) => r.packageName === LEGACY_PROPERTY_RATE_PACKAGE);
  // Malam yang sama dibaca dua kali: CI (runner GitHub di AS) tanpa pajak dan biaya, komputer lokal dengan total per malam.
  const night = legacy.filter((r) => r.placeId === "sanghyang" && r.checkIn?.startsWith("2026-11-24"));
  assert.ok(night.some((r) => r.price === 311328 && r.readBy.startsWith("GitHub Actions")), "bacaan CI Rp 311.328");
  assert.ok(night.some((r) => r.price === 361792 && r.readBy === "komputer lokal"), "bacaan lokal Rp 361.792 = halaman");
  assert.ok(legacy.length > 0 && legacy.every((r) => !isComparableRate(r)));
  assert.ok(FIXTURE.rows.filter((r) => r.packageName !== LEGACY_PROPERTY_RATE_PACKAGE).every(isComparableRate));
});

test("saringan basis data tarif sebanding sama dengan isComparableRate, termasuk baris tanpa paket", async () => {
  const [all, comparable, allOwn, comparableOwn] = await Promise.all([
    db.competitorPriceSnapshot.findMany({ select: { packageName: true } }),
    db.competitorPriceSnapshot.findMany({ where: COMPARABLE_RATE_WHERE, select: { packageName: true } }),
    db.sanghyangPriceSnapshot.findMany({ select: { packageName: true } }),
    db.sanghyangPriceSnapshot.findMany({ where: COMPARABLE_RATE_WHERE, select: { packageName: true } }),
  ]);
  assert.equal(comparable.length, all.filter(isComparableRate).length);
  assert.equal(comparableOwn.length, allOwn.filter(isComparableRate).length);
  assert.ok(comparable.every(isComparableRate) && comparableOwn.every(isComparableRate));
});

test("snapshot per kamar membawa status sarapan dari nama paketnya ke lapisan OTA", () => {
  const rows = FIXTURE.rows.filter((r) => r.placeId === "sanghyang" && (r.packageName === "Termasuk sarapan" || r.packageName === "Tanpa sarapan"));
  assert.ok(rows.length >= 2, "fixture memuat penawaran Sanghyang dengan dan tanpa sarapan");
  const subRows = buildHotelRoomSubRows({
    roomTypes: getHotelRoomTypes("sanghyang")!.roomTypes,
    evidence: [],
    evidenceCheckIn: { weekday: "2026-11-24", weekend: "2026-11-28" },
    snapshots: rows.map((r) => toSnapshot(r, "sanghyang")),
    propertyRange: null,
    officialObservedLimit: null,
    officialRates: [],
    officialUnavailableReason: null,
    crawlDate: null,
    ratesObservedAt: "2026-11-23",
    windowFirstCheckIn: "2026-11-24",
    windowLastCheckIn: "2026-12-07",
    entityBaseUrl: null,
    websiteUrl: null,
    mapsUrl: null,
  });
  const deluxe = subRows.find((r) => r.name === "Sanghyang Deluxe");
  assert.ok(deluxe?.otaLowest, "Sanghyang Deluxe punya lapisan OTA");
  // Booking.com "Sanghyang Deluxe" tanpa sarapan (24 Nov) dan Hotels.com termasuk sarapan (28 Nov) dari fixture.
  assert.equal(deluxe.otaLowest.weekdayPrice, 412810);
  assert.equal(deluxe.otaLowest.weekdayBreakfast, false);
  assert.equal(deluxe.otaLowest.weekendPrice, 1140000);
  assert.equal(deluxe.otaLowest.weekendBreakfast, true);
  assert.equal(deluxe.breakfastLabel, "Tersedia keduanya");
});

test("harga termurah yang sama dari situs resmi dan OTA pada malam yang sama memakai status sarapan situs resmi", () => {
  const official = FIXTURE.officialSanghyangDeluxe;
  // Bacaan Total per malam Sanghyang check-in 28 Nov (run lokal 23 Nov): harga baris "Situs Resmi" di Google Travel, yang
  // dipasok kanal metasearch booking engine yang sama, tanpa keterangan sarapan.
  const reading = FIXTURE.rows.find((r) => r.placeId === "sanghyang" && r.packageName === PROPERTY_RATE_PACKAGE && r.checkIn?.startsWith("2026-11-28"));
  assert.ok(reading && official.checkInWeekday && official.checkInWeekend, "fixture memuat bacaan 28 Nov dan tarif resmi bertanggal");
  assert.equal(reading.price, official.weekendPrice, "harga resmi akhir pekan sama dengan bacaan Google Travel");
  const none = { price: null, checkIn: null, source: null };
  const point = { price: reading.price, checkIn: official.checkInWeekend, source: reading.source };
  const subRows = buildHotelRoomSubRows({
    roomTypes: getHotelRoomTypes("sanghyang")!.roomTypes,
    evidence: [],
    evidenceCheckIn: { weekday: official.checkInWeekday, weekend: official.checkInWeekend },
    snapshots: [],
    propertyRange: { weekday: { nights: 0, min: none, max: none }, weekend: { nights: 1, min: point, max: point } },
    officialObservedLimit: null,
    officialRates: [official],
    officialUnavailableReason: null,
    crawlDate: "2026-11-23",
    ratesObservedAt: "2026-11-23",
    windowFirstCheckIn: "2026-11-24",
    windowLastCheckIn: "2026-12-07",
    entityBaseUrl: null,
    websiteUrl: null,
    mapsUrl: null,
  });
  const deluxe = subRows.find((r) => r.name === "Sanghyang Deluxe");
  assert.equal(deluxe?.otaLowest?.weekendPrice, reading.price, "tarif termurah properti terpasang di kamar kelas dasar");
  assert.equal(deluxe?.otaLowest?.weekendBreakfast, null);
  const hit = cheapestLayerOf(subRows, "weekend", reading.price);
  assert.equal(hit?.layer, "official");
  assert.equal(hit?.breakfast, false, "rate plan resmi Room Only");
  assert.equal(hit?.checkIn, official.checkInWeekend);
});

/** Titik harga (check-in|harga) yang dasar harganya total per malam untuk satu hotel: berkas jendela dan DB tanpa paket lama. */
async function comparablePoints(h: HotelMatrixEntry): Promise<Set<string>> {
  const points = new Set<string>();
  const main: Record<Stay, string> = { weekday: RESORT_ROOM_RATE_SOURCE.checkInWeekday, weekend: RESORT_ROOM_RATE_SOURCE.checkInWeekend };
  const low = RESORT_LOWEST_BY_HOTEL_ALL.find((x) => x.hotelId === h.placeId);
  for (const stay of STAYS) {
    if (low?.[stay].price != null) points.add(`${main[stay]}|${low[stay].price}`);
    for (const p of [low?.range?.[stay].min, low?.range?.[stay].max]) if (p?.price != null && p.checkIn) points.add(`${p.checkIn}|${p.price}`);
  }
  for (const e of RESORT_RATE_EVIDENCE_ALL.filter((x) => x.hotelId === h.placeId)) points.add(`${main[e.stay]}|${e.price}`);
  const rows =
    h.role === "sanghyang"
      ? await db.sanghyangPriceSnapshot.findMany({ where: COMPARABLE_RATE_WHERE, select: { price: true, checkIn: true } })
      : await db.competitorPriceSnapshot.findMany({ where: { competitorId: h.competitorId, ...COMPARABLE_RATE_WHERE }, select: { price: true, checkIn: true } });
  for (const r of rows) if (r.checkIn) points.add(`${r.checkIn.toISOString().slice(0, 10)}|${Math.round(Number(r.price))}`);
  return points;
}

test("matriks Kamar & Resort: setiap harga OTA bisa ditelusuri ke tarif berdasar total per malam, bukan ke paket lama", async () => {
  const matrices = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  let checked = 0;
  for (const h of matrices.resort.hotelEntries ?? []) {
    const points = await comparablePoints(h);
    for (const rt of h.roomTypes) {
      const ota = rt.otaLowest;
      if (!ota) continue;
      for (const stay of STAYS) {
        const price = stay === "weekday" ? ota.weekdayPrice : ota.weekendPrice;
        const checkIn = stay === "weekday" ? ota.weekdayCheckIn : ota.weekendCheckIn;
        if (price === null) continue;
        assert.ok(points.has(`${checkIn}|${price}`), `${h.name}/${rt.name} ${stay}: Rp ${price} (check-in ${checkIn}) tidak berasal dari tarif total per malam`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0, "matriks memuat harga OTA");
});

test("tabel tarif termurah: penawaran termurah yang tidak menyebut sarapan ditandai dan disertai penawaran kamar yang sama dengan/tanpa sarapan", async () => {
  const matrices = await buildOutletCompetitorMatrices({ outlets: ["resort"] });
  const comparison = matrices.resort.cheapestComparison;
  assert.ok(comparison && comparison.rows.length > 0, "tabel termurah terisi");
  let unstated = 0;
  for (const row of comparison.rows) {
    const h = matrices.resort.hotelEntries?.find((x) => x.competitorId === row.competitorId);
    const hit = h ? cheapestLayerOf(h.roomTypes, row.stay, row.price) : null;
    assert.ok(hit, `${row.hotelName} ${row.stay}: harga termurah bisa ditelusuri ke sub-baris`);
    assert.equal(row.roomTypeName, hit.room.name);
    if (hit.layer === "ota" && hit.breakfast === null) {
      unstated++;
      assert.equal(row.breakfastLabel, "Tidak disebutkan", `${row.hotelName} ${row.stay}: penawaran termurah tidak menyebut sarapan`);
      const offers = hit.room.otaLowest!.breakfastOffers[row.stay];
      assert.deepEqual(row.breakfastOffers, offers.withBreakfast || offers.withoutBreakfast ? offers : null, `${row.hotelName} ${row.stay}: penawaran kamar yang sama`);
    } else {
      const expected = hit.breakfast === true ? "Termasuk sarapan" : hit.breakfast === false ? "Tanpa sarapan" : "Belum tercatat";
      assert.equal(row.breakfastLabel, expected, `${row.hotelName} ${row.stay}`);
      assert.equal(row.breakfastOffers, null, `${row.hotelName} ${row.stay}: status sarapan sudah tersebut`);
    }
  }
  assert.ok(unstated > 0, "data asli memuat penawaran termurah tanpa keterangan sarapan (OTA hanya menampilkan harga)");
  const sanghyangWeekday = comparison.weekday.sanghyang;
  if (sanghyangWeekday?.roomTypeName === "Sanghyang Deluxe" && sanghyangWeekday.breakfastLabel === "Tidak disebutkan") {
    // Bukti per kamar Sanghyang Deluxe di jendela: dengan dan tanpa sarapan (berkas jendela dan pantauan DB).
    assert.ok(sanghyangWeekday.breakfastOffers?.withBreakfast && sanghyangWeekday.breakfastOffers.withoutBreakfast, "harga dengan dan tanpa sarapan tampil");
  }
});

test("C15: periode yang berakhir sebelum crawl memakai pantauan harian berdasar total per malam; paket lama di periode itu tidak dipakai", async () => {
  const registry = await db.competitor.findMany({ select: { id: true, name: true } });
  const idOf = new Map(registry.map((c) => [c.name, c.id]));
  // Semua baris pesaing di fixture (paket lama dan penawaran per kamar), dipetakan ke ID registri DB yang sedang dipakai.
  const fixtureSnaps = FIXTURE.rows.flatMap((r) => (r.competitorId && idOf.has(r.hotel) ? [{ row: r, snap: toSnapshot(r, idOf.get(r.hotel)!) }] : []));
  // Hanya pantauan sebelum crawl jendela: periode yang diuji harus berakhir sebelum crawl itu.
  const crawlMs = crawlCapturedAtMs(RESORT_ROOM_RATE_SOURCE.capturedAt);
  const comparable = fixtureSnaps.filter((x) => isComparableRate(x.row) && x.snap.observedAt.getTime() < crawlMs);
  assert.ok(comparable.length > 0 && fixtureSnaps.length > comparable.length, "fixture memuat penawaran per kamar dan paket lama");
  const to = new Date(Math.max(...comparable.map((x) => x.snap.observedAt.getTime())) + 60_000);
  const from = new Date(to.getTime() - 7 * 86_400_000);
  assert.ok(to.getTime() < crawlMs, "periode berakhir sebelum crawl jendela");

  const matrices = await buildOutletCompetitorMatrices({ outlets: ["resort"], from, to, priceSnapshots: fixtureSnaps.map((x) => x.snap) });
  const w = matrices.resort.rateWindow;
  assert.ok(w, "rateWindow tersedia");
  assert.equal(w.basis, "snapshot", "crawl sesudah periode tidak dipakai");

  const ownComparable = await db.sanghyangPriceSnapshot.findMany({
    where: { observedAt: { gte: from, lte: to }, ...COMPARABLE_RATE_WHERE },
    select: { price: true, checkIn: true },
  });
  let checked = 0;
  for (const h of matrices.resort.hotelEntries ?? []) {
    const pool =
      h.role === "sanghyang"
        ? ownComparable.map((s) => ({ price: Math.round(Number(s.price)), checkIn: s.checkIn.toISOString().slice(0, 10) }))
        : comparable
            .filter((x) => x.snap.competitorId === h.competitorId && x.snap.observedAt >= from && x.snap.observedAt <= to)
            .map((x) => ({ price: x.row.price, checkIn: x.row.checkIn!.slice(0, 10) }));
    for (const rt of h.roomTypes) {
      const ota = rt.otaLowest;
      if (!ota) continue;
      for (const stay of STAYS) {
        const price = stay === "weekday" ? ota.weekdayPrice : ota.weekendPrice;
        const ci = stay === "weekday" ? ota.weekdayCheckIn : ota.weekendCheckIn;
        if (price === null) continue;
        assert.ok(ci && ci >= w.firstCheckIn && ci <= w.lastCheckIn, `${h.name}/${rt.name} ${stay}: check-in ${ci} di jendela ${w.firstCheckIn}..${w.lastCheckIn}`);
        assert.ok(pool.some((s) => s.price === price && s.checkIn === ci), `${h.name}/${rt.name} ${stay}: Rp ${price} (${ci}) berasal dari pantauan berdasar total per malam`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0, "periode itu menampilkan tarif dari pantauan per kamar");
});
