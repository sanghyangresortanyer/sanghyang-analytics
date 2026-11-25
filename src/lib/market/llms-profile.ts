/**
 * Profil hotel dari data resmi yang disediakan operator untuk mesin lewat llms.txt (mis. Archipelago International untuk
 * Aston: llms.archipelagointernational.com). Dipakai bila halaman situsnya berupa aplikasi yang teksnya tidak terbaca.
 * Fakta disusun tanpa LLM; setiap kutipan diambil apa adanya dari teks sumber sehingga lolos verifikasi yang sama.
 */
import type { ExtractedFact } from "./competitor-facts";
import { PROFILE_CRAWLER_UA } from "./official-pages";

export interface SourcedFact extends ExtractedFact {
  sourceUrl: string;
}

interface PropertyIndex {
  property?: { name?: string; brand?: string; description?: string; star_rating?: number; room_count?: number };
  location?: { address?: Record<string, string | null> };
  documentation?: {
    rooms?: { inventory?: string };
    dining?: { restaurants?: { name: string; overview: string | null }[] };
    meetings?: { venues?: { name: string; capacity: number | null }[] };
  };
}

interface RoomInventory {
  room_types?: { name: string; size_sqm?: number | null; max_occupancy?: number | null }[];
}

async function fetchText(url: string): Promise<{ url: string; text: string } | null> {
  const res = await fetch(url, { headers: { "User-Agent": PROFILE_CRAWLER_UA }, redirect: "follow" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} menjawab ${res.status}`);
  return { url: res.url, text: await res.text() };
}

/** Alamat index.json properti yang ditautkan llms.txt situs, dicocokkan dengan slug di URL halaman hotel. */
export async function findPropertyIndexUrl(siteUrl: string): Promise<string | null> {
  const page = await fetch(siteUrl, { headers: { "User-Agent": PROFILE_CRAWLER_UA }, redirect: "follow" });
  const finalUrl = new URL(page.url);
  const slug = finalUrl.pathname.split("/").filter(Boolean).at(-1);
  if (!slug) return null;
  const llms = await fetchText(`${finalUrl.origin}/llms.txt`);
  if (!llms) return null;
  const needle = `/properties/${slug}/index.json`;
  const at = llms.text.indexOf(needle);
  if (at < 0) return null;
  const start = llms.text.lastIndexOf("http", at);
  const candidate = start < 0 ? "" : llms.text.slice(start, at + needle.length);
  return URL.canParse(candidate) && !/\s/.test(candidate) ? candidate : null;
}

/** Kutipan berupa teks persis di sumber; dipakai juga oleh verifikasi kutipan saat disimpan. */
const quoteOf = (raw: string, needle: string) => (raw.includes(needle) ? needle : null);

export async function readLlmsProfile(indexUrl: string): Promise<SourcedFact[]> {
  const index = await fetchText(indexUrl);
  if (!index) return [];
  const data = JSON.parse(index.text) as PropertyIndex;
  const base = indexUrl.replace(/index\.json$/, "");
  const facts: SourcedFact[] = [];
  const add = (f: ExtractedFact, raw: string, sourceUrl: string) => {
    if (quoteOf(raw, f.quote)) facts.push({ ...f, sourceUrl });
  };

  const p = data.property ?? {};
  if (p.description) add({ section: "profil", key: "deskripsi", text: p.description.slice(0, 240), quote: p.description.slice(0, 200) }, index.text, index.url);
  if (p.star_rating) add({ section: "profil", key: "kelas_bintang", text: `Bintang ${p.star_rating} menurut data resmi pengelola hotel.`, quote: `"star_rating": ${p.star_rating}` }, index.text, index.url);
  if (p.room_count) add({ section: "profil", key: "jumlah_kamar", text: `${p.room_count} kamar menurut data resmi pengelola hotel.`, quote: `"room_count": ${p.room_count}` }, index.text, index.url);
  if (p.brand) add({ section: "profil", key: "operator", text: `Merek ${p.brand}, data resmi dari ${new URL(indexUrl).hostname}.`, quote: `"brand": "${p.brand}"` }, index.text, index.url);
  const street = data.location?.address?.street;
  if (street) add({ section: "lokasi", key: "alamat", text: Object.values(data.location?.address ?? {}).filter(Boolean).join(", "), quote: street }, index.text, index.url);

  const venues = data.documentation?.meetings?.venues ?? [];
  const biggest = venues.filter((v) => v.capacity).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))[0];
  if (biggest?.capacity) add({ section: "fasilitas", key: "mice_kapasitas", text: `${biggest.name} menampung hingga ${biggest.capacity} orang.`, quote: `"capacity": ${biggest.capacity}` }, index.text, index.url);

  for (const r of data.documentation?.dining?.restaurants ?? []) {
    if (!r.overview) continue;
    const md = await fetchText(new URL(r.overview, base).toString());
    if (!md) continue;
    const overview = md.text.match(/## Overview\s+([^\n]+)/)?.[1]?.trim();
    if (overview) add({ section: "fasilitas", key: `restoran:${r.name}`, text: overview.slice(0, 240), quote: overview.slice(0, 280) }, md.text, md.url);
  }

  const inventoryUrl = data.documentation?.rooms?.inventory;
  if (inventoryUrl) {
    const inv = await fetchText(inventoryUrl);
    if (inv) {
      for (const room of (JSON.parse(inv.text) as RoomInventory).room_types ?? []) {
        const size = room.size_sqm ? `${room.size_sqm} m²` : "luas tidak tercantum";
        const guests = room.max_occupancy ? `hingga ${room.max_occupancy} tamu` : "kapasitas tidak tercantum";
        add({ section: "kamar", key: `tipe:${room.name}`, text: `${room.name}: ${size}, ${guests}.`, quote: `"name": "${room.name}"` }, inv.text, inv.url);
      }
    }
  }
  return facts;
}
