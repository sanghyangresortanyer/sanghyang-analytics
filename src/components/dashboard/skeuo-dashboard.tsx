"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Package,
  PackageMinus,
  ShoppingCart,
  Store,
} from "lucide-react";
import type { FullWeeklyMeetingData } from "@/lib/actions/weekly-meeting";
import type { DashboardDmlOutletPurchase, DashboardOutletUsage, InventoryOverview } from "@/lib/dashboard/dashboard-calc";
import type { HkLedger } from "@/lib/dashboard/hk-ledger";
import { revenueOutletFor, sameOutlet } from "@/lib/dashboard/outlet-match";
import { NO_LOCATION, hkLocationLabel } from "@/lib/dashboard/dashboard-calc";
import { mergeTargets, type OutletTarget, targetProgress } from "@/lib/dashboard/outlet-targets";
import { formatPct, formatRp, formatRpShort } from "@/lib/format-currency";
import { formatDateID } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/ui/data-table";
import { chartPoints, direction, outletDrops } from "@/lib/dashboard/day-series";
import type { RevenueCharts } from "@/lib/dashboard/revenue-trend";
import { HeroChart, MiniBars } from "./hero-chart";
import { OccupancyTable } from "./occupancy-table";
import { OutletMenus, OutletReportButton, SlowMenus } from "./outlet-menus";
import { CategoryBars, DbarSplitBars, PartHead, RevenueTrend, RoomSegmentsTable, RoomTypesTable, rangeText, type MenuActivityData } from "./revenue-charts";
import type { DbarSplitRow } from "@/lib/dashboard/dbar-split";
import { budgetStatus, type DivisionBudget } from "@/lib/dashboard/division-budgets";
import type { Night } from "@/lib/dashboard/occupancy";
import type { RoomTypeRevenue } from "@/lib/dashboard/room-types";
import {
  IconTile,
  PageHeader,
  RingProgress,
  SkeuoCard,
  StatusPill,
} from "@/components/skeuo/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const dayLabel = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const periodLabel = (meeting: FullWeeklyMeetingData["meeting"]) =>
  `Periode ${formatDateID(meeting.period_start)} s.d. ${formatDateID(meeting.period_end)}`;
const qty = (n: number | null) => (n === null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }));

export interface SkeuoDashboardProps {
  data: FullWeeklyMeetingData;
  hkLedger: HkLedger | null;
  hkLocations: DashboardOutletUsage[];
  hkUnpricedEntries: number;
  hkSyncedAt: string | null;
  dmlPurchases: DashboardDmlOutletPurchase[];
  dmlTotalAmount: number;
  dmlSheetsUsed: { sheet_name: string; list_date: string }[];
  revenueMerged: { target: string; sources: string[] }[];
  monthToDate: {
    month: string;
    through: string;
    meetingCount: number;
    source?: "fo" | "journal" | "none";
    missingOutlets?: string[];
    outlets: { outlet_name: string; revenue: number }[];
    purchases?: { division: string; total: number }[];
  } | null;
  inventory: InventoryOverview;
  /** Monthly target per outlet (Pengaturan); the defaults when not given. */
  outletTargets?: OutletTarget[];
  /** Monthly purchase budget per division (Pengaturan). */
  divisionBudgets?: DivisionBudget[];
  /** Room revenue per room type in the period. */
  roomTypes?: RoomTypeRevenue[] | null;
  /** d'Bar Karaoke & DBC split for the period. */
  dbarSplit?: { rows: DbarSplitRow[]; total: number } | null;
  revenueCharts?: RevenueCharts | null;
  previousRevenue?: { start: string; end: string; outlets: Record<string, number> } | null;
  roomSegments?: { segment: string; revenue: number; roomNights: number; lodging: number }[] | null;
  /** Rooms sold per night, with the same dates of the month before. */
  occupancy?: { nights: Night[]; previous: Night[]; range: { start: string; end: string }; previousRange: { start: string; end: string } } | null;
  menuActivity?: MenuActivityData | null;
  /** Server-rendered parts: period line and buttons (with the notification bell), the data banner, the date filter. */
  subtitle: React.ReactNode;
  headerActions: React.ReactNode;
  banner: React.ReactNode;
  filter: React.ReactNode;
  notices: React.ReactNode;
}

const TABS = [
  { id: "overview", label: "Ringkasan" },
  { id: "revenue", label: "Revenue" },
  { id: "purchase", label: "Purchase" },
  { id: "hk", label: "Inventory" },
] as const;

type TabId = (typeof TABS)[number]["id"];
const TITLES: Record<TabId, string> = { overview: "Dashboard", revenue: "Revenue", purchase: "Purchase", hk: "Inventory" };

export function SkeuoDashboard(props: SkeuoDashboardProps) {
  const [tab, setTab] = useState<TabId>("overview");
  const [outlet, setOutlet] = useState("");
  const openOutlet = (name: string) => {
    setOutlet(name);
    setTab("revenue");
    window.scrollTo({ top: 0 });
  };
  const tabButton = (t: (typeof TABS)[number], className: string, on: string, off: string) => (
    <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id} className={cn(className, tab === t.id ? on : off)}>
      {t.label}
    </button>
  );
  return (
    <div className="gap-6 lg:grid lg:grid-cols-[11.5rem_minmax(0,1fr)]">
      <aside className="hidden print:hidden lg:block">
        <div className="sticky top-6">
          <nav aria-label="Bagian dashboard" className="flex flex-col gap-1">
            {TABS.map((t) => tabButton(t, "min-h-11 rounded-2xl px-4 text-left text-base font-semibold", "skeuo-pill-light", "text-navy-700 hover:bg-white/50"))}
          </nav>
        </div>
      </aside>
      <div className="min-w-0 space-y-4">
        {/* The title says which part is open (owner, 24 Nov: Revenue, not Dashboard). */}
        <PageHeader title={TITLES[tab]} subtitle={props.subtitle} actions={props.headerActions} />
        {tab !== "overview" && props.banner}
        {props.filter}
        {props.notices}
        {tab === "overview" && <OverviewTab {...props} onOutlet={openOutlet} />}
        {tab === "revenue" && <RevenueTab {...props} initialOutlet={outlet} />}
        {tab === "purchase" && <PurchaseTab {...props} />}
        {tab === "hk" && <InventoryTab {...props} />}
      </div>

      <nav
        aria-label="Bagian dashboard"
        className="skeuo-pill-dark fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-full p-1.5 print:hidden sm:gap-1 lg:hidden"
      >
        {TABS.map((t) => tabButton(t, "min-h-11 shrink-0 rounded-full px-2.5 text-[13px] font-semibold sm:px-4 sm:text-sm", "skeuo-pill-light", "text-navy-100 hover:bg-white/10"))}
      </nav>
    </div>
  );
}

