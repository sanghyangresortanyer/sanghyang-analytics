<!-- AGENTS_ORCHESTRATOR_METADATA: {
  "engine": "plan_architect.py",
  "version": "5.1.0",
  "mode": "feature",
  "domain": "general_software",
  "subsystems_executed": [
    "repo_auditor.audit_all",
    "requirements_decomposer.decompose",
    "audit_gap_extractor.extract",
    "compliance_matcher.match_compliance",
    "stack_detector.detect_stacks",
    "dynamic_quality_gates.resolve_gates",
    "database_schema_designer.generate_schema_blueprint",
    "devsecops_pipeline_generator.generate_pipeline_spec",
    "graph_bridge.grounding",
    "enterprise_plan_architect.assemble_gold_standard"
  ],
  "prompt_fingerprint": "-6652618446730986607",
  "provenance_verified": true
} -->

# Perbaikan menyeluruh Sanghyang News berdasarkan audit 13 November 2026

Rencana implementasi terpadu ini disusun dari hasil audit menyeluruh 13 November 2026 menggunakan orkestrator blueprint `.agents/`. Rencana ini mencakup perbaikan lingkungan kerja (DB lokal, pengaman produksi), eliminasi data karangan (Zero Mock), penyatuan registri kompetitor, kepatuhan crawler, standardisasi UI/UX (AppShell tunggal, token Tailwind v4), suite pengujian otomatis Vitest, serta pembentukan lapisan pengetahuan (ADR, alur fase, graf pengetahuan, dan memori).

---

## Tinjauan pemilik

Rencana ini telah disetujui pemilik proyek (Monauli) melalui prompt swarm 13 November 2026 dan menjadi acuan operasional mutlak seluruh agen dan worker. Setiap tahapan pelaksanaan wajib mematuhi empat prinsip invarian tanpa kompromi:

> [!IMPORTANT]
> **1. Empat Nol, batas yang tidak ditawar**:
> - **Zero Mock Data**: Dilarang keras menanam angka estimasi, omset karangan, peringkat buatan, atau bukti fiktif di kode maupun database. Setiap metrik wajib berakar pada observasi riil berwaktu (`sourceUrl`, `capturedAt`), masukan resmi pemilik, atau formula berlabel transparan. Bila data belum tersedia, tampilkan "Belum ada data".
> - **Zero Hardcode**: Dilarang menanam kredensial, endpoint, konstanta pasar, maupun pengali piksel sembarangan. Konfigurasi dimuat dari `.env.development.local` via Zod/pydantic, dan `.env.example` disediakan sebagai acuan aman.
> - **Zero Fallback**: Dilarang menelan exception dengan `try/except: pass` atau `catch (e) {}` kosong. Pelanggaran kontrak dan galat mutasi wajib memunculkan respons bertipe yang sah (`HTTP 409 Conflict`, `HTTP 422`, `HTTP 500`).
> - **Zero Timeout**: Dilarang menggunakan loop jeda buta (`sleep()`, loop tanpa koordinasi). Pekerjaan scraping dan alur kerja asinkron dikelola terstruktur dengan pencatatan status deterministik dan kunci idempotensi.

> [!WARNING]
> **2. Kontrol konkurensi optimistis (OCC) dan keutuhan data**:
> - Entitas yang mengalami mutasi konkuren (seperti pencatatan postingan sosmed, pengaturan target, atau status promo) menerapkan kolom `version integer DEFAULT 1 NOT NULL`.
> - OCC dua lapis: deteksi versi usang di layer aplikasi (`HTTP 409 Conflict`) dan direct conditional update atomik `WHERE id = :id AND version = :expected_version` pada transaksi penting.
> - Isolasi data terjaga: seluruh aktivitas pengujian dan perayapan lokal diarahkan ke basis data Docker lokal (`127.0.0.1:55432`); database Supabase produksi diproteksi secara fisik dan logis.

---

## Pertanyaan terbuka

