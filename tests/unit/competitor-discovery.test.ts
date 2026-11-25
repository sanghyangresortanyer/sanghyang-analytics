import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  candidateIneligibility,
  classifyPlace,
  competitorRowFor,
  ineligibleWithoutRoadDistance,
  mapsSearchUrl,
  matchRegistry,
  nearestLodging,
  normalizeName,
  originFromRegistry,
  parseOsrmRoute,
  parsePlacePage,
  parseSearchCard,
  straightLineKm,
  type DiscoveryCandidate,
  type MapsPlace,
  type MapsSearchCard,
  type RegistryPlace,
} from "../../src/lib/market/competitor-discovery";

// Data nyata 15 Nov 2026 (asal tiap bagian ada di "_sumber" berkas fixture): kartu pencarian Google Maps, halaman tempat,
// jawaban OSRM, dan potongan registri Competitor dari DB lokal.
const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/maps-discovery-2026-11-15.json"), "utf8")) as {
  searchCards: (MapsSearchCard & { query: string; searchUrl: string; observedAt: string })[];
  placePages: Record<"singleResult" | "lodging", { url: string; name: string; mainText: string; addressLabel: string | null }>;
  osrm: { observedAt: string; kembangSari: unknown; myPisita: unknown; invalidUrl: { status: number; body: unknown } };
  registry: RegistryPlace[];
  dryRunPlaces: MapsPlace[];
};

function card(name: string) {
  const found = fixture.searchCards.find((c) => c.name === name);
  assert.ok(found, `kartu ${name} ada di fixture`);
  return found;
}
const place = (name: string) => parseSearchCard(card(name));
const sanghyang = () => originFromRegistry(fixture.registry);
const eligibilityInput = (name: string) => {
  const p = place(name);
  return { ...p, cls: classifyPlace(p.googleType, p.name), straightKm: straightLineKm(sanghyang(), p) };
};

test("kartu hotel: rating, jumlah ulasan, kelas bintang, koordinat, dan id tempat Google terbaca", () => {
  const mambruk = place("Mambruk Hotel & Convention");
  assert.equal(mambruk.name, "Mambruk Hotel & Convention");
  assert.deepEqual([mambruk.rating, mambruk.reviewCount, mambruk.googleType, mambruk.starRating], [4.6, 9708, "Hotel", 4]);
  assert.equal(mambruk.address, null, "kartu hotel tidak memuat alamat");
  assert.equal(mambruk.featureId, "0x2e422a6bf3e2279d:0x7352b852bda8d71e");
  assert.equal(mambruk.googlePlaceId, "ChIJnSfi82sqQi4RHteovVK4UnM");
  assert.deepEqual([mambruk.lat, mambruk.lng], [-6.0730137, 105.8845296]);
  assert.ok(mambruk.mapsUrl.startsWith("https://www.google.com/maps/place/Mambruk+Hotel+%26+Convention/data="));
  assert.ok(!mambruk.mapsUrl.includes("?"), "parameter pelacak (authuser, g_ep, rclk) dibuang dari URL tempat");
  assert.equal(mambruk.sponsored, false);
});

test("kartu restoran: jenis Google dan alamat dipisah, glif ikon di antaranya tidak terbaca sebagai alamat", () => {
  const kembang = place("Kembang Sari Anyer");
  assert.deepEqual([kembang.googleType, kembang.address, kembang.rating, kembang.reviewCount, kembang.starRating], ["Restoran Seafood", "Jl. Raya Anyer-Sirih No.128", 4.5, 400, null]);
  const cemara = place("Rumah Makan Cemara Anyer");
  assert.deepEqual([cemara.googleType, cemara.address], ["Restoran Seafood", "Jl. Raya Anyer-Sirih No.129"]);
  const saung = place("Pantai Batu Saung");
  assert.deepEqual(
    [saung.googleType, saung.address, saung.reviewCount],
    ["Klub pantai", "Kawasan Wisata, Jl. Raya Karang Bolong, Km. 138, Kp. Teneng Desa Cinangka, Kecamatan Cinangka", 3720],
  );
});

test("kartu tanpa ulasan, kartu bersponsor, dan kartu vila dibaca apa adanya", () => {
  const urut = place("URUT");
  assert.deepEqual([urut.rating, urut.reviewCount, urut.googleType], [null, 0, "Layanan Kesehatan di Rumah"]);
  const reddoorz = place("RedDoorz Plus near Tugu Mercusuar Anyer");
  assert.equal(reddoorz.sponsored, true);
  assert.equal(reddoorz.googleType, null, "baris sesudah rating berisi harga, bukan jenis tempat");
  assert.deepEqual([reddoorz.rating, reddoorz.reviewCount], [3.4, 141]);
  const mutiara = place("Mutiara Carita Cottages");
  assert.deepEqual([mutiara.sponsored, mutiara.googleType, mutiara.starRating, mutiara.reviewCount], [true, "Hotel", 4, 2994]);
  const villa = place("Grand Anyer Palazo Boutique Resort");
  assert.deepEqual([villa.googleType, villa.starRating, villa.address], ["Vila", null, null]);
});

