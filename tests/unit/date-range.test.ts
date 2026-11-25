import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_RANGE_DAYS, parseDayRange, presetRange, promoEffectiveEnd, promoInRange, promoRangeWhere, rangeLabel, wibDay, wibDayStart, type DayRange } from "../../src/lib/market/date-range";

test("rentang tanggal: hari dibaca dalam WIB, tanggal yang tidak ada ditolak", () => {
  assert.equal(wibDayStart("2026-10-01")?.toISOString(), "2026-09-30T17:00:00.000Z");
  assert.equal(wibDayStart("2026-02-30"), null);
  assert.equal(wibDayStart("1 Okt 2026"), null);
  assert.equal(wibDay(new Date("2026-11-14T18:30:00Z")), "2026-11-15", "01.30 WIB sudah tanggal 15");
});

test("rentang kustom: urutan, kelengkapan, dan panjang divalidasi", () => {
  const range = parseDayRange("2026-10-01", "2026-10-10");
  assert.ok(range && range !== "invalid");
  assert.equal(range.from.toISOString(), "2026-09-30T17:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-10-10T16:59:59.999Z");
  assert.equal(parseDayRange(null, null), null, "tanpa from dan to berarti memakai preset");
  assert.equal(parseDayRange("2026-10-10", "2026-10-01"), "invalid");
  assert.equal(parseDayRange("2026-10-01", null), "invalid");
  assert.equal(parseDayRange("2025-01-01", "2026-10-01"), "invalid", `lebih dari ${MAX_RANGE_DAYS} hari`);
  assert.equal(rangeLabel(range), "1 Okt 2026 – 10 Okt 2026");
});

test("preset: 30 hari terakhir berakhir di akhir hari ini WIB", () => {
  const now = new Date("2026-11-15T09:00:00Z");
  const range = presetRange("30d", now);
  assert.equal(wibDay(range.from), "2026-10-17");
  assert.equal(range.to.toISOString(), "2026-11-15T16:59:59.999Z");
  assert.equal(wibDay(presetRange("year", now).from), "2026-01-01");
});

// Promo Marbella Place Anyer by Jayakarta di DB lokal: poster Instagram 24 Nov–25 Des 2026, dan penawaran situs resmi
// tanpa tanggal tertulis yang tanggal mulainya diisi tanggal tangkap 8 Nov 2026.
const CHRISTMAS = { startsAt: new Date("2026-11-24T00:00:00Z"), endsAt: new Date("2026-12-25T23:59:59Z"), capturedAt: new Date("2026-11-05T10:00:00Z") };
const EARLY_BIRD = { startsAt: new Date("2026-11-08T00:00:00Z"), endsAt: null, capturedAt: new Date("2026-11-08T10:00:00Z") };

test("promo tampil bila masa berlakunya bersinggungan dengan rentang yang dipilih", () => {
  const now = new Date("2026-11-15T09:00:00Z");
  const october = parseDayRange("2026-10-01", "2026-10-10");
  const lateNovember = parseDayRange("2026-11-20", "2026-11-30");
  const midNovember = parseDayRange("2026-11-10", "2026-11-15");
  assert.ok(october && october !== "invalid" && lateNovember && lateNovember !== "invalid" && midNovember && midNovember !== "invalid");
  assert.equal(promoInRange(CHRISTMAS, october, now), false, "promo yang baru mulai 24 Nov tidak tampil di 1–10 Okt");
  assert.equal(promoInRange(CHRISTMAS, lateNovember, now), true);
  assert.equal(promoInRange(EARLY_BIRD, october, now), false, "promo yang baru terlihat 8 Nov tidak tampil di Oktober");
  assert.equal(promoInRange(EARLY_BIRD, midNovember, now), true, "promo tanpa tanggal akhir dianggap masih berjalan");
  const earlyNovember = parseDayRange("2026-11-01", "2026-11-10");
  assert.ok(earlyNovember && earlyNovember !== "invalid");
  assert.equal(promoInRange(CHRISTMAS, earlyNovember, now), true, "diumumkan 5 Nov walau baru berlaku 24 Nov: tampil sebagai promo yang segera datang");
});

