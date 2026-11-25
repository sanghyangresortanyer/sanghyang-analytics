import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildMeetingReport, reportPromoWhere } from "../../src/lib/meeting-report/build";
import { pdfContentDisposition, reportPdfFileName } from "../../src/lib/meeting-report/download-name";
import { compactCheckNote, previousPeriodMeta, promoDisplayTitle, splitReviewQuotes } from "../../src/lib/meeting-report/sections";
import { NO_DATA, type MeetingReport, type OutletReportBody } from "../../src/lib/meeting-report/types";
import { loadCompsetAudit } from "../../src/lib/market/compset-audit";
import { competitorMenu } from "../../src/lib/market/competitor-menu";
import { parseDayRange, presetRange, promoInRange, promoRangeWhere, type DayRange } from "../../src/lib/market/date-range";
import { isPromoWithinRecencyWindow } from "../../src/lib/market/promo-radar";
import { loadResortMarketSize } from "../../src/lib/market/market-size";
import { OUTLET_KEYS, type OutletKey } from "../../src/lib/market/outlet-filters";
import { isOwnCompetitorName, OWN_TEAM_SOURCE } from "../../src/lib/market/own-promos";
import { PROMOTION_TYPE_INFO, PROMOTION_TYPES, promotionTypeLabel } from "../../src/lib/market/promo-type";
import { footerTemplate, renderMeetingReport } from "../../src/templates/meeting-report";

const NOW = new Date("2026-11-21T12:00:00+07:00");
const VARIANTS: (OutletKey | "all")[] = [...OUTLET_KEYS, "all"];
// Periode uji dari permintaan pemilik: 15–20 Nov (6 hari), 15–21 Nov (7 hari), dan satu bulan kalender penuh.
const PERIODS = [
  { from: "2026-11-15", to: "2026-11-20" },
  { from: "2026-11-15", to: "2026-11-21" },
  { from: "2026-10-01", to: "2026-10-31" },
] as const;
const MAIN_PERIOD = PERIODS[1];

const reportCache = new Map<string, Promise<MeetingReport>>();
function report(key: OutletKey | "all", period: { from: string; to: string } = MAIN_PERIOD): Promise<MeetingReport> {
  const cacheKey = `${key}|${period.from}|${period.to}`;
  if (!reportCache.has(cacheKey)) reportCache.set(cacheKey, buildMeetingReport(key, NOW, { ...period }));
  return reportCache.get(cacheKey)!;
}

function range(period: { from: string; to: string }): DayRange {
  const r = parseDayRange(period.from, period.to);
  assert.ok(r && r !== "invalid");
  return r;
}

/** Teks yang terbaca di PDF: tanpa CSS, tanpa tag/atribut (URL tautan tidak ikut), entitas HTML dibuka. */
function visibleText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const bodiesOf = (r: MeetingReport): OutletReportBody[] => (r.outletBody ? [r.outletBody] : r.chapters.map((c) => c.body));

const TOOL_OR_AI_NAME = /\b(crawl4ai|playwright|puppeteer|selenium|gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\w.]*|llm|antigravity|osrm)\b|\.json\b/i;
const RAW_POST_PREFIX = /^\[(REELS|FEED|CAROUSEL|TIKTOK_VIDEO|STORY)\]/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const SHORT_DATE = /^\d{1,2} (Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des) \d{4}/;