test("halaman satu tempat: koordinat diambil dari data tempat, bukan dari tengah peta di URL", () => {
  const dragon = parsePlacePage(fixture.placePages.singleResult);
  assert.equal(dragon.name, "Dragon Beach Club - Sanghyang Indah Spa Resort");
  assert.deepEqual([dragon.lat, dragon.lng], [-6.0623289, 105.8985666], "@-6.0624549,105.9001458 di URL adalah tengah peta");
  assert.deepEqual([dragon.rating, dragon.reviewCount, dragon.googleType], [4.1, 41, "Klub Malam"]);
  assert.equal(dragon.address, "Jalan Raya Sirih No.KM. 128, Cikoneng, Kec. Anyar, Kabupaten Serang, Banten 42166");
  const pisita = parsePlacePage(fixture.placePages.lodging);
  assert.deepEqual([pisita.rating, pisita.reviewCount, pisita.googleType, pisita.starRating], [4.3, 4696, "Hotel", 4]);
  assert.equal(pisita.address, "Jl. Raya Anyer-Sirih No.Km.129, Anyar, Kec. Anyar, Kabupaten Serang, Banten 42166");
});

test("normalisasi nama: diakritik, apostrof, tanda baca, huruf besar, dan kata sambung tidak membedakan nama", () => {
  assert.equal(normalizeName("Mövenpick Resort Carita"), "movenpick resort carita");
  assert.equal(normalizeName("D'Bar & Karaoke (Sanghyang)"), "dbar karaoke sanghyang");
  assert.equal(normalizeName("RM.MUARO"), "rm muaro");
  assert.equal(normalizeName("Ol’ Pops Coffee Cinangka"), "ol pops coffee cinangka");
  assert.equal(normalizeName("Marbella Place Anyer by Jayakarta"), "marbella place anyer jayakarta");
  assert.equal(normalizeName("THE WEST COVE HOTEL"), normalizeName("The West Cove Hotel"));
});

test("registri: tempat yang sudah tercatat dikenali lewat id tempat Google walau namanya berbeda", () => {
  const allisa = matchRegistry(place("Allisa Resort Hotel Anyer"), fixture.registry);
  assert.deepEqual([allisa?.entry.name, allisa?.by], ["Allisa Resort Anyer", "id tempat Google"]);
  // Outlet di dalam hotel memakai URL hotel induknya; kartu hotel harus jatuh ke baris hotel, bukan ke outletnya.
  assert.equal(matchRegistry(place("Marbella Place Anyer by Jayakarta"), fixture.registry)?.entry.name, "Marbella Place Anyer by Jayakarta");
  assert.equal(matchRegistry(place("Mutiara Carita Cottages"), fixture.registry)?.entry.name, "Mutiara Carita Cottages");
  // Dry-run 16 Nov 2026: "Sunset Bar & Lounge ASTON" (arsip, tanpa parentId) memakai URL Aston; kartu hotel tetap jatuh ke baris hotel.
  const aston = fixture.dryRunPlaces.find((p) => p.name === "Aston Anyer Beach Hotel");
  assert.ok(aston, "tempat Aston dari dry-run ada di fixture");
  // findMany tanpa orderBy tidak menjamin urutan baris, jadi hasilnya harus sama untuk urutan mana pun.
  for (const registry of [fixture.registry, [...fixture.registry].reverse()]) {
    assert.equal(matchRegistry(aston, registry)?.entry.name, "Aston Anyer Beach Hotel");
  }
});

test("registri: baris tanpa URL dikenali lewat nama, outlet sendiri dan outlet hotel lewat nama dan lokasi", () => {
  const westCove = matchRegistry(place("THE WEST COVE HOTEL"), fixture.registry);
  assert.deepEqual([westCove?.entry.name, westCove?.by], ["The West Cove Hotel Anyer", "nama"]);
  const dragon = matchRegistry(place("Dragon Beach Club - Sanghyang Indah Spa Resort"), fixture.registry);
  assert.deepEqual([dragon?.entry.name, dragon?.by], ["Dragon Beach Club (Sanghyang)", "nama dan lokasi"]);
  assert.equal(matchRegistry(place("d'Spa Terapi Air Panas Alami"), fixture.registry)?.entry.name, "D'Spa & Hot Spring Aquamedic (Sanghyang)");
  // Campo del Sol 138 m dari titik Marbella dan berbagi kata "marbella" dengan hotelnya; baris outletnya yang paling mirip.
  assert.equal(matchRegistry(place("Campo del Sol Pool Bar - Marbella Hotel"), fixture.registry)?.entry.name, "Campo del Sol Pool Bar Marbella");
  assert.equal(matchRegistry(place("Oceana Pool Bar"), fixture.registry)?.entry.name, "Oceana Pool Bar Mövenpick");
});

