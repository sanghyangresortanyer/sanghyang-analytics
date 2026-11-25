import "server-only";
import { cache } from "react";
import { withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import type { DmlOutletTotal } from "./dml-parser";
import type { SheetSource } from "./source";

export interface SyncState {
  source: SheetSource;
  status: "ok" | "error";
  last_checked_at: string;
  last_changed_at: string | null;
  error: string | null;
  warnings: string[];
  stats: Record<string, unknown>;
}

export interface DmlSheetSummary {
  sheet_name: string;
  list_date: string;
  total_request: number;
  sheet_grand_total: number | null;
  line_count: number;
  outlets: DmlOutletTotal[];
  warnings: string[];
}

export interface DmlLineRow {
  row_no: number;
  outlet: string;
  item_code: string | null;
  item_name: string;
  unit: string | null;
  price: number | null;
  soh: number | null;
  qty_req: number | null;
  total: number | null;
  purchase_channel: string | null;
  note: string | null;
}

export interface HkItemRow {
  /** First day of the month tab the row comes from ("2026-11-01"). */
  period_month: string;
  item_code: string;
  item_name: string;
  unit: string | null;
  stock_awal: number | null;
  total_in: number | null;
  total_out: number | null;
  stock_akhir: number | null;
  average_price: number | null;
  stock_value: number | null;
}

export interface HkMovementRow {
  period_month: string;
  movement_date: string;
  item_code: string;
  day: number;
  qty_in: number | null;
  qty_out: number | null;
  location: string | null;
}

const PAGE = 1000;

function fail(what: string, message: string): never {
  throw new Error(`${what} gagal dibaca: ${message}`);
}

export interface DmlMrLineRow {
  sheet_name: string;
  purchase_channel: string | null;
  total: number | null;
}

export const getSyncStates = cache(async (propertyId: string): Promise<SyncState[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["sheets-sync-states"],
    tags: [CACHE_TAGS.sheets(propertyId)],
    revalidate: CACHE_TTL.sheets,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("sheet_sync_state")
        .select("source, status, last_checked_at, last_changed_at, error, warnings, stats")
        .eq("property_id", propertyId);
      if (error) fail("Status sinkron", error.message);
      return (data ?? []) as SyncState[];
    },
  }),
);

export const getDmlSheets = cache(async (propertyId: string): Promise<DmlSheetSummary[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["sheets-dml-sheets"],
    tags: [CACHE_TAGS.sheets(propertyId)],
    revalidate: CACHE_TTL.sheets,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("sheet_dml_sheets")
        .select("sheet_name, list_date, total_request, sheet_grand_total, line_count, outlets, warnings")
        .eq("property_id", propertyId)
        .order("list_date", { ascending: false });
      if (error) fail("Daftar sheet DML", error.message);
      return (data ?? []) as DmlSheetSummary[];
    },
  }),
);

export const getDmlLines = cache(async (propertyId: string, sheetName: string): Promise<DmlLineRow[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["sheets-dml-lines", sheetName],
    tags: [CACHE_TAGS.sheets(propertyId)],
    revalidate: CACHE_TTL.sheets,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("sheet_dml_lines")
        .select("row_no, outlet, item_code, item_name, unit, price, soh, qty_req, total, purchase_channel, note")
        .eq("property_id", propertyId)
        .eq("sheet_name", sheetName)
        .order("row_no", { ascending: true })
        .limit(5000);
      if (error) fail("Baris DML", error.message);
      return (data ?? []) as DmlLineRow[];
    },
  }),
);

export const getDmlMrLines = cache(async (propertyId: string): Promise<DmlMrLineRow[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["sheets-dml-mr-lines"],
    tags: [CACHE_TAGS.sheets(propertyId)],
    revalidate: CACHE_TTL.sheets,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("sheet_dml_lines")
        .select("sheet_name, purchase_channel, total")
        .eq("property_id", propertyId)
        .eq("outlet", "MR")
        .limit(5000);
      if (error) fail("Baris DML seksi MR", error.message);
      return (data ?? []) as DmlMrLineRow[];
    },
  }),
);

export const getHkItems = cache(async (propertyId: string): Promise<HkItemRow[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["sheets-hk-items"],
    tags: [CACHE_TAGS.sheets(propertyId)],
    revalidate: CACHE_TTL.sheets,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("sheet_hk_items")
        .select("period_month, item_code, item_name, unit, stock_awal, total_in, total_out, stock_akhir, average_price, stock_value")
        .eq("property_id", propertyId)
        .order("period_month", { ascending: true })
        .order("stock_value", { ascending: false, nullsFirst: false })
        .limit(20000);
      if (error) fail("Item HK", error.message);
      return (data ?? []) as HkItemRow[];
    },
  }),
);

/** A month of daily movements can pass PostgREST's 1000-row page; fetch remaining pages in parallel using exact count. */
export const getHkMovements = cache(async (propertyId: string): Promise<HkMovementRow[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["sheets-hk-movements"],
    tags: [CACHE_TAGS.sheets(propertyId)],
    revalidate: CACHE_TTL.sheets,
    query: async (supabase) => {
      const page = (from: number, to: number) =>
        supabase
          .from("sheet_hk_movements")
          .select("period_month, movement_date, item_code, day, qty_in, qty_out, location", { count: "exact" })
          .eq("property_id", propertyId)
          .order("id", { ascending: true })
          .range(from, to);

      const first = await page(0, PAGE - 1);
      if (first.error) fail("Pergerakan HK", first.error.message);
      const all = [...((first.data ?? []) as HkMovementRow[])];
      const total = first.count ?? all.length;
      if (all.length < PAGE || total <= PAGE) return all;

      const rest = await Promise.all(
        Array.from({ length: Math.ceil(total / PAGE) - 1 }, (_, i) => page((i + 1) * PAGE, (i + 2) * PAGE - 1)),
      );
      for (const r of rest) {
        if (r.error) fail("Pergerakan HK", r.error.message);
        all.push(...((r.data ?? []) as HkMovementRow[]));
      }
      return all;
    },
  }),
);

