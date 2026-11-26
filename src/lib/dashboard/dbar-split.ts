/**
 * d'Bar Karaoke & DBC is one outlet in VHP; RPC dbar_parts (migration 0087) splits its sales into DBC menus
 * ("DBC ...") and the other menus (d'Bar & Karaoke). Discounts and compliments follow the bill they are on;
 * "belum" holds those on a bill with menus of both parts, or uploaded before bill numbers were kept.
 */
const PARTS = [
  { part: "dbc", label: "DBC" },
  { part: "bar", label: "d'Bar & Karaoke" },
  { part: "belum", label: "Diskon dan compliment yang belum dibagi" },
] as const;

export type DbarSplitRow = {
  label: string;
  /** menus after discounts and compliments */
  revenue: number;
  menu: number;
  discount: number;
  compliment: number;
  openDays: number;
  sharePct: number | null;
};
export type DbarSplit = { rows: DbarSplitRow[]; total: number; /** discounts and compliments tied to neither part */ unsplit: number };
export type DbarPart = { part: string; menu: number | string; discount: number | string; compliment: number | string; open_days: number };

export function dbarSplit(parts: DbarPart[]): DbarSplit {
  const net = (p: DbarPart) => Number(p.menu) + Number(p.discount) + Number(p.compliment);
  const by = new Map(parts.map((p) => [p.part, p]));
  const sold = parts.filter((p) => p.part !== "belum").reduce((t, p) => t + net(p), 0);
  const rows = PARTS.flatMap(({ part, label }): DbarSplitRow[] => {
    const p = by.get(part);
    if (!p || (part === "belum" && net(p) === 0)) return [];
    return [
      {
        label,
        revenue: net(p),
        menu: Number(p.menu),
        discount: Number(p.discount),
        compliment: Number(p.compliment),
        openDays: p.open_days,
        sharePct: part !== "belum" && sold > 0 ? (net(p) / sold) * 100 : null,
      },
    ];
  });
  const left = by.get("belum");
  return { rows, total: rows.reduce((t, r) => t + r.revenue, 0), unsplit: left ? net(left) : 0 };
}
