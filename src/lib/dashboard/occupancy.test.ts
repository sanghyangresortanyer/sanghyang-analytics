import { describe, expect, it } from "vitest";
import { ACTIVE_ROOMS, type Night, occPct, occupancy, pairNights } from "./occupancy";

const n = (date: string, rooms: number, lodging = 0, pkg = 0): Night => ({ date, rooms, lodging, pkg });

describe("occupancy (as the hotel's WA group: rooms / 61, ARR cut down)", () => {
  it("has the 61 rooms of the hotel", () => {
    expect(ACTIVE_ROOMS).toBe(61);
    expect(occPct(54, 1)?.toFixed(1)).toBe("88.5");
  });

  it("adds nights up and divides by 61 rooms per night with data", () => {
    const o = occupancy([n("2026-11-01", 20, 9_000_000, 400_000), n("2026-11-02", 10, 4_000_000, 100_001)])!;
    expect(o).toMatchObject({ rooms: 30, nights: 2, arr: 450_000 }); // 13.500.001 / 30 = 450.000,03 -> cut
    expect(o.occ).toBeCloseTo((30 / 122) * 100, 6);
  });

  it("cuts ARR down instead of rounding up", () => {
    expect(occupancy([n("2026-11-01", 3, 2_000_000)])!.arr).toBe(666_666);
  });

  it("is null without data, and has no ARR when no room was sold", () => {
    expect(occupancy([])).toBeNull();
    expect(occupancy([n("2026-11-01", 0)])).toMatchObject({ rooms: 0, occ: 0, arr: null });
  });
});

describe("pairNights (1 Okt next to 1 Nov)", () => {
  const prev = { start: "2026-10-01", end: "2026-10-03" };
  const curr = { start: "2026-11-01", end: "2026-11-03" };
  it("puts the same position of both periods on one row", () => {
    const rows = pairNights([n("2026-11-01", 19), n("2026-11-03", 14)], [n("2026-10-01", 13), n("2026-10-02", 22), n("2026-10-03", 38)], curr, prev);
    expect(rows.map((r) => [r.prev?.date, r.prev?.rooms, r.curr?.date, r.curr?.rooms, r.diff])).toEqual([
      ["2026-10-01", 13, "2026-11-01", 19, 6],
      ["2026-10-02", 22, "2026-11-02", null, null],
      ["2026-10-03", 38, "2026-11-03", 14, -24],
    ]);
  });

  it("keeps the extra day of the longer period without a partner", () => {
    const rows = pairNights([], [n("2026-10-01", 5)], { start: "2026-11-01", end: "2026-11-02" }, { start: "2026-10-01", end: "2026-10-01" });
    expect(rows[1].prev).toBeNull();
    expect(rows[1].curr).toEqual({ date: "2026-11-02", rooms: null });
  });
});
