/**
 * Galeri Pesaing per outlet dari registri pembanding (sama dengan Insight Pasar), dengan foto yang relevan saja.
 * Outlet di dalam hotel (mis. Lighthouse di Mambruk) memakai foto resminya sendiri (scripts/ops/collect-venue-photos.ts)
 * lalu foto listing hotel induknya yang terkait jenis outlet: restoran untuk Sunset Grill dan D'Bistro, bar dan musik
 * untuk Dragon Beach Club dan D'Bar, spa untuk D'Spa. Foto kamar dan fasilitas hotel hanya tampil di Kamar & Resort.
 * Foto yang isinya tidak memperlihatkan tempat usahanya, atau belum dinilai (scripts/ops/read-gallery-photos.ts), tidak tampil.
 */
import { cache } from "react";
import { withCache } from "../cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "../cache/tags";
import { db } from "../db";
import { galleryPhotosOf, isShownPhoto, SANGHYANG_OUTLETS, slug, type GalleryPhoto, type GalleryPlace, type PlaceGroup, type SanghyangOutlet } from "./competitor-gallery";
import { parseCompsetRole, type CompsetRole } from "./compset";
import { isOutletKey } from "./outlet-filters";

export interface OutletGalleryPlace extends GalleryPlace {
  role: CompsetRole | "sanghyang";
  /** Nama hotel induk bila tempat ini outlet di dalam hotel; fotonya diambil dari listing hotel itu. */
  parentName: string | null;
  /** Foto hotel induk yang disembunyikan karena tidak terkait outlet yang dipilih. */
  hiddenPhotos: number;
  /** Foto tempat ini yang isinya tidak memperlihatkan tempat usahanya; disimpan sebagai arsip, tidak ditampilkan. */
  irrelevantPhotos: number;
  /** placeId pemilik foto utama: tempat ini sendiri, atau hotel induk bila outlet belum punya foto resmi. Analisis
   * visual hanya ditampilkan bila sama dengan placeId tempat ini. */
  photoPlaceId: string;
}

const FOOD = /\b(restoran|resto|makan|makanan|hidangan|menu|buffet|prasmanan|sarapan|kafe|cafe|dining|seafood|ikan|kuliner|minuman)\b/i;
const NIGHTLIFE = /\b(bar|lounge|musik|music|dj|panggung|karaoke|minuman|cocktail|koktail|club|klub|live)\b/i;
const SPA = /\b(spa|pijat|massage|terapi|perawatan|sauna|jacuzzi|onsen|relaksasi)\b/i;

/** Apakah foto ini layak tampil untuk outlet yang dipilih. `ownListing`: foto memang milik tempat itu sendiri. */
export function photoFitsOutlet(photo: GalleryPhoto, outlet: SanghyangOutlet | "all", ownListing: boolean, lodging: boolean): boolean {
  if (outlet === "all" || outlet === "resort") return true;
  // Foto kamar hanya untuk Kamar & Resort, juga kamar yang keterangannya menyebut meja makan atau minibar.
  if (photo.category === "kamar") return false;
  // Restoran, bar, atau spa yang berdiri sendiri: fotonya memang milik tempat itu.
  if (ownListing && !lodging) return true;
  // Keterangan berawalan "Nama tempat - ..."; nama hotel seperti "Resort & Spa" tidak boleh ikut dicocokkan.
  const text = `${photo.caption.replace(/^.*? - /, "")} ${photo.outlet ?? ""}`;
  if (outlet === "sunset-grill" || outlet === "dbistro") return photo.category === "restoran-outlet" || FOOD.test(text);
  if (outlet === "dragon-beach-club" || outlet === "dbar") return NIGHTLIFE.test(text);
  return SPA.test(text);
}

/** Outlet acuan untuk menyaring foto hotel induk di tab Semua Outlet, menurut jenis outlet hotelnya. */
const OUTLET_FOR_VENUE: Record<string, SanghyangOutlet> = { resto: "dbistro", bar: "dbar", spa: "dspa" };

