import { test } from "node:test";
import assert from "node:assert/strict";
import { stripLoneSurrogates, truncateAtSentence, truncateText } from "../../src/lib/text/safe-truncate";

// Teks asli dari basis data lokal (CompetitorFact dan CompetitorReview, dibaca 16 Nov 2026).
const ASTON_DESCRIPTION =
  "Escape the bustle of Jakarta and experience Aston Anyer in Banten—a serene beachfront retreat. Enjoy leisurely walks on soft, sandy shores, soak in the breathtaking views of Krakatoa, and relax in our elegant overwater Aquavillas.";
const SANGHYANG_DESCRIPTION = "Resor tepi laut dengan konsep mata air panas alami, laguna, serta ratusan pohon jati dan kelapa hijau.";
const ASTON_ADDRESS = "Jl. Karang Bolong Km 139, Kp. Kosambi, Desa Karang Suraga, Cinangka, Serang, Banten, Indonesia, 42167";
const MAMBRUK_REVIEW =
  "Hotel nyaman, kamar bersih, pelayanan ramah, dan fasilitas cukup lengkap. Suasananya tenang dan lokasi mudah dijangkau. Pengalaman menginap yang menyenangkan, and recommended.";

test("matriks PDF: kalimat pertama tetap utuh walau lebih panjang dari batas (dulu terpotong jadi 'beachfront retr')", () => {
  assert.equal(truncateAtSentence(ASTON_DESCRIPTION, 90), "Escape the bustle of Jakarta and experience Aston Anyer in Banten—a serene beachfront retreat.");
  assert.equal(truncateAtSentence(SANGHYANG_DESCRIPTION, 90), SANGHYANG_DESCRIPTION, "satu kalimat 102 karakter dicetak utuh, bukan '...pohon jati dan k'");
});

test("matriks PDF: kalimat utuh diambil selama muat, kalimat berikutnya dibuang tanpa memotong kata", () => {
  assert.equal(truncateAtSentence(MAMBRUK_REVIEW, 130), "Hotel nyaman, kamar bersih, pelayanan ramah, dan fasilitas cukup lengkap. Suasananya tenang dan lokasi mudah dijangkau.");
  assert.equal(truncateAtSentence(MAMBRUK_REVIEW, 100), "Hotel nyaman, kamar bersih, pelayanan ramah, dan fasilitas cukup lengkap.");
  assert.equal(truncateAtSentence(ASTON_DESCRIPTION, ASTON_DESCRIPTION.length), ASTON_DESCRIPTION, "teks yang muat tidak diubah");
});

test("matriks PDF: titik singkatan (Jl., Kp.) bukan akhir kalimat", () => {
  assert.equal(truncateAtSentence(ASTON_ADDRESS, 60), ASTON_ADDRESS);
});

test("pemotongan tidak membelah emoji (pasangan surrogate)", () => {
  const caption = "Promo akhir tahun 🎉🎉 menginap 2 malam";
  assert.match(caption.slice(0, 21), /[\uD800-\uDBFF]$/, "slice biasa memang membelah emoji kedua");
  const cut = truncateText(caption, 21);
  assert.equal(cut, "Promo akhir tahun 🎉");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(cut)));
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut), false);
});

test("teks pendek tidak berubah, emoji gabungan tetap utuh", () => {
  assert.equal(truncateText("Halo", 10), "Halo");
  const family = "Keluarga 👨‍👩‍👧 senang";
  assert.equal(truncateText(family, 12), "Keluarga ");
});

test("surrogate tunggal yang sudah rusak dibuang", () => {
  assert.equal(stripLoneSurrogates("abc\uD83C"), "abc");
  assert.equal(stripLoneSurrogates("ok 🎉"), "ok 🎉");
});
