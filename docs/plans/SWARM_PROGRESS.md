# Pelacak Kemajuan Swarm Antigravity · Sanghyang News

Dibuat: 2026-11-13. Disetujui pemilik lewat prompt swarm 13 Nov 2026.
Pelacak ini diperbarui setiap kali temuan audit diselesaikan dan diverifikasi secara nyata oleh `@verifier`.

---

## 1. Baseline Data Produksi (Snapshot 13 Nov 2026)

Target verifikasi L1: Basis data lokal Docker wajib memiliki jumlah baris yang identik dengan statistik produksi saat snapshot diambil.

| # | Nama Tabel | Jumlah Baris Baseline | Jumlah Baris DB Lokal | Status Verifikasi |
| :-: | :--- | :-: | :-: | :--- |
| 1 | `source` | 4 | 4 | Selesai-terverifikasi |
| 2 | `article` | 10.097 | 10.097 | Selesai-terverifikasi |
| 3 | `marketItem` | 734 | 734 | Selesai-terverifikasi |
| 4 | `competitor` | 33 | 33 | Selesai-terverifikasi |
| 5 | `competitorPriceSnapshot` | 189 | 189 | Selesai-terverifikasi |
| 6 | `sanghyangPriceSnapshot` | 44 | 44 | Selesai-terverifikasi |
| 7 | `competitorPromotion` | 157 | 157 | Selesai-terverifikasi |
| 8 | `competitorReview` | 210 | 210 | Selesai-terverifikasi |
| 9 | `outletMonthlyRevenue` | 0 | 0 | Selesai-terverifikasi |
| 10 | `outletMonthlySnapshot` | 6 | 6 | Selesai-terverifikasi |
| 11 | `marketingGoal` | 0 | 0 | Selesai-terverifikasi |
| 12 | `marketInsight` | 20 | 20 | Selesai-terverifikasi |
| 13 | `scrapeRun` | 52 | 52 | Selesai-terverifikasi |
| 14 | `scrapeError` | 13 | 13 | Selesai-terverifikasi |
| 15 | `scrapeLock` | 0 | 0 | Selesai-terverifikasi |

---

## 2. Tabel Pelacakan Temuan Audit Menyeluruh

Status yang diakui:
- **Belum**: Belum dikerjakan.
- **Berjalan**: Sedang dikerjakan oleh worker penanggung jawab.
- **Selesai-terverifikasi**: Telah selesai dan diverifikasi lulus secara independen oleh `@verifier` dengan bukti perintah.
- **Gagal**: Gagal dalam pengujian/verifikasi dan dikembalikan ke worker.

