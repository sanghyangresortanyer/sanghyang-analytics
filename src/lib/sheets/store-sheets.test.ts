import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SheetRow } from "./dml-parser";
import { parseHkWorkbook } from "./hk-parser";
import { dropImplausibleValues, monthForUnnamedTab, nameUnnamedStockTab, parseBeverageStore, priceTabRows, storeDestinationShares, withPriceTab } from "./store-sheets";
import { readWorkbookRows } from "./workbook-reader";

const row = (number: number, values: unknown[]): SheetRow => ({ number, values: [undefined, ...values] });

describe("monthForUnnamedTab", () => {
  it("is the running month while the tab's last day is not after today", () => {
    expect(monthForUnnamedTab(25, "2026-11-26")).toBe("2026-11");
    expect(monthForUnnamedTab(null, "2026-11-26")).toBe("2026-11");
  });
  it("is last month when the tab has days later than today in the first week of a new month", () => {
    expect(monthForUnnamedTab(30, "2026-12-07")).toBe("2026-11");
    expect(monthForUnnamedTab(31, "2027-01-02")).toBe("2026-12");
  });
  it("stays the running month when a day ahead is filled later in the month (Main Store had day 27 on 26 Nov)", () => {
    expect(monthForUnnamedTab(27, "2026-11-26")).toBe("2026-11");
    expect(monthForUnnamedTab(30, "2026-12-08")).toBe("2026-12");
  });
});

// HK layout as in the Main Store and Engineering sheets: three header rows, then items.
const stockTab = (entries: unknown[][]) => [
  row(1, ["No Art", "Description", "Unit", "Content", "TOTAL", null, null, null, 1, null, null, 2]),
  row(2, [null, null, null, null, "Stock", "IN", "Out", "Stock", "In", "Out", "Digunakan", "In", "Out", "Digunakan"]),
  row(3, [null, null, null, null, "Awal", null, null, "Akhir", null, null, "(Di mana)", null, null, "(Di mana)"]),
  ...entries.map((e, i) => row(4 + i, e)),
];

describe("nameUnnamedStockTab", () => {
  it("names the one tab called Sheet1 after the month and asks the team to rename it", () => {
    const sheets = new Map([["Sheet1", stockTab([[1107782, "Beras", "Kg", 1, 50, 25, 25, 50, 25, 25, "kichen"]])]]);
    const out = nameUnnamedStockTab(sheets, "2026-11-26");
    expect([...out.sheets.keys()]).toEqual(["2026-11"]);
    expect(out.warnings[0]).toContain('Ganti nama tab menjadi "Nov 2026"');
    expect(parseHkWorkbook(out.sheets).months[0].month).toBe("2026-11");
  });
  it("warns about entries written on a day after today", () => {
    const tab = stockTab([[1107782, "Beras", "Kg", 1, 50, 0, 25, 25, null, null, null, null, 25, "kichen"]]);
    tab[0] = row(1, ["No Art", "Description", "Unit", "Content", "TOTAL", null, null, null, 1, null, null, 9]);
    const out = nameUnnamedStockTab(new Map([["Sheet1", tab]]), "2026-11-08");
    expect([...out.sheets.keys()]).toEqual(["2026-11"]);
    expect(out.warnings[1]).toBe("Ada isian tanggal 9, padahal hari ini tanggal 8: periksa apakah salah kolom.");
  });
  it("leaves a workbook alone when its stock tab already has a month name", () => {
    const sheets = new Map([["Nov 2026", stockTab([])]]);
    expect(nameUnnamedStockTab(sheets, "2026-11-26")).toEqual({ sheets, warnings: [] });
  });
});

describe("withPriceTab", () => {
  const prices = [row(8, ["ArtNo", "Description", "D-Unit", "D-Content", "Unit", "Content", "R-Unit", "Min-Stock", "Actual-Price", "Last P-Price", "Average-Price"]), row(12, [4457206, "Lem Taco", "Pcs", 1, "Pcs", 1, "Pcs", 0, 9000, 9000, 8800])];
  it("lends a VHP price list to a sheet without one (Engineering) and values its stock", () => {
    const eng = new Map([["Sheet1", stockTab([[4457206, "Lem Taco", "Pcs", 1, 3, 0, 1, 2, null, 1, "srd"]])]]);
    const named = nameUnnamedStockTab(eng, "2026-11-26").sheets;
    const parsed = parseHkWorkbook(withPriceTab(named, prices));
    expect(parsed.months[0].items[0].stockValue).toBe(2 * 8800);
    expect(priceTabRows(new Map([["x", prices]]))).toBe(prices);
  });
});

describe("dropImplausibleValues", () => {
  it("leaves a line worth a billion out of the totals and names it (Lem Taco 46.024 pcs)", () => {
    const prices = [row(8, ["ArtNo", "Description", "D-Unit", "D-Content", "Unit", "Content", "R-Unit", "Min-Stock", "Actual-Price", "Last P-Price", "Average-Price"]), row(12, [4457206, "Lem Taco", "Pcs", 1, "Pcs", 1, "Pcs", 0, 0, 0, 806850]), row(13, [3306030, "Baterai", "Pcs", 1, "Pcs", 1, "Pcs", 0, 0, 0, 6250])];
    const tab = stockTab([[4457206, "Lem Taco", "Pcs", 1, 46024, 0, 0, 46024], [3306030, "Baterai", "Pcs", 1, 38, 0, 0, 38]]);
    const r = dropImplausibleValues(parseHkWorkbook(new Map([["Nov 2026", tab], ["Harga", prices]])));
    const m = r.months[0];
    expect(m.stats).toEqual({ itemCount: 2, pricedCount: 1, totalValue: 38 * 6250 });
    expect(m.items[0].averagePrice).toBeNull();
    expect(m.warnings.at(-1)).toMatch(/Lem Taco\): stok 46\.024 Pcs bernilai Rp37\.134\.[0-9.]+, tidak wajar/);
  });
});

