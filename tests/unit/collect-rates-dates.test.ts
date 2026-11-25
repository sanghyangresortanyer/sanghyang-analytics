import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyGoogleHotelPricePage,
  getAlternateStayDates,
  getDynamicTargetDates,
  resolveHotelRateWithFallback,
  type HotelPriceReadResult,
} from "../../src/lib/market/collect-rates";

/**
 * Waktu pengamatan asli dari CompetitorPriceSnapshot DB lokal (observedAt):
 *  - 2026-11-12T22:00:00.523Z = Jumat 13 Nov 05.00 WIB, job GitHub (runner UTC) yang tertunda lewat tengah malam WIB.
 *    Baris ini tersimpan dengan check-in "besok" 13 Nov, padahal 13 Nov adalah malam itu juga menurut WIB.
 *  - 2026-11-16T17:16:21.509Z = Selasa 17 Nov 00.16 WIB, tombol lokal (zona waktu komputer WIB): check-in 18 dan 21 Nov.
 */
const DELAYED_GITHUB_RUN = new Date("2026-11-12T22:00:00.523Z");
const LOCAL_BUTTON_RUN = new Date("2026-11-16T17:16:21.509Z");

function inTimezone<T>(tz: string, run: () => T): T {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
}

const nights = (pair: { checkIn: Date; checkOut: Date }) => [pair.checkIn.toISOString().slice(0, 10), pair.checkOut.toISOString().slice(0, 10)];

test("tanggal tarif besok dan Sabtu terdekat dihitung menurut WIB, juga di runner GitHub yang berjalan dalam UTC", () => {
  for (const tz of ["UTC", "Asia/Jakarta"]) {
    const late = inTimezone(tz, () => getDynamicTargetDates(DELAYED_GITHUB_RUN));
    assert.deepEqual(nights(late.tomorrow), ["2026-11-14", "2026-11-15"], `${tz}: besok dari Jumat 13 Nov WIB`);
    assert.deepEqual(nights(late.weekend), ["2026-11-14", "2026-11-15"], `${tz}: Sabtu terdekat dari Jumat 13 Nov WIB`);

    const local = inTimezone(tz, () => getDynamicTargetDates(LOCAL_BUTTON_RUN));
    assert.deepEqual(nights(local.tomorrow), ["2026-11-18", "2026-11-19"], `${tz}: besok dari Selasa 17 Nov WIB`);
    assert.deepEqual(nights(local.weekend), ["2026-11-21", "2026-11-22"], `${tz}: Sabtu terdekat dari Selasa 17 Nov WIB`);
  }
});

test("hari Sabtu WIB: akhir pekan yang dirayapi adalah Sabtu berikutnya, bukan malam itu juga", () => {
  // Sabtu 14 Nov 05.00 WIB = Jumat 13 Nov 22.00 UTC; di UTC hari itu masih Jumat sehingga "Sabtu terdekat" jatuh ke 14 Nov.
  const saturdayDawn = new Date(DELAYED_GITHUB_RUN.getTime() + 86_400_000);
  for (const tz of ["UTC", "Asia/Jakarta"]) {
    const dates = inTimezone(tz, () => getDynamicTargetDates(saturdayDawn));
    assert.deepEqual(nights(dates.tomorrow), ["2026-11-15", "2026-11-16"], tz);
    assert.deepEqual(nights(dates.weekend), ["2026-11-21", "2026-11-22"], tz);
  }
});

const SAMPLE_RATE_CTX = {
  hotelName: "Sanghyang Indah Spa Resort",
  checkIn: new Date("2026-11-26T00:00:00Z"),
  checkOut: new Date("2026-11-27T00:00:00Z"),
  guests: 2,
  sourceUrl: "https://www.google.com/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB/prices",
};

test("classifyGoogleHotelPricePage: membedakan tersedia, penuh (sold_out), kontak properti (contact_property), dan gagal baca", () => {
  const availableText = readFileSync("tests/fixtures/google-travel-sanghyang-2026-11-24.txt", "utf8");
  const avail = classifyGoogleHotelPricePage(availableText, SAMPLE_RATE_CTX);
  assert.equal(avail.status, "available");
  assert.equal(avail.rate?.price, 361792);

  // Teks nyata Google Hotels My Pisita Anyer Resort (25 Nov 2026): tidak menjual via OTA, hanya kontak properti.
  const contactText = [
    "My Pisita Anyer Resort",
    "Total per malam",
    "Hubungi pihak properti ini",
    "Telepon atau kunjungi situs untuk mengetahui tarif dan ketersediaan",
    "Bersponsor·Hotel serupa",
    "PENGINAPAN ANYER",
    "Rp 227.272",
    "Kunjungi Booking.com",
  ].join("\n");
  const contact = classifyGoogleHotelPricePage(contactText, { ...SAMPLE_RATE_CTX, hotelName: "My Pisita Anyer Resort" });
  assert.equal(contact.status, "contact_property");
  assert.equal(contact.rate, null);

  // Teks nyata Google Hotels Marbella & Jayakarta pada malam penuh (2026-11-26): saran tanggal lain, bukan harga 26 Nov.
  const soldOutText = [
    "Marbella Place Anyer by Jayakarta",
    "Total per malam",
    "Hanya bebas biaya pembatalan",
    "Tersedia untuk tanggal 27–28 Nov seharga Rp 554.528.",
    "Bersponsor·Hotel serupa",
    "Mambruk Hotel & Convention",
    "Rp 1.024.832",
    "Kunjungi tiket.com",
  ].join("\n");
  const soldOut = classifyGoogleHotelPricePage(soldOutText, { ...SAMPLE_RATE_CTX, hotelName: "Marbella Place Anyer by Jayakarta" });
  assert.equal(soldOut.status, "sold_out");
  assert.equal(soldOut.rate, null);

  const empty = classifyGoogleHotelPricePage("Halaman kosong tanpa elemen harga", SAMPLE_RATE_CTX);
  assert.equal(empty.status, "unreadable");
  assert.equal(empty.rate, null);
});

