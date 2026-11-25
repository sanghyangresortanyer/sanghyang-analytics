import ExcelJS from "exceljs";

interface ParsedInventoryRow {
  rowNo: number;
  outletName: string | null;
  itemCode: string | null;
  itemName: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
  totalValue: number;
}

export interface InventorySpreadsheetParseResult {
  rows: ParsedInventoryRow[];
  warnings: string[];
  hasOutletColumn: boolean;
  stats: {
    totalRows: number;
    validRows: number;
    skippedRows: number;
    totalValue: number;
    outletCount: number;
  };
  fatal: boolean;
  error?: string;
}

const HEADER_ALIASES = {
  outlet: [
    "outlet", "department", "dept", "lokasi", "bagian", "outlet_name", "nama_outlet",
    "gudang", "warehouse", "storage", "store", "lokasi_outlet",
  ],
  code: [
    "code", "kode", "artno", "article_no", "kode_barang", "code9", "sku", "item_code",
    "kode_item", "art_no",
  ],
  name: [
    "name", "nama", "item", "description", "deskripsi", "nama_barang", "item_name", "uraian",
    "barang", "produk", "nama_produk", "nama_item", "keterangan",
  ],
  unit: ["unit", "satuan", "uom"],
  qty: [
    "qty", "quantity", "stok", "stock", "jumlah", "saldo", "ending_qty", "sisa",
    "saldo_akhir", "stok_akhir", "qty_akhir", "ending_stock", "volume", "banyaknya",
  ],
  unitPrice: [
    "price", "harga", "unit_price", "harga_satuan", "avg_price", "average_price", "hpp",
    "cost", "unit_cost", "harga_pokok", "harga_beli", "harga_rata_rata",
  ],
  totalValue: [
    "total", "total_value", "nilai", "total_nilai", "amount", "value", "inventory_value",
    "nilai_inventory", "total_harga", "subtotal", "jumlah_harga", "jumlah_nilai",
    "saldo_nilai", "total_saldo", "nilai_akhir",
  ],
} as const;

type ColumnMap = {
  outlet: number;
  code: number;
  name: number;
  unit: number;
  qty: number;
  unitPrice: number;
  totalValue: number;
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // remove parenthesized units like (Rp), (Qty), (Pcs)
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_(?:rp|idr)$/, "") // remove trailing currency suffix
    .replace(/^_+|_+$/g, "");
}

function findColumnIndex(headers: string[], aliases: readonly string[]): number {
  for (let i = 0; i < headers.length; i++) {
    if (aliases.includes(headers[i])) return i;
  }
  return -1;
}

export function parseFlexibleNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && "error" in raw) return null;

  let text = String(raw)
    .replace(/rp\.?/gi, "")
    .replace(/\s+/g, "")
    .trim();
  if (!text || text === "-" || text === "--" || text.toLowerCase() === "n/a" || text.toLowerCase() === "null") {
    return null;
  }

  let isNegative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    isNegative = true;
    text = text.slice(1, -1).trim();
  } else if (text.endsWith("-")) {
    isNegative = true;
    text = text.slice(0, -1).trim();
  }

  // Handle Indonesian "1.250.000,50" vs English "1,250,000.50"
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized = text;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = text.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = text.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    const afterComma = text.slice(lastComma + 1);
    normalized = afterComma.length === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  } else if (lastDot > -1) {
    const parts = text.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = text.replace(/\./g, "");
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

/**
 * One delimiter per file, picked from the first non-empty line outside quotes.
 * Splitting on "," and ";" at once breaks Indonesian semicolon exports, whose
 * numbers use "," as the decimal separator ("12.500,50").
 */
function detectCsvDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let seenContent = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (seenContent) break;
    } else if (!inQuotes && ch in counts) {
      counts[ch]++;
      seenContent = true;
    } else if (ch.trim()) {
      seenContent = true;
    }
  }
  return Object.entries(counts).reduce((best, cur) => (cur[1] > best[1] ? cur : best), [",", 0])[0];
}

