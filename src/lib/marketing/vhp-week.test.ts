import { describe, expect, it } from "vitest";
import { averageWeek, countRoomNights, hotelPeriods, summarizeVhpWeek, vhpSection, type VhpWeek } from "./vhp-week.ts";

describe("hotelPeriods", () => {
  const nov = { since: "2026-11-01", until: "2026-11-23" };
  const okt = { since: "2026-10-01", until: "2026-10-23" };
  it("cuts both periods to the days VHP already has", () => {
    expect(hotelPeriods(nov, okt, "2026-11-22")).toEqual({ curr: { since: "2026-11-01", until: "2026-11-22" }, prev: { since: "2026-10-01", until: "2026-10-22" }, cut: true });
    expect(hotelPeriods({ since: "2026-11-16", until: "2026-11-22" }, { since: "2026-11-09", until: "2026-11-15" }, "2026-11-18").prev).toEqual({ since: "2026-11-09", until: "2026-11-11" });
  });
  it("leaves complete periods, and periods without any VHP day, as they are", () => {
    expect(hotelPeriods(nov, okt, "2026-11-23").cut).toBe(false);
    expect(hotelPeriods(nov, okt, "2026-10-31").cut).toBe(false);
    expect(hotelPeriods(nov, okt, null).cut).toBe(false);
  });
});

describe("countRoomNights (24 Nov: one room, one night, not one posting)", () => {
  const n = (sale_date: string, room_no: string | null, segment: string, sales_amount: number) => ({ sale_date, room_no, segment, sales_amount });
  it("counts a room once per night, drops a reversed night and postings without a room", () => {
    const rows = [
      n("2026-09-10", "101", "FIT-TA", 300_000),
      n("2026-09-10", "101", "FIT-TA", 50_000), // second posting of the same night
      n("2026-09-11", "101", "FIT-TA", 300_000),
      n("2026-09-11", "102", "FIT-TA", 400_000),
      n("2026-09-11", "102", "FIT-TA", -400_000), // reversed
      n("2026-09-19", null, "", -3_758_360), // correction without a room
      n("2026-08-31", "103", "FIT-TA", 300_000), // outside
    ];
    expect(countRoomNights(rows, "2026-09-01", "2026-09-30")).toEqual({ "FIT-TA": 2 });
  });
});

const week = (over: Partial<VhpWeek> = {}): VhpWeek => ({
  period: { since: "2026-11-09", until: "2026-11-15" },
  segments: [
    { segment: "FIT-TA", revenue: 41_000_000, lodging: 40_000_000, roomNights: 80 },
    { segment: "WALK IN", revenue: 20_500_000, lodging: 20_000_000, roomNights: 30 },
    { segment: "FIT", revenue: 10_000_000, lodging: 10_000_000, roomNights: 10 },
    { segment: "FIT-CORP", revenue: 5_000_000, lodging: 5_000_000, roomNights: 6 },
  ],
  lastDataDay: "2026-11-17",
  stay: { rooms: 126, nights: 7, occ: 29.508, arr: 612_345 },
  ...over,
});

describe("summarizeVhpWeek", () => {
  it("is room revenue only (Lodging): extra bed, no-show and gas fees are not room revenue", () => {
    const s = summarizeVhpWeek(week());
    expect(s.fit).toEqual({ revenue: 10_000_000, roomNights: 10 });
    expect(s.walkIn).toEqual({ revenue: 20_000_000, roomNights: 30 });
    expect(s.fitTa).toEqual({ revenue: 40_000_000, roomNights: 80 });
    expect(s.other).toEqual({ revenue: 5_000_000, roomNights: 6 });
    expect(s.roomRevenue).toBe(75_000_000);
    expect(s.fees).toBe(1_500_000);
    expect(s.complete).toBe(true);
  });

  it("is incomplete when VHP data stops inside the week, and empty when it stops before", () => {
    expect(summarizeVhpWeek(week({ lastDataDay: "2026-11-12" })).complete).toBe(false);
    expect(summarizeVhpWeek(week({ lastDataDay: "2026-11-08" })).available).toBe(false);
  });
});

describe("averageWeek", () => {
  it("divides totals since January by the number of weeks of data", () => {
    // 1 Jan – 14 Jan = 14 days = 2 weeks
    const avg = averageWeek({ ...week({ period: { since: "2026-01-01", until: "2026-01-14" } }), lastDataDay: "2026-01-14" });
    expect(avg.weeks).toBe(2);
    expect(avg.fit.revenue).toBe(5_000_000);
    expect(avg.walkIn.roomNights).toBe(15);
  });
});

