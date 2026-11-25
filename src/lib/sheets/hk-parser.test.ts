import { describe, expect, it } from "vitest";
import { parseHkWorkbook, piecesCounted } from "./hk-parser";
import type { SheetRow } from "./dml-parser";

const f = (formula: string, result?: unknown) => (result === undefined ? { formula } : { formula, result });
const rows = (list: unknown[][]): SheetRow[] => list.map((cells, i) => ({ number: i + 1, values: [null, ...cells] }));

const HEADER = [
  ["No Art", "Description", "Unit", "Content", "TOTAL", "TOTAL", "TOTAL", "TOTAL", 1, 1, 1, 2, 2, 2],
  ["No Art", "Description", "Unit", "Content", "Stock", "IN", "Out", "Stock", "In", "Out ", "Digunakan ", "In", "Out ", "Digunakan "],
  ["No Art", "Description", "Unit", "Content", "Awal", "IN", "Out", "Akhir", "In", "Out ", "(Di mana )", "In", "Out ", "(Di mana )"],
];

/** A month tab of the HK sheet: totals in E–H, then In/Out/"Digunakan (Di mana)" per day from column I. */
const novTab = rows([
  ...HEADER,
  [1107005, f("vlookup()", "Gula Sachet"), f("vlookup()", "Pack"), f("vlookup()", 250), 50, f("+I4+L4", 250), f("+J4+M4", 129), f("+E4+F4-G4", 171), 250, 100, "Room", null, 29, "Lobby"],
  [3306213, f("vlookup()", "Acrylic 15 x 21cm"), f("vlookup()", "Pcs"), f("vlookup()", 1), 8, f("+I5+L5"), f("+J5+M5"), f("+E5+F5-G5", 8)],
  [9999999, f("vlookup()", "Barang tanpa harga"), "Pcs", 1, 2, f("+I6+L6"), f("+J6+M6"), f("+E6+F6-G6", 2)],
]);

/** VHP "STOCK ARTICLE LIST" export. */
const priceTab = rows([
  ["SANGHYANG INDAH SPA RESORT"],
  ["STOCK A", "RTICLE LIST", null, "Date :", "12/11/26 11", ":03:01"],
  ["ArtNo", "Description", "D-Unit", "D-Content", "Unit", "Content", "R-Unit", "Min-Stock", "Actual-Price", "Last P-Price", "Average-Price", "PchaseFreq", "Supplier"],
  ["-------", "-----"],
  ["100 - P", "oultry Product"],
  [1107005, "Gula Sachet", "Pack", 1, "Pack", 250, "Sac", 0, 40000, 39000, 38500, 12, "SUKANDA"],
  [3306213, "Acrylic 15 x 21cm", "Pcs", 1, "Pcs", 1, "Pcs", 0, 25000, 0, 24000, 1],
]);