> [!NOTE]
> Seluruh keputusan arsitektur utama (ADR-001 s/d ADR-007) telah berstatus **Berlaku** atas persetujuan pemilik. Terdapat beberapa hal kebijakan bisnis yang tetap berada di tangan pemilik dan dicatat tanpa dieksekusi sepihak:
> 1. Status definitif Allisa Resort Anyer dalam registri compset (Klaster I / Klaster II / pensiun).
> 2. Pendaftaran akun resmi dan pembayaran kuota Google Business Profile API, Instagram Graph API, dan Places API.
> 3. Waktu pelaksanaan migrasi dan penerapan perubahan ke database Supabase produksi (melalui panduan `docs/plans/ROLLOUT_PRODUKSI.md`).
> 4. Pengunggahan data riil omset historis masing-masing outlet resort.
> 5. Ketersediaan API key LLM terpisah untuk ekstraksi semantik graf otomatis.

---

## Perubahan yang diusulkan

Dikelompokkan ke dalam 4 lapisan dependensi arsitektur yang terstruktur:

---

### Lapisan 1: Database Schema, Isolasi Lingkungan & OCC (L1, L2, D1, D5, D10, C1)

#### [NEW] [`docs/plans/ROLLOUT_PRODUKSI.md`](file:///home/user/Documents/SANGHYANG-NEWS/docs/plans/ROLLOUT_PRODUKSI.md)
- Panduan tertulis bagi pemilik untuk menjalankan migrasi skema dan seed terverifikasi ke database Supabase produksi secara aman.

#### [NEW] [`lib/market/competitor-registry.ts`](file:///home/user/Documents/SANGHYANG-NEWS/lib/market/competitor-registry.ts)
- Repositori akses data tunggal untuk membaca data kompetitor, venue, radius jarak jalan, dan pemetaan outlet resort langsung dari basis data.

#### [MODIFY] [`prisma/schema.prisma`](file:///home/user/Documents/SANGHYANG-NEWS/prisma/schema.prisma)
- Perluasan model `Competitor` dengan kolom klaster, kelompok (hotel, resto, bar, spa, venue), `placeId`, `mapsUrl`, jarak jalan terverifikasi, dan status aktif.
- Penambahan nilai enum `ScrapeJob` untuk seluruh job scraping serta penguatan model `ScrapeRun` dan `ScrapeError`.
- Penambahan kolom versi OCC (`version Int @default(1)`) pada model mutasi seperti pencatatan sosmed dan omset.

#### [MODIFY] [`lib/db.ts`](file:///home/user/Documents/SANGHYANG-NEWS/lib/db.ts)
- Pemasangan pengaman tulis produksi Prisma Client: menolak operasi mutasi (`create`, `update`, `delete`, `upsert`, `$executeRaw`) bila `DATABASE_URL` mengarah ke database produksi dan `ALLOW_PRODUCTION_WRITE !== "1"`.

#### [MODIFY] [`app/api/health/route.ts`](file:///home/user/Documents/SANGHYANG-NEWS/app/api/health/route.ts)
- Penambahan probe readiness `/api/health?ready` yang mengembalikan status non-rahasia `databaseTarget: "lokal" | "produksi"`.

---

### Lapisan 2: Integritas Data, Provenans & Crawler Patuh (D2–D8, C2–C7)

#### [NEW] [`tests/fixtures/google-travel-sample.html`](file:///home/user/Documents/SANGHYANG-NEWS/tests/fixtures/google-travel-sample.html)
- Rekaman fixture HTML statis asli dari halaman Google Travel untuk pengujian parser yang deterministik dan tahan perubahan layout.

#### [NEW] [`docs/research/sumber-data.md`](file:///home/user/Documents/SANGHYANG-NEWS/docs/research/sumber-data.md)
- Inventaris seluruh sumber data eksternal, frekuensi perayapan, status kepatuhan robots.txt/ToS, dan batasannya.

#### [MODIFY] [`lib/market/pricing-benchmark.ts`](file:///home/user/Documents/SANGHYANG-NEWS/lib/market/pricing-benchmark.ts)
- Pembersihan total konstanta omset fiktif (`RESORT_MARKET_SIZE`, `OUTLET_MARKET_SHARE_DATA`), ranking buatan, dan sumber bukti palsu.
- Penggantian dengan fungsi kalkulasi dinamis berbasis observasi tarif riil dan masukan resmi pemilik, dengan label jelas "Perkiraan kasar" bila memakai estimasi TPK BPS.

