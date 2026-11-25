"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/role";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { todayISO } from "@/lib/format-date";
import { loadAllInstagramPosts } from "@/lib/marketing/meta-instagram";
import { newPromoEvents, type PromoEventKey, type VhpMenu } from "@/lib/marketing/promo-detect";
import { shiftDate } from "@/lib/marketing/social-promo";
import { marketingAccess } from "@/lib/marketing/web";
import { createClient } from "@/lib/supabase/server";

export type PromoActionState = { ok?: string; error?: string; links?: string[] } | undefined;

/** Posts this old are no longer worth auditing. */
const LOOK_BACK_DAYS = 60;
const PAGE = 1000;

/** "Tarik data": newest posts from Instagram → offers with a till menu become audits by themselves. */
export async function pullPromos(): Promise<PromoActionState> {
  if (await marketingAccess()) return { error: "Tidak ada akses ke Marketing." };
  const me = await currentUser();
  if (!me?.propertyId) return { error: "Silakan login." };
  const supabase = await createClient();
  const { posts, problem } = await loadAllInstagramPosts(process.env, { fresh: true, limit: 50 });
  if (posts.length === 0) return { error: problem ?? "Tidak ada postingan yang terbaca dari Instagram." };

  // Menu names sold in the last 12 months, per outlet.
  const names = new Map<string, VhpMenu>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc("menu_names", { p_property: me.propertyId, p_from: shiftDate(todayISO(), -365) }).range(from, from + PAGE - 1);
    if (error) return { error: "Nama menu kasir tidak bisa dibaca dari database." };
    const rows = (data ?? []) as { outlet_name: string; description: string }[];
    for (const r of rows) names.set(`${r.outlet_name}|${r.description}`, { outlet: r.outlet_name, description: r.description });
    if (rows.length < PAGE) break;
  }
  const { data: have, error: readError } = await supabase.from("social_promo_events").select("source_post_id, post_date, outlet_name, menu_keyword").eq("property_id", me.propertyId);
  if (readError) return { error: "Audit promo tidak bisa dibaca dari database." };

  const found = newPromoEvents(posts, [...names.values()], (have ?? []) as PromoEventKey[], shiftDate(todayISO(), -LOOK_BACK_DAYS));
  if (found.events.length > 0) {
    const { error } = await supabase.from("social_promo_events").insert(found.events.map((e) => ({ ...e, property_id: me.propertyId, created_by: me.id })));
    // Two people pressing at once: the unique index keeps one, nothing is doubled.
    if (error) return { error: error.code === "23505" ? "Data sedang ditarik orang lain. Muat ulang halaman." : `Gagal menyimpan: ${error.message}` };
  }
  invalidateTags(INVALIDATION_GROUPS.forSocialPromoMutation(me.propertyId));
  revalidatePath("/marketing");
  const parts = [`${posts.length} postingan dibaca`, `${found.promos} promo dalam ${LOOK_BACK_DAYS} hari terakhir`, `${found.events.length} menu baru masuk audit`];
  if (found.existing > 0) parts.push(`${found.existing} sudah ada`);
  if (found.unknown.length > 0) parts.push(`${found.unknown.length} promo menunya tidak dikenali di kasir`);
  return { ok: `${parts.join(" · ")}.${problem ? ` Catatan: ${problem}` : ""}`, links: found.unknown.map((p) => p.permalink) };
}

/** "Abaikan": leaves the audit out for good (a later pull does not bring it back). */
export async function ignorePromoEvent(id: string): Promise<PromoActionState> {
  if (await marketingAccess()) return { error: "Tidak ada akses ke Marketing." };
  const me = await currentUser();
  if (!me?.propertyId) return { error: "Silakan login." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("social_promo_events").update({ ignored: true }).eq("id", id).eq("property_id", me.propertyId).select("id");
  if (error || !data?.length) return { error: "Gagal mengabaikan. Muat ulang halaman lalu coba lagi." };
  invalidateTags(INVALIDATION_GROUPS.forSocialPromoMutation(me.propertyId));
  revalidatePath("/marketing");
  return { ok: "Diabaikan." };
}
