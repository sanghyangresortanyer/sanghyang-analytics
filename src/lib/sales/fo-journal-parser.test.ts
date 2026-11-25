import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFoTurnoverReport } from "@/lib/parsers/fo-turnover-parser";
import { isFoJournal, isFoRevenue, parseFoJournal } from "./fo-journal-parser";

const real = path.resolve(process.cwd(), "fixtures/arsip/2026-11-01_to_2026-11-17/jurnal fo.txt");
const itReal = existsSync(real) ? it : it.skip;

describe("isFoRevenue", () => {
  it("keeps Front Office articles 100-199 and every outlet posting", () => {
    expect(isFoRevenue("Front Office", "100")).toBe(true);
    expect(isFoRevenue("Front Office", "190")).toBe(true);
    expect(isFoRevenue("Front Office", "40")).toBe(false); // cash payment
    expect(isFoRevenue("Front Office", "99")).toBe(false); // room charge
    expect(isFoRevenue("Front Office", "960")).toBe(false); // deposit
    expect(isFoRevenue("Front Office", "2001")).toBe(false); // outlet bill moved to a room
    expect(isFoRevenue("d'Bistro", "12")).toBe(true); // breakfast in the room package
  });
});

describe("parseFoJournal", () => {
  it("rejects other reports", () => {
    expect(isFoJournal("F/O Turnover by Department")).toBe(false);
    expect(parseFoJournal("Receiving List").fatal).toBe(true);
  });

  itReal("reads the real 1-17 Nov 2026 export", () => {
    const r = parseFoJournal(readFileSync(real, "latin1"));
    expect(r.fatal).toBe(false);
    expect(r.periodStart).toBe("2026-11-01");
    expect(r.periodEnd).toBe("2026-11-17");
    expect(r.unreadable).toBe(0);
    // The report's own Grand TOTAL.
    expect(r.rows.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(-600_786_313.99, 2);

    const sum = (dept: string) => r.revenue.filter((x) => x.department === dept).reduce((s, x) => s + x.amount, 0);
    expect(sum("d'Bistro")).toBe(12_800_000);
    expect(sum("Sunset Grill")).toBe(774_000);
    const first = r.rows.find((x) => x.department === "d'Bistro")!;
    expect(first).toMatchObject({ saleDate: "2026-11-01", roomNo: "119", billNo: "78950", artNo: "12", segment: "FIT-TA" });
    expect(first.guest).toBe("EVI WAHYUNI ,  MRS.");
  });

  itReal("Front Office revenue per day equals that day's Turnover", () => {
    const r = parseFoJournal(readFileSync(real, "latin1"));
    for (let d = 1; d <= 17; d++) {
      const dd = String(d).padStart(2, "0");
      const file = path.resolve(process.cwd(), `fixtures/2026-11-${dd}/revenue ${dd}-11-2026.txt`);
      if (!existsSync(file)) continue;
      const fo = parseFoTurnoverReport(readFileSync(file, "latin1")).departments.find((x) => /front office/i.test(x.departmentName));
      const journal = r.revenue
        .filter((x) => x.saleDate === `2026-11-${dd}` && x.department === "Front Office")
        .reduce((s, x) => s + x.amount, 0);
      expect(journal, `1-17 Nov, tanggal ${d}`).toBeCloseTo(fo?.mtdGros ?? 0, 2);
    }
  });
});
