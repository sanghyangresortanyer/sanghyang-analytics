import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getActiveCompetitors,
  getHotelCompset,
  getHotelRateTargets,
  getVenuesForOutlet,
  getCompetitorByPlaceId,
  getCompetitorById,
  COMPSET_RADIUS_KM,
} from "../../src/lib/market/competitor-repository";
import { db } from "../../src/lib/db";

test("Registri Tunggal - Penggabungan duplikat Aston Anyer Beach Hotel", async () => {
  // Hanya ada 1 baris Aston Anyer Beach Hotel aktif di database
  const astonRows = await db.competitor.findMany({
    where: {
      name: { contains: "Aston Anyer Beach Hotel" },
    },
  });

  assert.equal(astonRows.length, 1, "Harus hanya ada 1 baris Aston Anyer Beach Hotel di DB (duplikat telah digabung)");
  const aston = astonRows[0];
  assert.equal(aston.id, "10000000-0000-4000-8000-000000000001");
  assert.equal(aston.active, true);
  assert.ok(aston.roadKm !== null && aston.roadKm <= COMPSET_RADIUS_KM, "Aston harus berada dalam radius 25 km");

  // Promosi Aston tidak hilang (telah dialihkan ke id tunggal)
  const astonPromos = await db.competitorPromotion.count({
    where: { competitorId: aston.id },
  });
  assert.ok(astonPromos > 0, `Promosi Aston harus tersambung ke ID tunggal (ditemukan: ${astonPromos})`);
});

test("Registri Tunggal - Status pensiun Patra Anyer Hotel", async () => {
  const patra = await db.competitor.findFirst({
    where: { name: { contains: "Patra" } },
  });

  assert.ok(patra, "Patra Anyer Hotel harus ada di database");
  assert.equal(patra.active, false, "Patra Anyer Hotel harus berstatus active: false");
  assert.ok(patra.retiredReason, "Patra Anyer Hotel harus memiliki catatan alasan pensiun");
  assert.match(patra.retiredReason, /bintang 3/i);
});

test("Registri Tunggal - Registri kompetitor aktif memuat compset utama", async () => {
  const allActive = await getActiveCompetitors();
  assert.ok(allActive.length >= 20, `Harus mengembalikan seluruh kompetitor aktif (ditemukan: ${allActive.length})`);

  const compset = await getHotelCompset();
  assert.ok(compset.length >= 7, `Compset hotel harus memuat Sanghyang dan enam pembanding inti (ditemukan: ${compset.length})`);

  // Pastikan properti kunci ada dalam registri
  const names = compset.map((h) => h.name.toLowerCase());
  assert.ok(names.some((n) => n.includes("sanghyang")), "Sanghyang harus ada dalam registri");
  assert.ok(names.some((n) => n.includes("aston")), "Aston harus ada dalam registri");
  assert.ok(names.some((n) => n.includes("mambruk")), "Mambruk harus ada dalam registri");
  assert.ok(names.some((n) => n.includes("jayakarta")), "Jayakarta harus ada dalam registri");
  assert.ok(names.some((n) => n.includes("marbella")), "Marbella harus ada dalam registri");
  assert.ok(names.some((n) => n.includes("nemuru")), "Nemuru harus ada dalam registri");
  assert.ok(names.some((n) => n.includes("pisita")), "My Pisita harus ada dalam registri");
  assert.ok(!names.some((n) => n.includes("patra")), "Patra Anyer (bintang 3 di semua sumber) tidak masuk kompset");
  // Keputusan pemakai 13 Nov 2026: bintang di bawah 4 atau lebih dari 25 km jarak tempuh tidak masuk kompset.
  assert.ok(!names.some((n) => n.includes("allisa")), "Allisa (bintang 2–3) tidak boleh ada di kompset");
  assert.ok(!names.some((n) => n.includes("mutiara carita")), "Mutiara Carita (34,3 km) tidak boleh ada di kompset");

  // Setiap properti dalam compset memiliki data jarak terukur
  for (const h of compset) {
    assert.ok(typeof h.roadKm === "number", `Properti ${h.name} harus memiliki roadKm terukur`);
    assert.ok(h.roadKm >= 0, `roadKm ${h.name} tidak boleh negatif`);
  }
});

test("Registri Tunggal - Pemetaan outlet Sanghyang dan kategori venue", async () => {
  const sunsetGrillVenues = await getVenuesForOutlet("sunset-grill");
  assert.ok(sunsetGrillVenues.length > 0, "Harus ada venue kompetitor yang dipetakan ke Sunset Grill");

  const dbarVenues = await getVenuesForOutlet("dbar");
  assert.ok(dbarVenues.length > 0, "Harus ada venue kompetitor yang dipetakan ke D'Bar & Karaoke");

  for (const v of sunsetGrillVenues) {
    assert.equal(v.active, true, `Venue ${v.name} yang dipetakan harus aktif`);
    assert.ok(v.outlets.includes("sunset-grill"), `Venue ${v.name} harus mencantumkan sunset-grill di array outlets`);
  }
});

