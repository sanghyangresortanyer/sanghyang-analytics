# Skrip Operasional (`scripts/`)

Direktori ini berisi skrip operasional aktif untuk pengumpulan data pasar, pemeliharaan registri pembanding, audit mutu, utilitas Google Ads/GA4, alat bantu VHP, dan otomasi **Sanghyang Analytics** (`sanghyang-analytics`, ADR-014). Sinkronisasi media sosial Instagram dan TikTok dijalankan melalui Ekstensi Chrome **Sanghyang Analytics Sync** (`v1.1.11`, ADR-012/ADR-014) tanpa skrip login peramban lokal.

## 1. Pengaman, Utilitas Lingkungan, & Skrip Gabungan

1. **`ops/local-db-guard.ts`**: Penjaga agar skrip pengumpul data hanya menulis ke basis data kerja lokal (`127.0.0.1:55432`).
2. **`ops/db_guard.py`**: Pengaman tulis basis data produksi untuk skrip Python dengan aturan yang sama seperti `src/lib/db.ts`.
3. **`ops/github-login.mjs`**: Pengelola login GitHub tingkat proyek memakai Personal Access Token (PAT) ke `.git/.git-credentials` yang terisolasi dari `~/.git-credentials` (`--status` dan `--logout`).
4. **`mcp/github-mcp-server.sh`**: Pembungkus server MCP GitHub tingkat proyek yang membaca `GITHUB_ACCESS_TOKEN` dari `.env.development.local` lalu `.env.local`.
5. **`ops/sync-cloud-to-local.ts`**: Sinkronisasi aman data dari snapshot cloud ke basis data pengembangan lokal.
6. **`ops/sync-production-data.ts`** & **`ops/sync-before-push.ts`**: Utilitas sinkronisasi data terkendali (hanya uji kering bawaan; penulisan hanya dengan `--apply` dan `ALLOW_PRODUCTION_WRITE=1` atas izin eksplisit pemilik). Hook otomatis `pre-push` lama telah dihapus pada ADR-014.
7. **`marketing/cli.ts`**, **`marketing/google-ads-oauth.ts`**, **`marketing/vercel-env.py`**: Utilitas CLI laporan/audit Google Ads + GA4, inisiasi OAuth Google Ads lokal, dan penyetelan variabel lingkungan marketing ke Vercel lewat stdin.
8. **`pilot/pilot.ps1`**, **`pilot/vhp-audit.ps1`**, **`sort-fixtures.mjs`**: Utilitas baca-saja audit menu VHP di Windows serta pengarsipan berkas ekspor `.txt` VHP ke `fixtures/`.

## 2. Pengumpulan Data Pasar, Tarif, Berita, & Ulasan

