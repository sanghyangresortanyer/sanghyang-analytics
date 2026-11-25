import { describe, it, expect } from "vitest";
import { parseVhpNumber } from "./number";

describe("parseVhpNumber", () => {
  it("parses thousand+decimal separators", () => {
    expect(parseVhpNumber("1,357.10")).toBeCloseTo(1357.1);
    expect(parseVhpNumber("24,667.58")).toBeCloseTo(24667.58);
    expect(parseVhpNumber("1,200.000")).toBeCloseTo(1200);
    expect(parseVhpNumber("0.050")).toBeCloseTo(0.05);
  });

  it("returns null for garbage", () => {
    expect(parseVhpNumber("abc")).toBeNull();
    expect(parseVhpNumber("")).toBeNull();
  });
});