test("Registri Tunggal - Pencarian berbasis placeId dan id", async () => {
  const sanghyang = await getCompetitorByPlaceId("sanghyang");
  assert.ok(sanghyang, "Pencarian placeId 'sanghyang' harus menghasilkan entri Sanghyang");
  assert.equal(sanghyang.placeId, "sanghyang");

  const byId = await getCompetitorById(sanghyang.id);
  assert.ok(byId, "Pencarian berdasarkan id harus berhasil");
  assert.equal(byId.id, sanghyang.id);
});

test("Registri Tunggal - getHotelRateTargets hanya mengembalikan target aktif dengan ratesUrl", async () => {
  const targets = await getHotelRateTargets();
  assert.ok(targets.length >= 6, `Target tarif aktif harus mencakup minimal 6 properti (ditemukan: ${targets.length})`);

  for (const target of targets) {
    assert.ok(target.url, `Target ${target.name} harus memiliki URL tarif valid`);
    assert.ok(target.url.startsWith("http"), `URL tarif ${target.name} harus berupa HTTP/HTTPS URL`);
    assert.ok(target.name, "Target harus memiliki nama");
  }
});

// Akun Instagram resmi Star Queen: alamat di bio-nya sama dengan alamat Google Maps (diperiksa pemakai 15 Nov 2026).
const STAR_QUEEN_INSTAGRAM = "https://www.instagram.com/starqueen2236/";
const STAR_QUEEN_ADDRESS = "Jl. Lingkar Selatan Km.1,8 Ds.Harjatani Kec.Kramatwatu Serang-Cilegon Banten";
const INSTAGRAM_PROFILE = /^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/?$/;
const TIKTOK_ACCOUNT = /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._]+\/?$/;
const seedSource = (file: string) => fs.readFileSync(path.resolve(process.cwd(), "scripts/ops", file), "utf-8");

test("Registri Tunggal - Star Queen memakai akun Instagram resmi dan alamat dari bio-nya, beserta bukti verifikasinya", async () => {
  const row = await db.competitor.findFirst({ where: { placeId: "star_queen_restoran_n_karaoke_cilegon" } });
  assert.ok(row, "Star Queen ada di registri");
  assert.equal(row.instagramUrl, STAR_QUEEN_INSTAGRAM);
  assert.equal(row.address, STAR_QUEEN_ADDRESS);
  for (const evidence of [/bio Instagram/, /Google Maps/, /15 Nov 2026/]) assert.match(row.notes ?? "", evidence);
  const seed = seedSource("seed-competitor-registry.ts");
  assert.ok(seed.includes(STAR_QUEEN_INSTAGRAM) && seed.includes(STAR_QUEEN_ADDRESS), "seed berikutnya tidak boleh mengembalikan alamat 'Cilegon' tanpa akun");
});

test("Registri Tunggal - kolom akun sosial hanya berisi profil akun, bukan URL pencarian atau halaman tagar", async () => {
  const rows = await db.competitor.findMany({ select: { name: true, instagramUrl: true, tiktokUrl: true } });
  for (const r of rows) {
    if (r.instagramUrl) assert.match(r.instagramUrl, INSTAGRAM_PROFILE, `${r.name}: instagramUrl bukan profil Instagram`);
    if (r.tiktokUrl) assert.match(r.tiktokUrl, TIKTOK_ACCOUNT, `${r.name}: tiktokUrl bukan akun TikTok`);
  }
});

// Audit holistik 20 Nov 2026: D'Bistro restoran hotel, Sunset Grill open-air beach lounge/cafe/seafood/pool bar
// (termasuk Campo del Sol Pool Bar Marbella), Dragon Beach Club beach club/bar/nightlife/karaoke (termasuk Star Queen),
// sedangkan warung/RM pinggir jalan tanpa konsep pantai/lounge & tanpa menu diarsipkan.
const HOTEL_RESTOS = [
  "Hotel Pier Aston Anyer",
  "Sunset Cafe Aston Anyer",
  "El Patio Marbella",
  "Infinity Restaurant Mambruk",
  "Lagoon Restaurant Jayakarta",
  "TEMU KATSU RESTO Nemuru Palazo",
];
const ACTIVE_STANDALONE_SUNSET_RESTOS = [
  "Andalan Beach Resto & Coffee",
  "Kamalika Beach Cafe & Resto",
  "Beach Point Anyer",
];
const SEED_STANDALONE_RESTOS = [
  ...ACTIVE_STANDALONE_SUNSET_RESTOS,
  "RM.MUARO",
  "RM. Benhil Jaya Seafood Anyer",
  "Rumah Makan Sunset",
  "Ikan Bakar Tanjung Pinang 88",
  "Kembang Sari Anyer",
  "Warung Ikan Bakar ABAH JUNED",
  "RM 195 Seafood",
];

const activeRestoRivals = () =>
  db.competitor.findMany({
    where: { active: true, compsetRole: { not: null }, category: "resto" },
    select: { name: true, outlets: true, parentId: true },
  });

