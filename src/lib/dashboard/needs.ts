/** "Perlu Anda" on the dashboard (look A, owner 24 Nov 2026): what someone has to do next, most urgent first. Pure. */
import { compactDays, dataBanner, type DataReminders } from "./data-status";
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

export function needs(input: {
  today: string;
  reminders: DataReminders | null;
  /** null = not read (no access to Marketing, or Google did not answer) */
  balance: { remaining: number; daysLeft: number | null } | null;
  /** Last finished week without CS's chat count, or null. */
  chatWeek: { since: string; until: string } | null;
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
  if (input.chatWeek) {
    items.push({
      title: `Isi chat WA pekan ${compactDays(weekDays(input.chatWeek))}`,
      detail: "CS belum mengisi jumlah chat closing (jadi booking).",
      href: "/marketing?bagian=google",
      action: "Isi",
    });
  }
  return { items, note: banner && banner.tone === "amber" && banner.items.length === 0 ? banner.title : null };
}

function weekDays(p: { since: string; until: string }): string[] {
  const out: string[] = [];
  for (let d = p.since; d <= p.until; d = addDays(d, 1)) out.push(d);
  return out;
}
