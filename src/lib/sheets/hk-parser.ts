import { cellNumber, cellText, headerKey, type RawCell } from "./cell";
import type { SheetRow } from "./dml-parser";
import { dateInMonth, daysInMonth, parseMonthName, previousMonth } from "./month-name";

/**
 * Housekeeping inventory Google Sheet ("Daily Opname HK"):
 * - one stock tab per month, named after the month ("Nov 2026"): No Art |
 *   Description | Unit | Content | Stock Awal | IN | Out | Stock Akhir, then per
 *   day a triple In | Out | Digunakan (Di mana);
 * - a price tab: the VHP "STOCK ARTICLE LIST" export (ArtNo … Average-Price).
 * Stock value = stock × VHP Average-Price (price per D-Unit, the unit the stock
 * tab counts in).
 */

interface HkItem {
  rowNo: number;
  itemCode: string;
  itemName: string;
  unit: string | null;
  content: number | null;
  stockAwal: number | null;
  totalIn: number | null;
  totalOut: number | null;
  stockAkhir: number | null;
  averagePrice: number | null;
  lastPrice: number | null;
  stockValue: number | null;
}

interface HkMovement {
  itemCode: string;
  day: number;
  /** ISO date of the movement inside its month tab. */
  date: string;
  qtyIn: number | null;
  qtyOut: number | null;
  location: string | null;
}

export interface HkMonth {
  /** "YYYY-MM" from the tab name. */
  month: string;
  sheetName: string;
  items: HkItem[];
  movements: HkMovement[];
  warnings: string[];
  stats: { itemCount: number; pricedCount: number; totalValue: number };
}

export interface HkParseResult {
  priceSheet: string | null;
  months: HkMonth[];
  /** Problems not tied to one month, e.g. a missing price list. */
  warnings: string[];
}

const ITEM_CODE = /^\d{5,}$/;

/**
 * How many units the HK staff count per VHP price unit. An item named "Gula Sachet @250sac /pack" is
 * priced per pack in VHP, but HK may count the sachets: then a month's IN is a whole number of packs
 * in sachets (250, 500) or the stock reaches a pack's content, which no HK store holds in packs
 * (Nov 2026: IN 250 while the hotel bought 4 packs). Otherwise the count is in packs (Nescafe @60sac:
 * IN 12, stock 0–1).
 */
export function piecesCounted(name: string, totalIn: number | null, stockAwal: number | null, stockAkhir: number | null): number {
  const n = Number(/@\s*(\d+)\s*sac/i.exec(name)?.[1] ?? 1);
  if (!(n > 1)) return 1;
  const inWholePacks = (totalIn ?? 0) > 0 && (totalIn ?? 0) % n === 0;
  const stockOverPack = Math.max(stockAwal ?? 0, stockAkhir ?? 0) >= n;
  return inWholePacks || stockOverPack ? n : 1;
}

interface StockLayout {
  headerRow: number;
  days: { day: number; col: number }[];
}

function findStockLayout(rows: SheetRow[]): StockLayout | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const v = rows[i].values;
    if (headerKey(v[5]) !== "awal" || headerKey(v[8]) !== "akhir") continue;
    // Day numbers sit on the first header row, above "Awal/Akhir".
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      const top = rows[j].values;
      if (cellNumber(top[9]).kind !== "number") continue;
      const days: { day: number; col: number }[] = [];
      for (let col = 9; col < top.length; col += 3) {
        const d = cellNumber(top[col]);
        if (d.kind !== "number" || !Number.isInteger(d.value) || d.value < 1 || d.value > 31) break;
        days.push({ day: d.value, col });
      }
      return { headerRow: rows[i].number, days };
    }
    return { headerRow: rows[i].number, days: [] };
  }
  return null;
}

interface PriceColumns {
  headerRow: number;
  average: number;
  last: number | null;
}

function findPriceColumns(rows: SheetRow[]): PriceColumns | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const keys = Array.from(rows[i].values, headerKey);
    if (keys[1] !== "artno") continue;
    const average = keys.indexOf("average-price");
    if (average < 0) continue;
    const last = keys.indexOf("last p-price");
    return { headerRow: rows[i].number, average, last: last < 0 ? null : last };
  }
  return null;
}

function codeOf(v: RawCell): string | null {
  const t = cellText(v);
  return ITEM_CODE.test(t) ? t : null;
}

type PriceMap = Map<string, { average: number | null; last: number | null }>;

