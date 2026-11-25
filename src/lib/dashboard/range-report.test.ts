import { describe, expect, it } from "vitest";
import { buildRangeReport, dayBefore, resolveJournalOutlet, type FoSnapshot, type SalesLine } from "./range-report";

const fo = (id: string, start: string, end: string, outlets: Record<string, number>): FoSnapshot => ({
  meetingId: id,
  periodStart: start,
  periodEnd: end,
  outlets: Object.entries(outlets).map(([outlet_name, revenue_amount]) => ({ outlet_name, revenue_amount })),
  items: [],
});

const sale = (date: string, outlet: string, desc: string, sales: number, coupon = 0): SalesLine => ({
  sale_date: date,
  outlet_name: outlet,
  art_no: "1",
  description: desc,
  qty: 1,
  sales_amount: sales,
  coupon_amount: coupon,
});

const base = {
  salesLines: [] as SalesLine[],
  salesCoverage: [] as { start: string; end: string }[],
  purchaseLines: [],
  purchaseCoverage: [],
};

describe("dayBefore", () => {
  it("crosses month boundaries", () => {
    expect(dayBefore("2026-11-01")).toBe("2026-10-31");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });
});

describe("resolveJournalOutlet", () => {
  it("maps the 12-character journal name onto the F/O department", () => {
    expect(resolveJournalOutlet("d'Bar Karaok", ["Front Office", "d'Bar Karaoke & DBC"])).toBe("d'Bar Karaoke & DBC");
    expect(resolveJournalOutlet("Souvenir Sho", ["Souvenir Shop & SR"])).toBe("Souvenir Shop & SR");
    expect(resolveJournalOutlet("Sunset Grill", [])).toBe("Sunset Grill");
  });
});

