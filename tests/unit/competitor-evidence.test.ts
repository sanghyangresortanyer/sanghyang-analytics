import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildCompetitorEvidence,
  groundedComparisons,
  loadCompetitorEvidence,
  type EvidenceComparison,
  type EvidenceDataset,
} from "../../src/lib/market/competitor-comparison";
import { competitorMenu } from "../../src/lib/market/competitor-menu";
import { OWN_OUTLETS } from "../../src/lib/market/outlet-ratings";
import { db } from "../../src/lib/db";

// Baris registri, fakta situs resmi, dan ulasan asli dari DB lokal 16 Nov 2026 (lihat _sumber di berkas fixture).
const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/competitor-evidence-2026-11-16.json"), "utf8")) as EvidenceDataset;
const options = { ownOutlets: OWN_OUTLETS, menuOf: competitorMenu, topicsOf: () => null };
const all = buildCompetitorEvidence(fixture, options);
const card = (outlet: string, name: string): EvidenceComparison => {
  const found = all.find((c) => c.outlet === outlet && c.competitorName === name);
  assert.ok(found, `kartu ${name} untuk ${outlet} tidak terbentuk`);
  return found;
};
const items = (c: EvidenceComparison) => [...c.evidence.observed, ...c.evidence.strengths, ...c.evidence.gaps, ...c.evidence.opportunities];

test("bukti pesaing: satu kartu per outlet pesaing di registri, outlet Sanghyang sendiri bukan pesaing", () => {
  const names = new Set(all.map((c) => c.competitorName));
  for (const own of OWN_OUTLETS) assert.equal(names.has(own.competitorName), false, `${own.competitorName} tidak boleh jadi pesaing`);
  // Lighthouse terdaftar untuk tiga outlet di registri, jadi muncul di ketiganya dengan pembanding outlet masing-masing.
  const lighthouse = all.filter((c) => c.competitorName === "Lighthouse Restaurant & Bar Mambruk").map((c) => c.outlet).sort();
  assert.deepEqual(lighthouse, ["dbar", "dbistro", "dragon-beach-club"]);
  assert.equal(card("dbistro", "Lighthouse Restaurant & Bar Mambruk").outletName, "D'Bistro (Sanghyang)");
});

