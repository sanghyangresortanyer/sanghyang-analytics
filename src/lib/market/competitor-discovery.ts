/**
 * Penemuan pesaing baru dari halaman pencarian Google Maps sekitar Anyer–Carita. Untuk tiap kelompok outlet (hotel/resor,
 * restoran, kafe/beach club, bar/karaoke, spa) kartu hasil pencarian dibaca, tempat yang sudah ada di registri (tabel
 * Competitor) dibuang, lalu sisanya dinilai dengan aturan pembanding di compset.ts. Jarak tempuh mobil diukur lewat OSRM
 * publik hanya untuk tempat yang sudah lolos aturan lain, satu permintaan per kandidat.
 *
 * Perayap memperkenalkan diri (PROFILE_CRAWLER_UA), mematuhi robots.txt, dan berhenti bila Google meminta verifikasi.
 * Untuk perayap ini Google menyajikan "tampilan terbatas" Maps: kartu hasil tetap memuat nama, rating, jumlah ulasan,
 * jenis tempat, kelas bintang hotel, dan URL tempat berkoordinat, tetapi alamat hotel hanya ada di halaman tempatnya.
 */
import { setTimeout as sleep } from "node:timers/promises";
import type { Page } from "puppeteer";
import { localLaunchOptions } from "../browser-launch";
import { COMPSET_MAX_ROAD_KM, compsetIneligibility, isLodging } from "./compset";
import { slug } from "./competitor-gallery";
import { SANGHYANG_PLACE_ID } from "./competitor-repository";
import { outletsForVenue } from "./hotel-venues";
import { isCrawlAllowed, PROFILE_CRAWLER_UA } from "./official-pages";
import { parseMapsRating, parseMapsReviewCount } from "./outlet-ratings";

/** Kelompok pencarian per outlet Sanghyang; kategori akhir tiap tempat tetap ditentukan jenis tempat Google-nya. */
export const DISCOVERY_SEARCHES = [
  { group: "hotel/resor", terms: ["hotel", "resort"] },
  { group: "restoran", terms: ["restoran", "rumah makan"] },
  { group: "kafe/beach club", terms: ["kafe", "beach club"] },
  { group: "bar/karaoke", terms: ["bar", "karaoke"] },
  { group: "spa", terms: ["spa", "pijat"] },
] as const;
/** Wilayah sepanjang pesisir Anyer–Carita. */
export const DISCOVERY_AREAS = ["Anyer", "Cinangka", "Carita"] as const;
/**
 * Peta pencarian berjangkar di Sanghyang dengan zoom 12 (pesisir Anyer sampai Pasauran). Tanpa jangkar, "restoran
 * cinangka" berakhir di Cinangka, Depok (uji 15 Nov 2026).
 */
const SEARCH_ZOOM = 12;
export const DEFAULT_RESULTS_PER_SEARCH = 20;
/**
 * Listing outlet di dalam hotel berjarak 19–176 m dari titik hotelnya (Oceana, Spa Marbella, Campo del Sol; data 15 Nov
 * 2026). Dalam radius ini nama yang berbagi kata khas dianggap tempat yang sama.
 */
const MATCH_RADIUS_M = 300;
export const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";
/** Kebijakan server demo OSRM: tidak lebih dari satu permintaan per detik, untuk pemakaian wajar non-komersial. */
const OSRM_MIN_INTERVAL_MS = 1_000;
const GOTO_TIMEOUT_MS = 45_000;
/** Kartu hasil atau halaman tempat biasanya tampil dalam beberapa detik; lebih dari ini halamannya tidak memuat hasil. */
const RESULTS_TIMEOUT_MS = 25_000;
/** Tiap gulir panel hasil memuat 6–10 kartu baru; tanpa kartu baru dalam batas ini daftarnya sudah habis. */
const MORE_RESULTS_TIMEOUT_MS = 8_000;
const ADDRESS_TIMEOUT_MS = 15_000;

export interface MapsSearchCard {
  href: string;
  name: string;
  ratingLabel: string | null;
  text: string;
}

export interface MapsPlacePageText {
  url: string;
  name: string;
  mainText: string;
  addressLabel: string | null;
}

export interface MapsPlace {
  name: string;
  /** URL tempat tanpa parameter pelacak; memuat id tempat dan koordinatnya. */
  mapsUrl: string;
  /** Id fitur Google Maps (0x…:0x…), sama dengan yang tertulis di URL tempat di registri. */
  featureId: string;
  googlePlaceId: string | null;
  lat: number;
  lng: number;
  rating: number | null;
  /** 0 bila kartu menulis "Tidak ada ulasan"; null bila tidak terbaca. */
  reviewCount: number | null;
  googleType: string | null;
  starRating: number | null;
  address: string | null;
  sponsored: boolean;
}

