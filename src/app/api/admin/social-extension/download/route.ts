import { NextResponse } from "next/server";
import { buildExtensionZipArchive } from "@/lib/market/extension-zip";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";

export const dynamic = "force-dynamic";

export function createExtensionDownloadGet(checkAccess?: MarketingApiAccessGuard) {
  return async function GET() {
    const refused = await requireMarketingApiAccess(checkAccess);
    if (refused) return refused;

    try {
      const archive = buildExtensionZipArchive();
      return new NextResponse(new Uint8Array(archive.buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${archive.filename}"`,
          "Content-Length": String(archive.buffer.length),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "X-Extension-Version": archive.version,
          "X-Extension-Id": archive.extensionId,
          "X-Content-Sha256": archive.sha256,
        },
      });
    } catch (err) {
      console.error("[api/admin/social-extension/download] Gagal merakit arsip ekstensi:", err);
      return NextResponse.json({ error: "Paket ekstensi tidak tersedia di server." }, { status: 500 });
    }
  };
}

export const GET = createExtensionDownloadGet();
