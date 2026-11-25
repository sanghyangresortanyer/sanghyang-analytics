# Panduan Staf Windows · Sanghyang News

Panduan operasional harian dasbor web Sanghyang News untuk tim pemasaran dan manajemen Sanghyang Indah Spa Resort Anyer pada sistem operasi Windows.

---

## 1. Mengakses Aplikasi Web

Aplikasi berjalan terpusat di cloud sehingga staf tidak perlu memasang Node.js atau menjalankan server lokal di komputer kerja:
1. Buka peramban Google Chrome (atau peramban berbasis Chromium seperti Microsoft Edge).
2. Kunjungi alamat dasbor produksi:
   ```
   https://sanghyang-news.vercel.app
   ```
3. Simpan alamat tersebut sebagai *bookmark* peramban untuk akses harian.

---

## 2. Masuk ke Aplikasi (Login)

1. Saat pertama kali membuka rute yang dilindungi, Anda diarahkan ke halaman masuk (`/login`).
2. Masukkan kata sandi resmi aplikasi.
   > **Catatan Keamanan:** Kata sandi tidak dicantumkan di dalam dokumen ini maupun berkas teks terbuka. Tanyakan kata sandi resmi kepada Manajer Pemasaran atau Administrator Sistem.
3. Sesi masuk tersimpan aman melalui cookie peramban.

---

## 3. Memasang Ekstensi Chrome Sanghyang Market Sync

Untuk menyegarkan data Instagram dan TikTok langsung dari sesi peramban Anda (sekali saja per komputer atau saat ada versi ekstensi baru):
1. Pastikan Anda sudah masuk (*login*) secara normal ke Instagram (`https://www.instagram.com`) dan TikTok (`https://www.tiktok.com`) di peramban Chrome yang sama.
2. Di dasbor `https://sanghyang-news.vercel.app`, buka halaman `/market-intelligence` atau `/marketing-sosmed`, lalu klik tombol **Unduh Ekstensi (.zip)** (mengunduh arsip dari `/api/admin/social-extension/download`).
3. Klik kanan berkas `sanghyang-social-sync-v1.0.0.zip` yang terunduh -> pilih **Extract All...**, lalu tunggu hingga folder `sanghyang-social-sync` muncul.
4. Buka tab baru di Chrome, ketik `chrome://extensions`, lalu aktifkan sakelar **Mode developer / Developer mode** di pojok kanan atas.
5. Klik **Muat yang belum dibuka / Load unpacked**, lalu pilih folder `sanghyang-social-sync` yang langsung berisi `manifest.json`.
6. Kembali ke tab dasbor Sanghyang News dan klik **Cek Ulang** atau muat ulang halaman. Rincian penggunaan lintas OS tersedia di [Panduan Ekstensi Chrome Media Sosial](panduan-ekstensi-sosmed.md).

---

## 4. Alur Kerja Mingguan (Persiapan Rapat Senin)

Aplikasi mendukung evaluasi mingguan performa resort dan enam unit bisnis:
- **Newsletter Berita & Pasar**: Periksa kurasi berita industri pariwisata Banten dan Anyer melalui alur `/`, `/review`, dan `/preview`, lalu ekspor ke format PDF.
- **Insight Pasar & Outlet** (`/market-intelligence`): Tinjau 6 unit bisnis (Kamar & Resort, Sunset Grill, Dragon Beach Club, D'Bistro, D'Bar & Karaoke, dan D'Spa & Hot Spring) dengan urutan baca baku:
  1. *Tujuan*: Target dan fokus outlet minggu ini.
  2. *Kata Tamu*: Ulasan terbaru tamu hotel, outlet, dan komentar sosmed anonim.
  3. *Pesaing*: Kondisi pesaing di koridor Anyer (radius 25 km).
  4. *Harga*: Perbandingan tarif kamar dan menu.
  5. *Promo & Event*: Aktivitas promosi dan acara pesaing yang berlangsung.
  6. *Langkah Minggu Ini*: Rencana tindakan konkret.
  Gunakan tombol **Perbarui Semua Data** di bagian atas halaman bila perlu menyegarkan data pasar dan antrean ekstensi sosmed.
- **Untuk Direksi** (`/direksi`) & **Knowledge Graph** (`/knowledge-graph`): Tinjau evaluasi harga kamar/menu serta peta relasi data pasar.
- **Media Sosial** (`/marketing-sosmed`): Klik **Sinkron Sosmed via Chrome** untuk memperbarui postingan resmi Sanghyang serta metrik tayang, atau catat postingan baru dan kolom Leads WA manual.
- **Omset, Target dan Strategy** (`/admin/omset`): Masukkan realisasi omset bulanan outlet dan tinjau strategi tanggapan promo pesaing.

---

## 5. Penanganan Masalah Umum

- **Ekstensi tidak terdeteksi di dasbor**: Pastikan **Mode developer** di `chrome://extensions` aktif, ekstensi **Sanghyang Market Sync** berstatus menyala (*enabled*), dan folder yang dipilih langsung berisi `manifest.json` (bukan folder pembungkus di atasnya). Bila baru saja ada pembaruan aplikasi, unduh ulang `.zip` terbaru lalu klik tombol muat ulang pada kartu ekstensi.
- **Instagram meminta login ulang atau TikTok memunculkan CAPTCHA**: Biarkan ekstensi berhenti otomatis dan membuka tab media sosial ke depan, selesaikan login atau geser teka-teki langsung di tab Chrome tersebut, lalu klik **Sudah Selesai Login / CAPTCHA · Lanjutkan** di dasbor atau popup ekstensi.
- **Data tarif atau ulasan belum terbaru**: Klik **Perbarui Semua Data** pada halaman `/market-intelligence` dan tunggu proses selesai.
- **Sesi keluar sendiri**: Masuk kembali menggunakan kata sandi resmi melalui halaman `/login`.
