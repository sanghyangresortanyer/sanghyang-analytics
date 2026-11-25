export function parseVhpDate(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(trimmed);
  if (!m) return null;
  const rawYear = Number(m[3]);
  const year = m[3].length === 2 ? 2000 + rawYear : rawYear;
  const month = Number(m[2]);
  const day = Number(m[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/**
 * When a VHP report was printed, from its header line "Date   : 18/11/26   15:21:01" (hotel time,
 * WIB), as an ISO timestamp with offset. Null when the header has no such line.
 */
export function vhpPrintedAt(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /Date\s*:\s*(\d{2}\/\d{2}\/\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.slice(0, 4000));
  const day = m ? parseVhpDate(m[1]) : null;
  if (!m || !day) return null;
  return `${day}T${m[2]}:${m[3]}:${m[4] ?? "00"}+07:00`;
}
