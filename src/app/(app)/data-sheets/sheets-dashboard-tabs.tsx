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

/** A stock sheet besides HK, ready for the HK view (Main Store, Engineering, beverage store). */
export interface StoreTab {
  id: string;
  label: string;
  title: string;
  sheetName: string;
  items: HkItemRow[];
  usage: LocationUsageGroup[];
  months: string[];
}

const STORE_SPLIT_NOTE = 'Tujuan yang ditulis gabung (misal "kicen5,sg1") dibagi menurut angkanya; ejaan seperti kicen/kichen dan scrty/scurty disatukan.';

/** The Google Sheets: HK, the other stock sheets, and DML, one tab each. */
export function SheetsDashboardTabs({
  initialTab = "hk",
  states,
  dmlSheets,
  selectedDmlSheet,
  dmlLines,
  hkItems,
  hkUsageGroups,
  hkMonths = [],
  stores = [],
}: {
  initialTab?: string;
  states: SyncState[];
  dmlSheets: DmlSheetSummary[];
  selectedDmlSheet: DmlSheetSummary | undefined;
  dmlLines: DmlLineRow[];
  hkItems: HkItemRow[];
  hkUsageGroups: LocationUsageGroup[];
  /** Month tabs of the HK sheet, newest first; a picker shows when there is more than one. */
  hkMonths?: string[];
  stores?: StoreTab[];
}) {
  const tabs = [{ id: "hk", label: "HK Housekeeping" }, ...stores.map((s) => ({ id: s.id, label: s.label })), { id: "dml", label: "DML" }];
  const baseTab = tabs.some((t) => t.id === initialTab) ? initialTab : "hk";
  const [override, setOverride] = useState<{ base: string; tab: string } | null>(null);
  const tab = override && override.base === baseTab && tabs.some((t) => t.id === override.tab) ? override.tab : baseTab;
  const synced = (source: string) => states.find((s) => s.source === source)?.last_checked_at ?? null;
  const store = stores.find((s) => s.id === tab);

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setOverride({ base: baseTab, tab: t.id })}
            aria-pressed={tab === t.id}
            className={`rounded-lg px-5 py-2.5 text-base font-bold transition ${tab === t.id ? "bg-navy-800 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "dml" ? (
        <DmlSection sheets={dmlSheets} selected={selectedDmlSheet} lines={dmlLines} syncedAt={synced("dml")} />
      ) : store ? (
        store.items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-base text-slate-600">Belum ada data. Tekan Tarik Data Sekarang.</p>
        ) : (
          <HkSection
            key={store.id}
            items={store.items}
            usage={store.usage}
            syncedAt={synced(store.id)}
            months={store.months}
            tab={store.id}
            short={store.label}
            title={store.title}
            sheetName={store.sheetName}
            splitNote={STORE_SPLIT_NOTE}
          />
        )
      ) : (
        <HkSection items={hkItems} usage={hkUsageGroups} syncedAt={synced("hk")} months={hkMonths} />
      )}
    </div>
  );
}
