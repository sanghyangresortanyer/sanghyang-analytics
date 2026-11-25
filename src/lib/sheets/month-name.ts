/**
 * Month of an HK stock tab from its name: "Nov 2026", "November 2026", "NOV 26",
 * "11-2026", "2026-11". Indonesian and English month names. Returns "YYYY-MM",
 * or null when the name is not a month (the caller reports it; no guessing).
 */
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, nopember: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

const iso = (year: number, month: number) =>
  month >= 1 && month <= 12 && year >= 2000 && year <= 2100 ? `${year}-${String(month).padStart(2, "0")}` : null;

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

export function parseMonthName(sheetName: string): string | null {
  const name = sheetName.trim().toLowerCase().replace(/\s+/g, " ");

  const named = /^([a-z]+)\.?[ -]?(\d{2}|\d{4})$/.exec(name);
  if (named) {
    const month = MONTHS[named[1]];
    return month ? iso(fullYear(named[2]), month) : null;
  }
  const monthFirst = /^(\d{1,2})[-/ ](\d{4})$/.exec(name);
  if (monthFirst) return iso(Number(monthFirst[2]), Number(monthFirst[1]));
  const yearFirst = /^(\d{4})[-/ ](\d{1,2})$/.exec(name);
  if (yearFirst) return iso(Number(yearFirst[1]), Number(yearFirst[2]));
  return null;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "2026-11" + 5 → "2026-11-05". */
export function dateInMonth(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** "2026-11" → "2026-10". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