describe("buildRangeReport revenue", () => {
  const snaps = [
    fo("b", "2026-11-01", "2026-11-17", { "Front Office": 170, "Sunset Grill": 90 }),
    fo("a", "2026-11-01", "2026-11-14", { "Front Office": 100, "Sunset Grill": 60 }),
  ];

  it("uses an F/O report whose period equals the range", () => {
    const r = buildRangeReport({ ...base, start: "2026-11-01", end: "2026-11-14", snapshots: snaps });
    expect(r.revenue.source).toBe("fo");
    expect(r.revenue.total).toBe(160);
    expect(r.revenue.missingOutlets).toEqual([]);
  });

  it("subtracts two month-to-date F/O reports for the days between them", () => {
    const r = buildRangeReport({ ...base, start: "2026-11-15", end: "2026-11-17", snapshots: snaps });
    expect(r.revenue.source).toBe("fo");
    expect(r.revenue.outlets.find((o) => o.outlet_name === "Front Office")?.revenue).toBe(70);
    expect(r.revenue.total).toBe(100);
  });

  it("adds up one-day F/O reports for a range of days", () => {
    const daily = [
      fo("d1", "2026-11-01", "2026-11-01", { "Front Office": 10, "Sunset Grill": 5 }),
      fo("d2", "2026-11-02", "2026-11-02", { "Front Office": 20, "Sunset Grill": 6 }),
      fo("d3", "2026-11-03", "2026-11-03", { "Front Office": 30 }),
    ];
    const r = buildRangeReport({ ...base, start: "2026-11-01", end: "2026-11-03", snapshots: daily });
    expect(r.revenue.source).toBe("fo");
    expect(r.revenue.outlets.find((o) => o.outlet_name === "Front Office")?.revenue).toBe(60);
    expect(r.revenue.outlets.find((o) => o.outlet_name === "Sunset Grill")?.revenue).toBe(11);
    expect(r.revenue.foMeetingIds).toEqual(["d1", "d2", "d3"]);
    const two = buildRangeReport({ ...base, start: "2026-11-02", end: "2026-11-03", snapshots: daily });
    expect(two.revenue.total).toBe(56);
  });

  it("joins a month-to-date difference with daily reports", () => {
    const mixed = [...snaps, fo("d18", "2026-11-18", "2026-11-18", { "Front Office": 7, "Sunset Grill": 3 })];
    const r = buildRangeReport({ ...base, start: "2026-11-15", end: "2026-11-18", snapshots: mixed });
    expect(r.revenue.source).toBe("fo");
    expect(r.revenue.total).toBe(110);
  });

  it("does not use F/O when a day in the range has no report", () => {
    const gap = [fo("d1", "2026-11-01", "2026-11-01", { "Front Office": 10 }), fo("d3", "2026-11-03", "2026-11-03", { "Front Office": 30 })];
    const r = buildRangeReport({ ...base, start: "2026-11-01", end: "2026-11-03", snapshots: gap });
    expect(r.revenue.source).not.toBe("fo");
  });

  it("falls back to the journal per day, net of coupons, and lists outlets it cannot cover", () => {
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-10",
      snapshots: snaps,
      salesLines: [
        sale("2026-11-02", "Sunset Grill", "SUNSET PLATTER", 50),
        sale("2026-11-03", "Sunset Grill", "Breakfast", 20, 20),
        sale("2026-11-12", "Sunset Grill", "Outside range", 999),
      ],
      salesCoverage: [{ start: "2026-11-01", end: "2026-11-17" }],
    });
    expect(r.revenue.source).toBe("journal");
    expect(r.revenue.outlets.find((o) => o.outlet_name === "Sunset Grill")).toMatchObject({ revenue: 50, source: "journal" });
    expect(r.revenue.missingOutlets).toEqual(["Front Office"]);
    expect(r.revenue.total).toBe(50);
    expect(r.items.find((i) => i.description === "SUNSET PLATTER")?.total_amount).toBe(50);
  });

  it("names journal outlets and missing outlets from every F/O report, not only the matching ones", () => {
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-10",
      snapshots: [],
      knownOutlets: ["Front Office", "d'Bar Karaoke & DBC"],
      salesLines: [sale("2026-11-02", "d'Bar Karaok", "Beer", 40)],
      salesCoverage: [{ start: "2026-11-01", end: "2026-11-17" }],
    });
    expect(r.revenue.outlets.map((o) => o.outlet_name)).toEqual(["d'Bar Karaoke & DBC", "Front Office"]);
    expect(r.revenue.missingOutlets).toEqual(["Front Office"]);
    expect(r.items[0].outlet_name).toBe("d'Bar Karaoke & DBC");
  });

  it("keeps table transfers and discounts in revenue but out of the menu list", () => {
    const transfer = (desc: string, amount: number): SalesLine => ({ ...sale("2026-11-04", "Sunset Grill", desc, amount), art_no: null });
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-10",
      snapshots: [],
      salesLines: [
        sale("2026-11-04", "Sunset Grill", "GREYGOOSE", 2500),
        transfer("To Table 11 *66029", -2500),
        transfer("From Table 13 *66029", 2500),
        sale("2026-11-04", "Sunset Grill", "Disc Beverage 10%", -250),
      ],
      salesCoverage: [{ start: "2026-11-01", end: "2026-11-17" }],
    });
    expect(r.revenue.total).toBe(2250);
    expect(r.items.map((i) => i.description)).toEqual(["GREYGOOSE"]);
  });

  it("folds the 0.1-ons weight line into its dish and counts orders, not ons", () => {
    const line = (art: string, desc: string, qty: number, amount: number): SalesLine => ({
      ...sale("2026-11-05", "Sunset Grill", desc, amount),
      art_no: art,
      qty,
    });
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-10",
      snapshots: [],
      salesLines: [
        line("1207", "(ons) Ikan Kerapu Bakar", 4, 208_000),
        line("1208", "(0.1 ons) Ikan Kerapu Bakar", 2, 10_400),
        line("1207", "(ons) Ikan Kerapu Bakar", 5, 260_000),
        line("1150", "Steamed Rice", 2, 20_000),
      ],
      salesCoverage: [{ start: "2026-11-01", end: "2026-11-17" }],
    });
    expect(r.items).toEqual([
      expect.objectContaining({ description: "Ikan Kerapu Bakar (per ons)", total_qty: 2, total_amount: 478_400 }),
      expect.objectContaining({ description: "Steamed Rice", total_qty: 2, total_amount: 20_000 }),
    ]);
    expect(r.revenue.total).toBe(498_400);
  });

  it("reports no revenue when neither source covers the range", () => {
    const r = buildRangeReport({ ...base, start: "2026-10-01", end: "2026-10-05", snapshots: snaps });
    expect(r.revenue.source).toBe("none");
    expect(r.revenue.total).toBe(0);
  });

  it("warns when the journal covers only part of the range", () => {
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-20",
      snapshots: [],
      salesLines: [sale("2026-11-02", "Sunset Grill", "X", 10)],
      salesCoverage: [{ start: "2026-11-01", end: "2026-11-17" }],
    });
    expect(r.revenue.notes.join(" ")).toContain("18/11/2026");
  });
});

