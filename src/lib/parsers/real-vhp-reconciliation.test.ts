import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseFoTurnoverReport } from "./fo-turnover-parser";
import { parsePurchaseReceipts } from "./purchase-receipts";
import { buildWeeklyComparison } from "../comparison/weekly-aggregator";

describe("Phase 2: Validasi Data Nyata & Rekonsiliasi Ekspor VHP Asli", () => {
  const revenuePath = path.resolve(__dirname, "../../../fixtures/arsip/2026-11-01_to_2026-11-14/revenue.txt");
  const pembelianPath = path.resolve(__dirname, "../../../fixtures/arsip/2026-11-01_to_2026-11-14/Pembelian.txt");

  // Both exports are gitignored business data: on a clean clone or CI the suite is skipped, not failed.
  const itReal = fs.existsSync(revenuePath) && fs.existsSync(pembelianPath) ? it : it.skip;

  itReal("merekonstruksi dan mencocokkan laporan F/O Turnover VHP (revenue.txt) dengan presisi 100%", () => {
    const text = fs.readFileSync(revenuePath, "utf-8");
    const result = parseFoTurnoverReport(text);

    expect(result.fatal).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.warnings).toEqual([]);

    // Periode terdeteksi tepat 01/11/26 - 14/11/26
    expect(result.periodStart).toBe("2026-11-01");
    expect(result.periodEnd).toBe("2026-11-14");

    // Grand total matematis cocok persis dengan baris GRAND TOTAL di berkas VHP
    expect(result.grandTotalMtdNett).toBe(256255823);
    expect(result.grandTotalMtdGros).toBe(310069539);

    // Memastikan seluruh departemen terurai dan jumlahnya cocok dengan Grand Total
    expect(result.departments.length).toBeGreaterThan(0);
    const sumGros = result.departments.reduce((acc, d) => acc + d.mtdGros, 0);
    const sumNett = result.departments.reduce((acc, d) => acc + d.mtdNett, 0);

    expect(sumGros).toBe(result.grandTotalMtdGros);
    expect(sumNett).toBe(result.grandTotalMtdNett);
  });

  itReal("merekonstruksi dan mencocokkan Receiving List VHP (Pembelian.txt) dengan presisi 100%", () => {
    const text = fs.readFileSync(pembelianPath, "utf-8");
    const result = parsePurchaseReceipts(text);

    expect(result.fatal).toBe(false);
    expect(result.rows.length).toBeGreaterThan(0);

    // Total kuantitas dan nilai pembelian
    const totalQty = result.rows.reduce((sum, r) => sum + r.qty, 0);
    const totalValue = result.rows.reduce((sum, r) => sum + (r.value ?? r.price * r.qty), 0);

    // Cocok dengan angka GRAND TOTAL di berkas: Qty 6,510.63 dan Value Rp 113,907,935
    expect(Math.round(totalQty * 100) / 100).toBe(6510.63);
    expect(Math.round(totalValue)).toBe(113907935);

    // Supplier terdeteksi dan tidak ada baris yang kehilangan supplier
    expect(result.stats.supplierCount).toBeGreaterThan(5);
    expect(result.rows.every((r) => typeof r.supplier === "string" && r.supplier.length > 0)).toBe(true);
  });

  itReal("mengintegrasikan kedua berkas nyata ke Weekly Aggregator tanpa galat dan menghasilkan rasio yang akurat", () => {
    const revText = fs.readFileSync(revenuePath, "utf-8");
    const purText = fs.readFileSync(pembelianPath, "utf-8");

    const foResult = parseFoTurnoverReport(revText);
    const purResult = parsePurchaseReceipts(purText);

    const report = buildWeeklyComparison({
      periodStart: foResult.periodStart!,
      periodEnd: foResult.periodEnd!,
      foTurnover: foResult,
      purchaseRows: purResult.rows,
      previousMeeting: null,
    });

    expect(report.totalRevenue).toBe(310069539);
    expect(report.totalPurchase).toBe(113907935);

    // Rasio Pembelian / Revenue: 113,907,935 / 310,069,539 = ~36.7%
    expect(report.purchaseToRevenuePct).toBeCloseTo(36.736, 2);

    // Callouts otomatis terbentuk berbasis fakta
    expect(report.callouts.length).toBeGreaterThanOrEqual(2);
    expect(report.callouts.some((c) => c.includes("Outlet kontributor tertinggi"))).toBe(true);
    expect(report.callouts.some((c) => c.includes("Supplier terbesar minggu ini"))).toBe(true);
  });
});
