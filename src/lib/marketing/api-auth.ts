import "server-only";
import { NextResponse } from "next/server";
import { marketingAccess } from "@/lib/marketing/web";

export type MarketingApiAccessGuard = () => Promise<Response | null>;

const SESSION_EXPIRED_ERROR = "Sesi login telah berakhir. Silakan login ulang.";

/**
 * Penjaga autentikasi dan otorisasi properti tunggal untuk seluruh API Marketing & Market Intelligence.
 * Membungkus `marketingAccess()` (sesi Supabase Auth ES256 + kecocokan `MARKETING_PROPERTY_ID`)
 * agar selalu membalas JSON 401/403 yang terstruktur.
 */
export async function requireMarketingApiAccess(
  guard: MarketingApiAccessGuard = marketingAccess,
): Promise<Response | null> {
  let refused: Response | null;
  try {
    refused = await guard();
  } catch (err) {
    // Di luar lingkup request Next.js (misalnya pemanggilan langsung tanpa sesi pada pengujian), gagal tertutup 401.
    const message = err instanceof Error ? err.message : "";
    if (/outside a request scope|cookies/i.test(message)) {
      return NextResponse.json({ ok: false, error: SESSION_EXPIRED_ERROR }, { status: 401 });
    }
    throw err;
  }
  if (!refused) return null;

  const status = refused.status === 403 ? 403 : 401;
  if (status === 401) {
    return NextResponse.json({ ok: false, error: SESSION_EXPIRED_ERROR }, { status: 401 });
  }
  const detail = (await refused.text().catch(() => "")).trim();
  return NextResponse.json(
    { ok: false, error: detail || "Tidak ada akses ke Marketing properti ini." },
    { status: 403 },
  );
}
