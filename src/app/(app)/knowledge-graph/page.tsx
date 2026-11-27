import type { Metadata } from "next";
import { KnowledgeGraphView } from "@/components/knowledge-graph/knowledge-graph-view";
import { marketingAccess } from "@/lib/marketing/web";

export const metadata: Metadata = {
  title: "Knowledge Graph · Sanghyang Analytics",
  description:
    "Peta 3D hubungan data Sanghyang: outlet, kamar, kompetitor, harga, promo, ulasan tamu, berita kawasan, dan strategi, dengan tabel berisi data yang sama.",
};

/**
 * Restored from the old app (commit b5f68d8) inside the signed-in group: the proxy sends visitors without a session to
 * /login like every page here, and the graph API needs the same Marketing access as the Marketing page.
 */
export default async function KnowledgeGraphPage() {
  const refused = await marketingAccess();
  if (refused) return <p className="rounded-xl border border-cream-300 bg-white p-6 text-base text-navy-700">{await refused.text()}</p>;
  return <KnowledgeGraphView />;
}
