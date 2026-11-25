import { describe, expect, it } from "vitest";
import { niceTicks } from "./chart-scale";
import { formatRpShort } from "./format-currency";

describe("niceTicks", () => {
  it("covers the max with round steps", () => {
    expect(niceTicks(310_069_539)).toEqual([0, 100e6, 200e6, 300e6, 400e6]);
    expect(niceTicks(1_000_000)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000]);
  });
  it("returns a single zero tick when there is no data", () => {
    expect(niceTicks(0)).toEqual([0]);
  });
});

describe("formatRpShort", () => {
  it("abbreviates to rb / jt / M with Indonesian decimals", () => {
    expect(formatRpShort(310_069_539)).toBe("310,1 jt");
    expect(formatRpShort(1_250_000_000)).toBe("1,3 M");
    expect(formatRpShort(450_000)).toBe("450 rb");
    expect(formatRpShort(0)).toBe("0");
  });
});
