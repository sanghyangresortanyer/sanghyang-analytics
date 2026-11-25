/**
 * Menu paling tidak laku, counted back from the last day with data (owner, 2026-11-23: "jangkanya 3 bulan
 * saja"): only menus sold at least once in the last `deadDays` days (3 months) are listed, fewest portions
 * first. A menu with no sale in those 3 months is taken as off the menu and left out. A menu first sold in
 * the last `slowDays` days (one month) is new, not unpopular, and is left out too. `top` still covers the
 * 12 months behind menuBaseline. `slowBelow` is no longer used for the list (kept so saved settings load).
 */
export type MenuRules = { deadDays: number; slowDays: number; slowBelow: number };
export const DEFAULT_MENU_RULES: MenuRules = { deadDays: 90, slowDays: 30, slowBelow: 5 };
/** Limits the Pengaturan form accepts. */
export const MENU_RULE_LIMITS = { deadDays: { min: 14, max: 365 }, slowDays: { min: 7, max: 120 }, slowBelow: { min: 1, max: 100 } };

export interface MenuActivity {
  outlet: string;
  artNo: string;
  description: string;
  totalQty: number;
  /** Portions in the last `deadDays` days. */
  windowQty: number;
  /** Portions in the last `slowDays` days. */
  slowQty: number;
  totalSales: number;
  lastSold: string;
  /** Portions sold on `lastSold` (menu_last_sale); undefined when not read. */
  lastQty?: number;
  firstSold: string;
}

// "(0.1 Ons)" lines are the tenths of a weighed dish ordered as "(Ons) <dish>", not menus of their own.
const TENTHS = /^\(0[.,]1\s*ons\)/i;

/** First day with VHP data in the app; nothing older is used (owner, 2026-11-19). */
export const DATA_START = "2026-01-01";

/**
 * Start of the look-back for "has this menu ever sold": 12 months before the last day with data,
 * never before DATA_START. Counted back from the latest data, not from 1 January (owner, 2026-11-21).
 */
export function menuBaseline(lastDay: string): string {
  const from = windowStart(lastDay, 365);
  return from < DATA_START ? DATA_START : from;
}

export function windowStart(lastDay: string, days: number): string {
  const d = new Date(`${lastDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export function classifyMenus(rows: MenuActivity[], lastDay: string, rules: MenuRules = DEFAULT_MENU_RULES) {
  const deadFrom = windowStart(lastDay, rules.deadDays);
  const slowFrom = windowStart(lastDay, rules.slowDays);
  const menus = rows.filter((r) => !TENTHS.test(r.description));
  // Best sellers of the 12 months (menuBaseline to lastDay), 10 per outlet, by sales.
  const top: MenuActivity[] = [];
  const perOutlet = new Map<string, number>();
  for (const r of menus.filter((x) => x.totalSales > 0).sort((a, b) => b.totalSales - a.totalSales)) {
    const n = perOutlet.get(r.outlet) ?? 0;
    if (n >= 10) continue;
    perOutlet.set(r.outlet, n + 1);
    top.push(r);
  }
  return {
    ...rules,
    deadFrom,
    slowFrom,
    yearFrom: menuBaseline(lastDay),
    top,
    least: menus
      .filter((r) => r.windowQty > 0 && r.firstSold < slowFrom)
      .sort((a, b) => a.windowQty - b.windowQty || a.slowQty - b.slowQty || a.description.localeCompare(b.description)),
  };
}
