# Rencana implementasi fondasi Market Intelligence

Catatan arsip (26 Nov 2026): berkas ini dipindah dari `docs/superpowers/plans/2026-09-22-market-intelligence-foundation.md` dan diterjemahkan dari bahasa Inggris. Urutan tugas, daftar berkas, antarmuka, dan perintahnya tidak diubah; kotak centang langkah diganti judul langkah biasa karena rencana ini sudah tuntas. Hasilnya ada di kode sekarang: `src/lib/market/source-registry.ts`, `article-repository.ts`, `normalize.ts`, `scrape-log.ts`, `scraper.ts`, `rss-scraper.ts`, `http-scraper.ts`, `browser-fallback.ts`, `run-news.ts`, rute `src/app/api/admin/scraping/` (termasuk `[runId]`), serta model `Source`, `Article`, `ScrapeRun`, dan `ScrapeError` di `prisma/schema.prisma`. Halaman `/admin/scraping` kemudian diganti panel "Perbarui Semua Data" (`src/components/marketing/sn-update-all.tsx`, P2 butir C7). Path di bawah memakai susunan lama tanpa awalan `src/`, dan dokumen di Tugas 7 kini ada di [`legacy-v1/`](legacy-v1/). Perintah `git` dan PowerShell dicatat sebagai riwayat, bukan untuk dijalankan ulang.

> **Untuk pelaksana agen (saat itu):** sub-skill wajib `superpowers:subagent-driven-development` (dianjurkan) atau `superpowers:executing-plans` untuk mengerjakan rencana ini tugas demi tugas.

**Tujuan:** Menambahkan persistensi, registri sumber, log scraping, abstraksi scraper, dan admin scraping dasar tanpa memutus alur newsletter lama.

**Arsitektur:** Prisma menjadi lapisan persistensi baru di samping alur newsletter yang sudah ada. Pipeline scraper memakai adaptor kecil untuk RSS dan HTTP, dengan Puppeteer hanya sebagai cadangan saat hasil HTTP kosong atau terlalu pendek. API dan halaman admin mengelola sumber serta run berita manual; kontrak API lama tidak berubah.

**Teknologi:** Next.js 16 App Router, TypeScript, PostgreSQL, Prisma, React, Puppeteer yang sudah terpasang, dan ekstraktor artikel yang sudah ada.

**Rancangan:** [`2026-09-22-rancangan-fondasi-market-intelligence.md`](2026-09-22-rancangan-fondasi-market-intelligence.md)

**Catatan ruang kerja:** audit menemukan folder ini belum memiliki `.git`; langkah commit di bawah adalah titik periksa yang dipakai bila repositori sudah diinisialisasi, bukan alasan untuk menghentikan implementasi.

## Batasan global

- Alur `/`, `/review`, `/preview`, dan API newsletter lama tetap berfungsi.
- Phase 1 hanya mencakup fondasi berita; tidak membuat modul F&B, acara, pesaing, ulasan, tren, wawasan, atau rekomendasi.
- Otomasi peramban hanya cadangan, bukan scraper utama.
- Artikel duplikat tidak boleh menimpa rekaman pertama.
- URL yang datang dari peramban tetap melewati validasi URL aman yang ada.
- Kredensial dan rahasia produksi tidak diubah dan tidak di-commit.
- Tidak ada pekerjaan terjadwal di Phase 1.

## Fokus tinjauan

- Basis data yang belum tersedia atau `DATABASE_URL` yang kosong harus menghasilkan galat penyiapan yang jelas, bukan membuka akses atau merusak newsletter lama. Tes: kegagalan konfigurasi saat repositori dimulai.
- Dua item RSS dengan URL sama harus menyimpan satu artikel dan menghitung satu duplikat. Tes: deduplikasi URL yang deterministik.
- Dua item tanpa URL tetap dengan judul, sumber, tanggal, dan isi yang sama harus dianggap duplikat. Tes: deduplikasi gabungan.
- Satu sumber gagal sementara sumber lain berhasil harus menghasilkan run `partial`, bukan menggagalkan seluruh run. Tes: penghitungan galat per sumber.
- Cadangan peramban tidak boleh dipanggil untuk artikel yang isi HTTP-nya sah dan harus dipanggil untuk isi yang pendek. Tes: pengamat tiruan pada peluncur peramban.