1. **`ops/run-nightly-scrape.ts`**: Orkestrator eksekusi pembaruan data malam terjadwal (`nightly-market-scrape.yml`).
2. **`ops/collect-google-hotel-market-rates.ts`**: Pengumpulan tarif pasar hotel pembanding dari Google Hotels melalui Crawl4AI dan cadangan Chrome.
3. **`ops/crawl-room-rates.ts`**: Crawl tarif per tipe kamar (Google Travel tab Prices) serta tarif termurah harian ke `src/lib/market/resort-room-rates.data.json`.
4. **`ops/crawl-official-room-rates.ts`**: Tarif kamar resmi Sanghyang dari booking engine Exely (Search API kanal metasearch hotel, kredensial `EXELY_*` dari env) untuk tanggal check-in `src/lib/market/resort-room-rates.data.json`, 1 malam, 2 dewasa, ke `src/lib/market/official-room-rates.data.json`.
5. **`ops/discover-otas.ts`**: Pembaruan daftar penyedia OTA dan sumber ulasan Google Travel secara dinamis ke `src/lib/market/resort-room-rates.data.json`.
6. **`ops/crawl-venue-reviews.ts`**: Pengambilan ulasan dan topik Google Maps untuk restoran, bar, dan spa pembanding tanpa login ke `src/lib/market/review-topics.data.json`.
7. **`ops/collect-own-promos.ts`**: Pengambilan promo resmi Sanghyang dari `sanghyang.com/offers` serta program bulanan tim marketing ke `CompetitorPromotion`.
8. **`ops/refresh-promos-and-events.ts`**: Pembaruan promo dan pemisahan event situs resmi pesaing secara terpisah.
9. **`ops/collect-competitor-profiles.ts`** & **`ops/collect-venue-profiles.ts`**: Pengumpulan fakta profil outlet Sanghyang dan pembanding dari situs resmi atau berkas `llms.txt` pengelola ke `CompetitorFact`.
10. **`ops/collect-venue-photos.ts`** & **`ops/read-gallery-photos.ts`**: Pengumpulan dan penilaian relevansi foto outlet pembanding ke `src/lib/market/competitor-gallery.data.json` dan `src/lib/market/competitor-visual-insights.data.json`.
11. **`ops/read-competitor-menus.ts`**: Pembacaan foto menu unggahan pengguna Google Maps (`foto-maps`) ke `src/lib/market/competitor-menu.data.json` (`--apply`).
12. **`ops/import-official-menu.ts`**: Impor harga menu resmi Sunset Grill dan D'Bistro dari konten situs resmi Sanghyang ke `src/lib/market/official-menu.data.json`.
13. **`ops/import-resort-room-rates.py`**: Konversi buku kerja analisis tarif kamar ke `src/lib/market/resort-room-rates.data.json`.
14. **`ops/fetch-bps-tpk.ts`**: Pengambilan angka Tingkat Penghunian Kamar (TPK) hotel berbintang dari rilis resmi BPS Banten ke `MarketMacroStat`.
15. **`ops/export_crawlai_for_ingest.py`**, **`ops/ingest-crawlai-evidence.ts`**, **`ops/ingest-crawl4ai-venues.ts`**: Validasi dan penyerapan bukti pasar serta listing Google Maps hasil render Crawl4AI ke basis data lokal dan `src/lib/market/review-topics.data.json`.
16. **`ops/backfill-news-publishers.ts`**, **`ops/read-news-backlog.ts`**, **`ops/reset-news-readings.ts`**: Pemeliharaan asal penerbit dan pembacaan ulang isi berita kandidat.

## 3. Registri Pembanding, Seed, & Klasifikasi

1. **`ops/seed-competitor-registry.ts`**: Inisialisasi dan sinkronisasi registri tunggal pembanding (`Competitor`) ke basis data.
2. **`ops/audit-holistic-compset.ts`**: Penilaian holistik 6 dimensi seluruh kompetitor terhadap 6 outlet Sanghyang khusus DB kerja lokal `127.0.0.1:55432/sanghyang_analytics`.
3. **`ops/sync-hotel-venues.ts`**: Penambahan dan pembaruan restoran, bar, dan spa di dalam hotel pembanding sebagai pesaing outlet Sanghyang (`--apply`).
4. **`ops/discover-competitors.ts`**: Penemuan kandidat pesaing baru dari pencarian Google Maps sekitar Anyer-Carita dengan perhitungan jarak jalan (`--apply`).
5. **`ops/archive-duplicate-reviews.ts`**: Pengarsipan ulasan ganda berdasarkan ID Google atau kesamaan teks dan sumber (`--apply`).

## 4. Audit, Pengujian CI, & Pelaporan

1. **`ops/audit_provenance.ts`**: Validasi integritas metrik pasar dan provenans data (Zero Mock Data) pada kode sumber `src/`, dijalankan lewat `npm run audit:provenance`.
2. **`ops/check-market-data-quality.ts`**: Pemeriksaan kualitas artikel pasar, deteksi berita derau, dan akurasi penyaring berita.
3. **`ops/ci-fixture.ts`**: Ekspor dan pemuatan baseline data crawl nyata dari DB kerja lokal ke `tests/fixtures/ci-db/*.json` untuk CI (`sanghyang_analytics_test`).
4. **`ops/send-morning-briefing.ts`**: Penyusunan dan pengiriman ringkasan pasar pagi terjadwal ke tim manajemen dan pemasaran.

## Panduan Penggunaan

Seluruh skrip operasional dijalankan dengan menunjuk ke basis data lokal (`.env.development.local`) secara bawaan:

```bash
node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/<nama-skrip>.ts
```

Dilarang menjalankan skrip tulis ke basis data produksi tanpa izin eksplisit pemilik (`ALLOW_PRODUCTION_WRITE=1`), dan dilarang menulis langsung ke tabel operasional VHP (`weekly_*`) di luar halaman Upload aplikasi (`/upload-mingguan`).
