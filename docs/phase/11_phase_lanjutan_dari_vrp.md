# Phase 10: Pekerjaan lanjutan dari VRP

Status: **Belum mulai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-014, ADR-004

Dihimpun 26 Nov 2026 dari salinan baca-saja `VRP/` (repo `monauli/VRP`, cabang `main`, commit lokal terakhir `c64196a`): `TODO.md` (commit `6993b9a`, 26 Nov 11.31), `HANDOFF.md` (berkas kerja, entri 25 Nov 23.51 sampai 26 Nov 11.31), `PROJECT-STATUS.md` (13 Nov), `docs/plans/`, `docs/marketing/`, dan `docs/.sumber/`. Setiap butir dicek ke kode Sanghyang Analytics pada hari yang sama (`src/`, `supabase/`, `vercel.json`, `next.config.ts`, dan nama kunci env tanpa mencetak rahasianya), ditambah temuan auditor kode dan auditor basis data swarm P9. Butir yang sudah selesai, sudah diporting, atau sudah digantikan tidak dimasukkan; daftarnya ada di §9.

Cara membaca kolom **Sumber**: "TODO 38am" berarti butir 38am di `VRP/TODO.md` bagian "Ringkasan pekerjaan terbuka"; "TODO M2.9" berarti Milestone 2.9; "TODO B" berarti bagian B (iklan dan marketing); "TODO S3" berarti butir sosmed S3; "HANDOFF 26 Nov 11.31" berarti entri `VRP/HANDOFF.md` pada jam itu. Entri HANDOFF 26 Nov 03.03 ("sisa todo") terpotong di butir 6 dan sisa teksnya tidak tersimpan di mana pun; butir 1 sampai 5 sudah tercakup di bawah.

Arti kolom **Status**: **Belum mulai** (belum dikerjakan di mana pun), **Sebagian** (sebagian sudah ada di kode Sanghyang Analytics, sisanya disebut di butir), **Usulan** (rancangan ada, menunggu persetujuan pemilik), **Ditunda** (ditahan atas keputusan pemilik), **Pengingat** (tindakan bertanggal), **Belum terverifikasi** (perlu dicek sebelum dikerjakan).

## 1. Tujuan

Mencatat semua pekerjaan VRP yang belum selesai supaya pengembangan bisa berlanjut hanya di Sanghyang Analytics. Tiap butir menyebut sumbernya, status, yang ditunggu, dan siapa yang bertindak berikutnya.

## 2. Ruang lingkup

- Masuk: butir terbuka dari salinan `VRP/` yang belum ada di kode Sanghyang Analytics per 26 Nov 2026, ditambah temuan audit swarm P9 yang menunggu keputusan pemilik.
- Tidak masuk:
  - Pekerjaan P9 (audit konsolidasi, sinkron skema `0086..0088`, redesain login dan Media Sosial, rilis produksi), yang dicatat di [10](10_phase_audit_redesain_rilis.md).
  - Perubahan akun Google Ads atau Meta tanpa persetujuan pemilik per perubahan.
  - Penulisan data VHP selain lewat halaman unggah "Upload Data" (`/upload-mingguan`).

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 014 | Aplikasi tunggal Sanghyang Analytics, satu schema `public`, Supabase `omuqbpxierdlfjascngz` | Semua butir dikerjakan di `src/` dan `supabase/migrations/`, tidak lagi di VRP |
| 004 | Perayapan patuh; jalur publik tanpa login dipisah dari OAuth akun sendiri | Kelompok Meta, TikTok, dan Google Business Profile memakai API resmi akun Sanghyang sendiri |

## 4. Langkah kerja

### 4.1 Google Sheets (gudang dan HK)

