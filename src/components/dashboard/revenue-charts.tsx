"use client";

import { rangeText } from "@/lib/format-date";
import { useMemo, useState } from "react";
import { CATEGORY_COLORS } from "@/lib/dashboard/revenue-category";
import { categorySeries, monthlySeries, weeklySeries, type RevenueCharts } from "@/lib/dashboard/revenue-trend";
import { formatPct, formatRp, formatRpShort } from "@/lib/format-currency";
import { cn } from "@/lib/utils";
import { SkeuoCard } from "@/components/skeuo/ui";
import { DataTable } from "@/components/ui/data-table";

// Look A (owner, 24 Nov): ink without comparison, dark green up, red down, light grey when incomplete.
const INK = "#3a4047";
const LIGHT = "#a9afb6";
const UP = "#14532d";
const DOWN = "#c62f1d";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

interface Bar {
  key: string;
  label: string;
  value: number;
  color: string;
  detail: string;
  /** Month the bar belongs to; with many bars only the first bar of each month is labelled. */
  group?: string;
}

/**
 * Columns with their short value on top; pointing at (or focusing) a bar outlines it and writes
 * its full detail above the chart. Colours carry meaning only (up, down, incomplete), never the pointer.
 */
function ColumnChart({ bars, label }: { bars: Bar[]; label: string }) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(0, ...bars.map((b) => b.value));
  const shown = bars.find((b) => b.key === active) ?? bars.at(-1);
  // Many bars (all weeks): no numbers on top and one label per month, so nothing overlaps.
  const dense = bars.length > 16;
  return (
    <figure aria-label={label}>
      <p className="min-h-7 text-base font-semibold text-navy-900" aria-live="polite">
        {shown?.detail ?? ""}
      </p>
      <div className={cn("mt-2 flex h-72 items-end justify-center border-b border-cream-300", dense ? "gap-0.5" : "gap-1.5")} role="list">
        {bars.map((b) => (
          <button
            key={b.key}
            type="button"
            role="listitem"
            aria-label={b.detail}
            onMouseEnter={() => setActive(b.key)}
            onFocus={() => setActive(b.key)}
            className="flex h-full min-w-0 max-w-24 flex-1 flex-col items-center justify-end focus:outline-none"
          >
            {!dense && <span className="mb-1 whitespace-nowrap text-xs font-semibold tabular-nums text-navy-700 sm:text-sm">{formatRpShort(b.value)}</span>}
            <span
              className={cn("w-full max-w-16 rounded-t-md", active === b.key && "ring-2 ring-navy-900 ring-offset-2")}
              style={{ height: `${max > 0 ? (Math.max(b.value, 0) / max) * 85 : 0}%`, minHeight: 3, background: b.color }}
            />
          </button>
        ))}
      </div>
      <div className={cn("mt-1.5 flex justify-center", dense ? "gap-0.5" : "gap-1.5")}>
        {bars.map((b, i) =>
          dense ? (
            <span key={b.key} className="min-w-0 max-w-24 flex-1 overflow-visible whitespace-nowrap text-left text-sm font-medium text-navy-700">
              {b.group && b.group !== bars[i - 1]?.group ? b.group : ""}
            </span>
          ) : (
            <span key={b.key} className="min-w-0 max-w-24 flex-1 truncate text-center text-sm font-medium text-navy-700">
              {b.label}
            </span>
          ),
        )}
      </div>
      {dense && <p className="mt-1 text-sm text-navy-600">Arahkan kursor ke batang untuk melihat tanggal dan angkanya.</p>}
    </figure>
  );
}

function Legend({ first }: { first: string }) {
  const items = [
    { color: INK, text: first },
    { color: UP, text: "naik dari sebelumnya" },
    { color: DOWN, text: "turun" },
    { color: LIGHT, text: "belum lengkap" },
  ];
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-navy-700">
      {items.map((i) => (
        <span key={i.text} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ background: i.color }} />
          {i.text}
        </span>
      ))}
    </p>
  );
}

/** Colour of a period against the one before: ink without comparison, dark green up, red down, light when incomplete. */
const changeColor = (changePct: number | null, complete: boolean) => (!complete ? LIGHT : changePct === null ? INK : changePct >= 0 ? UP : DOWN);
const changeText = (changePct: number | null, what: string) =>
  changePct === null ? "" : ` · ${changePct >= 0 ? "naik" : "turun"} ${formatPct(Math.abs(changePct))} dari ${what} sebelumnya`;

