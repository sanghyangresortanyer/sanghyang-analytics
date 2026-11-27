import { describe, expect, it } from "vitest";
import { generateSocialContentDrafts, type ContentDraftInput } from "./ai-content-generator";

const INPUT: ContentDraftInput = {
  competitorName: "Aston Anyer Beach Hotel",
  promoTitle: "Year-End Staycation 25% OFF",
  promoCategory: "Potongan harga",
  counterStrategy: "Balas dengan paket nilai tambah Hot Spring Aquamedic tanpa memotong harga",
  outletName: "Kamar & Resort",
  previousHeadlines: ["Satu-satunya Natural Hot Spring di Anyer", "POV: Liburan Anti-Mainstream di Anyer"],
};

const reply = (headline: string) =>
  JSON.stringify({
    reels: { format: "reels", headline, hook3Sec: "Hook — baru", visualDirection: "Dermaga sore", caption: "Sunset di dermaga — lalu berendam air panas", audioRecommendation: "Akustik", callToAction: "Pesan lewat WhatsApp", hashtags: ["#Anyer"] },
    tiktok: { format: "tiktok", headline: `${headline} (TikTok)`, hookPOV: "POV", sceneSteps: [], caption: "Santai — tanpa ribet", soundTrend: "Tren", callToAction: "Cek tautan", hashtags: ["#Anyer"] },
    carousel: { format: "carousel", headline: `${headline} (Carousel)`, slides: [], caption: "Geser — lihat", promoOffer: "Paket menginap", hashtags: ["#Anyer"] },
  });

describe("generateSocialContentDrafts", () => {
  it("meminta versi baru yang berbeda dari draf sebelumnya dan membersihkan em dash dari draf", async () => {
    let prompt = "";
    const bundle = await generateSocialContentDrafts(INPUT, {
      generate: async (p) => {
        prompt = p;
        return reply("Sore Hangat di Dermaga Sanghyang");
      },
    });
    expect(prompt).toContain("Satu-satunya Natural Hot Spring di Anyer");
    expect(prompt).toMatch(/harus berbeda dari draf sebelumnya/);
    expect(bundle.reels.headline).toBe("Sore Hangat di Dermaga Sanghyang");
    expect(bundle.reels.caption).toBe("Sunset di dermaga, lalu berendam air panas");
    expect(JSON.stringify(bundle)).not.toContain("—");
  });

  it("galat AI dilaporkan apa adanya, tidak diganti template yang sama setiap klik", async () => {
    await expect(
      generateSocialContentDrafts(INPUT, { generate: () => Promise.reject(new Error("429 RESOURCE_EXHAUSTED per day")) }),
    ).rejects.toThrow(/per day/);
    await expect(generateSocialContentDrafts(INPUT, { generate: async () => "bukan JSON" })).rejects.toThrow(/tidak terbaca sebagai draf konten/);
  });
});
