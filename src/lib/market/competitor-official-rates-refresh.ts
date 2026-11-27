/**
 * Pembaruan tarif booking engine resmi kompetitor (be.dip.id) untuk tanggal check-in hari biasa dan akhir pekan lapisan
 * OTA (checkInWeekday/checkInWeekend di lib/market/resort-room-rates.data.json), 1 malam, 2 dewasa, lalu tulis
 * lib/market/competitor-official-rates.data.json. Berkas hanya ditimpa bila tiap hotel punya minimal satu kamar berharga;
 * bila tidak, data lama dipakai. Dipanggil CLI scripts/ops/crawl-competitor-official-rates.ts (job GitHub "room-rates")
 * dan langkah tarif "Perbarui Semua Data" (lib/market/full-refresh.ts) setelah resort-room-rates.data.json berganti tanggal.
 *
 * Hotel dan keyid engine diturunkan dari hotel-room-types.data.json (tipe kamar yang sumbernya halaman be.dip.id), jadi
 * kompetitor lain yang memakai engine yang sama ikut terbaca tanpa daftar hotel di kode. Engine dipanggil seperti
 * halaman pemesanannya sendiri: satu POST per tanggal dengan User-Agent perayap proyek; robots.txt diperiksa lebih dulu.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  buildCompetitorOfficialRatesFile,
  parseCompetitorOfficialRatesFile,
  type CompetitorEngineRead,
  type CompetitorOfficialRatesFile,
} from "./competitor-official-rates";
import { DIP_SEARCH_URL, dipSearchForm, dipSearchResponseSchema, type DipSearchResponse } from "./dip-booking-engine";
import { isCrawlAllowed, PROFILE_CRAWLER_UA } from "./official-pages";
import { OTA_LAYER_ADULTS, type StayKey } from "./official-room-rates";
import { otaStayDates } from "./official-room-rates-refresh";

const OTA_RATES_PATH = path.resolve(process.cwd(), "src/lib/market/resort-room-rates.data.json");
const ROOM_TYPES_PATH = path.resolve(process.cwd(), "src/lib/market/hotel-room-types.data.json");
const OUT = path.resolve(process.cwd(), "src/lib/market/competitor-official-rates.data.json");
/** Batas satu permintaan sama dengan skrip halaman engine (timeout 90000 di cekroom-withpackage.js). */
const REQUEST_TIMEOUT_MS = 90_000;
const DIP_HOST = "be.dip.id";
const STAYS: StayKey[] = ["weekday", "weekend"];

const log = (message: string) => console.log(`[tarif-resmi-kompetitor] ${message}`);
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

const roomTypesFileSchema = z.object({
  hotels: z.array(z.object({ hotelId: z.string().min(1), roomTypes: z.array(z.object({ name: z.string().min(1), sourceUrl: z.string().nullable() })) })),
});

export interface DipHotelSource {
  hotelId: string;
  apiKey: string;
  bookUrl: string;
  catalogRooms: string[];
}

/** Hotel yang tipe kamarnya bersumber halaman be.dip.id, beserta keyid publik dari tautan itu. */
export function dipHotelSources(roomTypesRaw: unknown): DipHotelSource[] {
  const { hotels } = roomTypesFileSchema.parse(roomTypesRaw);
  const sources: DipHotelSource[] = [];
  for (const hotel of hotels) {
    const bookUrl = hotel.roomTypes.map((r) => r.sourceUrl).find((u): u is string => Boolean(u) && new URL(u as string).hostname === DIP_HOST);
    if (!bookUrl) continue;
    const apiKey = new URL(bookUrl).searchParams.get("keyid");
    if (!apiKey) throw new Error(`${hotel.hotelId}: tautan ${DIP_HOST} tanpa keyid (${bookUrl})`);
    sources.push({ hotelId: hotel.hotelId, apiKey, bookUrl, catalogRooms: hotel.roomTypes.map((r) => r.name) });
  }
  return sources;
}

