import { parseVhpDate } from "@/lib/parsers/vhp-date";

/**
 * VHP "F/O Journal Transaction" (Accounting → F/O Journal Lists → Booking Journal by Article),
 * exported for articles 1–9999, departments 0–99, transfers excluded
 * (fixtures/arsip/2026-11-01_to_2026-11-17/jurnal fo.txt).
 *
 * It lists every posting made at Front Office: room revenue, payments, deposits, bills moved to
 * a room, and the share of a room package booked to an outlet (breakfast to d'Bistro, welcome
 * drink to Sunset Grill). Those outlet postings never pass an outlet cashier, so they are missing
 * from Penjualan per Artikel; together the two exports equal F/O Turnover per day (1–17 Nov 2026:
 * Front Office equal on all 17 days, d'Bistro +12,800,000, Sunset Grill +774,000).
 */
export interface FoJournalRow {
  lineNo: number;
  saleDate: string;
  roomNo: string;
  billNo: string;
  artNo: string;
  description: string;
  department: string;
  qty: number;
  amount: number;
  guest: string;
  /** Booking segment (FIT, FIT-TA, WALK IN, FIT-CORP, GIT-CORP); empty when not filled in. */
  segment: string;
}

export interface FoJournalParseResult {
  periodStart: string | null;
  periodEnd: string | null;
  rows: FoJournalRow[];
  /** Postings that are revenue (see isFoRevenue). */
  revenue: FoJournalRow[];
  unreadable: number;
  fatal: boolean;
  error?: string;
}

const TITLE_RE = /F\/O\s+Journal\s+Transaction/i;
const PERIOD_RE = /Period\s*:\s*(\d{2}\/\d{2}\/\d{2,4})\s*-\s*(\d{2}\/\d{2}\/\d{2,4})/i;
const DATA_RE = /^\d{2}\/\d{2}\/\d{2}\s/;
const AMOUNT_RE = /(-?[\d,]+\.\d{2})\s*$/;

export function isFoJournal(text: string | null | undefined): boolean {
  return typeof text === "string" && TITLE_RE.test(text.slice(0, 2000));
}

/**
 * Revenue in the journal: Front Office articles 100–199 (lodging, extra bed, early check-in,
 * late check-out, fees, misc) and anything booked to another department (room-package shares).
 * Front Office numbers below 100 are payments, 960 deposits, 2000+ bills moved to a room, 3000+
 * receivables.
 */
export function isFoRevenue(department: string, artNo: string): boolean {
  if (department.trim().toLowerCase() !== "front office") return true;
  const n = Number(artNo);
  return n >= 100 && n < 200;
}

const num = (s: string) => Number(s.replace(/,/g, ""));

export function parseFoJournal(text: string | null | undefined): FoJournalParseResult {
  const empty = { periodStart: null, periodEnd: null, rows: [], revenue: [], unreadable: 0 };
  if (!isFoJournal(text)) return { ...empty, fatal: true, error: "Bukan laporan F/O Journal Transaction." };
  const lines = text!.split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("Date ") && l.includes("ArtNo") && l.includes("Department"));
  if (!header) return { ...empty, fatal: true, error: "Baris judul kolom F/O Journal tidak ditemukan." };
  const at = (label: string) => header.indexOf(label);
  const col = {
    rm: at("RmNo"),
    bill: at("Bill-No"),
    art: at("ArtNo"),
    desc: at("Description"),
    voucher: at("Voucher"),
    dept: at("Department"),
    outlet: at("Outlet"),
    qty: at("Qty"),
    guest: at("Guest Name"),
  };
  if (Object.values(col).some((i) => i < 0)) return { ...empty, fatal: true, error: "Kolom F/O Journal tidak lengkap." };
  // Optional columns to the right of the guest: who pays, the booking segment, check-in date.
  const receiver = at("Bill Receiver");
  const segment = at("SegmentCode");
  const checkIn = at("Check In Date");

  const period = PERIOD_RE.exec(text!.slice(0, 2000));
  const rows: FoJournalRow[] = [];
  let unreadable = 0;
  lines.forEach((line, i) => {
    if (!DATA_RE.test(line)) return;
    const saleDate = parseVhpDate(line.slice(0, 8));
    // Between the room and the description sit the N/M/Sh flags ("*" on non-room bills), the
    // bill number (right-aligned, so it can start left of its label) and the 4-digit article.
    const billArt = /(\d+)?\s+(\d{1,4})\s*$/.exec(line.slice(col.rm + 6, col.desc));
    const artNo = (billArt?.[2] ?? "").replace(/^0+(?=\d)/, "");
    const amount = AMOUNT_RE.exec(line.slice(col.outlet, col.guest));
    const qtyText = line.slice(col.outlet, col.guest).trim().split(/\s+/)[0] ?? "";
    if (!saleDate || !/^\d+$/.test(artNo) || !amount) {
      unreadable++;
      return;
    }
    rows.push({
      lineNo: i + 1,
      saleDate,
      roomNo: line.slice(col.rm, col.rm + 6).trim(),
      billNo: billArt?.[1] ?? "",
      artNo,
      description: line.slice(col.desc, col.voucher).trim(),
      department: line.slice(col.dept, col.outlet).trim(),
      qty: Number.isFinite(Number(qtyText)) ? Number(qtyText) : 0,
      amount: num(amount[1]),
      guest: line.slice(col.guest, receiver > col.guest ? receiver : undefined).trim(),
      segment: segment >= 0 ? line.slice(segment, checkIn > segment ? checkIn : undefined).trim() : "",
    });
  });
  return {
    periodStart: period ? parseVhpDate(period[1]) : null,
    periodEnd: period ? parseVhpDate(period[2]) : null,
    rows,
    revenue: rows.filter((r) => isFoRevenue(r.department, r.artNo)),
    unreadable,
    fatal: rows.length === 0,
    error: rows.length === 0 ? "Tidak ada baris transaksi di F/O Journal." : undefined,
  };
}
