import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMetaConfig, loadAllInstagramPosts, loadInstagramAccounts, loadInstagramMedia } from "./meta-instagram";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const fail = (status: number, message = "x") => ({ ok: false, status, json: async () => ({ error: { message, code: status === 401 ? 190 : 1 } }) });
const ENV = { META_ACCESS_TOKEN: "valid_token" };

describe("meta-instagram loader", () => {
  it("extracts config cleanly from env", () => {
    const config = getMetaConfig({ META_ACCESS_TOKEN: '"EAAQtesttoken123"', META_BUSINESS_ID: "1157089496793977", META_APP_ID: "1149800084571159" });
    expect(config.token).toBe("EAAQtesttoken123");
    expect(config.businessId).toBe("1157089496793977");
    expect(config.appId).toBe("1149800084571159");
  });

  it("without a token returns nothing and says the key is not installed", async () => {
    expect(await loadInstagramAccounts({})).toEqual([]);
    expect(await loadInstagramMedia("123", "testoutlet", 10, {})).toEqual([]);
    const all = await loadAllInstagramPosts({});
    expect(all.accounts).toEqual([]);
    expect(all.posts).toEqual([]);
    expect(all.problem).toMatch(/belum dipasang/);
    expect(all.unreadable).toEqual([]);
  });

  it("sends the key in the Authorization header, never in the address (23 Nov security review)", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(ok({ data: [] }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    await loadInstagramAccounts(ENV);
    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("valid_token");
    expect(url).not.toContain("access_token");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer valid_token");
  });

  it("lists the connected accounts", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      ok({
        data: [
          { id: "1", username: "sanghyangresort", name: "Sanghyang Resort" },
          { id: "2", username: "sunsetgrillsanghyang", name: "Sunset Grill" },
        ],
      }),
    ) as unknown as typeof fetch;
    const accounts = await loadInstagramAccounts(ENV);
    expect(accounts.map((a) => a.username)).toEqual(["sanghyangresort", "sunsetgrillsanghyang"]);
  });

  it("attaches the outlet username to media items", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      ok({ data: [{ id: "m1", caption: "Promo weekend seafood", media_type: "IMAGE", permalink: "https://instagr.am/p/1", timestamp: "2026-11-20T10:00:00Z", like_count: 15, comments_count: 2 }] }),
    ) as unknown as typeof fetch;
    const media = await loadInstagramMedia("2", "sunsetgrillsanghyang", 5, ENV);
    expect(media).toHaveLength(1);
    expect(media[0].outlet_username).toBe("sunsetgrillsanghyang");
    expect(media[0].like_count).toBe(15);
  });

  it("explains a refused or expired key instead of showing an empty feed", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(fail(401, "Error validating access token: Session has expired")) as unknown as typeof fetch;
    const all = await loadAllInstagramPosts(ENV);
    expect(all.posts).toEqual([]);
    expect(all.problem).toMatch(/kedaluwarsa|dicabut|ditolak/);
    expect(all.problem).not.toContain("valid_token");
  });

  it("keeps the accounts that work and names the one that cannot be read", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/instagram_accounts")) return ok({ data: [{ id: "1", username: "a" }, { id: "2", username: "b" }] });
      if (url.includes("/1/media")) return ok({ data: [{ id: "m1", media_type: "IMAGE", permalink: "p", timestamp: "2026-11-20T10:00:00Z" }] });
      return fail(400, "no permission");
    }) as unknown as typeof fetch;
    const all = await loadAllInstagramPosts(ENV);
    expect(all.posts.map((p) => p.outlet_username)).toEqual(["a"]);
    expect(all.problem).toContain("@b");
    // Media Sosial menandai akun ini "tersambung tetapi tidak bisa dibaca", bukan "belum tersambung".
    expect(all.unreadable).toEqual(["b"]);
  });
});

describe("the app only reads from Meta (owner, 24 Nov: the key may do more, the app may not)", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
  const users = files(join(process.cwd(), "src")).filter((f) => /graph\.facebook\.com|META_ACCESS_TOKEN/.test(readFileSync(f, "utf8")));

  it("only talks to Meta from audited read-only adapter files", () => {
    expect(users.map((f) => f.split("\\").join("/").split("/src/")[1]).sort()).toEqual([
      "lib/market/adapters/instagram-graph.ts",
      "lib/marketing/meta-instagram.ts",
    ]);
  });

  it("never sends a write request from any Meta client file", () => {
    for (const file of users) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/method\s*:/);
      expect(code, file).not.toMatch(/ body\s*:/);
      expect(code, file).not.toMatch(/["'`](POST|DELETE|PUT|PATCH)["'`]/);
    }
  });

  it("calls fetch with GET only", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(ok({ data: [{ id: "1", username: "a" }] }));
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    await loadAllInstagramPosts(ENV);
    expect(fakeFetch.mock.calls.length).toBe(2);
    for (const [, init] of fakeFetch.mock.calls as [string, RequestInit][]) expect(init.method ?? "GET").toBe("GET");
  });
});
