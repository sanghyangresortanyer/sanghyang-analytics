import { NO_FILE, type DateSpan } from "./range-report";

/** The upload fields that say which days a saved upload covers. */
export interface UploadPeriod {
  period_start: string;
  period_end: string;
  revenue_source?: string | null;
  journal_filename?: string | null;
  purchase_filename?: string | null;
  revenue_filename?: string | null;
  revenue_exported_at?: string | null;
  journal_exported_at?: string | null;
  purchase_exported_at?: string | null;
  fo_journal_filename?: string | null;
  fo_journal_exported_at?: string | null;
  /** The Turnover's last day still had room revenue 0: VHP had not closed that day (owner, 2026-11-22). */
  revenue_open_day?: boolean | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Calendar day (WIB) a report was printed on; null when unknown. */
export const printedDay = (iso: string | null | undefined) =>
  iso ? new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10) : null;

/** A covered span plus the day its report was printed (null: unknown, taken as final). */
type CoveredSpan = DateSpan & { printed?: string | null };

/** Days each kind of VHP data exists for, across every saved upload. */
export function uploadCoverage(meetings: UploadPeriod[]): { revenue: CoveredSpan[]; sales: CoveredSpan[]; foJournal: CoveredSpan[]; purchase: CoveredSpan[] } {
  // A last day not closed in VHP (room revenue still 0) counts as pulled on that day, so it stays
  // "belum tutup" for every sales file of that upload; purchases do not depend on closing the day.
  const span = (m: UploadPeriod, printed?: string | null, closing = true) => ({
    start: m.period_start,
    end: m.period_end,
    printed: closing && m.revenue_open_day ? m.period_end : printedDay(printed),
  });
  // A file name is data only when it is a real name, never the "(Belum diunggah)" placeholder.
  const has = (name: string | null | undefined) => Boolean(name && name !== NO_FILE);
  return {
    revenue: meetings.filter((m) => m.revenue_source === "fo").map((m) => span(m, m.revenue_exported_at)),
    sales: meetings.filter((m) => has(m.journal_filename)).map((m) => span(m, m.journal_exported_at)),
    foJournal: meetings.filter((m) => has(m.fo_journal_filename)).map((m) => span(m, m.fo_journal_exported_at)),
    // Uploads from before daily lines (no revenue_source, but a revenue file) have no purchase lines.
    purchase: meetings
      .filter((m) => has(m.purchase_filename) && (m.revenue_source || m.revenue_filename === NO_FILE))
      .map((m) => span(m, m.purchase_exported_at, false)),
  };
}

/** Covered days as text: overlapping and back-to-back uploads join ("1–17 Nov"). */
export function coveredDays(spans: DateSpan[]): string {
  const days = new Set<string>();
  for (const sp of spans) for (let d = sp.start; d <= sp.end; d = addDays(d, 1)) days.add(d);
  return compactDays([...days]);
}

export function missingDays(spans: DateSpan[], from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!spans.some((s) => s.start <= d && s.end >= d)) out.push(d);
  return out;
}

/**
 * Receiving entries can be keyed in later for past dates, so the month's purchases are re-exported
 * at least once a week (user rule 2026-11-18). Due when the newest export is 7+ days old or unknown.
 */
function purchaseReexport(spans: CoveredSpan[], today: string): string | null {
  const printed = spans.map((sp) => sp.printed).filter((d): d is string => Boolean(d)).sort().pop();
  if (printed && addDays(printed, 7) > today) return null;
  return printed ? `ekspor ulang dari tgl 1 (terakhir ${compactDays([printed])})` : "ekspor ulang dari tgl 1";
}

/** "1–3 Nov, 17 Nov": runs of consecutive days joined. */
export function compactDays(dates: string[]): string {
  const runs: [string, string][] = [];
  for (const d of [...dates].sort()) {
    const last = runs.at(-1);
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else runs.push([d, d]);
  }
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  // A run across a month end names both months: "30 Nov–1 Des".
  return runs.map(([a, b]) => (a === b ? day(a) : `${a.slice(0, 7) === b.slice(0, 7) ? Number(a.slice(8, 10)) : day(a)}–${day(b)}`)).join(", ");
}

