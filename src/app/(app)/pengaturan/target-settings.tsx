"use client";

import { useActionState, useState } from "react";
import { saveOutletTargets } from "@/lib/actions/targets";
import { parseRupiah, type OutletTarget } from "@/lib/dashboard/outlet-targets";
import { formatRpShort } from "@/lib/format-currency";

const INPUT = "h-10 w-48 rounded-lg border border-slate-300 px-3 text-right text-base tabular-nums outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-100";
const asText = (n: number) => (n > 0 ? n.toLocaleString("id-ID") : "");

function TargetRow({ target }: { target: OutletTarget }) {
  const [text, setText] = useState(asText(target.monthlyTarget));
  const value = parseRupiah(text);
  const id = `target-${target.outlet}`;
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2">
        <label htmlFor={id} className="text-base font-semibold text-slate-900">{target.outlet}</label>
        <input type="hidden" name="outlet" value={target.outlet} />
        <input type="hidden" name="version" value={target.version} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-base text-slate-500">Rp</span>
          <input
            id={id}
            name="target"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => value !== null && setText(asText(value))}
            aria-invalid={value === null}
            className={`${INPUT} ${value === null ? "border-red-400" : ""}`}
          />
        </div>
      </td>
      <td className="px-3 py-2 text-base text-slate-600">
        {value === null ? <span className="text-red-700">Tulis angka saja</span> : value === 0 ? "Tanpa target (kartu tidak tampil)" : `${formatRpShort(value)} per bulan`}
      </td>
    </tr>
  );
}

/** Pengaturan → Target bulanan per outlet; the dashboard's target cards read these. */
export function TargetSettings({ targets }: { targets: OutletTarget[] }) {
  const [state, action, saving] = useActionState(saveOutletTargets, undefined);
  // A new version after saving remounts the rows, so they show what is stored now.
  const formKey = targets.map((t) => `${t.outlet}:${t.version}`).join("|");

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-bold text-slate-900">Target Revenue Bulanan per Outlet</h2>
      <p className="mt-1 text-base text-slate-600">
        Dipakai kartu &quot;Target bulanan&quot; di dasbor, dibanding angka laporan revenue VHP. Kosongkan bila outlet tidak punya target.
      </p>
      <form key={formKey} action={action} className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-sm font-semibold text-slate-600">
                <th className="px-3 py-2">Outlet</th>
                <th className="px-3 py-2">Target per bulan</th>
                <th className="px-3 py-2">Dibaca</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <TargetRow key={t.outlet} target={t} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="h-10 rounded-lg bg-navy-800 px-5 text-base font-semibold text-white hover:bg-navy-900 disabled:opacity-50">
            {saving ? "Menyimpan..." : "Simpan Target"}
          </button>
          {state?.error && <p className="text-base font-medium text-red-700">{state.error}</p>}
          {state?.ok && <p className="text-base font-medium text-emerald-700">{state.ok}</p>}
        </div>
      </form>
    </section>
  );
}
