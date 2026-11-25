# Inventaris Sumber Data & Kepatuhan · Sanghyang News

Dokumen ini mendokumentasikan seluruh sumber data yang digunakan oleh sistem Sanghyang News, mekanisme pengambilan data, status kepatuhan hukum dan teknis (robots.txt dan Ketentuan Layanan), frekuensi pengumpulan, serta batasan operasionalnya.

---

## 1. Prinsip Utama Pengumpulan Data

Sesuai dengan hukum invarian blueprint, ADR-004, dan pembaruan ADR-012:
- **Kepatuhan Penuh (Crawl Patuh)**: Menghormati batasan `robots.txt`, ketentuan layanan platform penyedia, dan menggunakan identitas perayap (*User-Agent*) yang jujur dan transparan.
- **Tanpa Penembusan Tantangan**: Server dilarang menyuntikkan cookie sesi pribadi atau memotong CAPTCHA/WAF; apabila pembacaan melalui Ekstensi Chrome Staf (ADR-012) menemui halaman login atau CAPTCHA, proses berhenti seketika untuk diselesaikan langsung oleh staf di tab Chrome asli.
- **Transparansi Status**: Sumber yang membutuhkan izin atau kredensial API resmi dikelola melalui adaptor dengan status jujur (*"Belum tersambung"* bila kredensial belum diisi pemilik).
- **Integritas Observasi (Zero Mock Data)**: Seluruh data yang disimpan wajib memiliki metadata provenans (`sourceUrl`, `capturedAt`, dan pengenal eksternal tanpa PII).

---

## 2. Matriks Sumber Data

| Nama Sumber | Jenis Data | Metode Pengambilan | Status Kepatuhan | Frekuensi | Batasan & Keterangan |
|---|---|---|---|---|---|
| **Google News RSS** | Berita industri pariwisata, perhotelan Banten, Anyer, & bencana alam/infrastruktur | Penguraian feed XML RSS publik via HTTP client | Patuh (Feed publik syndication standar) | Harian (06:00 & 18:00 WIB) | Artikel memerlukan ekstraksi konten penuh dan penyaringan redaksi. |
| **Google Travel / Hotels** | Tarif terendah kamar hotel compset per tanggal menginap | Parser headless browser Puppeteer dengan fixture teruji | Patuh (Data publik non-otentikasi, pembatasan laju ketat) | Harian (Nightly 22:23 WIB) | Tarif dinamis berdasarkan tanggal pencarian, durasi, dan ketersediaan OTA. Dilarang spamming kueri. |
| **Google Maps / Places** | Ulasan tamu, rating agregat, koordinat, dan jumlah ulasan | Adaptor Google Places API resmi & parser ulasan publik terstruktur | Patuh (Kredensial API resmi / inspeksi data publik) | Mingguan / Sesuai Kebutuhan | Tanggal ulasan publik bersifat relatif ("2 minggu lalu"); memerlukan konversi dengan pencatatan ketidakpastian hari. |
| **Instagram Business** | Aktivitas promosi kompetitor, postingan feed/reels, komentar anonim | Adaptor Meta Graph API + Ekstensi Chrome Staf (MV3 unpacked, ADR-012) | Patuh (Graph API resmi atau sesi peramban staf wajar; berhenti pada login/CAPTCHA; komentar dianonimkan) | On-demand / Mingguan | Server tidak menyuntikkan cookie; staf menjalankan sinkronisasi manual dari Ubuntu/Windows lewat ekstensi. |
| **TikTok** | Tren video pariwisata, metrik tayang/likes/shares, komentar anonim | `TikTok oEmbed` publik + Ekstensi Chrome Staf (MV3 unpacked, ADR-012) | Patuh (`SlardarWAF` dihormati; berhenti & tampilkan tab jika diminta verifikasi CAPTCHA/login; komentar dianonimkan) | On-demand | Ketersediaan video publik dicek lewat oEmbed; pembaruan metrik & komentar dilakukan di peramban staf secara interaktif. |
| **BPS Provinsi Banten** | Tingkat Penghunian Kamar (TPK) hotel berbintang & non-bintang | Rujukan publikasi statistik resmi BPS (manual / agregat terbitan) | Patuh (Data terbuka pemerintah RI) | Bulanan / Semesteran | Digunakan sebagai dasar penghitungan estimasi kasar pasar berlabel "Perkiraan Kasar Berdasarkan TPK BPS". |
| **Internal Resort (Staf)** | Realisasi omset per unit bisnis, target bulanan, promo in-house | Formulir input manual terlindungi di `/admin/omset` | Patuh (Data milik internal resort sendiri) | Bulanan (Setiap awal bulan / pasca closing) | Dilindungi kontrol privasi (penyamaran nilai di layar non-keuangan) dan verifikasi sesi. |

