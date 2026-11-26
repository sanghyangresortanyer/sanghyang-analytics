"use client";

import { useState, useTransition } from "react";
import { ignorePromoEvent, pullPromos, type PromoActionState } from "@/lib/actions/social-promo";
import { formatRp } from "@/lib/format-currency";
import { rangeText } from "@/lib/format-date";
import { OUTLET_TABS, type OutletChoice } from "@/lib/marketing/market-intelligence-types";
import { PROMO_AUDIT_OUTLETS } from "@/lib/marketing/promo-detect";
import { auditsForOutlet, auditsInPeriod, type PromoAuditItem, type PromoVerdict } from "@/lib/marketing/social-promo";
import { cn } from "@/lib/utils";

const LABEL: Record<PromoVerdict, { text: string; tone: string }> = {
  NAIK: { text: "Penjualan naik", tone: "bg-emerald-100 text-emerald-900" },
  NAIK_TIPIS: { text: "Naik tipis", tone: "bg-amber-100 text-amber-900" },
  TIDAK_NAIK: { text: "Tidak naik", tone: "bg-rose-100 text-rose-900" },
  SEDIKIT: { text: "Terlalu sedikit", tone: "bg-cream-200 text-navy-700" },
  MENUNGGU_DATA: { text: "Menunggu data", tone: "bg-cream-200 text-navy-700" },
};
const num = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 1 });

