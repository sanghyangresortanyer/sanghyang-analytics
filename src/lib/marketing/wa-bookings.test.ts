import { describe, expect, it } from "vitest";
import { bookingsIn, parseWaBookings, waNightsIn } from "./wa-bookings.ts";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const HEAD = ["NO", "NAMA TAMU", "NO WA", "NO KAMAR", "CHECK-IN", "CHECK-OUT"];

describe("parseWaBookings (file BOOKING BY WA, owner 25 Nov 2026)", () => {
  it("keeps number, dates and rooms only, never the name or the phone number", () => {
    const r = parseWaBookings([HEAD, [1, "BUDI", "0812", 132, d("2026-11-01"), d("2026-11-02")], [2, "ANI", 812, "316-321", d("2026-11-14"), d("2026-11-15")]]);
    expect(r.problems).toEqual([]);
    expect(r.bookings).toEqual([
      { ord: 1, no: 1, checkIn: "2026-11-01", checkOut: "2026-11-02", rooms: ["132"] },
      { ord: 2, no: 2, checkIn: "2026-11-14", checkOut: "2026-11-15", rooms: ["316", "317", "318", "319", "320", "321"] },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/BUDI|ANI|0812/);
  });

  it("finds the header anywhere, skips empty rows and reads dd/mm/yyyy text and lists of rooms", () => {
    const r = parseWaBookings([[], ["BOOKING BY WA"], [" no ", "nama tamu", "no wa", "No Kamar", "Check In", "Check Out"], [null, null, null, null, null, null], [3, "X", "1", "101, 102", "05/11/2026", "07/11/2026"]]);
    expect(r.bookings).toEqual([{ ord: 1, no: 3, checkIn: "2026-11-05", checkOut: "2026-11-07", rooms: ["101", "102"] }]);
  });

  it("says which row cannot be read instead of guessing", () => {
    const r = parseWaBookings([HEAD, [1, "X", "1", 101, "kemarin", d("2026-11-02")], [2, "X", "1", null, d("2026-11-02"), d("2026-11-03")], [3, "X", "1", 101, d("2026-11-05"), d("2026-11-04")]]);
    expect(r.bookings).toEqual([]);
    expect(r.problems).toEqual(["Baris 2 (no 1): tanggal check-in tidak terbaca.", "Baris 3 (no 2): nomor kamar kosong.", "Baris 4 (no 3): check-out sebelum check-in."]);
  });

  it("refuses a file without the expected columns", () => {
    expect(parseWaBookings([["Nama", "Tanggal"], ["X", d("2026-11-01")]]).problems[0]).toMatch(/kolom NO KAMAR, CHECK-IN, CHECK-OUT/);
  });
});

describe("bookingsIn: closings counted on the check-in date", () => {
  const list = [
    { ord: 1, no: 1, checkIn: "2026-11-01", checkOut: "2026-11-02", rooms: ["131"] },
    { ord: 2, no: 2, checkIn: "2026-11-02", checkOut: "2026-11-03", rooms: ["119"] },
    { ord: 3, no: 3, checkIn: "2026-11-08", checkOut: "2026-11-09", rooms: ["101"] },
  ];
  it("counts the bookings whose check-in falls in the period", () => {
    expect(bookingsIn(list, { since: "2026-11-02", until: "2026-11-08" })).toBe(2);
    expect(bookingsIn([], { since: "2026-11-02", until: "2026-11-08" })).toBe(0);
  });
});

describe("waNightsIn: WA room nights next to VHP", () => {
  const n = (night: string, room: string, lodging: number | null, segment: string | null, row_no = 1) => ({ row_no, night, room, lodging, segment });
  it("adds room revenue per guest type and lists nights VHP has no room charge for", () => {
    const s = waNightsIn([n("2026-11-01", "131", 500_000, "FIT"), n("2026-11-02", "119", 363_000, "WALK IN", 2), n("2026-11-21", "535", null, null, 29), n("2026-11-26", "101", null, null, 30)], { since: "2026-11-01", until: "2026-11-30" }, "2026-11-24");
    expect(s).toEqual({ nights: 2, revenue: 863_000, bySegment: { FIT: 1, "WALK IN": 1 }, missing: ["no 29: kamar 535 malam 21 Nov"] });
  });
});
