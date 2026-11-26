import { describe, expect, it } from "vitest";
import { ACTIVE_ROOMS, forecast, forecastMiss, type Night, occPct, occupancy, pairNights } from "./occupancy";

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

describe("forecast (owner, 25 Nov: count it ourselves, compare later)", () => {
  // Four weeks: Saturdays 40, 30, 50, 40; every other night 10, 12, 8, 10.
  const weeks = Array.from({ length: 28 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10);
    const w = Math.floor(i / 7);
    const sat = new Date(`${date}T00:00:00Z`).getUTCDay() === 6;
    return n(date, sat ? [40, 30, 50, 40][w] : [10, 12, 8, 10][w]);
  });

  it("is the average of the same weekday in the last 4 weeks with data, from the night after the last data", () => {
    const f = forecast(weeks, 7);
    expect(f[0]).toEqual({ date: "2026-11-23", rooms: 10, occ: (10 / 61) * 100, weeks: 4 });
    expect(f.find((x) => x.date === "2026-11-28")).toMatchObject({ rooms: 40, weeks: 4 });
    expect(f).toHaveLength(7);
  });

  it("uses fewer weeks when there are fewer, and nothing without data", () => {
    expect(forecast(weeks.slice(21), 1)[0]).toMatchObject({ rooms: 10, weeks: 1 });
    expect(forecast([], 7)).toEqual([]);
  });

  it("says how far off the same method was on the last nights with data", () => {
    const steady = Array.from({ length: 56 }, (_, i) => n(new Date(Date.UTC(2026, 8, 28 + i)).toISOString().slice(0, 10), 20));
    expect(forecastMiss(steady)).toEqual({ rooms: 0, nights: 28 });
    expect(forecastMiss(weeks.slice(0, 7))).toBeNull();
  });
});
