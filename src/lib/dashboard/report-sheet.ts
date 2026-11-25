import { revenueOutletFor } from "./outlet-match";
import { topMenus } from "./top-menus";

/**
 * Contents of the one-page report for a date range (owner, 2026-11-22): revenue per outlet,
 * purchases, inventory usage per department and outlet, the range's best-selling menus, and the
 * least sold menus of the last 3 months per outlet (owner, 23 Nov). Missing figures stay null
 * ("Belum ada data"), never 0.
 */
export function buildReportSheet(input: {
  from: string;
  to: string;
  outlets: { outlet_name: string; revenue_amount: number; revenue_share_pct: number; revenue_available?: boolean }[];
  totalPurchase: number | null;
  purchaseGroups: { main: string; total: number }[];
  suppliers: { supplier_name: string; purchase_amount: number }[];
  inventory: { name: string; connected: boolean; usage: number | null; usageBy: { location: string; totalCost: number }[] }[];
  outletItems: { outlet_name: string; description: string; total_qty: number; total_amount: number; source?: "journal" | "fo" }[];
  menuActivity: {
    deadFrom: string;
    slowFrom: string;
    lastDay: string;
    deadDays: number;
    slowDays: number;
    least: { outlet: string; description: string; windowQty: number }[];
  } | null;
}) {
  const rows = input.outlets.map((o) => ({
    outlet: o.outlet_name,
    amount: o.revenue_available === false ? null : o.revenue_amount,
    share: o.revenue_available === false ? null : o.revenue_share_pct,
  }));
  const inventoryRows = input.inventory.map((d) => ({
    name: d.name,
    usage: d.connected ? d.usage : null,
    by: d.connected ? d.usageBy.map((u) => ({ location: u.location, amount: u.totalCost })) : [],
  }));
  const usages = inventoryRows.map((r) => r.usage).filter((v): v is number => v !== null);

  const ma = input.menuActivity;
  const inactive = new Map<string, { outlet: string; count: number; examples: string[] }>();
  // Fewest portions first: the three least sold menus of each outlet are the examples.
  for (const m of [...(ma?.least ?? [])].sort((a, b) => a.windowQty - b.windowQty)) {
    const r = inactive.get(m.outlet) ?? inactive.set(m.outlet, { outlet: m.outlet, count: 0, examples: [] }).get(m.outlet)!;
    r.count += 1;
    if (r.examples.length < 3) r.examples.push(`${m.description} (${m.windowQty})`);
  }

  return {
    from: input.from,
    to: input.to,
    revenue: { rows, total: rows.reduce((s, r) => s + (r.amount ?? 0), 0) },
    purchases: {
      total: input.totalPurchase,
      groups: input.purchaseGroups.map((g) => ({ name: g.main, amount: g.total })),
      suppliers: [...input.suppliers]
        .sort((a, b) => b.purchase_amount - a.purchase_amount)
        .slice(0, 5)
        .map((s) => ({ name: s.supplier_name, amount: s.purchase_amount })),
    },
    inventory: { rows: inventoryRows, total: usages.length ? usages.reduce((s, v) => s + v, 0) : null },
    topMenus: topMenus(input.outletItems, 10).map((m) => ({ name: m.description, outlet: revenueOutletFor(m.outlet_name), qty: m.total_qty, amount: m.total_amount })),
    inactive: {
      deadFrom: ma?.deadFrom ?? null,
      slowFrom: ma?.slowFrom ?? null,
      lastDay: ma?.lastDay ?? null,
      deadDays: ma?.deadDays ?? null,
      slowDays: ma?.slowDays ?? null,
      rows: [...inactive.values()].sort((a, b) => a.outlet.localeCompare(b.outlet)),
    },
  };
}

export type ReportSheet = ReturnType<typeof buildReportSheet>;
