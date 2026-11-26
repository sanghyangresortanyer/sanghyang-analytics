import "server-only";

import { cache } from "react";
import { currentUser } from "@/lib/auth/role";
import { withPropertySupabaseCache, type AdminSupabaseClient } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import { getPresentationData, type PresentationQueryResult } from "@/lib/actions/weekly-meeting";
import { getDmlMrLines, getDmlSheets, getHkItems, getHkMovements, getSyncStates, type HkItemRow, type HkMovementRow } from "@/lib/sheets/queries";
import type { StockStore } from "@/lib/sheets/source";
import { storeFigures, type StoreFigures } from "./store-inventory";
import { formatRp } from "@/lib/format-currency";
import { revenueOutletFor } from "./outlet-match";
import { resolveJournalOutlet } from "./range-report";
import { buildRevenueCharts, type RevenueCharts } from "./revenue-trend";
import { nettRatios, samePeriodLastMonth, type NettRatio, type NettSource } from "./revenue-nett";
import { classifyMenus, menuBaseline, windowStart, type MenuActivity } from "./menu-activity";
import { computeRange, type RangeMeeting } from "./range-data";
import { INVENTORY_DEPARTMENTS } from "./inventory-departments";
import { dataReminders, type DataReminders } from "./data-status";
import { hkLedger, type HkLedger } from "./hk-ledger";
import { mergeTargets, type OutletTarget } from "./outlet-targets";
import { getOutletTargets } from "./outlet-targets-query";
import { groupPurchases } from "./purchase-groups";
import { mergeBudgets, type DivisionBudget } from "./division-budgets";
import type { Night } from "./occupancy";
import { getNights } from "./occupancy-query";
import { revenueByRoomType, type RoomTypeRevenue } from "./room-types";
import { getDbarSplit, getDivisionBudgets, getMenuRules, getRoomRevenue, getRoomSettings } from "./settings-query";
import type { DbarSplit } from "./dbar-split";
import {
  calculateDmlPurchases,
  calculateHkLocationUsage,
  dmlSheetsInPeriod,
  inventoryOverview,
  mergeRevenueOutlets,
  type DashboardDmlOutletPurchase,
  type DashboardOutletUsage,
  type InventoryDepartment,
  type InventoryOverview,
  type MrLineSummary,
} from "./dashboard-calc";

export interface UnifiedDashboardData {
  query: PresentationQueryResult;
  hkLinked: boolean;
  hkItemCount: number;
  /** HK stock value at the last day of the period; null when that month has no tab in the sheet. */
  hkTotalStockValue: number | null;
  /** HK goods taken out during the period, at the VHP average price. */
  hkTotalUsageCost: number;
  hkSyncedAt: string | null;
  hkLedger: HkLedger | null;
  hkUnpricedEntries: number;
  hkLocations: DashboardOutletUsage[];
  dmlPurchases: DashboardDmlOutletPurchase[];
  dmlTotalAmount: number;
  /** DML lists dated inside the meeting period that the purchase figures come from. */
  dmlSheetsUsed: { sheet_name: string; list_date: string }[];
  /** Google Sheets data that could not be read; shown on the dashboard instead of silent zeros. */
  sourceErrors: string[];
  /** Revenue outlets folded into another one on this dashboard (e.g. Room Service → d'Bistro). */
  revenueMerged: { target: string; sources: string[] }[];
  /** Month-to-date revenue per outlet for the month of the period end, for the monthly targets. */
  monthToDate: {
    month: string;
    through: string;
    meetingCount: number;
    source: "fo" | "journal" | "none";
    missingOutlets: string[];
    outlets: { outlet_name: string; revenue: number }[];
    /** Purchases per division (VHP article group) from the 1st of the month. */
    purchases: { division: string; total: number }[];
  } | null;
  /** Monthly target per outlet in force (Pengaturan, else the defaults). */
  outletTargets: OutletTarget[];
  /** Monthly purchase budget per division (Pengaturan). */
  divisionBudgets: DivisionBudget[];
  /** Room revenue per room type in the period; null when it could not be read. */
  roomTypes: RoomTypeRevenue[] | null;
  /** d'Bar Karaoke & DBC split into DBC and d'Bar & Karaoke for the period; null when it could not be read. */
  dbarSplit: DbarSplit | null;
  /** Stock and usage over every store, HK being one of them. */
  inventory: InventoryOverview;
  /** Data still to import, 1st of the month up to yesterday. */
  reminders: DataReminders | null;
  /** Monthly trend, weeks and categories for the Revenue tab (nett). */
  revenueCharts: RevenueCharts | null;
  /** Nett revenue per outlet in the period of the same length right before; null without data. */
  previousRevenue: { start: string; end: string; outlets: Record<string, number> } | null;
  /** Room revenue per booking segment in the period (nett), with room nights. */
  roomSegments: { segment: string; revenue: number; roomNights: number; lodging: number }[] | null;
  /** Rooms sold per night in the period and on the same dates of the month before; null when it could not be read. */
  occupancy: { nights: Night[]; previous: Night[]; range: { start: string; end: string }; previousRange: { start: string; end: string }; recent: Night[] } | null;
  /** Dead and slow menus since 1 January, over the last 90 days of data. */
  menuActivity: (ReturnType<typeof classifyMenus> & { lastDay: string }) | null;
}

