/**
 * Outlet di dalam hotel pesaing (baris registri yang punya hotel induk), dikelompokkan per hotel induk. Summary API
 * mengirimnya bersama promo hotel supaya promo yang menyebut nama outlet itu diarahkan ke outlet Sanghyang pembandingnya
 * (lib/market/outlet-filters.ts promoOutlets).
 */
import { cache } from "react";
import { withCachedMap } from "../cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "../cache/tags";
import { db } from "../db";
import type { PromoVenue } from "./outlet-filters";

export const loadHotelVenues = cache(async (): Promise<Map<string, PromoVenue[]>> =>
  withCachedMap(
    async () => {
      const rows = await db.competitor.findMany({
        where: { active: true, parentId: { not: null } },
        select: { parentId: true, name: true, outlets: true },
        orderBy: { name: "asc" },
      });
      const byHotel = new Map<string, PromoVenue[]>();
      for (const r of rows) {
        const hotelId = r.parentId as string;
        byHotel.set(hotelId, [...(byHotel.get(hotelId) ?? []), { name: r.name, outlets: r.outlets }]);
      }
      return byHotel;
    },
    ["mi-hotel-venues"],
    { tags: [CACHE_TAGS.marketCompetitors], revalidate: CACHE_TTL.marketIntelligence },
  ),
);
