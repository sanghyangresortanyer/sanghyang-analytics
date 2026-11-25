/**
 * Templat HTML/CSS laporan PDF Insight Pasar Sanghyang (format ringkas 3 poin per outlet):
 * - Portrait: sampul, KPI, "1. Ulasan Terbaru" (positif, netral, negatif, baris Total; tanpa kolom selisih).
 * - Landscape (`@page wide`), satu-satunya halaman lebar: "2. Ringkasan Kompetitor" (baris ringkasan tanpa kolom
 *   Audit pembanding) ditambah tarif termurah hari biasa dan akhir pekan (Kamar & Resort) atau perbandingan item
 *   sebanding (F&B, bar, spa).
 * - Portrait: "3. Promo & Event Berjalan", promo dan event dipisah untuk Sanghyang dan kompetitor.
 * Warna mengikuti token merek Sanghyang (app/styles/tokens.css). Semua teks data lewat sanitizeReportText.
 */
import type { FnbMatrixEntry, HotelMatrixEntry, OutletCompetitorMatrix } from "@/lib/market/competitor-matrix";
import { GENERIC_MATCH_LABEL } from "@/lib/market/fnb-compare";
import { rupiah } from "@/lib/market/menu-format";
import { promoDayLabel } from "@/lib/market/promo-radar";
import { PROMOTION_TYPE_INFO, PROMOTION_TYPES, promotionTypeLabel } from "@/lib/market/promo-type";
import { printText, sanitizeReportText } from "@/lib/meeting-report/build";
import { matrixCell, pdfMatrixColumns } from "@/lib/meeting-report/sections";
import type {
  MeetingReport,
  OutletReportBody,
  ReportChapter,
  ReportPromoEntry,
  ReportReviewQuote,
  ReportSource,
  ReportTable,
} from "@/lib/meeting-report/types";
import { NO_DATA } from "@/lib/meeting-report/types";

export const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Teks data untuk dicetak: dibersihkan dari nama alat/model AI dan istilah lama, lalu di-escape. */
const txt = (s: string | null | undefined) => esc(printText(s));

/** Hanya tautan http(s) yang dijadikan link; skema lain dicetak sebagai teks. */
const safeHref = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

const link = (label: string, url: string | null | undefined) => {
  const href = safeHref(url);
  return href ? `<a href="${esc(href)}">${txt(label)}</a>` : txt(label);
};

