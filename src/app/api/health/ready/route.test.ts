import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  supabaseResult: { error: null as null | { code?: string; message: string } },
  prismaOk: true,
}));

vi.mock("@/lib/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ limit: async () => state.supabaseResult }) }) }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: async () => {
      if (!state.prismaOk) throw new Error("connection refused at 10.0.0.5");
      return [{ "?column?": 1 }];
    },
  },
}));

import { GET } from "./route";

describe("GET /api/health/ready", () => {
  const prevGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    state.supabaseResult = { error: null };
    state.prismaOk = true;
    process.env.GEMINI_API_KEY = "configured-key-for-test";
  });

  afterEach(() => {
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
  });

  it("is ready when Supabase and Prisma both answer, exposing gemini.configured without AI model names", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "ready",
      supabase: "connected",
      database: "connected",
      gemini: { configured: true },
    });
    expect(JSON.stringify(body)).not.toMatch(/\b(gemini-[\w.-]+|flash[- ]?lite|claude|openai|chatgpt|gpt-\d|llm)\b/i);
  });

  it("is ready when Supabase answers 'permission denied' (42501) to an unauthenticated visitor", async () => {
    state.supabaseResult = { error: { code: "42501", message: "permission denied for table properties" } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready", supabase: "connected", database: "connected" });
  });

  it("is degraded on Supabase error without leaking internal hosts", async () => {
    state.supabaseResult = { error: { code: "PGRST000", message: "connection refused at 10.0.0.5" } };
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"status":"degraded"');
    expect(text).not.toContain("10.0.0.5");
  });

  it("is degraded when Prisma SELECT 1 fails without leaking internal hosts", async () => {
    state.prismaOk = false;
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: "degraded", supabase: "connected", database: "disconnected" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });
});
