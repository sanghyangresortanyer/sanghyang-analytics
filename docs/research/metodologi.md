# Metodologi Riset Intelijen Pasar & Glosarium · Sanghyang News

Dokumen ini memaparkan metodologi analitis, batasan geografis, segmentasi klaster pembanding, formula perhitungan metrik, serta glosarium istilah domain yang diterapkan pada sistem Sanghyang News.

---

## 1. Definisi Geografis & Batasan Wilayah

Riset intelijen pasar Sanghyang News dibatasi secara terukur pada koridor pariwisata pantai Anyer hingga Carita, Provinsi Banten:
- **Titik Acuan**: Sanghyang Indah Spa Resort, Jalan Raya Anyer KM 129, Cikoneng, Anyer, Banten.
- **Radius Wilayah Riset**: Maksimal **25 km jarak tempuh jalan raya** (*driving distance*).
- **Kriteria Kelayakan Properti Pembanding**:
  - Berupa hotel berbintang, resort tepi pantai, atau akomodasi liburan keluarga dengan fasilitas setara.
  - Memiliki amenitas penunjang seperti restoran, kolam renang, area pantai, atau layanan spa.
  - Terverifikasi beroperasi aktif dan melayani tamu komersial.
- **Kriteria Pengecualian**:
  - Warung makan non-hotel atau pedagang kaki lima tanpa entitas legal/amenitas pariwisata standar.
  - Properti yang telah berhenti beroperasi secara permanen (misalnya Patra Anyer Beach Resort ditandai pensiun dan dikecualikan dari jadwal observasi aktif).

---

## 2. Segmentasi & Klasterisasi Pembanding (Compset)

Berdasarkan registri basis data tunggal (tabel `Competitor`), pembanding dikelompokkan ke dalam dua klaster utama:

### Klaster I: Resort Koridor Anyer Utama
Merupakan pesaing langsung (*direct compset*) yang berlokasi berdampingan di sepanjang koridor pantai Anyer:
1. **Mambruk Hotel & Convention Anyer**
2. **Aston Anyer Beach Hotel** (termasuk unit Aquavillas)
3. **The Jayakarta Anyer Beach Resorts**
4. **Marbella Hotel Convention & Spa Anyer**
5. **Hawaii Resort Family Suites**
6. **Mutiara Carita Cottages**

### Klaster II: Resort Mewah & Bintang Lima Banten
Merupakan pembanding aspirasional dan tolok ukur standar layanan premium di Banten:
1. **Novus Jiva Anyer Villa, Resort & Spa**
2. **Mövenpick Resort Anyer**

---

## 3. Formula & Metrik Analisis Pasar

Seluruh metrik yang ditampilkan dalam sistem wajib mematuhi **Invarian Empat Nol (Zero Mock Data)**. Tidak ada angka omset pesaing atau pangsa pasar fiktif yang ditanam di dalam kode program.

### 3.1 Tarif Kamar Terendah Teramati (Lowest Observed Rate)
Tarif harian tipe kamar paling terjangkau yang teramati pada platform publik (Google Travel / OTA) untuk tanggal menginap tertentu:
$$\text{Tarif Terendah} = \min(\{P_{h, t, 1}, P_{h, t, 2}, \dots, P_{h, t, n}\})$$
di mana $P_{h, t, i}$ adalah harga yang teramati untuk hotel $h$ pada tanggal menginap $t$ dari kanal $i$.

### 3.2 Median Tarif Pasar
Digunakan untuk mengukur harga pasar wajar tanpa terdistorsi oleh lonjakan harga kamar suite mewah atau kamar promo ekstrem:
$$\text{Median Pasar} = \text{median}(\{P_{1}, P_{2}, \dots, P_{m}\})$$
untuk seluruh hotel aktif dalam compset pada tanggal yang sama.

