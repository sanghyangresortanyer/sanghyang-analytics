import { describe, expect, it } from "vitest";
import { legacyMarketingHref } from "./marketing-nav";

describe("legacyMarketingHref: tautan lama tab Sosmed Sanghyang", () => {
  it("mengalihkan bagian=sosmed dengan lihat apa pun ke tab Media Sosial, outlet bawaan", () => {
    for (const lihat of [undefined, "feed", "audit", "akun", "tidak-dikenal"]) {
      expect(legacyMarketingHref({ bagian: "sosmed", lihat }), String(lihat)).toBe("/marketing?bagian=media-sosial");
    }
  });

  it("membawa periode yang sah dan membuang periode yang rusak atau terbalik", () => {
    expect(legacyMarketingHref({ bagian: "sosmed", lihat: "audit", startDate: "2026-11-01", endDate: "2026-11-24" })).toBe(
      "/marketing?bagian=media-sosial&startDate=2026-11-01&endDate=2026-11-24",
    );
    expect(legacyMarketingHref({ bagian: "sosmed", startDate: "2026-11-24", endDate: "2026-11-01" })).toBe("/marketing?bagian=media-sosial");
    expect(legacyMarketingHref({ bagian: "sosmed", startDate: "kemarin", endDate: "2026-11-01" })).toBe("/marketing?bagian=media-sosial");
    expect(legacyMarketingHref({ bagian: ["sosmed", "google"] })).toBe("/marketing?bagian=media-sosial");
  });

  it("tidak mengalihkan bagian yang masih ada atau nama bawaan objek", () => {
    for (const bagian of [undefined, "google", "meta", "insight-pasar", "media-sosial", "strategy", "constructor", "__proto__"]) {
      expect(legacyMarketingHref({ bagian }), String(bagian)).toBeNull();
    }
  });
});
