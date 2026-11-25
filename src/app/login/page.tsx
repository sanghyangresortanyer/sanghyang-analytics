import { connection } from "next/server";
import { getLoginUsernames } from "@/lib/auth/login-users";
import { LoginForm } from "./login-form";

/** Never let a slow or unreachable Supabase block the login screen: fall back to typing. */
const FALLBACK_AFTER_MS = 3000;

export default async function LoginPage() {
  await connection(); // render per request so the user list is never baked in at build time
  const fetchedUsernames = await Promise.race([
    getLoginUsernames().catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : "unknown";
      console.warn(`[auth] gagal memuat daftar user login: ${detail}`);
      return [] as string[];
    }),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), FALLBACK_AFTER_MS)),
  ]);

  const devUser =
    process.env.NODE_ENV === "development" && process.env.LOCAL_DEV_AUTH_USER
      ? process.env.LOCAL_DEV_AUTH_USER.trim()
      : undefined;

  const usernames =
    devUser && !fetchedUsernames.includes(devUser)
      ? [devUser, ...fetchedUsernames]
      : fetchedUsernames;

  return <LoginForm usernames={usernames} />;
}