/* ----------------------------- Ringkasan ----------------------------- */

/** One of the four figures beside revenue. */
function Figure({ icon, label, value }: { icon: typeof Store; label: string; value: string }) {
  return (
    <SkeuoCard>
      <div className="flex items-center gap-2.5">
        <IconTile icon={icon} />
        <p className="text-base leading-tight text-navy-700">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-navy-900">{value}</p>
    </SkeuoCard>
  );
}

/** "naik 7,7%" on dark green, "turun 18,6%" on red. */
function ChangeChip({ pct, solid }: { pct: number | null; solid?: boolean }) {
  const d = direction(pct);
  if (pct === null) return solid ? <span className="whitespace-nowrap rounded-full bg-cream-200 px-3 py-0.5 text-sm font-semibold text-navy-600">tanpa pembanding</span> : <span className="text-sm text-navy-600">—</span>;
  const tone = d === "naik" ? (solid ? "bg-naik text-white" : "bg-emerald-50 text-naik") : d === "turun" ? (solid ? "bg-turun text-white" : "bg-red-50 text-turun") : "bg-cream-200 text-navy-700";
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-0.5 text-sm font-semibold tabular-nums", tone)}>
      {d === "naik" ? "▲ " : d === "turun" ? "▼ " : ""}
      {/* "naik 2.070%" says little; "jadi 21,7 kali" does. */}
      {pct >= 500 ? `jadi ${(1 + pct / 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })} kali` : d === "sama" ? d : `${d} ${formatPct(Math.abs(pct))}`}
    </span>
  );
}

const changeOf = (now: number, before: number | undefined) => (before !== undefined && before > 0 ? ((now - before) / before) * 100 : null);

