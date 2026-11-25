const lastDay = (iso: string) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Warnings for a VHP export period that looks mistyped. Several-day exports are pulled from the
 * 1st of a month (a whole month, or the current month up to yesterday), so a start after the
 * 1st, an end before the month's last day in a closed month, or a period through today is
 * probably a typo (user 2026-11-18: February exported from 02/02 instead of 01/02).
 */
export function periodWarnings(start: string, end: string, today: string): string[] {
  const out: string[] = [];
  if (end >= today) out.push(`Sampai ${dm(end)}: hari ini belum tutup. Tarik sampai tanggal kemarin.`);
  if (start === end) return out;
  if (!start.endsWith("-01")) out.push(`Mulai ${dm(start)}: tanggal 1 tidak ikut.`);
  if (end.slice(0, 7) < today.slice(0, 7) && end !== lastDay(end)) out.push(`Berakhir ${dm(end)}: akhir bulan (${dm(lastDay(end))}) tidak ikut.`);
  return out;
}

/**
 * A Turnover whose last day still has room revenue (100 Lodging) 0 was pulled before VHP closed
 * that day (night audit), even if pulled the day after (owner, 2026-11-22). Null when fine or unknown.
 */
export function closingWarning(lastDayLodging: number | null | undefined, end: string): string | null {
  if (lastDayLodging !== 0) return null;
  return `Room revenue (Lodging) tanggal ${dm(end)} masih 0: kemungkinan tutup hari (night audit) belum dijalankan. Data tanggal itu dianggap sementara; tarik ulang setelah tutup hari.`;
}
