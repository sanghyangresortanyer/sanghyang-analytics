import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "./spreadsheet";

describe("buildWorkbook", () => {
  it("round-trips a real xlsx with one worksheet per sheet", async () => {
    const buffer = await buildWorkbook([
      { name: "Ringkasan", headers: ["Keterangan", "Nilai"], rows: [["Total Revenue", 1234.5], ["Kosong", null]] },
      { name: "Nama Sheet Yang Sangat Panjang Sekali Melebihi Batas", headers: ["Nama"], rows: [['Nasi <Goreng> & "spesial"']] },
    ]);

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as unknown as Parameters<typeof reopened.xlsx.load>[0]);

    expect(reopened.worksheets).toHaveLength(2);
    expect(reopened.worksheets[0].name).toBe("Ringkasan");
    // Excel caps sheet names at 31 characters
    expect(reopened.worksheets[1].name).toHaveLength(31);
    // numbers stay numbers so Excel can SUM them
    expect(reopened.getWorksheet("Ringkasan")!.getCell("B2").value).toBe(1234.5);
    expect(reopened.getWorksheet("Ringkasan")!.getCell("A1").font?.bold).toBe(true);
    expect(reopened.worksheets[1].getCell("A2").value).toBe('Nasi <Goreng> & "spesial"');
  });
});
