import { AdapterStatus, OfficialApiAdapter } from './types';

export const GRAPH_API_ORIGIN = 'https://graph.facebook.com';
export const BUSINESS_DISCOVERY_DOCS = 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery';
/** Kolom media publik yang dikembalikan Business Discovery untuk akun bisnis atau kreator lain (bukan isi komentar). */
const MEDIA_FIELDS = 'id,caption,comments_count,like_count,timestamp,permalink,media_type';

/**
 * Permintaan Business Discovery dari akun profesional kita (igUserId) untuk akun bisnis pesaing (username). Versi Graph
 * API diambil dari INSTAGRAM_GRAPH_API_VERSION; tanpa versi, Graph API memakai versi yang disetel di dasbor aplikasi.
 */
export function businessDiscoveryRequest({ igUserId, username, limit, token, version }: { igUserId: string; username: string; limit: number; token: string; version: string | null }): { url: string } {
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) throw new Error(`Bukan nama akun Instagram yang sah: ${username}`);
  if (!/^\d+$/.test(igUserId)) throw new Error('INSTAGRAM_BUSINESS_ACCOUNT_ID harus berupa angka ID akun Instagram profesional');
  const fields = `business_discovery.username(${username}){username,followers_count,media_count,media.limit(${Math.max(1, Math.round(limit))}){${MEDIA_FIELDS}}}`;
  const path = version ? `/${version}/${igUserId}` : `/${igUserId}`;
  return { url: `${GRAPH_API_ORIGIN}${path}?${new URLSearchParams({ fields, access_token: token })}` };
}

/** URL atau pesan galat yang aman dicetak: nilai access_token diganti. */
export const redactAccessToken = (text: string) => text.replace(/(access_token=)[^&\s"]+/g, '$1[disembunyikan]');

export interface InstagramMediaPayload {
  id: string;
  caption?: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface ParsedInstagramPost {
  postId: string;
  permalink: string;
  caption: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  imageUrl?: string;
  postedAt: Date;
  likes: number;
  comments: number;
}

export class InstagramGraphAdapter implements OfficialApiAdapter {
  readonly id = 'instagram-graph';
  readonly name = 'Instagram Graph API';
  readonly description = 'Adaptor resmi Meta Graph API untuk akun resmi Sanghyang dan Business Discovery kompetitor.';
  readonly requiredEnvKeys = [
    'INSTAGRAM_GRAPH_ACCESS_TOKEN',
    'INSTAGRAM_BUSINESS_ACCOUNT_ID',
  ];

  getStatus(): AdapterStatus {
    const connected = this.isConnected();
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      status: connected ? 'connected' : 'unconnected',
      statusLabel: connected ? 'Tersambung' : 'Belum tersambung',
      reason: connected
        ? undefined
        : 'Variabel lingkungan INSTAGRAM_GRAPH_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID belum diatur oleh pemilik repo.',
      requiredEnvKeys: this.requiredEnvKeys,
      documentationUrl: BUSINESS_DISCOVERY_DOCS,
    };
  }

  isConnected(): boolean {
    const token = process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN?.trim();
    const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();
    return Boolean(token && accountId);
  }

  /**
   * Parser kontrak data media resmi Instagram Graph API / Business Discovery.
   */
  parseMediaItem(payload: InstagramMediaPayload): ParsedInstagramPost {
    return {
      postId: payload.id,
      permalink: payload.permalink,
      caption: payload.caption || '',
      mediaType: payload.media_type,
      imageUrl: payload.media_url,
      postedAt: new Date(payload.timestamp),
      likes: payload.like_count ?? 0,
      comments: payload.comments_count ?? 0,
    };
  }

  /**
   * Postingan publik terbaru akun bisnis pesaing lewat Business Discovery. Dipanggil hanya bila isConnected(); galat Graph
   * API dilempar dengan token disembunyikan, supaya kegagalan tercatat per akun dan bukan dianggap 0 postingan.
   */
  async fetchBusinessDiscoveryPosts(targetUsername: string, limit: number): Promise<ParsedInstagramPost[]> {
    const token = process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN?.trim();
    const igUserId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim();
    if (!token || !igUserId) throw new Error('Instagram Graph API belum tersambung: isi INSTAGRAM_GRAPH_ACCESS_TOKEN dan INSTAGRAM_BUSINESS_ACCOUNT_ID');
    const { url } = businessDiscoveryRequest({ igUserId, username: targetUsername, limit, token, version: process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || null });
    const res = await fetch(url);
    const body = (await res.json()) as { business_discovery?: { media?: { data?: InstagramMediaPayload[] } }; error?: { message?: string; code?: number } };
    if (!res.ok || body.error) {
      throw new Error(redactAccessToken(`Graph API ${res.status}${body.error?.code ? ` kode ${body.error.code}` : ''}: ${body.error?.message ?? 'jawaban tanpa pesan'}`));
    }
    const media = body.business_discovery?.media?.data;
    if (!Array.isArray(media)) throw new Error('Jawaban Business Discovery tanpa daftar media (akun bukan akun bisnis/kreator, atau dibatasi usia)');
    return media.map((m) => this.parseMediaItem(m));
  }
}