/**
 * Status of every data source from the 1st of the month up to yesterday (today's VHP day is
 * still open); on the 1st the whole previous month is checked. Every source is listed: `missing`
 * is null when complete, else the days (or "belum tersambung"). `hkThrough` is the last day the
 * HK Google Sheet has movements for.
 */
export function dataReminders(input: { today: string; meetings: UploadPeriod[]; notConnected: string[]; hkThrough?: string | null }) {
  const through = addDays(input.today, -1);
  const from = `${through.slice(0, 7)}-01`;
  const c = uploadCoverage(input.meetings);
  // Missing days, then days covered only by reports printed on or before that day (not closed yet).
  const gap = (spans: CoveredSpan[], a = from, b = through) => {
    const covering = (d: string) => spans.filter((sp) => sp.start <= d && sp.end >= d);
    const missing = missingDays(spans, a, b);
    const open = missingDays([], a, b).filter((d) => {
      const c = covering(d);
      return c.length > 0 && c.every((sp) => sp.printed != null && sp.printed <= d);
    });
    const parts = [compactDays(missing), open.length ? `${compactDays(open)} belum tutup` : ""].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  };
  const groups: { name: string; items: { label: string; missing: string | null }[] }[] = [
    {
      name: "VHP",
      items: [
        // Daily revenue comes from Turnover, or from F/O Journal + Penjualan per Artikel (same figure).
        { label: "Revenue", missing: gap([...c.revenue, ...c.foJournal]) },
        { label: "Penjualan per Artikel", missing: gap(c.sales) },
        { label: "Pembelian", missing: [gap(c.purchase), purchaseReexport(c.purchase, input.today)].filter(Boolean).join(" · ") || null },
        // Shown on its own as well: the user tracks how far the F/O Journal is complete (2026-11-18).
        { label: "F/O Journal", missing: gap(c.foJournal) },
      ],
    },
    {
      name: "Google Sheets",
      items: [
        ...(input.hkThrough !== undefined ? [{ label: "HK", missing: gap(input.hkThrough ? [{ start: from, end: input.hkThrough }] : []) }] : []),
        ...(input.notConnected.length ? [{ label: input.notConnected.join(", "), missing: "belum tersambung" }] : []),
      ],
    },
  ];
  const complete = groups.every((g) => g.items.every((i) => i.missing === null));
  // Sources pulled through today: today's VHP day is still open, so those figures are provisional.
  const coversToday = (spans: CoveredSpan[]) => spans.some((sp) => sp.start <= input.today && sp.end >= input.today);
  const provisional = [
    coversToday([...c.revenue, ...c.foJournal]) ? "Revenue" : "",
    coversToday(c.sales) ? "Penjualan per Artikel" : "",
    coversToday(c.purchase) ? "Pembelian" : "",
    coversToday(c.foJournal) ? "F/O Journal" : "",
  ].filter(Boolean);
  // Days since the last day with revenue, up to yesterday: the headline "sudah N hari belum diimport".
  const lastRevenue = [...c.revenue, ...c.foJournal].map((sp) => sp.end).sort().pop() ?? null;
  let behind: { days: number; from: string; to: string; text: string } | null = null;
  if (lastRevenue && lastRevenue < through) {
    const start = addDays(lastRevenue, 1);
    const days = missingDays([], start, through).length;
    behind = { days, from: start, to: through, text: compactDays(missingDays([], start, through)) };
  }
  // Last month must be uploaded complete (the official figures) once the admin had until the 5th
  // to finish corrections (owner, 2026-11-22). Revenue is the measure: every day in and closed.
  let lastMonth: { label: string; from: string; to: string; missing: string } | null = null;
  if (Number(input.today.slice(8, 10)) > LAST_MONTH_GRACE_DAYS) {
    const lmTo = addDays(from, -1);
    const lmFrom = `${lmTo.slice(0, 7)}-01`;
    const missing = gap([...c.revenue, ...c.foJournal], lmFrom, lmTo);
    if (missing) lastMonth = { label: `${MONTHS[Number(lmTo.slice(5, 7)) - 1]} ${lmTo.slice(0, 4)}`, from: lmFrom, to: lmTo, missing };
  }
  return { today: input.today, from, through, groups, complete, behind, provisional, lastMonth };
}

