# Phase 3: Pengujian Otomatis & Keamanan Sesi

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-001, ADR-006

## 1. Tujuan

Membangun kerangka pengujian otomatis berlapis yang aman dijalankan tanpa internet, tanpa database produksi, dan tanpa memanggil kuota Gemini, merapikan struktur direktori `scripts/`, memperkuat otentikasi sesi berbasis token HMAC dengan secret mandiri dan rate limiter login, mengaudit dependensi proyek, serta menyiapkan draf pipeline CI GitHub Actions.

## 2. Ruang lingkup

- Masuk:
  - Konfigurasi runner tes mandiri untuk pengujian unit, integrasi (DB lokal), dan parser fixture (K1).
  - Skrip pengujian `npm test` yang cepat, mandiri, dan aman dari mutasi produksi (K1).
  - Reorganisasi direktori `scripts/` menjadi `scripts/ops/`, `scripts/arsip/`, dan migrasi tes ke `tests/` (K2).
  - Penguatan cookie sesi berbasis token HMAC SHA-256 dengan secret terpisah, waktu kedaluwarsa, dan pembatas percobaan login di `/api/login` (K3).
  - Penghapusan sandi polos dari file dokumentasi (`BACA DULU.txt`) dan pengalihan seluruh fetch server ke `fetchAman` (K3).
  - Audit dan pembaruan dependensi kompatibel Next.js 16 / React 19 (K4).
  - Penyusunan draft workflow CI GitHub Actions tanpa eksekusi langsung (K5).
- Tidak masuk:
  - Menjalankan pipeline CI di repository GitHub pemilik secara langsung.

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 001 | Lingkungan pengembangan terpisah | Tes integrasi hanya boleh menargetkan kontainer DB lokal |
| 006 | Pengujian berlapis mandiri tanpa ketergantungan luar | Runner tes dikonfigurasi tanpa akses jaringan, Gemini, atau produksi |

## 4. Langkah kerja

| # | Langkah | Bukti (perintah + hasil, tautan, atau tangkapan layar) | Status |
| :---: | :--- | :--- | :--- |
| 1 | Konfigurasikan runner pengujian mandiri di `package.json` (K1) | `npm test` terpadu, 100% aman (DB lokal, tanpa Gemini, tanpa jaringan) | Selesai |
| 2 | Migrasikan skrip uji ad-hoc ke unit test dan parser test (K1) | Seluruh berkas uji berada di `tests/unit/`, 90 pass, 0 fail | Selesai |
| 3 | Reorganisasi struktur `scripts/` dan arsipkan skrip sekali pakai (K2) | `scripts/ops/` (operasional aktif), `scripts/arsip/` (skrip lama + README), data JSON ke `data/social-posts/` | Selesai |
| 4 | Rombak `lib/sandi.ts` dengan enkripsi HMAC ber-salt dan session secret (K3) | Token sesi HMAC-SHA256 ber-secret dengan kedaluwarsa deterministik, rotasi secret | Selesai |
| 5 | Tambahkan rate limiter pada endpoint `/api/login` (K3) | In-memory rate limiter per IP (maks 5 percobaan gagal per 15 menit) | Selesai |
| 6 | Bersihkan sandi polos dari dokumen repositori (K3) | Sandi polos dibersihkan dari `BACA DULU.txt`, `grep` bersih | Selesai |
| 7 | Pastikan semua pemanggilan HTTP sisi server memakai `fetchAman` (K3) | `fetchAman` SSRF guard aktif pada `promo-extractor.ts` dan unduhan gambar | Selesai |
| 8 | Periksa dan mutakhirkan dependensi proyek (`npm audit`, types) (K4) | Penyelarasan `@types/node` untuk Node 24 runtime; tsc 0 error, lint 0 error | Selesai |
| 9 | Susun draf pipeline CI GitHub Actions bebas eksekusi lokal (K5) | `.github/workflows/quality-ci.yml` terdefinisi rapi, terverifikasi oleh `@verifier` (board #83) | Selesai |

## 5. Berkas utama

- `tests/unit/`
- `scripts/ops/`
- `scripts/arsip/`
- `lib/sandi.ts`
- `app/api/login/route.ts`
- `lib/fetch-aman.ts`
- `.github/workflows/quality-ci.yml`

## 6. Verifikasi

- `npm test` -> 90 pass, 0 fail, 0 skipped (DB lokal, tanpa Gemini, tanpa internet).
- `npx tsc --noEmit` -> 0 galat.
- `npm run lint` -> 0 galat, 0 peringatan.
- Tes keamanan login & rate limiting terbukti menolak brute-force.
- Python: 14 pass, ruff check 0 error.
- Draf CI terverifikasi aman tanpa trigger eksekusi di lokal.

## 7. Kriteria keluar

- [x] Runner tes berjalan lancar dan aman melalui `npm test`
- [x] Folder `scripts/` tertata bersih dan seluruh skrip tes berada di `tests/`
- [x] Otentikasi sesi ber-HMAC dan pembatas laju login aktif
- [x] Sandi polos terhapus dari seluruh dokumen proyek
- [x] Draf workflow CI GitHub Actions selesai disusun (K5)
- [x] Verifikasi disetujui oleh `@verifier` (board #65, #83)
