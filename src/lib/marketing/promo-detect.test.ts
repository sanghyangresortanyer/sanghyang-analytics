import { describe, expect, it } from "vitest";
import { detectPromo, newPromoEvents, PROMO_AUDIT_OUTLETS, promoOutletKeys, type VhpMenu } from "./promo-detect";

const menu = (outlet: string, ...names: string[]): VhpMenu[] => names.map((description) => ({ outlet, description }));
const MENUS: VhpMenu[] = [
  ...menu("Sunset Grill", "(Ons) Lobster Bakar", "(0.1 Ons) Lobster Bakar", "(Ons) Kepiting Saus Padang", "Meat Lover Pizza", "SEAFOOD GABRUGAN", "ES KOPI SUNSET", "MELON MOJITO (COCKTAIL)", "ICE TEA", "Nasi Goreng Seafood", "Disc Food 20%"),
  ...menu("d'Spa", "Aquamedic Single (45m)", "Sanghyang Massage (120m)", "Balinese Massage (90m)", "Hair Spa (45m)"),
  ...menu("d'Bar Karaoke & DBC", "DBC GREYGOOSE VODKA BOTTLE", "DBC TEQUILA HERADURA PLATA B", "DBC MARTEL VSOP BOTTLE", "DBC CHIVAS REGAL 12 BOTTLE", "DBC CHIVAS REGAL 18 BOTTLE"),
  ...menu("d'Bistro", "SOP BUNTUT", "SATE BEBEK", "Nasi Goreng Seafood"),
];
const post = (caption: string, over: Partial<{ id: string; timestamp: string; outlet_username: string }> = {}) => ({ id: "p1", caption, timestamp: "2026-11-21T00:08:00+0000", permalink: "https://www.instagram.com/p/x/", outlet_username: "sanghyangresort", ...over });
const found = (caption: string, over = {}) => detectPromo(post(caption, over), MENUS)?.items.map((i) => `${i.outlet}: ${i.keyword}`) ?? null;

describe("detectPromo reads the offer and the promoted menu from the post text (owner, 24 Nov)", () => {
  it("Sunset 21 Nov: lobster, crab (= kepiting in the till), not the free mocktail or ice tea", () => {
    expect(found("Seafood segar dengan bumbu spesial kami\nHari ini, semua varian Lobster gratis 2 Mocktails, dan semua varian Crab diskon 20%. Ajak keluarga!\n@sunsetgrillsanghyang\n#SunsetGrillSeafood")).toEqual(["Sunset Grill: Lobster", "Sunset Grill: Kepiting"]);
    expect(found("Hari ini, pesan Kerang Gabrugan gratis 3 Ice Tea. Promo terbatas!\n@sunsetgrillsanghyang")).toEqual(["Sunset Grill: GABRUGAN"]);
    expect(found("Spesial November, Buy 2 Disc 20% untuk semua varian dessert dan cocktails di Sunset Grill Seafood.")).toEqual(["Sunset Grill: COCKTAIL"]);
  });

  it("DBC 21 Nov: brand names spelled differently in the till", () => {
    expect(found("All item Disc 20% + Free Cocktail untuk Grey Goose, Herradura, dan Macallan.\n#DragonBeachClub")).toEqual(["Dragon Beach Club (Indoor): GREYGOOSE", "Dragon Beach Club (Indoor): HERADURA"]);
    expect(found("All item Disc 10% + Free Cocktail untuk Martell VSOP dan Chivas Regal 18.\n#DragonBeachClub")).toEqual(["Dragon Beach Club (Indoor): MARTEL VSOP", "Dragon Beach Club (Indoor): CHIVAS REGAL 18"]);
  });

  it("Spa: the exact treatment, and all treatments", () => {
    expect(found("Nikmati diskon 30% untuk Sanghyang Massage. Mulai dari aromaterapi alami hingga hotspring spa.\n#dSpa")).toEqual(["d'Spa: Sanghyang Massage"]);
    expect(found("Promo Special November: 30% OFF untuk Aquamedic di d’Spa Hotspring.\n#dSpa #Aquamedic")).toEqual(["d'Spa: Aquamedic"]);
    expect(found("Nikmati relaksasi di d’Spa dengan promo spesial\n\n BUY 5 GET 1 FREE untuk All Treatments!")).toEqual(["d'Spa: *"]);
  });

  it("a carousel with several outlets' texts keeps each offer", () => {
    expect(found("Nikmati diskon 30% untuk Sanghyang Massage.\n#dSpa\n\nPromo Special November: 30% OFF untuk Aquamedic di d’Spa Hotspring.")).toEqual(["d'Spa: Sanghyang Massage", "d'Spa: Aquamedic"]);
  });

  it("is not a promo: gatherings, recipes, free entry, words like 'promo' without an offer", () => {
    expect(found("Terimakasih PT.JMP telah berkunjung, semua info dan promo cek web di bio yaa")).toBeNull();
    expect(found("Open Everyday 16.00-23.00 Free Entry | Live Music | Sunset View")).toBeNull();
    expect(found("Hallo Sunset Lovers, ini dia resep Pinacolada dari kaka Ajo")).toBeNull();
    expect(detectPromo(post(""), MENUS)).toBeNull();
  });

  it("an offer without a known menu is reported, not audited", () => {
    const p = detectPromo(post("FREE ENTRY alias GRATIS Pake baju HITAM ya guys", { outlet_username: "sunsetgrillsanghyang" }), MENUS);
    expect(p === null || p.items.length === 0).toBe(true);
    expect(detectPromo(post("Diskon 20% untuk Macallan #DragonBeachClub"), MENUS)?.items).toEqual([]);
  });

  it("dates the post in WIB, not UTC or the poster's country", () => {
    expect(detectPromo(post("Diskon 20% Aquamedic #dSpa", { timestamp: "2026-11-20T18:30:00+0000" }), MENUS)?.date).toBe("2026-11-21");
    expect(detectPromo(post("Diskon 20% Aquamedic #dSpa", { timestamp: "2026-11-21T00:10:00+0000" }), MENUS)?.date).toBe("2026-11-21");
  });
});

