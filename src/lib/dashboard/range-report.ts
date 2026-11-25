/**
 * Builds the dashboard figures for any date range from what was uploaded.
 *
 * Revenue has two sources with different strengths:
 * - F/O Turnover: the official per-department total, but only for the report's own period.
 *   One-day exports add up to any range; two reports with the same start give the days between them.
 * - Rest. Transaction Journal (Penjualan per Artikel): one line per sale with its date, for
 *   F&B/Spa outlets only.
 * - F/O Journal Transaction: dated Front Office revenue and the room-package shares Front Office
 *   books to outlets (breakfast, welcome drink). With Penjualan per Artikel it equals F/O per day.
 * An exact F/O figure is used when the range allows it; otherwise the journal, with the
 * outlets it cannot cover listed instead of shown as zero.
 */

/** Stored as the filename of an optional upload slot that was left empty. */
export const NO_FILE = "(Belum diunggah)";

export interface FoSnapshot {
  meetingId: string;
  periodStart: string;
  periodEnd: string;
  outlets: { outlet_name: string; revenue_amount: number }[];
  items: { outlet_name: string; art_no: string | null; description: string; total_qty: number; total_amount: number }[];
}

export interface SalesLine {
  sale_date: string;
  outlet_name: string;
  art_no: string | null;
  description: string;
  qty: number;
  sales_amount: number;
  /** Complimentary payments on the line (coupon, entertain, officer check); not outlet revenue in F/O. */
  coupon_amount: number;
  /** "pos": Penjualan per Artikel (default); "fo": F/O Journal posting, revenue but not a menu sale. */
  source?: "pos" | "fo";
}

export interface PurchaseLine {
  receive_date: string;
  supplier_name: string;
  art_no: string | null;
  description: string;
  unit: string | null;
  qty: number;
  amount: number;
}

export interface DateSpan {
  start: string;
  end: string;
}

export type RevenueSource = "fo" | "journal" | "none";

export interface RangeReport {
  revenue: {
    source: RevenueSource;
    /** Reports the F/O figure came from: added up, or a later one minus an earlier one. */
    foMeetingIds: string[];
    outlets: { outlet_name: string; revenue: number | null; qty: number; source: Exclude<RevenueSource, "none"> | null }[];
    total: number;
    /** Outlets that exist in F/O but have no figure for this range. */
    missingOutlets: string[];
    notes: string[];
  };
  /** Sold items per outlet: menu lines from the journal, else F/O articles. */
  items: { outlet_name: string; art_no: string | null; description: string; total_qty: number; total_amount: number; source: "journal" | "fo" }[];
  purchase: {
    total: number;
    covered: boolean;
    suppliers: { supplier_name: string; purchase_amount: number; line_count: number }[];
    items: { ingredient_code: string; description: string; unit: string; total_qty: number; total_amount: number }[];
    notes: string[];
  };
}

export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** VHP prints journal departments cut to 12 characters; the F/O report has the full name. */
export function resolveJournalOutlet(raw: string, foNames: string[]): string {
  const key = raw.trim().toLowerCase();
  return foNames.find((n) => n.toLowerCase() === key) ?? foNames.find((n) => n.toLowerCase().startsWith(key)) ?? raw.trim();
}

/** First day in [start, end] that no span covers, or null when fully covered. */
function firstGap(start: string, end: string, spans: DateSpan[]): string | null {
  let day = start;
  const sorted = [...spans].sort((a, b) => a.start.localeCompare(b.start));
  for (const s of sorted) {
    if (s.start > day) break;
    if (s.end >= day) day = dayAfter(s.end);
    if (day > end) return null;
  }
  return day <= end ? day : null;
}

/** One step of an exact F/O figure: a report added, or an earlier report of the same start taken off. */
type FoPart = { snapshot: FoSnapshot; sign: 1 | -1 };

