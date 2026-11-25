/**
 * Outlet names differ per source: VHP revenue says "d'Bistro", the DML sheet
 * "BISTRO", the HK sheet "bistro". Names are compared whole after dropping case,
 * a leading "d'" and extra spaces. No substring matching: HK location "Room"
 * (guest rooms) must not land on the revenue outlet "Room Service".
 */
export function outletKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^d['’]\s*/, "")
    .replace(/\s+/g, " ");
}

export function sameOutlet(a: string, b: string): boolean {
  return outletKey(a) === outletKey(b);
}

/**
 * MR lines carry the department in "Bagian dept". Only codes seen in the sheet
 * are mapped; any other code stays visible as "MR - <code>" instead of being
 * guessed onto an outlet.
 */
const MR_DEPT_TO_OUTLET: Record<string, string> = {
  DBC: "d'Bar Karaoke & DBC",
  ENG: "ENGINEERING",
};

export function mrOutletFor(dept: string | null): string {
  const code = dept?.trim().toUpperCase() ?? "";
  if (!code) return "MR";
  return MR_DEPT_TO_OUTLET[code] ?? `MR - ${code}`;
}

/**
 * Revenue outlets reported together (user decision 2026-11-17): Room Service and
 * Banquet are run by the Bistro, so their VHP revenue counts under d'Bistro.
 * Stored meeting data stays per VHP department; the merge happens on display.
 */
const REVENUE_OUTLET_MERGE: Record<string, string> = {
  "room service": "d'Bistro",
  banquet: "d'Bistro",
};

export function revenueOutletFor(name: string): string {
  return REVENUE_OUTLET_MERGE[outletKey(name)] ?? name;
}
