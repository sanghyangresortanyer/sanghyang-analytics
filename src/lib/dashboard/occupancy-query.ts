import "server-only";
import { cache } from "react";
import { withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import type { Night } from "./occupancy.ts";

/** Rooms sold and room income per night of all guests, cached per propertyId with explicit property filter. */
export const getNights = cache(async (propertyId: string, from: string, to: string): Promise<Night[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["occupancy-nights", from, to],
    tags: [CACHE_TAGS.vhpOccupancy(propertyId), CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) =>
      toNights(await supabase.rpc("occupancy_by_night", { p_property: propertyId, p_from: from, p_to: to })),
  }),
);

const getNightsOfByKey = cache(async (propertyId: string, from: string, to: string, segmentsKey: string): Promise<Night[]> => {
  const segments = segmentsKey ? segmentsKey.split("\x1f") : [];
  return withPropertySupabaseCache({
    propertyId,
    keyParts: ["occupancy-nights-segments", from, to, segmentsKey],
    tags: [CACHE_TAGS.vhpOccupancy(propertyId), CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) =>
      toNights(await supabase.rpc("occupancy_for_segments", { p_property: propertyId, p_from: from, p_to: to, p_segments: segments })),
  });
});

/** The same for chosen guest types only (VHP codes). */
export async function getNightsOf(propertyId: string, from: string, to: string, segments: string[]): Promise<Night[]> {
  const segmentsKey = [...segments].sort().join("\x1f");
  return getNightsOfByKey(propertyId, from, to, segmentsKey);
}

function toNights({ data, error }: { data: unknown; error: { message: string } | null }): Night[] {
  if (error) throw new Error(error.message);
  return ((data ?? []) as { night: string; rooms: unknown; lodging: unknown; package: unknown }[]).map((r) => ({
    date: r.night,
    rooms: Number(r.rooms),
    lodging: Number(r.lodging),
    pkg: Number(r.package),
  }));
}
