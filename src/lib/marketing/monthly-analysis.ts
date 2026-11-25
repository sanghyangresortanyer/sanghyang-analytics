// Bulan-bulan laporan iklan vs hotel sejak 1 Januari 2026 (data VHP sebelum itu tidak dipakai) dan tulisan tanggalnya.
import { addDays } from "./metrics.ts";
import type { Period } from "./weekly-report.ts";

export type MonthSlot = { month: string; period: Period; partial: boolean; /** data VHP ada di bulan ini */ hotel: boolean };

const SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const monthLabel = (m: string) => `${SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthLongLabel = (m: string) => `${LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** "1–30 Sep 2026" */
export const rangeLabel = (p: Period) => `${Number(p.since.slice(8))}–${Number(p.until.slice(8))} ${monthLabel(p.since.slice(0, 7))}`;
/** "1 Jan – 17 Nov 2026" */
export const spanLabel = (since: string, until: string) =>
  `${Number(since.slice(8))} ${SHORT[Number(since.slice(5, 7)) - 1]}${since.slice(0, 4) === until.slice(0, 4) ? "" : ` ${since.slice(0, 4)}`} – ${Number(until.slice(8))} ${SHORT[Number(until.slice(5, 7)) - 1]} ${until.slice(0, 4)}`;

const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
const monthEnd = (m: string) => addDays(`${nextMonth(m)}-01`, -1);

/**
 * Months from `start` (YYYY-MM) up to yesterday. The month in progress ends yesterday; when VHP data
 * stops earlier inside a month, that month is cut at the last VHP day so ads and hotel cover the same
 * days. A month entirely after the VHP data keeps its ads and has no hotel side.
 */
export function monthPeriods(start: string, today: string, lastDataDay: string | null): MonthSlot[] {
  const yesterday = addDays(today, -1);
  const out: MonthSlot[] = [];
  for (let m = start; `${m}-01` <= yesterday; m = nextMonth(m)) {
    const since = `${m}-01`;
    const end = monthEnd(m);
    let until = end < yesterday ? end : yesterday;
    const hotel = lastDataDay !== null && lastDataDay >= since;
    if (hotel && lastDataDay < until) until = lastDataDay;
    out.push({ month: m, period: { since, until }, partial: until < end, hotel });
  }
  return out;
}
