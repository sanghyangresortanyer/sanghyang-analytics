import { describe, expect, it } from "vitest";
import type { HkItemRow, HkMovementRow } from "@/lib/sheets/queries";
import { storeFigures } from "./store-inventory";

const item = (code: string, name: string, price: number, awal: number, akhir: number): HkItemRow => ({
  period_month: "2026-11-01",
  item_code: code,
  item_name: name,
  unit: "Pcs",
  stock_awal: awal,
  total_in: 0,
  total_out: awal - akhir,
  stock_akhir: akhir,
  average_price: price,
  stock_value: akhir * price,
});
const out = (code: string, date: string, qty: number, location: string): HkMovementRow => ({
  period_month: "2026-11-01",
  movement_date: date,
  item_code: code,
  day: Number(date.slice(8)),
  qty_in: null,
  qty_out: qty,
  location,
});

describe("storeFigures (Main Store, Engineering, beverage store)", () => {
  const items = [item("3304004", "Shower Cap", 500, 600, 0), item("1107782", "Beras", 15_000, 50, 25)];
  const moves = [out("3304004", "2026-11-05", 500, "hk"), out("3304004", "2026-11-06", 100, "spa"), out("1107782", "2026-11-05", 25, "kicen5,sg1")];

  it("counts goods moved into HK's stock once: out of usage, shown as sent to HK", () => {
    const f = storeFigures(items, moves, "2026-11-01", "2026-11-30", [{ destination: "HK", codes: new Set(["3304004"]) }])!;
    expect(f.transferred).toBe(500 * 500);
    expect(f.usage).toBe(100 * 500 + 25 * 15_000);
    expect(f.stock).toBe(25 * 15_000);
    expect(f.usageBy.map((u) => u.location)).toEqual(["Kitchen", "HK", "Sunset Grill", "Spa"]);
  });

  it("counts everything as usage when nothing goes to another store", () => {
    const f = storeFigures(items, moves, "2026-11-01", "2026-11-30")!;
    expect(f.transferred).toBe(0);
    expect(f.usage).toBe(600 * 500 + 25 * 15_000);
  });

  it("follows the period and has no figures without items", () => {
    expect(storeFigures(items, moves, "2026-11-06", "2026-11-30")!.usage).toBe(100 * 500);
    expect(storeFigures([], moves, "2026-11-01", "2026-11-30")).toBeNull();
  });
});
