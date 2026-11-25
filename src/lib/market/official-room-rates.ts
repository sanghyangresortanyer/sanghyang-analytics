/**
 * Tarif kamar resmi Sanghyang dari booking engine hotel (Exely, halaman sanghyang.com/book) untuk lapisan "situs resmi"
 * Insight Pasar. Tanggal check-in hari biasa dan akhir pekan sama dengan lapisan OTA (checkInWeekday/checkInWeekend di
 * resort-room-rates.data.json), menginap 1 malam, 2 dewasa, supaya kedua lapisan bisa dibandingkan langsung.
 *
 * Widget /book dimuat dari host Exely IBE yang robots.txt-nya melarang semua perayap (diperiksa 21 Nov 2026), jadi tarif
 * dibaca lewat Exely Connect Search API, kanal metasearch milik hotel (disetujui pemilik 21 Nov 2026). Tautan hasilnya
 * (`bookingFormLink`) membuka /book pada kamar, rate plan, dan tanggal yang sama. Berkas data ditulis
 * scripts/ops/crawl-official-room-rates.ts; modul ini memvalidasinya dan gagal cepat bila isinya rusak.
 *
 * Modul ini sengaja tanpa impor khusus Node (fs, process) supaya aman diimpor dari mana pun; pengambilan jaringan dan
 * penulisan berkas ada di skrip.
 */
import { z } from "zod";
import data from "./official-room-rates.data.json";

export type StayKey = "weekday" | "weekend";
const STAYS: StayKey[] = ["weekday", "weekend"];
const STAY_LABEL: Record<StayKey, string> = { weekday: "Hari biasa", weekend: "Akhir pekan" };

/** Okupansi lapisan OTA: Google Travel tab Prices memakai bawaan 2 dewasa (dicatat `guests: 2` di syncRoomRatesWindow14ToDb). */
export const OTA_LAYER_ADULTS = 2;
/** Lama menginap lapisan OTA: tanggal utama crawl-room-rates.ts selalu satu malam (nextDay di room-offers.ts). */
export const OTA_LAYER_NIGHTS = 1;
/** Mata uang lapisan OTA (pricesUrl memakai curr=IDR); harga engine dalam mata uang lain tidak dikonversi. */
export const RATE_CURRENCY = "IDR";

/** Kode paket makan Exely yang menyatakan status sarapan secara tertulis; kode lain = belum tercatat. */
const MEAL_WITH_BREAKFAST = "BreakFast";
const MEAL_ROOM_ONLY = "RoomOnly";
/** Parameter tautan engine yang dibuang dari tautan sumber: bahasa bawaan engine (Rusia) dan atribusi kanal metasearch. */
const DROPPED_LINK_PARAM = (key: string) => key === "tl-lng" || key.startsWith("utm_");
const OFFER_LINK_PARAMS = new Set(["tl-room", "tl-offer"]);

const FILE_COMMENT = "Tarif kamar resmi dari booking engine hotel (Exely Connect Search API). Ditulis scripts/ops/crawl-official-room-rates.ts; jangan disunting tangan.";
export const OFFICIAL_RATES_SOURCE_METHOD =
  "Booking engine resmi hotel (Exely) lewat Exely Connect Search API kanal metasearch hotel: harga per malam termasuk pajak, rate plan termurah per tipe kamar, tanpa diskon member";

// ---------- jawaban Exely Connect (hanya kolom yang dipakai divalidasi; kolom lain diabaikan) ----------

const exelyRoomStay = z.object({
  roomType: z.object({ id: z.string().min(1) }),
  ratePlan: z.object({ id: z.string().min(1) }),
  guestCount: z.object({ adultCount: z.number().int(), childAges: z.array(z.number().int()).nullable() }),
  stayDates: z.object({ arrivalDateTime: z.string().min(10), departureDateTime: z.string().min(10) }),
  availability: z.number().int(),
  currencyCode: z.string().min(1),
  total: z.object({ priceBeforeTax: z.number(), taxAmount: z.number() }),
  includedServices: z.array(z.object({ id: z.string(), mealPlanCode: z.string().nullable() })).nullable(),
  mealPlanCode: z.string().nullable(),
  bookingFormLink: z.url(),
});
export const exelyRoomStaysSchema = z.object({ roomStays: z.array(exelyRoomStay) });
export type ExelyRoomStays = z.infer<typeof exelyRoomStaysSchema>;

