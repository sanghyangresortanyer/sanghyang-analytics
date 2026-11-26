import { describe, expect, it } from "vitest";
import { renderReports } from "../marketing/weekly-report.ts";
import { outletTotals, renderResort, resortReport, type ResortSide } from "./resort-report.ts";

const side = (over: Partial<ResortSide> = {}): ResortSide => ({
  outlets: { "Front Office": 234_640_886, "d'Bar Karaoke & DBC": 200_000_000, "Sunset Grill": 110_000_000, "d'Bistro": 100_000_000 },
  segments: [
    { segment: "FIT-TA", lodging: 130_825_886 },
    { segment: "WALK IN", lodging: 59_252_000 },
    { segment: "FIT", lodging: 20_994_000 },
    { segment: "FIT-CORP", lodging: 10_404_000 },
    { segment: "GIT-CORP", lodging: 13_165_000 },
  ],
  stay: { rooms: 429, nights: 22, occ: 31.97, arr: 602_815 },
  purchase: 199_781_204,
  ...over,
});
const before = side({
  outlets: { "Front Office": 187_784_970, "d'Bar Karaoke & DBC": 210_000_000, "Sunset Grill": 100_000_000, "d'Bistro": 90_000_000 },
  segments: [{ segment: "FIT-TA", lodging: 120_919_970 }, { segment: "WALK IN", lodging: 47_018_000 }, { segment: "FIT", lodging: 9_492_000 }, { segment: "FIT-CORP", lodging: 10_355_000 }],
  stay: { rooms: 380, nights: 22, occ: 28.32, arr: 541_189 },
  purchase: 180_000_000,
});
const periods = { current: { since: "2026-11-01", until: "2026-11-22" }, previous: { since: "2026-10-01", until: "2026-10-22" }, labels: { prev: "Oktober 2026", curr: "November 2026" }, title: "Laporan Resort per bulan" };

describe("resortReport (owner, 25 Nov 2026: one report for the whole resort)", () => {
  const r = resortReport({ periods, curr: side(), prev: before, lastDataDay: "2026-11-22", cut: true });
  const rows = (title: string) => r.groups.find((g) => g.title.startsWith(title))!.rows;
  const row = (title: string, metric: string) => rows(title).find((x) => x.metric === metric)!;

  it("names the resort and Sanghyang Analytics, not hotel or VRP", () => {
    expect(r.title).toBe("Laporan Resort per bulan");
    expect(r.business).toBe("Sanghyang Indah Spa Resort");
    expect(r.url).toBe("Data VHP yang diunggah ke Sanghyang Analytics");
    expect(JSON.stringify(r)).not.toMatch(/hotel/i);
    expect(JSON.stringify(r)).not.toMatch(/\bVRP\b/);
  });

  it("lists every outlet, biggest first, and the resort total", () => {
    expect(rows("1.").map((x) => x.metric)).toEqual(["Front Office", "d'Bar Karaoke & DBC", "Sunset Grill", "d'Bistro", "Total revenue resort"]);
    expect(row("1.", "Total revenue resort")).toMatchObject({ curr: 644_640_886, prev: 587_784_970, total: true });
    expect(row("1.", "Front Office").note).toBe("36,4% dari total");
  });

  it("rooms: all guests together, OCC in points, every guest type", () => {
    expect(row("2.", "Revenue kamar")).toMatchObject({ curr: 234_640_886, prev: 187_784_970, sub: "semua tamu digabung" });
    expect(row("2.", "OCC").points).toBe(true);
    expect(row("2.", "Kamar terjual")).toMatchObject({ curr: 429, prev: 380 });
    expect(rows("2.").map((x) => x.metric).slice(4)).toEqual(["WALK IN", "FIT", "OTA", "Perusahaan", "Rombongan"]);
    expect(row("2.", "Rombongan").prev).toBe(0);
  });

  it("purchase next to revenue", () => {
    expect(row("3.", "Total pembelian")).toMatchObject({ curr: 199_781_204, prev: 180_000_000 });
    expect(row("3.", "Pembelian dibanding revenue").curr).toBeCloseTo((199_781_204 / 644_640_886) * 100);
  });

  it("opens with the total and says what moved most", () => {
    expect(r.kpis.map((k) => k.label)).toEqual(["Total revenue resort", "Revenue kamar", "OCC", "Total pembelian"]);
    expect(r.highlights[0]).toBe("Total revenue resort naik 10%: Rp587.784.970 → Rp644.640.886.");
    expect(r.highlights).toContain("Naik paling banyak: Front Office +Rp46.855.916. Turun paling banyak: d'Bar Karaoke & DBC -Rp10.000.000.");
    expect(r.highlights).toContain("OCC naik 3,7 poin (28,3% → 32,0%), ARR naik 11% (Rp541.189 → Rp602.815).");
    expect(r.limits.join(" ")).toContain("dipotong");
  });

  it("leaves a figure empty, never 0, when it could not be read", () => {
    const x = resortReport({ periods, curr: side({ stay: null, purchase: null }), prev: before, lastDataDay: "2026-11-22", cut: false });
    const g = (t: string, m: string) => x.groups.find((gr) => gr.title.startsWith(t))!.rows.find((y) => y.metric === m)!;
    expect(g("2.", "OCC").curr).toBeNull();
    expect(g("3.", "Total pembelian").curr).toBeNull();
    expect(renderReports([x]).includes("Laporan Resort per bulan")).toBe(true);
  });
});

