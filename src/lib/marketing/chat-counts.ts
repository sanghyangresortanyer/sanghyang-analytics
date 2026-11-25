/**
 * WhatsApp chats that became a booking (closing), counted by CS for a date range they pick (owner, 24 Nov
 * 2026: "buat simple saja chat yang closing"). All chats are not asked: Google Ads already counts them.
 */
export type ChatCount = { from: string; to: string; closing: number; total: number | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const whole = (v: string) => (/^\d{1,5}$/.test(v) ? Number(v) : null);

export function parseChatCount(form: FormData, today: string): { ok: ChatCount } | { error: string } {
  const from = String(form.get("chat_from") ?? "").trim();
  const to = String(form.get("chat_to") ?? "").trim();
  if (!DATE.test(from) || !DATE.test(to)) return { error: "Isi tanggal Dari dan Sampai." };
  if (from > to) return { error: "Tanggal 'Dari' harus sebelum atau sama dengan 'Sampai'." };
  if (to >= today) return { error: "Hari ini belum selesai: isi paling lambat sampai kemarin." };
  const closing = whole(String(form.get("closing") ?? "").trim());
  if (closing === null) return { error: "Jumlah chat closing harus angka 0 atau lebih." };
  return { ok: { from, to, closing, total: null } };
}
