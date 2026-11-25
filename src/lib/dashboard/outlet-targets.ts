import { outletKey } from "./outlet-match";

/**
 * Monthly revenue target per outlet, as given by the user on 2026-11-17.
 * d'Bistro's target covers Room Service and Banquet (folded into it on the
 * dashboard). Souvenir Shop and Laundry have no target.
 */
export const OUTLET_TARGETS: { outlet: string; monthlyTarget: number }[] = [
  { outlet: "Front Office", monthlyTarget: 500_000_000 },
  { outlet: "d'Bar Karaoke & DBC", monthlyTarget: 800_000_000 },
  { outlet: "Sunset Grill", monthlyTarget: 250_000_000 },
  { outlet: "d'Bistro", monthlyTarget: 200_000_000 },
  { outlet: "d'Spa", monthlyTarget: 100_000_000 },
];

/** A target as shown and edited; version 0 means it is still the default above (no row yet). */
export interface OutletTarget {
  outlet: string;
  monthlyTarget: number;
  version: number;
}

/**
 * The targets in force: the defaults above, each replaced by its saved row (table
 * outlet_targets, edited in Pengaturan). A target of 0 means "no target".
 */
export function mergeTargets(rows: { outlet: string; monthly_target: number | string; version: number }[]): OutletTarget[] {
  const saved = new Map(rows.map((r) => [outletKey(r.outlet), r]));
  return OUTLET_TARGETS.map((t) => {
    const row = saved.get(outletKey(t.outlet));
    return row ? { outlet: t.outlet, monthlyTarget: Number(row.monthly_target), version: row.version } : { ...t, version: 0 };
  });
}

/** Largest target accepted from the form (Rp 1 trillion), to catch an extra digit typed by mistake. */
export const MAX_TARGET = 1_000_000_000_000;

/**
 * A rupiah amount typed in the form: "500.000.000", "Rp 500.000.000" or "500000000".
 * Empty means 0 (no target). Null when it is not a whole amount or above MAX_TARGET.
 */
export function parseRupiah(text: string): number | null {
  const t = text.replace(/^\s*rp\.?\s*/i, "").replace(/[.\s]/g, "");
  if (t === "") return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_TARGET ? n : null;
}

/** Outlets that report revenue but have no target. */
const OUTLET_MONTHLY_TARGETS: Record<string, number> = Object.fromEntries(
  OUTLET_TARGETS.map((t) => [outletKey(t.outlet), t.monthlyTarget]),
);

export function monthlyTargetFor(outlet: string): number | null {
  return OUTLET_MONTHLY_TARGETS[outletKey(outlet)] ?? null;
}

export interface TargetProgress {
  target: number;
  /** Revenue as a share of the target; above 100 when exceeded. */
  achievedPct: number;
  /** Share of the target still to go; 0 once reached. */
  remainingPct: number;
  remainingAmount: number;
  reached: boolean;
}

export function targetProgress(revenue: number | null, target: number | null): TargetProgress | null {
  if (revenue === null || target === null || target <= 0) return null;
  const achievedPct = (revenue / target) * 100;
  const reached = revenue >= target;
  return {
    target,
    achievedPct,
    remainingPct: reached ? 0 : 100 - achievedPct,
    remainingAmount: reached ? 0 : target - revenue,
    reached,
  };
}
