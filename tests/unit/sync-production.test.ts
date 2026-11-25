import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient, type CompetitorPromotion } from "@prisma/client";
import { createDatabaseClient } from "../../src/lib/db";
import {
  articleKeys,
  betterReading,
  changedFields,
  loadArticleRefs,
  localFirst,
  mergeReview,
  pairByIdentity,
  pairReviews,
  planLegacyNames,
  planSourceNames,
  PROMO_FIELDS,
  promoCopyData,
  promoIdentity,
  rateIdentity,
  registryFieldsToRemote,
  REVIEW_FIELDS,
  sameValue,
  SYNC_SOCKET_TIMEOUT_S,
  syncRemoteUrl,
  type SourceRow,
} from "../../scripts/ops/sync-production-data";
import { destructiveMigrations, pendingMigrations } from "../../scripts/ops/sync-before-push";
import { DEFAULT_JOB_SOURCES } from "../../src/lib/market/scrape-log";

// Kolom tautan registri asli dari DB produksi dan DB kerja lokal, 19 Nov 2026 (lihat _sumber di fixture).
const registry = JSON.parse(readFileSync("tests/fixtures/registry-legacy-names-2026-11-19.json", "utf8")) as {
  produksi: Record<string, unknown>[];
  lokal: Record<string, unknown>[];
};
// Ulasan, bacaan berita, dan artikel kembar asli dari kedua DB sebelum sinkron dua arah (lihat _sumber di fixture).
const twoWay = JSON.parse(readFileSync("tests/fixtures/sync-two-way-2026-11-19.json", "utf8")) as {
  ulasan: Record<"lokal" | "produksi", { id: string; competitor: string; source: string; externalId: string; text: string; archivedAt: string | null }[]>;
  bacaanBerita: { lokal: { readStatus: string; readAt: string }; produksi: { readStatus: string; readAt: string } }[];
  artikelKembar: Record<"lokal" | "produksi", { canonicalUrl: string; contentHash: string | null; normalizedTitle: string; publishedAt: string | null }>[];
  isiUlasan: { kunci: string; lokal: { text: string; sentiment: string; themes: string[] }; produksi: { text: string; sentiment: string; themes: string[] } }[];
  promoBeda: Record<"lokal" | "produksi", Record<string, unknown> & { kunci: string; startsAt: string; endsAt: string | null; status: string }>[];
  postinganSatuBatch: { competitor: string; title: string; capturedAt: string; sourceUrl: string }[];
  tarifPindah: { baris: { roomName: string | null; packageName: string | null; checkIn: string; checkOut: string; observedAt: string; source: string; guests: number; sourceUrl: string }; pemilikLokal: string; pemilikProduksi: string };
  ulasanTanggalBeda: Record<"lokal" | "produksi", { competitor: string; source: string; externalId: string; text: string; reviewDate: string; rating: string; title: string | null; sourceUrlHash: string }>;
};
const rows = (list: Record<string, unknown>[]) => list.map((r, i) => ({ id: `id-${i}`, ...r }) as { id: string; name: string } & Record<string, unknown>);
const reviews = (side: "lokal" | "produksi") => twoWay.ulasan[side].map((r) => ({ ...r, id: `${side}-${r.id}`, archivedAt: r.archivedAt ? new Date(r.archivedAt) : null }));
const reading = (r: { readStatus: string; readAt: string }) => ({ readStatus: r.readStatus, readAt: new Date(r.readAt) });

test("nama lama di produksi dikenali lewat tautan yang sama: empat diganti nama, duplikat Aston digabung", () => {
  const plan = planLegacyNames(rows(registry.lokal), rows(registry.produksi));
  assert.deepEqual(
    plan.renames.map((r) => [r.from, r.to]).sort(),
    [
      ["Andalan Beach View Anyer", "Andalan Beach Resto & Coffee"],
      ["Kamalika Beach Café Anyer", "Kamalika Beach Cafe & Resto"],
      ["Lighthouse Bar & Lounge Mambruk", "Lighthouse Restaurant & Bar Mambruk"],
      ["The West Cove Hotel Anyer", "THE WEST COVE HOTEL"],
    ],
  );
  // Outlet Aston (Hotel Pier, Sunset Cafe, Spa) hanya berbagi situs; hotelnya cocok di Instagram dan situs sekaligus.
  assert.deepEqual(plan.merges.map((m) => [m.from, m.intoName]), [["Aston Anyer Beach Hotel & Aquavillas", "Aston Anyer Beach Hotel"]]);
  assert.deepEqual(plan.newRows, []);
  assert.deepEqual(plan.ambiguous, []);
});

