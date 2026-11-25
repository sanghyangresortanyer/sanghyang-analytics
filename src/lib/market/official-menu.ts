/**
 * Harga menu resmi outlet Sanghyang, dibaca dari teks foto menu di konten situs resmi (sanghyang.com).
 * Dipakai untuk kolom "Harga Sanghyang" di Langkah Harga dan halaman Untuk Direksi. Harga pesaing ada di
 * competitor-menu.ts dan belum dicocokkan per item dengan menu ini, jadi indeks harga outlet F&B tidak dihitung.
 */
import data from "./official-menu.data.json";
import type { OfficialMenu } from "./menu-text";
import type { MenuItemComparison } from "./pricing-rules";

export type { OfficialMenu, OfficialMenuItem, MenuItemSpec } from "./menu-text";
export { findMenuPrice } from "./menu-text";

const MENUS = data.outlets as Record<string, OfficialMenu>;
export const OFFICIAL_MENU_SOURCE = data.source;

export function officialMenu(outletKey: string): OfficialMenu | null {
  return MENUS[outletKey] ?? null;
}

/** Baris tabel harga menu: harga Sanghyang dari menu resmi, harga pesaing kosong sampai ada yang bersumber. */
export function officialMenuComparisons(outletKey: string): MenuItemComparison[] {
  const menu = officialMenu(outletKey);
  if (!menu) return [];
  return menu.items.map((item) => ({
    itemName: item.name,
    category: item.category,
    sanghyangPrice: item.price,
    competitorPrices: [],
    portionValueNote: `Menu resmi ${item.unit === "per ons" ? "(harga per ons)" : "(per porsi)"}; porsi tidak dicantumkan di menu.`,
  }));
}
