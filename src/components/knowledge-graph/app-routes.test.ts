import { describe, expect, it } from "vitest";
import { appRoute } from "./app-routes";

describe("appRoute: links in the graph data point at pages of the old app", () => {
  it("opens Insight Pasar for old Insight Pasar and Ringkasan links, keeping the outlet", () => {
    expect(appRoute("/market-intelligence?outlet=sunset-grill")).toEqual({
      href: "/marketing?bagian=insight-pasar&outlet=sunset-grill",
      label: "Insight Pasar",
    });
    expect(appRoute("/market-intelligence")).toEqual({ href: "/marketing?bagian=insight-pasar", label: "Insight Pasar" });
    expect(appRoute("/dashboard?outlet=dspa")).toEqual({ href: "/marketing?bagian=insight-pasar&outlet=dspa", label: "Insight Pasar" });
    expect(appRoute("/dashboard")).toEqual({ href: "/marketing?bagian=insight-pasar", label: "Insight Pasar" });
  });

  it("opens the Harga view for old Untuk Direksi links, where room rates and menu prices are now", () => {
    expect(appRoute("/direksi?outlet=resort")).toEqual({
      href: "/marketing?bagian=insight-pasar&lihat=harga&outlet=resort",
      label: "Insight Pasar · Harga",
    });
    expect(appRoute("/direksi")).toEqual({ href: "/marketing?bagian=insight-pasar&lihat=harga", label: "Insight Pasar · Harga" });
  });

  it("opens the outlet's own Media Sosial tab, which takes the outlet in lihat", () => {
    expect(appRoute("/marketing-sosmed?outlet=dbar")).toEqual({ href: "/marketing?bagian=media-sosial&lihat=dbar", label: "Media Sosial" });
    expect(appRoute("/marketing-sosmed")).toEqual({ href: "/marketing?bagian=media-sosial", label: "Media Sosial" });
  });

  it("opens the competitor list for the old gallery page, where each competitor's photos are", () => {
    expect(appRoute("/galeri-kompetitor")).toEqual({ href: "/marketing?bagian=insight-pasar&lihat=kompetitor", label: "Insight Pasar · Kompetitor" });
  });

  it("keeps links that already open a page of this app", () => {
    expect(appRoute("/")).toEqual({ href: "/", label: "Dashboard" });
    expect(appRoute("/pengaturan")).toEqual({ href: "/pengaturan", label: "Pengaturan" });
    expect(appRoute("/marketing")).toEqual({ href: "/marketing", label: "Marketing" });
    expect(appRoute("/marketing?bagian=strategy&outlet=resort")).toEqual({ href: "/marketing?bagian=strategy&outlet=resort", label: "Strategy" });
  });

  it("drops an outlet value that is not one of the six outlets", () => {
    expect(appRoute("/direksi?outlet=semua")).toEqual({ href: "/marketing?bagian=insight-pasar&lihat=harga", label: "Insight Pasar · Harga" });
  });
});