/** "15 Nov 2026" menurut kalender WIB; tanggal tanpa jam ("2026-11-15") dibaca sebagai hari WIB itu. */
const shortDay = (value: string) =>
  promoDayLabel(/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+07:00`) : new Date(value), null);

const FONTS = "https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Noto+Serif+Display:wght@500;600&display=swap";

const STYLE = `
  :root {
    --velvet: #22382d; --cream: #f3f3ec; --sand: #fbf8f3; --ink: #1f2b4d; --sunset: #a94617;
    --palm: #375b49; --lagoon: #0f5673; --line: #e4ddd0; --muted: #5d5a52;
    --pos-bg: #edf7f1; --pos-ink: #1e5638; --neg-bg: #fdf1ed; --neg-ink: #9c2f15;
  }
  @page { size: A4 portrait; margin: 12mm 12mm 14mm; }
  @page wide { size: A4 landscape; margin: 9mm 10mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Archivo", "Segoe UI", Arial, sans-serif; font-size: 8.2pt; line-height: 1.36; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1, h2, h3, h4 { font-family: "Noto Serif Display", Georgia, serif; font-weight: 600; color: var(--velvet); margin: 0; break-after: avoid; }
  a { color: var(--lagoon); text-decoration: underline; }
  p { margin: 1mm 0; }
  ul { margin: 1mm 0; padding-left: 4.5mm; }
  li { margin: 0.5mm 0; }
  .eyebrow { font-size: 6.8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sunset); margin: 0; }
  .cover { background: var(--velvet); color: var(--cream); border-radius: 2.5mm; padding: 6mm 7mm; }
  .cover h1 { color: var(--cream); font-size: 16.5pt; line-height: 1.18; margin-top: 1.5mm; }
  .cover .sub { margin-top: 1.5mm; font-size: 8.3pt; color: var(--cream); opacity: 0.92; }
  .meta-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; margin-top: 3.5mm; }
  .meta-strip div { border: 1px solid rgba(243, 243, 236, 0.25); border-radius: 1.8mm; padding: 1.6mm 2.4mm; font-size: 7.4pt; }
  .meta-strip b { display: block; font-size: 6.4pt; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; margin-bottom: 0.5mm; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.2mm; margin-top: 3mm; }
  .kpi-card { background: var(--sand); border: 1px solid var(--line); border-top: 2px solid var(--velvet); border-radius: 1.8mm; padding: 2mm 2.4mm; }
  .kpi-card .k-label { font-size: 6.4pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .kpi-card .k-val { font-size: 10pt; font-weight: 700; color: var(--velvet); margin-top: 0.8mm; line-height: 1.2; }
  .kpi-card .k-sub { font-size: 6.7pt; color: var(--muted); margin-top: 0.6mm; line-height: 1.25; }
  .block { margin-top: 4mm; }
  .block h2 { font-size: 11pt; border-bottom: 1.5px solid var(--velvet); padding-bottom: 1mm; margin-bottom: 1.8mm; }
  .block h3 { font-size: 9.2pt; color: var(--palm); margin: 2.2mm 0 1mm; }
  .chapter-start { break-before: page; }
  .chapter-banner { border-left: 3mm solid var(--sunset); padding-left: 3mm; margin-bottom: 2mm; }
  .chapter-banner h2 { font-size: 13.5pt; border: none; padding: 0; margin: 0.5mm 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 7.3pt; margin: 1.2mm 0; font-variant-numeric: tabular-nums; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border-bottom: 1px solid var(--line); padding: 1mm 1.5mm; text-align: left; vertical-align: top; }
  thead th { background: var(--cream); color: var(--velvet); font-weight: 700; }
  tbody tr:nth-child(even) td { background: var(--sand); }
  tbody tr.total-row td { background: var(--cream); border-top: 1.5px solid var(--velvet); border-bottom: 1.5px solid var(--velvet); font-weight: 700; color: var(--velvet); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 1.8mm; }
  .review-box { border: 1px solid var(--line); border-radius: 1.8mm; padding: 2.2mm 2.8mm; break-inside: avoid; }
  .review-box.pos { background: var(--pos-bg); border-color: #c5e1cf; }
  .review-box.neg { background: var(--neg-bg); border-color: #f0cbc0; }
  .review-box h3 { margin-top: 0; font-size: 8.8pt; }
  .review-box.pos h3 { color: var(--pos-ink); }
  .review-box.neg h3 { color: var(--neg-ink); }
  .quote-item { font-size: 7.3pt; margin: 1.1mm 0; padding-bottom: 1mm; border-bottom: 1px dashed rgba(31, 43, 77, 0.14); }
  .quote-item:last-child { border-bottom: none; padding-bottom: 0; }
  .quote-meta { font-size: 6.7pt; color: var(--muted); }
  .pill { display: inline-block; padding: 0.2mm 1.4mm; border-radius: 1mm; font-size: 6.3pt; font-weight: 600; background: var(--cream); color: var(--velvet); margin-right: 1mm; }
  .pill.ref { background: #e9eef2; color: var(--lagoon); margin: 0 0 0 1mm; }
  .social-strip { background: var(--sand); border: 1px solid var(--line); border-radius: 1.8mm; padding: 1.8mm 2.8mm; margin-top: 1.8mm; font-size: 7.3pt; }
  .matrix-landscape { page: wide; break-before: page; }
  .matrix-landscape h2 { font-size: 11pt; border-bottom: 1.5px solid var(--velvet); padding-bottom: 1mm; margin-bottom: 1.2mm; }
  .matrix-landscape h3 { font-size: 8.8pt; color: var(--velvet); margin: 2.4mm 0 0.6mm; }
  .matrix-landscape table.matrix-table { table-layout: fixed; font-size: 6.6pt; line-height: 1.26; margin: 1.2mm 0; }
  .matrix-landscape table.matrix-table th, .matrix-landscape table.matrix-table td { padding: 0.9mm 1.1mm; overflow-wrap: anywhere; }
  .matrix-landscape table.compare-table { font-size: 6.7pt; line-height: 1.26; margin-top: 0.8mm; }
  .matrix-landscape table.compare-table th, .matrix-landscape table.compare-table td { padding: 0.8mm 1.2mm; }
  tr.own-row td { background: #e8f1eb !important; font-weight: 600; }
  .promo-group { border: 1px solid var(--line); border-radius: 1.8mm; padding: 2.2mm 2.8mm; background: var(--sand); margin-top: 2.2mm; }
  .promo-group > h3 { margin: 0 0 0.6mm; font-size: 9.2pt; color: var(--velvet); }
  .promo-sub { margin-top: 1.6mm; }
  .promo-sub h4 { font-size: 8pt; color: var(--palm); margin: 0 0 0.6mm; }
  .promo-group table { font-size: 6.8pt; line-height: 1.3; background: #ffffff; }
  .promo-group th, .promo-group td { padding: 0.8mm 1.3mm; }
  .promo-group tbody tr:nth-child(even) td { background: #fbfaf7; }
  .note { font-size: 6.9pt; color: var(--muted); margin-top: 0.8mm; }
  .sources { font-size: 6.9pt; color: var(--muted); margin-top: 1.2mm; }
  .method { font-size: 6.9pt; color: var(--muted); margin-top: 2.5mm; border-top: 1px solid var(--line); padding-top: 1.5mm; }
  .method b { color: var(--velvet); }
`;

function renderSimpleTable(t: ReportTable): string {
  return `<table><thead><tr>${t.head.map((h) => `<th>${txt(h)}</th>`).join("")}</tr></thead><tbody>${t.rows
    .map((r) => `<tr>${r.map((c) => `<td>${txt(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function renderSources(list: ReportSource[]): string {
  if (!list.length) return "";
  return `<p class="sources">Sumber: ${list.map((s) => link(s.label, s.url)).join(" | ")}</p>`;
}

function renderQuotes(list: ReportReviewQuote[], emptyText: string): string {
  if (!list.length) return `<p class="note">${esc(emptyText)}</p>`;
  return list
    .map((q) => {
      const score = q.rating > 0 ? `${q.rating}/5` : "Komentar publik";
      return `<div class="quote-item">&ldquo;${txt(q.text)}&rdquo;<div class="quote-meta">${link(q.source, q.sourceUrl)} · ${esc(score)} · ${esc(shortDay(q.reviewDate))}</div></div>`;
    })
    .join("");
}

function renderReviewSection(body: OutletReportBody): string {
  const rev = body.reviews;
  const rows = [
    ["Ulasan Positif (Pujian)", rev.current.positive, rev.previous.positive],
    ["Ulasan Netral", rev.current.neutral, rev.previous.neutral],
    ["Ulasan Negatif (Perlu Perhatian)", rev.current.negative, rev.previous.negative],
  ]
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("");
  const themes = rev.topThemes.length
    ? `<p class="note"><b>Topik dominan:</b> ${rev.topThemes.map((t) => `<span class="pill">${txt(t.theme)} (${t.count})</span>`).join(" ")}</p>`
    : "";
  const social = [
    rev.socialStatus.accounts.length ? `Akun: ${rev.socialStatus.accounts.join(", ")}` : null,
    rev.socialStatus.followersText,
    rev.socialStatus.likesText,
    rev.socialStatus.note,
  ].filter(Boolean);

  return `<section class="block">
    <h2>1. Ulasan Terbaru: Positif &amp; Negatif</h2>
    <table class="review-table">
      <thead><tr>
        <th style="width:40%">Metrik Ulasan Sanghyang</th>
        <th style="width:30%">Periode Terpilih (${esc(rev.periodLabel)})</th>
        <th style="width:30%">${esc(rev.previousPeriodCompactLabel)}</th>
      </tr></thead>
      <tbody>${rows}<tr class="total-row"><td>Total Ulasan Terverifikasi</td><td>${rev.current.total}</td><td>${rev.previous.total}</td></tr></tbody>
    </table>
    ${themes}
    <div class="two-col">
      <div class="review-box pos"><h3>Ulasan Positif (Pujian Tamu)</h3>${renderQuotes(rev.praises, "Tidak ada ulasan positif pada periode terpilih.")}</div>
      <div class="review-box neg"><h3>Ulasan Negatif (Perlu Perhatian)</h3>${renderQuotes(rev.complaints, "Tidak ada ulasan negatif pada periode terpilih.")}</div>
    </div>
    <div class="social-strip"><b>Status Kanal Media Sosial Sanghyang:</b> ${txt(social.join(" · "))}</div>
    ${renderSources(rev.sources)}
  </section>`;
}

/** Bobot lebar kolom tabel 2 menurut nama kolom web; dinormalkan ke 100% dari kolom yang benar-benar dicetak. */
const RESORT_COLUMN_WEIGHT: Record<string, number> = {
  No: 2.5, Tempat: 12, Bintang: 4.5, Jarak: 6.5, "Tipe Kamar": 8.5, Luas: 6, "Tarif kamar (biasa / akhir pekan)": 13.5,
  "Rating Google": 6.5, Kamar: 4, "Smart TV": 5.5, Bathtub: 6, "Kolam / Air Panas": 9, "Gaya Desain": 15.5,
};
const FNB_COLUMN_WEIGHT: Record<string, number> = {
  No: 3, Tempat: 15, Jarak: 7.5, "Rating Google": 7, "Kisaran Menu / Paket": 13, "Rincian Menu & Harga": 33, "Fasilitas & Suasana": 21.5,
};

function colgroup(columns: string[], weights: Record<string, number>): string {
  const total = columns.reduce((sum, c) => sum + (weights[c] ?? 0), 0);
  if (columns.some((c) => weights[c] === undefined)) {
    throw new Error(`Kolom tabel 2 tanpa lebar cetak: ${columns.filter((c) => weights[c] === undefined).join(", ")}`);
  }
  return `<colgroup>${columns.map((c) => `<col style="width:${((weights[c] / total) * 100).toFixed(2)}%">`).join("")}</colgroup>`;
}

function renderMatrixRows(cm: OutletCompetitorMatrix, columns: string[]): string {
  const entries: (HotelMatrixEntry | FnbMatrixEntry)[] = cm.kind === "resort" ? (cm.hotelEntries ?? []) : (cm.fnbEntries ?? []);
  return entries
    .map((e) => {
      // Penyaring klaim fasilitas yang dibantah hanya untuk baris Sanghyang; fakta kompetitor dicetak apa adanya.
      const clean = e.role === "sanghyang" ? sanitizeReportText : printText;
      const cells = columns.map((c) => {
        const value = esc(clean(matrixCell(cm.kind, e, c)));
        return c === "Tempat" && e.role === "acuan" ? `<td>${value}<span class="pill ref">Acuan</span></td>` : `<td>${value}</td>`;
      });
      return `<tr${e.role === "sanghyang" ? ' class="own-row"' : ""}>${cells.join("")}</tr>`;
    })
    .join("");
}

/** Tarif kamar termurah hari biasa dan akhir pekan, ringkas: kategori hari hanya ditulis di baris pertama kelompoknya. */
function renderCheapestRates(cm: OutletCompetitorMatrix): string {
  const cc = cm.cheapestComparison;
  if (!cc || cc.rows.length === 0) return "";
  const rows = cc.rows
    .map((r, i) => {
      const firstOfStay = i === 0 || cc.rows[i - 1].stay !== r.stay;
      const checkIn = r.checkIn ? `, ${shortDay(r.checkIn)}` : "";
      return `<tr${r.role === "sanghyang" ? ' class="own-row"' : ""}>
        <td>${firstOfStay ? txt(r.stayLabel) : ""}</td>
        <td>${txt(r.hotelName)}</td>
        <td>${txt(r.roomTypeName)}</td>
        <td>${txt(r.areaLabel)}</td>
        <td>${txt(r.breakfastLabel)}</td>
        <td>${txt(r.priceLabel)} · ${link(r.otaName, r.otaUrl)}${esc(checkIn)}</td>
        <td>${txt(r.diffLabel)}</td>
      </tr>`;
    })
    .join("");
  return `<h3>${txt(cc.title)}</h3>
    ${cc.subtitle ? `<p class="note">${txt(cc.subtitle)}</p>` : ""}
    <table class="compare-table">
      <thead><tr>
        <th style="width:12%">Kategori Hari</th><th style="width:21%">Tempat</th><th style="width:20%">Tipe Kamar</th>
        <th style="width:7%">Luas</th><th style="width:11%">Sarapan</th><th style="width:19%">Tarif, OTA, check-in</th>
        <th style="width:10%">Selisih vs Sanghyang</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderItemComparisons(cm: OutletCompetitorMatrix, outletName: string): string {
  const rows = (cm.itemComparisons ?? []).filter((ic) => ic.matches.length > 0);
  if (!rows.length) return "";
  return `<h3>Perbandingan Harga Item Sebanding (${esc(outletName)} vs Kompetitor Inti)</h3>
    <table class="compare-table">
      <thead><tr>
        <th style="width:20%">Item Resmi Sanghyang</th><th style="width:12%">Harga Sanghyang</th>
        <th style="width:13%">Rata-rata Kompetitor</th><th style="width:10%">Selisih Harga</th>
        <th style="width:45%">Rincian Kompetitor &amp; Harga</th>
      </tr></thead>
      <tbody>${rows
        .map((ic) => {
          const genericInAverage = ic.matches.some((m) => m.core && m.generic);
          const avg =
            ic.averageCompetitorPrice !== null
              ? `${rupiah(ic.averageCompetitorPrice)}${genericInAverage ? " (termasuk padanan umum)" : ""}`
              : NO_DATA;
          const gap = ic.averageGapPercent !== null ? `${ic.averageGapPercent > 0 ? "+" : ""}${ic.averageGapPercent}%` : NO_DATA;
          // Kompetitor acuan dicantumkan tetapi tidak masuk rata-rata, jadi ditandai. Padanan umum masuk rata-rata dan selalu berlabel.
          const rivals = ic.matches
            .map(
              (m) =>
                `${m.rival}${m.core ? "" : " (acuan)"}: ${rupiah(m.price)} (${m.gapPercent > 0 ? "+" : ""}${m.gapPercent}%${m.generic ? `, ${GENERIC_MATCH_LABEL}` : ""})`,
            )
            .join("; ");
          return `<tr><td><b>${txt(ic.itemName)}</b>${ic.unit ? ` (${txt(ic.unit)})` : ""}</td><td>${esc(rupiah(ic.sanghyangPrice))}</td><td>${esc(avg)}</td><td>${esc(gap)}</td><td>${txt(rivals)}</td></tr>`;
        })
        .join("")}</tbody>
    </table>`;
}

function renderCompetitorMatrixSection(body: OutletReportBody): string {
  const cm = body.matrix.competitorMatrix;
  if (!cm) {
    return `<section class="block matrix-landscape">
      <h2>2. ${txt(body.matrix.title)}</h2>
      <p class="note">${txt(body.matrix.intro)}</p>
      ${renderSimpleTable(body.matrix.table)}
      <p class="note">${txt(body.matrix.note)}</p>
    </section>`;
  }
  const columns = pdfMatrixColumns(cm);
  return `<section class="block matrix-landscape">
    <p class="eyebrow">Ringkasan Kompetitor &amp; Harga · ${esc(body.outletName)}</p>
    <h2>2. ${txt(body.matrix.title)}</h2>
    <p class="note">${txt(body.matrix.intro)}</p>
    <table class="matrix-table">
      ${colgroup(columns, cm.kind === "resort" ? RESORT_COLUMN_WEIGHT : FNB_COLUMN_WEIGHT)}
      <thead><tr>${columns.map((c) => `<th>${txt(c)}</th>`).join("")}</tr></thead>
      <tbody>${renderMatrixRows(cm, columns)}</tbody>
    </table>
    <p class="note">${txt(body.matrix.note)}</p>
    ${cm.kind === "resort" ? renderCheapestRates(cm) : renderItemComparisons(cm, body.outletName)}
  </section>`;
}

/** Satu baris keterangan untuk kategori promosi yang muncul di tabel itu, memakai definisi bersama prompt AI. */
function promotionTypeLegend(list: ReportPromoEntry[]): string {
  const present = PROMOTION_TYPES.filter((t) => list.some((p) => p.promotionType === t));
  const parts = present.map((t) => `<b>${esc(PROMOTION_TYPE_INFO[t].label)}:</b> ${esc(PROMOTION_TYPE_INFO[t].definition)}`);
  if (list.some((p) => p.promotionType === null)) parts.push(`<b>${esc(promotionTypeLabel(null))}:</b> kategori promosi belum dibaca.`);
  return `<p class="note">Kategori Promosi · ${parts.join(" ")}</p>`;
}

/** Nama tempat hanya di baris pertama tiap kelompok; baris sudah diurutkan per tempat. */
const placeCell = (list: ReportPromoEntry[], i: number) =>
  i === 0 || list[i - 1].competitorName !== list[i].competitorName ? `<b>${txt(list[i].competitorName)}</b>` : "";

function renderPromoTable(list: ReportPromoEntry[], emptyMsg: string, omitted: number): string {
  if (!list.length) return `<p class="note">${esc(emptyMsg)}</p>`;
  const rows = list
    .map((p, i) => {
      const offer = [p.priceText, p.discount != null ? `Diskon ${p.discount}%` : null].filter(Boolean).join(" · ") || "—";
      return `<tr>
        <td>${placeCell(list, i)}</td>
        <td>${txt(p.title)}</td>
        <td>${txt(p.promotionTypeLabel)}</td>
        <td>${txt(p.dateLabel)}</td>
        <td>${txt(offer)}</td>
        <td>${link(p.sourceLabel, p.sourceUrl)}</td>
      </tr>`;
    })
    .join("");
  const more = omitted > 0 ? `<p class="note">+${omitted} promo lain tercatat pada periode ini; daftar lengkap ada di halaman Insight Pasar.</p>` : "";
  return `<table class="promo-table">
    <thead><tr>
      <th style="width:17%">Tempat</th><th style="width:33%">Judul Promo</th><th style="width:12%">Kategori Promosi</th>
      <th style="width:15%">Periode</th><th style="width:11%">Harga / Diskon</th><th style="width:12%">Sumber</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>${promotionTypeLegend(list)}${more}`;
}

function renderEventTable(list: ReportPromoEntry[], emptyMsg: string, omitted: number): string {
  if (!list.length) return `<p class="note">${esc(emptyMsg)}</p>`;
  const rows = list
    .map((p, i) => {
      const value = [p.priceText, p.discount != null ? `Diskon ${p.discount}%` : null].filter(Boolean).join(" · ") || p.categoryLabel;
      return `<tr>
        <td>${placeCell(list, i)}</td>
        <td>${txt(p.title)}</td>
        <td>${txt(p.dateLabel)}</td>
        <td>${txt(value)}</td>
        <td>${link(p.sourceLabel, p.sourceUrl)}</td>
      </tr>`;
    })
    .join("");
  const more = omitted > 0 ? `<p class="note">+${omitted} event lain tercatat pada periode ini; daftar lengkap ada di halaman Insight Pasar.</p>` : "";
  return `<table class="event-table">
    <thead><tr>
      <th style="width:19%">Tempat</th><th style="width:40%">Judul Acara / Kegiatan</th><th style="width:16%">Periode</th>
      <th style="width:13%">Kategori / Harga</th><th style="width:12%">Sumber</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>${more}`;
}

function renderPromoSection(body: OutletReportBody): string {
  const pr = body.promos;
  return `<section class="block">
    <h2>3. Promo &amp; Event Berjalan (Maks. 3 Bulan Terakhir)</h2>
    <div class="promo-group">
      <h3>Sanghyang (${pr.ownPromos.length + pr.omitted.ownPromos} Promo · ${pr.ownEvents.length + pr.omitted.ownEvents} Event)</h3>
      <p class="note">Sumber: ${txt(pr.ownSourceSummary)}</p>
      <div class="promo-sub">
        <h4>Promo Berjalan Sanghyang (${pr.ownPromos.length + pr.omitted.ownPromos})</h4>
        ${renderPromoTable(pr.ownPromos, "Belum ada promo publik Sanghyang untuk outlet ini pada periode terpilih.", pr.omitted.ownPromos)}
      </div>
      <div class="promo-sub">
        <h4>Event &amp; Kegiatan Sanghyang (${pr.ownEvents.length + pr.omitted.ownEvents})</h4>
        ${renderEventTable(pr.ownEvents, "Belum ada event atau kegiatan publik Sanghyang untuk outlet ini pada periode terpilih.", pr.omitted.ownEvents)}
      </div>
    </div>
    <div class="promo-group">
      <h3>Kompetitor (${pr.competitorPromos.length + pr.omitted.competitorPromos} Promo · ${pr.competitorEvents.length + pr.omitted.competitorEvents} Event)</h3>
      <div class="promo-sub">
        <h4>Promo Kompetitor (${pr.competitorPromos.length + pr.omitted.competitorPromos})</h4>
        ${renderPromoTable(pr.competitorPromos, "Belum ada promo kompetitor untuk outlet ini pada periode terpilih.", pr.omitted.competitorPromos)}
      </div>
      <div class="promo-sub">
        <h4>Event Kompetitor (${pr.competitorEvents.length + pr.omitted.competitorEvents})</h4>
        ${renderEventTable(pr.competitorEvents, "Belum ada event atau kegiatan kompetitor untuk outlet ini pada periode terpilih.", pr.omitted.competitorEvents)}
      </div>
    </div>
    <p class="note">${txt(pr.note)}</p>
  </section>`;
}

function renderKpis(body: OutletReportBody): string {
  return `<div class="kpi-grid">${body.kpis
    .map((k) => `<div class="kpi-card"><div class="k-label">${txt(k.label)}</div><div class="k-val">${txt(k.value)}</div><div class="k-sub">${txt(k.sub)}</div></div>`)
    .join("")}</div>`;
}

function renderChapter(c: ReportChapter): string {
  return `<div class="chapter-start">
    <div class="chapter-banner">
      <p class="eyebrow">${txt(c.title)}</p>
      <h2>${txt(c.body.outletName)}</h2>
      <p class="note">${txt(c.intro)}</p>
    </div>
    ${renderKpis(c.body)}
    ${renderReviewSection(c.body)}
  </div>
  ${renderCompetitorMatrixSection(c.body)}
  ${renderPromoSection(c.body)}`;
}

export function renderMeetingReport(report: MeetingReport): string {
  const body = report.outletBody;
  const methodology = report.methodology.length
    ? `<section class="block method">
    <p><b>Metodologi dan sumber data.</b> ${report.methodology.map((m) => `<b>${txt(m.label)}:</b> ${txt(m.text)}`).join(" ")}</p>
  </section>`
    : "";
  const main = body
    ? `${renderKpis(body)}${renderReviewSection(body)}${renderCompetitorMatrixSection(body)}${renderPromoSection(body)}${methodology}`
    : `<section class="block">
         <h2>${txt(report.matrix.title)}</h2>
         <p class="note">${txt(report.matrix.intro)}</p>
         ${renderSimpleTable(report.matrix.table)}
         <p class="note">${txt(report.matrix.note)}</p>
       </section>
       ${methodology}
       ${report.chapters.map(renderChapter).join("")}`;

  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(report.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="${FONTS}"><style>${STYLE}</style></head><body>
  <header class="cover">
    <p class="eyebrow">Sanghyang Indah Spa Resort · Laporan Insight Pasar</p>
    <h1>${esc(report.title)}</h1>
    <p class="sub">${txt(report.subtitle)}</p>
    <div class="meta-strip">
      <div><b>Objek Riset</b>${esc(report.outletName)}</div>
      <div><b>Periode Terpilih</b>${esc(report.periodLabel ?? report.publishedAt)}</div>
      <div><b>${esc(report.previousPeriodTitle ?? "Periode Sebelumnya")}</b>${esc(report.previousPeriodLabel ?? NO_DATA)}</div>
    </div>
  </header>
  ${main}
  </body></html>`;
}

/** Kaki halaman PDF (dirender Chromium terpisah dari isi, jadi gayanya inline). */
export function footerTemplate(report: MeetingReport): string {
  return `<div style="width:100%;font-family:Arial,sans-serif;font-size:7px;color:#5d5a52;padding:0 12mm;display:flex;justify-content:space-between">
    <span>Laporan Insight Pasar · ${esc(report.outletName)} · ${esc(report.periodLabel ?? report.publishedAt)}</span>
    <span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>`;
}
