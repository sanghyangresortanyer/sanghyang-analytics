import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_JOB_SOURCES,
  getAllJobsStatusSummary,
  getJobStatusSummary,
  type ScrapeJob,
} from "@/lib/market/scrape-log";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";

export const dynamic = "force-dynamic";

export function createScrapingStatusGet(checkAccess?: MarketingApiAccessGuard) {
  return async function GET(request: NextRequest) {
    const refused = await requireMarketingApiAccess(checkAccess);
    if (refused) return refused;

    try {
      const { searchParams } = new URL(request.url);
      const jobParam = searchParams.get("job") as ScrapeJob | null;

      if (jobParam) {
        if (!(jobParam in DEFAULT_JOB_SOURCES)) {
          return NextResponse.json(
            {
              error: `Job '${jobParam}' tidak valid. Job yang didukung: ${Object.keys(
                DEFAULT_JOB_SOURCES,
              ).join(", ")}`,
            },
            { status: 400 },
          );
        }
        const summary = await getJobStatusSummary(jobParam);
        return NextResponse.json(summary, {
          headers: { "Cache-Control": "no-store, max-age=0" },
        });
      }

      const allSummary = await getAllJobsStatusSummary();
      return NextResponse.json(allSummary, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    } catch (error) {
      console.error("[api/admin/scraping/status] Galat mengambil status job:", error);
      return NextResponse.json(
        {
          error: "Gagal mengambil status perayapan aktual.",
          detail: (error as Error).message,
        },
        { status: 500 },
      );
    }
  };
}

export const GET = createScrapingStatusGet();
