# Kebijakan Retensi dan Kurasi Artikel Berita Pasar

Dokumen ini menetapkan standar kurasi, ambang batas relevansi, dan siklus hidup (retensi) artikel berita pasar pada sistem intelijen pasar Sanghyang Indah Spa Resort.

---

## 1. Latar Belakang dan Masalah

Berdasarkan audit komprehensif 13 November 2026 pada repositori dan basis data:
- Terdapat 10.054 artikel di basis data dengan status `discovered`, dengan penambahan sekitar 200 artikel baru setiap hari melalui saluran sindikasi RSS (Google News, media daring lokal Banten).
- Sebanyak 690 dari 734 entri `MarketItem` tercatat memiliki `relevanceScore` statis 50 (nilai bawaan tanpa kalkulasi nyata).
- Terjadi kontaminasi derau (false-positive) yang signifikan: berita non-pasar seperti turnamen olahraga (Porprov), pengangkatan pegawai (PPPK/ASN), pemutusan hubungan kerja (PHK), skandal konstruksi (PSU Perkim/U-ditch), dan berita kriminal masuk ke dalam kategori `fnb` atau `event`.
- Banyak acara (event) bertanggal tahun lalu (2024 dan 2025) yang masih berstatus aktif di dasbor.

Kondisi tersebut menyebabkan kartu dasbor intelijen pasar ("Berita kuliner", "Agenda wisata", dsb.) didominasi informasi yang tidak relevan dengan kebutuhan strategis operasional resort di Anyer.

---

## 2. Kriteria Relevansi Pasar (Eligibility Criteria)

Setiap artikel yang masuk diproses melalui filter deterministik di `lib/market/classifier.ts`.

### 2.1 Koridor Geografis Proporsional
Relevansi wilayah dibagi menjadi tiga tingkatan berbobot:
1. **Koridor Inti (`core`, bobot 40 poin)**:
   Anyer, Carita, Cinangka, Cikoneng, Sirih, Bandulu, Sambolo, Karang Bolong, Pantai Anyer, Pantai Carita, dan Sanghyang Indah Spa Resort.
2. **Penyangga Sekunder (`buffer`, bobot 20 poin)**:
   Cilegon, Serang (Kabupaten/Kota), Pandeglang, Labuan, Merak, dan Tanjung Lesung. Berita di wilayah ini hanya diakui relevan jika memuat kata kunci domain perhotelan, F&B, atau pariwisata yang jelas.
3. **Regional Provinsi (`regional`, bobot 10 poin)**:
   Provinsi Banten, Selat Sunda, dan kawasan Gunung Anak Krakatau.
4. **Di Luar Lingkup (`none`, bobot 0 poin)**:
   Wilayah di luar Banten barat (Tangerang Selatan, Cirebon, Ciamis, Jawa Barat, Jakarta) yang tidak memiliki keterkaitan langsung dengan koridor Anyer-Carita dieliminasi secara otomatis.

### 2.2 Taksonomi Kategori Pasar
Sistem mengelompokkan berita ke dalam enam domain pasar yang sah:
1. **Hotel & Akomodasi**: Tingkat okupansi, promosi menginap, reservasi, villa, cottage, dan kebijakan asosiasi PHRI.
2. **F&B (Kuliner & Restoran)**: Restoran pesisir, kafe pantai, sentra kuliner, olahan boga bahari (seafood), sate bebek, dan rabeg khas Banten.
3. **Event & Atraksi**: Festival kebudayaan pesisir, konser musik pantai, pameran wisata, atraksi kesenian, dan agenda tradisi (Seba Baduy).
4. **Regulasi & Kebijakan**: Pajak hotel/restoran (PBJT), penertiban sempadan pantai 100 meter, izin usaha pariwisata, dan retribusi wisata.
5. **Infrastruktur & Akses**: Akses jalan Anyer-Sirih, jalan Palima-Cinangka, progres Tol Serang-Panimbang, rekayasa lalu lintas akhir pekan, dan tanggul penahan abrasi pantai.
6. **Pariwisata & Destinasi**: Daya tarik pantai pasir putih, ekowisata mangrove, watersport, dan promosi destinasi pesisir Selat Sunda.

