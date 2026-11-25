import { NextResponse } from "next/server";
import { FNB_OUTLET_KEYS, isFnbOutlet } from "@/lib/market/fnb-compare";
import { loadFnbCompareData } from "@/lib/market/fnb-compare-data";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";

/**
 * Pembanding harga menu satu outlet F&B, bar, atau spa: item menu pesaing, hotel induk, dan foto galeri.
 * Hanya untuk pengguna yang sudah login dan berwenang mengakses properti Marketing.
 */
export function createFnbCompareGet(checkAccess?: MarketingApiAccessGuard) {
  return async function GET(request: Request) {
    const refused = await requireMarketingApiAccess(checkAccess);
    if (refused) return refused;

    const outlet = new URL(request.url).searchParams.get("outlet");
    if (!isFnbOutlet(outlet)) {
      return NextResponse.json(
        { error: `Outlet tidak dikenal: ${outlet ?? "(kosong)"}. Pakai salah satu: ${FNB_OUTLET_KEYS.join(", ")}.` },
        { status: 422 },
      );
    }
    return NextResponse.json(await loadFnbCompareData(outlet), { headers: { "Cache-Control": "no-store" } });
  };
}

export const GET = createFnbCompareGet();
