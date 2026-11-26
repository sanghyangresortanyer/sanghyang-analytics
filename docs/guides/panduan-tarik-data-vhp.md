# Panduan tarik data VHP untuk Sanghyang Analytics

Disalin dan disesuaikan 26 Nov 2026 dari salinan baca-saja `VRP/docs/.sumber/panduan-tarik-data-vhp.html` (versi 25 Nov 2026, sumber PDF "Panduan Tarik Data VRP"; salinan lokalnya ada di `docs/panduan/` dan `docs/.sumber/`, keduanya tidak ikut git). Nama aplikasi diganti Sanghyang Analytics. Yang berubah sesudah konsolidasi ADR-014: isian chat closing CS diganti impor berkas BOOKING BY WA, tiga sheet gudang (Main Store, Beverages, Engineering) sudah dikenali aplikasi, dan menu "Laporan Resort" ikut membaca data VHP. Langkah di VHP sendiri tidak berubah.

## 1. Asal semua data

| Sumber | Dipakai untuk | Cara masuk ke aplikasi |
| :--- | :--- | :--- |
| VHP, 4 laporan | Revenue, menu terjual, kamar, OCC, ARR, pembelian | Diunggah staf di menu "Upload Data" seminggu sekali dan di awal bulan (bagian 2 sampai 6) |
| Google Sheets HK dan DML | Stok Housekeeping dan permintaan belanja harian outlet | Otomatis setiap Senin 01.00 WIB, atau tombol "Tarik Data Sekarang" di menu "Data Google Sheets" (bagian 7) |
| Google Sheets Main Store, Beverages (tab LH), Engineering | Stok dan pemakaian gudang selain Housekeeping | Sama dengan HK, setelah ID sheet-nya diisi di pengaturan lingkungan aplikasi (backlog P10 GS-1) |
| Google Ads | Biaya, klik, chat, telepon, rute Maps, sisa saldo iklan | Otomatis saat halaman Marketing dibuka (bagian 8) |
| Google Analytics | Pengunjung situs, klik WA dan telepon, booking situs | Otomatis saat halaman Marketing dibuka (bagian 8) |
| Instagram, 2 akun | Postingan dan Audit Promo | Postingan otomatis; Audit Promo lewat tombol "Tarik data" (bagian 8) |
| CS | Booking yang datang dari WhatsApp | CS mengimpor berkas BOOKING BY WA di kotak "Booking WA" di atas laporan Google Ads (bagian 8) |
| Pengaturan | Target outlet, budget divisi, jenis kamar, aturan menu | Diisi admin di menu "Pengaturan" |

## 2. Laporan VHP yang ditarik dan alasannya

- Seminggu sekali (misalnya Senin pagi): tanggal 1 bulan ini sampai kemarin. Angkanya masih sementara.
- Tanggal 1 sampai 5: bulan lalu lengkap. Ini angka resmi dan menggantikan yang sementara.
- Keempat laporan selalu ditarik bersama dengan tanggal yang sama.

| Laporan | Isinya | Alasan dibutuhkan |
| :--- | :--- | :--- |
| Laporan revenue (judul di berkas: F/O Turnover Report by Department) | Total pendapatan setiap departemen: Front Office, d'Bistro, Sunset Grill, d'Bar, Spa, dan lainnya | Angka resmi resort, dipakai sebagai patokan revenue di dasbor |
| Penjualan per Artikel (judul di berkas: Restaurant Transaction Journal) | Setiap menu yang terjual di kasir outlet, lengkap dengan tanggal, jumlah porsi, dan nomor bon | Laporan revenue tidak memuat nama menu. Laporan ini dipakai untuk menu terlaris, menu tidak laku, jumlah porsi, dan pemisahan diskon d'Bar & Karaoke dengan DBC per nomor bon |
| F/O Journal (judul di berkas: F/O Journal Transaction) | Semua yang dicatat Front Office per tanggal: harga kamar, extra bed, serta sarapan dan welcome drink dari paket kamar | Melengkapi Penjualan per Artikel (bagian 5) supaya revenue terlihat per tanggal; sumber kamar terjual, OCC, ARR, dan revenue WALK IN, FIT, serta OTA |
| Pembelian (judul di berkas: Receiving List by all suppliers) | Barang yang diterima dari supplier: tanggal, harga, jumlah, dan nilai | Total belanja, daftar supplier, dan perbandingan belanja dengan revenue |

## 3. Aturan umum

