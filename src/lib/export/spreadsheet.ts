import ExcelJS from "exceljs";

export interface Sheet {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
}

/** Excel rejects sheet names over 31 chars or containing []:*?/\ */
const safeName = (name: string) => name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);

export async function buildWorkbook(sheets: Sheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(safeName(sheet.name));
    worksheet.addRow(sheet.headers).font = { bold: true };
    for (const row of sheet.rows) worksheet.addRow(row.map((v) => v ?? ""));
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.columns.forEach((column, i) => {
      const longest = Math.max(sheet.headers[i]?.length ?? 0, ...sheet.rows.map((r) => String(r[i] ?? "").length));
      column.width = Math.min(Math.max(longest + 2, 10), 50);
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
