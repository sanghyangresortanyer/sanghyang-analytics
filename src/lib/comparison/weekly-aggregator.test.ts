import { describe, expect, it } from "vitest";
import { buildWeeklyComparison } from "./weekly-aggregator";
import type { ParsedRestaurantSalesRow } from "@/lib/sales/restaurant-journal-parser";
import type { ParsedPurchaseRow } from "@/lib/parsers/purchase-receipts";
import type { InventorySpreadsheetParseResult } from "@/lib/parsers/inventory-spreadsheet";

describe("buildWeeklyComparison", () => {
  it("computes global & per-outlet revenue, excludes payment rows, and preserves global-only inventory without guessing", () => {
    const revenueRows: ParsedRestaurantSalesRow[] = [
      {
        lineNo: 1,
        saleDate: "2026-11-08",
        tbNo: "1",
        billNo: "B001",
        artNo: "1001",
        description: "Nasi Goreng",
        department: "Bistro",
        qty: 2,
        amount: 200000,
        time: "12:00:00",
        foArtikel: "",
      },
      {
        lineNo: 2,
        saleDate: "2026-11-08",
        tbNo: "1",
        billNo: "B001",
        artNo: "",
        description: "CASH",
        department: "Bistro",
        qty: 0,
        amount: -200000,
        time: "12:05:00",
        foArtikel: "",
      },
      {
        lineNo: 3,
        saleDate: "2026-11-09",
        tbNo: "2",
        billNo: "B002",
        artNo: "2001",
        description: "Mojito",
        department: "Sunset Grill",
        qty: 1,
        amount: 100000,
        time: "18:00:00",
        foArtikel: "",
      },
      {
        lineNo: 4,
        saleDate: "2026-11-01", // out of range
        tbNo: "3",
        billNo: "B003",
        artNo: "1001",
        description: "Nasi Goreng",
        department: "Bistro",
        qty: 1,
        amount: 100000,
        time: "12:00:00",
        foArtikel: "",
      },
    ];

    const purchaseRows: ParsedPurchaseRow[] = [
      {
        lineNo: 1,
        businessDate: "2026-11-10",
        ingredientCode: "001100001",
        description: "Ayam",
        unit: "Kg",
        price: 35000,
        qty: 4,
        supplier: "PT Segar",
        documentNo: "DOC-1",
        deliverNote: "DN-1",
      },
    ];

    const inventoryResult: InventorySpreadsheetParseResult = {
      rows: [
        {
          rowNo: 2,
          outletName: null,
          itemCode: "001",
          itemName: "Stok Gudang",
          unit: "Unit",
          qty: 1,
          unitPrice: 900000,
          totalValue: 900000,
        },
      ],
      warnings: [],
      hasOutletColumn: false,
      stats: { totalRows: 1, validRows: 1, skippedRows: 0, totalValue: 900000, outletCount: 0 },
      fatal: false,
    };

    const report = buildWeeklyComparison({
      periodStart: "2026-11-08",
      periodEnd: "2026-11-14",
      revenueRows,
      purchaseRows,
      inventoryResult,
    });

    expect(report.totalRevenue).toBe(300000);
    expect(report.totalPurchase).toBe(140000);
    expect(report.totalInventory).toBe(900000);
    expect(report.hasOutletInventory).toBe(false);
    expect(report.outlets).toHaveLength(2);
    expect(report.outlets[0].outletName).toBe("Bistro");
    expect(report.outlets[0].inventoryAmount).toBeNull();
    expect(report.audit.excludedPaymentRows).toBe(1);
    expect(report.audit.outOfRangeRevenueRows).toBe(1);
  });

  it("supports comparison when inventory spreadsheet is not uploaded yet", () => {
    const report = buildWeeklyComparison({
      periodStart: "2026-11-01",
      periodEnd: "2026-11-14",
      foTurnover: {
        periodStart: "2026-11-01",
        periodEnd: "2026-11-14",
        departments: [
          {
            departmentCode: "1",
            departmentName: "d'Bistro",
            mtdNett: 10000000,
            mtdService: 1000000,
            mtdTax: 1100000,
            mtdGros: 12100000,
          },
        ],
        grandTotalMtdNett: 10000000,
        grandTotalMtdGros: 12100000,
        warnings: [],
        fatal: false,
      },
      purchaseRows: [
        {
          lineNo: 1,
          businessDate: "2026-11-10",
          ingredientCode: "001100001",
          description: "Ayam",
          unit: "Kg",
          price: 35000,
          qty: 10,
          supplier: "PT Segar",
          documentNo: "DOC-1",
          deliverNote: "DN-1",
        },
      ],
      inventoryResult: null,
    });

    expect(report.totalRevenue).toBe(12100000);
    expect(report.totalPurchase).toBe(350000);
    expect(report.totalInventory).toBe(0);
    expect(report.hasOutletInventory).toBe(false);
    expect(report.warnings.some((w) => w.includes("Inventory belum diunggah"))).toBe(true);
  });
});