export const exelyPropertyContentSchema = z.object({
  name: z.string().min(1),
  roomTypes: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  ratePlans: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
});
export type ExelyPropertyContent = z.infer<typeof exelyPropertyContentSchema>;

export const exelyTokenSchema = z.object({ access_token: z.string().min(1), token_type: z.string().regex(/^bearer$/i) });

// ---------- kredensial (hanya nama variabel yang pernah disebut di pesan galat, nilainya tidak) ----------

const EXELY_ENV_KEYS = ["EXELY_API_BASE_URL", "EXELY_CLIENT_ID", "EXELY_CLIENT_SECRET", "EXELY_PROPERTY_ID"] as const;
const exelyEnvSchema = z.object({
  EXELY_API_BASE_URL: z.url({ protocol: /^https$/ }),
  EXELY_CLIENT_ID: z.string().trim().min(1),
  EXELY_CLIENT_SECRET: z.string().trim().min(1),
  EXELY_PROPERTY_ID: z.string().regex(/^\d+$/),
});

export interface ExelyConfig {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  propertyId: string;
}

export class ExelyCredentialsMissingError extends Error {
  constructor(readonly invalidKeys: string[]) {
    super(
      `kredensial Exely belum dipasang: ${invalidKeys.join(", ")} kosong atau tidak sah. Pemilik mengisinya di .env.development.local ` +
        "(lokal) atau GitHub Secrets dengan nama yang sama (jadwal malam).",
    );
    this.name = "ExelyCredentialsMissingError";
  }
}

/** Kredensial Exely dari env, divalidasi; galat hanya menyebut nama variabel yang kosong atau salah bentuk. */
export function exelyConfigFromEnv(env: Readonly<Record<string, string | undefined>>): ExelyConfig {
  const picked = Object.fromEntries(EXELY_ENV_KEYS.map((key) => [key, env[key]]));
  const parsed = exelyEnvSchema.safeParse(picked);
  if (!parsed.success) throw new ExelyCredentialsMissingError([...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]);
  return {
    apiBaseUrl: parsed.data.EXELY_API_BASE_URL.replace(/\/+$/, ""),
    clientId: parsed.data.EXELY_CLIENT_ID.trim(),
    clientSecret: parsed.data.EXELY_CLIENT_SECRET.trim(),
    propertyId: parsed.data.EXELY_PROPERTY_ID,
  };
}

// ---------- aturan murni: penawaran engine -> tarif per tipe kamar ----------

export interface StayRequest {
  checkIn: string;
  checkOut: string;
  adults: number;
}

export interface EngineOffer {
  engineRoomTypeId: string;
  ratePlanId: string;
  ratePlan: string;
  price: number;
  breakfastIncluded: boolean | null;
  mealPlanCode: string | null;
  roomsLeft: number;
  bookingFormLink: string;
}

export interface SkippedOffer {
  checkIn: string;
  engineRoomTypeId: string;
  ratePlanId: string;
  reason: string;
}

/** Sarapan hanya dari yang tertulis di penawaran: paket makan BreakFast atau layanan sarapan yang termasuk = ya, RoomOnly = tidak. */
export function breakfastFromMealPlan(mealPlanCode: string | null, includedMealPlanCodes: readonly (string | null)[]): boolean | null {
  if (mealPlanCode === MEAL_WITH_BREAKFAST || includedMealPlanCodes.includes(MEAL_WITH_BREAKFAST)) return true;
  if (mealPlanCode === MEAL_ROOM_ONLY) return false;
  return null;
}

/**
 * Penawaran Search API untuk satu malam. Mata uang atau okupansi yang berbeda dari permintaan = jawaban tidak sesuai
 * kontrak (galat). Penawaran untuk malam lain (mis. paket beberapa jam) tidak dibandingkan dan dicatat sebagai dilewati.
 */