- Jangan menarik tanggal hari ini. Data satu hari baru lengkap setelah VHP menutup hari itu pada malam hari, jadi selalu tarik sampai tanggal kemarin.
- Pastikan tanggal terakhir sudah tutup hari di VHP: room revenue (Lodging) tanggal itu tidak boleh 0.
- Selalu tarik ulang dari tanggal 1. Data lama di tanggal yang sama otomatis diganti, jadi tidak dobel. Penerimaan barang kadang baru diinput beberapa hari kemudian.
- F/O Journal harus memuat harga kamar: cari baris Lodging atau Room Charge. Bila tidak ada, berkas terpotong atau terfilter; tarik ulang sebelum mengunggah.
- Semua data VHP hanya masuk lewat halaman "Upload Data". Data VHP tidak pernah dimasukkan lewat skrip atau SQL.
- Setiap ekspor VHP menimpa berkas sebelumnya (`Output File.txt`). Unggah berkas itu, atau simpan dengan nama lain, sebelum mengekspor laporan berikutnya.
- Nama berkas bebas. Aplikasi membaca jenis laporan dan tanggalnya dari isi berkas.
- Jangan mengubah isi berkas. Unggah apa adanya dari VHP.

## 4. Langkah per laporan

### 4.1 Laporan revenue

- Menu di VHP: di layar awal VHP klik ikon F/O Cashier (ikon oranye, kedua dari kiri di deretan ikon kanan), lalu menu Accounting, lalu F/O Turnover Report by Department.
- Isian: From Date tanggal 1, To Date kemarin (awal bulan: tanggal 1 sampai akhir bulan lalu); From Dept 00 sampai To Dept 20 (Front Office sampai Laundry); kotak Disp Total of Each VAT dan Disp Quantity dibiarkan kosong.
- Tampilkan: klik tombol centang hijau di kiri atas. Tabel terisi dan baris terakhirnya GRAND TOTAL.
- Simpan ke berkas: klik ikon printer di sebelah kanan centang hijau, pilih 99 Output File di jendela Select printer, lalu OK. Berkas tersimpan sebagai `C:\e1-vhp\Output File.txt`.
- Cek hasil: baris judul di berkas berbunyi F/O Turnover Report by Department.

### 4.2 Penjualan per Artikel

