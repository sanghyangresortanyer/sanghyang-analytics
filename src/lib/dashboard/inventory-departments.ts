/**
 * Inventory departments shown on the dashboard (user decision 2026-11-18): stock comes from
 * spreadsheets, one per department. HK is connected through Google Sheets; a department
 * without a source stays listed as "belum tersambung" until its spreadsheet is connected.
 * Add a department here when its spreadsheet exists.
 */
export const INVENTORY_DEPARTMENTS = [
  { key: "hk", name: "Inventory HK (Housekeeping)", source: "Google Sheets HK" },
  { key: "food", name: "Inventory Food & Beverage", source: "Spreadsheet belum tersambung" },
  { key: "liquor", name: "Inventory Liquor", source: "Spreadsheet belum tersambung" },
  { key: "eng", name: "Inventory Engineering", source: "Spreadsheet belum tersambung" },
  { key: "main", name: "Inventory Main Store", source: "Spreadsheet belum tersambung" },
] as const;

export type InventoryDepartmentKey = (typeof INVENTORY_DEPARTMENTS)[number]["key"];
