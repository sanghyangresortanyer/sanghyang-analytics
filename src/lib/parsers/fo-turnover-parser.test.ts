import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isFoTurnoverReport, parseFoTurnoverReport } from "./fo-turnover-parser";

describe("parseFoTurnoverReport", () => {
  it("parses department MTD-Nett and MTD-Gros accurately", () => {
    const sample = [
      "SANGHYANG INDAH SPA RESORT (Serang)      Page : 1",
      "Period :       01/11/26 - 14/11/26",
      "F/O Turnover Report by Department",
      "     1 - d'Bistro",
      "  10 Food d'Bistro  0  0  0  0  0.00  4,172,066  417,207  458,927  5,048,200  30.19  100  10  11  121  100.00  0.00",
      "     T O T A L      0  0  0  0  0.00  13,819,176  1,381,917  1,520,109  16,721,200  100.00  100  10  11  121  100.00  0.00",
      "     GRAND TOTAL    0  0  0  0  0.00  13,819,176  1,381,917  1,520,109  16,721,200  100.00  100  10  11  121  100.00  0.00",
    ].join("\n");

    expect(isFoTurnoverReport(sample)).toBe(true);
    const res = parseFoTurnoverReport(sample);
    expect(res.fatal).toBe(false);
    expect(res.periodStart).toBe("2026-11-01");
    expect(res.periodEnd).toBe("2026-11-14");
    expect(res.departments).toHaveLength(1);
    expect(res.departments[0].departmentName).toBe("d'Bistro");
    expect(res.departments[0].mtdGros).toBe(16721200);
    expect(res.grandTotalMtdGros).toBe(16721200);
  });

  it("warns instead of inventing a GRAND TOTAL when the report is truncated", () => {
    const truncated = [
      "Period :       01/11/26 - 14/11/26",
      "F/O Turnover Report by Department",
      "     1 - d'Bistro",
      "     T O T A L      0  0  0  0  0.00  100  10  11  121  100.00",
    ].join("\n");
    const res = parseFoTurnoverReport(truncated);

    expect(res.fatal).toBe(false);
    expect(res.grandTotalMtdGros).toBe(0);
    expect(res.warnings.some((w) => w.includes("GRAND TOTAL"))).toBe(true);
  });

  it("warns when department totals do not add up to GRAND TOTAL", () => {
    const mismatched = [
      "Period :       01/11/26 - 14/11/26",
      "F/O Turnover Report by Department",
      "     1 - d'Bistro",
      "     T O T A L      0  0  0  0  0.00  100  10  11  121  100.00",
      "     GRAND TOTAL    0  0  0  0  0.00  200  20  22  242  100.00",
    ].join("\n");
    const res = parseFoTurnoverReport(mismatched);

    expect(res.grandTotalMtdGros).toBe(242);
    expect(res.warnings.some((w) => w.includes("tidak sama"))).toBe(true);
  });

  const realPath = path.resolve(process.cwd(), "fixtures/arsip/2026-11-01_to_2026-11-14/revenue.txt");
  const itReal = fs.existsSync(realPath) ? it : it.skip;

  itReal("matches GRAND TOTAL in real revenue.txt fixture", () => {
    const text = fs.readFileSync(realPath, "utf8");
    const res = parseFoTurnoverReport(text);
    expect(res.fatal).toBe(false);
    expect(res.grandTotalMtdGros).toBe(310069539);
    const sumDepts = res.departments.reduce((s, d) => s + d.mtdGros, 0);
    expect(sumDepts).toBe(res.grandTotalMtdGros);
  });

  it("reads room revenue (Lodging) of the period's last day, to spot a day not closed yet (owner, 22 Nov)", () => {
    const report = (dayGros: string) =>
      [
        "Period :       01/11/26 - 21/11/26",
        "F/O Turnover Report by Department",
        "     0 - Front Office",
        ` 100 Lodging (Room Revenue)   ${dayGros === "0" ? "0  0  0  0  0.00" : `4,469,004  446,900  491,590  ${dayGros}  97.65`}   167,646,569  16,764,657  18,441,123  202,852,348  93.96   0  0  0  0  0.00  0.00`,
        " 110 Extra Bed   123,967  12,397  13,636  150,000  100.00   7,272,728  727,273  800,000  8,800,000  4.08   0  0  0  0  0.00  0.00",
        "     T O T A L   123,967  12,397  13,636  150,000  100.00   174,919,297  17,491,930  19,241,123  211,652,348  100.00   0  0  0  0  0.00  0.00",
        "     GRAND TOTAL 123,967  12,397  13,636  150,000  100.00   174,919,297  17,491,930  19,241,123  211,652,348  100.00   0  0  0  0  0.00  0.00",
      ].join("\n");
    expect(parseFoTurnoverReport(report("0")).lastDayLodging).toBe(0);
    expect(parseFoTurnoverReport(report("5,407,495")).lastDayLodging).toBe(5407495);
    // Without a Front Office Lodging line the day is unknown, never taken as 0.
    expect(parseFoTurnoverReport(report("0").replace(/ 100 Lodging.*\n/, "")).lastDayLodging).toBeNull();
  });
});
