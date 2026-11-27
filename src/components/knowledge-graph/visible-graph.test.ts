import { describe, expect, it } from "vitest";
import { NODE_KINDS, type GraphLink, type GraphNode, type NodeKind } from "@/lib/knowledge-graph/types";
import { matchingIds, tableOrder, visibleGraph } from "./visible-graph";

const node = (id: string, kind: NodeKind, outlets: string[], extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind,
  label: id,
  detail: [],
  sources: [],
  observedAt: null,
  outlets,
  weight: 1,
  ...extra,
});
const link = (source: string, target: string): GraphLink => ({ source, target, label: "terkait" });

// A small graph in the API's shape: two outlets, a competitor of each, a source platform linked to one, and a lone source.
const nodes = [
  node("outlet:resort", "outlet", ["resort"], { modules: ["dashboard"] }),
  node("outlet:sunset-grill", "outlet", ["sunset-grill"], { modules: ["dashboard"] }),
  node("pesaing:a", "pesaing", ["resort"], { modules: ["market-intelligence"], holisticScore: 80, label: "Ányer Hotel" }),
  node("pesaing:b", "pesaing", ["sunset-grill"], { modules: ["market-intelligence"], holisticScore: 60 }),
  node("sumber:google", "sumber", [], { modules: ["market-intelligence"] }),
  node("sumber:lepas", "sumber", []),
];
const links = [link("outlet:resort", "pesaing:a"), link("outlet:sunset-grill", "pesaing:b"), link("pesaing:a", "sumber:google")];
const allKinds = new Set<NodeKind>(NODE_KINDS);

const ids = (list: GraphNode[]) => list.map((n) => n.id).sort();

describe("visibleGraph", () => {
  it("drops nodes that belong to no outlet and link to nothing, like a source without any data", () => {
    const shown = visibleGraph(nodes, links, { kinds: allKinds, outlet: "all", module: "all" });
    expect(ids(shown.nodes)).toEqual(["outlet:resort", "outlet:sunset-grill", "pesaing:a", "pesaing:b", "sumber:google"]);
    expect(shown.links).toHaveLength(3);
  });

  it("keeps shared nodes when one outlet is in focus, and only links whose two ends are still shown", () => {
    const shown = visibleGraph(nodes, links, { kinds: allKinds, outlet: "resort", module: "all" });
    expect(ids(shown.nodes)).toEqual(["outlet:resort", "pesaing:a", "sumber:google"]);
    expect(shown.links.map((l) => `${l.source}>${l.target}`).sort()).toEqual(["outlet:resort>pesaing:a", "pesaing:a>sumber:google"]);
  });

  it("hides a kind switched off in the legend together with its links", () => {
    const kinds = new Set<NodeKind>(NODE_KINDS.filter((k) => k !== "pesaing"));
    const shown = visibleGraph(nodes, links, { kinds, outlet: "all", module: "all" });
    expect(ids(shown.nodes)).toEqual(["outlet:resort", "outlet:sunset-grill"]);
    expect(shown.links).toEqual([]);
  });

  it("keeps only nodes used by the chosen part of the app", () => {
    const shown = visibleGraph(nodes, links, { kinds: allKinds, outlet: "all", module: "market-intelligence" });
    expect(ids(shown.nodes)).toEqual(["pesaing:a", "pesaing:b", "sumber:google"]);
  });
});

describe("matchingIds", () => {
  it("finds names without caring about case or accents, and finds nothing for an empty search", () => {
    expect([...matchingIds(nodes, "anyer")]).toEqual(["pesaing:a"]);
    expect(matchingIds(nodes, "   ").size).toBe(0);
  });
});

describe("tableOrder", () => {
  it("lists kinds in the legend order, then the most comparable competitor first", () => {
    expect(tableOrder(nodes).map((n) => n.id)).toEqual([
      "outlet:resort",
      "outlet:sunset-grill",
      "pesaing:a",
      "pesaing:b",
      "sumber:google",
      "sumber:lepas",
    ]);
  });
});