export interface RegistryPlace {
  id: string;
  name: string;
  category: string | null;
  placeId: string | null;
  googleMapsUrl: string | null;
  mapsUrl: string | null;
  parentId: string | null;
  roadKm: number | null;
  active: boolean;
  compsetRole: string | null;
}

export type PlaceKind = "penginapan" | "restoran" | "kafe" | "beach club" | "bar" | "spa";

export interface PlaceClass {
  kind: PlaceKind;
  /** Kategori registri: hotel, resort, resto, bar, atau spa. */
  category: string;
  outlets: string[];
}

export interface Origin {
  name: string;
  lat: number;
  lng: number;
}

export interface RegistryMatch {
  entry: RegistryPlace;
  by: "id tempat Google" | "nama" | "nama dan lokasi";
}

export interface DiscoveredPlace extends MapsPlace {
  /** Kueri pencarian yang memunculkan tempat ini. */
  foundBy: string[];
  observedAt: string;
}

export interface RoadDistance {
  km: number;
  minutes: number;
  measuredAt: string;
  url?: string;
}

export interface DiscoveryCandidate {
  place: DiscoveredPlace;
  cls: PlaceClass | null;
  straightKm: number;
  road: RoadDistance | null;
  /** Alasan tidak layak menjadi pembanding inti; null berarti layak. */
  reason: string | null;
  /** Hotel di registri dalam radius pencocokan: tempat ini bisa jadi outlet di dalam hotel itu. */
  nearLodging: { name: string; meters: number } | null;
}

export interface EligibilityInput {
  cls: PlaceClass | null;
  googleType: string | null;
  starRating: number | null;
  reviewCount: number | null;
  straightKm: number;
  roadKm?: number | null;
}

export interface NewCompetitorRow {
  name: string;
  category: string;
  group: string;
  outlets: string[];
  placeId: string;
  googleMapsUrl: string;
  mapsUrl: string;
  roadKm: number;
  driveMinutes: null;
  straightKm: number;
  distanceSource: string;
  address: string | null;
  starRating: number | null;
  rating: number | null;
  reviewCount: number | null;
  ratingSource: string;
  ratingSourceUrl: string;
  ratingObservedAt: Date;
  active: true;
  compsetRole: "inti";
  verifiedAt: null;
  notes: string;
}

/** Glif ikon Google (area pribadi Unicode) dan spasi tak-putus ikut terbaca di innerText kartu dan halaman tempat. */
const ICON_GLYPHS = /[\ue000-\uf8ff]/g;

function cleanLines(text: string): string[] {
  return text
    .replace(ICON_GLYPHS, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Id fitur, id tempat, dan koordinat dari URL Google Maps. Titik tempat (!3d/!4d) didahulukan dari tengah peta (@). */
export function mapsUrlRefs(url: string | null | undefined): { featureId: string | null; googlePlaceId: string | null; coords: { lat: number; lng: number } | null } {
  if (!url) return { featureId: null, googlePlaceId: null, coords: null };
  const pin = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const view = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const pair = pin ?? view;
  return {
    featureId: url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1].toLowerCase() ?? null,
    googlePlaceId: url.match(/!19s(ChIJ[\w-]+)/)?.[1] ?? null,
    coords: pair ? { lat: Number(pair[1]), lng: Number(pair[2]) } : null,
  };
}

const RATING_LABEL = /^([1-5],\d) bintang ([\d.]+) Ulasan/i;
const RATING_LINE = /^[1-5],\d\s*\([\d.]+\)$/;
const NO_REVIEWS = /^(Tidak|Belum) ada ulasan$/i;
const PRICE = /^Rp\s?\d/;
const STAR_CLASS = /^(.*?)\s+bintang\s+([1-5])$/i;

/** Baris jenis tempat: "Restoran Seafood · Jl. Raya Anyer-Sirih No.128" atau "Hotel bintang 4". */
function parseTypeLine(line: string | null | undefined): { googleType: string | null; starRating: number | null; address: string | null } {
  if (!line || PRICE.test(line)) return { googleType: null, starRating: null, address: null };
  const [first, ...rest] = line
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!first) return { googleType: null, starRating: null, address: null };
  const star = first.match(STAR_CLASS);
  return {
    googleType: star ? star[1] : first,
    starRating: star ? Number(star[2]) : null,
    address: rest.filter((part) => !PRICE.test(part)).at(-1) ?? null,
  };
}

function requireRefs(url: string, what: string) {
  const refs = mapsUrlRefs(url);
  if (!refs.featureId || !refs.coords) throw new Error(`${what} tidak memuat id tempat atau koordinat di URL-nya: ${url}`);
  return { featureId: refs.featureId, googlePlaceId: refs.googlePlaceId, coords: refs.coords };
}

