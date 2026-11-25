import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HOLISTIC_DIMENSION_WEIGHTS,
  HOLISTIC_LODGING_WEIGHTS,
  HOLISTIC_SCORE_THRESHOLDS,
  ownerDecisionOf,
  reclassifyRegistry,
  scoreCompetitorHolistic,
  type HolisticCandidateInput,
  type HolisticReferenceContext,
  type RegistryCandidate,
} from "../../src/lib/market/competitor-holistic-matcher";
import { competitorMenu } from "../../src/lib/market/competitor-menu";
import type { OutletKey } from "../../src/lib/market/outlet-filters";

// Rekaman asli loadHolisticRegistry() dari DB kerja lokal dan berkas data repo, 21 Nov 2026 (scripts: .agents/local/probe).
interface RegistryFixture {
  references: Partial<Record<OutletKey, HolisticReferenceContext>>;
  candidates: RegistryCandidate[];
}
const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "tests/fixtures/holistic-registry-2026-11-21.json"), "utf8"),
) as RegistryFixture;
// Rekaman 21 Nov dibuat sebelum holisticReferencesOf mengisi bintang hotel Sanghyang untuk outlet di dalamnya (22 Nov).
// Nilainya bintang Kamar & Resort dari rekaman yang sama, persis seperti yang kini diisi loader.
const refs: Partial<Record<OutletKey, HolisticReferenceContext>> = Object.fromEntries(
  Object.entries(fixture.references).map(([outlet, ref]) => [outlet, { ...ref, ownStarRating: fixture.references.resort?.ownStarRating ?? null }]),
);
const row = (name: string) => {
  const hit = fixture.candidates.find((c) => c.name === name);
  assert.ok(hit, `${name} ada di fixture`);
  return hit;
};
const score = (name: string, outlet: OutletKey) => scoreCompetitorHolistic(row(name).input, outlet, refs[outlet]);

const FORBIDDEN_OUTPUT_RE = /\b(pesaing|registri|crawl4ai|playwright|gemini|flash[- ]?lite|claude|openai|chatgpt|gpt-?\d|llm)\b/i;

test("bobot 6 dimensi (umum dan penginapan) masing-masing berjumlah 1,0 dan ambang keputusan terurut", () => {
  for (const weights of [HOLISTIC_DIMENSION_WEIGHTS, HOLISTIC_LODGING_WEIGHTS]) {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `jumlah bobot harus 1, didapat ${sum}`);
    assert.equal(Object.keys(weights).length, 6);
  }
  assert.ok(HOLISTIC_LODGING_WEIGHTS.priceParity > HOLISTIC_DIMENSION_WEIGHTS.priceParity, "harga lebih menentukan untuk penginapan");
  assert.ok(HOLISTIC_SCORE_THRESHOLDS.core > HOLISTIC_SCORE_THRESHOLDS.benchmark);
});

test("aturan keras dari data asli: > 25 km, bintang < 4, dan tempat mandiri < 50 ulasan langsung arsip", () => {
  const mutiara = score("Mutiara Carita Cottages", "resort");
  assert.equal(mutiara.decision, "arsip");
  assert.match(mutiara.hardRuleReason ?? "", /25 km/);

  const patra = score("Patra Anyer Hotel", "resort");
  assert.equal(patra.decision, "arsip");
  assert.match(patra.hardRuleReason ?? "", /Bintang 3/);

  // Angel Karaoke & Lounge: 17 ulasan Google, di bawah syarat 50 ulasan tempat mandiri (keputusan 14 Nov 2026).
  for (const outlet of ["dragon-beach-club", "dbar"] as const) {
    const angel = score("Angel Karaoke & Lounge", outlet);
    assert.equal(angel.decision, "arsip", `${outlet}: ${angel.summary}`);
    assert.equal(angel.recommendedRole, null);
    assert.match(angel.hardRuleReason ?? "", /17 ulasan Google/);
  }
});

