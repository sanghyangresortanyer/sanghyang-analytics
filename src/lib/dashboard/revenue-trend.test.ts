import { describe, expect, it } from "vitest";
import { buildRevenueCharts, categorySeries, monthlySeries, weekStart, weeklySeries } from "./revenue-trend";

const charts = buildRevenueCharts({
  months: [
    { month: "2026-10", outlet_name: "d'Bistro", revenue: 100 },
    { month: "2026-10", outlet_name: "Room Service", revenue: 10 },
    { month: "2026-11", outlet_name: "Front Office", revenue: 300 },
  ],
  days: [
    { sale_date: "2026-11-02", outlet_name: "Front Office", revenue: 100 }, // Monday
    { sale_date: "2026-11-08", outlet_name: "Front Office", revenue: 100 }, // Sunday, same week
    { sale_date: "2026-11-09", outlet_name: "Front Office", revenue: 300 }, // next Monday
    { sale_date: "2026-11-10", outlet_name: "d'Bistro", revenue: 50 },
  ],
  categories: [
    { outlet_name: "Sunset Grill", category: "Food Sunset Grill", sales: 70, qty: 7 },
    { outlet_name: "Sunset Grill", category: "Beverage Non-Alcoholic Sunset Gr", sales: 20, qty: 4 },
    { outlet_name: "Sunset Grill", category: "Beverage Non-Alcoholic Sunset Grill", sales: 5, qty: 0 },
    { outlet_name: "Sunset Grill", category: "(compliment)", sales: -3, qty: 0 },
  ],
  // Room Service is reported under d'Bistro on the dashboard.
  outletFor: (n) => (n === "Room Service" ? "d'Bistro" : n),
});

describe("revenue charts", () => {
  it("folds merged outlets into the monthly trend", () => {
    expect(monthlySeries(charts, "d'Bistro")).toEqual([{ month: "2026-10", revenue: 110 }, { month: "2026-11", revenue: 0 }]);
    expect(monthlySeries(charts, null).map((m) => m.revenue)).toEqual([110, 300]);
  });

  it("sums Monday–Sunday weeks and compares each with the week before", () => {
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    const w = weeklySeries(charts, null);
    expect(w.map((x) => [x.start, x.revenue])).toEqual([["2026-11-02", 200], ["2026-11-09", 350]]);
    expect(w[1].changePct).toBe(75);
    expect(w[0].complete).toBe(true);
    expect(w[1].complete).toBe(false); // last data day is 10 Nov
  });

  it("groups categories and keeps complimentary on its own", () => {
    expect(categorySeries(charts, "Sunset Grill")).toEqual([
      { category: "Makanan", sales: 70, qty: 7 },
      { category: "Minuman non-alkohol", sales: 25, qty: 4 },
      { category: "Compliment", sales: -3, qty: 0 },
    ]);
  });
});
