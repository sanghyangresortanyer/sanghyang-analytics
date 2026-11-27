import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cheapestDipOffers, dipRates, dipSearchForm, dipSearchResponseSchema } from "../../src/lib/market/dip-booking-engine";

/** Jawaban asli be.dip.id untuk Nemuru Grand Anyer Palazo, lihat _sumber di tiap fixture. */
const response = (checkIn: string) =>
  dipSearchResponseSchema.parse(
    (JSON.parse(readFileSync(path.resolve(process.cwd(), `tests/fixtures/dip-nemuru-${checkIn}.json`), "utf8")) as { response: unknown }).response,
  );
// Waktu fixture diambil. Paket Nemuru tidak memakai jam aktif, jadi hasilnya tidak bergantung pada jam ini.
const NOW = new Date("2026-11-27T04:00:00Z");
const stay = (checkIn: string) => ({ checkIn, adults: 2, rooms: 1 });

/**
 * Harga per malam yang tampil di halaman engine saat dirender Chrome 27 Nov 2026 (2 dewasa, 1 kamar). Baris 30 Nov sama
 * dengan gambar audit pemilik: Town House 1 BR IDR 800.000 dan 2 BR IDR 1.200.000, keduanya "Breakfast Included".
 */
const SHOWN: Record<string, Record<string, number>> = {
  "2026-11-30": {
    "Town House 1 Bed Room - King Bed": 800_000,
    "Town House 2 Bed Room - King Bed": 1_200_000,
    "Wooden Cabin 1 Bed Room - King Bed": 1_100_000,
    "Wooden Cabin 2 Bed Room - King Bed": 1_700_000,
  },
  "2026-11-28": {
    "Town House 1 Bed Room - King Bed": 1_000_000,
    "Town House 2 Bed Room - King Bed": 1_500_000,
    "Wooden Cabin 1 Bed Room - King Bed": 1_023_500,
    "Wooden Cabin 2 Bed Room - King Bed": 1_600_000,
  },
  "2026-12-01": {
    "Town House 1 Bed Room - King Bed": 1_900_000,
    "Town House 2 Bed Room - King Bed": 2_400_000,
    "Wooden Cabin 1 Bed Room - King Bed": 2_050_000,
    "Wooden Cabin 2 Bed Room - King Bed": 2_700_000,
  },
};

for (const [checkIn, shown] of Object.entries(SHOWN)) {
  test(`be.dip.id ${checkIn}: harga termurah tiap kamar sama dengan yang tampil di engine, termasuk sarapan wajib`, () => {
    const { offers, unavailable } = cheapestDipOffers(response(checkIn), stay(checkIn), NOW);
    assert.deepEqual(unavailable, []);
    assert.deepEqual(Object.fromEntries(offers.map((o) => [o.engineRoomName, o.price])), shown);
    for (const o of offers) {
      assert.equal(o.ratePlan, "ROOM BREAKFAST", o.engineRoomName);
      assert.equal(o.breakfastIncluded, true, `${o.engineRoomName}: engine menulis "Breakfast Included"`);
      assert.ok(o.roomsLeft !== null && o.roomsLeft > 0, `${o.engineRoomName}: stok dibaca`);
    }
  });
}

test("be.dip.id: harga.after hanya harga kamar sebelum paket sarapan wajib (angka yang dulu tercatat di data riset)", () => {
  const res = response("2026-11-30");
  const th1 = res.list.list.find((r) => r.nama_jenis === "Town House 1 Bed Room - King Bed");
  assert.ok(th1);
  assert.equal(th1.harga["2026-11-30"].after, 600_000);
  assert.equal(th1.room_only_sale, false, "engine tidak menjual kamar tanpa paket");
});

test("be.dip.id: paket November Epic hanya dijual pada jendela tanggal check-in paketnya", () => {
  const plans = (checkIn: string) =>
    dipRates(response(checkIn), stay(checkIn), NOW)
      .rates.filter((r) => r.engineRoomName === "Wooden Cabin 1 Bed Room - King Bed")
      .map((r) => [r.ratePlan, r.price]);
  // 28 Nov: promo kamar 11% ikut memotong biaya paket, seperti tampilan engine (1.023.500 dan 1.223.265).
  assert.deepEqual(plans("2026-11-28"), [
    ["ROOM BREAKFAST", 1_023_500],
    ["November Epic 11.11", 1_223_265],
  ]);
  assert.deepEqual(plans("2026-11-30"), [["ROOM BREAKFAST", 1_100_000]]);
});

test("formulir pencarian sama dengan permintaan halaman engine: lang=IN, 1 malam, check-out sehari sesudahnya", () => {
  const form = dipSearchForm({ apiKey: "kunci-publik", checkIn: "2026-11-30", adults: 2, rooms: 1 });
  assert.deepEqual(Object.fromEntries(form), {
    apikey: "kunci-publik",
    tglcekin: "2026-11-30",
    duration: "1",
    tglcekout: "2026-12-01",
    jmlroom: "1",
    person: "2",
    lang: "IN",
  });
});

test("jawaban engine yang bentuknya berubah ditolak, bukan dibaca sebagian", () => {
  const raw = (JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/dip-nemuru-2026-11-30.json"), "utf8")) as { response: Record<string, unknown> }).response;
  assert.equal(dipSearchResponseSchema.safeParse({ ...raw, is_weekend: false }).success, false, "is_weekend boolean = permintaan tanpa lang=IN");
  assert.equal(dipSearchResponseSchema.safeParse({ ...raw, status: "failed" }).success, false);
});