function parseCsvLines(text: string): string[][] {
  const delimiter = detectCsvDelimiter(text);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += ch;
    }
  }
  currentRow.push(currentCell.trim());
  if (currentRow.some((c) => c.length > 0)) rows.push(currentRow);
  return rows;
}

function extractCellText(cellValue: ExcelJS.CellValue): unknown {
  if (cellValue === null || cellValue === undefined) return "";
  if (typeof cellValue === "object" && "result" in cellValue) {
    const res = cellValue.result;
    if (res && typeof res === "object" && "error" in res) return "";
    return res ?? "";
  }
  if (typeof cellValue === "object" && "richText" in cellValue && Array.isArray(cellValue.richText)) {
    return cellValue.richText.map((r) => r.text).join("");
  }
  return cellValue;
}

function parseMatrix(matrix: unknown[][]): InventorySpreadsheetParseResult {
  if (matrix.length < 2) {
    return {
      rows: [],
      warnings: [],
      hasOutletColumn: false,
      stats: { totalRows: matrix.length, validRows: 0, skippedRows: 0, totalValue: 0, outletCount: 0 },
      fatal: true,
      error: "File inventory kosong atau tidak memiliki baris data.",
    };
  }

  // Find header row within first 25 rows
  let headerRowIdx = -1;
  let colMap: ColumnMap | null = null;

  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const row = matrix[r];
    if (!row || !Array.isArray(row)) continue;
    const candidate = row.map((c) => normalizeHeader(String(c ?? "")));
    const nonEmptyCount = candidate.filter((c) => c.length > 0).length;
    if (nonEmptyCount < 2) continue; // Skip single-cell banner titles like "LAPORAN INVENTORY"

    const totalValueIdx = findColumnIndex(candidate, HEADER_ALIASES.totalValue);
    const qtyIdx = findColumnIndex(candidate, HEADER_ALIASES.qty);
    const unitPriceIdx = findColumnIndex(candidate, HEADER_ALIASES.unitPrice);

    if (totalValueIdx !== -1 || (qtyIdx !== -1 && unitPriceIdx !== -1)) {
      headerRowIdx = r;
      colMap = {
        outlet: findColumnIndex(candidate, HEADER_ALIASES.outlet),
        code: findColumnIndex(candidate, HEADER_ALIASES.code),
        name: findColumnIndex(candidate, HEADER_ALIASES.name),
        unit: findColumnIndex(candidate, HEADER_ALIASES.unit),
        qty: qtyIdx,
        unitPrice: unitPriceIdx,
        totalValue: totalValueIdx,
      };
      break;
    }
  }

  if (headerRowIdx === -1 || !colMap) {
    return {
      rows: [],
      warnings: [],
      hasOutletColumn: false,
      stats: { totalRows: matrix.length, validRows: 0, skippedRows: 0, totalValue: 0, outletCount: 0 },
      fatal: true,
      error:
        "Header kolom inventory tidak dikenali. Wajib memiliki kolom 'Total Nilai' (total/nilai/amount/value) atau pasangan kolom 'Qty' + 'Harga' (qty + price/harga).",
    };
  }

  const rows: ParsedInventoryRow[] = [];
  const warnings: string[] = [];
  const outlets = new Set<string>();
  let skippedRows = 0;
  let totalValueSum = 0;

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const rawRow = matrix[r];
    if (!rawRow || !Array.isArray(rawRow)) {
      skippedRows++;
      continue;
    }
    const rowText = rawRow.map((c) => String(c ?? "").trim()).join(" ").trim();
    if (!rowText || /^(grand\s+)?total\b/i.test(rowText)) {
      skippedRows++;
      continue;
    }

    const outletRaw = colMap.outlet !== -1 ? String(rawRow[colMap.outlet] ?? "").trim() : "";
    const codeRaw = colMap.code !== -1 ? String(rawRow[colMap.code] ?? "").trim() : "";
    const nameRaw = colMap.name !== -1 ? String(rawRow[colMap.name] ?? "").trim() : "";
    const unitRaw = colMap.unit !== -1 ? String(rawRow[colMap.unit] ?? "").trim() : "";

    const qty = colMap.qty !== -1 ? (parseFlexibleNumber(rawRow[colMap.qty]) ?? 0) : 0;
    const unitPrice = colMap.unitPrice !== -1 ? (parseFlexibleNumber(rawRow[colMap.unitPrice]) ?? 0) : 0;
    const explicitTotal = colMap.totalValue !== -1 ? parseFlexibleNumber(rawRow[colMap.totalValue]) : null;
    const computedTotal = explicitTotal !== null ? explicitTotal : qty * unitPrice;

    if (!nameRaw && !outletRaw && !codeRaw && computedTotal === 0) {
      skippedRows++;
      continue;
    }

    if (!Number.isFinite(computedTotal)) {
      warnings.push(`Baris ${r + 1}: nilai inventory tidak valid.`);
      skippedRows++;
      continue;
    }

    const outletName = outletRaw || null;
    if (outletName) outlets.add(outletName);

    const itemName = nameRaw || codeRaw || outletName || `Item #${r + 1}`;
    rows.push({
      rowNo: r + 1,
      outletName,
      itemCode: codeRaw || null,
      itemName,
      unit: unitRaw || null,
      qty,
      unitPrice,
      totalValue: computedTotal,
    });
    totalValueSum += computedTotal;
  }

  if (rows.length === 0) {
    return {
      rows: [],
      warnings,
      hasOutletColumn: colMap.outlet !== -1,
      stats: { totalRows: matrix.length - headerRowIdx - 1, validRows: 0, skippedRows, totalValue: 0, outletCount: 0 },
      fatal: true,
      error: "Tidak ada baris inventory yang valid setelah membaca header.",
    };
  }

  return {
    rows,
    warnings,
    hasOutletColumn: colMap.outlet !== -1 && outlets.size > 0,
    stats: {
      totalRows: matrix.length - headerRowIdx - 1,
      validRows: rows.length,
      skippedRows,
      totalValue: totalValueSum,
      outletCount: outlets.size,
    },
    fatal: false,
  };
}