test("baris gabungan yang sudah diarsipkan tetap digabung (lalu dihapus), dan sesudahnya rencana kosong", () => {
  const archived = rows(registry.produksi).map((r) => (r.name === "Aston Anyer Beach Hotel & Aquavillas" ? { ...r, active: false } : r));
  assert.equal(planLegacyNames(rows(registry.lokal), archived).merges.length, 1);
  const after = planLegacyNames(rows(registry.lokal), rows(registry.lokal));
  assert.deepEqual([after.renames, after.merges, after.newRows, after.ambiguous], [[], [], [], []]);
});

test("baris produksi tanpa tautan yang sama menjadi baris baru, tautan seri harus diputuskan orang", () => {
  const prodRow = (name: string) => rows(registry.produksi).filter((r) => r.name === name);
  // Tanpa satu pun baris Aston di lokal, baris Aquavillas produksi tidak punya pasangan: baris baru untuk lokal.
  const noAston = rows(registry.lokal).filter((r) => !String(r.name).includes("Aston"));
  assert.deepEqual(planLegacyNames(noAston, prodRow("Aston Anyer Beach Hotel & Aquavillas")).newRows.map((r) => r.name), ["Aston Anyer Beach Hotel & Aquavillas"]);
  // Baris hotel Aston produksi hanya punya situs, yang sama dengan tiga outlet Aston lokal: seri, tidak ditebak.
  const outletsOnly = rows(registry.lokal).filter((r) => r.name !== "Aston Anyer Beach Hotel");
  const plan = planLegacyNames(outletsOnly, prodRow("Aston Anyer Beach Hotel"));
  assert.deepEqual(plan.ambiguous.map((u) => u.candidates.length), [3]);
  assert.deepEqual([plan.renames, plan.merges, plan.newRows], [[], [], []]);
});

test("perbandingan nilai registri: Decimal, tanggal, dan larik", () => {
  assert.ok(sameValue(new Date("2026-11-18T00:00:00Z"), new Date("2026-11-18T00:00:00Z")));
  assert.ok(sameValue(["resort", "dbistro"], ["resort", "dbistro"]));
  assert.ok(!sameValue(["resort"], []));
  assert.ok(sameValue(null, undefined));
  const diff = changedFields(
    { id: "a", name: "x", outlets: ["resort"], compsetRole: "inti", roadKm: 3.1 },
    { id: "b", name: "x", outlets: [], compsetRole: null, roadKm: 3.1 },
    ["outlets", "compsetRole", "roadKm"],
  );
  assert.deepEqual(diff, { outlets: ["resort"], compsetRole: "inti" });
});

test("bacaan berita yang berhasil tidak tertimpa bacaan gagal yang lebih baru dari job produksi", () => {
  const [first] = twoWay.bacaanBerita;
  assert.equal(first.lokal.readStatus, "relevan");
  assert.equal(first.produksi.readStatus, "tidak_terbaca");
  assert.ok(new Date(first.produksi.readAt) > new Date(first.lokal.readAt));
  for (const pair of twoWay.bacaanBerita) {
    const l = reading(pair.lokal);
    const p = reading(pair.produksi);
    const expected = (l.readStatus === "tidak_terbaca") === (p.readStatus === "tidak_terbaca") ? (l.readAt > p.readAt ? "a" : "b") : l.readStatus === "tidak_terbaca" ? "b" : "a";
    assert.equal(betterReading(l, p), expected, JSON.stringify(pair));
  }
  assert.equal(betterReading({ readStatus: null, readAt: null }, reading(first.produksi)), "b");
  assert.equal(betterReading(reading(first.lokal), reading(first.lokal)), "sama");
});

