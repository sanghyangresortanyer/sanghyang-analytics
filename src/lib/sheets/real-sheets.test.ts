import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDmlSheet, parseDmlSheetDate } from "./dml-parser";
import { parseHkWorkbook } from "./hk-parser";
import { readWorkbookRows } from "./workbook-reader";
import { hkLedger } from "../dashboard/hk-ledger";

// Exports of the live Google Sheets (gitignored business data, downloaded 2026-11-17).
// Skipped on a clean clone or CI instead of failing.
const dir = path.resolve(__dirname, "../../../fixtures/arsip/2026-11-17/sheets");
const dmlPath = path.join(dir, "dml.xlsx");
const hkPath = path.join(dir, "hk.xlsx");

describe("Google Sheets asli", () => {
  (fs.existsSync(dmlPath) ? it : it.skip)(
    "DML 15-11-26: subtotal tiap outlet dan grand total cocok dengan sheet",
    async () => {
      const rows = await readWorkbookRows(fs.readFileSync(dmlPath), (n) => n === "15-11-26");
      const sheet = parseDmlSheet("15-11-26", rows.get("15-11-26")!);
      expect(sheet.warnings).toEqual([]);
      for (const o of sheet.outlets) expect(o.total).toBe(o.sheetSubtotal);
      expect(sheet.outlets.map((o) => o.outlet)).toEqual([
        "MAIN KITCHEN", "BISTRO", "MAIN STORE", "SUNSET GRILL", "HOUSEKEEPING", "ENGINEERING", "MR",
      ]);
      // The sheet's grand total covers the six outlets; MR sits below it.
      expect(sheet.sheetGrandTotal).toBe(42246124);
      expect(sheet.totalRequest - 9303000).toBe(42246124);
    },
    120_000,
  );

  (fs.existsSync(dmlPath) ? it : it.skip)(
    "DML: semua sheet bertanggal terbaca tanpa galat",
    async () => {
      const rows = await readWorkbookRows(fs.readFileSync(dmlPath), (n) => parseDmlSheetDate(n) !== null);
      const sheets = [...rows].map(([n, r]) => parseDmlSheet(n, r));
      expect(sheets.length).toBeGreaterThanOrEqual(50);
      expect(sheets.every((s) => s.lines.length > 0)).toBe(true);
    },
    120_000,
  );

  (fs.existsSync(hkPath) ? it : it.skip)("HK: semua item punya harga VHP, stok akhir dan total harian konsisten", async () => {
    // The fixture predates the monthly tab names; the user renames "Sheet1" to "Nov 2026".
    const sheets = await readWorkbookRows(fs.readFileSync(hkPath), () => true);
    const renamed = new Map([...sheets].map(([name, rows]) => [name === "Sheet1" ? "Nov 2026" : name, rows]));
    const result = parseHkWorkbook(renamed);
    expect(result.warnings).toEqual([]);
    expect(result.months).toHaveLength(1);
    const nov = result.months[0];
    expect(nov.warnings).toEqual([]);
    expect(nov.stats.itemCount).toBeGreaterThan(200);
    expect(nov.stats.pricedCount).toBe(nov.stats.itemCount);
    expect(nov.movements.every((m) => m.date.startsWith("2026-11-"))).toBe(true);
  }, 60_000);

  (fs.existsSync(hkPath) ? it : it.skip)("HK: stok yang dihitung ulang per tanggal sama dengan Stock Akhir sheet", async () => {
    const sheets = await readWorkbookRows(fs.readFileSync(hkPath), () => true);
    const renamed = new Map([...sheets].map(([name, rows]) => [name === "Sheet1" ? "Nov 2026" : name, rows]));
    const nov = parseHkWorkbook(renamed).months[0];
    const items = nov.items.map((i) => ({
      period_month: "2026-11-01",
      item_code: i.itemCode,
      item_name: i.itemName,
      unit: i.unit,
      stock_awal: i.stockAwal,
      total_in: i.totalIn,
      total_out: i.totalOut,
      stock_akhir: i.stockAkhir,
      average_price: i.averagePrice,
      stock_value: i.stockValue,
    }));
    const movements = nov.movements.map((m) => ({
      period_month: "2026-11-01",
      movement_date: m.date,
      item_code: m.itemCode,
      day: m.day,
      qty_in: m.qtyIn,
      qty_out: m.qtyOut,
      location: m.location,
    }));
    const ledger = hkLedger(items, movements, "2026-11-01", "2026-11-30");
    for (const i of nov.items) {
      expect(ledger.items.find((l) => l.itemCode === i.itemCode)?.closing).toBe(i.stockAkhir ?? 0);
    }
    expect(Math.round(ledger.closingValue!)).toBe(Math.round(nov.stats.totalValue));
    // Gula Sachet @250sac is counted in sachets: valued per sachet, not per pack (was 14,359,748).
    expect(Math.round(ledger.outValue)).toBe(5_497_949);
  }, 60_000);
});
