import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin" as string | null,
  sets: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      state.sets.push({ name, value, options });
    },
  }),
}));
vi.mock("@/lib/auth/role", () => ({
  currentUser: async () => (state.role ? { id: "u-1", role: state.role, propertyId: "prop-1", propertyName: null, username: "awi" } : null),
}));

import { saveKnowledgeGraphNav } from "./knowledge-graph-nav-action";

describe("saveKnowledgeGraphNav", () => {
  beforeEach(() => {
    state.role = "admin";
    state.sets = [];
  });

  it("stores 'on' in a long-lived, server-only cookie for the whole app", async () => {
    const result = await saveKnowledgeGraphNav(true);
    expect(result.error).toBeUndefined();
    expect(result.ok).toBeTruthy();
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0]).toMatchObject({
      name: "sa-nav-knowledge-graph",
      value: "1",
      options: { path: "/", httpOnly: true, sameSite: "lax", maxAge: 400 * 24 * 60 * 60 },
    });
  });

  it("stores 'off' as 0 so the rail drops the item", async () => {
    await saveKnowledgeGraphNav(false);
    expect(state.sets.map((s) => s.value)).toEqual(["0"]);
  });

  it("refuses staff and signed-out requests, the same as every other Pengaturan action", async () => {
    state.role = "staff";
    expect((await saveKnowledgeGraphNav(true)).error).toBeTruthy();
    state.role = null;
    expect((await saveKnowledgeGraphNav(true)).error).toBeTruthy();
    expect(state.sets).toEqual([]);
  });

  it("refuses anything but true or false, since a Server Action can be posted directly", async () => {
    expect((await saveKnowledgeGraphNav("1" as unknown as boolean)).error).toBeTruthy();
    expect(state.sets).toEqual([]);
  });
});