---

### Tugas 1: Fondasi dan skema Prisma

**Berkas:**
- Ubah: `package.json`
- Ubah: `package-lock.json`
- Buat: `prisma/schema.prisma`
- Buat: `prisma/seed.ts`
- Buat: `.env.example`
- Buat: `lib/db.ts`
- Buat: `lib/db-types.ts`
- Tes: `scripts/test-db-config.ts`

**Antarmuka:**
- Menghasilkan model Prisma `Source`, `Article`, `ScrapeRun`, `ScrapeError` dan singleton `db` dari `lib/db.ts`.
- `Source.category`: `news | fnb | event | competitor | review`.
- `Source.method`: `rss | http | browser | manual`.
- `ScrapeRun.job`: `news` untuk fase ini.

**Langkah 1: Tambahkan dependensi seperlunya dan skrip basis data**

Tambahkan `prisma` dan `tsx` sebagai dependensi pengembangan serta `@prisma/client` sebagai dependensi. Tambahkan skrip:

```json
"db:generate": "prisma generate",
"db:migrate": "prisma migrate dev",
"db:seed": "tsx prisma/seed.ts"
```

Jangan menambahkan ORM atau alat migrasi kedua.

**Langkah 2: Tulis skemanya**

Definisikan keempat model dengan id UUID, cap waktu, kunci asing, indeks, dan batasan unik untuk sumber `(domain, method)`. Tambahkan indeks atau batasan unik untuk `canonicalUrl` artikel, `contentHash`, dan kolom pencarian yang dibutuhkan deduplikasi. Biarkan kolom boleh kosong bila sumber RSS atau HTTP tidak bisa menjamin isinya.

**Langkah 3: Tambahkan contoh env dan singleton basis data**

`.env.example` hanya berisi:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/sanghyang_news"
GEMINI_API_KEY=
APP_PASSWORD=
GEMINI_MODEL=
```

`lib/db.ts` mengekspor singleton Prisma yang aman untuk pengembangan dan tidak menulis rahasia koneksi ke log.

**Langkah 4: Tambahkan tes konfigurasi minimal**

Buat `scripts/test-db-config.ts` yang memastikan `DATABASE_URL` diwajibkan di batas klien basis data dan nilainya tidak pernah dicetak. Jalankan dengan runner TypeScript yang tersedia di dependensi terpasang, atau dengan pemeriksaan yang bisa dijalankan Node biasa bila runner itu tidak ada.

**Langkah 5: Buat dan validasi klien Prisma**

Jalankan:

```powershell
npm install
npm run db:generate
```

Hasil yang diharapkan: klien Prisma berhasil dibuat tanpa membutuhkan basis data yang sedang berjalan.

**Langkah 6: Commit**

```powershell
git add package.json package-lock.json prisma .env.example lib/db.ts lib/db-types.ts scripts/test-db-config.ts
git commit -m "feat: add market intelligence persistence foundation"
```

---

### Tugas 2: Registri sumber dan repositori artikel yang deterministik

**Berkas:**
- Buat: `lib/market/source-registry.ts`
- Buat: `lib/market/article-repository.ts`
- Buat: `lib/market/normalize.ts`
- Buat: `scripts/test-market-repository.ts`
- Ubah: `prisma/seed.ts`

**Antarmuka:**

```ts
type SourceCategory = 'news' | 'fnb' | 'event' | 'competitor' | 'review';
type ScrapeMethod = 'rss' | 'http' | 'browser' | 'manual';

type NewArticle = {
  sourceId: string;
  title: string;
  canonicalUrl: string;
  normalizedTitle: string;
  publishedAt?: Date;
  description?: string;
  content?: string;
  imageUrl?: string;
  contentHash?: string;
};

