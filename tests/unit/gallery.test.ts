import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GALLERY_SOURCE, getGalleryPhotoStatus, isShownPhoto, placePhotos, validateGallery, type GalleryPhoto } from "../../src/lib/market/competitor-gallery";
import { loadGalleryByOutlet, photoFitsOutlet, registryPlaceIds } from "../../src/lib/market/gallery-outlets";
import { applyVerdict, getVisualInsight, insightFromReading, parsePhotoReading, type VisualInsight } from "../../src/lib/market/competitor-visual-insights";
import { loadCompsetAudit } from "../../src/lib/market/compset-audit";
import { loadResortMarketSize } from "../../src/lib/market/market-size";
import galleryData from "../../src/lib/market/competitor-gallery.data.json";
import insightData from "../../src/lib/market/competitor-visual-insights.data.json";
import { db } from "../../src/lib/db";

test("Galeri Kompetitor (D9) - Validasi data foto berprovenans", async () => {
  const problems = validateGallery(galleryData, await registryPlaceIds());
  assert.equal(problems.length, 0, `Data galeri tidak boleh memiliki error: ${problems.join(", ")}`);
});

test("Galeri Kompetitor (D9) - Status foto jujur tanpa janji crawl palsu", () => {
  assert.equal(getGalleryPhotoStatus([]), "Belum dikumpulkan");

  const samplePhoto = {
    url: "https://lh3.googleusercontent.com/p/sample",
    category: "kamar" as const,
    caption: "Kamar Deluxe Ocean View",
    outlet: null,
    sourceType: "Google Maps" as const,
    sourceUrl: "https://maps.google.com/?cid=123",
    capturedAt: "2026-11-09",
  };

  assert.equal(getGalleryPhotoStatus([samplePhoto]), "Tersedia");
});

test("Galeri Kompetitor (D9) - Tidak ada teks janji crawl palsu di kode UI modal detail kompetitor", () => {
  const modalPath = path.resolve(process.cwd(), "src/components/marketing/sn-competitor-detail-modal.tsx");
  const source = fs.readFileSync(modalPath, "utf-8");

  assert.ok(
    !source.includes("menunggu crawl"),
    "UI detail kompetitor tidak boleh menjanjikan 'menunggu crawl berikutnya' karena tidak ada crawler terjadwal (Zero Mock D9)",
  );
});

test("Galeri Pesaing: daftar per outlet sama dengan registri pembanding di Insight Pasar", async () => {
  const [byOutlet, audit] = await Promise.all([loadGalleryByOutlet(), loadResortMarketSize().then(loadCompsetAudit)]);
  for (const outlet of ["sunset-grill", "dragon-beach-club", "dbistro", "dbar", "dspa"] as const) {
    assert.deepEqual(byOutlet[outlet].map((p) => p.name).sort(), audit[outlet].used.map((c) => c.name).sort(), `${outlet}: daftar galeri berbeda dari registri`);
  }
  const names = byOutlet.all.map((p) => p.name);
  for (const gone of ["Pondok Cirebone", "Pondok Ikan Bakar Khas BAROKAH", "Patra Anyer Hotel", "Bale-Bale Spa ASTON"]) {
    assert.ok(!names.includes(gone), `${gone} sudah dikeluarkan dan tidak boleh tampil`);
  }
  assert.ok(byOutlet.resort.some((p) => p.group === "own"), "Kamar & Resort menampilkan Sanghyang sebagai pembanding");
});

test("Galeri Pesaing: foto kamar dan kolam hotel tidak tampil di outlet F&B, bar, atau spa", async () => {
  const byOutlet = await loadGalleryByOutlet();
  for (const outlet of ["sunset-grill", "dragon-beach-club", "dbistro", "dbar", "dspa"] as const) {
    for (const place of byOutlet[outlet]) {
      assert.ok(place.photos.every((ph) => ph.category !== "kamar"), `${outlet}/${place.name}: foto kamar ikut tampil`);
    }
  }
  const lighthouse = byOutlet["dbar"].find((p) => p.name.startsWith("Lighthouse"));
  assert.ok(lighthouse && lighthouse.parentName, "Lighthouse tercatat sebagai outlet di dalam Mambruk");
  assert.ok(lighthouse.hiddenPhotos > 0, "foto Mambruk yang tidak terkait bar disembunyikan dan dihitung");
  // Keterangan foto nyata dari listing Google Maps (competitor-gallery.data.json).
  const pool = { url: "x", category: "fasilitas" as const, caption: "Novus Jiva Villa, Resort & Spa - Kolam renang di tepi pantai berpasir", outlet: null, sourceType: "Google Maps" as const, sourceUrl: "x", capturedAt: "2026-11-09" };
  assert.equal(photoFitsOutlet(pool, "dspa", false, true), false, "nama hotel '... & Spa' tidak membuat foto kolam masuk D'Spa");
  assert.equal(photoFitsOutlet(pool, "resort", false, true), true);
});

