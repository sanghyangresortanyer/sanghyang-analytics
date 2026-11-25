import "server-only";

import { cache } from "react";
import { withPropertySupabaseCache, type AdminSupabaseClient } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import { uploadCoverage } from "./data-status";
import { buildRangeReport, dayBefore, type DateSpan, type FoSnapshot, type PurchaseLine, type RangeReport, type SalesLine } from "./range-report";

/** Minimal meeting fields the range engine needs. */
export interface RangeMeeting {
  id: string;
  period_start: string;
  period_end: string;
  journal_filename?: string | null;
  fo_journal_filename?: string | null;
  revenue_source?: string | null;
  purchase_filename?: string | null;
  revenue_filename?: string | null;
}

const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>;

/**
 * Supabase caps a select at 1000 rows; daily lines of one month are several thousand.
 * The first page also returns the row count, so the remaining pages are fetched at once
 * instead of one round-trip after another.
 */
async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const first = await page(0, PAGE - 1);
  if (first.error) throw new Error(first.error.message);
  const out = [...(first.data ?? [])];
  const total = first.count ?? out.length;
  if (out.length < PAGE || total <= PAGE) return out;
  const rest = await Promise.all(
    Array.from({ length: Math.ceil(total / PAGE) - 1 }, (_, i) => page((i + 1) * PAGE, (i + 2) * PAGE - 1)),
  );
  for (const r of rest) {
    if (r.error) throw new Error(r.error.message);
    out.push(...(r.data ?? []));
  }
  return out;
}

async function foSnapshots(supabase: AdminSupabaseClient, meetings: RangeMeeting[], start: string, end: string): Promise<FoSnapshot[]> {
  // Reports that can be a piece of an exact F/O range: they end inside it, or the day before it
  // (the earlier report of a difference).
  const before = dayBefore(start);
  // Only Turnover uploads are F/O snapshots (a purchase-only upload has no revenue at all).
  const candidates = meetings.filter((m) => m.revenue_source === "fo" && m.period_end >= before && m.period_end <= end);
  if (candidates.length === 0) return [];
  const ids = candidates.map((m) => m.id);
  const [{ data: outlets, error: oErr }, { data: items, error: iErr }] = await Promise.all([
    supabase.from("weekly_outlet_metrics").select("meeting_id, outlet_name, revenue_amount").in("meeting_id", ids),
    supabase.from("weekly_outlet_items").select("meeting_id, outlet_name, art_no, description, total_qty, total_amount").in("meeting_id", ids),
  ]);
  if (oErr || iErr) throw new Error((oErr ?? iErr)!.message);
  return candidates.map((m) => ({
    meetingId: m.id,
    periodStart: m.period_start,
    periodEnd: m.period_end,
    outlets: (outlets ?? []).filter((o) => o.meeting_id === m.id).map((o) => ({ outlet_name: o.outlet_name, revenue_amount: Number(o.revenue_amount) })),
    items: (items ?? [])
      .filter((i) => i.meeting_id === m.id)
      .map((i) => ({ outlet_name: i.outlet_name, art_no: i.art_no, description: i.description, total_qty: Number(i.total_qty), total_amount: Number(i.total_amount) })),
  }));
}

type RangeResult = RangeReport & { salesCoverage: DateSpan[]; purchaseCoverage: DateSpan[] };

const computeRangeByKey = cache(async (propertyId: string, start: string, end: string, meetingsJson: string): Promise<RangeResult> => {
  const meetings = JSON.parse(meetingsJson) as RangeMeeting[];
  const meetingsSig = meetings.map((m) => m.id).join(",");
  return withPropertySupabaseCache({
    propertyId,
    keyParts: ["range-report", start, end, meetingsSig],
    tags: [CACHE_TAGS.vhpMeetings(propertyId), CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const foMeetingIds = meetings.filter((m) => m.revenue_source === "fo").map((m) => m.id);
      const [snapshots, knownOutlets, salesLines, purchaseLines] = await Promise.all([
        foSnapshots(supabase, meetings, start, end),
        foMeetingIds.length
          ? supabase
              .from("weekly_outlet_metrics")
              .select("outlet_name")
              .in("meeting_id", foMeetingIds)
              .then(({ data, error }) => {
                if (error) throw new Error(error.message);
                return [...new Set((data ?? []).map((r) => r.outlet_name as string))];
              })
          : Promise.resolve([] as string[]),
        fetchAll<SalesLine>((from, to) =>
          supabase
            .from("weekly_sales_lines")
            .select("sale_date, outlet_name, art_no, description, qty, sales_amount, coupon_amount, source", { count: "exact" })
            .eq("property_id", propertyId)
            .gte("sale_date", start)
            .lte("sale_date", end)
            .order("id")
            .range(from, to),
        ),
        fetchAll<PurchaseLine>((from, to) =>
          supabase
            .from("weekly_purchase_lines")
            .select("receive_date, supplier_name, art_no, description, unit, qty, amount", { count: "exact" })
            .eq("property_id", propertyId)
            .gte("receive_date", start)
            .lte("receive_date", end)
            .order("id")
            .range(from, to),
        ),
      ]);
      // numeric columns arrive as strings from PostgREST
      const sales = salesLines.map((l) => ({ ...l, qty: Number(l.qty), sales_amount: Number(l.sales_amount), coupon_amount: Number(l.coupon_amount) }));
      const purchases = purchaseLines.map((l) => ({ ...l, qty: Number(l.qty), amount: Number(l.amount) }));

      // Uploads made since daily lines exist carry revenue_source; older ones have no lines.
      const salesCoverage = meetings.filter((m) => m.journal_filename).map((m) => ({ start: m.period_start, end: m.period_end }));
      const foJournalCoverage = meetings.filter((m) => m.fo_journal_filename).map((m) => ({ start: m.period_start, end: m.period_end }));
      const purchaseCoverage = uploadCoverage(meetings).purchase;

      const report = buildRangeReport({
        start,
        end,
        snapshots,
        knownOutlets,
        salesLines: sales,
        salesCoverage,
        foJournalCoverage,
        purchaseLines: purchases,
        purchaseCoverage,
      });
      if (purchaseCoverage.length === 0) report.purchase.notes.push("Belum ada baris pembelian harian. Unggah ulang file Pembelian VHP agar pembelian bisa dipilih per tanggal.");
      return { ...report, salesCoverage, purchaseCoverage };
    },
  });
});

/** All figures for [start, end] from the daily lines and F/O snapshots of a property. */
export async function computeRange(propertyId: string, meetings: RangeMeeting[], start: string, end: string): Promise<RangeResult> {
  // Normalize only RangeMeeting fields so identical meetings deduplicate inside React cache() & Data Cache.
  const minimal: RangeMeeting[] = meetings.map((m) => ({
    id: m.id,
    period_start: m.period_start,
    period_end: m.period_end,
    journal_filename: m.journal_filename ?? null,
    fo_journal_filename: m.fo_journal_filename ?? null,
    revenue_source: m.revenue_source ?? null,
    purchase_filename: m.purchase_filename ?? null,
    revenue_filename: m.revenue_filename ?? null,
  }));
  return computeRangeByKey(propertyId, start, end, JSON.stringify(minimal));
}
