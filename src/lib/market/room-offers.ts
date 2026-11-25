/**
 * Tarif per tipe kamar dari tab "Prices" Google Travel, port dari crawler "khuhsus crawl" (room_rates_crawler.py).
 * Hasilnya ditulis ke resort-room-rates.data.json dengan bentuk yang sama seperti impor workbook, jadi semua
 * perhitungan harga, PDF, dan tampilan web memakai aturan yang sama. Harga yang tidak tampil di layar tidak pernah ditebak.
 *
 * Aturan workbook yang dipertahankan (dicek 09 Nov 2026 pada 50 baris bukti):
 *  - jenis kamar dari nama: villa/cottage/condo/bedroom = villa, suite = suite, lainnya = standar;
 *  - harga per jenis = penawaran kamar termurah jenis itu; harga terendah hotel = penawaran penyedia termurah.
 *
 * Tipe kamar dan harga terendah per hari memakai tanggal utama (Selasa–Kamis dan Sabtu terdekat). Selain itu semua hotel
 * dirayapi untuk jendela malam H+1 sampai H+WINDOW_NIGHTS, supaya termurah dan termahal per jenis hari punya tanggal.
 */
import type { Browser, Page } from "puppeteer";
import compset from "./hotel-compset.data.json";
import { classifyRoom } from "./hotel-compset";
import { googleTravelEntityUrlFromMaps } from "./google-travel-entity";
import type { DatedRate, StayRange } from "./resort-room-rates";

export type RoomKind = "standard" | "suite" | "villa";
export type StayKey = "weekday" | "weekend";
const STAYS: StayKey[] = ["weekday", "weekend"];

/** Batas atas menunggu penawaran tambahan setelah "View more options" diklik (diukur 2–3 detik di Google Travel). */
const OFFER_LOAD_TIMEOUT_MS = 8_000;

export interface Offer { provider: string; price: number }
export interface RoomOffer { provider: string; room: string; detail: string; price: number }
export interface HotelStayCrawl { offers: Offer[]; rooms: RoomOffer[]; url: string }
/** Penawaran penyedia untuk satu malam lain di jendela tanggal (tanpa tipe kamar). */
export interface NightOffers { checkin: string; offers: Offer[] }
export interface HotelCrawl { hotelId: string; weekday: HotelStayCrawl | null; weekend: HotelStayCrawl | null; nights?: NightOffers[]; error?: string }

// ---------- aturan murni (diuji di tests/unit/room-rate-window.test.ts dan room-rate-registry.test.ts) ----------

const varint = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const field = (tag: number, payload: number[]) => [tag, ...varint(payload.length), ...payload];
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return [0x08, ...varint(y), 0x10, ...varint(m), 0x18, ...varint(d)];
};

/** Parameter `ts` Google Travel (tanggal menginap + mata uang); Google mengabaikan checkin/checkout biasa. */
export function buildTs(checkin: string, checkout: string, currency = "IDR"): string {
  const dates = [...field(0x0a, day(checkin)), ...field(0x12, day(checkout))];
  const inner = field(0x12, [...field(0x12, dates), ...field(0x32, [0x08, 0x00])]);
  const cur = field(0x2a, field(0x0a, field(0x3a, [...Buffer.from(currency)])));
  return Buffer.from([0x08, 0x00, ...field(0x1a, inner), ...cur]).toString("base64url");
}

export function parsePrice(text: string): number | null {
  const m = text.replace(/ /g, " ").trim().match(/^(?:Rp|IDR)\s?([\d.,]+)$/);
  return m ? Number(m[1].replace(/[.,]/g, "")) : null;
}

/** Judul blok iklan ("Sponsored·Featured options") dan "Cheapest combo rooms" (gabungan kamar) bukan satu tipe kamar. */
const NOT_A_ROOM = /^Sponsored|combo|^[^A-Za-z]*$/i;
const NOISE = new Set(["Sponsored", "Official Site", "Visit site", "Visit site for more options", "Sponsored·Featured options"]);

