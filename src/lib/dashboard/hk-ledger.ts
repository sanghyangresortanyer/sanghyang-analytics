import type { HkItemRow, HkMovementRow } from "@/lib/sheets/queries";
import { daysInMonth, dateInMonth } from "@/lib/sheets/month-name";

/**
 * Housekeeping stock per day, rebuilt from the monthly tabs:
 * stock(item, d) = Stock Awal of d's month + Σ (In − Out) of that month up to d.
 * An empty Stock Awal counts as 0, exactly like the sheet's own "=E+F-G".
 * Quantities are never summed across items (units differ); day totals are in
 * Rupiah at the VHP average price, and items without a price are left out of
 * every Rupiah total and counted in `unpricedItems`.
 */

interface HkLedgerMovement {
  itemCode: string;
  itemName: string;
  unit: string | null;
  qtyIn: number;
  qtyOut: number;
  location: string | null;
}

interface HkLedgerDay {
  date: string;
  inValue: number;
  outValue: number;
  closingValue: number;
  movements: HkLedgerMovement[];
}

interface HkLedgerItem {
  itemCode: string;
  itemName: string;
  unit: string | null;
  averagePrice: number | null;
  /** Stock the day before the period starts; null when that month is not in the sheet. */
  opening: number | null;
  qtyIn: number;
  qtyOut: number;
  /** Stock at the end of the period; null when that month is not in the sheet. */
  closing: number | null;
  closingValue: number | null;
  outValue: number | null;
}

export interface HkLedger {
  start: string;
  end: string;
  days: HkLedgerDay[];
  items: HkLedgerItem[];
  openingValue: number | null;
  inValue: number;
  outValue: number;
  closingValue: number | null;
  /** Months of the period with no tab in the sheet ("2026-12"). */
  missingMonths: string[];
  unpricedItems: number;
}

const monthOf = (date: string) => date.slice(0, 7);

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = monthOf(start).split("-").map(Number);
  const last = monthOf(end);
  for (;;) {
    const cur = `${y}-${String(m).padStart(2, "0")}`;
    out.push(cur);
    if (cur >= last) return out;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
}

export function hkLedger(items: HkItemRow[], movements: HkMovementRow[], start: string, end: string): HkLedger {
  const itemsByMonth = new Map<string, Map<string, HkItemRow>>();
  for (const i of items) {
    const month = monthOf(i.period_month);
    const map = itemsByMonth.get(month) ?? new Map<string, HkItemRow>();
    map.set(i.item_code, i);
    itemsByMonth.set(month, map);
  }
  const movesByDate = new Map<string, HkMovementRow[]>();
  for (const mv of movements) {
    const list = movesByDate.get(mv.movement_date) ?? [];
    list.push(mv);
    movesByDate.set(mv.movement_date, list);
  }

  const months = monthsBetween(start, end);
  const missingMonths = months.filter((m) => !itemsByMonth.has(m));

  // Latest known description and price per item across the months in view.
  const info = new Map<string, { itemName: string; unit: string | null; price: number | null }>();
  for (const m of months) {
    for (const i of itemsByMonth.get(m)?.values() ?? []) {
      info.set(i.item_code, { itemName: i.item_name, unit: i.unit, price: i.average_price });
    }
  }

  const totals = new Map<string, { opening: number | null; qtyIn: number; qtyOut: number; closing: number | null }>();
  const total = (code: string) => {
    const t = totals.get(code) ?? { opening: null, qtyIn: 0, qtyOut: 0, closing: null };
    totals.set(code, t);
    return t;
  };
  const days: HkLedgerDay[] = [];

  for (const month of months) {
    const monthItems = itemsByMonth.get(month);
    if (!monthItems) continue;
    const stock = new Map<string, number>([...monthItems.values()].map((i) => [i.item_code, i.stock_awal ?? 0]));

    for (let day = 1; day <= daysInMonth(month); day++) {
      const date = dateInMonth(month, day);
      if (date > end) break;
      const inPeriod = date >= start;
      if (date === start) for (const [code, qty] of stock) total(code).opening = qty;

      const dayMoves: HkLedgerMovement[] = [];
      let inValue = 0;
      let outValue = 0;
      for (const mv of movesByDate.get(date) ?? []) {
        if (!monthItems.has(mv.item_code)) continue;
        const qtyIn = mv.qty_in ?? 0;
        const qtyOut = mv.qty_out ?? 0;
        stock.set(mv.item_code, (stock.get(mv.item_code) ?? 0) + qtyIn - qtyOut);
        if (!inPeriod) continue;
        const it = info.get(mv.item_code);
        const t = total(mv.item_code);
        t.qtyIn += qtyIn;
        t.qtyOut += qtyOut;
        if (it?.price != null) {
          inValue += qtyIn * it.price;
          outValue += qtyOut * it.price;
        }
        dayMoves.push({
          itemCode: mv.item_code,
          itemName: it?.itemName ?? mv.item_code,
          unit: it?.unit ?? null,
          qtyIn,
          qtyOut,
          location: mv.location,
        });
      }
      if (!inPeriod) continue;

      let closingValue = 0;
      for (const [code, qty] of stock) {
        const price = info.get(code)?.price;
        if (price != null) closingValue += qty * price;
      }
      if (date === end) for (const [code, qty] of stock) total(code).closing = qty;
      days.push({ date, inValue, outValue, closingValue, movements: dayMoves });
    }
  }

  const itemRows: HkLedgerItem[] = [...info.entries()]
    .map(([itemCode, it]) => {
      const t = totals.get(itemCode) ?? { opening: null, qtyIn: 0, qtyOut: 0, closing: null };
      const priced = it.price != null;
      return {
        itemCode,
        itemName: it.itemName,
        unit: it.unit,
        averagePrice: it.price,
        opening: t.opening,
        qtyIn: t.qtyIn,
        qtyOut: t.qtyOut,
        closing: t.closing,
        closingValue: priced && t.closing !== null ? t.closing * it.price! : null,
        outValue: priced ? t.qtyOut * it.price! : null,
      };
    })
    .sort((a, b) => (b.closingValue ?? 0) - (a.closingValue ?? 0));

  const startCovered = itemsByMonth.has(monthOf(start));
  const endCovered = itemsByMonth.has(monthOf(end));
  const sumValue = (pick: (i: HkLedgerItem) => number | null) =>
    itemRows.reduce((s, i) => (i.averagePrice != null && pick(i) !== null ? s + pick(i)! * i.averagePrice : s), 0);

  return {
    start,
    end,
    days,
    items: itemRows,
    openingValue: startCovered ? sumValue((i) => i.opening) : null,
    inValue: days.reduce((s, d) => s + d.inValue, 0),
    outValue: days.reduce((s, d) => s + d.outValue, 0),
    closingValue: endCovered ? sumValue((i) => i.closing) : null,
    missingMonths,
    unpricedItems: itemRows.filter((i) => i.averagePrice == null).length,
  };
}
