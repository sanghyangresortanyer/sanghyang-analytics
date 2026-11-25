import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isClosedReceivingReport } from "./closed-receiving";
import { parsePurchaseReceipts } from "./purchase-receipts";

const real = path.resolve(process.cwd(), "fixtures/arsip/2026-01-01_to_2026-10-31/pembelian closed jan-sep.txt");
const itReal = existsSync(real) ? it : it.skip;

const sample = [
  "Receiving List -",
  "Article's Main Group: FOOD",
  "",
  "Date     Supplier     St ArtNo   Description                           D-Unit            Price        Quantity           Value Document-No  DeliverNote",
  "01/01/26 CASH ANYER   01 1109048 xxx Chicken Sausage CHAMP                Pack          48,500          4.00        194,000.00 Direct Pchas I260101001          ",
  "         T O T A L               Frozen Product                                                         4.00        194,000.00                                 ",
  "06/01/26 UD Bakul Say 01 1107048 Cereal Koko Krunch @330gr /pack          Pack          41,030          3.00        123,090.00 Direct Pchas I260106002          ",
].join("\n");

describe("closed receiving report", () => {
  it("is told apart from the open report and read line by line", () => {
    expect(isClosedReceivingReport(sample)).toBe(true);
    expect(isClosedReceivingReport("Receiving List by all suppliers\nDate     St ArtNo")).toBe(false);
    const r = parsePurchaseReceipts(sample, ["UD Bakul Sayur Segar", "CASH ANYER"]);
    expect(r.fatal).toBe(false);
    expect(r.stats.unreadableCount).toBe(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ businessDate: "2026-01-01", ingredientCode: "001109048", description: "xxx Chicken Sausage CHAMP", unit: "Pack", price: 48500, qty: 4, value: 194000, supplier: "CASH ANYER", documentNo: "Direct Pchas", deliverNote: "I260101001" });
    // VHP cuts supplier names to 12 characters; a known full name is restored.
    expect(r.rows[1].supplier).toBe("UD Bakul Sayur Segar");
  });

  itReal("reads every line of the real Jan–Sep 2026 export and matches its GRAND TOTAL", () => {
    const text = readFileSync(real, "latin1");
    const r = parsePurchaseReceipts(text);
    expect(r.stats.unreadableCount).toBe(0);
    expect(r.rows).toHaveLength(7991);
    const total = r.rows.reduce((s, x) => s + (x.value ?? 0), 0);
    expect(total).toBeCloseTo(2_581_765_724.69, 1);
    const months = new Set(r.rows.map((x) => x.businessDate.slice(0, 7)));
    expect([...months].sort()).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  });
});
