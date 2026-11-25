import { describe, expect, it } from "vitest";
import { buildReportSheet } from "./report-sheet";

const menu = (outlet: string, description: string, extra = {}) => ({ outlet, artNo: description, description, totalQty: 10, windowQty: 0, slowQty: 0, totalSales: 100, lastSold: "2026-08-01", firstSold: "2026-01-05", ...extra });

describe("buildReportSheet (owner 22 Nov: one-page report for a date range, card per topic)", () => {
  const sheet = buildReportSheet({
    from: "2026-11-01",
    to: "2026-11-21",
    outlets: [
      { outlet_name: "Front Office", revenue_amount: 300, revenue_share_pct: 60, revenue_available: true },
      { outlet_name: "Sunset Grill", revenue_amount: 200, revenue_share_pct: 40, revenue_available: true },
      { outlet_name: "Laundry", revenue_amount: 0, revenue_share_pct: 0, revenue_available: false },
    ],
    totalPurchase: 1000,
    purchaseGroups: [
      { main: "F&B", total: 700 },
      { main: "HK", total: 300 },
    ],
    suppliers: Array.from({ length: 7 }, (_, i) => ({ supplier_name: `S${i + 1}`, purchase_amount: (i + 1) * 10 })),
    inventory: [
      { name: "Housekeeping", connected: true, usage: 50, usageBy: [{ location: "Kamar", totalCost: 40 }, { location: "Spa", totalCost: 10 }] },
      { name: "F&B", connected: false, usage: null, usageBy: [] },
    ],
    outletItems: [
      { outlet_name: "Sunset Grill", description: "Nasi Goreng", total_qty: 5, total_amount: 500, source: "journal" as const },
      { outlet_name: "Room Service", description: "Mie Goreng", total_qty: 2, total_amount: 900, source: "journal" as const },
    ],
    menuActivity: {
      deadFrom: "2026-08-24",
      slowFrom: "2026-10-23",
      lastDay: "2026-11-21",
      deadDays: 90,
      slowDays: 30,
      least: [menu("Sunset Grill", "Steak", { windowQty: 6 }), menu("Sunset Grill", "Sup", { windowQty: 1 }), menu("d'Bistro", "Roti", { windowQty: 2 })],
    },
  });

  it("lists revenue per outlet with a total; an outlet without data says so instead of 0", () => {
    expect(sheet.revenue.rows.map((r) => [r.outlet, r.amount])).toEqual([
      ["Front Office", 300],
      ["Sunset Grill", 200],
      ["Laundry", null],
    ]);
    expect(sheet.revenue.total).toBe(500);
  });

  it("keeps purchases to the total, the groups and the 5 largest suppliers", () => {
    expect(sheet.purchases.total).toBe(1000);
    expect(sheet.purchases.groups).toEqual([{ name: "F&B", amount: 700 }, { name: "HK", amount: 300 }]);
    expect(sheet.purchases.suppliers.map((s) => s.name)).toEqual(["S7", "S6", "S5", "S4", "S3"]);
  });

  it("shows inventory usage per department and outlet; departments without a link say so", () => {
    expect(sheet.inventory.rows).toEqual([
      { name: "Housekeeping", usage: 50, by: [{ location: "Kamar", amount: 40 }, { location: "Spa", amount: 10 }] },
      { name: "F&B", usage: null, by: [] },
    ]);
    expect(sheet.inventory.total).toBe(50);
  });

  it("ranks the top menus of the range with the outlet they are reported under", () => {
    expect(sheet.topMenus.map((t) => [t.name, t.outlet])).toEqual([
      ["Mie Goreng", "d'Bistro"],
      ["Nasi Goreng", "Sunset Grill"],
    ]);
  });

  it("lists the least sold menus of the last 3 months per outlet, fewest portions first (owner, 23 Nov)", () => {
    expect(sheet.inactive.rows).toEqual([
      { outlet: "d'Bistro", count: 1, examples: ["Roti (2)"] },
      { outlet: "Sunset Grill", count: 2, examples: ["Sup (1)", "Steak (6)"] },
    ]);
    expect(sheet.inactive).toMatchObject({ deadFrom: "2026-08-24", slowFrom: "2026-10-23", lastDay: "2026-11-21" });
  });
});