test("Kamar & Resort: skor membedakan segmen tarif, tipe kamar, dan konsep; inti wajib di dalam rentang tarif Sanghyang", () => {
  const inti = ["The Jayakarta Villas Anyer Beach Resort", "Marbella Place Anyer by Jayakarta", "Nemuru Grand Anyer Palazo", "Hawaii Resort Family Suites Anyer"];
  const acuan = ["Mambruk Hotel & Convention", "Aston Anyer Beach Hotel", "My Pisita Anyer Resort"];
  const arsip = ["Novus Jiva Anyer Villa, Resort & Spa", "Mövenpick Resort Carita"];
  for (const name of inti) assert.equal(score(name, "resort").decision, "inti", `${name}: ${score(name, "resort").summary}`);
  for (const name of acuan) assert.equal(score(name, "resort").decision, "benchmark", `${name}: ${score(name, "resort").summary}`);
  for (const name of arsip) assert.equal(score(name, "resort").decision, "arsip", `${name}: ${score(name, "resort").summary}`);

  // Tarif rata-rata Mambruk dan Aston sekitar 2,1 kali Sanghyang: di atas tarif termahal Sanghyang di jendela yang sama.
  for (const name of ["Mambruk Hotel & Convention", "Aston Anyer Beach Hotel"]) {
    const res = score(name, "resort");
    assert.match(res.dimensions.priceParity.reason, /di atas rentang tarif termurah Sanghyang/, name);
    assert.ok(res.dimensions.priceParity.score < 70, `${name} segmen tarif ${res.dimensions.priceParity.score}`);
  }
  assert.match(score("My Pisita Anyer Resort", "resort").dimensions.priceParity.reason, /di bawah rentang tarif/);

  // Aston tanpa unit 2 kamar tidur; Jayakarta punya unit keluarga yang sebanding dengan Sanghyang.
  assert.match(score("Aston Anyer Beach Hotel", "resort").dimensions.product.reason, /Hanya kamar 1 ruang/);
  assert.ok(score("The Jayakarta Villas Anyer Beach Resort", "resort").dimensions.product.score > score("Aston Anyer Beach Hotel", "resort").dimensions.product.score);

  // Konsep tidak lagi seragam 100: skornya berbeda antarhotel dan bintang 5 dikurangi.
  const concepts = new Set([...inti, ...acuan, ...arsip].map((n) => score(n, "resort").dimensions.concept.score));
  assert.ok(concepts.size >= 3, `skor konsep harus bervariasi, didapat ${[...concepts].join(", ")}`);
  assert.ok(score("Mövenpick Resort Carita", "resort").dimensions.concept.score < score("Marbella Place Anyer by Jayakarta", "resort").dimensions.concept.score);
  assert.ok(score("Mambruk Hotel & Convention", "resort").score < score("The Jayakarta Villas Anyer Beach Resort", "resort").score);

  for (const name of [...inti, ...acuan, ...arsip]) {
    const res = score(name, "resort");
    assert.doesNotMatch(res.summary, FORBIDDEN_OUTPUT_RE, res.summary);
    for (const d of Object.values(res.dimensions)) assert.doesNotMatch(d.reason, FORBIDDEN_OUTPUT_RE, d.reason);
  }
});

test("Sunset Grill dan Dragon Beach Club dari data asli: beach lounge kopi/mocktail ke Sunset Grill, klub malam ke DBC", () => {
  for (const name of ["Beach Point Anyer", "Kamalika Beach Cafe & Resto", "Andalan Beach Resto & Coffee", "Campo del Sol Pool Bar Marbella"]) {
    assert.equal(score(name, "sunset-grill").decision, "inti", `${name}: ${score(name, "sunset-grill").summary}`);
    assert.equal(score(name, "dragon-beach-club").recommendedRole, null, `${name} bukan kompetitor DBC`);
  }
  for (const name of ["Warung Ikan Bakar ABAH JUNED", "RM 195 Seafood", "Kembang Sari Anyer"]) {
    assert.equal(score(name, "sunset-grill").decision, "arsip", `${name}: ${score(name, "sunset-grill").summary}`);
  }
  assert.equal(score("Star Queen Restoran N Karaoke Cilegon", "dragon-beach-club").decision, "inti");
  assert.equal(score("Lighthouse Restaurant & Bar Mambruk", "dragon-beach-club").recommendedRole, null, "bar hotel bukan beach club mandiri");
});