test("berita sama dengan alamat Google News berbeda tetap berpasangan lewat sidik isi atau judul dan waktu terbit", () => {
  const [twin] = twoWay.artikelKembar;
  const at = (a: (typeof twin)["lokal"]) => ({ ...a, publishedAt: a.publishedAt ? new Date(a.publishedAt) : null });
  assert.notEqual(twin.lokal.canonicalUrl, twin.produksi.canonicalUrl);
  const shared = articleKeys(at(twin.lokal)).filter((k) => articleKeys(at(twin.produksi)).includes(k));
  assert.deepEqual(shared.map((k) => k.split(":")[0]), ["hash", "judul"]);
});

test("ulasan Sunset Grill yang diarsipkan di lokal ikut diarsipkan di produksi; ulasan baru produksi disalin ke lokal", () => {
  const local = reviews("lokal");
  const remote = reviews("produksi");
  const plan = pairReviews(local, remote);
  assert.equal(plan.pairs.length, 4);
  assert.deepEqual(plan.copyFromLocal, []);
  assert.deepEqual(plan.copyFromRemote.map((id) => remote.find((r) => r.id === id)!.competitor), ["Marbella Place Anyer by Jayakarta"]);
  assert.deepEqual([plan.archiveInLocal, plan.archiveInRemote], [[], []]);
  const content = (r: (typeof local)[number]) => ({ text: r.text, sentiment: "positive", themes: [], archivedAt: r.archivedAt });
  const archivedNow = plan.pairs.filter(([l, r]) => {
    const merged = mergeReview(content(local.find((x) => x.id === l)!), content(remote.find((x) => x.id === r)!));
    return merged.archivedAt !== null && remote.find((x) => x.id === r)!.archivedAt === null;
  });
  assert.equal(archivedNow.length, 2);
});

test("tiruan teks ulasan yang berpasangan diarsipkan di sisinya, bukan disalin", () => {
  const local = reviews("lokal").filter((r) => !r.archivedAt);
  const remote = reviews("produksi").filter((r) => r.competitor !== "Marbella Place Anyer by Jayakarta");
  // Di lokal tinggal dua baris aktif; di produksi dua baris lain dengan teks yang sama juga aktif.
  const plan = pairReviews(local, remote);
  assert.equal(plan.pairs.length, 2);
  assert.equal(plan.archiveInRemote.length, 2);
  assert.deepEqual([plan.copyFromLocal, plan.copyFromRemote], [[], []]);
});

test("isi ulasan: teks utuh mengalahkan teks terpotong di sisi mana pun, tema yang sudah dipilah per outlet dipakai", () => {
  const content = (r: { text: string; sentiment: string; themes: string[] }) => ({ ...r, archivedAt: null });
  const [fullInLocal, fullInProd, taggedInProd] = twoWay.isiUlasan;
  assert.ok(fullInLocal.produksi.text.endsWith("…") && fullInProd.lokal.text.endsWith("…"));
  assert.equal(mergeReview(content(fullInLocal.lokal), content(fullInLocal.produksi)).text, fullInLocal.lokal.text);
  assert.equal(mergeReview(content(fullInProd.lokal), content(fullInProd.produksi)).text, fullInProd.produksi.text);
  assert.deepEqual(mergeReview(content(taggedInProd.lokal), content(taggedInProd.produksi)).themes, taggedInProd.produksi.themes);
});

test("ulasan yang berpasangan lewat teks memakai kunci dan tanggal lokal di kedua DB", () => {
  const { lokal, produksi } = twoWay.ulasanTanggalBeda;
  const at = (r: typeof lokal, side: string) => ({ ...r, id: side, archivedAt: null, reviewDate: new Date(r.reviewDate) });
  const plan = pairReviews([at(lokal, "l")], [at(produksi, "p")]);
  assert.deepEqual(plan.pairs, [["l", "p"]]);
  assert.notEqual(lokal.externalId, produksi.externalId);
  const { toRemote, toLocal } = localFirst(at(lokal, "l"), at(produksi, "p"), REVIEW_FIELDS);
  assert.deepEqual(toLocal, {});
  assert.equal(toRemote.externalId, lokal.externalId);
  assert.equal((toRemote.reviewDate as Date).toISOString(), lokal.reviewDate);
  assert.ok(!("rating" in toRemote) && !("title" in toRemote));
});