#### [MODIFY] [`lib/market/competitor-comparison.ts`](file:///home/user/Documents/SANGHYANG-NEWS/lib/market/competitor-comparison.ts)
- Perombakan perbandingan head-to-head agar murni bersumber dari baris observasi ulasan, harga, dan promo di database lokal.

#### [MODIFY] [`lib/market/sync-social-promos.ts`](file:///home/user/Documents/SANGHYANG-NEWS/lib/market/sync-social-promos.ts)
- Penghapusan daftar promo tertanam statis (`AUTHENTIC_COMPETITOR_PROMOS_AND_EVENTS`).
- Penentuan status aktif/kedaluwarsa promo berbasis komparasi tanggal `endsAt` aktual.

#### [MODIFY] [`lib/market/classifier.ts`](file:///home/user/Documents/SANGHYANG-NEWS/lib/market/classifier.ts)
- Kalibrasi klasifikasi berita berbasis set evaluasi berlabel wilayah Anyer–Carita dan Cinangka; evaluasi presisi dan recall terukur.

---

### Lapisan 3: Standardisasi UI/UX, Satu AppShell & Token Desain (U1–U10)

#### [NEW] [`components/layout/AppShell.tsx`](file:///home/user/Documents/SANGHYANG-NEWS/components/layout/AppShell.tsx)
- Komponen AppShell tunggal yang menyediakan sidebar navigasi seragam, header informasi outlet, dan breadcrumb di semua rute aplikasi.

#### [NEW] [`docs/design/DESIGN.md`](file:///home/user/Documents/SANGHYANG-NEWS/docs/design/DESIGN.md)
- Dokumentasi sistem desain: palet warna aksen, token tipografi Geist, pedoman kontras WCAG AA, dan larangan penggunaan emoji sebagai ikon.

#### [MODIFY] [`app/layout.tsx`](file:///home/user/Documents/SANGHYANG-NEWS/app/layout.tsx)
- Integrasi komponen `AppShell` tunggal dan penataan metadata default aplikasi.

#### [MODIFY] [`app/globals.css`](file:///home/user/Documents/SANGHYANG-NEWS/app/globals.css)
- Konfigurasi token desain Tailwind v4 CSS-first (`@theme`) untuk warna latar, permukaan, teks, dan aksen resort yang tenang.

#### [MODIFY] [`app/market-intelligence/page.tsx`](file:///home/user/Documents/SANGHYANG-NEWS/app/market-intelligence/page.tsx)
- Dekomposisi halaman raksasa menjadi sub-komponen terisolasi (< 300 baris per file).
- Pembersihan jargon teknis developer menjadi Bahasa Indonesia sederhana untuk tim pemasaran.
- Penggantian warna hex inline dan emoji dengan token desain serta Lucide icons.

#### [MODIFY] [`app/marketing-sosmed/page.tsx`](file:///home/user/Documents/SANGHYANG-NEWS/app/marketing-sosmed/page.tsx)
- Perapian tata letak form pencatatan postingan baru yang terhubung ke database lokal ber-OCC.
- Transparansi formula atau penghapusan skor fiktif.

#### [MODIFY] [`app/admin/scraping/page.tsx`](file:///home/user/Documents/SANGHYANG-NEWS/app/admin/scraping/page.tsx)
- Penyatuan tombol-tombol scraper menjadi panel kontrol terpadu dengan status eksekusi terakhir (`ScrapeRun`) dan dialog konfirmasi tindakan.

---

### Lapisan 4: Pengujian Berlapis, Keamanan Sesi & Penataan Skrip (K1–K5, L4, L5)

#### [NEW] [`vitest.config.ts`](file:///home/user/Documents/SANGHYANG-NEWS/vitest.config.ts)
- Konfigurasi test runner Vitest yang cepat, mendukung alias path Next.js, dan terisolasi dari jaringan luar / Gemini API.