const EMPTY = {
  hkLinked: false,
  hkItemCount: 0,
  hkTotalStockValue: 0,
  hkTotalUsageCost: 0,
  hkSyncedAt: null,
  hkLedger: null,
  hkUnpricedEntries: 0,
  hkLocations: [],
  dmlPurchases: [],
  dmlTotalAmount: 0,
  dmlSheetsUsed: [],
  sourceErrors: [],
  revenueMerged: [],
  monthToDate: null,
  outletTargets: mergeTargets([]),
  divisionBudgets: mergeBudgets([]),
  roomTypes: null,
  dbarSplit: null,
  inventory: inventoryOverview([]),
  reminders: null,
  revenueCharts: null,
  previousRevenue: null,
  roomSegments: null,
  occupancy: null,
  menuActivity: null,
} satisfies Omit<UnifiedDashboardData, "query">;

/** Runs a read and records its error message instead of turning it into an empty result. */
async function attempt<T>(label: string, errors: string[], run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Stock sheets read besides HK (migration 0088). */
const OTHER_STORES: StockStore[] = ["main", "eng", "bev"];

function loadSheets(propertyId: string, errors: string[]) {
  return Promise.all([
    attempt("Inventory HK", errors, () => getHkItems(propertyId)),
    attempt("Pemakaian HK", errors, () => getHkMovements(propertyId)),
    attempt("DML", errors, () => getDmlSheets(propertyId)),
    attempt("Inventory Main Store, Engineering, Minuman", errors, () =>
      Promise.all(
        OTHER_STORES.map(async (store) => {
          const [items, movements] = await Promise.all([getHkItems(propertyId, store), getHkMovements(propertyId, store)]);
          return { store, items, movements };
        }),
      ),
    ),
    attempt("Status sinkron", errors, () => getSyncStates(propertyId)),
    attempt("DML seksi MR", errors, () => getDmlMrLines(propertyId) as Promise<MrLineSummary[]>),
  ]);
}

export async function getUnifiedDashboardData(params: {
  mode?: string;
  meetingId?: string;
  startDate?: string;
  endDate?: string;
  month?: string;
}): Promise<UnifiedDashboardData> {
  const me = await currentUser();
  const errors: string[] = [];
  // Sheets data does not depend on the chosen period: fetch it while the period is computed,
  // instead of after it (each round-trip to the database counts).
  const sheets = me?.propertyId ? loadSheets(me.propertyId, errors) : null;
  // Default view: the current month from the 1st up to the last day with data.
  const noFilter = !params.mode && !params.meetingId && !params.startDate && !params.endDate;
  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 7);
  const [raw, nettSources] = await Promise.all([
    getPresentationData({ ...(noFilter ? { mode: "month", month: thisMonth } : params), compare: false }),
    SHOW_NETT && me?.propertyId ? attempt("Revenue bersih", errors, () => loadNettSources(me.propertyId!)) : Promise.resolve(null),
  ]);
  if (!me?.propertyId || !raw.data || !sheets) return { query: raw, ...EMPTY };

  // Revenue is the figure of VHP's laporan revenue, as decided at the start (user 2026-11-19: nett
  // versus gross is not on the table yet). The nett conversion stays ready behind SHOW_NETT.
  const ratio: NettRatio = SHOW_NETT ? nettRatios(nettSources ?? []) : () => 1;
  const { period_start: ps, period_end: pe } = raw.data.meeting;
  const nettOutlets = raw.data.outlets.map((o) => ({ ...o, revenue_amount: o.revenue_amount * ratio(o.outlet_name, ps, pe) }));
  raw.data.meeting = { ...raw.data.meeting, total_revenue: nettOutlets.reduce((s, o) => s + (o.revenue_available === false ? 0 : o.revenue_amount), 0) };

  // Revenue outlets reported together (Room Service, Banquet → d'Bistro), including their sold items.
  const revenue = mergeRevenueOutlets(nettOutlets);
  const query: PresentationQueryResult = {
    ...raw,
    data: {
      ...raw.data,
      outlets: revenue.outlets,
      outletItems: raw.data.outletItems?.map((it) => ({ ...it, outlet_name: revenueOutletFor(it.outlet_name) })),
    },
  };
  const meetingData = query.data!;
  const propertyId = me.propertyId;

  const { period_start, period_end } = meetingData.meeting;
  const foNames = raw.data.outlets.map((o) => o.outlet_name);
  const [[hkItems, hkMovements, dmlSheets, otherStores, states, mrLines], monthToDate, revenueCharts, roomSegments, menuRows, savedTargets, savedBudgets, roomTypes, dbar, occupancy] = await Promise.all([
    sheets,
    attempt("Revenue bulan berjalan", errors, () => monthToDateRevenue(propertyId, raw.allMeetings, period_end, () => 1)),
    attempt("Grafik revenue", errors, () => loadRevenueCharts(propertyId, foNames, period_start, period_end, ratio)),
    attempt("Revenue kamar per segmen", errors, () => loadRoomSegments(propertyId, period_start, period_end, ratio)),
    attempt("Menu tidak laku", errors, () => loadMenuActivity(propertyId, foNames, period_end)),
    attempt("Target outlet", errors, () => getOutletTargets(propertyId)),
    attempt("Budget belanja", errors, () => getDivisionBudgets(propertyId)),
    attempt("Revenue per jenis kamar", errors, async () => {
      const [rows, rooms] = await Promise.all([getRoomRevenue(propertyId, period_start, period_end), getRoomSettings(propertyId)]);
      return revenueByRoomType(rows, rooms);
    }),
    attempt("Rincian d'Bar & DBC", errors, () => getDbarSplit(propertyId, period_start, period_end)),
    attempt("OCC per malam", errors, async () => {
      const previousRange = samePeriodLastMonth(period_start, period_end);
      // The last 10 weeks, whatever the period on screen, for the estimate of the coming nights.
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
      const tenWeeks = new Date(Date.parse(`${today}T00:00:00Z`) - 70 * 86_400_000).toISOString().slice(0, 10);
      const [nights, previous, recent] = await Promise.all([
        getNights(propertyId, period_start, period_end),
        getNights(propertyId, previousRange.start, previousRange.end),
        getNights(propertyId, tenWeeks, today),
      ]);
      return { nights, previous, range: { start: period_start, end: period_end }, previousRange, recent };
    }),
  ]);
  const previousRevenue = revenueCharts ? previousRevenueFrom(revenueCharts, period_start, period_end) : null;
  const menuActivity = menuRows ? { ...classifyMenus(menuRows.rows, menuRows.lastDay, menuRows.rules), lastDay: menuRows.lastDay } : null;

  const items = hkItems ?? [];
  const inPeriod = (hkMovements ?? []).filter((m) => m.movement_date >= period_start && m.movement_date <= period_end);
  const usage = calculateHkLocationUsage(items, inPeriod);
  const ledger = items.length > 0 ? hkLedger(items, hkMovements ?? [], period_start, period_end) : null;
  const sheetsUsed = dmlSheetsInPeriod(dmlSheets ?? [], period_start, period_end);
  const { purchases, total } = calculateDmlPurchases(sheetsUsed, mrLines ?? []);
  const hkState = states?.find((s) => s.source === "hk");

  const hkCodes = new Set(items.map((i) => i.item_code));
  const stores: Partial<Record<StockStore, StoreFigures | null>> = Object.fromEntries(
    (otherStores ?? []).map((s: { store: StockStore; items: HkItemRow[]; movements: HkMovementRow[] }) => [
      s.store,
      // What the Main Store sends to HK and HK keeps in stock is a move, counted when HK uses it.
      storeFigures(s.items, s.movements, period_start, period_end, s.store === "main" ? [{ destination: "HK", codes: hkCodes }] : []),
    ]),
  );

  const inventory = inventoryOverview(
      inventoryDepartments({
        hkStock: ledger?.closingValue ?? null,
        hkUsage: ledger ? Math.round(ledger.outValue) : null,
        hkUsageBy: usage.locations,
        stores,
        uploadFilename: meetingData.meeting.inventory_filename !== "(Belum diunggah)" ? meetingData.meeting.inventory_filename : null,
        uploadStock: Number(meetingData.meeting.total_inventory),
      }),
    );

  return {
    query,
    hkLinked: items.length > 0,
    hkItemCount: new Set(items.map((i) => i.item_code)).size,
    hkTotalStockValue: ledger?.closingValue === null || !ledger ? null : Math.round(ledger.closingValue),
    hkTotalUsageCost: Math.round(ledger?.outValue ?? 0),
    hkSyncedAt: hkState?.last_checked_at ?? null,
    hkLedger: ledger,
    hkUnpricedEntries: usage.unpricedEntries,
    hkLocations: usage.locations,
    dmlPurchases: purchases,
    dmlTotalAmount: total,
    dmlSheetsUsed: sheetsUsed.map((s) => ({ sheet_name: s.sheet_name, list_date: s.list_date })),
    sourceErrors: errors,
    revenueMerged: revenue.merged,
    monthToDate,
    outletTargets: savedTargets ?? mergeTargets([]),
    divisionBudgets: savedBudgets ?? mergeBudgets([]),
    roomTypes,
    dbarSplit: dbar,
    revenueCharts,
    previousRevenue,
    roomSegments,
    occupancy,
    menuActivity,
    inventory,
    reminders: dataReminders({
      today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      meetings: raw.allMeetings,
      notConnected: inventory.notConnected.map((n) => n.replace(/^Inventory /, "")),
      hkThrough: (hkMovements ?? []).reduce<string | null>((max, m) => (max === null || m.movement_date > max ? m.movement_date : max), null),
    }),
  };
}

