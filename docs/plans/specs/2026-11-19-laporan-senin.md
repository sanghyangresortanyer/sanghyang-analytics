# Rancangan: Laporan Senin (iklan vs hasil di VHP)

Tanggal: 2026-11-19 · Status: Diserap ke Sanghyang Analytics (ADR-014) · Modul: Marketing (`/marketing/laporan`)

## Alasan

Setiap Senin manajemen mengevaluasi efektivitas iklan terhadap hasil akhir hotel. Biaya dan kontak iklan tersedia dari Google Ads API, sedangkan realisasi kamar per segmen tamu tersedia dari F/O Journal VHP. Keduanya perlu disajikan berdampingan dalam satu laporan mingguan yang dapat dicetak PDF.

## Tujuan

- Satu halaman per minggu (Senin-Minggu selesai): biaya Google Ads dan kontak dari iklan berdampingan dengan revenue kamar per segmen dari VHP.
- Perbandingan terhadap minggu sebelumnya dan rata-rata mingguan sejak 1 Januari 2026.
- Dapat diunduh sebagai PDF dari halaman laporan Google Ads (`/marketing/laporan`).

## Bukan tujuan

- Mengklaim hubungan sebab-akibat mutlak iklan terhadap tamu tertentu karena VHP hanya mencatat kode segmen.
- Otomasi Meta Ads (akun utama yang dievaluasi adalah Google Ads; angka sosmed organik dipantau terpisah).

## Yang harus dihindari

- Menulis "iklan menghasilkan Rp X" seolah pasti; gunakan istilah "petunjuk" karena faktor musim dan hari libur ikut berpengaruh.
- Menampilkan revenue minggu yang data VHP-nya belum masuk sebagai Rp 0; selalu tampilkan keterangan "data VHP belum lengkap s.d. tgl ...".

## Batasan

- Revenue menggunakan angka laporan revenue VHP (kotor), konsisten dengan dasbor utama.
- Akses Google Ads pada laporan ini bersifat baca-saja.

## Pendekatan terpilih

Menambahkan bagian **"Hasil di VHP"** ke laporan mingguan Google Ads di **Sanghyang Analytics** (`/marketing/laporan`), memanfaatkan pemilihan periode, pembanding minggu lalu, dan cetak PDF yang sudah ada serta membaca RPC `room_revenue_by_segment` dari database Sanghyang Analytics (schema `public`).

## Perilaku dan data

| Baris | Sumber |
| :--- | :--- |
| Revenue kamar FIT (tamu langsung: WA, telepon, website) | F/O Journal VHP, segmen FIT |
| Revenue kamar WALK IN | Segmen WALK IN |
| Revenue kamar FIT-TA (OTA/agen), FIT-CORP, GIT-CORP | Segmen pembanding |
| Malam kamar FIT dan rata-rata harga per malam | Lodging di F/O Journal VHP |
| Total revenue hotel minggu itu | Ringkasan harian dasbor |
| Biaya Google Ads / revenue kamar FIT | Hitungan rasio; "—" bila revenue FIT 0 |

Keadaan gagal:
- Tanggal terakhir data VHP lebih awal dari akhir minggu: tampilkan peringatan di atas bagian dan tandai baris VHP sebagai "belum lengkap".
- Google Ads gagal dibaca: bagian Google menampilkan pesan galat jujur, bagian VHP tetap tampil.

## Keamanan

Rute laporan dilindungi autentikasi tunggal `marketingAccess()` (sesi Supabase Auth + `MARKETING_PROPERTY_ID`) dan membaca RPC `room_revenue_by_segment` dengan RLS per properti.

## Keputusan pemilik

| Tanggal | Keputusan |
| :--- | :--- |
| 2026-11-18 | Kode segmen VHP yang ada cukup; iklan Google mengarah ke WA/website masuk segmen FIT |
| 2026-11-24 | Evaluasi kenaikan iklan menggunakan revenue kamar (Lodging) segmen FIT dan WALK IN dengan OTA sebagai pembanding, bukan total revenue hotel |