/**
 * F/O figure for exactly [start, end], as back-to-back pieces that together cover every day once.
 * A piece is one report whose period starts on that day (a one-day export, or any period), or
 * a later report minus an earlier one with the same start that ends the day before. The fewest
 * pieces win, so a single matching report is used as it is. Null when some day has no piece.
 */
function exactFo(start: string, end: string, snapshots: FoSnapshot[]): FoPart[] | null {
  const fits = snapshots.filter((s) => s.periodEnd <= end);
  const reached = new Map<string, FoPart[]>([[start, []]]);
  const queue = [start];
  const goal = dayAfter(end);
  while (queue.length) {
    const day = queue.shift()!;
    const path = reached.get(day)!;
    if (day === goal) return path;
    const steps: FoPart[][] = [];
    for (const s of fits) {
      if (s.periodStart === day) steps.push([{ snapshot: s, sign: 1 }]);
      if (s.periodStart < day && s.periodEnd >= day) {
        const earlier = fits.find((e) => e.periodStart === s.periodStart && e.periodEnd === dayBefore(day));
        if (earlier) steps.push([{ snapshot: s, sign: 1 }, { snapshot: earlier, sign: -1 }]);
      }
    }
    for (const step of steps) {
      const next = dayAfter(step[0].snapshot.periodEnd);
      if (reached.has(next)) continue;
      reached.set(next, [...path, ...step]);
      queue.push(next);
    }
  }
  return null;
}

/** Adds up the rows of every piece (minus for a subtracted report), keyed per outlet or article. */
function combine<T>(parts: FoPart[], rows: (s: FoSnapshot) => T[], key: (t: T) => string, value: (t: T) => number) {
  const out = new Map<string, { row: T; value: number }>();
  for (const { snapshot, sign } of parts) {
    for (const r of rows(snapshot)) {
      const cur = out.get(key(r));
      out.set(key(r), { row: cur?.row ?? r, value: (cur?.value ?? 0) + sign * value(r) });
    }
  }
  return [...out.values()];
}