describe("vhpSection (owner, 24 Nov: room revenue only, per WALK IN / OTA / FIT)", () => {
  const ads = { curr: { cost: 1_500_000 }, prev: { cost: 1_200_000 } };
  const avg = averageWeek({ ...week({ period: { since: "2026-01-01", until: "2026-01-14" } }), lastDataDay: "2026-01-14" });
  const row = (g: { rows: { metric: string; curr: number | null; prev: number | null; empty?: string }[] }, m: string) => g.rows.find((r) => r.metric === m)!;

  it("is the owner's table: WALK IN, FIT, OTA, ARR, room revenue, rooms sold, OCC, ad cost (24-25 Nov)", () => {
    const { group } = vhpSection(week(), week({ segments: [{ segment: "FIT-TA", revenue: 35_000_000, lodging: 35_000_000, roomNights: 70 }], stay: { rooms: 100, nights: 7, occ: 23.419, arr: 500_000 } }), avg, ads);
    expect(group.rows.map((r) => r.metric)).toEqual(["WALK IN", "FIT", "OTA", "ARR", "Revenue kamar", "Total kamar terjual", "Total OCC", "Biaya Google Ads"]);
    expect(row(group, "WALK IN").curr).toBe(20_000_000);
    expect(row(group, "FIT").curr).toBe(10_000_000);
    expect([row(group, "OTA").prev, row(group, "OTA").curr]).toEqual([35_000_000, 40_000_000]);
    expect([row(group, "ARR").prev, row(group, "ARR").curr]).toEqual([500_000, 612_345]);
    expect(row(group, "Revenue kamar").curr, "companies and groups left out").toBe(70_000_000);
    for (const m of ["ARR", "Revenue kamar", "Total kamar terjual", "Total OCC"])
      expect(group.rows.find((r) => r.metric === m)!.sub, `${m} says which guests it covers`).toBe("hanya WALK IN + FIT + OTA");
    expect([row(group, "Total kamar terjual").prev, row(group, "Total kamar terjual").curr]).toEqual([100, 126]);
    expect(row(group, "Total OCC").curr).toBeCloseTo(29.508);
    expect(group.rows.find((r) => r.metric === "Total OCC")!.points).toBe(true);
    expect([row(group, "Biaya Google Ads").prev, row(group, "Biaya Google Ads").curr]).toEqual([1_200_000, 1_500_000]);
  });

  it("leaves OCC and ARR empty, not zero, when they could not be read", () => {
    const { group } = vhpSection(week({ stay: null }), week(), avg, ads);
    for (const m of ["ARR", "Total kamar terjual", "Total OCC"]) expect(row(group, m).curr).toBeNull();
    expect(row(group, "FIT").curr).toBe(10_000_000);
  });

  it("says resort, never hotel, to the reader (owner, 25 Nov)", () => {
    const r = vhpSection(week({ lastDataDay: "2026-11-12" }), week(), avg, ads);
    expect(JSON.stringify([r.group, r.detail, r.limits, vhpSection(week({ lastDataDay: "2026-11-01" }), week(), avg, ads).limits])).not.toMatch(/hotel/i);
  });

  it("has no hotel-wide revenue and no check-in count (joined different guests, 2,572 arrivals lost Jan–22 Nov)", () => {
    const names = vhpSection(week(), week(), avg, ads).group.rows.map((r) => r.metric).join(" | ");
    expect(names).not.toMatch(/semua outlet|Total revenue hotel|check-in/i);
  });

  it("leaves VHP figures empty and warns when the week has no VHP data yet", () => {
    const { group, limits } = vhpSection(week({ lastDataDay: "2026-11-01" }), week(), avg, ads);
    expect(row(group, "FIT").curr).toBeNull();
    expect(limits.join(" ")).toContain("Belum ada data");
  });

  it("opens the conclusions with total room revenue, then WALK IN, FIT and OTA as the yardstick (owner, 24 Nov)", () => {
    const { verdict } = vhpSection(week(), week({ segments: [{ segment: "FIT-TA", revenue: 35_000_000, lodging: 35_000_000, roomNights: 70 }] }), avg, ads);
    expect(verdict).toMatch(/^Revenue kamar FIT \+ WALK IN \+ OTA naik 100%: Rp35,0 jt → Rp70,0 jt \(/);
    expect(verdict).toContain("WALK IN tanpa pembanding, FIT tanpa pembanding, OTA sebagai pembanding naik 14%.");
    expect(vhpSection(week({ lastDataDay: "2026-11-12" }), week(), avg, ads).verdict).toBeNull();
  });

  it("does not compare a period whose VHP data is not complete yet", () => {
    const { group, limits } = vhpSection(week({ lastDataDay: "2026-11-12" }), week(), avg, ads);
    expect(row(group, "OTA").curr).toBe(40_000_000);
    expect(row(group, "OTA").prev).toBeNull();
    expect(row(group, "OTA").empty).toBe("tidak setara");
    expect(limits.join(" ")).toContain("belum lengkap");
  });

  it("lists every segment with its share of room revenue", () => {
    const { detail, limits } = vhpSection(week(), week(), avg, ads);
    expect(detail.rows.map((r) => r[0])).toEqual(["FIT-TA", "WALK IN", "FIT", "FIT-CORP", "Total kamar (semua tamu digabung)"]);
    expect(detail.rows[1][2]).toBe("26,7%"); // 20 of 75 jt
    expect(limits.join(" ")).toContain("Rp1.500.000");
  });
});
