export function formatRp(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

/** Compact Rupiah for chart axes: 310,1 jt · 1,3 M · 450 rb. */
export function formatRpShort(value: number): string {
  const abs = Math.abs(value);
  const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (abs >= 1e9) return `${fmt(value / 1e9)} M`;
  if (abs >= 1e6) return `${fmt(value / 1e6)} jt`;
  if (abs >= 1e3) return `${fmt(value / 1e3)} rb`;
  return fmt(value);
}

export function formatPct(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
