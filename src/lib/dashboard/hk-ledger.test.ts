import { describe, expect, it } from "vitest";
import type { HkItemRow, HkMovementRow } from "@/lib/sheets/queries";
import { hkLedger } from "./hk-ledger";

const item = (month: string, code: string, awal: number | null, price: number | null): HkItemRow => ({
  period_month: `${month}-01`,
  item_code: code,
  item_name: `Item ${code}`,
  unit: "Pcs",
  stock_awal: awal,
  total_in: null,
  total_out: null,
  stock_akhir: null,
  average_price: price,
  stock_value: null,
});
const mv = (date: string, code: string, qtyIn: number | null, qtyOut: number | null, location: string | null = null): HkMovementRow => ({
  period_month: `${date.slice(0, 7)}-01`,
  movement_date: date,
  item_code: code,
  day: Number(date.slice(8)),
  qty_in: qtyIn,
  qty_out: qtyOut,
  location,
});

// Nov: A opens 10 @1.000; +5 on the 2nd, −3 on the 10th, −1 on the 20th. B opens empty (0), no price.
const items = [item("2026-11", "A", 10, 1000), item("2026-11", "B", null, null)];
const movements = [mv("2026-11-02", "A", 5, null), mv("2026-11-10", "A", null, 3, "Room"), mv("2026-11-20", "A", null, 1), mv("2026-11-05", "B", 4, 1)];

describe("hkLedger", () => {
  it("rebuilds stock for any period inside the month", () => {
    const first = hkLedger(items, movements, "2026-11-01", "2026-11-14");
    const a = first.items.find((i) => i.itemCode === "A")!;
    expect([a.opening, a.qtyIn, a.qtyOut, a.closing, a.closingValue]).toEqual([10, 5, 3, 12, 12000]);

    const second = hkLedger(items, movements, "2026-11-15", "2026-11-30");
    const a2 = second.items.find((i) => i.itemCode === "A")!;
    expect([a2.opening, a2.qtyIn, a2.qtyOut, a2.closing]).toEqual([12, 0, 1, 11]);
    expect(second.outValue).toBe(1000);
  });

  it("gives Rupiah per day and lists the day's movements", () => {
    const l = hkLedger(items, movements, "2026-11-01", "2026-11-14");
    expect(l.days).toHaveLength(14);
    const nov10 = l.days.find((d) => d.date === "2026-11-10")!;
    expect(nov10).toMatchObject({ inValue: 0, outValue: 3000, closingValue: 12000 });
    expect(nov10.movements).toEqual([{ itemCode: "A", itemName: "Item A", unit: "Pcs", qtyIn: 0, qtyOut: 3, location: "Room" }]);
    expect(l.openingValue).toBe(10000);
    expect(l.closingValue).toBe(12000);
  });

  it("keeps unpriced items out of Rupiah totals but tracks their stock", () => {
    const l = hkLedger(items, movements, "2026-11-01", "2026-11-30");
    const b = l.items.find((i) => i.itemCode === "B")!;
    expect([b.opening, b.closing, b.closingValue]).toEqual([0, 3, null]);
    expect(l.unpricedItems).toBe(1);
    expect(l.inValue).toBe(5000);
  });

  it("reports months the sheet does not have instead of filling them with 0", () => {
    const l = hkLedger(items, movements, "2026-11-25", "2026-12-05");
    expect(l.missingMonths).toEqual(["2026-12"]);
    expect(l.closingValue).toBeNull();
    expect(l.days.map((d) => d.date)).toEqual(["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30"]);
  });

  it("continues into the next month from that month's own opening stock", () => {
    const dec = [...items, item("2026-12", "A", 11, 1000)];
    const l = hkLedger(dec, [...movements, mv("2026-12-03", "A", 2, null)], "2026-11-25", "2026-12-05");
    const a = l.items.find((i) => i.itemCode === "A")!;
    expect([a.opening, a.qtyIn, a.closing]).toEqual([11, 2, 13]);
    expect(l.missingMonths).toEqual([]);
  });
});
