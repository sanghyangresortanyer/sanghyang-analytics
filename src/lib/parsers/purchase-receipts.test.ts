import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { parsePurchaseReceipts } from "./purchase-receipts";

const RECEIVING_EXPORT = "fixtures/arsip/2026-09-01_to_2026-09-08/Receive item 1-8 september.txt";
// Business export fixtures are gitignored; skip file-backed checks when absent on CI/clean clones.
const itReceiving = existsSync(RECEIVING_EXPORT) ? it : it.skip;

describe("parsePurchaseReceipts", () => {
  itReceiving("parses the real 1-8 September receiving list", () => {
    const text = readFileSync(RECEIVING_EXPORT, "latin1");
    const result = parsePurchaseReceipts(text);
    expect(result.fatal).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.stats).toEqual({
      totalLineCount: 296, nonDataLineCount: 105, unreadableCount: 0,
      rowCount: 191, dateCount: 8, articleCount: 178, supplierCount: 13,
    });

    const totalQty = result.rows.reduce((sum, r) => sum + r.qty, 0);
    expect(totalQty).toBeCloseTo(7149.3, 1);
    // qty*price only approximates the file's own (separately rounded) Value
    // column — a handful of rows have a price rounded from a fractional unit
    // cost (e.g. 40,000 / 24 -> 1,667, times back 24 -> 40,008), so this is a
    // sanity bound, not an exact match.
    const totalValue = result.rows.reduce((sum, r) => sum + r.qty * r.price, 0);
    expect(Math.abs(totalValue - 65807234)).toBeLessThan(1000);
  });

  itReceiving("keeps duplicate same-day receipts of the same article as separate rows", () => {
    const text = readFileSync(RECEIVING_EXPORT, "latin1");
    const { rows } = parsePurchaseReceipts(text);
    const soju = rows.filter((r) => r.businessDate === "2026-09-01" && r.ingredientCode === "002201161");
    expect(soju).toHaveLength(2);
    expect(soju.reduce((sum, r) => sum + r.qty, 0)).toBe(100);
  });

  itReceiving("pads ArtNo to 9 digits and reads the first row's fields", () => {
    const text = readFileSync(RECEIVING_EXPORT, "latin1");
    const { rows } = parsePurchaseReceipts(text);
    expect(rows[0]).toMatchObject({
      businessDate: "2026-09-03",
      ingredientCode: "003304007",
      description: "Guest Sleeper/Sandal Tamu",
      unit: "Pair",
      price: 1850,
      qty: 1000,
      supplier: "ADAF SAFEER INDONESIA",
      documentNo: "P260831002",
      deliverNote: "I260903005",
    });
  });

  itReceiving("captures Direct Purchase document numbers", () => {
    const text = readFileSync(RECEIVING_EXPORT, "latin1");
    const { rows } = parsePurchaseReceipts(text);
    expect(rows.some((r) => r.documentNo === "Direct Purchase")).toBe(true);
  });

  // Jaminan kelengkapan: tiap baris fisik file jatuh di tepat satu kategori,
  // jadi ringkasan upload tidak bisa kehilangan baris tanpa tercatat.
  itReceiving("accounts for every physical line of the real fixture", () => {
    const { stats } = parsePurchaseReceipts(readFileSync(RECEIVING_EXPORT, "latin1"));
    expect(stats.totalLineCount).toBe(296);
    expect(stats.nonDataLineCount + stats.unreadableCount + stats.rowCount).toBe(stats.totalLineCount);
  });

  it("counts a malformed data line as unreadable, not as furniture", () => {
    const { stats, warnings } = parsePurchaseReceipts("Receiving List\n03/09/26 rusak\n");
    expect(stats).toMatchObject({ totalLineCount: 3, nonDataLineCount: 2, unreadableCount: 1, rowCount: 0 });
    expect(warnings).toHaveLength(1);
    expect(stats.nonDataLineCount + stats.unreadableCount + stats.rowCount).toBe(stats.totalLineCount);
  });

  itReceiving("rejects impossible calendar dates", () => {
    const validLine = readFileSync(RECEIVING_EXPORT, "latin1").split(/\r?\n/).find((line) => /^\d{2}\/\d{2}\/\d{2}\s/.test(line))!;
    const result = parsePurchaseReceipts(validLine.replace(/^\d{2}\/\d{2}\/\d{2}/, "31/02/26"));
    expect(result.rows).toHaveLength(0);
    expect(result.stats.unreadableCount).toBe(1);
  });

  it("returns fatal on unrecognizable input", () => {
    expect(parsePurchaseReceipts("garbage\nmore garbage").fatal).toBe(true);
  });

  const realPembelian = resolve(process.cwd(), "fixtures/arsip/2026-11-01_to_2026-11-14/Pembelian.txt");
  const itRealPembelian = existsSync(realPembelian) ? it : it.skip;
  itRealPembelian("parses real Pembelian.txt with 0 unreadable lines and matches GRAND TOTAL", () => {
    const res = parsePurchaseReceipts(readFileSync(realPembelian, "utf8"));
    expect(res.fatal).toBe(false);
    expect(res.stats.unreadableCount).toBe(0);
    const total = Math.round(res.rows.reduce((s, r) => s + r.price * r.qty, 0));
    expect(Math.abs(total - 113907935)).toBeLessThanOrEqual(50);
  });
});
