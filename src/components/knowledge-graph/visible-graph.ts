import { NODE_KINDS, type AppModuleKey, type GraphLink, type GraphNode, type NodeKind } from "@/lib/knowledge-graph/types";

export type GraphFilter = { kinds: ReadonlySet<NodeKind>; outlet: string; module: AppModuleKey | "all" };

const fold = (text: string) => text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Nodes and links left after the filters. Nodes without an outlet are shared (a platform, an area, a news item) and stay
 * in every outlet's view, but only while something shown still links to them, so a lone source does not float in space.
 */
export function visibleGraph(nodes: GraphNode[], links: GraphLink[], filter: GraphFilter): { nodes: GraphNode[]; links: GraphLink[] } {
  const kept = nodes.filter(
    (n) =>
      filter.kinds.has(n.kind) &&
      (filter.outlet === "all" || n.outlets.length === 0 || n.outlets.includes(filter.outlet)) &&
      (filter.module === "all" || Boolean(n.modules?.includes(filter.module))),
  );
  const ids = new Set(kept.map((n) => n.id));
  const shownLinks = links.filter((l) => ids.has(l.source) && ids.has(l.target));
  const linked = new Set(shownLinks.flatMap((l) => [l.source, l.target]));
  return { nodes: kept.filter((n) => n.outlets.length > 0 || linked.has(n.id)), links: shownLinks };
}

/** Ids of the nodes whose name contains the search text, ignoring case and accents; empty when nothing is typed. */
export function matchingIds(nodes: GraphNode[], query: string): Set<string> {
  const q = fold(query.trim());
  return new Set(q ? nodes.filter((n) => fold(n.label).includes(q)).map((n) => n.id) : []);
}

/** Table order: kinds as the API lists them, then the most comparable competitor first, then by name. */
export function tableOrder(nodes: GraphNode[]): GraphNode[] {
  return nodes
    .slice()
    .sort(
      (a, b) =>
        NODE_KINDS.indexOf(a.kind) - NODE_KINDS.indexOf(b.kind) ||
        (b.holisticScore ?? -1) - (a.holisticScore ?? -1) ||
        a.label.localeCompare(b.label, "id"),
    );
}
