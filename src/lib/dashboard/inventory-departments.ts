import type { StockStore } from "@/lib/sheets/source";

/**
 * Inventory departments shown on the dashboard (user decision 2026-11-18): stock comes from
 * spreadsheets, one per department. A department without a source (`store` null) stays listed as
 * "belum tersambung" until its spreadsheet is connected. Main Store, Engineering and the beverage
 * store were connected on 26 Nov 2026; Food waits for the link of its sheet.
 */
export const INVENTORY_DEPARTMENTS: readonly { key: string; name: string; source: string; store: StockStore | null }[] = [
  { key: "hk", name: "Inventory HK (Housekeeping)", source: "Google Sheets HK", store: "hk" },
  { key: "main", name: "Inventory Main Store", source: "Google Sheets Main Store", store: "main" },
  { key: "liquor", name: "Inventory Minuman (gudang LH)", source: "Google Sheets Beverages, tab LH", store: "bev" },
  { key: "eng", name: "Inventory Engineering", source: "Google Sheets Engineering", store: "eng" },
  { key: "food", name: "Inventory Food", source: "Spreadsheet belum tersambung", store: null },
];

export type InventoryDepartmentKey = string;