/** Baris [provider, teks baris] -> penawaran penyedia atau penawaran kamar. Baris tanpa harga (habis) dilewati. */
export function parseOfferRows(rows: [string, string][]): { offers: Offer[]; rooms: RoomOffer[] } {
  const offers: Offer[] = [];
  const rooms: RoomOffer[] = [];
  for (const [provider, text] of rows) {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !NOISE.has(l));
    const idx = lines.map(parsePrice).findLastIndex((p) => p !== null);
    if (idx < 0) continue;
    const price = parsePrice(lines[idx])!;
    const names = lines.slice(0, idx).filter((l) => parsePrice(l) === null);
    if (!names.length || names[0].toLowerCase() === provider.toLowerCase()) offers.push({ provider, price });
    else if (!NOT_A_ROOM.test(names[0])) rooms.push({ provider, room: names[0], detail: names.slice(1).join(" · "), price });
  }
  return { offers, rooms };
}

export { classifyRoom };

/** "Breakfast included", "Free breakfast", "Termasuk sarapan" dsb. "Room only"/"Tanpa sarapan" = tidak. */
export function hasBreakfast(text: string): boolean {
  if (/room only|no breakfast|tanpa sarapan|hanya kamar|breakfast (?:not included|excluded)/i.test(text)) return false;
  return /breakfast|sarapan|\b(?:bb|b&b)\b/i.test(text);
}

const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
/**
 * Jendela tanggal yang sama untuk semua hotel: malam H+1 sampai H+WINDOW_NIGHTS. Pendek supaya tanggal termurah dan
 * termahal tidak berjauhan (permintaan pemilik 16 Nov 2026: termurah H+1 dan termahal sebulan lagi tidak relevan).
 */
export const WINDOW_NIGHTS = 14;
/** Hari check-in akhir pekan (0 = Minggu): malam Jumat dan Sabtu. Malam Minggu sampai Kamis = hari biasa. */
const WEEKEND_CHECKIN_DAYS = new Set([5, 6]);

/** Tanggal hari ini menurut WIB, sebagai milidetik tengah malam UTC tanggal itu. */
const wibToday = (now: Date) => {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate());
};
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Jenis hari satu malam menurut hari check-in-nya. */
export const stayOf = (checkin: string): StayKey => (WEEKEND_CHECKIN_DAYS.has(new Date(`${checkin}T00:00:00Z`).getUTCDay()) ? "weekend" : "weekday");

export interface StayNight { checkin: string; checkout: string; stay: StayKey }

/** Malam H+1 sampai H+nights (WIB), urut tanggal, masing-masing dengan jenis harinya. */
export function stayWindow(now: Date, nights = WINDOW_NIGHTS): StayNight[] {
  const today = wibToday(now);
  return Array.from({ length: nights }, (_, i) => {
    const ci = today + (i + 1) * DAY_MS;
    const checkin = isoDay(ci);
    return { checkin, checkout: isoDay(ci + DAY_MS), stay: stayOf(checkin) };
  });
}

/** Hari `dow` (0 = Minggu) terdekat setelah hari ini (WIB), menginap satu malam. */
function nextDay(now: Date, dow: number): { checkin: string; checkout: string } {
  const today = wibToday(now);
  const ci = today + ((dow - new Date(today).getUTCDay() + 7) % 7 || 7) * DAY_MS;
  return { checkin: isoDay(ci), checkout: isoDay(ci + DAY_MS) };
}

/** Tanggal pembanding bergulir (WIB): Selasa terdekat dan Sabtu terdekat, minimal besok. */
export function nextStayDates(now: Date): Record<StayKey, { checkin: string; checkout: string }> {
  return { weekday: nextDay(now, 2), weekend: nextDay(now, 6) };
}

/**
 * Calon tanggal hari biasa: Selasa, Rabu, Kamis terdekat (urut tanggal). Google kadang tidak menampilkan tipe kamar
 * Sanghyang untuk satu tanggal (tercatat Selasa 10 Nov 2026, 8 sampel), jadi tanggal berikutnya dicoba.
 */
export const weekdayCandidates = (now: Date) => [2, 3, 4].map((dow) => nextDay(now, dow)).sort((a, b) => a.checkin.localeCompare(b.checkin));

const HOTELS = compset.hotels as {
  hotelId: string;
  name: string;
  googleStars: number | null;
  starRating?: number;
  mapsUrl: string;
  excludedReason?: string;
  titleAliases?: string[];
}[];
/** Kelas bintang pembanding (sama dengan compsetStars); hotel yang dirayapi wajib punya minimal satu sumber bintang. */
const hotelStars = (h: { name: string; googleStars: number | null; starRating?: number }): number => {
  const stars = Math.max(h.googleStars ?? 0, h.starRating ?? 0);
  if (!stars) throw new Error(`Bintang ${h.name} belum tercatat di hotel-compset.data.json (googleStars atau starRating)`);
  return stars;
};
/** Hotel yang dirayapi: Sanghyang dan pembanding (inti dan acuan); hotel yang dikeluarkan dari kompset tidak dirayapi. */
export const ROOM_RATE_HOTELS = HOTELS.filter((h) => !h.excludedReason).map((h) => h.hotelId);

