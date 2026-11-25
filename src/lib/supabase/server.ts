import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side client scoped to the current user session — respects RLS. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // called from a Server Component without a response to write to — ignore,
            // middleware refreshes the session cookie instead.
          }
        },
      },
    }
  );
}
