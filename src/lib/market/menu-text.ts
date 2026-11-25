/**
 * Pembaca teks foto menu situs resmi Sanghyang. Terpisah dari official-menu.ts supaya skrip impor bisa memakainya
 * sebelum berkas data menu ada.
 */
export interface OfficialMenuItem {
  name: string;
  category: string;
  price: number;
  /** "porsi" atau "per ons" (ikan dan kepiting dijual per ons). */
  unit: string;
  menuImage: string;
}

export interface OfficialMenu {
  sourceUrl: string;
  items: OfficialMenuItem[];
}

export interface MenuItemSpec {
  label: string;
  category: string;
  /** Nama item persis seperti tertulis di foto menu (huruf besar/kecil diabaikan). */
  menuName: string;
}

/** Satu entri harga di teks foto menu: nama (sejak pemisah terakhir), harga dalam ribuan, dan tanda "/Ons". */
const PRICE_ENTRY = /([^·/\n]+?)\s*·\s*(\d+(?:[.,]\d+)?)\s*K\b(\s*\/\s*Ons)?/gi;
const normalizeName = (name: string) => name.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Cari "NAMA · 95K" atau "NAMA · 36K/Ons" di teks foto menu. Nama entri harus sama persis (huruf besar/kecil diabaikan)
 * supaya "SOP BUNTUT" tidak tertukar dengan "SOP BUNTUT GORENG"; hasilnya null bila tidak ada atau ada lebih dari satu.
 */
export function findMenuPrice(text: string, menuName: string): { price: number; unit: string } | null {
  const want = normalizeName(menuName);
  const hits = [...text.matchAll(PRICE_ENTRY)].filter((m) => normalizeName(m[1]) === want);
  if (hits.length !== 1) return null;
  const [, , amount, perOns] = hits[0];
  return { price: Math.round(Number(amount.replace(",", ".")) * 1000), unit: perOns ? "per ons" : "porsi" };
}
