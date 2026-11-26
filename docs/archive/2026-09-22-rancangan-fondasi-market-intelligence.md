# Rancangan fondasi Market Intelligence

Catatan arsip (26 Nov 2026): berkas ini dipindah dari `docs/superpowers/specs/2026-09-22-market-intelligence-foundation-design.md` dan diterjemahkan dari bahasa Inggris tanpa mengubah isi teknisnya. Rancangan ini sudah dilaksanakan lewat [rencana fondasi](2026-09-22-rencana-fondasi-market-intelligence.md). Bentuk sistem yang berlaku sekarang ada di [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) §4 dan §6 serta ADR-014: kode pindah ke `src/`, halaman `/admin/scraping` diganti panel "Perbarui Semua Data", dan login memakai Supabase Auth, bukan `APP_PASSWORD`.

**Tanggal:** 2026-09-22
**Lingkup:** hanya fondasi Phase 1

## Tujuan

Menambahkan persistensi dan pipeline scraping yang bisa dilacak tanpa memutus alur newsletter lama.

## Batasan saat itu

- Aplikasi saat itu hanya memiliki alur Google News RSS → penyaringan dan penilaian → resolve → ekstraksi → Gemini → PDF.
- Belum ada basis data, registri sumber, riwayat scraping, atau halaman admin scraping.
- Alur newsletter lama harus tetap berjalan.
- Phase 1 tidak memuat modul pesaing, ulasan, F&B, acara, tren, atau rekomendasi.
- Kredensial tidak boleh disimpan dan kredensial produksi tidak boleh diubah.

## Arsitektur

Phase 1 menambahkan lapisan persistensi di samping alur lama. Adaptor scraper menghasilkan rekaman yang sudah dinormalkan, lalu repositori menyimpan artikel, sumber, run scraping, dan galat. Endpoint admin hanya memulai proses berita manual dan membaca riwayat; proses newsletter lama tetap memakai modul yang ada sampai migrasi berikutnya.

Pipeline scraper:

```text
Registri sumber
    ↓
Adaptor scraper (RSS / HTTP / peramban / manual)
    ↓
Artikel yang dinormalkan
    ↓
Deduplikasi deterministik
    ↓
Simpan Article + ScrapeRun + ScrapeError
```

## Model data

### Source

- `id`: kunci primer UUID atau string
- `name`: nama tampilan
- `domain`: domain yang dinormalkan
- `category`: `news | fnb | event | competitor | review`
- `type`: `rss | http | browser | manual`
- `enabled`: boolean, bawaan `true`
- `priority`: bilangan bulat, bawaan 0
- `intervalMinutes`: bilangan bulat, opsional
- `lastRunAt`: tanggal dan jam, opsional
- `lastSuccessAt`: tanggal dan jam, opsional
- `failureCount`: bilangan bulat, bawaan 0
- `createdAt`, `updatedAt`

Kunci unik: `(domain, type)`.

### Article

- `id`: kunci primer UUID atau string
- `sourceId`: kunci asing ke Source
- `title`
- `canonicalUrl`
- `normalizedTitle`
- `publishedAt`: tanggal dan jam, opsional
- `description`: teks, opsional
- `content`: teks, opsional
- `imageUrl`: string, opsional
- `contentHash`: string, opsional
- `status`: `discovered | extracted | failed | duplicate`
- `createdAt`, `updatedAt`

Deduplikasi deterministik memakai URL kanonis lebih dulu, lalu gabungan sumber, judul yang dinormalkan, tanggal terbit, dan hash isi. Duplikat tidak boleh menimpa artikel asli.

### ScrapeRun

- `id`: kunci primer UUID atau string
- `sourceId`: kunci asing ke Source
- `job`: `news`
- `status`: `running | success | partial | failed`
- `startedAt`
- `finishedAt`: tanggal dan jam, opsional
- `recordsDiscovered`: bilangan bulat, bawaan 0
- `recordsSaved`: bilangan bulat, bawaan 0
- `duplicates`: bilangan bulat, bawaan 0
- `errors`: bilangan bulat, bawaan 0
- `createdAt`

### ScrapeError

- `id`: kunci primer UUID atau string
- `runId`: kunci asing ke ScrapeRun
- `sourceId`: kunci asing ke Source
- `url`: string, opsional
- `stage`: `fetch | parse | extract | persist`
- `message`: pesan diagnosis yang aman ditampilkan
- `statusCode`: bilangan bulat, opsional
- `createdAt`

## Antarmuka scraper

Antarmuka bersama dibuat sekecil mungkin:

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

Adaptor di Phase 1:

- Adaptor RSS yang membungkus alur Google News yang sudah ada.
- Adaptor artikel HTTP yang membungkus ekstraktor yang sudah ada.
- Cadangan peramban di jalur ekstraksi, hanya bila keluaran HTTP kosong atau lebih pendek dari ambang yang berlaku.

Peramban tidak dijalankan untuk setiap artikel. Kegagalan peramban dicatat sebagai rekaman `ScrapeError` dan tidak menghentikan rekaman lain yang tidak terkait.

## Halaman admin

Tambahkan `/admin/scraping` di belakang autentikasi `proxy.ts` yang sudah ada.

Versi pertama memuat:

- daftar sumber yang aktif;
- tombol `Run News Now`;
- status run yang sedang berjalan;
- run terbaru dengan hitungan ditemukan, disimpan, duplikat, dan galat;
- rincian teks galat;
- tampilan saat kosong dan saat gagal.

Endpoint wajib menolak pekerjaan (`job`) yang tidak didukung, sumber yang dinonaktifkan, dan run bersamaan untuk sumber yang sama.

## Kompatibilitas

- Kontrak `/api/search`, `/api/resolve`, `/api/extract`, `/api/summarize`, dan `/api/export` tidak berubah.
- Alur tinjauan berbasis `sessionStorage` yang ada tidak berubah.
- Pemeriksaan keamanan URL untuk URL yang dikirim peramban tetap wajib.
- Kunci API tetap hanya di server.

## Pengujian

Pemeriksaan minimum:

- pembuatan skema dan migrasi;
- perilaku mengaktifkan dan menonaktifkan sumber;
- perilaku duplikat yang deterministik;
- penghitungan run scraping yang sukses, sebagian, dan gagal;
- cadangan ekstraksi HTTP ke peramban saat isi terlalu pendek;
- endpoint admin menolak permintaan tanpa autentikasi atau yang tidak sah;
- lint, pemeriksaan tipe, build, dan skrip regresi yang ada tetap lulus.

## Sengaja ditunda

- Pengumpul data F&B dan acara.
- Pengelolaan data pesaing, snapshot harga, promosi, dan ulasan.
- Tren, wawasan, peluang, dan rekomendasi Gemini.
- Scraping terjadwal atau di latar belakang.
- Deploy produksi dan perubahan kredensial.
