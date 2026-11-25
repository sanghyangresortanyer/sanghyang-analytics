import "server-only";
import { cache } from "react";
import { withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import { mergeTargets, type OutletTarget } from "./outlet-targets";

/** Targets in force for the property: saved rows (Pengaturan) over the defaults. */
export const getOutletTargets = cache(async (propertyId: string): Promise<OutletTarget[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["outlet-targets"],
    tags: [CACHE_TAGS.settingsTargets(propertyId)],
    revalidate: CACHE_TTL.settings,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("outlet_targets")
        .select("outlet, monthly_target, version")
        .eq("property_id", propertyId);
      if (error) throw new Error(error.message);
      return mergeTargets(data ?? []);
    },
  }),
);