### 2.3 Eliminasi Derau Mutlak (Noise Exclusion)
Artikel berikut dilarang masuk ke dalam intelijen pasar:
- Kriminalitas, kekerasan, pembunuhan, narkoba, razia penyakit masyarakat/prostitusi, dan sidang perkara pidana/korupsi.
- Berita duka cita, penemuan jenazah, pemakaman, dan kecelakaan fatal non-wisata.
- Politik praktis daerah, pilkada, pemilu, sengketa bawaslu, dan dinamika fraksi legislatif.
- Kepegawaian sipil umum (PPPK, CPNS, kenaikan honorer).
- Ketenagakerjaan industri manufaktur dan gelombang PHK buruh pabrik.
- Kompetisi olahraga umum (Porprov, atlet cabor, bonus medali).
- Program sosial pemerintah non-pariwisata (simulasi makan bergizi gratis di sekolah dasar).
- Proyek teknis lingkungan perumahan (drainase permukiman, rutilahu, u-ditch).

---

## 3. Rumus Perhitungan Nilai Relevansi (`relevanceScore`)

Nilai relevansi dihitung secara dinamis dalam rentang 0 hingga 100:

$$\text{relevanceScore} = \text{Skor Lokasi (0--40)} + \text{Skor Domain (0--45)} + \text{Skor Kesegaran (0--15)}$$

- **Skor Lokasi**: Koridor Inti = 40, Penyangga = 20, Regional = 10, Luar = 0.
- **Skor Domain**:
  - Kata kunci domain cocok di judul artikel: 30 poin.
  - Kata kunci domain cocok di teks deskripsi: 15 poin.
  - Kata kunci pendukung sektor pariwisata dalam teks: 3 poin per kata (maksimal 15 poin).
- **Skor Kesegaran**:
  - Publikasi $\le 30$ hari: 15 poin.
  - Publikasi 31--90 hari: 10 poin.
  - Publikasi 91--180 hari: 5 poin.
  - Publikasi $> 180$ hari: 0 poin.
- **Penalti Event Kedaluwarsa**: Event tahun lampau atau yang telah berakhir otomatis diberi skor 0.

**Ambang Batas Tampil**:
Artikel dengan $\text{relevanceScore} \ge 45$ berhak masuk ke tabel `MarketItem` dan ditampilkan di dasbor intelijen pasar. Artikel dengan skor $< 45$ ditolak dari kurasi aktif.

---

## 4. Kebijakan Retensi Berbasis Waktu (Lifecycle & TTL)

| Tipe Artikel | Masa Aktif di Dasbor | Perlakuan Pasca Masa Aktif |
|---|---|---|
| **Berita Pasar Umum** (Hotel, FnB, Regulasi, Infrastruktur, Wisata) | **12 Bulan (365 hari)** sejak `publishedAt` | Diarsipkan (`archivedAt` diisi timestamp). Data tetap tersimpan untuk analisis komparatif tahunan, namun disembunyikan dari kartu ringkasan operasional harian. |
| **Berita Event / Acara** | **Hingga tanggal acara + 7 hari** | Diberi penanda `isExpired = true`, skor relevansi diset ke 0, dan dikeluarkan dari kartu agenda aktif. |
| **Artikel Noise / Ditolak** | **0 Hari** (tidak dibuatkan `MarketItem`) | Tetap tersimpan di tabel `Article` dengan status `discovered` agar URL tidak di-crawl ulang oleh mesin pengikis RSS. |

---

## 5. Deduplikasi Artikel dan Penanganan Data Sindikasi

1. **Deduplikasi Judul**:
   Sebelum artikel baru disimpan ke basis data, sistem membersihkan atribusi nama media (contoh: ` - Tribunnews.com`, ` - BantenNews.co.id`) dan menghitung koefisien kemiripan token kata (`titleSimilarity`). Jika kemiripan terhadap artikel yang sudah ada mencapai $\ge 75\%$, artikel dianggap duplikat sindikasi dan ditolak penyimpanannya dengan mencatat kenaikan counter `duplicate`.
2. **Prinsip Zero Data Loss**:
   Tidak ada operasi hard `DELETE` otomatis pada data produksi. Pengarsipan dilakukan secara lunak (`soft archiving`) melalui kolom `archivedAt`.
3. **Pembersihan Rutin Artikel Mentah**:
   Artikel mentah berstatus `discovered` yang berusia lebih dari 90 hari dan tidak lolos kurasi `MarketItem` dapat dibersihkan secara berkala melalui migrasi pemeliharaan khusus atas instruksi tertulis dari pemilik repositori.
