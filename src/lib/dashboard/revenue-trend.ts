/** Pure helpers for the revenue charts (monthly trend, weeks, categories); tested on their own. */
import { revenueCategory, REVENUE_CATEGORIES, type RevenueCategory } from "./revenue-category";

export interface RevenueCharts {
  /** Revenue per month and outlet (outlets already merged the dashboard way). */
  months: { month: string; outlets: Record<string, number> }[];
  /** Revenue per day and outlet, from 1 January of the year of the selected period. */
  days: { date: string; outlets: Record<string, number> }[];
  /** Gross sales per outlet and category in the selected period, complimentary as its own category. */
  categories: { outlet: string; category: RevenueCategory; sales: number; qty: number }[];
  /** Last day with sales lines, so a month in progress is labelled "s.d. <day>". */
  lastDay: string | null;
}

const sum = (o: Record<string, number>, outlet: string | null) =>
  outlet ? (o[outlet] ?? 0) : Object.values(o).reduce((s, v) => s + v, 0);

export function monthlySeries(charts: RevenueCharts, outlet: string | null) {
  return charts.months.map((m) => ({ month: m.month, revenue: sum(m.outlets, outlet) }));
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week a date falls in (weeks run Monday–Sunday, as in the auditor's file). */
export function weekStart(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
}

/** Revenue per week with the change against the week before; the last week can be incomplete. */
export function weeklySeries(charts: RevenueCharts, outlet: string | null) {
  const weeks = new Map<string, number>();
  for (const d of charts.days) weeks.set(weekStart(d.date), (weeks.get(weekStart(d.date)) ?? 0) + sum(d.outlets, outlet));
  const ordered = [...weeks].sort(([a], [b]) => a.localeCompare(b));
  return ordered.map(([start, revenue], i) => {
    const end = addDays(start, 6);
    const prev = i > 0 ? ordered[i - 1][1] : null;
    return {
      start,
      end,
      revenue,
      complete: charts.lastDay !== null && end <= charts.lastDay,
      changePct: prev && prev !== 0 ? ((revenue - prev) / Math.abs(prev)) * 100 : null,
    };
  });
}

/** Category totals for one outlet (or all), in the fixed category order, empty ones left out. */
export function categorySeries(charts: RevenueCharts, outlet: string | null) {
  const by = new Map<RevenueCategory, { sales: number; qty: number }>();
  for (const c of charts.categories) {
    if (outlet && c.outlet !== outlet) continue;
    const cur = by.get(c.category) ?? { sales: 0, qty: 0 };
    by.set(c.category, { sales: cur.sales + c.sales, qty: cur.qty + c.qty });
  }
  return REVENUE_CATEGORIES.filter((c) => (by.get(c)?.sales ?? 0) !== 0).map((c) => ({ category: c, ...by.get(c)! }));
}

/** Rows from the database roll-ups, folded per merged outlet and grouped category. */
export function buildRevenueCharts(input: {
  months: { month: string; outlet_name: string; revenue: number }[];
  days: { sale_date: string; outlet_name: string; revenue: number }[];
  categories: { outlet_name: string; category: string; sales: number; qty: number }[];
  outletFor: (raw: string) => string;
}): RevenueCharts {
  const months = new Map<string, Record<string, number>>();
  for (const r of input.months) {
    const o = (months.get(r.month) ?? {}) as Record<string, number>;
    const name = input.outletFor(r.outlet_name);
    o[name] = (o[name] ?? 0) + r.revenue;
    months.set(r.month, o);
  }
  const days = new Map<string, Record<string, number>>();
  for (const r of input.days) {
    const o = (days.get(r.sale_date) ?? {}) as Record<string, number>;
    const name = input.outletFor(r.outlet_name);
    o[name] = (o[name] ?? 0) + r.revenue;
    days.set(r.sale_date, o);
  }
  const cats = new Map<string, RevenueCharts["categories"][number]>();
  for (const r of input.categories) {
    const outlet = input.outletFor(r.outlet_name);
    const category = revenueCategory(r.category);
    const k = `${outlet}|${category}`;
    const cur = cats.get(k) ?? { outlet, category, sales: 0, qty: 0 };
    cats.set(k, { ...cur, sales: cur.sales + r.sales, qty: cur.qty + r.qty });
  }
  const dayList = [...days].sort(([a], [b]) => a.localeCompare(b));
  return {
    months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, outlets]) => ({ month, outlets })),
    days: dayList.map(([date, outlets]) => ({ date, outlets })),
    categories: [...cats.values()],
    lastDay: dayList.at(-1)?.[0] ?? null,
  };
}
