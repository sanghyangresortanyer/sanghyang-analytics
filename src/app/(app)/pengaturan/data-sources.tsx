import { listWeeklyMeetings } from "@/lib/actions/weekly-meeting";
import { coveredDays, uploadCoverage } from "@/lib/dashboard/data-status";
import { getSyncStates } from "@/lib/sheets/queries";

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "Belum ditarik";

/** Where the dashboard figures come from and which days each source covers (moved off the dashboard). */
export async function DataSources({ propertyId }: { propertyId: string }) {
  const [meetings, states] = await Promise.all([listWeeklyMeetings(), getSyncStates(propertyId).catch(() => [])]);
  const c = uploadCoverage(meetings);
  const state = (source: string) => states.find((s) => s.source === source);
  const rows = [
    { name: "Laporan revenue VHP", detail: coveredDays(c.revenue) || "Belum ada" },
    { name: "Penjualan per Artikel (VHP)", detail: coveredDays(c.sales) || "Belum ada" },
    { name: "F/O Journal (VHP)", detail: coveredDays(c.foJournal) || "Belum ada" },
    { name: "Pembelian VHP", detail: coveredDays(c.purchase) || "Belum ada" },
    { name: "Inventory HK (Google Sheets)", detail: when(state("hk")?.last_checked_at) },
    { name: "DML (Google Sheets)", detail: when(state("dml")?.last_checked_at) },
  ];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-bold text-slate-900">Sumber data</h2>
      <p className="mt-1 text-base text-slate-600">Tanggal yang sudah diunggah per jenis data, dan waktu terakhir Google Sheets ditarik.</p>
      <dl className="mt-4 divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.name} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
            <dt className="text-base font-semibold text-slate-800">{r.name}</dt>
            <dd className="text-base tabular-nums text-slate-600">{r.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
