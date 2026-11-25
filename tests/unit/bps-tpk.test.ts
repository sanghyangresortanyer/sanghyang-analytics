import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTpkTitle, syncBpsTpk } from "../../src/lib/market/bps-tpk";

// Judul asli rilis BPS Banten 4 Mei 2026 (banten.bps.go.id/id/pressrelease/2026/05/04/935/...).
const TITLE = "Tingkat Penghunian Kamar (TPK) hotel bintang di Banten pada Maret 2026 mencapai 47,14 persen";

test("TPK dan bulannya terbaca dari judul rilis BPS Banten", () => {
  const parsed = parseTpkTitle(TITLE);
  assert.ok(parsed);
  assert.equal(parsed.value, 47.14);
  assert.equal(parsed.period.toISOString().slice(0, 10), "2026-03-01");
});

test("judul rilis lain atau angka tidak masuk akal ditolak", () => {
  assert.equal(parseTpkTitle("Jumlah kunjungan wisman ke Banten pada Maret 2026 mencapai 157.262 kunjungan"), null);
  assert.equal(parseTpkTitle("Tingkat Penghunian Kamar (TPK) hotel bintang di Banten pada Maret 2026 mencapai 147,14 persen"), null);
});

test("tanpa BPS_WEBAPI_KEY penemuan rilis dilewati dengan alasan, bukan diam-diam", async () => {
  const result = await syncBpsTpk({});
  assert.equal(result.saved, 0);
  assert.match(result.skippedReason ?? "", /BPS_WEBAPI_KEY/);
});