test("postingan sosmed dari satu batch (judul dan waktu tangkap sama) tetap dua tangkapan berbeda", () => {
  const [a, b] = twoWay.postinganSatuBatch.map((p) => ({ ...p, capturedAt: new Date(p.capturedAt) }));
  assert.equal(a.title, b.title);
  assert.equal(a.capturedAt.getTime(), b.capturedAt.getTime());
  assert.notEqual(promoIdentity(a.competitor, a), promoIdentity(b.competitor, b));
});

test("tarif yang dipindah ke pesaing lain oleh audit lokal tetap berpasangan, bukan disalin ulang", () => {
  const { baris, pemilikLokal, pemilikProduksi } = twoWay.tarifPindah;
  const row = { ...baris, checkIn: new Date(baris.checkIn), checkOut: new Date(baris.checkOut), observedAt: new Date(baris.observedAt) };
  // Kunci lama memuat nama pesaing, jadi dua atribusi terlihat sebagai dua tangkapan dan versi salah tersalin balik.
  assert.equal(rateIdentity(pemilikLokal, row), rateIdentity(pemilikProduksi, row));
  const plan = pairByIdentity([{ id: "l", key: rateIdentity(pemilikLokal, row) }], [{ id: "p", key: rateIdentity(pemilikProduksi, row) }]);
  assert.deepEqual([plan.pairs, plan.onlyLocal, plan.onlyRemote], [[["l", "p"]], [], []]);
  // Dua baris dengan identitas sama di satu DB tidak ditebak: tidak dipasangkan dan tidak disalin.
  const twin = pairByIdentity([{ id: "l", key: rateIdentity(pemilikLokal, row) }], [{ id: "p1", key: rateIdentity(pemilikProduksi, row) }, { id: "p2", key: rateIdentity(pemilikLokal, row) }]);
  assert.deepEqual([twin.pairs, twin.onlyLocal, twin.onlyRemote, twin.duplicates.length], [[], [], [], 1]);
});

test("tanggal promo yang sudah dikoreksi ke kalender WIB di lokal menimpa tanggal lama di produksi", () => {
  for (const pair of twoWay.promoBeda) {
    const { toRemote, toLocal } = localFirst(pair.lokal, pair.produksi, PROMO_FIELDS);
    assert.equal(toRemote.startsAt, pair.lokal.startsAt, pair.lokal.kunci);
    assert.equal(toRemote.endsAt, pair.lokal.endsAt, pair.lokal.kunci);
    assert.ok(!("startsAt" in toLocal) && !("endsAt" in toLocal), pair.lokal.kunci);
  }
  // Kolom yang kosong di lokal tidak menghapus isi produksi; justru diisi dari produksi.
  const [first] = twoWay.promoBeda;
  const { toRemote, toLocal } = localFirst({ ...first.lokal, kind: null }, { ...first.produksi, kind: "event" }, ["kind"]);
  assert.deepEqual([toRemote, toLocal], [{}, { kind: "event" }]);
});

// Baris promo penuh asli dari DB kerja lokal 22 Nov 2026 yang sudah berkategori promosi (lihat _sumber di fixture).
const salinan = JSON.parse(readFileSync("tests/fixtures/promo-salinan-2026-11-22.json", "utf8")) as {
  rows: {
    pesaing: string;
    baris: Omit<CompetitorPromotion, "startsAt" | "endsAt" | "capturedAt" | "createdAt" | "price" | "originalPrice" | "discount"> & {
      startsAt: string;
      endsAt: string | null;
      capturedAt: string;
      createdAt: string;
      price: string | null;
      originalPrice: string | null;
      discount: string | null;
    };
  }[];
};
const promoRow = (i: number): CompetitorPromotion => {
  const r = salinan.rows[i].baris;
  const decimal = (v: string | null) => (v === null ? null : new Prisma.Decimal(v));
  return {
    ...r,
    startsAt: new Date(r.startsAt),
    endsAt: r.endsAt ? new Date(r.endsAt) : null,
    capturedAt: new Date(r.capturedAt),
    createdAt: new Date(r.createdAt),
    price: decimal(r.price),
    originalPrice: decimal(r.originalPrice),
    discount: decimal(r.discount),
  };
};

