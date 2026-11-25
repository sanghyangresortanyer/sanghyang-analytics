import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { buildMeetingReport } from "../../src/lib/meeting-report/build";
import { renderMeetingReport } from "../../src/templates/meeting-report";
import { COMPSET_HOTELS } from "../../src/lib/market/hotel-compset";
import { drivingMinutesFor } from "../../src/lib/market/distance-source";

// Durasi rute server demo OSRM jauh lebih pendek dari Google Maps (19,3 km tercatat 14 menit di jalan Anyer), jadi
// menit berkendara hanya dipakai dari pengukuran Google Maps; jarak km OSRM tetap dipakai dengan sumbernya.
test("registri: baris berjarak OSRM tidak menyimpan menit berkendara", async () => {
  const osrm = await db.competitor.findMany({
    where: { active: true, distanceSource: { contains: "OSRM" } },
    select: { name: true, driveMinutes: true },
  });
  assert.ok(osrm.length > 0, "ada baris berjarak OSRM di registri lokal");
  assert.deepEqual(osrm.filter((r) => r.driveMinutes !== null).map((r) => r.name), []);
});

test("menit berkendara: Google Maps dipakai, OSRM dan sumber kosong dikosongkan", () => {
  assert.equal(drivingMinutesFor("Google Maps (mobil) dari Sanghyang Indah Spa Resort, diukur 13 Nov 2026", 15), 15);
  assert.equal(drivingMinutesFor("Rute OSRM dari Sanghyang Indah Spa Resort (17 Nov 2026)", 14), null);
  assert.equal(drivingMinutesFor("Mengikuti lokasi hotel induknya (Rute OSRM dari Sanghyang Indah Spa Resort (17 Nov 2026))", 2), null);
  assert.equal(drivingMinutesFor(null, 5), null);
});

test("PDF: sel jarak rute terbuka jujur (tanpa menit, tanpa mengaku Google Maps) dan tanpa menyebut nama alat", async () => {
  const report = await buildMeetingReport("dbistro");
  const html = renderMeetingReport(report);
  const osrmRows = await db.competitor.findMany({
    where: { active: true, outlets: { has: "dbistro" }, distanceSource: { contains: "OSRM" } },
    select: { name: true },
  });
  assert.ok(osrmRows.length > 0, "ada pembanding D'Bistro berjarak OSRM");
  const entries = report.outletBody?.matrix.competitorMatrix?.fnbEntries ?? [];
  for (const { name } of osrmRows) {
    const entry = entries.find((e) => e.name === name);
    assert.ok(entry, `${name} ada di matriks Ringkasan Kompetitor PDF`);
    assert.equal(entry.driveMinutes, null, `${name}: menit berkendara OSRM dikosongkan`);
    assert.doesNotMatch(entry.distanceLabel, /Google Maps|mnt|menit/i, `${name}: tidak mengaku Google Maps atau menyebut menit OSRM`);
    const row = html.match(new RegExp(`<tr[^>]*><td>${entry.no}</td>[\\s\\S]*?</tr>`))?.[0] ?? "";
    const distanceCell = row.match(/<td>[^<]*<\/td>\s*<td>[^<]*(?:<span[^>]*>[^<]*<\/span>)?<\/td>\s*<td>([^<]*)<\/td>/)?.[1] ?? "";
    assert.match(distanceCell, /km/, `${name}: sel jarak PDF tercetak`);
    assert.doesNotMatch(distanceCell, /OSRM|Google Maps|mnt|menit/i, `${name}: sel jarak PDF tanpa nama alat atau menit`);
  }
});

test("tabel hotel: menit berkendara boleh kosong dan tidak pernah ditulis dari OSRM", () => {
  const nemuru = COMPSET_HOTELS.find((h) => h.hotelId === "nemuru_palazo");
  assert.ok(nemuru, "Nemuru ada di daftar hotel");
  assert.equal(nemuru.driveMinutes, null);
});
