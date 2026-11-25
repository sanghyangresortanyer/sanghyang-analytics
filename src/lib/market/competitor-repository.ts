import { db } from "../db";
import type { Competitor } from "@prisma/client";
import { COMPSET_MAX_ROAD_KM, parseCompsetRole, type CompsetRole } from "./compset";
import { googleTravelEntityUrlFromMaps } from "./google-travel-entity";
import { COMPARABLE_RATE_WHERE } from "./rate-basis";

export type { Competitor };

export type CompetitorInput = {
  name: string;
  category?: string | null;
  group?: string | null;
  outlets?: string[];
  placeId?: string | null;
  websiteUrl?: string | null;
  googleMapsUrl?: string | null;
  mapsUrl?: string | null;
  roadKm?: number | null;
  driveMinutes?: number | null;
  straightKm?: number | null;
  distanceSource?: string | null;
  address?: string | null;
  starRating?: number | null;
  roomCount?: number | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  location?: string | null;
  bookingUrl?: string | null;
  ratesUrl?: string | null;
  socialUrl?: string | null;
  active?: boolean;
  retiredReason?: string | null;
  verifiedAt?: Date | null;
  notes?: string | null;
};

export type PriceSnapshotInput = {
  competitorId: string;
  roomName?: string | null;
  packageName?: string | null;
  price: number;
  originalPrice?: number | null;
  currency?: string;
  guests?: number;
  discount?: number | null;
  checkIn?: Date | null;
  checkOut?: Date | null;
  source: string;
  sourceUrl?: string | null;
  observedAt?: Date;
};

export type PromotionInput = {
  competitorId: string;
  title: string;
  category: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  price?: number | null;
  originalPrice?: number | null;
  discount?: number | null;
  source: string;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  capturedAt: Date;
};

export type ReviewInput = {
  competitorId: string;
  externalId: string;
  source: string;
  sourceUrl: string;
  rating: number;
  reviewDate: Date;
  title?: string | null;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
  themes: string[];
  capturedAt: Date;
};

export interface HotelRateTarget {
  competitorId?: string;
  name: string;
  url: string;
}

export interface ReviewTarget {
  competitorId?: string;
  competitorName: string;
  query: string;
  /** Halaman entity Google Travel yang sudah tersimpan (dari ratesUrl); bila ada, tidak perlu mencari ulang. */
  travelEntityUrl?: string | null;
  /** Kategori registri: penginapan dibaca dari Google Travel, selain itu dari Google Maps. */
  category?: string | null;
  mapsUrl?: string | null;
}

export interface HotelCompsetItem {
  id: string;
  name: string;
  placeId: string | null;
  category: string | null;
  group: string | null;
  roadKm: number;
  driveMinutes: number | null;
  straightKm: number | null;
  distanceSource: string | null;
  address: string | null;
  starRating: number | null;
  roomCount: number | null;
  mapsUrl: string | null;
  ratesUrl: string | null;
  active: boolean;
  /** Jarak tempuh dalam 25 km (keterangan jarak saja; ikut dihitung atau tidak ditentukan `compsetRole`). */
  inRadius: boolean;
  compsetRole: CompsetRole | null;
  isSanghyang: boolean;
  outlets: string[];
}

export interface CompsetRateCoverage {
  hotelId: string;
  competitorId: string | null;
  name: string;
  group: string;
  roadKm: number;
  inRadius: boolean;
  ratesUrl: string | null;
  hasRatesTarget: boolean;
  lastObservedAt: Date | null;
  lastPrice: number | null;
  lastSource: string | null;
  isObserved: boolean;
  unobservedReason: string | null;
}

export const COMPSET_RADIUS_KM = COMPSET_MAX_ROAD_KM;
export const SANGHYANG_HOTEL_NAME = "Sanghyang Indah Spa Resort";
export const SANGHYANG_PLACE_ID = "sanghyang";

