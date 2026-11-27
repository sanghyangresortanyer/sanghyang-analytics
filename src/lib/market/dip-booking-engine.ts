/**
 * Booking engine be.dip.id (dipakai Nemuru Grand Anyer Palazo; keyid-nya publik di tautan pesan dari situs resmi hotel).
 * Harga yang dilihat tamu = harga kamar + paket yang dijual. Rumusnya meniru skrip engine sendiri
 * (be.dip.id/lib/d2017/js/book/cekroom-withpackage.js, dibaca 27 Nov 2026) dan dicocokkan dengan halaman engine yang
 * dirender Chrome untuk check-in 28 Nov, 30 Nov, dan 1 Des 2026 (tests/unit/dip-booking-engine.test.ts).
 *
 * `harga[tanggal].after` saja adalah harga kamar sebelum paket sarapan wajib. Data riset 19 Nov mencatat angka itu, sehingga
 * tarif Nemuru tampil terlalu murah dan sarapannya "Belum tercatat" (laporan pemilik 27 Nov 2026).
 *
 * Modul ini tanpa impor khusus Node supaya aman diimpor dari mana pun; pengambilan jaringan ada di modul refresh.
 */
import { z } from "zod";

export const DIP_SEARCH_URL = "https://be.dip.id/booking/cekroomservice_withpackage";
/** Halaman engine memakai lang IN; dengan kode lain is_weekend dikirim sebagai boolean dan skrip engine tidak menjual paket. */
const DIP_LANG = "IN";
/** Skrip engine memakai jam peramban tamu; tamu hotel ini berada di zona WIB. */
const GUEST_TIME_ZONE = "Asia/Jakarta";

const dipPackageSchema = z.object({
  id: z.number().int(),
  packageName: z.string().min(1),
  weekday: z.boolean(),
  weekend: z.boolean(),
  paket: z.enum(["include", "exclude"]),
  breakfast: z.boolean(),
  beBreakfast: z.number().nullable(),
  bePrice: z.number().nullable(),
  forSale: z.boolean(),
});
const dipPackageMappingSchema = z.object({
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  bookingStartDate: z.string().nullable(),
  bookingEndDate: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  roomPrice: z.number().nullable(),
  activeDay: z.string().nullable(),
});
const dipRoomSchema = z.object({
  nama_jenis: z.string().min(1),
  kapasitas: z.number().int().positive(),
  harga: z.record(z.string(), z.object({ after: z.number().nonnegative(), stop_sell: z.boolean() })),
  liststok: z.record(z.string(), z.number()),
  package: z.array(dipPackageSchema),
  // PHP mengirim [] untuk peta kosong.
  packageMapping: z.union([z.record(z.string(), dipPackageMappingSchema), z.array(z.never()).max(0)]),
  packageBase: z.string().min(1),
  room_only_sale: z.boolean(),
  promopaket: z.object({ data: z.object({ jenis_diskon: z.string().optional(), diskon: z.coerce.number() }) }).nullable(),
});
export const dipSearchResponseSchema = z.object({
  status: z.literal("success"),
  is_weekend: z.enum(["true", "false"]),
  list: z.object({ list: z.array(dipRoomSchema) }),
});
export type DipSearchResponse = z.infer<typeof dipSearchResponseSchema>;
type DipRoom = DipSearchResponse["list"]["list"][number];
type DipPackageMapping = z.infer<typeof dipPackageMappingSchema>;

export interface DipStayRequest {
  checkIn: string;
  adults: number;
  rooms: number;
}

export interface DipRate {
  engineRoomName: string;
  ratePlan: string;
  /** id paket engine, atau "room-only" untuk tarif kamar saja. */
  ratePlanId: string;
  price: number;
  breakfastIncluded: boolean;
  roomsLeft: number;
}

export interface DipUnavailableRoom {
  engineRoomName: string;
  reason: string;
}

const nextDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** Isi POST yang sama dengan permintaan skrip halaman engine untuk satu malam. */
export function dipSearchForm(input: DipStayRequest & { apiKey: string }): URLSearchParams {
  return new URLSearchParams({
    apikey: input.apiKey,
    tglcekin: input.checkIn,
    duration: "1",
    tglcekout: nextDay(input.checkIn),
    jmlroom: String(input.rooms),
    person: String(input.adults),
    lang: DIP_LANG,
  });
}

interface GuestClock {
  date: string;
  time: string;
  day: string;
}

function guestClock(now: Date): GuestClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: GUEST_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "long",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, day: parts.weekday };
}

