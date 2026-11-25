"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { formatRp } from "@/lib/format-currency";
import { formatDateTimeWIB } from "@/lib/format-date";
import type { HkItemRow } from "@/lib/sheets/queries";
import type { LocationUsageGroup } from "./sheets-dashboard-tabs";
import { DataTable } from "@/components/ui/data-table";

const qty = (n: number | null) => (n === null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }));
const rp = (n: number | null) => (n === null ? "—" : formatRp(Math.round(n)));
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

type View = "hk" | "pemakaian" | "stock";
const VIEWS: { id: View; label: string }[] = [
  { id: "hk", label: "HK" },
  { id: "pemakaian", label: "HK Pemakaian" },
  { id: "stock", label: "HK Stock Terakhir" },
];

/** Housekeeping, read from the HK Google Sheet (one month tab, the latest unless picked), in three views. */
export function HkSection({ items, usage, syncedAt, months = [] }: { items: HkItemRow[]; usage: LocationUsageGroup[]; syncedAt: string | null; months?: string[] }) {
  const [view, setView] = useState<View>("hk");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const month = items[0]?.period_month;
  const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const monthLabel = month ? label(month) : "";
  const pickMonth = (m: string) => startTransition(() => router.push(`/data-sheets?tab=hk&hk=${m}`, { scroll: false }));
  const value = (q: number | null, p: number | null) => (q !== null && p !== null ? q * p : 0);
  const totals = {
    awal: items.reduce((s, i) => s + value(i.stock_awal, i.average_price), 0),
    masuk: items.reduce((s, i) => s + value(i.total_in, i.average_price), 0),
    keluar: items.reduce((s, i) => s + value(i.total_out, i.average_price), 0),
    akhir: items.reduce((s, i) => s + (i.stock_value ?? 0), 0),
  };

  return (
    <div className="space-y-4" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">HK Housekeeping {monthLabel}</h2>
          <p className="text-sm text-slate-600">Dari Google Sheets HK · terakhir data sync: {syncedAt ? formatDateTimeWIB(syncedAt) : "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {months.length > 1 && month && (
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              Bulan
              <select
                value={month}
                disabled={pending}
                onChange={(e) => pickMonth(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {label(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${view === v.id ? "bg-navy-800 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}
            >
              {v.label}
            </button>
          ))}
          </div>
        </div>
      </div>

      {view === "hk" && <Summary totals={totals} items={items} usage={usage} />}
      {view === "pemakaian" && <Usage usage={usage} />}
      {view === "stock" && <Stock items={items} />}
    </div>
  );
}

function Summary({ totals, items, usage }: { totals: Record<"awal" | "masuk" | "keluar" | "akhir", number>; items: HkItemRow[]; usage: LocationUsageGroup[] }) {
  const topItems = [...items]
    .filter((i) => (i.total_out ?? 0) > 0)
    .map((i) => ({ ...i, cost: (i.total_out ?? 0) * (i.average_price ?? 0) }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Stok awal", value: totals.awal, tone: "text-slate-900" },
          { label: "Masuk (IN)", value: totals.masuk, tone: "text-emerald-800" },
          { label: "Keluar (OUT)", value: totals.keluar, tone: "text-rose-800" },
          { label: "Stok akhir", value: totals.akhir, tone: "text-blue-800" },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-500">{t.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${t.tone}`}>{rp(t.value)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-bold text-slate-900">Pemakaian terbesar per lokasi</h3>
          <ul className="mt-3 divide-y divide-slate-100">
            {usage.slice(0, 5).map((g) => (
              <li key={g.label} className="flex items-center justify-between py-2 text-base">
                <span className="font-medium text-slate-800">{g.label}</span>
                <span className="font-semibold tabular-nums text-slate-900">{rp(g.value)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-bold text-slate-900">Barang paling banyak keluar</h3>
          <ul className="mt-3 divide-y divide-slate-100">
            {topItems.map((i) => (
              <li key={i.item_code} className="flex items-center justify-between gap-3 py-2 text-base">
                <span className="min-w-0 font-medium text-slate-800">
                  {i.item_name} <span className="text-sm text-slate-500">· {qty(i.total_out)} {i.unit ?? ""}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-slate-900">{rp(i.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Usage({ usage }: { usage: LocationUsageGroup[] }) {
  const [open, setOpen] = useState<string | null>(usage[0]?.label ?? null);
  const total = usage.reduce((s, g) => s + g.value, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">Pemakaian per lokasi</h3>
        <p className="text-base font-semibold tabular-nums text-slate-900">Total {rp(total)}</p>
      </div>
      <p className="text-sm text-slate-600">Lokasi gabungan (misal &quot;SRD &amp; BC&quot;) dibagi rata ke tiap lokasi.</p>
      <div className="mt-3 divide-y divide-slate-100">
        {usage.map((g) => {
          const isOpen = open === g.label;
          return (
            <div key={g.label}>
              <button type="button" onClick={() => setOpen(isOpen ? null : g.label)} className="flex w-full items-center justify-between gap-3 py-3 text-left">
                <span className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  {isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  {g.label}
                  <span className="text-sm font-normal text-slate-500">{g.items.length} barang</span>
                </span>
                <span className="text-base font-bold tabular-nums text-slate-900">{rp(g.value)}</span>
              </button>
              {isOpen && (
                <DataTable
                  className="mb-3 pl-6"
                  rows={g.items}
                  rowKey={(it) => it.code}
                  initialSort={{ key: "value", dir: "desc" }}
                  columns={[
                    { key: "name", header: "Barang", sort: (it) => it.name, render: (it) => <span className="text-slate-800">{it.name}</span> },
                    { key: "qty", header: "Keluar", align: "right", sort: (it) => it.qty, render: (it) => `${qty(it.qty)} ${it.unit ?? ""}` },
                    { key: "price", header: "Harga rata-rata", align: "right", sort: (it) => it.averagePrice, render: (it) => rp(it.averagePrice) },
                    { key: "value", header: "Nilai", align: "right", sort: (it) => it.cost, render: (it) => <span className="font-semibold text-slate-900">{rp(it.cost)}</span> },
                  ]}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stock({ items }: { items: HkItemRow[] }) {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => !q || i.item_name.toLowerCase().includes(q) || i.item_code.includes(q));
  }, [items, search]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-900">Stock terakhir · {items.length} barang</h3>
        <label className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari barang..."
            aria-label="Cari barang"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-blue-600 focus:bg-white focus:outline-none"
          />
        </label>
      </div>
      <DataTable
        key={search}
        className="mt-3"
        rows={rows}
        rowKey={(i) => i.item_code}
        rank
        empty="Tidak ada barang yang cocok."
        initialSort={{ key: "value", dir: "desc" }}
        columns={[
          { key: "name", header: "Barang", sort: (i) => i.item_name, render: (i) => <span className="font-medium text-slate-900">{i.item_name}</span> },
          { key: "stock", header: "Stok akhir", align: "right", sort: (i) => i.stock_akhir, render: (i) => `${qty(i.stock_akhir)} ${i.unit ?? ""}` },
          { key: "price", header: "Harga rata-rata", align: "right", sort: (i) => i.average_price, render: (i) => rp(i.average_price) },
          { key: "value", header: "Nilai", align: "right", sort: (i) => i.stock_value, render: (i) => <span className="font-semibold text-slate-900">{rp(i.stock_value)}</span> },
        ]}
      />
    </div>
  );
}