#### [NEW] [`tests/unit/production-guard.test.ts`](file:///home/user/Documents/SANGHYANG-NEWS/tests/unit/production-guard.test.ts)
- Pengujian unit untuk memverifikasi bahwa pengaman tulis `lib/db.ts` memblokir mutasi pada URL produksi dan mengizinkan URL lokal.

#### [MODIFY] [`package.json`](file:///home/user/Documents/SANGHYANG-NEWS/package.json)
- Konfigurasi `allowScripts` npm 12 yang terdokumentasi rapi.
- Perbaruan skrip pengujian `test` dan `audit:provenance`.

#### [MODIFY] [`eslint.config.mjs`](file:///home/user/Documents/SANGHYANG-NEWS/eslint.config.mjs)
- Penambahan pola ignore untuk `.agents/**` dan `graphify-out/**` sehingga linting kode aplikasi 100% bersih.

#### [MODIFY] [`lib/sandi.ts`](file:///home/user/Documents/SANGHYANG-NEWS/lib/sandi.ts)
- Pembaruan mekanisme enkripsi cookie sesi menggunakan token HMAC SHA-256 dengan secret terpisah dan masa kedaluwarsa terukur.

---

### 3. Kepatuhan dan regulasi ([`compliance_matcher.py`](file:///home/user/Documents/SANGHYANG-NEWS/.agents/scripts/compliance_matcher.py))
Domain Terdeteksi: `general_software` (Hospitality Market Intelligence & Marketing CMS).

| Standar Kepatuhan | Klausul / Regulasi | Kontrol Teknis yang Wajib Diterapkan |
| :--- | :--- | :--- |
| **UU No. 27/2022 (UU PDP)** | `Pelindungan Data Pribadi` | Tidak mengumpulkan data tamu privat; ulasan publik dianonimkan sesuai data publik Google Maps. |
| **ISO/IEC 25010:2023** | `Kualitas Produk Perangkat Lunak` | Kesesuaian fungsional, keandalan data (Zero Mock), efisiensi kinerja (p95 API < 1,5s), dan kemudahan pemeliharaan. |
| **OWASP ASVS 4.0.3** | `Defensive Web Architecture` | Sanitasi URL perayapan via `fetchAman` (anti-SSRF), token sesi ber-HMAC, pembatas percobaan login di `/api/login`. |
| **Robots.txt & Fair Crawling** | `Etika & Kepatuhan Perayapan` | Identitas crawler jujur, jeda laju ramah server sasaran, penolakan injeksi cookie sesi untuk menembus login Instagram/TikTok. |
| **CycloneDX 1.7 / SPDX 3.0.1** | `Rantai Pasok Perangkat Lunak` | Penguncian dependensi via `package-lock.json` dan audit berkala celah keamanan dependensi tanpa vulnerabilitas kritis. |

---

## Arsitektur While-Loop: eksekusi berurutan 10 gerbang mutu

Seluruh perubahan kode wajib melalui siklus While-Loop 10 gerbang mutu secara sekuensial. Kegagalan pada gerbang manapun memicu penghentian seketika, perbaikan di akar masalah, dan pengulangan verifikasi dari Gate 1:

```mermaid
graph TD
    Start([🚀 Mulai Eksekusi Rencana]) --> Gate1[Gate 1: Secret Leak & Cryptography]
    Gate1 -->|Pass / Skip| Gate2[Gate 2: Static Code Linter (ESLint & Ruff)]
    Gate2 -->|Fail| Fail2[Halt & Upstream Fix Root Cause]
    Fail2 --> Gate1
    Gate2 -->|Pass| Gate3[Gate 3: Strict Static Type Checker (tsc & pyright)]
    Gate3 -->|Fail| Fail3[Halt & Fix Type Annotations]
    Fail3 --> Gate1
    Gate3 -->|Pass| Gate4[Gate 4: Dead Code Elimination (Knip & Vulture)]
    Gate4 -->|Fail| Fail4[Halt & Prune Dead Code]
    Fail4 --> Gate1
    Gate4 -->|Pass| Gate5[Gate 5: Automated Unit & Integration Tests (Vitest & Pytest)]
    Gate5 -->|Fail| Fail5[Halt & Repair Regressions]
    Fail5 --> Gate1
    Gate5 -->|Pass| Gate6[Gate 6: SAST & Supply Chain Audit (Semgrep/Trivy)]
    Gate6 -->|Pass / Skip| Gate7[Gate 7: Production Build & Packaging]
    Gate7 -->|Pass| Gate8[Gate 8: Runtime Turnkey & Health Probes (/api/health)]
    Gate8 -->|Pass| Gate9[Gate 9: Regulatory Compliance & Provenance Audit]
    Gate9 -->|Pass| Gate10[Gate 10: Hermes & Graphify Memory Seeding]
    Gate10 --> Done([🎉 100% PRODUCTION-READY REACHED])
```

