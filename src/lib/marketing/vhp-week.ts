// Laporan Senin, bagian "Hasil di hotel (VHP)": revenue kamar per segmen dari F/O Journal di samping biaya dan
// kontak Google Ads. Rancangan: docs/plans/specs/2026-11-19-laporan-senin.md. Angka hotel = laporan revenue VHP
// (kotor), sama dengan dasbor. Hubungan iklan → tamu hanya perkiraan: VHP tidak mencatat sumber tamu selain segmen.
import type { Occupancy } from "../dashboard/occupancy.ts";
import { addDays } from "./metrics.ts";
import type { DetailTable, Period, ReportGroup, ReportRow } from "./weekly-report.ts";

const NO_SEGMENT = "(tidak diisi)";

/** One Lodging posting (article 100) of the F/O Journal: a room occupied for one night. */
export type LodgingRow = { sale_date: string; room_no: string | null; segment: string | null; sales_amount?: number | string };
/** Room revenue of one segment (RPC room_revenue_by_segment); lodging = article 100 only. */
export type SegmentRow = { segment: string; revenue: number; roomNights: number; lodging?: number };
export type VhpWeek = {
  period: Period;
  segments: SegmentRow[];
  /** Last day with VHP data in the app; null when there is none. */
  lastDataDay: string | null;
  /** Rooms sold, OCC and ARR of AD_GUESTS in the period; null or absent when not read. */
  stay?: Occupancy | null;
};

/**
 * Hotel periods that compare like with like (owner, 24 Nov: no "tidak setara"): when VHP data stops inside
 * the report period, both periods are cut to the same number of days, e.g. 1–23 Nov vs 1–23 Okt becomes
 * 1–22 Nov vs 1–22 Okt while VHP has data up to 22 Nov.
 */
export function hotelPeriods(curr: Period, prev: Period, lastDataDay: string | null): { curr: Period; prev: Period; cut: boolean } {
  if (!lastDataDay || lastDataDay < curr.since || lastDataDay >= curr.until) return { curr, prev, cut: false };
  const n = Math.round((Date.parse(lastDataDay) - Date.parse(curr.since)) / 86_400_000);
  return { curr: { since: curr.since, until: lastDataDay }, prev: { since: prev.since, until: addDays(prev.since, n) }, cut: true };
}

/** Nights per segment: one room on one date, whatever the number of postings; a reversed night does not count. */
export function countRoomNights(rows: LodgingRow[], from: string, to: string): Record<string, number> {
  const net = new Map<string, { segment: string; amount: number }>();
  for (const r of rows) {
    if (r.sale_date < from || r.sale_date > to || !r.room_no) continue;
    const segment = r.segment?.trim() || NO_SEGMENT;
    const key = `${r.room_no}|${segment}|${r.sale_date}`;
    const night = net.get(key) ?? { segment, amount: 0 };
    night.amount += Number(r.sales_amount ?? 1);
    net.set(key, night);
  }
  const out: Record<string, number> = {};
  for (const n of net.values()) if (n.amount > 0) out[n.segment] = (out[n.segment] ?? 0) + 1;
  return out;
}

type SegmentFigures = { revenue: number; roomNights: number };
/** Room revenue = article 100 "Lodging (Room Revenue)" of VHP, without extra bed, no-show, gas and other fees. */
const room = (x: SegmentRow) => x.lodging ?? x.revenue;
/** Guest types (VHP codes) the ads report counts; companies and groups come through the sales team. */
export const AD_GUESTS = ["FIT", "WALK IN", "FIT-TA"];
const ONLY = "hanya WALK IN + FIT + OTA";
const add = (rows: SegmentRow[]): SegmentFigures => ({ revenue: rows.reduce((t, x) => t + room(x), 0), roomNights: rows.reduce((t, x) => t + x.roomNights, 0) });

