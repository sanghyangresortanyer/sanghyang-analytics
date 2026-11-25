import { db } from '../db';
import { Prisma, PromotionStatus } from '@prisma/client';
import type { PromoPlatform } from './promo-radar';

export interface CompetitorSocialPromoItem {
  competitorName: string;
  competitorHandle: string;
  /** Outlet Sanghyang yang dibandingkan dengan pesaing ini menurut registri; kosong untuk data lama tanpa registri. */
  competitorOutlets?: string[];
  competitorIsLodging?: boolean;
  competitorRoadKm?: number | null;
  /** Restoran, bar, dan spa di dalam hotel pesaing beserta outlet Sanghyang yang dibandingkan dengannya. */
  competitorVenues?: { name: string; outlets: string[] }[];
  platform: PromoPlatform;
  /** Semua sumber penawaran yang sama (postingan dan situs resmi); kosong untuk data lama. */
  sources?: { platform: PromoPlatform; url: string; label: string }[];
  title: string;
  category: 'Kamar & Menginap' | 'F&B & Kuliner' | 'Acara & Live Music' | 'Keluarga & Anak' | 'Wellness & Relaksasi' | 'Digital & Booking' | string;
  description: string;
  startsAt: Date;
  endsAt?: Date;
  price?: number;
  originalPrice?: number;
  discount?: number;
  source: string;
  sourceUrl: string;
  imageUrl?: string;
  counterStrategy?: string;
}

/**
 * Menghitung status promosi berdasarkan tanggal berlaku.
 * Zero Mock / D3: Status expired ditentukan secara deterministik bila endsAt < now.
 */
export function computePromotionStatus(
  startsAt: Date,
  endsAt?: Date | null,
  now = new Date()
): PromotionStatus {
  if (endsAt && endsAt < now) {
    return 'expired';
  }
  return 'new';
}

/**
 * Memperbarui status seluruh promo di database yang sudah melewati batas waktu endsAt menjadi expired.
 */
export async function expireOutdatedPromotions(now = new Date()): Promise<number> {
  const result = await db.competitorPromotion.updateMany({
    where: {
      endsAt: {
        lt: now,
      },
      status: {
        not: 'expired',
      },
    },
    data: {
      status: 'expired',
      version: { increment: 1 },
    },
  });

  return result.count;
}

/**
 * Sinkronisasi promo & event kompetitor.
 * Hanya memproses input data riil yang diberikan (dari crawler patuh atau masukan manual staf),
 * dan memperbarui status promo kedaluwarsa secara otomatis di database.
 */
export async function syncCompetitorSocialPromoEvents(
  realPromos: CompetitorSocialPromoItem[] = []
): Promise<{
  totalSynced: number;
  activeCount: number;
  upcomingCount: number;
  expiredCount: number;
}> {
  console.log('[sync-social-promos] Memulai sinkronisasi promo & event kompetitor...');

  const now = new Date();
  const autoExpired = await expireOutdatedPromotions(now);

  if (realPromos.length === 0) {
    console.log(`[sync-social-promos] Tidak ada item promo baru untuk diimpor. ${autoExpired} promo lama kedaluwarsa.`);
    return {
      totalSynced: 0,
      activeCount: 0,
      upcomingCount: 0,
      expiredCount: autoExpired,
    };
  }

  const [competitors, existingPromotions] = await Promise.all([
    db.competitor.findMany({
      select: { id: true, name: true, instagramUrl: true, tiktokUrl: true },
    }),
    db.competitorPromotion.findMany({
      where: {
        sourceUrl: {
          in: realPromos.map((p) => p.sourceUrl).filter(Boolean),
        },
      },
      select: { id: true, sourceUrl: true, competitorId: true, imageUrl: true },
    }),
  ]);

  const competitorMap = new Map<string, string>();
  for (const c of competitors) {
    competitorMap.set(c.name.toLowerCase().trim(), c.id);
  }

  const existingMap = new Map<string, typeof existingPromotions[number]>();
  for (const ep of existingPromotions) {
    if (ep.sourceUrl) {
      existingMap.set(ep.sourceUrl, ep);
    }
  }

  const findCompetitorId = (targetName: string): string | null => {
    const direct = competitorMap.get(targetName.toLowerCase().trim());
    if (direct) return direct;

    for (const [name, id] of competitorMap.entries()) {
      if (targetName.toLowerCase().includes(name) || name.includes(targetName.toLowerCase())) {
        return id;
      }
    }
    return null;
  };

  let activeCount = 0;
  let upcomingCount = 0;
  let expiredCount = autoExpired;
  let totalSynced = 0;

  const mutationPromises: Promise<unknown>[] = [];

  for (const promo of realPromos) {
    const competitorId = findCompetitorId(promo.competitorName);
    if (!competitorId) {
      console.warn(`[sync-social-promos] Kompetitor tidak ditemukan untuk: ${promo.competitorName}`);
      continue;
    }

    const status = computePromotionStatus(promo.startsAt, promo.endsAt, now);
    if (status === 'expired') {
      expiredCount++;
    } else if (promo.startsAt > now) {
      upcomingCount++;
    } else {
      activeCount++;
    }

    const existing = promo.sourceUrl ? existingMap.get(promo.sourceUrl) : undefined;

    if (existing) {
      mutationPromises.push(
        db.competitorPromotion.update({
          where: { id: existing.id },
          data: {
            title: promo.title,
            category: promo.category,
            description: promo.description,
            startsAt: promo.startsAt,
            endsAt: promo.endsAt ?? null,
            price: promo.price != null ? new Prisma.Decimal(promo.price) : null,
            originalPrice: promo.originalPrice != null ? new Prisma.Decimal(promo.originalPrice) : null,
            discount: promo.discount != null ? new Prisma.Decimal(promo.discount) : null,
            source: promo.source,
            sourceUrl: promo.sourceUrl,
            imageUrl: promo.imageUrl ?? existing.imageUrl,
            status,
            version: { increment: 1 },
          },
        })
      );
    } else {
      mutationPromises.push(
        db.competitorPromotion.create({
          data: {
            competitorId,
            title: promo.title,
            category: promo.category,
            description: promo.description,
            startsAt: promo.startsAt,
            endsAt: promo.endsAt ?? null,
            price: promo.price != null ? new Prisma.Decimal(promo.price) : null,
            originalPrice: promo.originalPrice != null ? new Prisma.Decimal(promo.originalPrice) : null,
            discount: promo.discount != null ? new Prisma.Decimal(promo.discount) : null,
            source: promo.source,
            sourceUrl: promo.sourceUrl,
            imageUrl: promo.imageUrl ?? null,
            capturedAt: promo.startsAt,
            status,
            version: 1,
          },
        })
      );
    }

    totalSynced++;
  }

  await Promise.all(mutationPromises);

  console.log(`[sync-social-promos] Berhasil menyinkronkan ${totalSynced} promo/event (Aktif: ${activeCount}, Upcoming: ${upcomingCount}, Expired: ${expiredCount})`);

  return { totalSynced, activeCount, upcomingCount, expiredCount };
}