### Protokol penanganan kegagalan While-Loop:
1. **Berhenti dan cari akar masalahnya.** Bila Gate $N$ gagal, eksekusi berhenti seketika. Jangan menutupi galat dengan casting tipe `any` atau menonaktifkan assertion tes unit. Telusuri sumber masalah ke hulu (`Halt & Upstream Fix Root Cause`).
2. **Wajib mulai ulang dari Gate 1.** Setiap perubahan pada kode perbaikan berpotensi menimbulkan regresi pada lapisan sebelumnya. Oleh karena itu, pengujian wajib dimulai kembali dari Gate 1.
3. **Maksimal lima putaran perbaikan.** Bila setelah 5 iterasi kegagalan masih berlanjut, hentikan tindakan, catat log kesalahan secara transparan, dan mintalah masukan teknis dari koordinator / pemilik.

---

## Rencana verifikasi

### Pengujian otomatis (gerbang mutu dinamis 1..10)

1. **Secret Leak Detection & Cryptographic Integrity**:
   ```bash
   gitleaks detect --no-git --verbose
   ```
2. **Static Code Linter (0 Error, 0 Warning)**:
   ```bash
   npm run lint && (cd crawler && ruff check --extend-ignore=I001 .)
   ```
3. **Strict Static Type Checker**:
   ```bash
   npx tsc --noEmit
   ```
4. **Dead Code & Unused Dependency Elimination**:
   ```bash
   npx --yes knip
   ```
5. **Automated Unit & Integration Test Suite**:
   ```bash
   npm test && (cd crawler && PYTHONPATH=. pytest crawler/tests/)
   ```
6. **SAST, SCA & Supply Chain Vulnerability Audit**:
   ```bash
   semgrep scan --config auto -j 1 --disable-version-check
   ```
7. **Production Build & Packaging Compilation**:
   ```bash
   python3 .agents/scripts/resource_guard.py --profile build -- npm run build
   ```
8. **Turnkey Runtime & Health Probes (HTTP / Smoke / Container)**:
   ```bash
   curl -s http://127.0.0.1:3001/api/health?ready | grep '"databaseTarget":"lokal"'
   ```
9. **Candidate Compliance & Provenance Audit**:
   ```bash
   npm run audit:provenance
   ```
10. **Hermes & Graphify Memory Seeding**:
    ```bash
    python3 .agents/scripts/brain.py phase --check
    ```

### Verifikasi manual dan runtime

1. **Isolasi Database & Pencegahan Mutasi Produksi**:
   - Pastikan bahwa `curl -s http://127.0.0.1:3001/api/health?ready` mengonfirmasi target `lokal`.
   - Jalankan kueri baca-saja ke `_prisma_migrations` produksi untuk memastikan tidak ada perubahan skema yang menyentuh server live.
2. **Kelengkapan AppShell & Responsivitas Mobile**:
   - Uji navigasi di seluruh 6 rute utama menggunakan Puppeteer headless pada resolusi desktop 1440x900 dan mobile 390x844.
   - Pastikan tidak ada horizontal scroll dan tidak ada pesan error di konsol browser.
3. **Audit Provenans Angka Dashboard**:
   - Buka halaman Dashboard dan Insight Pasar, pastikan setiap angka disertai label sumber dan tanggal observasi terverifikasi.
