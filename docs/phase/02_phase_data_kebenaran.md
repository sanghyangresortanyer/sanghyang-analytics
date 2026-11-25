# Phase 1: Integritas Data & Sumber Kebenaran

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-002, ADR-003, ADR-004

## 1. Tujuan

Menyatukan seluruh daftar kompetitor ke registri tunggal di basis data, membuang seluruh data karangan (Zero Mock: omset fiktif, peringkat buatan, sumber palsu), menstandarkan observasi ulasan & tarif, mengkalibrasi classifier berita pasar Anyer-Carita dengan data berlabel, dan mencatat eksekusi seluruh job scraping di tabel observabilitas.

## 2. Ruang lingkup

- Masuk:
  - Registri tunggal kompetitor di tabel database relasional `Competitor` dengan migrasi Prisma dan seed berprovenans (D1 - `@registri`).
  - Eliminasi angka pasar karangan, peringkat buatan, dan bukti palsu (D2 - `@provenans`).
  - Normalisasi status dan masa berlaku promo & event (D3 - `@provenans`).
  - Pembaruan siklus intelijen pasar dan kedaluwarsa insight otomatis (D4 - `@provenans`).
  - Penataan model omset & target riil berbasis impor pemilik (D5 - `@provenans`).
  - Normalisasi sumber ulasan, sentimen berbasis kata kunci, dan label verifikasi jujur (D6 - `@riset`).
  - Kalibrasi classifier berita pasar Anyer-Carita dengan set evaluasi berlabel (D7 - `@klasifikasi`).
  - Karantina skrip ulasan sintetis di `crawler/research/scripts` (D8 - `@riset`).
  - Observabilitas scraping: penambahan enum `ScrapeJob`, model `ScrapeRun` dan `ScrapeError` (C1, C2, C5 - `@observabilitas` & `@registri`).
- Tidak masuk:
  - Modifikasi frontend AppShell atau komponen halaman (masuk fase P2).
  - Penulisan ke database produksi (hanya DB lokal).

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 002 | Registri pembanding tunggal di basis data | Seluruh pembacaan compset dialihkan ke repositori database tunggal |
| 003 | Provenans data dan eliminasi data karangan (Zero Mock) | Skrip audit provenans diterapkan untuk memastikan 0 metrik tanpa bukti |
| 004 | Perayapan patuh, teramati, dan isolasi sumber berlogin | Semua job perayapan mencatat run dan error secara terstruktur |

## 4. Langkah kerja

| # | Langkah | Bukti (perintah + hasil, tautan, atau tangkapan layar) | Status |
| :---: | :--- | :--- | :--- |
| 1 | Rancang migrasi Prisma registri kompetitor tunggal di DB lokal (D1, C5) | Migrasi `20261113000000_competitor_registry_and_jobs` diterapkan ke DB lokal | Selesai |
| 2 | Buat seed berprovenans dari data JSON yang ada (D1) | Duplikat Aston digabung, Patra ditandai pensiun, DB lokal terbarui | Selesai |
| 3 | Bersihkan konstanta omset fiktif, ranking, dan skor karangan (D2, D5) | `grep` angka omset fiktif di `lib/` dan `app/` menghasilkan 0 baris | Selesai |
| 4 | Bangun skrip `npm run audit:provenance` (D2) | `npm run audit:provenance` 176/176 data tervalidasi, 0 fail (100% lulus) | Selesai |
| 5 | Normalisasi status promo & event berbasis tanggal (D3) | Konstanta promo statis dihapus, komparasi tanggal deterministik teruji | Selesai |
| 6 | Perbaiki classifier berita dan buat dataset evaluasi berlabel (D7) | Evaluasi 50 artikel Anyer-Carita mencapai presisi 0,94 (≥ 0,8) | Selesai |
| 7 | Karantina skrip sintetis di `crawler/research` dan amankan ingest (D8) | 6 skrip sintetis dipindah ke `quarantine/`, ingest tolak cid buatan | Selesai |
| 8 | Normalisasi label ulasan Google Maps vs Google Travel & rentang waktu (D6) | Filter jendela 24 bulan dan pembedaan label total vs tersimpan teruji | Selesai |
| 9 | Perluas enum `ScrapeJob` dan catat riwayat run/error (C1, C2) | 9 job terdaftar, pencatatan `ScrapeRun` dan `ScrapeError` aktif | Selesai |

## 5. Berkas utama

- `prisma/schema.prisma`
- `lib/market/competitor-repository.ts`
- `lib/market/pricing-benchmark.ts`
- `lib/market/competitor-comparison.ts`
- `lib/market/sync-social-promos.ts`
- `lib/market/classifier.ts`
- `lib/market/scrape-log.ts`
- `crawler/research/scripts/quarantine/`
- `lib/market/scrape-new-reviews.ts`

## 6. Verifikasi

- `npm run audit:provenance` -> 0 metrik tanpa sumber (176/176 titik data sah).
- `npm run test:unit` -> 43 passed, 0 failed.
- `npm run lint` -> 0 error, 0 warning di seluruh repositori.
- `npx tsc --noEmit` -> 0 error.

## 7. Kriteria keluar

- [x] Registri pembanding tunggal terpasang di database lokal dan dibaca seragam oleh seluruh modul
- [x] Seluruh data karangan (omset, ranking, bukti fiktif) terhapus dari codebase
- [x] Classifier berita pasar mencapai presisi ≥ 0,8 pada set evaluasi berlabel Anyer-Carita (aktual: 0,94)
- [x] Job scraping mencatat riwayat eksekusi ke `ScrapeRun` dan `ScrapeError`
- [x] Karantina data sintetis di `crawler/research` selesai dan ingest terlindungi
- [x] Verifikasi disetujui oleh `@verifier`