test("ownerDecisionOf membaca keputusan pemakai/pemilik beserta lingkup outletnya", () => {
  const allisa = ownerDecisionOf(row("Allisa Resort Anyer"));
  assert.equal(allisa?.scope, "semua", "keputusan tanpa nama outlet mengunci seluruh baris");
  // Catatan verifikasi alamat Star Queen ("diperiksa pemakai 15 Nov 2026") bukan keputusan; kalimat keputusan DBC-nya iya.
  const starQueenNotes = row("Star Queen Restoran N Karaoke Cilegon").notes ?? "";
  const verification = starQueenNotes.split(/(?<=\.)\s+/).filter((s) => /diperiksa pemakai/.test(s)).join(" ");
  assert.match(verification, /diperiksa pemakai 15 Nov 2026/);
  assert.equal(ownerDecisionOf({ retiredReason: null, notes: verification }), null, "'diperiksa pemakai' bukan keputusan");
  assert.deepEqual(ownerDecisionOf(row("Star Queen Restoran N Karaoke Cilegon"))?.scope, ["dragon-beach-club"]);
  assert.equal(ownerDecisionOf(row("Mambruk Hotel & Convention")), null);
  const scoped = ownerDecisionOf({
    retiredReason: "Keputusan pemakai 20 Nov 2026: bukan kompetitor Sunset Grill (tempat ini 16 km).",
    notes: null,
  });
  assert.deepEqual(scoped?.scope, ["sunset-grill"]);
  const dbc = ownerDecisionOf({ retiredReason: null, notes: "Klub malam. Keputusan pemakai 20 Nov 2026: kompetitor Dragon Beach Club." });
  assert.deepEqual(dbc?.scope, ["dragon-beach-club"]);
});

