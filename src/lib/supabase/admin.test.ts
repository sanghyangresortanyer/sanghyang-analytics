import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // admin.ts is server-only; the guard has no meaning under vitest

// The Vercel outage: SUPABASE_STORAGE_BUCKET existed but was blank, so `??`
// kept "" and storage answered NoSuchBucket.
describe("SOURCE_BUCKET", () => {
  const resolve = async (value: string | undefined) => {
    vi.resetModules(); // SOURCE_BUCKET is read once at module scope
    if (value === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
    else process.env.SUPABASE_STORAGE_BUCKET = value;
    return (await import("./admin")).SOURCE_BUCKET;
  };

  it("falls back when unset, blank, or whitespace", async () => {
    expect(await resolve(undefined)).toBe("source-files");
    expect(await resolve("")).toBe("source-files");
    expect(await resolve("   ")).toBe("source-files");
  });

  it("uses an override and trims it", async () => {
    expect(await resolve(" other-bucket ")).toBe("other-bucket");
  });
});

describe("createAdminClient", () => {
  const callWithEnv = async (url: string | undefined, secret: string | undefined) => {
    vi.resetModules();
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (secret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = secret;
    const { createAdminClient } = await import("./admin");
    return createAdminClient();
  };

  it("throws when SUPABASE_SECRET_KEY is missing, empty, or whitespace", async () => {
    await expect(callWithEnv("https://example.supabase.co", undefined)).rejects.toThrow(/SUPABASE_SECRET_KEY/);
    await expect(callWithEnv("https://example.supabase.co", "")).rejects.toThrow(/SUPABASE_SECRET_KEY/);
    await expect(callWithEnv("https://example.supabase.co", "   ")).rejects.toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("creates a client when URL and secret key are provided with surrounding whitespace", async () => {
    const client = await callWithEnv(" https://example.supabase.co ", " sb_secret_test_value ");
    expect(client).toBeDefined();
    expect(client.auth.admin).toBeDefined();
  });
});
