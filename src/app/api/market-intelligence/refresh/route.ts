import { NextResponse } from "next/server";
import { createAdminScrapingHandlers } from "@/app/api/admin/scraping/route";
import { currentRefresh } from "@/lib/market/refresh-progress";
import { lastRefreshAt } from "@/lib/market/refresh-heartbeat";
import { OUTLET_KEYS } from "@/lib/market/outlet-filters";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";

export const dynamic = "force-dynamic";

export function createRefreshHandlers({
  checkAccess,
}: {
  checkAccess?: MarketingApiAccessGuard;
} = {}) {
  const scrapingHandlers = createAdminScrapingHandlers({ checkAccess });

  return {
    /** Status pembaruan menyeluruh lintas seluruh 6 outlet Sanghyang. */
    async GET() {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      const manualRunAvailable = !process.env.VERCEL;
      const lastSyncAt = await lastRefreshAt().catch(() => null);
      return NextResponse.json({
        scope: "all-outlets",
        outlets: [...OUTLET_KEYS],
        manualRunAvailable,
        refresh: currentRefresh(),
        lastSyncAt,
      });
    },

    /** Memicu 'Perbarui Semua Data' lintas seluruh 6 outlet Sanghyang (tidak pernah dibatasi ke tab outlet aktif saja). */
    async POST(request: Request) {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      const manualRunAvailable = !process.env.VERCEL;
      const job = manualRunAvailable ? "local-all" : "remote";
      const forwarded = new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const res = await scrapingHandlers.POST(forwarded);
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return NextResponse.json(
        {
          ...json,
          scope: "all-outlets",
          outlets: [...OUTLET_KEYS],
        },
        { status: res.status },
      );
    },
  };
}

const handlers = createRefreshHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
