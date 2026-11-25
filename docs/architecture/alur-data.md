# Alur Data Sistem · Sanghyang News

Dokumen ini menjelaskan alur data menyeluruh sistem Sanghyang News dari tahap pengumpulan (sumber eksternal dan masukan staf), proses validasi dan ingestion, persistensi di basis data, hingga penyajian pada antarmuka pengguna dan berkas laporan rapat.

---

## 1. Diagram Arsitektur Alur Data

```mermaid
flowchart TD
    subgraph SumberData["1. Sumber Data (Eksternal & Internal)"]
        S_News["Google News RSS (Feed Pariwisata Banten)"]
        S_Rates["Google Travel / Hotels (Harga Publik Compset)"]
        S_Places["Google Maps / Places (Ulasan & Rating)"]
        S_Social["Meta Graph & Places API (Adaptor Resmi)"]
        S_Ext["Instagram & TikTok (Ekstensi Chrome Staf ADR-012)"]
        S_Manual["Masukan Staf Resort (Realisasi Omset & Target)"]
        S_BPS["Publikasi Statistik BPS (TPK Banten)"]
    end

    subgraph Pengumpul["2. Pengumpul & Adaptor Data"]
        C_News["News Fetcher & Resolver"]
        C_Rates["Hotel Rates Collector"]
        C_Reviews["Review Scraper & Parser"]
        C_Adapters["Official API Adapters (Status Jujur)"]
        C_Ext["Browser Sync API (/api/marketing-sosmed/browser-sync)"]
        C_Form["Input Controller (/admin/omset)"]
    end

    subgraph ValidasiIngestion["3. Validasi & Ingestion (Zero Mock & Kepatuhan)"]
        V_Rule["Validasi Kontrak & Anti-Halusinasi"]
        V_Dedup["Deduplikasi Hash & ID Eksternal Stabil"]
        V_Log["Pencatat Observabilitas (ScrapeRun & ScrapeError)"]
    end

    subgraph BasisData["4. Basis Data (PostgreSQL 17 via Prisma)"]
        DB_Articles["Article & MarketItem"]
        DB_Compset["Competitor (Registri Tunggal)"]
        DB_Rates["PriceSnapshots (Sanghyang & Pesaing)"]
        DB_Reviews["CompetitorReview (Ulasan Riil)"]
        DB_Promos["CompetitorPromotion (Promo Terpantau)"]
        DB_Revenue["OutletMonthlyRevenue & Snapshot"]
        DB_Runs["ScrapeRun & ScrapeError"]
    end

    subgraph ApiLayer["5. Lapisan API (Next.js App Router)"]
        API_Summary["/api/market-intelligence/summary"]
        API_Outlet["/api/market-intelligence/outlet"]
        API_Scrape["/api/admin/scraping (Status & Trigger)"]
        API_Omset["/api/admin/omset"]
        API_News["/api/news & /api/newsletter"]
    end

    subgraph Presentasi["6. Konsumsi & Penyajian"]
        UI_Dash["Dasbor Utama (/dashboard)"]
        UI_Market["Intelijen Pasar & Pembaruan Data (/market-intelligence)"]
        UI_Gallery["Galeri & Compset (/galeri-kompetitor)"]
        UI_Sosmed["Performa Sosmed (/marketing-sosmed)"]
        UI_Graph["Knowledge Graph (/knowledge-graph)"]
        PDF_Report["Ekspor PDF Laporan Rapat Senin (Puppeteer)"]
    end

    %% Hubungan Alur
    S_News --> C_News
    S_Rates --> C_Rates
    S_Places --> C_Reviews
    S_Social --> C_Adapters
    S_Ext --> C_Ext
    S_Manual --> C_Form
    S_BPS --> C_Form

    C_News --> V_Rule
    C_Rates --> V_Rule
    C_Reviews --> V_Rule
    C_Adapters --> V_Rule
    C_Ext --> V_Rule
    C_Form --> V_Rule

    V_Rule --> V_Dedup
    V_Dedup --> V_Log

    V_Log --> DB_Articles
    V_Log --> DB_Compset
    V_Log --> DB_Rates
    V_Log --> DB_Reviews
    V_Log --> DB_Promos
    V_Log --> DB_Revenue
    V_Log --> DB_Runs

    DB_Articles --> API_News
    DB_Compset --> API_Summary
    DB_Rates --> API_Summary
    DB_Rates --> API_Outlet
    DB_Reviews --> API_Outlet
    DB_Promos --> API_Outlet
    DB_Revenue --> API_Omset
    DB_Runs --> API_Scrape

    API_News --> UI_Dash
    API_Summary --> UI_Dash
    API_Outlet --> UI_Market
    API_Scrape --> UI_Market
    API_Summary --> UI_Gallery
    API_Summary --> UI_Sosmed
    API_Summary --> UI_Graph
    API_Summary --> PDF_Report
    API_Outlet --> PDF_Report
```

