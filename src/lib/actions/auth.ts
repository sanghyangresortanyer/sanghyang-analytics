"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/auth/username";

export async function signIn(_prevState: { error?: string; ok?: boolean } | undefined, formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) return { error: "Username dan password wajib diisi" };

  const supabase = await createClient();

  // Optional local-only dev credential bridge configured via .env.local (never active in production)
  const devUser = process.env.LOCAL_DEV_AUTH_USER?.trim();
  const devPass = process.env.LOCAL_DEV_AUTH_PASSWORD;
  const devEmail = process.env.LOCAL_DEV_AUTH_EMAIL?.trim();
  if (
    process.env.NODE_ENV === "development" &&
    devUser &&
    devPass &&
    devEmail &&
    username.toLowerCase() === devUser.toLowerCase() &&
    password === devPass
  ) {
    const admin = createAdminClient();
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: devEmail,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      return { error: `Gagal membuat sesi lokal: ${linkErr?.message ?? "token kosong"}` };
    }
    const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (otpErr) return { error: `Verifikasi sesi lokal gagal: ${otpErr.message}` };
    return { ok: true };
  }

  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
  if (error) {
    console.warn(`[auth] signInWithPassword gagal: status=${error.status ?? "?"} code=${error.code ?? "unknown"}`);
    return { error: "Login gagal: username atau password salah" };
  }

  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