test("bukti pesaing: setiap butir menyebut sumber dan tanggal", () => {
  for (const c of all) {
    for (const item of items(c)) {
      assert.ok(item.text.trim().length > 0, `${c.competitorName}: butir kosong`);
      assert.ok(item.sources.length > 0, `${c.competitorName}: "${item.text}" tanpa sumber`);
      for (const s of item.sources) {
        assert.ok(s.label.trim().length > 0, `${c.competitorName}: sumber tanpa nama`);
        assert.ok(!Number.isNaN(Date.parse(s.observedAt)), `${c.competitorName}: "${item.text}" tanpa tanggal yang sah`);
        if (s.url !== null) assert.match(s.url, /^https:\/\//);
      }
    }
  }
});

test("outlet di dalam hotel memakai fakta outlet itu dari hotel induk, bukan tipe kamar hotel", () => {
  const upper = card("dragon-beach-club", "The Upper Circle Novus Jiva");
  const texts = upper.evidence.strengths.map((s) => s.text);
  assert.ok(texts.some((t) => /Upper Circle/i.test(t) && /rooftop|360/i.test(t)), `fakta bar:The Upper Circle dari Novus Jiva tidak terpakai: ${texts.join(" | ")}`);
  // Baris registri Upper Circle membawa fakta tipe kamar hotel (salah tempat saat pengumpulan); bukan keunggulan sebuah bar.
  assert.ok(texts.every((t) => !/Standard Room|Villa menawarkan/i.test(t)), `tipe kamar ikut tampil: ${texts.join(" | ")}`);
  const sources = upper.evidence.strengths.flatMap((s) => s.sources.map((x) => x.url));
  assert.ok(sources.includes("https://www.novushotels.com/novusjiva/restaurant-hotel-anyer"));
});

test("fakta yang sama dari dua halaman situs resmi hanya ditulis sekali", () => {
  // Marbella menyimpan restoran:El Patio (halaman El Patio) dan restoran:EL PATIO (halaman dining).
  const elPatio = card("dbistro", "El Patio Marbella");
  const about = elPatio.evidence.strengths.filter((s) => /El Patio/i.test(s.text));
  assert.equal(about.length, 1, about.map((s) => s.text).join(" | "));
});

test("rating Google Maps dibandingkan dengan outlet Sanghyang yang sama", () => {
  const mambruk = card("resort", "Mambruk Hotel & Convention");
  const higher = mambruk.evidence.strengths.find((s) => /rating/i.test(s.text));
  assert.ok(higher, "rating Mambruk 4,6 di atas Sanghyang 4,4 harus jadi keunggulan pesaing");
  assert.match(higher.text, /4,6/);
  assert.match(higher.text, /4,4/);
  assert.equal(higher.sources.length, 2, "sumber rating pesaing dan Sanghyang");

  const marbella = card("resort", "Marbella Place Anyer by Jayakarta");
  assert.ok(marbella.evidence.gaps.some((g) => /rating/i.test(g.text) && /4,1/.test(g.text)), "rating 4,1 di bawah 4,4 harus jadi celah");
  assert.ok(marbella.evidence.opportunities.some((o) => /rating/i.test(o.text)), "rating Sanghyang yang lebih tinggi harus jadi peluang");

  const muaro = card("sunset-grill", "RM.MUARO");
  assert.ok(muaro.evidence.gaps.some((g) => /4,2/.test(g.text) && /4,5/.test(g.text)), "RM.MUARO 4,2 di bawah Sunset Grill 4,5");
});

test("keluhan tamu diambil dari ulasan bintang rendah beserta kutipan, tanggal, dan tautannya", () => {
  const marbella = card("resort", "Marbella Place Anyer by Jayakarta");
  const complaint = marbella.evidence.gaps.find((g) => /house ?keeping/i.test(g.quote ?? ""));
  assert.ok(complaint, "ulasan bintang 1 soal housekeeping 12 Nov 2026 tidak muncul sebagai celah");
  assert.equal(complaint.sources[0].observedAt.slice(0, 10), "2026-11-12");
  assert.match(complaint.sources[0].url ?? "", /google\.com\/travel\/hotels\/entity/);
  for (const c of all) {
    for (const g of c.evidence.gaps.filter((x) => x.quote)) {
      assert.ok((g.quote ?? "").length <= 200, `${c.competitorName}: kutipan terlalu panjang`);
    }
  }
});

test("peluang tema hanya bila kedua pihak punya ulasan pada tema yang sama", () => {
  const themed = all.flatMap((c) => c.evidence.opportunities.filter((x) => x.basis === "tema").map((o) => ({ c, o })));
  assert.ok(themed.length > 0, "data 16 Nov memuat tema yang dikeluhkan pesaing dan dipuji tamu Sanghyang");
  for (const { c, o } of themed) {
    const labels = o.sources.map((s) => s.label).join(" | ");
    assert.equal(o.sources.length, 2, `${c.competitorName}: peluang "${o.text}" harus menyebut ulasan pesaing dan ulasan Sanghyang (${labels})`);
    assert.ok(o.sources.some((s) => s.label.includes("Ulasan")), labels);
  }
});

test("teks situs resmi berbahasa Inggris tampil sebagai kutipan, kalimat butirnya tetap berbahasa Indonesia", () => {
  // Fakta Aston dari llms.archipelagointernational.com disalin apa adanya dalam bahasa Inggris.
  const pier = card("dbistro", "Hotel Pier Aston Anyer");
  const quoted = pier.evidence.strengths.find((s) => /Hotel Pier/.test(s.text));
  assert.ok(quoted, pier.evidence.strengths.map((s) => s.text).join(" | "));
  assert.match(quoted.text, /bahasa Inggris/);
  assert.match(quoted.quote ?? "", /overwater restaurant/);
  for (const c of all) {
    for (const item of items(c)) assert.doesNotMatch(item.text, /\b(the|with|offering|and)\b.*\b(the|with|offering|and)\b/i, `${c.competitorName}: "${item.text}"`);
  }
});

test("kalimat perbandingan memakai nama outlet tanpa keterangan dalam kurung", () => {
  const muaro = card("sunset-grill", "RM.MUARO");
  const rating = muaro.evidence.gaps.find((g) => g.basis === "rating");
  assert.ok(rating);
  assert.match(rating.text, /di bawah Sunset Grill \(4,5 dari 926 ulasan\)/);
});

test("pujian beberapa tema tidak memakai kutipan ulasan yang sama berulang", () => {
  for (const c of all) {
    const quotes = c.evidence.strengths.filter((s) => s.basis === "ulasan").map((s) => s.quote);
    assert.equal(new Set(quotes).size, quotes.length, `${c.competitorName}: kutipan pujian berulang`);
  }
});

test("harga per orang dari Google Maps tampil sebagai fakta teramati, bukan keunggulan", () => {
  const muaro = card("sunset-grill", "RM.MUARO");
  const price = muaro.evidence.observed.find((o) => /per orang/i.test(o.text));
  assert.ok(price, "kisaran harga per orang RM.MUARO (55 pelapor Google Maps) tidak muncul");
  assert.match(price.text, /Rp\s?25\.000/);
  assert.match(price.text, /Rp\s?175\.000/);
  assert.match(price.text, /55 pengguna/);
});

test("Langkah 2 hanya memuat pesaing yang punya butir bersumber; tanpa alasan data kosong atau catatan tim lama", () => {
  const infinity = fixture.registry.find((r) => r.name === "Infinity Restaurant Mambruk");
  assert.ok(infinity);
  // Baris registri asli tanpa fakta hotel induk, ulasan, dan rating: keadaan resto mandiri sebelum 16 Nov 2026.
  const dataset = {
    ...fixture,
    registry: fixture.registry.map((r) => (r.id === infinity.id ? { ...r, rating: null, reviewCount: null } : r)),
    facts: fixture.facts.filter((f) => f.competitorId !== infinity.parentId && f.competitorId !== infinity.id),
    reviews: [],
  };
  const built = buildCompetitorEvidence(dataset, {
    ...options,
    menuOf: (name) => (name === infinity.name ? null : competitorMenu(name)),
  });
  const bare = built.find((c) => c.competitorName === "Infinity Restaurant Mambruk");
  assert.ok(bare);
  assert.equal(items(bare).length, 0, items(bare).map((i) => i.text).join(" | "));
  assert.equal("missing" in bare.evidence, false, "alasan data kosong tidak dikirim lagi");
  const shown = groundedComparisons(built);
  assert.equal(shown.some((c) => c.competitorName === "Infinity Restaurant Mambruk"), false, "kartu tanpa butir bersumber tidak tampil");
  assert.ok(shown.length > 0 && shown.every((c) => items(c).length > 0));
  for (const c of shown) for (const item of items(c)) assert.ok(item.sources.length > 0, `${c.competitorName}: ${item.text} tanpa sumber`);
});

test("kartu bukti dari DB lokal: tiap outlet Sanghyang yang punya pembanding mendapat kartu bersumber", async () => {
  const cards = await loadCompetitorEvidence();
  const registry = await db.competitor.findMany({ where: { active: true, compsetRole: { in: ["inti", "benchmark"] } }, select: { outlets: true } });
  for (const o of OWN_OUTLETS) {
    const expected = registry.some((r) => r.outlets.includes(o.outletKey));
    assert.equal(cards.some((c) => c.outlet === o.outletKey), expected, `${o.outletKey}: kartu bukti ${expected ? "harus ada" : "tidak boleh ada"}`);
  }
  for (const c of cards) {
    for (const item of [...c.evidence.observed, ...c.evidence.strengths, ...c.evidence.gaps, ...c.evidence.opportunities]) {
      assert.ok(item.sources.every((s) => !Number.isNaN(Date.parse(s.observedAt))), `${c.competitorName}: ${item.text}`);
    }
  }
  for (const c of groundedComparisons(cards)) assert.ok(items(c).length > 0, `${c.competitorName} (${c.outlet}) tampil tanpa butir bersumber`);
});

after(() => db.$disconnect());
