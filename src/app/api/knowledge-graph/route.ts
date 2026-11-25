import { NextResponse } from "next/server";
import { buildKnowledgeGraph } from "@/lib/knowledge-graph/build";
import { APP_MODULES, type AppModuleKey } from "@/lib/knowledge-graph/types";
import { parseDayRange, presetRange, type RangePreset } from "@/lib/market/date-range";
import { lastRefreshAt } from "@/lib/market/refresh-heartbeat";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";

const MODULE_SET = new Set<string>(APP_MODULES);

/**
 * Graf pengetahuan bisnis terpadu lintas modul, dirakit dari DB setiap permintaan;
 * hanya untuk pengguna yang sudah login dengan akses properti Marketing.
 */
export function createKnowledgeGraphGet(checkAccess?: MarketingApiAccessGuard) {
  return async function GET(request: Request) {
    const refused = await requireMarketingApiAccess(checkAccess);
    if (refused) return refused;

    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const period = url.searchParams.get("period");
    const moduleParam = url.searchParams.get("module");

    if (moduleParam && moduleParam !== "all" && !MODULE_SET.has(moduleParam)) {
      return NextResponse.json({ error: "Modul tidak dikenal." }, { status: 400 });
    }

    let range = null;
    if (from !== null || to !== null) {
      const parsed = parseDayRange(from, to);
      if (parsed === "invalid") {
        return NextResponse.json({ error: "Rentang tanggal tidak valid." }, { status: 400 });
      }
      range = parsed;
    } else if (period === "30d" || period === "90d" || period === "year") {
      range = presetRange(period as RangePreset, new Date());
    }

    const [graph, dataUpdatedAt] = await Promise.all([buildKnowledgeGraph(range ?? undefined), lastRefreshAt()]);

    if (moduleParam && moduleParam !== "all") {
      const mod = moduleParam as AppModuleKey;
      const filteredNodes = graph.nodes.filter((n) => n.modules?.includes(mod));
      const nodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredLinks = graph.links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));
      return NextResponse.json(
        { ...graph, nodes: filteredNodes, links: filteredLinks, activeModule: mod, dataUpdatedAt },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({ ...graph, dataUpdatedAt }, { headers: { "Cache-Control": "no-store" } });
  };
}

export const GET = createKnowledgeGraphGet();
