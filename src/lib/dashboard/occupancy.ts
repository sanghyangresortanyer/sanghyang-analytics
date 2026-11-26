// OCC and ARR exactly as the hotel reports them in its WA group (11 of 15 nights identical, Nov 2026):
// OCC = rooms sold / 61 rooms; ARR = (Lodging + breakfast and drink package) / rooms sold, cut down, not rounded.
import { ROOM_COUNT } from "./room-types.ts";

/** All rooms of the hotel. */
export const ACTIVE_ROOMS = ROOM_COUNT;

/** One night of the F/O Journal (RPC occupancy_by_night). */
export type Night = { date: string; rooms: number; lodging: number; pkg: number };
export type Occupancy = { rooms: number; nights: number; /** percent */ occ: number; /** null when no room was sold */ arr: number | null };
export type NightPair = {
  prev: { date: string; rooms: number | null } | null;
  curr: { date: string; rooms: number | null } | null;
  /** rooms now minus rooms then; null when one of the two has no data */
  diff: number | null;
};

export const occPct = (rooms: number, nights: number): number | null => (nights > 0 ? (rooms / (ACTIVE_ROOMS * nights)) * 100 : null);

/** Totals over the nights that have data; null without any. */
export function occupancy(nights: Night[]): Occupancy | null {
  if (nights.length === 0) return null;
  const rooms = nights.reduce((t, n) => t + n.rooms, 0);
  const revenue = nights.reduce((t, n) => t + n.lodging + n.pkg, 0);
  return { rooms, nights: nights.length, occ: occPct(rooms, nights.length)!, arr: rooms > 0 ? Math.floor(revenue / rooms) : null };
}

type Range = { start: string; end: string };
function dates(r: Range): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${r.start}T00:00:00Z`); t <= Date.parse(`${r.end}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Both periods side by side, first night next to first night (1 Okt next to 1 Nov). */
export function pairNights(curr: Night[], prev: Night[], currRange: Range, prevRange: Range): NightPair[] {
  const rooms = (list: Night[]) => new Map(list.map((n) => [n.date, n.rooms]));
  const a = rooms(curr);
  const b = rooms(prev);
  const ca = dates(currRange);
  const pb = dates(prevRange);
  return Array.from({ length: Math.max(ca.length, pb.length) }, (_, i) => {
    const c = ca[i] ? { date: ca[i], rooms: a.get(ca[i]) ?? null } : null;
    const p = pb[i] ? { date: pb[i], rooms: b.get(pb[i]) ?? null } : null;
    return { prev: p, curr: c, diff: c && p && c.rooms !== null && p.rooms !== null ? c.rooms - p.rooms : null };
  });
}

const DAY = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** Weeks looked back: the 4-week average missed by about 6 rooms a night on Sep–Nov 2026, the least of 3 to 8 weeks. */
const WEEKS = 4;

/** Rooms on the same weekday in the WEEKS weeks before `night`, using only nights up to `cutoff`. */
function sameWeekday(rooms: Map<string, number>, night: string, cutoff: string): number[] {
  const out: number[] = [];
  for (let k = 1; out.length < WEEKS && k <= WEEKS * 3; k++) {
    const d = shift(night, -7 * k);
    if (d <= cutoff && rooms.has(d)) out.push(rooms.get(d)!);
  }
  return out;
}

export type Forecast = { date: string; rooms: number; occ: number; weeks: number };

/**
 * Estimated rooms for the nights after the last night with data (owner, 25 Nov 2026: "itung dari kita dulu, nanti
 * kita cocokan"): the average of the same weekday in the last 4 weeks. It knows nothing of holidays or bookings.
 */
export function forecast(nights: Night[], days = 7): Forecast[] {
  if (nights.length === 0) return [];
  const rooms = new Map(nights.map((n) => [n.date, n.rooms]));
  const last = nights.reduce((m, n) => (n.date > m ? n.date : m), nights[0].date);
  const out: Forecast[] = [];
  for (let i = 1; i <= days; i++) {
    const date = shift(last, i);
    const seen = sameWeekday(rooms, date, last);
    if (seen.length === 0) continue;
    const r = Math.round(seen.reduce((t, x) => t + x, 0) / seen.length);
    out.push({ date, rooms: r, occ: occPct(r, 1)!, weeks: seen.length });
  }
  return out;
}

/** How many rooms the same method missed by on average, over the last `count` nights with data; null if too few. */
export function forecastMiss(nights: Night[], count = 28): { rooms: number; nights: number } | null {
  const rooms = new Map(nights.map((n) => [n.date, n.rooms]));
  const misses: number[] = [];
  for (const n of [...nights].sort((a, b) => b.date.localeCompare(a.date)).slice(0, count)) {
    const seen = sameWeekday(rooms, n.date, shift(n.date, -1));
    if (seen.length === WEEKS) misses.push(Math.abs(Math.round(seen.reduce((t, x) => t + x, 0) / seen.length) - n.rooms));
  }
  return misses.length < 7 ? null : { rooms: Math.round((misses.reduce((t, x) => t + x, 0) / misses.length) * 10) / 10, nights: misses.length };
}
