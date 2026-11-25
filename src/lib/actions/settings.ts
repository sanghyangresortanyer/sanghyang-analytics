"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth/role";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { DIVISIONS } from "@/lib/dashboard/division-budgets";
import { parseRupiah } from "@/lib/dashboard/outlet-targets";
import { ROOM_TYPES } from "@/lib/dashboard/room-types";
import { MENU_RULE_LIMITS } from "@/lib/dashboard/menu-activity";
import { createClient } from "@/lib/supabase/server";

export type SettingsActionState = { ok?: string; error?: string } | undefined;

const CONFLICT = "Data ini baru saja diubah di tempat lain. Muat ulang halaman, lalu simpan lagi.";
const versionOf = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** Pengaturan → Jenis kamar: saves the type of every room in one go (admin only). */
export async function saveRoomTypes(_prev: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const me = await currentUser();
  if (me?.role !== "admin" || !me.propertyId) return { error: "Hanya admin yang bisa mengubah jenis kamar." };
  const rooms = formData.getAll("room").map(String);
  const types = formData.getAll("type").map(String);
  const versions = formData.getAll("version").map(String);
  if (rooms.length === 0 || rooms.length !== types.length || rooms.length !== versions.length) return { error: "Isian tidak lengkap. Muat ulang halaman." };
  const codes = new Set<string>(ROOM_TYPES.map((t) => t.code));
  const rows: { room: string; type: string | null; version: number }[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const version = versionOf(versions[i]);
    if (!/^[0-9A-Za-z-]{1,8}$/.test(rooms[i]) || version === null) return { error: "Isian tidak lengkap. Muat ulang halaman." };
    if (types[i] && !codes.has(types[i])) return { error: `Jenis kamar ${rooms[i]} tidak dikenal.` };
    rows.push({ room: rooms[i], type: types[i] || null, version });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_room_types", { p_property: me.propertyId, p_rows: rows });
  if (error) return { error: error.message.includes("SETTINGS_CONFLICT") ? CONFLICT : `Gagal menyimpan: ${error.message}` };
  invalidateTags(INVALIDATION_GROUPS.forRoomsMutation(me.propertyId));
  revalidatePath("/");
  revalidatePath("/pengaturan");
  revalidatePath("/marketing");
  return { ok: "Jenis kamar tersimpan." };
}

/** Pengaturan → Budget belanja: saves the monthly budget of every division (admin only). */
export async function saveDivisionBudgets(_prev: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const me = await currentUser();
  if (me?.role !== "admin" || !me.propertyId) return { error: "Hanya admin yang bisa mengubah budget." };
  const divisions = formData.getAll("division").map(String);
  const budgets = formData.getAll("budget").map(String);
  const versions = formData.getAll("version").map(String);
  if (divisions.length === 0 || divisions.length !== budgets.length || divisions.length !== versions.length) return { error: "Isian tidak lengkap. Muat ulang halaman." };
  const rows: { division: string; budget: number; version: number }[] = [];
  for (let i = 0; i < divisions.length; i++) {
    if (!DIVISIONS.includes(divisions[i])) return { error: `Divisi tidak dikenal: ${divisions[i]}` };
    const budget = parseRupiah(budgets[i]);
    if (budget === null) return { error: `Budget ${divisions[i]} tidak terbaca. Tulis angka rupiah saja, misalnya 150.000.000.` };
    const version = versionOf(versions[i]);
    if (version === null) return { error: "Isian tidak lengkap. Muat ulang halaman." };
    rows.push({ division: divisions[i], budget, version });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_division_budgets", { p_property: me.propertyId, p_rows: rows });
  if (error) return { error: error.message.includes("SETTINGS_CONFLICT") ? CONFLICT : `Gagal menyimpan: ${error.message}` };
  invalidateTags(INVALIDATION_GROUPS.forBudgetsMutation(me.propertyId));
  revalidatePath("/");
  revalidatePath("/pengaturan");
  return { ok: "Budget tersimpan. Dasbor sudah memakai angka baru." };
}

/** Pengaturan → Aturan menu tidak laku: days for a dead menu, and the month and portions for a rarely sold one. */
export async function saveMenuRules(_prev: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const me = await currentUser();
  if (me?.role !== "admin" || !me.propertyId) return { error: "Hanya admin yang bisa mengubah aturan menu." };
  const whole = (v: FormDataEntryValue | null) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
  const L = MENU_RULE_LIMITS;
  const fields = [
    { key: "dead_menu_days", limit: L.deadDays, label: "Jangka hari menu paling tidak laku" },
    { key: "slow_menu_days", limit: L.slowDays, label: "Hari menu baru" },
    { key: "slow_menu_below", limit: L.slowBelow, label: "Batas porsi menu jarang laku" },
  ] as const;
  const rows: { key: string; value: number; version: number }[] = [];
  for (const f of fields) {
    const value = whole(formData.get(f.key));
    if (value === null || value < f.limit.min || value > f.limit.max) return { error: `${f.label} harus angka ${f.limit.min}–${f.limit.max}.` };
    const version = versionOf(String(formData.get(`${f.key}_version`) ?? ""));
    if (version === null) return { error: "Isian tidak lengkap. Muat ulang halaman." };
    rows.push({ key: f.key, value, version });
  }
  if (rows[1].value >= rows[0].value) return { error: "Hari menu baru harus lebih pendek dari jangka menu paling tidak laku." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_property_settings", { p_property: me.propertyId, p_rows: rows });
  if (error) return { error: error.message.includes("SETTINGS_CONFLICT") ? CONFLICT : `Gagal menyimpan: ${error.message}` };
  invalidateTags(INVALIDATION_GROUPS.forMenuRulesMutation(me.propertyId));
  revalidatePath("/");
  revalidatePath("/pengaturan");
  return { ok: "Aturan menu tersimpan. Dasbor sudah memakai batas baru." };
}
