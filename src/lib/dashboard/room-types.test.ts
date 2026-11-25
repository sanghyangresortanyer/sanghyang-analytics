import { describe, expect, it } from "vitest";
import { mergeRoomTypes, revenueByRoomType } from "./room-types";

describe("mergeRoomTypes", () => {
  it("lists every known room with its saved type over the VHP default, ordered by number", () => {
    const rooms = mergeRoomTypes(["101", "131", "302", "307"], [{ room_no: "302", room_type: "KV", version: 2 }]);
    expect(rooms).toEqual([
      { room: "101", type: "SRD", version: 0 },
      { room: "131", type: "SS", version: 0 },
      { room: "302", type: "KV", version: 2 },
      { room: "307", type: "KV", version: 0 },
    ]);
  });

  it("keeps a room that has a saved type but no F/O Journal line yet", () => {
    expect(mergeRoomTypes([], [{ room_no: "999", room_type: "BC", version: 1 }])).toEqual([{ room: "999", type: "BC", version: 1 }]);
  });

  it("leaves an unknown room without a type instead of guessing", () => {
    expect(mergeRoomTypes(["998"], [])[0].type).toBeNull();
  });
});

describe("revenueByRoomType", () => {
  const rooms = mergeRoomTypes(["101", "131", "998"], []);
  const rows = [
    { room_no: "101", revenue: 730_000, room_nights: 2, lodging: 726_000 },
    { room_no: "131", revenue: 700_000, room_nights: 1, lodging: 500_000 },
    { room_no: "998", revenue: 400_000, room_nights: 1, lodging: 400_000 },
  ];

  it("adds revenue, nights and room count per type, unmapped rooms apart", () => {
    const t = revenueByRoomType(rows, rooms);
    expect(t.find((x) => x.code === "SRD")).toMatchObject({ revenue: 730_000, roomNights: 2, lodging: 726_000, rooms: 1, name: "Sanghyang Deluxe" });
    expect(t.find((x) => x.code === null)).toMatchObject({ name: "Belum diatur", revenue: 400_000, rooms: 1 });
  });

  it("keeps postings without a room number apart, so the total matches the segment total", () => {
    const t = revenueByRoomType([...rows, { room_no: "", revenue: 230_000, room_nights: 0, lodging: 0 }], rooms);
    expect(t.find((x) => x.name === "Tanpa nomor kamar")).toMatchObject({ revenue: 230_000, rooms: 0 });
    expect(t.reduce((s, x) => s + x.revenue, 0)).toBe(730_000 + 700_000 + 400_000 + 230_000);
  });

  it("orders by revenue and drops types without revenue", () => {
    const t = revenueByRoomType(rows, rooms);
    expect(t.map((x) => x.code)).toEqual(["SRD", "SS", null]);
  });
});
