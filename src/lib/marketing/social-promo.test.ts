import { describe, expect, it } from "vitest";
import { auditsForOutlet, auditsInPeriod, computePromoLift, portions, shiftDate, type PromoAuditItem } from "./social-promo";

const sales = (from: string, perDay: number[]) => perDay.map((qty, i) => ({ saleDate: shiftDate(from, i), qty, amount: qty * 10_000 }));

describe("computePromoLift (owner, 24 Nov: no verdict before the 7 days are complete)", () => {
  it("compares 7 days with 7 days, so every weekday is on both sides once", () => {
    const r = computePromoLift("2026-11-08", [...sales("2026-11-01", [2, 2, 2, 2, 2, 2, 2]), ...sales("2026-11-08", [3, 3, 3, 3, 3, 3, 3])], "2026-11-22");
    expect(r).toMatchObject({ beforeDays: 7, afterDays: 7, beforeQty: 14, afterQty: 21, qtyPct: 50, verdict: "NAIK" });
    expect(r.reason).toContain("Belum tentu karena postingan");
  });
  it("waits until all 7 days after the post have data", () => {
    const r = computePromoLift("2026-11-21", sales("2026-11-14", [5, 5, 5, 5, 5, 5, 5, 9, 9]), "2026-11-22");
    expect(r).toMatchObject({ verdict: "MENUNGGU_DATA", afterDays: 2, qtyPct: null });
    expect(r.reason).toContain("2 dari 7 hari");
  });
  it("says too little was sold instead of calling 0 → 0 a failure", () => {
    expect(computePromoLift("2026-11-08", [], "2026-11-22").verdict).toBe("SEDIKIT");
    expect(computePromoLift("2026-11-08", sales("2026-11-01", [4, 0, 0, 0, 0, 0, 0, 1]), "2026-11-22").verdict).toBe("SEDIKIT");
  });
  it("knows a small rise, no rise, and a rise from nothing", () => {
    const run = (b: number, a: number) => computePromoLift("2026-11-08", [...sales("2026-11-01", [b]), ...sales("2026-11-08", [a])], "2026-11-22");
    expect(run(20, 22).verdict).toBe("NAIK_TIPIS");
    expect(run(20, 20).verdict).toBe("TIDAK_NAIK");
    expect(run(20, 10)).toMatchObject({ verdict: "TIDAK_NAIK", qtyPct: -50 });
    expect(run(0, 15)).toMatchObject({ verdict: "NAIK", qtyPct: null });
  });
  it("counts the tenths of a weighed dish as tenths", () => {
    expect(portions("(0.1 Ons) Lobster Bakar", 5)).toBe(0.5);
    expect(portions("(Ons) Lobster Bakar", 5)).toBe(5);
  });
});

describe("auditsForOutlet dan auditsInPeriod (tab Media Sosial per outlet, periode aktif)", () => {
  const audit = (id: string, outlet_name: string, post_date: string): PromoAuditItem => ({
    event: { id, post_date, platform: "instagram", outlet_name, promo_title: id, menu_keyword: "*" },
    lift: computePromoLift(post_date, [], "2026-11-24"),
    menus: [],
  });
  const audits = [audit("sunset", "Sunset Grill", "2026-11-12"), audit("dbc", "Dragon Beach Club (Indoor)", "2026-11-20"), audit("spa", "d'Spa", "2026-10-30")];

  it("memilih audit outlet itu saja; Semua Outlet memuat semuanya", () => {
    expect(auditsForOutlet(audits, "dbar").map((a) => a.event.id)).toEqual(["dbc"]);
    expect(auditsForOutlet(audits, "dragon-beach-club").map((a) => a.event.id)).toEqual(["dbc"]);
    expect(auditsForOutlet(audits, "resort")).toEqual([]);
    expect(auditsForOutlet(audits, "all")).toHaveLength(3);
  });

  it("menyaring tanggal tayang pada rentang inklusif", () => {
    expect(auditsInPeriod(audits, "2026-11-01", "2026-11-20").map((a) => a.event.id)).toEqual(["sunset", "dbc"]);
    expect(auditsInPeriod(audits, "2026-10-30", "2026-10-30").map((a) => a.event.id)).toEqual(["spa"]);
  });
});