/** Nama tempat di URL Google Maps ("/maps/place/<nama>/"), yaitu nama Google untuk entity yang sama; null bila tidak ada. */
export function mapsPlaceName(mapsUrl: string | null | undefined): string | null {
  const segment = mapsUrl?.match(/\/maps\/place\/([^/@?#]+)/)?.[1];
  return segment ? decodeURIComponent(segment.replace(/\+/g, " ")).trim() || null : null;
}

/**
 * Nama untuk memeriksa judul panel Google Travel dan mengenali situs resmi hotel itu sendiri: nama registri, nama
 * tempatnya di Google Maps, dan alias judul panel yang tercatat di data kompset. Semuanya dari data kompset, jadi hotel
 * yang ditambahkan ke registri langsung bisa dirayapi tanpa mengubah kode (daftar nama tertanam yang lama tidak memuat
 * Nemuru, sehingga setiap sampelnya gagal).
 */
export function hotelTitleNames(hotelId: string): string[] {
  const hotel = HOTELS.find((h) => h.hotelId === hotelId);
  if (!hotel) throw new Error(`hotel ${hotelId} tidak ada di daftar kompetitor (hotel-compset.data.json)`);
  // Alias = judul panel Google Travel untuk entity yang sama, dicatat di data kompset beserta sumbernya.
  return [...new Set([hotel.name, mapsPlaceName(hotel.mapsUrl), ...(hotel.titleAliases ?? [])].filter((name): name is string => Boolean(name)))];
}

/** Halaman entity Google Travel per hotel, dihitung dari ID tempat Google Maps di data kompset (tanpa pencarian nama). */
const ENTITY_URL = new Map(HOTELS.map((h) => [h.hotelId, googleTravelEntityUrlFromMaps(h.mapsUrl)]));
const SANGHYANG = "sanghyang";
const KINDS: RoomKind[] = ["standard", "suite", "villa"];
const KIND_OFFER: Record<RoomKind | "lowest", string> = { lowest: "OTA - Harga Terendah", standard: "OTA - Kamar Standar", suite: "OTA - Suite", villa: "OTA - Villa / Unit Multi-Kamar" };
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

interface Evidence { hotelId: string; stay: StayKey; provider: string; roomType: string; kind: RoomKind; price: number; breakfast: boolean }

const cheapest = <T extends { price: number }>(list: T[]) => list.reduce<T | null>((m, x) => (m === null || x.price < m.price ? x : m), null);

const NO_RATE: DatedRate = { price: null, checkIn: null, source: null };

/**
 * Termurah dan termahal per jenis hari dari penawaran termurah tiap malam (semua tipe kamar). Sampel yang jatuh pada
 * malam yang sama digabung dulu; bila tarifnya sama di beberapa malam, malam paling awal yang dipakai.
 */
function rateRange(nights: NightOffers[]): Record<StayKey, StayRange> {
  const offersByNight = new Map<string, Offer[]>();
  for (const n of nights) offersByNight.set(n.checkin, [...(offersByNight.get(n.checkin) ?? []), ...n.offers]);
  const lowest = [...offersByNight]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([checkIn, offers]) => {
      const offer = cheapest(offers);
      return offer ? [{ checkIn, offer }] : [];
    });
  const range = (stay: StayKey): StayRange => {
    const priced = lowest.filter((n) => stayOf(n.checkIn) === stay);
    const pick = (wins: (price: number, best: number) => boolean) =>
      priced.reduce<(typeof priced)[number] | null>((best, n) => (best === null || wins(n.offer.price, best.offer.price) ? n : best), null);
    const dated = (n: (typeof priced)[number] | null): DatedRate => (n ? { price: n.offer.price, checkIn: n.checkIn, source: n.offer.provider } : NO_RATE);
    return { nights: priced.length, min: dated(pick((price, best) => price < best)), max: dated(pick((price, best) => price > best)) };
  };
  return { weekday: range("weekday"), weekend: range("weekend") };
}

function note(stay: Record<StayKey, { sanghyang: number | null; competitor: number | null }>): string {
  const label: Record<StayKey, string> = { weekday: "Hari biasa", weekend: "Akhir pekan" };
  return (["weekday", "weekend"] as StayKey[])
    .map((s) => {
      const { sanghyang: a, competitor: b } = stay[s];
      if (a === null || b === null) return `${label[s]}: pembanding tidak tampil di bukti`;
      if (a === b) return `${label[s]}: setara dengan Sanghyang`;
      return `${label[s]}: kompetitor lebih ${b > a ? "mahal" : "murah"} dari Sanghyang (${rp(Math.abs(b - a))})`;
    })
    .join("; ");
}

/** Penawaran dari situs resmi hotel itu sendiri (bukan OTA); workbook hanya membandingkan harga OTA. */
export const isOfficialProvider = (provider: string, hotelId: string) => titleScore(provider, hotelTitleNames(hotelId)) >= MIN_TITLE_SCORE;

/**
 * Hasil crawl -> isi resort-room-rates.data.json (bentuk sama dengan scripts/ops/import-resort-room-rates.py), ditambah
 * jendela tanggal dan rentang termurah–termahal per hotel. `stayNights` = malam jendela yang dirayapi, dihitung saat
 * crawl mulai.
 */
export function buildRoomRateData(rawCrawls: HotelCrawl[], dates: Record<StayKey, { checkin: string }>, capturedAt: Date, stayNights: { checkin: string }[]) {
  const ota = <T extends { provider: string; room?: string }>(list: T[], hotelId: string) =>
    list.filter((o) => !isOfficialProvider(o.provider, hotelId) && (o.room === undefined || !NOT_A_ROOM.test(o.room)));
  const crawls = rawCrawls.map((c) => ({
    ...c,
    weekday: c.weekday && { ...c.weekday, offers: ota(c.weekday.offers, c.hotelId), rooms: ota(c.weekday.rooms, c.hotelId) },
    weekend: c.weekend && { ...c.weekend, offers: ota(c.weekend.offers, c.hotelId), rooms: ota(c.weekend.rooms, c.hotelId) },
    nights: (c.nights ?? []).map((n) => ({ ...n, offers: ota(n.offers, c.hotelId) })),
  }));
  /** Semua malam yang dirayapi untuk satu hotel: tanggal utama ditambah malam lain di jendela. */
  const nightsOf = (c: (typeof crawls)[number]): NightOffers[] => [
    ...STAYS.flatMap((s) => (c[s] ? [{ checkin: dates[s].checkin, offers: c[s].offers }] : [])),
    ...c.nights,
  ];
  const evidence: Evidence[] = [];
  for (const c of crawls)
    for (const s of STAYS)
      for (const r of c[s]?.rooms ?? []) {
        const e = { hotelId: c.hotelId, stay: s, provider: r.provider, roomType: r.room, kind: classifyRoom(r.room), price: r.price, breakfast: hasBreakfast(`${r.room} ${r.detail}`) };
        if (!evidence.some((x) => x.hotelId === e.hotelId && x.stay === s && x.provider === e.provider && x.roomType === e.roomType && x.price === e.price)) evidence.push(e);
      }
  const lowest = (hotelId: string, s: StayKey) => cheapest(crawls.find((c) => c.hotelId === hotelId)?.[s]?.offers ?? []);
  const kindMin = (hotelId: string, kind: RoomKind, s: StayKey) => cheapest(evidence.filter((e) => e.hotelId === hotelId && e.kind === kind && e.stay === s));
  const hotel = (id: string) => HOTELS.find((h) => h.hotelId === id)!;

  const lowestByHotel = crawls
    .filter((c) => c.weekday || c.weekend || c.nights.length)
    .map((c) => ({
      hotelId: c.hotelId,
      hotel: hotel(c.hotelId).name,
      starRating: hotelStars(hotel(c.hotelId)),
      weekday: { price: lowest(c.hotelId, "weekday")?.price ?? null, source: lowest(c.hotelId, "weekday")?.provider ?? null },
      weekend: { price: lowest(c.hotelId, "weekend")?.price ?? null, source: lowest(c.hotelId, "weekend")?.provider ?? null },
      range: rateRange(nightsOf(c)),
    }));

  const rates = [];
  for (const c of crawls.filter((x) => x.hotelId !== SANGHYANG && (x.weekday || x.weekend))) {
    const h = hotel(c.hotelId);
    const stars = hotelStars(h);
    const base = { hotelId: c.hotelId, competitorName: h.name, starRating: stars, cluster: stars >= 5 ? "KLASTER_II_BINTANG_5" : "KLASTER_I_BINTANG_4" };
    const byDay = (pick: (id: string, s: StayKey) => { price: number } | null) => ({
      weekday: { sanghyang: pick(SANGHYANG, "weekday")?.price ?? null, competitor: pick(c.hotelId, "weekday")?.price ?? null },
      weekend: { sanghyang: pick(SANGHYANG, "weekend")?.price ?? null, competitor: pick(c.hotelId, "weekend")?.price ?? null },
    });
    const lowDays = byDay(lowest);
    const via = (id: string) => STAYS.map((s) => `${s === "weekday" ? "Hari biasa" : "Akhir pekan"}: Semua tipe kamar (termurah via ${lowest(id, s)?.provider ?? "-"})`).join("\n");
    rates.push({ ...base, kind: "lowest", offer: KIND_OFFER.lowest, sanghyangRoom: via(SANGHYANG), competitorRoom: via(c.hotelId), ...lowDays, note: note(lowDays) });
    for (const kind of KINDS) {
      const days = byDay((id, s) => kindMin(id, kind, s));
      if (days.weekday.competitor === null && days.weekend.competitor === null) continue;
      const room = (id: string) => {
        const e = kindMin(id, kind, "weekday") ?? kindMin(id, kind, "weekend");
        return e ? `${e.roomType} (${e.provider})` : "Tidak tampil di bukti";
      };
      rates.push({ ...base, kind, offer: KIND_OFFER[kind], sanghyangRoom: room(SANGHYANG), competitorRoom: room(c.hotelId), ...days, note: note(days) });
    }
  }
  const wib = new Date(capturedAt.getTime() + WIB_OFFSET_MS);
  return {
    source: "Google Travel, tab Prices (crawl otomatis tiap malam)",
    sourceMethod: "Penawaran OTA di Google Travel (tab Prices), harga per malam termasuk pajak & biaya",
    capturedAt: `${wib.toISOString().slice(0, 16).replace("T", " ")} WIB`,
    checkInWeekday: dates.weekday.checkin,
    checkInWeekend: dates.weekend.checkin,
    window: { nights: stayNights.length, firstCheckIn: stayNights[0].checkin, lastCheckIn: stayNights[stayNights.length - 1].checkin },
    rates,
    lowestByHotel,
    evidence,
  };
}

/** Minimal hotel pembanding yang harganya tampil supaya perbandingan pasar bermakna. */
const MIN_PRICED_COMPETITORS = 5;
/** Minimal malam berharga per jenis hari supaya termurah dan termahal membandingkan malam yang berbeda. */
const MIN_RANGE_NIGHTS = 2;

/**
 * Data baru hanya dipakai bila lengkap: Sanghyang & minimal 5 hotel pembanding punya harga kedua hari di tanggal utama
 * dan rentang tarif minimal 2 malam per jenis hari, dengan semua tanggal rentang di dalam jendela yang disebut.
 */
export function validateRoomRateData(d: ReturnType<typeof buildRoomRateData>): string[] {
  const problems: string[] = [];
  const priced = (s: StayKey) => d.lowestByHotel.filter((h) => h[s].price !== null);
  for (const s of STAYS) {
    if (!priced(s).some((h) => h.hotelId === SANGHYANG)) problems.push(`harga Sanghyang (${s}) tidak tampil`);
    if (priced(s).filter((h) => h.hotelId !== SANGHYANG).length < MIN_PRICED_COMPETITORS) problems.push(`pembanding ${s} kurang dari ${MIN_PRICED_COMPETITORS} hotel`);
  }
  for (const s of STAYS)
    if (!d.evidence.some((e) => e.hotelId === SANGHYANG && e.stay === s)) problems.push(`tidak ada penawaran per tipe kamar Sanghyang (${s})`);
  const ranged = (s: StayKey) => d.lowestByHotel.filter((h) => h.range[s].nights >= MIN_RANGE_NIGHTS);
  for (const s of STAYS) {
    if (!ranged(s).some((h) => h.hotelId === SANGHYANG)) problems.push(`rentang tarif Sanghyang (${s}) kurang dari ${MIN_RANGE_NIGHTS} malam`);
    if (ranged(s).filter((h) => h.hotelId !== SANGHYANG).length < MIN_PRICED_COMPETITORS)
      problems.push(`pembanding dengan rentang tarif ${s} minimal ${MIN_RANGE_NIGHTS} malam kurang dari ${MIN_PRICED_COMPETITORS} hotel`);
  }
  // Tanggal utama dihitung terpisah dari jendela; bila jendela diperpendek, tanggal itu bisa jatuh di luar jendela yang dicetak.
  const { firstCheckIn, lastCheckIn } = d.window;
  for (const h of d.lowestByHotel)
    for (const s of STAYS)
      for (const [end, label] of [["min", "termurah"], ["max", "termahal"]] as const) {
        const night = h.range[s][end].checkIn;
        if (night !== null && (night < firstCheckIn || night > lastCheckIn)) problems.push(`${h.hotelId}: tarif ${s} ${label} ${night} di luar jendela ${firstCheckIn} sampai ${lastCheckIn}`);
      }
  return problems;
}

// ---------- crawl (puppeteer) ----------

/** Untuk tiap tombol "Visit site for <provider>", naik ke leluhur terbesar yang hanya memuat tombol itu = satu baris penawaran. */
const ROWS_JS = (section: Element) => {
  const sel = "button[aria-label^='Visit site for ']";
  return [...section.querySelectorAll(sel)]
    .filter((b) => (b as HTMLElement).checkVisibility())
    .map((b) => {
      let row: Element = b;
      while (row.parentElement && row.parentElement !== section && row.parentElement.querySelectorAll(sel).length === 1) row = row.parentElement;
      // Teks per node teks, bukan innerText: di Chrome headless innerText baris ini menempel tanpa pemisah baris.
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      const parts: string[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim()) parts.push(n.textContent.trim());
      return [b.getAttribute("aria-label")!.slice("Visit site for ".length), parts.join("\n")] as [string, string];
    });
};

const bigrams = (s: string) => new Set([...s.toLowerCase()].map((_, i, a) => a.slice(i, i + 2).join("")).filter((x) => x.length === 2));
/** Kemiripan judul panel dengan nama hotel (Dice bigram); termuat utuh = 1. */
export function titleScore(title: string, names: string[]): number {
  const t = title.toLowerCase();
  return Math.max(...names.map((n) => {
    if (t.includes(n.toLowerCase()) || n.toLowerCase().includes(t)) return 1;
    const a = bigrams(t), b = bigrams(n);
    return (2 * [...a].filter((x) => b.has(x)).length) / (a.size + b.size || 1);
  }));
}
const MIN_TITLE_SCORE = 0.6;
const EXTRA_SANGHYANG_SAMPLES = 5;
const enDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Alamat halaman harga satu hotel untuk satu malam. Hanya alamat entity (dari ID tempat Google Maps) yang dipakai:
 * robots.txt google.com melarang /travel/search, jadi hotel tanpa entity tidak dicari lewat namanya.
 */
export function pricesUrl(hotelId: string, checkin: string, checkout: string): string {
  const entity = ENTITY_URL.get(hotelId);
  if (!entity) {
    throw new Error(`alamat entity Google Travel untuk ${hotelId} belum tercatat (isi mapsUrl dengan ID tempat Google Maps); pencarian /travel/search dilarang robots.txt`);
  }
  const params = new URLSearchParams({ hl: "en", gl: "id", curr: "IDR", ts: buildTs(checkin, checkout) });
  return `${entity}/prices?${params}`;
}

export type RoomOfferPageState = "offers" | "contact_property" | "sold_out" | "loading";

const ROOM_OFFER_CONTACT_RE =
  /contact this property|call or visit site for rates and availability|hubungi pihak properti ini/i;
const ROOM_OFFER_SOLD_OUT_RE =
  /available for\b|unavailable for your dates|no rooms available|sold out|tersedia untuk tanggal|tidak tersedia untuk tanggal/i;

/** Mengklasifikasikan status tab Prices Google Travel agar halaman kontak properti atau penuh selesai dalam hitungan detik. */
export function classifyRoomOfferPageState(bodyText: string, hasAllOptionsHeading: boolean): RoomOfferPageState {
  if (hasAllOptionsHeading) return "offers";
  if (ROOM_OFFER_CONTACT_RE.test(bodyText)) return "contact_property";
  if (ROOM_OFFER_SOLD_OUT_RE.test(bodyText)) return "sold_out";
  return "loading";
}

class ContactPropertyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactPropertyError";
  }
}