/** Satu kartu hasil pencarian. Jenis tempat adalah baris tepat sesudah rating; kartu iklan hotel kadang hanya memuat harga di sana. */
export function parseSearchCard(card: MapsSearchCard): MapsPlace {
  const refs = requireRefs(card.href, `Kartu "${card.name}"`);
  const lines = cleanLines(card.text);
  const label = card.ratingLabel?.match(RATING_LABEL);
  const ratingAt = lines.findIndex((line) => RATING_LINE.test(line) || NO_REVIEWS.test(line));
  const noReviews = ratingAt >= 0 && NO_REVIEWS.test(lines[ratingAt]);
  return {
    name: card.name,
    mapsUrl: card.href.split("?")[0],
    featureId: refs.featureId,
    googlePlaceId: refs.googlePlaceId,
    lat: refs.coords.lat,
    lng: refs.coords.lng,
    rating: label ? Number(label[1].replace(",", ".")) : null,
    reviewCount: label ? Number(label[2].replace(/\./g, "")) : noReviews ? 0 : null,
    ...parseTypeLine(ratingAt >= 0 ? lines[ratingAt + 1] : null),
    sponsored: lines.includes("Bersponsor"),
  };
}

const PLACE_TABS = new Set(["Ringkasan", "Ulasan", "Tentang", "Harga", "Menu", "Ikhtisar"]);

/**
 * Halaman satu tempat: pencarian yang langsung membuka satu tempat, atau halaman tempat yang dibuka untuk membaca alamat.
 * Kepala halaman berisi rating, jumlah ulasan, dan jenis tempat sebelum tab Ringkasan.
 */
export function parsePlacePage(page: MapsPlacePageText): MapsPlace {
  const refs = requireRefs(page.url, `Halaman "${page.name}"`);
  const lines = cleanLines(page.mainText);
  const start = lines.indexOf(page.name.trim());
  if (start < 0) throw new Error(`Nama "${page.name}" tidak ada di teks halaman tempatnya`);
  const end = lines.findIndex((line, i) => i > start && PLACE_TABS.has(line));
  const header = lines.slice(start + 1, end < 0 ? undefined : end);
  const headerText = header.join("\n");
  const countAt = header.findIndex((line) => /^\([\d.]+\)/.test(line));
  // Hotel: "(4.696)·Hotel bintang 4" dalam satu baris; tempat lain: "(41)" lalu "Klub Malam" di baris berikutnya.
  const typeLine =
    countAt >= 0
      ? header[countAt].replace(/^\([\d.]+\)\s*·?\s*/, "") || header[countAt + 1]
      : header.find((line) => !/^[1-5],\d$/.test(line) && !NO_REVIEWS.test(line));
  const { googleType, starRating } = parseTypeLine(typeLine);
  const noReviews = header.some((line) => NO_REVIEWS.test(line));
  return {
    name: page.name.trim(),
    mapsUrl: page.url.split("?")[0],
    featureId: refs.featureId,
    googlePlaceId: refs.googlePlaceId,
    lat: refs.coords.lat,
    lng: refs.coords.lng,
    rating: parseMapsRating(headerText),
    reviewCount: parseMapsReviewCount(headerText) ?? (noReviews ? 0 : null),
    googleType,
    starRating,
    address: page.addressLabel?.replace(/^Alamat:\s*/, "").trim() || null,
    sponsored: false,
  };
}

const NAME_STOPWORDS = new Set(["the", "and", "dan", "by", "n", "at", "di", "of"]);

/** Nama untuk dibandingkan: tanpa diakritik, apostrof, tanda baca, huruf besar, dan kata sambung. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !NAME_STOPWORDS.has(word))
    .join(" ");
}

/** Kata jenis tempat dan wilayah yang dipakai banyak nama sehingga tidak membedakan satu tempat dari tempat lain. */
const GENERIC_NAME_WORDS = new Set([
  ...DISCOVERY_AREAS.map((area) => area.toLowerCase()),
  ..."anyar banten serang pandeglang cilegon".split(" "),
  ..."hotel hotels resort resorts resor villa villas vila cottage cottages penginapan homestay inn boutique place convention".split(" "),
  ..."beach pantai laut sea seaside view sunset pool".split(" "),
  ..."restaurant restoran resto rumah makan rm warung kedai cafe caffe kafe coffee kopi eatery dining grill seafood".split(" "),
  ..."bar lounge pub karaoke club klub spa massage pijat".split(" "),
]);

const distinctiveTokens = (name: string) => new Set(normalizeName(name).split(" ").filter((word) => word && !GENERIC_NAME_WORDS.has(word)));

const EARTH_RADIUS_KM = 6371.0088;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Jarak garis lurus dalam km, satu desimal seperti kolom straightKm di registri. */
export const straightLineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round(haversineKm(a, b) * 10) / 10;
const straightLineMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round(haversineKm(a, b) * 1000);

