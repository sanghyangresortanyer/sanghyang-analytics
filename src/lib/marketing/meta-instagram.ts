// Meta Graph API loader for Sanghyang's Instagram accounts (the business portfolio's accounts).
// Reads only. The access key (META_ACCESS_TOKEN) stays on the server, is sent in the Authorization
// header (never in the address, so it cannot end up in a cache key or a log line), and is never
// part of any message shown on the page.

export interface InstagramAccount {
  id: string;
  username: string;
  name: string;
  profile_picture_url?: string;
}

export interface InstagramMediaItem {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string; // ISO 8601 string, e.g. 2026-11-22T07:25:25+0000
  like_count?: number;
  comments_count?: number;
  outlet_username: string;
}

const META_GRAPH_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Retrieves Meta API token and business ID from environment variables. */
export function getMetaConfig(env: Record<string, string | undefined> = process.env) {
  const token = env.META_ACCESS_TOKEN?.trim().replace(/^["']|["']$/g, "");
  const businessId = env.META_BUSINESS_ID?.trim() || "1157089496793977";
  const appId = env.META_APP_ID?.trim() || "1149800084571159";
  return { token, businessId, appId };
}

type Graph<T> = { data: T } | { problem: string };

/** One Graph API read. A failure becomes a plain Indonesian reason; the key is never in it. */
async function graph<T>(path: string, token: string, revalidate: number): Promise<Graph<T[]>> {
  try {
    // revalidate 0 = straight from Instagram (the "Tarik data" button).
    const res = await fetch(`${META_BASE_URL}/${path}`, { headers: { authorization: `Bearer ${token}` }, ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }) });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: number } };
      const expired = res.status === 401 || body.error?.code === 190;
      console.warn(`[Meta API] ${path.split("?")[0]}: status ${res.status}${body.error?.code ? ` kode ${body.error.code}` : ""}`);
      return { problem: expired ? "ditolak Instagram (kunci akses kedaluwarsa atau dicabut)" : `tidak bisa dibaca (kode ${res.status})` };
    }
    const json = (await res.json()) as { data?: T[] };
    return { data: json.data ?? [] };
  } catch (err: unknown) {
    console.warn(`[Meta API] ${path.split("?")[0]}: ${(err as Error).message}`);
    return { problem: "tidak bisa dihubungi, coba lagi nanti" };
  }
}

async function accountsWithProblem(env: Record<string, string | undefined>): Promise<{ accounts: InstagramAccount[]; problem: string | null }> {
  const { token, businessId } = getMetaConfig(env);
  if (!token) return { accounts: [], problem: "Kunci akses Meta belum dipasang di aplikasi." };
  const r = await graph<InstagramAccount>(`${businessId}/instagram_accounts?fields=id,username,name,profile_picture_url`, token, 3600);
  return "problem" in r ? { accounts: [], problem: `Daftar akun Instagram ${r.problem}.` } : { accounts: r.data, problem: null };
}

async function mediaWithProblem(igUserId: string, username: string, limit: number, env: Record<string, string | undefined>, fresh = false): Promise<{ items: InstagramMediaItem[]; problem: string | null }> {
  const { token } = getMetaConfig(env);
  if (!token) return { items: [], problem: "Kunci akses Meta belum dipasang di aplikasi." };
  const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
  const r = await graph<Omit<InstagramMediaItem, "outlet_username">>(`${igUserId}/media?fields=${fields}&limit=${limit}`, token, fresh ? 0 : 900);
  if ("problem" in r) return { items: [], problem: `@${username} ${r.problem}` };
  return { items: r.data.map((item) => ({ ...item, outlet_username: username })), problem: null };
}

/** Connected Instagram business accounts under the business portfolio ([] when nothing can be read). */
export async function loadInstagramAccounts(env: Record<string, string | undefined> = process.env): Promise<InstagramAccount[]> {
  return (await accountsWithProblem(env)).accounts;
}

/** Recent media posts/reels of one Instagram account ([] when nothing can be read). */
export async function loadInstagramMedia(igUserId: string, username: string, limit = 20, env: Record<string, string | undefined> = process.env): Promise<InstagramMediaItem[]> {
  return (await mediaWithProblem(igUserId, username, limit, env)).items;
}

/**
 * All posts of all connected accounts, newest first. `problem` says in plain words what could not be
 * read (key missing, refused, one account unreadable); the accounts that did work are still returned.
 */
export async function loadAllInstagramPosts(
  env: Record<string, string | undefined> = process.env,
  { fresh = false, limit = 25 }: { fresh?: boolean; limit?: number } = {},
): Promise<{ accounts: InstagramAccount[]; posts: InstagramMediaItem[]; problem: string | null }> {
  const { accounts, problem } = await accountsWithProblem(env);
  if (!accounts.length) return { accounts: [], posts: [], problem: problem ?? "Belum ada akun Instagram yang tersambung ke portofolio Meta." };

  const results = await Promise.all(accounts.map((acc) => mediaWithProblem(acc.id, acc.username, limit, env, fresh)));
  const posts = results.flatMap((r) => r.items).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const problems = results.map((r) => r.problem).filter((p): p is string => !!p);
  // Every account refused with the same reason: say it once.
  const message = problems.length === 0 ? null : problems.length === accounts.length && posts.length === 0 && new Set(problems.map((p) => p.replace(/^@\S+ /, ""))).size === 1 ? `Semua akun ${problems[0].replace(/^@\S+ /, "")}.` : `${problems.join("; ")}.`;
  return { accounts, posts, problem: message };
}
