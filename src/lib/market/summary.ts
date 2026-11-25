import { parseDayRange, presetRange, type DayRange } from './date-range';
import { LEGACY_OFFICIAL_SOCIAL_OUTLETS, OFFICIAL_SOCIAL_ACCOUNTS } from './marketing-sosmed';
import { channelFromSource } from './outlet-filters';
import { platformOf } from './promo-radar';

export type SummaryPeriod = '30d' | '90d' | 'year';

/** Segmen pertama alamat Instagram/Facebook yang bukan nama akun (tautan postingan tanpa akun). */
const NON_ACCOUNT_SEGMENTS = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'watch', 'photo', 'photo.php', 'permalink.php', 'story.php', 'share']);

/**
 * Akun pemilik postingan media sosial dari tautannya: instagram.com/<akun>/reel/..., tiktok.com/@<akun>/video/...,
 * facebook.com/<akun>/... Null bila tautan bukan media sosial atau tidak memuat nama akun (asalnya tidak terbukti).
 */
export function socialAccountOf(url: string | null | undefined): string | null {
  const platform = platformOf(url);
  if (!url || !platform || platform === 'website') return null;
  const first = new URL(url).pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  if (platform === 'tiktok') return first.startsWith('@') && first.length > 1 ? first.slice(1) : null;
  return first && !NON_ACCOUNT_SEGMENTS.has(first) ? first.replace(/^@/, '') : null;
}

/** Akun media sosial resmi Sanghyang (induk, per outlet, dan arsip cadangan resmi), dari marketing-sosmed.ts. */
export const OFFICIAL_SOCIAL_HANDLES: ReadonlySet<string> = new Set([
  ...OFFICIAL_SOCIAL_ACCOUNTS.map((a) => socialAccountOf(a.url)).filter((h): h is string => h !== null),
  ...Object.keys(LEGACY_OFFICIAL_SOCIAL_OUTLETS),
]);

export interface OwnOutletReviewRow {
  competitorId: string;
  source: string;
  sourceUrl: string | null;
  themes: string[];
}

/**
 * Ulasan Langkah 1 untuk satu outlet Sanghyang.
 * - Komentar media sosial hanya yang tersimpan di baris outlet itu sendiri (sinkron sosmed memetakan akun outlet, atau
 *   takarir akun induk, ke barisnya) dan berasal dari akun resmi Sanghyang. Komentar di akun kompetitor tidak pernah ikut,
 *   walau temanya memuat kunci outlet (permintaan pemakai 19 Nov 2026, gambar 1).
 * - Ulasan Google dan OTA milik outlet itu, ditambah ulasan outlet Sanghyang lain yang ditandai menyebut outlet ini
 *   (tema kunci outlet dari pembaca ulasan resort). Ulasan kompetitor tidak pernah ikut.
 */
export function reviewsForOwnOutlet<T extends OwnOutletReviewRow>(
  reviews: T[],
  outlet: { id: string; key: string },
  ownOutletIds: ReadonlySet<string>,
): T[] {
  return reviews.filter((r) => {
    if (channelFromSource(r.source) === 'social') {
      return r.competitorId === outlet.id && OFFICIAL_SOCIAL_HANDLES.has(socialAccountOf(r.sourceUrl) ?? '');
    }
    return r.competitorId === outlet.id || (ownOutletIds.has(r.competitorId) && r.themes.includes(outlet.key));
  });
}

export type SummaryRow = {
  date: string; // Tanggal posted date asli sumber (misal tanggal posting Instagram)
  category: string;
  source: string;
  sourceUrl?: string;
  headline: string;
  relevance?: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  reviewDate?: string;
  activeFrom?: string; // Tanggal mulai periode aktif (promo/acara/menu)
  activeTo?: string;   // Tanggal berakhir periode aktif (promo/acara/menu)
  socialUrls?: {
    instagram?: string;
    tiktok?: string;
    facebook?: string;
    website?: string;
    maps?: string;
  };
};

export type SummaryInput = {
  rows: SummaryRow[];
  competitors: number;
  marketItems: number;
  period: SummaryPeriod;
  now?: Date;
  from?: string | Date;
  to?: string | Date;
  customRange?: DayRange | { from: Date; to: Date } | null;
};

