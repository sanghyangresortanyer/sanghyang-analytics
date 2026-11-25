"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/role";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { syncAllSheets, type SourceSyncResult } from "@/lib/sheets/sync";

/** "Tarik Data Sekarang": the same pull the cron job runs, for the signed-in user's property. */
export async function syncSheetsNow(): Promise<{ ok: true; results: SourceSyncResult[] } | { ok: false; error: string }> {
  const me = await currentUser();
  if (!me?.propertyId) return { ok: false, error: "Sesi atau properti belum tersedia." };
  // The sheet ids in env belong to one property; never pull them into another.
  const target = process.env.SHEETS_PROPERTY_ID?.trim();
  if (!target) return { ok: false, error: "SHEETS_PROPERTY_ID belum diisi di pengaturan server." };
  if (me.propertyId !== target) return { ok: false, error: "Google Sheets ini bukan milik properti Anda." };
  const results = await syncAllSheets(target);
  invalidateTags(INVALIDATION_GROUPS.forSheetsMutation(target));
  revalidatePath("/data-sheets");
  revalidatePath("/");
  revalidatePath("/pengaturan");
  return { ok: true, results };
}