test("promo yang disalin ke DB lain membawa seluruh isi tangkapan, termasuk kategori promosi", () => {
  const row = promoRow(0);
  assert.equal(row.promotionType, "potongan_harga");
  const data = promoCopyData(row, row.competitorId);
  for (const field of PROMO_FIELDS) assert.ok(field in data, `kolom ${field} ikut disalin`);
  assert.equal(data.promotionType, "potongan_harga");
  // Setiap kolom skalar selain id dan version (dibuat DB tujuan) ada di salinan, jadi kolom baru tidak hilang diam-diam.
  const scalar = Object.values(Prisma.CompetitorPromotionScalarFieldEnum).filter((c) => c !== "id" && c !== "version");
  assert.deepEqual(Object.keys(data).sort(), [...scalar].sort());
  // Kolom yang bukan identitas tangkapan harus ikut disamakan pada pasangan (PROMO_FIELDS).
  const identity = ["competitorId", "title", "capturedAt", "createdAt"];
  assert.deepEqual(scalar.filter((c) => !identity.includes(c)).sort(), [...PROMO_FIELDS].sort());
});

test("promo yang 22 Nov tersalin tanpa kategori promosi terisi dari lokal pada sinkron berikutnya lewat pasangan", () => {
  const local = promoRow(0);
  // Salinan di produksi dibuat payload lama: baris yang sama tanpa promotionType.
  const remote: CompetitorPromotion = { ...local, id: `${local.id}-produksi`, version: 1, promotionType: null };
  const owner = salinan.rows[0].pesaing;
  const plan = pairByIdentity([{ id: local.id, key: promoIdentity(owner, local) }], [{ id: remote.id, key: promoIdentity(owner, remote) }]);
  assert.deepEqual([plan.pairs, plan.onlyLocal, plan.onlyRemote], [[[local.id, remote.id]], [], []]);
  const { toRemote, toLocal } = localFirst(local, remote, PROMO_FIELDS);
  assert.deepEqual(toRemote, { promotionType: "potongan_harga" });
  assert.deepEqual(toLocal, {});
});

// Baris Source dan kolom rating asli dari kedua DB, 22 Nov 2026 (lihat _sumber di fixture).
const sumberRating = JSON.parse(readFileSync("tests/fixtures/sumber-dan-rating-2026-11-22.json", "utf8")) as {
  sumber: Record<"lokal" | "produksi", SourceRow[]>;
  rating: Record<
    "lokal" | "produksi",
    { id: string; name: string; rating: string | null; reviewCount: number | null; ratingSource: string | null; ratingSourceUrl: string | null; ratingObservedAt: string | null; version: number }[]
  >;
};
const ratingRow = (r: (typeof sumberRating.rating.lokal)[number]) => ({
  ...r,
  rating: r.rating === null ? null : new Prisma.Decimal(r.rating),
  ratingObservedAt: r.ratingObservedAt ? new Date(r.ratingObservedAt) : null,
});

test("label rating yang dirapikan di lokal sampai ke produksi walau waktu bacanya sama, jadi nama alat tidak tertinggal di web", () => {
  assert.equal(sumberRating.rating.lokal.length, 3);
  sumberRating.rating.lokal.forEach((l, i) => {
    const local = ratingRow(l);
    const remote = ratingRow(sumberRating.rating.produksi[i]);
    assert.equal(remote.name, local.name);
    assert.ok(sameValue(local.ratingObservedAt, remote.ratingObservedAt), `${local.name}: bacaan yang sama`);
    assert.match(String(remote.ratingSource), /Crawl4AI/);
    assert.deepEqual(changedFields(local, remote, registryFieldsToRemote(local, remote)), { ratingSource: l.ratingSource });
  });
});

test("rating produksi yang dibaca lebih baru tetap tidak ditimpa bacaan lokal yang lebih lama", () => {
  const local = ratingRow(sumberRating.rating.lokal[0]);
  const remote = { ...ratingRow(sumberRating.rating.produksi[0]), ratingObservedAt: new Date(local.ratingObservedAt!.getTime() + 86_400_000) };
  assert.ok(!registryFieldsToRemote(local, remote).includes("ratingSource"));
});

const jobRegistry = Object.values(DEFAULT_JOB_SOURCES);