type SaveArticleResult = { saved: boolean; duplicate: boolean; articleId: string };
```

**Langkah 1: Tulis pemeriksaan normalisasi dan deduplikasi yang gagal lebih dulu**

Uji bahwa normalisasi memangkas dan merapatkan spasi serta memakai huruf kecil saat membandingkan judul, hash isi selalu sama untuk isi yang sama, fragmen URL dibuang, dan rekaman dengan URL, judul, tanggal, serta isi yang setara menghasilkan kunci deduplikasi yang sama.

**Langkah 2: Implementasikan normalisasi**

Pakai kelas `URL` bawaan dan hash dari modul crypto Node. Simpan URL kanonis asli secara terpisah; nilai yang dinormalkan hanya dipakai untuk perbandingan.

**Langkah 3: Tulis pemeriksaan repositori yang gagal lebih dulu**

Pakai klien repositori yang bisa disuntikkan atau pengganti Prisma khusus tes, supaya pemeriksaan tidak membutuhkan akses jaringan. Cakup aktif dan nonaktif sumber, duplikat URL, duplikat gabungan, dan terjaganya rekaman pertama.

**Langkah 4: Implementasikan registri sumber**

Sediakan fungsi:

```ts
listSources(category?: SourceCategory): Promise<Source[]>;
getEnabledSources(category: SourceCategory): Promise<Source[]>;
setSourceEnabled(id: string, enabled: boolean): Promise<Source>;
```

Isi satu sumber `Google News` yang aktif dengan metode RSS yang ada. Sumber pesaing atau ulasan belum diisi.

**Langkah 5: Implementasikan repositori artikel**

Sediakan `saveArticle()` yang memeriksa URL kanonis lebih dulu, lalu sidik jari gabungan. Fungsi ini wajib mengembalikan keterangan duplikat dan tidak pernah memperbarui rekaman asli saat duplikat ditemukan.

**Langkah 6: Jalankan tes dan commit**

```powershell
npm run db:generate
npx tsx scripts/test-market-repository.ts
git add lib/market prisma/seed.ts scripts/test-market-repository.ts
git commit -m "feat: add source registry and article deduplication"
```

---

### Tugas 3: Log run scraping dan galat

**Berkas:**
- Buat: `lib/market/scrape-log.ts`
- Buat: `scripts/test-scrape-log.ts`

**Antarmuka:**

```ts
type ScrapeJob = 'news';
type ScrapeRunStatus = 'running' | 'success' | 'partial' | 'failed';
type ScrapeStage = 'fetch' | 'parse' | 'extract' | 'persist';

startRun(sourceId: string, job: ScrapeJob): Promise<ScrapeRun>;
finishRun(id: string, result: { status: ScrapeRunStatus; discovered: number; saved: number; duplicates: number; errors: number }): Promise<ScrapeRun>;
recordScrapeError(input: { runId: string; sourceId: string; url?: string; stage: ScrapeStage; message: string; statusCode?: number }): Promise<ScrapeError>;
listRecentRuns(limit: number): Promise<ScrapeRun[]>;
```

**Langkah 1: Tulis pemeriksaan penghitungan yang gagal lebih dulu**

Pastikan run yang sukses menyimpan hitungannya, run sebagian menyimpan galat sambil mempertahankan rekaman yang sudah tersimpan, dan pesan galat dibatasi panjangnya serta aman ditampilkan di antarmuka.

**Langkah 2: Implementasikan fungsi log**

Pakai transaksi Prisma hanya bila pembaruan run dan hitungan galatnya harus tetap konsisten. Pemanggilannya tetap langsung, tanpa antrean atau penjadwal.

**Langkah 3: Tambahkan pembaruan kesehatan sumber**

Saat run selesai dengan sukses, perbarui `lastRunAt` dan `lastSuccessAt`, lalu setel ulang `failureCount`. Saat run selesai gagal atau sebagian, perbarui `lastRunAt` dan naikkan `failureCount`.

**Langkah 4: Jalankan pemeriksaan dan commit**

```powershell
npx tsx scripts/test-scrape-log.ts
git add lib/market/scrape-log.ts scripts/test-scrape-log.ts
git commit -m "feat: add scrape run and error logging"
```

---

### Tugas 4: Adaptor scraper dan cadangan peramban

**Berkas:**
- Buat: `lib/market/scraper.ts`
- Buat: `lib/market/rss-scraper.ts`
- Buat: `lib/market/http-scraper.ts`
- Buat: `lib/market/browser-fallback.ts`
- Ubah: `lib/extractor.ts`
- Buat: `scripts/test-market-scrapers.ts`

**Antarmuka:**

```ts
type ScrapeContext = { source: Source; runId: string };
type ScrapedArticle = {
  title: string;
  canonicalUrl: string;
  publishedAt?: Date;
  description?: string;
  content?: string;
  imageUrl?: string;
};

