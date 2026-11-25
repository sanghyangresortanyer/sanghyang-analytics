import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  pushed: [] as string[],
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
    useTransition: () => [false, (fn: () => void) => fn()] as const,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      hookState.pushed.push(href);
    },
  }),
}));
vi.mock("@/lib/config", () => ({ isSupabaseConfigured: () => true }));

const dashboardQueryState = vi.hoisted(() => ({
  mode: "day" as "day" | "range" | "month",
  startDate: "2026-11-01",
  endDate: "2026-11-25",
}));

vi.mock("@/lib/dashboard/dashboard-data", () => ({
  getUnifiedDashboardData: async () => ({
    query: {
      allMeetings: [{ id: "m1" }],
      data: null,
      matchedCount: 0,
      mode: dashboardQueryState.mode,
      selectedMeetingId: "m1",
      startDate: dashboardQueryState.startDate,
      endDate: dashboardQueryState.endDate,
      month: "2026-11",
    },
    sourceErrors: [],
  }),
}));

import DashboardPage from "./page";
import { DashboardFilterBar } from "@/components/dashboard-filter-bar";
import { dashboardFilterKey, normalizeDashboardRange } from "@/lib/dashboard/filter-range";

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

describe("DashboardPage and DashboardFilterBar date synchronization", () => {
  beforeEach(() => {
    hookState.slots = [];
    hookState.cursor = 0;
    hookState.pushed = [];
  });

  it("assigns a distinct key on DashboardFilterBar when active mode or date range changes (Reset)", async () => {
    dashboardQueryState.mode = "range";
    dashboardQueryState.startDate = "2026-11-10";
    dashboardQueryState.endDate = "2026-11-15";
    const rangeTree = await DashboardPage({
      searchParams: Promise.resolve({ mode: "range", startDate: "2026-11-10", endDate: "2026-11-15" }),
    });
    const [rangeFilter] = findElements(rangeTree, (el) => el.type === DashboardFilterBar);

    dashboardQueryState.mode = "day";
    dashboardQueryState.startDate = "2026-11-01";
    dashboardQueryState.endDate = "2026-11-25";
    const resetTree = await DashboardPage({ searchParams: Promise.resolve({}) });
    const [resetFilter] = findElements(resetTree, (el) => el.type === DashboardFilterBar);

    expect(rangeFilter).toBeDefined();
    expect(resetFilter).toBeDefined();
    expect(rangeFilter.key).toBe(dashboardFilterKey("range", "2026-11-10", "2026-11-15"));
    expect(resetFilter.key).toBe(dashboardFilterKey("day", "2026-11-01", "2026-11-25"));
    expect(rangeFilter.key).not.toBe(resetFilter.key);
    expect(normalizeDashboardRange("2026-11-20", "2026-11-10")).toEqual({
      startDate: "2026-11-10",
      endDate: "2026-11-20",
    });
  });

  it("syncs date inputs when props change on Reset and normalizes reversed date ranges on submit", () => {
    const renderBar = (props: { activeMode: "day" | "range" | "month"; activeStartDate: string; activeEndDate: string }) => {
      hookState.cursor = 0;
      return DashboardFilterBar(props);
    };

    // Start in custom range
    let tree = renderBar({ activeMode: "range", activeStartDate: "2026-11-10", activeEndDate: "2026-11-15" });
    let [startInput, endInput] = findElements(tree, (el) => el.type === "input");
    expect(startInput.props.value).toBe("2026-11-10");
    expect(endInput.props.value).toBe("2026-11-15");

    // Simulate Reset updating active props without remounting
    tree = renderBar({ activeMode: "day", activeStartDate: "2026-11-01", activeEndDate: "2026-11-25" });
    [startInput, endInput] = findElements(tree, (el) => el.type === "input");
    expect(startInput.props.value).toBe("2026-11-01");
    expect(endInput.props.value).toBe("2026-11-25");

    // Enter reversed range and submit
    (startInput.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "2026-11-20" } });
    tree = renderBar({ activeMode: "day", activeStartDate: "2026-11-01", activeEndDate: "2026-11-25" });
    [startInput, endInput] = findElements(tree, (el) => el.type === "input");
    (endInput.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "2026-11-10" } });
    tree = renderBar({ activeMode: "day", activeStartDate: "2026-11-01", activeEndDate: "2026-11-25" });

    const [form] = findElements(tree, (el) => el.type === "form");
    (form.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault: () => undefined });
    expect(hookState.pushed.at(-1)).toBe("/?mode=range&startDate=2026-11-10&endDate=2026-11-20");

    tree = renderBar({ activeMode: "day", activeStartDate: "2026-11-01", activeEndDate: "2026-11-25" });
    [startInput, endInput] = findElements(tree, (el) => el.type === "input");
    expect(startInput.props.value).toBe("2026-11-10");
    expect(endInput.props.value).toBe("2026-11-20");
  });
});
