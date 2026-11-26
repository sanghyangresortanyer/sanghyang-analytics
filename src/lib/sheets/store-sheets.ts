import { cellNumber, cellText, headerKey } from "./cell";
import type { SheetRow } from "./dml-parser";
import { findPriceColumns, findStockLayout, readPrices, type HkItem, type HkMonth, type HkMovement, type HkParseResult, type PriceMap } from "./hk-parser";
import { dateInMonth, daysInMonth, parseMonthName, previousMonth } from "./month-name";

/**
 * The stock sheets besides HK (study 26 Nov 2026, data/raw/sheets_20261126):
 * - Main Store and Engineering: the HK layout in a tab named "Sheet1" (not a month);
 *   Engineering has no VHP price tab of its own.
 * - Beverages: tab "LH" (the beverage store) with SAW | Total IN | Total TF | SAK and per day
 *   IN | BAR | DBC | SG | Bistro | SAK; the outlet tabs DBC/Dbar/SG were empty in November.
 */

const ITEM_CODE = /^\d{5,}$/;
const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** Days at the start of a month in which a tab with later days is still last month's (before the team starts the new one). */
const NEW_MONTH_GRACE_DAYS = 7;

/**
 * Month of a stock tab that is not named after one: the running month, unless today is in the first
 * week of a month and the tab has days later than today, i.e. it is still last month's tab.
 * Later in the month a day after today is an entry written ahead (26 Nov 2026: the Main Store tab
 * already had day 27), not last month.
 */
export function monthForUnnamedTab(lastFilledDay: number | null, today: string): string {
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  return day <= NEW_MONTH_GRACE_DAYS && lastFilledDay !== null && lastFilledDay > day ? previousMonth(month) : month;
}

/** Entries on days after today, in the running month: the team should check them. */
function aheadWarning(month: string, lastFilledDay: number | null, today: string): string[] {
  if (month !== today.slice(0, 7) || lastFilledDay === null || lastFilledDay <= Number(today.slice(8, 10))) return [];
  return [`Ada isian tanggal ${lastFilledDay}, padahal hari ini tanggal ${Number(today.slice(8, 10))}: periksa apakah salah kolom.`];
}

/** Last day of the month with anything written in its In/Out/location columns. */
function lastFilledDay(rows: SheetRow[], days: { day: number; col: number }[], width: number): number | null {
  let last: number | null = null;
  for (const row of rows) {
    if (!ITEM_CODE.test(cellText(row.values[1]))) continue;
    for (const { day, col } of days) {
      const used = Array.from({ length: width }, (_, k) => row.values[col + k]).some((c) => {
        const n = cellNumber(c);
        return n.kind === "number" ? n.value !== 0 : cellText(c) !== "";
      });
      if (used && (last === null || day > last)) last = day;
    }
  }
  return last;
}

/**
 * Gives a month name ("2026-11") to the one stock tab that has none, so the HK reader accepts it,
 * and says so: the team should name the tab after its month, as on the HK sheet.
 */
export function nameUnnamedStockTab(sheets: Map<string, SheetRow[]>, today: string): { sheets: Map<string, SheetRow[]>; warnings: string[] } {
  const unnamed = [...sheets].filter(([name, rows]) => parseMonthName(name) === null && findStockLayout(rows) !== null);
  if (unnamed.length !== 1) return { sheets, warnings: [] };
  const [name, rows] = unnamed[0];
  const layout = findStockLayout(rows)!;
  const last = lastFilledDay(rows, layout.days, 3);
  const month = monthForUnnamedTab(last, today);
  const out = new Map<string, SheetRow[]>();
  for (const [n, r] of sheets) out.set(n === name ? month : n, r);
  return {
    sheets: out,
    warnings: [`Tab "${name}" tidak bernama bulan; dibaca sebagai ${monthLabel(month)}. Ganti nama tab menjadi "${monthLabel(month).replace(/^(\w{3})\w*/, "$1")}".`, ...aheadWarning(month, last, today)],
  };
}

/** Adds a VHP price list from another sheet when this workbook has none (Engineering). */
export function withPriceTab(sheets: Map<string, SheetRow[]>, priceRows: SheetRow[] | null): Map<string, SheetRow[]> {
  if (!priceRows || [...sheets.values()].some((rows) => findPriceColumns(rows) !== null)) return sheets;
  return new Map([...sheets, ["Harga VHP (sheet Main Store)", priceRows]]);
}

/** The VHP price list (STOCK ARTICLE LIST) rows of a workbook, to lend to another one. */
export function priceTabRows(sheets: Map<string, SheetRow[]>): SheetRow[] | null {
  for (const rows of sheets.values()) if (findPriceColumns(rows) !== null) return rows;
  return null;
}

/** Beverage store destinations, in the order of the LH tab's sub-columns. */
const LH_OUTLETS = ["BAR", "DBC", "SG", "Bistro"] as const;

