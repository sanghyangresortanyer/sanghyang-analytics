# Phase 9: Audit konsolidasi, redesain login dan Media Sosial, serta rilis produksi

Status: **Berjalan** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-014

## 1. Tujuan

Menuntaskan konsolidasi ADR-014 sampai produksi. Tidak ada pekerjaan VRP yang tertinggal di kode, skema, atau dokumen; halaman login dan tab Media Sosial diperbarui; lalu Sanghyang Analytics dirilis ke `https://analytics.sanghyang.com` atas izin pemilik.

## 2. Ruang lingkup

- Masuk:
  - Audit celah porting kode dari salinan baca-saja `VRP/` ke `src/`, serta selisih skema dan data antara basis data lokal dan produksi.
  - Migrasi `0086_wa_bookings.sql`, `0087_sales_bill_no_and_dbar_parts.sql`, dan `0088_sheet_stores.sql` di basis data lokal dan Supabase produksi `omuqbpxierdlfjascngz`.
  - Pemindahan pekerjaan VRP yang belum selesai ke [P10](11_phase_lanjutan_dari_vrp.md), pemindahan `docs/superpowers/` ke `docs/archive/`, dan salinan rujukan VRP yang masih berguna.
  - Redesain halaman login bertema situs resmi sanghyang.com dengan slogan baru berbahasa Inggris.
  - Redesain tab Media Sosial di halaman Marketing.
  - Rilis produksi ke `analytics.sanghyang.com` (alias `sanghyang-analytics.vercel.app` tetap aktif).
- Tidak masuk:
  - Butir P10 yang tidak dibutuhkan rilis.
  - `git commit`, `git push`, deploy, atau SQL produksi tanpa instruksi eksplisit pemilik.
  - Penulisan data VHP selain lewat halaman unggah "Upload Data".

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 014 | Aplikasi tunggal Sanghyang Analytics, satu schema `public`, Supabase `omuqbpxierdlfjascngz`, tanpa hook pre-push lama | Migrasi produksi lewat `supabase/migrations/` dan ledger Supabase; rilis memakai proyek Vercel `sanghyang-analytics` (`sin1`) |

## 4. Daftar periksa

Koordinator mencentang butir setelah buktinya (perintah dan hasil, tautan, atau konfirmasi pemilik) ditulis di bawah butir itu.

- [x] Audit konsolidasi VRP ke `sanghyang-analytics`: celah kode, skema, data, dan dokumen tercatat beserta tindak lanjutnya (pelaksana `@auditor-kode` dan `@auditor-db`).
  Bukti 26 Nov 2026: titik dasar VRP `a0ef96a`, 13 commit kode sampai `c64196a`; 56 dari 57 berkas terporting benar, satu hilang (`SECURITY_HEADERS` di `next.config.ts`, kini dipasang). 85 dari 86 berkas "termodifikasi" di VRP hanya beda CRLF. Celah konfigurasi yang ditutup: `DML_MIN_LIST_DATE=2026-11-01` dan tiga ID sheet gudang di `.env.local` serta `.env.development.local`. `chat-counts.ts` yatim dihapus (VRP menghapusnya di `6ecdc4f`). Folder `VRP/` dipindah ke Trash sebelum commit atas permintaan pemilik, setelah ekspor VHP (`fixtures/`, 108 berkas) dan `data/raw` disalin ke folder lokal yang diabaikan git.
- [x] Sinkron skema `0086..0088`: terpasang di basis data lokal (31 migrasi, 41 tabel ber-RLS) dan di Supabase produksi sebelum kode di-push, karena `/data-sheets` dan unggah VHP gagal seluruhnya bila kolom atau RPC barunya belum ada; ledger `supabase_migrations.schema_migrations` mencatat ketiganya dan kueri verifikasi ROLLOUT "Tambahan 26 Nov 2026" §5 lulus (pelaksana `@auditor-db`, disetujui pemilik).
  Bukti 26 Nov 2026 (UTC): `apply_migration` lewat MCP selalu berakhir "declined" karena dialog konfirmasi server Supabase tidak tampil di editor, jadi atas persetujuan pemilik ketiganya diterapkan lewat psql, satu transaksi per berkas berikut baris ledger berformat sama (versi `20261126100702`, `20261126100717`, `20261126100731`; md5 isi ledger sama dengan berkas). Uji kering sebelumnya di DB lokal dengan rollback. Pasca-cek: 41/41 tabel ber-RLS, `authenticated` di `wa_bookings` hanya DELETE/INSERT/SELECT/UPDATE, PK `sheet_hk_months` = `(property_id, store, period_month)`, baris HK tetap 1/204/191 dengan 0 baris non-HK.