---

## 2. Rincian Tahapan Alur Data

### Tahap 1: Pengumpulan & Normalisasi
- **Otomasi Terjadwal**: GitHub Actions menjalankan workflow pengumpulan tarif setiap malam pukul 22:23 WIB.
- **Pemicuan Manual**: Tim internal dapat memicu pembaruan data melalui tombol **Perbarui Semua Data** di `/market-intelligence` (tautan lama `/admin/scraping` dialihkan otomatis ke `/market-intelligence`).
- **Sinkronisasi Media Sosial Staf (ADR-012)**: Data Instagram dan TikTok disinkronkan langsung dari sesi Chrome staf lewat Ekstensi Chrome **Sanghyang Market Sync** ke `POST /api/marketing-sosmed/browser-sync` dengan jeda manusia pada login atau CAPTCHA.
- **Adaptor Terisolasi**: Sumber data eksternal yang memerlukan token API resmi (Meta Graph, Google Places) diproses melalui adaptor berstandar yang secara transparan mengembalikan status ketersediaan kredensial.

### Tahap 2: Validasi Zero Mock & Deduplikasi
- Data yang masuk tidak boleh menyertakan nilai karangan (*mock data*).
- Setiap harga dan ulasan dipetakan ke ID stabil berbasis hash properti penting (`hotelId`, `date`, `price`, `author`, `textHash`) guna mencegah duplikasi observasi berulang.
- Seluruh metrik yang tidak memiliki data observasi nyata akan disimpan dan dirender sebagai `null` / *"Belum ada data"*.

### Tahap 3: Persistensi & Integritas Relasional
- Menggunakan Prisma ORM pada PostgreSQL 17 dengan skema bertipe aman.
- **Optimistic Concurrency Control (OCC)**: Tabel kritis mengimplementasikan kolom `version Int @default(1)` untuk mencegah konflik penulisan konkuren.
- **Isolasi Lingkungan**: Seluruh pengujian dan pengembangan lokal diarahkan ke basis data PostgreSQL Docker lokal. Operasi tulis terhadap Supabase produksi diblokir oleh pengaman `lib/db.ts`.

### Tahap 4: Penyajian Berjenjang & Laporan Eksekutif
- **Penyajian Cepat**: Endpoint `/api/market-intelligence/summary` menyajikan agregat metrik dengan pemfilteran periode dan seleksi kolom minimalis guna menjaga performa respons tetap di bawah 1,5 detik.
- **Penyajian 6 Unit Bisnis**: Data disajikan mengikuti 6 langkah membaca konsisten:
  1. *Tujuan*
  2. *Kata Tamu*
  3. *Pesaing*
  4. *Harga*
  5. *Promo & Event*
  6. *Langkah Minggu Ini*
- **Laporan Rapat Senin**: Modul generator PDF Puppeteer menyusun ringkasan mingguan berformat cetak A4 dengan tata letak bersih untuk evaluasi manajemen.