async function crawlSample(page: Page, hotelId: string, checkin: string, checkout: string): Promise<HotelStayCrawl> {
  const names = hotelTitleNames(hotelId);
  const url = pricesUrl(hotelId, checkin, checkout);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent?.trim() === "Prices") || document.querySelector('a[aria-label^="View prices for "]'), { timeout: 60_000 });
  const pricesTabVisible = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent?.trim() === "Prices" && (t as HTMLElement).checkVisibility()));
  if (!pricesTabVisible) {
    // Google menampilkan daftar hasil: buka kartu yang paling mirip nama hotel lewat URL-nya sendiri (membawa ts).
    const cards = await page.$$eval('a[aria-label^="View prices for "]', (els) => els.map((e) => ({ label: e.getAttribute("aria-label")!.slice("View prices for ".length), href: (e as HTMLAnchorElement).href })));
    const best = cards.map((c) => ({ ...c, score: titleScore(c.label, names) })).sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < MIN_TITLE_SCORE) throw new Error(`tidak ada kartu hasil untuk ${names[0]}: ${cards.slice(0, 5).map((c) => c.label).join(", ")}`);
    await page.goto(best.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent?.trim() === "Prices"), { timeout: 60_000 });
  }
  const headings = await page.$$eval("h1", (hs) => hs.map((h) => h.textContent?.trim() ?? "").filter((h) => !/[\d,.]+\s+results$/.test(h)));
  if (!headings.some((h) => titleScore(h, names) >= MIN_TITLE_SCORE)) throw new Error(`panel bukan ${names[0]}: ${headings.join(" | ")}`);
  const shown = await page.$$eval("input", (els) => Object.fromEntries(els.map((e) => [e.getAttribute("aria-label") ?? "", (e as HTMLInputElement).value])));
  if (shown["Check-in"] !== enDay(checkin) || shown["Check-out"] !== enDay(checkout)) throw new Error(`tanggal di layar ${shown["Check-in"]}–${shown["Check-out"]}, diminta ${enDay(checkin)}–${enDay(checkout)}`);

  // Halaman memuat beberapa salinan panel; hanya salinan yang terlihat yang dipakai.
  await page.evaluate(() => ([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === "Prices" && (t as HTMLElement).checkVisibility()) as HTMLElement).click());
  await page.waitForFunction(
    () => {
      if ([...document.querySelectorAll("h2")].some((h) => h.textContent?.trim() === "All options")) return true;
      const body = document.body.innerText || "";
      return /contact this property|call or visit site for rates and availability|available for\b|unavailable for your dates|no rooms available|sold out/i.test(body);
    },
    { timeout: 60_000 },
  );
  const pageState = await page.evaluate(() => ({
    hasAllOptions: [...document.querySelectorAll("h2")].some((h) => h.textContent?.trim() === "All options"),
    body: document.body.innerText || "",
  }));
  const state = classifyRoomOfferPageState(pageState.body, pageState.hasAllOptions);
  if (state === "contact_property") {
    throw new ContactPropertyError(`${names[0]} tidak mempublikasikan tarif OTA di Google Travel (hubungi properti)`);
  }
  if (state === "sold_out") {
    throw new Error(`tidak tersedia untuk ${names[0]} ${checkin}`);
  }
  // Bagian "All options" dicari ulang tiap kali: Google merender ulang bagian ini saat penawaran dibuka/dimuat.
  const SECTION = () => [...document.querySelectorAll("h2")].find((h) => h.textContent?.trim() === "All options" && h.checkVisibility())?.closest("section") ?? null;
  const inSection = `(${SECTION.toString()})()`;
  await page.waitForFunction(`${inSection}?.querySelector("button[aria-label^='Visit site for ']")`, { timeout: 60_000 });
  // Penawaran (sering yang lebih murah) disembunyikan di balik "View more options"; buka sampai 3 tingkat.
  const rowCount = () => page.evaluate(`(${inSection})?.querySelectorAll("button[aria-label^='Visit site for ']").length ?? 0`) as Promise<number>;
  for (let i = 0; i < 3; i++) {
    const before = await rowCount();
    const opened = await page.evaluate(`(() => { const b = [...(${inSection}?.querySelectorAll("button") ?? [])].find((x) => /^View more options/.test(x.textContent?.trim() ?? "")); b?.click(); return Boolean(b); })()`);
    if (!opened) break;
    // Tunggu penawaran tambahan muncul (batas atas, bukan jeda tetap); bila tidak bertambah, lanjut membaca.
    await page
      .waitForFunction(`(${inSection})?.querySelectorAll("button[aria-label^='Visit site for ']").length > ${before}`, { timeout: OFFER_LOAD_TIMEOUT_MS })
      .catch(() => undefined); // ZERO-FALLBACK: tidak ada penawaran tambahan; baris yang sudah tampil tetap dibaca.
  }
  const rawRows = (await page.evaluate(`(${ROWS_JS.toString()})(${inSection})`)) as [string, string][];
  const parsed = parseOfferRows(rawRows);
  if (!parsed.offers.length) throw new Error(`tidak ada harga tampil untuk ${names[0]} ${checkin}`);
  return { ...parsed, url };
}

