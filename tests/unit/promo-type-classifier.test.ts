import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PROMO_ANALYST } from "../../src/lib/market/promo-extractor";
import { PROMOTION_TYPE_INFO, PROMOTION_TYPES } from "../../src/lib/market/promo-type";

/** Tangkapan terbaru baris promo di tangkapan layar pemilik, DB lokal 21 Nov 2026 (lihat _sumber di fixture). */
interface FixtureRow {
  id: string;
  title: string;
  category: string;
  description: string | null;
  details: string[];
  terms: string[];
  price: number | null;
  originalPrice: number | null;
  discount: number | null;
  source: string;
  competitor: { name: string };
}
const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "tests/fixtures/promo-type-kandidat-2026-11-21.json"), "utf8"),
) as { rows: FixtureRow[] };
const candidates = fixture.rows.map((r) => ({
  id: r.id,
  competitor: r.competitor.name,
  title: r.title,
  category: r.category,
  description: r.description,
  details: r.details,
  terms: r.terms,
  price: r.price,
  originalPrice: r.originalPrice,
  discount: r.discount,
  source: r.source,
}));
const row = (title: string) => {
  const found = candidates.find((c) => c.title.startsWith(title));
  assert.ok(found, `baris "${title}" ada di fixture`);
  return found;
};

test("E1 prompt: definisi kategori urut prioritas, aturan tepat satu, dan contoh kalibrasi pemilik", async () => {
  const { buildTypePrompt } = await import("../../src/lib/market/promo-type-classifier");
  const prompt = buildTypePrompt(candidates);
  assert.ok(prompt.startsWith(PROMO_ANALYST), "memakai peran analis promo yang sama");
  let last = -1;
  for (const key of PROMOTION_TYPES) {
    const at = prompt.indexOf(`"${key}"`);
    assert.ok(at > last, `kategori ${key} hadir sesuai urutan prioritas`);
    assert.ok(prompt.includes(PROMOTION_TYPE_INFO[key].definition), `definisi ${key} disalin dari promo-type.ts`);
    last = at;
  }
  assert.match(prompt, /tepat satu/i);
  assert.match(prompt, /Seaside Candlelight Dinner[^\n]*950\.000[^\n]*brand_awareness/, "contoh pemilik: makan malam tepi laut tanpa insentif = brand awareness");
});

test("E1 prompt: teks sumber per baris lengkap tanpa usulan Versi kita", async () => {
  const { buildTypePrompt } = await import("../../src/lib/market/promo-type-classifier");
  const candlelight = row("Seaside Candlelight Dinner");
  const aston = row("Promo Diskon 20% Menginap");
  const prompt = buildTypePrompt([candlelight, aston]);
  const items = JSON.parse(prompt.split("Penawaran:\n")[1].split("\n\nJawab")[0]) as Record<string, unknown>[];
  assert.deepEqual(items.map((i) => i.id), [candlelight.id, aston.id]);
  const [c, a] = items;
  assert.equal(c.tempat, "Mambruk Hotel & Convention");
  assert.equal(c.judul, "Seaside Candlelight Dinner");
  assert.equal(c.harga, 950000);
  assert.deepEqual(c.isiPaket, candlelight.details);
  assert.deepEqual(c.syarat, candlelight.terms);
  assert.equal(c.sumber, "Situs resmi", "label sumber tanpa nama mesin baca");
  assert.equal(a.diskonPersen, 20);
  assert.ok(String(c.ringkasan).startsWith("Seaside Candlelight Dinner menyediakan makan malam romantis"));
  assert.doesNotMatch(prompt, /Versi kita|dapat menghadirkan paket makan malam romantis di tepi pantai Dragon Beach Club/, "usulan untuk Sanghyang bukan teks sumber");
});

test("E1 jawaban: hanya id yang diminta dan kunci kategori yang sah, tanpa nilai cadangan", async () => {
  const { parseTypeAnswer } = await import("../../src/lib/market/promo-type-classifier");
  const ids = candidates.map((c) => c.id);
  const [a, b, c] = ids;
  const parsed = parseTypeAnswer(
    "```json\n" +
      JSON.stringify({
        items: [
          { id: a, promotionType: " Brand_Awareness " },
          { id: b, promotionType: "diskon" },
          { id: "id-lain", promotionType: "potongan_harga" },
          { id: c, promotionType: "potongan_harga" },
          { id: c, promotionType: "harga_spesial" },
        ],
      }) +
      "\n```",
    ids,
  );
  assert.deepEqual([...parsed], [
    [a, "brand_awareness"],
    [c, "potongan_harga"],
  ]);
  assert.equal(parseTypeAnswer("bukan json", ids).size, 0);
  assert.equal(parseTypeAnswer(JSON.stringify([{ id: a, promotionType: "produk_baru" }]), ids).get(a), "produk_baru", "daftar langsung juga dibaca");
  assert.equal(parseTypeAnswer('{"items":[{"id":"' + a + '"}]}', ids).size, 0, "tanpa kategori tidak diisi apa pun");
});

// Baris asli DB lokal 22 Nov 2026 (tests/fixtures/promo-rentang-2026-11-22.json): unggahan mentah dan event.
const rangeRows = (
  JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/promo-rentang-2026-11-22.json"), "utf8")) as {
    rows: (FixtureRow & { label: string; kind: string | null; sourceUrl: string | null })[];
  }
).rows;
const byLabel = (label: string) => {
  const found = rangeRows.find((r) => r.label === label);
  assert.ok(found, `baris ${label} ada di fixture`);
  return found;
};

