import { describe, expect, it } from "vitest";
import { classifyMenus, DEFAULT_MENU_RULES, windowStart } from "./menu-activity";

// deadQty = portions in the last 3 months, slowQty = portions in the last month.
const m = (description: string, deadQty: number, slowQty: number, firstSold: string, lastSold = "2026-11-10") => ({
  outlet: "Sunset Grill",
  artNo: description,
  description,
  totalQty: deadQty + 10,
  windowQty: deadQty,
  slowQty,
  totalSales: 1,
  firstSold,
  lastSold,
});

describe("classifyMenus (owner 23 Nov: menu paling tidak laku in the last 3 months)", () => {
  it("defaults to 90 days, a 30-day month and fewer than 5 portions", () => {
    expect(DEFAULT_MENU_RULES).toEqual({ deadDays: 90, slowDays: 30, slowBelow: 5 });
    expect(windowStart("2026-11-17", 90)).toBe("2026-08-20");
    expect(windowStart("2026-11-17", 30)).toBe("2026-10-19");
  });

  it("lists only menus still sold in the last 3 months, fewest portions first; older ones and new ones are left out (owner, 23 Nov)", () => {
    const r = classifyMenus(
      [
        m("Old Soup", 0, 0, "2026-01-05", "2026-06-01"),
        m("Rare Steak", 12, 3, "2026-01-05"),
        m("Gone This Month", 6, 0, "2026-01-05", "2026-10-01"),
        m("Busy Rice", 300, 90, "2026-01-01"),
        m("Five A Month", 20, 5, "2026-01-05"),
        m("New Dish", 2, 2, "2026-11-01"),
        m("(0.1 Ons) Kepiting", 1, 0, "2026-01-01", "2026-09-01"),
      ],
      "2026-11-17",
    );
    expect(r.least.map((x) => x.description)).toEqual(["Gone This Month", "Rare Steak", "Five A Month", "Busy Rice"]);
    expect(r).toMatchObject({ deadFrom: "2026-08-20", slowFrom: "2026-10-19", deadDays: 90, slowDays: 30 });
  });

  it("uses the numbers saved in Pengaturan", () => {
    const r = classifyMenus([m("Rare Steak", 20, 8, "2026-01-05"), m("Fresh", 1, 1, "2026-11-10")], "2026-11-17", { deadDays: 60, slowDays: 14, slowBelow: 10 });
    expect(r.least.map((x) => x.description)).toEqual(["Rare Steak"]); // Fresh, first sold after 4 Nov, is new, not unpopular
    expect(r.slowFrom).toBe("2026-11-04");
    expect(r.deadFrom).toBe("2026-09-19");
  });
});

describe("menuBaseline (owner 21 Nov: counted back from the last day, not from January)", () => {
  it("looks back 12 months from the last day with data", async () => {
    const { menuBaseline } = await import("./menu-activity");
    expect(menuBaseline("2027-03-10")).toBe("2026-03-11");
  });

  it("never goes before the first VHP data (1 Jan 2026)", async () => {
    const { menuBaseline } = await import("./menu-activity");
    expect(menuBaseline("2026-11-17")).toBe("2026-01-01");
  });
});

describe("classifyMenus top (owner 21 Nov: best sellers over the year, per outlet)", () => {
  it("keeps the 10 best-selling menus of each outlet over the 12 months, by sales", () => {
    const row = (outlet: string, description: string, totalSales: number) => ({ ...m(description, 5, 5, "2026-01-05"), outlet, totalSales });
    const grill = Array.from({ length: 12 }, (_, i) => row("Sunset Grill", `Grill ${i + 1}`, (i + 1) * 100));
    const r = classifyMenus([...grill, row("d'Bistro", "Nasi Goreng", 50), row("d'Bistro", "(0.1 Ons) Kepiting", 999), row("d'Bistro", "Batal", 0)], "2026-11-17");
    expect(r.top.filter((x) => x.outlet === "Sunset Grill").map((x) => x.description)).toEqual(
      ["Grill 12", "Grill 11", "Grill 10", "Grill 9", "Grill 8", "Grill 7", "Grill 6", "Grill 5", "Grill 4", "Grill 3"],
    );
    expect(r.top.filter((x) => x.outlet === "d'Bistro").map((x) => x.description)).toEqual(["Nasi Goreng"]);
    expect(r.yearFrom).toBe("2026-01-01");
  });
});
