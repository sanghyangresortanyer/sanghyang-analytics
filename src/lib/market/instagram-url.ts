/**
 * Alamat Instagram tanpa ketergantungan server, supaya modul murni (gabung umpan Meta dan ekstensi) dan
 * sinkron ekstensi memakai aturan shortcode yang sama.
 */

/** Segmen jalur Instagram yang bukan nama akun. */
export const IG_RESERVED_PATHS = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts", "directory"]);

/**
 * Mengekstrak shortcode Instagram (case-sensitive) dari permalink `/p/<CODE>/`, `/reel/<CODE>/`,
 * `/reels/<CODE>/`, maupun `/<handle>/(p|reel|reels)/<CODE>/`. Menolak jalur reserved Instagram sebagai handle.
 */
export function instagramShortcodeFromUrl(rawUrl: string | null | undefined): string | null {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (host !== "www.instagram.com" && host !== "instagram.com" && host !== "m.instagram.com") return null;
    const m = parsed.pathname.match(/^\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reels?)\/([A-Za-z0-9_-]+)\/?$/);
    if (!m) return null;
    if (m[1] && IG_RESERVED_PATHS.has(m[1].toLowerCase())) return null;
    return m[3];
  } catch {
    return null;
  }
}