test("registri: tempat baru tidak ikut tercocokkan, termasuk yang dekat tetapi namanya lain atau hanya kata umum", () => {
  // Way's Cafe 266 m dari titik Mambruk; "Spa" 176 m dari Marbella tetapi namanya hanya kata umum.
  for (const name of ["My Pisita Anyer Resort", "Kembang Sari Anyer", "Way's Cafe Anyer", "Spa", "Pantai Batu Saung"]) {
    assert.equal(matchRegistry(place(name), fixture.registry), null, `${name} bukan baris registri mana pun`);
  }
});

test("jenis tempat Google menentukan kategori registri dan outlet Sanghyang pembandingnya", () => {
  assert.deepEqual(classifyPlace("Hotel", "My Pisita Anyer Resort"), { kind: "penginapan", category: "resort", outlets: ["resort"] });
  assert.deepEqual(classifyPlace("Hotel", "Mambruk Hotel & Convention"), { kind: "penginapan", category: "hotel", outlets: ["resort"] });
  // Keputusan pemilik 16 Nov 2026: resto dan kafe mandiri pesaing Sunset Grill, bukan D'Bistro (restoran hotel).
  assert.deepEqual(classifyPlace("Restoran Seafood", "Kembang Sari Anyer"), { kind: "restoran", category: "resto", outlets: ["sunset-grill"] });
  assert.deepEqual(classifyPlace("Kafe", "Way's Cafe Anyer"), { kind: "kafe", category: "resto", outlets: ["sunset-grill"] });
  assert.deepEqual(classifyPlace("Kafe", "Pantai Pandan Carita Cafe and Resto"), { kind: "kafe", category: "resto", outlets: ["sunset-grill", "dragon-beach-club"] });
  assert.deepEqual(classifyPlace("Klub pantai", "Pantai Batu Saung"), { kind: "beach club", category: "bar", outlets: ["dbar", "dragon-beach-club"] });
  assert.deepEqual(classifyPlace("Klub Malam", "Dragon Beach Club - Sanghyang Indah Spa Resort"), { kind: "beach club", category: "bar", outlets: ["dbar", "dragon-beach-club"] });
  assert.deepEqual(classifyPlace("Bar Olahraga", "TONS Billiard & Warmindo"), { kind: "bar", category: "bar", outlets: ["dbar"] });
  assert.deepEqual(classifyPlace("Klub Spa dan Kesehatan", "d'Spa Terapi Air Panas Alami"), { kind: "spa", category: "spa", outlets: ["dspa"] });
  for (const type of ["Toko Es Krim", "Klub Olahraga", "Salon Kecantikan", "Layanan Kesehatan di Rumah", null]) {
    assert.equal(classifyPlace(type, "Tempat"), null, `${type} tidak sejenis dengan outlet Sanghyang`);
  }
});

test("kelayakan: aturan non-jarak dinilai dulu, jarak tempuh hanya diukur untuk tempat yang lolos", () => {
  const kembang = eligibilityInput("Kembang Sari Anyer");
  assert.equal(kembang.straightKm, 2.8);
  assert.equal(ineligibleWithoutRoadDistance(kembang), null, "lolos aturan non-jarak, jadi jarak tempuhnya diukur");
  assert.equal(candidateIneligibility({ ...kembang, roadKm: parseOsrmRoute(fixture.osrm.kembangSari).km }), null);
  const pisita = eligibilityInput("My Pisita Anyer Resort");
  assert.equal(ineligibleWithoutRoadDistance(pisita), null);
  assert.equal(candidateIneligibility({ ...pisita, roadKm: parseOsrmRoute(fixture.osrm.myPisita).km }), null);
  assert.match(candidateIneligibility({ ...pisita, roadKm: null }) ?? "", /belum diukur/, "tanpa jarak tempuh tidak ada yang layak");

  assert.equal(ineligibleWithoutRoadDistance(eligibilityInput("Green Garden Resort")), "Bintang 3, di bawah bintang 4 Sanghyang.");
  assert.equal(ineligibleWithoutRoadDistance(eligibilityInput("Grand Anyer Palazo Boutique Resort")), "Kelas bintang belum diketahui.");
  assert.equal(ineligibleWithoutRoadDistance(eligibilityInput("Spa")), "1 ulasan Google, di bawah 50: pasarnya terlalu kecil untuk dibandingkan.");
  assert.equal(ineligibleWithoutRoadDistance(eligibilityInput("Momoyo Anyer")), 'Jenis tempat Google "Toko Es Krim" tidak sejenis dengan outlet Sanghyang.');
  assert.equal(ineligibleWithoutRoadDistance(eligibilityInput("RedDoorz Plus near Tugu Mercusuar Anyer")), "Jenis tempat tidak tampil di kartu Google Maps.");
  // "Jl. Anyer I" di Jakarta dan Cinangka di Depok: nama wilayah yang sama, tempatnya jauh.
  assert.match(ineligibleWithoutRoadDistance(eligibilityInput("Eklusive massage home spa")) ?? "", /^Jarak garis lurus 105,4 km dari Sanghyang/);
  assert.match(ineligibleWithoutRoadDistance(eligibilityInput("Pantai Pandan Carita Cafe and Resto")) ?? "", /^Jarak garis lurus 27,5 km/);
});