export function engineOffers(response: ExelyRoomStays, content: ExelyPropertyContent, stay: StayRequest): { offers: EngineOffer[]; skipped: SkippedOffer[] } {
  const planName = new Map(content.ratePlans.map((plan) => [plan.id, plan.name]));
  const offers: EngineOffer[] = [];
  const skipped: SkippedOffer[] = [];
  for (const rs of response.roomStays) {
    const ref = { checkIn: stay.checkIn, engineRoomTypeId: rs.roomType.id, ratePlanId: rs.ratePlan.id };
    if (rs.currencyCode !== RATE_CURRENCY) throw new Error(`penawaran ${rs.roomType.id}/${rs.ratePlan.id} dalam ${rs.currencyCode}, lapisan OTA memakai ${RATE_CURRENCY}`);
    const children = rs.guestCount.childAges ?? [];
    if (rs.guestCount.adultCount !== stay.adults || children.length) {
      throw new Error(`penawaran ${rs.roomType.id}/${rs.ratePlan.id} untuk ${rs.guestCount.adultCount} dewasa dan ${children.length} anak, diminta ${stay.adults} dewasa`);
    }
    const arrival = rs.stayDates.arrivalDateTime.slice(0, 10);
    const departure = rs.stayDates.departureDateTime.slice(0, 10);
    if (arrival !== stay.checkIn || departure !== stay.checkOut) {
      skipped.push({ ...ref, reason: `penawaran untuk ${arrival} sampai ${departure}, bukan malam ${stay.checkIn} sampai ${stay.checkOut}` });
      continue;
    }
    if (rs.availability < 1) {
      skipped.push({ ...ref, reason: "sisa kamar 0" });
      continue;
    }
    const ratePlan = planName.get(rs.ratePlan.id);
    if (!ratePlan) throw new Error(`rate plan ${rs.ratePlan.id} tidak ada di Content API properti ${content.name}`);
    // Rupiah tanpa sen; total = harga sebelum pajak + pajak, sama dengan lapisan OTA yang sudah termasuk pajak.
    const price = Math.round(rs.total.priceBeforeTax + rs.total.taxAmount);
    if (!(price > 0)) throw new Error(`harga penawaran ${rs.roomType.id}/${rs.ratePlan.id} tidak sah: ${price}`);
    offers.push({
      engineRoomTypeId: rs.roomType.id,
      ratePlanId: rs.ratePlan.id,
      ratePlan,
      price,
      breakfastIncluded: breakfastFromMealPlan(rs.mealPlanCode, (rs.includedServices ?? []).map((s) => s.mealPlanCode)),
      mealPlanCode: rs.mealPlanCode,
      roomsLeft: rs.availability,
      bookingFormLink: rs.bookingFormLink,
    });
  }
  return { offers, skipped };
}

/** Penawaran termurah; harga sama diurutkan menurut ID rate plan supaya hasilnya tetap antar run. */
export function cheapestOffer(offers: readonly EngineOffer[]): EngineOffer | null {
  return offers.reduce<EngineOffer | null>(
    (best, o) => (best === null || o.price < best.price || (o.price === best.price && o.ratePlanId < best.ratePlanId) ? o : best),
    null,
  );
}

export interface RoomMapping {
  mapped: { engineRoomTypeId: string; engineRoomName: string; roomName: string }[];
  unmapped: { engineRoomTypeId: string; engineRoomName: string; reason: string }[];
  catalogWithoutEngine: string[];
}

/**
 * Nama kamar engine -> nama kamar katalog (hotel-room-types.data.json): nama persis, atau alias eksplisit. Kamar yang
 * tidak cocok dilaporkan, tidak ditebak. Alias ke nama di luar katalog, atau dua kamar engine ke satu nama, adalah galat.
 */
