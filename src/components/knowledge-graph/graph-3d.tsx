"use client";

import { useEffect, useRef, useState } from "react";
import type { ForceGraph3DInstance } from "3d-force-graph";
import { APP_MODULE_META, NODE_KIND_LABEL, type GraphLink, type GraphNode, type NodeKind } from "@/lib/knowledge-graph/types";
import { GRAPH_TOKENS, KIND_TOKEN } from "./kind-colors";

type SimNode = GraphNode & { x?: number; y?: number; z?: number };
type SimLink = Omit<GraphLink, "source" | "target"> & { source: string | SimNode; target: string | SimNode };
type MapColors = { kind: Record<NodeKind, string>; background: string; dimNode: string; link: string; linkActive: string };

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const endId = (end: string | SimNode) => (typeof end === "string" ? end : end.id);

function hasWebGl(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}

/**
 * WebGL and the graph library only read sRGB colours, while Tailwind writes theme tokens in oklch: the browser paints
 * one pixel with each token and the pixel is read back. A token that is not defined stops the map with its name.
 */
function readMapColors(el: Element): MapColors {
  const css = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("kanvas 2D tidak tersedia");
  const rgb = (token: string) => {
    const value = css.getPropertyValue(token).trim();
    if (!value) throw new Error(`warna ${token} tidak terbaca`);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  const kind = Object.fromEntries(Object.entries(KIND_TOKEN).map(([k, token]) => [k, rgb(token)])) as Record<NodeKind, string>;
  return {
    kind,
    background: rgb(GRAPH_TOKENS.background),
    dimNode: rgb(GRAPH_TOKENS.dimNode),
    link: rgb(GRAPH_TOKENS.link),
    linkActive: rgb(GRAPH_TOKENS.linkActive),
  };
}

/** Hands the filtered data to the map; nodes keep their position across filters, so the camera does not jump. */
function pushData(graph: ForceGraph3DInstance, data: { nodes: GraphNode[]; links: GraphLink[] }, keep: Map<string, SimNode>) {
  const nextNodes = data.nodes.map((n) => {
    const existing = keep.get(n.id);
    const node: SimNode = existing ? Object.assign(existing, n) : { ...n };
    keep.set(n.id, node);
    return node;
  });
  // The library replaces link ends with node objects, so it gets copies.
  graph.graphData({ nodes: nextNodes, links: data.links.map((l) => ({ ...l })) });
}

function nodeTooltip(node: SimNode): string {
  const score = typeof node.holisticScore === "number" ? `<div>Skor kemiripan: ${node.holisticScore}/100</div>` : "";
  const modules = node.modules?.length
    ? `<div class="opacity-80">Bagian aplikasi: ${escapeHtml(node.modules.map((m) => APP_MODULE_META[m]?.shortLabel ?? m).join(", "))}</div>`
    : "";
  return `<div class="font-semibold">${escapeHtml(node.label)}</div><div>${escapeHtml(NODE_KIND_LABEL[node.kind])}</div>${score}${modules}`;
}

function linkTooltip(link: SimLink): string {
  const weight = typeof link.weight === "number" ? ` · bobot ${link.weight}/100` : "";
  const factors = link.factors?.length
    ? `<div class="opacity-80">${escapeHtml(link.factors.slice(0, 3).map((f) => `${f.label}: ${f.score}`).join(" · "))}</div>`
    : "";
  return `<div><span class="font-semibold">${escapeHtml(link.label)}</span>${escapeHtml(weight)}</div>${factors}`;
}

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId: string | null;
  highlightIds: Set<string>;
  onSelect: (id: string) => void;
}

const NOTICE = "flex h-full min-h-64 items-center justify-center rounded-[22px] bg-cream-100 p-6 text-center text-base text-navy-700";

/**
 * The 3D map on the dark ink surface. Line width follows the link weight. With reduced motion the layout is computed
 * before the first frame, and the map neither spins nor flies the camera.
 */
