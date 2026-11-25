import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "../../src/lib/db";
import {
  formatAreaSqm,
  getHotelRoomTypes,
  HOTEL_ROOM_TYPES,
  loadDynamicHotelRoomTypes,
  mergeRoomTypeLayers,
  type HotelRoomTypeSpec,
} from "../../src/lib/market/hotel-room-types";
import { bestMatchingRoomIndex } from "../../src/lib/market/room-name-match";

after(() => db.$disconnect());

// Hasil penyegaran otomatis tipe kamar asli dari DB lokal 23 Nov 2026 (lihat _sumber di fixture).
const segar = JSON.parse(readFileSync("tests/fixtures/tipe-kamar-segar-2026-11-23.json", "utf8")) as {
  hotels: Record<string, { competitor: string; roomTypes: HotelRoomTypeSpec[] }>;
};

const FIELDS = ["areaSqm", "bedrooms", "smartTv", "bathtub"] as const;
const filled = (v: unknown) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");

/** Kolom data riset yang punya nilai tetapi kosong setelah digabung, per tipe kamar riset. */
function lostFields(baseline: HotelRoomTypeSpec[], merged: HotelRoomTypeSpec[]): string[] {
  const lost: string[] = [];
  for (const b of baseline) {
    const idx = bestMatchingRoomIndex(b.name, merged);
    if (idx < 0) {
      lost.push(`${b.name}: tipe hilang`);
      continue;
    }
    for (const f of FIELDS) if (filled(b[f]) && !filled(merged[idx][f])) lost.push(`${b.name}: ${f}`);
  }
  return lost;
}

test("data riset tipe kamar tidak hilang saat digabung dengan hasil penyegaran yang lebih miskin (situs resmi dulu, OTA mengisi yang kosong)", () => {
  for (const [hotelId, fresh] of Object.entries(segar.hotels)) {
    const baseline = getHotelRoomTypes(hotelId);
    if (!baseline) continue;
    const merged = mergeRoomTypeLayers(baseline.roomTypes, fresh.roomTypes);
    assert.deepEqual(lostFields(baseline.roomTypes, merged), [], `${fresh.competitor}: kolom riset hilang`);
  }
});

test("nama kamar OTA Aston dari Booking.com terserap ke tipe resmi yang berluas, bukan baris kosong tersendiri", () => {
  const baseline = getHotelRoomTypes("aston_anyer")!;
  const merged = mergeRoomTypeLayers(baseline.roomTypes, segar.hotels.aston_anyer.roomTypes);
  const empty = merged.filter((rt) => !filled(rt.areaSqm) && !filled(rt.areaLabel)).map((rt) => rt.name);
  assert.deepEqual(empty, [], "setiap tipe kamar Aston punya luas");
  const superior = merged.find((rt) => rt.name === "Superior");
  assert.ok(superior, "tipe resmi Superior tetap memakai nama situs resmi");
  assert.equal(superior.sourcePriority, "official");
  assert.equal(superior.areaSqm, 25);
});

test("profil tipe kamar dari DB tidak kehilangan kolom data riset untuk hotel mana pun", async () => {
  const profiles = await loadDynamicHotelRoomTypes();
  for (const baseline of HOTEL_ROOM_TYPES) {
    const loaded = profiles.get(baseline.hotelId);
    if (!loaded) continue;
    assert.deepEqual(lostFields(baseline.roomTypes, loaded.roomTypes), [], `${baseline.name}: kolom riset hilang di profil gabungan`);
  }
});

test("penyegaran tipe kamar yang gagal membaca situs resmi tidak menimpa fakta sebelumnya yang lebih lengkap", async () => {
  const { refreshDynamicRoomTypes } = await import("../../src/lib/market/refresh-room-types");
  const aston = getHotelRoomTypes("aston_anyer")!;
  const now = new Date("2026-11-23T01:50:00.000Z");
  const saved: unknown[] = [];
  // Penawaran Booking.com asli Aston 23 Nov (fixture) sebagai tangkapan tarif; satu malam hari biasa per nama kamar.
  const snapshots = segar.hotels.aston_anyer.roomTypes.map((rt) => ({
    competitorId: "aston",
    roomName: rt.name,
    price: rt.weekdayPrice ?? rt.weekendPrice,
    checkIn: new Date("2026-11-24T00:00:00.000Z"),
    source: rt.priceSource ?? "Booking.com",
    sourceUrl: rt.sourceUrl,
    observedAt: now,
  }));
  const client = {
    competitor: { findMany: async () => [{ id: "aston", name: "Aston Anyer Beach Hotel", placeId: "aston_anyer", category: "hotel", websiteUrl: "https://anyer.astonhotelsinternational.com/" }] },
    competitorFact: {
      findMany: async () => [
        { id: "f-aston", competitorId: "aston", observedAt: new Date("2026-11-10T00:00:00.000Z"), version: 3, sourceUrl: aston.roomTypes[0].sourceUrl, value: { hotelId: "aston_anyer", roomTypes: aston.roomTypes } },
      ],
      findUnique: async () => ({ id: "f-aston", version: 3 }),
      updateMany: async ({ data }: { data: { value: unknown } }) => {
        saved.push(data.value);
        return { count: 1 };
      },
      create: async () => {
        throw new Error("fakta Aston sudah ada; harus diperbarui, bukan dibuat");
      },
    },
    competitorPriceSnapshot: { findMany: async () => snapshots },
  };
  const result = await refreshDynamicRoomTypes({
    now,
    recordRun: false,
    client: client as never,
    checkRobots: async () => true,
    // Beranda Aston tanpa daftar kamar (kamar dimuat JavaScript), seperti yang diterima fetch biasa.
    fetchPage: async (url) => ({ url, html: `<html><body><p>${"Your seaside sanctuary awaits at Aston Anyer. ".repeat(6)}</p></body></html>` }),
    generate: async () => JSON.stringify({ roomTypes: [] }),
  });
  assert.equal(result.updated, 1, JSON.stringify(result.failures));
  const roomTypes = (saved[0] as { roomTypes: HotelRoomTypeSpec[] }).roomTypes;
  assert.deepEqual(lostFields(aston.roomTypes, roomTypes), [], "fakta tersimpan tidak kehilangan kolom yang sudah diketahui");
});

test("label luas dari situs resmi ditulis seragam dengan m², termasuk superskrip yang terbaca sebagai '2'", () => {
  const label = (rt: HotelRoomTypeSpec | undefined) => formatAreaSqm({ areaSqm: rt?.areaSqm ?? null, areaLabel: rt?.areaLabel ?? null });
  const byName = (hotelId: string, name: string) => segar.hotels[hotelId].roomTypes.find((rt) => rt.name === name);
  assert.equal(label(byName("marbella", "Studio Room")), "36 m²");
  assert.equal(label(byName("marbella", "Executive Suite")), "90 m²");
  assert.equal(label(byName("marbella", "Four Bedroom Suite")), "240 m²");
  assert.equal(label(byName("mambruk", "Superior")), "26 m²");
  assert.equal(label(getHotelRoomTypes("nemuru_palazo")!.roomTypes[0]), "38–42 m²");
});
