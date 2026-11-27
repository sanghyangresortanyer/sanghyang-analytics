/**
 * Tarif kamar booking engine resmi kompetitor pada tanggal check-in lapisan OTA (checkInWeekday/checkInWeekend di
 * resort-room-rates.data.json), 1 malam, 2 dewasa, supaya kolom situs resmi di matriks kompetitor sebanding dengan OTA.
 * Saat ini hanya engine be.dip.id (Nemuru Grand Anyer Palazo). Berkas ditulis lib/market/competitor-official-rates-refresh.ts.
 *
 * Harga riset tanpa tanggal menginap di hotel-room-types.data.json tidak lagi dipakai sebagai tarif situs resmi (laporan
 * pemilik 27 Nov 2026): tarif resmi hanya dari engine yang dibaca untuk malam yang sama dengan OTA.
 *
 * Modul ini murni (tanpa berkas data dan tanpa jaringan) supaya penyegaran bisa berjalan sebelum berkas pertama ada;
 * pemuat berkas repo ada di competitor-official-rates-data.ts.
 */
import { z } from "zod";
import { cheapestDipOffers, type DipSearchResponse } from "./dip-booking-engine";
import type { OfficialRoomRate, StayKey } from "./official-room-rates";

const STAYS: StayKey[] = ["weekday", "weekend"];
const STAY_LABEL: Record<StayKey, string> = { weekday: "Hari biasa", weekend: "Akhir pekan" };
export const DIP_ENGINE_LABEL = "Booking engine resmi be.dip.id";
export const COMPETITOR_OFFICIAL_RATES_COMMENT =
  "Tarif kamar booking engine resmi kompetitor (be.dip.id) pada tanggal lapisan OTA. Ditulis lib/market/competitor-official-rates-refresh.ts; jangan disunting tangan.";

const isoDate = z.iso.date();
const stayRateSchema = z.object({
  checkIn: isoDate,
  checkOut: isoDate,
  price: z.number().int().positive().nullable(),
  breakfastIncluded: z.boolean().nullable(),
  ratePlan: z.string().min(1).nullable(),
  ratePlanId: z.string().min(1).nullable(),
  mealPlanCode: z.null(),
  roomsLeft: z.number().int().nonnegative().nullable(),
  unavailableReason: z.string().min(1).nullable(),
  sourceUrl: z.url(),
});
const hotelSchema = z.object({
  hotelId: z.string().min(1),
  engine: z.literal("be.dip.id"),
  sourceLabel: z.string().min(1),
  bookUrl: z.url(),
  rooms: z.array(z.object({ roomName: z.string().min(1), engineRoomName: z.string().min(1), weekday: stayRateSchema, weekend: stayRateSchema })),
  unmappedEngineRooms: z.array(z.object({ engineRoomName: z.string().min(1), reason: z.string().min(1) })),
  catalogRoomsWithoutEngineRoom: z.array(z.string().min(1)),
});
export const competitorOfficialRatesFileSchema = z.object({
  $comment: z.string().min(1),
  observedAt: z.iso.datetime(),
  checkInWeekday: isoDate,
  checkInWeekend: isoDate,
  datesFrom: z.string().min(1),
  hotels: z.array(hotelSchema),
});
export type CompetitorOfficialRatesFile = z.infer<typeof competitorOfficialRatesFileSchema>;
type CompetitorStayRate = z.infer<typeof stayRateSchema>;
type CompetitorHotel = z.infer<typeof hotelSchema>;

/** Keterkaitan antarkolom yang tidak bisa dinyatakan per kolom; tiap butir = satu pelanggaran. */
function invariantProblems(file: CompetitorOfficialRatesFile): string[] {
  const problems: string[] = [];
  const expected: Record<StayKey, string> = { weekday: file.checkInWeekday, weekend: file.checkInWeekend };
  for (const hotel of file.hotels) {
    const names = hotel.rooms.map((r) => r.roomName);
    if (new Set(names).size !== names.length) problems.push(`${hotel.hotelId}: nama kamar katalog ganda`);
    for (const room of hotel.rooms)
      for (const s of STAYS) {
        const stay = room[s];
        if (stay.checkIn !== expected[s]) problems.push(`${hotel.hotelId}/${room.roomName}: check-in ${s} ${stay.checkIn}, permintaan ${expected[s]}`);
        if ((stay.price === null) === (stay.unavailableReason === null)) problems.push(`${hotel.hotelId}/${room.roomName}: ${s} harus berisi harga atau alasan tidak tersedia, tidak keduanya`);
        if (stay.price !== null && (!stay.ratePlan || !stay.ratePlanId || stay.breakfastIncluded === null)) {
          problems.push(`${hotel.hotelId}/${room.roomName}: harga ${s} tanpa rate plan atau status sarapan`);
        }
      }
  }
  return problems;
}

/** Validasi berkas data; galat menyebut kolom yang rusak supaya data rusak tidak pernah tampil. */
export function parseCompetitorOfficialRatesFile(raw: unknown): CompetitorOfficialRatesFile {
  const parsed = competitorOfficialRatesFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(akar)"}: ${issue.message}`);
    throw new Error(`competitor-official-rates.data.json tidak sah: ${issues.slice(0, 8).join("; ")}`);
  }
  const problems = invariantProblems(parsed.data);
  if (problems.length) throw new Error(`competitor-official-rates.data.json tidak sah: ${problems.slice(0, 8).join("; ")}`);
  return parsed.data;
}

