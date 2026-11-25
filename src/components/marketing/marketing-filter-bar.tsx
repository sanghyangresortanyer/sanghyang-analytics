"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, RotateCcw } from "lucide-react";
import { Bars } from "@/components/ui/bars";
import { fmtDateShort } from "@/lib/marketing/market-intelligence-types";

const FIELD =
  "h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-100";

const SECTIONS_WITH_VIEW = new Set(["sosmed", "insight-pasar", "media-sosial", "strategy"]);
const SECTIONS_WITH_OUTLET = new Set(["insight-pasar", "strategy"]);

/**
 * Menyusun parameter URL filter periode Marketing.
 * Tab Google Ads hanya memiliki satu laporan terpadu (tanpa sub-tab harian/mingguan/chat)
 * dan Meta Ads tanpa sub-tab, sehingga parameter `lihat` lama seperti `lihat=chat` tidak ditempelkan.
 */
export function buildMarketingFilterParams({
  section,
  view,
  outlet,
  range,
}: {
  section: string;
  view?: string | null;
  outlet?: string | null;
  range?: { startDate: string; endDate: string } | null;
}): URLSearchParams {
  const params = new URLSearchParams();
  const normalizedSection = section || "google";
  params.set("bagian", normalizedSection);
  if (view && SECTIONS_WITH_VIEW.has(normalizedSection)) {
    params.set("lihat", view);
  }
  if (outlet && SECTIONS_WITH_OUTLET.has(normalizedSection)) {
    params.set("outlet", outlet);
  }
  if (range) {
    params.set("startDate", range.startDate);
    params.set("endDate", range.endDate);
  }
  return params;
}

/**
 * Filter periode global halaman Marketing (gaya selaras DashboardFilterBar).
 * Membaca parameter URL aktif (`bagian`, `lihat`, `outlet`) agar pilihan tab dan outlet
 * tetap dipertahankan saat filter tanggal diterapkan atau direset di seluruh 6 tab.
 */
export function MarketingFilterBar({
  section,
  view,
  outlet,
  activeStartDate,
  activeEndDate,
  isCustomRange,
  maxDate,
}: {
  section: string;
  view?: string;
  outlet?: string;
  activeStartDate: string;
  activeEndDate: string;
  isCustomRange: boolean;
  maxDate: string;
}) {
  const router = useRouter();
  const currentParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(activeStartDate);
  const [endDate, setEndDate] = useState(activeEndDate);
  const [error, setError] = useState<string | null>(null);

  const buildBaseParams = (range?: { startDate: string; endDate: string } | null) =>
    buildMarketingFilterParams({
      section: currentParams.get("bagian") ?? section,
      view: currentParams.get("lihat") ?? view,
      outlet: currentParams.get("outlet") ?? outlet,
      range,
    });

  const navigate = (params: URLSearchParams) =>
    startTransition(() => {
      router.push(`/marketing?${params.toString()}`, { scroll: false });
    });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) {
      setError("Isi tanggal awal dan tanggal akhir terlebih dahulu.");
      return;
    }
    if (startDate > endDate) {
      setError("Tanggal awal tidak boleh lebih besar dari tanggal akhir.");
      return;
    }
    setError(null);
    navigate(buildBaseParams({ startDate, endDate }));
  }

  function handleReset() {
    setError(null);
    navigate(buildBaseParams(null));
  }

  return (
    <div
      aria-busy={pending}
      className="skeuo-card flex flex-wrap items-center justify-between gap-4 px-5 py-3.5"
    >
      <form onSubmit={handleSubmit} className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
        <span className="inline-flex items-center gap-2 text-base font-semibold text-slate-800">
          <CalendarRange className="h-5 w-5 text-navy-700" aria-hidden />
          Periode
        </span>
        <div className="flex w-full items-center gap-2 sm:w-auto [&>input]:flex-1">
          <input
            type="date"
            value={startDate}
            max={maxDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Dari tanggal"
            className={FIELD}
          />
          <span className="text-base text-slate-500">s.d.</span>
          <input
            type="date"
            value={endDate}
            max={maxDate}
            onChange={(e) => setEndDate(e.target.value)}
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
        {isCustomRange && (
          <button
            type="button"
            onClick={handleReset}
            className="skeuo-pill-light inline-flex h-11 items-center gap-2 rounded-full px-4 text-base font-semibold"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Reset
          </button>
        )}
      </form>

      <div className="text-xs font-medium text-navy-600">
        {isCustomRange ? (
          <span className="inline-flex items-center rounded-full border border-navy-200 bg-cream-100 px-3 py-1 font-semibold text-navy-900">
            Filter aktif: {fmtDateShort(activeStartDate)} – {fmtDateShort(activeEndDate)}
          </span>
        ) : (
          <span>Periode bawaan aktif di semua tab · tekan Terapkan untuk menyaring rentang tertentu</span>
        )}
      </div>

      {error && (
        <p role="alert" className="w-full text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
