/**
 * VHP article groups from the article number: digit 1 is the main group, digits 2–4 the
 * sub-group ("1100005" = Food / 100 Poultry Product). Names come from the VHP Stock Article
 * List (price tab of the HK sheet, Nov 2026). Civil Work (5xx) counts under Engineering
 * (user decision 2026-11-18).
 */
const MAIN: Record<string, string> = {
  "1": "Food",
  "2": "Beverage",
  "3": "Operating Supplies",
  "4": "Engineering",
  "5": "Engineering",
  "9": "Inventaris",
};

const SUB: Record<string, string> = {
  "100": "Poultry Product",
  "101": "Fish & Shell Fish",
  "102": "Beef, Lamb & Veal",
  "103": "Fresh Fruits",
  "104": "Fresh Vegetables",
  "105": "Spices & Herbs",
  "106": "Dairy & Ice Cream",
  "107": "Groceries",
  "108": "Can's",
  "109": "Frozen Product",
  "110": "Pastry",
  "199": "Other Food",
  "200": "Non Alcoholic Beverage",
  "201": "Alcoholic Beverage",
  "299": "Other Beverage",
  "301": "Tobacco",
  "302": "Chemical Supplies",
  "303": "Cleaning Supplies",
  "304": "Guest Supplies",
  "305": "Printing",
  "306": "Stationary",
  "307": "Paper Supplies",
  "308": "Promotion Supplies",
  "309": "Souvenir Item",
  "310": "Signage",
  "311": "Operating Supplies",
  "312": "Complimentary Voucher",
  "313": "Menu & Beverage List",
  "314": "Kitchen Supplies",
  "315": "Consignment Item",
  "316": "Linen",
  "317": "Uniform",
  "321": "Kitchen Utensil",
  "322": "Glassware",
  "323": "Chinaware",
  "324": "Cutleries",
  "326": "H/K Decoration",
  "327": "Pool Equipment",
  "328": "Spa",
  "329": "Bar Equipment",
  "330": "Other Kitchen Inventory",
  "451": "Engineering Tools",
  "452": "Electrical Equipment",
  "453": "Light Bulb",
  "454": "AC / Refrigerator",
  "455": "Water Heater",
  "456": "Plumbing",
  "457": "Carpentry",
  "458": "Painting",
  "459": "Gas",
  "460": "Fuel & Gas",
  "498": "Inventaris Engineering",
  "499": "Other Equipment",
  "501": "Civil Work",
  "999": "Other Inventory",
};

export function articleGroup(artNo: string | null): { main: string; sub: string } {
  // The purchase parser stores codes zero-padded to 9 digits ("002200004").
  const code = (artNo ?? "").trim().replace(/^0+(?=\d{7}$)/, "");
  if (!/^\d{7}$/.test(code)) return { main: "Lainnya", sub: "Lainnya" };
  const sub = code.slice(1, 4);
  return { main: MAIN[code[0]] ?? "Lainnya", sub: SUB[sub] ?? `Kelompok ${sub}` };
}

export interface PurchaseItem {
  ingredient_code: string;
  description: string;
  unit: string;
  total_qty: number;
  total_amount: number;
}

export interface PurchaseGroup {
  main: string;
  total: number;
  subs: { name: string; total: number; items: PurchaseItem[] }[];
}

/** Purchased items by main group and sub-group, largest first. */
export function groupPurchases(items: PurchaseItem[]): PurchaseGroup[] {
  const mains = new Map<string, Map<string, PurchaseItem[]>>();
  for (const it of items) {
    const { main, sub } = articleGroup(it.ingredient_code);
    const subs = mains.get(main) ?? new Map<string, PurchaseItem[]>();
    subs.set(sub, [...(subs.get(sub) ?? []), it]);
    mains.set(main, subs);
  }
  const sum = (list: PurchaseItem[]) => list.reduce((s, i) => s + i.total_amount, 0);
  return [...mains]
    .map(([main, subs]) => {
      const subList = [...subs]
        .map(([name, list]) => ({ name, total: sum(list), items: [...list].sort((a, b) => b.total_amount - a.total_amount) }))
        .sort((a, b) => b.total - a.total);
      return { main, total: subList.reduce((s, x) => s + x.total, 0), subs: subList };
    })
    .sort((a, b) => b.total - a.total);
}