const registryRefs = (row: RegistryPlace) => [row.googleMapsUrl, row.mapsUrl].map(mapsUrlRefs);
const registryCoords = (row: RegistryPlace) => registryRefs(row).find((ref) => ref.coords !== null)?.coords ?? null;

/**
 * Baris registri untuk tempat hasil pencarian. Urutannya: id tempat Google di URL registri; lalu nama untuk baris arsip
 * tanpa lokasi (jenis tempat harus sama); lalu, dalam radius pencocokan, nama yang sama atau berbagi kata khas, untuk
 * outlet sendiri dan outlet di dalam hotel yang tercatat dengan titik hotelnya. Yang paling mirip menang, lalu yang terdekat.
 */
export function matchRegistry(place: MapsPlace, registry: RegistryPlace[]): RegistryMatch | null {
  const byId = registry.filter(
    (row) =>
      row.placeId === place.featureId ||
      (place.googlePlaceId !== null && row.placeId === place.googlePlaceId) ||
      registryRefs(row).some((ref) => ref.featureId === place.featureId || (place.googlePlaceId !== null && ref.googlePlaceId === place.googlePlaceId)),
  );
  const lodging = isLodging(classifyPlace(place.googleType, place.name)?.category);
  if (byId.length) {
    // Outlet di dalam hotel memakai URL hotel induknya, sebagian tanpa parentId (mis. bar arsip Aston), jadi baris yang
    // jenisnya sama dengan tempat ini didahulukan, lalu baris tanpa induk.
    const rank = (row: RegistryPlace) => (isLodging(row.category) === lodging ? 0 : 2) + (row.parentId === null ? 0 : 1);
    return { entry: [...byId].sort((a, b) => rank(a) - rank(b))[0], by: "id tempat Google" };
  }

  const name = normalizeName(place.name);
  const tokens = distinctiveTokens(place.name);
  let best: (RegistryMatch & { score: number; meters: number }) | null = null;
  for (const row of registry) {
    const coords = registryCoords(row);
    const meters = coords ? straightLineMeters(place, coords) : null;
    if (meters !== null && meters > MATCH_RADIUS_M) continue;
    const theirs = distinctiveTokens(row.name);
    const shared = [...tokens].filter((word) => theirs.has(word)).length;
    const sameName = normalizeName(row.name) === name;
    let by: RegistryMatch["by"] | null = null;
    if (meters === null) {
      const sameWords = shared > 0 && shared === tokens.size && shared === theirs.size;
      if (isLodging(row.category) === lodging && (sameName || sameWords)) by = "nama";
    } else if (sameName) by = "nama";
    else if (shared > 0) by = "nama dan lokasi";
    if (!by) continue;
    const score = sameName ? 1 : shared / new Set([...tokens, ...theirs]).size;
    const distance = meters ?? Number.POSITIVE_INFINITY;
    if (!best || score > best.score || (score === best.score && distance < best.meters)) best = { entry: row, by, score, meters: distance };
  }
  return best ? { entry: best.entry, by: best.by } : null;
}

const LODGING_TYPE = /^(hotel|resor|resort|vila|villa|penginapan|pondok|wisma|losmen|homestay|guest ?house|hostel|motel|cottage|bungalo|rental akomodasi)\b/i;
const RESTO_TYPE = /^(restoran|rumah makan|warung makan|pujasera|bistro|steakhouse)\b/i;
const CAFE_TYPE = /^(kafe|kedai kopi|kedai teh|coffee shop)\b/i;
const BEACH_CLUB_TYPE = /^(klub pantai|klub malam|beach club)\b/i;
const BAR_TYPE = /^(bar|pub|lounge|karaoke)\b/i;
const SPA_TYPE = /^(spa|klub spa|taman spa|terapis pijat|tukang pijat|panti pijat|pijat|refleksi)\b/i;
/** Restoran dan kafe di tepi pantai juga pesaing Dragon Beach Club, seperti Beach Point dan Kamalika di registri. */
const BEACHFRONT = /\b(beach|pantai)\b/i;
const RESORT_WORD = /\b(resor|resort)\b/i;

/**
 * Kategori registri dan outlet Sanghyang pembanding dari jenis tempat Google. Jenis yang tidak sejenis dengan outlet
 * mana pun (toko es krim, salon, klub olahraga) mengembalikan null.
 */
