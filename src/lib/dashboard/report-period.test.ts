import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFoTurnoverReport } from "@/lib/parsers/fo-turnover-parser";
import { isReportPeriodWithinRange } from "./report-period";

describe("isReportPeriodWithinRange", () => {
  const fixturePath = path.resolve(process.cwd(), "fixtures/arsip/2026-11-01_to_2026-11-14/revenue.txt");
  const itWithFixture = fs.existsSync(fixturePath) ? it : it.skip;

  itWithFixture("excludes a real VHP report when the selected range cuts off part of its period", () => {
    const report = parseFoTurnoverReport(fs.readFileSync(fixturePath, "utf8"));

    expect(report.periodStart).toBe("2026-11-01");
    expect(report.periodEnd).toBe("2026-11-14");
    expect(isReportPeriodWithinRange(report.periodStart!, report.periodEnd!, "2026-11-01", "2026-11-10")).toBe(false);
    expect(isReportPeriodWithinRange(report.periodStart!, report.periodEnd!, "2026-11-01", "2026-11-14")).toBe(true);
  });
});
