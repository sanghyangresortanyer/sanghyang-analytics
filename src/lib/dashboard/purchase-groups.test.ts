import { describe, expect, it } from "vitest";
import { articleGroup, groupPurchases } from "./purchase-groups";

describe("articleGroup", () => {
  it("reads main group and sub-group from the VHP article number", () => {
    expect(articleGroup("1100005")).toEqual({ main: "Food", sub: "Poultry Product" });
    expect(articleGroup("2200001")).toEqual({ main: "Beverage", sub: "Non Alcoholic Beverage" });
    expect(articleGroup("4456010")).toEqual({ main: "Engineering", sub: "Plumbing" });
  });

  it("reads codes stored zero-padded to 9 digits", () => {
    expect(articleGroup("002200004")).toEqual({ main: "Beverage", sub: "Non Alcoholic Beverage" });
    expect(articleGroup("004460004")).toEqual({ main: "Engineering", sub: "Fuel & Gas" });
  });

  it("puts Civil Work under Engineering", () => {
    expect(articleGroup("5501029")).toEqual({ main: "Engineering", sub: "Civil Work" });
  });

  it("keeps unknown codes visible instead of dropping them", () => {
    expect(articleGroup("ABC")).toEqual({ main: "Lainnya", sub: "Lainnya" });
  });
});

describe("groupPurchases", () => {
  it("totals per main group and sub-group, largest first", () => {
    const item = (code: string, amount: number) => ({ ingredient_code: code, description: code, unit: "pcs", total_qty: 1, total_amount: amount });
    const g = groupPurchases([item("1104001", 50), item("5501029", 300), item("4456010", 200), item("1100005", 100)]);
    expect(g.map((x) => [x.main, x.total])).toEqual([
      ["Engineering", 500],
      ["Food", 150],
    ]);
    expect(g[0].subs.map((s) => s.name)).toEqual(["Civil Work", "Plumbing"]);
  });
});