export function summarizeVhpWeek(w: VhpWeek) {
  const of = (name: string) => add(w.segments.filter((x) => x.segment === name));
  return {
    fit: of("FIT"),
    walkIn: of("WALK IN"),
    fitTa: of("FIT-TA"),
    /** Companies, groups and stays without a guest type, so the parts add up to the room total. */
    other: add(w.segments.filter((x) => !AD_GUESTS.includes(x.segment))),
    roomRevenue: add(w.segments).revenue,
    /** FIT + WALK IN + OTA: the guests the ads can bring. Companies and groups come through the sales team (owner, 24 Nov). */
    guestRevenue: add(w.segments.filter((x) => AD_GUESTS.includes(x.segment))).revenue,
    roomNights: add(w.segments).roomNights,
    /** Front Office revenue that is not room revenue (extra bed, no show, cancellation, gas, late check-out …). */
    fees: w.segments.reduce((t, x) => t + (x.revenue - room(x)), 0),
    /** Some VHP data falls inside the period. */
    available: w.lastDataDay !== null && w.lastDataDay >= w.period.since,
    /** VHP data reaches the last day of the period. */
    complete: w.lastDataDay !== null && w.lastDataDay >= w.period.until,
  };
}

const days = (since: string, until: string) => Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1;
const scale = (f: SegmentFigures, by: number): SegmentFigures => ({ revenue: f.revenue / by, roomNights: f.roomNights / by });

/** Weekly average over a long range (1 January up to the report week), counting only days with data. */
export function averageWeek(range: VhpWeek) {
  const s = summarizeVhpWeek(range);
  const end = range.lastDataDay && range.lastDataDay < range.period.until ? range.lastDataDay : range.period.until;
  const weeks = s.available ? days(range.period.since, end) / 7 : 0;
  const by = weeks || 1;
  const perSegment = Object.fromEntries(range.segments.map((x) => [x.segment, room(x) / by]));
  return { weeks, fit: scale(s.fit, by), walkIn: scale(s.walkIn, by), fitTa: scale(s.fitTa, by), other: scale(s.other, by), roomRevenue: s.roomRevenue / by, guestRevenue: s.guestRevenue / by, roomNights: s.roomNights / by, perSegment };
}

export type AdsWeek = { cost: number };

