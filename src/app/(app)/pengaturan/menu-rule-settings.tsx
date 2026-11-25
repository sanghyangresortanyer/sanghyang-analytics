"use client";

import { useActionState } from "react";
import { saveMenuRules } from "@/lib/actions/settings";
import { MENU_RULE_LIMITS } from "@/lib/dashboard/menu-activity";
import type { MenuRuleSettings } from "@/lib/dashboard/settings-query";

const INPUT = "h-10 w-24 rounded-lg border border-slate-300 px-3 text-right text-base tabular-nums outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-100";

/** Pengaturan → Aturan menu tidak laku; the Revenue tab uses these limits. */
export function MenuRuleSettingsForm({ rules }: { rules: MenuRuleSettings }) {
  const [state, action, saving] = useActionState(saveMenuRules, undefined);
  const v = rules.versions;
  const L = MENU_RULE_LIMITS;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-xl font-bold text-slate-900">Aturan Menu Tidak Laku</h2>
      <p className="mt-1 text-base text-slate-600">Dipakai kartu &quot;Menu paling tidak laku&quot; di tab Revenue dan laporan 1 halaman: menu yang masih terjual dalam jangka ini, diurutkan dari porsi paling sedikit.</p>
      <form key={`${v.dead_menu_days}|${v.slow_menu_days}|${v.slow_menu_below}`} action={action} className="mt-4 space-y-3">
        <input type="hidden" name="dead_menu_days_version" value={v.dead_menu_days} />
        <input type="hidden" name="slow_menu_days_version" value={v.slow_menu_days} />
        <input type="hidden" name="slow_menu_below_version" value={v.slow_menu_below} />
        <p className="flex flex-wrap items-center gap-2 text-base text-slate-800">
          <span className="font-semibold">Jangka:</span>
          <input name="dead_menu_days" aria-label="Jangka hari menu paling tidak laku" inputMode="numeric" defaultValue={rules.deadDays} className={INPUT} />
          hari terakhir <span className="text-slate-500">(90 hari = 3 bulan; menu yang tidak terjual sama sekali dalam jangka ini dianggap sudah tidak dijual; {L.deadDays.min}–{L.deadDays.max})</span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-base text-slate-800">
          <span className="font-semibold">Menu baru:</span> mulai dijual dalam
          <input name="slow_menu_days" aria-label="Hari menu baru" inputMode="numeric" defaultValue={rules.slowDays} className={INPUT} />
          hari terakhir, tidak ikut dihitung <span className="text-slate-500">(30 hari = 1 bulan)</span>
          {/* No longer used by the list (owner, 23 Nov); still sent so the saved value is kept. */}
          <input type="hidden" name="slow_menu_below" value={rules.slowBelow} />
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="h-10 rounded-lg bg-navy-800 px-5 text-base font-semibold text-white hover:bg-navy-900 disabled:opacity-50">
            {saving ? "Menyimpan..." : "Simpan Aturan Menu"}
          </button>
          {state?.error && <p className="text-base font-medium text-red-700">{state.error}</p>}
          {state?.ok && <p className="text-base font-medium text-emerald-700">{state.ok}</p>}
        </div>
      </form>
    </section>
  );
}