export function mapEngineRooms(
  engineRooms: readonly { id: string; name: string }[],
  catalogNames: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): RoomMapping {
  const catalog = new Set(catalogNames);
  for (const [from, to] of Object.entries(aliases)) {
    if (!catalog.has(to)) throw new Error(`alias kamar "${from}" menunjuk "${to}" yang tidak ada di katalog kamar`);
  }
  const mapping: RoomMapping = { mapped: [], unmapped: [], catalogWithoutEngine: [] };
  const claimedBy = new Map<string, string>();
  for (const room of engineRooms) {
    const name = room.name.trim();
    const roomName = catalog.has(name) ? name : aliases[name];
    if (!roomName) {
      mapping.unmapped.push({ engineRoomTypeId: room.id, engineRoomName: name, reason: "nama kamar engine tidak ada di katalog hotel-room-types.data.json dan tidak punya alias" });
      continue;
    }
    const other = claimedBy.get(roomName);
    if (other) throw new Error(`kamar engine "${other}" dan "${name}" sama-sama dipetakan ke "${roomName}"`);
    claimedBy.set(roomName, name);
    mapping.mapped.push({ engineRoomTypeId: room.id, engineRoomName: name, roomName });
  }
  mapping.catalogWithoutEngine = catalogNames.filter((name) => !claimedBy.has(name));
  return mapping;
}

/**
 * Tautan engine dipindah ke halaman booking yang dituju pengalihannya (/book), dengan parameter kamar, tarif, tanggal,
 * dan okupansi yang sama. `dateOnly` membuang kamar dan rate plan (untuk kamar yang tidak ditawarkan pada tanggal itu).
 */
export function bookDeepLink(bookingFormLink: string, bookPageUrl: string, dateOnly = false): string {
  const link = new URL(bookingFormLink);
  const page = new URL(bookPageUrl);
  for (const key of [...new Set(link.searchParams.keys())]) {
    if (DROPPED_LINK_PARAM(key) || (dateOnly && OFFER_LINK_PARAMS.has(key))) link.searchParams.delete(key);
  }
  return `${page.origin}${page.pathname}?${link.searchParams}`;
}

// ---------- berkas data ----------

const isoDate = z.iso.date();
const stayRateSchema = z.object({
  checkIn: isoDate,
  checkOut: isoDate,
  price: z.number().int().positive().nullable(),
  breakfastIncluded: z.boolean().nullable(),
  ratePlan: z.string().min(1).nullable(),
  ratePlanId: z.string().min(1).nullable(),
  mealPlanCode: z.string().min(1).nullable(),
  roomsLeft: z.number().int().nonnegative().nullable(),
  unavailableReason: z.string().min(1).nullable(),
  sourceUrl: z.url(),
});
const roomSchema = z.object({
  roomName: z.string().min(1),
  engineRoomName: z.string().min(1),
  engineRoomTypeId: z.string().min(1),
  weekday: stayRateSchema,
  weekend: stayRateSchema,
});
const hotelSchema = z.object({
  hotelId: z.string().min(1),
  engineProperty: z.string().min(1),
  rooms: z.array(roomSchema),
  unmappedEngineRooms: z.array(z.object({ engineRoomTypeId: z.string().min(1), engineRoomName: z.string().min(1), reason: z.string().min(1) })),
  catalogRoomsWithoutEngineRoom: z.array(z.string().min(1)),
  skippedOffers: z.array(z.object({ checkIn: isoDate, engineRoomTypeId: z.string().min(1), ratePlanId: z.string().min(1), reason: z.string().min(1) })),
});
const requestSchema = z.object({
  api: z.string().min(1),
  contentPath: z.string().min(1),
  searchPath: z.string().min(1),
  adults: z.number().int().positive(),
  childAges: z.array(z.number().int()),
  nights: z.number().int().positive(),
  checkInWeekday: isoDate,
  checkInWeekend: isoDate,
  datesFrom: z.string().min(1),
});
export const officialRoomRatesFileSchema = z.object({
  $comment: z.string().min(1),
  status: z.enum(["terbaca", "belum ada data"]),
  reason: z.string().min(1).nullable(),
  sourceLabel: z.string().min(1),
  sourceMethod: z.string().min(1),
  bookUrl: z.url().nullable(),
  observedAt: z.iso.datetime().nullable(),
  request: requestSchema.nullable(),
  hotels: z.array(hotelSchema),
});
export type OfficialRoomRatesFile = z.infer<typeof officialRoomRatesFileSchema>;
export type OfficialStayRate = z.infer<typeof stayRateSchema>;
type OfficialHotel = z.infer<typeof hotelSchema>;
type OfficialRoom = z.infer<typeof roomSchema>;

