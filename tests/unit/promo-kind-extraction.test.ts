import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groundedLines, parseExtraction, promoDayRange } from "../../src/lib/market/promo-extractor";
import { buildWebsitePrompt, parseWebsitePromos } from "../../src/lib/market/website-promos";

// Halaman penawaran resmi Novus Jiva hasil crawl Crawl4AI 17 Nov 2026 01.50 WIB
// (https://www.novushotels.com/novusjiva/promo-hotel-anyer, sha256 fad22516…).
const NOVUS_PAGE = readFileSync(new URL("../fixtures/novus-jiva-promo-2026-11-17.md", import.meta.url), "utf8");
const today = new Date("2026-11-17T03:00:00Z");

test("isi paket hanya diterima bila tertulis di sumber; karangan atau terjemahan dibuang", () => {
  const lines = groundedLines(
    [
      "Free-flow mocktails at Barefoot from 9 AM–5 PM for two",
      "Free-flow coffee & tea at Sarasa for two, during operating hours",
      "Bonus sarapan di pantai dan fasilitas menarik lainnya",
      "Free-flow mocktails at Barefoot from 9 AM–5 PM for two",
    ],
    NOVUS_PAGE,
    12,
  );
  assert.deepEqual(lines, ["Free-flow mocktails at Barefoot from 9 AM–5 PM for two", "Free-flow coffee & tea at Sarasa for two, during operating hours"]);
});

test("penawaran situs: jenis wajib, butir paket dari bagiannya sendiri, tanggal menurut kalender WIB", () => {
  const raw = JSON.stringify({
    promos: [
      {
        kind: "promo",
        title: "Midweek Full Reset",
        category: "Kamar & Menginap",
        startsAt: "2026-10-01",
        endsAt: "2026-12-13",
        price: null,
        discountPercent: null,
        summary: "Paket menginap minimal dua malam Minggu–Kamis.",
        details: ["Breakfast for two", "Free-flow mocktails at Barefoot from 9 AM–5 PM for two", "Voucher spa gratis tanpa batas"],
        terms: ["Validity: All direct website bookings for minimum two-night stays from 1 October – 13 December 2026, Sunday–Thursday."],
        ourVersion: null,
      },
      { title: "Tanpa jenis", category: "Kamar & Menginap", summary: "x", details: [], terms: [] },
    ],
  });
  const [promo, ...rest] = parseWebsitePromos(raw, today, NOVUS_PAGE);
  assert.equal(rest.length, 0, "jawaban tanpa jenis promo/event dibuang");
  assert.equal(promo.kind, "promo");
  assert.deepEqual(promo.details, ["Breakfast for two", "Free-flow mocktails at Barefoot from 9 AM–5 PM for two"]);
  assert.equal(promo.terms.length, 1);
  const { startsAt, endsAt } = promoDayRange(promo.startsAt, promo.endsAt);
  // 13 Desember 23.59.59 WIB, sehingga kartu menulis "13 Des 2026", bukan 14 Des.
  assert.equal(endsAt?.toISOString(), "2026-12-13T16:59:59.000Z");
  assert.equal(startsAt?.toISOString(), "2026-09-30T17:00:00.000Z");
});

test("event dikenali dari jawaban AI dan tetap memakai tanggal acara", () => {
  const caption =
    "A Magical Mermaid Day is Coming to Mambruk!\nMeet & Greet with Mermaid\nFun Photobooth\nExciting Dining Vouchers\n7 November 2026\nMambruk Hotel & Convention";
  const parsed = parseExtraction(
    JSON.stringify({
      isPromo: true,
      kind: "event",
      title: "A Magical Mermaid Day",
      category: "Keluarga & Anak",
      startsAt: "2026-11-07",
      endsAt: "2026-11-07",
      price: null,
      discountPercent: null,
      summary: "Pertunjukan putri duyung di Mambruk.",
      details: ["Meet & Greet with Mermaid", "Fun Photobooth"],
      terms: [],
      ourVersion: null,
    }),
    new Date("2026-11-01T00:00:00Z"),
    caption,
  );
  assert.equal(parsed?.kind, "event");
  assert.deepEqual(parsed?.details, ["Meet & Greet with Mermaid", "Fun Photobooth"]);
  assert.equal(parseExtraction(JSON.stringify({ isPromo: true, kind: "lomba", title: "X", category: "Keluarga & Anak" }), today, caption), null);
});

test("prompt situs memuat seluruh halaman penawaran, bukan 2.000 huruf pertama", () => {
  const prompt = buildWebsitePrompt("Novus Jiva Anyer Villa, Resort & Spa", NOVUS_PAGE, today);
  assert.ok(NOVUS_PAGE.indexOf("Game Card with 3 sessions") > 2000, "butir terakhir Midweek ada jauh setelah huruf ke-2.000");
  assert.match(prompt, /Game Card with 3 sessions/);
  assert.match(prompt, /"kind"/);
  assert.match(prompt, /"details"/);
});

