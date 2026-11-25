/**
 * Tingkat Penghunian Kamar (TPK) hotel bintang Provinsi Banten dari Badan Pusat Statistik, sebagai dasar perkiraan
 * ukuran pasar kamar (lib/market/market-size.ts). Menggantikan konstanta 48,5% tanpa sumber.
 *
 * Sumber: Berita Resmi Statistik BPS Banten. Judul rilisnya selalu memuat angkanya, mis. "Tingkat Penghunian Kamar
 * (TPK) hotel bintang di Banten pada Maret 2026 mencapai 47,14 persen", dan halaman rilis dirender di server sehingga
 * bisa dibaca tanpa peramban. Rilis baru ditemukan lewat BPS WebAPI (kunci gratis, BPS_WEBAPI_KEY); tanpa kunci,
 * langkah penemuan dilewati dengan alasan yang tercatat, dan nilai terakhir yang tersimpan tetap dipakai beserta bulannya.
 */
import { db } from "../db";

export const TPK_KEY = "tpk_hotel_bintang_banten";
const BPS_BANTEN_DOMAIN = "3600";
/** Identitas perayap yang jujur (bukan menyamar sebagai peramban). */
const CRAWLER_UA = "SanghyangNewsCrawler/1.0 (pemantauan pasar internal; sumber data BPS dicantumkan)";

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

export interface TpkObservation {
  /** Hari pertama bulan data (UTC). */
  period: Date;
  /** Persen, mis. 47.14. */
  value: number;
  sourceTitle: string;
  sourceUrl: string;
}

/** Angka TPK dan bulannya dari judul rilis BPS Banten; null bila judul bukan rilis TPK hotel bintang Banten. */
export function parseTpkTitle(title: string): { period: Date; value: number } | null {
  const m = title.match(/Tingkat Penghunian Kamar \(TPK\) hotel bintang di Banten pada ([A-Za-z]+) (\d{4}) mencapai ([\d.,]+) persen/i);
  const month = m ? MONTHS[m[1].toLowerCase()] : undefined;
  if (!m || !month) return null;
  const value = Number(m[3].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return { period: new Date(Date.UTC(Number(m[2]), month - 1, 1)), value };
}

/** Baca satu halaman rilis BPS dari server dan ambil TPK dari judulnya. */
export async function fetchTpkPressRelease(url: string): Promise<TpkObservation> {
  const res = await fetch(url, { headers: { "User-Agent": CRAWLER_UA, "Accept-Language": "id-ID,id;q=0.9" }, redirect: "follow" });
  if (!res.ok) throw new Error(`rilis BPS menjawab HTTP ${res.status}`);
  const html = await res.text();
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+-\s+Badan Pusat Statistik[\s\S]*$/, "").trim();
  const parsed = title ? parseTpkTitle(title) : null;
  if (!title || !parsed) throw new Error(`judul rilis bukan TPK hotel bintang Banten: "${title ?? "tanpa judul"}"`);
  return { ...parsed, sourceTitle: title, sourceUrl: url };
}

export async function saveTpk(obs: TpkObservation) {
  return db.marketMacroStat.upsert({
    where: { key_period: { key: TPK_KEY, period: obs.period } },
    update: { value: obs.value, sourceTitle: obs.sourceTitle, sourceUrl: obs.sourceUrl, observedAt: new Date(), version: { increment: 1 } },
    create: { key: TPK_KEY, period: obs.period, value: obs.value, unit: "persen", sourceTitle: obs.sourceTitle, sourceUrl: obs.sourceUrl },
  });
}

interface WebApiPressRelease {
  title: string;
  rl_date?: string;
  pdf?: string;
}

/**
 * Temukan rilis TPK terbaru lewat BPS WebAPI lalu simpan. Tanpa BPS_WEBAPI_KEY langkah ini dilewati dengan alasannya;
 * galat jaringan atau format dilempar supaya tercatat di ScrapeError. listed = rilis yang dikembalikan BPS, saved = yang
 * judulnya terurai dan tersimpan; rilis ada tetapi tidak satu pun tersimpan menandakan format judul BPS berubah.
 */
export async function syncBpsTpk(env: Record<string, string | undefined> = process.env): Promise<{ saved: number; listed: number; skippedReason?: string }> {
  const key = env.BPS_WEBAPI_KEY?.trim();
  if (!key) return { saved: 0, listed: 0, skippedReason: "BPS_WEBAPI_KEY belum diisi, jadi rilis TPK baru tidak dicari otomatis" };
  const url = `https://webapi.bps.go.id/v1/api/list/model/pressrelease/lang/ind/domain/${BPS_BANTEN_DOMAIN}/keyword/${encodeURIComponent("penghunian kamar")}/key/${encodeURIComponent(key)}/`;
  const res = await fetch(url, { headers: { "User-Agent": CRAWLER_UA } });
  if (!res.ok) throw new Error(`BPS WebAPI menjawab HTTP ${res.status}`);
  const json = (await res.json()) as { status?: string; data?: [unknown, WebApiPressRelease[]] };
  if (json.status !== "OK" || !Array.isArray(json.data?.[1])) throw new Error(`format BPS WebAPI tidak dikenal (status ${json.status ?? "kosong"})`);
  let saved = 0;
  for (const item of json.data[1]) {
    const parsed = parseTpkTitle(item.title);
    if (!parsed) continue;
    await saveTpk({ ...parsed, sourceTitle: item.title, sourceUrl: item.pdf ?? `https://banten.bps.go.id/id/pressrelease` });
    saved++;
  }
  return { saved, listed: json.data[1].length };
}

/** TPK terbaru yang tersimpan (pecahan 0–1) beserta bulan dan sumbernya; null bila belum pernah diambil. */
export async function latestTpk(): Promise<{ rate: number; period: Date; sourceTitle: string; sourceUrl: string } | null> {
  const row = await db.marketMacroStat.findFirst({ where: { key: TPK_KEY }, orderBy: { period: "desc" } });
  return row ? { rate: Number(row.value) / 100, period: row.period, sourceTitle: row.sourceTitle, sourceUrl: row.sourceUrl } : null;
}
