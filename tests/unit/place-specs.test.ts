/**
 * Unit test untuk agregator spesifikasi tempat & fasilitas terstruktur (lib/market/place-specs.ts).
 * Menegakkan invarian Zero Mock Data, kelengkapan fasilitas multi-sumber, wawasan visual,
 * topik ulasan, dan provenance berizin sah.
 *
 * Jalankan: node --env-file=.env.development.local --test --import tsx tests/unit/place-specs.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  loadPlaceSpecsMap,
  getPlaceSpecs,
  summarizeFacilities,
} from "../../src/lib/market/place-specs";
import type { StoredFact } from "../../src/lib/market/competitor-facts";
import type { RoomSize } from "../../src/lib/market/hotel-compset";

test("summarizeFacilities: pemetaan deterministik fakta ke ringkasan terstruktur", () => {
  const facts: StoredFact[] = [
    {
      section: "kamar",
      key: "smart_tv",
      text: "Tersedia Smart TV 55 inci di seluruh 219 kamar dan suite.",
      quote: "55-inch Smart TV with streaming capabilities",
      sourceUrl: "https://example.com/rooms",
      observedAt: "2026-11-19",
    },
    {
      section: "kamar",
      key: "bathtub",
      text: "Bathtub elegan tersedia di tipe Junior Suite dan Family Suite.",
      quote: "soaking bathtub and walk-in rain shower",
      sourceUrl: "https://example.com/rooms",
      observedAt: "2026-11-19",
    },
    {
      section: "fasilitas",
      key: "infinity_pool",
      text: "Tersedia Lagoon swimming pool bertaraf internasional dan Oceana Pool Bar.",
      quote: "Expansive lagoon swimming pool",
      sourceUrl: "https://example.com/facilities",
      observedAt: "2026-11-19",
    },
    {
      section: "fasilitas",
      key: "hot_spring",
      text: "Tidak ada fasilitas air panas alami.",
      quote: "Kolam renang outdoor reguler",
      sourceUrl: "https://example.com/facilities",
      observedAt: "2026-11-19",
    },
    {
      section: "kamar",
      key: "luas_kamar",
      text: "Rentang luas kamar: 29–48 m² (Standard 29 m², Balcony Suite 48 m²).",
      quote: "Room sizes from 29 sqm standard room up to 48 sqm suite",
      sourceUrl: "https://example.com/rooms",
      observedAt: "2026-11-19",
    },
    {
      section: "kamar",
      key: "fasilitas_kamar",
      text: "Fasilitas kamar: AC, Smart TV, Wi-Fi gratis, minibar, pengering rambut.",
      quote: "AC, Smart TV, Wi-Fi, minibar, hairdryer",
      sourceUrl: "https://example.com/rooms",
      observedAt: "2026-11-19",
    },
    {
      section: "profil",
      key: "konsep_desain",
      text: "Resort bintang 5 kontemporer jaringan Accor.",
      quote: "Contemporary beachfront 5-star resort",
      sourceUrl: "https://example.com/about",
      observedAt: "2026-11-19",
    },
  ];

  const roomSizes: RoomSize[] = [
    { hotelId: "test_hotel", room: "Standard", sizeM2: 29, sourceUrl: "https://example.com", checkedAt: "2026-11-19" },
    { hotelId: "test_hotel", room: "Suite", sizeM2: 48, sourceUrl: "https://example.com", checkedAt: "2026-11-19" },
  ];

  const summary = summarizeFacilities(facts, roomSizes);

  assert.equal(summary.smartTv, true);
  assert.equal(summary.bathtub, true);
  assert.equal(summary.hotSpring, false);
  assert.deepEqual(summary.roomSizesM2, [29, 48]);
  assert.equal(summary.roomSizeRangeLabel, "29–48 m²");
  assert.ok(summary.keyAmenities.includes("AC"));
  assert.ok(summary.keyAmenities.includes("Bathtub"));
  assert.equal(summary.designStyle, "Resort bintang 5 kontemporer jaringan Accor.");
});

test("summarizeFacilities: menangani data kosong dengan anggun (Zero Mock)", () => {
  const summary = summarizeFacilities([], []);
  assert.equal(summary.smartTv, null);
  assert.equal(summary.smartTvNote, null);
  assert.equal(summary.bathtub, null);
  assert.equal(summary.bathtubNote, null);
  assert.equal(summary.infinityPool, null);
  assert.equal(summary.poolType, null);
  assert.equal(summary.hotSpring, null);
  assert.equal(summary.hotSpringNote, null);
  assert.deepEqual(summary.roomSizesM2, []);
  assert.equal(summary.roomSizeRangeLabel, null);
  assert.deepEqual(summary.keyAmenities, []);
  assert.equal(summary.designStyle, null);
  assert.equal(summary.usp, null);
});

test("loadPlaceSpecsMap: memuat spesifikasi lengkap untuk seluruh compset aktif", async () => {
  const specsMap = await loadPlaceSpecsMap();

  assert.ok(specsMap.size > 0, "Peta spesifikasi tidak boleh kosong");

  // Periksa keberadaan properti utama
  const sanghyang = specsMap.get("sanghyang");
  assert.ok(sanghyang, "Sanghyang harus ada di dalam peta");
  assert.equal(sanghyang.isSanghyang, true);
  assert.equal(sanghyang.placeId, "sanghyang");
  assert.equal(sanghyang.starRating, 4);
  assert.equal(sanghyang.roomCount, 61);
  assert.equal(sanghyang.facilities.hotSpring, true, "Sanghyang harus memiliki hotSpring = true");
  assert.ok(sanghyang.sources.length > 0, "Sanghyang harus memiliki sumber provenans");

  const aston = specsMap.get("aston_anyer");
  assert.ok(aston, "Aston Anyer harus ada di dalam peta");
  assert.equal(aston.isSanghyang, false);
  assert.equal(aston.facilities.hotSpring, false, "Aston tidak memiliki hot spring");
  assert.ok(aston.facilities.roomSizesM2.length > 0, "Aston harus memiliki data ukuran kamar m²");
  assert.ok(aston.sources.length > 0, "Aston harus memiliki sumber provenans");

  const mambruk = specsMap.get("mambruk");
  assert.ok(mambruk, "Mambruk harus ada di dalam peta");
  assert.equal(mambruk.isSanghyang, false);
  assert.equal(mambruk.starRating, 4);
  assert.ok(mambruk.sources.length > 0, "Mambruk harus memiliki sumber provenans");
});

test("loadPlaceSpecsMap: menyaring dengan benar berdasarkan outletKey", async () => {
  const resortMap = await loadPlaceSpecsMap("resort");
  assert.ok(resortMap.has("sanghyang"));
  assert.ok(resortMap.has("aston_anyer"));
  assert.ok(resortMap.has("mambruk"));

  const sunsetGrillMap = await loadPlaceSpecsMap("sunset-grill");
  assert.ok(sunsetGrillMap.has("sunset_grill_sanghyang"));
  // Semua entri di sunsetGrillMap wajib memiliki 'sunset-grill' di daftar outlet-nya
  for (const specs of sunsetGrillMap.values()) {
    assert.ok(
      specs.outlets.includes("sunset-grill"),
      `${specs.name} harus memiliki outlet 'sunset-grill'`,
    );
  }

  const dspaMap = await loadPlaceSpecsMap("dspa");
  assert.ok(dspaMap.has("dspa_sanghyang"));
  for (const specs of dspaMap.values()) {
    assert.ok(
      specs.outlets.includes("dspa"),
      `${specs.name} harus memiliki outlet 'dspa'`,
    );
  }
});

test("loadPlaceSpecsMap: memverifikasi integrasi VisualInsight dan galeri", async () => {
  const specsMap = await loadPlaceSpecsMap();

  // Nemuru Palazo memiliki visual insight terverifikasi
  const nemuru = specsMap.get("nemuru_palazo");
  assert.ok(nemuru, "Nemuru Palazo harus ada di registri");
  assert.ok(nemuru.visual, "Nemuru Palazo harus memiliki data visual insight");
  assert.ok(nemuru.visual.photoUrls.length > 0, "Nemuru harus memiliki foto galeri terverifikasi");
  assert.ok(nemuru.visual.designStyle, "Nemuru harus memiliki gaya arsitektur");

  // Lagoon Restaurant Jayakarta memiliki visual insight
  const lagoon = specsMap.get("lagoon_restaurant_jayakarta");
  assert.ok(lagoon, "Lagoon Restaurant Jayakarta harus ada di registri");
  assert.ok(lagoon.visual, "Lagoon Restaurant Jayakarta harus memiliki visual insight");
  assert.ok(lagoon.visual.photoUrls.length > 0, "Lagoon Restaurant harus memiliki URL foto");
});

test("getPlaceSpecs: mengambil spesifikasi tempat berdasarkan ID atau nama", async () => {
  const byId = await getPlaceSpecs("sanghyang");
  assert.ok(byId);
  assert.equal(byId.placeId, "sanghyang");

  const byName = await getPlaceSpecs("Aston Anyer Beach Hotel");
  assert.ok(byName);
  assert.equal(byName.placeId, "aston_anyer");

  const byOutletName = await getPlaceSpecs("Sunset Grill (Sanghyang)");
  assert.ok(byOutletName);
  assert.equal(byOutletName.placeId, "sunset_grill_sanghyang");

  const nonExistent = await getPlaceSpecs("Tempat Yang Tidak Pernah Ada");
  assert.equal(nonExistent, null);
});

test("Zero Mock Data & Provenance: setiap sumber memiliki URL sah dan tanggal observasi", async () => {
  const specsMap = await loadPlaceSpecsMap();
  for (const [placeId, specs] of specsMap.entries()) {
    for (const source of specs.sources) {
      assert.ok(source.label, `Sumber pada ${placeId} harus memiliki label`);
      assert.ok(source.url, `Sumber pada ${placeId} harus memiliki url`);
      assert.ok(source.observedAt, `Sumber pada ${placeId} harus memiliki tanggal observasi`);
      assert.ok(!source.url.includes("mock"), `URL sumber tidak boleh mengandung kata 'mock'`);
      assert.ok(!source.url.includes("placeholder"), `URL sumber tidak boleh mengandung kata 'placeholder'`);
    }
  }
});

test("sumber situs resmi bertanggal fakta terbaru dari host situs itu, bukan cap waktu periksa daftar kompetitor", async () => {
  const { db } = await import("../../src/lib/db");
  const { loadFacts } = await import("../../src/lib/market/competitor-facts");
  const hostOf = (u: string) => (URL.canParse(u) ? new URL(u).hostname.replace(/^www\./, "") : u);
  const specs = [...(await loadPlaceSpecsMap()).values()];
  const rows = await db.competitor.findMany({
    where: { id: { in: specs.map((s) => s.competitorId) } },
    select: { id: true, websiteUrl: true, verifiedAt: true },
  });
  const facts = await loadFacts(rows.map((r) => r.id));
  let checked = 0;
  for (const s of specs) {
    const row = rows.find((r) => r.id === s.competitorId);
    assert.ok(row, s.name);
    if (!row.websiteUrl || !URL.canParse(row.websiteUrl)) continue;
    const host = hostOf(row.websiteUrl);
    const dates = (facts.get(row.id) ?? []).filter((f) => f.sourceUrl && hostOf(f.sourceUrl) === host).map((f) => f.observedAt.slice(0, 10));
    const expected = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    const site = s.sources.find((src) => src.url === row.websiteUrl);
    if (expected === null) {
      assert.equal(site, undefined, `${s.name}: tanpa fakta dari ${host}, situs resmi tidak dicantumkan sebagai sumber bertanggal`);
    } else {
      assert.equal(site?.observedAt, expected, `${s.name}: tanggal situs resmi = fakta terbaru dari ${host}, bukan verifiedAt ${row.verifiedAt?.toISOString().slice(0, 10)}`);
    }
    checked++;
  }
  assert.ok(checked > 0, "ada tempat bersitus resmi yang diperiksa");
});