test("Galeri Pesaing: foto resmi outlet hotel berasal dari situs outlet/induknya atau Google Maps terverifikasi", async () => {
  const venues = await db.competitor.findMany({
    where: { parentId: { not: null }, placeId: { not: null } },
    select: { name: true, placeId: true, websiteUrl: true, parent: { select: { websiteUrl: true } } },
  });
  const byId = new Map(venues.map((v) => [v.placeId as string, v]));
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
  const official = galleryData.places.filter((p) => byId.has(p.placeId));
  assert.ok(official.length > 0, "ada outlet hotel yang punya foto");
  for (const place of official) {
    const venue = byId.get(place.placeId)!;
    const hosts = [venue.websiteUrl, venue.parent?.websiteUrl].filter((u): u is string => Boolean(u)).map(host);
    for (const photo of place.photos) {
      if (photo.sourceType === "Google Maps") {
        assert.ok(host(photo.sourceUrl).includes("google."), `${place.placeId}: sumber Google Maps harus domain google`);
        continue;
      }
      assert.equal(photo.sourceType, "situs resmi", `${place.placeId}: sumber foto outlet hotel`);
      assert.ok(photo.caption.startsWith(`${venue.name} - `), `${place.placeId}: keterangan diawali nama outlet`);
      assert.ok(hosts.includes(host(photo.sourceUrl)), `${place.placeId}: ${photo.sourceUrl} bukan situs outlet atau hotel induknya`);
    }
  }
});

test("Galeri Kompetitor (D9) - placePhotos hanya foto yang masih hidup", () => {
  const astonPhotos = placePhotos("aston_anyer");
  assert.ok(astonPhotos.length > 0);
  assert.ok(astonPhotos.every((p) => !p.expired));
  assert.ok(astonPhotos.every((p) => p.relevant === true), "tabel hotel di Insight Pasar juga hanya memakai foto yang relevan");
});

// Sembilan foto Google Maps Star Queen Restoran N Karaoke Cilegon (diambil 9 Nov 2026, competitor-gallery.data.json),
// dengan keterangan hasil pembacaan 9 Nov. Pemakai (15 Nov 2026) menilai foto orang berpose, mobil saat hujan, pekerja
// bangunan, dan rapat bukan foto tempat usahanya; foto keluarga dan bayi termasuk foto orang. Foto 1 berupa etalase.
const STAR_QUEEN = "star_queen_restoran_n_karaoke_cilegon";
const STAR_QUEEN_OFF_TOPIC = [
  "ANWiy9T3OzaYrHUgnD5x",
  "ANWiy9TeD82UfVhfotkk",
  "ANWiy9QCeXBnYjsXQl5x",
  "ANWiy9SMeOGmM33plmmQ",
  "ANWiy9TjWtmHEJrh-whA",
  "ANWiy9RkospC7VgfJ0s3",
  "ANWiy9QJPQdMgq2bwJ4W",
  "ANWiy9SKgr8TeuS5rSKi",
];
const starQueenPhotos = () => structuredClone(galleryData.places.find((p) => p.placeId === STAR_QUEEN)!.photos) as GalleryPhoto[];
const starQueenAnswer = {
  photos: [
    { i: 1, subject: "tempat", category: "restoran-outlet", caption: "Etalase kaca berisi makanan, botol minum, dan wadah saji" },
    { i: 2, subject: "orang", category: "lainnya", caption: "Pria berseragam hijau berdiri memegang ponsel di area luar" },
    { i: 3, subject: "kendaraan", category: "lainnya", caption: "Tampak depan mobil hitam saat hujan turun di halaman paving" },
    { i: 4, subject: "bangunan-lain", category: "lainnya", caption: "Pekerja bangunan duduk di area proyek konstruksi" },
    { i: 5, subject: "acara", category: "lainnya", caption: "Sekelompok orang duduk rapat di ruangan dengan lukisan burung" },
    { i: 6, subject: "orang", category: "lainnya", caption: "Keluarga berkumpul di area luar dekat material bangunan" },
    { i: 7, subject: "orang", category: "lainnya", caption: "Empat orang berfoto bersama di area teras dengan atap kayu" },
    { i: 8, subject: "orang", category: "lainnya", caption: "Sekelompok pria berpeci berfoto bersama di dalam ruangan" },
    { i: 9, subject: "orang", category: "kamar", caption: "Bayi berbaring di kasur bermotif kartun dengan botol susu" },
  ],
  insight: null,
};
// Ringkasan interior Star Queen hasil pembacaan 14 Nov 2026 (competitor-visual-insights.data.json): dibangun dari
// etalase, ruang rapat, dan area luar, padahal dua foto terakhir bukan tempat usahanya.
const oldStarQueenInsight = {
  designStyle: "Kombinasi ruang fungsional, area rapat, dan ruang terbuka",
  ambience: "Suasana kasual, kebersamaan keluarga, dan aktivitas fungsional sehari-hari",
  materialsAndLighting: "Didominasi material kaca, kayu, dinding cat terang, serta pencahayaan alami dan lampu ruangan standar.",
  marketingOpportunity: "Fokuskan konten marketing pada area tempat duduk santai dan kebersamaan untuk menarik pengunjung keluarga.",
  keyVisualElements: ["Etalase kaca berisi makanan dan perlengkapan saji", "Ruang pertemuan dengan lukisan dinding dan meja kerja", "Area luar dengan lanskap pepohonan dan latar bangunan"],
};

