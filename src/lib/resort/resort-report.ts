// Laporan Resort (owner, 25 Nov 2026): the whole resort in one report, kept apart from the Google Ads report, which
// talks about rooms only. Same look as that report (renderReports). Revenue = the VHP revenue report (gross, with
// service and tax), as on the dashboard. Pure: the data is read in resort-data.ts.
import type { Occupancy } from "../dashboard/occupancy.ts";
import { revenueOutletFor } from "../dashboard/outlet-match.ts";
import { resolveJournalOutlet } from "../dashboard/range-report.ts";
import { type Period, REPORT_CSS, type ReportRow, shortRange, type WeeklyReport } from "../marketing/weekly-report.ts";

export type ResortSide = {
  /** Revenue per outlet, as on the dashboard (Banquet and Room Service inside d'Bistro). */
  outlets: Record<string, number>;
  /** Room revenue (Lodging) per guest type, VHP codes. */
  segments: { segment: string; lodging: number }[];
  stay: Occupancy | null;
  /** null = could not be read */
  purchase: number | null;
};
/** Revenue per outlet under the dashboard's names: VHP cuts a department to 12 characters in some journal lines. */
export function outletTotals(rows: { outlet_name: string; revenue: unknown }[], names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const o = revenueOutletFor(resolveJournalOutlet(r.outlet_name, names));
    out[o] = (out[o] ?? 0) + Number(r.revenue ?? 0);
  }
  return out;
}

export type ResortPeriods = { current: Period; previous: Period; labels: { prev: string; curr: string }; title: string; note?: string; partial?: boolean };

