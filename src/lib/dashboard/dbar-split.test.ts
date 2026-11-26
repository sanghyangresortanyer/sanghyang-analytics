import { describe, expect, it } from "vitest";
import { dbarSplit } from "./dbar-split";

const part = (name: string, menu: number, discount = 0, compliment = 0, open_days = 1) => ({ part: name, menu: String(menu), discount: String(discount), compliment: String(compliment), open_days });

describe("dbarSplit (owner, 25 Nov: discounts follow the bill they are on)", () => {
  it("each part is its menus after its own discounts and compliments, adding up to the outlet total", () => {
    const s = dbarSplit([part("bar", 74_000, -1_200, -800, 18), part("dbc", 160_000, -3_000, -9_000, 20)]);
    expect(s.rows.map((r) => r.label)).toEqual(["DBC", "d'Bar & Karaoke"]);
    expect(s.rows[0]).toMatchObject({ revenue: 148_000, menu: 160_000, discount: -3_000, compliment: -9_000, openDays: 20 });
    expect(s.rows[1].revenue).toBe(72_000);
    expect(s.total).toBe(220_000);
    expect(s.unsplit).toBe(0);
  });

  it("shares are of what the two parts sold together", () => {
    const s = dbarSplit([part("dbc", 90, -10), part("bar", 20), part("belum", 0, -5)]);
    expect(s.rows[0].sharePct).toBe(80);
    expect(s.rows[1].sharePct).toBe(20);
    expect(s.rows[2].sharePct).toBeNull();
  });

  it("keeps what no bill could settle apart, named in plain words, and still counts it in the total", () => {
    const s = dbarSplit([part("dbc", 100), part("belum", 0, -6, -4, 0)]);
    expect(s.rows[1]).toMatchObject({ label: "Diskon dan compliment yang belum dibagi", revenue: -10 });
    expect(s.total).toBe(90);
    expect(s.unsplit).toBe(-10);
  });

  it("shows no empty row for what could not be settled, and nothing without d'Bar sales", () => {
    expect(dbarSplit([part("dbc", 100), part("belum", 0)]).rows).toHaveLength(1);
    expect(dbarSplit([]).rows).toEqual([]);
  });
});