test("reclassifyRegistry menilai ulang SEMUA baris, menghormati keputusan pemakai, dan menurunkan status hotel induk ke outletnya", () => {
  // Fixture direkam setelah audit 21 Nov 2026; status lama beberapa baris dikembalikan ke isi DB sebelum audit itu
  // (Mambruk, Aston, My Pisita, dan Infinity inti; Hawaii arsip; Angel acuan DBC + D'Bar) supaya terlihat bahwa
  // kompetitor lama ikut dihitung ulang, bukan hanya kandidat baru.
  const PRE_AUDIT: Record<string, Partial<RegistryCandidate>> = {
    "Mambruk Hotel & Convention": { active: true, compsetRole: "inti", outlets: ["resort"], retiredReason: null },
    "Aston Anyer Beach Hotel": { active: true, compsetRole: "inti", outlets: ["resort"], retiredReason: null },
    "My Pisita Anyer Resort": { active: true, compsetRole: "inti", outlets: ["resort"], retiredReason: null },
    "Infinity Restaurant Mambruk": { active: true, compsetRole: "inti", outlets: ["dbistro"], retiredReason: null },
    "Hawaii Resort Family Suites Anyer": {
      active: false,
      compsetRole: null,
      outlets: ["resort"],
      retiredReason: "Properti timeshare/keanggotaan bintang 3 di 18,2 km, di bawah standar minimum bintang 4 penginapan sejenis Sanghyang.",
    },
    "Angel Karaoke & Lounge": { active: true, compsetRole: "benchmark", outlets: ["dragon-beach-club", "dbar"], retiredReason: null },
  };
  const candidates = fixture.candidates.map((c) => ({ ...c, ...(PRE_AUDIT[c.name] ?? {}) }));
  const decisions = reclassifyRegistry(candidates, refs);
  assert.equal(decisions.length, candidates.length, "setiap baris dinilai, tidak ada yang hilang");
  const by = new Map(decisions.map((d) => [d.name, d]));

  const mambruk = by.get("Mambruk Hotel & Convention")!;
  assert.equal(mambruk.before.compsetRole, "inti");
  assert.equal(mambruk.after.compsetRole, "benchmark");
  assert.equal(mambruk.changed, true);
  const hawaii = by.get("Hawaii Resort Family Suites Anyer")!;
  assert.equal(hawaii.after.active, true);
  assert.equal(hawaii.after.compsetRole, "inti");
  assert.equal(hawaii.after.retiredReason, null);

  // Keputusan pemakai tanpa lingkup outlet: seluruh baris dikunci.
  for (const name of ["Allisa Resort Anyer", "Anyer Wonderland", "Bale-Bale Spa ASTON"]) {
    const d = by.get(name)!;
    assert.equal(d.changed, false, name);
    assert.equal(d.protectedBy?.scope, "semua", name);
  }
  // Keputusan berlingkup Sunset Grill (dicatat 21 Nov dari gambar 7): mesin menilai BM Seaside cocok, keputusan dihormati.
  const bm = by.get("BM Seaside View Cafe & Resto")!;
  assert.deepEqual(bm.protectedBy?.scope, ["sunset-grill"]);
  assert.ok(bm.scoresByOutlet["sunset-grill"].score >= HOLISTIC_SCORE_THRESHOLDS.benchmark, "skor mesin tetap dihitung");
  assert.equal(bm.after.active, false);
  assert.match(bm.after.retiredReason ?? "", /Keputusan pemakai 20 Nov 2026/);
  // Keputusan berlingkup DBC (gambar 8): Angel tetap acuan DBC; D'Bar dinilai mesin dan gugur oleh syarat 50 ulasan.
  const angel = by.get("Angel Karaoke & Lounge")!;
  assert.deepEqual(angel.protectedBy?.scope, ["dragon-beach-club"]);
  assert.deepEqual(angel.after.outlets, ["dragon-beach-club"]);
  assert.equal(angel.after.compsetRole, "benchmark");

  // Outlet mengikuti status hotel induk hasil penilaian yang sama.
  assert.equal(by.get("Infinity Restaurant Mambruk")!.after.compsetRole, "benchmark");
  assert.equal(by.get("Bluewave Lounge Mövenpick")!.after.active, false);
  assert.equal(by.get("El Patio Marbella")!.after.compsetRole, "inti");

  for (const d of decisions) {
    if (!d.after.active) assert.ok(d.after.retiredReason, `${d.name}: arsip wajib beralasan`);
    assert.doesNotMatch(d.after.retiredReason ?? "", /\b(crawl4ai|playwright|gemini|registri|pesaing)\b/i, d.name);
  }
});

