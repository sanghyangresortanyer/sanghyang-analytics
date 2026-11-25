import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFoTurnoverReport } from "@/lib/parsers/fo-turnover-parser";
import { parseFoJournal } from "@/lib/sales/fo-journal-parser";
import { parseJournalByArticle } from "@/lib/sales/journal-by-article";
import { buildRangeReport, type SalesLine } from "./range-report";

const dir = path.resolve(process.cwd(), "fixtures");
const journalFile = path.join(dir, "arsip/2026-11-01_to_2026-11-17/jurnal fo.txt");
const day = (d: number) => String(d).padStart(2, "0");
const daily = (kind: string, d: number) => path.join(dir, `2026-11-${day(d)}/${kind} ${day(d)}-11-2026.txt`);
const ready = existsSync(journalFile) && Array.from({ length: 17 }, (_, i) => i + 1).every((d) => existsSync(daily("revenue", d)) && existsSync(daily("penjualan per artikel", d)));
const itReal = ready ? it : it.skip;

/**
 * The dashboard without Turnover: Penjualan per Artikel + F/O Journal lines, stored the way
 * saveWeeklyMeeting stores them, must give every outlet the same revenue as that day's Turnover.
 */
describe("F/O Journal + Penjualan per Artikel vs Turnover, 1-17 Nov 2026", () => {
  itReal("matches every outlet on every day", () => {
    const fo = parseFoJournal(readFileSync(journalFile, "latin1"));
    const foLines: SalesLine[] = fo.revenue.map((r) => ({
      sale_date: r.saleDate,
      outlet_name: r.department,
      art_no: r.artNo,
      description: r.description,
      qty: r.qty,
      sales_amount: r.amount,
      coupon_amount: 0,
      source: "fo",
    }));
    const posLines: SalesLine[] = [];
    const turnover = new Map<number, Map<string, number>>();
    for (let d = 1; d <= 17; d++) {
      const j = parseJournalByArticle(readFileSync(daily("penjualan per artikel", d), "latin1"));
      for (const r of j.rows.filter((x) => x.sales !== 0 || x.isComplimentary)) {
        posLines.push({
          sale_date: r.saleDate,
          outlet_name: r.department,
          art_no: r.artNo || null,
          description: r.description,
          qty: r.qty,
          sales_amount: r.sales,
          coupon_amount: r.isComplimentary ? -r.payment : 0,
        });
      }
      const t = parseFoTurnoverReport(readFileSync(daily("revenue", d), "latin1"));
      turnover.set(d, new Map(t.departments.map((x) => [x.departmentName, x.mtdGros])));
    }
    const knownOutlets = [...new Set([...turnover.values()].flatMap((m) => [...m.keys()]))];
    const cover = [{ start: "2026-11-01", end: "2026-11-17" }];

    const diffs: string[] = [];
    for (let d = 1; d <= 17; d++) {
      const date = `2026-11-${day(d)}`;
      const r = buildRangeReport({
        start: date,
        end: date,
        snapshots: [],
        knownOutlets,
        salesLines: [...posLines, ...foLines],
        salesCoverage: cover,
        foJournalCoverage: cover,
        purchaseLines: [],
        purchaseCoverage: [],
      });
      expect(r.revenue.source).toBe("journal");
      for (const name of knownOutlets) {
        const want = turnover.get(d)!.get(name) ?? 0;
        const got = r.revenue.outlets.find((o) => o.outlet_name === name)?.revenue ?? 0;
        if (Math.abs(want - got) > 0.5) diffs.push(`${date} ${name}: Turnover ${want}, aplikasi ${got}`);
      }
    }
    expect(diffs).toEqual([]);
  });
});
