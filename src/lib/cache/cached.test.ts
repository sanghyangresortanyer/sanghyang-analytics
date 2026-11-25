import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  unstableCacheCalls: [] as Array<{ keyParts: string[]; options: { tags?: string[]; revalidate?: number | false } }>,
  revalidateTagCalls: [] as Array<{ tag: string; profile: unknown }>,
  simulateOutsideNextScope: false,
  throwInsideFn: null as Error | null,
  adminClientCalls: 0,
  sessionClientCalls: 0,
  store: new Map<string, unknown>(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => Promise<unknown>>(
    fn: T,
    keyParts: string[] = [],
    options: { tags?: string[]; revalidate?: number | false } = {},
  ) => {
    cacheMocks.unstableCacheCalls.push({ keyParts, options });
    return async (...args: Parameters<T>) => {
      if (cacheMocks.simulateOutsideNextScope) {
        throw new Error("Invariant: incrementalCache missing in unstable_cache");
      }
      const cacheKey = JSON.stringify([keyParts, args]);
      if (cacheMocks.store.has(cacheKey)) {
        return JSON.parse(JSON.stringify(cacheMocks.store.get(cacheKey)));
      }
      const result = await fn(...args);
      // Simulasikan serialisasi JSON Next.js Data Cache (Map akan rusak jika tidak dikonversi ke entries).
      const serialized = JSON.parse(JSON.stringify(result));
      cacheMocks.store.set(cacheKey, serialized);
      return serialized;
    };
  },
  revalidateTag: (tag: string, profile: unknown) => {
    if (cacheMocks.simulateOutsideNextScope) {
      throw new Error(`Invariant: static generation store missing in revalidateTag ${tag}`);
    }
    cacheMocks.revalidateTagCalls.push({ tag, profile });
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    cacheMocks.adminClientCalls += 1;
    return { kind: "admin" };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    cacheMocks.sessionClientCalls += 1;
    return { kind: "session" };
  },
}));

import {
  hasAdminSupabaseKey,
  invalidateTags,
  withCache,
  withCachedMap,
  withPropertySupabaseCache,
} from "./cached";
import { CACHE_TAGS, CACHE_TTL, INVALIDATION_GROUPS, PRIVATE_CACHE_CONTROL } from "./tags";

