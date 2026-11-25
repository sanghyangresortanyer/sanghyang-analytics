// Date helpers (YYYY-MM-DD strings, Asia/Jakarta reporting). The Meta-specific metrics stay in the AMP-META-ADS project.

export const todayIn = (tz: string, now = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
