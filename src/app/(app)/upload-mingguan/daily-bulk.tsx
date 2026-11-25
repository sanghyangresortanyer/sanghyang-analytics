"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Files, Loader2 } from "lucide-react";
import { saveWeeklyMeeting } from "@/lib/actions/weekly-meeting";
import { closingWarning, periodWarnings } from "@/lib/dashboard/period-check";
import { isFoTurnoverReport, parseFoTurnoverReport } from "@/lib/parsers/fo-turnover-parser";

type Kind = "revenue" | "penjualan" | "jurnalFo" | "pembelian";

interface DayGroup {
  start: string;
  end: string;
  files: Partial<Record<Kind, File>>;
  status: "siap" | "menyimpan" | "tersimpan" | "gagal" | "dilewati";
  message?: string;
  /** Period looks mistyped (misses the 1st, the month end, or runs through today). */
  warnings: string[];
}

const KINDS: { re: RegExp; kind: Kind }[] = [
  { re: /F\/O\s+Turnover/i, kind: "revenue" },
  { re: /F\/O\s+Journal\s+Transaction/i, kind: "jurnalFo" },
  { re: /Transaction\s+Journal/i, kind: "penjualan" },
  { re: /Receiving\s+List/i, kind: "pembelian" },
];
const PERIOD_RE = /Period\s*:\s*(\d{2})\/(\d{2})\/(\d{2,4})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})/i;
const year = (y: string) => (y.length === 2 ? `20${y}` : y);
const label = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Kind and period from the report's own first page, so file names do not matter. */
async function identify(file: File): Promise<{ kind: Kind; start: string; end: string } | null> {
  const head = (await file.slice(0, 4000).text()) ?? "";
  const kind = KINDS.find((k) => k.re.test(head))?.kind;
  const p = head.match(PERIOD_RE);
  if (!kind || !p) return null;
  return { kind, start: `${year(p[3])}-${p[2]}-${p[1]}`, end: `${year(p[6])}-${p[5]}-${p[4]}` };
}

/**
 * Many VHP exports at once (one revenue report per day, plus Penjualan per Artikel and
 * Pembelian for the same day when there are any). Files are grouped by the period printed in
 * them and every group is saved as its own upload, in date order.
 */
export function DailyBulkUpload() {
  const router = useRouter();
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  async function pick(list: FileList | null) {
    const files = [...(list ?? [])];
    const byPeriod = new Map<string, DayGroup>();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const notRead: string[] = [];
    for (const f of files) {
      const id = await identify(f);
      if (!id) {
        notRead.push(f.name);
        continue;
      }
      const key = `${id.start}|${id.end}`;
      const g = byPeriod.get(key) ?? { start: id.start, end: id.end, files: {}, status: "siap" as const, warnings: periodWarnings(id.start, id.end, today) };
      g.files[id.kind] = f;
      if (id.kind === "revenue") {
        // Room revenue 0 on the last day: VHP had not closed that day yet (owner, 2026-11-22).
        const text = await f.text();
        const w = isFoTurnoverReport(text) ? closingWarning(parseFoTurnoverReport(text).lastDayLodging, id.end) : null;
        if (w && !g.warnings.includes(w)) g.warnings = [...g.warnings, w];
      }
      byPeriod.set(key, g);
    }
    const sorted = [...byPeriod.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    setGroups(sorted);
    setUnknown(notRead);
  }

  async function saveAll() {
    setRunning(true);
    const next = [...groups];
    for (let i = 0; i < next.length; i++) {
      const g = next[i];
      if (g.status !== "siap" && g.status !== "gagal") continue;
      next[i] = { ...g, status: "menyimpan", message: undefined };
      setGroups([...next]);
      const fd = new FormData();
      fd.set("meetingDate", g.end);
      fd.set("periodStart", g.start);
      fd.set("periodEnd", g.end);
      const kind = g.files.revenue || g.files.penjualan || g.files.jurnalFo ? "Harian" : "Pembelian";
      fd.set("title", g.start === g.end ? `${kind} ${label(g.start)}` : `${kind} ${label(g.start)}–${label(g.end)}`);
      if (g.files.revenue) fd.set("revenueFile", g.files.revenue);
      if (g.files.penjualan) fd.set("journalFile", g.files.penjualan);
      if (g.files.jurnalFo) fd.set("foJournalFile", g.files.jurnalFo);
      if (g.files.pembelian) fd.set("purchaseFile", g.files.pembelian);
      try {
        const res = await saveWeeklyMeeting(fd);
        next[i] = res.ok ? { ...g, status: "tersimpan" } : { ...g, status: "gagal", message: res.error };
      } catch (e) {
        next[i] = { ...g, status: "gagal", message: e instanceof Error ? e.message : "Gagal menyimpan" };
      }
      setGroups([...next]);
    }
    setRunning(false);
    router.refresh();
  }

  const ready = groups.filter((g) => g.status === "siap" || g.status === "gagal").length;
  const done = groups.filter((g) => g.status === "tersimpan").length;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-start gap-3">
        <Files className="mt-0.5 h-5 w-5 shrink-0 text-emerald-800" />
        <div>
          <h2 className="text-xl font-bold text-slate-900">Pilih file dari VHP</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Boleh banyak file sekaligus: Laporan revenue, Penjualan per Artikel, F/O Journal, dan Pembelian (Receiving List).
            Tanggal dan jenis file dibaca dari isi file, jadi nama file bebas.
          </p>
        </div>
      </div>

      <input
        type="file"
        accept=".txt"
        multiple
        disabled={running}
        onChange={(e) => pick(e.target.files)}
        className="text-sm text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-emerald-800 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
      />

      {unknown.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Tidak dikenali (dilewati): {unknown.join(", ")}</span>
        </div>
      )}

      {groups.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Tanggal</th>
                  <th className="py-2 pr-3">Revenue</th>
                  <th className="py-2 pr-3">Penjualan</th>
                  <th className="py-2 pr-3">F/O Journal</th>
                  <th className="py-2 pr-3">Pembelian</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((g) => (
                  <tr key={`${g.start}|${g.end}`}>
                    <td className="py-1.5 pr-3 font-semibold tabular-nums text-slate-800">
                      {g.start === g.end ? label(g.start) : `${label(g.start)}–${label(g.end)}`}
                      {g.warnings.map((w) => (
                        <span key={w} className="mt-0.5 flex items-start gap-1 text-xs font-medium text-amber-800">
                          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                          {w}
                        </span>
                      ))}
                    </td>
                    {(["revenue", "penjualan", "jurnalFo", "pembelian"] as const).map((k) => (
                      <td key={k} className="py-1.5 pr-3 text-slate-600">
                        {g.files[k] ? "✓" : "—"}
                      </td>
                    ))}
                    <td className="py-1.5 text-slate-700">
                      {g.status === "menyimpan" && <Loader2 className="inline h-4 w-4 animate-spin" />}
                      {g.status === "tersimpan" && <CheckCircle2 className="inline h-4 w-4 text-emerald-600" />} {g.status}
                      {g.message && <span className="block text-xs text-rose-700">{g.message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {done} tersimpan · {ready} siap. Periode yang sudah pernah diunggah diganti dengan file baru.
            </p>
            <button
              type="button"
              onClick={saveAll}
              disabled={running || ready === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {running && <Loader2 className="h-4 w-4 animate-spin" />}
              {running ? "Menyimpan..." : `Simpan ${ready} periode`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