describe("modul cache native Next.js 16.4.6", () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevSecret = process.env.SUPABASE_SECRET_KEY;

  beforeEach(() => {
    cacheMocks.unstableCacheCalls = [];
    cacheMocks.revalidateTagCalls = [];
    cacheMocks.simulateOutsideNextScope = false;
    cacheMocks.throwInsideFn = null;
    cacheMocks.adminClientCalls = 0;
    cacheMocks.sessionClientCalls = 0;
    cacheMocks.store.clear();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    process.env.SUPABASE_SECRET_KEY = prevSecret;
  });

  it("menyimpan hasil ke unstable_cache dan membedakan keyParts serta tags", async () => {
    let calls = 0;
    const load = () =>
      withCache(
        async () => {
          calls += 1;
          return { total: 42, calls };
        },
        ["summary", "30d"],
        { tags: [CACHE_TAGS.marketSummary], revalidate: CACHE_TTL.marketIntelligence },
      );

    const first = await load();
    const second = await load();
    expect(first).toEqual({ total: 42, calls: 1 });
    expect(second).toEqual({ total: 42, calls: 1 });
    expect(calls).toBe(1);
    expect(cacheMocks.unstableCacheCalls[0]).toEqual({
      keyParts: ["summary", "30d"],
      options: { tags: [CACHE_TAGS.marketSummary], revalidate: CACHE_TTL.marketIntelligence },
    });
  });

  it("mempertahankan keutuhan Map lewat withCachedMap meskipun Data Cache menserialisasi JSON", async () => {
    let calls = 0;
    const load = () =>
      withCachedMap(
        async () => {
          calls += 1;
          return new Map([
            ["sanghyang", { count: 61 }],
            ["aston", { count: 101 }],
          ]);
        },
        ["room-map"],
        { tags: [CACHE_TAGS.marketRoomTypes], revalidate: 300 },
      );

    const m1 = await load();
    const m2 = await load();
    expect(m1).toBeInstanceOf(Map);
    expect(m2).toBeInstanceOf(Map);
    expect(m2.get("sanghyang")).toEqual({ count: 61 });
    expect(m2.get("aston")).toEqual({ count: 101 });
    expect(calls).toBe(1);
  });

  it("memanggil revalidateTag(tag, { expire: 0 }) unik untuk seluruh tag invalidasi", () => {
    invalidateTags([CACHE_TAGS.marketSummary, CACHE_TAGS.knowledgeGraph, CACHE_TAGS.marketSummary]);
    expect(cacheMocks.revalidateTagCalls).toEqual([
      { tag: CACHE_TAGS.marketSummary, profile: { expire: 0 } },
      { tag: CACHE_TAGS.knowledgeGraph, profile: { expire: 0 } },
    ]);
  });

  it("melempar ulang galat nyata (Zero Fallback) dan hanya melewati invariant di luar runtime Next.js", async () => {
    await expect(
      withCache(
        async () => {
          throw new Error("database connection refused");
        },
        ["err-key"],
        { tags: ["t"], revalidate: 60 },
      ),
    ).rejects.toThrow("database connection refused");

    cacheMocks.simulateOutsideNextScope = true;
    const out = await withCache(async () => "live-outside-next", ["outside"], { tags: ["t"], revalidate: 60 });
    expect(out).toBe("live-outside-next");
    expect(() => invalidateTags(["t"])).not.toThrow();
  });

  it("memakai createAdminClient di dalam unstable_cache (tanpa cookies) dan mengisolasi propertyId di keyParts", async () => {
    expect(hasAdminSupabaseKey()).toBe(true);
    const res = await withPropertySupabaseCache({
      propertyId: "prop-a",
      keyParts: ["sheets-hk"],
      tags: [CACHE_TAGS.sheets("prop-a")],
      revalidate: CACHE_TTL.sheets,
      query: async (supabase) => ({ client: (supabase as unknown as { kind: string }).kind }),
    });
    expect(res).toEqual({ client: "admin" });
    expect(cacheMocks.adminClientCalls).toBe(1);
    expect(cacheMocks.sessionClientCalls).toBe(0);
    expect(cacheMocks.unstableCacheCalls[0].keyParts).toEqual(["sheets-hk", "prop-a"]);
  });

  it("menjalankan kueri sesi di luar unstable_cache bila SUPABASE_SECRET_KEY belum tersedia", async () => {
    process.env.SUPABASE_SECRET_KEY = "";
    expect(hasAdminSupabaseKey()).toBe(false);
    const res = await withPropertySupabaseCache({
      propertyId: "prop-b",
      keyParts: ["sheets-hk"],
      tags: [CACHE_TAGS.sheets("prop-b")],
      revalidate: CACHE_TTL.sheets,
      query: async (supabase) => ({ client: (supabase as unknown as { kind: string }).kind }),
    });
    expect(res).toEqual({ client: "session" });
    expect(cacheMocks.sessionClientCalls).toBe(1);
    expect(cacheMocks.adminClientCalls).toBe(0);
    expect(cacheMocks.unstableCacheCalls).toHaveLength(0);
  });

  it("menolak propertyId kosong dengan galat eksplisit", async () => {
    await expect(
      withPropertySupabaseCache({
        propertyId: "   ",
        keyParts: ["bad"],
        tags: ["t"],
        revalidate: 60,
        query: async () => "never",
      }),
    ).rejects.toThrow(/propertyId wajib/);
  });

  it("menjamin seluruh header Cache-Control bersifat private dan bebas public/s-maxage serta seluruh tag <= 256 karakter", () => {
    for (const header of Object.values(PRIVATE_CACHE_CONTROL)) {
      expect(header).toMatch(/^private,/);
      expect(header).not.toMatch(/\bpublic\b|\bs-maxage\b/i);
    }
    const sampleProperty = "2e439433-e59f-4e56-93eb-32f6ee129bf1";
    const allTags = [
      ...INVALIDATION_GROUPS.forVhpMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forSheetsMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forTargetsMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forBudgetsMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forRoomsMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forMenuRulesMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forSocialPromoMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forWhatsappChatMutation(sampleProperty),
      ...INVALIDATION_GROUPS.forMarketingSosmedMutation(),
      ...INVALIDATION_GROUPS.forMarketRefreshMutation(),
      ...INVALIDATION_GROUPS.forGoalsMutation(),
      ...INVALIDATION_GROUPS.forMarketItemOrInsightMutation(),
    ];
    for (const tag of allTags) {
      expect(tag.length).toBeGreaterThan(0);
      expect(tag.length).toBeLessThanOrEqual(256);
    }
  });
});