describe("storeDestinationShares (Main Store 'Digunakan')", () => {
  const shares = (raw: string) => storeDestinationShares(raw).map((s) => [s.label, Math.round(s.share * 1000) / 1000]);
  it("splits 'kicen5,sg1' by the numbers written after each name", () => {
    expect(shares("kicen5,sg1")).toEqual([["Kitchen", 0.833], ["Sunset Grill", 0.167]]);
  });
  it("folds the spellings seen in the sheet into one department", () => {
    expect(shares("kicen1,kichen1,kcen2")).toEqual([["Kitchen", 1]]);
    expect(shares("scrty1,scurty1,scry1,scty1").map((s) => s[0])).toEqual(["Security"]);
    expect(shares("kicen5,scrty1,grdnr,1,eng1").map((s) => s[0])).toEqual(["Kitchen", "Security", "Gardener", "Engineering"]);
    expect(shares("hk1 sg2,eng1,scrity1")).toEqual([["HK", 0.2], ["Sunset Grill", 0.4], ["Engineering", 0.2], ["Security", 0.2]]);
  });
  it("gives a single name the whole entry, and an empty one its own label", () => {
    expect(shares("kichen")).toEqual([["Kitchen", 1]]);
    expect(shares("")).toEqual([["Tujuan tidak diisi", 1]]);
    expect(shares("dbar")).toEqual([["d'Bar", 1]]);
  });
});

describe("parseBeverageStore (tab LH)", () => {
  const lh = [
    row(1, ["Art No", "Description", "D-Unit", "Cont", "SAW", "Total IN", "Total TF", "SAK", "IN", 1, null, null, null, "SAK", "IN", 2]),
    row(2, [null, null, null, null, null, null, null, null, null, "Transfer", null, null, null, null, null, "Transfer"]),
    row(3, [null, null, null, null, null, null, null, null, null, "BAR", "DBC", "SG", "Bistro", null, null, "BAR", "DBC", "SG", "Bistro"]),
    row(5, [2200001, "Air Mineral 330 Ml", "Carton", 1333, 96, 840, 552, 384, 840, null, null, 24, null, 72, null, null, 528]),
  ];
  it("reads stock, goods in and what went to each outlet, valued at the tab's unit price", () => {
    const r = parseBeverageStore(new Map([["LH", lh]]), "2026-11-26");
    const m = r.months[0];
    expect(m.month).toBe("2026-11");
    expect(m.items[0]).toMatchObject({ itemCode: "2200001", stockAwal: 96, totalIn: 840, totalOut: 552, stockAkhir: 384, averagePrice: 1333, stockValue: 384 * 1333 });
    expect(m.movements).toEqual([
      { itemCode: "2200001", day: 1, date: "2026-11-01", qtyIn: 840, qtyOut: null, location: null },
      { itemCode: "2200001", day: 1, date: "2026-11-01", qtyIn: null, qtyOut: 24, location: "SG" },
      { itemCode: "2200001", day: 2, date: "2026-11-02", qtyIn: null, qtyOut: 528, location: "DBC" },
    ]);
    expect(m.warnings.join(" ")).toContain('Tab "LH" tidak bernama bulan');
  });
  it("says so when the LH tab is missing", () => {
    expect(() => parseBeverageStore(new Map([["DBC", lh.slice(0, 1)]]), "2026-11-26")).toThrow(/LH/);
  });
});

// The live sheets downloaded on 26 Nov 2026 (git-ignored business data); skipped without them.
const dir = path.resolve(__dirname, "../../../data/raw/sheets_20261126");
const file = (name: string) => path.join(dir, `${name}_20261126.xlsx`);
const has = (...names: string[]) => names.every((n) => fs.existsSync(file(n)));

describe("sheets asli 26 Nov", () => {
  (has("MainStore") ? it : it.skip)("Main Store: 208 barang, semua berharga VHP, stok akhir cocok dengan sheet", async () => {
    const wb = await readWorkbookRows(fs.readFileSync(file("MainStore")), () => true);
    const named = nameUnnamedStockTab(wb, "2026-11-26");
    const m = parseHkWorkbook(named.sheets).months[0];
    expect(m.month).toBe("2026-11");
    expect(m.stats.itemCount).toBe(208);
    expect(m.stats.pricedCount).toBe(208);
    expect(m.warnings).toEqual([]);
  }, 60_000);

  (has("Engineering", "MainStore") ? it : it.skip)("Engineering: 328 barang dinilai dengan harga VHP dari sheet Main Store", async () => {
    const main = await readWorkbookRows(fs.readFileSync(file("MainStore")), () => true);
    const eng = await readWorkbookRows(fs.readFileSync(file("Engineering")), () => true);
    const m = parseHkWorkbook(withPriceTab(nameUnnamedStockTab(eng, "2026-11-26").sheets, priceTabRows(main))).months[0];
    expect(m.stats.itemCount).toBe(328);
    expect(m.stats.pricedCount).toBe(328);
  }, 60_000);

  (has("Beverages") ? it : it.skip)("Beverages: tab LH terbaca, 93 minuman, SAK = SAW + IN − TF", async () => {
    const wb = await readWorkbookRows(fs.readFileSync(file("Beverages")), () => true);
    const m = parseBeverageStore(wb, "2026-11-26").months[0];
    expect(m.sheetName).toBe("LH");
    expect(m.stats.itemCount).toBe(93);
    expect(m.warnings.filter((w) => /seharusnya|jumlah harian/.test(w))).toEqual([]);
    expect(m.movements.some((x) => x.location === "DBC")).toBe(true);
  }, 60_000);
});