/** placeId semua baris registri, termasuk outlet hotel yang fotonya disimpan dengan placeId sendiri. */
export async function registryPlaceIds(): Promise<string[]> {
  const rows = await db.competitor.findMany({ where: { placeId: { not: null } }, select: { placeId: true } });
  return rows.map((r) => r.placeId as string);
}

export const groupFor = (category: string | null, own: boolean): PlaceGroup =>
  own ? "own" : category === "hotel" || category === "resort" ? "hotel" : category === "bar" ? "bar" : category === "spa" ? "spa" : "resto";

export const loadGalleryByOutlet = cache(async (): Promise<Record<SanghyangOutlet | "all", OutletGalleryPlace[]>> =>
  withCache(
    async () => {
      const rows = await db.competitor.findMany({
        where: { active: true, OR: [{ compsetRole: { not: null } }, { placeId: "sanghyang" }] },
        select: { name: true, placeId: true, category: true, outlets: true, roadKm: true, mapsUrl: true, googleMapsUrl: true, compsetRole: true, parent: { select: { name: true, placeId: true } } },
        orderBy: [{ roadKm: "asc" }, { name: "asc" }],
      });

      const build = (row: (typeof rows)[number], outlet: SanghyangOutlet | "all"): OutletGalleryPlace => {
        const placeId = row.placeId ?? slug(row.name);
        const own = placeId === "sanghyang";
        const lodging = row.category === "hotel" || row.category === "resort";
        const parentPlaceId = row.parent?.placeId ?? null;
        const allOwn = galleryPhotosOf(placeId);
        const ownPhotos = allOwn.filter(isShownPhoto);
        const parentPhotos = parentPlaceId ? galleryPhotosOf(parentPlaceId).filter(isShownPhoto) : [];
        const fitParent = (ph: GalleryPhoto) => {
          if (outlet !== "all" || !parentPlaceId) return photoFitsOutlet(ph, outlet, false, true);
          const targets = row.outlets.filter(isOutletKey) as SanghyangOutlet[];
          const effective = targets.length ? targets : [OUTLET_FOR_VENUE[row.category ?? ""] ?? outlet];
          return effective.some((o) => photoFitsOutlet(ph, o, false, true));
        };
        const photos = [
          ...ownPhotos.filter((ph) => photoFitsOutlet(ph, outlet, true, lodging)),
          ...parentPhotos.filter(fitParent),
        ];
        const photoPlaceId = ownPhotos.length || !parentPlaceId ? placeId : parentPlaceId;
        return {
          placeId,
          name: row.name,
          group: groupFor(row.category, own),
          roadKm: row.roadKm,
          mapsUrl: row.googleMapsUrl ?? row.mapsUrl,
          photos,
          role: own ? "sanghyang" : (parseCompsetRole(row.compsetRole) ?? "inti"),
          parentName: row.parent?.name ?? null,
          hiddenPhotos: ownPhotos.length + parentPhotos.length - photos.length,
          irrelevantPhotos: allOwn.filter((ph) => !ph.expired && ph.relevant === false).length,
          photoPlaceId,
        };
      };

      const result = {} as Record<SanghyangOutlet | "all", OutletGalleryPlace[]>;
      for (const outlet of SANGHYANG_OUTLETS) {
        result[outlet] = rows
          .filter((r) => r.outlets.includes(outlet) && (r.placeId !== "sanghyang" || outlet === "resort"))
          .filter((r) => r.placeId === "sanghyang" || r.compsetRole !== null)
          .map((r) => build(r, outlet));
      }
      result.all = rows.filter((r) => r.placeId !== "sanghyang").map((r) => build(r, "all"));
      return result;
    },
    ["mi-gallery-by-outlet"],
    { tags: [CACHE_TAGS.marketCompetitors, CACHE_TAGS.fnbCompare], revalidate: CACHE_TTL.marketIntelligence },
  ),
);