const rp = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const num = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 1 });
const pct = (v: number) => `${v.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const tanggal = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The VHP group, the per-segment table and the caveats for one report week. */
export function vhpSection(curr: VhpWeek, prev: VhpWeek, avg: ReturnType<typeof averageWeek>, ads: { curr: AdsWeek; prev: AdsWeek }) {
  const a = summarizeVhpWeek(curr);
  const b = summarizeVhpWeek(prev);
  const on = (s: typeof a, v: number | null) => (s.available ? v : null);
  const about = (who: string, mean: number) => (avg.weeks > 0 ? `${who}. Rata-rata per minggu sejak Jan: ${rp(mean)}` : who);
  // A period VHP has not finished yet against a finished one would read as a drop that is not there.
  const partial = a.available && !a.complete;
  const pair = (x: number | null, y: number | null) => ({ curr: on(a, x), prev: partial ? null : on(b, y), ...(partial ? { empty: "tidak setara" } : {}) });
  const both = (f: (s: typeof a) => number) => pair(f(a), f(b));
  const stay = (f: (o: Occupancy) => number | null) => pair(curr.stay ? f(curr.stay) : null, prev.stay ? f(prev.stay) : null);

  // One table in the owner's layout (24 Nov): guest types, ARR, then the totals of those guests.
  const rows: ReportRow[] = [
    { better: "up", metric: "WALK IN", sub: "revenue kamar", ...both((x) => x.walkIn.revenue), fmt: "rp", note: about("Datang langsung ke hotel", avg.walkIn.revenue) },
    { better: "up", metric: "FIT", sub: "revenue kamar", ...both((x) => x.fit.revenue), fmt: "rp", note: about("Pesan langsung: WA, telepon, website", avg.fit.revenue) },
    { better: "up", metric: "OTA", sub: "revenue kamar", ...both((x) => x.fitTa.revenue), fmt: "rp", note: about("Pembanding, lewat OTA atau agen (FIT-TA di VHP)", avg.fitTa.revenue) },
    { better: "up", metric: "ARR", sub: ONLY, ...stay((o) => o.arr), fmt: "rp", note: "Harga rata-rata per kamar: harga kamar + sarapan dan minuman paket, dibagi kamar terjual" },
    { better: "up", metric: "Revenue kamar", sub: ONLY, ...both((x) => x.guestRevenue), fmt: "rp", note: "Perusahaan dan rombongan tidak termasuk", total: true },
    { better: "up", metric: "Total kamar terjual", sub: ONLY, ...stay((o) => o.rooms), fmt: "int", note: "Satu kamar terisi satu malam" },
    { better: "up", metric: "Total OCC", sub: ONLY, ...stay((o) => o.occ), fmt: "pct", points: true, note: "Kamar terjual dibagi 61 kamar. OCC semua tamu ada di Dasbor: Revenue, Front Office, Kamar" },
    { metric: "Biaya Google Ads", ...pair(ads.curr.cost, ads.prev.cost), fmt: "rp", note: "Pada tanggal yang sama dengan data hotel" },
  ];

  const sorted = [...curr.segments].sort((x, y) => room(y) - room(x));
  const share = (v: number) => (a.roomRevenue > 0 ? pct((v / a.roomRevenue) * 100) : "–");
  const perNight = (x: SegmentRow) => (x.roomNights > 0 ? rp(room(x) / x.roomNights) : "–");
  const detail: DetailTable = {
    title: "Revenue kamar per jenis tamu (periode ini)",
    head: ["Jenis tamu (kode VHP)", "Revenue kamar", "Porsi", "Malam kamar", "Harga rata-rata per malam", "Rata-rata per minggu sejak Jan"],
    rows: a.available
      ? [
          ...sorted.map((x) => [x.segment, rp(room(x)), share(room(x)), num(x.roomNights), perNight(x), avg.weeks > 0 ? rp(avg.perSegment[x.segment] ?? 0) : "–"]),
          ["Total kamar (semua tamu digabung)", rp(a.roomRevenue), a.roomRevenue > 0 ? "100%" : "–", num(a.roomNights), "", avg.weeks > 0 ? rp(avg.roomRevenue) : "–"],
        ]
      : [],
    note: "FIT = tamu pesan langsung (WA, telepon, website). FIT-TA = lewat OTA/agen. WALK IN = datang langsung ke hotel. FIT-CORP = perusahaan. GIT-CORP = rombongan perusahaan. Malam kamar = satu kamar terisi satu malam.",
  };

  const last = curr.lastDataDay ? tanggal(curr.lastDataDay) : "belum ada";
  const limits = [
    !a.available
      ? `Belum ada data hotel untuk periode ini (data VHP terakhir: ${last}). Angka hotel dikosongkan, bukan nol.`
      : !a.complete
        ? `Data VHP baru sampai ${last}; angka hotel periode ini belum lengkap.`
        : "",
    b.available && !b.complete ? "Data VHP periode pembanding belum lengkap." : "",
    a.available ? `Revenue kamar = "Lodging (Room Revenue)" di laporan Revenue VHP. Tidak ikut: extra bed, no show, pembatalan, gas, late check-out, dan biaya lain di Front Office (${rp(a.fees)} periode ini).` : "",
    "Hubungan iklan dan tamu hanya perkiraan: VHP tidak mencatat apakah tamu datang karena iklan.",
    "Tamu perusahaan dan rombongan tidak ikut di bagian Tamu hotel dan kesimpulan: mereka dibawa tim marketing, bukan oleh iklan. Semua tamu digabung hanya di tabel Revenue kamar per jenis tamu dan di Dasbor.",
  ].filter(Boolean);

  const group: ReportGroup = { title: "5. Tamu hotel", source: `Data VHP${curr.lastDataDay ? ` · s.d. ${last}` : ""}`, rows };
  // The deciding sentence (owner, 24 Nov: whether room revenue went up decides the comparison): total room
  // revenue first, then the guests the ads aim at, with OTA as the yardstick the ads do not move.
  const change = (x: number, y: number) => (y > 0 ? Math.round(((x - y) / y) * 100) : null);
  const word = (p: number | null) => (p === null ? "tanpa pembanding" : p === 0 ? "tetap" : `${p > 0 ? "naik" : "turun"} ${Math.abs(p)}%`);
  const jt = (v: number) => `Rp${(v / 1e6).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} jt`;
  const verdict =
    a.available && b.available && a.complete && b.complete
      ? `Revenue kamar FIT + WALK IN + OTA ${word(change(a.guestRevenue, b.guestRevenue))}: ${jt(b.guestRevenue)} → ${jt(a.guestRevenue)} (${tanggal(prev.period.since)}–${tanggal(prev.period.until)} dibanding ${tanggal(curr.period.since)}–${tanggal(curr.period.until)}). WALK IN ${word(change(a.walkIn.revenue, b.walkIn.revenue))}, FIT ${word(change(a.fit.revenue, b.fit.revenue))}, OTA sebagai pembanding ${word(change(a.fitTa.revenue, b.fitTa.revenue))}.`
      : null;
  return { group, detail, limits, verdict };
}
