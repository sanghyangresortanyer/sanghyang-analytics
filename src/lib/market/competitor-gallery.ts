/**
 * Galeri foto pesaing (kamar, fasilitas, restoran & outlet) untuk modul "Galeri Kompetitor".
 * Foto dikumpulkan Antigravity (prompt: docs/prompts/antigravity-galeri-kompetitor.md) ke competitor-gallery.data.json;
 * daftar sasaran foto diambil dari hotel-compset. Pesaing yang tampil per outlet berasal dari registri pembanding (gallery-outlets.ts).
 * Foto tidak disalin: hanya URL aslinya yang disimpan, dengan URL halaman sumbernya.
 */
import compset from "./hotel-compset.data.json";
import { COMPSET_MAX_ROAD_KM } from "./compset";
import gallery from "./competitor-gallery.data.json";

export const PHOTO_CATEGORIES = ["kamar", "fasilitas", "restoran-outlet", "lainnya"] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  kamar: "Kamar",
  fasilitas: "Fasilitas",
  "restoran-outlet": "Restoran & Outlet",
  lainnya: "Suasana & Menu",
};
export const SOURCE_TYPES = ["situs resmi", "Google Maps", "Instagram", "OTA"] as const;

export type PlaceGroup = "own" | "hotel" | "resto" | "bar" | "spa";
export const GROUP_LABEL: Record<PlaceGroup, string> = {
  own: "Sanghyang (pembanding)",
  hotel: "Hotel & Resort",
  resto: "Resto & Beach Club",
  bar: "Bar & Karaoke",
  spa: "Spa hotel",
};

export const SANGHYANG_OUTLETS = [
  "resort",
  "sunset-grill",
  "dragon-beach-club",
  "dbistro",
  "dbar",
  "dspa",
] as const;
export type SanghyangOutlet = (typeof SANGHYANG_OUTLETS)[number];

export interface OutletMeta {
  key: SanghyangOutlet;
  label: string;
  icon: string;
  tagline: string;
}

export const OUTLET_META: Record<SanghyangOutlet, OutletMeta> = {
  resort: { key: "resort", label: "Kamar & Resort", icon: "🏖️", tagline: "Hotel & resort" },
  "sunset-grill": { key: "sunset-grill", label: "Sunset Grill", icon: "🐟", tagline: "Resto seafood" },
  "dragon-beach-club": { key: "dragon-beach-club", label: "Dragon Beach Club", icon: "🎧", tagline: "Venue hiburan & musik" },
  dbistro: { key: "dbistro", label: "D'Bistro", icon: "🍽️", tagline: "Restoran hotel" },
  dbar: { key: "dbar", label: "D'Bar & Karaoke", icon: "🎤", tagline: "Bar & karaoke" },
  dspa: { key: "dspa", label: "D'Spa & Hot Spring", icon: "♨️", tagline: "Spa & relaksasi" },
};

export interface GalleryPhoto {
  url: string;
  category: PhotoCategory;
  caption: string;
  /** Nama outlet di dalam tempat itu (mis. "Lighthouse Bar & Lounge"), atau null. */
  outlet: string | null;
  sourceType: (typeof SOURCE_TYPES)[number];
  sourceUrl: string;
  capturedAt: string;
  /**
   * Tanggal link foto diketahui mati (mis. link Google Travel "/hrppk/" kedaluwarsa, atau server kini membalas halaman
   * HTML seperti perlindungan bot alih-alih gambar); disimpan, tidak ditampilkan.
   */
  expired?: string;
  /**
   * Hasil membaca isi foto (scripts/ops/read-gallery-photos.ts): true bila foto memperlihatkan tempat usaha itu sendiri.
   * Foto unggahan pengunjung Google Maps sering salah tempat, jadi foto yang belum dinilai juga tidak ditampilkan.
   */
  relevant?: boolean;
  /** Alasan foto dinilai tidak relevan (orang berpose, kendaraan, bangunan lain, dsb.); foto tetap disimpan sebagai arsip. */
  irrelevantReason?: string;
}

/** Foto yang boleh tampil: link masih hidup dan isinya sudah dinilai memperlihatkan tempat itu sendiri. */
export const isShownPhoto = (photo: GalleryPhoto): boolean => !photo.expired && photo.relevant === true;

