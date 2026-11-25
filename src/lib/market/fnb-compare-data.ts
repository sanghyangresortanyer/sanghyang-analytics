/**
 * Data pembanding harga menu satu outlet untuk route /api/market-intelligence/fnb-compare: item menu pesaing yang
 * lengkap, hotel induk dan jenis tempat dari registri, serta foto yang sama dengan Galeri Pesaing. Hanya untuk server:
 * berkas data menu tidak dibundel ke browser, dan nomor foto menu serta pencatat pembacaannya tidak ikut dikirim.
 */
import { cache } from "react";
import { withCache } from "../cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "../cache/tags";
import { galleryPhotosOf, isShownPhoto } from "./competitor-gallery";
import { menuExclusion } from "./competitor-menu";
import { mergeCompetitorMenu } from "./compset-audit";
import { menuGroup, type FnbCompareData, type FnbItem, type FnbOutletKey } from "./fnb-compare";
import { loadGalleryByOutlet, photoFitsOutlet } from "./gallery-outlets";
import { loadPlaceSpecsMap, getPlaceSpecs } from "./place-specs";
import { loadDynamicCompetitorMenuItems, type DynamicCompetitorMenuRecord } from "./refresh-competitor-menus";

/** Item menu satu pesaing beserta kategori menunya; null bila tempat ini belum ada di berkas data menu maupun fakta dinamis. */
export function rivalFnbItems(name: string, dynamicRecord?: DynamicCompetitorMenuRecord | null): FnbItem[] | null {
  const menu = mergeCompetitorMenu(name, dynamicRecord);
  if (!menu) return null;
  return menu.items.map((i) => ({
    name: i.name,
    category: i.category,
    price: i.price,
    priceMax: i.priceMax,
    unit: i.unit,
    group: menuGroup(i),
    excluded: menuExclusion(i),
  }));
}

function findDynamicMenu(
  map: Map<string, DynamicCompetitorMenuRecord>,
  placeId: string,
  name: string,
): DynamicCompetitorMenuRecord | null {
  const norm = name.trim().toLowerCase();
  for (const rec of map.values()) {
    if (rec.placeId && rec.placeId === placeId) return rec;
    if (rec.competitorName.trim().toLowerCase() === norm) return rec;
  }
  return null;
}

export const loadFnbCompareData = cache(async (outlet: FnbOutletKey): Promise<FnbCompareData> =>
  withCache(
    async () => {
      const [gallery, specsMap, dynamicMenusMap] = await Promise.all([
        loadGalleryByOutlet(),
        loadPlaceSpecsMap(outlet),
        loadDynamicCompetitorMenuItems(),
      ]);
      const places = gallery[outlet];
      const sanghyangPlaceId = `${outlet.replace(/-/g, "_")}_sanghyang`;
      const sanghyangSpecs = (await getPlaceSpecs(sanghyangPlaceId, outlet)) ?? (await getPlaceSpecs("sanghyang"));
      return {
        outlet,
        // Foto listing Sanghyang disaring dengan aturan foto hotel induk pesaing: restoran, bar, atau spa sesuai outletnya.
        sanghyangPhotos: galleryPhotosOf("sanghyang").filter(isShownPhoto).filter((p) => photoFitsOutlet(p, outlet, false, true)),
        sanghyangSpecs,
        rivals: Object.fromEntries(
          places.map((p) => {
            const specs = specsMap.get(p.placeId) ?? specsMap.get(p.name.toLowerCase()) ?? null;
            const dyn = findDynamicMenu(dynamicMenusMap, p.placeId, p.name);
            return [
              p.name,
              {
                parentName: p.parentName,
                group: p.group,
                photos: p.photos,
                items: rivalFnbItems(p.name, dyn),
                specs,
              },
            ];
          }),
        ),
        placeSpecsMap: Object.fromEntries(specsMap.entries()),
      };
    },
    ["mi-fnb-compare", outlet],
    {
      tags: [CACHE_TAGS.fnbCompare, CACHE_TAGS.marketMenus, CACHE_TAGS.marketSpecs, CACHE_TAGS.marketCompetitors],
      revalidate: CACHE_TTL.marketIntelligence,
    },
  ),
);
