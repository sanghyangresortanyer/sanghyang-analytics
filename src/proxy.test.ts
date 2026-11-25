import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const claimsState = vi.hoisted(() => ({
  claims: null as { sub: string } | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: claimsState.claims ? { claims: claimsState.claims } : null,
      }),
    },
  }),
}));

import { proxy } from "./proxy";

describe("proxy auth guard", () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
    claimsState.claims = null;
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevKey;
  });

  it("returns 401 JSON for private /api/* routes when session is missing or expired", async () => {
    const privateApis = [
      "http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all",
      "http://localhost:3001/api/marketing-sosmed",
      "http://localhost:3001/api/admin/scraping",
      "http://localhost:3001/api/export-meeting?id=123",
    ];

    for (const url of privateApis) {
      const res = await proxy(new NextRequest(url));
      expect(res.status, url).toBe(401);
      expect(res.headers.get("location"), url).toBeNull();
      expect(await res.json(), url).toEqual({
        ok: false,
        error: "Sesi login telah berakhir. Silakan login ulang.",
      });
    }
  });

  it("allows public API routes without a user session", async () => {
    const publicApis = [
      "http://localhost:3001/api/health",
      "http://localhost:3001/api/health/ready",
      "http://localhost:3001/api/cron/sync-sheets",
    ];

    for (const url of publicApis) {
      const res = await proxy(new NextRequest(url));
      expect(res.status, url).toBe(200);
      expect(res.headers.get("location"), url).toBeNull();
    }
  });

  it("redirects unauthenticated non-API pages (including removed /auth path) to /login without leaking query parameters", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3001/marketing?bagian=insight-pasar&outlet=resort&startDate=2026-11-01"),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const target = new URL(location!);
    expect(target.pathname).toBe("/login");
    expect(target.search).toBe("");

    const authRes = await proxy(new NextRequest("http://localhost:3001/auth/callback"));
    expect(authRes.status).toBe(307);
    expect(new URL(authRes.headers.get("location")!).pathname).toBe("/login");
  });

  it("passes through private /api/* routes when user session is valid", async () => {
    claimsState.claims = { sub: "user-analytics-1" };
    const res = await proxy(new NextRequest("http://localhost:3001/api/market-intelligence/summary?period=30d"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("fails closed with 503 JSON for private /api/* routes when Supabase auth env is unconfigured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const res = await proxy(new NextRequest("http://localhost:3001/api/market-intelligence/summary?period=30d"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Konfigurasi autentikasi belum lengkap.",
    });
  });
});