export function classifyPlace(googleType: string | null, name: string): PlaceClass | null {
  if (!googleType) return null;
  if (LODGING_TYPE.test(googleType)) {
    return { kind: "penginapan", category: RESORT_WORD.test(`${googleType} ${name}`) ? "resort" : "hotel", outlets: ["resort"] };
  }
  if (RESTO_TYPE.test(googleType) || CAFE_TYPE.test(googleType)) {
    const outlets = outletsForVenue("resto", name, googleType);
    return {
      kind: CAFE_TYPE.test(googleType) ? "kafe" : "restoran",
      category: "resto",
      outlets: BEACHFRONT.test(name) && !outlets.includes("dragon-beach-club") ? [...outlets, "dragon-beach-club"] : outlets,
    };
  }
  if (BEACH_CLUB_TYPE.test(googleType)) return { kind: "beach club", category: "bar", outlets: ["dbar", "dragon-beach-club"] };
  if (BAR_TYPE.test(googleType)) return { kind: "bar", category: "bar", outlets: outletsForVenue("bar", name, googleType) };
  if (SPA_TYPE.test(googleType)) return { kind: "spa", category: "spa", outlets: ["dspa"] };
  return null;
}

/** Titik awal jarak: koordinat Sanghyang Indah Spa Resort di registri. */
export function originFromRegistry(registry: RegistryPlace[]): Origin {
  const own = registry.find((row) => row.placeId === SANGHYANG_PLACE_ID);
  const coords = own ? registryCoords(own) : null;
  if (!own || !coords) throw new Error(`Titik awal jarak tidak ada: baris daftar kompetitor "${SANGHYANG_PLACE_ID}" tanpa koordinat Google Maps`);
  return { name: own.name, lat: coords.lat, lng: coords.lng };
}

const kmText = (km: number) => km.toLocaleString("id-ID");

/**
 * Aturan yang bisa dinilai tanpa jarak tempuh: sejenis, jarak garis lurus, kelas bintang, dan jumlah ulasan. OSRM hanya
 * ditanya untuk tempat yang lolos di sini, supaya server publiknya tidak dibebani.
 */
export function ineligibleWithoutRoadDistance(c: EligibilityInput): string | null {
  if (!c.googleType) return "Jenis tempat tidak tampil di kartu Google Maps.";
  if (!c.cls) return `Jenis tempat Google "${c.googleType}" tidak sejenis dengan outlet Sanghyang.`;
  if (c.straightKm > COMPSET_MAX_ROAD_KM) {
    return `Jarak garis lurus ${kmText(c.straightKm)} km dari Sanghyang sudah di luar ${COMPSET_MAX_ROAD_KM} km, jadi jarak tempuhnya pasti lebih jauh.`;
  }
  // Jarak garis lurus adalah batas bawah jarak tempuh. Selama batas bawah itu masih di dalam 25 km, compsetIneligibility
  // hanya bisa menolak karena kelas bintang atau jumlah ulasan, dua aturan yang tidak bergantung pada jarak.
  return compsetIneligibility({ category: c.cls.category, starRating: c.starRating, roadKm: c.straightKm, reviewCount: c.reviewCount });
}

/** Alasan tidak layak dengan jarak tempuh terukur; null berarti layak menjadi pembanding inti. */
export function candidateIneligibility(c: EligibilityInput): string | null {
  const before = ineligibleWithoutRoadDistance(c);
  if (before !== null || c.cls === null) return before;
  return compsetIneligibility({ category: c.cls.category, starRating: c.starRating, roadKm: c.roadKm ?? null, reviewCount: c.reviewCount });
}

/** Hotel di registri yang paling dekat dalam radius pencocokan; dipakai sebagai petunjuk outlet di dalam hotel. */
export function nearestLodging(place: MapsPlace, registry: RegistryPlace[]): { name: string; meters: number } | null {
  let best: { name: string; meters: number } | null = null;
  for (const row of registry) {
    if (!isLodging(row.category) || row.parentId !== null) continue;
    const coords = registryCoords(row);
    if (!coords) continue;
    const meters = straightLineMeters(place, coords);
    if (meters <= MATCH_RADIUS_M && (!best || meters < best.meters)) best = { name: row.name, meters };
  }
  return best;
}

/** Jawaban route OSRM -> jarak (km, satu desimal) dan durasi tanpa lalu lintas (menit). Jawaban galat dilempar. */
export function parseOsrmRoute(json: unknown): { km: number; minutes: number } {
  const body = json as { code?: string; message?: string; routes?: { distance?: number; duration?: number }[] };
  const route = body.code === "Ok" ? body.routes?.[0] : undefined;
  if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
    throw new Error(`OSRM tidak memberi rute: ${body.code ?? "tanpa kode"}${body.message ? ` (${body.message})` : ""}`);
  }
  return { km: Math.round((route.distance as number) / 100) / 10, minutes: Math.round((route.duration as number) / 60) };
}

export function mapsSearchUrl(term: string, area: string, origin: Origin): string {
  const query = encodeURIComponent(`${term} ${area}`).replace(/%20/g, "+");
  return `https://www.google.com/maps/search/${query}/@${origin.lat},${origin.lng},${SEARCH_ZOOM}z?hl=id`;
}

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

