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
