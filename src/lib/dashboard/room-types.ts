/** Room types of Sanghyang, codes as in VHP (confirmed by the owner 2026-11-19). */
export const ROOM_TYPES = [
  { code: "SRD", name: "Sanghyang Deluxe" },
  { code: "SS", name: "Sanghyang Suite" },
  { code: "KS", name: "Krakatau Suite" },
  { code: "KV", name: "Krakatau Villa" },
  { code: "KVB", name: "Krakatau Beach View" },
  { code: "BC", name: "Baduy Condo" },
  { code: "BS", name: "Baduy Suite" },
] as const;
export type RoomTypeCode = (typeof ROOM_TYPES)[number]["code"];

const rooms = (type: RoomTypeCode, list: string) => list.split(" ").map((r) => [r, type] as const);

/**
 * All 61 rooms, read from VHP Room Revenue Breakdown screenshots of 1–4 Mar, 16 Aug and 1, 6, 7, 14 Nov
 * 2026 (RmType column); used until Pengaturan saves a type.
 */
const KNOWN: Record<string, RoomTypeCode> = Object.fromEntries([
  ...rooms("SRD", "101 102 103 105 106 115 116 117 118 119 207 208 209 210 211 212 220 221 222 223 225 226"),
  ...rooms("SS", "131 132"),
  ...rooms("KS", "301 302 303"),
  ...rooms("KV", "305 306 307 308 309 310"),
  ...rooms("KVB", "311 312 315 316 317 318 319 320 321 322 323"),
  ...rooms("BC", "529 530 531 532 533 535 536 537 538 539 540 541"),
  ...rooms("BS", "502 503 505 506 507"),
]);

/** Rooms the hotel sells (OCC is out of this number). */
export const ROOM_COUNT = Object.keys(KNOWN).length;

export type RoomSetting = { room: string; type: RoomTypeCode | null; version: number };

const byNumber = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** Every room seen in the F/O Journal plus every saved one, with its type: saved, else the 1 Nov default, else none. */
export function mergeRoomTypes(rooms: string[], saved: { room_no: string; room_type: string; version: number }[]): RoomSetting[] {
  const rows = new Map(saved.map((s) => [s.room_no, s]));
  const all = [...new Set([...rooms, ...saved.map((s) => s.room_no)])].sort(byNumber);
  return all.map((room) => {
    const s = rows.get(room);
    return s ? { room, type: s.room_type as RoomTypeCode, version: s.version } : { room, type: KNOWN[room] ?? null, version: 0 };
  });
}

export type RoomTypeRevenue = { code: RoomTypeCode | null; name: string; revenue: number; roomNights: number; lodging: number; rooms: number };

/**
 * Room revenue per room type; rooms without a type are kept together as "Belum diatur", and Front
 * Office postings without a room number (room_no "") as "Tanpa nomor kamar", so the total equals
 * the room revenue per segment.
 */
export function revenueByRoomType(rows: { room_no: string; revenue: number; room_nights: number; lodging: number }[], rooms: RoomSetting[]): RoomTypeRevenue[] {
  const typeOf = new Map(rooms.map((r) => [r.room, r.type]));
  const out = new Map<string, RoomTypeRevenue & { roomSet: Set<string> }>();
  for (const r of rows) {
    const noRoom = r.room_no.trim() === "";
    const code = noRoom ? null : (typeOf.get(r.room_no) ?? null);
    const key = noRoom ? "-" : (code ?? "");
    const name = noRoom ? "Tanpa nomor kamar" : (ROOM_TYPES.find((t) => t.code === code)?.name ?? "Belum diatur");
    const o = out.get(key) ?? { code, name, revenue: 0, roomNights: 0, lodging: 0, rooms: 0, roomSet: new Set<string>() };
    o.revenue += r.revenue;
    o.roomNights += r.room_nights;
    o.lodging += r.lodging;
    if (!noRoom) o.roomSet.add(r.room_no);
    out.set(key, o);
  }
  return [...out.values()]
    .map(({ roomSet, ...o }) => ({ ...o, rooms: roomSet.size }))
    .filter((o) => o.revenue !== 0 || o.roomNights > 0)
    .sort((a, b) => b.revenue - a.revenue);
}
