/**
 * Nett revenue (before service 10% and tax 10%), the dashboard's main revenue figure (user decision
 * 2026-11-19). F/O Turnover prints MTD-Nett per department; where an upload has it, the department's
 * own nett/gross ratio of that month is used, so whole months are exact. Elsewhere VHP's rate applies:
 * gross = nett × 1.1 × 1.1 (outlets exactly; Front Office a little less, some room charges carry no
 * service — Oct 2026: 309,893,008 gross, 256,153,319 nett).
 */
export const DEFAULT_NETT_RATIO = 1 / 1.21;

export interface NettSource {
  outlet_name: string;
  period_start: string;
  period_end: string;
  gross: number;
  nett: number | null;
}

export type NettRatio = (outlet: string, from: string, to: string) => number;

const months = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return out;
};

/** Ratio nett/gross per outlet over the months a range touches, from Turnover uploads within one month. */
export function nettRatios(sources: NettSource[]): NettRatio {
  const byMonth = new Map<string, { gross: number; nett: number }>();
  for (const s of sources) {
    if (s.nett === null || s.period_start.slice(0, 7) !== s.period_end.slice(0, 7)) continue;
    const k = `${s.outlet_name}|${s.period_start.slice(0, 7)}`;
    const cur = byMonth.get(k) ?? { gross: 0, nett: 0 };
    byMonth.set(k, { gross: cur.gross + s.gross, nett: cur.nett + s.nett });
  }
  return (outlet, from, to) => {
    let gross = 0;
    let nett = 0;
    for (const m of months(from, to)) {
      const v = byMonth.get(`${outlet}|${m}`);
      if (v) {
        gross += v.gross;
        nett += v.nett;
      }
    }
    return gross > 0 ? nett / gross : DEFAULT_NETT_RATIO;
  };
}

/**
 * The same dates one month earlier (owner, 24 Nov 2026: "biar kita tahu perbandingan perbulan"): 1–22 Nov
 * against 1–22 Okt. A day the earlier month does not have becomes its last day (1–31 Okt against 1–30 Sep).
 * Periods longer than 31 days cannot repeat inside one month: those use the same length right before.
 */
export function samePeriodLastMonth(start: string, end: string): { start: string; end: string } {
  const length = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (length > 31) return previousPeriod(start, end);
  const back = (iso: string) => {
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7)) - 1; // this month, 0-based
    const first = new Date(Date.UTC(y, m - 1, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return `${first.toISOString().slice(0, 8)}${String(Math.min(Number(iso.slice(8, 10)), last)).padStart(2, "0")}`;
  };
  return { start: back(start), end: back(end) };
}

/** Same length period right before [start, end]. */
export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const day = 86_400_000;
  const s = Date.parse(`${start}T00:00:00Z`);
  const len = Math.round((Date.parse(`${end}T00:00:00Z`) - s) / day) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { start: iso(s - len * day), end: iso(s - day) };
}
