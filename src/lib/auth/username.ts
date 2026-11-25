/**
 * Login is by username; Supabase Auth is by email. The two are bridged here.
 *
 * New accounts follow the convention `<username>@sanghyang-analytics.local`, so they never need
 * an entry. The map is only for accounts that already existed with a real
 * address — changing those in the Dashboard is fiddly and there is no reason to.
 *
 * Lives in its own module (not the "use server" action file) so it stays a plain
 * function that can be imported and tested.
 */
const EMAIL_BY_USERNAME: Record<string, string> = {
  demon: "demon@gmail.com",
};

const FALLBACK_DOMAIN = "sanghyang-analytics.local";

export function usernameToEmail(username: string): string {
  const key = username.trim().toLowerCase();
  return EMAIL_BY_USERNAME[key] ?? `${key}@${FALLBACK_DOMAIN}`;
}

/** True for accounts that belong to this app (convention domain or explicitly mapped). */
export function isAppAccount(email: string): boolean {
  const key = email.trim().toLowerCase();
  return key.endsWith(`@${FALLBACK_DOMAIN}`) || Object.values(EMAIL_BY_USERNAME).includes(key);
}

/**
 * Inverse of usernameToEmail, for showing an account back to an admin. Falls
 * back to the address itself so a mapped account that is not in the table above
 * is still identifiable rather than silently mangled.
 */
export function emailToUsername(email: string): string {
  const key = email.trim().toLowerCase();
  const mapped = Object.keys(EMAIL_BY_USERNAME).find((u) => EMAIL_BY_USERNAME[u] === key);
  if (mapped) return mapped;
  return key.endsWith(`@${FALLBACK_DOMAIN}`) ? key.slice(0, -(FALLBACK_DOMAIN.length + 1)) : key;
}