/** Keterkaitan antarkolom yang tidak bisa dinyatakan per kolom; tiap butir = satu pelanggaran. */
function invariantProblems(file: OfficialRoomRatesFile): string[] {
  const problems: string[] = [];
  if (file.status === "belum ada data") {
    if (!file.reason) problems.push("status 'belum ada data' tanpa alasan");
    if (file.observedAt || file.request || file.bookUrl || file.hotels.length) problems.push("status 'belum ada data' tidak boleh memuat waktu baca, permintaan, tautan booking, atau tarif");
    return problems;
  }
  if (file.reason) problems.push("status 'terbaca' tidak boleh memuat alasan belum ada data");
  if (!file.observedAt || !file.request || !file.bookUrl) problems.push("status 'terbaca' wajib memuat observedAt, request, dan bookUrl");
  if (!file.hotels.length) problems.push("status 'terbaca' tanpa hotel");
  for (const hotel of file.hotels) {
    const names = hotel.rooms.map((r) => r.roomName);
    if (new Set(names).size !== names.length) problems.push(`${hotel.hotelId}: nama kamar katalog ganda`);
    for (const room of hotel.rooms)
      for (const s of STAYS) {
        const stay = room[s];
        const expected = s === "weekday" ? file.request?.checkInWeekday : file.request?.checkInWeekend;
        if (stay.checkIn !== expected) problems.push(`${hotel.hotelId}/${room.roomName}: check-in ${s} ${stay.checkIn}, permintaan ${expected}`);
        if ((stay.price === null) === (stay.unavailableReason === null)) problems.push(`${hotel.hotelId}/${room.roomName}: ${s} harus berisi harga atau alasan tidak tersedia, tidak keduanya`);
        if (stay.price !== null && (!stay.ratePlan || !stay.ratePlanId)) problems.push(`${hotel.hotelId}/${room.roomName}: harga ${s} tanpa rate plan`);
      }
  }
  return problems;
}

/** Validasi berkas data; galat menyebut kolom yang rusak supaya data rusak tidak pernah tampil. */
export function parseOfficialRoomRatesFile(raw: unknown): OfficialRoomRatesFile {
  const parsed = officialRoomRatesFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(akar)"}: ${issue.message}`);
    throw new Error(`official-room-rates.data.json tidak sah: ${issues.slice(0, 8).join("; ")}`);
  }
  const problems = invariantProblems(parsed.data);
  if (problems.length) throw new Error(`official-room-rates.data.json tidak sah: ${problems.slice(0, 8).join("; ")}`);
  return parsed.data;
}

/** Isi berkas saat tarif resmi belum bisa dibaca; tanpa waktu supaya penulisan ulang tidak membuat commit baru. */
export function pendingOfficialRoomRatesFile(reason: string, sourceLabel: string): OfficialRoomRatesFile {
  return parseOfficialRoomRatesFile({
    $comment: FILE_COMMENT,
    status: "belum ada data",
    reason,
    sourceLabel,
    sourceMethod: OFFICIAL_RATES_SOURCE_METHOD,
    bookUrl: null,
    observedAt: null,
    request: null,
    hotels: [],
  });
}

export interface OfficialCrawlInput {
  hotelId: string;
  catalogRoomNames: readonly string[];
  aliases?: Readonly<Record<string, string>>;
  content: ExelyPropertyContent;
  stays: Record<StayKey, StayRequest & { response: ExelyRoomStays }>;
  /** Halaman booking tujuan pengalihan `bookingFormLink` (mis. https://sanghyang.com/book). */
  bookPageUrl: string;
  observedAt: Date;
  request: { api: string; contentPath: string; searchPath: string; datesFrom: string };
}