export function transformMarketSummary(input: SummaryInput) {
  const now = input.now ?? new Date();

  let start: Date;
  let endOfPeriod: Date;

  if (input.customRange) {
    start = input.customRange.from;
    endOfPeriod = input.customRange.to;
  } else if (input.from && input.to) {
    const fromStr = typeof input.from === 'string' ? input.from : input.from.toISOString().slice(0, 10);
    const toStr = typeof input.to === 'string' ? input.to : input.to.toISOString().slice(0, 10);
    const parsed = parseDayRange(fromStr, toStr);
    if (parsed && parsed !== 'invalid') {
      start = parsed.from;
      endOfPeriod = parsed.to;
    } else {
      const wibToday = presetRange(input.period, now);
      start = input.period === 'year'
        ? wibToday.from
        : new Date(now.getTime() - (input.period === '90d' ? 90 : 30) * 86400000);
      endOfPeriod = wibToday.to;
    }
  } else {
    // Hari dihitung dalam WIB: server Vercel berjalan di UTC dan mesin kerja di WIB, jadi batas hari waktu lokal server
    // membuat produksi dan localhost menyaring baris yang berbeda antara pukul 00.00 dan 07.00 WIB.
    const wibToday = presetRange(input.period, now);
    start = input.period === 'year'
      ? wibToday.from
      : new Date(now.getTime() - (input.period === '90d' ? 90 : 30) * 86400000);
    endOfPeriod = wibToday.to;
  }

  // Batas masa depan untuk promosi dan jadwal acara yang sedang/akan aktif
  const futureDays = input.period === 'year' ? 365 : input.period === '90d' ? 90 : 30;
  const futureLimit = new Date(endOfPeriod.getTime() + futureDays * 86400000);

  const rows = input.rows
    .filter((row) => {
      const postedTime = Date.parse(row.date);
      if (Number.isNaN(postedTime)) return false;

      const postedDate = new Date(postedTime);

      // 1. Apakah diposting dalam rentang periode (misal 30 hari terakhir atau rentang kustom)?
      const isPostedInPeriod = postedDate >= start && postedDate <= endOfPeriod;

      // 2. Apakah konten/promosi/acara SEDANG AKTIF dalam rentang periode yang dipilih?
      // (Bahkan jika kompetitor memposting 45 hari sebelumnya, asalkan masa berlaku promosi/acara aktif dalam periode ini, data tetap diterima)
      let isActiveInPeriod = false;

      if (row.activeFrom || row.activeTo) {
        const fromTime = row.activeFrom ? Date.parse(row.activeFrom) : postedTime;
        const toTime = row.activeTo ? Date.parse(row.activeTo) : null;

        const fromDate = !Number.isNaN(fromTime) ? new Date(fromTime) : postedDate;
        const toDate = toTime && !Number.isNaN(toTime) ? new Date(toTime) : null;

        const maxStart = input.customRange || (input.from && input.to) ? endOfPeriod : futureLimit;

        if (toDate) {
          // Promo / acara masih aktif jika berakhir pada atau setelah awal periode
          // dan sudah dimulai sebelum batas periode aktif mendatang (atau akhir rentang jika kustom)
          isActiveInPeriod = toDate >= start && fromDate <= maxStart;
        } else {
          // Tanpa batas akhir eksplisit: aktif jika dimulai dalam jendela periode aktif
          isActiveInPeriod = fromDate >= start && fromDate <= maxStart;
        }
      }

      // Entitas profil kompetitor selalu aktif untuk pembanding pasar
      if (row.category === 'Competitors') {
        return true;
      }

      return isPostedInPeriod || isActiveInPeriod;
    })
    // Tanggal seri (satu tangkapan menyimpan banyak baris dengan waktu sama) diurutkan menurut isi, bukan urutan fisik
    // baris di basis data, supaya DB lokal dan produksi yang isinya sama menampilkan urutan yang sama.
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.category.localeCompare(b.category) || a.headline.localeCompare(b.headline) || (a.sourceUrl ?? '').localeCompare(b.sourceUrl ?? ''));

  const bucketCount = input.period === 'year' ? 12 : input.period === '90d' ? 9 : 7;
  const span = Math.max(1, endOfPeriod.getTime() - start.getTime());
  const trend: Record<string, number[]> = {
    fnb: Array(bucketCount).fill(0),
    event: Array(bucketCount).fill(0),
    entertainment: Array(bucketCount).fill(0),
    competitors: Array(bucketCount).fill(0),
    promotions: Array(bucketCount).fill(0),
    reviews: Array(bucketCount).fill(0),
    destinations: Array(bucketCount).fill(0),
  };
  const key = (category: string) => ({
    'F&B': 'fnb',
    Events: 'event',
    Entertainment: 'entertainment',
    Competitors: 'competitors',
    Promotions: 'promotions',
    Reviews: 'reviews',
    Destinations: 'destinations',
  } as Record<string, string>)[category];

  for (const row of rows) {
    const rowTime = Date.parse(row.date);
    const clampedTime = Math.min(endOfPeriod.getTime(), Math.max(start.getTime(), rowTime));
    const bucket = Math.min(bucketCount - 1, Math.max(0, Math.floor(((endOfPeriod.getTime() - clampedTime) / span) * bucketCount)));
    const series = key(row.category);
    if (series) trend[series][bucket]++;
  }

  const marketItems = rows.filter((r) => ['F&B', 'Events', 'Entertainment', 'Destinations'].includes(r.category)).length;

  return {
    counts: {
      marketItems,
      competitors: rows.filter((r) => r.category === 'Competitors').length,
      fnb: rows.filter((r) => r.category === 'F&B').length,
      events: rows.filter((r) => r.category === 'Events').length,
      entertainment: rows.filter((r) => r.category === 'Entertainment').length,
      destinations: rows.filter((r) => r.category === 'Destinations').length,
      priceChanges: rows.filter((r) => r.category === 'Competitors').length,
      promotions: rows.filter((r) => r.category === 'Promotions').length,
      reviews: rows.filter((r) => r.category === 'Reviews').length,
    },
    sourceNames: [...new Set(rows.map((r) => r.source))].sort(),
    recentRows: rows.slice(0, 100),
    trend,
  };
}
