import { test } from "node:test";
import assert from "node:assert/strict";
import { isProfileSource, parseRobots, robotsAllows, robotsRulesForStatus } from "../../src/lib/market/official-pages";
import { buildFactPrompt, parseVerifiedFacts } from "../../src/lib/market/competitor-facts";
import { db } from "../../src/lib/db";

test("robots.txt: 4xx berarti tidak ada larangan, 5xx berarti larangan penuh (RFC 9309 2.3.1)", () => {
  assert.equal(robotsAllows(robotsRulesForStatus(404, ""), "/menu"), true);
  assert.equal(robotsAllows(robotsRulesForStatus(503, ""), "/menu"), false, "server bermasalah tidak boleh dibaca sebagai izin");
  assert.equal(robotsAllows(robotsRulesForStatus(200, "User-agent: *\nDisallow: /booking/"), "/booking/1"), false);
});

test("prompt fakta profil: pengelola ditulis sebagai pengelola, grup, atau merek, bukan jaringan", () => {
  const prompt = buildFactPrompt("Marbella Place Anyer by Jayakarta", "https://marbellaplaceanyer.com/", "Teks halaman.");
  assert.doesNotMatch(prompt, /jaringan/i, "kata jaringan terbaca seperti jaringan internet di laporan");
  assert.match(prompt, /"operator" berisi pengelola, grup hotel, atau merek/);
});

test("robots.txt: grup khusus perayap didahulukan, aturan Allow terpanjang menang", () => {
  const rules = parseRobots(["User-agent: *", "Disallow: /admin", "Disallow: /booking/", "", "User-agent: SanghyangNewsCrawler", "Disallow: /private", "Allow: /private/promo"].join("\n"));
  assert.equal(robotsAllows(rules, "/private/data"), false);
  assert.equal(robotsAllows(rules, "/private/promo/natal"), true);
  assert.equal(robotsAllows(rules, "/admin"), true, "grup * tidak berlaku bila ada grup khusus");
  const generic = parseRobots("User-agent: *\nDisallow: /booking/\nDisallow: /*.pdf$");
  assert.equal(robotsAllows(generic, "/booking/step1"), false);
  assert.equal(robotsAllows(generic, "/files/menu.pdf"), false);
  assert.equal(robotsAllows(generic, "/rooms"), true);
  assert.equal(robotsAllows(parseRobots(""), "/apa-saja"), true, "robots.txt kosong berarti tidak ada larangan");
});

test("sumber profil: Instagram, Linktree, dan Google Maps bukan situs resmi tempat", () => {
  assert.equal(isProfileSource("https://www.mambruk.co.id/facilities"), true);
  assert.equal(isProfileSource("https://www.instagram.com/andalanbeach/"), false);
  assert.equal(isProfileSource("https://linktr.ee/BeachPointAnyer"), false);
  assert.equal(isProfileSource("https://www.google.com/maps/search/?api=1&query=Kalani"), false);
  assert.equal(isProfileSource(null), false);
});

test("fakta profil: hanya yang kutipannya ada di teks halaman yang disimpan", async () => {
  // Fakta asli yang sudah lolos verifikasi dari situs resmi (tabel CompetitorFact di DB lokal).
  const stored = await db.competitorFact.findFirst({ orderBy: { observedAt: "asc" } });
  assert.ok(stored, "butuh minimal satu fakta tersimpan di DB lokal");
  const { text, quote } = stored.value as { text: string; quote: string };
  const pageText = `Header situs. ${quote} Footer situs.`;
  const raw = JSON.stringify({
    facts: [
      { section: stored.section, key: stored.key, text, quote },
      { section: "profil", key: "operator", text: "Dikelola grup besar", quote: "kalimat yang tidak ada di halaman ini sama sekali" },
      { section: "lain", key: "x", text: "bagian tidak dikenal", quote },
    ],
  });
  const result = parseVerifiedFacts(raw, pageText);
  assert.deepEqual(result.facts.map((f) => f.key), [stored.key]);
  assert.equal(result.rejected, 2);
  assert.deepEqual(
    result.rejections.map((r) => [r.key, r.reason]),
    [
      ["operator", "kutipan tidak ada di halaman"],
      ["x", "bagian tidak dikenal"],
    ],
    "fakta yang ditolak dilaporkan beserta alasannya supaya tidak hilang diam-diam",
  );
  assert.deepEqual(parseVerifiedFacts("bukan json", pageText), { facts: [], rejected: 0, rejections: [] });
});

test("fakta profil: jawaban Gemini berupa array langsung juga dibaca", () => {
  // Bentuk jawaban nyata Gemini untuk halaman dining Marbella (14 Nov 2026): array tanpa pembungkus "facts".
  const page = "DINING EL PATIO Lobby Level 06.00 am to 11.00 pm (Sunday-Friday), 24 hours (Saturday) El Patio Restaurant is an All day dining restaurant, serving International and Indonesian specialties as well as a wide selection of Asian favorites.";
  const raw = JSON.stringify([
    {
      section: "fasilitas",
      key: "restoran:El Patio",
      text: "El Patio adalah restoran all-day dining yang menyajikan masakan internasional, Indonesia, dan favorit Asia.",
      quote: "El Patio Restaurant is an All day dining restaurant, serving International and Indonesian specialties",
    },
  ]);
  const result = parseVerifiedFacts(raw, page);
  assert.deepEqual(result.facts.map((f) => f.key), ["restoran:El Patio"]);
});

test("fakta profil: bagian diturunkan dari kunci, jadi outlet yang diberi bagian lain oleh Gemini tetap tersimpan", () => {
  // Jawaban nyata Gemini untuk halaman restoran Novus Jiva (14 Nov 2026): section "restoran" di luar daftar bagian.
  const page =
    "SERAI RESTAURANT Serai derives from the ingredient “Lemongrass” meaning fresh, aromatic and flavourful. Serving a wide variety of dishes.";
  const raw = JSON.stringify([
    {
      section: "restoran",
      key: "restoran:Serai Restaurant",
      text: "Serai menyajikan beragam hidangan; namanya dari serai (lemongrass) yang segar dan harum.",
      quote: "SERAI RESTAURANT Serai derives from the ingredient “Lemongrass” meaning fresh, aromatic and flavourful.",
    },
  ]);
  const result = parseVerifiedFacts(raw, page);
  assert.deepEqual(result.facts.map((f) => [f.section, f.key]), [["fasilitas", "restoran:Serai Restaurant"]]);
  assert.equal(result.rejected, 0);
});