export interface GalleryTarget {
  placeId: string;
  name: string;
  group: PlaceGroup;
  roadKm: number | null;
  mapsUrl: string | null;
}

export interface GalleryPlace extends GalleryTarget {
  photos: GalleryPhoto[];
}

/** Tempat fiktif yang tidak ada di Google Maps (keputusan 07 Nov 2026); tidak masuk galeri. */
const EXCLUDED = new Set(["anyer_family_ktv"]);
export const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Semua tempat yang dikumpulkan fotonya: hotel compset, resto/beach club, dan tempat sejenis outlet Sanghyang (≤ 25 km). */
export const GALLERY_TARGETS: GalleryTarget[] = (() => {
  // Hotel yang dikeluarkan dari kompset dan tempat di luar 25 km tidak dikumpulkan fotonya (keputusan pemakai 13 Nov 2026).
  const out: GalleryTarget[] = compset.hotels.filter((h) => !("excludedReason" in h && h.excludedReason)).map((h) => ({
    placeId: h.hotelId,
    name: h.name,
    group: h.hotelId === "sanghyang" ? "own" : "hotel",
    roadKm: h.roadKm,
    mapsUrl: h.mapsUrl,
  }));
  const add = (t: GalleryTarget) => {
    const inRadius = t.roadKm !== null && t.roadKm <= COMPSET_MAX_ROAD_KM;
    if (inRadius && !EXCLUDED.has(t.placeId) && !out.some((x) => x.placeId === t.placeId || x.name.toLowerCase() === t.name.toLowerCase())) out.push(t);
  };
  for (const v of compset.venues) add({ placeId: v.venueId, name: v.name, group: "resto", roadKm: v.roadKm, mapsUrl: v.mapsUrl });
  const outlets = compset.outletVenues as Record<string, { name: string; roadKm: number; mapsUrl: string }[]>;
  for (const [outlet, places] of Object.entries(outlets))
    for (const p of places) add({ placeId: slug(p.name), name: p.name, group: outlet === "dbar" ? "bar" : outlet === "dspa" ? "spa" : "resto", roadKm: p.roadKm, mapsUrl: p.mapsUrl });
  return out;
})();

/**
 * Aturan file hasil crawl; dipakai `npm run check:gallery` sebelum file diserahkan. `registryPlaceIds`: placeId registri
 * (gallery-outlets.ts) untuk outlet hotel yang fotonya dikumpulkan dari situs resmi dan tidak ada di daftar sasaran.
 */