test("previousPeriodMeta: pembanding sama panjang (hari inklusif) dan bulan kalender penuh dibanding bulan sebelumnya", () => {
  const meta6 = previousPeriodMeta(range({ from: "2026-11-15", to: "2026-11-20" }));
  assert.equal(meta6.days, 6);
  assert.equal(meta6.title, "Periode Sebelumnya (6 hari)");
  assert.equal(meta6.compactLabel, "Periode Sebelumnya (6 hari: 9–14 Nov 2026)");
  assert.equal(meta6.dateRangeLabel, "9 November 2026 – 14 November 2026");

  const meta7 = previousPeriodMeta(range({ from: "2026-11-15", to: "2026-11-21" }));
  assert.equal(meta7.days, 7);
  assert.equal(meta7.title, "7 Hari Sebelumnya");
  assert.equal(meta7.compactLabel, "7 Hari Sebelumnya (8–14 Nov 2026)");

  const meta30 = previousPeriodMeta(range({ from: "2026-10-22", to: "2026-11-20" }));
  assert.equal(meta30.days, 30);
  assert.equal(meta30.title, "30 Hari Sebelumnya");
  assert.equal(meta30.compactLabel, "30 Hari Sebelumnya (22 Sep–21 Okt 2026)");

  const metaMonth = previousPeriodMeta(range({ from: "2026-10-01", to: "2026-10-31" }));
  assert.equal(metaMonth.title, "Bulan Sebelumnya");
  assert.equal(metaMonth.dateRangeLabel, "1 September 2026 – 30 September 2026");
});

test("C6: nama berkas unduhan = judul PDF 'Laporan Insight Pasar: {outlet}' lewat filename* RFC 5987", () => {
  assert.equal(reportPdfFileName({ title: "Laporan Insight Pasar: Kamar & Resort" }), "Laporan Insight Pasar: Kamar & Resort.pdf");
  assert.equal(
    pdfContentDisposition("Laporan Insight Pasar: Kamar & Resort.pdf"),
    "attachment; filename=\"Laporan Insight Pasar: Kamar & Resort.pdf\"; filename*=UTF-8''Laporan%20Insight%20Pasar%3A%20Kamar%20%26%20Resort.pdf",
  );
  const bistro = pdfContentDisposition("Laporan Insight Pasar: D'Bistro.pdf");
  assert.match(bistro, /filename\*=UTF-8''Laporan%20Insight%20Pasar%3A%20D%27Bistro\.pdf$/, "apostrof wajib di-encode di filename*");
  const encoded = bistro.match(/filename\*=UTF-8''([^;]+)$/)?.[1];
  assert.equal(decodeURIComponent(encoded ?? ""), "Laporan Insight Pasar: D'Bistro.pdf");
  // Cadangan ASCII tidak boleh memuat huruf non-ASCII atau tanda kutip yang memutus header.
  const accented = pdfContentDisposition('Laporan Insight Pasar: Mövenpick "Carita".pdf');
  assert.match(accented, /filename="Laporan Insight Pasar: Movenpick _Carita_\.pdf"/);
  assert.match(accented, /M%C3%B6venpick%20%22Carita%22\.pdf$/);
});

test("C6: judul, <title>, dan nama berkas ketujuh varian memakai 'Laporan Insight Pasar: {outlet}' tanpa 'Intelijen'", async () => {
  for (const key of VARIANTS) {
    const r = await report(key);
    const expectedName = key === "all" ? "Semua Outlet" : r.outletBody!.outletName;
    assert.equal(r.title, `Laporan Insight Pasar: ${expectedName}`, `${key}: judul`);
    const html = renderMeetingReport(r);
    const escapedTitle = r.title.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
    assert.ok(html.includes(`<title>${escapedTitle}</title>`), `${key}: <title> sama dengan judul`);
    assert.equal(reportPdfFileName(r), `Laporan Insight Pasar: ${expectedName}.pdf`, `${key}: nama berkas`);
    assert.doesNotMatch(visibleText(html), /intelijen/i, `${key}: tidak ada kata Intelijen`);
    assert.match(footerTemplate(r), /Laporan Insight Pasar/);
  }
});

