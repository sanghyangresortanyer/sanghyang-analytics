"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/ui/data-table";
import { formatRp } from "@/lib/format-currency";
import { formatDateID, formatDateTimeWIB } from "@/lib/format-date";
import type { DmlLineRow, DmlSheetSummary } from "@/lib/sheets/queries";

const qty = (n: number | null) => (n === null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }));
const rp = (n: number | null) => (n === null ? "—" : formatRp(n));
const PILL = "rounded-lg px-3 py-1.5 text-sm font-bold transition";
const pill = (on: boolean) => `${PILL} ${on ? "bg-navy-800 text-white shadow" : "text-slate-600 hover:text-slate-900"}`;

/**
 * DML (Daily Market List) from the Google Sheet, laid out like HK: one header card with the date
 * and an optional date to compare with, a summary, then one tab per outlet instead of a long
 * column of collapsible sections.
 */
export function DmlSection({
  sheets,
  selected,
  lines,
  syncedAt,
}: {
  sheets: DmlSheetSummary[];
  selected: DmlSheetSummary | undefined;
  lines: DmlLineRow[];
  syncedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [compareName, setCompareName] = useState("");
  const [view, setView] = useState("ringkasan");
  const compare = sheets.find((s) => s.sheet_name === compareName && s.sheet_name !== selected?.sheet_name) ?? null;

  const pick = (name: string) =>
    startTransition(() => router.push(`/data-sheets?dml=${encodeURIComponent(name)}&tab=dml`, { scroll: false }));

  const outlets = useMemo(() => selected?.outlets.filter((o) => o.outlet !== "MR") ?? [], [selected]);
  const hasMr = selected?.outlets.some((o) => o.outlet === "MR") ?? false;
  const views = ["ringkasan", ...outlets.map((o) => o.outlet), ...(hasMr ? ["MR"] : [])];
  const current = views.includes(view) ? view : "ringkasan";

  if (!selected) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-base text-slate-500">Belum ada data DML.</p>;
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">DML {formatDateID(selected.list_date)}</h2>
          <p className="text-sm text-slate-600">Dari Google Sheets DML · terakhir data sync: {syncedAt ? formatDateTimeWIB(syncedAt) : "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {sheets.map((s) => (
              <button key={s.sheet_name} type="button" disabled={pending} onClick={() => pick(s.sheet_name)} aria-pressed={s.sheet_name === selected.sheet_name} className={pill(s.sheet_name === selected.sheet_name)}>
                {formatDateID(s.list_date)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            Bandingkan dengan
            <select
              value={compare?.sheet_name ?? ""}
              onChange={(e) => setCompareName(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700"
            >
              <option value="">—</option>
              {sheets
                .filter((s) => s.sheet_name !== selected.sheet_name)
                .map((s) => (
                  <option key={s.sheet_name} value={s.sheet_name}>
                    {formatDateID(s.list_date)}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Figure label={`Total permintaan ${formatDateID(selected.list_date)}`} value={formatRp(selected.total_request)} />
        <Figure label="Jumlah barang diminta" value={`${selected.line_count} barang · ${outlets.length} outlet${hasMr ? " + MR" : ""}`} />
        {compare ? (
          <Figure
            label={`Dibanding ${formatDateID(compare.list_date)} (${formatRp(compare.total_request)})`}
            value={`${selected.total_request >= compare.total_request ? "+" : "−"}${formatRp(Math.abs(selected.total_request - compare.total_request))}`}
            tone={selected.total_request > compare.total_request ? "text-rose-800" : "text-emerald-800"}
          />
        ) : (
          <Figure label="Grand total di sheet" value={rp(selected.sheet_grand_total)} />
        )}
      </div>

      <div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {views.map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={v === current} className={pill(v === current)}>
              {v === "ringkasan" ? "Ringkasan" : v === "MR" ? "MR (material)" : v}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {current === "ringkasan" ? (
            <Summary selected={selected} compare={compare} />
          ) : (
            <Lines key={current} lines={lines.filter((l) => l.outlet === current)} mr={current === "MR"} />
          )}
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, tone = "text-slate-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

/** Request per outlet; with a second date, both dates side by side and the difference. */
function Summary({ selected, compare }: { selected: DmlSheetSummary; compare: DmlSheetSummary | null }) {
  const rows = useMemo(() => {
    const names = [...new Set([...selected.outlets.map((o) => o.outlet), ...(compare?.outlets.map((o) => o.outlet) ?? [])])];
    return names.map((outlet) => {
      const a = selected.outlets.find((o) => o.outlet === outlet);
      const b = compare?.outlets.find((o) => o.outlet === outlet);
      return { outlet, lines: a?.lineCount ?? 0, total: a?.total ?? 0, sheet: a?.sheetSubtotal ?? null, other: b?.total ?? 0 };
    });
  }, [selected, compare]);
  const a = formatDateID(selected.list_date);
  const b = compare ? formatDateID(compare.list_date) : "";
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.outlet}
      initialSort={{ key: "total", dir: "desc" }}
      columns={[
        { key: "outlet", header: "Outlet", sort: (r) => r.outlet, render: (r) => <span className="font-bold text-slate-900">{r.outlet}</span> },
        { key: "lines", header: "Item", align: "right", sort: (r) => r.lines, render: (r) => r.lines },
        { key: "total", header: compare ? a : "Total permintaan", align: "right", sort: (r) => r.total, render: (r) => <span className="font-bold text-amber-700">{formatRp(r.total)}</span> },
        ...(compare
          ? [
              { key: "other", header: b, align: "right" as const, sort: (r: (typeof rows)[number]) => r.other, render: (r: (typeof rows)[number]) => formatRp(r.other) },
              {
                key: "diff",
                header: "Selisih",
                align: "right" as const,
                sort: (r: (typeof rows)[number]) => r.total - r.other,
                render: (r: (typeof rows)[number]) => (
                  <span className={r.total > r.other ? "font-semibold text-rose-700" : r.total < r.other ? "font-semibold text-emerald-700" : "text-slate-500"}>
                    {r.total === r.other ? "0" : `${r.total > r.other ? "+" : "−"}${formatRp(Math.abs(r.total - r.other))}`}
                  </span>
                ),
              },
            ]
          : [
              {
                key: "sheet",
                header: "Subtotal di sheet",
                align: "right" as const,
                sort: (r: (typeof rows)[number]) => r.sheet,
                render: (r: (typeof rows)[number]) => {
                  const mismatch = r.sheet !== null && Math.abs(r.sheet - r.total) > 0.5;
                  return (
                    <span className={mismatch ? "font-semibold text-rose-700" : "text-slate-600"}>
                      {rp(r.sheet)}
                      {mismatch && " (selisih)"}
                    </span>
                  );
                },
              },
            ]),
      ]}
    />
  );
}

/** Items requested by one outlet (or the MR section, which also names the department). */
function Lines({ lines, mr }: { lines: DmlLineRow[]; mr: boolean }) {
  return (
    <DataTable
      rows={lines}
      rowKey={(l) => String(l.row_no)}
      rank
      empty="Tidak ada barang."
      initialSort={{ key: "total", dir: "desc" }}
      columns={[
        {
          key: "item",
          header: "Barang",
          sort: (l) => l.item_name,
          render: (l) => (
            <span className="font-medium text-slate-900">
              {l.item_name}
              {l.unit && <span className="text-slate-400"> · {l.unit}</span>}
            </span>
          ),
        },
        { key: "price", header: "Harga", align: "right", sort: (l) => l.price, render: (l) => rp(l.price) },
        ...(mr ? [] : [{ key: "soh", header: "Stok", align: "right" as const, sort: (l: DmlLineRow) => l.soh, render: (l: DmlLineRow) => qty(l.soh) }]),
        { key: "qty", header: "Diminta", align: "right", sort: (l) => l.qty_req, render: (l) => qty(l.qty_req) },
        { key: "total", header: "Total", align: "right", sort: (l) => l.total, render: (l) => <span className="font-semibold text-amber-700">{rp(l.total)}</span> },
        { key: "channel", header: mr ? "Dept" : "Beli di", sort: (l) => l.purchase_channel, render: (l) => <span className="text-sm text-slate-600">{l.purchase_channel ?? "—"}</span> },
        ...(mr ? [{ key: "note", header: "Catatan", render: (l: DmlLineRow) => <span className="text-xs text-slate-500">{l.note ?? "—"}</span> }] : []),
      ]}
    />
  );
}