// Baris asli DB lokal 22 Nov 2026 (lihat _sumber di fixture) untuk aturan promoInRange keputusan koordinator (papan #40).
interface RangeRow {
  label: string;
  title: string;
  category: string;
  description: string | null;
  kind: string | null;
  source: string;
  sourceUrl: string | null;
  price: number | null;
  discount: number | null;
  details: string[];
  terms: string[];
  startsAt: string;
  endsAt: string | null;
  capturedAt: string;
}
const rangeFixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "tests/fixtures/promo-rentang-2026-11-22.json"), "utf8"),
) as { rows: RangeRow[] };
const dbRow = (label: string) => {
  const r = rangeFixture.rows.find((x) => x.label === label);
  assert.ok(r, `baris ${label} ada di fixture`);
  return { ...r, startsAt: new Date(r.startsAt), endsAt: r.endsAt ? new Date(r.endsAt) : null, capturedAt: new Date(r.capturedAt) };
};
const days = (from: string, to: string) => {
  const r = parseDayRange(from, to);
  assert.ok(r && r !== "invalid");
  return r;
};
/** 22 Nov 2026 07.30 WIB, saat temuan papan #40 diperiksa ulang. */
const NOW_22_NOV = new Date("2026-11-22T00:30:00Z");

test("promoInRange #40: event yang selesai sebelum periode tidak tampil walau di-crawl di dalam periode", () => {
  const week = days("2026-11-15", "2026-11-21");
  assert.equal(promoInRange(dbRow("dbc-event-1-6-nov"), week, NOW_22_NOV), false, "event DBC 1-6 Nov, di-crawl 20 Nov");
  assert.equal(promoInRange(dbRow("dbc-event-1-6-nov"), days("2026-11-01", "2026-11-07"), NOW_22_NOV), true, "tetap tampil di periode yang mencakupnya");
});

test("promoInRange #40: event mendatang yang sudah diumumkan sebelum akhir periode tampil sebagai segera datang", () => {
  assert.equal(promoInRange(dbRow("nye-jayakarta"), days("2026-11-15", "2026-11-21"), NOW_22_NOV), true, "NYE 31 Des diumumkan 5 Nov");
  assert.equal(promoInRange(dbRow("nye-jayakarta"), days("2026-10-01", "2026-10-31"), NOW_22_NOV), false, "belum diumumkan pada Oktober");
});

test("promoInRange #40: unggahan event tanpa tanggal selesai berakhir pada hari mulainya", () => {
  const week = days("2026-11-15", "2026-11-21");
  for (const label of ["dbc-reels-31-agu", "dbc-reels-recap-aiko", "dbc-reels-halloween"]) {
    assert.equal(promoInRange(dbRow(label), week, NOW_22_NOV), false, `${label} tidak berjalan sampai sekarang`);
  }
  assert.equal(promoInRange(dbRow("dbc-reels-halloween"), days("2026-10-20", "2026-10-20"), NOW_22_NOV), true, "tampil di hari unggahannya");
  assert.equal(promoInRange(dbRow("dbc-reels-halloween"), days("2026-10-21", "2026-10-31"), NOW_22_NOV), false, "tidak tampil sehari sesudahnya");
});

test("promoInRange #40: promo tanpa tanggal akhir berlaku paling lama 3 bulan sejak mulai dan tidak melewati hari ini", () => {
  const week = days("2026-11-15", "2026-11-21");
  assert.equal(promoInRange(dbRow("marbella-early-bird-situs"), week, NOW_22_NOV), true, "penawaran situs tanpa tanggal, dibaca 20 Nov");
  assert.equal(promoInRange(dbRow("marbella-early-bird-situs"), days("2026-10-01", "2026-10-31"), NOW_22_NOV), false, "belum terlihat pada Oktober");
  assert.equal(promoInRange(dbRow("andalan-boat-trip-ig"), week, NOW_22_NOV), true, "promo Instagram 21 Okt masih di dalam 3 bulan");
  assert.equal(promoInRange(dbRow("andalan-boat-trip-ig"), days("2027-01-25", "2027-01-31"), new Date("2027-02-01T00:00:00Z")), false, "lebih dari 3 bulan sejak 21 Okt");
  assert.equal(promoInRange(dbRow("andalan-bundling-mentah"), week, NOW_22_NOV), true, "unggahan mentah yang tampil sebagai promo");
});

