import { describe, expect, it, vi } from "vitest";
import { aiConfig, buildInteraction, generateWithRetry, jedaDari, readInteraction } from "./gemini";

const ENV = { GEMINI_API_KEY: "kunci-uji", PRIMARY_MODEL: "gemini-4-hydrogen", PRIMARY_THINKING_LEVEL: "xhigh" };
const CONFIG = { apiKey: "kunci-uji", model: "gemini-4-hydrogen", thinkingLevel: "xhigh" as const };

describe("aiConfig", () => {
  it("mengambil model dan thinking level dari env", () => {
    expect(aiConfig(ENV)).toEqual(CONFIG);
    expect(aiConfig({ ...ENV, PRIMARY_THINKING_LEVEL: " XHIGH " }).thinkingLevel).toBe("xhigh");
  });

  it("tanpa PRIMARY_MODEL gagal, tidak memakai model cadangan maupun GEMINI_MODEL lama", () => {
    expect(() => aiConfig({ ...ENV, PRIMARY_MODEL: "" })).toThrow(/PRIMARY_MODEL/);
    expect(() => aiConfig({ GEMINI_API_KEY: "kunci-uji", GEMINI_MODEL: "gemini-3.5-flash-lite", PRIMARY_THINKING_LEVEL: "xhigh" })).toThrow(
      /PRIMARY_MODEL/,
    );
  });

  it("thinking level wajib xhigh", () => {
    expect(() => aiConfig({ ...ENV, PRIMARY_THINKING_LEVEL: "high" })).toThrow(/xhigh/);
    expect(() => aiConfig({ ...ENV, PRIMARY_THINKING_LEVEL: "" })).toThrow(/xhigh/);
  });

  it("tanpa GEMINI_API_KEY gagal", () => {
    expect(() => aiConfig({ ...ENV, GEMINI_API_KEY: "" })).toThrow(/GEMINI_API_KEY/);
  });
});

describe("buildInteraction", () => {
  it("teks biasa: model dari konfigurasi, store false, xhigh, token keluaran minimal 16.384, tanpa temperature", () => {
    const { request, options } = buildInteraction({ contents: "halo" }, CONFIG);
    expect(request).toEqual({
      model: "gemini-4-hydrogen",
      input: "halo",
      store: false,
      generation_config: { max_output_tokens: 16_384, thinking_level: "xhigh" },
    });
    expect(JSON.stringify(request)).not.toContain("temperature");
    expect(options).toEqual({ retries: { strategy: "none" } });
  });

  it("teks dan gambar inlineData menjadi masukan bertipe, JSON lewat response_format", () => {
    const signal = new AbortController().signal;
    const { request, options } = buildInteraction(
      {
        contents: [{ role: "user", parts: [{ text: "baca foto" }, { inlineData: { data: "QUJD", mimeType: "image/webp" } }] }],
        config: { responseMimeType: "application/json", maxOutputTokens: 32_768, abortSignal: signal },
      },
      CONFIG,
    );
    expect(request.input).toEqual([
      { type: "text", text: "baca foto" },
      { type: "image", data: "QUJD", mime_type: "image/webp" },
    ]);
    // Interactions API menolak response_mime_type tanpa response_format (invalid_request, uji nyata 26 Nov 2026).
    expect(request.response_format).toEqual({ type: "text", mime_type: "application/json" });
    expect(request).not.toHaveProperty("response_mime_type");
    expect(request.generation_config).toEqual({ max_output_tokens: 32_768, thinking_level: "xhigh" });
    expect(options.fetch_options?.signal).toBe(signal);
  });
});

describe("readInteraction", () => {
  it("memakai output_text bila ada, lalu memetakan status ke finishReason", () => {
    const done = readInteraction({ status: "completed", output_text: "Serang", usage: { total_tokens: 209 } });
    expect(done.text).toBe("Serang");
    expect(done.candidates[0]?.finishReason).toBe("STOP");
    expect(readInteraction({ status: "incomplete", output_text: "{\"items\":[" }).candidates[0]?.finishReason).toBe("MAX_TOKENS");
  });

  it("tanpa output_text menggabungkan teks langkah model_output dan melewati langkah thought", () => {
    const raw = {
      status: "completed",
      steps: [
        { type: "thought", content: [{ type: "text", text: "bukan jawaban" }] },
        { type: "model_output", content: [{ type: "text", text: "Ser" }, { type: "text", text: "ang" }] },
      ],
    };
    expect(readInteraction(raw).text).toBe("Serang");
  });
});

describe("jedaDari", () => {
  it("mengikuti retryDelay dari Google, termasuk bentuk 'retry in', dengan batas 65 detik", () => {
    expect(jedaDari('{"retryDelay": "8s"}', 0, () => 0)).toBe(8_500);
    expect(jedaDari("Please retry in 39.5s.", 0, () => 0)).toBe(40_000);
    expect(jedaDari('{"retryDelay": "300s"}', 0, () => 0)).toBe(65_000);
  });
});

describe("generateWithRetry", () => {
  const penuh = (status: number, message: string) => Object.assign(new Error(message), { status });

  it("batas per menit: menunggu lalu mencoba lagi dengan model yang sama", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(penuh(429, '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"2s"}]}}'))
      .mockResolvedValueOnce({ status: "completed", output_text: "ok" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await generateWithRetry({ contents: "halo" }, { create, sleep, env: ENV });
    expect(res.text).toBe("ok");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([request]) => request.model)).toEqual(["gemini-4-hydrogen", "gemini-4-hydrogen"]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(2_500);
  });

  it("server sibuk (503) juga ditunggu lalu dicoba lagi", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(penuh(503, "This model is currently experiencing high demand."))
      .mockResolvedValueOnce({ status: "completed", output_text: "ok" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(generateWithRetry({ contents: "halo" }, { create, sleep, env: ENV })).resolves.toMatchObject({ text: "ok" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("kuota harian habis: langsung dilempar tanpa menunggu dan tanpa ganti model", async () => {
    const create = vi.fn().mockRejectedValue(penuh(429, "Quota exceeded for metric GenerateRequestsPerDay"));
    const sleep = vi.fn();
    await expect(generateWithRetry({ contents: "halo" }, { create, sleep, env: ENV })).rejects.toThrow(/PerDay/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("galat permintaan (400) tidak dicoba ulang", async () => {
    const create = vi.fn().mockRejectedValue(penuh(400, "Invalid argument"));
    const sleep = vi.fn();
    await expect(generateWithRetry({ contents: "halo" }, { create, sleep, env: ENV })).rejects.toThrow(/Invalid/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("setelah percobaan habis tetap model yang sama sampai akhir, lalu galatnya dilempar", async () => {
    const create = vi.fn().mockRejectedValue(penuh(429, '{"retryDelay":"1s"}'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(generateWithRetry({ contents: "halo" }, { create, sleep, env: ENV, tries: 3 })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(3);
    expect(new Set(create.mock.calls.map(([request]) => request.model))).toEqual(new Set(["gemini-4-hydrogen"]));
  });
});