test("C7: tabel ulasan memakai periode pembanding setara, baris Total di bawah, tanpa kolom atau angka Selisih", async () => {
  for (const period of PERIODS) {
    const meta = previousPeriodMeta(range(period));
    for (const key of VARIANTS) {
      const r = await report(key, period);
      const html = renderMeetingReport(r);
      for (const body of bodiesOf(r)) {
        assert.equal(body.reviews.previousPeriodCompactLabel, meta.compactLabel, `${key} ${period.from}: label pembanding`);
        assert.equal(body.reviews.periodDays, meta.days);
        const reviewKpi = body.kpis.find((k) => k.label === "Ulasan Periode Terpilih");
        assert.ok(reviewKpi, `${key}: KPI ulasan ada`);
        assert.doesNotMatch(`${reviewKpi.value} ${reviewKpi.sub}`, /[+-]\d+\s*vs\b|selisih/i, `${key}: KPI ulasan tanpa selisih`);
      }
      for (const table of html.match(/<table class="review-table">[\s\S]*?<\/table>/g) ?? []) {
        assert.doesNotMatch(table, /Selisih/i, `${key}: tabel ulasan tanpa kolom Selisih`);
        assert.match(table, /<th[^>]*>7 Hari Sebelumnya|<th[^>]*>Periode Sebelumnya|<th[^>]*>Bulan Sebelumnya/);
        const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => visibleText(m[1]).trim());
        assert.match(rows.at(-1) ?? "", /^Total Ulasan Terverifikasi/, `${key}: baris Total paling bawah`);
      }
      assert.equal((html.match(/<table class="review-table">/g) ?? []).length, bodiesOf(r).length, `${key}: satu tabel ulasan per outlet`);
    }
  }
  const all = await report("all");
  const meta = previousPeriodMeta(range(MAIN_PERIOD));
  assert.ok(all.matrix.table.head.includes("Ulasan Periode Terpilih"));
  assert.ok(all.matrix.table.head.includes(`Ulasan ${meta.title}`));
  for (const row of all.matrix.table.rows) assert.doesNotMatch(row.join(" "), /\bvs\b|[+]\d/, "ikhtisar tanpa angka selisih");
});

test("C8 dan C13: tabel 2 tanpa kolom Audit pembanding dan hanya baris ringkasan (tanpa sub-baris tipe kamar)", async () => {
  const audit = await loadCompsetAudit(await loadResortMarketSize());
  for (const key of VARIANTS) {
    const r = await report(key);
    const html = renderMeetingReport(r);
    assert.doesNotMatch(visibleText(html), /audit pembanding/i, `${key}: kolom Audit pembanding tidak dicetak`);
    assert.doesNotMatch(html, /class="room-sub"/, `${key}: sub-baris tipe kamar tidak dicetak`);
    for (const body of bodiesOf(r)) {
      const used = audit[body.outletKey].used.map((c) => c.name);
      assert.equal(body.matrix.table.rows.length, used.length + 1, `${body.outletKey}: Sanghyang + kompetitor aktif saja`);
      assert.deepEqual(body.matrix.table.rows.slice(1).map((row) => row[1]), used);
      assert.ok(!body.matrix.table.head.some((h) => /audit/i.test(h)));
    }
  }
  const resort = await report("resort");
  const head = resort.matrix.table.head;
  assert.equal(head.length, 13, "13 kolom ringkasan Kamar & Resort");
  // Tarif di PDF = tarif baris ringkasan matriks web (C12/C13), tanpa angka sub-baris yang berbeda.
  const rateColumn = head.findIndex((h) => /^Tarif /.test(h));
  assert.ok(rateColumn > 0, "kolom tarif ada");
  const hotels = resort.outletBody!.matrix.competitorMatrix!.hotelEntries!;
  resort.matrix.table.rows.forEach((row, i) => assert.equal(row[rateColumn], hotels[i].otaRateLabel, `${row[1]}: tarif sama dengan matriks web`));
  assert.ok(resort.matrix.table.rows.some((row) => /Rp [\d.]+/.test(row[rateColumn])), "DB lokal punya tarif rupiah");
  assert.match(visibleText(renderMeetingReport(resort)), /Hari Biasa \(Weekday\)[\s\S]*Akhir Pekan \(Weekend\)/, "ringkasan termurah hari biasa dan akhir pekan");
});