| ID | Butir | Sumber | Status | Menunggu | Siapa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GS-1 | Isi `GOOGLE_SHEET_MAIN_ID`, `GOOGLE_SHEET_BEV_ID`, dan `GOOGLE_SHEET_ENG_ID` di `.env.development.local`, `.env.local`, dan Vercel. Kode tiga gudang sudah diporting (`src/lib/sheets/store-sheets.ts` sama dengan VRP, migrasi `0088_sheet_stores.sql`), Per 26 Nov 2026 ketiga kunci terisi di `.env.local`, `.env.development.local`, dan env Vercel produksi (bertipe sensitive), migrasi `0088` sudah di produksi, dan deploy `cd29795` sudah memuatnya. Tinggal tarikan pertama ketiga gudang (Tarik Data Sekarang di `/data-sheets` atau cron Senin 01.00 WIB). | commit VRP `882b153`; HANDOFF 26 Nov 11.04; ROLLOUT Tambahan 26 Nov §3 | Sebagian | Tarikan pertama tiga gudang di produksi | Pemilik |
| GS-2 | Ubah akses tautan keempat berkas sheet dari Editor ke Pelihat; aplikasi hanya perlu membaca. | HANDOFF 26 Nov 11.02; TODO 38am | Belum mulai | Tidak ada | Pemilik |
| GS-3 | Kirim tautan berkas "Daily Opname FB November 26.xlsx". Pembelian makanan VHP 1–24 Nov senilai Rp57,1 jt (ayam, ikan, daging, buah, sayur, susu, frozen, kue) tidak tercatat di sheet mana pun, dan sumber FB belum ada di kode. | HANDOFF 26 Nov 11.19; TODO 38an, A.98 | Belum mulai | Tautan berkas FB | Pemilik dan tim FB |
| GS-4 | Tarik Google Sheets setiap hari 01.00 WIB (`0 18 * * *`). Pemilik menahannya; `vercel.json` tetap mingguan Senin 01.00 WIB (`0 18 * * 0`). Tarikan mingguan mengambil draf DML yang masih diedit tim (DML 22-11 berubah lagi sesudah ditarik 23 Nov). | TODO 38ah, 38ag, 38am; commit VRP `72b9ad0`; auditor kode 26 Nov | Ditunda | Keputusan pemilik | Pemilik |
| GS-5 | Ganti akses tautan publik dengan akun layanan (service account), lalu tutup akses publik sheet. | TODO A.11, M2.2 | Belum mulai | Akun layanan dari pemilik | Pemilik, lalu agen |
| GS-6 | Buat tab "Des 2026" di sheet HK sebelum 1 Des 2026, karena sheet HK dibaca per tab bulan. | TODO 38ae | Pengingat | Tidak ada | Tim HK |
| GS-7 | Tetapkan aturan barang yang tercatat di dua sheet: Main Store dan Beverages LH (23 minuman, Rp20,2 jt di Main Store), HK dan Engineering (7 barang), Main Store dan Engineering (2 barang). Main Store ke HK sudah dijawab: barang dipindah, bukan dobel, dan `src/lib/dashboard/store-inventory.ts` tidak menghitung kirimannya sebagai pemakaian. | TODO 38an, 38ao; HANDOFF 26 Nov 11.31 | Sebagian | Aturan dari pemilik dan tim | Pemilik dan tim gudang |
| GS-8 | Tampilkan peringatan "dikirim Main Store dibanding diterima HK". Contoh 26 Nov: Shower Cap 500 lawan 200, Sanitary Bag 400 lawan 200, sandal 800 lawan 446 pasang, air mineral 1.536 lawan 816, gas 12 kg 20 lawan 0 tabung. Belum dibangun di VRP maupun di sini. | TODO 38ao | Usulan | Persetujuan pemilik | Agen |
| GS-9 | Rapikan isi sheet: 136 dari 207 pengeluaran HK tanpa "Di mana" (26 Nov), stok Sanitary Bag dan Shower Cap minus 58, 27 barang HK dan 27 barang Main Store tanpa stok awal, 23 dari 55 pengeluaran Engineering tanpa tujuan, stok awal "Lem Taco" 46.024 pcs (salah ketik, sekitar Rp37 miliar, kini dikeluarkan kode dari total), 87 dari 93 barang Beverages tanpa stok awal. | TODO 38ae, 38am; commit VRP `c64196a` | Belum mulai | Tidak ada | Tim HK, Main Store, Engineering, Beverages lewat pemilik |
| GS-10 | Susun daftar "Yang perlu dilengkapi" dan kamus ejaan supplier serta lokasi (kicen, kichen, kcen; scrty, scurty, scry; grdr, gardnr; "Kitcheb" dan "Kitchen"). | HANDOFF 26 Nov 03.03 no. 3; TODO 38am; [audit alur data](../plans/2026-11-18-audit-alur-data.md) Tahap B | Usulan | Persetujuan pemilik | Agen |
| GS-11 | Tanyakan ke tim arti kolom IN di sheet HK (barang HK yang dibeli di VHP jarang sama dengan IN sheet) dan daftar permintaan d'Bar/DBC, Spa, Front Office, kantor, serta Souvenir yang tidak punya bagian di DML. | HANDOFF 26 Nov 03.03 no. 5; TODO 38ae | Belum mulai | Jawaban tim | Pemilik |
| GS-12 | Tab DBC, Dbar, dan SG di sheet Beverages kosong bulan ini; dipakai sebagai stok per outlet bila sudah diisi. | HANDOFF 26 Nov 11.04; TODO 38am | Ditunda | Tim mengisi tab | Tim Beverages |