/** Inventory departments from INVENTORY_DEPARTMENTS, plus a spreadsheet uploaded with the weekly files. */
function inventoryDepartments(input: {
  hkStock: number | null;
  hkUsage: number | null;
  hkUsageBy: DashboardOutletUsage[];
  stores: Partial<Record<StockStore, StoreFigures | null>>;
  uploadFilename: string | null;
  uploadStock: number;
}): InventoryDepartment[] {
  const departments: InventoryDepartment[] = INVENTORY_DEPARTMENTS.map(({ key, name, source, store }) => {
    if (store === "hk") return { key, name, source, connected: input.hkStock !== null || input.hkUsage !== null, stock: input.hkStock, usage: input.hkUsage, usageBy: input.hkUsageBy };
    const f = store ? input.stores[store] : null;
    if (!f) return { key, name, source: store ? `${source} (belum ada data)` : source, connected: false, stock: null, usage: null, usageBy: [] };
    const note = f.transferred > 0 ? ` · kiriman ke HK ${formatRp(f.transferred)} dihitung di HK` : "";
    return { key, name, source: `${source}${note}`, connected: true, stock: f.stock, usage: f.usage, usageBy: f.usageBy };
  });
  if (input.uploadFilename) {
    departments.push({ key: "upload", name: `Inventory upload (${input.uploadFilename})`, source: "Spreadsheet upload mingguan", connected: true, stock: input.uploadStock, usage: null, usageBy: [] });
  }
  return departments;
}

