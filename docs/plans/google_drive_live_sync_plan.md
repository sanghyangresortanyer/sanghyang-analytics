# Integrasi Live Google Sheets untuk Inventory HK dan DML Pembelian Outlet

Catatan konsolidasi (ADR-014, 25 Nov 2026): rencana historis ini diserap ke **Sanghyang Analytics** (`sanghyang-analytics`). Sinkronisasi mingguan berjalan melalui Vercel Cron `/api/cron/sync-sheets` (`0 18 * * 0` UTC / Senin 01.00 WIB) dengan `Authorization: Bearer <CRON_SECRET>` (`crypto.timingSafeEqual`) dan menyimpan baris bertanggal ke tabel `sheet_hk_*` serta `sheet_dml_*` pada schema `public`.

## Ringkasan Desain & Kontrol

1. **Empat Nol**:
   - **Zero Mock Data**: data Inventory HK dan DML diambil langsung dari lembar Google Sheets resmi (`GOOGLE_SHEET_HK_ID`, `GOOGLE_SHEET_DML_ID`), bukan data tiruan.
   - **Zero Hardcode**: ID sheet, batas tanggal awal `DML_MIN_LIST_DATE`, properti target `SHEETS_PROPERTY_ID`, dan `CRON_SECRET` dimuat dari variabel lingkungan (terdokumentasi di `.env.example`).
   - **Zero Fallback**: kegagalan pembacaan atau validasi lembar dicatat pada `sheet_sync_state` dan mengembalikan status galat terstruktur tanpa menulis angka nol buatan.
   - **Zero Timeout**: pembaruan terjadwal dijalankan asinkron melalui endpoint cron dengan batas waktu terukur.
2. **Keamanan & Kepatuhan**:
   - Seluruh tabel `sheet_hk_*`, `sheet_dml_*`, dan `sheet_sync_state` di schema `public` dilindungi Row-Level Security per `property_id`.
   - Entitas konfigurasi dan status sinkronisasi memakai kontrol konkurensi optimistis (`version`).
   - Kepatuhan perlindungan data mengikuti UU PDP No. 27/2022 dan standar ISO/IEC 27001.

## Verifikasi

- Pengujian unit parser HK/DML serta otorisasi Bearer constant-time pada `/api/cron/sync-sheets` melalui `npx vitest run`.
- Validasi paritas variabel lingkungan pada [`.env.example`](../../.env.example).
- Validasi jadwal cron pada `vercel.json` dan pemeriksaan kesehatan `/api/health/ready`.
