import { describe, expect, it } from "vitest";
import { generateInsights } from "./insights";

describe("generateInsights", () => {
  it("judul dan ringkasan temuan yang ditulis model tampil tanpa em dash", async () => {
    const answer = JSON.stringify([
      {
        type: "opportunity",
        title: "Judul uji — temuan pasar",
        summary: "Ringkasan uji temuan pasar — ditulis dengan em dash.",
        evidence: ["Bukti uji"],
        sourceReferences: ["Sumber uji"],
        priority: 70,
        confidence: 60,
        status: "active",
      },
    ]);
    const [first] = await generateInsights({ rows: [], counts: {} }, async () => answer);
    expect(first?.title).toBe("Judul uji, temuan pasar");
    expect(first?.summary).toBe("Ringkasan uji temuan pasar, ditulis dengan em dash.");
  });
});