/**
 * Revenue per outlet from the 1st of the month of `through` up to `through`, from the
 * same range engine as the dashboard. A month-to-date F/O report already holds the whole
 * month so far; summing every upload of the month would count those days twice.
 * Room Service and Banquet fold into d'Bistro.
 */
async function monthToDateRevenue(propertyId: string, meetings: RangeMeeting[], through: string, ratio: NettRatio) {
  const month = through.slice(0, 7);
  const range = await computeRange(propertyId, meetings, `${month}-01`, through);
  const sums = new Map<string, number>();
  for (const o of range.revenue.outlets) {
    if (o.revenue === null) continue;
    const outlet = revenueOutletFor(o.outlet_name);
    sums.set(outlet, (sums.get(outlet) ?? 0) + o.revenue * ratio(o.outlet_name, `${month}-01`, through));
  }
  return {
    month,
    through,
    meetingCount: meetings.filter((m) => m.period_end.startsWith(month) && m.period_end <= through).length,
    source: range.revenue.source,
    missingOutlets: range.revenue.missingOutlets,
    outlets: [...sums].map(([outlet_name, revenue]) => ({ outlet_name, revenue })),
    purchases: groupPurchases(range.purchase.items).map((g) => ({ division: g.main, total: g.total })),
  };
}

type MonthRow = { month: string; outlet_name: string; revenue: unknown };
type DayRow = { sale_date: string; outlet_name: string; revenue: unknown };
type CategoryRow = { outlet_name: string; category: string; sales: unknown; qty: unknown };

