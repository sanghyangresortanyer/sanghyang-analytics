import { NextRequest, NextResponse } from "next/server";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { ProductionWriteBlockedError } from "@/lib/db";
import {
  BrowserSyncConflictError,
  BrowserSyncValidationError,
  buildSocialSyncTargets,
  persistBrowserSyncBatch,
  sanitizeBrowserSyncPayload,
} from "@/lib/market/browser-social-sync";
import { getJobStatusSummary } from "@/lib/market/scrape-log";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";

export const dynamic = "force-dynamic";

/**
 * Verifikasi origin dinamis (Zero Hardcode): hanya menerima permintaan same-origin
 * terhadap host aplikasi yang sedang melayani permintaan.
 */
function isSameOriginAllowed(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === request.nextUrl.origin;
  }
  return true;
}

export function createBrowserSyncHandlers(checkAccess?: MarketingApiAccessGuard) {
  return {
    async GET() {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      try {
        const [targetInfo, socialJob] = await Promise.all([buildSocialSyncTargets(), getJobStatusSummary("social")]);
        return NextResponse.json({
          targets: targetInfo.targets,
          allowedHandles: targetInfo.allowedHandles,
          knownPostUrls: targetInfo.knownPostUrls,
          extensionId: targetInfo.extensionId,
          extensionVersion: targetInfo.extensionVersion,
          socialJob,
        });
      } catch (err) {
        console.error("[api/marketing-sosmed/browser-sync] Galat GET:", err);
        return NextResponse.json({ error: "Gagal menyusun daftar akun media sosial." }, { status: 500 });
      }
    },

    async POST(request: NextRequest) {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      if (!isSameOriginAllowed(request)) {
        return NextResponse.json({ error: "Origin permintaan ditolak." }, { status: 403 });
      }

      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return NextResponse.json({ error: "Payload JSON tidak valid." }, { status: 400 });
      }

      try {
        const { allowedHandles } = await buildSocialSyncTargets();
        const validated = sanitizeBrowserSyncPayload(rawBody, allowedHandles);
        const saved = await persistBrowserSyncBatch(validated);
        invalidateTags(INVALIDATION_GROUPS.forMarketingSosmedMutation());
        return NextResponse.json({
          success: true,
          ...saved,
        });
      } catch (err) {
        if (err instanceof BrowserSyncValidationError) {
          return NextResponse.json({ error: err.message }, { status: 422 });
        }
        if (err instanceof BrowserSyncConflictError) {
          return NextResponse.json({ error: err.message }, { status: 409 });
        }
        if (err instanceof ProductionWriteBlockedError) {
          return NextResponse.json({ error: err.message }, { status: 403 });
        }
        console.error("[api/marketing-sosmed/browser-sync] Galat POST:", err);
        return NextResponse.json({ error: "Gagal menyimpan hasil sinkronisasi media sosial." }, { status: 500 });
      }
    },
  };
}

const handlers = createBrowserSyncHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