export type DataReminders = ReturnType<typeof dataReminders>;

/** Days without imported VHP revenue at which the banner turns red: more than a week (owner, 2026-11-22). */
export const BEHIND_ALERT_DAYS = 8;
/** Days into a month the admin has to finish last month's corrections before it must be uploaded complete. */
export const LAST_MONTH_GRACE_DAYS = 5;

/**
 * The one data banner above the dashboard (owner, 2026-11-21/22). Uploads are weekly and
 * provisional; the month uploaded complete early next month is official. Red when revenue is
 * more than a week behind, or last month is still incomplete after the 5th; otherwise amber,
 * listing what is still missing, or saying this month's figures are provisional. Sheets without
 * a link are not counted (nothing to upload).
 */
export function dataBanner(reminders: DataReminders | null) {
  if (!reminders) return null;
  const note = `${compactDays([reminders.today])} sementara, tarik ulang besok`;
  const items = reminders.groups
    .flatMap((g) => g.items)
    .map((i) => {
      const parts = [i.missing !== null && i.missing !== "belum tersambung" ? i.missing : "", reminders.provisional.includes(i.label) ? note : ""].filter(Boolean);
      return parts.length ? { label: i.label, missing: parts.join(" · ") } : null;
    })
    .filter((i): i is { label: string; missing: string } => i !== null);
  const b = reminders.behind;
  if (b && b.days >= BEHIND_ALERT_DAYS) return { tone: "red" as const, title: `Sudah ${b.days} hari data VHP belum diimport (${b.text}).`, items };
  const lm = reminders.lastMonth;
  if (lm) {
    const range = `${Number(lm.from.slice(8, 10))}–${compactDays([lm.to])}`;
    return { tone: "red" as const, title: `Data ${lm.label} belum lengkap (${lm.missing}). Upload ulang ${range} dari VHP untuk angka resmi bulan lalu.`, items };
  }
  if (items.length > 0) return { tone: "amber" as const, title: "Data belum lengkap. Yang belum diunggah:", items };
  const month = reminders.through.slice(0, 7);
  const end = addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);
  const next = addDays(end, 1);
  const name = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
  const long = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][Number(next.slice(5, 7)) - 1];
  return {
    tone: "amber" as const,
    title: `Data ${name(month)} ${month.slice(0, 4)} masih sementara. Angka resmi setelah upload bulan lengkap (1–${compactDays([end])}) di awal ${long}.`,
    items,
  };
}

type UploadKinds = { revenue: boolean; journal: boolean; purchase: boolean; foJournal: boolean };

/**
 * Uploads a new pull makes obsolete (owner, 2026-11-21: pulling through today is allowed): an
 * older upload with the same start whose last day was still open when it was printed (printed on
 * or before that day), once the new pull covers that day and was printed after it. Only uploads
 * holding nothing the new one lacks; unknown print days are kept. `printed` is a WIB day.
 */
export function supersededProvisional(
  mine: { start: string; end: string; printed: string | null; kinds: UploadKinds },
  others: { id: string; start: string; end: string; printed: string | null; kinds: UploadKinds; open?: boolean }[],
): string[] {
  if (!mine.printed) return [];
  return others
    .filter(
      (o) =>
        o.start === mine.start &&
        o.end < mine.end &&
        (o.open || (o.printed !== null && o.printed <= o.end)) &&
        mine.printed! > o.end &&
        (Object.keys(o.kinds) as (keyof UploadKinds)[]).every((k) => !o.kinds[k] || mine.kinds[k]),
    )
    .map((o) => o.id);
}
