/** Points of the main dashboard chart (look A, owner 24 Nov 2026): per day, or per week for long periods. Pure, tested on its own. */
import { type RevenueCharts, weekStart } from "./revenue-trend";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
/** Longer periods are drawn per week: more bars than this cannot be read. */
const MAX_DAYS = 62;
/** A change smaller than this (in %) is shown as "sama". */
const FLAT_PCT = 0.05;

export interface ChartPoint {
  start: string;
  end: string;
  /** "Sabtu 14 Nov" or "9–15 Nov". */
  label: string;
  /** "14 Nov" / "9–15 Nov", for the axis. */
  short: string;
  /** null = no data for (part of) this point. */
  value: number | null;
  changePct: number | null;
  /** What the change is measured against. */
  against: string | null;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
export const dayName = (iso: string) => `${DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${dayMonth(iso)}`;
const spanName = (a: string, b: string) => (a === b ? dayMonth(a) : a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8, 10))}–${dayMonth(b)}` : `${dayMonth(a)}–${dayMonth(b)}`);
const monthEnd = (iso: string) => addDays(`${addDays(`${iso.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
const pct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

/**
 * One point per day (a day against the same weekday a week earlier: weekends and weekdays differ for a
 * hotel), or per Monday–Sunday week cut at the period for more than 62 days. A month in progress runs
 * to its last day, so the days still to come are visible as empty.
 */
export function chartPoints(charts: RevenueCharts, start: string, end: string, outlet: string | null): { unit: "hari" | "minggu"; points: ChartPoint[]; lastIndex: number } {
  const byDay = new Map(charts.days.map((d) => [d.date, outlet ? (d.outlets[outlet] ?? 0) : Object.values(d.outlets).reduce((s, v) => s + v, 0)]));
  const length = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  const points: ChartPoint[] = [];
  let unit: "hari" | "minggu" = "hari";
  if (length <= MAX_DAYS) {
    const running = start.endsWith("-01") && start.slice(0, 7) === end.slice(0, 7) && (charts.lastDay === null || end >= charts.lastDay);
    const last = running ? monthEnd(end) : end;
    for (let d = start; d <= last; d = addDays(d, 1)) {
      const value = d <= end ? (byDay.get(d) ?? null) : null;
      const before = byDay.get(addDays(d, -7));
      const changePct = value === null || before === undefined ? null : pct(value, before);
      points.push({ start: d, end: d, label: dayName(d), short: dayMonth(d), value, changePct, against: changePct === null ? null : dayName(addDays(d, -7)) });
    }
  } else {
    unit = "minggu";
    let prev: { value: number; full: boolean; label: string } | null = null;
    for (let from = start; from <= end; ) {
      const sunday = addDays(weekStart(from), 6);
      const to = sunday < end ? sunday : end;
      let value = 0;
      let found = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const dayValue = byDay.get(d);
        if (dayValue !== undefined) {
          value += dayValue;
          found += 1;
        }
      }
      const full = found === 7;
      const label = spanName(from, to);
      const changePct: number | null = full && prev?.full ? pct(value, prev.value) : null;
      points.push({ start: from, end: to, label, short: label, value: found ? value : null, changePct, against: changePct === null ? null : prev!.label });
      prev = { value, full, label };
      from = addDays(to, 1);
    }
  }
  return { unit, points, lastIndex: points.findLastIndex((p) => p.value !== null) };
}

export type Direction = "naik" | "turun" | "sama" | "tanpa";
/** "Nov" */
export const monthName = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
export const direction = (changePct: number | null): Direction => (changePct === null ? "tanpa" : changePct >= FLAT_PCT ? "naik" : changePct <= -FLAT_PCT ? "turun" : "sama");

/** Rupiah per dot, at a round amount, so the highest column has at most 26 dots. */
export function dotStep(max: number): number {
  for (let unit = 100_000; ; unit *= 10) for (const k of [1, 2, 5]) if (max / (unit * k) <= 26) return unit * k;
}

/** Two to four round amounts up to the highest value. */
export function gridLines(max: number): number[] {
  if (max <= 0) return [];
  for (let unit = 1_000; ; unit *= 10)
    for (const k of [1, 2, 4, 5]) {
      const step = unit * k;
      const n = Math.floor(max / step);
      if (n <= 4) return Array.from({ length: n }, (_, i) => step * (i + 1));
    }
}

/**
 * Every outlet that went down against the comparison period, the largest rupiah loss first (owner, 24 Nov:
 * "kenapa yang ditulis hanya DBC?"). A change smaller than "sama" (FLAT_PCT) is not a drop.
 */
export function outletDrops(outlets: { name: string; revenue: number }[], previous: Record<string, number> | null | undefined) {
  if (!previous) return [];
  return outlets
    .map((o) => ({ name: o.name, from: previous[o.name] ?? 0, to: o.revenue, pct: pct(o.revenue, previous[o.name] ?? 0) }))
    .filter((d): d is typeof d & { pct: number } => d.pct !== null && direction(d.pct) === "turun")
    .sort((a, b) => a.to - a.from - (b.to - b.from));
}