test("keputusan pemakai di retiredReason tidak hilang saat outlet lain mengaktifkan baris (tiga putaran malam)", () => {
  const NAME = "BM Seaside View Cafe & Resto";
  const DECISION = "Keputusan pemakai 20 Nov 2026: bukan kompetitor Sunset Grill.";
  assert.ok(row(NAME).retiredReason?.startsWith(DECISION), "rekaman menyimpan keputusan di retiredReason");
  // Langkah menu_pesaing menambah satu minuman beralkohol ke menu dinamis tempat ini; barisnya diambil dari rekaman yang
  // sama (menu Campo del Sol), bukan angka karangan.
  const beer = row("Campo del Sol Pool Bar Marbella").input.menuItems?.find((m) => m.category === "BEER");
  assert.ok(beer, "rekaman memuat baris bir");
  const withBeer = { ...row(NAME).input, menuItems: [...(row(NAME).input.menuItems ?? []), beer] };
  const countDecision = (notes: string | null) => (notes ?? "").split(DECISION).length - 1;
  const night = (candidates: RegistryCandidate[]) => reclassifyRegistry(candidates, refs).find((d) => d.name === NAME)!;
  const persist = (candidates: RegistryCandidate[], d: ReturnType<typeof night>, input: HolisticCandidateInput = withBeer): RegistryCandidate[] =>
    candidates.map((c) =>
      c.name === NAME
        ? { ...c, version: c.version + 1, active: d.after.active, compsetRole: d.after.compsetRole, outlets: d.after.outlets, retiredReason: d.after.retiredReason, notes: d.after.notes, input: { ...input, notes: d.after.notes } }
        : c,
    );

  // Malam 1: DBC (tidak dikunci) merekomendasikan baris ini; kalimat keputusan pindah ke notes, bukan dibuang.
  let cands = fixture.candidates.map((c) => (c.name === NAME ? { ...c, input: withBeer } : c));
  const n1 = night(cands);
  assert.equal(n1.after.active, true);
  assert.deepEqual(n1.after.outlets, ["dragon-beach-club"]);
  assert.equal(n1.after.retiredReason, null);
  assert.equal(countDecision(n1.after.notes), 1, `keputusan tersimpan di notes: ${n1.after.notes}`);
  assert.ok(n1.after.notes?.startsWith(row(NAME).notes ?? ""), "isi notes lama dipertahankan");
  assert.equal(n1.changed, true);

  // Malam 2: keputusan masih terbaca, jadi Sunset Grill tidak ditambahkan walau skor mesinnya tinggi.
  cands = persist(cands, n1);
  const n2 = night(cands);
  assert.deepEqual(n2.protectedBy?.scope, ["sunset-grill"]);
  assert.ok(n2.scoresByOutlet["sunset-grill"].score >= HOLISTIC_SCORE_THRESHOLDS.benchmark, "mesin tetap menilai cocok");
  assert.ok(!n2.after.outlets.includes("sunset-grill"), `Sunset Grill tidak ditambahkan: ${n2.after.outlets.join(",")}`);
  assert.equal(n2.changed, false);
  assert.equal(countDecision(n2.after.notes), 1);

  // Malam 3: stabil, keputusan tidak digandakan.
  cands = persist(cands, n2);
  const n3 = night(cands);
  assert.equal(n3.changed, false);
  assert.equal(countDecision(n3.after.notes), 1);

  // Menu dinamis kembali tanpa bir: baris kembali arsip dengan alasan, keputusan tetap ada, Sunset Grill tetap tidak masuk.
  cands = persist(cands, n3, row(NAME).input);
  const n4 = night(cands);
  assert.equal(n4.after.active, false);
  assert.ok(n4.after.retiredReason, "arsip wajib beralasan");
  assert.match(n4.after.retiredReason ?? "", /Keputusan pemakai 20 Nov 2026/);
  assert.deepEqual(n4.protectedBy?.scope, ["sunset-grill"]);
  assert.equal(countDecision(n4.after.notes), 1);
  cands = persist(cands, n4, row(NAME).input);
  assert.equal(night(cands).changed, false, "sesudah arsip kembali, putaran berikutnya stabil");
});

