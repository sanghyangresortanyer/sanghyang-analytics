import type { JournalByBillParseResult, JournalByBillRow } from "./journal-by-bill-parser";
import { parseRestaurantJournal, type ParsedRestaurantSalesRow } from "./restaurant-journal-parser";

/**
 * VHP "Restaurant Transaction Journal" (the user calls it "Penjualan per Artikel",
 * fixtures/2026-11-04/penjualan per artikel 04-11-2026.txt) read as journal rows.
 * It has one signed Amount column: menu lines are positive (discounts and voids negative),
 * payments are negative. Payment articles are numbered 9800 and up (9850 Officer Check,
 * 9871 Entertaint, 9900 Cash, 9910 coupons, 993x cards, 9950 Company Ledger); d'Bar
 * cigarettes use 92xx and are sales.
 */
const PAYMENT_FROM = 9800;
const TITLE_RE = /^\s*Restaurant\s+Transaction\s+Journal\s*$/im;
const PERIOD_RE = /Period\s*:\s*(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})/i;
// Same set as the by-bill journal: coupons, entertainment, officer check ("Compliment - <dept>" in F/O).
const COMPLIMENTARY_RE = /coupon|entertain|officer\s*check|compliment/i;

export function isJournalByArticle(text: string | null | undefined): boolean {
  return typeof text === "string" && TITLE_RE.test(text);
}

export function journalRowsFromArticles(rows: ParsedRestaurantSalesRow[]): JournalByBillRow[] {
  return rows.map((r) => {
    const isPayment = Number(r.artNo) >= PAYMENT_FROM;
    const payment = isPayment ? r.amount : 0;
    return {
      lineNo: r.lineNo,
      saleDate: r.saleDate,
      billNo: r.billNo,
      department: r.department,
      artNo: r.artNo,
      description: r.description,
      qty: r.qty,
      sales: isPayment ? 0 : r.amount,
      payment,
      isComplimentary: payment !== 0 && COMPLIMENTARY_RE.test(`${r.description} ${r.foArtikel}`),
      category: r.foArtikel || undefined,
    };
  });
}

const year = (y: string) => (y.length === 2 ? `20${y}` : y);

/** Same result shape as parseJournalByBill, so the upload treats both exports alike. */
export function parseJournalByArticle(text: string): JournalByBillParseResult {
  const parsed = parseRestaurantJournal(text);
  const p = text.match(PERIOD_RE);
  const fatal = parsed.fatal || parsed.rows.length === 0;
  return {
    periodStart: p ? `${year(p[3])}-${p[2]}-${p[1]}` : null,
    periodEnd: p ? `${year(p[6])}-${p[5]}-${p[4]}` : null,
    rows: journalRowsFromArticles(parsed.rows),
    unreadable: parsed.stats.unreadableCount,
    fatal,
    error: fatal ? "File Penjualan per Artikel tidak dapat dibaca atau tidak memiliki baris transaksi." : undefined,
  };
}
