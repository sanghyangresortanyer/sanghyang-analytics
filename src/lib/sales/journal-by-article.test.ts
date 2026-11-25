import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ParsedRestaurantSalesRow } from "./restaurant-journal-parser";
import { isJournalByArticle, journalRowsFromArticles } from "./journal-by-article";

const row = (artNo: string, description: string, amount: number, foArtikel: string, billNo = "1"): ParsedRestaurantSalesRow => ({
  lineNo: 1,
  saleDate: "2026-11-04",
  tbNo: "1",
  billNo,
  artNo,
  description,
  department: "d'Bistro",
  qty: 1,
  amount,
  time: "10:00:00",
  foArtikel,
});

describe("journalRowsFromArticles", () => {
  it("splits menu lines from payments by article number", () => {
    const out = journalRowsFromArticles([
      row("300", "NASI GORENG", 35_000, "Food d'Bistro"),
      row("9200", "DJI SAM SOE", 40_000, "Cigarette d'Bar"),
      row("8911", "Discount 10%", -3_500, "Discount d'Bistro"),
      row("9900", "Cash Rp", -71_500, "Cash Outlet"),
    ]);
    expect(out.map((r) => [r.sales, r.payment, r.isComplimentary])).toEqual([
      [35_000, 0, false],
      [40_000, 0, false],
      [-3_500, 0, false],
      [0, -71_500, false],
    ]);
  });

  it("marks coupon, entertain and compliment payments, and keeps a cancelled one signed", () => {
    const out = journalRowsFromArticles([
      row("9910", "B'fast Coupon", -200_000, "B'Fast Coupon"),
      row("9871", "Entertaint - FB", -40_000, "Entertaint - FB"),
      row("9858", "Officer Check - SPA", -35_000, "Compliment - Spa"),
      row("9858", "Officer Check - SPA     CANC", 35_000, "Compliment - Spa"),
    ]);
    expect(out.every((r) => r.isComplimentary)).toBe(true);
    expect(out.map((r) => r.payment)).toEqual([-200_000, -40_000, -35_000, 35_000]);
  });
});

describe("isJournalByArticle", () => {
  it("recognises the Restaurant Transaction Journal export", () => {
    expect(isJournalByArticle("Restaurant Transaction Journal\n")).toBe(true);
    expect(isJournalByArticle("Rest. Transaction Journal by BillNo\n")).toBe(false);
    expect(isJournalByArticle("F/O Turnover Report by Department")).toBe(false);
  });
});

const realDay = path.resolve(process.cwd(), "fixtures/2026-11-04/penjualan per artikel 04-11-2026.txt");
const itReal = existsSync(realDay) ? it : it.skip;

itReal("real 4 Nov export: outlet totals net of complimentary match the Turnover report", async () => {
  const { parseRestaurantJournal } = await import("./restaurant-journal-parser");
  const parsed = parseRestaurantJournal(readFileSync(realDay, "latin1"));
  const rows = journalRowsFromArticles(parsed.rows);
  const net = (dept: string) =>
    rows.filter((r) => r.department === dept).reduce((s, r) => s + r.sales - (r.isComplimentary ? -r.payment : 0), 0);
  // Turnover 04/11/26 (fixtures/2026-11-04/revenue 04-11-2026.txt), MTD-Gros per department.
  expect(net("d'Bar Karaoke & DBC")).toBe(13_457_000);
  expect(net("Room Service")).toBe(49_500);
  expect(net("d'Spa")).toBe(600_000);
  // Sunset and d'Bistro are lower by postings that exist only in Turnover (see TODO Milestone 2.9).
  expect(net("Sunset Grill")).toBe(2_876_000 - 26_000);
  expect(net("d'Bistro")).toBe(2_143_000 - 600_000);
});
