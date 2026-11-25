import { parseVhpNumber } from "@/lib/parser/number";
import { parseVhpDate } from "@/lib/parsers/vhp-date";

/**
 * VHP "Rest. Transaction Journal by BillNo" (fixtures/arsip/2026-11-01_to_2026-11-16/.../Penjualan1.txt).
 * One line per bill entry: item lines carry Sales, payment lines carry Payment (negative).
 * Sales is the gross amount, the same basis as MTD-Gros in the F/O Turnover report.
 * The older "Restaurant Transaction Journal" layout is read by restaurant-journal-parser.ts.
 */
export interface JournalByBillRow {
  lineNo: number;
  saleDate: string;
  billNo: string;
  /** Department as printed; VHP cuts it to 12 characters ("d'Bar Karaok"). */
  department: string;
  artNo: string;
  description: string;
  qty: number;
  sales: number;
  payment: number;
  /**
   * Complimentary payment: coupon (breakfast, welcome drink), entertainment or officer check.
   * F/O Turnover does not count bills settled this way as outlet revenue; sales less these
   * payments matches F/O MTD-Gros for d'Bar, Banquet, Room Service, Spa and Souvenir (1-17 Nov 2026).
   */
  isComplimentary: boolean;
  /** Sales category ("F/O Artikel" in Penjualan per Artikel); absent in the by-bill export. */
  category?: string;
}

export interface JournalByBillParseResult {
  periodStart: string | null;
  periodEnd: string | null;
  rows: JournalByBillRow[];
  /** Date-prefixed lines that could not be read. Must be 0 for a trusted import. */
  unreadable: number;
  fatal: boolean;
  error?: string;
}

const TITLE_RE = /Rest\.\s+Transaction\s+Journal\s+by\s+BillNo/i;
const PERIOD_RE = /Period\s*:\s*(\d{2}\/\d{2}\/\d{2,4})\s*-\s*(\d{2}\/\d{2}\/\d{2,4})/i;
const DATA_RE = /^\d{2}\/\d{2}\/\d{2}\s/;
// Payment articles seen in the export: 9910 B'fast Coupon, 9915 Welcome Drink Coupon,
// 985x "Officer Check - <dept>", 987x "Entertaint - <dept>".
const COMPLIMENTARY_RE = /coupon|entertain|officer\s*check/i;

export function isJournalByBill(text: string | null | undefined): boolean {
  return typeof text === "string" && TITLE_RE.test(text);
}

type Columns = { billNo: number; department: number; artNo: number; description: number; qty: number; id: number };

/** Column starts come from the report's own header line, so a wider export still parses. */
function columnsFrom(header: string): Columns | null {
  const at = (label: string) => header.indexOf(label);
  const cols = {
    billNo: at("Bill-No"),
    department: at("Department"),
    artNo: at("ArtNo"),
    description: at("Description"),
    qty: at("Qty"),
    id: at(" ID ") + 1,
  };
  return Object.values(cols).every((v) => v > 0) ? cols : null;
}

export function parseJournalByBill(text: string | null | undefined): JournalByBillParseResult {
  const empty = (error: string): JournalByBillParseResult => ({ periodStart: null, periodEnd: null, rows: [], unreadable: 0, fatal: true, error });
  if (!isJournalByBill(text)) return empty("Bukan format Rest. Transaction Journal by BillNo.");

  const lines = (text as string).split(/\r?\n/);
  const header = lines.find((l) => /^Date\s+TblNo\s+Bill-No/.test(l));
  const cols = header ? columnsFrom(header) : null;
  if (!cols) return empty("Baris judul kolom Journal tidak ditemukan.");

  const period = lines.map((l) => PERIOD_RE.exec(l)).find(Boolean);
  const rows: JournalByBillRow[] = [];
  let unreadable = 0;

  lines.forEach((line, i) => {
    if (!DATA_RE.test(line)) return;
    const saleDate = parseVhpDate(line.slice(0, 8));
    // Qty, Sales and Payment share one right-aligned block that ends where ID starts.
    const numbers = line.slice(cols.qty, cols.id).trim().split(/\s+/);
    const [qty, sales, payment] = numbers.map((n) => parseVhpNumber(n));
    if (!saleDate || numbers.length !== 3 || qty === null || sales === null || payment === null) {
      unreadable++;
      return;
    }
    const description = line.slice(cols.description, cols.qty).trim();
    rows.push({
      lineNo: i + 1,
      saleDate,
      billNo: line.slice(cols.billNo, cols.department).trim(),
      department: line.slice(cols.department, cols.artNo).trim(),
      artNo: line.slice(cols.artNo, cols.description).trim(),
      description,
      qty,
      sales,
      payment,
      isComplimentary: payment !== 0 && COMPLIMENTARY_RE.test(description),
    });
  });

  if (rows.length === 0) {
    return { ...empty("Tidak ada baris transaksi yang terbaca di Journal."), unreadable };
  }
  return {
    periodStart: period ? parseVhpDate(period[1]) : null,
    periodEnd: period ? parseVhpDate(period[2]) : null,
    rows,
    unreadable,
    fatal: false,
  };
}
