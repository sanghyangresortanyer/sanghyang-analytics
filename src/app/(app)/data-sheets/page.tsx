import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { currentUser } from "@/lib/auth/role";
import { isSupabaseConfigured } from "@/lib/config";
import { SetupNeeded } from "@/components/setup-needed";
import { formatDateTimeWIB } from "@/lib/format-date";
import {
  getDmlLines,
  getDmlSheets,
  getHkItems,
  getHkMovements,
  getSyncStates,
  type DmlLineRow,
  type HkItemRow,
  type HkMovementRow,
  type SyncState,
} from "@/lib/sheets/queries";
import { SHEET_SOURCES } from "@/lib/sheets/source";
import { SyncButton } from "./sync-button";
import { SheetsDashboardTabs, type LocationUsageGroup } from "./sheets-dashboard-tabs";
import { hkLocationShares } from "@/lib/dashboard/dashboard-calc";
import { chooseHkMonth, hkMonths } from "@/lib/sheets/hk-months";

// "Tarik Data Sekarang" runs the full pull inside this route (~10–20 s).
export const maxDuration = 300;

function StatusCard({ label, state, configured }: { label: string; state: SyncState | undefined; configured: boolean }) {
  const icon = !configured ? (
    <CircleDashed className="h-5 w-5 text-slate-400" />
  ) : !state ? (
    <CircleDashed className="h-5 w-5 text-slate-400" />
  ) : state.status === "error" ? (
    <XCircle className="h-5 w-5 text-rose-600" />
  ) : state.warnings.length > 0 ? (
    <AlertTriangle className="h-5 w-5 text-amber-600" />
  ) : (
    <CheckCircle2 className="h-5 w-5 text-emerald-700" />
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-bold text-slate-900">{label}</h2>
      </div>
      {!configured ? (
        <p className="mt-2 text-base text-slate-600">ID sheet belum diisi di pengaturan server (env).</p>
      ) : !state ? (
        <p className="mt-2 text-base text-slate-600">Belum pernah ditarik.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-500">Dicek</dt>
          <dd className="text-slate-800">{formatDateTimeWIB(state.last_checked_at)}</dd>
          <dt className="text-slate-500">Isi sheet berubah</dt>
          <dd className="text-slate-800">{state.last_changed_at ? formatDateTimeWIB(state.last_changed_at) : "—"}</dd>
          {state.status === "error" && (
            <>
              <dt className="text-rose-700">Galat</dt>
              <dd className="text-rose-700">{state.error}</dd>
            </>
          )}
          {state.warnings.length > 0 && (
            <>
              <dt className="text-amber-700">Peringatan</dt>
              <dd className="text-amber-800">{state.warnings.length} (catatan sheet)</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

interface LocationGroupAcc {
  label: string;
  value: number;
  entries: number;
  unpriced: number;
  itemMap: Map<
    string,
    {
      code: string;
      name: string;
      unit: string | null;
      qty: number;
      averagePrice: number | null;
      cost: number | null;
    }
  >;
}

/** Out × average price per "Digunakan (Di mana)" entry; hierarchical breakdown by item. */
function usageByLocation(items: HkItemRow[], movements: HkMovementRow[]): LocationUsageGroup[] {
  const itemLookup = new Map(items.map((i) => [i.item_code, i]));
  const groups = new Map<string, LocationGroupAcc>();

  for (const m of movements) {
    if (!m.qty_out) continue;
    const item = itemLookup.get(m.item_code);
    const p = item?.average_price ?? null;
    // Same location rules as the dashboard: names as written (typos folded), combined entries split equally.
    for (const { key, label, share } of hkLocationShares(m.location)) {
      let g = groups.get(key);
      if (!g) {
        g = { label, value: 0, entries: 0, unpriced: 0, itemMap: new Map() };
        groups.set(key, g);
      }
      const q = m.qty_out * share;
      if (p === null) g.unpriced += 1;
      else g.value += q * p;
      g.entries += 1;
      let itemEntry = g.itemMap.get(m.item_code);
      if (!itemEntry) {
        itemEntry = { code: m.item_code, name: item?.item_name ?? m.item_code, unit: item?.unit ?? null, qty: 0, averagePrice: p, cost: null };
        g.itemMap.set(m.item_code, itemEntry);
      }
      itemEntry.qty += q;
      if (p !== null) itemEntry.cost = (itemEntry.cost ?? 0) + q * p;
    }
  }

  return [...groups.values()]
    .map((g) => ({
      label: g.label,
      value: g.value,
      entries: g.entries,
      unpriced: g.unpriced,
      items: [...g.itemMap.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)),
    }))
    .sort((a, b) => b.value - a.value);
}

/** The sheet's own problems (subtotal mismatches, unreadable numbers): those values are left out of the totals. */
function SheetWarnings({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <summary className="cursor-pointer text-base font-semibold text-amber-900">
        {title}: {items.length} peringatan (angka yang bermasalah tidak dihitung)
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
        {items.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

function LoadError({ message }: { message: string }) {
  const missingTable = /could not find the table|does not exist|schema cache/i.test(message);
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-base text-rose-800">
      <p className="font-semibold">Data Google Sheets belum bisa dibaca.</p>
      <p className="mt-1">{message}</p>
      {missingTable && (
        <p className="mt-2">
          Tabel belum ada di database: migrasi <code className="rounded bg-rose-100 px-1">0061_google_sheets_sync.sql</code> perlu dijalankan.
        </p>
      )}
    </div>
  );
}

export default async function DataSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ dml?: string; tab?: string; hk?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNeeded />;
  const me = await currentUser();
  if (!me?.propertyId) return <SetupNeeded />;
  const propertyId = me.propertyId;
  const params = await searchParams;

  let data: {
    states: SyncState[];
    dmlSheets: Awaited<ReturnType<typeof getDmlSheets>>;
    hkItems: HkItemRow[];
    hkMovements: HkMovementRow[];
    lines: DmlLineRow[];
  };
  try {
    const [states, dmlSheets, hkItems, hkMovements] = await Promise.all([
      getSyncStates(propertyId),
      getDmlSheets(propertyId),
      getHkItems(propertyId),
      getHkMovements(propertyId),
    ]);
    const selected = dmlSheets.find((s) => s.sheet_name === params.dml) ?? dmlSheets[0];
    const lines = selected ? await getDmlLines(propertyId, selected.sheet_name) : [];
    data = { states, dmlSheets, hkItems, hkMovements, lines };
  } catch (err) {
    return (
      <div className="w-full space-y-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Data Google Sheets</h1>
        <LoadError message={err instanceof Error ? err.message : String(err)} />
      </div>
    );
  }

  const { states, dmlSheets, lines } = data;
  // One month tab at a time (?hk=, else the latest); per-date stock for any period lives on the dashboard.
  const months = hkMonths(data.hkItems);
  const hkMonth = chooseHkMonth(months, params.hk);
  const hkItems = data.hkItems.filter((i) => i.period_month === hkMonth);
  const hkMovements = data.hkMovements.filter((m) => m.period_month === hkMonth);
  const selectedDmlSheet = dmlSheets.find((s) => s.sheet_name === params.dml) ?? dmlSheets[0];
  const hkUsageGroups = usageByLocation(hkItems, hkMovements);
  const configured = Object.fromEntries(SHEET_SOURCES.map((s) => [s.source, Boolean(process.env[s.env]?.trim())]));

  const initialTab = params.tab === "dml" ? "dml" : "hk";

  return (
    <div className="w-full space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Data Google Sheets</h1>
          <p className="mt-1 text-base text-slate-600">
            Ditarik otomatis setiap Senin pukul 01.00 WIB, atau klik Tarik Data Sekarang.
          </p>
        </div>
        <SyncButton />
      </div>

      {/* A sheet that cannot be pulled (no ID, or the last pull failed) is the only status worth a card. */}
      {SHEET_SOURCES.some((s) => !configured[s.source] || states.find((x) => x.source === s.source)?.status === "error") && (
        <div className="grid gap-4 md:grid-cols-2">
          {SHEET_SOURCES.filter((s) => !configured[s.source] || states.find((x) => x.source === s.source)?.status === "error").map((s) => (
            <StatusCard key={s.source} label={s.label} state={states.find((x) => x.source === s.source)} configured={configured[s.source]} />
          ))}
        </div>
      )}

      <SheetWarnings title="Inventory HK" items={states.find((x) => x.source === "hk")?.warnings ?? []} />
      {selectedDmlSheet && (
        <SheetWarnings title={`DML ${selectedDmlSheet.sheet_name}`} items={selectedDmlSheet.warnings} />
      )}

      {/* Interactive Tabs: HK & DML Sections */}
      <SheetsDashboardTabs
        key={initialTab}
        initialTab={initialTab}
        states={states}
        dmlSheets={dmlSheets}
        selectedDmlSheet={selectedDmlSheet}
        dmlLines={lines}
        hkItems={hkItems}
        hkUsageGroups={hkUsageGroups}
        hkMonths={months}
      />
    </div>
  );
}
