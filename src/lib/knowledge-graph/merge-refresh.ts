import type { GraphNode, KnowledgeGraph } from "./types";

/** Isi graf untuk dibandingkan. Simpul hitungan (misalnya ukuran pasar) memakai waktu rakit sebagai observedAt; waktu itu berganti tiap muat walau datanya sama, jadi diabaikan. */
function contentOf(graph: KnowledgeGraph): string {
  const nodes = graph.nodes.map((n): GraphNode => (n.observedAt === graph.generatedAt ? { ...n, observedAt: null } : n));
  return JSON.stringify([nodes, graph.links]);
}

/**
 * Graf hasil muat ulang. Bila simpul dan relasinya sama dengan yang tampil, larik lama dipakai lagi supaya peta 3D
 * tidak memaskan ulang kamera dan filter tidak dihitung ulang; waktu muat dan waktu datanya tetap diperbarui.
 */
export function mergeRefreshedGraph<T extends KnowledgeGraph>(previous: T | null, next: T): T {
  if (!previous || contentOf(previous) !== contentOf(next)) return next;
  return { ...next, nodes: previous.nodes, links: previous.links };
}
