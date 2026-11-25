import { describe, expect, it } from "vitest";
import { chooseHkMonth, hkMonths } from "./hk-months";

const items = [{ period_month: "2026-11-01" }, { period_month: "2026-10-01" }, { period_month: "2026-11-01" }, { period_month: "2026-12-01" }];

describe("hkMonths", () => {
  it("lists each month once, newest first", () => {
    expect(hkMonths(items)).toEqual(["2026-12-01", "2026-11-01", "2026-10-01"]);
  });
});

describe("chooseHkMonth", () => {
  const months = hkMonths(items);
  it("takes the requested month when the sheet has it", () => {
    expect(chooseHkMonth(months, "2026-10-01")).toBe("2026-10-01");
  });
  it("falls back to the newest month for a missing or unknown month", () => {
    expect(chooseHkMonth(months, undefined)).toBe("2026-12-01");
    expect(chooseHkMonth(months, "2025-01-01")).toBe("2026-12-01");
  });
  it("is null without HK data", () => {
    expect(chooseHkMonth([], "2026-10-01")).toBeNull();
  });
});