test("promoEffectiveEnd: promo tanpa tanggal akhir yang mulai sesudah sekarang berjalan setidaknya pada hari mulainya", () => {
  // Promo Instagram Andalan 21 Okt tanpa tanggal akhir, seandainya sudah tertangkap 15 Okt (diumumkan sebelum mulai).
  const announced = { ...dbRow("andalan-boat-trip-ig"), capturedAt: new Date("2026-10-15T03:00:00Z") };
  const now = new Date("2026-10-15T05:00:00Z");
  const end = promoEffectiveEnd(announced, now);
  assert.ok(end >= announced.startsAt, `akhir efektif ${end.toISOString()} tidak boleh lebih awal dari mulai ${announced.startsAt.toISOString()}`);
  assert.equal(end.toISOString(), "2026-10-21T16:59:59.999Z", "berlaku sampai akhir hari mulai (WIB)");
  assert.equal(promoInRange(announced, days("2026-10-21", "2026-10-27"), now), true, "rentang kustom di masa depan yang memuat hari mulainya");
  assert.equal(promoInRange(announced, days("2026-10-21", "2026-10-21"), now), true, "hari mulainya saja");
  // Sesudah hari mulai belum ada pengamatan bahwa promo masih berjalan, sama dengan aturan "tidak melewati sekarang".
  assert.equal(promoInRange(announced, days("2026-10-22", "2026-10-27"), now), false);
  // Sesudah mulai, aturan lama tetap: paling lama sampai sekarang.
  assert.equal(promoEffectiveEnd(announced, NOW_22_NOV).getTime(), NOW_22_NOV.getTime());
});

