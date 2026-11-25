# Audit alur data dan rencana perbaikan Sanghyang Analytics (18 Nov 2026)

Catatan konsolidasi (ADR-014, 25 Nov 2026): dokumen audit historis ini diserap dari fase sebelum konsolidasi penuh **Sanghyang Analytics** (`sanghyang-analytics`). Tahap A penyimpanan baris harian VHP telah diimplementasikan melalui `weekly_sales_lines` dan `weekly_purchase_lines`.

Audit ini dibuat dari uji langsung di Chrome (localhost, sesi 01-17 Nov 2026), dari pembacaan kode, dan dari berkas ekspor VHP di `fixtures/`.

## 1. Cara kerja awal saat audit

```text
Upload mingguan (3 slot)                     Google Sheets (tarik mingguan, Senin 01.00 WIB)
  Revenue VHP  : F/O Turnover ATAU Journal     Inventory HK : stok per bulan + mutasi harian
  Pembelian VHP: Receiving List                DML          : permintaan belanja per outlet
  Inventory    : spreadsheet (opsional)
        |                                                |
        v                                                v
  Parser -> agregasi per SESI -> simpan TOTAL      sheet_hk_* , sheet_dml_* (per baris, bertanggal)
  weekly_meetings, weekly_outlet_metrics,
  weekly_purchase_suppliers/items, weekly_outlet_items
        |                                                |
        +--------------> Dashboard / Presentasi <--------+
```

Kelemahan utamanya saat audit: data VHP masih disimpan sebagai **total per sesi upload**, sedangkan data Google Sheets disimpan per baris bertanggal sehingga filter rentang tanggal tidak seragam.

## 2. Temuan utama

| # | Keluhan | Bukti | Akar masalah |
|---|---|---|---|
| 0 | Tampilan di produksi tertinggal | CSS produksi lama belum memuat token redesain terbaru di localhost | Perubahan UI lokal belum di-commit/deploy saat audit |
| 1 | Geser tanggal, angka tidak berubah | Rentang 01-10 Nov kosong | Filter rentang hanya membaca total sesi 01-17 Nov utuh |
| 2 | Top item per outlet seharusnya dari penjualan | Tab Revenue Front Office menampilkan kategori artikel F/O dengan qty 0 | F/O Turnover dan Journal tidak bisa diunggah bersama dalam satu slot |
| 3 | Stok inventory harus mencakup semua gudang | Kartu global kosong saat file Inventory VHP belum diunggah | Kartu global belum menjumlahkan HK dan gudang lain |
| 4 | Pemakaian inventory bukan hanya HK | Hanya mutasi keluar sheet HK yang tampil | Pemakaian gudang lain belum memiliki sumber laporan VHP |

Temuan tambahan:
- Pemakaian HK Rp 10,67 jt dari Rp 14,36 jt (74%) tidak memiliki lokasi tercatat dan penamaan lokasi belum seragam.
- Outlet DML (ENGINEERING, MAIN STORE, MAIN KITCHEN, HOUSEKEEPING) belum terhubung ke biaya departemen.
- Pembelian VHP (receiving) dan permintaan DML perlu dijelaskan dalam satu alur sebab-akibat.

## 3. Data yang tersedia di berkas impor VHP

| Berkas | Isi | Bisa dipecah per tanggal? | Item per outlet? |
|---|---|---|---|
| `Revenue1.txt` (F/O Turnover by Department) | Per departemen dan artikel: Day dan MTD | Hanya MTD | Kategori revenue |
| `Penjualan1.txt` (Rest. Transaction Journal) | 3.961 baris, 01-17 Nov, per bill | Ya | Ya: Sunset Grill, d'Bistro, d'Bar Karaoke, d'Spa |
| `Pembelian1.txt` (Receiving List) | Per baris: tanggal, supplier, artikel, qty, nilai | Ya | Per artikel dan supplier |
| `hk.xlsx` (Google Sheets) | Stok HK per bulan + mutasi harian dengan lokasi | Ya | Per lokasi |
| `dml.xlsx` (Google Sheets) | Permintaan belanja per outlet per tanggal daftar | Per tanggal daftar | Per outlet |

## 4. Rencana perbaikan bertahap

### Tahap A: Data harian (menjawab keluhan 1 dan 2)
1. Simpan baris mentah bertanggal (`weekly_sales_lines`, `weekly_purchase_lines`, F/O Journal) lewat `/upload-mingguan`.
2. Terima F/O Turnover sekaligus Journal pada unggahan mingguan.
3. Hitung dasbor dari baris harian; rentang di luar data yang tersedia ditandai jelas sebagai "Belum ada data", bukan diisi 0.
4. Cocokkan total Journal per outlet dengan F/O per departemen dan tampilkan selisihnya sebagai peringatan.

### Tahap B: Inventory menyeluruh (menjawab keluhan 3 dan 4)
1. Gabungkan stok HK (sheet) dengan laporan stok per gudang dari VHP.
2. Seragamkan nama lokasi HK memakai kamus alias dan tampilkan porsi tanpa lokasi sebagai peringatan mutu data.

### Tahap C: Laporan yang berkesinambungan
Susun dasbor dalam satu alur sebab-akibat untuk periode yang sama: Revenue -> Permintaan (DML) -> Pembelian (Receiving) -> Stok -> Pemakaian, dilengkapi baris "Sumber data" per berkas.
