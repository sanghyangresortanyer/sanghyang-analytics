/**
 * Pembaruan tarif kamar resmi Sanghyang dari booking engine hotel (Exely) untuk tanggal check-in hari biasa dan akhir
 * pekan lapisan OTA (checkInWeekday/checkInWeekend di lib/market/resort-room-rates.data.json), 1 malam, 2 dewasa, lalu
 * tulis lib/market/official-room-rates.data.json. Berkas hanya ditimpa bila data lolos validasi; bila tidak, data lama
 * dipakai. Dipanggil CLI scripts/ops/crawl-official-room-rates.ts (job GitHub "room-rates") dan langkah tarif
 * "Perbarui Semua Data" (lib/market/full-refresh.ts) setelah resort-room-rates.data.json berganti tanggal.
 *
 * Sumber: Exely Connect Search API, kanal metasearch milik hotel (disetujui pemilik 21 Nov 2026). Widget /book dimuat dari
 * host Exely IBE yang robots.txt-nya melarang semua perayap, jadi widget tidak dirayapi. Kredensial EXELY_* hanya dibaca
 * dari env dan token akses hanya di memori; keduanya tidak pernah dicetak atau ditulis.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import path from "node:path";
import { z } from "zod";
import { isCrawlAllowed, PROFILE_CRAWLER_UA } from "./official-pages";
import { SANGHYANG_HOTEL_ID } from "./resort-room-rates";
import { stayOf } from "./room-offers";
import {
  buildOfficialRoomRatesFile,
  ExelyCredentialsMissingError,
  exelyConfigFromEnv,
  exelyPropertyContentSchema,
  exelyRoomStaysSchema,
  exelyTokenSchema,
  OTA_LAYER_ADULTS,
  OTA_LAYER_NIGHTS,
  officialRoomRatesOf,
  parseOfficialRoomRatesFile,
  pendingOfficialRoomRatesFile,
  validateOfficialRoomRates,
  type ExelyConfig,
  type OfficialRoomRatesFile,
  type StayKey,
  type StayRequest,
} from "./official-room-rates";

const OTA_RATES_PATH = path.resolve(process.cwd(), "src/lib/market/resort-room-rates.data.json");
const ROOM_TYPES_PATH = path.resolve(process.cwd(), "src/lib/market/hotel-room-types.data.json");
const OUT = path.resolve(process.cwd(), "src/lib/market/official-room-rates.data.json");
/** Booking engine ini milik Sanghyang sendiri. */
const OWN_HOTEL_ID = SANGHYANG_HOTEL_ID;
/** Belum ada alias: ketujuh nama tipe kamar Content API sama persis dengan katalog (fixture 13 Okt 2026). */
const ENGINE_ROOM_ALIASES: Readonly<Record<string, string>> = {};
/** Batas atas satu permintaan (bukan jeda); Exely biasanya menjawab dalam 1-2 detik. */
const REQUEST_TIMEOUT_MS = 30_000;
/** bookingFormLink -> /book diamati 21 Nov 2026 lewat dua pengalihan (308 lalu 301). */
const MAX_REDIRECTS = 5;
/**
 * Sambungan TCP ke host Exely dari mesin kerja lokal diukur sekitar 240 ms (curl, 21 Nov 2026), sedangkan Node memindah
 * percobaan ke keluarga alamat berikutnya setelah 250 ms. Resolver lokal (DNS64) juga memberi alamat IPv6 NAT64 yang tidak
 * tersambung, sehingga fetch berakhir ETIMEDOUT. Batas percobaan ini hanya menunda pindah keluarga alamat; sambungan yang
 * cepat tidak berubah.
 */
const CONNECT_ATTEMPT_MS = 2_000;
const PENDING_SOURCE_LABEL = "Situs resmi (booking engine hotel)";
const PENDING_REASON =
  "Akses API resmi Exely untuk booking engine hotel belum dipasang, jadi tarif resmi belum dibaca. Halaman /book tidak dibaca otomatis karena host Exely melarang perayap di robots.txt (diperiksa 21 Nov 2026).";
