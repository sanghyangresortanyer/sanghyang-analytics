# Desain dashboard (`/amp`, `/sanghyang`, `/sosmed`) dan laporan mingguan

## Subjek, pemakai, tugas

- Pemakai: owner, dibuka di laptop dan ponsel, sekali sehari atau saat ada keputusan.
- Tugas utama: dalam satu layar tahu tiga hal. Iklan properti AMP menghasilkan chat atau tidak, iklan Google Sanghyang menghasilkan kontak atau tidak, dan apa yang terjadi di sosmed Sanghyang.
- Bukan tempat mengubah iklan. Perubahan tetap lewat chat dengan persetujuan owner.
- 17 Nov (owner): dipisah jadi 3 halaman bertab: AMP Meta Ads, Google Ads Sanghyang, Sosmed Sanghyang. `/overview` diarahkan ke `/amp`. Tab aktif bergaris warna identitas; di ponsel ketiga tab berbagi lebar layar.
- Laporan mingguan (`/laporan/meta`, `/laporan/google`, atau `report:meta` / `report:google`) mengikuti `Template_Laporan_Mingguan_Google_Ads_Analytics.pdf`: biru tua, 4 kotak ringkasan, tabel pekan lalu vs pekan ini, evaluasi. Bilah atas (kembali, pilih pekan, cetak) hanya di layar, tidak ikut tercetak. PDF A4 dua halaman lewat Chrome headless.

## Lintasan 1: token

| Token | Nilai | Peran |
|---|---|---|
| `--paper` | `#F5F2EC` | latar halaman, kertas hangat |
| `--card` | `#FFFFFF` | isi kartu |
| `--ink` | `#1E2227` | teks utama |
| `--muted` | `#5E636B` | teks pendukung (kontras ≥ 4,5:1 di `--card` dan `--paper`) |
| `--line` | `#DDD6CA` | garis kartu |
| `--amp` | `#1F3B5C` | biru pelabuhan, identitas AMP (properti Batam/Singapura) |
| `--sh` | `#1D6458` | hijau laut Anyer, identitas Sanghyang |
| `--social` | `#9A4A26` | terakota senja (Sunset Grill), section sosmed |
| `--ok` / `--warn` / `--bad` | `#2B6E47` / `#8A5A0B` / `#A3241C` | status terhadap aturan keputusan |

- Huruf: IBM Plex Sans (400/600) dengan cadangan sistem; angka `font-variant-numeric: tabular-nums`.
- Skala: 13 / 15 / 18 / 24 / 36 px. Panjang baris teks ≤ 70 karakter.
- Radius: kartu 10 px, kartu utama 14 px, chip 999 px. Jarak dasar 8 px.
- Tata letak: grid 12 kolom di desktop (kartu utama 6, kartu biasa 3, kartu lebar 12), 2 kolom di tablet, 1 kolom di ponsel.

## Lintasan 2: yang diganti karena terbaca bawaan

- Bayangan abu lembut di semua kartu → diganti garis 1 px; hanya kartu utama yang punya pita warna identitas di atas.
- Label huruf kapital berjarak di atas tiap kartu → huruf kalimat biasa.
- Emoji ikon dari dashboard lama → tidak dipakai; identitas section memakai warna dan nama.
- Angka besar tanpa konteks → setiap angka besar punya pembanding atau batas data di bawahnya.
- Grafik dekoratif → hanya satu grafik: chat per hari AMP, batang dengan angka tertulis (terbaca tanpa warna).

## Sumber data dan kejujuran

- AMP: Meta Marketing API (baca-saja), 7 hari terakhir termasuk hari ini (hari ini belum lengkap).
- Sanghyang: Google Ads API + GA4 216046044, bulan berjalan vs hari yang sama bulan lalu; definisi kontak sama dengan `sanghyang:monthly`.
- Sosmed: daftar akun dari tabel `social_accounts` (email login tidak ditampilkan) dan tangkapan layar di `docs/sanghyang-sosmed/`. Angka sosmed ditandai "isi manual" sampai izin Instagram tersedia.
- Satu sumber gagal tidak menjatuhkan halaman: kartunya menampilkan pesan galat dan cara memperbaikinya.
