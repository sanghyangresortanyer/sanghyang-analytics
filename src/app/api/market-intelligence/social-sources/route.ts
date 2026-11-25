import { NextResponse } from "next/server";
import { PRIVATE_CACHE_CONTROL } from "@/lib/cache/tags";
import { requireMarketingApiAccess } from "@/lib/marketing/api-auth";
import { countSocialTargets, socialSourceStatuses } from "@/lib/market/social-sources";

export const dynamic = "force-dynamic";

/** Status jalur resmi media sosial per sumber untuk Langkah 1 Insight Pasar. Hanya nama kunci yang dikirim, bukan nilainya. */
export async function GET() {
  const refused = await requireMarketingApiAccess();
  if (refused) return refused;

  const sources = socialSourceStatuses(process.env, await countSocialTargets());
  return NextResponse.json(
    { sources, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL.medium } },
  );
}