test("promoRangeWhere: prefilter basis data tidak membuang baris yang lolos promoInRange (DB lokal)", async () => {
  const { db } = await import("../../src/lib/db");
  try {
    const now = new Date();
    const rows = await db.competitorPromotion.findMany({
      select: { id: true, title: true, category: true, description: true, kind: true, source: true, sourceUrl: true, price: true, discount: true, details: true, terms: true, startsAt: true, endsAt: true, capturedAt: true },
    });
    const keptBy = async (range: DayRange) => new Set((await db.competitorPromotion.findMany({ where: promoRangeWhere(range), select: { id: true } })).map((r) => r.id));
    for (const range of [presetRange("30d", now), presetRange("90d", now), presetRange("year", now), days("2026-11-15", "2026-11-21"), days("2026-10-01", "2026-10-31")]) {
      const kept = await keptBy(range);
      const dropped = rows.filter((p) => promoInRange(p, range, now) && !kept.has(p.id)).map((p) => p.title);
      assert.deepEqual(dropped, [], `${rangeLabel(range)}: baris dibuang prefilter`);
    }
    // Rentang kustom di masa depan, dengan acuan waktu sekarang dan lampau: acuan lampau membuat baris yang mulai
    // sesudahnya menjadi promo mendatang, jadi aturan "berjalan pada hari mulainya" ikut diuji pada baris asli.
    const afterDays = (from: Date, start: number, end: number) => days(wibDay(new Date(from.getTime() + start * 86_400_000)), wibDay(new Date(from.getTime() + end * 86_400_000)));
    for (const reference of [now, new Date("2026-11-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")]) {
      for (const range of [afterDays(reference, 1, 7), afterDays(reference, 8, 60), presetRange("30d", reference)]) {
        const kept = await keptBy(range);
        const dropped = rows.filter((p) => promoInRange(p, range, reference) && !kept.has(p.id)).map((p) => p.title);
        assert.deepEqual(dropped, [], `${rangeLabel(range)} (acuan ${wibDay(reference)}): baris dibuang prefilter`);
      }
    }
    const future = rows.filter((p) => !p.endsAt && p.startsAt > new Date("2026-10-01T00:00:00Z"));
    assert.ok(future.length > 0, "ada baris tanpa tanggal akhir yang mulai sesudah acuan lampau");

    // Event mendatang nyata di DB lokal (startsAt > capturedAt dalam jendela 90 hari): lolos prefilter saat
    // rentang mencakup hari tangkapnya, dan tidak bocor pada rentang sebelum hari tangkapnya.
    const { PROMO_MAX_AGE_DAYS } = await import("../../src/lib/market/promo-radar");
    const isUpcomingCandidate = (r: (typeof rows)[number]) =>
      wibDay(r.startsAt) > wibDay(r.capturedAt) &&
      r.startsAt.getTime() - r.capturedAt.getTime() <= PROMO_MAX_AGE_DAYS * 86_400_000;
    const upcoming =
      rows.find((r) => /New Year/i.test(r.title) && isUpcomingCandidate(r)) ??
      rows.find(isUpcomingCandidate);
    assert.ok(upcoming, "ada event mendatang di DB lokal yang tertangkap sebelum tanggal mulainya");
    const capturedDay = wibDay(upcoming.capturedAt);
    const capturedDayStart = wibDayStart(capturedDay);
    assert.ok(capturedDayStart);
    const weekOfCapture = days(wibDay(new Date(capturedDayStart.getTime() - 6 * 86_400_000)), capturedDay);
    assert.equal(promoInRange(upcoming, weekOfCapture, upcoming.capturedAt), true, `${upcoming.title} tampil di minggu saat tertangkap (${capturedDay})`);
    const keptOnCapture = await db.competitorPromotion.count({ where: { AND: [promoRangeWhere(weekOfCapture), { id: upcoming.id }] } });
    assert.equal(keptOnCapture, 1, `${upcoming.title} lolos prefilter minggu saat tertangkap`);

    const weekBeforeCapture = days(
      wibDay(new Date(capturedDayStart.getTime() - 7 * 86_400_000)),
      wibDay(new Date(capturedDayStart.getTime() - 86_400_000)),
    );
    assert.equal(promoInRange(upcoming, weekBeforeCapture, upcoming.capturedAt), false, `${upcoming.title} tidak tampil sebelum hari tangkap`);
    const keptBeforeCapture = await db.competitorPromotion.count({ where: { AND: [promoRangeWhere(weekBeforeCapture), { id: upcoming.id }] } });
    assert.equal(keptBeforeCapture, 0, `${upcoming.title} tidak lolos prefilter sebelum hari tangkap`);
  } finally {
    await db.$disconnect();
  }
});

test("promoEffectiveEnd: akhir efektif yang dipakai promoInRange", () => {
  const halloween = dbRow("dbc-reels-halloween");
  assert.equal(promoEffectiveEnd(halloween, NOW_22_NOV).toISOString(), "2026-10-20T16:59:59.999Z", "event tanpa tanggal selesai berakhir 20 Okt 23.59 WIB");
  assert.ok(promoEffectiveEnd(halloween, NOW_22_NOV) < NOW_22_NOV, "jadi sudah berakhir pada 22 Nov");
  const boat = dbRow("andalan-boat-trip-ig");
  assert.equal(promoEffectiveEnd(boat, NOW_22_NOV).getTime(), NOW_22_NOV.getTime(), "promo 21 Okt tanpa tanggal akhir berlaku sampai sekarang (masih di dalam 3 bulan)");
  const nye = dbRow("nye-jayakarta");
  assert.equal(promoEffectiveEnd(nye, NOW_22_NOV).toISOString(), nye.endsAt?.toISOString(), "tanggal selesai tertulis dipakai apa adanya");
});
