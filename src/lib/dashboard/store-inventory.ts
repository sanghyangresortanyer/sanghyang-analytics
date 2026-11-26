import type { HkItemRow, HkMovementRow } from "@/lib/sheets/queries";
import { storeDestinationShares } from "@/lib/sheets/store-sheets";
import { calculateHkLocationUsage, type DashboardOutletUsage } from "./dashboard-calc";
import { hkLedger } from "./hk-ledger";

export interface StoreFigures {
  /** Stock value at the end of the period; null when the period's month has no tab. */
  stock: number | null;
  /** Value taken out in the period, without goods moved into another connected store. */
  usage: number | null;
  /** Value sent to another connected store in the period (counted there when it is used). */
  transferred: number;
  usageBy: DashboardOutletUsage[];
}

/**
 * Stock and usage of one store sheet (Main Store, Engineering, beverage store) for a period.
 * Goods the Main Store sends to HK that HK also keeps in stock are a move between two stores,
 * not a use: they leave `usage` (HK counts them when it uses them) and show in `transferred`.
 * Study 26 Nov 2026: Main Store sent 500 Shower Caps to HK, HK recorded 200 in.
 */
export function storeFigures(
  items: HkItemRow[],
  movements: HkMovementRow[],
  start: string,
  end: string,
  movedInto: { destination: string; codes: Set<string> }[] = [],
): StoreFigures | null {
  if (items.length === 0) return null;
  const ledger = hkLedger(items, movements, start, end);
  const inPeriod = movements.filter((m) => m.movement_date >= start && m.movement_date <= end);
  const usage = calculateHkLocationUsage(items, inPeriod, storeDestinationShares);

  const price = new Map(items.map((i) => [i.item_code, i.average_price]));
  let transferred = 0;
  for (const m of inPeriod) {
    const p = price.get(m.item_code);
    if (!m.qty_out || p === null || p === undefined) continue;
    for (const { label, share } of storeDestinationShares(m.location)) {
      if (movedInto.some((t) => t.destination === label && t.codes.has(m.item_code))) transferred += m.qty_out * p * share;
    }
  }
  return {
    stock: ledger.closingValue === null ? null : Math.round(ledger.closingValue),
    usage: Math.round(ledger.outValue - transferred),
    transferred: Math.round(transferred),
    usageBy: usage.locations,
  };
}