describe("renderResort (owner, 25 Nov: tidy, per outlet then the total revenue)", () => {
  const html = renderResort(resortReport({ periods, curr: side(), prev: before, lastDataDay: "2026-11-22", cut: true }), new Date("2026-11-25T07:00:00Z"));
  it("is the owner's table: Deskripsi, both periods, Status, without the side column", () => {
    expect(html).toContain("<th>Deskripsi</th>");
    expect(html).toContain("<th>Status</th>");
    expect(html).not.toContain(">Bagian<");
    expect(html).not.toContain("Keterangan");
  });
  it("lists every outlet first and the total revenue as the last row", () => {
    const outlets = html.slice(html.indexOf("Revenue per outlet"), html.indexOf("Kamar</h2>"));
    const names = [...outlets.matchAll(/<td class="desc"><b>([^<]+)<\/b>/g)].map((m) => m[1]);
    expect(names).toEqual(["Front Office", "d&#39;Bar Karaoke &amp; DBC", "Sunset Grill", "d&#39;Bistro", "Total revenue resort"]);
    expect(html.indexOf("Total revenue resort")).toBeGreaterThan(html.indexOf("Sunset Grill"));
  });
  it("writes the change in words, points for percentages", () => {
    expect(html).toContain("▲ Naik 10%");
    expect(html).toContain("▼ Turun 5%");
    expect(html).toContain("▲ Naik 3,7 poin");
  });
});

describe("outletTotals", () => {
  const names = ["Front Office", "d'Bistro", "Souvenir Shop & SR", "Banquet", "Room Service"];
  it("joins a name VHP cut to 12 characters with the full one (Souvenir Sho, audit 25 Nov)", () => {
    expect(outletTotals([{ outlet_name: "Souvenir Sho", revenue: "700000" }, { outlet_name: "Souvenir Shop & SR", revenue: 300_000 }], names)).toEqual({ "Souvenir Shop & SR": 1_000_000 });
  });
  it("keeps Banquet and Room Service inside d'Bistro, as on the dashboard, and a name it does not know as it is", () => {
    expect(outletTotals([{ outlet_name: "Banquet", revenue: 5 }, { outlet_name: "Room Service", revenue: 3 }, { outlet_name: "d'Bistro", revenue: 2 }, { outlet_name: "Laundry", revenue: 1 }], names)).toEqual({ "d'Bistro": 10, Laundry: 1 });
  });
});