const getRevenueMonths = cache(async (propertyId: string): Promise<MonthRow[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["revenue-by-month"],
    tags: [CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase.rpc("revenue_by_month", { p_property: propertyId });
      if (error) throw new Error(error.message);
      return (data ?? []) as MonthRow[];
    },
  }),
);

/** A year of daily rows is a few thousand; the API returns 1000 per request, so read it in pages. */
async function allDays(supabase: AdminSupabaseClient, propertyId: string, year: string): Promise<DayRow[]> {
  const out: DayRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .rpc("revenue_by_day", { p_property: propertyId, p_from: `${year}-01-01`, p_to: `${year}-12-31` })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as DayRow[]));
    if (!data || data.length < 1000) return out;
  }
}

const getRevenueDays = cache(async (propertyId: string, year: string): Promise<DayRow[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["revenue-by-day", year],
    tags: [CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: (supabase) => allDays(supabase, propertyId, year),
  }),
);

const getRevenueCategories = cache(async (propertyId: string, periodStart: string, periodEnd: string): Promise<CategoryRow[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["revenue-by-category", periodStart, periodEnd],
    tags: [CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase.rpc("revenue_by_category", {
        p_property: propertyId,
        p_from: periodStart,
        p_to: periodEnd,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as CategoryRow[];
    },
  }),
);

/**
 * Data for the revenue charts from the database roll-ups (migration 0067): revenue per month since
 * the first upload, per day from 1 January of the selected year, and categories of the selected period.
 * Journal department names (cut to 12 characters) get their F/O name, then the dashboard merge.
 */
async function loadRevenueCharts(propertyId: string, foNames: string[], periodStart: string, periodEnd: string, ratio: NettRatio): Promise<RevenueCharts> {
  const year = periodEnd.slice(0, 4);
  const [months, days, categories] = await Promise.all([
    getRevenueMonths(propertyId),
    getRevenueDays(propertyId, year),
    getRevenueCategories(propertyId, periodStart, periodEnd),
  ]);
  const num = (v: unknown) => Number(v ?? 0);
  const dept = (raw: string) => resolveJournalOutlet(raw, foNames);
  // Nett per VHP department and month (exact where a Turnover of that month is uploaded).
  const monthNett = (raw: string, month: string, v: unknown) => num(v) * ratio(dept(raw), `${month}-01`, `${month}-28`);
  return buildRevenueCharts({
    months: months.map((r) => ({ month: r.month, outlet_name: r.outlet_name, revenue: monthNett(r.outlet_name, r.month, r.revenue) })),
    days: days.map((r) => ({ sale_date: r.sale_date, outlet_name: r.outlet_name, revenue: monthNett(r.outlet_name, r.sale_date.slice(0, 7), r.revenue) })),
    categories: categories.map((r) => ({
      outlet_name: r.outlet_name,
      category: r.category,
      sales: num(r.sales) * ratio(dept(r.outlet_name), periodStart, periodEnd),
      qty: num(r.qty),
    })),
    outletFor: (raw) => revenueOutletFor(dept(raw)),
  });
}

const SHOW_NETT = false;

/** Gross and nett per department from every Turnover upload, with its period (migration 0068). */
const loadNettSources = cache(async (propertyId: string): Promise<NettSource[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["nett-sources"],
    tags: [CACHE_TAGS.vhpMeetings(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("weekly_outlet_metrics")
        .select("outlet_name, revenue_amount, revenue_nett, weekly_meetings!inner(period_start, period_end, property_id)")
        .eq("weekly_meetings.property_id", propertyId)
        .not("revenue_nett", "is", null)
        .limit(5000);
      if (error) throw new Error(error.message);
      type Row = { outlet_name: string; revenue_amount: unknown; revenue_nett: unknown; weekly_meetings: { period_start: string; period_end: string } | { period_start: string; period_end: string }[] };
      return ((data ?? []) as Row[]).map((r) => {
        const m = Array.isArray(r.weekly_meetings) ? r.weekly_meetings[0] : r.weekly_meetings;
        return { outlet_name: r.outlet_name, period_start: m.period_start, period_end: m.period_end, gross: Number(r.revenue_amount), nett: r.revenue_nett === null ? null : Number(r.revenue_nett) };
      });
    },
  }),
);

/** Revenue per (merged) outlet on the same dates last month (samePeriodLastMonth), from the daily roll-up. */
function previousRevenueFrom(charts: RevenueCharts, start: string, end: string) {
  const prev = samePeriodLastMonth(start, end);
  const first = charts.days[0]?.date;
  if (!first || prev.start < first) return null;
  const outlets: Record<string, number> = {};
  for (const d of charts.days) {
    if (d.date < prev.start || d.date > prev.end) continue;
    for (const [o, v] of Object.entries(d.outlets)) outlets[o] = (outlets[o] ?? 0) + v;
  }
  return { ...prev, outlets };
}

const getRawRoomSegments = cache(async (propertyId: string, start: string, end: string) =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["room-segments", start, end],
    tags: [CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase.rpc("room_revenue_by_segment", { p_property: propertyId, p_from: start, p_to: end });
      if (error) throw new Error(error.message);
      return ((data ?? []) as { segment: string; revenue: unknown; room_nights: unknown; lodging: unknown }[]).map((x) => ({
        segment: x.segment,
        revenue: Number(x.revenue),
        roomNights: Number(x.room_nights),
        lodging: Number(x.lodging),
      }));
    },
  }),
);

