/**
 * VHP numbers use "," as thousand separator and "." as decimal separator,
 * regardless of server/OS locale (e.g. "24,667.58", "1,200.000", "0.050").
 * Never use Number()/parseFloat() directly on raw VHP text elsewhere.
 */
export function parseVhpNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