export function validateGallery(data: unknown, registryPlaceIds: Iterable<string> = []): string[] {
  const problems: string[] = [];
  const d = data as { source?: unknown; updatedAt?: unknown; places?: unknown };
  const isDay = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const isHttps = (v: unknown) => typeof v === "string" && URL.canParse(v) && new URL(v).protocol === "https:";
  if (typeof d?.source !== "string" || !d.source.trim()) problems.push("source wajib diisi");
  if (!isDay(d?.updatedAt)) problems.push("updatedAt harus YYYY-MM-DD");
  if (!Array.isArray(d?.places)) return [...problems, "places harus array"];
  const ids = new Set([...GALLERY_TARGETS.map((t) => t.placeId), ...registryPlaceIds]);
  // Foto tempat yang sudah dikeluarkan dari pembanding tetap disimpan sebagai arsip, tetapi tidak ditampilkan.
  const archived = new Set([
    ...compset.hotels.filter((h) => "excludedReason" in h && h.excludedReason).map((h) => h.hotelId),
    ...compset.venues.filter((v) => v.roadKm === null || v.roadKm > COMPSET_MAX_ROAD_KM).map((v) => v.venueId),
  ]);
  const seenUrls = new Set<string>();
  for (const [i, p] of (d.places as { placeId?: unknown; photos?: unknown }[]).entries()) {
    const where = `places[${i}]`;
    if (typeof p?.placeId === "string" && archived.has(p.placeId)) continue;
    if (typeof p?.placeId !== "string" || !ids.has(p.placeId)) {
      problems.push(`${where}: placeId "${String(p?.placeId)}" tidak ada di daftar sasaran`);
      continue;
    }
    if (!Array.isArray(p.photos)) {
      problems.push(`${where} (${p.placeId}): photos harus array`);
      continue;
    }
    for (const [j, ph] of (p.photos as Partial<GalleryPhoto>[]).entries()) {
      const at = `${p.placeId}.photos[${j}]`;
      if (!isHttps(ph.url)) problems.push(`${at}: url harus https`);
      else if (ph.url!.includes("/hrppk/") && !ph.expired) problems.push(`${at}: link Google Travel (/hrppk/) kedaluwarsa dalam beberapa hari; pakai foto Google Maps atau situs resmi`);
      else if (seenUrls.has(ph.url!)) problems.push(`${at}: url ganda`);
      else seenUrls.add(ph.url!);
      if (!PHOTO_CATEGORIES.includes(ph.category as PhotoCategory)) problems.push(`${at}: category harus salah satu ${PHOTO_CATEGORIES.join(", ")}`);
      if (typeof ph.caption !== "string" || !ph.caption.trim() || ph.caption.length > 120) problems.push(`${at}: caption 1-120 huruf`);
      if (ph.outlet !== null && (typeof ph.outlet !== "string" || !ph.outlet.trim())) problems.push(`${at}: outlet berisi nama atau null`);
      if (!SOURCE_TYPES.includes(ph.sourceType as (typeof SOURCE_TYPES)[number])) problems.push(`${at}: sourceType harus salah satu ${SOURCE_TYPES.join(", ")}`);
      if (!isHttps(ph.sourceUrl)) problems.push(`${at}: sourceUrl harus https`);
      if (!isDay(ph.capturedAt)) problems.push(`${at}: capturedAt harus YYYY-MM-DD`);
      if (ph.relevant !== undefined && typeof ph.relevant !== "boolean") problems.push(`${at}: relevant harus true atau false`);
      const reasonOk = typeof ph.irrelevantReason === "string" && ph.irrelevantReason.trim() !== "" && ph.irrelevantReason.length <= 120;
      if (ph.relevant === false && !reasonOk) problems.push(`${at}: foto yang tidak relevan wajib punya irrelevantReason 1-120 huruf`);
      if (ph.relevant !== false && ph.irrelevantReason !== undefined) problems.push(`${at}: irrelevantReason hanya untuk foto yang tidak relevan`);
    }
  }
  return problems;
}

export const GALLERY_SOURCE = { source: gallery.source, updatedAt: gallery.updatedAt };

/** Semua foto satu placeId di data galeri, termasuk outlet hotel dari registri dan foto arsip. */
export const galleryPhotosOf = (placeId: string): GalleryPhoto[] =>
  (gallery.places as { placeId: string; photos: GalleryPhoto[] }[]).find((p) => p.placeId === placeId)?.photos ?? [];

/** Tempat + fotonya, Sanghyang lebih dulu, lalu yang terdekat. Tempat tanpa foto tetap tampil (menunggu crawl). */
export const GALLERY_PLACES: GalleryPlace[] = GALLERY_TARGETS.map((t) => ({
  ...t,
  photos: galleryPhotosOf(t.placeId).filter(isShownPhoto),
})).sort((a, b) => Number(b.group === "own") - Number(a.group === "own") || (a.roadKm ?? Infinity) - (b.roadKm ?? Infinity));

/** Foto galeri yang masih hidup dan relevan untuk satu tempat (dipakai juga tabel hotel di Insight Pasar); kamar dulu. */
export const placePhotos = (placeId: string): GalleryPhoto[] =>
  [...(GALLERY_PLACES.find((p) => p.placeId === placeId)?.photos ?? [])].sort((a, b) => PHOTO_CATEGORIES.indexOf(a.category) - PHOTO_CATEGORIES.indexOf(b.category));

/**
 * Status ketersediaan foto secara jujur (D9 / Zero Mock).
 * Mengembalikan 'Belum dikumpulkan' jika tidak ada foto, tanpa menjanjikan crawl di masa depan.
 */
export function getGalleryPhotoStatus(photos: GalleryPhoto[]): "Tersedia" | "Belum dikumpulkan" {
  return photos.length > 0 ? "Tersedia" : "Belum dikumpulkan";
}