test("Galeri Pesaing: setiap foto dinilai memperlihatkan tempat usahanya atau tidak, dan penolakan wajib beralasan", () => {
  const reading = parsePhotoReading(JSON.stringify(starQueenAnswer), 9);
  assert.ok(reading, "jawaban JSON yang sah terbaca");
  assert.equal(reading.photos.size, 9);
  assert.equal(reading.photos.get(1)?.relevant, true);
  for (let i = 2; i <= 9; i++) {
    const verdict = reading.photos.get(i);
    assert.equal(verdict?.relevant, false, `foto ${i} bukan tempat usahanya`);
    assert.ok(verdict?.reason && verdict.reason.length <= 120, `foto ${i}: alasan wajib ada`);
  }
  assert.equal(reading.insight, null);

  assert.equal(reading.photos.get(5)?.subject, "acara", "foto rapat diarsipkan walaupun ruangannya terlihat");
  // Daftar harga paket milik tempat itu tetap tampil (foto Google Maps Happy Puppy Karaoke, diambil 9 Nov 2026).
  const priceList = { i: 1, subject: "menu", category: "lainnya", caption: "Daftar harga paket Triple Delight dan informasi kontak" };
  assert.equal(parsePhotoReading(JSON.stringify({ photos: [priceList], insight: null }), 1)?.photos.get(1)?.relevant, true);
  // Subjek yang hilang atau di luar daftar tidak ditebak: fotonya tidak ikut dinilai dan dicatat sebagai masalah.
  const incomplete = parsePhotoReading(
    JSON.stringify({ photos: [starQueenAnswer.photos[0], { ...starQueenAnswer.photos[1], subject: undefined }, { ...starQueenAnswer.photos[2], subject: "lain-lain" }], insight: null }),
    3,
  );
  assert.deepEqual([...(incomplete?.photos.keys() ?? [])], [1]);
  assert.equal(incomplete?.problems.length, 2);
});

test("Galeri Pesaing: ringkasan interior hanya dibangun dari foto relevan yang memperlihatkan ruang tempat itu", () => {
  const photos = starQueenPhotos();
  const answer = (insight: unknown, first = starQueenAnswer.photos[0]) => JSON.stringify({ photos: [first, ...starQueenAnswer.photos.slice(1)], insight });
  // Ringkasan lama memakai foto rapat (5) dan keluarga (6): ditolak, bukan dipotong diam-diam.
  const rejected = parsePhotoReading(answer({ ...oldStarQueenInsight, fromPhotos: [1, 5, 6] }), 9);
  assert.equal(rejected?.insight, null);
  assert.ok(rejected?.problems.some((p) => p.includes("5") && p.includes("6")), "masalahnya menyebut foto yang tidak relevan");
  // Tanpa daftar foto sumber, ringkasan tidak bisa diperiksa sehingga tidak dipakai.
  assert.equal(parsePhotoReading(answer(oldStarQueenInsight), 9)?.insight, null);
  // Foto hidangan atau menu saja tidak cukup untuk menilai gaya interior.
  assert.equal(parsePhotoReading(answer({ ...oldStarQueenInsight, fromPhotos: [1] }, { ...starQueenAnswer.photos[0], subject: "hidangan", category: "lainnya" }), 9)?.insight, null);

  const accepted = parsePhotoReading(answer({ ...oldStarQueenInsight, fromPhotos: [1] }), 9);
  assert.ok(accepted?.insight, "ringkasan dari foto etalase yang relevan diterima");
  const insight = insightFromReading(accepted!, (n) => photos[n - 1].url);
  assert.deepEqual(insight?.photoUrls, [photos[0].url]);
  assert.equal(insight?.photoCount, 1);
});

