import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyScrapeIssue } from "../../src/lib/market/refresh-status";

test("galat crawl ulasan diterjemahkan dengan nama tempatnya", () => {
  assert.equal(
    friendlyScrapeIssue("Ulasan gagal untuk Mambruk Hotel & Convention: Timed out after waiting 60000ms"),
    "Mambruk Hotel & Convention: halaman terlalu lama dimuat",
  );
  assert.equal(
    friendlyScrapeIssue('Ulasan gagal untuk Novus Jiva Anyer Villa, Resort & Spa: halaman hotel Google Travel tidak ditemukan untuk "Novus Jiva"'),
    "Novus Jiva Anyer Villa, Resort & Spa: halamannya belum ditemukan di Google Travel",
  );
});

test("galat Gemini, Prisma, dan Instagram tidak tampil mentah", () => {
  assert.equal(
    friendlyScrapeIssue('Gemini gagal membaca postingan: BM Seaside View Cafe & Resto: {"error":{"code":503,"status":"UNAVAILABLE"}}'),
    "BM Seaside View Cafe & Resto: layanan pembaca otomatis sedang sibuk",
  );
  assert.equal(
    friendlyScrapeIssue("Gemini gagal membaca postingan: Marbella Place Anyer by Jayakarta: Invalid `prisma.competitorPromotion.updateMany()` invocation: unexpected end of hex escape at line 1"),
    "Marbella Place Anyer by Jayakarta: teks berisi emoji terpotong saat disimpan",
  );
  assert.equal(
    friendlyScrapeIssue("Dilewati: Instagram Graph API belum tersambung: isi INSTAGRAM_ACCESS_TOKEN untuk mengaktifkan."),
    "Instagram belum tersambung lewat akses resmi",
  );
});

test("pesan yang belum dikenal tetap disebut, dipotong, dan tidak dikarang", () => {
  const out = friendlyScrapeIssue("Something new happened ".repeat(20));
  assert.match(out, /^Kendala teknis \(Something new happened/);
  assert.ok(out.length < 150);
});

test("catatan langkah yang dilewati tampil sebagai alasannya, tanpa nama mesin AI", () => {
  assert.equal(
    friendlyScrapeIssue("Dilewati: Tidak ada promo baru untuk diimpor dan tidak ada promo yang lewat masa berlakunya."),
    "Tidak ada promo baru untuk diimpor dan tidak ada promo yang lewat masa berlakunya",
  );
  for (const message of [
    'Gemini gagal membaca postingan: BM Seaside View Cafe & Resto: {"error":{"code":503,"status":"UNAVAILABLE"}}',
    "Dilewati: Instagram Graph API belum tersambung: isi INSTAGRAM_ACCESS_TOKEN untuk mengaktifkan.",
  ]) {
    assert.doesNotMatch(friendlyScrapeIssue(message), /Gemini/);
  }
});
