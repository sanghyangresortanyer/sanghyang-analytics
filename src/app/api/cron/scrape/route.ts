import { isAuthorizedCronRequest } from "@/lib/auth/cron-secret";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { runNewsNow, NewsRunInProgressError } from "@/lib/market/run-news";

type RunNews = () => Promise<{ runId: string; status: string }>;

export function createCronScrapeHandler(run: RunNews = runNewsNow, secret = process.env.CRON_SECRET) {
  return async function GET(request: Request) {
    if (!isAuthorizedCronRequest(request, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });
    try {
      const result = await run();
      invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
      return Response.json({ ok: true, ...result }, { status: 200 });
    } catch (error) {
      if (error instanceof NewsRunInProgressError) return Response.json({ ok: false, status: "running" }, { status: 409 });
      return Response.json({ ok: false, status: "failed" }, { status: 500 });
    }
  };
}

export const GET = createCronScrapeHandler();
