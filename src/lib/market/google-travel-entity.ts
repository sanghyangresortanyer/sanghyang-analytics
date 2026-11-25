/**
 * Alamat halaman hotel Google Travel diturunkan dari ID tempat Google Maps yang sudah tersimpan di registri.
 *
 * Token entity Google Travel adalah protobuf berenkode base64url: field 1 berisi { 1: cid, 3: kgmid } dan field 2
 * bernilai 1. cid adalah bagian kedua ID fitur di URL Google Maps ("!1s0x<a>:0x<cid>"), kgmid adalah "/g/..." di
 * bagian "!16s". Dengan ini crawler tidak perlu mencari hotel berdasarkan nama (cara lama yang gagal untuk enam hotel
 * karena nama registri berbeda dengan nama di Google). Rumus diuji terhadap token yang diketahui di
 * tests/unit/google-travel-entity.test.ts.
 */

export interface MapsPlaceIds {
  cidHex: string;
  kgmid: string | null;
}

/** Ambil cid dan kgmid dari URL tempat Google Maps; null bila URL tidak memuat ID fitur. */
export function mapsPlaceIds(mapsUrl: string | null | undefined): MapsPlaceIds | null {
  if (!mapsUrl) return null;
  const decoded = decodeURIComponent(mapsUrl);
  const feature = decoded.match(/!1s0x[0-9a-f]+:(0x[0-9a-f]+)/i);
  if (!feature) return null;
  const kgmid = decoded.match(/!16s(\/g\/[A-Za-z0-9_-]+)/)?.[1] ?? null;
  return { cidHex: feature[1].toLowerCase(), kgmid };
}

function varint(value: bigint): number[] {
  const out: number[] = [];
  let n = value;
  do {
    let byte = Number(n & BigInt(0x7f));
    n >>= BigInt(7);
    if (n > BigInt(0)) byte |= 0x80;
    out.push(byte);
  } while (n > BigInt(0));
  return out;
}

/** Token entity Google Travel untuk sebuah cid (dan kgmid bila ada). */
export function googleTravelEntityToken({ cidHex, kgmid }: MapsPlaceIds): string {
  const inner = [0x08, ...varint(BigInt(cidHex))];
  if (kgmid) inner.push(0x1a, kgmid.length, ...Buffer.from(kgmid, "utf8"));
  const message = [0x0a, inner.length, ...inner, 0x10, 0x01];
  return Buffer.from(message).toString("base64url");
}

export function googleTravelEntityUrlFromMaps(mapsUrl: string | null | undefined): string | null {
  const ids = mapsPlaceIds(mapsUrl);
  return ids ? `https://www.google.com/travel/hotels/entity/${googleTravelEntityToken(ids)}` : null;
}