async function searchDip(apiKey: string, checkIn: string): Promise<DipSearchResponse> {
  const url = new URL(DIP_SEARCH_URL);
  if (!(await isCrawlAllowed(url.href))) throw new Error(`robots.txt ${url.host} melarang ${url.pathname}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": PROFILE_CRAWLER_UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json, text/plain, */*" },
      body: dipSearchForm({ apiKey, checkIn, adults: OTA_LAYER_ADULTS, rooms: 1 }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    throw new Error(`${(error as Error).message}${cause?.code ? ` (${cause.code})` : ""}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Engine menjawab JSON dengan content-type text/html, jadi teksnya dibaca lalu diurai.
  const parsed = dipSearchResponseSchema.safeParse(JSON.parse(await response.text()));
  if (!parsed.success) throw new Error(`bentuk jawaban berubah (${[...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(akar)"))].join(", ")})`);
  return parsed.data;
}

/** Hotel yang tidak satu kamar pun berharga di kedua tanggal; berkas seperti itu tidak menimpa data lama. */
function emptyHotels(file: CompetitorOfficialRatesFile): string[] {
  return file.hotels
    .filter((h) => !h.rooms.some((r) => r.weekday.price !== null || r.weekend.price !== null))
    .map((h) => `${h.hotelId}: engine tidak menawarkan satu kamar pun untuk ${file.checkInWeekday} maupun ${file.checkInWeekend}`);
}

export interface CompetitorOfficialRatesRefresh {
  file: CompetitorOfficialRatesFile;
  problems: string[];
  written: boolean;
}

export async function refreshCompetitorOfficialRates(options: { dry?: boolean; now?: Date } = {}): Promise<CompetitorOfficialRatesRefresh> {
  const now = options.now ?? new Date();
  const todayWib = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const dates = otaStayDates(JSON.parse(readFileSync(OTA_RATES_PATH, "utf8")), todayWib);
  const sources = dipHotelSources(JSON.parse(readFileSync(ROOM_TYPES_PATH, "utf8")));
  const reads: CompetitorEngineRead[] = [];
  for (const source of sources) {
    const responses = {} as CompetitorEngineRead["responses"];
    for (const stay of STAYS) {
      try {
        responses[stay] = await searchDip(source.apiKey, dates[stay].checkIn);
      } catch (error) {
        // Dicatat sebagai alasan di berkas; hotel tanpa satu harga pun membuat berkas tidak ditulis (emptyHotels).
        responses[stay] = { error: (error as Error).message };
        log(`${source.hotelId} ${dates[stay].checkIn}: ${(error as Error).message}`);
      }
    }
    reads.push({ hotelId: source.hotelId, bookUrl: source.bookUrl, catalogRooms: source.catalogRooms, responses });
  }
  const file = parseCompetitorOfficialRatesFile(
    buildCompetitorOfficialRatesFile({
      observedAt: now.toISOString(),
      checkInWeekday: dates.weekday.checkIn,
      checkInWeekend: dates.weekend.checkIn,
      datesFrom: `lib/market/resort-room-rates.data.json (capturedAt ${dates.capturedAt})`,
      adults: OTA_LAYER_ADULTS,
      hotels: reads,
      now,
    }),
  );
  const problems = [
    ...emptyHotels(file),
    ...file.hotels.flatMap((h) => h.unmappedEngineRooms.map((u) => `${h.hotelId}: kamar engine "${u.engineRoomName}" ${u.reason}`)),
  ];
  for (const hotel of file.hotels)
    for (const room of hotel.rooms)
      log(
        `${hotel.hotelId} · ${room.roomName}: ${STAYS.map((s) => (room[s].price !== null ? `${room[s].checkIn} ${rp(room[s].price)} ${room[s].breakfastIncluded ? "termasuk sarapan" : "tanpa sarapan"} (${room[s].ratePlan})` : `${room[s].checkIn} ${room[s].unavailableReason}`)).join(" | ")}`,
      );
  const written = !problems.length && !options.dry;
  if (written) writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
  return { file, problems, written };
}