### 4.2 DML (permintaan belanja outlet)

| ID | Butir | Sumber | Status | Menunggu | Siapa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| DML-1 | DML mulai 1 Nov disetujui pemilik ("tgl 1 nov masuk juga"). `DML_MIN_LIST_DATE` sudah `2026-11-01` di `.env.development.local`, `.env.local`, dan env Vercel produksi, dan deploy `cd29795` sudah memuatnya (26 Nov 2026). Bila tidak diubah, tarikan berikutnya membuang daftar 1 Nov (Rp58,9 jt). ROLLOUT §3 Tambahan 26 Nov sudah dikoreksi. | HANDOFF 26 Nov 11.31; TODO 38ao, 38ae | Sebagian | Ubah env lokal dan Vercel sebelum tarikan produksi pertama | Pemilik atau koordinator |
| DML-2 | Cocokkan DML (diminta) dengan Pembelian VHP (diterima) per kode barang: jumlah, harga, dan barang tanpa DML. Temuan awal: Rp67,4 jt dari Rp199,8 jt pembelian 1–24 Nov tidak punya kode di 4 daftar DML November (minuman 2201 Rp21,3 jt, teknik Rp40,8 jt); tab Realisasi DML berhenti Jan 2026. | TODO A.9, M2.9, 38ae; HANDOFF 26 Nov 03.03 no. 4 | Usulan | GS-1, GS-3, DML-1, persetujuan pemilik | Agen |
| DML-3 | Tambahkan langkah "Barang masuk (IN sheet)" di Ringkasan dasbor, lalu tinjau tampilan dan alur kerja secara menyeluruh. | TODO A.9, M2.9 | Ditunda | Data lengkap (keputusan pemilik) | Agen |

### 4.3 Google Ads

| ID | Butir | Sumber | Status | Menunggu | Siapa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GA-1 | Anggaran harian MONTHLY PROMO dinaikkan dari Rp92.000 ke Rp110.000 (25 Nov 22.4x, izin pemilik). Rabu 2 Des: baca hasil 1 minggu, tanyakan naik ke Rp120.000. Rabu 9 Des: putuskan setelah 2 minggu (chat, telepon, dan WA per minggu dibanding 16–22 Nov: 17, 14, 5; WALK IN dan FIT dibanding OTA); bila kontak tidak naik, kembali ke Rp92.000. Kedua pengingat hanya ada di TODO VRP, belum ada di `docs/marketing/reminders.json` yang dibaca halaman Marketing; usulan isinya di §5. | TODO 38ak; commit VRP `6efae3c` | Pengingat | 2 dan 9 Des 2026 | Agen (baca-saja), pemilik memutuskan |
| GA-2 | Isi saldo iklan Google sebelum ±28 Nov. Saldo 25 Nov 21.46 Rp1.217.204, rata-rata biaya ±Rp234 rb per hari, perkiraan habis sekitar 30 Nov. | TODO 38ak, 38ag, 38u | Pengingat | Tidak ada | Pemilik |
| GA-3 | Cek berkala baca-saja: ±28 Nov baca ulang istilah penelusuran 2 minggu dan tambah kata negatif; Senin 30 Nov cek mingguan; 1 Des bandingkan Local 24–30 Nov dengan 16–22 Nov (patokan Rp798.994, 167 klik, 96 rute, 2 chat, 2 telepon); ±6 Des nilai perubahan nilai konversi 22 Nov dan putuskan butir E (Booking menjadi konversi sekunder); 8 Des nilai kenaikan Local 24 Nov–7 Des dengan revenue dan malam kamar WALK IN di VHP. | TODO B, M3.2, 38s | Pengingat | Tanggal masing-masing | Agen, pemilik |
| GA-4 | Usulan yang menunggu keputusan pemilik per perubahan: (a) pisahkan pencarian merek "sanghyang", yang menyerap 56% biaya istilah MONTHLY PROMO 12–25 Nov (Rp568.888 dari Rp1.021.417), sementara grup iklan "Merek" tidak punya iklan; (b) MONTHLY PROMO menawar ke "Booking" (event GA4, bukan booking nyata) dan "Klik untuk menelepon" tidak ikut; (c) halaman tujuan khusus Anyer untuk kata kunci umum (skor kualitas 1–3); (d) 47 kata kunci luas; (e) judul iklan usang "Liburan Lebaran" dan "march is Holiday" (prioritas rendah); (f) strategi Leads/Booking; (g) rekomendasi Google menaikkan Local ke Rp480 rb per hari, saran agen: jangan; (h) uji naik anggaran Local 2 minggu sambil memantau WALK IN. | TODO B, M3.2, 38ak, 38s | Usulan | Keputusan pemilik | Pemilik |
| GA-5 | Pelacakan chat WA dari iklan: (a) teks WA berpenanda per sumber dan FO atau CS mencatat sumber; (b) situs menyimpan gclid, kodenya ditaruh di teks wa.me, lalu diunggah sebagai konversi luring; (c) google/wci dengan WhatsApp Business Platform Cloud API. Termasuk tombol WA sanghyang.com berpenanda "(web)" dan nilai rupiah untuk kontak nyata dengan unggahan booking luring bulanan. | TODO B, M3.2 | Usulan | Keputusan pemilik | Pemilik |
| GA-6 | Bukti dampak iklan dari tamu: FO atau CS mencatat asal tamu di VHP (Reservation Source, laporan di F/O Reception > Statistics) atau hitungan CS; tanyakan ke FO jumlah tamu walk-in per bulan dan yang tahu dari Google Maps; uji anggaran naik turun per kampanye. | TODO A.40, M3.2 | Usulan | Keputusan pemilik dan FO | Pemilik, FO |
| GA-7 | Bedah dan perbaiki laporan Google Ads bersama pemilik: definisi kontak, rute dibanding booking, rentang tanggal, dan pencocokan dengan VHP. | TODO 28j, 30 | Belum mulai | Jadwal dengan pemilik | Agen, pemilik |
| GA-8 | Exely: ekspor Sep–Nov 2026, cocokkan purchase GA4 dengan booking website Exely November (awal Des), audit beberapa bulan per sumber (Ads, GA4, booking Exely), dan telusuri alur booking tanpa membayar. Unggah Exely ke aplikasi ditunda sejak 20 Nov. | TODO A.12, M2.10 no. 14, M3.2 | Ditunda | Ekspor Exely dari pemilik | Pemilik, agen |

