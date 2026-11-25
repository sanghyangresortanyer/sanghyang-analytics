# Phase 2: Crawler Patuh & Perombakan UI/UX

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-004, ADR-005

## 1. Tujuan

Membangun crawler yang patuh etika/hukum (tanpa penembusan login ilegal), parser stabil dengan rekaman fixture HTML asli, panel status scraping terpadu, serta merombak total antarmuka pengguna menjadi satu ruang kerja konsisten berbasis satu AppShell, token desain Tailwind v4, tanpa emoji sebagai ikon, dan optimasi kinerja API (p95 < 1,5 detik).

## 2. Ruang lingkup

- Masuk:
  - Penghentian scraping berlogin ilegal dan penyediaan adaptor API resmi (Google Business Profile, Instagram Graph, Places) dengan status "Belum tersambung" (C3 - `@crawler`).
  - Parser Google Travel/Maps stabil berbasis fixture rekaman asli dengan ID eksternal deterministik (C4 - `@crawler`).
  - Standarisasi pengujian dan pemeriksaan modul Python crawler (C6 - `@crawler`).
  - Panel pembaruan data terpadu dengan status riil per job (C7 frontend - `@ui-halaman`).
  - Persistensi metadata galeri kompetitor dan postingan media sosial ke basis data lokal (D9 - `@crawler`, D10 - `@ui-halaman`).
  - Satu AppShell seragam di seluruh rute (U1 - `@ui-shell`).
  - Metadata spesifik per halaman dan dekomposisi halaman raksasa (U2, U3 - `@ui-shell` & `@ui-halaman`).
  - Standardisasi token desain Tailwind v4 dan eliminasi kode warna hex tertanam (U4, U10 - `@ui-shell`).
  - Penggantian emoji dengan set ikon Lucide (U5 - `@ui-shell`).
  - Pembersihan jargon teknis internal menjadi bahasa pemasaran sederhana (U6 - `@ui-halaman`).
  - Koreksi teks status dan lencana agar mencerminkan data aktual (U7 - `@ui-halaman`).
  - Optimasi kueri API summary agar p95 < 1,5 detik (U8 - `@api`).
- Tidak masuk:
  - Registrasi API berbayar tanpa persetujuan biaya dari pemilik.
  - Penulisan ke database produksi.

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 004 | Perayapan patuh, teramati, dan isolasi sumber berlogin | Adaptor API resmi non-aktif tanpa kredensial, DOM scraping berlogin dihentikan |
| 005 | Satu AppShell terpadu dan token desain Tailwind v4 | Layout tunggal di route group, token desain di `@theme`, ikon Lucide |

## 4. Langkah kerja

| # | Langkah | Bukti (perintah + hasil, tautan, atau tangkapan layar) | Status |
| :---: | :--- | :--- | :--- |
| 1 | Siapkan adaptor API resmi dan hentikan injeksi cookie sesi (C3) | Adaptor di `lib/market/adapters/`, status jujur "Belum tersambung", `crawler-adapters.test.ts` pass, panduan `docs/guides/integrasi-api-resmi.md` | Selesai |
| 2 | Bangun parser Google Travel berbasis fixture HTML asli di `tests/fixtures/` (C4) | Fixture `tests/fixtures/google-travel-sample.html`, `generateExternalId` stabil, `review-parser.test.ts` 9 pass. Koreksi 18 Nov 2026: fixture itu ternyata contoh buatan (halaman asli menulis "di  Google", bukan "di Google Travel") dan pengurai HTML statisnya tidak terpakai; keduanya diganti kartu asli `tests/fixtures/google-travel-review-cards-sanghyang-2026-11-18.json` (ADR-003) | Selesai |
| 3 | Satukan halaman pembaruan data scraper dengan konfirmasi tindakan (C7) | `app/admin/scraping/page.tsx` (210 baris) membaca status 9 job DB lokal; dialog konfirmasi per job aktif | Selesai |
| 4 | Pindahkan galeri foto & formulir sosmed ke model DB ber-OCC (D9, D10) | `loadGalleryPlacesFromDb` terhubung ke DB D1; `app/marketing-sosmed/page.tsx` terhubung ke DB dengan OCC versioning | Selesai |
| 5 | Bangun komponen `AppShell` dan pasang di `app/layout.tsx` (U1) | Navigasi 8 menu kanonis terpusat di `lib/navigation.ts`, AppShell & AppSidebar semantik, `ui-shell.test.ts` pass | Selesai |
| 6 | Dekomposisi halaman raksasa `market-intelligence` dan `marketing-sosmed` (U3) | `app/market-intelligence/page.tsx` (293 baris), 11 subkomponen < 300 baris, 6 langkah membaca konsisten | Selesai |
| 7 | Terapkan token desain Tailwind v4 di `app/globals.css` (U4) | Token di `@theme inline`, seluruh kode hex tertanam di shell digantikan token Tailwind | Selesai |
| 8 | Ganti seluruh emoji di tombol/lencana dengan Lucide icons (U5) | 0 emoji sebagai ikon di navigasi dan shell, diganti ikon SVG Lucide, `ui-shell.test.ts` pass | Selesai |
| 9 | Ganti jargon teknis dengan Bahasa Indonesia sederhana (U6, U7) | `grep` jargon internal dan teks status menyesatkan 0 temuan di UI, bahasa pemasaran lugas | Selesai |
| 10 | Optimasi kueri database pada `/api/market-intelligence/summary` (U8) | Benchmark p95 terukur 146–194 ms (< 1500 ms SLA) di `api-performance.test.ts`, HTTP curl 200 OK | Selesai |

## 5. Berkas utama

- `components/layout/AppShell.tsx`
- `app/layout.tsx`
- `app/globals.css`
- `app/market-intelligence/page.tsx`
- `app/marketing-sosmed/page.tsx`
- `app/admin/scraping/page.tsx`
- `app/api/market-intelligence/summary/route.ts`
- `crawler/src/`

## 6. Verifikasi

- `npm run lint` -> 0 galat, 0 peringatan (exit code 0).
- `npx tsc --noEmit` -> 0 galat (exit code 0).
- Benchmark latensi endpoint API p95 < 1,5 detik (146–194 ms).
- Seluruh unit test suite lulus (90 pass, 0 fail).
- Python test suite lulus (14 pass, 0 fail, ruff check 0 error).

## 7. Kriteria keluar

- [x] Satu AppShell aktif di semua rute dengan navigasi dan metadata seragam
- [x] Token desain Tailwind v4 aktif tanpa warna hex tertanam
- [x] Seluruh emoji digantikan oleh set ikon Lucide yang rapi
- [x] Waktu respons API summary terbukti di bawah 1,5 detik pada DB lokal
- [x] Verifikasi disetujui oleh `@verifier` (board #65, #69, #74)