describe("newPromoEvents adds each menu once and never brings back an ignored one", () => {
  const posts = [post("Nikmati diskon 30% untuk Sanghyang Massage. #dSpa", { id: "a" }), post("Diskon 10% untuk Martell VSOP #DragonBeachClub", { id: "b" })];
  it("inserts only what is missing", () => {
    const first = newPromoEvents(posts, MENUS, [], "2026-09-25");
    expect(first.events.map((e) => [e.source_post_id, e.outlet_name, e.menu_keyword, e.post_date])).toEqual([
      ["a", "d'Spa", "Sanghyang Massage", "2026-11-21"],
      ["b", "Dragon Beach Club (Indoor)", "MARTEL VSOP", "2026-11-21"],
    ]);
    const again = newPromoEvents(posts, MENUS, first.events, "2026-09-25");
    expect(again.events).toEqual([]);
    expect(again.existing).toBe(2);
  });
  it("leaves out posts before the start date and lists offers without a known menu", () => {
    const r = newPromoEvents([...posts, post("Diskon 20% untuk Macallan #DragonBeachClub", { id: "c" })], MENUS, [], "2026-09-25");
    expect(r.unknown.map((p) => p.permalink)).toEqual(["https://www.instagram.com/p/x/"]);
    expect(newPromoEvents(posts, MENUS, [], "2026-11-22").events).toEqual([]);
  });
});

describe("promoOutletKeys: nama outlet audit atau kasir ke tab outlet halaman Marketing", () => {
  it("DBC (Indoor) dan kasir d'Bar Karaoke & DBC melayani Dragon Beach Club dan D'Bar", () => {
    expect(promoOutletKeys("Dragon Beach Club (Indoor)")).toEqual(["dragon-beach-club", "dbar"]);
    expect(promoOutletKeys("d'Bar Karaoke & DBC")).toEqual(["dragon-beach-club", "dbar"]);
    expect(promoOutletKeys("Sunset Grill")).toEqual(["sunset-grill"]);
    expect(promoOutletKeys(" d'bistro ")).toEqual(["dbistro"]);
    expect(promoOutletKeys("d'Spa")).toEqual(["dspa"]);
  });

  it("Kamar & Resort tidak punya menu kasir, jadi tidak punya audit promo", () => {
    expect(promoOutletKeys("Front Office")).toEqual([]);
    expect(PROMO_AUDIT_OUTLETS).not.toContain("resort");
    expect([...PROMO_AUDIT_OUTLETS].sort()).toEqual(["dbar", "dbistro", "dragon-beach-club", "dspa", "sunset-grill"]);
  });
});
