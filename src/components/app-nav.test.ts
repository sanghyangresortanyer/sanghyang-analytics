import { describe, expect, it } from "vitest";
import { KNOWLEDGE_GRAPH_NAV_COOKIE, knowledgeGraphNavShown, visibleNavItems } from "./app-nav";

const hrefs = (opts: { isAdmin: boolean; showKnowledgeGraph: boolean }) => visibleNavItems(opts).map((i) => i.href);

describe("Knowledge Graph menu switch (cookie per browser)", () => {
  it("names the cookie the layout and Pengaturan both read", () => {
    expect(KNOWLEDGE_GRAPH_NAV_COOKIE).toBe("sa-nav-knowledge-graph");
  });

  it("turns the menu on only for the exact value the switch writes", () => {
    expect(knowledgeGraphNavShown("1")).toBe(true);
    for (const value of [undefined, "", "0", "true", "on", " 1", "1 "]) {
      expect(knowledgeGraphNavShown(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("visibleNavItems", () => {
  it("puts Knowledge Graph directly under Pengaturan for an admin who switched it on", () => {
    expect(hrefs({ isAdmin: true, showKnowledgeGraph: true })).toEqual([
      "/",
      "/upload-mingguan",
      "/data-sheets",
      "/laporan-resort",
      "/marketing",
      "/pengaturan",
      "/knowledge-graph",
    ]);
  });

  it("hides Knowledge Graph when the switch is off, leaving the rail as before", () => {
    expect(hrefs({ isAdmin: true, showKnowledgeGraph: false })).toEqual([
      "/",
      "/upload-mingguan",
      "/data-sheets",
      "/laporan-resort",
      "/marketing",
      "/pengaturan",
    ]);
  });

  it("still hides Pengaturan from staff, so Knowledge Graph closes the list when the browser has it on", () => {
    expect(hrefs({ isAdmin: false, showKnowledgeGraph: true })).toEqual([
      "/",
      "/upload-mingguan",
      "/data-sheets",
      "/laporan-resort",
      "/marketing",
      "/knowledge-graph",
    ]);
    expect(hrefs({ isAdmin: false, showKnowledgeGraph: false })).not.toContain("/knowledge-graph");
  });

  it("labels the new item the way the tooltip and screen readers show it", () => {
    const item = visibleNavItems({ isAdmin: true, showKnowledgeGraph: true }).at(-1);
    expect(item?.label).toBe("Knowledge Graph");
    expect(item?.icon).toBeDefined();
  });
});
