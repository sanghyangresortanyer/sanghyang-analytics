import { describe, expect, it } from "vitest";
import { MAX_TARGET, mergeTargets, monthlyTargetFor, parseRupiah, targetProgress } from "./outlet-targets";

describe("monthlyTargetFor", () => {
  it("finds targets whatever the source spells the outlet", () => {
    expect(monthlyTargetFor("Front Office")).toBe(500_000_000);
    expect(monthlyTargetFor("d'Bar Karaoke & DBC")).toBe(800_000_000);
    expect(monthlyTargetFor("SUNSET GRILL")).toBe(250_000_000);
    expect(monthlyTargetFor("d'Bistro")).toBe(200_000_000);
    expect(monthlyTargetFor("d'Spa")).toBe(100_000_000);
  });

  it("has no target for Souvenir Shop and Laundry", () => {
    expect(monthlyTargetFor("Souvenir Shop & SR")).toBeNull();
    expect(monthlyTargetFor("Laundry")).toBeNull();
  });
});

describe("targetProgress", () => {
  it("reports how much is left", () => {
    // Front Office 1–14 Nov 2026: Rp 109.942.079 of Rp 500 jt.
    const p = targetProgress(109_942_079, 500_000_000)!;
    expect(p.achievedPct).toBeCloseTo(21.99, 2);
    expect(p.remainingPct).toBeCloseTo(78.01, 2);
    expect(p.remainingAmount).toBe(390_057_921);
    expect(p.reached).toBe(false);
  });

  it("marks a reached target with nothing left", () => {
    expect(targetProgress(260_000_000, 250_000_000)).toMatchObject({ reached: true, remainingPct: 0, remainingAmount: 0, achievedPct: 104 });
  });

  it("returns null without a target", () => {
    expect(targetProgress(1000, null)).toBeNull();
  });

  it("does not treat unavailable revenue as zero progress", () => {
    expect(targetProgress(null, 500_000_000)).toBeNull();
  });
});

describe("mergeTargets", () => {
  it("uses the defaults while nothing is saved", () => {
    const t = mergeTargets([]);
    expect(t.map((x) => x.outlet)).toEqual(["Front Office", "d'Bar Karaoke & DBC", "Sunset Grill", "d'Bistro", "d'Spa"]);
    expect(t[0]).toEqual({ outlet: "Front Office", monthlyTarget: 500_000_000, version: 0 });
  });

  it("replaces a default by its saved row, matched like the dashboard matches outlets", () => {
    const t = mergeTargets([{ outlet: "FRONT OFFICE", monthly_target: "550000000", version: 3 }]);
    expect(t[0]).toEqual({ outlet: "Front Office", monthlyTarget: 550_000_000, version: 3 });
    expect(t[1].version).toBe(0);
  });

  it("keeps a saved 0 (no target)", () => {
    expect(mergeTargets([{ outlet: "d'Spa", monthly_target: 0, version: 1 }])[4].monthlyTarget).toBe(0);
  });
});

describe("parseRupiah", () => {
  it("reads amounts with dots, spaces or Rp", () => {
    expect(parseRupiah("500.000.000")).toBe(500_000_000);
    expect(parseRupiah("Rp 250.000.000")).toBe(250_000_000);
    expect(parseRupiah("100000000")).toBe(100_000_000);
  });

  it("treats empty as no target", () => {
    expect(parseRupiah("  ")).toBe(0);
  });

  it("refuses decimals, negatives, text and amounts above the limit", () => {
    expect(parseRupiah("500,5")).toBeNull();
    expect(parseRupiah("-5")).toBeNull();
    expect(parseRupiah("lima ratus")).toBeNull();
    expect(parseRupiah(String(MAX_TARGET + 1))).toBeNull();
  });
});
