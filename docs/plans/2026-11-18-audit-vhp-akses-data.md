# Audit aplikasi VHP: bisakah data diambil otomatis? (18 Nov 2026)

Audit baca-saja pada komputer operasional. Tidak ada koneksi yang dibuka ke server VHP, tidak ada data yang diubah, dan nilai kredensial pada berkas konfigurasi tidak dibaca keluar.

## Temuan

| Bagian | Isi | Bukti |
|---|---|---|
| Aplikasi | Klien Progress OpenEdge 10.2B (`C:\OpenEdge\bin\prowin32.exe`), program VHP berupa 3.910 berkas `.r` di `C:\e1-vhp\vhplib` | `C:\OpenEdge\version`, isi folder |
| Pintasan "VHP Live Cloud" | `prowin32.exe -pf config\vhpLIVE.pf -ini config\vhp10.ini ...` | target pintasan |
| Letak data hotel | `RemoteLocal=Remote; AppSHost=54.151.254.231; AppSPort=3101`: data ada di AppServer milik vendor di cloud, bukan di laptop | `config\vhpLIVE.pf`, `config\vhpSANGHYANG.pf` |
| Database lokal | `C:\e1-vhp\localDB\vhp.db` (~22 MB) dijalankan `mprosrv-vhp.bat` di `localhost:2600`, hanya untuk sesi klien | `mprosrv-vhp.bat`, `vhp.st`, `vhp.lg` |
| Driver ODBC OpenEdge | Tidak terpasang (hanya driver Microsoft) | registry `ODBCINST.INI` |
| Ekspor Excel bawaan | `fo-excel\DRR-SHY.xls` (Daily Revenue Report) | isi folder |

## Kesimpulan

1. **Tidak dapat mengambil database hotel langsung.** Klien hanya memanggil prosedur bisnis pada AppServer vendor; tidak ada port database atau ODBC yang terbuka. Membongkar API privat vendor tanpa izin tidak dilakukan.
2. **Jalur resmi yang layak, urut prioritas:**
   - Meminta akses baca resmi ke vendor VHP (ODBC/SQL OpenEdge, API, atau ekspor terjadwal) untuk F/O Turnover, Journal by BillNo, dan Receiving.
   - Menggunakan ekspor bawaan VHP (`.txt` dan DRR Excel), lalu mengunggahnya lewat halaman `/upload-mingguan` Sanghyang Analytics dengan deteksi jenis laporan otomatis.
   - Memeriksa isi `DRR-SHY.xls` sebagai kandidat sumber revenue harian Front Office bila diperlukan.