const CONTENT_PATH = "/api/content/v1/properties/{EXELY_PROPERTY_ID}?languageCode=en";
const SEARCH_PATH = "/api/search/v1/properties/{EXELY_PROPERTY_ID}/room-stays";

const log = (message: string) => console.log(`[tarif-resmi] ${message}`);
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

const otaDatesSchema = z.object({ capturedAt: z.string().min(1), checkInWeekday: z.iso.date(), checkInWeekend: z.iso.date() });

const nextDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + OTA_LAYER_NIGHTS)).toISOString().slice(0, 10);
};

/**
 * Tanggal menginap lapisan OTA dari isi resort-room-rates.data.json. Tanggal tidak dihitung ulang di sini supaya selalu
 * sama dengan pilihan crawl-room-rates.ts (yang bisa bergeser dari Selasa ke Rabu atau Kamis).
 */
export function otaStayDates(raw: unknown, todayWib: string): { capturedAt: string } & Record<StayKey, StayRequest> {
  const parsed = otaDatesSchema.safeParse(raw);
  if (!parsed.success) throw new Error("resort-room-rates.data.json tidak memuat capturedAt, checkInWeekday, dan checkInWeekend yang sah");
  const { capturedAt, checkInWeekday, checkInWeekend } = parsed.data;
  if (stayOf(checkInWeekday) !== "weekday") throw new Error(`checkInWeekday ${checkInWeekday} bukan malam hari biasa`);
  if (stayOf(checkInWeekend) !== "weekend") throw new Error(`checkInWeekend ${checkInWeekend} bukan malam akhir pekan`);
  for (const checkIn of [checkInWeekday, checkInWeekend]) {
    if (checkIn < todayWib) throw new Error(`tanggal check-in lapisan OTA ${checkIn} sudah lewat (hari ini ${todayWib} WIB); jalankan crawl-room-rates.ts dulu`);
  }
  const stay = (checkIn: string): StayRequest => ({ checkIn, checkOut: nextDate(checkIn), adults: OTA_LAYER_ADULTS });
  return { capturedAt, weekday: stay(checkInWeekday), weekend: stay(checkInWeekend) };
}

/** Galat jaringan dengan nama langkah dan kode sebabnya (mis. ETIMEDOUT); URL kueri dan header tidak ikut dicetak. */
function networkError(operation: string, error: unknown): Error {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  return new Error(`${operation}: ${(error as Error).message}${cause ? ` (${cause.code ?? cause.message})` : ""}`);
}

async function assertRobotsAllow(url: URL, operation: string): Promise<void> {
  let allowed: boolean;
  try {
    allowed = await isCrawlAllowed(url.href);
  } catch (error) {
    throw networkError(`robots.txt ${url.host}`, error);
  }
  if (!allowed) throw new Error(`robots.txt ${url.host} melarang ${url.pathname}; ${operation} dihentikan`);
}

async function request(url: URL, init: RequestInit, operation: string): Promise<Response> {
  await assertRobotsAllow(url, operation);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "User-Agent": PROFILE_CRAWLER_UA, Accept: "application/json", ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(operation, error);
  }
  if (response.ok || (init.redirect === "manual" && response.status >= 300 && response.status < 400)) return response;
  const retryAfter = response.headers.get("retry-after");
  const quota = response.status === 429 ? ` (batas kuota Exely, coba lagi setelah ${retryAfter ?? "?"} detik)` : "";
  throw new Error(`${operation}: HTTP ${response.status}${quota}`);
}