function readPrices(rows: SheetRow[], cols: PriceColumns): PriceMap {
  const prices: PriceMap = new Map();
  for (const row of rows) {
    if (row.number <= cols.headerRow) continue;
    const code = codeOf(row.values[1]);
    if (!code) continue;
    const avg = cellNumber(row.values[cols.average]);
    const last = cols.last === null ? null : cellNumber(row.values[cols.last]);
    prices.set(code, {
      average: avg.kind === "number" ? avg.value : null,
      last: last && last.kind === "number" ? last.value : null,
    });
  }
  return prices;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6;

function parseStockTab(
  sheetName: string,
  month: string,
  rows: SheetRow[],
  layout: StockLayout,
  prices: PriceMap | null,
): HkMonth {
  const warnings: string[] = [];
  const items: HkItem[] = [];
  const movements: HkMovement[] = [];
  const lastDay = daysInMonth(month);

  for (const row of rows) {
    if (row.number <= layout.headerRow) continue;
    const v = row.values;
    const code = codeOf(v[1]);
    if (!code) continue;
    const itemName = cellText(v[2]);
    const where = `Baris ${row.number} (${code} ${itemName})`;

    const num = (col: number, label: string): number | null => {
      const c = cellNumber(v[col]);
      if (c.kind === "number") return c.value;
      if (c.kind === "invalid") warnings.push(`${where}: kolom ${label} berisi "${c.text}".`);
      return null;
    };
    const stockAwal = num(5, "Stock Awal");
    const totalIn = num(6, "IN");
    const totalOut = num(7, "Out");
    const stockAkhir = num(8, "Stock Akhir");

    if (stockAkhir !== null && totalIn !== null && totalOut !== null) {
      const expected = (stockAwal ?? 0) + totalIn - totalOut;
      if (!close(expected, stockAkhir)) {
        warnings.push(`${where}: Stock Akhir ${stockAkhir}, seharusnya awal + IN − Out = ${expected}.`);
      }
    }

    let dailyIn = 0;
    let dailyOut = 0;
    for (const { day, col } of layout.days) {
      const qtyIn = num(col, `In tgl ${day}`);
      const qtyOut = num(col + 1, `Out tgl ${day}`);
      const location = cellText(v[col + 2]) || null;
      if (qtyIn === null && qtyOut === null && location === null) continue;
      if (day > lastDay) {
        warnings.push(`${where}: ada isian tanggal ${day}, padahal ${month} hanya ${lastDay} hari (tidak dihitung).`);
        continue;
      }
      dailyIn += qtyIn ?? 0;
      dailyOut += qtyOut ?? 0;
      movements.push({ itemCode: code, day, date: dateInMonth(month, day), qtyIn, qtyOut, location });
    }
    if (totalIn !== null && !close(totalIn, dailyIn)) warnings.push(`${where}: IN ${totalIn}, jumlah harian ${dailyIn}.`);
    if (totalOut !== null && !close(totalOut, dailyOut)) warnings.push(`${where}: Out ${totalOut}, jumlah harian ${dailyOut}.`);

    const p = prices?.get(code);
    if (prices && !p) warnings.push(`${where}: tidak ada di daftar harga VHP.`);
    // VHP prices a pack; staff may count the sachets inside it (see piecesCounted).
    const pieces = piecesCounted(itemName, totalIn, stockAwal, stockAkhir);
    const averagePrice = p?.average != null ? p.average / pieces : null;
    items.push({
      rowNo: row.number,
      itemCode: code,
      itemName,
      unit: cellText(v[3]) || null,
      content: num(4, "Content"),
      stockAwal,
      totalIn,
      totalOut,
      stockAkhir,
      averagePrice,
      lastPrice: p?.last != null ? p.last / pieces : null,
      stockValue: stockAkhir !== null && averagePrice !== null ? stockAkhir * averagePrice : null,
    });
  }

  const priced = items.filter((i) => i.stockValue !== null);
  return {
    month,
    sheetName,
    items,
    movements,
    warnings,
    stats: {
      itemCount: items.length,
      pricedCount: priced.length,
      totalValue: priced.reduce((s, i) => s + (i.stockValue ?? 0), 0),
    },
  };
}

export function parseHkWorkbook(sheets: Map<string, SheetRow[]>): HkParseResult {
  let price: { name: string; rows: SheetRow[]; cols: PriceColumns } | null = null;
  const stockTabs: { name: string; rows: SheetRow[]; layout: StockLayout }[] = [];
  for (const [name, rows] of sheets) {
    const layout = findStockLayout(rows);
    if (layout) {
      stockTabs.push({ name, rows, layout });
      continue;
    }
    if (!price) {
      const cols = findPriceColumns(rows);
      if (cols) price = { name, rows, cols };
    }
  }
  if (stockTabs.length === 0) throw new Error('Tab stok HK tidak ditemukan (butuh header "Stock Awal" … "Stock Akhir").');

  const unnamed = stockTabs.filter((t) => parseMonthName(t.name) === null).map((t) => `"${t.name}"`);
  if (unnamed.length > 0) {
    throw new Error(`Tab stok HK ${unnamed.join(", ")} harus dinamai bulannya, mis. "Nov 2026".`);
  }

  const warnings: string[] = [];
  if (!price) warnings.push("Daftar harga VHP (STOCK ARTICLE LIST) tidak ditemukan: nilai stok tidak bisa dihitung.");
  const prices = price ? readPrices(price.rows, price.cols) : null;

  const months = stockTabs
    .map((t) => parseStockTab(t.name, parseMonthName(t.name)!, t.rows, t.layout, prices))
    .sort((a, b) => a.month.localeCompare(b.month));

  const seen = new Map<string, string>();
  for (const m of months) {
    const dup = seen.get(m.month);
    if (dup) throw new Error(`Tab "${dup}" dan "${m.sheetName}" sama-sama bulan ${m.month}.`);
    seen.set(m.month, m.sheetName);
  }

  // Opening stock of a month should be the previous month's closing stock.
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const m of months) {
    const prev = byMonth.get(previousMonth(m.month));
    if (!prev) continue;
    const prevClose = new Map(prev.items.map((i) => [i.itemCode, i.stockAkhir]));
    for (const item of m.items) {
      const before = prevClose.get(item.itemCode);
      if (before === undefined || before === null) continue;
      if (!close(before, item.stockAwal ?? 0)) {
        m.warnings.push(
          `${item.itemCode} ${item.itemName}: Stock Awal ${item.stockAwal ?? 0}, Stock Akhir ${prev.sheetName} ${before}.`,
        );
      }
    }
  }

  return { priceSheet: price?.name ?? null, months, warnings };
}
