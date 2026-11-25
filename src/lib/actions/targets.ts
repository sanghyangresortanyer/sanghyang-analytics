"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/role";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { mergeTargets, parseRupiah } from "@/lib/dashboard/outlet-targets";
import { createClient } from "@/lib/supabase/server";

export type TargetActionState = { ok?: string; error?: string } | undefined;

/** Pengaturan → Target: saves the monthly target of every outlet in one go (admin only). */
export async function saveOutletTargets(_prev: TargetActionState, formData: FormData): Promise<TargetActionState> {
  const me = await currentUser();
  if (me?.role !== "admin" || !me.propertyId) return { error: "Hanya admin yang bisa mengubah target." };

  const known = new Set(mergeTargets([]).map((t) => t.outlet));
  const outlets = formData.getAll("outlet").map(String);
  const targets = formData.getAll("target").map(String);
  const versions = formData.getAll("version").map(String);
  if (outlets.length === 0 || outlets.length !== targets.length || outlets.length !== versions.length) return { error: "Isian tidak lengkap. Muat ulang halaman." };

  const rows: { outlet: string; target: number; version: number }[] = [];
  for (let i = 0; i < outlets.length; i++) {
    if (!known.has(outlets[i])) return { error: `Outlet tidak dikenal: ${outlets[i]}` };
    const target = parseRupiah(targets[i]);
    if (target === null) return { error: `Target ${outlets[i]} tidak terbaca. Tulis angka rupiah saja, misalnya 500.000.000.` };
    const version = Number(versions[i]);
    if (!Number.isInteger(version) || version < 0) return { error: "Isian tidak lengkap. Muat ulang halaman." };
    rows.push({ outlet: outlets[i], target, version });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_outlet_targets", { p_property: me.propertyId, p_rows: rows });
  if (error) {
    if (error.message.includes("OUTLET_TARGETS_CONFLICT")) return { error: "Target baru saja diubah di tempat lain. Muat ulang halaman, lalu simpan lagi." };
    return { error: `Gagal menyimpan: ${error.message}` };
  }
  invalidateTags(INVALIDATION_GROUPS.forTargetsMutation(me.propertyId));
  revalidatePath("/");
  revalidatePath("/pengaturan");
  revalidatePath("/marketing");
  return { ok: "Target tersimpan. Dasbor sudah memakai angka baru." };
}