test("E1 #40: kandidat kategori = setiap baris yang tampil sebagai promo, termasuk unggahan mentah yang lolos penyaring radar", async () => {
  const { isTypeCandidate } = await import("../../src/lib/market/promo-type-classifier");
  assert.equal(isTypeCandidate(byLabel("andalan-bundling-mentah")), true, "BUNDLING PROMO 99K++ tampil sebagai promo, jadi wajib berkategori");
  assert.equal(isTypeCandidate(byLabel("marbella-early-bird-situs")), true);
  assert.equal(isTypeCandidate(byLabel("andalan-boat-trip-ig")), true);
  assert.equal(isTypeCandidate(byLabel("aston-just-say-mentah")), false, "unggahan umum gambar 9 tidak tampil, tidak dibaca");
  assert.equal(isTypeCandidate(byLabel("aston-calendar-mentah")), false, "unggahan umum gambar 9 tidak tampil, tidak dibaca");
  assert.equal(isTypeCandidate(byLabel("nye-jayakarta")), false, "event tidak memakai kategori promosi");
  assert.equal(isTypeCandidate(byLabel("dbc-reels-halloween")), false);
});

test("E1 #40: prompt membaca takarir unggahan mentah, bukan JSON mentahnya", async () => {
  const { buildTypePrompt } = await import("../../src/lib/market/promo-type-classifier");
  const raw = byLabel("andalan-bundling-mentah");
  assert.ok((raw.description ?? "").trim().startsWith("{"), "deskripsi unggahan mentah tersimpan sebagai JSON takarir");
  const prompt = buildTypePrompt([
    { id: raw.id, competitor: raw.competitor.name, title: raw.title, category: raw.category, description: raw.description, details: raw.details, terms: raw.terms, price: raw.price, originalPrice: null, discount: raw.discount, source: raw.source },
  ]);
  const [item] = JSON.parse(prompt.split("Penawaran:\n")[1].split("\n\nJawab")[0]) as { ringkasan: string; judul: string }[];
  assert.equal(item.judul, "BUNDLING PROMO 99K++ 🔥");
  assert.ok(item.ringkasan.length > 0 && !item.ringkasan.startsWith("{"), `ringkasan berupa takarir: ${item.ringkasan.slice(0, 60)}`);
  assert.doesNotMatch(item.ringkasan, /"metrics"|"postType"/);
});

test("E1: antrean kategori dibaca per halaman dan berhenti begitu batas per putaran terpenuhi, tanpa melewatkan kandidat (DB lokal)", async () => {
  const { db } = await import("../../src/lib/db");
  const { isTypeCandidate, pendingTypeCandidates } = await import("../../src/lib/market/promo-type-classifier");
  const { NOT_PROMO_CATEGORY } = await import("../../src/lib/market/promo-radar");
  const { OWN_TEAM_SOURCE } = await import("../../src/lib/market/own-promos");
  const shownWhere = { category: { not: NOT_PROMO_CATEGORY }, source: { not: OWN_TEAM_SOURCE }, competitor: { active: true } };
  const rollback = new Error("transaksi uji dibatalkan");
  try {
    await db.$transaction(
      async (tx) => {
        // Kandidat dibuat di dalam transaksi yang dibatalkan: kategori tiga promo tampil dikosongkan sementara, sehingga
        // tes tidak bergantung pada ada tidaknya antrean di DB dan tidak mengubah data.
        const shown = await tx.competitorPromotion.findMany({
          where: { ...shownWhere, kind: "promo", promotionType: { not: null } },
          select: { id: true },
          orderBy: [{ capturedAt: "desc" }, { id: "asc" }],
          take: 3,
        });
        assert.ok(shown.length >= 2, `DB memuat promo tampil berkategori (${shown.length})`);
        await tx.competitorPromotion.updateMany({ where: { id: { in: shown.map((r) => r.id) } }, data: { promotionType: null } });
        // Acuan: seluruh antrean dalam satu kueri dengan urutan yang sama (tangkapan terbaru dulu, lalu id).
        const all = await tx.competitorPromotion.findMany({
          where: { ...shownWhere, promotionType: null },
          select: { id: true, title: true, category: true, description: true, details: true, terms: true, price: true, discount: true, source: true, sourceUrl: true, kind: true },
          orderBy: [{ capturedAt: "desc" }, { id: "asc" }],
        });
        const candidates = all.filter(isTypeCandidate);
        assert.ok(candidates.length >= 2, `antrean berisi kandidat kategori (${candidates.length} dari ${all.length} baris tertunda)`);
        // Ukuran halaman dari isi antrean supaya antrean selalu terbagi beberapa halaman.
        const pageSize = Math.max(1, Math.ceil(all.length / 10));
        const small = await pendingTypeCandidates(2, pageSize, tx);
        assert.deepEqual(small.rows.map((r) => r.id), candidates.slice(0, 2).map((r) => r.id));
        const secondAt = all.findIndex((r) => r.id === candidates[1].id);
        assert.equal(small.scanned, Math.min(all.length, Math.ceil((secondAt + 1) / pageSize) * pageSize), "berhenti di halaman kandidat kedua");
        // Kandidat di halaman belakang tetap terbaca bila batasnya cukup: tidak ada baris yang seharusnya tampil terbuang.
        const every = await pendingTypeCandidates(candidates.length, pageSize, tx);
        assert.deepEqual(every.rows.map((r) => r.id), candidates.map((r) => r.id));
        throw rollback;
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await db.$disconnect();
  }
});
