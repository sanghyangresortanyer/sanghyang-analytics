import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCompsetAudit } from "../../src/lib/market/compset-audit";
import { compsetRationale, sanghyangAuditSummary } from "../../src/lib/market/compset-rationale";
import { EXCLUDED_HOTELS } from "../../src/lib/market/hotel-compset";
import { loadResortMarketSize } from "../../src/lib/market/market-size";
import { loadPlaceSpecsMap } from "../../src/lib/market/place-specs";
import { OUTLET_MARKET_SHARE_DATA } from "../../src/lib/market/pricing-benchmark";

const auditReady = loadResortMarketSize().then(loadCompsetAudit);
const AI_ENGINE_RE = /\b(gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm)\b/i;
const FORBIDDEN_TERMS_RE = /\b(pesaing|registri|crawl4ai|playwright)\b/i;

async function reasonOf(outlet: string, name: string): Promise<string> {
  const item = (await auditReady)[outlet].used.find((c) => c.name === name);
  assert.ok(item?.auditRationale, `${name} pembanding ${outlet} beserta alasannya`);
  return item.auditRationale;
}

test("teks audit pembanding tidak menanam nama tempat kompetitor di kode (kompetitor baru otomatis terjelaskan)", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/lib/market/compset-rationale.ts"), "utf8");
  const registryNames = /\b(beach point|kamalika|campo del sol|andalan|star queen|angel karaoke|mambruk|lighthouse|upper circle|bellezza|nemuru|marbella|jayakarta|aston|novus|m[oö]venpick|hawaii|pisita)\b/i;
  assert.doesNotMatch(source, registryNames);
});

test("audit pembanding: ringkas, menyertakan skor holistik, bebas istilah pesaing/registri/alat/AI, dan unik per tempat di semua outlet", async () => {
  for (const [outlet, { used, excluded }] of Object.entries(await auditReady)) {
    assert.ok(used.length > 0, `${outlet} punya pembanding`);
    for (const c of used) {
      const text = c.auditRationale ?? "";
      assert.doesNotMatch(text, /Memenuhi aturan/, `${outlet}: ${c.name}`);
      assert.doesNotMatch(text, AI_ENGINE_RE, `${outlet}: ${c.name} bebas nama mesin AI`);
      assert.doesNotMatch(text, FORBIDDEN_TERMS_RE, `${outlet}: ${c.name} bebas kata pesaing/registri/alat (${text})`);
      assert.doesNotMatch(c.evidenceSource ?? "", FORBIDDEN_TERMS_RE, `${outlet}: ${c.name} evidenceSource bersih`);
      assert.ok(text.split(/(?<=\.)\s+(?=[A-Z])/).length <= 6, `${outlet}: ${c.name} paling banyak 6 kalimat pendek (${text})`);
      assert.ok(typeof c.relevanceScore === "number" && c.relevanceScore > 0, `${outlet}: ${c.name} punya relevanceScore holistik`);
    }
    for (const ex of excluded) {
      assert.doesNotMatch(ex.reason, /\b(crawl4ai|playwright)\b/i, `${outlet}: excluded ${ex.name} bebas nama alat`);
    }
    assert.equal(new Set(used.map((c) => c.auditRationale)).size, used.length, `${outlet}: setiap tempat punya Audit pembanding unik`);
  }
});

test("audit pembanding Kamar & Resort: segmen tarif, tipe kamar (unit 2+ kamar tidur), dan kelebihan kompetitor vs Sanghyang", async () => {
  const mambruk = await reasonOf("resort", "Mambruk Hotel & Convention");
  assert.match(mambruk, /Tarif rata-rata \d,\d kali Sanghyang, di atas tarif termurah akhir pekan Sanghyang/);
  assert.match(mambruk, /tidak sebanding dengan unit keluarga Sanghyang/);
  assert.match(mambruk, /Sanghyang unggul di air panas alami/);
  assert.match(mambruk, /Acuan harga, tidak dihitung di pangsa pasar: tarif di atas rentang tarif Sanghyang/);

  const aston = await reasonOf("resort", "Aston Anyer Beach Hotel");
  assert.match(aston, /Hanya kamar 1 ruang/, "Aston tidak punya unit 2 kamar tidur");
  assert.match(aston, /Smart TV/, "kelebihan Smart TV Aston tercatat");
  assert.match(aston, /unit keluarga 2 kamar tidur/, "keunggulan unit keluarga Sanghyang disebut");
  assert.doesNotMatch(aston, /Escape the bustle|beachfront retreat/, "teks situs berbahasa Inggris tidak dikutip");

  const marbella = await reasonOf("resort", "Marbella Place Anyer by Jayakarta");
  assert.match(marbella, /masih satu segmen harga/);
  assert.match(marbella, /unit 2\+ kamar tidur seluas \d+–\d+ m² yang sebanding/);
  assert.match(marbella, /Skor holistik \d+\/100\./);

  // My Pisita belum tentu ikut crawl CI terbaru; alasannya harus jujur terhadap data tarif yang sedang dipakai.
  const ratesData = JSON.parse(readFileSync(path.join(process.cwd(), "src/lib/market/resort-room-rates.data.json"), "utf8")) as {
    lowestByHotel: { hotelId: string }[];
  };
  const pisitaRated = ratesData.lowestByHotel.some((h) => h.hotelId === "my_pisita_anyer");
  assert.match(
    await reasonOf("resort", "My Pisita Anyer Resort"),
    pisitaRated ? /di bawah tarif termurah hari biasa Sanghyang/ : /Tarif OTA belum ada data/,
  );
});

