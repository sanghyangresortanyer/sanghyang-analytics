"use client";

import { useState, useTransition } from "react";
import { SkeuoCard } from "@/components/skeuo/ui";
import { ignorePromoEvent, pullPromos, type PromoActionState } from "@/lib/actions/social-promo";
import { formatRp } from "@/lib/format-currency";
import { rangeText } from "@/lib/format-date";
import type { PromoAuditItem, PromoVerdict } from "@/lib/marketing/social-promo";
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

/** Marketing → Sosmed → Audit Promo: fills itself from Instagram (owner, 24 Nov); "Abaikan" removes a wrong one. */
export function SocialPromoAuditView({
  audits,
  problem,
  dataUntil,
  startDate,
  endDate,
  isCustomRange,
}: {
  audits: PromoAuditItem[];
  problem: string | null;
  dataUntil: string | null;
  startDate?: string;
  endDate?: string;
  isCustomRange?: boolean;
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
  const hasRange = Boolean(isCustomRange && startDate && endDate);
  const visibleAudits = hasRange
    ? audits.filter((a) => a.event.post_date >= startDate! && a.event.post_date <= endDate!)
    : audits;
  // One card per post: its menus together.
  const posts = new Map<string, PromoAuditItem[]>();
  for (const a of visibleAudits) {
    const key = `${a.event.source_post_id ?? a.event.post_url ?? ""}|${a.event.post_date}|${a.event.outlet_name}`;
    posts.set(key, [...(posts.get(key) ?? []), a]);
  }
  return (
    <div className="space-y-4">
      <SkeuoCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-navy-900">Audit promo Instagram</h2>
            <p className="mt-1 text-base text-navy-600">
              Penjualan menu promo di kasir, 7 hari sebelum dibanding 7 hari sejak tayang. Data kasir sampai {dataUntil ? rangeText(dataUntil, dataUntil) : "belum ada"}.
            </p>
            {hasRange && (
              <p className="mt-1 text-sm font-medium text-navy-700">
                Periode dipilih: {rangeText(startDate!, endDate!)} ({visibleAudits.length} dari {audits.length} audit promo).
              </p>
            )}
          </div>
          <button type="button" disabled={busy} onClick={() => run(pullPromos)} className="skeuo-pill-dark rounded-full px-5 py-2.5 text-base font-semibold disabled:opacity-60">
            {busy ? "Sedang menarik..." : "Tarik data"}
          </button>
        </div>
        <div aria-live="polite">
          {state?.error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">{state.error}</p>}
          {state?.ok && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-900">{state.ok}</p>}
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
          {problem && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">{problem}</p>}
        </div>
        <p className="mt-3 text-sm text-navy-600">
          Promo dikenali dari teks postingan, bukan dari foto. Yang salah tekan Abaikan. Naik atau tidaknya penjualan belum tentu karena postingan.
        </p>
      </SkeuoCard>
      {audits.length === 0 && !problem && (
        <SkeuoCard>
          <p className="text-base text-navy-700">Belum ada data. Tekan Tarik data.</p>
        </SkeuoCard>
      )}
      {hasRange && visibleAudits.length === 0 && audits.length > 0 && (
        <SkeuoCard>
          <p className="text-base text-navy-700">
            Tidak ada audit promo pada periode {rangeText(startDate!, endDate!)} (ada {audits.length} promo di luar rentang ini).
          </p>
        </SkeuoCard>
      )}
      {[...posts.entries()].map(([key, items]) => (
        <SkeuoCard key={key}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-navy-900">
              {items[0].event.outlet_name} · tayang {rangeText(items[0].event.post_date, items[0].event.post_date)}
            </h3>
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
        </SkeuoCard>
      ))}
    </div>
  );
}
