import { describe, expect, it } from "vitest";
import { revenueCategory } from "./revenue-category";

describe("revenueCategory", () => {
  it("groups the VHP sales categories seen in Jan–Oct 2026", () => {
    expect(revenueCategory("Food Sunset Grill")).toBe("Makanan");
    expect(revenueCategory("B'fast d'Bistro (FIT)")).toBe("Makanan");
    expect(revenueCategory("Beverage Non-Alcoholic Sunset Gr")).toBe("Minuman non-alkohol");
    expect(revenueCategory("Beverage Alcoholic d'Bar")).toBe("Minuman beralkohol");
    expect(revenueCategory("Beverage d'Bistro")).toBe("Minuman lain");
    expect(revenueCategory("Cigarette d'Bar")).toBe("Rokok");
    expect(revenueCategory("Disc Bev d'Bar")).toBe("Diskon");
    expect(revenueCategory("Lodging")).toBe("Kamar");
    expect(revenueCategory("Extra Bed")).toBe("Kamar");
    expect(revenueCategory("Treatment Ala Carte")).toBe("Lain-lain");
    expect(revenueCategory("(compliment)")).toBe("Compliment");
    expect(revenueCategory(null)).toBe("Lain-lain");
  });
});