const GUESTS: [string, string[]][] = [
  ["WALK IN", ["WALK IN"]],
  ["FIT", ["FIT"]],
  ["OTA", ["FIT-TA"]],
  ["Perusahaan", ["FIT-CORP"]],
  ["Rombongan", ["GIT-CORP"]],
];
const rp = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const pct1 = (v: number) => `${v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const sum = (o: Record<string, number>) => Object.values(o).reduce((t, v) => t + v, 0);
const change = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
const word = (p: number | null) => (p === null ? "tanpa pembanding" : p === 0 ? "tetap" : `${p > 0 ? "naik" : "turun"} ${Math.abs(p)}%`);
const signed = (v: number) => `${v >= 0 ? "+" : "-"}${rp(Math.abs(v))}`;

export function resortReport(x: { periods: ResortPeriods; curr: ResortSide; prev: ResortSide; lastDataDay: string | null; cut: boolean }): WeeklyReport {
  const { curr: a, prev: b, periods: p } = x;
  const totalA = sum(a.outlets);
  const totalB = sum(b.outlets);
  const outlets = [...new Set([...Object.keys(a.outlets), ...Object.keys(b.outlets)])].sort((m, n) => (a.outlets[n] ?? 0) - (a.outlets[m] ?? 0));
  const roomOf = (s: ResortSide, codes?: string[]) => s.segments.filter((g) => !codes || codes.includes(g.segment)).reduce((t, g) => t + g.lodging, 0);
  const known = GUESTS.flatMap(([, c]) => c);
  const other = (s: ResortSide) => s.segments.filter((g) => !known.includes(g.segment)).reduce((t, g) => t + g.lodging, 0);

  const revenue: ReportRow[] = [
    ...outlets.map((o): ReportRow => ({ better: "up", metric: o, prev: b.outlets[o] ?? 0, curr: a.outlets[o] ?? 0, fmt: "rp", note: totalA > 0 ? `${pct1(((a.outlets[o] ?? 0) / totalA) * 100)} dari total` : "" })),
    { better: "up", metric: "Total revenue resort", prev: totalB, curr: totalA, fmt: "rp", note: "Semua outlet", total: true },
  ];
  const stay = (s: ResortSide, f: (o: Occupancy) => number | null) => (s.stay ? f(s.stay) : null);
  const rooms: ReportRow[] = [
    { better: "up", metric: "Revenue kamar", sub: "semua tamu digabung", prev: roomOf(b), curr: roomOf(a), fmt: "rp", note: "Harga kamar (Lodging) saja" },
    { better: "up", metric: "Kamar terjual", prev: stay(b, (o) => o.rooms), curr: stay(a, (o) => o.rooms), fmt: "int", note: "Satu kamar terisi satu malam" },
    { better: "up", metric: "OCC", prev: stay(b, (o) => o.occ), curr: stay(a, (o) => o.occ), fmt: "pct", points: true, note: "Kamar terjual dibagi 61 kamar" },
    { better: "up", metric: "ARR", prev: stay(b, (o) => o.arr), curr: stay(a, (o) => o.arr), fmt: "rp", note: "Harga kamar + sarapan dan minuman paket, dibagi kamar terjual" },
    ...GUESTS.map(([name, codes]): ReportRow => ({ better: "up", metric: name, sub: "revenue kamar", prev: roomOf(b, codes), curr: roomOf(a, codes), fmt: "rp", note: name === "OTA" ? "FIT-TA di VHP" : "" })),
    ...(other(a) || other(b) ? [{ metric: "Lainnya", sub: "revenue kamar", prev: other(b), curr: other(a), fmt: "rp" as const, note: "Jenis tamu lain atau tidak diisi" }] : []),
  ];
  const share = (s: ResortSide, total: number) => (s.purchase === null || total <= 0 ? null : (s.purchase / total) * 100);
  const purchase: ReportRow[] = [
    { metric: "Total pembelian", prev: b.purchase, curr: a.purchase, fmt: "rp", note: "Barang diterima dari supplier" },
    { better: "down", metric: "Pembelian dibanding revenue", prev: share(b, totalB), curr: share(a, totalA), fmt: "pct", points: true, note: "Makin kecil makin hemat" },
  ];

  const highlights = [`Total revenue resort ${word(change(totalA, totalB))}: ${rp(totalB)} → ${rp(totalA)}.`];
  const moves = outlets.map((o) => ({ o, d: (a.outlets[o] ?? 0) - (b.outlets[o] ?? 0) })).sort((m, n) => n.d - m.d);
  const up = moves[0];
  const down = moves.at(-1);
  const parts = [up && up.d > 0 ? `Naik paling banyak: ${up.o} ${signed(up.d)}.` : "", down && down.d < 0 ? `Turun paling banyak: ${down.o} ${signed(down.d)}.` : ""].filter(Boolean);
  if (parts.length) highlights.push(parts.join(" "));
  if (a.stay && b.stay) {
    // From the figures as printed (one decimal), so 28,3% → 32,0% reads 3,7 poin.
    const pts = Math.round(Math.round(a.stay.occ * 10) - Math.round(b.stay.occ * 10)) / 10;
    const occ = pts === 0 ? "OCC tetap" : `OCC ${pts > 0 ? "naik" : "turun"} ${Math.abs(pts).toLocaleString("id-ID")} poin`;
    const arr = a.stay.arr !== null && b.stay.arr ? `, ARR ${word(change(a.stay.arr, b.stay.arr))} (${rp(b.stay.arr)} → ${rp(a.stay.arr)})` : "";
    highlights.push(`${occ} (${pct1(b.stay.occ)} → ${pct1(a.stay.occ)})${arr}.`);
  }

  const kpiChange = (cur: number | null, prev: number | null) => (cur === null || prev === null ? "" : `${word(change(cur, prev))} dari ${p.labels.prev}`);
  return {
    kind: "resort",
    title: p.title,
    subtitle: "Revenue semua outlet, kamar, dan pembelian",
    business: "Sanghyang Indah Spa Resort",
    url: "Data VHP yang diunggah ke Sanghyang Analytics",
    period: p.current,
    previous: p.previous,
    ...(p.note ? { periodNote: p.note } : {}),
    ...(p.partial ? { partial: true } : {}),
    labels: p.labels,
    kpis: [
      { label: "Total revenue resort", value: rp(totalA), sub: kpiChange(totalA, totalB) },
      { label: "Revenue kamar", value: rp(roomOf(a)), sub: kpiChange(roomOf(a), roomOf(b)) },
      { label: "OCC", value: a.stay ? pct1(a.stay.occ) : "–", sub: a.stay ? `${a.stay.rooms} kamar terjual` : "Belum ada data" },
      { label: "Total pembelian", value: a.purchase === null ? "–" : rp(a.purchase), sub: kpiChange(a.purchase, b.purchase) },
    ],
    groups: [
      { title: "1. Revenue per outlet", source: "Laporan revenue VHP", rows: revenue },
      { title: "2. Kamar", source: "F/O Journal VHP", rows: rooms },
      { title: "3. Purchase", source: "Pembelian VHP", rows: purchase },
    ],
    details: [],
    highlights,
    limits: [
      "Revenue = laporan revenue VHP (kotor, termasuk service dan pajak), sama dengan dasbor. d'Bistro termasuk Banquet dan Room Service.",
      x.cut && x.lastDataDay ? `Data VHP baru sampai ${x.lastDataDay.slice(8, 10)}/${x.lastDataDay.slice(5, 7)}: kedua periode dipotong sampai hari yang sama.` : "",
      !a.stay || !b.stay ? "Kamar terjual, OCC, atau ARR tidak bisa dibaca untuk salah satu periode: dikosongkan, bukan nol." : "",
      a.purchase === null || b.purchase === null ? "Pembelian tidak bisa dibaca untuk salah satu periode: dikosongkan, bukan nol." : "",
    ].filter(Boolean),
  };
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${BULAN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const value = (v: number | null, f: ReportRow["fmt"]) => (v === null ? "–" : f === "rp" ? rp(v) : f === "pct" ? pct1(v) : v.toLocaleString("id-ID"));

/** "▲ Naik 11%", "▼ Turun 3,7 poin", coloured by whether that is good. */
function status(r: ReportRow): { text: string; tone: string } {
  if (r.prev === null || r.curr === null) return { text: "–", tone: "neutral" };
  if (r.points) {
    const d = (Math.round(r.curr * 10) - Math.round(r.prev * 10)) / 10;
    if (d === 0) return { text: "Tetap", tone: "neutral" };
    return { text: `${d > 0 ? "▲ Naik" : "▼ Turun"} ${Math.abs(d).toLocaleString("id-ID")} poin`, tone: !r.better ? "neutral" : (r.better === "up") === d > 0 ? "good" : "bad" };
  }
  if (r.prev === 0) return { text: r.curr === 0 ? "Tetap" : "Baru", tone: "neutral" };
  const d = Math.round(((r.curr - r.prev) / r.prev) * 100);
  if (d === 0) return { text: "Tetap", tone: "neutral" };
  return { text: `${d > 0 ? "▲ Naik" : "▼ Turun"} ${Math.abs(d)}%`, tone: !r.better ? "neutral" : (r.better === "up") === d > 0 ? "good" : "bad" };
}

const RESORT_CSS = `table.resort{width:100%;border-collapse:collapse;table-layout:fixed}table.resort th:nth-child(1){width:34%}table.resort th:nth-child(2),table.resort th:nth-child(3){width:23%}table.resort th,table.resort td{border:1px solid var(--line);padding:8px 10px}
table.resort td.desc span{display:block;color:var(--muted);font-size:11px}table.resort td.st{white-space:nowrap;font-weight:600}
table.resort td.st.good{color:var(--green)}table.resort td.st.bad{color:var(--red)}table.resort td.st.neutral{color:var(--muted)}
table.resort tr.total td{background:var(--lemon);color:var(--ink);font-weight:700}.period{color:var(--muted);margin:4px 0 0}`;

/**
 * Laporan Resort on paper (owner, 25 Nov 2026: "dibuat rapi, per outlet baru total revenuenya"): one table per part in
 * the owner's layout, Deskripsi | period B | period A | Status, outlets first and the resort's total revenue last.
 */
export function renderResort(r: WeeklyReport, preparedAt = new Date(), picker = ""): string {
  const labels = r.labels ?? { prev: "Periode lalu", curr: "Periode ini" };
  const notes: Record<string, string> = {
    "1. Revenue per outlet": "d'Bistro termasuk Banquet dan Room Service, sama seperti dasbor.",
    "2. Kamar": "Semua tamu digabung. OCC = kamar terjual dibagi 61 kamar. ARR = harga kamar + sarapan dan minuman paket, dibagi kamar terjual.",
  };
  const tables = r.groups
    .map((g) => {
      const body = g.rows
        .map((row) => {
          const st = status(row);
          const sub = [row.sub, g.title.startsWith("1.") ? row.note : ""].filter(Boolean).join(" · ");
          return `<tr${row.total ? ' class="total"' : ""}><td class="desc"><b>${esc(row.metric)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</td><td class="num">${esc(value(row.prev, row.fmt))}</td><td class="num">${esc(value(row.curr, row.fmt))}</td><td class="st ${st.tone}">${esc(st.text)}</td></tr>`;
        })
        .join("");
      const title = g.title.replace(/^\d+\.\s*/, "");
      return `<h2>${esc(title)}</h2><div class="detail-wrap"><table class="resort"><thead><tr><th>Deskripsi</th><th class="num">${esc(labels.prev)}<small>${esc(shortRange(r.previous))}</small></th><th class="num">${esc(labels.curr)}<small>${esc(shortRange(r.period))}</small></th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>${notes[g.title] ? `<p class="limits">${esc(notes[g.title])}</p>` : ""}`;
    })
    .join("");
  const made = preparedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const page = `<div class="page"><h1>${esc(r.title)}</h1><p class="period"><b>${esc(r.business)}</b> · ${esc(longDate(r.period.since))} – ${esc(longDate(r.period.until))}, dibanding ${esc(longDate(r.previous.since))} – ${esc(longDate(r.previous.until))}</p><hr style="margin-top:12px">
${tables}
${r.highlights.length ? `<h2>Kesimpulan</h2><ul class="facts">${r.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
<div class="limits"><b>Perlu diketahui</b><ul>${r.limits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
<footer>${esc(r.title)} · ${esc(r.business)} · disusun ${esc(made)} WIB dari data VHP</footer></div>`;
  const toolbar = picker ? `<div class="toolbar">${picker}<button type="button" onclick="window.print()">Cetak / simpan PDF</button></div>` : "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)}</title><link rel="icon" href="data:,"><style>${REPORT_CSS}${RESORT_CSS}</style></head><body>${toolbar}${page}</body></html>`;
}
