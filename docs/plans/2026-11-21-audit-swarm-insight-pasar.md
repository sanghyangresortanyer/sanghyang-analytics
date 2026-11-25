# Audit dan perbaikan permintaan swarm 19 sampai 21 Nov 2026 (Claude Code, 21 Nov 2026)

Pemakai meminta pemeriksaan menyeluruh: apakah permintaan swarm di Antigravity (19 Nov, koreksi 19 Nov, 20 Nov versi
19.34 WIB, koreksi 21 Nov) beserta gambar yang diunggah sudah 100% terpenuhi, lalu perbaikan, commit, dan push sehingga
https://sanghyang-news.vercel.app sama persis dengan localhost:3001. Semua permintaan berlaku untuk **seluruh outlet**
(Kamar & Resort, Sunset Grill, Dragon Beach Club, D'Bistro, D'Bar & Karaoke, D'Spa & Hot Spring), bukan hanya outlet
yang dijadikan contoh.

Sumber asli (baca-saja): transkrip Antigravity
`~/.gemini/antigravity/brain/3709f11b-6c12-4fd9-9137-3af5609f2058/.system_generated/logs/transcript_full.jsonl`
(pesan `USER_EXPLICIT`, step 5718, 6268, 6294, 6308, 6582 versi 12:34 UTC, 6888, 7000, 7647, 7986). Teks lengkap
tersalin di `/tmp/claude-1000/-home-user-Documents-SANGHYANG-NEWS/fc3b3a41-42bf-4fd0-b019-5ffed3d94766/scratchpad/ag/req-*.txt`
(`req-6582-v2.txt` adalah versi 20 Nov yang berlaku). Gambar ada di
`~/.gemini/antigravity/brain/3709f11b-6c12-4fd9-9137-3af5609f2058/.user_uploaded/` (alat Read bisa menampilkannya).

## Daftar periksa

Status awal diisi koordinator dari pemeriksaan 21 Nov; pekerja memperbarui status di laporan akhirnya.

### Permintaan 19 Nov (step 5718, gambar `media_17950725325{40,44,49}`)

| ID | Butir | Status awal |
| :-- | :-- | :-- |
| A1 | Tombol unduh laporan berbunyi `Download Report • {nama outlet/tab}` (bukan "PDF Rapat Senin" atau "Laporan Insight Pasar ·"); isi laporan dan web mengikuti periode terpilih, termasuk rekomendasi | Label masih `Laporan Insight Pasar · {outlet}` (market-header.tsx:77) |
| A2 | Langkah 1 "Apa kata tamu" detail: komentar media sosial hanya dari akun outlet Sanghyang itu sendiri; bila kosong tulis `Belum ada komentar media sosial untuk {outlet}.` (gambar 1) | Perlu dicek |
| A3 | Sinkron sosmed via Chrome mengambil semua postingan secara dinamis (tanpa URL tertanam) sampai postingan awal, memperbarui metrik postingan lama | Perlu dicek |
| A4 | Langkah 4 menampilkan promo Sanghyang yang sedang berjalan (situs resmi dan media sosial), juga terhubung dengan tab "Omset, Target dan Strategy" | Sebagian ada |
| A5 | `/marketing-sosmed`: kartu TikTok tampil di samping Instagram; bila tidak ada data tetap tampil dengan `-` (gambar 2, kotak merah) | Perlu dicek |
| A6 | Langkah 2 head-to-head memuat outlet Sanghyang juga, bukan hanya ulasan: harga kamar, fasilitas (infinity pool, dsb.), jumlah dan luas kamar, ulasan menu, gaya desain dari galeri; narasi dengan sumber grounding; memakai Knowledge Graph | Ada narasi, perlu dicek per outlet |
| A7 | Langkah 3 detail: fasilitas kamar (smart TV, bathtub, jumlah kamar, dsb.) dari situs resmi dan OTA, dalam narasi dengan sumber | Perlu dicek |
| A8 | PDF layak presentasi; hanya halaman tabel yang landscape | Halaman tabel landscape (resort hal. 2 dan 3) |
| A9 | PPTX: **dibatalkan** oleh permintaan 20 Nov versi 19.34 WIB (hapus tombol dan seluruh kodenya) | Sudah dihapus |
| A10 | Data omset impor manual dikosongkan dulu | `OutletMonthlyRevenue` lokal 0 baris (perlu dicek) |
| A11 | `/dashboard`: analitik dan grafik dari seluruh data crawl dan grounding, bukan hanya status sumber | Perlu dicek |
| A12 | Knowledge Graph diperbarui dan dipakai model di `.env` untuk membuat laporan | Perlu dicek |

### Koreksi 19 Nov (step 6268, 6294, 6308; gambar `media_179509*`, `media_1795098469650`)

| ID | Butir | Status awal |
| :-- | :-- | :-- |
| B1 | Promo lebih dari 3 bulan tidak tampil (kecuali penawaran situs resmi tanpa tanggal); promo outlet Sanghyang tidak masuk daftar promo kompetitor, cukup di kartu "Promo Berjalan" | Perlu dicek |
| B2 | D'Bistro dan semua outlet F&B: data menu kompetitor yang "Belum ada data" dilengkapi dari berbagai sumber, bukan hanya Google Maps | Perlu dicek |
| B3 | "Audit pembanding" ringkas dan masuk akal: harga, fasilitas, tipe kamar (mis. condo 2 kamar Sanghyang), fasilitas resort, kelebihan dan kekurangan Sanghyang vs kompetitor | Perlu dicek |
| B4 | Tabel tipe kamar: semua tipe dari semua sumber (situs resmi menang bila beda dengan OTA), kolom "Luas" | Ada di web; PDF hanya ringkasan (sesuai 20 Nov) |
| B5 | Langkah 3 detail: bagian lama (termurah→termahal, tarif per tipe kamar, dengan/tanpa sarapan, kartu audit) diganti tabel seperti PDF; kolom "Audit pembanding" di web, sinkron dengan PDF | Perlu dicek |
| B6 | PDF berisi poin papan tulis: ulasan terbaru vs periode sebelumnya (positif/negatif), kompetitor, harga/kamar, promo/event; judul "Ringkasan Kompetitor"; tanpa profil kompetitor satu per satu; tidak perlu banyak halaman | Resort 5 hal., D'Bistro 5, DBC 4, lainnya 3 |
| B7 | Semua perubahan bisa dihasilkan ulang oleh refresh (cron dan "Perbarui Semua Data") lewat model di `.env`, dinamis, tanpa hardcode (pemetaan boleh) | Perlu dicek |

### Permintaan 20 Nov versi 19.34 WIB (step 6582 kedua; gambar `media_1795177318*.png` = gambar 1 sampai 8, `media_1795177486308` = gambar 9)

| ID | Butir | Status awal |
| :-- | :-- | :-- |
| C1 | `localhost:3001/` langsung ke Ringkasan (`/dashboard`) | Selesai (app/page.tsx) |
| C2 | Semua kata "pesaing" di UI dan PDF menjadi "kompetitor" | Perlu sapu akhir |
| C3 | Kartu "Promo Berjalan Sanghyang" dibagi dua bagian (promo dan event) dalam kartu yang sama, seperti kompetitor | Ada di PDF; web perlu dicek |
| C4 | Sumber promo Sanghyang tidak hanya situs resmi, juga media sosial (bila memang kosong, laporkan) | Perlu dicek |
| C5 | Galat sinkron ekstensi `Could not load file: 'parsers.js'` diperbaiki sampai berhasil penuh | Diklaim v1.1.1, perlu dicek |
| C6 | Nama berkas unduhan PDF `Laporan Insight Pasar:{nama_outlet}` dan judul/isi PDF "Insight Pasar" (bukan "Intelijen Pasar") | Judul PDF benar; nama berkas masih `Laporan_Insight_Pasar_{outlet}_{tanggal}.pdf` |
| C7 | PDF: periode pembanding sama panjang dengan periode terpilih; kolom Selisih dibuang; baris Total | Selesai di PDF resort; cek semua outlet |
| C8 | PDF tabel 2: kolom "Audit Pembanding" tidak dicetak (web tetap ada), semua outlet | Selesai di resort; cek semua outlet |
| C9 | Tanpa nama alat ("diperiksa Crawl4AI 17 Nov 2026" menjadi "terakhir diperiksa 17 Nov 2026") di web dan PDF | Ada pembersih teks; cek sumber datanya |
| C10 | "Perbarui Semua Data" memperbarui semua outlet, bukan hanya tab terpilih, dan datanya benar-benar diperbarui | Perlu dicek |
| C11 | Pemilihan kompetitor holistik (konsep, menu, suasana, pemandangan, fasilitas, harga, reputasi, jarak) untuk semua outlet, terdeteksi otomatis oleh AI saat refresh dalam 25 km dan aturan aktif; fallback boleh; Sunset Grill sesuai gambar 7; DBC sesuai gambar 8; isi Audit Pembanding ikut berubah; hotel "tidak sebanyak itu" | Lihat catatan kompetitor |
| C12 | Angka ringkasan tarif = angka sub-baris tipe kamar (tidak boleh beda) | Diklaim selesai, cek di web |
| C13 | PDF hanya ringkasan tarif; web tetap rinci | Selesai di resort |
| C14 | Sub-baris tarif: baris situs resmi dan baris OTA termurah (tautan bisa diklik ke OTA termurah), status sarapan (termasuk/tidak), berpengaruh ke "Evaluasi Harga Kamar Untuk Direksi" | Perlu dicek, termasuk halaman Direksi |
| C15 | Catatan aturan/jendela tarif dinamis mengikuti data dan tanggal terpilih; di bawahnya ringkasan termurah hari biasa dan akhir pekan (kita atau kompetitor) dengan sedikit kolom | Ada di PDF; cek web |
| C16 | Gambar 9: unggahan umum bukan promosi tidak masuk promo; promo dan event dipisah di PDF seperti di web | PDF resort sudah bersih; cek semua outlet |
| C17 | PDF: bagian "4. Rekomendasi & Langkah Aksi" dihapus (web tidak berubah) | Selesai di resort; cek semua outlet |
| C18 | Hapus tombol Download PPTX dan seluruh kodenya | Selesai |
| C19 | Kata "registri"/"registri pembanding" diganti bahasa awam ("daftar kompetitor") | Perlu sapu akhir |
| C20 | Knowledge Graph lebih kaya dan terhubung ke seluruh aplikasi, dipakai untuk kesimpulan dan pembobotan; diperbarui setelah semua perbaikan | Perlu dicek |
| C21 | Tanpa hardcode berlebihan (pemetaan boleh) supaya kompetitor baru terdeteksi otomatis | Lihat catatan kompetitor |

### Koreksi 21 Nov (step 6888, 7000, 7647, 7986; gambar `media_1795227880947`)

| ID | Butir | Status awal |
| :-- | :-- | :-- |
| D1 | PDF: ulasan negatif hanya dari periode terpilih (bukan "di luar rentang periode") | Selesai di resort; cek semua outlet |
| D2 | Kompetitor Sunset Grill dan DBC diubah sesuai gambar 7 dan 8 | DB lokal: SG 4 (Andalan, Beach Point, Kamalika, Campo del Sol), DBC 2 (Star Queen, Angel Karaoke) |
| D3 | Kompetitor Kamar & Resort (dan semua outlet) memakai analisis holistik yang sama | Lihat catatan kompetitor |

## Catatan kompetitor (pemeriksaan koordinator 21 Nov)

- Mesin skor: `lib/market/competitor-holistic-matcher.ts` (6 dimensi: jarak 15%, konsep 25%, produk 20%, fasilitas 15%,
  reputasi 10%, harga 15%; inti >= 70, acuan >= 55).
- Langkah refresh `syncHolisticCompetitorClassification` (lib/market/full-refresh.ts) hanya mengklasifikasi kandidat
  **baru**; keputusan untuk kompetitor lama tidak pernah dihitung ulang, jadi registri sekarang campuran hasil mesin dan
  edit manual. Uji kering `scripts/ops/audit-holistic-compset.ts` hanya berbeda di Mövenpick (mesin: acuan skor 63; DB:
  diarsipkan dengan tangan 21 Nov 04:17 UTC).
- Resort lokal: 6 inti (Marbella 95, Mambruk 94, Jayakarta 94, Nemuru 93, My Pisita 91, Aston 84). Produksi masih 9
  (Hawaii, Mövenpick, Novus Jiva aktif) karena DB produksi dan kode belum disamakan sejak 19 Nov.
- Skor hotel hampir seragam tinggi (konsep 100 untuk semua resor pantai bintang 4), padahal tarif minimum Mambruk 2,8x
  dan Aston 2,3x Sanghyang. Pemakai menilai jumlah hotel "tidak sebanyak itu".

## Batasan untuk semua pekerja

- Hanya DB kerja lokal (`.env.development.local`, 127.0.0.1:55432). Jangan membuka `.env.local` atau menulis ke produksi.
- Tanpa `git commit`, `git push`, ganti cabang, atau ubah riwayat. Koordinator yang commit dan push.
- RAM 14 GiB: jangan menjalankan `tsc` seluruh proyek, eslint seluruh proyek, seluruh suite tes, `next build`, atau
  pembaruan graf. Boleh: eslint pada berkas milik sendiri dan `node --test --import tsx <berkas tes terkait>`, keduanya
  lewat `python3 .agents/scripts/resource_guard.py --profile light --min-budget-mb 800 --memory-max-mb 1500 -- <perintah>`.
- Jangan memakai peramban Chrome pemakai (dipakai koordinator). Server dev sudah jalan di http://127.0.0.1:3001 (wajib
  login, jadi verifikasi pakai pemanggilan langsung fungsi lewat `node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs <skrip>`).