test("Pemetaan outlet - tidak ada restoran hotel di pembanding Sunset Grill", async () => {
  const inHotel = (await activeRestoRivals()).filter((r) => r.parentId !== null);
  assert.ok(inHotel.length >= HOTEL_RESTOS.length, `restoran hotel aktif: ${inHotel.length}`);
  for (const r of inHotel) {
    assert.ok(!r.outlets.includes("sunset-grill"), `${r.name} restoran hotel, bukan kompetitor Sunset Grill (outlets: ${r.outlets.join(", ")})`);
    assert.ok(r.outlets.includes("dbistro"), `${r.name} restoran hotel, kompetitor D'Bistro`);
  }
});

test("Pemetaan outlet - tidak ada resto atau kafe mandiri di pembanding D'Bistro", async () => {
  const standalone = (await activeRestoRivals()).filter((r) => r.parentId === null);
  assert.ok(standalone.length >= ACTIVE_STANDALONE_SUNSET_RESTOS.length, `resto mandiri aktif: ${standalone.length}`);
  for (const r of standalone) {
    assert.ok(!r.outlets.includes("dbistro"), `${r.name} resto mandiri, bukan kompetitor D'Bistro (outlets: ${r.outlets.join(", ")})`);
    assert.ok(r.outlets.includes("sunset-grill"), `${r.name} resto mandiri, kompetitor Sunset Grill`);
  }
});

test("Pemetaan outlet - audit holistik: Sunset Grill (termasuk Campo del Sol), DBC (Star Queen, tanpa kafe pantai siang), dan arsip Angel Karaoke", async () => {
  const rows = await db.competitor.findMany({
    where: {
      name: {
        in: [
          ...HOTEL_RESTOS,
          ...ACTIVE_STANDALONE_SUNSET_RESTOS,
          "Campo del Sol Pool Bar Marbella",
          "Lighthouse Restaurant & Bar Mambruk",
          "Star Queen Restoran N Karaoke Cilegon",
          "Angel Karaoke & Lounge",
        ],
      },
    },
    select: { name: true, outlets: true, parentId: true, active: true, retiredReason: true },
  });
  const outletsOf = (name: string) => {
    const row = rows.find((r) => r.name === name);
    assert.ok(row?.active, `${name} ada dan aktif di daftar kompetitor`);
    return row.outlets;
  };
  for (const name of HOTEL_RESTOS) assert.deepEqual(outletsOf(name), ["dbistro"], name);
  for (const name of ACTIVE_STANDALONE_SUNSET_RESTOS) {
    assert.ok(outletsOf(name).includes("sunset-grill") && !outletsOf(name).includes("dbistro"), name);
  }
  // Sunset Grill holistik: Beach Point, Kamalika, Campo del Sol Pool Bar Marbella; kafe siang/pool bar tidak salah kamar di DBC
  assert.ok(outletsOf("Campo del Sol Pool Bar Marbella").includes("sunset-grill"), "Campo del Sol Pool Bar masuk Sunset Grill");
  assert.ok(!outletsOf("Campo del Sol Pool Bar Marbella").includes("dragon-beach-club"), "Campo del Sol Pool Bar tidak masuk Dragon Beach Club");
  for (const name of ["Kamalika Beach Cafe & Resto", "Beach Point Anyer"]) {
    assert.ok(!outletsOf(name).includes("dragon-beach-club"), `${name} tidak salah kamar di Dragon Beach Club`);
  }
  // Dragon Beach Club holistik: Star Queen + Lighthouse + pool bar/lounge + Angel Karaoke (benchmark)
  assert.ok(outletsOf("Star Queen Restoran N Karaoke Cilegon").includes("dragon-beach-club"), "Star Queen masuk Dragon Beach Club");
  const lighthouse = outletsOf("Lighthouse Restaurant & Bar Mambruk");
  for (const outlet of ["dbistro", "dbar"]) assert.ok(lighthouse.includes(outlet), `Lighthouse tetap di ${outlet}`);
  assert.ok(!lighthouse.includes("dragon-beach-club"), "Lighthouse tidak masuk Dragon Beach Club");
  // Angel Karaoke & Lounge aktif sebagai benchmark Dragon Beach Club (koridor JLS)
  const angel = rows.find((r) => r.name === "Angel Karaoke & Lounge");
  assert.ok(angel && angel.active === true && angel.outlets.includes("dragon-beach-club"), "Angel Karaoke & Lounge aktif di Dragon Beach Club");
});

test("Pemetaan outlet - seed registri tidak mengembalikan resto mandiri ke D'Bistro", () => {
  const seed = seedSource("seed-competitor-registry.ts");
  for (const name of SEED_STANDALONE_RESTOS) {
    const entry = seed.match(new RegExp(`name: "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",[\\s\\S]*?outlets: \\[([^\\]]*)\\]`));
    assert.ok(entry, `seed memuat ${name}`);
    assert.doesNotMatch(entry[1], /dbistro/, `seed ${name}: ${entry[1]}`);
    assert.match(entry[1], /sunset-grill/, `seed ${name}: ${entry[1]}`);
  }
});