### 4.4 Meta dan Instagram

| ID | Butir | Sumber | Status | Menunggu | Siapa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| MI-1 | Sambungkan 4 akun Instagram lain ke portofolio bisnis Meta "Sanghyang Indah Spa Resort": @dbistro.anyer, @dragonbeachclub, d'Spa, dan @sunset_grillsanghyang lama. Nama akun d'Spa tertulis @dspagsanghyang di daftar akun dan @dspasanghyang2 di catatan 24 Nov, jadi perlu dipastikan. Yang sudah tersambung: @sanghyangresort dan @sunsetgrillsanghyang. Langkahnya ada di Panduan Sambung Meta Bagian 1 (salinan lokal di `docs/panduan/`). | TODO 28f, 30, S2 | Belum mulai | Admin halaman Facebook | Pemilik |
| MI-2 | Halaman pengaturan sosmed dan iklan: akun sosmed per outlet, pemetaan kata kunci menu kasir VHP untuk Audit Promo, dan draf iklan otomatis. `src/app/(app)/pengaturan/` belum punya halaman ini. | TODO 28i | Belum mulai | Tidak ada | Agen |
| MI-3 | Perbaikan Audit Promo: kamus kata (Crab menjadi Kepiting), kelompok menu (dessert, cocktail, semua treatment), menu yang tidak pernah terjual di kasir masih dilewati, Story tidak ikut, foto tidak dibaca; pilihan jendela 7 atau 14 hari menunggu jawaban pemilik. | TODO 34, 38af | Usulan | Jawaban pemilik | Agen |
| MI-4 | Sheet "Promo November & Data akun" tab "promo konten": tautan lengkap belum ada, kolom LINK KONTENNYA kosong, dan arti kolom G bertanda X belum jelas. | TODO 28b, 28c, 23 | Belum mulai | Tautan dan isian tim digital marketing | Pemilik, tim digital marketing |
| MI-5 | Iklan Meta lewat Marketing API: baca biaya dan hasil. Tab "Meta Ads" di Marketing masih "Belum ada data". Perubahan iklan hanya usulan yang dijalankan sesudah persetujuan pemilik per perubahan. | TODO S3 | Belum mulai | Akun iklan Meta | Pemilik, agen |
| MI-6 | TikTok Business dan iklan TikTok lewat API resmi; aplikasi developer perlu disetujui TikTok. | TODO S4 | Belum mulai | Akun TikTok Business | Pemilik |
| MI-7 | Google Business Profile API: pengajuan izin ke Google; Sunset Grill butuh akses pemilik utama. | TODO S5 | Belum mulai | Izin Google | Pemilik |
| MI-8 | Kalender promo: rencana dari tab "promo konten" berdampingan dengan posting yang benar-benar tayang per akun. | TODO S6 | Belum mulai | MI-4 | Agen |

