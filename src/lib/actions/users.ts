"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/auth/role";
import { usernameToEmail } from "@/lib/auth/username";
import { LOGIN_USERS_TAG } from "@/lib/auth/login-users";

export type UserActionState = { error?: string; ok?: string } | undefined;

/** GoTrue has no permanent ban, so "disabled" is a ban far past any useful date. */
const BAN_FOREVER = "876000h";
const MIN_PASSWORD = 6;

/**
 * Every action re-checks the role. Gating only the page would leave the actions
 * callable directly by any signed-in user, which is the whole attack.
 */
async function adminOnly() {
  const me = await currentUser();
  if (me?.role !== "admin") return { me: null, denied: { error: "Hanya admin yang boleh mengelola user." } };
  return { me, denied: null };
}

function readPassword(formData: FormData): string | null {
  const password = String(formData.get("password") ?? "");
  return password.length >= MIN_PASSWORD ? password : null;
}

export async function createUser(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const { denied } = await adminOnly();
  if (denied) return denied;

  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  if (!username) return { error: "Username wajib diisi." };
  // The username becomes the local part of an email address, so anything that
  // would produce an invalid one has to be rejected here rather than by GoTrue.
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(username)) {
    return { error: "Username hanya boleh huruf, angka, titik, garis bawah, dan strip." };
  }
  const password = readPassword(formData);
  if (!password) return { error: `Password minimal ${MIN_PASSWORD} karakter.` };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true, // no mailbox exists behind sanghyang-analytics.local; never wait for a click
  });
  if (error) {
    console.error("Create user failed", { username, error });
    const taken = /already|registered|exists/i.test(error.message);
    return { error: taken ? `Username "${username}" sudah dipakai.` : `User tidak dapat dibuat: ${error.message}` };
  }

  revalidatePath("/pengaturan");
  revalidateTag(LOGIN_USERS_TAG, { expire: 0 });
  return { ok: `User "${username}" dibuat. Profil dan property-nya menyusul otomatis.` };
}

export async function resetPassword(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const { denied } = await adminOnly();
  if (denied) return denied;

  const userId = String(formData.get("userId") ?? "");
  const password = readPassword(formData);
  if (!userId) return { error: "User tidak dikenal." };
  if (!password) return { error: `Password minimal ${MIN_PASSWORD} karakter.` };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    console.error("Reset password failed", { userId, error });
    return { error: `Password tidak dapat diubah: ${error.message}` };
  }

  revalidatePath("/pengaturan");
  revalidateTag(LOGIN_USERS_TAG, { expire: 0 });
  return { ok: "Password berhasil diubah." };
}

export async function setUserActive(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const { me, denied } = await adminOnly();
  if (denied) return denied;

  const userId = String(formData.get("userId") ?? "");
  const activate = formData.get("activate") === "1";
  if (!userId) return { error: "User tidak dikenal." };
  // Disabling yourself is how an admin locks the whole team out of Pengaturan.
  if (!activate && userId === me.id) return { error: "Tidak bisa menonaktifkan akun sendiri." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: activate ? "none" : BAN_FOREVER,
  });
  if (error) {
    console.error("Set user active failed", { userId, activate, error });
    return { error: `Status user tidak dapat diubah: ${error.message}` };
  }

  revalidatePath("/pengaturan");
  revalidateTag(LOGIN_USERS_TAG, { expire: 0 });
  return { ok: activate ? "User diaktifkan kembali." : "User dinonaktifkan dan tidak bisa login lagi." };
}