/**
 * Baris registri untuk kandidat layak. Durasi OSRM tidak disimpan: tanpa lalu lintas angkanya jauh di bawah Google Maps
 * (Mövenpick 17 menit vs 32 menit di registri), sedangkan jaraknya sejalan (23,65 km vs 23,6 km).
 */
export function competitorRowFor(c: DiscoveryCandidate, originName: string): NewCompetitorRow {
  if (c.reason !== null || c.cls === null || c.road === null) {
    throw new Error(`${c.place.name} tidak layak atau jarak tempuhnya belum diukur; hanya kandidat layak yang ditulis ke daftar kompetitor.`);
  }
  const p = c.place;
  return {
    name: p.name,
    category: c.cls.category,
    group: c.cls.category,
    outlets: c.cls.outlets,
    placeId: slug(p.name),
    googleMapsUrl: p.mapsUrl,
    mapsUrl: p.mapsUrl,
    roadKm: c.road.km,
    driveMinutes: null,
    straightKm: c.straightKm,
    distanceSource: `OSRM (router.project-osrm.org, mobil) dari ${originName}, diukur ${dateText(c.road.measuredAt)}`,
    address: p.address,
    starRating: isLodging(c.cls.category) ? p.starRating : null,
    rating: p.rating,
    reviewCount: p.reviewCount,
    ratingSource: "Google Maps",
    ratingSourceUrl: p.mapsUrl,
    ratingObservedAt: new Date(p.observedAt),
    active: true,
    compsetRole: "inti",
    verifiedAt: null,
    notes: `Ditemukan otomatis ${dateText(p.observedAt)} dari pencarian Google Maps; perlu dicek pemilik.`,
  };
}

/** Google meminta verifikasi (halaman /sorry/, persetujuan, atau CAPTCHA). Perayap berhenti, tidak menembusnya. */
export class GoogleVerificationError extends Error {
  name = "GoogleVerificationError";
}

const isTimeout = (error: unknown) => (error as Error).name === "TimeoutError";

async function stopIfVerificationRequested(page: Page): Promise<void> {
  const url = page.url();
  const challenged =
    /\/sorry\/|consent\.google\./.test(url) || (await page.evaluate(() => document.querySelector('iframe[src*="recaptcha"], #captcha-form') !== null));
  if (challenged) throw new GoogleVerificationError(`Google meminta verifikasi di ${url}; penemuan dihentikan tanpa menembusnya.`);
}

/**
 * Satu Chrome untuk satu halaman. Chrome yang dipakai berulang menumpuk proses renderer Google Maps walau tabnya ditutup,
 * sampai cgroup 1,6 GB mesin pengembang mematikannya (oom-kill setelah 9 pencarian, 16 Nov 2026).
 */