- [x] Pemindahan dokumen: pekerjaan VRP yang belum selesai tercatat di P10, `docs/superpowers/` pindah ke `docs/archive/`, dan rujukan VRP tersalin ke lokasi standar dengan catatan asal (pelaksana `@penjaga-dokumen`).
  Bukti: 49 butir outstanding di [P10](11_phase_lanjutan_dari_vrp.md), dua dokumen arsip di `docs/archive/`, `brain.py phase --check` bersih.
- [x] Redesain halaman login bertema sanghyang.com dengan slogan baru berbahasa Inggris, dicek di desktop 1440 px dan ponsel 390 px (pelaksana `@pemeta-frontend` dan `@perayap-tema`).
  Bukti: palet era situs hidup (cream #F3F3EC, ink #1F2B4D, velvet #22382D), Noto Serif Display dan Archivo hanya di /login, logo dan foto udara resmi dari `sanghyang_web`; slogan "A comprehensive analytics workspace for resort operations, marketing and market intelligence." Dicek di peramban desktop 1568 px dan emulasi ponsel 390 px tanpa gulir horizontal; `src/app/login/page.test.ts` 4/4 lulus.
- [x] Redesain tab Media Sosial di halaman Marketing, dicek di desktop 1440 px dan ponsel 390 px (pelaksana `@pemeta-frontend`).
  Bukti 26 Nov 2026 di `http://localhost:3001` dengan sesi pemilik: tab "Sosmed Sanghyang" digabung ke "Media Sosial" (`?bagian=sosmed&lihat=audit` dialihkan ke `?bagian=media-sosial`), "Daftar Akun Sosmed" dihapus seutuhnya, Audit Promo Outlet menjadi bagian di atas evaluasi, dan evaluasi menjadi grid kartu (foto, lencana jenis dan sumber, metrik, skor total, Hook/Copy/CTA, saran perbaikan). Semua Outlet 33 kartu; Sunset Grill 7 kartu, menyempit ke 1 kartu saat periode 20–26 Nov; keterangan per akun menyebut akun yang belum tersambung ke Meta ("data dari ekstensi"). Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, jadi satu kolom di 390 px. 94 tes terkait lulus. Catatan: server dev diikat ke `localhost`; membuka lewat `127.0.0.1` membuat halaman tidak terhidrasi karena Next 16 menolak WebSocket HMR lintas-origin.
- [ ] Rilis produksi ke `https://analytics.sanghyang.com` atas izin pemilik: env produksi lengkap (termasuk `DML_MIN_LIST_DATE=2026-11-01` dan ID sheet gudang, lihat P10 DML-1 dan GS-1), deploy Vercel READY, health dan login dicek, lalu tindakan pasca-deploy ROLLOUT "Tambahan 26 Nov 2026" §4 langkah 5 dijalankan (koordinator dan pemilik, diperiksa `@verifier-1`).

## 5. Berkas utama

- [ROLLOUT_PRODUKSI.md](../plans/ROLLOUT_PRODUKSI.md): §3 Langkah 1 (cara migrasi yang berlaku) dan bagian "Tambahan 26 Nov 2026"
- `supabase/migrations/0086_wa_bookings.sql`, `0087_sales_bill_no_and_dbar_parts.sql`, `0088_sheet_stores.sql`
- `src/app/login/` dan `src/app/(app)/marketing/` beserta komponennya
- [P10 pekerjaan lanjutan dari VRP](11_phase_lanjutan_dari_vrp.md), [arsip fondasi Market Intelligence](../archive/2026-09-22-rencana-fondasi-market-intelligence.md), [panduan tarik data VHP](../guides/panduan-tarik-data-vhp.md)

## 6. Verifikasi

- `python3 .agents/scripts/brain.py phase --check` tanpa galat.
- Kueri ledger dan kueri verifikasi ROLLOUT "Tambahan 26 Nov 2026" §5 di Supabase produksi.
- Gerbang mutu (`tsc --noEmit`, `eslint`, `vitest`, `test:market`) lewat `python3 .agents/scripts/resource_guard.py`.
- Tangkapan layar halaman login dan tab Media Sosial di 1440 px dan 390 px.
- Sesudah rilis: `https://analytics.sanghyang.com/api/health` menjawab 200 dan halaman terkunci mengalihkan ke login.

## 7. Kriteria keluar

- [ ] Semua butir §4 bercentang dengan bukti
- [ ] `python3 .agents/scripts/brain.py phase --check` tanpa galat
- [ ] Pemilik mengonfirmasi fase ditutup
