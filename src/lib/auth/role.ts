import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { emailToUsername } from "@/lib/auth/username";

type ProfileRow = { role: string; property_id: string | null; properties: { name: string } | null };

/**
 * The signed-in user's id, role, property_id/name and username, or null when
 * nobody is signed in.
 *
 * Read through the user's own client, so the existing profiles_select_self
 * policy covers it and the role check never depends on service_role.
 *
 * Only 'admin' means anything: it gates Pengaturan and nothing else. 'manager'
 * and 'staff' keep full access to every weekly comparison feature.
 *
 * Wrapped in React's cache() so every server component/action that calls
 * this within the same request (layout, page, etc.) shares one session check
 * + one profiles lookup instead of each repeating both round-trips.
 *
 * The session is checked with getClaims (token verified on this server with the project's ES256
 * key, no call to Supabase unless the token must be refreshed). getUser asked Supabase every time,
 * which was slow and, when that call failed, showed "Silakan login." to a signed-in user (22 Nov).
 */
export const currentUser = cache(async (): Promise<{ id: string; role: string; propertyId: string | null; propertyName: string | null; username: string } | null> => {
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) {
    // Code only (no token or user data), so a wrongly refused session can be traced in the logs.
    if (error) console.warn(`[auth] sesi tidak terbaca: ${error.name}${"code" in error && error.code ? ` ${String(error.code)}` : ""}`);
    return null;
  }
  const user = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };

  // properties(name) is embedded here (not a separate query) so showing the
  // resort name in the sidebar costs zero extra round-trips.
  const { data } = await supabase.from("profiles").select("role, property_id, properties(name)").eq("id", user.id).maybeSingle();
  const profile = data as ProfileRow | null;
  return {
    id: user.id,
    role: profile?.role ?? "staff",
    propertyId: profile?.property_id ?? null,
    propertyName: profile?.properties?.name ?? null,
    username: emailToUsername(user.email ?? ""),
  };
});

