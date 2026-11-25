import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../../src/lib/db";
import { createSummaryGet } from "../../src/app/api/market-intelligence/summary/route";
import { OFFICIAL_SOCIAL_HANDLES, reviewsForOwnOutlet, socialAccountOf } from "../../src/lib/market/summary";
import { channelFromSource, OUTLET_KEYS, type OutletKey } from "../../src/lib/market/outlet-filters";
import { classifyPromoOrEvent, isOwnPromoItem, ownPromosForOutlet, PROMO_MAX_AGE_DAYS } from "../../src/lib/market/promo-radar";
import { isPromotionType } from "../../src/lib/market/promo-type";
import type { SnOutletInfo, SnRadarPromo } from "../../src/lib/marketing/market-intelligence-types";

const getSummary = createSummaryGet(async () => null);

/** Baris asli DB lokal 21 Nov 2026, lihat _sumber di fixture. */
interface FixtureReview {
  id: string;
  competitorId: string;
  source: string;
  sourceUrl: string;
  reviewDate: string;
  text: string;
  themes: string[];
  competitor: { name: string; outlets: string[] };
}
const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "tests/fixtures/promo-ulasan-sanghyang-2026-11-21.json"), "utf8"),
) as { ownOutlets: { id: string; name: string; outlets: string[] }[]; reviews: FixtureReview[] };

const ownIds = new Set(fixture.ownOutlets.map((o) => o.id));
const outletRow = (key: OutletKey) => {
  const row = fixture.ownOutlets.find((o) => o.outlets.includes(key));
  assert.ok(row, `baris outlet sendiri ${key} ada di fixture`);
  return { id: row.id, key };
};
const isSocial = (r: { source: string }) => channelFromSource(r.source) === "social";

test("A2: akun resmi Sanghyang dibaca dari daftar akun resmi, akun pemilik postingan dari tautannya", () => {
  for (const handle of ["sanghyangresort", "sunsetgrillsanghyang", "sunset_grillsanghyang", "dragonbeachclub", "dbistro.anyer", "dspasanghyang", "sanghyangsparesort", "sunsetgrill.sanghyang"]) {
    assert.ok(OFFICIAL_SOCIAL_HANDLES.has(handle), `${handle} termasuk akun resmi`);
  }
  assert.equal(OFFICIAL_SOCIAL_HANDLES.has("astonanyer"), false);
  assert.equal(socialAccountOf("https://www.instagram.com/astonanyer/reel/DfoJf-wT7Pm/"), "astonanyer");
  assert.equal(socialAccountOf("https://www.instagram.com/sanghyangresort/reel/DfeUWFsv-pk/"), "sanghyangresort");
  assert.equal(socialAccountOf("https://www.tiktok.com/@astonanyerofficial/video/7707131846605196562"), "astonanyerofficial");
  assert.equal(socialAccountOf("https://www.instagram.com/p/DfTxAQ9hugH/"), null, "tautan tanpa akun tidak bisa dibuktikan");
  assert.equal(socialAccountOf("https://sanghyang.com/offers"), null);
});

test("A2: komentar media sosial Langkah 1 per outlet hanya dari baris outlet itu dan akun resmi Sanghyang (fixture DB lokal)", () => {
  const counts: Record<string, number> = {};
  for (const key of OUTLET_KEYS) {
    const outlet = outletRow(key);
    const social = reviewsForOwnOutlet(fixture.reviews, outlet, ownIds).filter(isSocial);
    counts[key] = social.length;
    for (const r of social) {
      assert.equal(r.competitorId, outlet.id, `${key}: komentar milik outlet lain bocor (${r.sourceUrl})`);
      assert.ok(OFFICIAL_SOCIAL_HANDLES.has(socialAccountOf(r.sourceUrl) ?? ""), `${key}: komentar bukan dari akun Sanghyang (${r.sourceUrl})`);
    }
  }
  // Komentar sosial yang tersimpan di outlet sendiri pada 21 Nov 2026: resort 1, DBC 4, Sunset Grill 2, D'Spa 1.
  assert.deepEqual(counts, { "sunset-grill": 2, "dragon-beach-club": 4, resort: 1, dbistro: 0, dbar: 0, dspa: 1 });
});

test("A2 regresi gambar 1 (19 Nov): komentar Instagram Aston tidak pernah tampil di outlet Sanghyang", () => {
  const aston = fixture.reviews.filter((r) => r.competitor.name === "Aston Anyer Beach Hotel");
  assert.deepEqual(
    aston.map((r) => r.text.slice(0, 22)).sort(),
    ["Pak IMAN RACHMAN HASAN", "Pak IMAN RACHMAN HASAN", "include breakfast kah?"],
  );
  // (a) Tema kunci outlet seperti yang ditulis browser-social-sync versi HEAD (outletThemes = outlet daftar kompetitor Aston):
  //     summary versi HEAD menampilkan setiap ulasan bertema "resort" di Kamar & Resort, sumber kebocoran di gambar 1.
  const taggedLikeHead = aston.map((r) => ({ ...r, themes: [...r.themes, ...r.competitor.outlets] }));
  assert.ok(taggedLikeHead.every((r) => r.themes.includes("resort")));
  // (b) Baris yang salah menempel ke baris outlet Sanghyang: akun pemilik postingan tetap @astonanyer.
  const misattached = aston.map((r) => ({ ...r, competitorId: outletRow("resort").id }));
  for (const key of OUTLET_KEYS) {
    assert.deepEqual(reviewsForOwnOutlet([...taggedLikeHead, ...misattached], outletRow(key), ownIds), [], key);
  }
});

