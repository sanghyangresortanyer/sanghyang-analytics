"use client";

import { useActionState, useState } from "react";
import { saveDivisionBudgets } from "@/lib/actions/settings";
import type { DivisionBudget } from "@/lib/dashboard/division-budgets";
import { parseRupiah } from "@/lib/dashboard/outlet-targets";
import { formatRpShort } from "@/lib/format-currency";

const INPUT = "h-10 w-48 rounded-lg border border-slate-300 px-3 text-right text-base tabular-nums outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-100";
const asText = (n: number) => (n > 0 ? n.toLocaleString("id-ID") : "");

function BudgetRow({ budget }: { budget: DivisionBudget }) {
  const [text, setText] = useState(asText(budget.monthlyBudget));
  const value = parseRupiah(text);
  const id = `budget-${budget.division}`;
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2">
        <label htmlFor={id} className="text-base font-semibold text-slate-900">{budget.division}</label>
        <input type="hidden" name="division" value={budget.division} />
        <input type="hidden" name="version" value={budget.version} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-base text-slate-500">Rp</span>
          <input
            id={id}
            name="budget"
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
        {value === null ? <span className="text-red-700">Tulis angka saja</span> : value === 0 ? "Belum ada budget" : `${formatRpShort(value)} per bulan`}
      </td>
    </tr>
  );
}

/** Pengaturan → Budget belanja per divisi per bulan; the Pembelian tab compares purchases with it. */
export function BudgetSettings({ budgets }: { budgets: DivisionBudget[] }) {
  const [state, action, saving] = useActionState(saveDivisionBudgets, undefined);
  const formKey = budgets.map((b) => `${b.division}:${b.version}`).join("|");
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-bold text-slate-900">Budget Belanja per Divisi (per bulan)</h2>
      <p className="mt-1 text-base text-slate-600">
        Dibanding pembelian dari VHP bulan berjalan di tab Pembelian. Divisi mengikuti kelompok barang di VHP. Kosongkan bila belum ada budget.
      </p>
      <form key={formKey} action={action} className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-slate-200 text-sm font-semibold text-slate-600">
                <th className="px-3 py-2">Divisi</th>
                <th className="px-3 py-2">Budget per bulan</th>
                <th className="px-3 py-2">Dibaca</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <BudgetRow key={b.division} budget={b} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="h-10 rounded-lg bg-navy-800 px-5 text-base font-semibold text-white hover:bg-navy-900 disabled:opacity-50">
            {saving ? "Menyimpan..." : "Simpan Budget"}
          </button>
          {state?.error && <p className="text-base font-medium text-red-700">{state.error}</p>}
          {state?.ok && <p className="text-base font-medium text-emerald-700">{state.ok}</p>}
        </div>
      </form>
    </section>
  );
}
