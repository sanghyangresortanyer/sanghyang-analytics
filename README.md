# Sanghyang Analytics

Platform operasional hotel dan intelijen pasar terpadu untuk manajemen serta tim pemasaran Sanghyang Indah Spa Resort (Anyer, Banten).

Berdasarkan ADR-014, **Sanghyang Analytics** (`sanghyang-analytics`) menyatukan pelaporan operasional harian VHP, pengendalian pembelian dan stok (Inventory HK & DML), evaluasi iklan Google Ads/GA4 dan Meta, serta intelijen pasar 6 outlet ke dalam satu aplikasi tunggal Next.js 16.4.6 di `src/` dengan satu basis data PostgreSQL/Supabase pada schema `public`.

---

## Modul Utama

1. **Ringkasan Eksekutif & Operasional VHP** (`/`):
   - Total revenue, rincian per outlet (Front Office, Sunset Grill, d'Bistro, d'Bar Karaoke & DBC, d'Spa), kotak aksi "Perlu Anda", empat metrik rantai pasok (permintaan DML, pembelian VHP, stok inventory, pemakaian), dan cincin capaian target bulanan.
2. **Okupansi & Tarif Kamar (OCC / ARR)** (`/occ`):
   - Pemantauan okupansi harian (61 kamar aktif) dan Average Room Rate (ARR) berdasarkan F/O Journal VHP serta segmen tamu (FIT, WALK IN, OTA, korporasi).
3. **Unggah Data VHP & Riwayat** (`/upload-mingguan`, `/riwayat`, `/data-sheets`):
   - Jalur unggah tunggal resmi untuk ekspor berkas VHP (F/O Turnover, Rest. Transaction Journal, F/O Journal, Receiving List) dengan perlindungan anti-duplikasi per tanggal serta sinkronisasi mingguan Google Sheets Inventory HK dan DML.
4. **Marketing Terpadu 6 Bagian** (`/marketing`):
   - **Google Ads & Meta Ads**: biaya, kontak, sisa saldo iklan, korelasi kampanye terhadap revenue kamar FIT/WALK IN, dan laporan mingguan/harian cetak PDF.
   - **Sosmed Sanghyang**: umpan postingan/Reels IG resmi dan Audit Promo Outlet terhadap penjualan kasir VHP 7 hari sebelum vs sesudah.
   - **Insight Pasar**: analisis 6 unit bisnis terhadap kompetitor koridor Anyer (radius 25 km jalan), ulasan tamu, koridor harga P25, radar promo & event, serta berita kawasan.
   - **Media Sosial Pesaing**: pemantauan postingan dan promosi kompetitor dengan sinkronisasi langsung lewat Ekstensi Chrome **Sanghyang Analytics Sync** (`v1.1.11`).
   - **Strategy**: rekomendasi pemasaran silang antara kinerja operasional VHP dan dinamika pasar eksternal, didukung Knowledge Graph belakang layar tanpa kebocoran angka rupiah.
5. **Pengaturan Properti & Akun** (`/pengaturan`):
   - Manajemen akun staf berbasis Supabase Auth, target bulanan outlet, tipe kamar, dan anggaran divisi.

---

## Arsitektur & Stack (ADR-014)

- **Aplikasi Web**: Next.js 16.4.6 (App Router, `src/`), React 19, TypeScript 5, Tailwind CSS v4, Vitest, dan `tsx`.
- **Autentikasi & Basis Data**: Supabase Auth (ES256, `marketingAccess()`, akun internal `@sanghyang-analytics.local`) dan PostgreSQL 17 pada satu schema `public` (`supabase/migrations/`: 28 migrasi bersih `0000_core_foundation` + `0059..0085` tanpa warisan VOLA, 100% tabel ber-RLS; ke-18 tabel Market Intelligence mencabut akses `anon`/`authenticated` dari Data API publik). Prisma (`prisma/schema.prisma`) dipertahankan untuk klien terketik modul Market Intelligence.
- **Perayap & Otomasi**: Python 3.12 (`crawler/` dan `crawler/research/` via `uv`), GitHub Actions pada cabang `main` (`nightly-market-scrape.yml`, `morning-market-briefing.yml`, `quality-ci.yml`), dan Vercel Cron `/api/cron/sync-sheets` pada region `sin1`.
- **Ekstensi Chrome**: `extension/sanghyang-social-sync/` (`Sanghyang Analytics Sync` `v1.1.11`, Extension ID tetap `kabomdcpiamnnncoifohknncamcddahl`).

---

## Panduan Penggunaan Cepat

### Pengguna Windows (Staf & Manajemen)

1. Buka dasbor produksi di Google Chrome (atau Microsoft Edge):
   `https://sanghyang-analytics.vercel.app`
2. Masuk melalui halaman `/login` menggunakan akun Supabase Auth masing-masing staf.
3. Untuk menyegarkan data Instagram dan TikTok dari sesi peramban Anda, pasang Ekstensi Chrome **Sanghyang Analytics Sync** (`v1.1.11`) sekali per komputer:
   - Buka halaman `/marketing?bagian=insight-pasar` atau `/marketing?bagian=media-sosial`, lalu klik **Unduh Ekstensi (.zip)** (`/api/admin/social-extension/download`).
   - Ekstrak arsip `.zip` ke folder kerja.
   - Buka `chrome://extensions`, aktifkan **Mode developer**, klik **Muat yang belum dibuka (Load unpacked)**, lalu pilih folder `sanghyang-social-sync` yang berisi `manifest.json`.
4. Dokumentasi operasional: [Panduan Staf Windows](docs/guides/panduan-staf-windows.md) dan [Panduan Ekstensi Chrome Media Sosial](docs/guides/panduan-ekstensi-sosmed.md).

### Pengembang Linux (Quickstart 3 Langkah)

1. Salin `.env.example` ke `.env.development.local` dan lengkapi koneksi PostgreSQL lokal (`127.0.0.1:55432/sanghyang_analytics?schema=public`) serta kunci Supabase pengembangan. Hubungkan GitHub proyek secara terisolasi bila diperlukan:
   ```bash
   node scripts/ops/github-login.mjs
   ```
2. Pasang dependensi Node dan bangkitkan klien Prisma:
   ```bash
   npm ci && npx prisma generate
   ```
3. Jalankan server pengembangan lokal di `http://127.0.0.1:3001` dan periksa endpoint kesehatan:
   ```bash
   npm run dev
   curl -s http://127.0.0.1:3001/api/health
   curl -s http://127.0.0.1:3001/api/health/ready
   ```

Dokumentasi rinci: [Panduan Pengembang Linux](docs/guides/panduan-pengembang-linux.md).

---

## Kepatuhan Data & Pengamanan Produksi

- **Empat Nol (Zero Mock, Zero Hardcode, Zero Fallback, Zero Timeout)**: seluruh angka bersumber dari berkas VHP, API resmi, atau observasi berbukti (`sourceUrl` dan waktu pengamatan). Data kosong tampil jujur sebagai "Belum ada data".
- **Tanpa Kebocoran Rupiah**: `src/lib/analytics/internal-signals.ts` hanya meneruskan persentase capaian target, pertumbuhan MoM, okupansi, menu lambat/mati, dan hasil audit promo ke Knowledge Graph serta Strategy tanpa angka rupiah internal.
- **Jalur Tunggal VHP**: data VHP hanya diunggah melalui halaman `/upload-mingguan`; skrip atau SQL langsung ke tabel `weekly_*` dilarang.
- **Nol Hook Pre-Push Lama**: tidak ada hook `.git/hooks/pre-push` yang menulis otomatis ke DB produksi. Tulis ke basis data non-lokal ditolak oleh pengaman di `src/lib/db.ts` kecuali `ALLOW_PRODUCTION_WRITE=1` atas izin eksplisit pemilik.
- **Tanpa Nama Mesin AI**: halaman web dan PDF Rapat Senin hanya mencantumkan sumber data serta tanggal pembacaan.

---

## Rangkaian Verifikasi Mutu

Jalankan seluruh gerbang mutu sebelum mengajukan perubahan (bungkus perintah berat dengan `python3 .agents/scripts/resource_guard.py --profile light -- <perintah>`):

```bash
# Bangkitkan tipe rute Next.js & pemeriksaan tipe TypeScript (0 galat)
npx next typegen && npm run typecheck

# Pemeriksaan lint ESLint (0 galat, 0 peringatan)
npm run lint

# Pengujian unit aplikasi & operasional VHP (Vitest)
npx vitest run

# Pengujian unit intelijen pasar (tsx)
npx tsx --test --test-concurrency=2 tests/unit/*.test.ts

# Audit keterlacakan metrik pasar & larangan omset tertanam
npm run audit:provenance

# Pengujian modul perayap Python
(cd crawler && uv run ruff check . && uv run pytest tests)
(cd crawler/research && uv run ruff check . && uv run pytest tests)
```

---

## Peta Dokumentasi

- **Arsitektur & Keputusan Sistem**:
  - [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) (Register ADR-001 hingga ADR-014)
  - [Alur Data & Diagram Sistem](docs/architecture/alur-data.md)
- **Desain Antarmuka**:
  - [Sistem Tampilan Sanghyang Analytics (Tampilan A)](docs/design/tampilan-a-sanghyang-analytics.md)
  - [Panduan Desain Ruang Kerja](docs/design/DESIGN.md)
- **Riset & Metodologi Pasar**:
  - [Inventaris Sumber Data & Kepatuhan](docs/research/sumber-data.md)
  - [Metodologi Analisis & Glosarium](docs/research/metodologi.md)
  - [Kebijakan Retensi Artikel](docs/research/kebijakan-retensi-artikel.md)
- **Panduan Operasional**:
  - [Panduan Staf Windows](docs/guides/panduan-staf-windows.md)
  - [Panduan Ekstensi Chrome Media Sosial](docs/guides/panduan-ekstensi-sosmed.md)
  - [Panduan Pengembang Linux](docs/guides/panduan-pengembang-linux.md)
  - [Panduan Integrasi API Resmi](docs/guides/integrasi-api-resmi.md)
- **Rencana, Audit, & Peluncuran**:
  - [Peta Jalan Pengembangan (ROADMAP.md)](docs/plans/ROADMAP.md)
  - [Rencana Peluncuran Produksi (ROLLOUT_PRODUKSI.md)](docs/plans/ROLLOUT_PRODUKSI.md)
  - [Konsolidasi Sanghyang Analytics](docs/plans/2026-11-25-konsolidasi-sanghyang-analytics.md)
  - [Audit Alur Data Operasional](docs/plans/2026-11-18-audit-alur-data.md)
  - [Audit Akses Data VHP](docs/plans/2026-11-18-audit-vhp-akses-data.md)
  - [Spesifikasi Laporan Senin](docs/plans/specs/2026-11-19-laporan-senin.md)
- **Tata Kelola Repositori**:
  - [Panduan Kontribusi](CONTRIBUTING.md)
  - [Kebijakan Keamanan](SECURITY.md)
