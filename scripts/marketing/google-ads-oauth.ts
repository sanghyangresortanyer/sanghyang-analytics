// One-time OAuth consent for Google Ads API. Reuses the "GA4 MCP" desktop client (project sanghyang-web)
// from GA4_CREDENTIALS_FILE and stores GOOGLE_ADS_REFRESH_TOKEN in .env.local.
// Sign in with the dedicated account that has Standard access to Google Ads 793-128-8995 (not the owner account).
// Usage: node scripts/marketing/google-ads-oauth.ts  → open the printed URL, pick that account, click Allow.
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { loadEnv } from "../../src/lib/marketing/config.ts";

loadEnv();
const credsFile = process.env.GA4_CREDENTIALS_FILE?.trim();
if (!credsFile) throw new Error("GA4_CREDENTIALS_FILE missing in .env.local");
const { client_id, client_secret } = JSON.parse(readFileSync(credsFile, "utf8")) as Record<string, string>;
if (!client_id || !client_secret) throw new Error("client_id/client_secret missing in credentials file");

const PORT = 8799;
const redirect = `http://127.0.0.1:${PORT}`;
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id,
  redirect_uri: redirect,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/adwords",
  access_type: "offline",
  prompt: "select_account consent",
})}`;

const envPath = resolve(import.meta.dirname, "..", "..", ".env.local");
function saveEnv(key: string, value: string): void {
  const text = readFileSync(envPath, "utf8");
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(envPath, re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`);
}

const server = createServer(async (req, res) => {
  const code = new URL(req.url ?? "/", redirect).searchParams.get("code");
  if (!code) {
    res.end("Menunggu izin Google...");
    return;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id, client_secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const json = (await tokenRes.json()) as { refresh_token?: string; error?: string };
  if (!json.refresh_token) {
    res.end(`Gagal: ${json.error ?? "refresh_token tidak diterima"}`);
    console.error("OAUTH_FAILED", json.error ?? "no refresh_token");
    server.close();
    return;
  }
  saveEnv("GOOGLE_ADS_REFRESH_TOKEN", json.refresh_token);
  saveEnv("GOOGLE_ADS_CUSTOMER_ID", "7931288995");
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Berhasil. Izin Google Ads tersimpan. Tab ini boleh ditutup.");
  console.log("OAUTH_OK refresh token saved to .env.local");
  server.close();
});
server.listen(PORT, "127.0.0.1", () => console.log(`AUTH_URL ${authUrl}`));
