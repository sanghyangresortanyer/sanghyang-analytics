import { describe, expect, it } from "vitest";
import { topMenus } from "./top-menus";

const item = (outlet_name: string, description: string, total_qty: number, total_amount: number, source: "journal" | "fo" = "journal") => ({ outlet_name, art_no: description, description, total_qty, total_amount, source });

describe("topMenus", () => {
  it("ranks menus of every outlet by sales, journal lines only", () => {
    const t = topMenus([item("d'Bistro", "Breakfast FIT", 91, 18_200_000), item("d'Spa", "Massage", 25, 7_500_000), item("Front Office", "Lodging", 300, 99_000_000, "fo"), item("Sunset Grill", "Nasi Goreng", 40, 2_000_000)], 2);
    expect(t.map((x) => x.description)).toEqual(["Breakfast FIT", "Massage"]);
  });

  it("leaves out weighed-dish tenths and lines without sales", () => {
    const t = topMenus([item("Sunset Grill", "(0.1 Ons) Kepiting", 50, 9_000_000), item("Sunset Grill", "Free Kacang", 3, 0), item("Sunset Grill", "Kepiting Saus Padang", 5, 1_000_000)], 10);
    expect(t.map((x) => x.description)).toEqual(["Kepiting Saus Padang"]);
  });
});