function OutletPills({ names, selected, onPick }: { names: string[]; selected: string; onPick: (n: string) => void }) {
  return (
    <div className="skeuo-inset flex flex-wrap gap-1 p-1">
      {["Semua", ...names].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          aria-pressed={n === selected}
          className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", n === selected ? "skeuo-pill-dark" : "text-navy-500 hover:text-navy-800")}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/** Revenue per month and per week for one outlet or all, with the change against the week before. */
export function RevenueTrend({ charts, outlets }: { charts: RevenueCharts; outlets: string[] }) {
  const [picked, setPicked] = useState("Semua");
  const [allWeeks, setAllWeeks] = useState(false);
  const outlet = picked === "Semua" ? null : picked;
  const months = useMemo(() => monthlySeries(charts, outlet), [charts, outlet]);
  const weeks = useMemo(() => weeklySeries(charts, outlet), [charts, outlet]);
  const lastMonth = charts.lastDay?.slice(0, 7);
  const monthBars: Bar[] = months.map((m, i) => {
    const partial = m.month === lastMonth && charts.lastDay !== null && Number(charts.lastDay.slice(8, 10)) < new Date(Date.UTC(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 0)).getUTCDate();
    const prev = i > 0 ? months[i - 1].revenue : null;
    const changePct = prev ? ((m.revenue - prev) / Math.abs(prev)) * 100 : null;
    return {
      key: m.month,
      label: monthName(m.month),
      value: m.revenue,
      color: changeColor(changePct, !partial),
      detail: `${monthName(m.month)}${partial ? ` (s.d. ${dayMonth(charts.lastDay!)}, belum lengkap)` : ""}: ${formatRp(m.revenue)}${partial ? "" : changeText(changePct, "bulan")}`,
    };
  });
  const weekBars: Bar[] = (allWeeks ? weeks : weeks.slice(-13)).map((w) => {
    // An open week says how many of its days have data, e.g. "baru 2 dari 7 hari (s.d. 17 Nov)".
    const last = charts.lastDay && charts.lastDay < w.end ? charts.lastDay : w.end;
    const daysIn = Math.round((Date.parse(last) - Date.parse(w.start)) / 86_400_000) + 1;
    return {
      key: w.start,
      label: dayMonth(w.start),
      group: monthName(w.start.slice(0, 7)),
      value: w.revenue,
      color: changeColor(w.changePct, w.complete),
      detail: `${dayMonth(w.start)}–${dayMonth(w.end)}: ${formatRp(w.revenue)}${
        w.complete ? changeText(w.changePct, "minggu") : ` · baru ${daysIn} dari 7 hari ada data (s.d. ${dayMonth(last)}), belum bisa dibandingkan`
      }`,
    };
  });
  return (
    <SkeuoCard>
      <h2 className="text-xl font-semibold text-navy-900">Tren revenue</h2>
      <p className="text-base text-navy-600">Revenue seperti di laporan revenue VHP. Arahkan kursor ke batang untuk melihat angkanya.</p>
      <div className="mt-3">
        <OutletPills names={outlets} selected={picked} onPick={setPicked} />
      </div>
      <div className="mt-5 space-y-8">
        <div>
          <h3 className="text-lg font-semibold text-navy-900">Per bulan</h3>
          <ColumnChart bars={monthBars} label="Revenue per bulan" />
          <Legend first="bulan pertama (tanpa pembanding)" />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-navy-900">Per minggu (Senin–Minggu)</h3>
            <button type="button" onClick={() => setAllWeeks((v) => !v)} className="text-base font-semibold text-navy-700 underline underline-offset-2">
              {allWeeks ? "13 minggu terakhir" : "Semua minggu"}
            </button>
          </div>
          <ColumnChart bars={weekBars} label="Revenue per minggu" />
          <Legend first="minggu pertama (tanpa pembanding)" />
        </div>
      </div>
    </SkeuoCard>
  );
}

/* ---------- Parts of the "Detail per outlet" card: no card of their own, one outlet at a time ---------- */

/** "1–17 Nov 2026", "20 Agu – 17 Nov 2026" or "28 Des 2025 – 3 Jan 2026". */
export { rangeText };

/** Heading of one part of the card, always with the dates it covers. */
export function PartHead({ title, range, note }: { title: string; range: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 className="text-lg font-semibold text-navy-900">{title}</h3>
      <p className="text-sm font-semibold text-navy-700">
        Tanggal: <span className="tabular-nums">{range}</span>
      </p>
      {note && <p className="w-full text-sm text-navy-600">{note}</p>}
    </div>
  );
}

/** Sales per category (food, drinks, tobacco, …) of one outlet in the selected period. */
export function CategoryBars({ charts, outlet }: { charts: RevenueCharts; outlet: string }) {
  const rows = useMemo(() => categorySeries(charts, outlet), [charts, outlet]);
  const gross = rows.filter((r) => r.category !== "Compliment" && r.category !== "Diskon").reduce((s, r) => s + r.sales, 0);
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.sales)));
  if (rows.length === 0) return <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>;
  return (
    <ul className="mt-3 space-y-3">
      {rows.map((r) => (
        <li key={r.category} className="grid grid-cols-[9rem_1fr_8rem] items-center gap-3 sm:grid-cols-[13rem_1fr_11rem]">
          <span className="text-base font-semibold text-navy-900">{r.category}</span>
          <span className="h-6 rounded-md" style={{ width: `${max > 0 ? (Math.abs(r.sales) / max) * 100 : 0}%`, minWidth: 3, background: CATEGORY_COLORS[r.category] }} />
          <span className="text-right text-base font-semibold tabular-nums text-navy-900">
            {r.sales < 0 ? "−" : ""}
            {formatRpShort(Math.abs(r.sales))}
            {r.sales > 0 && gross > 0 && <span className="text-navy-500"> · {formatPct((r.sales / gross) * 100)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const SEGMENT_LABELS: Record<string, string> = {
  FIT: "Tamu langsung (FIT)",
  "FIT-TA": "OTA / travel agent (FIT-TA)",
  "WALK IN": "Datang langsung (WALK IN)",
  "FIT-CORP": "Perusahaan (FIT-CORP)",
  "GIT-CORP": "Rombongan perusahaan (GIT-CORP)",
  "HOUSE USE": "Dipakai hotel (HOUSE USE)",
  "(tidak diisi)": "Segmen tidak diisi",
};

function RevenueBar({ value, max, total, light }: { value: number; max: number; total: number; light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-5 rounded-md" style={{ width: `${max > 0 ? (Math.max(value, 0) / max) * 60 : 0}%`, minWidth: 3, background: light ? LIGHT : INK }} />
      <span className="whitespace-nowrap text-base tabular-nums text-navy-900">
        {formatRpShort(value)}
        {total > 0 && <span className="text-navy-500"> · {formatPct((value / total) * 100)}</span>}
      </span>
    </div>
  );
}

/** Room revenue per booking segment from the F/O Journal: revenue, room nights, average per night. */
export function RoomSegmentsTable({ rows }: { rows: { segment: string; revenue: number; roomNights: number; lodging: number }[] }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const max = Math.max(0, ...rows.map((r) => r.revenue));
  if (rows.length === 0) return <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left">
        <thead className="text-sm text-navy-600">
          <tr>
            <th className="py-2 pr-3 font-semibold">Segmen</th>
            <th className="py-2 pr-3 font-semibold">Revenue kamar</th>
            <th className="py-2 pr-3 text-right font-semibold">Malam kamar</th>
            <th className="py-2 text-right font-semibold">Rata-rata per malam</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.segment} className="border-t border-cream-200">
              <td className="py-2.5 pr-3 text-base font-semibold text-navy-900">{SEGMENT_LABELS[r.segment] ?? r.segment}</td>
              <td className="py-2.5 pr-3">
                <RevenueBar value={r.revenue} max={max} total={total} />
              </td>
              <td className="py-2.5 pr-3 text-right text-base tabular-nums text-navy-900">{r.roomNights.toLocaleString("id-ID")}</td>
              <td className="py-2.5 text-right text-base tabular-nums text-navy-900">{r.roomNights > 0 ? formatRp(r.lodging / r.roomNights) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Room revenue per room type (Pengaturan → Jenis kamar maps room numbers to types). */
export function RoomTypesTable({ rows }: { rows: { code: string | null; name: string; revenue: number; roomNights: number; lodging: number; rooms: number }[] }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const max = Math.max(0, ...rows.map((r) => r.revenue));
  const unset = rows.find((r) => r.name === "Belum diatur");
  if (rows.length === 0) return <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left">
        <thead className="text-sm text-navy-600">
          <tr>
            <th className="py-2 pr-3 font-semibold">Jenis kamar</th>
            <th className="py-2 pr-3 font-semibold">Revenue kamar</th>
            <th className="py-2 pr-3 text-right font-semibold">Malam menginap</th>
            <th className="py-2 pr-3 text-right font-semibold">Harga rata-rata per malam</th>
            <th className="py-2 text-right font-semibold">Jumlah kamar terisi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code ?? r.name} className="border-t border-cream-200">
              <td className={cn("py-2.5 pr-3 text-base font-semibold", r.code ? "text-navy-900" : "text-amber-700")}>{r.name}</td>
              <td className="py-2.5 pr-3">
                <RevenueBar value={r.revenue} max={max} total={total} light={!r.code} />
              </td>
              <td className="py-2.5 pr-3 text-right text-base tabular-nums text-navy-900">{r.roomNights.toLocaleString("id-ID")}</td>
              <td className="py-2.5 pr-3 text-right text-base tabular-nums text-navy-900">{r.roomNights > 0 ? formatRp(r.lodging / r.roomNights) : "—"}</td>
              <td className="py-2.5 text-right text-base tabular-nums text-navy-900">{r.rooms}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unset && <p className="mt-2 text-sm text-amber-700">&quot;Belum diatur&quot; = kamar yang jenisnya belum diisi di Pengaturan → Jenis Kamar.</p>}
    </div>
  );
}

/** d'Bar Karaoke & DBC is one outlet in VHP; its menus show how much is DBC and how much d'Bar & Karaoke. */
export function DbarSplitBars({ split }: { split: { rows: { label: string; revenue: number; openDays: number; sharePct: number | null }[]; total: number } }) {
  const max = Math.max(0, ...split.rows.map((r) => r.revenue));
  if (split.rows.length === 0) return <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>;
  return (
    <div className="mt-3 space-y-3">
      {split.rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(9rem,14rem)_1fr] items-center gap-3">
          <div>
            <p className="text-base font-semibold text-navy-900">{r.label}</p>
            {r.revenue > 0 && <p className="text-sm text-navy-600">{r.openDays} hari ada penjualan</p>}
          </div>
          <div className="flex items-center gap-3">
            <span className="h-5 rounded-md" style={{ width: `${max > 0 ? (Math.max(r.revenue, 0) / max) * 60 : 0}%`, minWidth: 3, background: r.revenue < 0 ? DOWN : INK }} />
            <span className="whitespace-nowrap text-base tabular-nums text-navy-900">
              {formatRp(r.revenue)}
              {r.sharePct !== null && <span className="text-navy-500"> · {formatPct(r.sharePct)}</span>}
            </span>
          </div>
        </div>
      ))}
      <p className="border-t border-cream-200 pt-2 text-base font-semibold tabular-nums text-navy-900">Total {formatRp(split.total)}</p>
    </div>
  );
}

type MenuRowActivity = { outlet: string; artNo: string; description: string; totalQty: number; windowQty: number; slowQty: number; totalSales: number; lastSold: string; lastQty?: number; firstSold: string };
export type MenuActivityData = {
  deadFrom: string;
  slowFrom: string;
  lastDay: string;
  deadDays: number;
  slowDays: number;
  slowBelow: number;
  /** Start of the 12 months behind `top` (never before 1 Jan 2026). */
  yearFrom: string;
  /** Menus sold in the last `deadDays` days, fewest portions first (owner, 23 Nov). */
  least: MenuRowActivity[];
  /** 10 best sellers per outlet over the 12 months. */
  top: MenuRowActivity[];
};

/**
 * Menu paling tidak laku of one outlet (owner, 23 Nov: "jangkanya 3 bulan saja"): menus still sold in the
 * last 3 months, fewest portions first. Counted back from the last data day, not from the date filter.
 */
export function MenuActivityPart({ activity, outlet }: { activity: MenuActivityData; outlet: string }) {
  const rows = activity.least.filter((r) => r.outlet === outlet);
  const { deadDays, slowDays } = activity;
  return (
    <div>
      <PartHead
        title="Menu paling tidak laku"
        range={rangeText(activity.deadFrom, activity.lastDay)}
        note={`${deadDays} hari terakhir, dihitung mundur dari data terakhir (${rangeText(activity.lastDay, activity.lastDay)}), tidak ikut pilihan tanggal di atas. Jangka hari diatur di Pengaturan.`}
      />
      <p className="mt-2 text-base text-navy-700">
        Menu yang masih terjual dalam {deadDays} hari terakhir, diurutkan dari porsi paling sedikit. Menu yang tidak terjual sama sekali selama {deadDays} hari dianggap sudah tidak ada di menu, jadi
        tidak ditampilkan. Menu baru (mulai dijual dalam {slowDays} hari terakhir) juga tidak ikut.
      </p>
      <DataTable
        key={outlet}
        className="mt-3"
        rows={rows}
        rowKey={(r) => `${r.outlet}|${r.artNo}`}
        rank
        empty="Tidak ada menu di daftar ini."
        initialSort={{ key: "window", dir: "asc" }}
        columns={[
          { key: "menu", header: "Menu", sort: (r) => r.description, render: (r) => <span className="font-semibold text-navy-900">{r.description}</span> },
          { key: "window", header: `Porsi ${deadDays} hari terakhir`, align: "right", sort: (r) => r.windowQty, render: (r) => r.windowQty.toLocaleString("id-ID") },
          { key: "month", header: `Porsi ${slowDays} hari terakhir`, align: "right", sort: (r) => r.slowQty, render: (r) => r.slowQty.toLocaleString("id-ID") },
          { key: "last", header: "Terakhir terjual", sort: (r) => r.lastSold, render: (r) => rangeText(r.lastSold, r.lastSold) },
        ]}
      />
    </div>
  );
}
