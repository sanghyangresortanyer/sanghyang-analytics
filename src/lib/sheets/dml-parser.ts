import { cellNumber, cellText, headerKey, type RawCell } from "./cell";

/**
 * Daily Market List (DML) Google Sheet: one sheet per list date ("15-11-26"),
 * split into outlet sections (MAIN KITCHEN, BISTRO, MAIN STORE, SUNSET GRILL,
 * HOUSEKEEPING, ENGINEERING, …). Each section is a label row, a header row
 * ("No Art | Description | D-Unit | Price | SOH | Qty Req | <Total> |
 * Pembelanjaan"), item rows, and a subtotal row holding only the Total column.
 * A summary block after the sections ends in a grand total row.
 */

export interface SheetRow {
  number: number;
  /** exceljs row.values: index 0 unused, column A is index 1. */
  values: RawCell[];
}

interface DmlLine {
  rowNo: number;
  outlet: string;
  itemCode: string | null;
  itemName: string;
  unit: string | null;
  price: number | null;
  soh: number | null;
  qtyReq: number | null;
  /** Price × Qty Req as written in the sheet; null when the cell is empty or broken. */
  total: number | null;
  purchaseChannel: string | null;
  note: string | null;
}

export interface DmlOutletTotal {
  outlet: string;
  /** Sum of the line totals that could be read. */
  total: number;
  lineCount: number;
  /** The section's own subtotal row; null when the section has none. */
  sheetSubtotal: number | null;
}

export interface DmlSheet {
  sheetName: string;
  listDate: string;
  lines: DmlLine[];
  outlets: DmlOutletTotal[];
  totalRequest: number;
  sheetGrandTotal: number | null;
  warnings: string[];
}

const OUTLET_ALIASES: Record<string, string> = {
  "SUNSET GRIL": "SUNSET GRILL",
  // Sheets up to mid-2026 label the Bistro section "D'BISTRO".
  "D'BISTRO": "BISTRO",
  MAINKITCHEN: "MAIN KITCHEN",
  MAINSTORE: "MAIN STORE",
};

const NO_SECTION = "(Tanpa nama seksi)";

function normalizeOutlet(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().toUpperCase();
  return OUTLET_ALIASES[name] ?? name;
}

