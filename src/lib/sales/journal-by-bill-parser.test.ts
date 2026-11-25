import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isJournalByBill, parseJournalByBill } from "./journal-by-bill-parser";

const HEADER = [
  "SANGHYANG INDAH SPA RESORT (Serang)                                              Page   :       1",
  "Jl. Raya Sirih Km. 128 Anyer                                                     Period :      01/11/26 - 17/11/26",
  "Tel          +62254600888                                                        Date   : 17/11/26   11:59:32",
  "",
  "Rest. Transaction Journal by BillNo",
  "",
  "=".repeat(150),
  "Date      TblNo   Bill-No Department        ArtNo  Description                Qty              Sales            Payment ID   Time     OpenTable ClosedTable GuestName                Room No",
  "-".repeat(150),
];

const line = (date: string, bill: string, dept: string, art: string, desc: string, qty: string, sales: string, pay: string) =>
  `${date.padEnd(10)}${"1".padStart(5).padEnd(8)}${bill.padStart(6).padEnd(8)}${dept.padEnd(18)}${art.padEnd(7)}${desc.padEnd(27)}` +
  `${qty.padStart(2)}${sales.padStart(18)}${pay.padStart(19)}`.padEnd(42) +
  "554  08:47:14 08:47:14              GUEST                    536      ";

describe("parseJournalByBill", () => {
  const sample = [
    ...HEADER,
    line("01/11/26", "187677", "d'Bistro", "1603", "Breakfast FIT", "4", "800,000", "0"),
    line("01/11/26", "187677", "d'Bistro", "9910", "B'fast Coupon", "4", "0", "-800,000"),
    line("02/11/26", "187690", "Sunset Grill", "2001", "SUNSET PLATTER", "1", "125,000", "0"),
    line("02/11/26", "187690", "Sunset Grill", "9900", "Cash Rp", "0", "0", "-125,000"),
    "                                                    T O T A L                    5            925,000           -925,000",
  ].join("\n");

  it("recognises the report title", () => {
    expect(isJournalByBill(sample)).toBe(true);
    expect(isJournalByBill("Restaurant Transaction Journal")).toBe(false);
  });

  it("reads dated sales lines and marks coupon payments", () => {
    const res = parseJournalByBill(sample);
    expect(res.fatal).toBe(false);
    expect(res.periodStart).toBe("2026-11-01");
    expect(res.periodEnd).toBe("2026-11-17");
    expect(res.rows).toHaveLength(4);
    expect(res.rows[0]).toMatchObject({ saleDate: "2026-11-01", department: "d'Bistro", artNo: "1603", description: "Breakfast FIT", qty: 4, sales: 800000, payment: 0, isComplimentary: false });
    expect(res.rows[1]).toMatchObject({ payment: -800000, isComplimentary: true });
    expect(res.rows[3]).toMatchObject({ payment: -125000, isComplimentary: false });
    expect(res.unreadable).toBe(0);
  });

  it("is fatal for text without the journal header", () => {
    expect(parseJournalByBill("random").fatal).toBe(true);
  });

  const realPath = path.resolve(process.cwd(), "fixtures/arsip/2026-11-01_to_2026-11-16/exports/2026-11-17_17-27-39/Penjualan1.txt");
  const itReal = fs.existsSync(realPath) ? it : it.skip;

  itReal("reconciles the real 1-17 Nov export line by line", () => {
    const res = parseJournalByBill(fs.readFileSync(realPath, "utf8"));
    expect(res.fatal).toBe(false);
    expect(res.unreadable).toBe(0);
    expect(res.rows).toHaveLength(3961);
    const sales = (dept: string) => res.rows.filter((r) => r.department === dept).reduce((s, r) => s + r.sales, 0);
    const comp = (dept: string) => res.rows.filter((r) => r.department === dept && r.isComplimentary).reduce((s, r) => s - r.payment, 0);
    const net = (dept: string) => sales(dept) - comp(dept);
    expect(sales("Sunset Grill")).toBe(91380737);
    // Sales less coupon/entertain/officer-check payments = F/O Turnover MTD-Gros (Revenue1.txt, 1-17 Nov).
    expect(net("d'Bar Karaok")).toBe(143907000);
    expect(net("Banquet")).toBe(32905000);
    expect(net("Room Service")).toBe(1718400);
    expect(net("d'Spa")).toBe(14383000);
    expect(net("Souvenir Sho")).toBe(11290000);
    expect(comp("d'Bistro")).toBe(18400000 + 7900000 + 223000);
    expect(new Set(res.rows.map((r) => r.saleDate)).size).toBe(17);
  });
});
