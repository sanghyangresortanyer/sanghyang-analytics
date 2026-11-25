import { describe, expect, it } from "vitest";
import { chartPoints, direction, dotStep, gridLines, outletDrops } from "./day-series";
import type { RevenueCharts } from "./revenue-trend";

const iso = (i: number, start = "2026-11-01") => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
const charts = (days: RevenueCharts["days"], lastDay = days.at(-1)?.date ?? null): RevenueCharts => ({ months: [], days, categories: [], lastDay });
const run = (n: number, start: string, value: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ date: iso(i, start), outlets: { "Front Office": value(i), "d'Spa": 1 } }));

describe("chartPoints: the bars, dots and lines of the main card (owner, 24 Nov: look A)", () => {
  it("a month in progress runs to the end of the month; days without data are null, never 0", () => {
    const r = chartPoints(charts(run(22, "2026-11-01", (i) => i + 1)), "2026-11-01", "2026-11-22", null);
    expect(r.unit).toBe("hari");
    expect(r.points).toHaveLength(30);
    expect(r.points[21]).toMatchObject({ start: "2026-11-22", value: 23, label: "Minggu 22 Nov" });
    expect(r.points[22].value).toBeNull();
    expect(r.lastIndex).toBe(21);
  });

  it("a period that does not start on the 1st, or a finished month, shows only its own days", () => {
    expect(chartPoints(charts(run(22, "2026-11-01", () => 5)), "2026-11-16", "2026-11-22", null).points).toHaveLength(7);
    expect(chartPoints(charts(run(53, "2026-10-01", () => 5)), "2026-10-01", "2026-10-22", null).points).toHaveLength(22);
  });

  it("a day is compared with the same weekday a week earlier, also when that lies before the period", () => {
    const r = chartPoints(charts(run(14, "2026-11-01", (i) => (i < 7 ? 99 : 199))), "2026-11-08", "2026-11-14", null);
    expect(r.points[0].changePct).toBeCloseTo(100);
    expect(r.points[0].against).toBe("Minggu 1 Nov");
    expect(chartPoints(charts(run(7, "2026-11-01", () => 5)), "2026-11-01", "2026-11-07", null).points[0].changePct).toBeNull();
  });

  it("a day missing inside the period is null; an outlet closed that day is 0", () => {
    const days = run(3, "2026-11-01", () => 5);
    days.splice(1, 1);
    const all = chartPoints(charts(days), "2026-11-01", "2026-11-03", null);
    expect(all.points[1].value).toBeNull();
    expect(chartPoints(charts([{ date: "2026-11-01", outlets: { "Front Office": 5 } }]), "2026-11-01", "2026-11-01", "d'Spa").points[0].value).toBe(0);
  });

  it("the points add up to the period's revenue, per day and per week", () => {
    const c = charts(run(140, "2026-07-01", (i) => i % 9));
    for (const [from, to] of [["2026-11-01", "2026-11-17"], ["2026-07-03", "2026-11-17"]] as const) {
      const want = c.days.filter((d) => d.date >= from && d.date <= to).reduce((s, d) => s + d.outlets["Front Office"] + 1, 0);
      expect(chartPoints(c, from, to, null).points.reduce((s, p) => s + (p.value ?? 0), 0)).toBe(want);
    }
  });

  it("more than 62 days becomes weeks; a cut week is never compared", () => {
    const r = chartPoints(charts(run(140, "2026-07-01", () => 10)), "2026-07-01", "2026-11-17", null);
    expect(r.unit).toBe("minggu");
    expect(r.points[0]).toMatchObject({ start: "2026-07-01", end: "2026-07-05", changePct: null });
    expect(r.points[1].changePct).toBeNull(); // the week before was cut
    expect(r.points[2].changePct).toBe(0);
    expect(r.points.at(-1)!.changePct).toBeNull(); // cut at the end
  });
});

describe("direction", () => {
  it("small moves are 'sama', unknown is 'tanpa'", () => {
    expect([direction(12), direction(-3), direction(0.04), direction(null)]).toEqual(["naik", "turun", "sama", "tanpa"]);
  });
});

describe("dotStep and gridLines", () => {
  it("keeps the highest column at 26 dots or fewer, at round amounts", () => {
    expect(dotStep(120_100_000)).toBe(5_000_000);
    expect(dotStep(20_000_000)).toBe(1_000_000);
    expect(dotStep(0)).toBe(100_000);
  });
  it("gives round lines below the highest value", () => {
    expect(gridLines(120_100_000)).toEqual([40_000_000, 80_000_000, 120_000_000]);
    expect(gridLines(0)).toEqual([]);
  });
});

describe("outletDrops: the sentence under the chart", () => {
  const prev = { "Front Office": 100e6, "d'Bar": 246e6, Sunset: 115e6, "d'Spa": 2e6 };
  it("names every outlet that went down, the largest rupiah loss first", () => {
    const r = outletDrops([{ name: "Front Office", revenue: 130e6 }, { name: "Sunset", revenue: 114e6 }, { name: "d'Bar", revenue: 200e6 }, { name: "d'Spa", revenue: 3e6 }], prev);
    expect(r.map((d) => d.name)).toEqual(["d'Bar", "Sunset"]);
    expect(r[0]).toMatchObject({ from: 246e6, to: 200e6 });
  });
  it("is empty when nothing went down or there is no comparison", () => {
    expect(outletDrops([{ name: "Front Office", revenue: 100e6 }], prev)).toEqual([]);
    expect(outletDrops([{ name: "Front Office", revenue: 1 }], null)).toEqual([]);
  });
});
