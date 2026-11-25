import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformMarketSummary, type SummaryRow } from "../../src/lib/market/summary";

// Enam promo Mambruk asli dari satu tangkapan (tanggalnya sama persis) dan satu ulasan asli (lihat _sumber di fixture).
const { rows, ulasan } = JSON.parse(readFileSync("tests/fixtures/summary-rows-same-date-2026-11-19.json", "utf8")) as { rows: SummaryRow[]; ulasan: SummaryRow };

/** Menjalankan fn dengan zona waktu proses tertentu (Vercel memakai UTC, mesin kerja memakai Asia/Jakarta). */
function inTimeZone<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("batas hari ringkasan memakai hari WIB, bukan zona waktu server", () => {
  // 19 Nov 2026 03.00 WIB = 18 Nov 20.00 UTC: di UTC ulasan 19 Nov 03.00 UTC masih "besok", di WIB sudah "hari ini".
  const now = new Date("2026-11-18T20:00:00Z");
  const headlines = () => transformMarketSummary({ rows: [...rows, ulasan], competitors: 0, marketItems: 0, period: "30d", now }).recentRows.map((r) => r.headline);
  assert.deepEqual(inTimeZone("UTC", headlines), inTimeZone("Asia/Jakarta", headlines));
  assert.ok(inTimeZone("UTC", headlines).includes(ulasan.headline));
});

test("baris ringkasan bertanggal sama berurutan sama, apa pun urutan baris dari basis data", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const order = (input: SummaryRow[]) => transformMarketSummary({ rows: input, competitors: 0, marketItems: 0, period: "30d", now }).recentRows.map((r) => r.headline);
  // DB lokal dan produksi mengembalikan baris dengan urutan fisik berbeda; tampilannya harus tetap sama.
  assert.deepEqual(order([...rows].reverse()), order(rows));
  assert.equal(order(rows).length, rows.length);
});