test("getAlternateStayDates: memilih tanggal alternatif dengan jenis hari sama (weekday vs weekend) di dalam jendela 14 malam", () => {
  const now = new Date("2026-11-25T03:00:00Z"); // Rabu 25 Nov 2026 10:00 WIB
  const thuCheckIn = new Date("2026-11-26T00:00:00Z"); // Kamis (weekday)
  const weekdayAlts = getAlternateStayDates(thuCheckIn, now, 3);
  assert.deepEqual(
    weekdayAlts.map((p) => p.checkIn.toISOString().slice(0, 10)),
    ["2026-11-29", "2026-11-30", "2026-12-01"],
    "harus melewati Jumat 27 Nov & Sabtu 28 Nov dan mengambil weekday berikutnya",
  );

  const satCheckIn = new Date("2026-11-28T00:00:00Z"); // Sabtu (weekend)
  const weekendAlts = getAlternateStayDates(satCheckIn, now, 3);
  assert.deepEqual(
    weekendAlts.map((p) => p.checkIn.toISOString().slice(0, 10)),
    ["2026-11-27", "2026-12-04", "2026-12-05"],
    "harus hanya memilih malam akhir pekan (Jumat/Sabtu) lain dalam jendela 14 malam",
  );
});

test("resolveHotelRateWithFallback: saat tanggal target penuh mencoba tanggal sejenis berikutnya, dan properti kontak langsung tidak gagal", async () => {
  const now = new Date("2026-11-25T03:00:00Z");
  const tried: string[] = [];
  const resSoldOut = await resolveHotelRateWithFallback({
    hotelName: "Marbella Place Anyer by Jayakarta",
    checkIn: new Date("2026-11-26T00:00:00Z"),
    checkOut: new Date("2026-11-27T00:00:00Z"),
    allowDateFallback: true,
    baseDate: now,
    readNight: async (ci, co): Promise<HotelPriceReadResult> => {
      const iso = ci.toISOString().slice(0, 10);
      tried.push(iso);
      if (iso === "2026-11-26") return { status: "sold_out", rate: null, reason: "Penuh pada 2026-11-26" };
      return {
        status: "available",
        rate: {
          hotelName: "Marbella Place Anyer by Jayakarta",
          price: 409040,
          currency: "IDR",
          checkIn: ci,
          checkOut: co,
          guests: 2,
          source: "Google Hotels lowest displayed rate",
          sourceUrl: "https://www.google.com/travel/hotels/entity/ChgIkM3qyZ-BzczfARoLL2cvMXRmeXNuY2cQAQ/prices",
          observedAt: now,
        },
        reason: null,
      };
    },
  });
  assert.equal(resSoldOut.status, "available");
  assert.equal(resSoldOut.rate?.price, 409040);
  assert.equal(resSoldOut.rate?.checkIn.toISOString().slice(0, 10), "2026-11-29", "checkIn harus tanggal aktual yang dibaca, bukan 2026-11-26");
  assert.deepEqual(tried, ["2026-11-26", "2026-11-29"]);

  const contactTried: string[] = [];
  const resContact = await resolveHotelRateWithFallback({
    hotelName: "My Pisita Anyer Resort",
    checkIn: new Date("2026-11-26T00:00:00Z"),
    checkOut: new Date("2026-11-27T00:00:00Z"),
    allowDateFallback: true,
    baseDate: now,
    readNight: async (ci): Promise<HotelPriceReadResult> => {
      contactTried.push(ci.toISOString().slice(0, 10));
      return { status: "contact_property", rate: null, reason: "Hubungi pihak properti ini" };
    },
  });
  assert.equal(resContact.status, "contact_property");
  assert.equal(resContact.rate, null);
  assert.deepEqual(contactTried, ["2026-11-26"], "properti kontak langsung tidak perlu mencoba tanggal lain");
});