test("baris lama tanpa jenis: prompt membawa definisi promo/event dan membuang usulan Versi kita; jawaban disaring per id", async () => {
  const { buildKindPrompt, parseKindAnswer } = await import("../../src/lib/market/promo-kind");
  const rows = [
    {
      id: "a",
      competitor: "Mambruk Hotel & Convention",
      title: "A Magical Mermaid Day (7 November 2026) Pertunjukan Putri Duyung Kolam Renang",
      category: "Keluarga & Anak",
      description: "Pertunjukan spesial putri duyung untuk keluarga dan anak-anak.\nVersi kita: Paket keluarga Sanghyang.",
    },
    { id: "b", competitor: "Novus Jiva Anyer Villa, Resort & Spa", title: "Midweek Full Reset", category: "Kamar & Menginap", description: null },
  ];
  const prompt = buildKindPrompt(rows.map((r) => ({ ...r, recordedDay: "2026-11-07" })));
  assert.match(prompt, /"kind": "event" bila/);
  assert.match(prompt, /A Magical Mermaid Day/);
  assert.doesNotMatch(prompt, /Paket keluarga Sanghyang/, "usulan Versi kita bukan bagian penawaran pesaing");
  const kinds = parseKindAnswer('{"items":[{"id":"a","kind":"event","eventDate":"2026-11-07"},{"id":"b","kind":"Promo","eventDate":"2026-11-07"},{"id":"x","kind":"event"},{"id":"b","kind":"lainnya"}]}', ["a", "b"]);
  assert.deepEqual([...kinds], [["a", { kind: "event", eventDate: "2026-11-07", eventEndDate: null }], ["b", { kind: "promo", eventDate: null, eventEndDate: null }]]);
  assert.equal(parseKindAnswer("bukan json", ["a"]).size, 0);
});

test("status langkah situs menyebut promo yang diperbarui dan event yang ditandai", async () => {
  const { websiteOutcome } = await import("../../src/lib/market/refresh-outcome");
  const out = websiteOutcome({ sites: 6, saved: 1, updated: 9, events: 2, kindFailures: 0, siteFailures: [], ownFailure: null });
  assert.equal(out.status, "berhasil");
  assert.match(out.detail ?? "", /9 diperbarui dari situs, 2 event baru ditandai/);
  assert.equal(websiteOutcome({ sites: 6, saved: 0, kindFailures: 3, siteFailures: [], ownFailure: null }).status, "sebagian");
});

test("kolom jenis, isi paket, dan syarat ada di tabel promo lokal", async () => {
  const { db } = await import("../../src/lib/db");
  try {
    const row = await db.competitorPromotion.findFirst({ select: { kind: true, details: true, terms: true } });
    assert.ok(row === null || Array.isArray(row.details));
  } finally {
    await db.$disconnect();
  }
});

test("kartu tidak menulis tanggal baca sebagai tanggal mulai promo atau event", async () => {
  const { promoPeriodText } = await import("../../src/lib/marketing/market-intelligence-types");
  const { startDateWritten } = await import("../../src/lib/market/promo-radar");
  // Fire Dance Novus Jiva: tanpa tanggal mulai, berlaku sampai Desember 2026 (dibaca 17 Nov 2026).
  const read = new Date("2026-11-17T10:07:00Z");
  assert.equal(startDateWritten({ startsAt: read, capturedAt: read }), false);
  assert.equal(promoPeriodText({ startsAt: read.toISOString(), endsAt: "2026-12-31T16:59:59.000Z", startWritten: false }), "Berlaku s.d. 31 Des 2026");
  assert.match(promoPeriodText({ startsAt: read.toISOString(), endsAt: null, startWritten: false }), /^Tanpa tanggal tertulis \(dibaca 17 Nov 2026\)$/);
  // Midweek Full Reset: 1 Okt–13 Des 2026 menurut kalender WIB.
  assert.equal(promoPeriodText({ startsAt: "2026-09-30T17:00:00.000Z", endsAt: "2026-12-13T16:59:59.000Z", startWritten: true }), "1 Okt 2026 – 13 Des 2026");
  // A Magical Mermaid Day: caption hanya menulis "7 November 2026", jadi satu hari penuh WIB dan satu tanggal di kartu.
  assert.equal(promoPeriodText({ startsAt: "2026-11-06T17:00:00.000Z", endsAt: "2026-11-07T16:59:59.000Z", startWritten: true }), "7 Nov 2026");
});

test("event bertanggal tanpa tanggal selesai berakhir di hari itu; tanggal tercatat lama tidak dianggap tanggal acara", async () => {
  const { eventDatesFor, parseKindAnswer } = await import("../../src/lib/market/promo-kind");
  const parsed = parseExtraction(
    JSON.stringify({ isPromo: true, kind: "event", title: "Halloween Night Party", category: "Acara & Live Music", startsAt: "2026-10-30", endsAt: null, summary: "Pesta Halloween.", details: [], terms: [] }),
    new Date("2026-10-25T00:00:00Z"),
    "Halloween Night Party 30 Oktober 2026",
  );
  assert.equal(promoDayRange(parsed?.startsAt ?? null, parsed?.endsAt ?? null).endsAt?.toISOString(), "2026-10-30T16:59:59.000Z");
  // "New Year's Eve 2026" Jayakarta di DB lokal tercatat 28 Okt (tanggal posting); AI membaca tanggal acara 31 Des.
  const posted = { startsAt: new Date("2026-10-27T17:00:00Z"), endsAt: null };
  const answers = parseKindAnswer('{"items":[{"id":"nye","kind":"event","eventDate":"2026-12-31","eventEndDate":null},{"id":"x","kind":"event","eventDate":"2031-01-01"}]}', ["nye", "x"]);
  const nye = eventDatesFor(posted, answers.get("nye")!);
  assert.equal(nye?.startsAt.toISOString(), "2026-12-30T17:00:00.000Z");
  assert.equal(nye?.endsAt.toISOString(), "2026-12-31T16:59:59.000Z");
  assert.equal(eventDatesFor(posted, answers.get("x")!), null, "tanggal acara di luar jendela wajar ditolak");
  assert.equal(eventDatesFor({ ...posted, endsAt: new Date("2026-11-01T00:00:00Z") }, answers.get("nye")!), null, "tanggal selesai yang sudah ada tidak ditimpa");
});