export async function parseInventorySpreadsheet(
  buffer: ArrayBuffer | Uint8Array,
  filename: string
): Promise<InventorySpreadsheetParseResult> {
  if (!buffer || buffer.byteLength === 0) {
    return {
      rows: [],
      warnings: [],
      hasOutletColumn: false,
      stats: { totalRows: 0, validRows: 0, skippedRows: 0, totalValue: 0, outletCount: 0 },
      fatal: true,
      error: "File spreadsheet kosong (0 byte).",
    };
  }

  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = new TextDecoder("utf-8").decode(buffer);
    const matrix = parseCsvLines(text);
    return parseMatrix(matrix);
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = buffer instanceof ArrayBuffer ? buffer : Uint8Array.from(buffer).buffer;
    try {
      await workbook.xlsx.load(arrayBuffer);
    } catch {
      return {
        rows: [],
        warnings: [],
        hasOutletColumn: false,
        stats: { totalRows: 0, validRows: 0, skippedRows: 0, totalValue: 0, outletCount: 0 },
        fatal: true,
        error: "File Excel (.xlsx) rusak atau tidak valid.",
      };
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return {
        rows: [],
        warnings: [],
        hasOutletColumn: false,
        stats: { totalRows: 0, validRows: 0, skippedRows: 0, totalValue: 0, outletCount: 0 },
        fatal: true,
        error: "Workbook Excel tidak memiliki worksheet.",
      };
    }
    const matrix: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      matrix.push(values.map((v) => extractCellText(v as ExcelJS.CellValue)));
    });
    return parseMatrix(matrix);
  }

  return {
    rows: [],
    warnings: [],
    hasOutletColumn: false,
    stats: { totalRows: 0, validRows: 0, skippedRows: 0, totalValue: 0, outletCount: 0 },
    fatal: true,
    error: `Format file '${filename}' tidak didukung. Gunakan .xlsx atau .csv.`,
  };
}