/**
 * The "LH" tab of the Beverages sheet. Stock value uses the VHP average price when the item is in
 * the workbook's price list, else the tab's own "Cont" column, which holds the unit price.
 */
export function parseBeverageStore(sheets: Map<string, SheetRow[]>, today: string): HkParseResult {
  const entry = [...sheets].find(([, rows]) => isLhTab(rows));
  if (!entry) throw new Error('Tab gudang minuman (LH) tidak ditemukan: butuh kolom "SAW", "Total IN", "Total TF", "SAK" dan tujuan BAR/DBC/SG/Bistro.');
  const [sheetName, rows] = entry;
  const header = rows[0].values;
  const days: { day: number; col: number }[] = [];
  for (let col = 10; col < header.length; col++) {
    const d = cellNumber(header[col]);
    if (d.kind === "number" && Number.isInteger(d.value) && d.value >= 1 && d.value <= 31) days.push({ day: d.value, col });
  }
  // A day block is IN (one column before the day number) and the four destinations from the day number on.
  const last = lastFilledDay(rows, days.map((d) => ({ day: d.day, col: d.col - 1 })), 5);
  const month = parseMonthName(sheetName) ?? monthForUnnamedTab(last, today);
  const priceRows = priceTabRows(sheets);
  const prices: PriceMap | null = priceRows ? readPrices(priceRows, findPriceColumns(priceRows)!) : null;
  const lastDay = daysInMonth(month);

  const warnings: string[] = [...(parseMonthName(sheetName) ? [] : [`Tab "${sheetName}" tidak bernama bulan; dibaca sebagai ${monthLabel(month)}.`]), ...aheadWarning(month, last, today)];
  const items: HkItem[] = [];
  const movements: HkMovement[] = [];
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6;

  for (const row of rows) {
    if (row.number <= 4) continue;
    const v = row.values;
    const code = cellText(v[1]);
    if (!ITEM_CODE.test(code)) continue;
    const itemName = cellText(v[2]);
    const where = `Baris ${row.number} (${code} ${itemName})`;
    const num = (col: number, label: string): number | null => {
      const c = cellNumber(v[col]);
      if (c.kind === "number") return c.value;
      if (c.kind === "invalid") warnings.push(`${where}: kolom ${label} berisi "${c.text}".`);
      return null;
    };
    const unitPrice = num(4, "Cont");
    const stockAwal = num(5, "SAW");
    const totalIn = num(6, "Total IN");
    const totalOut = num(7, "Total TF");
    const stockAkhir = num(8, "SAK");
    if (stockAkhir !== null && !close((stockAwal ?? 0) + (totalIn ?? 0) - (totalOut ?? 0), stockAkhir)) {
      warnings.push(`${where}: SAK ${stockAkhir}, seharusnya SAW + IN − TF = ${(stockAwal ?? 0) + (totalIn ?? 0) - (totalOut ?? 0)}.`);
    }

    let dailyIn = 0;
    let dailyOut = 0;
    for (const { day, col } of days) {
      if (day > lastDay) continue;
      const date = dateInMonth(month, day);
      const qtyIn = num(col - 1, `IN tgl ${day}`);
      if (qtyIn) {
        dailyIn += qtyIn;
        movements.push({ itemCode: code, day, date, qtyIn, qtyOut: null, location: null });
      }
      LH_OUTLETS.forEach((outlet, k) => {
        const qty = num(col + k, `${outlet} tgl ${day}`);
        if (!qty) return;
        dailyOut += qty;
        movements.push({ itemCode: code, day, date, qtyIn: null, qtyOut: qty, location: outlet });
      });
    }
    if (totalIn !== null && !close(totalIn, dailyIn)) warnings.push(`${where}: Total IN ${totalIn}, jumlah harian ${dailyIn}.`);
    if (totalOut !== null && !close(totalOut, dailyOut)) warnings.push(`${where}: Total TF ${totalOut}, jumlah harian ${dailyOut}.`);

    const p = prices?.get(code);
    const averagePrice = p?.average ?? unitPrice;
    items.push({
      rowNo: row.number,
      itemCode: code,
      itemName,
      unit: cellText(v[3]) || null,
      content: null,
      stockAwal,
      totalIn,
      totalOut,
      stockAkhir,
      averagePrice,
      lastPrice: p?.last ?? null,
      stockValue: stockAkhir !== null && averagePrice !== null ? stockAkhir * averagePrice : null,
    });
  }

  const missingOpening = items.filter((i) => i.stockAwal === null).length;
  if (missingOpening > 0) warnings.push(`${missingOpening} dari ${items.length} minuman belum ada stok awal (SAW): nilai stok baru dari barang masuk bulan ini.`);
  const priced = items.filter((i) => i.stockValue !== null);
  const result: HkMonth = {
    month,
    sheetName,
    items,
    movements,
    warnings,
    stats: { itemCount: items.length, pricedCount: priced.length, totalValue: priced.reduce((s, i) => s + (i.stockValue ?? 0), 0) },
  };
  return { priceSheet: priceRows ? "Output File" : null, months: [result], warnings: [] };
}