test("C9, C2, C19, C17: teks PDF tanpa nama alat/model AI, tanpa 'pesaing'/'registri', tanpa Rekomendasi & Langkah Aksi, format 'terakhir diperiksa DD Mmm YYYY'", async () => {
  for (const key of VARIANTS) {
    const html = renderMeetingReport(await report(key));
    const text = visibleText(html);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(text, TOOL_OR_AI_NAME, `${key}: nama alat atau model AI tercetak`);
    assert.doesNotMatch(text, /\bpesaing\b/i, `${key}: kata pesaing`);
    assert.doesNotMatch(text, /\bregistri\b/i, `${key}: kata registri`);
    assert.doesNotMatch(text, /rekomendasi|langkah aksi/i, `${key}: bagian Rekomendasi & Langkah Aksi`);
    for (const m of text.matchAll(/(\S+)\s+diperiksa\s+(\S+ \S+ \S+)/g)) {
      assert.equal(m[1].replace(/[^\p{L}]/gu, "").toLowerCase(), "terakhir", `${key}: "${m[0]}" harus "terakhir diperiksa"`);
      assert.match(m[2], SHORT_DATE, `${key}: "${m[0]}" harus DD Mmm YYYY`);
    }
  }
});

test("C16: promo dan event dipisah untuk Sanghyang dan kompetitor, tanpa unggahan umum, mengikuti periode terpilih", async () => {
  for (const period of PERIODS) {
    const r0 = range(period);
    for (const key of OUTLET_KEYS) {
      const pr = (await report(key, period)).outletBody!.promos;
      const groups = [
        { list: pr.ownPromos, own: true, kind: "promo" as const },
        { list: pr.ownEvents, own: true, kind: "event" as const },
        { list: pr.competitorPromos, own: false, kind: "promo" as const },
        { list: pr.competitorEvents, own: false, kind: "event" as const },
      ];
      for (const g of groups) {
        for (const p of g.list) {
          const where = `${key} ${period.from}: ${p.competitorName} "${p.title}"`;
          assert.equal(p.kind, g.kind, where);
          assert.equal(isOwnCompetitorName(p.competitorName), g.own, where);
          assert.notEqual(p.sourceLabel, OWN_TEAM_SOURCE, where);
          assert.doesNotMatch(p.title, RAW_POST_PREFIX, `${where}: judul mentah sosmed`);
          assert.doesNotMatch(p.title, EMOJI, `${where}: emoji di judul`);
          assert.doesNotMatch(p.title, /\b(no\s+sliders|no\s+dropdowns|let'?s\s+put\s+something\s+else)\b/i, `${where}: unggahan umum gambar 9`);
          // Aturan web dan PDF yang sama: berjalan di dalam periode, atau segera datang dan sudah diumumkan sebelum periode berakhir.
          const dates = { startsAt: new Date(p.startsAt), endsAt: p.endsAt ? new Date(p.endsAt) : null, capturedAt: new Date(p.capturedAt), title: p.title };
          assert.ok(promoInRange(dates, r0, NOW, g.kind), `${where}: tidak berjalan dan tidak segera datang pada periode`);
        }
      }
    }
  }
});

test("C16: promo tanpa tanggal yang tertangkap 1 Jun dan belum berakhir lolos saringan web dan PDF pada preset 90 hari", async () => {
  const { db } = await import("../../src/lib/db");
  // Penawaran situs resmi Marbella tanpa tanggal tertulis (DB lokal 22 Nov 2026, tests/fixtures/promo-rentang-2026-11-22.json),
  // seandainya tangkapan terakhirnya 1 Jun: tanggal mulai = tanggal tangkap, tanpa tanggal akhir, status belum expired.
  const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/promo-rentang-2026-11-22.json"), "utf8")) as {
    rows: { label: string; title: string; category: string; description: string | null; kind: "promo" | "event" | null; promotionType: string | null; source: string; sourceUrl: string | null; price: number | null; discount: number | null; details: string[]; terms: string[]; status: "new" | "changed" | "expired"; competitor: { name: string } }[];
  };
  const offer = fixture.rows.find((r) => r.label === "marbella-early-bird-situs");
  assert.ok(offer, "baris penawaran situs Marbella ada di fixture");
  const june = new Date("2026-06-01T03:00:00Z");
  const row = { ...offer, startsAt: june, endsAt: null, capturedAt: june };
  const now = new Date("2026-11-22T00:30:00Z");
  const range = presetRange("90d", now);
  // Gerbang dalam memori yang sama di ringkasan web dan PDF.
  assert.equal(promoInRange(row, range, now), true, "berjalan sampai 30 Agu, di dalam 25 Agu-22 Nov");
  assert.equal(isPromoWithinRecencyWindow(row, range.to), true, "tanpa tanggal tertulis dan belum expired");
  // Saringan basis data kedua jalur dinilai Postgres di dalam transaksi yang dibatalkan, jadi DB tidak berubah.
  class Rollback extends Error {}
  await assert.rejects(
    db.$transaction(async (tx) => {
      const competitor = await tx.competitor.findFirstOrThrow({ where: { name: offer.competitor.name, active: true }, select: { id: true } });
      const { id } = await tx.competitorPromotion.create({
        data: {
          competitorId: competitor.id, title: row.title, category: row.category, description: row.description, startsAt: june, endsAt: null, price: row.price, discount: row.discount,
          source: row.source, sourceUrl: row.sourceUrl, capturedAt: june, status: row.status, kind: row.kind, details: row.details, terms: row.terms,
        },
        select: { id: true },
      });
      const passes = (where: object) => tx.competitorPromotion.count({ where: { AND: [where, { id }] } });
      assert.equal(await passes(promoRangeWhere(range)), 1, "saringan ringkasan web");
      assert.equal(await passes(reportPromoWhere(range)), 1, "saringan PDF");
      throw new Rollback();
    }),
    Rollback,
  );
  assert.equal(await db.competitorPromotion.count({ where: { title: row.title, capturedAt: june } }), 0, "baris uji tidak tersimpan");
});

test("E1: setiap tabel promo memuat kolom Kategori Promosi (urutan sama dengan web) dan keterangan kategori yang muncul", async () => {
  const expectedHead = ["Tempat", "Judul Promo", "Kategori Promosi", "Periode", "Harga / Diskon", "Sumber"];
  const cellsOf = (tableHtml: string, tag: "th" | "td") =>
    [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((row) => [...row[1].matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g"))].map((c) => visibleText(c[1]).trim()))
      .filter((cells) => cells.length > 0);
  for (const key of VARIANTS) {
    const r = await report(key);
    let promoTables = 0;
    for (const body of bodiesOf(r)) {
      const pr = body.promos;
      for (const p of [...pr.ownPromos, ...pr.ownEvents, ...pr.competitorPromos, ...pr.competitorEvents]) {
        assert.ok(p.promotionType === null || PROMOTION_TYPES.includes(p.promotionType), `${key}: ${p.title}`);
        assert.equal(p.promotionTypeLabel, promotionTypeLabel(p.promotionType), `${key}: label kategori ${p.title}`);
      }
      promoTables += (pr.ownPromos.length ? 1 : 0) + (pr.competitorPromos.length ? 1 : 0);
    }
    const html = renderMeetingReport(r);
    const tables = [...html.matchAll(/<table class="promo-table">([\s\S]*?)<\/table>(?:<p class="note">Kategori Promosi · ([\s\S]*?)<\/p>)?/g)];
    assert.equal(tables.length, promoTables, `${key}: satu tabel promo per kelompok berisi`);
    for (const [, tableHtml, legendHtml] of tables) {
      assert.deepEqual(cellsOf(tableHtml, "th")[0], expectedHead, `${key}: urutan kolom tabel promo`);
      assert.ok(legendHtml, `${key}: keterangan kategori di bawah tabel promo`);
      const legend = visibleText(legendHtml);
      const labels = new Set(cellsOf(tableHtml, "td").map((cells) => cells[2]));
      for (const label of labels) assert.ok(legend.includes(`${label}:`), `${key}: keterangan memuat "${label}"`);
      for (const t of PROMOTION_TYPES) {
        if (!labels.has(PROMOTION_TYPE_INFO[t].label)) assert.ok(!legend.includes(`${PROMOTION_TYPE_INFO[t].label}:`), `${key}: keterangan hanya kategori yang muncul`);
      }
    }
    for (const eventTable of html.match(/<table class="event-table">[\s\S]*?<\/table>/g) ?? []) {
      assert.deepEqual(cellsOf(eventTable, "th")[0], ["Tempat", "Judul Acara / Kegiatan", "Periode", "Kategori / Harga", "Sumber"]);
      assert.doesNotMatch(visibleText(eventTable), /Postingan Sosmed/, `${key}: kategori penyimpanan sosmed tidak dicetak`);
    }
  }
});

test("D1: ulasan negatif hanya dari periode terpilih; bila tidak ada, PDF menulis tidak ada ulasan negatif pada periode itu", async () => {
  for (const period of PERIODS) {
    const r0 = range(period);
    for (const key of OUTLET_KEYS) {
      const r = await report(key, period);
      const rev = r.outletBody!.reviews;
      for (const q of [...rev.complaints, ...rev.praises]) {
        const t = new Date(q.reviewDate);
        assert.ok(t >= r0.from && t <= r0.to, `${key} ${period.from}: kutipan ${q.reviewDate} di luar periode`);
      }
      assert.ok(rev.complaints.length <= rev.current.negative, `${key}: kutipan negatif melebihi hitungan`);
      const text = visibleText(renderMeetingReport(r));
      assert.doesNotMatch(text, /di luar rentang periode|terakhir tercatat/i, `${key}: ulasan di luar periode`);
      if (rev.current.negative === 0) {
        assert.equal(rev.complaints.length, 0);
        assert.match(text, /Tidak ada ulasan negatif pada periode terpilih/, `${key}: keterangan kosong`);
      }
    }
  }
  // Kasus pemilik 21 Nov: ulasan buruk 15 Okt dan 7 Agu tidak boleh muncul di laporan 15–21 Nov.
  const resort = (await report("resort")).outletBody!.reviews;
  assert.ok(!resort.complaints.some((q) => /2026-10-1[45]|2026-08-0[67]/.test(q.reviewDate)));
});

test("splitReviewQuotes hanya memakai ulasan periode terpilih", () => {
  const inPeriod = [
    { rating: 5, text: "Bagus dan bersih", source: "Google Maps", sourceUrl: "", reviewDate: "2026-11-19", themes: [] },
    { rating: 2, text: "Kamar mandi bau", source: "Google Maps", sourceUrl: "", reviewDate: "2026-11-18", themes: [] },
  ];
  const result = splitReviewQuotes(inPeriod, 4);
  assert.deepEqual(result.praises.map((q) => q.text), ["Bagus dan bersih"]);
  assert.deepEqual(result.complaints.map((q) => q.text), ["Kamar mandi bau"]);
  assert.deepEqual(splitReviewQuotes([], 4), { praises: [], complaints: [] });
});

test("B6 dan A8: isi wajib papan tulis per outlet, judul Ringkasan Kompetitor, tanpa profil kompetitor, hanya tabel 2 yang landscape", async () => {
  for (const key of VARIANTS) {
    const r = await report(key);
    const html = renderMeetingReport(r);
    const text = visibleText(html);
    assert.equal(r.sections.length, 0, `${key}: tanpa bab profil kompetitor`);
    assert.equal(r.chapters.length, key === "all" ? OUTLET_KEYS.length : 0);
    const outletCount = bodiesOf(r).length;
    for (const heading of ["1. Ulasan Terbaru", "2. Ringkasan Kompetitor", "3. Promo & Event"]) {
      assert.equal(text.split(heading).length - 1, outletCount, `${key}: bagian "${heading}" per outlet`);
    }
    for (const body of bodiesOf(r)) {
      assert.match(body.matrix.title, /^Ringkasan Kompetitor: /);
      assert.ok(body.kpis.some((k) => /tarif|menu/i.test(k.label)), `${body.outletKey}: KPI harga/kamar`);
    }
    assert.match(html, /@page wide \{ size: A4 landscape;/);
    assert.equal((html.match(/<section class="block matrix-landscape">/g) ?? []).length, outletCount, `${key}: satu bagian landscape per outlet`);
    assert.equal((html.match(/page: wide/g) ?? []).length, 1, `${key}: hanya .matrix-landscape yang memakai halaman landscape`);
  }
});

test("compactCheckNote: keterangan 'dicek' ringkas tanpa URL atau nama berkas, tanggal menjadi 'terakhir diperiksa DD Mmm YYYY'", () => {
  // Teks asli dari lib/market/competitor-menu.data.json (El Patio Marbella dan Spa & Wellness Aston Anyer).
  const marbella = compactCheckNote(
    "Situs resmi Marbella (https://marbellaplaceanyer.com/dining/el-patio/ & /offers/, diperiksa 15 & 19 Nov 2026): mencantumkan jam buka dan buffet tanpa daftar harga menu a la carte",
  );
  assert.equal(marbella, "Situs resmi Marbella (terakhir diperiksa 19 Nov 2026): mencantumkan jam buka dan buffet tanpa daftar harga menu a la carte");
  const aston = compactCheckNote(
    "Data resmi Archipelago (aston_amenities.json) & situs resmi anyer.astonhotelsinternational.com (diperiksa 17 & 19 Nov 2026): layanan spa terpadu hotel tanpa daftar harga publik terpisah",
  );
  assert.doesNotMatch(aston, /\.json|https?:|astonhotelsinternational/);
  assert.match(aston, /terakhir diperiksa 19 Nov 2026/);
});

test("promoDisplayTitle: judul unggahan sosmed tanpa penanda mentah/emoji dan memuat kalimat penawarannya", () => {
  // Takarir asli unggahan Instagram @dbistro.anyer 16 Nov 2026 dan @sanghyangresort 16 Nov 2026 di DB lokal.
  const bistro = promoDisplayTitle({
    title: "[FEED] Nikmati kekayaan cita rasa khas Banten di d’Bistro✨ Hadir dengan beragam pilihan",
    description: JSON.stringify({
      caption:
        "Nikmati kekayaan cita rasa khas Banten di d’Bistro✨\n\nHadir dengan beragam pilihan menu Nusantara yang menggugah selera, mulai dari Pepes Tahu & Oseng Kikil, Pecak Lele Goreng, Nasi Ikan Balado, hingga Pindang Ikan.\n\nLengkap dengan **FREE ICE TEA** untuk setiap pembelian menu! 🧡\n\nYuk, ajak keluarga dan teman untuk menikmati sajian lezat dengan cita rasa lokal.\n\n#dBistro #SanghyangIndah",
    }),
    kind: "promo",
  });
  assert.doesNotMatch(bistro, RAW_POST_PREFIX);
  assert.doesNotMatch(bistro, EMOJI);
  assert.match(bistro, /^Nikmati kekayaan cita rasa khas Banten di d’Bistro/);
  assert.match(bistro, /FREE ICE TEA untuk setiap pembelian menu!/);

  const kimia = promoDisplayTitle({
    title: "[REELS] Building stronger teams through unforgettable experiences. Terima kasih Kimia Fa",
    description: JSON.stringify({
      caption:
        "Building stronger teams through unforgettable experiences.\nTerima kasih Kimia Farma UB Cilegon telah mempercayakan momen kebersamaannya bersama kami!\n\n#hotelanyer #resortanyer #wisataanyer #pantaianyer #anyerbeach",
    }),
    kind: "event",
  });
  assert.match(kimia, /^Building stronger teams through unforgettable experiences\. Terima kasih Kimia Farma UB Cilegon/);
  assert.doesNotMatch(kimia, /#|\[REELS\]/);

  assert.equal(promoDisplayTitle({ title: "November Break Diskon 25%", description: null, kind: "promo" }), "November Break Diskon 25%");
  assert.equal(promoDisplayTitle({ title: "BUNDLING PROMO 99K++ 🔥", description: null, kind: "promo" }), "BUNDLING PROMO 99K++");
});

test("menu kompetitor: setiap kompetitor outlet F&B, bar, dan spa sudah punya entri di berkas data menu", async () => {
  const audit = await loadCompsetAudit(await loadResortMarketSize());
  const rivals = new Set(OUTLET_KEYS.filter((k) => k !== "resort").flatMap((k) => audit[k].used.map((c) => c.name)));
  const missing = [...rivals].filter((name) => competitorMenu(name) === null);
  assert.deepEqual(missing, [], "kompetitor baru harus diperiksa sumber harganya dulu (lib/market/competitor-menu.data.json)");
});

test("Laporan F&B: tabel perbandingan item sebanding memakai istilah Kompetitor dan kolom Selisih Harga", async () => {
  const bistro = await report("dbistro");
  assert.deepEqual(bistro.matrix.table.head, [
    "No",
    "Tempat",
    "Jarak",
    "Rating Google",
    "Kisaran Menu / Paket",
    "Rincian Menu & Harga",
    "Fasilitas & Suasana",
  ]);
  const text = visibleText(renderMeetingReport(bistro));
  assert.match(text, /Perbandingan Harga Item Sebanding \(D'Bistro vs Kompetitor Inti\)/);
  assert.match(text, /Selisih Harga/);
  for (const row of bistro.matrix.table.rows) assert.ok(row.every((c) => c !== ""), `sel kosong pada ${row[1]} (pakai ${NO_DATA})`);
});

test("PDF keputusan pemilik 22 Nov 2026: paket dan sewa ruang di luar kisaran menu, padanan umum ikan bakar berlabel", async () => {
  const dbar = (await report("dbar")).outletBody!;
  const head = dbar.matrix.table.head;
  const puppy = dbar.matrix.table.rows.find((row) => row[head.indexOf("Tempat")] === "Happy Puppy Karaoke");
  assert.ok(puppy, "Happy Puppy Karaoke aktif di daftar kompetitor D'Bar");
  // Sebelumnya: Rp 20.000 – Rp 1.300.000, termahal Royal Suite (Weekend) yang berupa paket ruang karaoke 3 jam.
  assert.equal(puppy[head.indexOf("Kisaran Menu / Paket")], "Rp 20.000 – Rp 80.000");
  assert.match(puppy[head.indexOf("Rincian Menu & Harga")], /dari 39 item per porsi; di luar kisaran: 16 paket sewa ruang, 10 sewa ruang per jam$/);
  assert.doesNotMatch(visibleText(renderMeetingReport(await report("dbar"))), /Rp 1\.300\.000/);

  const text = visibleText(renderMeetingReport(await report("sunset-grill")));
  assert.ok(text.includes("Kamalika Beach Cafe & Resto: Rp 17.000 (-53%, padanan umum: jenis ikan tidak disebut)"), "kakap bakar per ons");
  assert.ok(text.includes("Kamalika Beach Cafe & Resto: Rp 17.000 (-67%, padanan umum: jenis ikan tidak disebut)"), "kerapu bakar per ons");
  assert.match(text, /Kerapu Bakar \(per ons\) Rp 52\.000 Rp [\d.]+ \(termasuk padanan umum\)/, "rata-rata yang memuat padanan umum diberi catatan");
});
