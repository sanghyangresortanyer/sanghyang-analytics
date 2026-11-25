import { describe, expect, it } from "vitest";
import { budgetStatus, DIVISIONS, mergeBudgets } from "./division-budgets";

describe("mergeBudgets", () => {
  it("lists every VHP article group, with 0 (no budget) until one is saved", () => {
    const b = mergeBudgets([{ division: "Food", monthly_budget: "150000000", version: 3 }]);
    expect(b.map((x) => x.division)).toEqual(DIVISIONS);
    expect(b[0]).toEqual({ division: "Food", monthlyBudget: 150_000_000, version: 3 });
    expect(b[1]).toEqual({ division: "Beverage", monthlyBudget: 0, version: 0 });
  });
});

describe("budgetStatus", () => {
  it("reports what is left of the budget", () => {
    expect(budgetStatus(60_000_000, 100_000_000)).toEqual({ usedPct: 60, left: 40_000_000, over: false });
  });

  it("reports an overspend", () => {
    expect(budgetStatus(120_000_000, 100_000_000)).toEqual({ usedPct: 120, left: -20_000_000, over: true });
  });

  it("is null without a budget", () => {
    expect(budgetStatus(5, 0)).toBeNull();
  });
});
