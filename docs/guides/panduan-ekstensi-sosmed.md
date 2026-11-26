# Panduan Ekstensi Chrome Sinkronisasi Media Sosial

Panduan pemasangan dan penggunaan ekstensi Chrome **Sanghyang Market Sync** (Manifest V3 unpacked, tanpa biaya Chrome Web Store) di komputer kerja **Ubuntu Linux** dan **Windows** untuk menyegarkan data Instagram serta TikTok pada dasbor Sanghyang News.

---

## 1. Persyaratan Awal

1. Google Chrome desktop (Ubuntu atau Windows) atau browser berbasis Chromium (mis. Microsoft Edge di Windows).
2. Sudah masuk (*login*) secara normal di peramban yang sama ke akun media sosial yang ingin dibaca:
   - Instagram (`https://www.instagram.com`)
   - TikTok (`https://www.tiktok.com`)
3. Sudah masuk ke dasbor Sanghyang Analytics (`https://analytics.sanghyang.com` atau `https://sanghyang-analytics.vercel.app` untuk produksi, atau `http://localhost:3001` untuk uji lokal).

---

## 2. Pemasangan Ekstensi (Sekali Saja per Komputer)

### Pilihan A: Unduh langsung dari dasbor
1. Masuk ke halaman `/market-intelligence` atau `/marketing-sosmed`.
2. Klik tombol **Unduh Ekstensi (.zip)** pada panel sinkronisasi media sosial.
3. Ekstrak berkas `.zip`:
   - **Ubuntu Linux**: klik kanan `sanghyang-social-sync-v1.0.0.zip` -> *Extract Here*, atau jalankan `unzip sanghyang-social-sync-v1.0.0.zip -d ~/sanghyang-ext`.
   - **Windows**: klik kanan `sanghyang-social-sync-v1.0.0.zip` -> *Extract All...*, tunggu sampai muncul folder `sanghyang-social-sync`.

### Pilihan B: Langsung dari folder repositori (khusus komputer pengembang lokal)
- Folder siap pakai tersedia di `extension/sanghyang-social-sync/` (di dalamnya langsung ada berkas `manifest.json`).

### Memuat Ekstensi ke Google Chrome (Ubuntu & Windows)
1. Buka tab baru di Chrome dan ketik `chrome://extensions`.
2. Aktifkan sakelar **Mode developer / Developer mode** di pojok kanan atas.
3. Klik tombol **Muat yang belum dibuka / Load unpacked**.
4. Pilih folder `sanghyang-social-sync` (pastikan folder tersebut langsung berisi `manifest.json`).
5. Pastikan ekstensi **Sanghyang Market Sync** tampil dalam keadaan aktif (*enabled*), lalu klik **Cek Ulang** atau muat ulang halaman dasbor Sanghyang News.

---

## 3. Cara Menyegarkan Data Media Sosial

1. Di `/market-intelligence`: klik **Perbarui Semua Data** -> konfirmasi, maka ekstensi berjalan otomatis bersama pembaruan data; atau klik **Sinkron Sosmed via Chrome** di Langkah 1 / Langkah 4.
2. Di `/marketing-sosmed`: klik **Sinkron Sosmed via Chrome** untuk memperbarui postingan resmi Sanghyang dan metrik tayang (`views`, `likes`, `comments`, `shares`). Kolom Leads WA tetap diisi manual agar tidak terisi angka palsu.

---

## 4. Menangani Login Ulang atau CAPTCHA (`SlardarWAF`)

Apabila Instagram meminta login ulang atau TikTok menampilkan teka-teki CAPTCHA/slider:
1. Ekstensi berhenti otomatis tanpa mencoba menembus verifikasi, lalu memunculkan tab media sosial bersangkutan ke depan.
2. Pengguna menyelesaikan login atau menggeser slider CAPTCHA langsung di tab Chrome tersebut hingga halaman akun atau video kembali terbuka normal.
3. Kembali ke dasbor (atau klik ikon ekstensi di bilah alat Chrome), lalu tekan tombol **Sudah Selesai Login / CAPTCHA · Lanjutkan**.
4. Antrean berlanjut dan menyimpan hasil terbaru ke basis data.
