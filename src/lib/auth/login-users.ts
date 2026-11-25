import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailToUsername, isAppAccount } from "@/lib/auth/username";

export const LOGIN_USERS_TAG = "login-users";

/**
 * Usernames offered in the login dropdown: active Sanghyang Analytics accounts only (accounts of other
 * apps sharing this Supabase project are left out). Cached so the login page never waits
 * on the Auth admin API; user actions bust the tag. Errors throw and are not cached.
 */
// ponytail: unstable_cache is the pre-Cache-Components API; move to "use cache" + cacheTag if cacheComponents is enabled.
export const getLoginUsernames = unstable_cache(
  async (): Promise<string[]> => {
    const { data, error } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    const now = new Date();
    return data.users
      .filter((u) => u.email && isAppAccount(u.email) && !(u.banned_until && new Date(u.banned_until) > now))
      .map((u) => emailToUsername(u.email!))
      .sort((a, b) => a.localeCompare(b, "id-ID"));
  },
  ["login-usernames"],
  { tags: [LOGIN_USERS_TAG], revalidate: 300 }
);
