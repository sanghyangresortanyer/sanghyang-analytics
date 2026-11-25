"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FileDown } from "lucide-react";
import { formatPct, formatRp } from "@/lib/format-currency";
import type { ReportSheet } from "@/lib/dashboard/report-sheet";
import { rangeText } from "./revenue-charts";

const rp = (v: number | null) => (v === null ? "Belum ada data" : formatRp(v));

function Card({ title, range, children }: { title: string; range: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-md border border-slate-400 p-2">
      <div className="mb-1 flex items-baseline justify-between gap-2 border-b border-slate-300 pb-0.5">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-900">{title}</h2>
        <p className="whitespace-nowrap text-[9px] font-semibold text-slate-600">Tanggal: {range}</p>
      </div>
      {children}
    </section>
  );
}

function Line({ label, value, strong, sub }: { label: React.ReactNode; value: string; strong?: boolean; sub?: string }) {
  return (
    <div className={`flex justify-between gap-2 leading-tight ${strong ? "border-t border-slate-300 pt-0.5 font-bold" : ""}`}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="whitespace-nowrap tabular-nums">
        {value}
        {sub && <span className="text-slate-500"> · {sub}</span>}
      </span>
    </div>
  );
}

/** The one-page report, only visible when printing (owner, 2026-11-22). */
function Sheet({ sheet, printedOn }: { sheet: ReportSheet; printedOn: string }) {
  const range = rangeText(sheet.from, sheet.to);
  const ia = sheet.inactive;
  return (
    <div id="analytics-report" className="hidden bg-white text-[10px] text-slate-900">
      <header className="mb-2 flex items-end justify-between border-b-2 border-slate-800 pb-1">
        <div>
          <h1 className="text-[15px] font-bold">Laporan Sanghyang Analytics · Sanghyang Indah Spa Resort</h1>
          <p className="text-[10px] text-slate-700">Tanggal laporan: {range}</p>
        </div>
        <p className="text-[9px] text-slate-600">Dicetak {printedOn} · sumber: VHP dan Google Sheets</p>
      </header>
      <div className="grid grid-cols-2 gap-2">
        <Card title="Revenue per outlet" range={range}>
          {sheet.revenue.rows.map((r) => (
            <Line key={r.outlet} label={r.outlet} value={rp(r.amount)} sub={r.share === null ? undefined : formatPct(r.share)} />
          ))}
          <Line label="Total" value={formatRp(sheet.revenue.total)} strong />
        </Card>
        <Card title="Pembelian" range={range}>
          <Line label="Total pembelian" value={rp(sheet.purchases.total)} strong />
          <div className="mt-1 grid grid-cols-2 gap-x-3">
            <div>
              <p className="font-semibold text-slate-600">Per kelompok barang</p>
              {sheet.purchases.groups.length === 0 ? <p>Belum ada data</p> : sheet.purchases.groups.slice(0, 6).map((g) => <Line key={g.name} label={g.name} value={formatRp(g.amount)} />)}
            </div>
            <div>
              <p className="font-semibold text-slate-600">5 supplier terbesar</p>
              {sheet.purchases.suppliers.length === 0 ? <p>Belum ada data</p> : sheet.purchases.suppliers.map((s) => <Line key={s.name} label={s.name} value={formatRp(s.amount)} />)}
            </div>
          </div>
        </Card>
        <Card title="Pemakaian inventory" range={range}>
          {sheet.inventory.rows.length === 0 && <p>Belum ada data</p>}
          {sheet.inventory.rows.map((d) => (
            <div key={d.name} className="mb-0.5">
              <Line label={<span className="font-semibold">{d.name}</span>} value={rp(d.usage)} />
              {d.by.length > 0 && (
                <p className="truncate pl-2 text-[9px] text-slate-600">
                  {d.by
                    .slice(0, 5)
                    .map((u) => `${u.location} ${formatRp(u.amount)}`)
                    .join(" · ")}
                </p>
              )}
            </div>
          ))}
          <Line label="Total pemakaian" value={rp(sheet.inventory.total)} strong />
        </Card>
        <Card title="10 menu terlaris" range={range}>
          {sheet.topMenus.length === 0 ? (
            <p>Belum ada data</p>
          ) : (
            sheet.topMenus.map((m, i) => <Line key={`${m.outlet}-${m.name}`} label={`${i + 1}. ${m.name} (${m.outlet})`} value={formatRp(m.amount)} sub={`${m.qty.toLocaleString("id-ID")} porsi`} />)
          )}
        </Card>
      </div>
      <div className="mt-2">
        <Card
          title="Menu paling tidak laku per outlet"
          range={ia.lastDay && ia.deadFrom ? rangeText(ia.deadFrom, ia.lastDay) : "Belum ada data"}
        >
          {ia.rows.length === 0 ? (
            <p>Belum ada data</p>
          ) : (
            <>
              <p className="mb-0.5 text-[9px] text-slate-600">
                Menu yang masih terjual dalam {ia.deadDays} hari terakhir, porsi paling sedikit (angka dalam kurung = porsi). Dihitung mundur dari data terakhir, tidak ikut tanggal laporan.
              </p>
              <div className="grid grid-cols-2 gap-x-4">
                {ia.rows.map((r) => (
                  <Line key={r.outlet} label={<><span className="font-semibold">{r.outlet}</span><span className="text-slate-500"> · {r.examples.join(", ")}</span></>} value={`${r.count} menu`} />
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/** "Unduh laporan": the browser's print dialog shows only the one-page report (Save as PDF). */
export function ReportButton({ sheet }: { sheet: ReportSheet }) {
  // The report goes into <body> (outside the app chrome), so it is only rendered in the browser.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const printedOn = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
  return (
    <>
      <button
        type="button"
        onClick={() => window.print()}
        title="Pilih 'Simpan sebagai PDF' di jendela cetak"
        className="skeuo-pill-light inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold hover:brightness-[1.02] print:hidden"
      >
        <FileDown className="h-4 w-4" />
        Unduh laporan
      </button>
      {mounted && createPortal(<Sheet sheet={sheet} printedOn={printedOn} />, document.body)}
    </>
  );
}