/** "15-11-26" → "2026-11-15"; "DML 16-11-25", "19-04-2026" also accepted. */
export function parseDmlSheetDate(sheetName: string): string | null {
  const m = /^(?:DML\s+)?(\d{2})-(\d{2})-(\d{2}|\d{4})$/i.exec(sheetName.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface ColumnMap {
  code: number;
  name: number;
  unit: number | null;
  price: number;
  soh: number | null;
  qty: number;
  total: number;
  channel: number | null;
}

function readHeader(values: RawCell[]): ColumnMap | null {
  // exceljs rows are sparse arrays; Array.from fills the holes so indexes stay column numbers.
  const keys = Array.from(values, headerKey);
  const name = keys.indexOf("description");
  const qty = keys.findIndex((k) => /^qty ?req/.test(k));
  const price = keys.indexOf("price");
  if (name < 1 || qty < 0 || price < 0) return null;
  const idx = (pred: (k: string) => boolean) => {
    const i = keys.findIndex(pred);
    return i < 0 ? null : i;
  };
  return {
    code: name - 1,
    name,
    unit: idx((k) => k === "d-unit" || k === "unit"),
    price,
    soh: idx((k) => k === "soh"),
    qty,
    // The Total column (Price × Qty Req) sits right after Qty Req; its header
    // cell is often left blank in 2026 sheets.
    total: qty + 1,
    channel: idx((k) => k.startsWith("pembelanjaan") || k.includes("bagian") || k.includes("dept")),
  };
}

/** Columns A–I hold the list; notes further right are ignored when spotting a section label. */
const TABLE_LAST_COLUMN = 9;

/** A row whose non-empty cells in A–I all hold the same upper-case label, e.g. "MAIN KITCHEN", "D'BISTRO", "MR". */
function sectionLabel(values: RawCell[]): string | null {
  const texts = Array.from(values.slice(0, TABLE_LAST_COLUMN + 1), cellText).filter((t) => t !== "");
  if (texts.length === 0) return null;
  const first = texts[0];
  if (!texts.every((t) => t === first)) return null;
  if (!/^[A-Z][A-Z &/.'-]*$/.test(first)) return null;
  return first;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseDmlSheet(sheetName: string, rows: SheetRow[]): DmlSheet {
  const listDate = parseDmlSheetDate(sheetName);
  if (!listDate) throw new Error(`Nama sheet "${sheetName}" bukan tanggal DD-MM-YY.`);

  const warnings: string[] = [];
  const lines: DmlLine[] = [];
  const sections: DmlOutletTotal[] = [];

  let label: { text: string; row: number } | null = null;
  let active: { outlet: string; map: ColumnMap; total: number; lineCount: number } | null = null;
  let lastMap: ColumnMap | null = null;
  let closedTotal = 0;
  let sheetGrandTotal: number | null = null;

  const closeSection = (subtotal: number | null) => {
    if (!active) return;
    const total = round2(active.total);
    sections.push({ outlet: active.outlet, total, lineCount: active.lineCount, sheetSubtotal: subtotal });
    if (subtotal === null) {
      warnings.push(`Seksi ${active.outlet} tidak punya baris subtotal.`);
    } else if (Math.abs(subtotal - total) > 0.5) {
      warnings.push(
        `Seksi ${active.outlet}: subtotal di sheet ${subtotal.toLocaleString("id-ID")}, jumlah baris ${total.toLocaleString("id-ID")}.`,
      );
    }
    closedTotal += total;
    active = null;
  };

  for (const row of rows) {
    const v = row.values;
    const map = readHeader(v);
    if (map) {
      closeSection(null);
      const outlet = label && row.number - label.row <= 3 ? normalizeOutlet(label.text) : NO_SECTION;
      if (outlet === NO_SECTION) warnings.push(`Baris ${row.number}: header tanpa nama seksi outlet di atasnya.`);
      active = { outlet, map, total: 0, lineCount: 0 };
      lastMap = map;
      label = null;
      continue;
    }

    const lbl = sectionLabel(v);
    if (lbl) {
      label = { text: lbl, row: row.number };
      continue;
    }

    if (!active) {
      // Grand total: after at least one section, a row holding only the Total column.
      if (lastMap && sheetGrandTotal === null && sections.length > 0) {
        const t = cellNumber(v[lastMap.total]);
        const otherText = v.some((c, i) => i !== lastMap!.total && cellText(c) !== "");
        if (t.kind === "number" && !otherText) {
          sheetGrandTotal = t.value;
          if (Math.abs(t.value - round2(closedTotal)) > 0.5) {
            warnings.push(
              `Grand total di sheet ${t.value.toLocaleString("id-ID")}, jumlah seksi ${round2(closedTotal).toLocaleString("id-ID")}.`,
            );
          }
        }
      }
      continue;
    }

    const m: ColumnMap = active.map;
    const name = cellText(v[m.name]);
    const code = cellText(v[m.code]);
    const total = cellNumber(v[m.total]);

    if (name === "" && code === "") {
      if (total.kind === "number") closeSection(total.value);
      continue;
    }
    if (name === "") continue;

    const price = cellNumber(v[m.price]);
    const qty = cellNumber(v[m.qty]);
    if (price.kind === "empty" && qty.kind === "empty" && total.kind === "empty") continue;

    const num = (c: ReturnType<typeof cellNumber>, col: string): number | null => {
      if (c.kind === "number") return c.value;
      if (c.kind === "invalid") warnings.push(`Baris ${row.number} (${active!.outlet}, ${name}): kolom ${col} berisi "${c.text}".`);
      return null;
    };
    const line: DmlLine = {
      rowNo: row.number,
      outlet: active.outlet,
      itemCode: /^\d{5,}$/.test(code) ? code : null,
      itemName: name,
      unit: m.unit !== null ? cellText(v[m.unit]) || null : null,
      price: num(price, "Price"),
      soh: m.soh !== null ? num(cellNumber(v[m.soh]), "SOH") : null,
      qtyReq: num(qty, "Qty Req"),
      total: num(total, "Total"),
      purchaseChannel: m.channel !== null ? cellText(v[m.channel]) || null : null,
      note: m.channel !== null ? cellText(v[m.channel + 1]) || null : null,
    };
    if (line.total === null && total.kind === "empty") {
      warnings.push(`Baris ${row.number} (${active.outlet}, ${name}): kolom Total kosong.`);
    }
    lines.push(line);
    active.lineCount += 1;
    active.total += line.total ?? 0;
  }
  closeSection(null);

  const merged = new Map<string, DmlOutletTotal>();
  for (const s of sections) {
    const prev = merged.get(s.outlet);
    if (!prev) {
      merged.set(s.outlet, { ...s });
      continue;
    }
    prev.total = round2(prev.total + s.total);
    prev.lineCount += s.lineCount;
    prev.sheetSubtotal = prev.sheetSubtotal === null || s.sheetSubtotal === null ? null : prev.sheetSubtotal + s.sheetSubtotal;
  }
  const outlets = [...merged.values()];

  return {
    sheetName,
    listDate,
    lines,
    outlets,
    totalRequest: round2(outlets.reduce((sum, o) => sum + o.total, 0)),
    sheetGrandTotal,
    warnings,
  };
}
