import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/auth/cron-secret";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { syncAllSheets } from "@/lib/sheets/sync";

// Membaca workbook DML memakan ~10 dtk secara lokal; beri ruang untuk unduhan lambat.
export const maxDuration = 300;

/**
 * Vercel Cron (vercel.json, "0 18 * * 0" UTC = Senin 01:00 WIB) memanggil endpoint ini
 * dengan `Authorization: Bearer $CRON_SECRET` (diverifikasi dengan timingSafeEqual).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const propertyId = process.env.SHEETS_PROPERTY_ID?.trim();
  if (!secret || !propertyId) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET dan SHEETS_PROPERTY_ID wajib diisi." }, { status: 500 });
  }
  if (!isAuthorizedCronRequest(request, secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const results = await syncAllSheets(propertyId);
  invalidateTags(INVALIDATION_GROUPS.forSheetsMutation(propertyId));
  revalidatePath("/");
  revalidatePath("/data-sheets");
  revalidatePath("/pengaturan");
  const failed = results.some((r) => r.status === "error");
  return NextResponse.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
}
