import { describe, expect, it } from "vitest";
import { DEFAULT_NETT_RATIO, nettRatios, previousPeriod, samePeriodLastMonth } from "./revenue-nett";

describe("nettRatios", () => {
  const ratio = nettRatios([
    // Oct 2026 Front Office from the real Turnover: exact for the month.
    { outlet_name: "Front Office", period_start: "2026-10-01", period_end: "2026-10-31", gross: 309_893_008, nett: 256_153_319 },
    { outlet_name: "Front Office", period_start: "2026-11-01", period_end: "2026-11-01", gross: 121, nett: 100 },
    { outlet_name: "Front Office", period_start: "2026-11-02", period_end: "2026-11-02", gross: 242, nett: 200 },
    // A report spanning months is not used.
    { outlet_name: "d'Bistro", period_start: "2026-10-20", period_end: "2026-11-05", gross: 100, nett: 50 },
  ]);

  it("uses the department's own Turnover ratio", () => {
    expect(309_893_008 * ratio("Front Office", "2026-10-01", "2026-10-31")).toBeCloseTo(256_153_319, 0);
    expect(ratio("Front Office", "2026-11-01", "2026-11-17")).toBeCloseTo(300 / 363, 10);
  });

  it("falls back to service 10% + tax 10% without a Turnover", () => {
    expect(ratio("d'Bistro", "2026-11-01", "2026-11-05")).toBe(DEFAULT_NETT_RATIO);
    expect(121 * DEFAULT_NETT_RATIO).toBeCloseTo(100, 10);
  });
});

describe("samePeriodLastMonth (owner, 24 Nov: compare with the same dates last month)", () => {
  it("moves both dates one month back", () => {
    expect(samePeriodLastMonth("2026-11-01", "2026-11-22")).toEqual({ start: "2026-10-01", end: "2026-10-22" });
    expect(samePeriodLastMonth("2026-11-16", "2026-11-22")).toEqual({ start: "2026-10-16", end: "2026-10-22" });
    expect(samePeriodLastMonth("2026-01-05", "2026-01-05")).toEqual({ start: "2025-12-05", end: "2025-12-05" });
  });
  it("a day the earlier month lacks becomes its last day", () => {
    expect(samePeriodLastMonth("2026-10-01", "2026-10-31")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(samePeriodLastMonth("2026-03-30", "2026-03-31")).toEqual({ start: "2026-02-28", end: "2026-02-28" });
    expect(samePeriodLastMonth("2026-10-25", "2026-11-05")).toEqual({ start: "2026-09-25", end: "2026-10-05" });
  });
  it("longer than 31 days uses the same length right before", () => {
    expect(samePeriodLastMonth("2026-09-01", "2026-11-22")).toEqual(previousPeriod("2026-09-01", "2026-11-22"));
  });
});

describe("previousPeriod", () => {
  it("is the same number of days right before", () => {
    expect(previousPeriod("2026-11-01", "2026-11-17")).toEqual({ start: "2026-10-15", end: "2026-10-31" });
    expect(previousPeriod("2026-03-01", "2026-03-01")).toEqual({ start: "2026-02-28", end: "2026-02-28" });
  });
});
