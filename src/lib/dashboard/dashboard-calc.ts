import type { DmlSheetSummary, HkItemRow, HkMovementRow } from "@/lib/sheets/queries";
import { mrOutletFor, outletKey, revenueOutletFor } from "./outlet-match";

export interface DashboardOutletUsage {
  location: string;
  totalCost: number;
  itemCount: number;
}

export interface DashboardDmlOutletPurchase {
  outlet: string;
  totalAmount: number;
  lineCount: number;
}

export interface MrLineSummary {
  sheet_name: string;
  purchase_channel: string | null;
  total: number | null;
}

/** DML lists dated inside the meeting period. No sheet in the period means no DML figure, never another period's. */
export function dmlSheetsInPeriod(sheets: DmlSheetSummary[], periodStart: string, periodEnd: string): DmlSheetSummary[] {
  return sheets
    .filter((s) => s.list_date >= periodStart && s.list_date <= periodEnd)
    .sort((a, b) => a.list_date.localeCompare(b.list_date));
}

/**
 * Purchase requests per outlet over the given DML sheets. The MR section is split
 * by its "Bagian dept" column (read into purchase_channel) when its lines are known.
 */
export function calculateDmlPurchases(
  sheets: DmlSheetSummary[],
  mrLines: MrLineSummary[],
): { purchases: DashboardDmlOutletPurchase[]; total: number } {
  const outletMap = new Map<string, { totalAmount: number; lineCount: number }>();
  const add = (outlet: string, amount: number, lines: number) => {
    const cur = outletMap.get(outlet) ?? { totalAmount: 0, lineCount: 0 };
    cur.totalAmount += amount;
    cur.lineCount += lines;
    outletMap.set(outlet, cur);
  };

  for (const s of sheets) {
    for (const o of s.outlets ?? []) {
      const sheetMrLines = o.outlet === "MR" ? mrLines.filter((l) => l.sheet_name === s.sheet_name) : [];
      if (sheetMrLines.length === 0) {
        add(o.outlet, o.total, o.lineCount);
        continue;
      }
      // Lines with an unreadable Total are left out here exactly as in the section total.
      for (const line of sheetMrLines) add(mrOutletFor(line.purchase_channel), line.total ?? 0, 1);
    }
  }

  const purchases = [...outletMap.entries()]
    .map(([outlet, d]) => ({ outlet, totalAmount: Math.round(d.totalAmount), lineCount: d.lineCount }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
  return { purchases, total: purchases.reduce((sum, p) => sum + p.totalAmount, 0) };
}

/**
 * Misspellings found in the HK sheet's "Di mana" column (Nov 2026 tab), mapped to the
 * spelling used elsewhere in the same column. Add a pair only when it appears in the sheet.
 */
const HK_LOCATION_TYPOS: Record<string, string> = {
  kitcheb: "Kitchen",
  krakata: "Krakatau",
};

/** Label for HK Out entries whose "Di mana" cell was left empty: the goods did go out. */
export const NO_LOCATION = "Lokasi tidak diisi";

/** One place as the HK staff wrote it, with case, spacing and known typos folded. */
export function hkLocationLabel(raw: string | null): { key: string; label: string } {
  const label = (raw ?? "").trim().replace(/\s+/g, " ") || NO_LOCATION;
  const fixed = HK_LOCATION_TYPOS[label.toLowerCase()] ?? label;
  return { key: outletKey(fixed), label: fixed };
}

/**
 * The places one "Di mana" entry stands for, each with its share of the entry. A combined entry
 * ("SRD & BC", "SPA & SG") is split equally between its places (user rule 2026-11-18).
 */
export function hkLocationShares(raw: string | null): { key: string; label: string; share: number }[] {
  const parts = (raw ?? "").split("&").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [{ ...hkLocationLabel(raw), share: 1 }];
  return parts.map((p) => ({ ...hkLocationLabel(p), share: 1 / parts.length }));
}

/**
 * HK usage cost (Out × VHP average price) per "Di mana" location. Locations that
 * differ only in case, spacing or a known typo are one place; combined entries are split. Out entries for items
 * without a price are counted in `unpricedEntries`, not valued at 0.
 */
export function calculateHkLocationUsage(
  items: HkItemRow[],
  movements: HkMovementRow[],
  shares: (raw: string | null) => { key: string; label: string; share: number }[] = hkLocationShares,
): { locations: DashboardOutletUsage[]; unpricedEntries: number } {
  const price = new Map(items.map((i) => [i.item_code, i.average_price]));
  const groups = new Map<string, { label: string; totalCost: number; items: Set<string> }>();
  let unpricedEntries = 0;

  for (const m of movements) {
    if (!m.qty_out) continue;
    const p = price.get(m.item_code);
    if (p === null || p === undefined) {
      unpricedEntries += 1;
      continue;
    }
    for (const { key, label, share } of shares(m.location)) {
      const g = groups.get(key) ?? { label, totalCost: 0, items: new Set<string>() };
      g.totalCost += m.qty_out * p * share;
      g.items.add(m.item_code);
      groups.set(key, g);
    }
  }

  const locations = [...groups.values()]
    .map((g) => ({ location: g.label, totalCost: Math.round(g.totalCost), itemCount: g.items.size }))
    .sort((a, b) => b.totalCost - a.totalCost);
  return { locations, unpricedEntries };
}

export interface InventoryDepartment {
  key: string;
  name: string;
  /** Where the department's stock comes from, e.g. "Google Sheets HK". */
  source: string;
  connected: boolean;
  /** Stock value at the end of the period; null when the source has no figure for it. */
  stock: number | null;
  /** Goods taken out during the period, at average price. */
  usage: number | null;
  /** Usage per destination ("dipakai untuk"), largest first. */
  usageBy: DashboardOutletUsage[];
}

export interface InventoryOverview {
  departments: InventoryDepartment[];
  stockTotal: number | null;
  usageTotal: number | null;
  /** Departments listed but without data, shown instead of being counted as 0. */
  notConnected: string[];
}

/** Global stock and usage = sum of the inventory departments that have figures. */
export function inventoryOverview(departments: InventoryDepartment[]): InventoryOverview {
  const sum = (pick: (d: InventoryDepartment) => number | null) => {
    const values = departments.map(pick).filter((v): v is number => v !== null);
    return values.length ? values.reduce((s, v) => s + v, 0) : null;
  };
  return {
    departments,
    stockTotal: sum((d) => (d.connected ? d.stock : null)),
    usageTotal: sum((d) => (d.connected ? d.usage : null)),
    notConnected: departments.filter((d) => !d.connected).map((d) => d.name),
  };
}

export interface RevenueOutletRow {
  outlet_name: string;
  revenue_amount: number;
  revenue_qty: number;
  revenue_share_pct: number;
  inventory_amount: number | null;
  prev_revenue_amount: number | null;
  revenue_available?: boolean;
}

/**
 * Folds outlets listed in REVENUE_OUTLET_MERGE into their target and recomputes
 * each share from the merged amounts. Returns which outlets were folded where.
 */
export function mergeRevenueOutlets<T extends RevenueOutletRow>(
  outlets: T[],
): { outlets: T[]; merged: { target: string; sources: string[] }[] } {
  const byName = new Map<string, T>();
  const sources = new Map<string, string[]>();
  const addNullable = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

  for (const o of outlets) {
    const target = revenueOutletFor(o.outlet_name);
    if (target !== o.outlet_name) sources.set(target, [...(sources.get(target) ?? []), o.outlet_name]);
    const cur = byName.get(outletKey(target));
    if (!cur) {
      byName.set(outletKey(target), { ...o, outlet_name: target });
      continue;
    }
    cur.revenue_amount += o.revenue_amount;
    cur.revenue_qty += o.revenue_qty;
    if (cur.revenue_available === false || o.revenue_available === false) {
      cur.revenue_available = cur.revenue_available !== false || o.revenue_available !== false;
    }
    cur.inventory_amount = addNullable(cur.inventory_amount, o.inventory_amount);
    cur.prev_revenue_amount = addNullable(cur.prev_revenue_amount, o.prev_revenue_amount);
  }

  const total = [...byName.values()].reduce((s, o) => s + o.revenue_amount, 0);
  const merged = [...byName.values()]
    .map((o) => ({ ...o, revenue_share_pct: total > 0 ? (o.revenue_amount / total) * 100 : 0 }))
    .sort((a, b) => b.revenue_amount - a.revenue_amount);
  return { outlets: merged, merged: [...sources].map(([target, s]) => ({ target, sources: s })) };
}
