import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
  }),
}));
vi.mock("@/lib/auth/role", () => ({
  currentUser: async () => ({ id: "admin-1", role: "admin", propertyId: "prop-1", propertyName: "Sanghyang", username: "admin" }),
}));
vi.mock("@/lib/actions/auth", () => ({ signOut: async () => {} }));

import AppLayout from "./layout";
import { IconRail } from "@/components/app-chrome";

function findElementByType<P>(node: ReactNode, targetType: unknown): ReactElement<P> | null {
  if (!isValidElement(node)) return null;
  if (node.type === targetType) return node as ReactElement<P>;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const hit = findElementByType<P>(child, targetType);
    if (hit) return hit;
  }
  return null;
}

async function railProps() {
  const tree = await AppLayout({ children: null });
  const rail = findElementByType<{ isAdmin: boolean; showKnowledgeGraph: boolean }>(tree, IconRail);
  expect(rail).not.toBeNull();
  return rail!.props;
}

describe("AppLayout reads the Knowledge Graph switch on the server", () => {
  beforeEach(() => {
    jar.values.clear();
  });

  it("passes the switch to the rail when this browser turned it on, so the first paint already has the item", async () => {
    jar.values.set("sa-nav-knowledge-graph", "1");
    expect(await railProps()).toMatchObject({ isAdmin: true, showKnowledgeGraph: true });
  });

  it("keeps the item hidden for a browser without the cookie or with the switch off", async () => {
    expect((await railProps()).showKnowledgeGraph).toBe(false);
    jar.values.set("sa-nav-knowledge-graph", "0");
    expect((await railProps()).showKnowledgeGraph).toBe(false);
  });
});
