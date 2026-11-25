import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

const listUsersMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: listUsersMock,
      },
    },
  }),
}));

import { getLoginUsernames } from "./login-users";

describe("getLoginUsernames", () => {
  beforeEach(() => {
    listUsersMock.mockReset();
  });

  it("returns sorted active Sanghyang Analytics usernames and excludes non-app or banned accounts", async () => {
    const futureBan = new Date(Date.now() + 86_400_000).toISOString();
    const expiredBan = new Date(Date.now() - 86_400_000).toISOString();

    listUsersMock.mockResolvedValue({
      data: {
        users: [
          { id: "1", email: "trian@sanghyang-analytics.local", banned_until: null },
          { id: "2", email: "lie011009@gmail.com", banned_until: null },
          { id: "3", email: "demon@gmail.com", banned_until: expiredBan },
          { id: "4", email: "awi@sanghyang-analytics.local", banned_until: null },
          { id: "5", email: "legacy@vola.local", banned_until: null },
          { id: "6", email: "disabled@sanghyang-analytics.local", banned_until: futureBan },
          { id: "7", email: undefined, banned_until: null },
        ],
      },
      error: null,
    });

    await expect(getLoginUsernames()).resolves.toEqual(["awi", "demon", "trian"]);
    expect(listUsersMock).toHaveBeenCalledWith({ perPage: 1000 });
  });

  it("throws on admin API error so failures are never cached as an empty list", async () => {
    listUsersMock.mockResolvedValue({
      data: { users: [] },
      error: new Error("Invalid API key"),
    });

    await expect(getLoginUsernames()).rejects.toThrow("Invalid API key");
  });
});
