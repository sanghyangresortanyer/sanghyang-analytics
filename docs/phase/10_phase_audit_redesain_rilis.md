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
- [x] Rilis produksi ke `https://analytics.sanghyang.com` atas izin pemilik: env produksi lengkap (termasuk `DML_MIN_LIST_DATE=2026-11-01` dan ID sheet gudang, lihat P10 DML-1 dan GS-1), deploy Vercel READY, health dan login dicek (koordinator).
  Bukti 26 Nov 2026: env Vercel produksi `GOOGLE_SHEET_MAIN_ID`, `GOOGLE_SHEET_BEV_ID`, `GOOGLE_SHEET_ENG_ID` (sensitive) dan `DML_MIN_LIST_DATE=2026-11-01` terpasang dari `.env.local` sanghyang-analytics. Commit `cd29795` (sanghyangresortanyer, noreply) di-push ke `main`; deploy `dpl_GAbjXiXJ5fFwAeyWcU4FjjU12Udi` READY dalam 64 detik dengan alias `analytics.sanghyang.com`; workflow Security checks sukses; tanpa galat runtime satu jam pertama. `/api/health` 200, `/marketing`, `/data-sheets`, dan `/laporan-resort` mengalihkan ke login tanpa sesi, header `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, dan `Permissions-Policy` aktif, dan `/login` memuat slogan baru tanpa teks lama. Langkah 1 ROLLOUT (dump sebelum migrasi) terlewat; sebagai gantinya dibuat dump pasca-migrasi `backups/omuqbpxierdlfjascngz-pasca-0088-20261126-1851.dump` (11,2 MB, 69 tabel data) sebelum ada penulisan data baru.
- [x] Model AI tunggal seperti proyek web sanghyang (permintaan pemilik 26 Nov 2026): model hanya dari `PRIMARY_MODEL` dan penalaran dari `PRIMARY_THINKING_LEVEL`, keduanya wajib, tanpa model cadangan; kena batas laju atau server sibuk berarti menunggu lalu mencoba model yang sama.
  Bukti: `src/lib/gemini.ts` memanggil Interactions API (`store: false`, `thinking_level` dari env, token keluaran minimal 16.384, JSON lewat `response_format`) dan menjadi satu-satunya pintu untuk 18 pemanggil; `GEMINI_MODEL` dan nilai bawaannya dihapus. Pilihan model mengikuti kuota Free tier proyek `gen-lang-client-0948123454` di AI Studio (26 Nov 2026): Gemini 4 Hydrogen, 3.8 Flash, dan 3.6 Flash masing-masing 20 permintaan per hari dan 5 per menit; Gemini 4 Neon, Carbon, Argon, dan 3.1 Pro 0; Gemini 3.5 Flash-Lite dan 3.1 Flash Lite 500 per hari dan 15 per menit. Refresh harian butuh sekitar 50-150 panggilan, jadi pemilik memilih `gemini-3.5-flash-lite` (model terbaru yang cukup) dengan `PRIMARY_THINKING_LEVEL=high`; kuota dihitung per permintaan sehingga tingkat penalaran tidak menambah pemakaian kuota. Uji tugas nyata (kategori 25 promo): `low` 6,1 detik dan `high` 14,7 detik, keduanya 25/25 terklasifikasi dengan hasil sama. Batas job scrape malam dinaikkan dari 45 ke 60 menit untuk hari sibuk. Run job malam pertama di repo baru (26 Nov 23.28 WIB) gagal karena `src/lib/cache/cached.ts` mengimpor `server-only`; langkah scrape kini memakai `NODE_OPTIONS=--conditions=react-server` seperti `test:market`, dan impor modul job terbukti berhasil dengan kondisi itu. Env yang sama di `.env.local`, `.env.development.local`, Vercel produksi, dan repository variables GitHub; secret `GEMINI_MODEL` dihapus. Pesan kuota harian ("per day") dikenali sehingga tidak dicoba ulang sia-sia. Tes `src/lib/gemini.test.ts` 16/16 lulus.
- [x] Tombol Perbarui Semua Data dan ekstensi Chrome bekerja di domain `https://analytics.sanghyang.com` (laporan pemilik 27 Nov 2026).
  Bukti: tombol gagal karena `GITHUB_DISPATCH_TOKEN` tidak ada di Vercel; atas keputusan pemilik diisi token classic yang sama dengan `GITHUB_ACCESS_TOKEN`, redeploy, lalu `GET /api/admin/scraping` dari sesi pemilik menjawab `remote.configured: true` tanpa galat dan klik pemilik memicu run `workflow_dispatch` 45873239114. Panel menganggap ekstensi belum terpasang karena manifest hanya mengizinkan `sanghyang-analytics.vercel.app` dan localhost; ekstensi naik ke versi `1.2.0` dengan domain baru di `host_permissions`, `externally_connectable`, `ALLOWED_APP_ORIGINS`, dan `popup.js`. Tes `tests/unit/browser-social-sync.test.ts` 31/31 lulus, typecheck tanpa galat.
- [ ] Tindakan operasional pasca-deploy ROLLOUT "Tambahan 26 Nov 2026" §4 langkah 5 (pemilik): unggah ulang Penjualan per Artikel bulan berjalan dan bulan pembandingnya lewat `/upload-mingguan` agar `bill_no` terisi, impor `BOOKING BY WA.xlsx` di tab Google Ads, lalu tekan Tarik Data Sekarang di `/data-sheets` untuk Main Store, minuman (LH), dan Engineering (atau tunggu cron Senin 01.00 WIB). Ekspor VHP Januari sampai November 2026 tersedia di `fixtures/` lokal.

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

- [ ] Semua butir §4 bercentang dengan bukti (tersisa tindakan operasional pasca-deploy milik pemilik)
- [x] `python3 .agents/scripts/brain.py phase --check` tanpa galat
- [ ] Pemilik mengonfirmasi fase ditutup