async function loadRoomSegments(propertyId: string, start: string, end: string, ratio: NettRatio) {
  const rows = await getRawRoomSegments(propertyId, start, end);
  const r = ratio("Front Office", start, end);
  return rows
    .map((x) => ({ segment: x.segment, revenue: x.revenue * r, roomNights: x.roomNights, lodging: x.lodging * r }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** Menus sold in the 12 months up to the last day with sales lines (menuBaseline). */
async function loadMenuActivity(propertyId: string, foNames: string[], periodEnd: string) {
  const rules = await getMenuRules(propertyId);
  const foSig = [...foNames].sort().join("|");
  const rulesSig = `${rules.deadDays}:${rules.slowDays}:${rules.slowBelow}`;
  return withPropertySupabaseCache({
    propertyId,
    keyParts: ["menu-activity", periodEnd, rulesSig, foSig],
    tags: [CACHE_TAGS.vhpSales(propertyId), CACHE_TAGS.settingsMenuRules(propertyId), CACHE_TAGS.vhpDashboard(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data: last, error: lastErr } = await supabase
        .from("weekly_sales_lines")
        .select("sale_date")
        .eq("property_id", propertyId)
        .eq("source", "pos")
        .order("sale_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastErr) throw new Error(lastErr.message);
      const lastDay = (last?.sale_date as string | undefined) ?? periodEnd;
      type Row = { outlet_name: string; art_no: string; description: string; total_qty: unknown; window_qty: unknown; total_sales: unknown; last_sold: string; first_sold: string };
      // The same RPC twice: portions in the dead-menu window (3 months) and in the rarely-sold month.
      const windowRows = async (windowFrom: string) => {
        const out: Row[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .rpc("menu_activity", { p_property: propertyId, p_from: menuBaseline(lastDay), p_window_from: windowFrom, p_to: lastDay })
            .range(from, from + 999);
          if (error) throw new Error(error.message);
          out.push(...((data ?? []) as Row[]));
          if (!data || data.length < 1000) return out;
        }
      };
      type LastRow = { outlet_name: string; art_no: string; last_sold: string; last_qty: unknown };
      const lastSales = async () => {
        const out: LastRow[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.rpc("menu_last_sale", { p_property: propertyId, p_from: windowStart(lastDay, rules.deadDays), p_to: lastDay }).range(from, from + 999);
          if (error) throw new Error(error.message);
          out.push(...((data ?? []) as LastRow[]));
          if (!data || data.length < 1000) return out;
        }
      };
      // Portions on the last day sold are extra: if they cannot be read the list still shows.
      const [rows, monthRows, lastRows] = await Promise.all([windowRows(windowStart(lastDay, rules.deadDays)), windowRows(windowStart(lastDay, rules.slowDays)), lastSales().catch(() => null)]);
      const monthQty = new Map(monthRows.map((r) => [`${r.outlet_name}|${r.art_no}`, Number(r.window_qty)]));
      // Outlets reported together (Room Service, Banquet under d'Bistro) keep one row per menu.
      const merged = new Map<string, MenuActivity>();
      for (const r of rows) {
        const outlet = revenueOutletFor(resolveJournalOutlet(r.outlet_name, foNames));
        const k = `${outlet}|${r.art_no}`;
        const cur = merged.get(k);
        const row: MenuActivity = {
          outlet,
          artNo: r.art_no,
          description: r.description,
          totalQty: Number(r.total_qty),
          windowQty: Number(r.window_qty),
          slowQty: monthQty.get(`${r.outlet_name}|${r.art_no}`) ?? 0,
          totalSales: Number(r.total_sales),
          lastSold: r.last_sold,
          firstSold: r.first_sold,
        };
        merged.set(
          k,
          cur
            ? {
                ...cur,
                totalQty: cur.totalQty + row.totalQty,
                windowQty: cur.windowQty + row.windowQty,
                slowQty: cur.slowQty + row.slowQty,
                totalSales: cur.totalSales + row.totalSales,
                lastSold: cur.lastSold > row.lastSold ? cur.lastSold : row.lastSold,
                firstSold: cur.firstSold < row.firstSold ? cur.firstSold : row.firstSold,
              }
            : row,
        );
      }
      if (lastRows) {
        // Outlets reported together: the latest day wins, the same day adds up.
        const lastMap = new Map<string, { day: string; qty: number }>();
        for (const r of lastRows) {
          const k = `${revenueOutletFor(resolveJournalOutlet(r.outlet_name, foNames))}|${r.art_no}`;
          const cur = lastMap.get(k);
          const qty = Number(r.last_qty);
          if (!cur || r.last_sold > cur.day) lastMap.set(k, { day: r.last_sold, qty });
          else if (r.last_sold === cur.day) cur.qty += qty;
        }
        for (const [k, m] of merged) {
          const l = lastMap.get(k);
          if (l && l.day === m.lastSold) m.lastQty = l.qty;
        }
      }
      return { rows: [...merged.values()], lastDay, rules };
    },
  });
}