test("bonus hotel induk setara D'Bistro mengikuti bintang Sanghyang dari data, bukan angka 4 tetap", () => {
  const infinity = row("Infinity Restaurant Mambruk").input;
  assert.equal(infinity.parentStarRating, 4, "hotel induk Infinity (Mambruk) bintang 4 di rekaman");
  const ownStar = refs.resort?.ownStarRating;
  assert.equal(ownStar, 4, "bintang Sanghyang di rekaman");
  const concept = (ref: HolisticReferenceContext | undefined) => scoreCompetitorHolistic(infinity, "dbistro", ref).dimensions.concept;
  const withOwnStar = concept({ ...refs.dbistro, ownStarRating: ownStar });
  assert.match(withOwnStar.reason, /hotel induk bintang 4 setara/);
  // Tanpa bintang Sanghyang di konteks pembanding, kesetaraan kelas tidak bisa dinilai dan tidak diberi bonus.
  const withoutOwnStar = concept({ ...refs.dbistro, ownStarRating: null });
  assert.doesNotMatch(withoutOwnStar.reason, /setara/);
  assert.ok(withoutOwnStar.score < withOwnStar.score);
  // Hotel induk bintang 5 (Mövenpick) tidak setara dengan Sanghyang bintang 4.
  const lagoon = scoreCompetitorHolistic(row("Lagoon Restaurant Mövenpick").input, "dbistro", { ...refs.dbistro, ownStarRating: ownStar });
  assert.doesNotMatch(lagoon.dimensions.concept.reason, /setara/);
});

test("penalti spa ruko membaca jenis bangunan, bukan nama kota", () => {
  const belia = row("Belia Spa and Reflexy Cilegon").input;
  assert.match(belia.address ?? "", /^Ruko /);
  assert.match(score("Belia Spa and Reflexy Cilegon", "dspa").dimensions.concept.reason, /ruko perkotaan/);
  // Bagian alamat yang sama tanpa kata "Ruko ... Business Square": nama kota saja bukan bukti spa ruko.
  const cityOnly = { ...belia, address: (belia.address ?? "").replace(/^.*?Blok B No\.33,\s*/, "") };
  assert.match(cityOnly.address ?? "", /Kota Cilegon/);
  assert.doesNotMatch(scoreCompetitorHolistic(cityOnly, "dspa", refs.dspa).dimensions.concept.reason, /ruko/);
});

test("penilaian ulang data yang sudah diterapkan bersifat idempoten, dan penginapan tanpa tarif tidak berubah peran", () => {
  const decisions = reclassifyRegistry(fixture.candidates, refs);
  assert.deepEqual(decisions.filter((d) => d.changed).map((d) => d.name), [], "fixture sesudah audit: tidak ada perubahan");
  // Mövenpick tidak lagi dirayapi setelah diarsipkan; tanpa tarif, statusnya dipertahankan (bukan naik jadi acuan).
  const noTariff = fixture.candidates.map((c) =>
    c.name === "Mövenpick Resort Carita" ? { ...c, input: { ...c.input, priceRatioVsOwn: null } } : c,
  );
  const movenpick = reclassifyRegistry(noTariff, refs).find((d) => d.name === "Mövenpick Resort Carita")!;
  assert.equal(movenpick.changed, false);
  assert.equal(movenpick.after.active, false);
  // Penginapan tanpa tarif tidak bisa menjadi inti karena inti dihitung di koridor harga.
  const noTariffScore = scoreCompetitorHolistic({ ...row("Nemuru Grand Anyer Palazo").input, priceRatioVsOwn: null }, "resort", refs.resort);
  assert.notEqual(noTariffScore.decision, "inti");
});

test("kewajaran rasio harga memakai median harga per porsi, tanpa paket beberapa orang atau sewa ruang (keputusan pemilik 22 Nov 2026)", () => {
  // Menu Infinity Restaurant Mambruk di berkas data kini menandai tiga paket per pasangan (2 pax) senilai Rp 400.000–950.000.
  const menuItems = competitorMenu("Infinity Restaurant Mambruk")!.items;
  assert.equal(menuItems.filter((i) => i.kind === "paket-bersama").length, 3);
  const infinity = { ...row("Infinity Restaurant Mambruk").input, menuItems };
  // Median 56 item per porsi Rp 60.000 terhadap median menu resmi D'Bistro Rp 75.000 di rekaman (dengan paket: Rp 70.000, 93%).
  const price = scoreCompetitorHolistic(infinity, "dbistro", refs.dbistro).dimensions.priceParity;
  assert.match(price.reason, /^Rasio harga 80% terhadap Sanghyang/);
});