describe("buildRangeReport with the F/O Journal", () => {
  const foLine = (date: string, outlet: string, art: string, desc: string, amount: number, qty = 1): SalesLine => ({
    sale_date: date,
    outlet_name: outlet,
    art_no: art,
    description: desc,
    qty,
    sales_amount: amount,
    coupon_amount: 0,
    source: "fo",
  });
  const cover = [{ start: "2026-11-01", end: "2026-11-01" }];
  const lines = [
    sale("2026-11-01", "d'Bistro", "Nasi Goreng", 100_000),
    foLine("2026-11-01", "d'Bistro", "12", "B'fast d'Bistro (FIT)", 200_000, 2),
    foLine("2026-11-01", "Front Office", "100", "Lodging", 1_500_000, 3),
  ];

  it("adds room-package postings and Front Office to the outlet revenue, not to the menu list", () => {
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-01",
      snapshots: [],
      knownOutlets: ["Front Office", "d'Bistro", "Sunset Grill"],
      salesLines: lines,
      salesCoverage: cover,
      foJournalCoverage: cover,
    });
    expect(r.revenue.source).toBe("journal");
    expect(r.revenue.total).toBe(1_800_000);
    const bistro = r.revenue.outlets.find((o) => o.outlet_name === "d'Bistro")!;
    expect(bistro).toMatchObject({ revenue: 300_000, qty: 1 });
    // Both journals cover the day: Sunset sold nothing, so 0 instead of "missing".
    expect(r.revenue.outlets.find((o) => o.outlet_name === "Sunset Grill")?.revenue).toBe(0);
    expect(r.revenue.missingOutlets).toEqual([]);
    expect(r.items.map((i) => i.description)).toEqual(["Lodging", "Nasi Goreng"]);
    expect(r.items.find((i) => i.description === "Lodging")?.source).toBe("fo");
    expect(r.revenue.notes).toEqual([]);
  });

  it("says the F/O Journal is missing when only Penjualan per Artikel is there", () => {
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-01",
      snapshots: [],
      knownOutlets: ["Front Office", "d'Bistro"],
      salesLines: [lines[0]],
      salesCoverage: cover,
    });
    expect(r.revenue.missingOutlets).toEqual(["Front Office"]);
    expect(r.revenue.notes.join(" ")).toContain("F/O Journal");
  });

  it("keeps Turnover first and does not list package breakfast as a menu", () => {
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-01",
      snapshots: [fo("t", "2026-11-01", "2026-11-01", { "d'Bistro": 300_000, "Front Office": 1_500_000 })],
      salesLines: lines,
      salesCoverage: cover,
      foJournalCoverage: cover,
    });
    expect(r.revenue.source).toBe("fo");
    expect(r.revenue.total).toBe(1_800_000);
    expect(r.items.some((i) => i.description.startsWith("B'fast"))).toBe(false);
  });
});

describe("buildRangeReport purchases", () => {
  it("sums receiving lines inside the range per supplier and item", () => {
    const r = buildRangeReport({
      ...base,
      start: "2026-11-01",
      end: "2026-11-10",
      snapshots: [],
      purchaseLines: [
        { receive_date: "2026-11-04", supplier_name: "ADI", art_no: "2200001", description: "Air", unit: "Btl", qty: 240, amount: 320000 },
        { receive_date: "2026-11-10", supplier_name: "ADI", art_no: "2200001", description: "Air", unit: "Btl", qty: 240, amount: 320000 },
        { receive_date: "2026-11-12", supplier_name: "AMANAH", art_no: "2200047", description: "Jus", unit: "Drg", qty: 1, amount: 157620 },
      ],
      purchaseCoverage: [{ start: "2026-11-01", end: "2026-11-17" }],
    });
    expect(r.purchase.total).toBe(640000);
    expect(r.purchase.suppliers).toEqual([{ supplier_name: "ADI", purchase_amount: 640000, line_count: 2 }]);
    expect(r.purchase.items[0]).toMatchObject({ ingredient_code: "2200001", total_qty: 480, total_amount: 640000 });
    expect(r.purchase.covered).toBe(true);
  });
});