### 3.3 Agregasi Skor Sentimen Kata Tamu
Sentimen dihitung secara dinamis dari ulasan riil yang tersimpan di basis data (`CompetitorReview`):
- Diklasifikasikan berdasarkan kategori unit bisnis (Kamar, Restoran, Beach Club, Spa, dsb).
- Menghitung rasio sentimen positif, netral, dan keluhan operasional berdasarkan kata kunci pengalaman tamu nyata.
- Ulasan tanpa tanggal atau tanpa teks tidak diikutsertakan dalam pembobotan sentimen.

### 3.4 Estimasi Makro Pasar (Bila Data Nyata Terbatas)
Jika estimasi potensi pasar diperlukan, sistem dilarang mengarang angka omset pesaing. Proyeksi hanya boleh menggunakan data resmi BPS Provinsi Banten:
$$\text{Estimasi Keterisian Kamar Koridor} = \text{Total Kapasitas Kamar Compset} \times \text{TPK BPS Banten}$$
Setiap visualisasi yang menggunakan perhitungan ini **WAJIB** mencantumkan label:
> *"Perkiraan Kasar: Berdasarkan publikasi Tingkat Penghunian Kamar (TPK) BPS Provinsi Banten."*

---

## 4. Evaluasi 6 Unit Bisnis Resort

Aplikasi menyelaraskan analisis pasar terhadap enam unit bisnis Sanghyang Indah Spa Resort:
1. **Kamar & Resort**: Tolok ukur tarif menginap, okupansi akhir pekan, kenyamanan kamar, dan kebersihan.
2. **Sunset Grill**: Restoran tepi pantai dengan fokus menu hidangan laut dan suasana matahari terbenam.
3. **Dragon Beach Club**: Hiburan tepi pantai, suasana musik, dan paket acara akhir pekan.
4. **D'Bistro**: Restoran kasual untuk sarapan pagi dan santapan keluarga sepanjang hari.
5. **D'Bar & Karaoke**: Fasilitas hiburan malam dan lounge santai.
6. **D'Spa & Hot Spring**: Layanan relaksasi unggulan dengan kolam air panas alami dan terapi aquamedic.

---

## 5. Glosarium Istilah Domain

- **Compset (Competitive Set)**: Sekelompok hotel dan resort pembanding utama yang bersaing langsung memperebutkan segmen tamu dan wisatawan yang sama di wilayah Anyer.
- **ADR (Average Daily Rate)**: Rata-rata pendapatan sewa per kamar yang terjual dalam suatu periode waktu.
- **RevPAR (Revenue Per Available Room)**: Total pendapatan kamar dibagi dengan jumlah total kamar yang tersedia untuk disewakan.
- **TPK (Tingkat Penghunian Kamar / Occupancy Rate)**: Persentase jumlah malam kamar yang dihuni terhadap jumlah malam kamar yang tersedia (dirilis secara berkala oleh BPS).
- **OCC (Optimistic Concurrency Control)**: Mekanisme integritas basis data menggunakan kolom versi (`version`) untuk mendeteksi dan mencegah konflik penulisan konkuren secara atomik.
- **Zero Mock Data**: Prinsip mutlak di mana sistem tidak pernah menampilkan data sintetis, angka tebakan, atau narasi ulasan buatan; seluruh metrik harus terlacak ke baris observasi atau masukan staf.
- **Observasi**: Satu unit data mentah yang berhasil dikumpulkan dari kanal publik lengkap dengan stempel waktu (`capturedAt`), URL bukti (`sourceUrl`), dan pengenal unik.
- **ScrapeRun**: Catatan riwayat eksekusi pekerjaan pengumpulan data yang mendokumentasikan waktu mulai, waktu selesai, jumlah data ditemukan, dan jumlah galat.
- **Rapat Senin**: Rapat koordinasi evaluasi mingguan antara manajemen dan tim pemasaran Sanghyang Resort untuk merumuskan aksi operasional berdasarkan data pasar terkini.