| ID | Judul Temuan | Gelombang | Penanggung Jawab | Status | Bukti Verifikasi | Tanggal |
| :---: | :--- | :---: | :---: | :---: | :--- | :---: |
| **L1** | Basis data lokal dengan snapshot asli | Gelombang 0 | `@fondasi` | Selesai-terverifikasi | Kontainer Docker `sanghyang-news-db` (Postgres 17, port 55432). Dump data-only dari produksi direstore ke lokal. 15 tabel 100% cocok dengan baseline statistik produksi. | 2026-11-13 |
| **L2** | Pengaman tulis produksi | Gelombang 0 | `@fondasi` | Selesai-terverifikasi | Pengaman di `lib/db.ts` memblokir operasi create/update/upsert/delete/executeRaw saat mengarah ke produksi tanpa `ALLOW_PRODUCTION_WRITE=1`. `scripts/db_guard.py` aktif. Tes `tests/unit/production-guard.test.ts` (4 pass, 0 fail). | 2026-11-13 |
| **L3** | Server dev pindah ke basis data lokal | Gelombang 0 | `@fondasi` | Selesai-terverifikasi | `curl -s http://127.0.0.1:3001/api/health?ready` mengembalikan `databaseTarget: "lokal"`. | 2026-11-13 |
| **L4** | Lint gagal karena folder bukan aplikasi | Gelombang 0 | `@fondasi` | Selesai-terverifikasi | `eslint.config.mjs` mengabaikan `.agents/**` dan `graphify-out/**`. `npm run lint` keluar 0 error, 0 warning. `npx tsc --noEmit` 0 error. | 2026-11-13 |
| **L5** | Skrip instalasi diblokir npm 12 | Gelombang 0 | `@fondasi` | Selesai-terverifikasi | `allowScripts` di `package.json` dikonfigurasi untuk 8 paket esensial. `npm install-scripts ls` menunjukkan 0 unreviewed scripts. | 2026-11-13 |
| **D1** | Registri pembanding tidak tunggal & tidak konsisten | Gelombang 1 | `@registri` | Selesai-terverifikasi | Registri tunggal DB via migrasi `20261113000000_competitor_registry_and_jobs`. Duplikat Aston digabung, Patra pensiun tercatat. `lib/market/competitor-repository.ts` aktif. `competitor-registry.test.ts` pass. | 2026-11-13 |
| **D2** | Angka pasar dan bukti karangan di kode (Zero Mock) | Gelombang 1 | `@provenans` | Selesai-terverifikasi | Metrik karangan dan bukti palsu dihapus. Formula transparan BPS di pricing-benchmark. `npm run audit:provenance`: 176/176 titik data sah, 0 pelanggaran (100% Lulus). | 2026-11-13 |
| **D3** | Promo hasil crawl ternyata daftar tertanam | Gelombang 1 | `@provenans` | Selesai-terverifikasi | Konstanta promo statis dihapus dari `sync-social-promos.ts`. Fungsi `computePromotionStatus` deterministik berdasarkan tanggal. Unit test `provenance.test.ts` pass. | 2026-11-13 |
| **D4** | Insight usang dengan keyakinan tertanam | Gelombang 1 | `@provenans` | Selesai-terverifikasi | 19 insight usang diarsipkan di DB lokal. Generator insight `lib/market/insight-generator.ts` berbasis observasi riil dengan confidence dinamis 20-95. | 2026-11-13 |
| **D5** | Omset dan target | Gelombang 1 | `@provenans` | Selesai-terverifikasi | Angka omset hardcoded dihapus total (`grep` bersih 0 baris). Modul `revenue-baseline.ts` terhubung ke DB `OutletMonthlyRevenue`. Tombol baseline/contoh statis dihapus. | 2026-11-13 |
| **D6** | Ulasan: label sumber, sentimen & verifikasi | Gelombang 1 | `@riset` | Selesai-terverifikasi | Label sumber Google Travel vs Maps sesuai URL. Sentimen berbasis teks/rating riil. Jendela waktu 24 bulan aktif. Pembedaan label total Google vs tersimpan teruji di `review-parser.test.ts`. | 2026-11-13 |
| **D7** | Klasifikasi berita pasar keliru | Gelombang 1 | `@klasifikasi` | Selesai-terverifikasi | Dataset evaluasi `tests/fixtures/news-eval-dataset.json`. Classifier Anyer-Carita mencapai presisi 0,94 (target ≥ 0,8). Skor relevansi dinamis. `classifier.test.ts` pass. | 2026-11-13 |
| **D8** | Mesin riset Python berisi data karangan | Gelombang 1 | `@riset` | Selesai-terverifikasi | 6 skrip sintetis dikarantina ke `crawler/research/scripts/quarantine/`. `grep` skrip aktif 0 temuan. `ingest-crawlai-evidence.ts` menolak pola buatan `?cid=`. `ingest-evidence.test.ts` pass. | 2026-11-13 |
| **D9** | Galeri kompetitor | Gelombang 2 | `@crawler` | Selesai-terverifikasi | `loadGalleryPlacesFromDb` terhubung ke DB lokal (D1). Teks crawl palsu bersih. `gallery.test.ts` 5 pass, 0 fail. Lint 0, tsc 0. (board #69) | 2026-11-13 |
| **D10** | Marketing Sosmed | Gelombang 2 | `@ui-halaman` | Selesai-terverifikasi | `app/marketing-sosmed/page.tsx` (273 baris) terhubung penuh ke API DB lokal dengan OCC versioning; modal transparansi formula skor caption (Hook 35%, Copy 35%, CTA 30%). `npm test` pass. (board #74) | 2026-11-13 |
| **C1** | Hanya berita yang tercatat | Gelombang 1 | `@observabilitas` | Selesai-terverifikasi | Enum `ScrapeJob` 9 job. `lib/market/scrape-log.ts` mencatat `ScrapeRun` (discovered, saved, duplicates, errors) dan `ScrapeError` per URL teruji di `observability.test.ts`. | 2026-11-13 |
| **C2** | Pesaing pensiun tetap di-crawl | Gelombang 1 | `@observabilitas` | Selesai-terverifikasi | `lib/market/website-promos.ts` memfilter `active: true` dari registri DB. Pesaing pensiun (Patra) tidak lagi di-crawl. Teruji di `observability.test.ts`. | 2026-11-13 |
| **C3** | Sumber berlogin & rencana melanggar aturan | Gelombang 2 | `@crawler` | Selesai-terverifikasi | Adaptor `GoogleBusinessProfileAdapter`, `InstagramGraphAdapter`, `GooglePlacesAdapter` di `lib/market/adapters/`. Status jujur "Belum tersambung" tanpa kredensial. Panduan `docs/guides/integrasi-api-resmi.md`. `crawler-adapters.test.ts` pass. (board #69) | 2026-11-13 |
| **C4** | Parser Google Travel/Maps rapuh | Gelombang 2 | `@crawler` | Selesai-terverifikasi | Fixture HTML asli di `tests/fixtures/google-travel-sample.html`. `generateExternalId` stabil (bebas drift tanggal). `uncertaintyDays` tercatat. `review-parser.test.ts` 9 pass, 0 fail. (board #69) | 2026-11-13 |
| **C5** | Cakupan tarif tidak lengkap | Gelombang 1 | `@registri` | Selesai-terverifikasi | Sasaran compset hotel terhubung ke DB lokal (7 aktif). Fallback alasan jujur bila belum teramati teruji di `compset-coverage.test.ts`. | 2026-11-13 |
| **C6** | Crawler Python dan mesin riset | Gelombang 2 | `@crawler` | Selesai-terverifikasi | `crawler/`: `uv run pytest` 10 pass, `ruff check` 0 error. `crawler/research/`: `uv run pytest` 4 pass, `ruff check` 0 error. Total 14/14 tes Python lulus. (board #69) | 2026-11-13 |
| **C7** | Tombol pembaruan & klaim jadwal keliru | Gelombang 1/2 | `@observabilitas` / `@ui-halaman` | Selesai-terverifikasi | Backend API `scraping/status` selesai-terverifikasi. `app/admin/scraping/page.tsx` (210 baris) membaca data aktual 9 job DB lokal; dialog konfirmasi per job; pemisahan tombol muat ulang vs crawl. (board #74) | 2026-11-13 |
| **U1** | Lima navigasi berbeda | Gelombang 2 | `@ui-shell` | Selesai-terverifikasi | Navigasi 8 menu kanonis terpusat di `lib/navigation.ts`. AppShell & AppSidebar semantik, 0 emoji sebagai ikon. `ui-shell.test.ts` 8 pass, 0 fail. Lint 0, tsc 0. (board #65) | 2026-11-13 |
| **U2** | Judul tab tidak spesifik | Gelombang 2 | `@ui-shell` | Selesai-terverifikasi | Template root `%s · Sanghyang News` dan 9 rute dengan judul & deskripsi tersendiri. `ui-shell.test.ts` 8 pass. (board #65) | 2026-11-13 |
| **U3** | Halaman raksasa | Gelombang 2 | `@ui-halaman` | Selesai-terverifikasi | `app/market-intelligence/page.tsx` tereduksi ke 293 baris. Seluruh 11 komponen di `components/market-intelligence/` strictly < 300 baris. Urutan 6 langkah membaca konsisten per outlet. (board #74) | 2026-11-13 |
| **U4** | Token desain & 1.500+ warna hex tertanam | Gelombang 2 | `@ui-shell` | Selesai-terverifikasi | Token Tailwind CSS v4 di `@theme inline` (`app/globals.css`). Seluruh kode HEX tertanam pada komponen shell & sidebar digantikan kelas token. `ui-shell.test.ts` 8 pass. (board #65) | 2026-11-13 |
| **U5** | Emoji sebagai ikon | Gelombang 2 | `@ui-shell` | Selesai-terverifikasi | 0 emoji sebagai ikon pada seluruh elemen navigasi & shell. Digantikan ikon SVG `lucide-react`. `ui-shell.test.ts` 8 pass. (board #65) | 2026-11-13 |
| **U6** | Jargon internal di UI | Gelombang 2 | `@ui-halaman` | Selesai-terverifikasi | Seluruh frasa teknis internal ("MASTER PROMPT COMPLIANCE", "The 4 Zeros Framework", "Grounding Data", "Siklus Riset Sinkron") bersih 0 temuan di UI. Diganti Bahasa Indonesia lugas. (board #74) | 2026-11-13 |
| **U7** | Teks status yang menyesatkan | Gelombang 2 | `@ui-halaman` | Selesai-terverifikasi | Teks status menyesatkan ("menunggu crawl berikutnya", "hilang saat halaman dimuat ulang") bersih 0 temuan. Status kini berbasis data aktual observasi & ScrapeRun. (board #74) | 2026-11-13 |
| **U8** | Kinerja API summary lambat | Gelombang 2 | `@api` | Selesai-terverifikasi | Optimasi select kueri DB, filter periode di SQL, Promise.all paralel. Benchmark p95 terukur 146–194 ms (< 1500 ms SLA) di `api-performance.test.ts` (6 pass). HTTP curl 200 OK. | 2026-11-13 |
| **U9** | Aksesibilitas dan ponsel | Gelombang 3 | `@e2e` | Selesai-terverifikasi | Visual Audit E2E Puppeteer `tests/e2e/visual-audit.ts`: 20/20 tes lulus di 10 rute (1440x900 & 390x844), 0 galat konsol, 0 respons HTTP >= 400, bebas overflow ponsel (`scrollWidth <= clientWidth`), 20 tangkapan layar di `docs/design/layar/`. (board #89) | 2026-11-13 |
| **U10** | Arah visual | Gelombang 2 | `@ui-shell` | Selesai-terverifikasi | `docs/design/DESIGN.md` terisi lengkap: prinsip data tenang, aksen Deep Teal, tipografi Geist, 0 gradasi murahan, 0 emoji sebagai ikon. `ui-shell.test.ts` 8 pass. (board #65) | 2026-11-13 |
| **K1** | Tidak ada kerangka tes | Gelombang 2 | `@tes-keamanan` | Selesai-terverifikasi | `npm test` terpadu: 83 passed, 0 failed, 0 skipped (4.5s). DB lokal, tanpa Gemini, tanpa jaringan luar. Lint 0, tsc 0. (board #65) | 2026-11-13 |
| **K2** | Folder scripts/ campur aduk | Gelombang 2 | `@tes-keamanan` | Selesai-terverifikasi | `scripts/ops/` (operasional aktif), `scripts/arsip/` (skrip lama + README). Data JSON dipindah ke `data/social-posts/`. Lint 0, tsc 0. (board #65) | 2026-11-13 |
| **K3** | Keamanan sesi | Gelombang 2 | `@tes-keamanan` | Selesai-terverifikasi | Token sesi HMAC-SHA256 + `SESSION_SECRET`, kedaluwarsa deterministik. Rate limiter `/api/login` (5 percobaan/15 menit). Sandi polos bersih dari `BACA DULU.txt`. `fetchAman` SSRF guard aktif. 83 tests pass. (board #65) | 2026-11-13 |
| **K4** | Dependensi usang | Gelombang 2 | `@tes-keamanan` | Selesai-terverifikasi | Penyelarasan `@types/node` untuk Node 24 runtime. `tsc` 0 error, `eslint` 0 error. Build tidak rusak. (board #65) | 2026-11-13 |
| **K5** | CI mutu | Gelombang 3 | `@pengetahuan` | Selesai-terverifikasi | Draf workflow CI GitHub Actions `.github/workflows/quality-ci.yml` terdefinisi rapi (typecheck, lint, test, audit, Python test). (board #83) | 2026-11-13 |
| **P1** | Dokumen prosedur, arsitektur & fase | Gelombang 0 | `@dokumen` | Selesai-terverifikasi | `brain.py init`, brief, ADR Berlaku, fase Berjalan, `plan_architect.py --validate-plan` (skor 100%), `brain.py phase --check` (0 galat) | 2026-11-13 |
| **P2** | README rusak dan basi | Gelombang 3 | `@pengetahuan` | Selesai-terverifikasi | `README.md` ditulis ulang UTF-8 bersih, jadwal nightly 22:23 WIB, DB lokal tercatat, dokumen legacy dikonsolidasi ke `docs/archive/legacy-v1/`, panduan staf & developer di `docs/guides/`. (board #83) | 2026-11-13 |
| **P3** | Dokumentasi riset dan alur data | Gelombang 3 | `@pengetahuan` | Selesai-terverifikasi | Dokumentasi `docs/research/sumber-data.md`, diagram Mermaid `docs/architecture/alur-data.md`, dan `docs/research/metodologi.md` lengkap. (board #83) | 2026-11-13 |
| **P4** | Graf dan memori | Gelombang 3 | `@pengetahuan` | Selesai-terverifikasi | Graf diperbarui strict 100% (499/499 berkas, 4.222 simpul), 15 Q&A tersimpan, refleksi `LESSONS.md`, `MEMORY.md` 1.784 char (< 2.200), `brain.py memory check` 0 catatan, `contract_test.py` lulus. (board #83) | 2026-11-13 |
| **P5** | Peta jalan pengganti TODO.md | Gelombang 3 | `@pengetahuan` | Selesai-terverifikasi | Peta jalan resmi 6 fase `docs/plans/ROADMAP.md` aktif menggantikan TODO.md. (board #83) | 2026-11-13 |

---

## 3. Catatan Putusan Terkunci Pemilik

Hal-hal berikut dicatat dan tidak dieksekusi secara sepihak oleh swarm:
1. Status Allisa Resort Anyer dalam klasifikasi compset (Klaster I / Klaster II / pensiun).
2. Pendaftaran akun berbayar Google Business Profile API, Instagram Graph API, dan Google Places API.
3. Waktu pelaksanaan migrasi dan penerapan perubahan ke database Supabase produksi (panduan di `docs/plans/ROLLOUT_PRODUKSI.md`).
4. Input angka omset historis riil masing-masing outlet resort.
5. Ketersediaan API key LLM terpisah untuk ekstraksi semantik graf otomatis.
