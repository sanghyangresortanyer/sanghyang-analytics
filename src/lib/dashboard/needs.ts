/** "Perlu Anda" on the dashboard (look A, owner 24 Nov 2026): what someone has to do next, most urgent first. Pure. */
import { dataBanner, type DataReminders } from "./data-status";
import { dayName } from "./day-series";

export interface Need {
  title: string;
  detail: string;
  href: string;
  action: string;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The ad balance is listed when it lasts this many days or less. */
export const LOW_BALANCE_DAYS = 8;
/** CS's booking file is asked for again when the last import is this many days old. */
const WA_IMPORT_DAYS = 7;

export function needs(input: {
  today: string;
  reminders: DataReminders | null;
  /** null = not read (no access to Marketing, or Google did not answer) */
  balance: { remaining: number; daysLeft: number | null } | null;
  /** Last import of CS's file BOOKING BY WA: null = never, undefined = not read (no Marketing access). */
  waImport: string | null | undefined;
}): { items: Need[]; note: string | null } {
  const items: Need[] = [];
  const b = input.balance;
  if (b && b.daysLeft !== null && b.daysLeft <= LOW_BALANCE_DAYS) {
    const out = addDays(input.today, b.daysLeft);
    items.push({
      title: `Saldo iklan habis sekitar ${dayName(out)}`,
      detail: `Sisa Rp${Math.round(b.remaining).toLocaleString("id-ID")}. ${b.daysLeft > 1 ? `Isi paling lambat ${dayName(addDays(out, -1))}.` : "Isi sekarang."}`,
      href: "/marketing?bagian=google",
      action: "Lihat saldo",
    });
  }
  const banner = dataBanner(input.reminders);
  const missing = banner?.items.map((i) => `${i.label} (${i.missing})`).join(", ");
  if (banner && (banner.tone === "red" || banner.items.length > 0)) {
    const need = { title: banner.tone === "red" ? banner.title : "Unggah data yang belum ada", detail: missing || "Unggah dari VHP.", href: "/upload-mingguan", action: "Unggah" };
    if (banner.tone === "red") items.unshift(need);
    else items.push(need);
  }
  const imported = input.waImport;
  if (imported === null || (imported !== undefined && addDays(new Date(Date.parse(imported) + 7 * 3_600_000).toISOString().slice(0, 10), WA_IMPORT_DAYS) <= input.today)) {
    items.push({
      title: "Import file BOOKING BY WA",
      detail: imported ? `Terakhir diimport ${shortDay(imported)}.` : "Belum pernah diimport.",
      href: "/marketing?bagian=google",
      action: "Import",
    });
  }
  return { items, note: banner && banner.tone === "amber" && banner.items.length === 0 ? banner.title : null };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const shortDay = (iso: string) => {
  const d = new Date(Date.parse(iso) + 7 * 3_600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
