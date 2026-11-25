/**
 * Cell values as exceljs emits them from a Google Sheets .xlsx export
 * (row.values, 1-based): number, string, Date, boolean, { formula, result },
 * { richText }, { error }, { text, hyperlink }, or null.
 */
export type RawCell = unknown;

export type CellNumber =
  | { kind: "empty" }
  | { kind: "number"; value: number }
  | { kind: "invalid"; text: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !(v instanceof Date);
}

function errorText(v: unknown): string | null {
  if (isObject(v) && typeof v.error === "string") return v.error;
  return null;
}

export function cellText(v: RawCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (isObject(v)) {
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map((t) => t.text ?? "").join("").trim();
    }
    if ("formula" in v || "sharedFormula" in v) return cellText(v.result);
    const err = errorText(v);
    if (err) return err;
    if (typeof v.text === "string") return v.text.trim();
  }
  return "";
}

/**
 * Numeric value of a cell.
 *
 * A formula cell without a cached result is read as 0: Google Sheets leaves the
 * cached value out of its .xlsx export when the formula evaluates to 0 (checked
 * against the HK sheet, where every such cell is a sum of empty or cancelling
 * cells). Any other non-numeric content, including #REF!/#N/A, is "invalid" so
 * the caller can report it instead of guessing.
 */
export function cellNumber(v: RawCell): CellNumber {
  if (v === null || v === undefined) return { kind: "empty" };
  if (typeof v === "number") return Number.isFinite(v) ? { kind: "number", value: v } : { kind: "invalid", text: String(v) };
  if (typeof v === "string") return numberFromText(v);
  if (isObject(v)) {
    if ("formula" in v || "sharedFormula" in v) {
      if (!("result" in v) || v.result === undefined) return { kind: "number", value: 0 };
      const inner = cellNumber(v.result);
      return inner.kind === "empty" ? { kind: "number", value: 0 } : inner;
    }
    const err = errorText(v);
    if (err) return { kind: "invalid", text: err };
  }
  const text = cellText(v);
  return text === "" ? { kind: "empty" } : { kind: "invalid", text };
}

/**
 * Numbers typed as text. Accepted: "12", "0.5" (dot decimal, not 3 digits),
 * "0,5" and "8.600,00" (Indonesian). "-" means nothing was filled in.
 * "1.500" is ambiguous (1,5 or 1500) and "25.800.00" malformed: both invalid.
 */
export function numberFromText(raw: string): CellNumber {
  const t = raw.trim();
  if (t === "" || /^[-–—]$/.test(t)) return { kind: "empty" };
  if (/^-?\d+$/.test(t)) return { kind: "number", value: Number(t) };
  if (/^-?\d+\.(\d{1,2}|\d{4,})$/.test(t)) return { kind: "number", value: Number(t) };
  if (/^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(t)) {
    return { kind: "number", value: Number(t.replace(/\./g, "").replace(",", ".")) };
  }
  return { kind: "invalid", text: t };
}

/** Normalised header text: lowercase, single spaces, no trailing punctuation. */
export function headerKey(v: RawCell): string {
  return cellText(v).toLowerCase().replace(/\s+/g, " ").trim();
}
