import { describe, expect, it } from "vitest";
import { parseDmlSheet, parseDmlSheetDate, type SheetRow } from "./dml-parser";

const f = (formula: string, result?: unknown) => (result === undefined ? { formula } : { formula, result });

/** Rows shaped like sheet "15-11-26": values are 1-based like exceljs row.values. */
function rows(list: unknown[][]): SheetRow[] {
  return list.map((cells, i) => ({ number: i + 1, values: [null, ...cells] }));
}

const HEADER = ["No Art", "Description", "D-Unit", "Price", "SOH", "Qty Req", null, "Pembelanjaan ", "Supplier Name"];
const section = (name: string) => Array(8).fill(name);

describe("parseDmlSheetDate", () => {
  it("reads DD-MM-YY and DD-MM-YYYY sheet names, with or without a DML prefix", () => {
    expect(parseDmlSheetDate("15-11-26")).toBe("2026-11-15");
    expect(parseDmlSheetDate("19-04-2026")).toBe("2026-04-19");
    expect(parseDmlSheetDate("DML 16-11-25")).toBe("2025-11-16");
  });

  it("rejects names that are not a full date", () => {
    expect(parseDmlSheetDate("26-10")).toBeNull();
    expect(parseDmlSheetDate("Realisasi 18-01-26")).toBeNull();
    expect(parseDmlSheetDate("31-02-26")).toBeNull();
    expect(parseDmlSheetDate("Sheet4")).toBeNull();
  });
});

