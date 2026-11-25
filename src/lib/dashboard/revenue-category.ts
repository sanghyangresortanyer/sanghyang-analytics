/**
 * Groups VHP sales categories (the "F/O Artikel" column of Penjualan per Artikel, or the article of an
 * F/O Journal posting) the way the hotel's auditor splits revenue: food, drinks with and without
 * alcohol, tobacco, rooms and others. Discounts and complimentary payments stay visible on their own.
 */
export const REVENUE_CATEGORIES = [
  "Kamar",
  "Makanan",
  "Minuman non-alkohol",
  "Minuman beralkohol",
  "Minuman lain",
  "Rokok",
  "Lain-lain",
  "Diskon",
  "Compliment",
] as const;
export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];

/** Chart colours from the auditor's workbook (Financial Forecast 1126). */
export const CATEGORY_COLORS: Record<RevenueCategory, string> = {
  Kamar: "#1F3864",
  Makanan: "#2E75B6",
  "Minuman non-alkohol": "#9DC3E6",
  "Minuman beralkohol": "#1F4E79",
  "Minuman lain": "#8EA9DB",
  Rokok: "#A6A6A6",
  "Lain-lain": "#F4B183",
  Diskon: "#C55A11",
  Compliment: "#C00000",
};

export function revenueCategory(raw: string | null | undefined): RevenueCategory {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "(compliment)") return "Compliment";
  if (/^disc|discount/.test(s)) return "Diskon";
  if (/lodging|extra bed|early c|late c|no show|room revenue/.test(s)) return "Kamar";
  if (/non[\s-]?alc/.test(s)) return "Minuman non-alkohol";
  if (/alcohol|liquor|beer|wine/.test(s)) return "Minuman beralkohol";
  if (/beverage|drink/.test(s)) return "Minuman lain";
  if (/cigar|tobacco/.test(s)) return "Rokok";
  if (/food|b'?fast|breakfast|lunch|dinner|bbq|coffee break|package/.test(s)) return "Makanan";
  return "Lain-lain";
}