### 4.5 VHP

| ID | Butir | Sumber | Status | Menunggu | Siapa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| VHP-1 | Unggahan rutin lewat "Upload Data": mingguan sementara (tanggal 1 sampai kemarin) dan bulanan resmi (tanggal 1–5, bulan lalu lengkap). Berikutnya: November lengkap paling lambat 5 Des. Caranya di [panduan tarik data VHP](../guides/panduan-tarik-data-vhp.md). | TODO A.18 | Pengingat | Tidak ada | Penarik data VHP |
| VHP-2 | Pastikan unggahan yang masuk ke VRP sesudah salinan data konsolidasi ikut ada di produksi baru: VHP 1–24 Nov (25 Nov 12.52), unggah ulang Penjualan per Artikel bernomor bon (25 Nov 16.59), dan impor BOOKING BY WA berisi 29 booking (25 Nov sekitar 15.20). Bila belum ada, unggah ulang lewat halaman "Upload Data" dan formulir "Booking WA", bukan lewat skrip. | TODO 38n, 38aa, 38v; ADR-014 | Belum terverifikasi | Pemeriksaan data produksi di P9 | Auditor basis data, pemilik |
| VHP-3 | Sesudah migrasi `0087` di produksi, unggah ulang Penjualan per Artikel bulan berjalan dan bulan pembandingnya supaya diskon dan compliment d'Bar & Karaoke dibanding DBC terbagi per nomor bon. Jan–Okt tetap "belum dibagi" sampai diunggah ulang (belum diminta pemilik); periksa nama supplier Jan–Sep sebelum mengunggah ulang Pembelian. | TODO 38aa; auditor kode 26 Nov; ROLLOUT Tambahan 26 Nov §4 | Belum mulai | Migrasi `0087` di produksi | Penarik data VHP, pemilik |
| VHP-4 | Setelah VHP sampai 30 Nov atau 1 Des masuk, cocokkan perkiraan OCC 25 Nov–1 Des (13, 14, 20, 45, 19, 15, 13 kamar) dengan kamar sebenarnya. Disampaikan lewat chat; teks aplikasi tidak diubah. | TODO 38z | Pengingat | Data VHP sampai 1 Des | Agen, pemilik |
| VHP-5 | OCC malam yang akan datang: perkiraan rata-rata 4 minggu ada di kode (`OccupancyForecast`) tetapi tidak ditampilkan atas keputusan pemilik 25 Nov (`src/components/dashboard/skeuo-dashboard.tsx:518`). Sumber resminya laporan VHP "Forecast of Room Occupancy" yang belum ditarik. | TODO 38j, 38q, 38y | Ditunda | Keputusan pemilik atau berkas Forecast VHP | Pemilik |
| VHP-6 | Asal tamu (kota atau alamat saat check-in) dari laporan tamu VHP, karena Exely tidak menyimpan kota (94% kosong). Bedah baca-saja bersama pemilik; hasilnya juga dipakai untuk lokasi target iklan. | TODO A.5, A.29, M2.10 no. 14 | Belum mulai | Pemilik menarik laporan tamu VHP | Pemilik, agen |
| VHP-7 | Promo kamar dan outlet di VHP: Room Revenue Breakdown (Argt RO, RB, RBW, OUT; RCode TA), menu promo, voucher, dan birthday. Bedah baca-saja. | TODO A.8, M2.9 | Belum mulai | Tidak ada | Agen, pemilik |
| VHP-8 | Akses baca resmi dari vendor VHP atau ekspor terjadwal supaya data tidak diekspor manual; kirim contoh DRR ke vendor. Alat audit layar VHP dijeda 19 Nov dan butuh izin vendor serta daftar tombol terlarang. | TODO A.12, M2.8, M2.9, M2.10 no. 5 | Ditunda | Keputusan pemilik dan vendor | Pemilik |
| VHP-9 | Analisa menu lanjutan: Menu Engineering VHP (laku dikali untung; laporan "Menu Price and Cost" dan "FB Sales and Cost"), pisahkan menu paket atau promo dari daftar menu tidak laku, dan kaitkan dengan kalender promo (MI-8). | TODO M2.9, M2.10 no. 9 | Belum mulai | Tidak ada | Agen |
| VHP-10 | d'Bar mencatat Rp0 pada 1, 3, 12, dan 17 Nov: konfirmasi ke outlet apakah tutup. | TODO M2.9 | Belum mulai | Jawaban outlet | Pemilik |

