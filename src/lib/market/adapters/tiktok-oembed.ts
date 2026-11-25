/**
 * TikTok oEmbed resmi (https://developers.tiktok.com/doc/embed-videos/): endpoint publik tanpa kunci untuk menyematkan
 * video. Jawaban nyata 16 Nov 2026 hanya berisi pemutar (html, embed_product_id), tanpa judul atau nama akun, jadi
 * yang bisa dipakai adalah pemeriksaan bahwa video yang sudah tercatat masih tersedia. Profil kreator dan postingan
 * Photo Mode (/photo/<id>) dijawab HTTP 400 (diverifikasi 25 Nov 2026).
 */
import { PROFILE_CRAWLER_UA } from "../official-pages";

export const TIKTOK_OEMBED_ENDPOINT = "https://www.tiktok.com/oembed";
export const TIKTOK_OEMBED_DOCS = "https://developers.tiktok.com/doc/embed-videos/";
const VIDEO_URL = /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._-]+\/video\/\d+\/?$/;
const PHOTO_URL = /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._-]+\/photo\/\d+\/?$/;
const OEMBED_TIMEOUT_MS = 10_000;

export const isTikTokVideoUrl = (url: string) => VIDEO_URL.test(url);
export const isTikTokPhotoUrl = (url: string) => PHOTO_URL.test(url);

export function tiktokOEmbedUrl(videoUrl: string): string {
  if (!isTikTokVideoUrl(videoUrl)) throw new Error(`Bukan URL video TikTok: ${videoUrl}`);
  return `${TIKTOK_OEMBED_ENDPOINT}?url=${encodeURIComponent(videoUrl)}`;
}

export interface TikTokOEmbedResult {
  url: string;
  status: number;
  available: boolean;
  embedProductId: string | null;
  /** Kolom oEmbed lama; null bila TikTok tidak mengirimkannya. */
  title: string | null;
  authorName: string | null;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseTikTokOEmbed(url: string, status: number, body: unknown): TikTokOEmbedResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const embedProductId = text(b.embed_product_id);
  return {
    url,
    status,
    available: status === 200 && (embedProductId !== null || text(b.html) !== null),
    embedProductId,
    title: text(b.title),
    authorName: text(b.author_name),
  };
}

export async function checkTikTokVideo(videoUrl: string): Promise<TikTokOEmbedResult> {
  const res = await fetch(tiktokOEmbedUrl(videoUrl), {
    headers: { "User-Agent": PROFILE_CRAWLER_UA },
    signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
  });
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // ZERO-FALLBACK: jawaban bukan JSON berarti video tidak terbaca lewat oEmbed; status HTTP tetap dicatat apa adanya.
    body = null;
  }
  return parseTikTokOEmbed(videoUrl, res.status, body);
}
