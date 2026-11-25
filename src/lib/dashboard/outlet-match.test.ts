import { describe, expect, it } from "vitest";
import { mrOutletFor, sameOutlet } from "./outlet-match";

describe("sameOutlet", () => {
  it.each([
    ["d'Bistro", "BISTRO"],
    ["d'Bistro", "bistro"],
    ["Sunset Grill", "SUNSET GRILL"],
    ["Laundry", "laundry "],
    ["d'Bar Karaoke & DBC", "d'Bar Karaoke  & DBC"],
  ])("matches %s with %s", (a, b) => {
    expect(sameOutlet(a, b)).toBe(true);
  });

  it.each([
    ["Room Service", "Room"],
    ["d'Spa", "SPA & SG"],
    ["Front Office", "Office"],
  ])("does not match %s with %s", (a, b) => {
    expect(sameOutlet(a, b)).toBe(false);
  });
});

describe("mrOutletFor", () => {
  it("maps the department codes found in the sheet", () => {
    expect(mrOutletFor("DBC")).toBe("d'Bar Karaoke & DBC");
    expect(mrOutletFor(" eng ")).toBe("ENGINEERING");
  });

  it("keeps unknown or missing codes visible instead of guessing", () => {
    expect(mrOutletFor("SPA")).toBe("MR - SPA");
    expect(mrOutletFor(null)).toBe("MR");
  });
});