export function buildRangeReport(input: {
  start: string;
  end: string;
  snapshots: FoSnapshot[];
  /** F/O department names from every report of the property, to name journal and missing outlets. */
  knownOutlets?: string[];
  salesLines: SalesLine[];
  salesCoverage: DateSpan[];
  /** Days the F/O Journal was uploaded for. */
  foJournalCoverage?: DateSpan[];
  purchaseLines: PurchaseLine[];
  purchaseCoverage: DateSpan[];
}): RangeReport {
  const { start, end, snapshots } = input;
  const inRange = (d: string) => d >= start && d <= end;
  const foNames = [...new Set([...snapshots.flatMap((s) => s.outlets.map((o) => o.outlet_name)), ...(input.knownOutlets ?? [])])];

  // Journal lines of the range, keyed by the F/O department name.
  const journal = input.salesLines
    .filter((l) => inRange(l.sale_date))
    .map((l) => ({ ...l, outlet_name: resolveJournalOutlet(l.outlet_name, foNames) }));
  const journalOutlets = new Map<string, { revenue: number; qty: number }>();
  const journalItems = new Map<string, RangeReport["items"][number]>();
  // Weighed dishes (fish, crab) are billed as "(Ons) <dish>" x whole ons plus "(0.1 Ons) <dish>"
  // x tenths, whose article number is the dish's + 1. The tenths line is part of the same order.
  const PER_ONS = /^\(ons\)\s*/i;
  const TENTHS = /^\(0[.,]1\s*ons\)/i;
  const perOns = new Map<string, string>();
  for (const l of journal) if (l.art_no && PER_ONS.test(l.description)) perOns.set(`${l.outlet_name}|${l.art_no}`, l.description);
  const posOutlets = new Set(journal.filter((l) => l.source !== "fo").map((l) => l.outlet_name));
  for (const l of journal) {
    const o = journalOutlets.get(l.outlet_name) ?? { revenue: 0, qty: 0 };
    o.revenue += l.sales_amount - l.coupon_amount;
    if (l.source === "fo") {
      journalOutlets.set(l.outlet_name, o);
      // Room-package postings are no menu sale; an outlet with no cashier lines (Front Office)
      // lists its F/O articles instead, as with Turnover.
      if (posOutlets.has(l.outlet_name)) continue;
      const k = `${l.outlet_name}|${l.art_no}|${l.description}`;
      const it = journalItems.get(k) ?? { outlet_name: l.outlet_name, art_no: l.art_no, description: l.description, total_qty: 0, total_amount: 0, source: "fo" as const };
      it.total_qty += l.qty;
      it.total_amount += l.sales_amount;
      journalItems.set(k, it);
      continue;
    }
    if (l.sales_amount > 0) o.qty += l.qty;
    journalOutlets.set(l.outlet_name, o);
    // Menu lines only: table transfers ("From Table 13") carry no article number and net to zero
    // against their "To Table" pair; discounts are negative. Both stay in the outlet revenue above.
    if (l.sales_amount <= 0 || !l.art_no) continue;
    const parentArt = TENTHS.test(l.description) ? String(Number(l.art_no) - 1) : null;
    const parent = parentArt ? perOns.get(`${l.outlet_name}|${parentArt}`) : undefined;
    const artNo = parent ? parentArt! : l.art_no;
    const raw = parent ?? l.description;
    const weighed = PER_ONS.test(raw);
    const description = weighed ? `${raw.replace(PER_ONS, "")} (per ons)` : raw;
    const k = `${l.outlet_name}|${artNo}|${description}`;
    const it = journalItems.get(k) ?? { outlet_name: l.outlet_name, art_no: artNo, description, total_qty: 0, total_amount: 0, source: "journal" as const };
    // A weighed dish counts orders (one "(Ons)" line each); its qty is ons, not portions.
    it.total_qty += weighed ? (parent ? 0 : 1) : l.qty;
    it.total_amount += l.sales_amount;
    journalItems.set(k, it);
  }

  const notes: string[] = [];
  const fo = exactFo(start, end, snapshots);
  let revenue: RangeReport["revenue"];
  let items: RangeReport["items"] = [...journalItems.values()];

  if (fo) {
    const outlets = combine(fo, (s) => s.outlets, (o) => o.outlet_name, (o) => o.revenue_amount).map(({ row, value }) => ({
      outlet_name: row.outlet_name,
      revenue: value,
      qty: journalOutlets.get(row.outlet_name)?.qty ?? 0,
      source: "fo" as const,
    }));
    revenue = {
      source: "fo",
      foMeetingIds: fo.map((p) => p.snapshot.meetingId),
      outlets,
      total: outlets.reduce((s, o) => s + (o.revenue ?? 0), 0),
      missingOutlets: [],
      notes,
    };
    const added = fo.filter((p) => p.sign === 1).length;
    if (fo.some((p) => p.sign === -1)) notes.push(`Revenue ${fmt(start)}–${fmt(end)} dihitung dari selisih laporan revenue VHP.`);
    else if (added > 1) notes.push(`Revenue ${fmt(start)}–${fmt(end)} = jumlah ${added} laporan revenue VHP.`);
    // Outlets without journal lines (Front Office) keep their F/O revenue articles as "items".
    const foItems = combine(fo, (s) => s.items, (i) => `${i.outlet_name}|${i.art_no}|${i.description}`, (i) => i.total_amount);
    for (const { row, value } of foItems) {
      if (journalOutlets.has(row.outlet_name) || value === 0) continue;
      items.push({ outlet_name: row.outlet_name, art_no: row.art_no, description: row.description, total_qty: row.total_qty, total_amount: value, source: "fo" });
    }
  } else if (journalOutlets.size > 0) {
    const outlets: RangeReport["revenue"]["outlets"] = [...journalOutlets].map(([outlet_name, v]) => ({ outlet_name, revenue: v.revenue, qty: v.qty, source: "journal" }));
    // With both journals covering every day, an outlet without lines sold nothing (0); otherwise
    // its figure is unknown and listed as missing.
    const foGap = firstGap(start, end, input.foJournalCoverage ?? []);
    const complete = !foGap && !firstGap(start, end, input.salesCoverage);
    const missing = complete ? [] : foNames.filter((n) => !journalOutlets.has(n));
    for (const n of foNames.filter((x) => !journalOutlets.has(x)))
      outlets.push(complete ? { outlet_name: n, revenue: 0, qty: 0, source: "journal" } : { outlet_name: n, revenue: null, qty: 0, source: null });
    revenue = {
      source: "journal",
      foMeetingIds: [],
      outlets,
      total: outlets.reduce((s, o) => s + (o.revenue ?? 0), 0),
      missingOutlets: missing,
      notes,
    };
    // Penjualan per Artikel lacks the room-package breakfast (d'Bistro) and welcome drink
    // (Sunset Grill) that Front Office posts to the room bill; the F/O Journal has them, and the
    // two together match Turnover to the rupiah (every day of 1-17 Nov 2026).
    if (foGap) notes.push("Sarapan dan welcome drink paket kamar (d'Bistro, Sunset Grill) dan revenue Front Office ada di laporan F/O Journal, yang belum diunggah untuk seluruh rentang ini.");
    if (missing.length) notes.push(`Belum termasuk ${missing.join(", ")}: butuh laporan revenue atau F/O Journal untuk ${fmt(start)}–${fmt(end)}.`);
  } else {
    revenue = { source: "none", foMeetingIds: [], outlets: [], total: 0, missingOutlets: foNames, notes };
    if (snapshots.length > 0 || input.salesCoverage.length > 0) notes.push(`Tidak ada revenue F/O maupun Journal untuk ${fmt(start)}–${fmt(end)}.`);
  }

  if (revenue.source === "journal") {
    const gap = firstGap(start, end, input.salesCoverage);
    if (gap) notes.push(`Penjualan per Artikel belum mencakup tanggal ${fmt(gap)} dst. dalam rentang ini.`);
  }
  revenue.outlets.sort((a, b) => (b.revenue ?? -1) - (a.revenue ?? -1));
  items = items.sort((a, b) => b.total_amount - a.total_amount);

  // Purchases: receiving lines are dated, so any range is exact where uploads cover it.
  const lines = input.purchaseLines.filter((l) => inRange(l.receive_date));
  const sup = new Map<string, { purchase_amount: number; line_count: number }>();
  const pItems = new Map<string, RangeReport["purchase"]["items"][number]>();
  for (const l of lines) {
    const s = sup.get(l.supplier_name) ?? { purchase_amount: 0, line_count: 0 };
    s.purchase_amount += l.amount;
    s.line_count++;
    sup.set(l.supplier_name, s);
    const k = `${l.art_no}|${l.unit}`;
    const it = pItems.get(k) ?? { ingredient_code: l.art_no ?? "", description: l.description, unit: l.unit ?? "", total_qty: 0, total_amount: 0 };
    it.total_qty += l.qty;
    it.total_amount += l.amount;
    pItems.set(k, it);
  }
  const pGap = firstGap(start, end, input.purchaseCoverage);
  const purchaseNotes = pGap && input.purchaseCoverage.length > 0 ? [`Pembelian VHP belum diunggah untuk tanggal ${fmt(pGap)} dst.`] : [];

  return {
    revenue,
    items,
    purchase: {
      total: lines.reduce((s, l) => s + l.amount, 0),
      covered: input.purchaseCoverage.length > 0 && !pGap,
      suppliers: [...sup].map(([supplier_name, v]) => ({ supplier_name, ...v })).sort((a, b) => b.purchase_amount - a.purchase_amount),
      items: [...pItems.values()].sort((a, b) => b.total_amount - a.total_amount),
      notes: purchaseNotes,
    },
  };
}