export type CompetitorRepositoryClient = {
  competitor: {
    create(args: { data: unknown }): Promise<unknown>;
    findMany(args: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
    findUnique(args: { where: Record<string, unknown> }): Promise<unknown | null>;
    update(args: { where: Record<string, unknown>; data: unknown }): Promise<unknown>;
  };
  competitorPriceSnapshot: {
    create(args: { data: unknown }): Promise<unknown>;
    findMany(args: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
  };
  competitorPromotion: {
    create(args: { data: unknown }): Promise<unknown>;
    findMany(args: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
  };
  competitorReview?: {
    create(args: { data: unknown }): Promise<unknown>;
    findMany(args: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
  };
};

export function createCompetitorRepository(client: CompetitorRepositoryClient) {
  return {
    createCompetitor(data: CompetitorInput) {
      return client.competitor.create({ data });
    },
    findCompetitor(id: string) {
      return client.competitor.findUnique({ where: { id } });
    },
    updateCompetitor(id: string, data: Partial<CompetitorInput>) {
      return client.competitor.update({ where: { id }, data });
    },
    deleteCompetitor(id: string) {
      return client.competitor.update({ where: { id }, data: { active: false } });
    },
    listCompetitors(active?: boolean) {
      return client.competitor.findMany({
        where: active === undefined ? undefined : { active },
        orderBy: [{ roadKm: "asc" }, { name: "asc" }],
      });
    },
    createPriceSnapshot(data: PriceSnapshotInput) {
      return client.competitorPriceSnapshot.create({ data });
    },
    listPriceSnapshots(competitorId: string) {
      return client.competitorPriceSnapshot.findMany({
        where: { competitorId, ...COMPARABLE_RATE_WHERE },
        orderBy: { observedAt: "desc" },
      });
    },
    async createPromotion(data: PromotionInput) {
      const prior = await client.competitorPromotion.findMany({
        where: { competitorId: data.competitorId, source: data.source, title: data.title },
        orderBy: { capturedAt: "desc" },
      });
      const previous = prior[0] as Record<string, unknown> | undefined;
      const expired = data.endsAt != null && data.endsAt.getTime() < Date.now();
      const material = ["category", "description", "startsAt", "endsAt", "price", "originalPrice", "discount", "sourceUrl", "imageUrl"];
      const comparable = (value: unknown) => {
        if (value instanceof Date) return value.getTime();
        if (value && typeof value === "object" && "toString" in value) {
          const numeric = Number(String(value));
          return Number.isNaN(numeric) ? String(value) : numeric;
        }
        return value;
      };
      const changed = Boolean(
        previous &&
          material.some((key) => {
            const oldValue = comparable(previous[key]);
            const newValue = comparable((data as unknown as Record<string, unknown>)[key]);
            return oldValue !== newValue;
          })
      );
      return client.competitorPromotion.create({
        data: { ...data, status: expired ? "expired" : changed ? "changed" : "new" },
      });
    },
    listPromotions(competitorId: string) {
      return client.competitorPromotion.findMany({
        where: { competitorId },
        orderBy: { capturedAt: "desc" },
      });
    },
    createReview(data: ReviewInput) {
      return client.competitorReview!.create({ data });
    },
    listReviews(competitorId: string) {
      return client.competitorReview!.findMany({
        where: { competitorId, archivedAt: null },
        orderBy: { reviewDate: "desc" },
      });
    },
  };
}

export const competitorRepository = createCompetitorRepository(db as unknown as CompetitorRepositoryClient);

/**
 * Mengambil seluruh kompetitor aktif dari registri tunggal di database.
 */
export async function getActiveCompetitors(filter?: {
  category?: string;
  group?: string;
  outlet?: string;
  maxRoadKm?: number;
}): Promise<Competitor[]> {
  const where: Record<string, unknown> = {
    active: true,
  };

  if (filter?.category) {
    where.category = filter.category;
  }
  if (filter?.group) {
    where.group = filter.group;
  }
  if (filter?.outlet) {
    where.outlets = {
      has: filter.outlet,
    };
  }
  if (typeof filter?.maxRoadKm === "number") {
    where.roadKm = {
      lte: filter.maxRoadKm,
    };
  }

  return db.competitor.findMany({
    where,
    orderBy: [{ roadKm: "asc" }, { name: "asc" }],
  });
}

/**
 * Mengambil daftar hotel compset (resort & hotel dalam radius pembanding)
 * dari database terpadu.
 */
export async function getHotelCompset(options?: {
  /** Hanya Sanghyang dan pembanding inti (tanpa acuan). */
  inRadiusOnly?: boolean;
}): Promise<HotelCompsetItem[]> {
  const where: Record<string, unknown> = {
    active: true,
    OR: [
      { category: { in: ["resort", "hotel"] } },
      { group: { in: ["resort", "hotel"] } },
      { outlets: { has: "resort" } },
    ],
  };

  const rows = (
    await db.competitor.findMany({
      where,
      orderBy: [{ roadKm: "asc" }, { name: "asc" }],
    })
  ).filter((r) => {
    const own = r.placeId === SANGHYANG_PLACE_ID;
    const role = parseCompsetRole(r.compsetRole);
    return own || (options?.inRadiusOnly ? role === "inti" : role !== null);
  });

  return rows.map((r) => {
    const roadKm = r.roadKm ?? 999;
    const isSanghyang = r.placeId === SANGHYANG_PLACE_ID || r.name.toLowerCase().includes("sanghyang");
    return {
      id: r.id,
      name: r.name,
      placeId: r.placeId,
      category: r.category,
      group: r.group ?? r.category ?? "hotel",
      roadKm,
      driveMinutes: r.driveMinutes,
      straightKm: r.straightKm,
      distanceSource: r.distanceSource,
      address: r.address,
      starRating: r.starRating,
      roomCount: r.roomCount,
      mapsUrl: r.mapsUrl ?? r.googleMapsUrl,
      ratesUrl: r.ratesUrl,
      active: r.active,
      inRadius: roadKm <= COMPSET_RADIUS_KM,
      compsetRole: parseCompsetRole(r.compsetRole),
      isSanghyang,
      outlets: r.outlets,
    };
  });
}

/**
 * Sasaran tarif Google Hotels: Sanghyang dan pembanding penginapan (inti dan acuan) di registri. Alamatnya ratesUrl,
 * atau dihitung dari ID tempat Google Maps bila ratesUrl kosong (lib/market/google-travel-entity.ts), sehingga hotel
 * baru seperti Mövenpick ikut terpantau tanpa mencari nama.
 */
export async function getHotelRateTargets(): Promise<HotelRateTarget[]> {
  const compset = await getHotelCompset();
  return compset.flatMap((h) => {
    const url = googleTravelEntityUrl(h.ratesUrl) ?? googleTravelEntityUrlFromMaps(h.mapsUrl);
    // Sanghyang disimpan sebagai SanghyangPriceSnapshot (target tanpa competitorId), pesaing sebagai CompetitorPriceSnapshot.
    return url ? [{ name: h.name, competitorId: h.isSanghyang ? undefined : h.id, url }] : [];
  });
}

/**
 * Mengambil sasaran pengumpulan ulasan hotel compset dari DB registri.
 */
export async function getReviewTargets(): Promise<ReviewTarget[]> {
  const compset = await getHotelCompset();
  return compset.map((h) => ({
    competitorId: h.id,
    competitorName: h.name,
    query: h.name,
    travelEntityUrl: googleTravelEntityUrl(h.ratesUrl) ?? googleTravelEntityUrlFromMaps(h.mapsUrl),
    category: h.category,
    mapsUrl: h.mapsUrl,
  }));
}

/** URL entity Google Travel dari ratesUrl, tanpa parameter dan tanpa akhiran tab; null bila bukan entity Google Travel. */
export function googleTravelEntityUrl(ratesUrl: string | null | undefined): string | null {
  if (!ratesUrl || !URL.canParse(ratesUrl)) return null;
  const url = new URL(ratesUrl);
  const match = url.pathname.match(/^\/travel\/hotels\/entity\/[^/]+/);
  return url.hostname.endsWith("google.com") || url.hostname.endsWith("google.co.id")
    ? match
      ? `https://www.google.com${match[0]}`
      : null
    : null;
}

/**
 * Menghitung cakupan tarif per hotel dalam compset (audit C5).
 * Membandingkan seluruh hotel target compset dengan observasi riil terbaru di database.
 * Jika harga belum teramati, berikan alasan jujur tanpa data buatan.
 */
export async function getCompsetRateCoverage(): Promise<CompsetRateCoverage[]> {
  const hotels = await getHotelCompset();

  const coverageList: CompsetRateCoverage[] = [];

  for (const hotel of hotels) {
    let lastObservedAt: Date | null = null;
    let lastPrice: number | null = null;
    let lastSource: string | null = null;

    if (hotel.isSanghyang) {
      const latestSnapshot = await db.sanghyangPriceSnapshot.findFirst({
        where: COMPARABLE_RATE_WHERE,
        orderBy: { observedAt: "desc" },
      });
      if (latestSnapshot) {
        lastObservedAt = latestSnapshot.observedAt;
        lastPrice = Number(latestSnapshot.price);
        lastSource = latestSnapshot.source;
      }
    } else {
      const latestSnapshot = await db.competitorPriceSnapshot.findFirst({
        where: { competitorId: hotel.id, ...COMPARABLE_RATE_WHERE },
        orderBy: { observedAt: "desc" },
      });
      if (latestSnapshot) {
        lastObservedAt = latestSnapshot.observedAt;
        lastPrice = Number(latestSnapshot.price);
        lastSource = latestSnapshot.source;
      }
    }

    const hasRatesTarget = Boolean(hotel.ratesUrl);
    const isObserved = Boolean(lastObservedAt && lastPrice !== null);

    let unobservedReason: string | null = null;
    if (!isObserved) {
      if (!hasRatesTarget) {
        if (hotel.name.toLowerCase().includes("mövenpick") || hotel.name.toLowerCase().includes("movenpick")) {
          unobservedReason = "Mövenpick Resort Carita belum memiliki entitas pemesanan resmi di Google Travel";
        } else if (hotel.name.toLowerCase().includes("hawaii")) {
          unobservedReason = "Hawaii Resort Family Suites belum memiliki entitas pemesanan aktif di Google Travel";
        } else if (hotel.name.toLowerCase().includes("allisa")) {
          unobservedReason = "Allisa Resort belum terdaftar di listing tarif Google Travel";
        } else {
          unobservedReason = "Belum memiliki tautan listing tarif OTA / Google Travel terverifikasi";
        }
      } else {
        unobservedReason = "Tautan tarif tersedia, namun belum ada observasi sukses dalam siklus pengumpulan terkini";
      }
    }

    coverageList.push({
      hotelId: hotel.placeId ?? hotel.id,
      competitorId: hotel.id,
      name: hotel.name,
      group: hotel.group ?? "hotel",
      roadKm: hotel.roadKm,
      inRadius: hotel.inRadius,
      ratesUrl: hotel.ratesUrl,
      hasRatesTarget,
      lastObservedAt,
      lastPrice,
      lastSource,
      isObserved,
      unobservedReason,
    });
  }

  return coverageList;
}

/**
 * Mengambil venue kompetitor di sekitar outlet Sanghyang tertentu.
 */
export async function getVenuesForOutlet(outletKey: string): Promise<Competitor[]> {
  return db.competitor.findMany({
    where: {
      active: true,
      outlets: { has: outletKey },
      OR: [{ compsetRole: { not: null } }, { name: { contains: "Sanghyang" } }],
      NOT: {
        category: { in: ["resort", "hotel"] },
      },
    },
    orderBy: [{ roadKm: "asc" }, { name: "asc" }],
  });
}

/**
 * Mencari kompetitor berdasarkan placeId.
 */
export async function getCompetitorByPlaceId(placeId: string): Promise<Competitor | null> {
  return db.competitor.findFirst({
    where: { placeId, active: true },
  });
}

/**
 * Mencari kompetitor berdasarkan id (UUID).
 */
export async function getCompetitorById(id: string): Promise<Competitor | null> {
  return db.competitor.findUnique({
    where: { id },
  });
}
