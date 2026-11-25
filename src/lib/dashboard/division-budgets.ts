/**
 * Monthly purchase budget per division. Divisions are the VHP article main groups the purchase
 * figures already use (purchase-groups.ts), so budget and purchases always meet on the same name.
 */
export const DIVISIONS = ["Food", "Beverage", "Operating Supplies", "Engineering", "Inventaris"];

export type DivisionBudget = { division: string; monthlyBudget: number; version: number };

/** Every division with its saved budget; 0 (no budget) and version 0 until one is saved. */
export function mergeBudgets(rows: { division: string; monthly_budget: number | string; version: number }[]): DivisionBudget[] {
  const saved = new Map(rows.map((r) => [r.division, r]));
  return DIVISIONS.map((division) => {
    const r = saved.get(division);
    return r ? { division, monthlyBudget: Number(r.monthly_budget), version: r.version } : { division, monthlyBudget: 0, version: 0 };
  });
}

/** Share of the budget used and what is left (negative when over); null without a budget. */
export function budgetStatus(spent: number, budget: number): { usedPct: number; left: number; over: boolean } | null {
  if (budget <= 0) return null;
  return { usedPct: (spent / budget) * 100, left: budget - spent, over: spent > budget };
}
