"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileDown } from "lucide-react";
import { busyMenus, soldMenus } from "@/lib/dashboard/outlet-menus";
import { formatPct, formatRp, formatRpShort } from "@/lib/format-currency";
import { rangeText } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/ui/data-table";
import type { MenuActivityData } from "./revenue-charts";

type Menu = { art_no: string | null; description: string; total_qty: number; total_amount: number; source?: "journal" | "fo" };
type Slow = MenuActivityData["least"][number];

const porsi = (n: number) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })} porsi`;
const day = (iso: string) => rangeText(iso, iso).replace(/ \d{4}$/, "");

function Head({ title, range, note }: { title: string; range: string; note?: string }) {
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

/** Top 10 by portions as bento cards (owner, 24 Nov: "bento card agar lebih astetik"). */
function TopBento({ top }: { top: (Menu & { monthly: number })[] }) {
  if (top.length === 0) return <p className="py-4 text-center text-base text-navy-600">Belum ada data.</p>;
  const [first, ...rest] = top;
  const most = first.total_qty;
  const Tile = ({ m, rank }: { m: Menu; rank: number }) => (
    <div className="skeuo-inset flex min-w-0 flex-col justify-between gap-2 rounded-2xl p-3.5">
      <div className="flex items-start gap-2">
        <span className="text-sm font-semibold tabular-nums text-navy-500">{rank}</span>
        <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug text-navy-900" title={m.description}>
          {m.description}
        </p>
      </div>
      <div>
        <p className="text-xl font-semibold tabular-nums text-navy-900">{porsi(m.total_qty)}</p>
        <p className="text-sm tabular-nums text-navy-600">{formatRp(m.total_amount)}</p>
        <span aria-hidden className="mt-2 block h-1 rounded-full bg-cream-400">
          <span className="block h-1 rounded-full bg-navy-900" style={{ width: `${(m.total_qty / most) * 100}%` }} />
        </span>
      </div>
    </div>
  );
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="skeuo-pill-dark flex min-h-48 flex-col justify-between rounded-3xl p-5 sm:col-span-2 sm:row-span-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-lemon text-base font-bold text-navy-900">1</span>
          <span className="text-sm text-navy-200">Paling banyak terjual</span>
        </div>
        <div>
          <p className="text-2xl font-semibold leading-tight md:text-3xl">{first.description}</p>
          <p className="mt-3 text-4xl font-light tabular-nums md:text-5xl">{porsi(first.total_qty)}</p>
          <p className="mt-1 text-base tabular-nums text-navy-200">
            {formatRp(first.total_amount)} · ±{Math.round(first.monthly).toLocaleString("id-ID")} porsi per bulan
          </p>
        </div>
      </div>
      {rest.slice(0, 4).map((m, i) => (
        <Tile key={`${m.art_no}-${m.description}`} m={m} rank={i + 2} />
      ))}
      {rest.length > 4 && (
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-5">
          {rest.slice(4).map((m, i) => (
            <Tile key={`${m.art_no}-${m.description}`} m={m} rank={i + 6} />
          ))}
        </div>
      )}
    </div>
  );
}

/** "Menu terjual" of one outlet: top 10 as bento cards, then every menu above 3 portions a month. */
export function OutletMenus({ rows, range, days }: { rows: Menu[]; range: string; days: number }) {
  const sold = useMemo(() => soldMenus(rows, days), [rows, days]);
  const busy = useMemo(() => busyMenus(sold), [sold]);
  const [all, setAll] = useState(false);
  const shown = all ? sold : busy;
  const total = sold.reduce((s, m) => s + m.total_amount, 0);
  const portions = sold.reduce((s, m) => s + m.total_qty, 0);
  return (
    <div className="space-y-8">
      <div>
        <Head title="10 menu terlaris" range={range} note="Urut dari porsi terbanyak. Ikut pilihan tanggal di atas." />
        <TopBento top={sold.slice(0, 10)} />
      </div>
      <div>
        <Head title="Menu terjual" range={range} note={`Menu yang rata-rata terjual lebih dari 3 porsi per bulan, urut dari porsi terbanyak. Per bulan = porsi ${days} hari dihitung ke 30 hari.`} />
        {sold.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Menu terjual", value: sold.length.toLocaleString("id-ID") },
              { label: "Lebih dari 3 porsi per bulan", value: busy.length.toLocaleString("id-ID") },
              { label: `Porsi per hari (${days} hari)`, value: (Math.round((portions / days) * 10) / 10).toLocaleString("id-ID") },
            ].map((s) => (
              <div key={s.label} className="skeuo-inset rounded-xl px-2 py-2">
                <p className="text-lg font-bold tabular-nums text-navy-900">{s.value}</p>
                <p className="text-sm text-navy-600">{s.label}</p>
              </div>
            ))}
          </div>
        )}
        <DataTable
          key={`${all}`}
          className="mt-3"
          rows={shown}
          rowKey={(m) => `${m.art_no}-${m.description}`}
          rank
          empty="Belum ada menu yang terjual lebih dari 3 porsi per bulan."
          initialSort={{ key: "qty", dir: "desc" }}
          columns={[
            { key: "name", header: "Menu", sort: (m) => m.description, render: (m) => <span className="font-semibold text-navy-900">{m.description}</span> },
            { key: "qty", header: "Terjual", align: "right", sort: (m) => m.total_qty, render: (m) => m.total_qty.toLocaleString("id-ID", { maximumFractionDigits: 1 }) },
            { key: "month", header: "Rata-rata per bulan", align: "right", sort: (m) => m.monthly, render: (m) => m.monthly.toLocaleString("id-ID", { maximumFractionDigits: 1 }) },
            { key: "value", header: "Nilai", align: "right", sort: (m) => m.total_amount, render: (m) => <span className="font-semibold text-navy-900">{formatRp(m.total_amount)}</span> },
            { key: "share", header: "% dari total", align: "right", sort: (m) => m.total_amount, render: (m) => (total > 0 ? formatPct((m.total_amount / total) * 100) : "—") },
          ]}
        />
        {sold.length > busy.length && (
          <button type="button" onClick={() => setAll((v) => !v)} className="skeuo-pill-light mt-3 min-h-10 rounded-full px-4 text-sm font-semibold">
            {all ? "Hanya yang lebih dari 3 porsi per bulan" : `Tampilkan juga ${sold.length - busy.length} menu yang 3 porsi per bulan atau kurang`}
          </button>
        )}
      </div>
    </div>
  );
}

const PAGE = 20;

function SlowRows({ rows, offset, deadDays, slowDays }: { rows: Slow[]; offset: number; deadDays: number; slowDays: number }) {
  return (
    <table className="table-compact w-full text-left text-sm">
      <thead>
        <tr>
          <th className="w-8 text-right">No</th>
          <th>Menu</th>
          <th className="text-right">{deadDays} hari</th>
          <th className="text-right">{slowDays} hari</th>
          <th className="text-right">Terakhir terjual</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.outlet}|${r.artNo}`}>
            <td className="text-right tabular-nums text-navy-500">{offset + i + 1}</td>
            <td className="font-semibold text-navy-900">{r.description}</td>
            <td className="text-right tabular-nums">{r.windowQty.toLocaleString("id-ID")}</td>
            <td className="text-right tabular-nums">{r.slowQty.toLocaleString("id-ID")}</td>
            <td className="whitespace-nowrap text-right tabular-nums">
              {day(r.lastSold)}
              {r.lastQty !== undefined && <span className="text-navy-600"> · {porsi(r.lastQty)}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Menu paling tidak laku, 10 on the left and 10 on the right (owner, 24 Nov), with portions on the last day sold. */
export function SlowMenus({ activity, outlet }: { activity: MenuActivityData; outlet: string }) {
  const rows = useMemo(() => activity.least.filter((r) => r.outlet === outlet), [activity.least, outlet]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = rows.slice(current * PAGE, current * PAGE + PAGE);
  const { deadDays, slowDays } = activity;
  return (
    <div>
      <Head
        title="Menu paling tidak laku"
        range={rangeText(activity.deadFrom, activity.lastDay)}
        note={`Menu yang masih terjual dalam ${deadDays} hari terakhir, porsi paling sedikit di atas. Dihitung mundur dari data terakhir (${rangeText(activity.lastDay, activity.lastDay)}), tidak ikut pilihan tanggal. Menu yang tidak terjual sama sekali selama ${deadDays} hari dan menu baru (mulai dijual dalam ${slowDays} hari terakhir) tidak ikut.`}
      />
      {rows.length === 0 ? (
        <p className="py-6 text-center text-base text-navy-600">Tidak ada menu di daftar ini.</p>
      ) : (
        <div className="mt-3 grid gap-x-6 gap-y-3 xl:grid-cols-2">
          <SlowRows rows={slice.slice(0, 10)} offset={current * PAGE} deadDays={deadDays} slowDays={slowDays} />
          {slice.length > 10 && <SlowRows rows={slice.slice(10)} offset={current * PAGE + 10} deadDays={deadDays} slowDays={slowDays} />}
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-navy-600">
          <span className="tabular-nums">
            {current * PAGE + 1}–{Math.min(rows.length, current * PAGE + PAGE)} dari {rows.length}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="skeuo-pill-light min-h-9 rounded-full px-3 font-semibold disabled:opacity-40">
              Sebelumnya
            </button>
            <span className="tabular-nums">
              {current + 1} / {pages}
            </span>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="skeuo-pill-light min-h-9 rounded-full px-3 font-semibold disabled:opacity-40">
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type OutletReportData = {
  outlet: string;
  from: string;
  to: string;
  revenue: number | null;
  share: number | null;
  previous: { from: string; to: string; revenue: number } | null;
  bestDay: { label: string; value: number } | null;
  target: { month: string; achieved: number; target: number } | null;
  menus: Menu[];
  slow: { activity: MenuActivityData } | null;
};

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 border-b border-slate-200 py-0.5", strong && "font-bold")}>
      <span>{label}</span>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

/** The report of one outlet, only visible when printing: summary against last month, top menus, slow menus. */
function OutletSheet({ d }: { d: OutletReportData }) {
  const days = Math.round((Date.parse(d.to) - Date.parse(d.from)) / 86_400_000) + 1;
  const top = soldMenus(d.menus, days).slice(0, 10);
  const slow = d.slow ? d.slow.activity.least.filter((r) => r.outlet === d.outlet).slice(0, 20) : [];
  const change = d.revenue !== null && d.previous && d.previous.revenue > 0 ? ((d.revenue - d.previous.revenue) / d.previous.revenue) * 100 : null;
  const printed = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div id="analytics-outlet-report" className="hidden bg-white text-[11px] text-slate-900">
      <header className="mb-3 flex items-end justify-between border-b-2 border-slate-900 pb-1">
        <div>
          <h1 className="text-[17px] font-bold">Laporan {d.outlet}</h1>
          <p>Sanghyang Indah Spa Resort · Tanggal laporan: {rangeText(d.from, d.to)}</p>
        </div>
        <p className="text-[10px] text-slate-600">Dicetak {printed} WIB · sumber: VHP</p>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <section>
          <h2 className="mb-1 text-[12px] font-bold">1. Ringkasan dan bulan lalu</h2>
          <Line label={`Revenue ${rangeText(d.from, d.to)}`} value={d.revenue === null ? "Belum ada data" : formatRp(d.revenue)} strong />
          {d.previous && <Line label={`Revenue ${rangeText(d.previous.from, d.previous.to)}`} value={formatRp(d.previous.revenue)} />}
          <Line label="Perubahan" value={change === null ? "—" : `${change >= 0 ? "naik" : "turun"} ${formatPct(Math.abs(change))}`} />
          <Line label="Bagian dari total hotel" value={d.share === null ? "—" : formatPct(d.share)} />
          <Line label="Rata-rata per hari" value={d.revenue === null ? "—" : formatRp(d.revenue / days)} />
          <Line label="Hari tertinggi" value={d.bestDay ? `${d.bestDay.label} · ${formatRp(d.bestDay.value)}` : "—"} />
          {d.target && <Line label={`Target ${d.target.month}`} value={`${formatRpShort(d.target.achieved)} dari ${formatRpShort(d.target.target)} (${formatPct((d.target.achieved / d.target.target) * 100)})`} />}
        </section>
        <section>
          <h2 className="mb-1 text-[12px] font-bold">2. 10 menu terlaris (porsi terbanyak)</h2>
          {top.length === 0 ? (
            <p>Belum ada data</p>
          ) : (
            top.map((m, i) => <Line key={`${m.art_no}-${m.description}`} label={`${i + 1}. ${m.description}`} value={`${porsi(m.total_qty)} · ${formatRp(m.total_amount)}`} />)
          )}
        </section>
      </div>
      <section className="mt-4">
        <h2 className="mb-1 text-[12px] font-bold">
          3. Menu paling tidak laku{d.slow ? ` (${rangeText(d.slow.activity.deadFrom, d.slow.activity.lastDay)})` : ""}
        </h2>
        {slow.length === 0 ? (
          <p>Belum ada data</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4">
            {slow.map((r, i) => (
              <Line key={r.artNo} label={`${i + 1}. ${r.description}`} value={`${porsi(r.windowQty)} · terakhir ${day(r.lastSold)}${r.lastQty !== undefined ? ` (${porsi(r.lastQty)})` : ""}`} />
            ))}
          </div>
        )}
        {d.slow && <p className="mt-1 text-[10px] text-slate-600">Porsi dalam {d.slow.activity.deadDays} hari terakhir, paling sedikit di atas; dalam kurung = porsi pada hari terakhir terjual.</p>}
      </section>
    </div>
  );
}

/** "Unduh PDF / cetak" for one outlet: the print dialog shows only this outlet's report (Save as PDF). */
export function OutletReportButton({ data }: { data: OutletReportData }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const print = () => {
    const title = document.title;
    // The PDF file name comes from the page title.
    document.title = `Laporan ${data.outlet} ${rangeText(data.from, data.to)}`;
    document.body.classList.add("print-outlet");
    const done = () => {
      document.body.classList.remove("print-outlet");
      document.title = title;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  };
  return (
    <>
      <button type="button" onClick={print} title="Pilih 'Simpan sebagai PDF' untuk mengunduh" className="skeuo-pill-light inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold print:hidden">
        <FileDown className="h-4 w-4" />
        Unduh PDF / cetak {data.outlet}
      </button>
      {mounted && createPortal(<OutletSheet d={data} />, document.body)}
    </>
  );
}