export function Graph3D({ nodes, links, selectedId, highlightIds, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const simNodes = useRef(new Map<string, SimNode>());
  const dataRef = useRef({ nodes, links });
  const stateRef = useRef({ selectedId, highlightIds, neighbors: new Set<string>() });
  const onSelectRef = useRef(onSelect);
  const fitPending = useRef(true);
  const [unsupported] = useState(() => !hasWebGl());
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || unsupported) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("3d-force-graph")
      .then(({ default: ForceGraph3D }) => {
        if (disposed) return;
        const colors = readMapColors(el);
        const touchesSelected = (link: SimLink) => {
          const id = stateRef.current.selectedId;
          return Boolean(id) && (endId(link.source) === id || endId(link.target) === id);
        };
        const isActive = (id: string) => {
          const s = stateRef.current;
          if (s.selectedId) return id === s.selectedId || s.neighbors.has(id);
          return s.highlightIds.size === 0 || s.highlightIds.has(id);
        };
        const graph = ForceGraph3D({ controlType: "orbit" })(el)
          .backgroundColor(colors.background)
          .showNavInfo(false)
          .nodeRelSize(4)
          .nodeOpacity(0.9)
          .nodeVal((n) => (n as SimNode).weight)
          .nodeColor((n) => (isActive((n as SimNode).id) ? colors.kind[(n as SimNode).kind] : colors.dimNode))
          .nodeLabel((n) => nodeTooltip(n as SimNode))
          .linkLabel((l) => linkTooltip(l as SimLink))
          .linkColor((l) => (touchesSelected(l as SimLink) ? colors.linkActive : colors.link))
          .linkOpacity(0.55)
          .linkWidth((l) => {
            const link = l as SimLink;
            const base = typeof link.weight === "number" ? 0.25 + (link.weight / 100) * 0.95 : 0.35;
            return touchesSelected(link) ? Math.max(1.4, base + 0.6) : base;
          })
          .warmupTicks(reducedMotion ? 120 : 0)
          .cooldownTicks(reducedMotion ? 0 : 120)
          .enableNodeDrag(false)
          .onEngineStop(() => {
            if (!fitPending.current) return;
            fitPending.current = false;
            graph.zoomToFit(reducedMotion ? 0 : 600, 40);
          })
          .onNodeClick((n) => {
            const node = n as SimNode;
            onSelectRef.current(node.id);
            if (node.x === undefined || node.y === undefined || node.z === undefined) return;
            const ratio = 1 + 140 / Math.max(1, Math.hypot(node.x, node.y, node.z));
            graph.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, { x: node.x, y: node.y, z: node.z }, reducedMotion ? 0 : 900);
          });
        if (!reducedMotion) {
          const controls = graph.controls() as { autoRotate?: boolean; autoRotateSpeed?: number; addEventListener?: (type: string, fn: () => void) => void };
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.45;
          controls.addEventListener?.("start", () => {
            controls.autoRotate = false;
          });
        }
        graph.width(el.clientWidth).height(el.clientHeight);
        observer = new ResizeObserver(() => graph.width(el.clientWidth).height(el.clientHeight));
        observer.observe(el);
        graphRef.current = graph;
        pushData(graph, dataRef.current, simNodes.current);
      })
      .catch((err: unknown) => {
        if (!disposed) setFailure(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      graphRef.current?._destructor();
      graphRef.current = null;
    };
  }, [unsupported]);

  useEffect(() => {
    dataRef.current = { nodes, links };
    fitPending.current = true;
    if (graphRef.current) pushData(graphRef.current, dataRef.current, simNodes.current);
  }, [nodes, links]);

  useEffect(() => {
    const neighbors = new Set<string>();
    if (selectedId) {
      for (const l of links) {
        if (l.source === selectedId) neighbors.add(l.target);
        if (l.target === selectedId) neighbors.add(l.source);
      }
    }
    stateRef.current = { selectedId, highlightIds, neighbors };
    const graph = graphRef.current;
    if (graph) graph.nodeColor(graph.nodeColor()).linkColor(graph.linkColor()).linkWidth(graph.linkWidth());
  }, [selectedId, highlightIds, links]);

  if (unsupported) {
    return <div className={NOTICE}>Peramban ini tidak bisa menampilkan peta 3D (WebGL tidak tersedia). Semua data tetap bisa dibuka lewat tabel di bawah.</div>;
  }
  if (failure) {
    return <div className={NOTICE}>Peta 3D tidak bisa digambar ({failure}). Semua data tetap bisa dibuka lewat tabel di bawah.</div>;
  }
  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Peta 3D berisi ${nodes.length} titik data dan ${links.length} hubungan. Untuk memilih dengan papan ketik, pakai tabel di bawah.`}
      className="h-full w-full overflow-hidden rounded-[22px] bg-(--color-era-ink) [&_.float-tooltip-kap]:max-w-xs [&_.float-tooltip-kap]:rounded-xl [&_.float-tooltip-kap]:bg-navy-800 [&_.float-tooltip-kap]:px-3 [&_.float-tooltip-kap]:py-2 [&_.float-tooltip-kap]:font-sans [&_.float-tooltip-kap]:text-sm [&_.float-tooltip-kap]:leading-snug [&_.float-tooltip-kap]:text-white [&_.float-tooltip-kap]:shadow-md"
    />
  );
}