test("nama sumber job terdaftar mengikuti registri tugas; sumber yang hanya ada di satu DB tidak disalin", () => {
  const plan = planSourceNames(sumberRating.sumber.lokal, sumberRating.sumber.produksi, jobRegistry);
  assert.deepEqual(
    plan.map((p) => [p.side, `${p.domain}|${p.method}`, p.from, p.data]),
    [
      ["produksi", "competitor-websites|browser", { name: "Situs Resmi Pesaing" }, { name: "Situs Resmi Kompetitor" }],
      ["produksi", "news.google.com|rss", { name: "Google News" }, { name: "Google News Anyer" }],
    ],
  );
  const remoteByKey = new Map(sumberRating.sumber.produksi.map((s) => [`${s.domain}|${s.method}`, s]));
  for (const p of plan) {
    const row = remoteByKey.get(`${p.domain}|${p.method}`)!;
    assert.deepEqual([p.id, p.version], [row.id, row.version], "OCC memakai id dan versi baris produksi");
  }
});

test("rencana nama sumber kosong setelah diterapkan, jadi push berikutnya tidak menulis apa pun", () => {
  const { lokal, produksi } = sumberRating.sumber;
  const plan = planSourceNames(lokal, produksi, jobRegistry);
  const applied = (rows: SourceRow[], side: "lokal" | "produksi") =>
    rows.map((r) => {
      const p = plan.find((x) => x.side === side && x.id === r.id);
      return p ? { ...r, ...p.data, version: r.version + 1 } : r;
    });
  assert.deepEqual(planSourceNames(applied(lokal, "lokal"), applied(produksi, "produksi"), jobRegistry), []);
});

test("DB lokal yang job-nya belum berjalan sejak registri diganti ikut disamakan, bukan mengembalikan nama lama ke produksi", () => {
  // Baris produksi asli 22 Nov masih memakai nama lama; di sini dipakai sebagai keadaan lokal sebelum job lokal berjalan.
  const { produksi } = sumberRating.sumber;
  const plan = planSourceNames(produksi, produksi, jobRegistry);
  assert.deepEqual(
    plan.map((p) => [p.side, `${p.domain}|${p.method}`, p.data.name]),
    [
      ["lokal", "competitor-websites|browser", "Situs Resmi Kompetitor"],
      ["lokal", "news.google.com|rss", "Google News Anyer"],
      ["produksi", "competitor-websites|browser", "Situs Resmi Kompetitor"],
      ["produksi", "news.google.com|rss", "Google News Anyer"],
    ],
  );
});

test("migrasi tertunda dan migrasi yang menghapus skema dikenali dari berkas migrasi asli", () => {
  const dir = path.resolve("prisma/migrations");
  const dirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const applied = new Set(dirs.filter((d) => d !== "20261118000000_news_reading"));
  assert.deepEqual(pendingMigrations(dirs, applied), ["20261118000000_news_reading"]);
  const read = (name: string) => readFileSync(path.join(dir, name, "migration.sql"), "utf8");
  // 20260923020000 berisi DROP COLUMN "roomPackage"; migrasi berita hanya menambah kolom dan tabel.
  assert.deepEqual(destructiveMigrations(["20260923020000_competitor_review_fixes", "20261118000000_news_reading"], read), ["20260923020000_competitor_review_fixes"]);
});

test("migrasi yang mewajibkan kolom, menghapus constraint atau indeks, mengganti nilai enum, atau menghapus isi tabel ikut membatalkan push", () => {
  // Bentuk pernyataan keluaran prisma migrate diff; nama tabel, kolom, dan enum dari skema proyek ini.
  const risky: Record<string, string> = {
    set_not_null: 'ALTER TABLE "CompetitorPromotion" ALTER COLUMN "kind" SET NOT NULL;',
    drop_constraint: 'ALTER TABLE "CompetitorPromotion" DROP CONSTRAINT "CompetitorPromotion_competitorId_fkey";',
    drop_index: '-- DropIndex\nDROP INDEX "Article_contentHash_key";',
    rename_value: `ALTER TYPE "PromotionType" RENAME VALUE 'produk_baru' TO 'produk_anyar';`,
    truncate: 'TRUNCATE TABLE "ScrapeError";',
    delete: `DELETE FROM "CompetitorPromotion" WHERE "source" = 'Tim marketing Sanghyang';`,
  };
  assert.deepEqual(destructiveMigrations(Object.keys(risky), (name) => risky[name]), Object.keys(risky));
  // Kata kuncinya mirip tetapi aditif: ON DELETE pada kunci asing, kolom baru NOT NULL berbawaan, nilai enum baru, indeks baru.
  const additive: Record<string, string> = {
    fk_on_delete: 'ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    not_null_default: 'ALTER TABLE "Competitor" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;',
    add_value: `ALTER TYPE "PromotionType" ADD VALUE 'program_loyalitas';`,
    create_index: 'CREATE INDEX "CompetitorPromotion_kind_idx" ON "CompetitorPromotion"("kind");',
  };
  assert.deepEqual(destructiveMigrations(Object.keys(additive), (name) => additive[name]), []);
  // Semua migrasi asli: hanya DROP COLUMN roomPackage dan SET NOT NULL ownerToken yang tertangkap; promotion_type aditif.
  const dir = path.resolve("prisma/migrations");
  const dirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.ok(dirs.includes("20261121000000_promotion_type"));
  const read = (name: string) => readFileSync(path.join(dir, name, "migration.sql"), "utf8");
  assert.deepEqual(destructiveMigrations(dirs, read), ["20260923020000_competitor_review_fixes", "20260923080000_scrape_lock_owner_token"]);
});