test("A2: ulasan Google resort yang ditandai outlet lain tetap ikut di outlet yang disebut, bukan outlet lain", () => {
  const tagged = fixture.reviews.find((r) => r.competitor.name === "Sanghyang Indah Spa Resort" && r.themes.includes("dspa"));
  assert.ok(tagged, "ulasan resort bertanda dspa ada di fixture");
  assert.equal(reviewsForOwnOutlet([tagged], outletRow("dspa"), ownIds).length, 1);
  assert.equal(reviewsForOwnOutlet([tagged], outletRow("resort"), ownIds).length, 1);
  assert.equal(reviewsForOwnOutlet([tagged], outletRow("dbistro"), ownIds).length, 0);
});

after(() => db.$disconnect());

type SummaryJson = {
  range: { from: string; to: string };
  outlets: SnOutletInfo[];
  ownPromos: SnRadarPromo[];
  competitorSocialRadar: SnRadarPromo[];
};

async function loadSummary(query: string): Promise<SummaryJson> {
  const res = await getSummary(new Request(`http://127.0.0.1:3001/api/market-intelligence/summary?${query}&segment=all`));
  assert.equal(res.status, 200);
  return (await res.json()) as SummaryJson;
}

test("A2/A4/B1/C3/C4/C16 lewat GET summary DB lokal (periode tahun ini) untuk keenam outlet", async () => {
  const data = await loadSummary("period=year");

  // A2: komentar sosial per outlet hanya dari akun resmi Sanghyang.
  for (const outlet of data.outlets) {
    const social = outlet.reviews.filter(isSocial);
    for (const r of social) {
      assert.ok(OFFICIAL_SOCIAL_HANDLES.has(socialAccountOf(r.sourceUrl ?? "") ?? ""), `${outlet.key}: komentar ${r.sourceUrl} bukan dari akun Sanghyang`);
    }
    assert.equal(outlet.channelBreakdown?.social.count, social.length, `${outlet.key}: hitungan kanal sosial = isi daftar`);
  }

  // B1: promo Sanghyang tidak pernah masuk daftar kompetitor; promo bertanggal > 3 bulan tidak tampil.
  assert.deepEqual(data.competitorSocialRadar.filter((p) => isOwnPromoItem(p)).map((p) => p.title), []);
  const cutoff = Date.parse(`${data.range.to}T23:59:59.999+07:00`) - PROMO_MAX_AGE_DAYS * 86_400_000;
  for (const p of [...data.ownPromos, ...data.competitorSocialRadar]) {
    const dated = p.startWritten !== false || p.endsAt !== null || p.platform !== "website";
    if (dated) assert.ok(Date.parse(p.endsAt ?? p.startsAt) >= cutoff, `promo > ${PROMO_MAX_AGE_DAYS} hari: ${p.competitorName} — ${p.title}`);
  }

  // C16: unggahan umum Aston (gambar 9) tidak masuk promo maupun event di outlet mana pun.
  for (const p of [...data.ownPromos, ...data.competitorSocialRadar]) {
    assert.doesNotMatch(p.title, /^Just say the number|put something else on the calendar/i, `${p.competitorName}: ${p.title}`);
  }

  // A4/C3/C4: promo Sanghyang dipetakan ke outlet baris sumbernya dan dipilah promo/event; media sosial ikut menjadi sumber.
  const resort = ownPromosForOutlet(data.ownPromos, "resort");
  assert.ok(resort.some((p) => p.title === "Paket Babakaran"), "Paket Babakaran (kartu situs resmi resort) tampil di Kamar & Resort");
  assert.ok(!ownPromosForOutlet(data.ownPromos, "dbistro").some((p) => p.title === "Paket Babakaran"), "Paket Babakaran tidak dipindah ke D'Bistro");
  const eat = resort.find((p) => p.title.startsWith("[REELS] Eat together"));
  assert.ok(eat && classifyPromoOrEvent(eat) === "event", "dokumentasi makan bersama rombongan (gambar 2, kotak merah) tampil sebagai event");
  for (const p of data.ownPromos) assert.ok(classifyPromoOrEvent(p) !== null, `ownPromos hanya promo atau event: ${p.title}`);
  for (const key of OUTLET_KEYS) {
    for (const p of ownPromosForOutlet(data.ownPromos, key)) {
      assert.ok(p.competitorOutlets?.includes(key), `${key}: ${p.title} milik outlet ${p.competitorOutlets?.join(",")}`);
    }
  }
  assert.ok(data.ownPromos.some((p) => p.platform === "instagram"), "promo/event Sanghyang memuat sumber media sosial");

  // E1: setiap item membawa kategori promosi; null berarti belum dibaca dan tampil "belum ada data".
  for (const p of [...data.ownPromos, ...data.competitorSocialRadar] as (SnRadarPromo & { promotionType?: unknown })[]) {
    assert.ok("promotionType" in p, `${p.competitorName}: ${p.title} tanpa kunci promotionType`);
    assert.ok(p.promotionType === null || isPromotionType(p.promotionType), `${p.title}: kategori ${String(p.promotionType)} di luar daftar`);
  }
});