test("audit pembanding Sanghyang sendiri: tarif, tipe kamar, dan fasilitas dari data resmi, tanpa kata acuan", async () => {
  const specs = await loadPlaceSpecsMap();
  const ownResort = sanghyangAuditSummary({
    outlet: "resort",
    ownAdr: 504713,
    ownRoomCount: 61,
    ownRating: 4.4,
    ownReviewCount: 3049,
    ownSpecs: specs.get("sanghyang") ?? null,
  });
  assert.match(ownResort, /7 tipe kamar, 5 di antaranya unit 2 kamar tidur/);
  assert.match(ownResort, /air panas alami/);
  assert.match(ownResort, /Smart TV/);
  assert.doesNotMatch(ownResort, /\bacuan\b/i, "tidak memakai kata acuan agar tidak rancu dengan peran benchmark");

  const ownBistro = sanghyangAuditSummary({
    outlet: "dbistro",
    ownMenuItemCount: 24,
    ownMenuRange: { min: 40000, max: 150000 },
    ownRating: 4.6,
    ownReviewCount: 41,
    ownSpecs: specs.get("dbistro_sanghyang") ?? null,
  });
  assert.match(ownBistro, /24 menu resmi/);
  assert.match(ownBistro, /all-day dining/i, "konsep outlet dibaca dari fakta situs resmi");
  assert.doesNotMatch(ownBistro, /\bacuan\b/i);
});

test("audit pembanding F&B, bar, dan spa: harga menu, kesamaan konsep dari data, kelebihan kompetitor vs Sanghyang", async () => {
  const infinity = await reasonOf("dbistro", "Infinity Restaurant Mambruk");
  assert.match(infinity, /Mambruk Hotel & Convention/);
  assert.match(infinity, /Menu sebanding \d+% lebih mahal dari D'Bistro/);
  assert.match(infinity, /Acuan D'Bistro .*hotel induknya berstatus acuan/);

  const elPatio = await reasonOf("dbistro", "El Patio Marbella");
  assert.match(elPatio, /Belanja Rp 75\.000–100\.000\/orang/);
  assert.match(elPatio, /Kompetitor inti D'Bistro/);

  const pier = await reasonOf("dbistro", "Hotel Pier Aston Anyer");
  assert.doesNotMatch(pier, /signature dining|overwater restaurant/, "teks situs berbahasa Inggris tidak dikutip");
  assert.doesNotMatch(pier, /Rp /, "tanpa harga bersumber, harga tidak disebut");

  const kamalika = await reasonOf("sunset-grill", "Kamalika Beach Cafe & Resto");
  assert.match(kamalika, /Kesamaan: lokasi tepi pantai\/laut/);
  assert.match(kamalika, /Kompetitor inti Sunset Grill/);

  assert.match(await reasonOf("dbar", "Happy Puppy Karaoke"), /karaoke/);
  const altaSpa = await reasonOf("dspa", "Alta Spa Marbella Anyer");
  // Honeymooner (2 orang) di luar kisaran per porsi (keputusan pemilik 22 Nov 2026).
  assert.match(altaSpa, /Rp 150\.000–750\.000/);
  assert.match(altaSpa, /kolam air panas alami/);

  const angel = await reasonOf("dragon-beach-club", "Angel Karaoke & Lounge");
  assert.match(angel, /Acuan Dragon Beach Club, tidak dihitung di pangsa pasar: 17 ulasan Google, di bawah 50/);
});

test("audit pembanding di Semua Outlet menyebut daftar outlet dan peran acuan menyebut aturan yang tidak dipenuhi", async () => {
  assert.match(await reasonOf("all", "Lighthouse Restaurant & Bar Mambruk"), /Acuan D'Bistro dan D'Bar & Karaoke/);

  const allisa = EXCLUDED_HOTELS.find((h) => h.hotelId === "allisa");
  assert.ok(allisa, "Allisa ada di data kompset sebagai hotel yang dikeluarkan");
  const reason = compsetRationale(
    {
      name: allisa.name,
      category: allisa.group,
      outlets: ["resort"],
      starRating: allisa.googleStars,
      roomCount: allisa.roomCount,
      roadKm: allisa.roadKm,
      driveMinutes: allisa.driveMinutes,
      distanceSource: null,
      rating: null,
      reviewCount: null,
      compsetRole: "benchmark",
      facts: [],
      parent: null,
    },
    "resort",
    { own: { starRating: 4, seaside: true }, market: null, rates: null, menu: null },
  );
  assert.match(reason, /Acuan harga, tidak dihitung di pangsa pasar: Bintang 2, di bawah bintang 4 Sanghyang\./);

  const staticMambruk = OUTLET_MARKET_SHARE_DATA.resort.benchmarkCompetitors.find((c) => c.name === "Mambruk Hotel & Convention");
  assert.match(staticMambruk?.auditRationale ?? "", /Tarif rata-rata \d+% di atas Sanghyang/);
  assert.doesNotMatch(staticMambruk?.auditRationale ?? "", /Memenuhi aturan/);
});
