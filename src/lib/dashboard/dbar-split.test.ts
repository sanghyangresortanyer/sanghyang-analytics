import { describe, expect, it } from "vitest";
import { dbarSplit } from "./dbar-split";

describe("dbarSplit", () => {
  it("names the parts in a fixed order and adds up to the outlet total (Oct 2026)", () => {
    const s = dbarSplit([
      { part: "bar", revenue: "24936000", open_days: 12 },
      { part: "diskon", revenue: "-6410000", open_days: 0 },
      { part: "dbc", revenue: "296546000", open_days: 25 },
    ]);
    expect(s.rows.map((r) => r.label)).toEqual(["DBC", "d'Bar & Karaoke", "Diskon (belum bisa dipisah)"]);
    expect(s.total).toBe(315_072_000);
    expect(s.rows[0]).toMatchObject({ revenue: 296_546_000, openDays: 25 });
  });

  it("shares are of the menu sales, so discounts do not distort them", () => {
    const s = dbarSplit([
      { part: "dbc", revenue: 80, open_days: 2 },
      { part: "bar", revenue: 20, open_days: 3 },
      { part: "diskon", revenue: -10, open_days: 0 },
    ]);
    expect(s.rows[0].sharePct).toBe(80);
    expect(s.rows[1].sharePct).toBe(20);
    expect(s.rows[2].sharePct).toBeNull();
  });

  it("is empty without d'Bar sales", () => {
    expect(dbarSplit([]).rows).toEqual([]);
  });
});