function Audit({ item, busy, onIgnore }: { item: PromoAuditItem; busy: boolean; onIgnore: () => void }) {
  const { event, lift, menus } = item;
  const label = LABEL[lift.verdict];
  const max = Math.max(1, ...lift.days.map((d) => d.qty));
  const side = (after: boolean) => lift.days.filter((d) => d.after === after);
  const range = (after: boolean) => rangeText(side(after)[0].date, side(after).at(-1)!.date);
  return (
    <li className="border-t border-cream-200 py-4 first:border-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-navy-900">{event.menu_keyword === "*" ? "Semua menu" : event.menu_keyword}</p>
          <p className="text-sm text-navy-600">{event.promo_title}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", label.tone)}>{label.text}</span>
          <button type="button" disabled={busy} onClick={onIgnore} className="skeuo-pill-light rounded-full px-3 py-1 text-sm font-semibold text-navy-700 disabled:opacity-50">
            Abaikan
          </button>
        </div>
      </div>
      <p className="mt-2 text-base text-navy-800">{lift.reason}</p>
      <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-navy-700 sm:grid-cols-2">
        <p>
          Sebelum ({range(false)}): <b className="tabular-nums">{num(lift.beforeQty)} porsi</b>, {formatRp(lift.beforeAmount)}
        </p>
        <p>
          Sejak tayang ({range(true)}): <b className="tabular-nums">{num(lift.afterQty)} porsi</b>, {formatRp(lift.afterAmount)}
          {lift.afterDays < 7 && ` (data ${lift.afterDays} hari)`}
        </p>
      </div>
      <div className="mt-3 flex h-16 items-end gap-1" role="img" aria-label={`Porsi per hari: ${lift.days.map((d) => `${d.date} ${d.hasData ? num(d.qty) : "belum ada data"}`).join(", ")}`}>
        {lift.days.map((d) => (
          <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${rangeText(d.date, d.date)}: ${d.hasData ? `${num(d.qty)} porsi` : "Belum ada data"}`}>
            <div className={cn("w-full rounded-t", !d.hasData ? "bg-transparent" : d.after ? "bg-emerald-700" : "bg-navy-400")} style={{ height: d.hasData ? `${Math.max(3, (d.qty / max) * 100)}%` : 0 }} />
            <span className={cn("mt-1 text-center text-xs leading-none", d.isPost ? "font-bold text-navy-900" : "text-navy-500")}>{Number(d.date.slice(8))}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-navy-600">
        {menus.length === 0 ? "Tidak ada penjualan menu ini di kasir dalam 14 hari itu." : `Menu yang dihitung: ${menus.slice(0, 6).join(", ")}${menus.length > 6 ? `, dan ${menus.length - 6} lainnya` : ""}.`}
      </p>
    </li>
  );
}

/**
 * Marketing → Media Sosial → Audit Promo Outlet: the chosen outlet's audits in the active period. Fills itself from
 * Instagram with "Tarik data" (owner, 24 Nov); "Abaikan" removes a wrong one.
 */
export function SocialPromoAuditView({
  audits,
  problem,
  dataUntil,
  startDate,
  endDate,
  outlet,
  outletLabel,
  metaProblem = null,
}: {
  audits: PromoAuditItem[];
  problem: string | null;
  dataUntil: string | null;
  startDate: string;
  endDate: string;
  outlet: OutletChoice;
  outletLabel: string;
  /** Why Meta cannot be read now; "Tarik data" depends on it, so the reason sits next to the button. */
  metaProblem?: string | null;
}) {
  const [state, setState] = useState<PromoActionState>();
  const [busy, start] = useTransition();
  const run = (job: () => Promise<PromoActionState>) =>
    start(async () => {
      try {
        setState(await job());
      } catch {
        setState({ error: "Tidak bisa menghubungi server. Coba lagi." });
      }
    });
  const range = rangeText(startDate, endDate);
  const outletAudits = auditsForOutlet(audits, outlet);
  const visibleAudits = auditsInPeriod(outletAudits, startDate, endDate);
  const hasTill = outlet === "all" || PROMO_AUDIT_OUTLETS.includes(outlet);
  const tillOutlets = OUTLET_TABS.filter((t) => (PROMO_AUDIT_OUTLETS as readonly string[]).includes(t.key)).map((t) => t.label);
  // One block per post: its menus together.
  const posts = new Map<string, PromoAuditItem[]>();
  for (const a of visibleAudits) {
    const key = `${a.event.source_post_id ?? a.event.post_url ?? ""}|${a.event.post_date}|${a.event.outlet_name}`;
    posts.set(key, [...(posts.get(key) ?? []), a]);
  }
  const empty = !hasTill
    ? `Belum ada data pada ${range}. Audit promo membandingkan penjualan menu kasir, dan menu kasir hanya tercatat untuk ${tillOutlets.join(", ")}.`
    : outletAudits.length === 0
      ? `Belum ada data pada ${range}. Tekan Tarik data untuk membaca postingan promo terbaru.`
      : visibleAudits.length === 0
        ? `Belum ada data pada ${range}. Ada ${outletAudits.length} audit promo di luar rentang ini.`
        : null;

  return (
    <section aria-labelledby="audit-promo-outlet" className="skeuo-card space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cream-300 pb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Audit Promo Outlet</p>
          <h3 id="audit-promo-outlet" className="mt-0.5 text-lg font-semibold text-navy-900">
            {outletLabel} · {range}
          </h3>
          <p className="mt-1 text-sm text-navy-600">
            Penjualan menu promo di kasir, 7 hari sebelum dibanding 7 hari sejak tayang. Data kasir sampai {dataUntil ? rangeText(dataUntil, dataUntil) : "belum ada"}.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => run(pullPromos)} className="skeuo-pill-dark rounded-full px-5 py-2.5 text-base font-semibold disabled:opacity-60">
          {busy ? "Sedang menarik..." : "Tarik data"}
        </button>
      </div>
      {metaProblem && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Tarik data membaca postingan terbaru dari Meta, dan saat ini Meta belum bisa dibaca: {metaProblem}
        </p>
      )}
      <div aria-live="polite">
        {state?.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">{state.error}</p>}
        {state?.ok && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-900">{state.ok}</p>}
        {state?.links && state.links.length > 0 && (
          <p className="mt-2 text-sm text-navy-700">
            Menu tidak dikenali:{" "}
            {state.links.map((l, i) => (
              <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="mr-2 underline">
                postingan {i + 1}
              </a>
            ))}
          </p>
        )}
      </div>
      {problem && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">
          {problem}
        </p>
      )}
      {empty ? (
        <p className="rounded-xl bg-cream-100 px-4 py-6 text-center text-base text-navy-700">{empty}</p>
      ) : (
        <div className="space-y-3">
          {[...posts.entries()].map(([key, items]) => (
            <article key={key} className="rounded-xl border border-cream-300 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-lg font-semibold text-navy-900">
                  {items[0].event.outlet_name} · tayang {rangeText(items[0].event.post_date, items[0].event.post_date)}
                </h4>
                {items[0].event.post_url && (
                  <a href={items[0].event.post_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-navy-700 underline">
                    Buka di Instagram
                  </a>
                )}
              </div>
              <ul>
                {items.map((item) => (
                  <Audit key={item.event.id} item={item} busy={busy} onIgnore={() => run(() => ignorePromoEvent(item.event.id))} />
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
      <p className="text-sm text-navy-600">
        Promo dikenali dari teks postingan, bukan dari foto. Yang salah tekan Abaikan. Naik atau tidaknya penjualan belum tentu karena postingan.
      </p>
    </section>
  );
}
