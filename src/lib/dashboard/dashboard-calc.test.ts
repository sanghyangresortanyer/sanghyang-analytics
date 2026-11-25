import { describe, expect, it } from "vitest";
import type { DmlSheetSummary, HkItemRow } from "@/lib/sheets/queries";
import { calculateDmlPurchases, calculateHkLocationUsage, dmlSheetsInPeriod, inventoryOverview, mergeRevenueOutlets } from "./dashboard-calc";

const sheet = (sheet_name: string, list_date: string, outlets: DmlSheetSummary["outlets"]): DmlSheetSummary => ({
  sheet_name,
  list_date,
  outlets,
  total_request: outlets.reduce((s, o) => s + o.total, 0),
  sheet_grand_total: null,
  line_count: outlets.reduce((s, o) => s + o.lineCount, 0),
  warnings: [],
});

const nov01 = sheet("01-11-26", "2026-11-01", [{ outlet: "BISTRO", total: 1000, lineCount: 2, sheetSubtotal: 1000 }]);
const nov08 = sheet("08-11-26", "2026-11-08", [{ outlet: "BISTRO", total: 500, lineCount: 1, sheetSubtotal: 500 }]);
const nov15 = sheet("15-11-26", "2026-11-15", [
  { outlet: "SUNSET GRILL", total: 700, lineCount: 1, sheetSubtotal: 700 },
  { outlet: "MR", total: 300, lineCount: 2, sheetSubtotal: 300 },
]);

describe("dmlSheetsInPeriod", () => {
  it("keeps only lists dated inside the period", () => {
    expect(dmlSheetsInPeriod([nov15, nov08, nov01], "2026-11-01", "2026-11-14").map((s) => s.sheet_name)).toEqual([
      "01-11-26",
      "08-11-26",
    ]);
  });

  it("returns nothing for a period without lists instead of borrowing the latest ones", () => {
    expect(dmlSheetsInPeriod([nov15, nov08, nov01], "2026-09-01", "2026-09-14")).toEqual([]);
  });
});

describe("calculateDmlPurchases", () => {
  it("sums outlets over the sheets", () => {
    expect(calculateDmlPurchases([nov01, nov08], [])).toEqual({
      purchases: [{ outlet: "BISTRO", totalAmount: 1500, lineCount: 3 }],
      total: 1500,
    });
  });

  it("splits MR by department and keeps the total", () => {
    const result = calculateDmlPurchases(
      [nov15],
      [
        { sheet_name: "15-11-26", purchase_channel: "DBC", total: 200 },
        { sheet_name: "15-11-26", purchase_channel: "ENG", total: 100 },
      ],
    );
    expect(result.total).toBe(1000);
    expect(result.purchases).toContainEqual({ outlet: "d'Bar Karaoke & DBC", totalAmount: 200, lineCount: 1 });
    expect(result.purchases).toContainEqual({ outlet: "ENGINEERING", totalAmount: 100, lineCount: 1 });
  });
});

describe("calculateHkLocationUsage", () => {
  const item = (item_code: string, average_price: number | null): HkItemRow => ({
    period_month: "2026-11-01",
    item_code,
    item_name: item_code,
    unit: null,
    stock_awal: null,
    total_in: null,
    total_out: null,
    stock_akhir: null,
    average_price,
    stock_value: null,
  });

  it("merges locations written in different case and counts unpriced entries separately", () => {
    const result = calculateHkLocationUsage(
      [item("A", 1000), item("B", null)],
      [
        { period_month: "2026-11-01", movement_date: "2026-11-01", item_code: "A", day: 1, qty_in: null, qty_out: 2, location: "Bistro" },
        { period_month: "2026-11-01", movement_date: "2026-11-02", item_code: "A", day: 2, qty_in: null, qty_out: 1, location: "bistro" },
        { period_month: "2026-11-01", movement_date: "2026-11-02", item_code: "B", day: 2, qty_in: null, qty_out: 5, location: "Room" },
      ],
    );
    expect(result.locations).toEqual([{ location: "Bistro", totalCost: 3000, itemCount: 1 }]);
    expect(result.unpricedEntries).toBe(1);
  });

  it("folds spelling variants seen in the HK sheet into one location", () => {
    const mv = (location: string, qty_out: number) => ({ period_month: "2026-11-01", movement_date: "2026-11-01", item_code: "A", day: 1, qty_in: null, qty_out, location });
    const result = calculateHkLocationUsage(
      [item("A", 100)],
      [mv("Kitchen", 1), mv("Kitcheb", 1), mv("krakata", 1), mv("Krakatau", 2), mv("Sampah SRD", 1)],
    );
    expect(result.locations.map((l) => [l.location, l.totalCost])).toEqual([
      ["Krakatau", 300],
      ["Kitchen", 200],
      ["Sampah SRD", 100],
    ]);
  });

  it("splits a combined location such as \"SRD & BC\" equally between its places (user rule 2026-11-18)", () => {
    const mv = (location: string, qty_out: number) => ({ period_month: "2026-11-01", movement_date: "2026-11-01", item_code: "A", day: 1, qty_in: null, qty_out, location });
    const result = calculateHkLocationUsage([item("A", 100)], [mv("SRD & BC", 2), mv("SRD &BC", 2), mv("BC", 1)]);
    expect(result.locations.map((l) => [l.location, l.totalCost])).toEqual([
      ["BC", 300],
      ["SRD", 200],
    ]);
  });
});

describe("inventoryOverview", () => {
  const dept = (key: string, stock: number | null, usage: number | null, connected = true) => ({
    key,
    name: key,
    source: "sheet",
    connected,
    stock,
    usage,
    usageBy: [],
  });

  it("sums the departments that have figures into the global stock and usage", () => {
    const r = inventoryOverview([dept("HK", 300, 40), dept("Food", 500, 60)]);
    expect(r.stockTotal).toBe(800);
    expect(r.usageTotal).toBe(100);
    expect(r.notConnected).toEqual([]);
  });

  it("lists a department without a source instead of counting it as zero", () => {
    const r = inventoryOverview([dept("HK", 300, 40), dept("Food", null, null, false)]);
    expect(r.stockTotal).toBe(300);
    expect(r.notConnected).toEqual(["Food"]);
  });

  it("has no global figure when no department has data", () => {
    expect(inventoryOverview([dept("Food", null, null, false)]).stockTotal).toBeNull();
  });
});

describe("mergeRevenueOutlets", () => {
  const row = (outlet_name: string, revenue_amount: number, prev: number | null = null) => ({
    outlet_name,
    revenue_amount,
    revenue_qty: 1,
    revenue_share_pct: 0,
    inventory_amount: null,
    prev_revenue_amount: prev,
  });

  it("folds Room Service and Banquet into d'Bistro and recomputes shares", () => {
    const { outlets, merged } = mergeRevenueOutlets([
      row("Front Office", 600),
      row("d'Bistro", 200, 100),
      row("Room Service", 100),
      row("Banquet", 100, 50),
    ]);
    expect(outlets.map((o) => [o.outlet_name, o.revenue_amount, o.revenue_share_pct, o.prev_revenue_amount])).toEqual([
      ["Front Office", 600, 60, null],
      ["d'Bistro", 400, 40, 150],
    ]);
    expect(merged).toEqual([{ target: "d'Bistro", sources: ["Room Service", "Banquet"] }]);
  });

  it("creates d'Bistro when only Room Service exists", () => {
    expect(mergeRevenueOutlets([row("Room Service", 100)]).outlets[0].outlet_name).toBe("d'Bistro");
  });
});