test("klien produksi sinkron memakai socket_timeout tanpa mengubah parameter URL lain", () => {
  // Bentuk URL pooler di .env.local (host, port, pgbouncer=true); kredensialnya diganti.
  const pooler = "postgresql://u:rahasia@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
  const url = new URL(syncRemoteUrl({ DATABASE_URL: pooler }));
  assert.equal(url.searchParams.get("socket_timeout"), String(SYNC_SOCKET_TIMEOUT_S));
  assert.equal(url.searchParams.get("pgbouncer"), "true");
  for (const key of ["connect_timeout", "pool_timeout", "connection_limit"]) assert.ok(url.searchParams.get(key), `${key} dari getDatabaseUrl tetap ada`);
  // Nilai yang sudah tertulis di URL dipakai apa adanya, tidak digandakan.
  assert.deepEqual(new URL(syncRemoteUrl({ DATABASE_URL: `${pooler}&socket_timeout=15` })).searchParams.getAll("socket_timeout"), ["15"]);
});

test("socket_timeout memutus kueri yang tidak dijawab menjadi galat, bukan tunggu tanpa batas (DB lokal, pg_sleep)", async () => {
  // Mode pgbouncer seperti produksi: setiap kueri dibungkus BEGIN, DEALLOCATE ALL, dan COMMIT.
  const base = process.env.DATABASE_URL ?? "";
  const client = createDatabaseClient({ DATABASE_URL: syncRemoteUrl({ DATABASE_URL: `${base}${base.includes("?") ? "&" : "?"}pgbouncer=true` }, 1) });
  const started = Date.now();
  try {
    await assert.rejects(client.$queryRaw`SELECT pg_sleep(5)`, /Socket timeout/);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 4000, `galat muncul setelah ${elapsed} ms, sebelum kueri 5 detik selesai`);
  } finally {
    await client.$disconnect();
  }
});

test("artikel dibaca per halaman berbatas, bukan satu respons berisi seluruh tabel (DB lokal)", async () => {
  const client = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [{ emit: "event", level: "query" }] });
  const articleQueries: string[] = [];
  client.$on("query", (e) => {
    if (/FROM "public"\."Article"/.test(e.query)) articleQueries.push(e.query);
  });
  try {
    const total = await client.article.count();
    assert.ok(total > 1, "DB berisi artikel");
    articleQueries.length = 0;
    // Ukuran halaman diturunkan dari isi DB (lokal 12 ribu artikel, CI ratusan) supaya selalu ada beberapa halaman.
    const pageSize = Math.ceil(total / 3);
    const refs = await loadArticleRefs(client, pageSize);
    assert.equal(refs.length, total);
    assert.equal(new Set(refs.map((a) => a.id)).size, total, "setiap artikel tepat sekali");
    assert.ok(refs.every((a) => a.source.domain && a.source.method), "sumber berita ikut terbaca");
    assert.equal(articleQueries.length, Math.floor(total / pageSize) + 1, "satu kueri per halaman");
    for (const q of articleQueries) assert.match(q, /\bLIMIT\b/, "setiap kueri artikel berbatas");
  } finally {
    await client.$disconnect();
  }
});
