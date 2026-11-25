/**
 * Outlet F&B dan spa di dalam hotel pembanding sebagai pesaing outlet Sanghyang, diturunkan dari fakta situs resmi
 * (CompetitorFact restoran:/bar:/spa:, dan fasilitas:<nama> yang namanya outlet). Restoran hotel bersaing dengan D'Bistro,
 * restoran hotel Sanghyang, walau menunya bertema seafood; resto dan kafe mandiri bersaing dengan Sunset Grill, restoran
 * bakar seafood di pantai (keputusan pemilik 16 Nov 2026). Bar dengan D'Bar, yang di pantai atau ber-DJ juga dengan
 * Dragon Beach Club; spa dengan D'Spa. Lokasi, jarak, dan peran pembanding ikut hotel induknya (lib/market/compset.ts).
 */
import { slug } from "./competitor-gallery";

export type VenueKind = "resto" | "bar" | "spa";
/** Letak tempat: di dalam hotel pembanding (baris registri anak) atau berdiri sendiri. */
export type VenueSetting = "hotel" | "mandiri";

export interface HotelForVenues {
  id: string;
  name: string;
  placeId: string | null;
  compsetRole: string | null;
}

export interface VenueFact {
  hotelId: string;
  key: string;
  text: string;
  sourceUrl: string;
}

export interface PlannedVenue {
  parentId: string;
  name: string;
  placeId: string;
  category: VenueKind;
  outlets: string[];
  compsetRole: "inti" | "benchmark";
  websiteUrl: string;
  notes: string;
}

const KIND_BY_PREFIX: Record<string, VenueKind> = { restoran: "resto", bar: "bar", spa: "spa" };
const KIND_BY_NAME: [RegExp, VenueKind][] = [
  [/\bspa\b/i, "spa"],
  [/\b(restaurant|restoran|resto|dining|cafe|café|kafe|bistro|grill)\b/i, "resto"],
  [/\b(bar|lounge|pub)\b/i, "bar"],
];
/** Kata umum outlet; nama yang hanya berisi kata ini (mis. "Pool Bar") bukan nama outlet. */
const GENERIC_OUTLET_WORDS = new Set(
  "restaurant restoran resto dining cafe café kafe bistro grill bar lounge pub spa pool kolam renang beach pantai rooftop coffee shop main utama all day the & and dan".split(" "),
);

/**
 * Jenis outlet dari nama fasilitas bernama. Gemini kadang menulis outlet sebagai fasilitas:<nama> (mis. "fasilitas:Daiva
 * Spa"); outlet baru dihitung bila namanya punya kata khas selain kata umum.
 */
export function venueKindFromFacilityName(name: string): VenueKind | null {
  const kind = KIND_BY_NAME.find(([pattern]) => pattern.test(name))?.[1] ?? null;
  const distinctive = name.split(/\s+/).some((w) => w && !GENERIC_OUTLET_WORDS.has(w.toLowerCase()));
  return kind && distinctive ? kind : null;
}
const BEACH_NIGHTLIFE = /\b(beach|pantai|club|dj|live music|musik)\b/i;
/** Kata umum nama hotel yang dibuang saat membuat nama pendek ("Mambruk Hotel & Convention" -> "Mambruk"). */
const GENERIC_HOTEL_WORDS = new Set(["hotel", "resort", "place", "beach", "villa", "villas", "convention", "&", "by", "spa", "the"]);

export function shortHotelName(name: string): string {
  const words = name.split(/\s+/);
  const cut = words.findIndex((w, i) => i > 0 && GENERIC_HOTEL_WORDS.has(w.toLowerCase().replace(/,$/, "")));
  return (cut > 0 ? words.slice(0, cut) : words).join(" ").replace(/,$/, "");
}

/** Outlet resto Sanghyang yang menjadi pembanding menurut letak tempat, dan outlet resto yang bukan. */
const RESTO_OUTLET: Record<VenueSetting, { keep: string; drop: string }> = {
  hotel: { keep: "dbistro", drop: "sunset-grill" },
  mandiri: { keep: "sunset-grill", drop: "dbistro" },
};

/**
 * Outlet Sanghyang pembanding sebuah tempat. Penemuan pesaing (competitor-discovery.ts) memanggilnya untuk tempat
 * mandiri, jadi letak bawaannya "mandiri"; outlet di dalam hotel pembanding mengirim "hotel".
 */
export function outletsForVenue(kind: VenueKind, name: string, text: string, setting: VenueSetting = "mandiri"): string[] {
  if (kind === "resto") return [RESTO_OUTLET[setting].keep];
  if (kind === "bar") return BEACH_NIGHTLIFE.test(`${name} ${text}`) ? ["dbar", "dragon-beach-club"] : ["dbar"];
  return ["dspa"];
}

/**
 * Kolom outlets baris resto setelah aturan letak diterapkan: outlet resto yang salah dibuang, yang benar ditambahkan,
 * outlet lain (mis. Dragon Beach Club untuk kafe pantai) tetap di urutannya.
 */
export function restoOutlets(outlets: string[], setting: VenueSetting): string[] {
  const { keep, drop } = RESTO_OUTLET[setting];
  const kept = outlets.filter((o) => o !== drop);
  return kept.includes(keep) ? kept : [keep, ...kept];
}

/** Rencana baris registri per outlet hotel; hotel tanpa peran pembanding (dan Sanghyang sendiri) dilewati. */
export function planHotelVenues(hotels: HotelForVenues[], facts: VenueFact[]): PlannedVenue[] {
  const plans: PlannedVenue[] = [];
  for (const hotel of hotels) {
    const role = hotel.compsetRole === "inti" || hotel.compsetRole === "benchmark" ? hotel.compsetRole : null;
    if (!role || hotel.placeId === "sanghyang") continue;
    for (const fact of facts.filter((f) => f.hotelId === hotel.id)) {
      const [prefix, ...rest] = fact.key.split(":");
      const venue = rest.join(":").trim();
      const kind = KIND_BY_PREFIX[prefix] ?? (prefix === "fasilitas" ? venueKindFromFacilityName(venue) : null);
      if (!kind || !venue) continue;
      const short = shortHotelName(hotel.name);
      const name = venue.toLowerCase().includes(short.toLowerCase()) ? venue : `${venue} ${short}`;
      if (plans.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
      plans.push({
        parentId: hotel.id,
        name,
        placeId: slug(`${venue}_${hotel.placeId ?? short}`),
        category: kind,
        outlets: outletsForVenue(kind, venue, fact.text, "hotel"),
        compsetRole: role,
        websiteUrl: fact.sourceUrl,
        notes: fact.text,
      });
    }
  }
  return plans;
}
