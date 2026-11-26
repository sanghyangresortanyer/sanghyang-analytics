# Phase 8: Konsolidasi penuh aplikasi tunggal Sanghyang Analytics

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-014

## 1. Tujuan

Menyatukan proyek operasional VHP dan Market Intelligence menjadi satu aplikasi Next.js 16.3.5 bersih bernama `sanghyang-analytics` (`Opsi A`), satu schema PostgreSQL `public` di proyek Supabase baru (`omuqbpxierdlfjascngz`), satu struktur folder standar `.agents/` tanpa duplikasi, menghapus seluruh penamaan lama `VRP` dan `sanghyang-news`, menghubungkan data operasional internal VHP ke Knowledge Graph belakang layar dan mesin rekomendasi strategi tanpa kebocoran rupiah, serta mengganti nama folder utama menjadi `sanghyang-analytics` dengan output `localhost:3001` 100% identik dan nol galat.

## 2. Ruang lingkup

- Masuk:
  - Proyek Supabase baru `sanghyang-analytics` (`omuqbpxierdlfjascngz`, `ap-southeast-1`, `\$0/bulan`) dengan 1 jalur migrasi bersih `supabase/migrations/` (`0000_core_foundation.sql` + `0059..0084` VHP/Sheets + `0085_market_intelligence_tables.sql` ber-RLS/`REVOKE`; 58 migrasi, 28 tabel, dan 20 RPC VOLA dibersihkan) dan salinan baca-saja data historis internal + data Market Intelligence lokal.
  - Aplikasi tunggal Next.js 16.3.5 di `src/` memakai Supabase Auth tunggal (`marketingAccess()` / `currentUser()`), menghapus 4 rute proxy, `APP_PASSWORD`, `SESSION_SECRET`, dan halaman lama di luar `localhost:3001`.
  - Modul `src/lib/analytics/internal-signals.ts` (`server-only`, Zero Rupiah Leak) menghubungkan data internal 6 outlet ke Knowledge Graph belakang layar (`/api/knowledge-graph`, `src/lib/knowledge-graph/*`) dan mesin rekomendasi strategi, sekaligus menghapus nominal rupiah dari `/api/market-intelligence/summary`.
  - Pembersihan total nama lama `VRP`/`sanghyang-news`/warisan `VOLA` ke `Sanghyang Analytics` / `sanghyang-analytics` (mempertahankan `VHP`; domain akun internal diganti ke `@sanghyang-analytics.local`), ekstensi Chrome `v1.1.11`, 3 workflow GitHub Actions di cabang `main`, konfigurasi `.vercelignore`/`vercel.json` (`sin1`), dan rename folder utama ke `/home/user/Documents/sanghyang-analytics`.
- Tidak masuk:
  - Penulisan ke produksi lama (`VOLA` / `lpnvlsmvndhfgodutpmu` / `vercel` lama), `git commit`, `git push`, atau deploy Vercel tanpa instruksi eksplisit pemilik.

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 014 | Aplikasi tunggal `sanghyang-analytics`, 1 schema `public`, jembatan KG internal-eksternal | Dasar arsitektur seluruh penyatuan kode, skema, autentikasi, penamaan, dan migrasi akun |

## 4. Daftar periksa

- [x] Proyek Supabase baru `omuqbpxierdlfjascngz` dan DB lokal `sanghyang_analytics` bersih dari 28 tabel, 20 RPC, dan 58 migrasi VOLA (`0001..0058` diganti `0000_core_foundation.sql`; total 28 migrasi, 40 tabel ber-RLS 100%, 20 fungsi aktif) dengan seluruh `122.937` baris data aktif utuh (`28.736` Market Intelligence + `94.196` VHP/Sheets + `1` properti + `4` profil, serta `4` akun `auth.users`).
- [x] Aplikasi tunggal Next.js 16.3.5 di `src/` bebas proxy 2-port, bebas `APP_PASSWORD`, bebas nama `VRP`/`sanghyang-news`/warisan `VOLA` (tetap menjaga `VHP`; domain akun `@vola.local` diganti ke `@sanghyang-analytics.local`).
- [x] Jembatan `src/lib/analytics/internal-signals.ts` terhubung ke Knowledge Graph belakang layar (`12` simpul `operasional:*` dari `82.062` baris VHP) dan mesin rekomendasi strategi dengan Zero Rupiah Leak teruji TDD.
- [x] Struktur folder standar `.agents/` bersih tanpa duplikasi (`VRP/` dilebur dan dihapus), ekstensi Chrome `v1.1.11`, 3 workflow GitHub Actions di cabang `main`, hook pre-push lama dan tautan prod lama dihapus, remote diarahkan ke `sanghyangresortanyer/sanghyang-analytics`.
- [x] Gerbang mutu lulus 100% (`next typegen`, `tsc --noEmit` = `0`, `eslint src --max-warnings=0` = `0/0`, `vitest` = `404` lulus `0` gagal termasuk `rsc-boundary.test.ts`, `test:market` = `603` lulus `0` gagal, `audit:provenance` = `87/87`, `compliance_matcher` = `matched: true`).
- [x] Folder utama diganti nama ke `/home/user/Documents/sanghyang-analytics`, `localhost:3001` diverifikasi ulang, Graphify/Obsidian/3D/Hermes lulus `--strict`.
- [x] Sinkronisasi pembaruan operasional 26 Nov 2026 dari salinan referensi baca-saja `VRP/` (3 migrasi lokal `0086..0088` -> total 31 migrasi / 41 tabel ber-RLS, Laporan Resort `/laporan-resort`, WA Bookings, Multi-Store Google Sheets, `dbar_parts` tersambung ke `internal-signals.ts` tanpa kebocoran rupiah, caching native `unstable_cache` + `invalidateTags` terjaga penuh, pengecualian `/VRP/` di `.gitignore`/`.graphifyignore`, dan panduan rollout dicatat di `docs/plans/ROLLOUT_PRODUKSI.md`).
