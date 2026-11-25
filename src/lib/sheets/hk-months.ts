/** Month tabs of the HK sheet held in the database, newest first ("2026-11-01"). */
export function hkMonths(items: { period_month: string }[]): string[] {
  return [...new Set(items.map((i) => i.period_month))].sort().reverse();
}

/** The month asked for in the address (?hk=2026-10-01) when it exists, else the newest. */
export function chooseHkMonth(months: string[], requested: string | undefined): string | null {
  return requested && months.includes(requested) ? requested : (months[0] ?? null);
}
