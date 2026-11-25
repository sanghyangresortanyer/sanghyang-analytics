// Reads the VHP side of the Monday report from the Sanghyang Analytics database, cached per propertyId
// via Next.js Data Cache (admin client with explicit property_id filter, auth checked by caller).
import "server-only";
import { cache } from "react";
import { withPropertySupabaseCache, type AdminSupabaseClient } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import { occupancy } from "@/lib/dashboard/occupancy";
import { getNightsOf } from "@/lib/dashboard/occupancy-query";
import { addDays } from "./metrics.ts";
import type { HotelRooms } from "./campaign-impact.ts";
import type { MonthSlot } from "./monthly-analysis.ts";
import { AD_GUESTS, countRoomNights, type LodgingRow, type SegmentRow, type VhpWeek } from "./vhp-week.ts";
import type { Period } from "./weekly-report.ts";

const PAGE = 1000;
/** Baseline of the averages, as decided by the user on 2026-11-18 (VHP data before 2026 is not used). */
export const BASELINE = "2026-01-01";

async function paged<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function segments(supabase: AdminSupabaseClient, propertyId: string, p: Period): Promise<SegmentRow[]> {
  const { data, error } = await supabase.rpc("room_revenue_by_segment", { p_property: propertyId, p_from: p.since, p_to: p.until });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { segment: string; revenue: unknown; room_nights: unknown; lodging: unknown }[]).map((r) => ({
    segment: r.segment,
    revenue: Number(r.revenue),
    roomNights: Number(r.room_nights),
    lodging: Number(r.lodging),
  }));
}

const loadVhpWeeksByKey = cache(
  async (
    propertyId: string,
    currSince: string,
    currUntil: string,
    prevSince: string,
    prevUntil: string,
  ): Promise<{ curr: VhpWeek; prev: VhpWeek; range: VhpWeek }> =>
    withPropertySupabaseCache({
      propertyId,
      keyParts: ["marketing-vhp-weeks", currSince, currUntil, prevSince, prevUntil],
      tags: [CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpOccupancy(propertyId)],
      revalidate: CACHE_TTL.vhp,
      query: async (supabase) => {
        const curr: Period = { since: currSince, until: currUntil };
        const prev: Period = { since: prevSince, until: prevUntil };
        const range: Period = { since: BASELINE, until: curr.until };
        const from = prev.since < BASELINE ? prev.since : BASELINE;
        // OCC and ARR are extra: if they cannot be read, those rows stay empty and the rest of the table shows.
        const stay = (p: Period) => getNightsOf(propertyId, p.since, p.until, AD_GUESTS).then(occupancy).catch(() => null);
        const [last, lodging, segCurr, segPrev, segRange, stayCurr, stayPrev] = await Promise.all([
          supabase.from("weekly_sales_lines").select("sale_date").eq("property_id", propertyId).order("sale_date", { ascending: false }).limit(1),
          paged<LodgingRow>((a, b) =>
            supabase
              .from("weekly_sales_lines")
              .select("sale_date, room_no, segment, sales_amount")
              .eq("property_id", propertyId)
              .eq("source", "fo")
              .eq("outlet_name", "Front Office")
              .eq("art_no", "100")
              .gte("sale_date", addDays(from, -1))
              .lte("sale_date", curr.until)
              .order("id", { ascending: true })
              .range(a, b),
          ),
          segments(supabase, propertyId, curr),
          segments(supabase, propertyId, prev),
          segments(supabase, propertyId, range),
          stay(curr),
          stay(prev),
        ]);
        if (last.error) throw new Error(last.error.message);
        const lastDataDay = (last.data?.[0] as { sale_date: string } | undefined)?.sale_date ?? null;
        // The RPC counts postings as nights; a room has one night per date (countRoomNights).
        const week = (period: Period, segs: SegmentRow[]): VhpWeek => {
          const nights = countRoomNights(lodging, period.since, period.until);
          return { period, segments: segs.map((x) => ({ ...x, roomNights: nights[x.segment] ?? 0 })), lastDataDay };
        };
        return { curr: { ...week(curr, segCurr), stay: stayCurr }, prev: { ...week(prev, segPrev), stay: stayPrev }, range: week(range, segRange) };
      },
    }),
);

/** VHP figures of the report week, the week before, and 1 January up to the report week (for averages). */
export async function loadVhpWeeks(propertyId: string, curr: Period, prev: Period): Promise<{ curr: VhpWeek; prev: VhpWeek; range: VhpWeek }> {
  return loadVhpWeeksByKey(propertyId, curr.since, curr.until, prev.since, prev.until);
}

/** Last day with VHP data in the app, or null. */
export const lastVhpDay = cache(async (propertyId: string): Promise<string | null> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["marketing-last-vhp-day"],
    tags: [CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("weekly_sales_lines")
        .select("sale_date")
        .eq("property_id", propertyId)
        .order("sale_date", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0] as { sale_date: string } | undefined)?.sale_date ?? null;
    },
  }),
);

/** Room revenue (Lodging) per month slot with VHP data, for "Iklan dan revenue kamar per bulan". */
export async function loadHotelRooms(propertyId: string, slots: MonthSlot[]): Promise<Map<string, HotelRooms>> {
  const withData = slots.filter((s) => s.hotel);
  if (withData.length === 0) return new Map();
  const slotsSig = withData.map((s) => `${s.month}:${s.period.since}..${s.period.until}`).join("|");
  const entries = await withPropertySupabaseCache({
    propertyId,
    keyParts: ["marketing-hotel-rooms", slotsSig],
    tags: [CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const segs = await Promise.all(withData.map((s) => segments(supabase, propertyId, s.period)));
      const of = (rows: SegmentRow[], name: string) =>
        rows.filter((r) => r.segment === name).reduce((t, r) => t + (r.lodging ?? r.revenue), 0);
      return withData.map((s, i): [string, HotelRooms] => [
        s.month,
        { fit: of(segs[i], "FIT"), walkIn: of(segs[i], "WALK IN"), ota: of(segs[i], "FIT-TA") },
      ]);
    },
  });
  return new Map(entries);
}
