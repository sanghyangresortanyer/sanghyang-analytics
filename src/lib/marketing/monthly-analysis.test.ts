import { describe, expect, it } from "vitest";
import { monthPeriods, rangeLabel, spanLabel } from "./monthly-analysis.ts";

describe("monthPeriods", () => {
  it("lists January up to the current month, the current one ending yesterday", () => {
    const p = monthPeriods("2026-01", "2026-03-10", "2026-03-31");
    expect(p.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(p[1].period).toEqual({ since: "2026-02-01", until: "2026-02-28" });
    expect(p[2]).toMatchObject({ period: { since: "2026-03-01", until: "2026-03-09" }, partial: true, hotel: true });
  });

  it("cuts both sides at the last VHP day so ads and hotel cover the same days", () => {
    const p = monthPeriods("2026-01", "2026-11-19", "2026-11-17");
    expect(p.at(-1)).toMatchObject({ month: "2026-11", period: { since: "2026-11-01", until: "2026-11-17" }, partial: true, hotel: true });
  });

  it("keeps ads for a month without any VHP data, and marks the hotel side missing", () => {
    const p = monthPeriods("2026-01", "2026-12-05", "2026-11-17");
    expect(p.at(-1)).toMatchObject({ month: "2026-12", period: { since: "2026-12-01", until: "2026-12-04" }, hotel: false });
  });
});

describe("date labels", () => {
  it("writes the days of every figure", () => {
    expect(rangeLabel({ since: "2026-09-01", until: "2026-09-30" })).toBe("1–30 Sep 2026");
    expect(spanLabel("2026-01-01", "2026-11-17")).toBe("1 Jan – 17 Nov 2026");
  });
});
