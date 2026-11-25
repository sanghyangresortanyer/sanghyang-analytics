/** Menus of one outlet for "Menu terjual" and the outlet report (owner, 24 Nov 2026). Pure, tested on its own. */

// "(0.1 Ons)" lines are the tenths of a weighed dish, not menus of their own (as in menu-activity.ts).
const TENTHS = /^\(0[.,]1\s*ons\)/i;
/** A menu counts as selling well when it averages more than this many portions a month (owner). */
export const BUSY_PER_MONTH = 3;

type Menu = { description: string; total_qty: number; total_amount: number; source?: "journal" | "fo" };

/** Portions per month: the period's portions spread over 30 days. */
export const perMonth = (qty: number, days: number) => (days > 0 ? (qty * 30) / days : 0);

/** Menus sold in the period, most portions first (owner: "sort dari total qty terbanyak"), with their monthly average. */
export function soldMenus<T extends Menu>(items: T[], days: number): (T & { monthly: number })[] {
  return items
    .filter((i) => i.source === "journal" && i.total_qty > 0 && !TENTHS.test(i.description))
    .map((i) => ({ ...i, monthly: perMonth(i.total_qty, days) }))
    .sort((a, b) => b.total_qty - a.total_qty || b.total_amount - a.total_amount || a.description.localeCompare(b.description));
}

/** Only menus that average more than BUSY_PER_MONTH portions a month. */
export const busyMenus = <T extends { monthly: number }>(menus: T[]) => menus.filter((m) => m.monthly > BUSY_PER_MONTH);
