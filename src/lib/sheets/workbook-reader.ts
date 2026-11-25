import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { SheetRow } from "./dml-parser";

/**
 * Streams an .xlsx and keeps the rows of the sheets `keep` accepts. Streaming
 * matters for the DML workbook (65 sheets, 4.5 MB): a full load took 16 s and
 * 770 MB RSS locally, streaming ~10 s and under 300 MB.
 */
export async function readWorkbookRows(
  data: Buffer,
  keep: (sheetName: string) => boolean,
): Promise<Map<string, SheetRow[]>> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(data), {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "ignore",
  });
  const sheets = new Map<string, SheetRow[]>();
  for await (const ws of reader) {
    const name = (ws as unknown as { name: string }).name;
    const wanted = keep(name);
    const rows: SheetRow[] = [];
    for await (const row of ws) {
      if (wanted) rows.push({ number: row.number, values: row.values as unknown[] });
    }
    if (wanted) sheets.set(name, rows);
  }
  return sheets;
}