describe("parseDmlSheet", () => {
  it("splits lines per outlet section and reconciles with each subtotal and the grand total", () => {
    const sheet = parseDmlSheet(
      "15-11-26",
      rows([
        [],
        ["Tanggal : …"],
        [],
        section("MAIN KITCHEN"),
        HEADER,
        [1104002, f("VLOOKUP()", "Bawang Merah"), "Kg", 35500, 2, 2, f("+D6*F6", 71000), "DARUS PUTRA"],
        [1104005, "Bawang Bombay", "Kg", 25000, 2, 3, f("+D7*F7", 75000), "Silokananta"],
        [null, null, null, null, null, null, f("sum(G6:G7)", 146000)],
        [],
        section("SUNSET GRIL"),
        [null, "Description", "D-Unit", "Price", "SOH", "Qty Req", null, "Pembelanjaan "],
        ["New art", "Syrup Strawberry", "btl", 103000, 0.6, 2, f("", 206000), "online", "https://id.shp.ee/x"],
        [null, null, null, null, null, null, f("sum(G12:G12)", 206000)],
        [],
        [null, "Kitchen", null, null, null, null, f("G8", 146000), "CASH ANYER"],
        [null, "SG", null, null, null, null, f("G13", 206000), "Online"],
        [null, null, null, null, null, null, f("sum(G15:G16)", 352000)],
      ]),
    );

    expect(sheet.listDate).toBe("2026-11-15");
    expect(sheet.warnings).toEqual([]);
    expect(sheet.outlets).toEqual([
      { outlet: "MAIN KITCHEN", total: 146000, lineCount: 2, sheetSubtotal: 146000 },
      { outlet: "SUNSET GRILL", total: 206000, lineCount: 1, sheetSubtotal: 206000 },
    ]);
    expect(sheet.totalRequest).toBe(352000);
    expect(sheet.sheetGrandTotal).toBe(352000);
    expect(sheet.lines[0]).toEqual({
      rowNo: 6,
      outlet: "MAIN KITCHEN",
      itemCode: "1104002",
      itemName: "Bawang Merah",
      unit: "Kg",
      price: 35500,
      soh: 2,
      qtyReq: 2,
      total: 71000,
      purchaseChannel: "DARUS PUTRA",
      note: null,
    });
    expect(sheet.lines[2]).toMatchObject({ itemCode: null, itemName: "Syrup Strawberry", note: "https://id.shp.ee/x" });
  });

  it("takes the outlet from a single label row (e.g. MR) above a header", () => {
    const sheet = parseDmlSheet(
      "15-11-26",
      rows([
        ["MR"],
        HEADER,
        [null, "Chemical Kaca", "Liter", 75000, 0, 3, f("+D3*F3", 225000)],
        [null, null, null, null, null, null, f("sum(G3:G3)", 225000)],
      ]),
    );
    expect(sheet.outlets).toEqual([{ outlet: "MR", total: 225000, lineCount: 1, sheetSubtotal: 225000 }]);
  });

  it("reports a subtotal that does not match its lines instead of trusting either", () => {
    const sheet = parseDmlSheet(
      "08-11-26",
      rows([
        section("BISTRO"),
        HEADER,
        [1107005, "Gula", "Pack", 1000, 0, 2, f("+D3*F3", 2000)],
        [null, null, null, null, null, null, f("sum(G3:G3)", 9000)],
      ]),
    );
    expect(sheet.outlets[0]).toMatchObject({ total: 2000, sheetSubtotal: 9000 });
    expect(sheet.warnings).toEqual([expect.stringContaining("BISTRO")]);
  });

  it("keeps a line with a broken number but leaves the value empty and warns", () => {
    const sheet = parseDmlSheet(
      "11-01-26",
      rows([
        section("MAIN KITCHEN"),
        HEADER,
        [1100001, "Ayam", "Kg", 35500, 12, 15, f("+D3*F3", { error: "#REF!" })],
        [null, null, null, null, null, null, f("sum(G3:G3)", 0)],
      ]),
    );
    expect(sheet.lines[0]).toMatchObject({ itemName: "Ayam", total: null, qtyReq: 15 });
    expect(sheet.warnings).toEqual([expect.stringContaining("#REF!")]);
  });

  it("ignores notes right of the table on a label row and maps D'BISTRO to BISTRO", () => {
    const sheet = parseDmlSheet(
      "12-04-26",
      rows([
        ["D'BISTRO", null, null, null, null, null, null, null, null, null, "ENGINEERING"],
        HEADER,
        [3328068, "Gelas", "Pcs", 20000, 0, 2, f("D3*F3", 40000), "Online"],
        [null, null, null, null, null, null, f("sum(G3:G3)", 40000)],
      ]),
    );
    expect(sheet.outlets.map((o) => o.outlet)).toEqual(["BISTRO"]);
    expect(sheet.warnings).toEqual([]);
  });

  it("ignores item rows that appear before any header", () => {
    const sheet = parseDmlSheet("15-11-26", rows([[1104002, "Bawang Merah", "Kg", 35500, 2, 2, 71000]]));
    expect(sheet.lines).toEqual([]);
    expect(sheet.outlets).toEqual([]);
  });

  it("reads MR section with 'Bagian dept' column and notes", () => {
    const mrHeader = ["No Art", "Description", "D-Unit", "Price", "SOH", "Qty Req", null, "Bagian dept", "Notes"];
    const sheet = parseDmlSheet(
      "15-11-26",
      rows([
        section("MR"),
        mrHeader,
        [4499062, "Bambu 2\"", "Pcs", 12000, null, 13, 156000, "ENG", null],
        [4456381, "Tee PVC 4\" Rucika", "Pce", 95000, null, 1, 95000, "ENG", "3\""],
        [3301030, "Rokok Marlboro Ice Blast", "Slop", 52000, null, 30, 1560000, "DBC", null],
        [null, null, null, null, null, null, 1811000],
      ]),
    );

    expect(sheet.outlets).toEqual([{ outlet: "MR", total: 1811000, lineCount: 3, sheetSubtotal: 1811000 }]);
    expect(sheet.lines).toHaveLength(3);
    expect(sheet.lines[0]).toMatchObject({
      itemName: "Bambu 2\"",
      purchaseChannel: "ENG",
      note: null,
    });
    expect(sheet.lines[1]).toMatchObject({
      itemName: "Tee PVC 4\" Rucika",
      purchaseChannel: "ENG",
      note: "3\"",
    });
    expect(sheet.lines[2]).toMatchObject({
      itemName: "Rokok Marlboro Ice Blast",
      purchaseChannel: "DBC",
      note: null,
    });
  });
});
