import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. Server-only ("server-only" import
 * throws if bundled into a client component). Never expose this key or
 * client to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Supabase belum dikonfigurasi: isi NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SECRET_KEY di .env.local"
    );
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Private bucket for original VHP exports. `||` (not `??`) so a bucket env var
 * that exists but is blank — as happened on Vercel — still falls back instead
 * of asking storage for bucket "" and getting NoSuchBucket.
 */
export const SOURCE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "source-files";
