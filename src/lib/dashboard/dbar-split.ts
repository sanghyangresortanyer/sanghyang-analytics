/**
 * d'Bar Karaoke & DBC is one outlet in VHP; RPC dbar_split (migration 0074) splits its menu sales into
 * DBC menus ("DBC ..."), the other menus (d'Bar & Karaoke) and discounts, which cannot be tied to either.
 */
const PARTS = [
  { part: "dbc", label: "DBC" },
  { part: "bar", label: "d'Bar & Karaoke" },
  { part: "diskon", label: "Diskon (belum bisa dipisah)" },
] as const;

export type DbarSplitRow = { label: string; revenue: number; openDays: number; sharePct: number | null };

export function dbarSplit(rows: { part: string; revenue: number | string; open_days: number }[]) {
  const by = new Map(rows.map((r) => [r.part, r]));
  const menus = rows.filter((r) => r.part !== "diskon").reduce((s, r) => s + Number(r.revenue), 0);
  const out: DbarSplitRow[] = PARTS.filter((p) => by.has(p.part)).map((p) => {
    const r = by.get(p.part)!;
    const revenue = Number(r.revenue);
    return { label: p.label, revenue, openDays: r.open_days, sharePct: p.part !== "diskon" && menus > 0 ? (revenue / menus) * 100 : null };
  });
  return { rows: out, total: out.reduce((s, r) => s + r.revenue, 0) };
}