async function readJson<T>(response: Response, schema: z.ZodType<T>, operation: string): Promise<T> {
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${operation}: bentuk jawaban berubah (${[...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(akar)"))].join(", ")})`);
  return parsed.data;
}

/** Token client credentials Exely; hanya disimpan di variabel pemanggil. */
async function accessToken(config: ExelyConfig): Promise<string> {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: config.clientId, client_secret: config.clientSecret });
  const response = await request(
    new URL(`${config.apiBaseUrl}/auth/token`),
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    "token Exely",
  );
  return (await readJson(response, exelyTokenSchema, "token Exely")).access_token;
}

async function exelyGet<T>(config: ExelyConfig, token: string, pathAndQuery: string, schema: z.ZodType<T>, operation: string): Promise<T> {
  const response = await request(new URL(`${config.apiBaseUrl}${pathAndQuery}`), { headers: { Authorization: `Bearer ${token}` } }, operation);
  return readJson(response, schema, operation);
}

/** Halaman booking yang dituju bookingFormLink (situs hotel), diikuti per pengalihan supaya robots.txt tiap alamat dicek. */
async function resolveBookPage(bookingFormLink: string): Promise<string> {
  let url = new URL(bookingFormLink);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await request(url, { method: "HEAD", redirect: "manual" }, "halaman booking situs resmi");
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return `${url.origin}${url.pathname}`;
    const next = new URL(location, url);
    if (next.hostname !== url.hostname) throw new Error(`bookingFormLink dialihkan ke host lain (${next.hostname})`);
    url = next;
  }
  throw new Error(`bookingFormLink dialihkan lebih dari ${MAX_REDIRECTS} kali`);
}

function currentFile(): OfficialRoomRatesFile | null {
  return existsSync(OUT) ? parseOfficialRoomRatesFile(JSON.parse(readFileSync(OUT, "utf8"))) : null;
}