/** Jawaban engine untuk kedua tanggal -> isi official-room-rates.data.json. */
export function buildOfficialRoomRatesFile(input: OfficialCrawlInput): OfficialRoomRatesFile {
  const mapping = mapEngineRooms(input.content.roomTypes, input.catalogRoomNames, input.aliases);
  if (input.stays.weekend.adults !== input.stays.weekday.adults) throw new Error("okupansi hari biasa dan akhir pekan berbeda");
  const read = (s: StayKey) => ({ stay: input.stays[s] as StayRequest, ...engineOffers(input.stays[s].response, input.content, input.stays[s]) });
  const perStay: Record<StayKey, { stay: StayRequest; offers: EngineOffer[]; skipped: SkippedOffer[] }> = { weekday: read("weekday"), weekend: read("weekend") };

  const stayRate = (s: StayKey, engineRoomTypeId: string): OfficialStayRate => {
    const { stay, offers } = perStay[s];
    const best = cheapestOffer(offers.filter((o) => o.engineRoomTypeId === engineRoomTypeId));
    if (best) {
      return {
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        price: best.price,
        breakfastIncluded: best.breakfastIncluded,
        ratePlan: best.ratePlan,
        ratePlanId: best.ratePlanId,
        mealPlanCode: best.mealPlanCode,
        roomsLeft: best.roomsLeft,
        unavailableReason: null,
        sourceUrl: bookDeepLink(best.bookingFormLink, input.bookPageUrl),
      };
    }
    const anyOffer = offers[0];
    return {
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      price: null,
      breakfastIncluded: null,
      ratePlan: null,
      ratePlanId: null,
      mealPlanCode: null,
      roomsLeft: null,
      unavailableReason: `Tidak ditawarkan booking engine untuk check-in ${stay.checkIn}, ${OTA_LAYER_NIGHTS} malam, ${stay.adults} dewasa (kamar habis atau tidak dijual untuk tanggal itu)`,
      sourceUrl: anyOffer ? bookDeepLink(anyOffer.bookingFormLink, input.bookPageUrl, true) : input.bookPageUrl,
    };
  };

  const page = new URL(input.bookPageUrl);
  const hotel: OfficialHotel = {
    hotelId: input.hotelId,
    engineProperty: input.content.name,
    rooms: mapping.mapped.map((m) => ({ ...m, weekday: stayRate("weekday", m.engineRoomTypeId), weekend: stayRate("weekend", m.engineRoomTypeId) })),
    unmappedEngineRooms: mapping.unmapped,
    catalogRoomsWithoutEngineRoom: mapping.catalogWithoutEngine,
    skippedOffers: STAYS.flatMap((s) => perStay[s].skipped),
  };
  return parseOfficialRoomRatesFile({
    $comment: FILE_COMMENT,
    status: "terbaca",
    reason: null,
    sourceLabel: `Situs resmi ${page.hostname.replace(/^www\./, "")}${page.pathname}`,
    sourceMethod: OFFICIAL_RATES_SOURCE_METHOD,
    bookUrl: `${page.origin}${page.pathname}`,
    observedAt: input.observedAt.toISOString(),
    request: {
      ...input.request,
      adults: input.stays.weekday.adults,
      childAges: [],
      nights: OTA_LAYER_NIGHTS,
      checkInWeekday: input.stays.weekday.checkIn,
      checkInWeekend: input.stays.weekend.checkIn,
    },
    hotels: [hotel],
  });
}

/**
 * Data baru hanya dipakai bila bermakna: setiap hotel punya kamar yang terpetakan dan minimal satu harga di salah satu
 * tanggal. Engine yang tidak menawarkan satu kamar pun di kedua tanggal lebih mungkin kanal tertutup daripada penuh.
 */
export function validateOfficialRoomRates(file: OfficialRoomRatesFile): string[] {
  if (file.status !== "terbaca") return [`status ${file.status}`];
  const problems: string[] = [];
  for (const hotel of file.hotels) {
    if (!hotel.rooms.length) problems.push(`${hotel.hotelId}: tidak ada kamar engine yang terpetakan ke katalog`);
    else if (!hotel.rooms.some((r) => r.weekday.price !== null || r.weekend.price !== null)) {
      problems.push(`${hotel.hotelId}: booking engine tidak menawarkan satu kamar pun untuk ${file.request?.checkInWeekday} maupun ${file.request?.checkInWeekend}`);
    }
  }
  return problems;
}

// ---------- kontrak baca untuk lapisan "situs resmi" ----------

