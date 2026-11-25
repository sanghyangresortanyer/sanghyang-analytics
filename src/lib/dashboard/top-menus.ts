// "(0.1 Ons)" lines are the tenths of a weighed dish, not menus of their own (same rule as menu-activity.ts).
const TENTHS = /^\(0[.,]1\s*ons\)/i;

type Item = { outlet_name: string; description: string; total_qty: number; total_amount: number; source?: "journal" | "fo" };

/** Best-selling menus of every outlet in the period, by sales (Penjualan per Artikel lines only). */
export function topMenus<T extends Item>(items: T[], n = 10): T[] {
  return items
    .filter((i) => i.source === "journal" && i.total_amount > 0 && !TENTHS.test(i.description))
    .sort((a, b) => b.total_amount - a.total_amount)
    .slice(0, n);
}
