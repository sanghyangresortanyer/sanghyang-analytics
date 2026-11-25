"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, RotateCcw } from "lucide-react";
import { Bars } from "@/components/ui/bars";
import { dashboardFilterKey, normalizeDashboardRange, type DashboardFilterMode } from "@/lib/dashboard/filter-range";

const FIELD = "h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-100";

/** Date range only: uploads are daily, so a picker of upload sessions is no longer needed (user 2026-11-18). */
export function DashboardFilterBar({
  activeMode,
  activeStartDate,
  activeEndDate,
}: {
  activeMode: DashboardFilterMode;
  activeStartDate: string;
  activeEndDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const baseKey = dashboardFilterKey(activeMode, activeStartDate, activeEndDate);
  const [draft, setDraft] = useState<{ base: string; startDate: string; endDate: string } | null>(null);
  const startDate = draft && draft.base === baseKey ? draft.startDate : activeStartDate;
  const endDate = draft && draft.base === baseKey ? draft.endDate : activeEndDate;

  const go = (href: string) => startTransition(() => router.push(href, { scroll: false }));

  function handleRangeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) return;
    const normalized = normalizeDashboardRange(startDate, endDate);
    setDraft(
      normalized.startDate === activeStartDate && normalized.endDate === activeEndDate
        ? null
        : { base: baseKey, startDate: normalized.startDate, endDate: normalized.endDate },
    );
    go(`/?${new URLSearchParams({ mode: "range", startDate: normalized.startDate, endDate: normalized.endDate })}`);
  }

  return (
    <div
      aria-busy={pending}
      className="skeuo-card flex flex-wrap items-center justify-between gap-4 px-5 py-3.5"
    >
      <form onSubmit={handleRangeSubmit} className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
        <span className="inline-flex items-center gap-2 text-base font-semibold text-slate-800">
          <CalendarRange className="h-5 w-5 text-navy-700" />
          Periode
        </span>
        <div className="flex w-full items-center gap-2 sm:w-auto [&>input]:flex-1">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setDraft({ base: baseKey, startDate: e.target.value, endDate })}
            aria-label="Dari tanggal"
            className={FIELD}
          />
          <span className="text-base text-slate-500">s.d.</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setDraft({ base: baseKey, startDate, endDate: e.target.value })}
            aria-label="Sampai tanggal"
            className={FIELD}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="skeuo-pill-dark inline-flex h-11 min-w-28 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold hover:brightness-125 disabled:opacity-70"
        >
          {pending ? <Bars className="h-4 w-4" /> : null}
          {pending ? "Memuat…" : "Terapkan"}
        </button>
        {activeMode === "range" && (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              go("/");
            }}
            className="skeuo-pill-light inline-flex h-11 items-center gap-2 rounded-full px-4 text-base font-semibold"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        )}
      </form>

    </div>
  );
}
