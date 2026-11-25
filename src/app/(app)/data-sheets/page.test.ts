import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const idx = hookState.cursor++;
      if (!(idx in hookState.slots)) {
        hookState.slots[idx] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prev = hookState.slots[idx] as T;
        hookState.slots[idx] = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      };
      return [hookState.slots[idx] as T, setState] as const;
    },
  };
});
vi.mock("@/lib/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/auth/role", () => ({
  currentUser: async () => ({ id: "u1", role: "staff", propertyId: "prop-1" }),
}));
vi.mock("@/lib/sheets/queries", () => ({
  getSyncStates: async () => [],
  getDmlSheets: async () => [],
  getHkItems: async () => [],
  getHkMovements: async () => [],
  getDmlLines: async () => [],
}));
vi.mock("./sync-button", () => ({ SyncButton: () => null }));
vi.mock("./hk-section", () => ({ HkSection: () => null }));
vi.mock("./dml-section", () => ({ DmlSection: () => null }));

import DataSheetsPage from "./page";
import { SheetsDashboardTabs } from "./sheets-dashboard-tabs";

function findElements(
  node: ReactNode,
  predicate: (el: ReactElement<Record<string, unknown>>) => boolean,
  out: Array<ReactElement<Record<string, unknown>>> = [],
): Array<ReactElement<Record<string, unknown>>> {
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, unknown>>;
  if (predicate(el)) out.push(el);
  const children = el.props.children as ReactNode;
  if (Array.isArray(children)) {
    for (const child of children) findElements(child, predicate, out);
  } else if (children) {
    findElements(children, predicate, out);
  }
  return out;
}

describe("DataSheetsPage and SheetsDashboardTabs query tab sync", () => {
  beforeEach(() => {
    hookState.slots = [];
    hookState.cursor = 0;
  });

  it("keys SheetsDashboardTabs by active ?tab= query so URL changes synchronize the tab", async () => {
    const hkTree = await DataSheetsPage({ searchParams: Promise.resolve({ tab: "hk" }) });
    const dmlTree = await DataSheetsPage({ searchParams: Promise.resolve({ tab: "dml" }) });
    const [hkTabs] = findElements(hkTree, (el) => el.type === SheetsDashboardTabs);
    const [dmlTabs] = findElements(dmlTree, (el) => el.type === SheetsDashboardTabs);

    expect(hkTabs).toBeDefined();
    expect(dmlTabs).toBeDefined();
    expect(hkTabs.key).toBe("hk");
    expect(dmlTabs.key).toBe("dml");
  });

  it("updates active tab when initialTab prop changes without remounting", () => {
    const renderTabs = (initialTab: "hk" | "dml") => {
      hookState.cursor = 0;
      return SheetsDashboardTabs({
        initialTab,
        states: [],
        dmlSheets: [],
        selectedDmlSheet: undefined,
        dmlLines: [],
        hkItems: [],
        hkUsageGroups: [],
        hkMonths: [],
      });
    };

    let tree = renderTabs("hk");
    let buttons = findElements(tree, (el) => el.type === "button");
    expect(buttons[0].props["aria-pressed"]).toBe(true);
    expect(buttons[1].props["aria-pressed"]).toBe(false);

    tree = renderTabs("dml");
    buttons = findElements(tree, (el) => el.type === "button");
    expect(buttons[0].props["aria-pressed"]).toBe(false);
    expect(buttons[1].props["aria-pressed"]).toBe(true);
  });
});
