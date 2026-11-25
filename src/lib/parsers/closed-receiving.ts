import { parseVhpNumber } from "@/lib/parser/number";
import type { ParsedPurchaseRow, PurchaseParseResult } from "./purchase-receipts";
import { parseVhpDate } from "./vhp-date";

/**
 * VHP "(Closed) Receiving Report" (Inventory → Lists → Closed Inventory List): purchases of months
 * whose stock is already closed. The open "Receiving List by all suppliers" only holds the
 * current month (an export for 01/01–31/10/26 on 19 Nov 2026 returned October only).
 *
 * Layout differs from the open report: the title is "Receiving List -", the supplier is printed
 * on every line and cut to 12 characters, and a "T O T A L" line follows every sub-group:
 *   Date     Supplier     St ArtNo   Description   D-Unit   Price   Quantity   Value Document-No  DeliverNote
 *   01/01/26 CASH ANYER   01 1109048 xxx Chicken…  Pack     48,500      4.00  194,000.00 Direct Pchas I260101001
 */
const DATA_RE = /^\d{2}\/\d{2}\/\d{2}\s/;
const NUMBERS_RE = /^(.*?)\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)\s*$/;

export function isClosedReceivingReport(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  const head = text.slice(0, 3000);
  return /Receiving\s+List\s+-/i.test(head) && /^Date\s+Supplier\s+St\s+ArtNo/m.test(head);
}

/**
 * Reads the closed report. Supplier names are cut to 12 characters by VHP; `knownSuppliers`
 * (full names from open reports) restores them where exactly one known name starts with it.
 */
export function parseClosedReceiving(text: string, knownSuppliers: string[] = []): PurchaseParseResult {
  const lines = text.split(/\r?\n/);
  const header = lines.find((l) => /^Date\s+Supplier\s+St\s+ArtNo/.test(l)) ?? "";
  const at = (label: string) => header.indexOf(label);
  const col = { supplier: at("Supplier"), st: at("St "), art: at("ArtNo"), desc: at("Description"), unit: at("D-Unit"), doc: at("Document-No"), note: at("DeliverNote") };
  const empty: PurchaseParseResult = {
    rows: [],
    warnings: [],
    stats: { totalLineCount: lines.length, nonDataLineCount: lines.length, unreadableCount: 0, rowCount: 0, dateCount: 0, articleCount: 0, supplierCount: 0 },
    fatal: true,
  };
  if (Object.values(col).some((i) => i < 0)) return empty;

  const fullName = (cut: string) => {
    const hits = knownSuppliers.filter((s) => s.toUpperCase().startsWith(cut.toUpperCase()));
    return hits.length === 1 ? hits[0] : cut;
  };
  const rows: ParsedPurchaseRow[] = [];
  const warnings: PurchaseParseResult["warnings"] = [];
  lines.forEach((line, i) => {
    if (!DATA_RE.test(line)) return;
    const businessDate = parseVhpDate(line.slice(0, 8));
    const art = line.slice(col.art, col.desc).trim();
    const nums = NUMBERS_RE.exec(line.slice(col.unit, col.doc));
    if (!businessDate || !/^\d+$/.test(art) || !nums) {
      warnings.push({ lineNo: i + 1, message: `Baris ${i + 1}: format tidak dikenali, dilewati — "${line.slice(0, 60).trim()}"` });
      return;
    }
    const supplier = line.slice(col.supplier, col.st).trim();
    rows.push({
      lineNo: i + 1,
      businessDate,
      ingredientCode: art.padStart(9, "0"),
      description: line.slice(col.desc, col.unit).trim(),
      unit: nums[1].trim(),
      price: parseVhpNumber(nums[2]) ?? 0,
      qty: parseVhpNumber(nums[3]) ?? 0,
      value: parseVhpNumber(nums[4]) ?? undefined,
      supplier: supplier ? fullName(supplier) : null,
      documentNo: line.slice(col.doc, col.note).trim(),
      deliverNote: line.slice(col.note).trim(),
    });
  });
  const dataLines = rows.length + warnings.length;
  return {
    rows,
    warnings,
    stats: {
      totalLineCount: lines.length,
      nonDataLineCount: lines.length - dataLines,
      unreadableCount: warnings.length,
      rowCount: rows.length,
      dateCount: new Set(rows.map((r) => r.businessDate)).size,
      articleCount: new Set(rows.map((r) => r.ingredientCode)).size,
      supplierCount: new Set(rows.map((r) => r.supplier)).size,
    },
    fatal: rows.length === 0,
  };
}