export interface CompetitorEngineRead {
  hotelId: string;
  bookUrl: string;
  /** Nama tipe kamar hotel ini di hotel-room-types.data.json. */
  catalogRooms: string[];
  /** Jawaban engine per jenis hari, atau pesan galat bila engine gagal dibaca. */
  responses: Record<StayKey, DipSearchResponse | { error: string }>;
}

const normalizeRoomName = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
const nextDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** Jawaban engine kedua tanggal -> isi competitor-official-rates.data.json (belum ditulis; pemanggil yang menulis). */
export function buildCompetitorOfficialRatesFile(input: {
  observedAt: string;
  checkInWeekday: string;
  checkInWeekend: string;
  datesFrom: string;
  adults: number;
  hotels: CompetitorEngineRead[];
  now: Date;
}): CompetitorOfficialRatesFile {
  const checkIns: Record<StayKey, string> = { weekday: input.checkInWeekday, weekend: input.checkInWeekend };
  const hotels: CompetitorHotel[] = input.hotels.map((read) => {
    const priced = Object.fromEntries(
      STAYS.map((s) => {
        const res = read.responses[s];
        return [s, "error" in res ? { error: res.error } : cheapestDipOffers(res, { checkIn: checkIns[s], adults: input.adults, rooms: 1 }, input.now)];
      }),
    ) as Record<StayKey, { error: string } | ReturnType<typeof cheapestDipOffers>>;
    const engineNames = new Set(
      STAYS.flatMap((s) => {
        const res = read.responses[s];
        return "error" in res ? [] : res.list.list.map((r) => r.nama_jenis);
      }),
    );
    const catalogByKey = new Map(read.catalogRooms.map((name) => [normalizeRoomName(name), name]));
    const rooms: CompetitorHotel["rooms"] = [];
    const unmappedEngineRooms: CompetitorHotel["unmappedEngineRooms"] = [];
    for (const engineRoomName of engineNames) {
      const roomName = catalogByKey.get(normalizeRoomName(engineRoomName));
      if (!roomName) {
        unmappedEngineRooms.push({ engineRoomName, reason: "nama tipe tidak ada di katalog hotel-room-types.data.json" });
        continue;
      }
      const stay = (s: StayKey): CompetitorStayRate => {
        const base = { checkIn: checkIns[s], checkOut: nextDay(checkIns[s]), mealPlanCode: null, sourceUrl: read.bookUrl };
        const result = priced[s];
        if ("error" in result) {
          return { ...base, price: null, breakfastIncluded: null, ratePlan: null, ratePlanId: null, roomsLeft: null, unavailableReason: `Engine be.dip.id gagal dibaca: ${result.error}` };
        }
        const offer = result.offers.find((o) => o.engineRoomName === engineRoomName);
        if (!offer) {
          const reason = result.unavailable.find((u) => u.engineRoomName === engineRoomName)?.reason ?? `Kamar tidak tampil di engine untuk check-in ${checkIns[s]}`;
          return { ...base, price: null, breakfastIncluded: null, ratePlan: null, ratePlanId: null, roomsLeft: null, unavailableReason: reason };
        }
        return {
          ...base,
          price: offer.price,
          breakfastIncluded: offer.breakfastIncluded,
          ratePlan: offer.ratePlan,
          ratePlanId: offer.ratePlanId,
          roomsLeft: offer.roomsLeft,
          unavailableReason: null,
        };
      };
      rooms.push({ roomName, engineRoomName, weekday: stay("weekday"), weekend: stay("weekend") });
    }
    const mapped = new Set(rooms.map((r) => r.roomName));
    return {
      hotelId: read.hotelId,
      engine: "be.dip.id",
      sourceLabel: DIP_ENGINE_LABEL,
      bookUrl: read.bookUrl,
      rooms,
      unmappedEngineRooms,
      catalogRoomsWithoutEngineRoom: read.catalogRooms.filter((name) => !mapped.has(name)),
    };
  });
  return {
    $comment: COMPETITOR_OFFICIAL_RATES_COMMENT,
    observedAt: input.observedAt,
    checkInWeekday: input.checkInWeekday,
    checkInWeekend: input.checkInWeekend,
    datesFrom: input.datesFrom,
    hotels,
  };
}

function agreed<T>(values: T[]): T | null {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

/** Tarif resmi per tipe kamar satu hotel dalam bentuk lapisan situs resmi matriks; [] bila hotel tidak dibaca. */
export function competitorOfficialRoomRatesOf(file: CompetitorOfficialRatesFile, hotelId: string): OfficialRoomRate[] {
  const hotel = file.hotels.find((h) => h.hotelId === hotelId);
  if (!hotel) return [];
  return hotel.rooms.map((room) => {
    const priced = STAYS.filter((s) => room[s].price !== null);
    const plans = priced.map((s) => room[s].ratePlan as string);
    return {
      hotelId: hotel.hotelId,
      roomName: room.roomName,
      engineRoomName: room.engineRoomName,
      weekdayPrice: room.weekday.price,
      weekendPrice: room.weekend.price,
      checkInWeekday: room.weekday.checkIn,
      checkInWeekend: room.weekend.checkIn,
      breakfastIncluded: agreed(priced.map((s) => room[s].breakfastIncluded)),
      ratePlan: agreed(plans) ?? (plans.length ? priced.map((s) => `${STAY_LABEL[s]}: ${room[s].ratePlan}`).join(" · ") : null),
      sourceLabel: hotel.sourceLabel,
      sourceUrl: room[priced[0] ?? "weekday"].sourceUrl,
      observedAt: file.observedAt,
      weekday: room.weekday,
      weekend: room.weekend,
    };
  });
}