function isLhTab(rows: SheetRow[]): boolean {
  if (rows.length < 3) return false;
  const top = Array.from(rows[0].values, headerKey);
  const third = Array.from(rows[2].values, headerKey);
  return top[5] === "saw" && top[8] === "sak" && third.includes("bar") && third.includes("dbc") && third.includes("bistro");
}

/**
 * Destinations as the Main Store and beverage store write them, to one name per department.
 * Only spellings seen in the sheets (26 Nov 2026) are listed; anything else stays as written.
 */
const STORE_DESTINATIONS: Record<string, string> = {
  kitchen: "Kitchen", kicen: "Kitchen", kichen: "Kitchen", kcen: "Kitchen",
  sg: "Sunset Grill",
  hk: "HK",
  dbc: "DBC",
  bar: "d'Bar", dbar: "d'Bar",
  bistro: "d'Bistro",
  spa: "Spa",
  fo: "Front Office",
  eng: "Engineering",
  scrty: "Security", scurty: "Security", scry: "Security", scty: "Security", scrity: "Security", security: "Security",
  grdr: "Gardener", gardnr: "Gardener", grdnr: "Gardener",
  laudry: "Laundry", laundry: "Laundry",
  marketing: "Marketing",
};

export const NO_DESTINATION = "Tujuan tidak diisi";

function destinationLabel(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!k) return NO_DESTINATION;
  return STORE_DESTINATIONS[k] ?? raw.trim().replace(/\s+/g, " ");
}

/**
 * The departments one store "Out" entry went to, each with its share. "kicen5,sg1" splits by the
 * numbers written after each name (5/6 and 1/6); names without numbers share equally.
 */
export function storeDestinationShares(raw: string | null): { key: string; label: string; share: number }[] {
  const text = (raw ?? "").trim();
  const pairs = [...text.toLowerCase().matchAll(/([a-z][a-z' .]*?)\s*,?\s*(\d+(?:[.,]\d+)?)/g)].map((m) => ({ name: m[1].trim(), qty: Number(m[2].replace(",", ".")) }));
  const total = pairs.reduce((s, p) => s + p.qty, 0);
  const parts =
    pairs.length > 0 && total > 0
      ? pairs.map((p) => ({ label: destinationLabel(p.name), share: p.qty / total }))
      : text.split(/[,&]/).map((p) => p.trim()).filter(Boolean).map((p, _, all) => ({ label: destinationLabel(p), share: 1 / all.length }));
  if (parts.length === 0) return [{ key: NO_DESTINATION.toLowerCase(), label: NO_DESTINATION, share: 1 }];
  const merged = new Map<string, { key: string; label: string; share: number }>();
  for (const p of parts) {
    const key = p.label.toLowerCase();
    const cur = merged.get(key) ?? { key, label: p.label, share: 0 };
    cur.share += p.share;
    merged.set(key, cur);
  }
  return [...merged.values()];
}

/** One stock line worth this much is a typing error, not stock (Engineering "Lem Taco" 46.024 pcs = Rp37 miliar, 26 Nov 2026). */
export const IMPLAUSIBLE_LINE_VALUE = 1_000_000_000;

/**
 * Leaves stock lines worth IMPLAUSIBLE_LINE_VALUE or more out of every Rupiah figure (they count as
 * items without a price) and names them, so one typo cannot inflate the resort's stock.
 */
export function dropImplausibleValues(result: HkParseResult): HkParseResult {
  return {
    ...result,
    months: result.months.map((m) => {
      const bad = m.items.filter((i) => (i.stockValue ?? 0) >= IMPLAUSIBLE_LINE_VALUE);
      if (bad.length === 0) return m;
      const items = m.items.map((i) => (bad.includes(i) ? { ...i, averagePrice: null, lastPrice: null, stockValue: null } : i));
      const priced = items.filter((i) => i.stockValue !== null);
      return {
        ...m,
        items,
        warnings: [
          ...m.warnings,
          ...bad.map((i) => `Baris ${i.rowNo} (${i.itemCode} ${i.itemName}): stok ${i.stockAkhir?.toLocaleString("id-ID")} ${i.unit ?? ""} bernilai Rp${Math.round(i.stockValue!).toLocaleString("id-ID")}, tidak wajar; tidak dihitung sampai dibetulkan di sheet.`),
        ],
        stats: { itemCount: items.length, pricedCount: priced.length, totalValue: priced.reduce((s, i) => s + (i.stockValue ?? 0), 0) },
      };
    }),
  };
}