test("outlet di sebelah hotel dicatat sebagai petunjuk untuk pemilik", () => {
  assert.deepEqual(nearestLodging(place("Spa"), fixture.registry), { name: "Marbella Place Anyer by Jayakarta", meters: 176 });
  assert.equal(nearestLodging(place("Kembang Sari Anyer"), fixture.registry), null);
});

test("OSRM: jarak dan durasi dibaca dari jawaban nyata, jawaban galat dilempar", () => {
  assert.deepEqual(parseOsrmRoute(fixture.osrm.kembangSari), { km: 3.3, minutes: 3 });
  assert.deepEqual(parseOsrmRoute(fixture.osrm.myPisita), { km: 0.7, minutes: 1 });
  assert.throws(() => parseOsrmRoute(fixture.osrm.invalidUrl.body), /InvalidUrl/);
});

test("pencarian berjangkar di koordinat Sanghyang dari registri supaya nama wilayah tidak melompat ke kota lain", () => {
  const origin = sanghyang();
  assert.deepEqual([origin.name, origin.lat, origin.lng], ["Sanghyang Indah Spa Resort", -6.0624549, 105.9001458]);
  assert.equal(mapsSearchUrl("rumah makan", "Cinangka", origin), "https://www.google.com/maps/search/rumah+makan+Cinangka/@-6.0624549,105.9001458,12z?hl=id");
});

test("baris registri baru: hanya kandidat layak, dengan sumber jarak OSRM dan catatan untuk pemilik", () => {
  const kembangCard = card("Kembang Sari Anyer");
  const kembang = parseSearchCard(kembangCard);
  const candidate: DiscoveryCandidate = {
    place: { ...kembang, foundBy: [kembangCard.query], observedAt: kembangCard.observedAt },
    cls: classifyPlace(kembang.googleType, kembang.name),
    straightKm: straightLineKm(sanghyang(), kembang),
    road: { ...parseOsrmRoute(fixture.osrm.kembangSari), measuredAt: fixture.osrm.observedAt },
    reason: null,
    nearLodging: null,
  };
  const row = competitorRowFor(candidate, sanghyang().name);
  assert.deepEqual(
    [row.name, row.category, row.group, row.outlets, row.placeId, row.active, row.compsetRole, row.verifiedAt],
    ["Kembang Sari Anyer", "resto", "resto", ["sunset-grill"], "kembang_sari_anyer", true, "inti", null],
  );
  assert.deepEqual([row.roadKm, row.straightKm, row.driveMinutes], [3.3, 2.8, null], "durasi OSRM tanpa lalu lintas tidak disimpan");
  assert.equal(row.distanceSource, "OSRM (router.project-osrm.org, mobil) dari Sanghyang Indah Spa Resort, diukur 15 Nov 2026");
  assert.equal(row.notes, "Ditemukan otomatis 15 Nov 2026 dari pencarian Google Maps; perlu dicek pemilik.");
  assert.deepEqual([row.googleMapsUrl, row.mapsUrl, row.ratingSourceUrl], [kembang.mapsUrl, kembang.mapsUrl, kembang.mapsUrl]);
  assert.deepEqual([row.address, row.rating, row.reviewCount, row.ratingSource, row.starRating], ["Jl. Raya Anyer-Sirih No.128", 4.5, 400, "Google Maps", null]);
  assert.throws(() => competitorRowFor({ ...candidate, reason: "1 ulasan Google, di bawah 50." }, sanghyang().name), /tidak layak/);
});
