// Google Ads + GA4 settings. Paths are relative to the Sanghyang Analytics
// root (the folder the app and `npm run marketing` start from).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = process.cwd();
export const REPORTS_DIR = resolve(ROOT, "docs", "laporan", "ads");
export const REMINDERS_FILE = resolve(ROOT, "docs", "marketing", "reminders.json");

/** Loads .env.local (if present) without overriding real env vars. */
export function loadEnv(path = resolve(ROOT, ".env.local")): void {
  // The ignore marks keep the build from packing the whole project because of this one optional file.
  if (existsSync(/* turbopackIgnore: true */ path)) process.loadEnvFile(/* turbopackIgnore: true */ path);
}

/**
 * The Google OAuth client (client_id, client_secret and, for GA4, refresh_token): the JSON itself in
 * GOOGLE_OAUTH_CLIENT_JSON (for Vercel), else the file named by GA4_CREDENTIALS_FILE. Errors name keys only.
 */
export function googleCredentials(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const inline = env.GOOGLE_OAUTH_CLIENT_JSON?.trim();
  if (inline) return parseSecret(inline, "GOOGLE_OAUTH_CLIENT_JSON");
  const file = env.GA4_CREDENTIALS_FILE?.trim();
  if (!file) throw new Error("GOOGLE_OAUTH_CLIENT_JSON or GA4_CREDENTIALS_FILE missing");
  if (!existsSync(file)) throw new Error("GA4_CREDENTIALS_FILE not found on this computer");
  return parseSecret(readFileSync(file, "utf8"), "GA4_CREDENTIALS_FILE");
}

/** JSON.parse whose error names the key only; the engine's own message quotes part of the secret. */
function parseSecret(text: string, name: string): Record<string, string> {
  try {
    return JSON.parse(text) as Record<string, string>;
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}