export async function withCrawlerPage<T>(read: (page: Page) => Promise<T>): Promise<T> {
  const puppeteer = (await import("puppeteer")).default;
  const launch = localLaunchOptions();
  const browser = await puppeteer.launch({ ...launch, args: [...launch.args, "--disable-dev-shm-usage", "--lang=id-ID"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(PROFILE_CRAWLER_UA);
    await page.setViewport({ width: 1280, height: 900 });
    return await read(page);
  } finally {
    await browser.close();
  }
}

async function readPlaceText(page: Page): Promise<MapsPlacePageText> {
  await page.waitForSelector("h1", { timeout: RESULTS_TIMEOUT_MS });
  await page.waitForSelector('[data-item-id="address"]', { timeout: ADDRESS_TIMEOUT_MS }).catch((error: unknown) => {
    // ZERO-FALLBACK: ada tempat yang memang tanpa alamat; alamatnya dicatat null, galat selain batas waktu tetap dilempar.
    if (!isTimeout(error)) throw error;
  });
  // Fungsi di dalam page.evaluate tidak boleh diberi nama: tsx membungkusnya dengan helper __name yang tidak ada di peramban.
  return page.evaluate(() => ({
    url: location.href,
    name: (document.querySelector("h1")?.textContent ?? "").trim(),
    mainText: ((document.querySelector('div[role="main"]') as HTMLElement | null)?.innerText ?? "").slice(0, 3000),
    addressLabel: document.querySelector('[data-item-id="address"]')?.getAttribute("aria-label") ?? null,
  }));
}

export type MapsSearchResult = { kind: "list"; cards: MapsSearchCard[] } | { kind: "place"; page: MapsPlacePageText };

/** Buka satu pencarian Google Maps dan baca kartunya sampai `maxResults`, atau satu tempat bila Google langsung membukanya. */
export async function readMapsSearch(page: Page, url: string, maxResults: number): Promise<MapsSearchResult> {
  if (!(await isCrawlAllowed(url))) throw new Error(`robots.txt melarang ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS });
  await stopIfVerificationRequested(page);
  const handle = await page.waitForFunction(
    () => {
      if (document.querySelector('div[role="article"] a[href*="/maps/place/"]')) return "list";
      if (location.pathname.startsWith("/maps/place/") && document.querySelector("h1")) return "place";
      return false;
    },
    { timeout: RESULTS_TIMEOUT_MS },
  );
  if ((await handle.jsonValue()) === "place") return { kind: "place", page: await readPlaceText(page) };
  let count = await page.$$eval('div[role="article"]', (els) => els.length);
  while (count < maxResults) {
    await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollTop = feed.scrollHeight;
    });
    const grew = await page
      .waitForFunction((n: number) => document.querySelectorAll('div[role="article"]').length > n, { timeout: MORE_RESULTS_TIMEOUT_MS }, count)
      .then(() => true)
      .catch((error: unknown) => {
        // ZERO-FALLBACK: tampilan terbatas tidak menandai akhir daftar; tanpa kartu baru dalam batas waktu daftarnya habis.
        if (isTimeout(error)) return false;
        throw error;
      });
    if (!grew) break;
    count = await page.$$eval('div[role="article"]', (els) => els.length);
  }
  const cards = await page.$$eval('div[role="article"]', (els) =>
    els.map((el) => {
      const link = el.querySelector('a[href*="/maps/place/"]') as HTMLAnchorElement | null;
      return {
        href: link?.href ?? "",
        name: link?.getAttribute("aria-label") ?? "",
        ratingLabel: Array.from(el.querySelectorAll('span[role="img"][aria-label]'))
          .map((span) => span.getAttribute("aria-label") ?? "")
          .find((label) => /bintang/i.test(label)) ?? null,
        text: (el as HTMLElement).innerText,
      };
    }),
  );
  return { kind: "list", cards: cards.filter((c) => c.href && c.name).slice(0, maxResults) };
}

/** Halaman satu tempat, untuk alamat yang tidak tampil di kartu hasil (kartu hotel). */
export async function readMapsPlace(page: Page, mapsUrl: string): Promise<MapsPlace> {
  const url = `${mapsUrl}${mapsUrl.includes("?") ? "&" : "?"}hl=id`;
  if (!(await isCrawlAllowed(url))) throw new Error(`robots.txt melarang ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS });
  await stopIfVerificationRequested(page);
  return parsePlacePage(await readPlaceText(page));
}

let lastOsrmRequestAt = 0;

/** Jarak tempuh mobil dari OSRM publik, satu permintaan per kandidat dengan UA jujur. */
export async function osrmRoadDistance(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RoadDistance> {
  const url = `${OSRM_ROUTE_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  if (!(await isCrawlAllowed(url))) throw new Error(`robots.txt melarang ${url}`);
  const wait = lastOsrmRequestAt + OSRM_MIN_INTERVAL_MS - Date.now();
  // Batas laju dari pemilik server, bukan jeda menunggu keadaan: permintaan berikutnya baru dikirim setelah satu detik.
  if (wait > 0) await sleep(wait);
  lastOsrmRequestAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": PROFILE_CRAWLER_UA } });
  if (!(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`OSRM HTTP ${res.status} tanpa jawaban JSON`);
  return { ...parseOsrmRoute(await res.json()), measuredAt: new Date().toISOString(), url };
}

export interface SearchRun {
  query: string;
  url: string;
  results: number;
  error: string | null;
}

export interface DiscoveryReport {
  origin: Origin;
  startedAt: string;
  searches: SearchRun[];
  known: { place: DiscoveredPlace; match: RegistryMatch }[];
  candidates: DiscoveryCandidate[];
  /** Pencarian, pengukuran jarak, atau pembacaan alamat yang gagal; --apply menolak menulis selama ini tidak kosong. */
  failures: string[];
}

export interface DiscoveryOptions {
  maxResultsPerSearch?: number;
  log?: (line: string) => void;
}

const REGISTRY_SELECT = {
  id: true,
  name: true,
  category: true,
  placeId: true,
  googleMapsUrl: true,
  mapsUrl: true,
  parentId: true,
  roadKm: true,
  active: true,
  compsetRole: true,
} as const;

/**
 * Jalankan semua pencarian, buang tempat yang sudah ada di registri, nilai sisanya dengan aturan pembanding, ukur jarak
 * tempuh kandidat yang lolos aturan lain, lalu baca alamat kandidat layak yang belum punya alamat. Tidak menulis apa pun.
 */
export async function discoverCompetitors(options: DiscoveryOptions = {}): Promise<DiscoveryReport> {
  const maxResults = options.maxResultsPerSearch ?? DEFAULT_RESULTS_PER_SEARCH;
  const log = options.log ?? (() => undefined);
  const { db } = await import("../db");
  const registry = await db.competitor.findMany({ select: REGISTRY_SELECT });
  const origin = originFromRegistry(registry);
  const report: DiscoveryReport = { origin, startedAt: new Date().toISOString(), searches: [], known: [], candidates: [], failures: [] };
  const found = new Map<string, DiscoveredPlace>();

  for (const { terms } of DISCOVERY_SEARCHES) {
    for (const term of terms) {
      for (const area of DISCOVERY_AREAS) {
        const query = `${term} ${area}`;
        const url = mapsSearchUrl(term, area, origin);
        try {
          const result = await withCrawlerPage((page) => readMapsSearch(page, url, maxResults));
          const observedAt = new Date().toISOString();
          const places = result.kind === "list" ? result.cards.map(parseSearchCard) : [parsePlacePage(result.page)];
          for (const place of places) {
            const seen = found.get(place.featureId);
            if (!seen) found.set(place.featureId, { ...place, foundBy: [query], observedAt });
            // Kartu iklan kadang tanpa jenis tempat; kartu biasa untuk tempat yang sama menggantikannya.
            else if (seen.sponsored && !place.sponsored) found.set(place.featureId, { ...place, foundBy: [...new Set([...seen.foundBy, query])], observedAt });
            else if (!seen.foundBy.includes(query)) seen.foundBy.push(query);
          }
          report.searches.push({ query, url, results: places.length, error: null });
          log(`${query}: ${places.length} tempat`);
        } catch (error) {
          if (error instanceof GoogleVerificationError) throw error;
          const message = (error as Error).message;
          report.searches.push({ query, url, results: 0, error: message });
          report.failures.push(`Pencarian "${query}": ${message}`);
          log(`${query}: GAGAL ${message}`);
        }
      }
    }
  }

  for (const place of found.values()) {
    const match = matchRegistry(place, registry);
    if (match) {
      report.known.push({ place, match });
      continue;
    }
    report.candidates.push({
      place,
      cls: classifyPlace(place.googleType, place.name),
      straightKm: straightLineKm(origin, place),
      road: null,
      reason: null,
      nearLodging: nearestLodging(place, registry),
    });
  }

  for (const c of report.candidates) {
    const input = { ...c.place, cls: c.cls, straightKm: c.straightKm };
    const before = ineligibleWithoutRoadDistance(input);
    if (before !== null) {
      c.reason = before;
      continue;
    }
    try {
      c.road = await osrmRoadDistance(origin, c.place);
      log(`jarak ${c.place.name}: ${kmText(c.road.km)} km`);
    } catch (error) {
      report.failures.push(`Jarak tempuh ${c.place.name}: ${(error as Error).message}`);
    }
    c.reason = candidateIneligibility({ ...input, roadKm: c.road?.km ?? null });
  }

  for (const c of report.candidates.filter((x) => x.reason === null && x.place.address === null)) {
    try {
      c.place.address = (await withCrawlerPage((page) => readMapsPlace(page, c.place.mapsUrl))).address;
      log(`alamat ${c.place.name}: ${c.place.address ?? "tidak tampil"}`);
    } catch (error) {
      if (error instanceof GoogleVerificationError) throw error;
      report.failures.push(`Alamat ${c.place.name}: ${(error as Error).message}`);
    }
  }
  return report;
}

/**
 * Tulis kandidat layak ke registri sebagai pembanding inti, semuanya dalam satu transaksi. Ditolak bila penemuan punya
 * galat, dan dibatalkan seluruhnya bila sebuah kandidat ternyata sudah tercatat sesudah penemuan berjalan.
 */
export async function applyDiscoveredCompetitors(report: DiscoveryReport): Promise<string[]> {
  if (report.failures.length) {
    throw new Error(`Penemuan belum lengkap (${report.failures.length} galat), daftar kompetitor tidak diubah. Selidiki galatnya lalu jalankan ulang.`);
  }
  const rows = report.candidates.filter((c) => c.reason === null).map((c) => ({ featureId: c.place.featureId, row: competitorRowFor(c, report.origin.name) }));
  if (!rows.length) return [];
  const { db } = await import("../db");
  return db.$transaction(async (tx) => {
    const added: string[] = [];
    for (const { featureId, row } of rows) {
      const clash = await tx.competitor.findFirst({
        where: { OR: [{ placeId: row.placeId }, { googleMapsUrl: { contains: featureId } }, { mapsUrl: { contains: featureId } }] },
        select: { name: true },
      });
      if (clash) throw new Error(`${row.name} bentrok dengan baris daftar kompetitor "${clash.name}"; tidak ada yang ditulis.`);
      await tx.competitor.create({ data: row });
      added.push(row.name);
    }
    return added;
  });
}
