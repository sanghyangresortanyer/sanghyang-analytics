import { describe, expect, it } from "vitest";
import { daysInMonth, parseMonthName, previousMonth } from "./month-name";

describe("parseMonthName", () => {
  it.each([
    ["Nov 2026", "2026-11"],
    ["November 2026", "2026-11"],
    ["NOV 26", "2026-11"],
    ["Des 2026", "2026-12"],
    ["Dec-2026", "2026-12"],
    ["Mei 2027", "2027-05"],
    ["Agustus 2027", "2027-08"],
    ["Okt 2027", "2027-10"],
    ["11-2026", "2026-11"],
    ["2026-11", "2026-11"],
  ])("reads %s", (name, month) => {
    expect(parseMonthName(name)).toBe(month);
  });

  it.each(["Sheet1", "Sheet2", "Nov", "13-2026", "Foo 2026", "15-11-26"])("rejects %s", (name) => {
    expect(parseMonthName(name)).toBeNull();
  });
});

describe("month helpers", () => {
  it("knows month lengths and the previous month", () => {
    expect(daysInMonth("2026-11")).toBe(30);
    expect(daysInMonth("2026-12")).toBe(31);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });
});
