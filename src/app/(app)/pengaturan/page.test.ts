import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/auth/role", () => ({
  currentUser: async () => ({ id: "admin-1", role: "admin", propertyId: "prop-1" }),
}));

const authUsers = vi.hoisted(() => ({
  users: [] as Array<{ id: string; email?: string; created_at: string; banned_until?: string | null }>,
  profiles: [] as Array<{ id: string; role: string }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: authUsers.users }, error: null }),
      },
    },
    from: () => ({
      select: async () => ({ data: authUsers.profiles, error: null }),
    }),
  }),
}));

vi.mock("@/lib/dashboard/outlet-targets-query", () => ({
  getOutletTargets: async () => [],
}));
vi.mock("@/lib/dashboard/settings-query", () => ({
  getDivisionBudgets: async () => null,
  getRoomSettings: async () => null,
  getMenuRules: async () => null,
}));
vi.mock("./data-sources", () => ({ DataSources: () => null }));

import PengaturanPage from "./page";
import { UserAdmin, type ManagedUser } from "./user-admin";

function findElementByType<P>(node: ReactNode, targetType: unknown): ReactElement<P> | null {
  if (!isValidElement(node)) return null;
  if (node.type === targetType) return node as ReactElement<P>;
  const children = (node.props as { children?: ReactNode }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const hit = findElementByType<P>(child, targetType);
      if (hit) return hit;
    }
  } else if (children) {
    return findElementByType<P>(children, targetType);
  }
  return null;
}

describe("PengaturanPage user filtering", () => {
  beforeEach(() => {
    authUsers.users = [
      { id: "u1", email: "awi@sanghyang-analytics.local", created_at: "2026-11-01T00:00:00Z", banned_until: null },
      { id: "u2", email: "demon@gmail.com", created_at: "2026-11-02T00:00:00Z", banned_until: null },
      { id: "u3", email: "other-app-user@gmail.com", created_at: "2026-11-03T00:00:00Z", banned_until: null },
      { id: "u4", email: "outsider@example.com", created_at: "2026-11-04T00:00:00Z", banned_until: null },
      { id: "u5", email: undefined, created_at: "2026-11-05T00:00:00Z", banned_until: null },
    ];
    authUsers.profiles = [
      { id: "u1", role: "staff" },
      { id: "u2", role: "admin" },
      { id: "u3", role: "staff" },
    ];
  });

  it("filters Supabase Auth users with isAppAccount so accounts from other apps never leak into UserAdmin", async () => {
    const tree = await PengaturanPage();
    const userAdminEl = findElementByType<{ users: ManagedUser[]; currentUserId: string }>(tree, UserAdmin);
    expect(userAdminEl).not.toBeNull();
    expect(userAdminEl!.props.users.map((u) => u.username)).toEqual(["awi", "demon"]);
    expect(userAdminEl!.props.users.map((u) => u.id)).toEqual(["u1", "u2"]);
  });
});