/**
 * Sama dengan isPackageValid skrip engine: jam dan hari aktif dibandingkan dengan waktu sekarang (bukan tanggal check-in),
 * sedangkan jendela bookingStartDate-bookingEndDate dibandingkan dengan tanggal check-in.
 */
function mappingAllows(m: DipPackageMapping | undefined, checkIn: string, clock: GuestClock): boolean {
  if (!m) return true;
  if (m.startDate && m.endDate && m.startTime && m.endTime) {
    if (clock.date < m.startDate || clock.date > m.endDate) return false;
    const inTime =
      m.startTime <= m.endTime
        ? clock.time >= m.startTime && clock.time <= m.endTime
        : clock.time >= m.startTime || clock.time <= m.endTime;
    if (!inTime) return false;
  }
  if (m.bookingStartDate && m.bookingEndDate && (checkIn < m.bookingStartDate || checkIn > m.bookingEndDate)) return false;
  return m.activeDay === null || m.activeDay.includes(clock.day);
}

function breakfastPax(room: DipRoom, req: DipStayRequest): number {
  if (room.packageBase === "person_base") return req.adults / req.rooms;
  if (room.packageBase === "room_base_room_capacity") return room.kapasitas;
  return 2;
}

/** Semua tarif yang dijual engine per kamar untuk satu malam, termurah dulu seperti urutan tampilan engine. */
export function dipRates(res: DipSearchResponse, req: DipStayRequest, now: Date): { rates: DipRate[]; unavailable: DipUnavailableRoom[] } {
  const clock = guestClock(now);
  const weekend = res.is_weekend === "true";
  const rates: DipRate[] = [];
  const unavailable: DipUnavailableRoom[] = [];
  for (const room of res.list.list) {
    const night = room.harga[req.checkIn];
    const roomsLeft = room.liststok[req.checkIn] ?? 0;
    if (!night) {
      unavailable.push({ engineRoomName: room.nama_jenis, reason: `Engine tidak memuat harga untuk check-in ${req.checkIn}` });
      continue;
    }
    if (night.stop_sell || roomsLeft <= 0) {
      unavailable.push({ engineRoomName: room.nama_jenis, reason: `Kamar habis di engine untuk check-in ${req.checkIn}` });
      continue;
    }
    const mapping = Array.isArray(room.packageMapping) ? {} : room.packageMapping;
    const roomRates: DipRate[] = [];
    if (room.room_only_sale) {
      roomRates.push({ engineRoomName: room.nama_jenis, ratePlan: "Room Only", ratePlanId: "room-only", price: night.after, breakfastIncluded: false, roomsLeft });
    }
    for (const pkg of room.package) {
      const m = mapping[String(pkg.id)];
      if (!(weekend ? pkg.weekend : pkg.weekday) || !pkg.forSale || !mappingAllows(m, req.checkIn, clock)) continue;
      const roomPrice = m?.roomPrice ?? night.after;
      const packageTotal = pkg.bePrice ?? 0;
      // Skrip engine tidak menampilkan paket 'include' yang lebih mahal dari harga kamarnya.
      if (packageTotal > roomPrice && pkg.paket !== "exclude") continue;
      let extra = pkg.breakfast ? (pkg.beBreakfast ?? 0) * breakfastPax(room, req) : 0;
      if (pkg.paket === "exclude") extra += packageTotal;
      const promo = room.promopaket?.data;
      if (promo && promo.jenis_diskon !== "malam" && promo.jenis_diskon !== "harga") extra -= (extra * promo.diskon) / 100;
      roomRates.push({
        engineRoomName: room.nama_jenis,
        ratePlan: pkg.packageName,
        ratePlanId: String(pkg.id),
        price: Math.round(roomPrice + extra),
        breakfastIncluded: pkg.breakfast,
        roomsLeft,
      });
    }
    if (!roomRates.length) {
      unavailable.push({ engineRoomName: room.nama_jenis, reason: `Engine tidak menjual rate plan untuk check-in ${req.checkIn}` });
      continue;
    }
    rates.push(...roomRates.sort((a, b) => a.price - b.price));
  }
  return { rates, unavailable };
}

/** Tarif termurah tiap kamar (baris teratas di halaman engine). */
export function cheapestDipOffers(res: DipSearchResponse, req: DipStayRequest, now: Date): { offers: DipRate[]; unavailable: DipUnavailableRoom[] } {
  const { rates, unavailable } = dipRates(res, req, now);
  const offers = new Map<string, DipRate>();
  for (const rate of rates) if (!offers.has(rate.engineRoomName)) offers.set(rate.engineRoomName, rate);
  return { offers: [...offers.values()], unavailable };
}
