"use client";

import { useState } from "react";
import type { DmlLineRow, DmlSheetSummary, HkItemRow, SyncState } from "@/lib/sheets/queries";
import { DmlSection } from "./dml-section";
import { HkSection } from "./hk-section";

interface LocationItemUsage {
  code: string;
  name: string;
  unit: string | null;
  qty: number;
  averagePrice: number | null;
  cost: number | null;
}

export interface LocationUsageGroup {
  label: string;
  value: number;
  entries: number;
  unpriced: number;
  items: LocationItemUsage[];
}

const TABS = [
  { id: "hk", label: "HK Housekeeping" },
  { id: "dml", label: "DML" },
] as const;

/** The two Google Sheets: HK (Housekeeping) and DML, one tab each. */
export function SheetsDashboardTabs({
  initialTab = "hk",
  states,
  dmlSheets,
  selectedDmlSheet,
  dmlLines,
  hkItems,
  hkUsageGroups,
  hkMonths = [],
}: {
  initialTab?: "hk" | "dml";
  states: SyncState[];
  dmlSheets: DmlSheetSummary[];
  selectedDmlSheet: DmlSheetSummary | undefined;
  dmlLines: DmlLineRow[];
  hkItems: HkItemRow[];
  hkUsageGroups: LocationUsageGroup[];
  /** Month tabs of the HK sheet, newest first; a picker shows when there is more than one. */
  hkMonths?: string[];
}) {
  const [override, setOverride] = useState<{ base: "hk" | "dml"; tab: "hk" | "dml" } | null>(null);
  const tab: "hk" | "dml" = override && override.base === initialTab ? override.tab : initialTab;
  const synced = (source: string) => states.find((s) => s.source === source)?.last_checked_at ?? null;
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl bg-slate-100 p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOverride({ base: initialTab, tab: t.id })}
            aria-pressed={tab === t.id}
            className={`rounded-lg px-5 py-2.5 text-base font-bold transition ${tab === t.id ? "bg-navy-800 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "hk" ? (
        <HkSection items={hkItems} usage={hkUsageGroups} syncedAt={synced("hk")} months={hkMonths} />
      ) : (
        <DmlSection sheets={dmlSheets} selected={selectedDmlSheet} lines={dmlLines} syncedAt={synced("dml")} />
      )}
    </div>
  );
}
