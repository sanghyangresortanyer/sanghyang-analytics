// Reads the Laporan Resort figures via Next.js Data Cache (per propertyId, auth checked via currentUser())
// and renders the print-ready HTML page.
import "server-only";
import { cache } from "react";
import { currentUser } from "@/lib/auth/role";
import { withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import { occupancy } from "@/lib/dashboard/occupancy";
import { getNights } from "@/lib/dashboard/occupancy-query";
import { type ReportQuery, reportPeriods, reportPicker } from "@/lib/marketing/ads-report";
import { lastVhpDay } from "@/lib/marketing/vhp-load";
import { hotelPeriods } from "@/lib/marketing/vhp-week";
import type { Period } from "@/lib/marketing/weekly-report";
import { outletTotals, renderResort, resortReport, type ResortSide } from "./resort-report";

async function paged<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || (data as unknown[]).length < 1000) return out;
  }
}

/** Department names as VHP's revenue report writes them in full, explicitly filtered by propertyId. */
const getKnownOutletNames = cache(async (propertyId: string): Promise<string[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["resort-known-outlets"],
    tags: [CACHE_TAGS.vhpResortReport(propertyId), CACHE_TAGS.vhpMeetings(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const known = await paged<{ outlet_name: string }>((a, b) =>
        supabase
          .from("weekly_outlet_metrics")
          .select("outlet_name, weekly_meetings!inner(property_id)")
          .eq("weekly_meetings.property_id", propertyId)
          .order("id")
          .range(a, b),
      );
      return [...new Set(known.map((k) => k.outlet_name))];
    },
  }),
);

const getResortRevenueDays = cache(async (propertyId: string, since: string, until: string) =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["resort-revenue-days", since, until],
    tags: [CACHE_TAGS.vhpResortReport(propertyId), CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: (supabase) =>
      paged<{ outlet_name: string; revenue: unknown }>((a, b) =>
        supabase.rpc("revenue_by_day", { p_property: propertyId, p_from: since, p_to: until }).range(a, b),
      ),
  }),
);

const getResortRoomSegments = cache(async (propertyId: string, since: string, until: string) =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["resort-room-segments", since, until],
    tags: [CACHE_TAGS.vhpResortReport(propertyId), CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase.rpc("room_revenue_by_segment", { p_property: propertyId, p_from: since, p_to: until });
      if (error) throw new Error(error.message);
      return ((data ?? []) as { segment: string; lodging: unknown }[]).map((s) => ({
        segment: s.segment,
        lodging: Number(s.lodging ?? 0),
      }));
    },
  }),
);

const getResortPurchaseTotal = cache(async (propertyId: string, since: string, until: string) =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["resort-purchase-total", since, until],
    tags: [CACHE_TAGS.vhpResortReport(propertyId), CACHE_TAGS.vhpMeetings(propertyId), CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const buys = await paged<{ amount: unknown }>((a, b) =>
        supabase
          .from("weekly_purchase_lines")
          .select("amount")
          .eq("property_id", propertyId)
          .gte("receive_date", since)
          .lte("receive_date", until)
          .order("id")
          .range(a, b),
      );
      return buys.reduce((t, r) => t + Number(r.amount ?? 0), 0);
    },
  }),
);

async function side(propertyId: string, p: Period, names: string[]): Promise<ResortSide> {
  const [days, segments, nights, purchase] = await Promise.all([
    getResortRevenueDays(propertyId, p.since, p.until),
    getResortRoomSegments(propertyId, p.since, p.until),
    // ZERO-FALLBACK: okupansi dan pembelian ditampilkan kosong ("–") dengan catatan eksplisit di limits bila gagal dibaca, bukan 0.
    getNights(propertyId, p.since, p.until).catch(() => null),
    getResortPurchaseTotal(propertyId, p.since, p.until).catch(() => null),
  ]);
  return {
    outlets: outletTotals(days, names),
    segments,
    stay: nights ? occupancy(nights) : null,
    purchase,
  };
}

/** Laporan Resort: per month by default, or per day, week or free dates like the Google Ads report. */
export async function resortReportPage(q: ReportQuery): Promise<string> {
  const me = await currentUser();
  if (!me?.propertyId) throw new Error("Silakan login.");
  const periods = reportPeriods({ ...q, mode: q.mode || "bulan" });
  const title = periods.title.replace("Perbandingan iklan Google", "Laporan Resort");
  const [last, names] = await Promise.all([lastVhpDay(me.propertyId), getKnownOutletNames(me.propertyId)]);
  const h = hotelPeriods(periods.current, periods.previous, last);
  const [curr, prev] = await Promise.all([side(me.propertyId, h.curr, names), side(me.propertyId, h.prev, names)]);
  const report = resortReport({ periods: { ...periods, title, current: h.curr, previous: h.prev }, curr, prev, lastDataDay: last, cut: h.cut });
  // The refresh button reads Google again; this report has no Google data.
  const picker = reportPicker(q.mode ? q : { ...q, mode: "bulan" }, periods).replace(/<button type="submit" name="refresh"[^>]*>[^<]*<\/button>/, "");
  return renderResort(report, new Date(), picker);
}