### 4.6 Pendaftaran pengguna dan keamanan

| ID | Butir | Sumber | Status | Menunggu | Siapa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| USR-1 | Pendaftaran publik Supabase (temuan TINGGI). Trigger `handle_new_auth_user` (`supabase/migrations/0000_core_foundation.sql:76-101`) menjadikan setiap akun baru staf aktif. `enable_signup = false` di `supabase/config.toml` hanya berlaku untuk Supabase lokal; diperiksa 26 Nov 2026 lewat `GET /auth/v1/settings` produksi `omuqbpxierdlfjascngz`: `disable_signup: false` dengan provider email aktif, jadi pendaftaran publik masih terbuka (konfirmasi email tetap wajib). Akun yang terdaftar sendiri langsung menjadi staf aktif dan bisa membaca data properti lewat API Supabase. Pembuatan pengguna lewat Pengaturan memakai `auth.admin.createUser`, jadi tidak terpengaruh. | TODO 38ac, 38ad, 38af | Belum mulai | Pemilik membuka pengaturan Authentication Supabase | Pemilik |
| USR-2 | Buat pengguna `kukuh` lewat Pengaturan > Buat User (oleh pemilik sendiri), sekaligus menguji USR-1. | TODO M1.4, A.12, 38ad | Belum mulai | USR-1 | Pemilik |
| USR-3 | Daftar nama pengguna tampil di halaman login (pilihan "Pilih user…", temuan RENDAH). Putuskan dipertahankan atau tidak saat redesain login P9. | TODO 38ac | Usulan | Redesain login P9 | Pemilik |
| USR-4 | Header keamanan dari `VRP/next.config.ts` (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`) belum ada di `next.config.ts`. | TODO 38ad; ROLLOUT Tambahan 26 Nov §6 | Belum mulai | Izin perubahan konfigurasi | Agen |
| USR-5 | 22 tabel operasional lama di produksi memberi role `anon` hak tabel penuh lewat hak bawaan skema (`ALTER DEFAULT PRIVILEGES`); yang menahan baris hanya RLS. Usulan: migrasi yang mencabut hak itu (`REVOKE`) dari `anon`. | auditor basis data 26 Nov | Usulan | Keputusan pemilik | Pemilik, lalu agen |

### 4.7 Lainnya

| ID | Butir | Sumber | Status | Menunggu | Siapa |
| :--- | :--- | :--- | :--- | :--- | :--- |
| LN-1 | Sinyal akuisisi WA di `src/lib/analytics/internal-signals.ts` (baris 348 dan 722) masih membaca `whatsapp_chat_counts`, padahal masukan CS sudah diganti impor BOOKING BY WA (`wa_bookings`) sejak 25 Nov. | auditor kode 26 Nov; TODO 38q | Usulan | Keputusan pemilik soal sumber sinyal | Pemilik, lalu agen |
| LN-2 | Isi budget per divisi dan target outlet di Pengaturan (target outlet masih bawaan). Pemilik meminta ini dikerjakan paling akhir. | TODO A.99, 38ac | Ditunda | Tidak ada | Pemilik |
| LN-3 | Satu PDF "sumber data": tiap angka di aplikasi berasal dari laporan atau sheet mana. | TODO 38af | Belum mulai | Kelompok 4.1 selesai | Agen |
| LN-4 | Halaman rencana dibanding realisasi per divisi seperti contoh auditor (berkas Financial Forecast: budget divisi, forecast, arus kas, kinerja per divisi). Berkas contoh berisi saldo bank dan tidak boleh disalin ke repo. | TODO M2.9 | Usulan | Rancangan disetujui pemilik | Pemilik, agen |
| LN-5 | Baca berkas mutasi bank otomatis dengan OCR; parsernya belum ada. | TODO A.12, M2.1; PROJECT-STATUS 13 Nov | Ditunda | Permintaan pemilik | Agen |
| LN-6 | Periksa dalam keadaan login fitur yang di VRP masih tertulis menunggu dicek pemilik: lonceng notifikasi, Revenue (bento, menu tidak laku, PDF per outlet), Laporan Google Ads bagian 5, Laporan Resort, dan impor BOOKING BY WA. Di sini dilakukan sesudah rilis P9. | TODO 38j, 38l, 38q, 50 | Belum mulai | Rilis P9 | Pemilik |
| LN-7 | Kuota AI: di Free tier, model yang lebih kuat (Gemini 4 Hydrogen, 3.8 Flash, 3.6 Flash) hanya 20 permintaan per hari, sedangkan refresh harian butuh sekitar 50-150 panggilan; per 26 Nov 2026 aplikasi memakai `gemini-3.5-flash-lite` (500 per hari, 15 per menit) dengan thinking `high`. Bila ingin model yang lebih kuat, perlu tier berbayar (Tier 1, AI Studio > Set up billing) lalu cukup mengganti `PRIMARY_MODEL` dan `PRIMARY_THINKING_LEVEL` di env. | AI Studio Rate Limit 26 Nov 2026; `src/lib/gemini.ts` | Sebagian | Keputusan pemilik soal tier berbayar | Pemilik |
| LN-8 | Pemuat tarif booking engine resmi untuk kompetitor selain Nemuru. Engine yang perlu diperiksa: situs Marbella (`marbellaplaceanyer.com`), Jayakarta (`booking.jayakartahotelsresorts.com`), dan Aston. Sampai pemuatnya ada, kolom situs resmi hotel itu tertulis "belum tercatat", tidak memakai harga riset tanpa tanggal. | Audit pemilik 27 Nov 2026; `src/lib/market/competitor-official-rates.ts` | Belum mulai | Pemeriksaan robots.txt dan cara kerja tiap engine | Agen |
| LN-9 | Perluasan Knowledge Graph dengan data operasional hasil konsolidasi VRP, tanpa nominal rupiah (ADR-014): menu terlaris dan menu mati per outlet, tipe kamar terjual dan segmen tamu, hasil tiap promo, kampanye iklan, serta Purchase dan Inventory, dan hubungannya dengan data pasar. | Permintaan pemilik 27 Nov 2026 | Berjalan | Tidak ada | Agen |

## 5. Tanggal yang harus diingat

| Tanggal | Butir | Siapa |
| :--- | :--- | :--- |
| ±28 Nov 2026 | GA-2 isi saldo iklan; GA-3 istilah penelusuran 2 minggu | Pemilik; agen |
| 30 Nov 2026 | GA-3 cek mingguan Google Ads | Agen |
| Sebelum 1 Des 2026 | GS-6 tab "Des 2026" di sheet HK | Tim HK |
| 1 Des 2026 | GA-3 perbandingan Local; VHP-4 cocokkan perkiraan OCC | Agen, pemilik |
| 2 Des 2026 | GA-1 baca hasil 1 minggu MONTHLY PROMO | Agen, pemilik |
| Paling lambat 5 Des 2026 | VHP-1 unggah November lengkap | Penarik data VHP |
| ±6 Des 2026 | GA-3 nilai perubahan nilai konversi dan butir E | Agen, pemilik |
| 8 Des 2026 | GA-3 kenaikan Local dibanding WALK IN | Agen |
| 9 Des 2026 | GA-1 putusan anggaran MONTHLY PROMO | Pemilik |

Usulan isi tambahan `docs/marketing/reminders.json` untuk GA-1, belum diterapkan karena berkas itu tampil di halaman Marketing dan isinya diputuskan pemilik:

```json
{ "date": "2026-12-02", "text": "Google Ads: anggaran MONTHLY PROMO Rp110.000 sejak 25 Nov. Baca hasil 1 minggu, lalu tanyakan ke pemilik apakah naik ke Rp120.000." },
{ "date": "2026-12-09", "text": "Google Ads: putuskan anggaran MONTHLY PROMO setelah 2 minggu. Bandingkan chat, telepon, dan WA per minggu dengan 16-22 Nov (17, 14, 5) serta revenue WALK IN + FIT dengan OTA. Bila kontak tidak naik, kembalikan ke Rp92.000." }
```

## 6. Berkas utama

- Google Sheets dan gudang: `src/lib/sheets/`, `src/lib/dashboard/store-inventory.ts`, `src/app/(app)/data-sheets/`, `vercel.json`, `.env.example`
- Marketing: `src/lib/marketing/`, `src/app/(app)/marketing/`, `docs/marketing/reminders.json`
- Sinyal internal: `src/lib/analytics/internal-signals.ts`
- Pengguna dan keamanan: `supabase/migrations/0000_core_foundation.sql`, `supabase/config.toml`, `next.config.ts`, `src/app/login/`
- Rilis: [ROLLOUT_PRODUKSI.md](../plans/ROLLOUT_PRODUKSI.md) bagian "Tambahan 26 Nov 2026"

## 7. Verifikasi

Perintah untuk mengecek ulang status butir sebelum dikerjakan (tidak mencetak rahasia):

```bash
grep -cE "^GOOGLE_SHEET_(MAIN|BEV|ENG)_ID=.+" .env.development.local   # GS-1: 3 bila sudah diisi
grep -E "^DML_MIN_LIST_DATE=" .env.development.local                    # DML-1: harus "2026-11-01"
grep -n '"schedule"' vercel.json                                        # GS-4: 0 18 * * 0 = mingguan
grep -n "X-Frame-Options" next.config.ts                                # USR-4: kosong = belum dipasang
grep -n "whatsapp_chat_counts" src/lib/analytics/internal-signals.ts    # LN-1
python3 .agents/scripts/brain.py phase --check
```

## 8. Kriteria keluar

- [ ] Setiap butir §4 selesai dengan bukti, dipindah ke fase lain, atau dibatalkan pemilik dengan alasan tercatat
- [ ] `python3 .agents/scripts/brain.py phase --check` tanpa galat
- [ ] Pemilik mengonfirmasi fase ditutup

## 9. Butir VRP yang tidak dibawa

| Butir di VRP | Alasan |
| :--- | :--- |
| Inventory Main Store, Engineering, dan Liquor "butuh link spreadsheet" (TODO A.98, M2.9) | Tautan sudah dibuka 26 Nov dan kode tiga gudang sudah diporting; sisa konfigurasi di GS-1, Food di GS-3 |
| Laporan memakai OCC dan ARR seperti grup WA; laporan Room Statistic dari IT (TODO 38, 38b) | Rumus terbukti (TODO 38c, 38d) dan sudah dibangun (TODO 38j, 38l, migrasi `0083`, `0084`); Room Statistic tidak diperlukan lagi |
| Audit Promo otomatis dari posting (TODO 23, 33) | Tombol "Tarik data" di Audit Promo Outlet (TODO 34, migrasi `0080`); sisa perbaikan di MI-3 |
| Daftar akun sosmed dan status (TODO S1) | Tab "Daftar Akun Sosmed" ada di Marketing > Sosmed Sanghyang |
| Tampilan login ikut Tampilan A (TODO 48) | Selesai di VRP (TODO 38q, 38w); redesain baru dikerjakan di P9 |
| Format Export PDF (TODO M2.9) | Digantikan laporan 1 halaman (TODO A.10) dan Laporan Resort |
| Tarik data VHP harian (TODO M2.10 no. 2) | Digantikan pola mingguan sementara dan bulanan resmi (TODO A.18), lihat VHP-1 |
| Jadwal C/D 22 Nov dan penilaian 23 Nov (TODO M3.2) | Dikerjakan 22–23 Nov (TODO B); butir E masuk GA-3 |
| Cek lokasi target iklan (TODO M3.2) | Diperiksa 25 Nov dan usulannya dicabut (TODO 38al) |
| Tab barang slow moving (TODO M2.9) | Digantikan "Menu paling tidak laku" (TODO 28e, 47) |
| Kunci Meta berizin penuh (TODO 31) | Keputusan pemilik: kunci dibiarkan; aplikasi hanya membaca dan dijaga tes |
| Gerbang 7–10, suite ulang Gate 1, selisih simpul Graphify, dan perapian dasbor 17 Nov (TODO M2.5, M2.6) | Pekerjaan VRP 17 Nov yang digantikan Tampilan A (TODO 42) dan gerbang mutu P8 |
| Insiden `vercel link` menimpa `.env.local`, pencatatan 40 berkas skill di hub, ide pembaruan skill REA (TODO M2.2, M1.9, M2.9) | Khusus mesin dan blueprint VRP, tidak berlaku di sini |
| Pemilik mengecek grafik tab Revenue (TODO M2.10 no. 1) | Digantikan iterasi tab Revenue 21–25 Nov (TODO 15, 47, 38x) |
