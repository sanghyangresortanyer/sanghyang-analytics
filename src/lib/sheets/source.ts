import "server-only";

export type SheetSource = "hk" | "dml";

export const SHEET_SOURCES: { source: SheetSource; label: string; env: string }[] = [
  { source: "hk", label: "Inventory HK", env: "GOOGLE_SHEET_HK_ID" },
  { source: "dml", label: "DML Pembelian Outlet", env: "GOOGLE_SHEET_DML_ID" },
];

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Google file id from env; accepts a bare id or a pasted share link. */
export function sheetFileId(source: SheetSource): string | null {
  const raw = process.env[SHEET_SOURCES.find((s) => s.source === source)!.env]?.trim();
  if (!raw) return null;
  const fromLink = /\/d\/([A-Za-z0-9_-]{20,})/.exec(raw);
  const id = fromLink ? fromLink[1] : raw;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) {
    throw new Error(`ID Google Sheet di ${source.toUpperCase()} tidak valid: "${raw}".`);
  }
  return id;
}

/**
 * Downloads the sheet as .xlsx through its share link ("Anyone with the link"
 * can view). Works for native Google Sheets and for .xlsx files stored in Drive.
 */
export async function downloadSheetXlsx(fileId: string): Promise<Buffer> {
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;
  const res = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(90_000) });
  if (!res.ok) {
    throw new Error(`Google menolak unduhan (HTTP ${res.status}). Cek link share masih aktif.`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes(XLSX_TYPE)) {
    throw new Error(
      'Sheet tidak bisa dibuka tanpa login. Set berbagi ke "Siapa saja yang memiliki link" (Viewer).',
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("Unduhan dari Google bukan file .xlsx yang utuh.");
  }
  return buf;
}
