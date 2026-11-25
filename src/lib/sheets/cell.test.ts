import { describe, expect, it } from "vitest";
import { cellNumber, cellText, numberFromText } from "./cell";

describe("numberFromText", () => {
  it.each([
    ["12", 12],
    ["0.5", 0.5],
    ["0,5", 0.5],
    ["8.600,00", 8600],
    ["1.250.000,5", 1250000.5],
  ])("reads %s", (raw, value) => {
    expect(numberFromText(raw)).toEqual({ kind: "number", value });
  });

  it("treats a dash as not filled in", () => {
    expect(numberFromText("-")).toEqual({ kind: "empty" });
  });

  it.each(["1.500", "25.800.00", "103.00.00", "0',5", "abc"])("refuses %s instead of guessing", (raw) => {
    expect(numberFromText(raw).kind).toBe("invalid");
  });
});

describe("cellNumber", () => {
  it("reads formula results and treats a formula without cached result as 0", () => {
    expect(cellNumber({ formula: "+D6*F6", result: 71000 })).toEqual({ kind: "number", value: 71000 });
    expect(cellNumber({ formula: "+E4+F4-G4" })).toEqual({ kind: "number", value: 0 });
  });

  it("reports spreadsheet errors", () => {
    expect(cellNumber({ formula: "VLOOKUP()", result: { error: "#N/A" } })).toEqual({ kind: "invalid", text: "#N/A" });
    expect(cellNumber({ error: "#REF!" })).toEqual({ kind: "invalid", text: "#REF!" });
  });

  it("returns empty for blank cells", () => {
    expect(cellNumber(null)).toEqual({ kind: "empty" });
    expect(cellNumber("  ")).toEqual({ kind: "empty" });
  });
});

describe("cellText", () => {
  it("joins rich text and unwraps formula results", () => {
    expect(cellText({ richText: [{ text: "https://" }, { text: "x" }] })).toBe("https://x");
    expect(cellText({ formula: "VLOOKUP()", result: "Ayam " })).toBe("Ayam");
  });
});