function OverviewTab({ data, dmlSheetsUsed, dmlTotalAmount, monthToDate, inventory, previousRevenue, outletTargets, revenueCharts, onOutlet }: SkeuoDashboardProps & { onOutlet: (name: string) => void }) {
  const { meeting, range } = data;
  const { period_start: from, period_end: to } = meeting;
  const dmlValue = dmlSheetsUsed.length ? dmlTotalAmount : null;
  const revenue = range?.revenueSource === "none" ? null : meeting.total_revenue;
  const before = previousRevenue ? Object.values(previousRevenue.outlets).reduce((s, v) => s + v, 0) : undefined;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const names = useMemo(() => [...data.outlets].sort((a, b) => b.revenue_amount - a.revenue_amount).map((o) => o.outlet_name), [data.outlets]);
  const best = useMemo(() => {
    const known = revenueCharts ? chartPoints(revenueCharts, from, to, null).points.filter((p) => p.value !== null) : [];
    return known.length ? known.reduce((a, b) => (b.value! > a.value! ? b : a)) : null;
  }, [revenueCharts, from, to]);
  const drops = outletDrops(data.outlets.filter((o) => o.revenue_available !== false).map((o) => ({ name: o.outlet_name, revenue: o.revenue_amount })), previousRevenue?.outlets);
  const versus = previousRevenue ? rangeText(previousRevenue.start, previousRevenue.end) : null;
  return (
    <div className="space-y-4">
      <SkeuoCard className="p-5">
        <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-navy-900">Total revenue</h2>
            <p className="text-sm text-navy-600">{rangeText(from, to)}</p>
            <p className="mt-2 whitespace-nowrap text-5xl font-light tabular-nums tracking-tight text-navy-900">{revenue === null ? "—" : formatRpShort(revenue)}</p>
            <p className="mt-1 text-sm tabular-nums text-navy-600">{revenue === null ? "Belum ada data" : formatRp(revenue)}</p>
            {revenue !== null && (
              <div className="mt-3">
                <ChangeChip pct={changeOf(revenue, before)} solid />
                {versus && before !== undefined && (
                  <p className="mt-1.5 text-sm text-navy-600">
                    dari {formatRpShort(before)}
                    <br />
                    {versus}
                  </p>
                )}
              </div>
            )}
            <dl className="mt-4 text-sm">
              <div className="flex justify-between gap-3 border-t border-cream-300 py-2">
                <dt className="text-navy-600">Rata-rata per hari</dt>
                <dd className="font-semibold tabular-nums text-navy-900">{revenue === null ? "—" : formatRpShort(revenue / days)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-cream-300 py-2">
                <dt className="text-navy-600">Tertinggi</dt>
                <dd className="text-right font-semibold tabular-nums text-navy-900">
                  {best ? best.label : "—"}
                  {best && <span className="block font-normal text-navy-700">{formatRp(best.value!)}</span>}
                </dd>
              </div>
            </dl>
          </div>
          {revenueCharts ? <HeroChart charts={revenueCharts} start={from} end={to} outlets={names} /> : <p className="py-10 text-center text-base text-navy-600">Grafik belum bisa dibaca.</p>}
        </div>
        {versus && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-cream-300 pt-4">
            <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", drops.length ? "bg-turun" : "bg-naik")} />
            <p className="min-w-0 flex-1 basis-52 text-base text-navy-800">
              {drops.length === 0 ? (
                <span className="font-semibold text-navy-900">Semua outlet naik dibanding {versus}.</span>
              ) : (
                <>
                  <span className="font-semibold text-navy-900">
                    {drops.length === 1 ? "1 outlet" : `${drops.length} outlet`} turun dibanding {versus}:
                  </span>{" "}
                  {drops.map((d, i) => (
                    <span key={d.name}>
                      {i > 0 && ", "}
                      <span className="font-semibold text-turun">{d.name} {formatPct(Math.abs(d.pct))}</span> ({formatRpShort(d.from)} → {formatRpShort(d.to)})
                    </span>
                  ))}
                  . Outlet lain naik.
                </>
              )}
            </p>
            {drops[0] && (
              <button type="button" onClick={() => onOutlet(drops[0].name)} className="skeuo-pill-dark min-h-11 rounded-full px-5 text-sm font-semibold hover:brightness-125 max-sm:w-full">
                Lihat {drops[0].name}
              </button>
            )}
          </div>
        )}
      </SkeuoCard>

      <div>
        <SkeuoCard className="p-5">
          <h2 className="text-lg font-semibold text-navy-900">Revenue per outlet</h2>
          <p className="text-sm text-navy-600">
            {rangeText(from, to)}
            {versus && `, dibanding ${versus}`}
          </p>
          <ul className="mt-2">
            {names.map((name) => {
              const o = data.outlets.find((x) => x.outlet_name === name)!;
              const known = o.revenue_available !== false;
              return (
                <li key={name} className="border-t border-cream-300">
                  <button type="button" onClick={() => onOutlet(name)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 text-left hover:bg-white/60 sm:grid-cols-[minmax(0,1fr)_9rem_6.5rem_8.5rem] lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7rem_9rem] lg:gap-x-6">
                    <span className="truncate text-base font-semibold text-navy-900">{name}</span>
                    <span className="hidden sm:block">{revenueCharts && known && <MiniBars charts={revenueCharts} start={from} end={to} outlet={name} />}</span>
                    <span className="text-right text-base tabular-nums text-navy-900">{known ? formatRpShort(o.revenue_amount) : "Belum ada data"}</span>
                    <span className="max-sm:col-span-2 sm:text-right">{known && <ChangeChip pct={previousRevenue ? changeOf(o.revenue_amount, previousRevenue.outlets[name] ?? 0) : null} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SkeuoCard>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure icon={FileSpreadsheet} label="Permintaan belanja" value={dmlValue === null ? "—" : formatRp(dmlValue)} />
        <Figure icon={ShoppingCart} label="Purchase" value={formatRp(meeting.total_purchase)} />
        <Figure icon={Package} label="Stok inventory" value={inventory.stockTotal === null ? "—" : formatRp(inventory.stockTotal)} />
        <Figure icon={PackageMinus} label="Pemakaian inventory" value={inventory.usageTotal === null ? "—" : formatRp(inventory.usageTotal)} />
      </div>

      <OutletTargets monthToDate={monthToDate} targets={outletTargets ?? mergeTargets([])} />
    </div>
  );
}

/** Progress to the monthly target per outlet for the current month. */
function OutletTargets({ monthToDate, targets }: { monthToDate: SkeuoDashboardProps["monthToDate"]; targets: OutletTarget[] }) {
  const month = monthToDate ? monthLabel(monthToDate.month) : "";
  return (
    <SkeuoCard className="p-5">
      <h2 className="text-lg font-semibold text-navy-900">Target bulanan {month}</h2>
      {monthToDate && <p className="text-sm text-navy-600">Revenue {month} s.d. {formatDateID(monthToDate.through)}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {targets.filter((t) => t.monthlyTarget > 0).map((t) => {
          const missing = monthToDate?.missingOutlets?.some((m) => sameOutlet(revenueOutletFor(m), t.outlet)) ?? false;
          const mtd = monthToDate && !missing ? (monthToDate.outlets.find((o) => sameOutlet(o.outlet_name, t.outlet))?.revenue ?? 0) : null;
          const p = targetProgress(mtd, t.monthlyTarget);
          return (
            <div key={t.outlet} className="skeuo-inset flex flex-col items-center rounded-2xl p-4 text-center">
              {p ? (
                <RingProgress pct={p.achievedPct} caption="tercapai" label={`Target ${t.outlet}`} />
              ) : (
                <div className="flex h-[104px] w-[104px] items-center justify-center rounded-full border border-cream-400 text-2xl text-navy-500">—</div>
              )}
              <p className="mt-2 text-lg font-semibold text-navy-900">{t.outlet}</p>
              <p className="mt-1 text-sm tabular-nums text-navy-700">
                {mtd === null ? "Belum tersedia" : `${formatRpShort(mtd)} dari ${formatRpShort(t.monthlyTarget)}`}
              </p>
              {p && (
                <p className={cn("mt-1 text-sm font-semibold", p.reached ? "text-naik" : "text-navy-700")}>
                  {p.reached ? "Target tercapai" : `Tinggal ${formatPct(p.remainingPct)}`}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </SkeuoCard>
  );
}

/* ------------------------------ Revenue ------------------------------ */

type MenuRow = NonNullable<FullWeeklyMeetingData["outletItems"]>[number];

// Outlets reported together (Room Service and Banquet under d'Bistro) can sell the same menu
// (7001 ICE CUBE): one row per menu, summed, so every row has its own key.
function itemsOf(items: MenuRow[], outlet: string): MenuRow[] {
  const byMenu = new Map<string, MenuRow>();
  for (const it of items) {
    if (revenueOutletFor(it.outlet_name) !== outlet) continue;
    const k = `${it.art_no}|${it.description}`;
    const cur = byMenu.get(k);
    byMenu.set(k, cur ? { ...cur, total_qty: cur.total_qty + it.total_qty, total_amount: cur.total_amount + it.total_amount } : it);
  }
  return [...byMenu.values()];
}

/** Every menu (or VHP article, for outlets without Penjualan per Artikel) of one outlet in the period. */
function ItemsTable({ rows, fromJournal, outlet }: { rows: MenuRow[]; fromJournal: boolean; outlet: string }) {
  // Share of the outlet's sales (gross, before discounts), so the shares add up to 100%.
  const total = rows.reduce((s, it) => s + it.total_amount, 0);
  return (
    <DataTable
      key={outlet}
      className="mt-3"
      rows={rows}
      rowKey={(it) => `${it.art_no}-${it.description}`}
      rank
      empty="Belum ada data."
      initialSort={{ key: fromJournal ? "qty" : "value", dir: "desc" }}
      columns={[
        { key: "name", header: fromJournal ? "Menu" : "Artikel", sort: (it) => it.description, render: (it) => <span className="font-semibold text-navy-900">{it.description}</span> },
        ...(fromJournal ? [{ key: "qty", header: "Terjual", align: "right" as const, sort: (it: MenuRow) => it.total_qty, render: (it: MenuRow) => qty(it.total_qty) }] : []),
        { key: "value", header: "Nilai", align: "right", sort: (it) => it.total_amount, render: (it) => <span className="font-semibold text-emerald-900">{formatRp(it.total_amount)}</span> },
        { key: "share", header: "% dari total", align: "right", sort: (it) => it.total_amount, render: (it) => (total > 0 ? formatPct((it.total_amount / total) * 100) : "—") },
      ]}
    />
  );
}

type OutletPart = "ringkasan" | "kamar" | "menu" | "tidak-laku";

/**
 * Everything below the trend, one outlet at a time (owner, 2026-11-21): one card with an outlet
 * picker and parts (summary, rooms for Front Office, menus, menus that do not sell). Every part
 * says which dates it covers.
 */
function OutletDetail({ data, revenueCharts, roomSegments, roomTypes, occupancy, dbarSplit, menuActivity, previousRevenue, monthToDate, outletTargets, initialOutlet }: SkeuoDashboardProps & { initialOutlet: string }) {
  const names = useMemo(() => data.outlets.map((o) => o.outlet_name), [data.outlets]);
  const [picked, setPicked] = useState(initialOutlet);
  const [part, setPart] = useState<OutletPart>("ringkasan");
  const outlet = names.includes(picked) ? picked : (names[0] ?? "");
  const row = data.outlets.find((o) => o.outlet_name === outlet);
  const rows = useMemo(() => itemsOf(data.outletItems ?? [], outlet), [data.outletItems, outlet]);
  const isFO = sameOutlet(outlet, "Front Office");
  const isDbar = sameOutlet(outlet, "d'Bar Karaoke & DBC");
  const hasMenus = rows.some((r) => r.source === "journal");
  const hasInactive = !!menuActivity && menuActivity.least.some((r) => r.outlet === outlet);
  const parts: [OutletPart, string][] = [
    ["ringkasan", "Ringkasan"],
    ...(isFO ? [["kamar", "Kamar"] as [OutletPart, string]] : []),
    ...(!isFO || hasMenus ? [["menu", "Menu terjual"] as [OutletPart, string]] : []),
    ...(menuActivity && (!isFO || hasInactive) ? [["tidak-laku", "Menu paling tidak laku"] as [OutletPart, string]] : []),
  ];
  const shown = parts.some(([id]) => id === part) ? part : "ringkasan";
  const { period_start: from, period_end: to } = data.meeting;
  const range = rangeText(from, to);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const articles = rows.filter((r) => r.source !== "journal");
  const report = useMemo(() => {
    const known = row && row.revenue_available !== false;
    const days = revenueCharts ? chartPoints(revenueCharts, from, to, outlet).points.filter((p) => p.value !== null) : [];
    const best = days.length ? days.reduce((a, b) => (b.value! > a.value! ? b : a)) : null;
    const target = (outletTargets ?? mergeTargets([])).find((t) => sameOutlet(t.outlet, outlet) && t.monthlyTarget > 0);
    const mtd = monthToDate?.outlets.find((o) => sameOutlet(o.outlet_name, outlet))?.revenue;
    return {
      outlet,
      from,
      to,
      revenue: known ? row.revenue_amount : null,
      share: known ? row.revenue_share_pct : null,
      previous: previousRevenue ? { from: previousRevenue.start, to: previousRevenue.end, revenue: previousRevenue.outlets[outlet] ?? 0 } : null,
      bestDay: best ? { label: best.label, value: best.value! } : null,
      target: target && monthToDate && mtd !== undefined ? { month: monthLabel(monthToDate.month), achieved: mtd, target: target.monthlyTarget } : null,
      menus: rows,
      slow: menuActivity ? { activity: menuActivity } : null,
    };
  }, [row, revenueCharts, from, to, outlet, outletTargets, monthToDate, previousRevenue, rows, menuActivity]);
  return (
    <SkeuoCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-navy-900">Detail per outlet</h2>
          <p className="text-base text-navy-600">Pilih outlet, lalu pilih bagian yang ingin dilihat.</p>
        </div>
        {outlet && <OutletReportButton data={report} />}
      </div>
      <div className="skeuo-inset mt-3 flex flex-wrap gap-1 p-1">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPicked(n)}
            aria-pressed={n === outlet}
            className={cn("rounded-full px-4 py-2 text-base font-semibold", n === outlet ? "skeuo-pill-dark" : "text-navy-500 hover:text-navy-800")}
          >
            {n}
          </button>
        ))}
      </div>
      <div role="tablist" aria-label={`Bagian ${outlet}`} className="mt-4 flex flex-wrap gap-2 border-b border-cream-200 pb-3">
        {parts.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={shown === id}
            onClick={() => setPart(id)}
            className={cn("rounded-full px-4 py-2 text-base font-semibold", shown === id ? "skeuo-pill-dark" : "skeuo-pill-light text-navy-700")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {shown === "ringkasan" && (
          <div className="space-y-8">
            <div>
              <PartHead title={`Revenue ${outlet}`} range={range} />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-xl">
                <div className="skeuo-inset rounded-xl px-3 py-2">
                  <p className="text-xl font-bold tabular-nums text-navy-900">{row && row.revenue_available !== false ? formatRp(row.revenue_amount) : "Belum ada data"}</p>
                  <p className="text-sm text-navy-600">Revenue</p>
                </div>
                <div className="skeuo-inset rounded-xl px-3 py-2">
                  <p className="text-xl font-bold tabular-nums text-navy-900">{row && row.revenue_available !== false ? formatPct(row.revenue_share_pct) : "—"}</p>
                  <p className="text-sm text-navy-600">Bagian dari total hotel</p>
                </div>
              </div>
            </div>
            {isDbar && dbarSplit && (
              <div>
                <PartHead title="d'Bar & Karaoke dan DBC" range={range} note={'Di VHP satu outlet; dipisah dari nama menu (menu DBC bernama "DBC ..."). Target bulanan tetap gabungan.'} />
                <DbarSplitBars split={dbarSplit} />
              </div>
            )}
            {revenueCharts && (
              <div>
                <PartHead title="Revenue per kategori" range={range} note="Penjualan sebelum diskon dan compliment; keduanya ditampilkan terpisah." />
                <CategoryBars charts={revenueCharts} outlet={outlet} />
              </div>
            )}
            {!hasMenus && articles.length > 0 && (
              <div>
                <PartHead title="Rincian artikel" range={range} note="Dari laporan revenue VHP." />
                <ItemsTable rows={articles} fromJournal={false} outlet={outlet} />
              </div>
            )}
          </div>
        )}
        {shown === "kamar" && (
          <div className="space-y-8">
            <div>
              <PartHead
                title="OCC per malam"
                range={occupancy ? `${range}, pembanding ${rangeText(occupancy.previousRange.start, occupancy.previousRange.end)}` : range}
                note="Semua tamu digabung, termasuk perusahaan dan rombongan, sama seperti laporan di grup WA. OCC = kamar terjual dibagi 61 kamar. ARR = harga kamar + sarapan dan minuman paket, dibagi kamar terjual."
              />
              {occupancy ? <OccupancyTable {...occupancy} /> : <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>}
            </div>
            <div>
              <PartHead title="Revenue kamar per segmen" range={range} note="Semua tamu. Dari F/O Journal VHP; satu malam kamar = satu posting harga kamar." />
              {roomSegments ? <RoomSegmentsTable rows={roomSegments} /> : <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>}
            </div>
            <div>
              <PartHead title="Revenue kamar per jenis kamar" range={range} note="Dari F/O Journal VHP; jenis kamar diatur di Pengaturan." />
              {roomTypes ? <RoomTypesTable rows={roomTypes} /> : <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>}
            </div>
          </div>
        )}
        {shown === "menu" && (
          <OutletMenus rows={rows} range={range} days={days} />
        )}
        {shown === "tidak-laku" && menuActivity && <SlowMenus activity={menuActivity} outlet={outlet} />}
      </div>
    </SkeuoCard>
  );
}

function RevenueTab(props: SkeuoDashboardProps & { initialOutlet: string }) {
  const { data, revenueCharts } = props;
  const outlets = data.outlets.map((o) => o.outlet_name);
  return (
    <div className="space-y-4">
      {/* Opened from an outlet on Ringkasan: its detail first. */}
      {props.initialOutlet && <OutletDetail {...props} />}
      {revenueCharts && <RevenueTrend charts={revenueCharts} outlets={outlets} />}
      {!props.initialOutlet && <OutletDetail {...props} />}
    </div>
  );
}


/* ----------------------------- Pembelian ----------------------------- */

/** Same layout as the menu list on Revenue: group pills, three figures, every item ranked by value. */
function PurchaseItemsFeed({ data }: { data: FullWeeklyMeetingData }) {
  const groups = useMemo(() => data.purchaseGroups ?? [], [data.purchaseGroups]);
  const [picked, setPicked] = useState("Semua");
  const names = ["Semua", ...groups.map((g) => g.main)];
  const selected = names.includes(picked) ? picked : "Semua";
  const rows = useMemo(
    () =>
      groups
        .filter((g) => selected === "Semua" || g.main === selected)
        .flatMap((g) => g.subs.flatMap((sub) => sub.items.map((it) => ({ ...it, sub: sub.name })))),
    [groups, selected],
  );
  const total = rows.reduce((s, r) => s + r.total_amount, 0);
  const days = Math.round((Date.parse(data.meeting.period_end) - Date.parse(data.meeting.period_start)) / 86_400_000) + 1;
  return (
    <>
      <div className="skeuo-inset flex flex-wrap gap-1 p-1">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPicked(n)}
            aria-pressed={n === selected}
            className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", n === selected ? "skeuo-pill-dark" : "text-navy-500 hover:text-navy-800")}
          >
            {n}
          </button>
        ))}
      </div>
      {rows.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Jenis barang", value: qty(rows.length) },
            { label: "Nilai pembelian", value: formatRp(total) },
            { label: `Rata-rata / hari (${days} hari)`, value: formatRp(Math.round(total / days)) },
          ].map((s) => (
            <div key={s.label} className="skeuo-inset rounded-xl px-2 py-2">
              <p className="text-lg font-bold tabular-nums text-navy-900">{s.value}</p>
              <p className="text-xs text-navy-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}
      <DataTable
        key={selected}
        className="mt-3"
        rows={rows}
        rowKey={(it) => `${it.ingredient_code}|${it.description}`}
        rank
        empty="Tidak ada pembelian pada periode ini."
        initialSort={{ key: "value", dir: "desc" }}
        columns={[
          { key: "name", header: "Barang", sort: (it) => it.description, render: (it) => <span className="font-semibold text-navy-900">{it.description}</span> },
          { key: "sub", header: "Kelompok", sort: (it) => it.sub, render: (it) => <span className="text-navy-600">{it.sub}</span> },
          { key: "qty", header: "Jumlah", align: "right", sort: (it) => it.total_qty, render: (it) => `${qty(it.total_qty)} ${it.unit}` },
          { key: "value", header: "Nilai", align: "right", sort: (it) => it.total_amount, render: (it) => <span className="font-semibold text-red-900">{formatRp(it.total_amount)}</span> },
          { key: "share", header: "% dari total", align: "right", sort: (it) => it.total_amount, render: (it) => (total > 0 ? formatPct((it.total_amount / total) * 100) : "—") },
        ]}
      />
    </>
  );
}

const PURCHASE_VIEWS = [
  { id: "items", label: "Barang dibeli" },
  { id: "dml", label: "Permintaan DML" },
  { id: "suppliers", label: "Supplier" },
] as const;

/** One card, like Revenue: what was bought, what outlets asked for (DML) and from whom, one table at a time. */
/** Purchases from the 1st of the month against the monthly budget per division (Pengaturan). */
function DivisionBudgetCard({ budgets, monthToDate }: { budgets: DivisionBudget[]; monthToDate: SkeuoDashboardProps["monthToDate"] }) {
  const set = budgets.filter((b) => b.monthlyBudget > 0);
  const month = monthToDate ? monthLabel(monthToDate.month) : "";
  return (
    <SkeuoCard>
      <h2 className="text-lg font-semibold text-navy-900">Budget belanja {month}</h2>
      <p className="text-sm text-navy-600">
        {monthToDate ? `Pembelian VHP 1–${Number(monthToDate.through.slice(8))} ${month} dibanding budget per bulan` : "Belum ada data bulan ini"} · budget diatur di Pengaturan
      </p>
      {set.length === 0 ? (
        <p className="mt-3 text-base text-navy-600">Belum ada budget. Isi di Pengaturan → Budget Belanja per Divisi.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {set.map((b) => {
            const spent = monthToDate?.purchases?.find((p) => p.division === b.division)?.total ?? null;
            const st = spent === null ? null : budgetStatus(spent, b.monthlyBudget);
            return (
              <div key={b.division} className="skeuo-inset rounded-2xl p-4">
                <p className="text-base font-semibold text-navy-900">{b.division}</p>
                <p className="mt-1 text-sm tabular-nums text-navy-700">
                  {spent === null ? "Belum ada data pembelian" : `${formatRpShort(spent)} dari ${formatRpShort(b.monthlyBudget)}`}
                </p>
                {st && (
                  <>
                    <div className="mt-2 h-2.5 rounded-full bg-cream-200">
                      <div className={cn("h-2.5 rounded-full", st.over ? "bg-red-700" : "bg-emerald-700")} style={{ width: `${Math.min(100, st.usedPct)}%` }} />
                    </div>
                    <p className={cn("mt-1 text-sm font-semibold", st.over ? "text-red-700" : "text-emerald-800")}>
                      {st.over ? `Lewat budget ${formatRpShort(-st.left)}` : `Sisa ${formatRpShort(st.left)} (${formatPct(100 - st.usedPct)})`}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SkeuoCard>
  );
}

function PurchaseTab(props: SkeuoDashboardProps) {
  return (
    <div className="space-y-4">
      <DivisionBudgetCard budgets={props.divisionBudgets ?? []} monthToDate={props.monthToDate} />
      <PurchaseMain {...props} />
    </div>
  );
}

function PurchaseMain({ data, dmlPurchases }: SkeuoDashboardProps) {
  const { meeting, outlets, suppliers } = data;
  const [view, setView] = useState<(typeof PURCHASE_VIEWS)[number]["id"]>("items");
  return (
    <SkeuoCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy-900">Purchase</h2>
          <p className="text-sm text-navy-600">{periodLabel(meeting)}</p>
        </div>
        <div className="skeuo-inset inline-flex gap-1 p-1">
          {PURCHASE_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", view === v.id ? "skeuo-pill-dark" : "text-navy-500 hover:text-navy-800")}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        {view === "items" && <PurchaseItemsFeed data={data} />}
        {view === "dml" && (
          <>
            <p className="mb-2 text-sm text-navy-600">Total permintaan di sheet DML dalam periode ini, dibandingkan dengan revenue outlet.</p>
            <DataTable
              rows={dmlPurchases.map((p) => ({ ...p, revenue: outlets.find((o) => sameOutlet(o.outlet_name, p.outlet))?.revenue_amount ?? null }))}
              rowKey={(p) => p.outlet}
              empty="Tidak ada sheet DML bertanggal di dalam periode ini."
              initialSort={{ key: "value", dir: "desc" }}
              columns={[
                { key: "outlet", header: "Outlet", sort: (p) => p.outlet, render: (p) => <span className="font-semibold text-navy-900">{p.outlet}</span> },
                { key: "lines", header: "Jumlah barang", align: "right", sort: (p) => p.lineCount, render: (p) => p.lineCount },
                { key: "value", header: "Permintaan", align: "right", sort: (p) => p.totalAmount, render: (p) => <span className="font-semibold text-red-900">{formatRp(p.totalAmount)}</span> },
                { key: "revenue", header: "Revenue", align: "right", sort: (p) => p.revenue, render: (p) => (p.revenue === null ? <span className="text-navy-300">tidak ada revenue</span> : formatRp(p.revenue)) },
                { key: "ratio", header: "% dari revenue", align: "right", sort: (p) => (p.revenue ? p.totalAmount / p.revenue : null), render: (p) => (p.revenue ? formatPct((p.totalAmount / p.revenue) * 100) : "—") },
              ]}
            />
          </>
        )}
        {view === "suppliers" && (
          <DataTable
            rows={suppliers}
            rowKey={(sp) => sp.supplier_name}
            rank
            empty="Tidak ada pembelian pada periode ini."
            initialSort={{ key: "value", dir: "desc" }}
            columns={[
              { key: "name", header: "Supplier", sort: (sp) => sp.supplier_name, render: (sp) => <span className="font-semibold text-navy-900">{sp.supplier_name}</span> },
              { key: "lines", header: "Penerimaan", align: "right", sort: (sp) => sp.line_count, render: (sp) => sp.line_count },
              { key: "value", header: "Nilai", align: "right", sort: (sp) => sp.purchase_amount, render: (sp) => <span className="font-semibold text-red-900">{formatRp(sp.purchase_amount)}</span> },
              {
                key: "share",
                header: "%",
                align: "right",
                sort: (sp) => sp.purchase_amount,
                render: (sp) => (meeting.total_purchase > 0 ? formatPct((sp.purchase_amount / meeting.total_purchase) * 100) : "—"),
              },
            ]}
          />
        )}
      </div>
    </SkeuoCard>
  );
}

/* ------------------------------ Inventory ----------------------------- */

const PILL_ON = "skeuo-pill-dark";
const PILL_OFF = "text-navy-500 hover:text-navy-800";

/** Small figure tile, as in the menu and purchase lists. */
function Stat({ label, value, tone = "text-navy-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="skeuo-inset rounded-xl px-3 py-2 text-center">
      <p className={cn("text-lg font-bold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-navy-500">{label}</p>
    </div>
  );
}

/**
 * One card for every inventory department: pick Semua or a department; a connected department shows
 * stock in → out → stock and one table at a time (per date, per location, per item).
 */
function InventoryTab(props: SkeuoDashboardProps) {
  const { inventory, data } = props;
  const [dept, setDept] = useState("semua");
  const picked = inventory.departments.find((d) => d.key === dept);
  return (
    <SkeuoCard>
      <h2 className="text-lg font-semibold text-navy-900">Inventory</h2>
      <p className="text-sm text-navy-600">{periodLabel(data.meeting)}</p>
      <div className="skeuo-inset mt-3 flex flex-wrap gap-1 p-1">
        {[{ key: "semua", name: "Semua", connected: true }, ...inventory.departments].map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDept(d.key)}
            aria-pressed={dept === d.key}
            className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", dept === d.key ? PILL_ON : d.connected ? PILL_OFF : "text-navy-300 hover:text-navy-500")}
          >
            {d.name.replace(/^Inventory /, "")}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {dept === "semua" ? (
          <DepartmentList inventory={inventory} periodEnd={data.meeting.period_end} />
        ) : picked && !picked.connected ? (
          <p className="py-8 text-center text-base text-navy-500">
            Spreadsheet {picked.name.replace(/^Inventory /, "")} belum tersambung. Kirim link sheet-nya untuk disambungkan.
          </p>
        ) : dept === "hk" ? (
          <HkView {...props} />
        ) : (
          <p className="py-8 text-center text-base text-navy-500">Belum ada rincian untuk departemen ini.</p>
        )}
      </div>
    </SkeuoCard>
  );
}

function DepartmentList({ inventory, periodEnd }: { inventory: SkeuoDashboardProps["inventory"]; periodEnd: string }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={`Stok semua departemen s.d. ${formatDateID(periodEnd)}`} value={inventory.stockTotal === null ? "—" : formatRp(inventory.stockTotal)} tone="text-navy-900" />
        <Stat label="Pemakaian semua departemen" value={inventory.usageTotal === null ? "—" : formatRp(inventory.usageTotal)} tone="text-ember-700" />
      </div>
      <DataTable
        className="mt-3"
        rows={inventory.departments}
        rowKey={(d) => d.key}
        columns={[
          { key: "name", header: "Departemen", sort: (d) => d.name, render: (d) => <span className="font-semibold text-navy-900">{d.name.replace(/^Inventory /, "")}</span> },
          { key: "stock", header: "Stok akhir", align: "right", sort: (d) => (d.connected ? d.stock : null), render: (d) => (d.connected && d.stock !== null ? formatRp(d.stock) : <span className="text-navy-400">—</span>) },
          {
            key: "usage",
            header: "Pemakaian",
            align: "right",
            sort: (d) => (d.connected ? d.usage : null),
            render: (d) => (d.connected && d.usage !== null ? <span className="text-ember-700">{formatRp(d.usage)}</span> : <span className="text-navy-400">—</span>),
          },
          { key: "source", header: "Sumber", render: (d) => (d.connected ? d.source : <StatusPill>belum tersambung</StatusPill>) },
        ]}
      />
    </>
  );
}

/** One day of HK movements as a table row; a click opens the items moved that day below it. */
function MutationDayRow({ day }: { day: HkLedger["days"][number] }) {
  const [open, setOpen] = useState(false);
  const count = day.movements.length;
  return (
    <>
      <tr onClick={() => count && setOpen(!open)} className={count ? "cursor-pointer" : undefined} aria-expanded={count ? open : undefined}>
        <td className="font-semibold text-navy-900">
          <span className="inline-flex items-center gap-1.5">
            {count > 0 ? open ? <ChevronDown className="h-4 w-4 text-navy-400" /> : <ChevronRight className="h-4 w-4 text-navy-400" /> : <span className="w-4" />}
            {dayLabel(day.date)}
          </span>
        </td>
        <td className="text-right tabular-nums text-navy-600">{count || "—"}</td>
        <td className="text-right tabular-nums text-emerald-800">{day.inValue ? formatRp(day.inValue) : "—"}</td>
        <td className="text-right tabular-nums text-ember-600">{day.outValue ? formatRp(day.outValue) : "—"}</td>
        <td className="text-right font-semibold tabular-nums text-navy-900">{formatRp(day.closingValue)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-white/60">
            <div className="divide-y divide-cream-200">
              {day.movements.map((m, i) => (
                <div key={`${m.itemCode}-${i}`} className="grid grid-cols-[1fr_auto_auto] gap-3 py-1.5 pl-6 text-sm">
                  <span className="text-navy-800">
                    {m.itemName}{" "}
                    {m.qtyOut ? (
                      m.location?.trim() ? (
                        <span className="text-navy-500">→ {hkLocationLabel(m.location).label}</span>
                      ) : (
                        <span className="text-ember-600">→ {NO_LOCATION.toLowerCase()}</span>
                      )
                    ) : null}
                  </span>
                  <span className="tabular-nums text-emerald-800">{m.qtyIn ? `+${qty(m.qtyIn)}` : ""}</span>
                  <span className="tabular-nums text-ember-600">{m.qtyOut ? `−${qty(m.qtyOut)} ${m.unit ?? ""}` : ""}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const HK_VIEWS = [
  { id: "date", label: "Per tanggal" },
  { id: "location", label: "Per lokasi" },
  { id: "item", label: "Per barang" },
] as const;

function HkView({ hkLedger, hkLocations, hkUnpricedEntries }: SkeuoDashboardProps) {
  const [view, setView] = useState<(typeof HK_VIEWS)[number]["id"]>("date");
  if (!hkLedger) {
    return (
      <p className="py-8 text-center text-base text-navy-500">
        Data HK belum ada. Tarik dulu dari halaman <Link className="font-semibold text-navy-800 underline" href="/data-sheets">Data Google Sheets</Link>.
      </p>
    );
  }
  const moved = hkLedger.items.filter((i) => i.qtyIn !== 0 || i.qtyOut !== 0).length;
  const unrecorded = hkLocations.find((l) => l.location === NO_LOCATION);
  const unrecordedPct = unrecorded && hkLedger.outValue > 0 ? (unrecorded.totalCost / hkLedger.outValue) * 100 : 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Stok awal" value={hkLedger.openingValue != null ? formatRp(hkLedger.openingValue) : "—"} />
        <Stat label="Masuk" value={formatRp(hkLedger.inValue)} tone="text-emerald-800" />
        <Stat label="Keluar (pemakaian)" value={formatRp(hkLedger.outValue)} tone="text-ember-700" />
        <Stat label="Stok akhir" value={hkLedger.closingValue != null ? formatRp(hkLedger.closingValue) : "—"} tone="text-navy-900" />
      </div>
      {(hkLedger.missingMonths.length > 0 || hkUnpricedEntries > 0) && (
        <p className="mt-2 text-sm text-ember-700">
          {hkLedger.missingMonths.length > 0 && `Tab sheet HK untuk ${hkLedger.missingMonths.map(monthLabel).join(", ")} belum ada; tanggalnya tidak dihitung. `}
          {hkUnpricedEntries > 0 && `${hkUnpricedEntries} catatan keluar tanpa harga tidak ikut dinilai.`}
        </p>
      )}
      <div className="skeuo-inset mt-3 inline-flex gap-1 p-1">
        {HK_VIEWS.map((v) => (
          <button key={v.id} type="button" onClick={() => setView(v.id)} aria-pressed={view === v.id} className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", view === v.id ? PILL_ON : PILL_OFF)}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {view === "date" && (
          <DataTable
            rows={hkLedger.days}
            rowKey={(d) => d.date}
            initialSort={{ key: "date", dir: "asc" }}
            columns={[
              { key: "date", header: "Tanggal", sort: (d) => d.date, render: () => null },
              { key: "count", header: "Catatan", align: "right", sort: (d) => d.movements.length, render: () => null },
              { key: "in", header: "Masuk", align: "right", sort: (d) => d.inValue, render: () => null },
              { key: "out", header: "Keluar", align: "right", sort: (d) => d.outValue, render: () => null },
              { key: "close", header: "Stok akhir", align: "right", sort: (d) => d.closingValue, render: () => null },
            ]}
            renderRow={(d) => <MutationDayRow day={d} />}
          />
        )}
        {view === "location" && (
          <>
            {unrecordedPct >= 10 && (
              <p className="mb-2 text-sm text-ember-700">
                {Math.round(unrecordedPct)}% pemakaian ({formatRp(unrecorded!.totalCost)}) keluar tanpa lokasi: kolom &quot;Di mana&quot; di sheet HK tidak diisi.
              </p>
            )}
            <DataTable
              rows={hkLocations}
              rowKey={(l) => l.location}
              empty="Tidak ada pemakaian di periode ini."
              initialSort={{ key: "value", dir: "desc" }}
              columns={[
                { key: "name", header: "Lokasi", sort: (l) => l.location, render: (l) => <span className="font-semibold text-navy-900">{l.location}</span> },
                { key: "items", header: "Barang", align: "right", sort: (l) => l.itemCount, render: (l) => l.itemCount },
                { key: "value", header: "Nilai", align: "right", sort: (l) => l.totalCost, render: (l) => <span className="font-semibold text-ember-600">{formatRp(l.totalCost)}</span> },
                { key: "share", header: "%", align: "right", sort: (l) => l.totalCost, render: (l) => (hkLedger.outValue > 0 ? formatPct((l.totalCost / hkLedger.outValue) * 100) : "—") },
              ]}
            />
          </>
        )}
        {view === "item" && (
          <>
            <p className="mb-2 text-sm text-navy-600">
              {hkLedger.items.length} barang · {moved} bergerak di periode ini · dinilai dengan harga rata-rata VHP
            </p>
            <DataTable
              rows={hkLedger.items}
              rowKey={(i) => i.itemCode}
              rank
              initialSort={{ key: "value", dir: "desc" }}
              columns={[
                { key: "name", header: "Barang", sort: (i) => i.itemName, render: (i) => <span className="font-semibold text-navy-900">{i.itemName}</span> },
                { key: "open", header: "Awal", align: "right", sort: (i) => i.opening, render: (i) => qty(i.opening) },
                { key: "in", header: "Masuk", align: "right", sort: (i) => i.qtyIn, render: (i) => <span className="text-emerald-800">{i.qtyIn ? qty(i.qtyIn) : "—"}</span> },
                { key: "out", header: "Keluar", align: "right", sort: (i) => i.qtyOut, render: (i) => <span className="text-ember-600">{i.qtyOut ? qty(i.qtyOut) : "—"}</span> },
                { key: "close", header: "Akhir", align: "right", sort: (i) => i.closing, render: (i) => <span className="font-semibold">{`${qty(i.closing)} ${i.unit ?? ""}`}</span> },
                {
                  key: "value",
                  header: "Nilai akhir",
                  align: "right",
                  sort: (i) => i.closingValue,
                  render: (i) => (i.closingValue !== null ? formatRp(i.closingValue) : <span className="text-ember-600">tanpa harga</span>),
                },
              ]}
            />
          </>
        )}
      </div>
    </>
  );
}
