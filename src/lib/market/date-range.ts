/**
 * Rentang tanggal Insight Pasar dalam hari WIB. Promo, berita, tarif, dan ulasan (menurut tanggal ulasannya) disaring
 * dengan rentang ini.
 */
import { classifyPromoOrEvent, PROMO_MAX_AGE_DAYS, type ClassifiedPromoKind, type PromoOrEventInput } from "./promo-radar";

export interface DayRange {
  /** Awal hari WIB pertama. */
  from: Date;
  /** Akhir hari WIB terakhir (23.59.59,999 WIB). */
  to: Date;
}

export type RangePreset = "30d" | "90d" | "year";

const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Rentang kustom paling panjang: satu tahun ditambah satu bulan, cukup untuk "tahun ini" tanpa kueri yang membengkak. */
export const MAX_RANGE_DAYS = 400;

/** "2026-10-01" menjadi awal hari itu dalam WIB; null bila formatnya salah atau tanggalnya tidak ada (30 Februari). */
export function wibDayStart(day: string): Date | null {
  if (!ISO_DAY.test(day)) return null;
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(midnightUtc) || new Date(midnightUtc).toISOString().slice(0, 10) !== day) return null;
  return new Date(midnightUtc - WIB_OFFSET_MS);
}

/** Tanggal WIB ("YYYY-MM-DD") dari sebuah waktu. */
export const wibDay = (d: Date) => new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);

/** Rentang kustom dari parameter from/to; null bila keduanya tidak ada, "invalid" bila tidak lengkap, terbalik, atau terlalu panjang. */
export function parseDayRange(from: string | null, to: string | null): DayRange | "invalid" | null {
  if (from === null && to === null) return null;
  const start = from === null ? null : wibDayStart(from);
  const lastDay = to === null ? null : wibDayStart(to);
  if (!start || !lastDay || lastDay < start) return "invalid";
  const end = new Date(lastDay.getTime() + DAY_MS - 1);
  if ((end.getTime() + 1 - start.getTime()) / DAY_MS > MAX_RANGE_DAYS) return "invalid";
  return { from: start, to: end };
}

/** Rentang preset yang berakhir di akhir hari ini WIB; "year" dimulai 1 Januari tahun WIB berjalan. */
export function presetRange(preset: RangePreset, now: Date): DayRange {
  const today = wibDay(now);
  const todayStart = wibDayStart(today) as Date;
  const to = new Date(todayStart.getTime() + DAY_MS - 1);
  if (preset === "year") return { from: wibDayStart(`${today.slice(0, 4)}-01-01`) as Date, to };
  const days = preset === "90d" ? 90 : 30;
  return { from: new Date(todayStart.getTime() - (days - 1) * DAY_MS), to };
}

const MAX_AGE_MS = PROMO_MAX_AGE_DAYS * DAY_MS;

/**
 * Akhir efektif promo atau event: endsAt bila tertulis; tanpa endsAt, event berakhir di akhir hari mulainya (WIB) dan
 * promo berlaku paling lama PROMO_MAX_AGE_DAYS sejak mulai, tidak melewati sekarang. Akhir efektif tidak pernah lebih
 * awal dari akhir hari mulai: promo yang baru mulai sesudah sekarang tetap berjalan pada hari mulainya, jadi tampil di
 * rentang kustom masa depan yang memuat hari itu. Dipakai promoInRange; status kartu (Aktif/Sudah berakhir) di web dan
 * PDF masih membaca status DB dan endsAt, jadi bila status ikut aturan ini, ubah keduanya bersamaan supaya web = PDF.
 */
export function promoEffectiveEnd(
  p: { startsAt: Date; endsAt: Date | null } & PromoOrEventInput,
  now: Date,
  kind: ClassifiedPromoKind | null = classifyPromoOrEvent(p),
): Date {
  if (p.endsAt) return p.endsAt;
  const startDayEnd = (wibDayStart(wibDay(p.startsAt)) as Date).getTime() + DAY_MS - 1;
  if (kind === "event") return new Date(startDayEnd);
  return new Date(Math.max(startDayEnd, Math.min(p.startsAt.getTime() + MAX_AGE_MS, now.getTime())));
}

/**
 * Promo atau event tampil di rentang bila ia berjalan di dalamnya, atau bila ia segera datang (keputusan koordinator
 * 22 Nov 2026, papan #40):
 * - berakhir pada endsAt; tanpa endsAt, event berakhir di hari mulainya (aturan event tanpa tanggal selesai) dan promo
 *   berlaku paling lama PROMO_MAX_AGE_DAYS sejak mulai, tidak melewati sekarang, tetapi setidaknya pada hari mulainya
 *   (promoEffectiveEnd);
 * - berjalan = mulai paling lambat akhir rentang dan berakhir paling cepat awal rentang;
 * - segera datang = mulai sesudah rentang, paling lama PROMO_MAX_AGE_DAYS sesudahnya, dan sudah tertangkap sebelum akhir
 *   rentang.
 * Tanggal tangkap bukan tanggal pengumuman: event yang selesai sebelum rentang tidak tampil walau di-crawl di dalamnya.
 * Jenisnya dibaca dengan klasifikasi Langkah 4 (kolom kind di DB masih kosong untuk banyak unggahan), kecuali pemanggil
 * sudah menentukannya.
 */
export function promoInRange(
  p: { startsAt: Date; endsAt: Date | null; capturedAt: Date } & PromoOrEventInput,
  range: DayRange,
  now: Date,
  kind: ClassifiedPromoKind | null = classifyPromoOrEvent(p),
): boolean {
  const running = p.startsAt <= range.to && promoEffectiveEnd(p, now, kind) >= range.from;
  const upcoming = p.startsAt > range.to && p.capturedAt <= range.to && p.startsAt.getTime() <= range.to.getTime() + MAX_AGE_MS;
  return running || upcoming;
}

/**
 * Saringan basis data yang mendahului promoInRange: memuat setiap baris yang mungkin lolos (tanpa endsAt, baris yang
 * mulai lebih dari PROMO_MAX_AGE_DAYS sebelum rentang tidak mungkin berjalan, karena akhir efektifnya paling lambat
 * mulai + PROMO_MAX_AGE_DAYS), lalu promoInRange menyaring tepat.
 */
export function promoRangeWhere(range: DayRange) {
  return {
    OR: [
      {
        startsAt: { lte: range.to },
        OR: [{ endsAt: { gte: range.from } }, { endsAt: null, startsAt: { gte: new Date(range.from.getTime() - MAX_AGE_MS) } }],
      },
      { startsAt: { gt: range.to, lte: new Date(range.to.getTime() + MAX_AGE_MS) }, capturedAt: { lte: range.to } },
    ],
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const shortDay = (d: Date) => {
  const [y, m, day] = wibDay(d).split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};

/** "1 Okt 2026 – 10 Okt 2026". */
export const rangeLabel = (range: DayRange) => `${shortDay(range.from)} – ${shortDay(range.to)}`;