describe("parseHkWorkbook", () => {
  const result = parseHkWorkbook(
    new Map([
      ["Sheet2", priceTab],
      ["Nov 2026", novTab],
    ]),
  );
  const nov = result.months[0];

  it("reads the month from the tab name", () => {
    expect(result.months.map((m) => [m.month, m.sheetName])).toEqual([["2026-11", "Nov 2026"]]);
    expect(result.priceSheet).toBe("Sheet2");
  });

  it("reads stock per item and values it at the VHP average price", () => {
    expect(nov.items[0]).toEqual({
      rowNo: 4,
      itemCode: "1107005",
      itemName: "Gula Sachet",
      unit: "Pack",
      content: 250,
      stockAwal: 50,
      totalIn: 250,
      totalOut: 129,
      stockAkhir: 171,
      averagePrice: 38500,
      lastPrice: 39000,
      stockValue: 171 * 38500,
    });
    expect(nov.items[1]).toMatchObject({ totalIn: 0, totalOut: 0, stockAkhir: 8, stockValue: 8 * 24000 });
    expect(nov.stats).toEqual({ itemCount: 3, pricedCount: 2, totalValue: 171 * 38500 + 8 * 24000 });
  });

  it("dates each daily movement inside its month", () => {
    expect(nov.movements).toEqual([
      { itemCode: "1107005", day: 1, date: "2026-11-01", qtyIn: 250, qtyOut: 100, location: "Room" },
      { itemCode: "1107005", day: 2, date: "2026-11-02", qtyIn: null, qtyOut: 29, location: "Lobby" },
    ]);
  });

  it("leaves the value empty for an item missing from the price list and says so", () => {
    expect(nov.items[2]).toMatchObject({ itemCode: "9999999", averagePrice: null, stockValue: null });
    expect(nov.warnings).toEqual([expect.stringContaining("9999999")]);
  });

  it("refuses a stock tab not named after a month", () => {
    expect(() => parseHkWorkbook(new Map([["Sheet1", novTab], ["Sheet2", priceTab]]))).toThrow(/"Sheet1" harus dinamai bulannya/);
  });

  it("fails clearly when there is no stock tab", () => {
    expect(() => parseHkWorkbook(new Map([["Sheet2", priceTab]]))).toThrow(/stok/i);
  });

  it("warns when a closing stock or a total does not add up", () => {
    const broken = rows([...HEADER, [1107005, "Gula Sachet", "Pack", 250, 50, 999, 129, 999, 250, 100, "Room", null, 29, "Lobby"]]);
    const m = parseHkWorkbook(new Map([["Nov 2026", broken], ["Sheet2", priceTab]])).months[0];
    expect(m.warnings).toEqual([expect.stringContaining("Stock Akhir"), expect.stringContaining("IN 999, jumlah harian 250")]);
  });

  it("warns when a month opens with a different stock than the previous month closed", () => {
    const dec = rows([...HEADER, [1107005, "Gula Sachet", "Pack", 250, 170, 0, 0, 170]]);
    const r = parseHkWorkbook(new Map([["Nov 2026", novTab], ["Des 2026", dec], ["Sheet2", priceTab]]));
    expect(r.months.map((m) => m.month)).toEqual(["2026-11", "2026-12"]);
    expect(r.months[1].warnings).toEqual([expect.stringContaining("Stock Akhir Nov 2026 171")]);
  });

  it("does not count entries on a day the month does not have", () => {
    const feb = rows([
      ["No Art", "Description", "Unit", "Content", "TOTAL", "TOTAL", "TOTAL", "TOTAL", 29],
      ["No Art", "Description", "Unit", "Content", "Stock", "IN", "Out", "Stock", "In", "Out", "Digunakan"],
      ["No Art", "Description", "Unit", "Content", "Awal", "IN", "Out", "Akhir", "In", "Out", "(Di mana )"],
      [1107005, "Gula Sachet", "Pack", 250, 5, 0, 1, 4, null, 1, "Room"],
    ]);
    const m = parseHkWorkbook(new Map([["Feb 2027", feb], ["Sheet2", priceTab]])).months[0];
    expect(m.movements).toEqual([]);
    expect(m.warnings).toEqual(expect.arrayContaining([expect.stringContaining("tanggal 29")]));
  });
});

describe("piecesCounted", () => {
  it("reads sachet counts when IN is a whole number of packs in sachets", () => {
    // Nov 2026 HK sheet: Awal 50, IN 250, Out 141, Akhir 159; VHP bought 4 packs that month.
    expect(piecesCounted("Gula Sachet @250sac /pack", 250, 50, 159)).toBe(250);
  });

  it("keeps pack counts when the numbers only fit packs", () => {
    expect(piecesCounted("Nescafe Classic Sac 1,5Gr @60sac /pa", 12, 1, 0)).toBe(1);
  });

  it("ignores items without a pack content in the name", () => {
    expect(piecesCounted("Lipton Tea Yellow Label Tea Sachet", 200, 100, 137)).toBe(1);
    expect(piecesCounted("Air Mineral 600 Ml", 360, 0, 6)).toBe(1);
  });
});