interface Scraper {
  scrape(context: ScrapeContext): Promise<ScrapedArticle[]>;
}
```

**Langkah 1: Tulis tes adaptor dan cadangan**

Ganti `fetch` dan peluncur peramban dengan tiruan khusus tes. Pastikan RSS memetakan kolom Google News yang ada, HTTP memakai ekstraktor yang ada, isi HTTP yang sah tidak meluncurkan Puppeteer, dan isi yang pendek atau kosong memanggil cadangan peramban satu kali.

**Langkah 2: Pisahkan peluncuran peramban ke satu fungsi yang bisa disuntikkan**

Pakai ulang `puppeteer` yang terpasang untuk eksekusi lokal dan isolasi peluncur cadangan supaya tes tidak menyalakan Chromium. Ekstraksi lewat peramban wajib mengembalikan bentuk artikel yang sama dengan jalur HTTP.

**Langkah 3: Implementasikan adaptor RSS**

Bungkus keluaran `searchAll()` yang ada. Jangan menggandakan perilaku kata kunci dan penilaian; Phase 1 menyimpan artikel yang ditemukan dalam bentuk yang dinormalkan dan membiarkan perilaku pencarian sekarang tetap utuh.

**Langkah 4: Implementasikan adaptor HTTP**

Bungkus `extractOne()` dan pertahankan pemeriksaan keamanan URL yang ada. Untuk isi yang pendek atau kosong, panggil cadangan peramban. Kegagalan peramban dikembalikan sebagai galat terstruktur untuk pencatat run, bukan dilempar sampai menghentikan seluruh kelompok artikel.

**Langkah 5: Jalankan pemeriksaan regresi dan scraper**

```powershell
npx tsx scripts/test-market-scrapers.ts
npx tsx scripts/test-extractor.ts
npx tsx scripts/test-urlaman.ts
```

**Langkah 6: Commit**

```powershell
git add lib/market lib/extractor.ts scripts/test-market-scrapers.ts
git commit -m "feat: add layered market scrapers"
```

---

### Tugas 5: Layanan scraping berita manual dan API terlindung

**Berkas:**
- Buat: `lib/market/run-news.ts`
- Buat: `app/api/admin/scraping/route.ts`
- Buat: `app/api/admin/scraping/[runId]/route.ts`
- Buat: `scripts/test-admin-scraping.ts`

**Antarmuka:**

```ts
runNewsNow(): Promise<{ runId: string; status: ScrapeRunStatus }>;
```

**Langkah 1: Tulis pemeriksaan API dan layanan**

Pastikan metode yang tidak didukung dijawab 405, isi permintaan yang rusak dijawab 400, run berita yang bersamaan ditolak dengan 409, dan run yang berhasil mengembalikan id run. Penolakan autentikasi dicakup lewat perilaku proxy yang ada ditambah tes kontrak di tingkat rute.

**Langkah 2: Implementasikan layanan run**

Muat sumber berita yang aktif, buat satu run per sumber, jalankan adaptornya, simpan artikel, catat galat, lalu tutup hitungannya. Kegagalan satu sumber tidak boleh menghentikan sumber lain.

**Langkah 3: Implementasikan rute terlindung**

`POST /api/admin/scraping` memulai run berita. `GET /api/admin/scraping` mengembalikan sumber yang aktif dan run terbaru. `GET /api/admin/scraping/:runId` mengembalikan satu run beserta galatnya. Kunci API dan kredensial mentah tidak boleh ikut terkirim.

**Langkah 4: Jalankan pemeriksaan dan commit**

```powershell
npx tsx scripts/test-admin-scraping.ts
git add lib/market/run-news.ts app/api/admin/scraping scripts/test-admin-scraping.ts
git commit -m "feat: add manual news scraping API"
```

---

### Tugas 6: Halaman admin scraping awal

**Berkas:**
- Buat: `app/admin/scraping/page.tsx`
- Ubah: `proxy.ts`
- Buat: `scripts/test-admin-page.ts`

**Antarmuka:**
- Halaman memakai `GET /api/admin/scraping` dan `POST /api/admin/scraping`.
- Halaman hanya menampilkan label yang mudah dibaca; nama metode scraper internal dan stack trace mentah tetap tersembunyi.

**Langkah 1: Tulis pemeriksaan perilaku halaman**

Pastikan halaman menampilkan status sumber, tombol `Run News Now`, hitungan run terbaru, tampilan saat memuat, tampilan saat kosong, dan tampilan galat yang bisa dipulihkan.

**Langkah 2: Masukkan rute ke cakupan autentikasi**

Pastikan `/admin/scraping` dialihkan ke `/login` bila cookie sesi tidak ada, dan bisa dibuka setelah login. Pertahankan perilaku `APP_PASSWORD` yang menolak akses bila konfigurasinya tidak ada.

**Langkah 3: Implementasikan halaman minimal**

Pakai state React dan gaya Tailwind yang ada. Lakukan polling hanya setelah pengguna memicu run, dan hentikan saat run mencapai keadaan akhir. Jangan menambahkan pustaka state atau pustaka komponen.

**Langkah 4: Jalankan pemeriksaan halaman dan commit**

```powershell
npx tsx scripts/test-admin-page.ts
git add app/admin/scraping/page.tsx proxy.ts scripts/test-admin-page.ts
git commit -m "feat: add scraping admin page"
```

---

### Tugas 7: Verifikasi penuh Phase 1 dan dokumentasi

**Berkas:**
- Ubah: `README.md`
- Ubah: `BACKEND.md`
- Ubah: `FRONTEND.md`
- Ubah: `CODEX_HANDOFF_SANGHYANG_MARKET_INTELLIGENCE.md`
- Ubah: `package.json` (hanya bila skrip tes yang stabil sudah tersedia)

**Langkah 1: Dokumentasikan penyiapan basis data lokal**

Tulis `DATABASE_URL`, migrasi, seed, dan perintah menjalankan aplikasi lokal dengan persis. Nyatakan dengan jelas bahwa pekerjaan terjadwal dan modul Phase 2 tidak termasuk.

**Langkah 2: Dokumentasikan kontrak scraper dan log**

Perbarui dokumentasi backend dengan pipeline adaptor, pemicu cadangan, perilaku deduplikasi, kolom registri sumber, dan rute admin.

**Langkah 3: Jalankan seluruh rangkaian verifikasi**

```powershell
npm run lint
npx tsc --noEmit
npm run build
npx tsx scripts/test-market-repository.ts
npx tsx scripts/test-scrape-log.ts
npx tsx scripts/test-market-scrapers.ts
npx tsx scripts/test-admin-scraping.ts
npx tsx scripts/test-admin-page.ts
```

Jalankan juga skrip deterministik lama yang tidak membutuhkan kredensial asli atau layanan luar:

```powershell
npx tsx scripts/test-filter.ts
npx tsx scripts/test-scoring.ts
npx tsx scripts/test-jiplak.ts
npx tsx scripts/test-judul.ts
npx tsx scripts/test-urlaman.ts
```

**Langkah 4: Konfirmasi kriteria penerimaan Phase 1**

Periksa perilaku rute newsletter lama, pembuatan skema basis data, aktif dan nonaktif sumber, terjaganya rekaman pertama saat ada duplikat, cadangan peramban, riwayat scraping, autentikasi yang menolak akses saat konfigurasinya tidak ada, tidak ada rahasia yang ikut di-commit, lint, pemeriksaan tipe, tes, dan build produksi.

**Langkah 5: Commit dokumentasi dan verifikasi**

```powershell
git add README.md BACKEND.md FRONTEND.md CODEX_HANDOFF_SANGHYANG_MARKET_INTELLIGENCE.md package.json
git commit -m "docs: document market intelligence foundation"
```

## Tinjauan mandiri rencana

- Cakupan: setiap keluaran Phase 1 dari rancangan yang disetujui dipetakan ke Tugas 1 sampai 7.
- Lingkup: tidak ada fitur Phase 2 atau sesudahnya.
- Antarmuka: kontrak repositori, log, scraper, layanan run, dan API dinamai sebelum dipakai oleh bagian lain.
- Kemungkinan gagal: konfigurasi basis data yang hilang, duplikat deterministik, run sebagian, isi HTTP yang pendek, autentikasi, dan pemeriksaan regresi masing-masing punya tes.
- Tidak ada deploy produksi atau perubahan kredensial yang direncanakan.