/**
 * Sampel per hotel untuk malam lain di jendela tanggal. Daftar penawaran penyedia sudah lengkap dalam satu muat; baris
 * tipe kamar yang berganti tiap muat hanya diambil di tanggal utama. Satu sampel menjaga jumlah muat halaman job malam.
 */
export const WINDOW_SAMPLES = 1;

/** Satu muat halaman di konteks baru: status SPA Google Travel tidak boleh terbawa antar sampel. */
async function freshSample(browser: Browser, hotelId: string, checkin: string, checkout: string): Promise<HotelStayCrawl> {
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 3200 });
    return await crawlSample(page, hotelId, checkin, checkout);
  } finally {
    await ctx.close();
  }
}

/**
 * Beberapa sampel per hotel & tanggal utama: baris tipe kamar hanya muncul di blok "Featured options" yang berganti tiap
 * muat. `extraNights` = malam lain di jendela tanggal, WINDOW_SAMPLES sampel per hotel, hanya penawaran penyedia.
 */
export async function crawlRoomRates(
  dates: Record<StayKey, { checkin: string; checkout: string }>,
  samples = 3,
  hotelIds = ROOM_RATE_HOTELS,
  stays: StayKey[] = STAYS,
  extraNights: { checkin: string; checkout: string }[] = [],
): Promise<HotelCrawl[]> {
  const puppeteer = (await import("puppeteer")).default;
  const browser: Browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=en-US"] });
  const out: HotelCrawl[] = [];
  try {
    for (const hotelId of hotelIds) {
      const nights: NightOffers[] = [];
      const result: HotelCrawl = { hotelId, weekday: null, weekend: null, nights };
      const errors: string[] = [];
      let contactOnly = false;
      for (const stay of stays) {
        if (contactOnly) break;
        // Sanghyang dasar semua perbandingan: tambah sampel (maks EXTRA_SANGHYANG_SAMPLES) sampai tipe kamarnya tampil.
        const limit = hotelId === SANGHYANG ? samples + EXTRA_SANGHYANG_SAMPLES : samples;
        for (let n = 0; n < limit && (n < samples || !result[stay]?.rooms.length); n++) {
          try {
            const s = await freshSample(browser, hotelId, dates[stay].checkin, dates[stay].checkout);
            const prev = result[stay];
            result[stay] = prev ? { url: prev.url, offers: [...prev.offers, ...s.offers], rooms: [...prev.rooms, ...s.rooms] } : s;
          } catch (error) {
            errors.push(`${stay} s${n + 1}: ${(error as Error).message.slice(0, 160)}`);
            if (error instanceof ContactPropertyError) {
              contactOnly = true;
              break;
            }
          }
        }
      }
      if (!contactOnly) {
        for (const night of extraNights) {
          if (contactOnly) break;
          for (let n = 0; n < WINDOW_SAMPLES; n++) {
            try {
              nights.push({ checkin: night.checkin, offers: (await freshSample(browser, hotelId, night.checkin, night.checkout)).offers });
            } catch (error) {
              errors.push(`${night.checkin} s${n + 1}: ${(error as Error).message.slice(0, 160)}`);
              if (error instanceof ContactPropertyError) {
                contactOnly = true;
                break;
              }
            }
          }
        }
      }
      if (errors.length) result.error = errors.join("; ");
      const windowNote = extraNights.length ? `, jendela ${new Set(nights.map((x) => x.checkin)).size}/${extraNights.length} malam lain` : "";
      console.log(`[room-rates] ${hotelId}: weekday ${result.weekday?.offers.length ?? 0} penawaran/${result.weekday?.rooms.length ?? 0} kamar, weekend ${result.weekend?.offers.length ?? 0}/${result.weekend?.rooms.length ?? 0}${windowNote}${result.error ? ` (kendala: ${result.error})` : ""}`);
      out.push(result);
    }
  } finally {
    await browser.close();
  }
  return out;
}
