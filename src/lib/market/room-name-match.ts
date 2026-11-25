/**
 * Pencocokan nama tipe kamar antar-sumber (situs resmi, booking engine, dan penawaran OTA) untuk satu hotel. Dipakai
 * matriks kompetitor untuk menempelkan tarif OTA ke tipe kamar, dan pemuat profil tipe kamar untuk menggabungkan data
 * riset dengan hasil penyegaran. Jumlah kamar tidur yang berbeda tidak pernah dicocokkan.
 */
import type { HotelRoomTypeSpec } from "./hotel-room-types";

const BEDROOM_WORDS: Record<string, number> = {
  "1": 1,
  one: 1,
  satu: 1,
  "2": 2,
  two: 2,
  dua: 2,
  "3": 3,
  three: 3,
  tiga: 3,
  "4": 4,
  four: 4,
  empat: 4,
};

const ROOM_STOP_TOKENS = new Set([
  "room",
  "rooms",
  "kamar",
  "bed",
  "beds",
  "bedroom",
  "bedrooms",
  "tidur",
  "with",
  "and",
  "or",
  "the",
  "king",
  "queen",
  "double",
  "twin",
  "single",
  "view",
]);

export function extractBedroomsFromName(raw: string): number | null {
  const m = raw.toLowerCase().match(/\b(1|2|3|4|one|two|three|four|satu|dua|tiga|empat)[-\s]*bed(?:room)?s?\b/);
  if (!m) return null;
  return BEDROOM_WORDS[m[1]] ?? null;
}

function normalizeRoomTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/\btownhouse\b/g, "town house")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !ROOM_STOP_TOKENS.has(t) && !(t in BEDROOM_WORDS));
}

/**
 * Mencari indeks tipe kamar di `roomTypes` yang paling cocok dengan nama kamar bukti OTA (`evRoomType`).
 * Mengembalikan -1 bila tidak ada kecocokan yang memadai (anti-salah-tempel).
 */
export function bestMatchingRoomIndex(evRoomType: string, roomTypes: HotelRoomTypeSpec[]): number {
  if (!roomTypes.length) return -1;
  // Bila OTA menggabungkan dua nama kamar dengan " - " (mis. "2-Bedroom Townhouse Villa - 1-Bedroom Town House Villa"),
  // bagian pertama adalah nama tipe kamar penawaran tersebut.
  const primaryEv = evRoomType.split(/\s+-\s+/)[0].trim();
  const evBeds = extractBedroomsFromName(primaryEv);
  const evTokens = normalizeRoomTokens(primaryEv);
  const evNorm = primaryEv.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < roomTypes.length; i++) {
    const rt = roomTypes[i];
    const rtNorm = rt.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const rtBeds = rt.bedrooms ?? extractBedroomsFromName(rt.name);

    // Jangan pernah mencocokkan jumlah kamar tidur yang berbeda (mis. 1BR vs 2BR/3BR).
    if (evBeds !== null && rtBeds !== null && evBeds !== rtBeds) continue;

    let score = 0;
    if (evNorm === rtNorm) score += 100;
    else if (rtNorm.includes(evNorm) || evNorm.includes(rtNorm)) score += 70;

    const rtTokens = normalizeRoomTokens(rt.name);
    const rtTokenSet = new Set(rtTokens);
    const shared = evTokens.filter((t) => rtTokenSet.has(t)).length;

    if (shared > 0) {
      const overlap = shared / Math.min(Math.max(1, evTokens.length), Math.max(1, rtTokens.length));
      score += Math.round(overlap * 60);
      // Penalti kecil untuk token ekstra pada rt agar varian dasar ("Studio Room") menang atas "Studio Room – Santorini Style" saat bukti hanya "Studio".
      const extraRtTokens = Math.max(0, rtTokens.length - shared);
      score -= extraRtTokens * 4;
    } else if (evTokens.length === 1 && evTokens[0] === rt.category) {
      // Contoh: bukti "Suite" pada Jayakarta yang hanya memiliki 1 suite ("Boutique Suite"), atau "Two-Bedroom Villa" -> "Villa".
      const sameCategoryPeers = roomTypes.filter(
        (cand) => cand.category === rt.category && (evBeds === null || cand.bedrooms === evBeds),
      );
      if (sameCategoryPeers.length === 1) score += 55;
    }

    if (evBeds !== null && rtBeds !== null && evBeds === rtBeds && score > 0) {
      score += 15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestScore >= 40 ? bestIdx : -1;
}
