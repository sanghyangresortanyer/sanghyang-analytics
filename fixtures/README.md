# Fixture lokal

Data mentah dari VHP dan spreadsheet. Isinya tidak masuk Git.

## Susunan

```
fixtures/
  2026-11-01/
    revenue 01-11-2026.txt
    penjualan per artikel 01-11-2026.txt
  2026-11-02/
    ...
  arsip/        laporan lama yang mencakup beberapa hari, dan snapshot Google Sheets
  incoming/     tempat menaruh file baru (boleh juga langsung di fixtures/)
```

Satu folder per hari. Isinya laporan VHP untuk hari itu saja: revenue, penjualan per artikel, dan pembelian (`pembelian FOOD 01-11-2026.txt`, dst.).

## Menambah file

1. Ekspor dari VHP. VHP selalu menulis ke `C:\e1-vhp\Output File.txt` dan menimpanya tiap ekspor.
2. Jalankan `npm run sort-fixtures`. Skrip membaca jenis laporan dan tanggal di dalam file, lalu:
   - laporan satu hari masuk ke `YYYY-MM-DD/` dengan nama `<jenis> DD-MM-YYYY.txt`;
   - laporan beberapa hari masuk ke `arsip/YYYY-MM-DD_to_YYYY-MM-DD/`;
   - file yang sudah tersimpan tidak disalin dua kali; file berbeda dengan nama sama diberi akhiran ` (2)`.
   Pakai `--dry-run` untuk melihat rencananya dulu.

## Catatan

- `penjualan per artikel` 01–17 Nov dipecah per tanggal dari ekspor 1–18 Nov (`arsip/2026-11-01_to_2026-11-18/`). Kepala laporan disalin dan periodenya diganti ke tanggal itu; baris datanya tidak diubah. Tanggal 18 Nov tidak dipecah karena harinya belum selesai saat ekspor.
- Ekspor revenue VHP untuk satu hari berisi angka hari itu saja, baik di kolom harian maupun bulan berjalan (dicek 1–3 Nov 2026).
- Saat file disimpan lewat aplikasi, sesi dashboard dengan tanggal meeting atau periode yang sama diganti oleh sesi baru. Perapian folder ini terpisah dari penyimpanan di dashboard.
