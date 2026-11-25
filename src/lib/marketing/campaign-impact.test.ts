import { describe, expect, it } from "vitest";
import { campaignImpact, type ImpactMonth } from "./campaign-impact.ts";

type Ad = [cost: number, contacts: number, maps: number];
const month = (m: string, local: Ad, promo: Ad, hotel: [fit: number, walkIn: number, ota: number] | null, over: Partial<ImpactMonth> = {}): ImpactMonth => ({
  month: m,
  period: { since: `${m}-01`, until: `${m}-28` },
  partial: false,
  ads: { "Local store visits": { cost: local[0], contacts: local[1], maps: local[2] }, "MONTHLY PROMO": { cost: promo[0], contacts: promo[1], maps: promo[2] } },
  hotel: hotel && { fit: hotel[0], walkIn: hotel[1], ota: hotel[2] },
  ...over,
});
const M = (i: number) => `2026-${String(i).padStart(2, "0")}`;
const up = (f: (i: number) => [Ad, Ad, [number, number, number]]) => Array.from({ length: 8 }, (_, i) => month(M(i + 1), ...f(i)));
const row = (r: ReturnType<typeof campaignImpact>, name: string) => r.tables[1].rows.find((x) => x[0] === name)!;

describe("campaignImpact: monthly check of every campaign against room revenue (owner, 24 Nov)", () => {
  it("Local is checked against WALK IN with Maps routes, the others against FIT with chat and phone", () => {
    const r = campaignImpact(up((i) => [[1e6 + i, 1, 10 + i], [1e6 + i, 5 + i, 0], [1e6 + i, 2e6 + i, 3e6 + i]]));
    expect(row(r, "Local store visits")[1]).toBe("WALK IN");
    expect(row(r, "MONTHLY PROMO")[1]).toBe("FIT");
    expect(r.tables[0].head).toEqual(["Bulan", "Local store visits: biaya", "rute Maps", "MONTHLY PROMO: biaya", "chat + telepon", "Revenue FIT", "Revenue WALK IN", "Revenue OTA"]);
  });

  it("a result that moves with OTA just as well is read as season, not as the ad", () => {
    const z = (i: number) => (i % 2 ? 100 : 10);
    const r = campaignImpact(up((i) => [[1e6 + i, 1, z(i)], [1e6 + i, z(i), 0], [z(i), z(i), z(i)]]));
    expect(row(r, "Local store visits")[4]).toBe("7 dari 7");
    expect(row(r, "Local store visits")[5]).toMatch(/^Belum terbukti.*musim/);
  });

  it("only a campaign whose cost and result both follow its guests, clearly more than OTA, is a hint to test", () => {
    const z = (i: number) => (i % 2 ? 100 : 10);
    const r = campaignImpact(up((i) => [[z(i), 1, z(i)], [1e6 + i, 5 + (i % 3), 0], [50 + i, z(i), 100 - z(i)]]));
    expect(row(r, "Local store visits").slice(2, 5)).toEqual(["7 dari 7", "7 dari 7", "0 dari 7"]);
    expect(row(r, "Local store visits")[5]).toMatch(/^Ada petunjuk/);
    expect(row(r, "MONTHLY PROMO")[5]).toMatch(/^Belum terbukti/);
    expect(JSON.stringify(r)).not.toMatch(/"Terbukti/);
  });

  it("a running month is shown but not counted; a month without hotel data is 'Belum ada data'", () => {
    const base = up((i) => [[1e6 + i, 1, i + 1], [1e6 + i, 5 + i, 0], [1e6 + i, 1e6 + i, 1e6 - i]]);
    const r = campaignImpact([...base, month(M(9), [1, 1, 1], [1, 1, 1], [9, 9, 9], { partial: true, period: { since: "2026-09-01", until: "2026-09-22" } }), month(M(10), [1, 1, 1], [1, 1, 1], null)]);
    expect(row(r, "Local store visits")[2]).toBe("7 dari 7");
    expect(r.tables[0].rows[8][0]).toBe("1–\u206022\u00a0Sep\u00a02026");
    expect(r.tables[0].rows[9].slice(-3)).toEqual(["Belum ada data", "Belum ada data", "Belum ada data"]);
  });

  it("compares per day, so a short month does not look like a drop", () => {
    const a = month("2026-01", [31e5, 31, 31], [1e6, 5, 0], [31e6, 31e6, 31e6], { period: { since: "2026-01-01", until: "2026-01-31" } });
    const b = month("2026-02", [28.1e5, 29, 29], [1e6, 5, 0], [29e6, 29e6, 29e6], { period: { since: "2026-02-01", until: "2026-02-28" } });
    expect(row(campaignImpact([a, b]), "Local store visits").slice(2, 4)).toEqual(["1 dari 1", "1 dari 1"]);
  });

  it("too few full months gives no verdict", () => {
    const r = campaignImpact([month(M(1), [1, 1, 1], [1, 1, 1], [1, 1, 1]), month(M(2), [2, 2, 2], [2, 2, 2], [2, 2, 2])]);
    expect(row(r, "Local store visits")[5]).toMatch(/^Data belum cukup/);
  });

  it("without any Google figures there is no table", () => {
    expect(campaignImpact([month(M(1), [1, 1, 1], [1, 1, 1], [1, 1, 1], { ads: null })]).tables).toEqual([]);
  });
});