test("Galeri Pesaing: foto tidak relevan diarsipkan beserta alasannya, foto yang belum dinilai juga tidak tampil", () => {
  const photos = starQueenPhotos();
  for (const photo of photos) {
    delete photo.relevant;
    delete photo.irrelevantReason;
  }
  assert.ok(photos.every((p) => !isShownPhoto(p)), "foto yang belum dinilai tidak ditampilkan");
  const reading = parsePhotoReading(JSON.stringify(starQueenAnswer), 9)!;
  for (const [n, verdict] of reading.photos) applyVerdict(photos[n - 1], verdict);
  assert.deepEqual(photos.filter(isShownPhoto).map((p) => p.url), [photos[0].url]);
  assert.equal(photos.length, 9, "foto tidak dihapus");
  for (const photo of photos.slice(1)) assert.ok(photo.relevant === false && photo.irrelevantReason, "alasan arsip tersimpan");
  const data = { source: galleryData.source, updatedAt: galleryData.updatedAt, places: [{ placeId: STAR_QUEEN, photos }] };
  assert.deepEqual(validateGallery(data), []);
  // Foto yang dinilai ulang relevan tidak menyimpan alasan lama.
  applyVerdict(photos[1], { subject: "tempat", relevant: true, reason: null, category: "fasilitas", caption: "x" });
  assert.equal(photos[1].irrelevantReason, undefined);
  assert.ok(validateGallery({ ...data, places: [{ placeId: STAR_QUEEN, photos: [{ ...photos[2], irrelevantReason: undefined }] }] }).some((p) => p.includes("irrelevantReason")));
});

test("Galeri Pesaing: Star Queen tidak lagi menampilkan foto orang, kendaraan, proyek bangunan, atau rapat", async () => {
  const byOutlet = await loadGalleryByOutlet();
  const card = byOutlet.dbar.find((p) => p.placeId === STAR_QUEEN);
  assert.ok(card, "Star Queen tetap tampil sebagai pembanding D'Bar & Karaoke");
  for (const photo of card.photos) assert.ok(!STAR_QUEEN_OFF_TOPIC.some((id) => photo.url.includes(id)), `foto tidak relevan tampil: ${photo.caption}`);
  assert.ok(card.irrelevantPhotos >= STAR_QUEEN_OFF_TOPIC.length, "jumlah foto yang diarsipkan dilaporkan ke pemakai");
  const archived = galleryData.places.find((p) => p.placeId === STAR_QUEEN)!.photos as GalleryPhoto[];
  assert.equal(archived.length, 9, "foto Star Queen tetap tercatat di data sebagai arsip");
  for (const id of STAR_QUEEN_OFF_TOPIC) {
    const photo = archived.find((p) => p.url.includes(id))!;
    assert.ok(photo.relevant === false && photo.irrelevantReason, `${id}: alasan arsip wajib ada`);
  }
});

test("Galeri Pesaing: semua foto tempat yang tampil sudah dinilai, dan ringkasan interior hanya dari foto yang tampil", async () => {
  const byOutlet = await loadGalleryByOutlet();
  const ids = new Set(Object.values(byOutlet).flat().flatMap((p) => [p.placeId, p.photoPlaceId]));
  const insights = insightData.insights as Record<string, VisualInsight>;
  for (const id of ids) {
    const photos = (galleryData.places.find((p) => p.placeId === id)?.photos ?? []) as GalleryPhoto[];
    for (const photo of photos.filter((p) => !p.expired)) assert.equal(typeof photo.relevant, "boolean", `${id}: ${photo.url} belum dinilai`);
    const insight = insights[id];
    if (!insight) continue;
    const shown = new Set(photos.filter(isShownPhoto).map((p) => p.url));
    const sources = insight.photoUrls ?? [];
    assert.ok(sources.length > 0, `${id}: ringkasan tanpa daftar foto sumber`);
    assert.equal(insight.photoCount, sources.length, `${id}: jumlah foto ringkasan`);
    for (const url of sources) assert.ok(shown.has(url), `${id}: ringkasan memakai foto yang tidak tampil (${url})`);
    assert.ok(getVisualInsight(id), `${id}: ringkasan yang sah ditampilkan`);
  }
  // Ringkasan lama tanpa daftar foto sumber (tempat arsip) tidak ditampilkan.
  for (const [id, insight] of Object.entries(insights)) if (!insight.photoUrls) assert.equal(getVisualInsight(id), null, id);
});

test("Galeri Pesaing: teks yang dilihat pemakai tidak menyebut nama mesin AI", () => {
  assert.doesNotMatch(GALLERY_SOURCE.source, /gemini|gpt|claude|llm/i);
  const view = fs.readFileSync(path.resolve(process.cwd(), "src/components/marketing/sn-competitor-detail-modal.tsx"), "utf-8");
  assert.doesNotMatch(view, /gemini|gpt|claude|llm/i);
});
