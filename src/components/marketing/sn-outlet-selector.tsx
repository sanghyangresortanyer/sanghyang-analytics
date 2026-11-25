"use client";

import { Building2, Fish, Headphones, Hotel, Mic2, Sparkles, Star, Utensils, type LucideIcon } from "lucide-react";
import { SkeuoCard } from "@/components/skeuo/ui";
import { OUTLET_TABS, type OutletChoice, type SnOutletInfo, type SnSummary } from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";

const OUTLET_ICONS: Record<OutletChoice, LucideIcon> = {
  all: Building2,
  "sunset-grill": Fish,
  "dragon-beach-club": Headphones,
  resort: Hotel,
  dbistro: Utensils,
  dbar: Mic2,
  dspa: Sparkles,
};

/**
 * Grid pemilih unit bisnis Sanghyang (ikon, rating Google, jumlah ulasan, dan badge Sedang Aktif)
 * Selector outlet untuk tampilan Insight Pasar & Strategy Sanghyang Analytics.
 */
export function SnOutletSelector({
  selectedOutlet,
  outlets,
  summary,
  onSelectOutlet,
  outletKeys,
  eyebrow = "Unit Bisnis Sanghyang",
  title = "Pilih unit bisnis yang ingin dianalisis",
  description = "Klik salah satu outlet di bawah untuk menyesuaikan seluruh urutan analisis 5 langkah.",
  titleId,
  gridClassName = "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7",
}: {
  selectedOutlet: OutletChoice;
  outlets: SnOutletInfo[];
  summary: SnSummary | null;
  onSelectOutlet: (key: OutletChoice) => void;
  outletKeys?: OutletChoice[];
  eyebrow?: string;
  title?: string;
  description?: string;
  titleId?: string;
  gridClassName?: string;
}) {
  const activeOutlet = outlets.find((o) => o.key === selectedOutlet);
  const tabs = outletKeys ? OUTLET_TABS.filter((t) => outletKeys.includes(t.key)) : OUTLET_TABS;

  return (
    <SkeuoCard className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-300 pb-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">{eyebrow}</p>
          <h3 id={titleId} className="mt-0.5 text-lg font-semibold text-navy-900">
            {title}
          </h3>
          <p className="text-xs text-navy-600">{description}</p>
        </div>

        {activeOutlet && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-cream-300 bg-cream-50 px-3.5 py-1.5 text-xs">
            <span className="font-medium text-navy-600">Sedang Aktif:</span>
            <span className="font-bold text-navy-900">{activeOutlet.name}</span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-cream-300 bg-white px-2 py-0.5 font-bold text-navy-900">
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" aria-hidden />
              <span className="tabular-nums">
                {activeOutlet.rating === null ? "—" : activeOutlet.rating.toLocaleString("id-ID")}/5 (
                {activeOutlet.reviewCount.toLocaleString("id-ID")} ulasan)
              </span>
            </span>
          </div>
        )}
      </div>

      <div className={cn("grid gap-2.5", gridClassName)}>
        {tabs.map((ot) => {
          const isSelected = selectedOutlet === ot.key;
          const outletData = outlets.find((o) => o.key === ot.key);
          const Icon = OUTLET_ICONS[ot.key];

          return (
            <button
              key={ot.key}
              type="button"
              onClick={() => onSelectOutlet(ot.key)}
              aria-pressed={isSelected}
              className={cn(
                "flex flex-col items-center justify-center rounded-2xl p-3 text-center transition-all",
                isSelected
                  ? "border-2 border-navy-900 bg-navy-900 text-cream-50 shadow-sm"
                  : "border border-cream-300 bg-white text-navy-700 hover:border-navy-600 hover:bg-cream-50",
              )}
            >
              <div
                className={cn(
                  "rounded-xl p-2",
                  isSelected ? "bg-white/15 text-cream-50" : "bg-cream-100 text-navy-800",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <span className={cn("mt-2 text-xs font-bold leading-tight", isSelected ? "text-white" : "text-navy-900")}>
                {ot.label}
              </span>
              <span className={cn("mt-1 text-[10px]", isSelected ? "text-cream-200" : "text-navy-500")}>
                {ot.key === "all"
                  ? summary?.syncStatus
                    ? `${summary.syncStatus.totalReviews.toLocaleString("id-ID")} Ulasan`
                    : "Semua"
                  : outletData
                    ? `${outletData.rating === null ? "—" : outletData.rating.toLocaleString("id-ID")} · ${outletData.reviewCount.toLocaleString("id-ID")} ulasan`
                    : "Unit"}
              </span>
            </button>
          );
        })}
      </div>
    </SkeuoCard>
  );
}
