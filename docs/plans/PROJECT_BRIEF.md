# Ringkasan proyek: Sanghyang News

Status: **Disetujui** (disetujui pemilik lewat prompt swarm 13 Nov 2026) · Dibuat 2026-11-13

## 1. Tujuan

- Masalah yang diselesaikan:
  - Sanghyang News adalah ruang kerja internal tim pemasaran dan manajemen Sanghyang Indah Spa Resort (Anyer, Banten) untuk evaluasi mingguan (Rapat Senin) dan penerbitan newsletter bulanan.
  - Berdasarkan audit menyeluruh 13 November 2026, sistem memiliki kerentanan isolasi lingkungan (akses langsung ke DB produksi), inkonsistensi data kompetitor (daftar tersebar di 6 tempat), data karangan/mock (omset, pangsa pasar, peringkat, sumber bukti fiktif), crawler rapuh dan belum patuh, navigasi UI terpecah (5 sidebar berbeda), serta minimnya artefak dokumentasi dan pengujian otomatis.
- Hasil yang diharapkan pemilik (terukur):
  - Isolasi lingkungan 100%: Basis data pengujian dan pengembangan beralih penuh ke PostgreSQL 17 lokal di Docker (`127.0.0.1:55432`) dengan pengaman tulis ke produksi (`lib/db.ts`).
  - Integritas data Zero Mock: Seluruh angka, peringkat, skor, ulasan, dan tarif bersumber dari observasi riil berprovenans (`sourceUrl`, `capturedAt`), masukan resmi pemilik, atau formula terdokumentasi (audit provenance: 0 pelanggaran).
  - Registri tunggal: Seluruh modul membaca daftar kompetitor dari tabel basis data tunggal ber-seed terverifikasi.
  - Satu AppShell terpadu: Navigasi seragam di semua rute dengan token desain Tailwind v4 dan tanpa emoji sebagai ikon.
  - Keamanan dan pengujian: Suite tes aman (`npm test`) tanpa memanggil produksi, Gemini API, atau jaringan luar; otentikasi sesi ber-HMAC aman.
- Yang bukan tujuan (di luar lingkup):
  - Memodifikasi atau menulis ke basis data Supabase produksi secara langsung (dikelola lewat `ROLLOUT_PRODUKSI.md` untuk dijalankan pemilik).
  - Menembus login, CAPTCHA, atau memotong perlindungan bot (Instagram, TikTok) melalui injeksi cookie atau metode tidak patuh.
  - Menghapus riwayat data atau tabel di produksi.
  - Membeli lisensi API pihak ketiga sebelum persetujuan anggaran dari pemilik.

## 2. Pengguna dan pemangku kepentingan

| Peran | Kebutuhan utama | Bahasa / perangkat |
| :--- | :--- | :--- |
| Tim Pemasaran Digital & Staf Resort | Kurasi berita newsletter, peninjauan ulasan tamu, pencatatan aktivitas media sosial, pemantauan promo pesaing | Bahasa Indonesia sederhana, desktop & mobile web |
| Manajemen Resort (GM & Kepala Outlet) | Evaluasi metrik mingguan Rapat Senin, analisis perbandingan kompetitor koridor Anyer–Carita, ekspor laporan PDF | Bahasa Indonesia sederhana, antarmuka padat informasi dan bebas jargon |
| Pemilik Proyek (Monauli) | Tata kelola kode, persetujuan perubahan arsitektur, verifikasi rencana peluncuran produksi, keamanan data | Windows, Node.js, otorisasi tunggal rilis produksi |

## 3. Batasan

- Anggaran dan layanan berbayar: Mengutamakan stack open-source dan kuota gratis tanpa penambahan biaya tak terencana.
- Kuota platform (menit CI, CPU hosting, email, API pihak ketiga):
  - Gemini API di `.env.local` digunakan bersama staf resort (~500 ringkasan/hari); dilarang keras pemanggilan massal otomatis atau untuk ekstraksi semantik graf.
  - Vercel hosting dan Supabase PostgreSQL 17 produksi dijaga dari mutasi tidak sah.
- Tenggat dan jendela rilis: Eksekusi swarm 13 November 2026; penerapan ke produksi dijadwalkan bertahap setelah pengujian lokal 100% lulus.
- Mesin kerja (RAM, OS) dan lingkungan yang tersedia: Mesin Linux RAM 14 GiB (maksimal 1 perintah berat sekaligus dibungkus `resource_guard.py`), operasi git dinonaktifkan (folder salinan repo).
- Akun, kepemilikan, dan siapa yang boleh menyentuh produksi: Hanya pemilik repo yang berhak melakukan migrasi dan deploy ke lingkungan produksi.

## 4. Data dan kepatuhan

- Data pribadi yang diproses: Ulasan publik dari Google Travel / Google Maps (nama pengulas dan konten ulasan publik); tidak ada data pelanggan privat yang disedot tanpa izin.
- Regulasi yang berlaku: Kepatuhan UU No. 27/2022 tentang Pelindungan Data Pribadi (UU PDP), prinsip Zero Mock, kepatuhan robots.txt dan ketentuan layanan platform perayapan.
- Sistem lama yang harus dipertahankan atau dimigrasikan: Modul newsletter bulanan (`/` → `/review` → `/preview` → ekspor PDF) yang sudah stabil dipertahankan perilakunya.

## 5. Integrasi

| Sistem | Arah data | Kepemilikan | Catatan kuota/akses |
| :--- | :--- | :--- | :--- |
| Google News RSS | Masuk (Inbound) | Publik | Ekstraksi berkala berita Anyer dan Banten |
| Google Travel / Maps | Masuk (Inbound) | Publik | Observasi tarif hotel dan ulasan publik tanpa login |
| Supabase PostgreSQL 17 | Dua arah | Internal Resort | Database produksi (baca-saja saat snapshot); dev memakai Docker lokal |
| Google Gemini API | Dua arah | Proyek Resort | Kuota bersama staf (~500 req/hari); dilarang memanggil massal |
| Puppeteer Chromium | Lokal | Internal | Render PDF dan E2E testing lokal |

## 6. Kriteria sukses

- [x] Kriteria fungsional: Seluruh 6 modul utama (Newsletter, Dasbor, Insight Pasar, Galeri Kompetitor, Media Sosial, Omset & Target) berfungsi normal berbasis DB lokal.
- [x] Kriteria mutu (kinerja, keamanan, aksesibilitas): `tsc --noEmit` 0 galat, ESLint 0 galat/peringatan, audit provenans 0 metrik tanpa sumber, p95 respons API < 1,5 detik, kontras WCAG AA.
- [x] Kriteria operasional (rilis, pemantauan, cadangan): Lingkungan dev mandiri di PostgreSQL Docker port 55432, pengaman tulis produksi aktif, dokumen rollout produksi siap pakai.

## 7. Keputusan pemilik yang masih terbuka

- Penetapan status final Allisa Resort Anyer dalam klaster kompetitor (Klaster I/II atau pensiun).
- Persetujuan pendaftaran dan biaya langganan API resmi (Google Business Profile API, Instagram Graph API, Google Places API).
- Jadwal pelaksanaan migrasi skema dan data ke database Supabase produksi.
- Input data riil pendapatan bulanan (omset) masing-masing outlet resort.
- Penyediaan kredensial API LLM mandiri untuk ekstraksi semantik graf pengetahuan.