- Bahasa Indonesia baku di UI dan PDF; tanpa nama model atau alat AI; Zero Mock (kosong = `Belum ada data`), Zero
  Hardcode (pemetaan boleh), Zero Fallback; tes dari data asli (fixture dari DB lokal atau berkas data repo), tes gagal
  dulu sebelum perbaikan.
- Hanya sunting berkas di irisan sendiri. Bila butuh perubahan di berkas irisan lain, tulis ke papan
  (`python3 .agents/scripts/swarm_board.py post --agent <nama> --text "@coordinator ..."`).

## Tambahan permintaan pemilik 21 Nov 2026 (17.20 WIB)

- [ ] E1. Kolom "Kategori Promosi" di semua tabel promo (promo pesaing dan promo Sanghyang) pada web dan PDF untuk semua outlet. Urutan kolom sama di web dan PDF: Tempat, Judul Promo, Kategori Promosi, Periode, Harga / Diskon, Sumber. Kategori dibaca AI dari teks sumber yang tersimpan (taksonomi `lib/market/promo-type.ts`, kolom `CompetitorPromotion.promotionType`). Kalibrasi dari pemilik: "Seaside Candlelight Dinner" Mambruk = Brand awareness karena memperkenalkan fasilitas tanpa insentif harga. Promo yang belum dibaca tertulis "belum ada data".
- [ ] E2. Tarif kamar Sanghyang di lapisan "situs resmi" diambil dari booking engine resmi `sanghyang.com/book` (Exely IBE) untuk tanggal check-in hari biasa dan akhir pekan yang sama dengan lapisan OTA, semua tipe kamar yang tersedia, dan ikut diperbarui jadwal malam.