- Menu di VHP: layar awal VHP, menu FB-Reports (baris menu paling atas), lalu Booking Journal by Article. Jangan memilih "Booking Journal by BillNo".
- Isian: From Art 0 sampai To Art 9999999; From Dept 1 sampai To Dept 20 (d'Bistro sampai Laundry); pilih Excl Transfer; OD-Taker dibiarkan kosong.
- Tampilkan dan simpan: klik centang hijau, lalu ikon printer, pilih 99 Output File, lalu OK.
- Periode: tanggal 1 sampai kemarin; di awal bulan, tanggal 1 sampai akhir bulan lalu.
- Cek hasil: baris judul di berkas berbunyi Restaurant Transaction Journal, dengan kolom terakhir F/O Artikel.

### 4.3 F/O Journal

- Menu di VHP: ikon F/O Cashier, menu Accounting, F/O Journal Lists, lalu Booking Journal by Article.
- Isian: artikel 1 sampai 9999, departemen 0 sampai 99, pilih Excl Transfer.
- Periode: tanggal 1 sampai kemarin; di awal bulan, tanggal 1 sampai akhir bulan lalu.
- Cek hasil: baris judul di berkas berbunyi F/O Journal Transaction, dan ada baris harga kamar (Lodging).

### 4.4 Pembelian

- Menu di VHP: modul Inventory (Stock Accounting), List, Incoming List, lalu Receiving Report by Suppliers.
- Isian: Main group 1 sampai 9 (semua kelompok barang).
- Tampilkan dan simpan: klik centang hijau, lalu ikon printer, pilih 99 Output File, lalu OK.
- Periode: tanggal 1 sampai kemarin; di awal bulan, tanggal 1 sampai akhir bulan lalu.
- Cek hasil: baris judul di berkas berbunyi Receiving List by all suppliers. Tulisan Article's Main Group: FOOD di bagian atas selalu muncul dan tidak apa-apa; isi berkas tetap memuat semua kelompok barang.

## 5. Alasan revenue butuh lebih dari satu laporan

Laporan revenue memberi total per departemen, tetapi tidak menunjukkan menu. Penjualan per Artikel menunjukkan menu, tetapi hanya berisi transaksi kasir outlet. Rincian per tanggal berasal dari dua laporan sekaligus:

| Laporan | Isi per tanggal |
| :--- | :--- |
| F/O Journal | Revenue Front Office (kamar, extra bed) serta sarapan dan welcome drink paket kamar |
| Penjualan per Artikel | Penjualan kasir semua outlet (d'Bistro, Sunset Grill, d'Bar, Spa, dan lainnya) |
| Jumlah keduanya | Sama dengan laporan revenue, untuk setiap outlet dan setiap tanggal |

Tanpa F/O Journal, revenue hanya terlihat totalnya, dan kamar terjual, OCC, serta ARR tidak bisa dihitung.

Sarapan dan welcome drink untuk tamu paket kamar tidak lewat kasir outlet. Tamu membeli kamar paket yang harganya sudah termasuk sarapan dan welcome drink. Front Office mencatat bagian sarapan ke d'Bistro dan bagian welcome drink ke Sunset Grill langsung di tagihan kamar, sedangkan kasir d'Bistro hanya menerima kupon yang tidak dihitung sebagai penjualan. Akibatnya sarapan dan welcome drink paket muncul di laporan revenue dan F/O Journal, tetapi tidak di Penjualan per Artikel.

Contoh: kamar 119, tamu Trip.com, 1 November 2026, paket untuk 2 orang. Sarapan Rp200.000 (Rp100.000 per orang) dicatat Front Office ke d'Bistro, dan welcome drink Rp2.000 (Rp1.000 per orang) dicatat ke Sunset Grill. Pengecekan 1–17 November 2026: Penjualan per Artikel ditambah F/O Journal sama dengan laporan revenue untuk setiap outlet dan setiap hari, selisihnya Rp0. Selisih d'Bistro Rp12.800.000 dan Sunset Grill Rp774.000 seluruhnya berasal dari paket kamar tersebut.

### Cara aplikasi menghitung OCC dan ARR

| Angka | Rumus (sumber: F/O Journal) |
| :--- | :--- |
| Kamar terjual | Jumlah kamar yang punya tagihan harga kamar (Lodging) pada malam itu |
| OCC | Kamar terjual dibagi 61 kamar |
| ARR | Harga kamar ditambah sarapan dan minuman paket, dibagi kamar terjual. Extra bed, early check-in, late check-out, gas, dekorasi, dan no show tidak ikut |

- Dasbor (Revenue, Front Office, Kamar) dan "Laporan Resort": semua tamu digabung, sama seperti laporan di grup WA.
- Laporan Google Ads: hanya WALK IN, FIT, dan OTA; perusahaan dan rombongan tidak termasuk.
- Tangkapan layar grup WA hanya dipakai untuk mencocokkan, tidak dimasukkan ke aplikasi.
- OCC malam yang akan datang belum ditampilkan (keputusan pemilik 25 Nov 2026).

## 6. Cara mengunggah

1. Buka Sanghyang Analytics, lalu pilih menu "Upload Data".
2. Di bagian "Pilih file dari VHP", pilih semua berkas sekaligus (boleh banyak tanggal dan banyak jenis laporan).
3. Periksa tabel yang muncul. Setiap baris adalah satu periode, dengan kolom Revenue, Penjualan, F/O Journal, dan Pembelian yang menandai laporan yang terbaca.
4. Klik tombol "Simpan … periode", lalu tunggu sampai semua baris berstatus tersimpan.
5. Buka "Dashboard". Spanduk di bagian atas menunjukkan data yang masih kurang atau hari yang belum ditutup.

## 7. Data dari Google Sheets

Sebagian data tidak ada di VHP, jadi diambil dari Google Sheets yang diisi staf setiap hari. Staf tetap mengisi Google Sheets seperti biasa. Aplikasi hanya membaca sheet itu dan tidak pernah mengubah isinya; tautan sheet cukup berakses Pelihat.

| Sheet | Isinya | Alasan dibutuhkan | Status 26 Nov 2026 |
| :--- | :--- | :--- | :--- |
| HK (Daily Opname Housekeeping) | Stok barang Housekeeping: stok awal, barang masuk, barang keluar per tanggal, dan dipakai di mana | VHP tidak mencatat pemakaian harian per kamar atau lokasi | Tersambung |
| DML (Daily Market List) | Permintaan belanja harian setiap outlet (Main Kitchen, Bistro, Sunset Grill, Housekeeping, Engineering, dan lainnya) | Menunjukkan apa yang diminta, untuk dibandingkan dengan Pembelian VHP (apa yang diterima) | Tersambung; daftar mulai 1 Nov setelah pengaturan tanggal awal diubah (P10 DML-1) |
| Main Store | Tab "Sheet1" berisi stok harian dengan pola HK; tab harga VHP | Gudang pusat: pemakaian per bagian diambil dari barang keluar Main Store | Dikenali aplikasi; menunggu ID sheet di pengaturan lingkungan (P10 GS-1) |
| Engineering | Tab "Sheet1" berisi stok harian dengan pola HK; tanpa tab harga, jadi memakai harga VHP dari sheet Main Store | Stok dan pemakaian Engineering | Dikenali aplikasi; menunggu ID sheet (P10 GS-1) |
| Beverages | Tab "LH" (gudang minuman): barang masuk dan kiriman ke BAR, DBC, SG, dan Bistro per hari | Stok minuman; tab DBC, Dbar, dan SG belum terisi | Dikenali aplikasi; menunggu ID sheet (P10 GS-1) |
| FB | Stok bahan makanan | Pembelian makanan basah belum tercatat di sheet mana pun | Menunggu tautan (P10 GS-3) |

Aturan mengisi sheet HK:
- Setiap bulan buat tab baru dengan nama bulannya, contoh Nov 2026. Tab bulan berikutnya dibuat sebelum tanggal 1.
- Jangan mengubah urutan atau judul kolom: No Art, Description, Unit, Content, Stock Awal, IN, Out, Stock Akhir, lalu untuk setiap tanggal In, Out, dan Digunakan (Di mana).
- Isi kolom "Di mana" setiap ada barang keluar (nomor kamar atau nama lokasi). Bila kosong, pemakaian tercatat sebagai "Lokasi tidak diisi" dan tidak bisa dilihat per lokasi. Bila satu barang dipakai di dua lokasi, tulis keduanya dengan tanda &, contoh SRD & BC; jumlahnya dibagi rata.
- Isi nomor barang (No Art) sesuai kode VHP. Harga barang diambil dari tab harga (daftar stok barang dari VHP) dan dicocokkan lewat nomor ini.

Aturan mengisi sheet DML:
- Satu tab untuk satu tanggal, dinamai dengan tanggalnya, contoh 15-11-26.
- Setiap outlet punya bagian sendiri: baris nama outlet, baris judul kolom (No Art, Description, D-Unit, Price, SOH, Qty Req, Total, Pembelanjaan), daftar barang, lalu baris subtotal.
- Jangan mengubah judul kolom, dan isi No Art sesuai kode VHP supaya bisa dicocokkan dengan Pembelian.

Cara data sheet masuk ke aplikasi:
- Otomatis setiap Senin pukul 01.00 WIB. Tarikan harian sudah disiapkan tetapi ditahan pemilik (P10 GS-4).
- Kapan saja: buka menu "Data Google Sheets", lalu klik "Tarik Data Sekarang" (sekitar 20 detik).
- Waktu tarikan terakhir terlihat di halaman itu.

## 8. Data Marketing

| Data | Dilihat di | Yang perlu dilakukan |
| :--- | :--- | :--- |
| Google Ads dan Google Analytics | Marketing > Google Ads: laporan per hari, minggu, bulan, atau tanggal pilihan | Tidak ada. Data dibaca langsung dari Google dan disimpan sementara 10 menit. Aplikasi hanya membaca, tidak mengubah iklan |
| Booking dari WhatsApp | Kotak "Booking WA" di atas laporan Google Ads | CS mengimpor berkas BOOKING BY WA.xlsx (tombol "Import"). Booking dihitung menurut tanggal check-in dan revenue kamarnya diambil dari VHP. Nama dan nomor WA tamu tidak disimpan. Lonceng notifikasi mengingatkan bila impor terakhir lebih dari 7 hari |
| Postingan Instagram | Marketing > Sosmed Sanghyang > Postingan & Reels IG | Tidak ada. 25 postingan terbaru dari @sanghyangresort dan @sunsetgrillsanghyang; Story tidak ikut |
| Audit Promo | Marketing > Sosmed Sanghyang > Audit Promo Outlet | Tekan "Tarik data". Promo dibaca dari teks postingan, lalu dicocokkan dengan penjualan menu di VHP |
| Tamu resort di laporan iklan | Laporan Google Ads bagian 5 | Unggah data VHP. Laporan memakai hari yang sudah ada di VHP pada kedua periode |

Belum tersambung: Meta Ads, TikTok, Google Business Profile, Exely, dan akun Instagram outlet lainnya (backlog P10 kelompok 4.4 dan GA-8).

## 9. Ringkasan rutinitas

| Kapan | Siapa | Yang dilakukan |
| :--- | :--- | :--- |
| Seminggu sekali (Senin pagi) | Penarik data VHP | Tarik 4 laporan VHP tanggal 1 sampai kemarin, lalu unggah. Angkanya masih sementara |
| Tanggal 1 sampai 5 | Penarik data VHP | Tarik 4 laporan VHP bulan lalu lengkap, lalu unggah. Ini angka resmi yang menggantikan angka sementara |
| Seminggu sekali | CS | Impor berkas BOOKING BY WA di kotak "Booking WA" |
| Setelah ada promo baru | Marketing | Tekan "Tarik data" di Audit Promo Outlet |
| Setiap hari | Staf outlet dan gudang | Isi Google Sheets HK, DML, dan sheet gudang seperti biasa, termasuk kolom "Di mana" |
| Otomatis | Aplikasi | Google Sheets setiap Senin 01.00 WIB; Google Ads, Google Analytics, dan Instagram saat halaman dibuka |
