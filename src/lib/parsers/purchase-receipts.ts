import { parseVhpNumber } from "@/lib/parser/number";
import { parseVhpDate } from "./vhp-date";
import { isClosedReceivingReport, parseClosedReceiving } from "./closed-receiving";

export interface ParsedPurchaseRow {
  lineNo: number;
  businessDate: string; // YYYY-MM-DD
  ingredientCode: string; // VHP article code, zero-padded to 9 digits
  description: string;
  unit: string;
  price: number;
  qty: number;
  value?: number; // Nilai tercetak di VHP untuk mencegah akumulasi pembulatan harga satuan
  supplier: string | null;
  documentNo: string;
  deliverNote: string;
}

interface PurchaseParseWarning {
  lineNo: number;
  message: string;
}

export interface PurchaseParseResult {
  rows: ParsedPurchaseRow[];
  warnings: PurchaseParseWarning[];
  stats: {
    // Tiga angka pertama membentuk rekonsiliasi yang bisa diaudit:
    //   totalLineCount = nonDataLineCount + unreadableCount + rowCount
    // Tanpa ini "Total Baris File" di wizard sebenarnya rowCount (baris yang
    // BERHASIL dibaca), jadi baris furniture dan baris yang gagal diparse
    // hilang tanpa pernah muncul di kategori mana pun.
    totalLineCount: number; // baris fisik di file, apa adanya
    nonDataLineCount: number; // header/garis/nama supplier/subtotal/kosong
    unreadableCount: number; // baris data yang formatnya tidak dikenali
    rowCount: number;
    dateCount: number;
    articleCount: number;
    supplierCount: number;
  };
  fatal: boolean;
}

// Fixed-width column positions from the VHP "Receiving List by all suppliers"
// export (fixtures/arsip/2026-09-01_to_2026-09-08/Receive item 1-8 september.txt, 149 chars/data line),
// verified against every line of that fixture. [start, end) for slice().
// Unit/Price/Quantity/Value sit in a shared block (col 52-106) whose Unit
// width varies, so those are pulled with a right-anchored regex instead of
// fixed slicing (see NUMERIC_BLOCK_RE below).
const COLS = {
  date: [0, 8],
  artNo: [12, 19],
  description: [20, 52],
  documentNo: [107, 124],
  deliverNote: [124, 145],
} as const;

const field = (line: string, [start, end]: readonly [number, number]) => line.slice(start, end).trim();

// A real data row always starts with a DD/MM/YY date — every other line
// (page header/address/Tel, "Receiving List...", "Article's Main Group",
// the repeated column header, "---" separators, supplier names, "T O T A L"
// / "GRAND TOTAL") does not, so this alone reliably tells data from furniture
// apart without having to name every kind of furniture line.
const DATA_LINE_RE = /^\d{2}\/\d{2}\/\d{2}\s/;
const FURNITURE_RE = /^-+\s*$|Page\s*:|Period\s*:|^Tel\b|^Receiving List|Main Group\s*:|^Date\s+St\s+ArtNo|T\s*O\s*T\s*A\s*L/i;
// Unit (one or more words) + Price + Quantity + Value, each separated by whitespace,
// anchored to the end of the shared block.
const NUMERIC_BLOCK_RE = /^(.+?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/;

function toIsoDate(vhpDate: string): string | null {
  return parseVhpDate(vhpDate);
}

/**
 * Parses a VHP "Receiving List by all suppliers" purchase export. Tolerant
 * of repeated page headers, supplier subtotal blocks, page breaks and
 * printer control codes (0x0F etc.) — only lines starting with a date are
 * read as data, everything else is either recognized furniture or (if it's
 * an indented, non-furniture line) tracked as the current supplier name for
 * subsequent rows.
 */
export function parsePurchaseReceipts(text: string | null | undefined, knownSuppliers: string[] = []): PurchaseParseResult {
  // Months whose stock is closed come from the "(Closed) Receiving Report", laid out differently.
  if (isClosedReceivingReport(text)) return parseClosedReceiving(text as string, knownSuppliers);
  if (!text || typeof text !== "string") {
    return {
      rows: [],
      warnings: [],
      stats: {
        totalLineCount: 0,
        nonDataLineCount: 0,
        unreadableCount: 0,
        rowCount: 0,
        dateCount: 0,
        articleCount: 0,
        supplierCount: 0,
      },
      fatal: true,
    };
  }

  // Printer control codes (0x0F Shift-In, 0x0C form feed, etc.) show up as
  // stray lines or attached to real ones — stripped once, up front, rather
  // than guessed at per line.
  const cleaned = text.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, "");
  const rawLines = cleaned.split(/\r?\n/);
  const rows: ParsedPurchaseRow[] = [];
  const warnings: PurchaseParseWarning[] = [];
  const dates = new Set<string>();
  const articles = new Set<string>();
  const suppliers = new Set<string>();
  let currentSupplier: string | null = null;
  // Dihitung eksplisit, bukan diturunkan dari warnings.length atau selisih
  // rawLines.length - rows.length -- supaya penambahan jenis warning baru
  // nanti tidak diam-diam merusak rekonsiliasinya.
  let nonDataLineCount = 0;
  let unreadableCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const lineNo = i + 1;

    if (!DATA_LINE_RE.test(line)) {
      nonDataLineCount++;
      const trimmed = line.trim();
      if (trimmed.length >= 2 && !FURNITURE_RE.test(line)) {
        currentSupplier = trimmed;
        suppliers.add(trimmed);
      }
      continue;
    }

    const businessDate = toIsoDate(field(line, COLS.date));
    const artNoRaw = field(line, COLS.artNo);
    const description = field(line, COLS.description);
    const numericBlock = line.slice(52, 106).trim().match(NUMERIC_BLOCK_RE);
    if (!businessDate || !artNoRaw || !numericBlock) {
      unreadableCount++;
      warnings.push({ lineNo, message: `Baris ${lineNo}: format tidak dikenali, dilewati — "${line.slice(0, 60).trim()}"` });
      continue;
    }

    const [, unit, price, qty, val] = numericBlock;
    const ingredientCode = artNoRaw.padStart(9, "0");
    rows.push({
      lineNo,
      businessDate,
      ingredientCode,
      description,
      unit,
      price: parseVhpNumber(price) ?? 0,
      qty: parseVhpNumber(qty) ?? 0,
      value: val ? parseVhpNumber(val) ?? undefined : undefined,
      supplier: currentSupplier,
      documentNo: field(line, COLS.documentNo),
      deliverNote: field(line, COLS.deliverNote),
    });
    dates.add(businessDate);
    articles.add(ingredientCode);
  }

  return {
    rows,
    warnings,
    stats: {
      totalLineCount: rawLines.length,
      nonDataLineCount,
      unreadableCount,
      rowCount: rows.length,
      dateCount: dates.size,
      articleCount: articles.size,
      supplierCount: suppliers.size,
    },
    fatal: rows.length === 0,
  };
}
