import { describe, expect, it } from "vitest";
import { humanizeDashes, humanizeDeep } from "./humanize-text";

describe("humanizeDashes", () => {
  it("mengganti em dash dengan koma seperti tulisan staf", () => {
    expect(humanizeDashes("Hari biasa — Fase 1: pertahankan Rp 418.304.")).toBe("Hari biasa, Fase 1: pertahankan Rp 418.304.");
    expect(humanizeDashes("Promo kamar—diskon 25% di Aston")).toBe("Promo kamar, diskon 25% di Aston");
  });
  it("membuang em dash di awal baris dan sebelum tanda baca penutup", () => {
    expect(humanizeDashes("— Rilis 3 video pendek\n— Pantau tayangan")).toBe("Rilis 3 video pendek\nPantau tayangan");
    expect(humanizeDashes("Selesai —.")).toBe("Selesai.");
  });
  it("membiarkan en dash rentang dan teks tanpa em dash", () => {
    expect(humanizeDashes("7 tipe kamar 24–115 m² di Anyer–Carita, buka 09.00–22.00")).toBe("7 tipe kamar 24–115 m² di Anyer–Carita, buka 09.00–22.00");
    expect(humanizeDashes("")).toBe("");
  });
  it("teks tanpa em dash tidak disentuh sama sekali, termasuk koma ganda atau koma sebelum tanda kurung", () => {
    expect(humanizeDashes("Sumber: Google Maps,, Traveloka (4,5, )")).toBe("Sumber: Google Maps,, Traveloka (4,5, )");
  });
});

describe("humanizeDeep", () => {
  it("membersihkan semua string di objek dan larik bersarang, nilai lain tetap", () => {
    const input = { action: "Tambah Reels — fokus sunset dermaga.", steps: ["— Rilis 3 video", "Pantau tayangan"], score: 3, ok: true, none: null, nested: { note: "Harga naik — cek OTA" } };
    expect(humanizeDeep(input)).toEqual({
      action: "Tambah Reels, fokus sunset dermaga.",
      steps: ["Rilis 3 video", "Pantau tayangan"],
      score: 3,
      ok: true,
      none: null,
      nested: { note: "Harga naik, cek OTA" },
    });
  });
});
