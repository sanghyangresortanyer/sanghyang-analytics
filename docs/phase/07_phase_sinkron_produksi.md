# Phase 6: Sinkron data lokal dan produksi saat push

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-001, ADR-013

## 1. Tujuan

Produksi (https://sanghyang-news.vercel.app) menampilkan data yang sama dengan localhost:3001, sekarang dan setiap kali
pemakai melakukan commit dan push ke `master` (permintaan pemakai 19 Nov 2026).

## 2. Ruang lingkup

- Masuk:
  - Diagnosis selisih DB produksi dan DB kerja lokal per tabel (`.agents/local/probe/diff-all.ts`) dan per blok API
    ringkasan di peramban.
  - Skrip sinkron dua arah `scripts/ops/sync-production-data.ts` dengan tes aturan penggabungan dari data asli
    (`tests/unit/sync-production.test.ts`, fixture `tests/fixtures/sync-two-way-2026-11-19.json` dan
    `tests/fixtures/registry-legacy-names-2026-11-19.json`).
  - Hook `pre-push` (`scripts/ops/install-pre-push-hook.sh`, `scripts/ops/pre-push-sync.sh`,
    `scripts/ops/sync-before-push.ts`) yang menerapkan migrasi aditif dan sinkron sebelum push ke cabang produksi.
  - Urutan cadangan deterministik untuk nilai seri di `lib/market/summary.ts`, `lib/market/competitor-comparison.ts`, dan
    `app/api/market-intelligence/summary/route.ts` (tes `tests/unit/summary-order.test.ts`).
- Tidak masuk:
  - Menyalin log operasional per lingkungan (`ScrapeRun`, `ScrapeError`, `ScrapeLock`, `Source`, heartbeat malam).
  - Commit, push, atau `git pull` atas nama pemilik.

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 001 | Lingkungan pengembangan terpisah dan pengaman tulis | Tulisan ke produksi tetap lewat `ALLOW_PRODUCTION_WRITE=1`, kini juga dari hook pre-push atas persetujuan pemilik |
| 013 | DB produksi disamakan dengan DB lokal setiap push | Registri dan kurasi mengikuti lokal, pengamatan digabung dua arah, urutan tampilan deterministik |

## 4. Langkah kerja

| # | Langkah | Bukti (perintah + hasil, tautan, atau tangkapan layar) | Status |
| :---: | :--- | :--- | :--- |
| 1 | Diagnosis: skema sama, data registri/fakta/bacaan berita hanya di lokal; produksi punya tarif, ulasan, promo job malam | `diff-all.ts`: Competitor berperan 0 di produksi sebelum sinkron; Article hanya-lokal 400, hanya-produksi 572; ulasan arsip lokal aktif di produksi 8 | Selesai |
| 2 | Tes aturan penggabungan dari data asli kedua DB | `node --test --import tsx tests/unit/sync-production.test.ts tests/unit/summary-order.test.ts`: 13/13 lulus; tes urutan gagal dulu sebelum perbaikan | Selesai |
| 3 | Sinkron dua arah diterapkan ke produksi dan lokal | `sync-production-data.ts --apply` tiga putaran tanpa konflik OCC; uji kering sesudahnya nol perubahan di semua langkah; jumlah baris semua tabel data sama | Selesai |
| 4 | Hook pre-push terpasang dan diuji | Jalur cabang lain keluar 0 tanpa menyentuh DB; jalur `master` menjalankan cek migrasi dan sinkron idempoten, keluar 0 | Selesai |
| 5 | Verifikasi tampilan produksi vs lokal | Galeri Pesaing "Pesaing Sunset Grill 15 Tempat, 98 Foto"; sidik kanonis API ringkasan sama untuk berita, radar promo, jumlah, rating, menu, tarif, pangsa ulasan | Selesai |
| 6a | Insiden tarif Resort Prima tersalin balik ke lokal dan perbaikannya; identitas tangkapan tanpa nama pesaing | `fix-prima-rates-2026-11-19.ts`: kedua DB 53 → 0 tarif salah atribusi (44 ganda dihapus, 9 dipindah); tes `tarif yang dipindah ... tetap berpasangan` lulus | Selesai |
| 6b | Batas hari ringkasan dalam WIB dan tanggal teks promo dalam WIB | `tests/unit/summary-order.test.ts`: gagal dulu di TZ=UTC, lalu lulus di UTC dan Asia/Jakarta | Selesai |
| 6 | Pemilik menarik 3 commit data tarif kamar job malam (`git pull --ff-only origin master`) | Ukuran pasar, pangsa pasar, direktori OTA, tingkat harga audit pembanding sama setelah pull | Belum mulai |
| 7 | Pemilik commit dan push perubahan kode urutan deterministik; deploy Vercel READY | Kutipan ulasan pembanding dan urutan baris ringkasan sama di produksi dan lokal | Belum mulai |

## 5. Berkas utama

- `scripts/ops/sync-production-data.ts`
- `scripts/ops/sync-before-push.ts`
- `scripts/ops/pre-push-sync.sh`
- `scripts/ops/install-pre-push-hook.sh`
- `scripts/ops/fix-prima-rates-2026-11-19.ts`
- `tests/unit/sync-production.test.ts`
- `tests/unit/summary-order.test.ts`
- `tests/fixtures/sync-two-way-2026-11-19.json`
- `tests/fixtures/registry-legacy-names-2026-11-19.json`
- `tests/fixtures/summary-rows-same-date-2026-11-19.json`
- `lib/market/summary.ts`
- `lib/market/competitor-comparison.ts`
- `app/api/market-intelligence/summary/route.ts`
- `docs/plans/ROLLOUT_PRODUKSI.md`

## 6. Kriteria keluar

- Uji kering sinkron menghasilkan nol perubahan dan jumlah baris tabel data sama di kedua DB.
- Setelah langkah 6 dan 7, semua blok API ringkasan sama di produksi dan localhost:3001 kecuali heartbeat malam.

## Penutupan 22 Nov 2026

Push `e9d85a2`, `0c61be2`, `083bf59`, dan `e27042a` ke `master` menjalankan hook pre-push sampai selesai. Sinkron
terakhir tidak menemukan perubahan ("DB produksi sudah sama dengan DB kerja lokal"). Jumlah kompetitor aktif, kompetitor
inti, promo, ulasan, artikel, bacaan relevan, dan sebaran kategori promosi identik di kedua DB. Pembanding ringkasan
Insight Pasar (29 bagian, periode 30 hari, 90 hari, dan tahun ini, kolom ID diabaikan) menghasilkan 25 bagian identik.
Empat sisanya adalah catatan per lingkungan (heartbeat dan status sinkron), cap "Data per" waktu penyegaran terakhir, dan
sidik jari internal analisis dua outlet yang isinya identik. Perbedaan urutan karena collation basis data diperbaiki di
kode (lihat memori `urutan-collation-db`).

