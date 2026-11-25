# Sistem tampilan Sanghyang Analytics (Tampilan A)

Dokumen ini diserap dari desain antarmuka utama Tampilan A (pilihan pemilik 24 Nov 2026) dan menjadi acuan visual kanonis aplikasi tunggal **Sanghyang Analytics** (`sanghyang-analytics`, ADR-014).

## Arah visual

Tampilan A menggantikan tema krem/espresso lama. Dasbor dirancang sebagai ruang pengambilan keputusan cepat untuk staf dan manajemen hotel: satu kartu angka utama, satu kalimat temuan masalah disertai tombol aksi, dan kotak "Perlu Anda". Seluruh teks memakai bahasa sehari-hari yang mudah dipahami staf hotel, setiap angka menyertakan rentang tanggal, dan data kosong ditulis jujur sebagai "Belum ada data".

## Warna dan tipografi

- Kanvas abu terang, kartu putih lembut, rail navigasi dan tombol utama hitam. Nama token CSS dipertahankan (`navy` = hitam ke abu, `cream` = abu terang, `ember` = merah) agar seluruh halaman tetap konsisten.
- `lemon` (`#D5F34D`) khusus untuk sorotan penting (angka utama, pilihan aktif, garis "Data s.d."), selalu dipasangkan dengan teks atau tepi gelap agar kontras tetap tinggi.
- Indikator arah: naik memakai `naik` (`#14532D`, hijau tua), turun memakai `turun` (`#C62F1D`), tanpa pembanding memakai `netral` (`#3A4047`). Perubahan selalu disertai kata atau segitiga, tidak mengandalkan warna saja.
- Tipografi memakai system stack Segoe UI dengan angka tabular (`tabular-nums`): angka utama 48 px tipis, judul kartu 18 px, isi 14-16 px.

## Grafik utama

- Tiga bentuk tampilan: Batang (bawaan), Titik, dan Outlet. Agregasi harian hingga 62 hari, selebihnya per minggu.
- Satu hari dibandingkan terhadap hari yang sama pada pekan sebelumnya; pekan yang terpotong tidak dibandingkan. Hari tanpa data dibiarkan kosong, bukan diisi 0.
- Bentuk Outlet memakai skala masing-masing dengan keterangan yang selalu terlihat.

## Tata letak Ringkasan

- Urutan blok: kartu Total revenue + grafik utama, Revenue per outlet + kotak Perlu Anda, empat metrik rantai pasok (permintaan belanja DML, pembelian VHP, stok inventory, pemakaian), lalu cincin Target bulanan.
- Pembanding kartu dan outlet memakai periode sama panjang tepat sebelumnya dengan rentang tanggal yang selalu ditulis jelas.
- Navigasi bagian dasbor berada di sisi kiri pada layar lebar dan di bawah pada layar ponsel (0 px horizontal overflow pada 1440 px dan 390 px).
- Kartu Stok Inventory global memakai total snapshot VHP dari periode meeting; bila berkas Inventory VHP belum diunggah, tampilkan status tidak tersedia sedangkan nilai HK tetap pada rincian Inventory HK.
- Kartu Pembelian VHP menampilkan rentang tanggal yang sama dengan kartu Revenue periode.
- Cincin target berdiameter 104 px dengan nama outlet, capaian terhadap target, dan sisa persentase sebagai teks utama.
- Selector cetak menggunakan `#analytics-report` dan `#analytics-outlet-report`.
- Sumber dan rumus data tidak boleh diubah demi tampilan; data yang belum tersedia selalu ditandai jujur sebagai "Belum ada data".
