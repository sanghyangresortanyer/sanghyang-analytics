"use client";

import Link from "next/link";
import { Download, Eye } from "lucide-react";
import type { SavedWeeklyMeeting } from "@/lib/actions/weekly-meeting";
import { formatRp } from "@/lib/format-currency";
import { formatDateID } from "@/lib/format-date";
import { NO_FILE } from "@/lib/dashboard/range-report";
import { DataTable } from "@/components/ui/data-table";
import { DeleteMeetingButton } from "./delete-button";

/** What one upload holds, from the files it had: "Revenue + penjualan", "Pembelian", … */
function uploadContent(m: SavedWeeklyMeeting): string {
  const parts = [
    m.revenue_filename !== NO_FILE ? "Revenue" : null,
    m.journal_filename ? "penjualan" : null,
    m.fo_journal_filename ? "F/O Journal" : null,
    m.purchase_filename !== NO_FILE ? "pembelian" : null,
  ].filter(Boolean) as string[];
  const text = parts.join(" + ");
  return text ? text[0].toUpperCase() + text.slice(1) : "—";
}

/** Saved uploads, newest first, 10 per page; every header sorts. */
export function MeetingsTable({ meetings }: { meetings: SavedWeeklyMeeting[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <DataTable
        rows={meetings}
        rowKey={(m) => m.id}
        initialSort={{ key: "period", dir: "desc" }}
        columns={[
          { key: "content", header: "Isi upload", sort: (m) => uploadContent(m), render: (m) => <span className="font-semibold text-slate-900">{uploadContent(m)}</span> },
          {
            key: "period",
            header: "Periode",
            sort: (m) => `${m.period_end}|${m.period_start}`,
            render: (m) => (m.period_start === m.period_end ? formatDateID(m.period_start) : `${formatDateID(m.period_start)} – ${formatDateID(m.period_end)}`),
          },
          {
            key: "revenue",
            header: "Revenue",
            align: "right",
            sort: (m) => Number(m.total_revenue),
            render: (m) => (m.revenue_filename === NO_FILE ? "—" : <span className="font-bold text-emerald-800">{formatRp(m.total_revenue)}</span>),
          },
          {
            key: "purchase",
            header: "Pembelian",
            align: "right",
            sort: (m) => Number(m.total_purchase),
            render: (m) => (m.purchase_filename === NO_FILE ? "—" : <span className="font-semibold text-amber-700">{formatRp(m.total_purchase)}</span>),
          },
          {
            key: "actions",
            header: "Aksi",
            align: "right",
            render: (m) => (
              <div className="flex items-center justify-end gap-2">
                <Link href={`/?meeting=${m.id}`} title="Lihat Dashboard" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100">
                  <Eye className="h-4 w-4" />
                </Link>
                <a href={`/api/export-meeting?meetingId=${m.id}`} title="Export Excel" className="rounded-lg border border-slate-200 p-1.5 text-emerald-700 hover:bg-emerald-50">
                  <Download className="h-4 w-4" />
                </a>
                <DeleteMeetingButton meetingId={m.id} version={m.version} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