const writeFile = (file: OfficialRoomRatesFile) => writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`, "utf8");

export interface OfficialRoomRatesRefresh {
  /** true bila official-room-rates.data.json ditimpa dengan hasil baru. */
  written: boolean;
  file: OfficialRoomRatesFile;
  /** Alasan data baru tidak dipakai (berkas lama dipertahankan); kosong bila lolos. */
  problems: string[];
}

/**
 * Baca tarif resmi untuk tanggal lapisan OTA dan tulis berkas data. Kredensial kosong = ExelyCredentialsMissingError;
 * berkas yang belum pernah terbaca ditulis berstatus "belum ada data" beserta alasannya, data terbaca tidak disentuh.
 */
export async function refreshOfficialRoomRates(options: { dry?: boolean; now?: Date; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<OfficialRoomRatesRefresh> {
  const now = options.now ?? new Date();
  const todayWib = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const dates = otaStayDates(JSON.parse(readFileSync(OTA_RATES_PATH, "utf8")), todayWib);
  log(`tanggal dari resort-room-rates.data.json (capturedAt ${dates.capturedAt}): hari biasa ${dates.weekday.checkIn}, akhir pekan ${dates.weekend.checkIn}; ${OTA_LAYER_NIGHTS} malam, ${OTA_LAYER_ADULTS} dewasa`);

  let config: ExelyConfig;
  try {
    config = exelyConfigFromEnv(options.env ?? process.env);
  } catch (error) {
    if (error instanceof ExelyCredentialsMissingError && !options.dry && currentFile()?.status !== "terbaca") {
      writeFile(pendingOfficialRoomRatesFile(PENDING_REASON, PENDING_SOURCE_LABEL));
    }
    throw error;
  }

  const catalogHotel = (JSON.parse(readFileSync(ROOM_TYPES_PATH, "utf8")) as { hotels: { hotelId: string; name: string; roomTypes: { name: string }[] }[] }).hotels.find(
    (h) => h.hotelId === OWN_HOTEL_ID,
  );
  if (!catalogHotel) throw new Error(`hotel ${OWN_HOTEL_ID} tidak ada di hotel-room-types.data.json`);

  if (getDefaultAutoSelectFamilyAttemptTimeout() < CONNECT_ATTEMPT_MS) setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS);
  const token = await accessToken(config);
  const content = await exelyGet(config, token, `/api/content/v1/properties/${config.propertyId}?languageCode=en`, exelyPropertyContentSchema, "Content API properti");
  // Properti engine harus hotel katalog yang sama; ID properti salah di env tidak boleh menulis tarif hotel lain.
  if (content.name.trim() !== catalogHotel.name) throw new Error(`properti engine "${content.name}" bukan ${catalogHotel.name}; periksa EXELY_PROPERTY_ID`);
  log(`properti engine "${content.name}": ${content.roomTypes.length} tipe kamar, ${content.ratePlans.length} rate plan`);

  const search = async (stay: StayRequest) => {
    const query = new URLSearchParams({ arrivalDate: stay.checkIn, departureDate: stay.checkOut, adults: String(stay.adults) });
    const response = await exelyGet(config, token, `/api/search/v1/properties/${config.propertyId}/room-stays?${query}`, exelyRoomStaysSchema, `Search API ${stay.checkIn}`);
    log(`Search API ${stay.checkIn} sampai ${stay.checkOut}: ${response.roomStays.length} penawaran`);
    return response;
  };
  const weekday = await search(dates.weekday);
  const weekend = await search(dates.weekend);
  const anyLink = [...weekday.roomStays, ...weekend.roomStays][0]?.bookingFormLink;
  if (!anyLink) throw new Error(`booking engine tidak menawarkan satu kamar pun untuk ${dates.weekday.checkIn} maupun ${dates.weekend.checkIn}; berkas lama dipertahankan`);
  const bookPageUrl = await resolveBookPage(anyLink);

  const file = buildOfficialRoomRatesFile({
    hotelId: OWN_HOTEL_ID,
    catalogRoomNames: catalogHotel.roomTypes.map((r) => r.name),
    aliases: ENGINE_ROOM_ALIASES,
    content,
    stays: { weekday: { ...dates.weekday, response: weekday }, weekend: { ...dates.weekend, response: weekend } },
    bookPageUrl,
    observedAt: new Date(),
    request: { api: "Exely Connect Search API", contentPath: CONTENT_PATH, searchPath: SEARCH_PATH, datesFrom: `lib/market/resort-room-rates.data.json (capturedAt ${dates.capturedAt})` },
  });

  for (const rate of officialRoomRatesOf(file, OWN_HOTEL_ID)) {
    const stayText = (s: StayKey) => {
      const st = rate[s];
      if (st.price === null) return `${s === "weekday" ? "hari biasa" : "akhir pekan"} tidak ditawarkan`;
      const bf = st.breakfastIncluded === true ? "termasuk sarapan" : st.breakfastIncluded === false ? "tanpa sarapan" : "sarapan belum tercatat";
      return `${s === "weekday" ? "hari biasa" : "akhir pekan"} ${rp(st.price)} (${st.ratePlan}, ${bf}, sisa ${st.roomsLeft})`;
    };
    log(`${rate.roomName}: ${stayText("weekday")}; ${stayText("weekend")}`);
  }
  const hotel = file.hotels[0];
  for (const u of hotel.unmappedEngineRooms) log(`TIDAK TERPETAKAN: kamar engine "${u.engineRoomName}" (${u.engineRoomTypeId}): ${u.reason}`);
  for (const name of hotel.catalogRoomsWithoutEngineRoom) log(`kamar katalog "${name}" tidak ada di booking engine`);
  for (const s of hotel.skippedOffers) log(`penawaran dilewati ${s.checkIn} ${s.engineRoomTypeId}/${s.ratePlanId}: ${s.reason}`);

  const problems = validateOfficialRoomRates(file);
  if (problems.length || options.dry) return { written: false, file, problems };
  writeFile(file);
  log(`tersimpan: ${path.relative(process.cwd(), OUT)}`);
  return { written: true, file, problems };
}
