import { describe, expect, it } from "vitest";
import { busyMenus, perMonth, soldMenus } from "./outlet-menus";

const m = (description: string, total_qty: number, total_amount = total_qty * 1000, source: "journal" | "fo" = "journal") => ({ description, total_qty, total_amount, source });

describe("soldMenus (owner, 24 Nov: most portions first, more than 3 a month)", () => {
  it("sorts by portions, then by value; leaves out tenths, returns and articles", () => {
    const r = soldMenus([m("Teh", 10, 50_000), m("Kopi", 30), m("Nasi", 10, 90_000), m("(0.1 Ons) Lobster", 99), m("Retur", 0), m("Lodging", 50, 9, "fo")], 22);
    expect(r.map((x) => x.description)).toEqual(["Kopi", "Nasi", "Teh"]);
  });
  it("spreads the period over 30 days", () => {
    expect(perMonth(22, 22)).toBe(30);
    expect(perMonth(5, 0)).toBe(0);
  });
  it("keeps only menus above 3 portions a month", () => {
    const r = busyMenus(soldMenus([m("A", 3), m("B", 2), m("C", 2.2)], 22));
    expect(r.map((x) => x.description)).toEqual(["A"]);
  });
});