export interface OfficialRoomRate {
  hotelId: string;
  /** Nama kamar di hotel-room-types.data.json. */
  roomName: string;
  engineRoomName: string;
  /** Rupiah per malam termasuk pajak, rate plan termurah; null bila tidak ditawarkan pada tanggal itu. */
  weekdayPrice: number | null;
  weekendPrice: number | null;
  checkInWeekday: string;
  checkInWeekend: string;
  /** Sama di semua tanggal yang berharga; null bila berbeda antar tanggal atau tidak tertulis. */
  breakfastIncluded: boolean | null;
  /** Nama rate plan termurah; bila berbeda antar tanggal: "Hari biasa: X · Akhir pekan: Y". */
  ratePlan: string | null;
  sourceLabel: string;
  /** Tautan /book untuk tanggal hari biasa (akhir pekan bila hari biasa tidak berharga). */
  sourceUrl: string;
  observedAt: string;
  weekday: OfficialStayRate;
  weekend: OfficialStayRate;
}

export interface OfficialRoomRatesSource {
  status: OfficialRoomRatesFile["status"];
  reason: string | null;
  sourceLabel: string;
  bookUrl: string | null;
  observedAt: string | null;
  checkInWeekday: string | null;
  checkInWeekend: string | null;
}

function agreed<T>(values: T[]): T | null {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

function toOfficialRoomRate(file: OfficialRoomRatesFile, hotel: OfficialHotel, room: OfficialRoom): OfficialRoomRate {
  const priced = STAYS.filter((s) => room[s].price !== null);
  const plans = priced.map((s) => room[s].ratePlan as string);
  const ratePlan = agreed(plans) ?? (plans.length ? priced.map((s) => `${STAY_LABEL[s]}: ${room[s].ratePlan}`).join(" · ") : null);
  return {
    hotelId: hotel.hotelId,
    roomName: room.roomName,
    engineRoomName: room.engineRoomName,
    weekdayPrice: room.weekday.price,
    weekendPrice: room.weekend.price,
    checkInWeekday: room.weekday.checkIn,
    checkInWeekend: room.weekend.checkIn,
    breakfastIncluded: agreed(priced.map((s) => room[s].breakfastIncluded)),
    ratePlan,
    sourceLabel: file.sourceLabel,
    sourceUrl: room[priced[0] ?? "weekday"].sourceUrl,
    observedAt: file.observedAt as string,
    weekday: room.weekday,
    weekend: room.weekend,
  };
}

/** Tarif resmi per tipe kamar dari berkas yang sudah divalidasi (bukan berkas modul); dipakai tes dan skrip. */
export function officialRoomRatesOf(file: OfficialRoomRatesFile, hotelId: string): OfficialRoomRate[] {
  if (file.status !== "terbaca") return [];
  const hotel = file.hotels.find((h) => h.hotelId === hotelId);
  return hotel ? hotel.rooms.map((room) => toOfficialRoomRate(file, hotel, room)) : [];
}

export function officialRoomRatesSourceOf(file: OfficialRoomRatesFile): OfficialRoomRatesSource {
  return {
    status: file.status,
    reason: file.reason,
    sourceLabel: file.sourceLabel,
    bookUrl: file.bookUrl,
    observedAt: file.observedAt,
    checkInWeekday: file.request?.checkInWeekday ?? null,
    checkInWeekend: file.request?.checkInWeekend ?? null,
  };
}

let loaded: OfficialRoomRatesFile | undefined;
/** Berkas data repo, divalidasi sekali saat pertama dipakai; berkas rusak = galat, bukan tampilan kosong. */
export function loadOfficialRoomRates(): OfficialRoomRatesFile {
  loaded ??= parseOfficialRoomRatesFile(data);
  return loaded;
}

/** Tarif resmi per tipe kamar satu hotel; [] selama status "belum ada data" atau hotel tidak dibaca. */
export function officialRoomRatesFor(hotelId: string): OfficialRoomRate[] {
  return officialRoomRatesOf(loadOfficialRoomRates(), hotelId);
}

/** Status, alasan, label, dan tanggal lapisan resmi untuk tampilan (termasuk saat belum ada data). */
export function officialRoomRatesSource(): OfficialRoomRatesSource {
  return officialRoomRatesSourceOf(loadOfficialRoomRates());
}
