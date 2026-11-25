/**
 * Format harga menu yang sama untuk PDF Rapat Senin dan tampilan web. Terpisah dari competitor-menu.ts supaya komponen
 * browser bisa memakainya tanpa ikut membundel berkas data menu.
 */

/**
 * Harga yang bukan untuk satu porsi atau satu item (keputusan pemilik 22 Nov 2026): "paket-bersama" untuk beberapa orang
 * dan "sewa-ruang" untuk ruang karaoke, baik per jam maupun paket ruang.
 */
export type MenuItemKind = "paket-bersama" | "sewa-ruang";

export interface PricedItem {
  price: number;
  priceMax: number | null;
  unit: string | null;
  kind?: MenuItemKind;
  /** Jumlah orang dalam paket-bersama, hanya bila sumbernya menyebut. */
  pax?: number;
}

export const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
export const rupiahRange = (min: number, max: number) => (min === max ? rupiah(min) : `${rupiah(min)} – ${rupiah(max)}`);

/** Label jujur untuk harga yang bukan per porsi; null untuk harga per porsi, per item, atau bersatuan biasa. */
export function servingLabel(m: Pick<PricedItem, "kind" | "pax" | "unit">): string | null {
  if (m.kind === "paket-bersama") return m.pax ? `paket ${m.pax} orang` : "paket beberapa orang";
  // Harga sewa yang sudah bersatuan ("per jam") cukup disebut sewa ruang; tanpa satuan berarti harga paket ruang.
  if (m.kind === "sewa-ruang") return m.unit ? "sewa ruang" : "paket sewa ruang";
  return null;
}

export const itemPriceText = (m: PricedItem) => {
  const label = servingLabel(m);
  return `${rupiahRange(m.price, m.priceMax ?? m.price)}${m.unit ? ` ${m.unit}` : ""}${label ? `, ${label}` : ""}`;
};
export const perPersonText = (r: { min: number; max: number }) => `${rupiahRange(r.min, r.max)} per orang`;
export const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
