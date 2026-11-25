/** DD/MM/YYYY, regardless of browser/system locale. */
export function formatDateID(value: string | Date): string {
  if (typeof value === "string") {
    const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  }
  const d = typeof value === "string" ? new Date(value) : value;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Bisnisnya jalan di WIB, jadi "hari ini" harus tanggal Jakarta — bukan UTC.
// Sebelum 07:00 WIB keduanya beda hari, dan tanggal default seluruh aplikasi
// ikut mundur sehari. formatToParts dipakai (bukan format()) supaya urutan
// tahun-bulan-hari tidak bergantung pada data locale.
const JAKARTA_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Tanggal hari ini (YYYY-MM-DD) menurut zona Asia/Jakarta. */
export function todayISO(now: Date = new Date()): string {
  const part = Object.fromEntries(JAKARTA_YMD.formatToParts(now).map((p) => [p.type, p.value]));
  return `${part.year}-${part.month}-${part.day}`;
}

const JAKARTA_DATETIME = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "17 Nov 2026, 11.40 WIB" for a stored timestamp. */
export function formatDateTimeWIB(iso: string): string {
  return `${JAKARTA_DATETIME.format(new Date(iso))} WIB`;
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Short period label for chart axes: "1–14 Nov", or "28 Okt – 3 Nov" across months. */
export function formatPeriodShort(start: string, end: string): string {
  const [, m1, d1] = start.split("-").map(Number);
  const [, m2, d2] = end.split("-").map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MONTHS_ID[m2 - 1]}` : `${d1} ${MONTHS_ID[m1 - 1]} – ${d2} ${MONTHS_ID[m2 - 1]}`;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/**
 * "1–21 Nov 2026", "30 Nov – 1 Des 2026", "22 Nov 2026". Plain module so server and client code can
 * both call it (23 Nov: calling it from a "use client" file on the server broke /marketing).
 */
export function rangeText(from: string, to: string): string {
  const [fy, fm, fd] = [from.slice(0, 4), from.slice(5, 7), Number(from.slice(8, 10))];
  const [ty, tm, td] = [to.slice(0, 4), to.slice(5, 7), Number(to.slice(8, 10))];
  const month = (m: string) => SHORT_MONTHS[Number(m) - 1];
  if (from === to) return `${td} ${month(tm)} ${ty}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${month(tm)} ${ty}`;
  if (fy === ty) return `${fd} ${month(fm)} – ${td} ${month(tm)} ${ty}`;
  return `${fd} ${month(fm)} ${fy} – ${td} ${month(tm)} ${ty}`;
}
