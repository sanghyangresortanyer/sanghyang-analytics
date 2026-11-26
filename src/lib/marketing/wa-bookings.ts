// CS's file "BOOKING BY WA" (owner, 25 Nov 2026): one row per booking closed on WhatsApp, with guest name, WhatsApp
// number, room, check-in and check-out. Only the row number, the dates and the rooms are read: names and phone
// numbers stay in the file. Pure: the xlsx reading and the database calls are in web.ts.
import type { Period } from "./weekly-report.ts";

export type WaBooking = { ord: number; no: number | null; checkIn: string; checkOut: string; rooms: string[] };
/** One booked night from RPC wa_booking_nights; lodging null = VHP has no room charge for that room that night. */
export type WaNight = { row_no: number | null; night: string; room: string; lodging: number | null; segment: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z]/g, "");

function toIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

/** "132", 132, "316-321" (a run of rooms), "101, 102" or "101 & 102". */
function toRooms(v: unknown): string[] {
  const text = String(v ?? "").trim();
  if (!text) return [];
  const out: string[] = [];
  for (const part of text.split(/[,&/]|\s+dan\s+/i).map((p) => p.trim()).filter(Boolean)) {
    const run = /^(\d{3})\s*-\s*(\d{3})$/.exec(part);
    if (run && Number(run[2]) >= Number(run[1]) && Number(run[2]) - Number(run[1]) < 20) {
      for (let r = Number(run[1]); r <= Number(run[2]); r++) out.push(String(r));
    } else if (/^\d{2,4}$/.test(part)) out.push(part);
    else return [];
  }
  return out;
}

/** Rows of the first sheet as values (strings, numbers, dates). The header row may be anywhere. */
export function parseWaBookings(rows: unknown[][]): { bookings: WaBooking[]; problems: string[] } {
  const at = rows.findIndex((r) => {
    const h = r.map(norm);
    return h.includes("NOKAMAR") && h.includes("CHECKIN") && h.includes("CHECKOUT");
  });
  if (at < 0) return { bookings: [], problems: ["File tidak punya kolom NO KAMAR, CHECK-IN, CHECK-OUT. Pakai file BOOKING BY WA dari CS."] };
  const head = rows[at].map(norm);
  const col = (name: string) => head.indexOf(name);
  const [cNo, cRoom, cIn, cOut] = [col("NO"), col("NOKAMAR"), col("CHECKIN"), col("CHECKOUT")];
  const bookings: WaBooking[] = [];
  const problems: string[] = [];
  rows.slice(at + 1).forEach((r, i) => {
    const used = [cNo, cRoom, cIn, cOut].filter((c) => c >= 0).map((c) => r[c]);
    if (used.every((v) => v === null || v === undefined || String(v).trim() === "")) return;
    const no = cNo >= 0 && /^\d+$/.test(String(r[cNo] ?? "").trim()) ? Number(r[cNo]) : null;
    const where = `Baris ${at + i + 2}${no === null ? "" : ` (no ${no})`}`;
    const checkIn = toIso(r[cIn]);
    const checkOut = toIso(r[cOut]);
    const rooms = toRooms(r[cRoom]);
    if (!checkIn) return void problems.push(`${where}: tanggal check-in tidak terbaca.`);
    if (!checkOut) return void problems.push(`${where}: tanggal check-out tidak terbaca.`);
    if (rooms.length === 0) return void problems.push(`${where}: nomor kamar ${String(r[cRoom] ?? "").trim() ? "tidak terbaca" : "kosong"}.`);
    if (checkOut < checkIn) return void problems.push(`${where}: check-out sebelum check-in.`);
    bookings.push({ ord: bookings.length + 1, no, checkIn, checkOut, rooms });
  });
  return { bookings, problems };
}

/** Closings in a period, counted on the check-in date (the file has no booking date). */
export const bookingsIn = (list: { checkIn: string }[], p: Period): number => list.filter((b) => b.checkIn >= p.since && b.checkIn <= p.until).length;

/** WA room nights and their room revenue in a period; nights after VHP's last day are left out. */
export function waNightsIn(nights: WaNight[], p: Period, lastVhpDay: string | null) {
  const inside = nights.filter((n) => n.night >= p.since && n.night <= p.until && lastVhpDay !== null && n.night <= lastVhpDay);
  const found = inside.filter((n) => n.lodging !== null && n.lodging > 0);
  const bySegment: Record<string, number> = {};
  for (const n of found) bySegment[n.segment || "(tidak diisi)"] = (bySegment[n.segment || "(tidak diisi)"] ?? 0) + 1;
  return {
    nights: found.length,
    revenue: found.reduce((t, n) => t + (n.lodging ?? 0), 0),
    bySegment,
    missing: inside.filter((n) => !(n.lodging && n.lodging > 0)).map((n) => `${n.row_no === null ? "tanpa no" : `no ${n.row_no}`}: kamar ${n.room} malam ${short(n.night)}`),
  };
}