---

## 3. Detail Kepatuhan per Kanal

### 3.1 Google News RSS
- **Endpoint**: `https://news.google.com/rss/search?q=...&hl=id&gl=ID&ceid=ID:id`
- **TOS & Robots**: Google mengizinkan sindikasi RSS publik untuk konsumsi agregator berita non-komersial langsung.
- **Penanganan URL**: Tautan Google News melewati sistem desereferensi / redirection resolver untuk mendapatkan URL kanonis portal berita penerbit asli.

### 3.2 Google Travel (Hotel Rates)
- **Karakteristik**: Mengambil tarif terendah kamar untuk sasaran compset di koridor Anyer (Klaster I & Klaster II).
- **Kepatuhan Robots & Laju**:
  - Request dibatasi dengan jeda minimum 3–5 detik antar-permintaan hotel.
  - User-Agent menyertakan identitas perayap riset resmi.
  - Uji parser wajib divalidasi terhadap fixture HTML offline di `tests/fixtures/` guna meminimalkan trafik langsung.
  - Pencatatan ID eksternal dilakukan secara deterministik (`hash(hotel + tanggal_pantau + harga)`).

### 3.3 Media Sosial (Pemisahan Data Publik vs Akun Sanghyang)
- **Keputusan Arsitektur**: Berdasarkan ADR-004 (beserta pembaruan 17 Nov 2026), seluruh mekanisme injeksi cookie sesi atau penembusan `robots.txt`/WAF (`instagram.com`, `facebook.com`, `tiktok.com`) tetap dilarang, namun **jalur komentar/postingan publik tanpa login akun Sanghyang** dipisahkan secara jelas dari OAuth akun milik sendiri:
  - **Tanpa login Sanghyang**: `Instagram Business Discovery` (token akun profesional mana pun untuk metadata postingan publik pesaing) dan `TikTok oEmbed` (tanpa kunci).
  - **Khusus login/OAuth akun Sanghyang**: analitik konten internal, data iklan media sosial, dan komentar pada postingan IG/FB milik Sanghyang (`instagram_manage_comments`).
- **Status Operasional**: Sumber tanpa kunci aktif melapor secara terpisah dari yang belum memiliki kunci server (`INSTAGRAM_GRAPH_ACCESS_TOKEN`). Bila kunci belum diisi, antarmuka menampilkan status jujur per jalur (`"Belum dikonfigurasi"`) beserta kunci yang diperlukan.

---

## 4. Penanganan Kegagalan & Observabilitas Sumber Data

Setiap upaya pengumpulan data dicatat ke dalam tabel `ScrapeRun` dan `ScrapeError`:
1. `job`: Jenis pekerjaan (`news`, `rates`, `reviews`, `promos`, `social`).
2. `startedAt` & `finishedAt`: Waktu presisi durasi penarikan data.
3. `itemsFound` & `itemsSaved`: Jumlah data valid yang berhasil diobservasi dan disimpan ke basis data.
4. `errorsCount`: Jumlah kegagalan atau respons non-200.
5. `ScrapeError`: Mencatat URL sasaran, kode status HTTP, pesan kesalahan, dan waktu kejadian untuk analisis akar masalah di halaman `/admin/scraping`.
