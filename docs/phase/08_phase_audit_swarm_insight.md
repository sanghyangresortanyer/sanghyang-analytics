# Phase 7: Audit permintaan swarm Insight Pasar, kategori promosi, dan tarif resmi

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-012, ADR-013

## 1. Tujuan

Semua permintaan swarm Antigravity 19-21 Nov 2026, beserta gambar unggahannya, terpenuhi di web dan PDF untuk semua
outlet, lalu produksi (https://sanghyang-news.vercel.app) sama dengan localhost:3001 setelah push. Daftar periksa lengkap
ada di [rencana audit swarm](../plans/2026-11-21-audit-swarm-insight-pasar.md) (A1-A12, B1-B7, C1-C21, D1-D3, E1-E2).

## 2. Ruang lingkup

- Masuk:
  - Pemilihan kompetitor dengan penilaian enam dimensi (jarak, konsep, produk, fasilitas, reputasi, kesetaraan harga)
    untuk semua outlet: setiap penyegaran menilai ulang seluruh daftar kompetitor dengan OCC tanpa menghapus baris, dan keputusan pemakai yang tercatat dihormati (`lib/market/competitor-holistic-matcher.ts`,
    `lib/market/compset-audit.ts`).
  - Kolom "Kategori Promosi" di semua tabel promo web dan PDF (E1): taksonomi `lib/market/promo-type.ts`, kolom
    `CompetitorPromotion.promotionType` (migrasi aditif `20261121000000_promotion_type`), dan pembaca AI
    `lib/market/promo-type-classifier.ts`.
  - Tarif kamar resmi Sanghyang dari booking engine `sanghyang.com/book` lewat Exely Search API berkredensial pemilik
    (E2): `scripts/ops/crawl-official-room-rates.ts` dan `lib/market/official-room-rates.ts`, dipanggil jadwal malam dan
    "Perbarui Semua Data" setelah tanggal tarif OTA berganti.
  - Aturan periode promo dan event yang sama untuk web, Ringkasan, Knowledge Graph, dan PDF (`promoInRange`,
    `promoRangeWhere` di `lib/market/date-range.ts`): berjalan di dalam periode atau segera datang.
  - PDF 3 halaman per outlet, nama berkas sama dengan judul, tanpa nama alat atau model AI.
  - Penyeragaman istilah "kompetitor" dan "daftar kompetitor" di kode, prompt AI, dan teks tersimpan (skrip sekali
    jalannya dibuang setelah diterapkan, lihat bagian 7).
  - Ekstensi Sanghyang Market Sync v1.1.2, halaman Media Sosial, Ringkasan, dan Knowledge Graph.
  - GitHub Secrets `EXELY_*` untuk jadwal malam (diisi 22 Nov 2026 atas permintaan pemilik, lihat bagian 7).
- Tidak masuk:
  - 20 sel harga menu kompetitor yang tidak tercantum di sumber resmi (B2).

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 012 | Ekstensi Chrome untuk sinkron media sosial | Ekstensi naik ke v1.1.2: folder yang terhapus terdeteksi, grid profil dibaca sampai postingan awal |
| 013 | DB produksi disamakan saat push | Kolom `promotionType`, hasil penilaian ulang kompetitor, dan teks yang diseragamkan sampai ke produksi lewat hook pre-push |

Keputusan pemilik di fase ini:
- 21 Nov 2026 23.12 WIB: Exely Search API boleh dipakai; pemilik memasang kredensial sendiri. Host widget Exely melarang
  semua perayap lewat robots.txt, jadi halaman `/book` tidak dirayapi.
- 21 Nov 2026: "Seaside Candlelight Dinner" Mambruk adalah contoh Brand awareness; taksonomi lainnya disusun AI.

## 4. Daftar periksa

- [x] E1 kolom Kategori Promosi di web dan PDF, 0 promo tampil tanpa kategori di DB lokal.
- [x] E2 tarif resmi 7 dari 7 tipe kamar Sanghyang untuk check-in 24 dan 28 Nov 2026.
- [x] Penilaian ulang kompetitor semua outlet di DB lokal (uji kering ulang 0 perubahan).
- [x] Gerbang lokal: `tsc --noEmit` exit 0, `npm run lint` exit 0.
- [x] Replika CI (DB baru, migrasi, fixture `tests/fixtures/ci-db` hasil ekspor 22 Nov, satu berkas tes sekaligus):
      575 lulus, 0 gagal, 1 dilewati dengan sengaja; `audit:provenance` exit 0.
- [x] Render 7 PDF periode 24 Okt-22 Nov 2026: 3 halaman per outlet, 19 halaman Semua Outlet, 0 nama alat atau model AI.
- [x] Push ke `master` dengan hook pre-push (migrasi aditif dan sinkron DB) lalu deploy Vercel READY (`e27042a`, CI lulus untuk `e9d85a2`, `0c61be2`, `083bf59`).
- [x] Produksi dicocokkan dengan localhost:3001 di peramban: 25 dari 29 bagian ringkasan identik; sisanya catatan per lingkungan, cap waktu penyegaran, dan sidik jari internal.
- [x] GitHub Secrets `EXELY_*` diisi 22 Nov 2026 atas permintaan pemilik (dienkripsi libsodium sistem, nilai tidak dicetak).

## 5. Catatan verifikasi

- Tes paralel di mesin 12 inti bisa gagal karena berkas tes saling menulis DB yang sama dan tes kecepatan U8 berebut
  CPU. Runner CI repo privat memakai 2 vCPU, sehingga berkas tes berjalan berurutan; replika berurutan lulus.
- Server dev perlu dimulai ulang setelah `prisma generate`, karena klien Prisma lama tetap di memori proses
  (gejala: "Unknown field `promotionType`" dan galat 500 pada ringkasan Insight Pasar).

## 6. Putaran perbaikan tinjauan independen (22 Nov 2026)

Peninjau independen menilai commit `b5f68d8` belum siap dirilis. Push pertama juga dibatalkan karena sinkron pre-push
macet di tahap berita: satu kueri artikel sekitar 7 MB alirannya terhenti dan Prisma menunggu tanpa batas. Tahap
sebelumnya sudah tersinkron ke produksi, termasuk migrasi `promotionType`. Perbaikannya:

- Keputusan pemakai di `retiredReason` tidak pernah hilang. Saat baris aktif lagi, kalimatnya pindah ke `notes` dalam
  pembaruan OCC yang sama.
- Klasifikasi kompetitor hanya menulis dari mesin kerja lokal. Di CI langkahnya berjalan dalam mode laporan, sehingga
  daftar kompetitor mengikuti lokal (ADR-013) dan tidak bolak-balik.
- Klasifikasi tidak lagi menulis `verifiedAt`. Tanggal "Situs resmi" diambil dari fakta situs. Sebanyak 73 nilai
  `verifiedAt` lokal dipulihkan dari cadangan dengan skrip sekali jalan yang sudah dibuang (bagian 7).
- Sinkron menyalin `promotionType`, membaca artikel per 1.000 baris, dan memakai `socket_timeout` 60 dtk untuk klien
  produksi, sehingga soket yang macet membatalkan push dengan galat jelas.
- Tarif resmi hanya ikut harga termurah bila tanggal check-in-nya sama dengan lapisan OTA. Bila tanggalnya berbeda,
  harga itu tampil terpisah lengkap dengan tanggalnya.
- PDF memakai saringan promo `promoRangeWhere` yang sama dengan web, dan promo mendatang tanpa tanggal selesai berlaku
  sejak hari mulainya.
- Galat simpan dan galat model pada analisis Knowledge Graph tampil di keluaran langkah, dengan komentar
  `ZERO-FALLBACK` untuk cadangan tampilan yang disengaja.
- Postingan media sosial yang tersimpan lebih dari sekali (satu baris per tangkapan sinkron) diwakili tangkapan
  terbarunya di halaman Media Sosial, Ringkasan, dan Knowledge Graph.

Bukti: `tsc --noEmit` exit 0, `npm run lint` exit 0, replika CI berurutan 599 lulus ditambah tes antrean kategori yang
diperbaiki (6/6 di DB replika), 1 dilewati dengan sengaja, `audit:provenance` exit 0. Tujuh PDF dirender ulang: 3 halaman
per outlet, kolom Kategori Promosi ada, tanpa nama alat atau model AI. Sebanyak 28 promo dari produksi dikategorikan, dan
dari 39 promo yang tampil di web tidak ada yang tanpa kategori.

## 7. Keputusan pemilik yang diserahkan ke agen dan pembersihan skrip (22 Nov 2026)

Pemilik menyerahkan keputusan yang tertunda ("bayangkan kamu adalah saya"). Yang diputuskan:

- GitHub Secrets `EXELY_*` diisi lewat API GitHub dengan token proyek. Nilai dienkripsi libsodium sistem
  (`crypto_box_seal`) dan tidak dicetak.
- Harga paket untuk beberapa orang dan sewa ruang (41 item, antara lain Seaside Candlelight Dinner Mambruk Rp 950.000 dan
  Royal Suite Happy Puppy Rp 1.300.000) tidak lagi masuk kisaran harga per porsi, rata-rata, indeks harga, atau
  perbandingan per item. Item itu tetap tampil dengan label "paket 2 orang" atau "sewa ruang". Penanda `kind` dan `pax`
  dipertahankan saat foto menu dibaca ulang.
- "Ikan bakar per ons" boleh menjadi padanan kakap atau kerapu bakar per ons dengan label "padanan umum: jenis ikan tidak
  disebut". Sel lain tanpa harga bersumber tetap "Belum ada data".
- Batas 10 baris per tabel promo di PDF dipertahankan supaya laporan rapat tetap 3 halaman per outlet; daftar lengkap ada
  di web.
- 17 skrip sekali jalan yang efeknya sudah diterapkan atau sudah digantikan mesin baru dibuang, beserta 2 tes khususnya
  dan entri README-nya. Seed `seed-market-competitors-social.ts` ikut dibuang karena `npm run db:seed` menghapus seluruh
  promo dan ulasan lewat `deleteMany({})`; data kini datang dari crawl dan ekstensi.

Bukti: uji kering penilaian kompetitor sesudah perubahan menu 0 perubahan; `tsc --noEmit` dan `npm run lint` exit 0;
replika CI berurutan 600 lulus, 0 gagal, 1 dilewati dengan sengaja; `audit:provenance` exit 0.

## 8. Pencocokan menyeluruh 22 API dan urutan tetap (22 Nov 2026 malam)

Pencocokan produksi dengan localhost diperluas dari ringkasan Insight Pasar ke 22 API GET yang dipakai halaman. Sembilan
API sudah identik (Media Sosial, Galeri Kompetitor, perbandingan F&B lima outlet, Target, Omset). Perbedaan lainnya
berasal dari tiga sebab:

- Urutan baris dari DB tidak tetap. Kueri tanpa ORDER BY mengikuti letak fisik baris, yang berbeda di Postgres lokal dan
  Supabase, dan tanggal terbit RSS tersimpan per hari sehingga LIMIT SQL memotong berita bertanggal sama dalam urutan
  bebas. Akibatnya sumber simpul tema dan urutan simpul Knowledge Graph, urutan berita dan promo aktif terbaru di
  Ringkasan, serta sidik jari analisis Resort dan Sunset Grill berbeda. Perbaikannya `lib/market/stable-order.ts`
  (waktu terbaru dulu, lalu teks dengan `localeCompare('id')`, nama kompetitor sebagai ganti UUID), dipakai
  `mergePromoCaptures` (web, Ringkasan, dan PDF), `assembleGraph`, serta berita Ringkasan dan Knowledge Graph yang kini
  dipotong sesudah diurutkan.
- Nama sumber berita ditulis dua jalur. Registri tugas perayapan memakai "Google News Anyer", sedangkan tombol admin
  (termasuk "Perbarui Semua Data") dan seed menulis "Google News", sehingga label penerbit di kartu berita berganti
  setiap kali tombol ditekan. Keduanya kini memakai registri, dan sinkron pre-push menyamakan nama dan kategori sumber
  yang domain dan metodenya sama (langkah 9).
- Label rating tiga kompetitor di produksi masih menyebut nama alat ("crawl Crawl4AI"), karena kolom rating hanya
  disalin bila waktu baca lokal lebih baru. Bacaan dengan waktu baca sama kini mengikuti lokal.

Perbedaan yang memang milik tiap lingkungan dibiarkan: catatan otomasi malam (`nightlyHeartbeat`, `syncStatus`, insight
heartbeat), cap "Data per" di ringkasan eksekutif dan `dataUpdatedAt` graf (waktu penyegaran penuh terakhir di
lingkungan itu), status sumber Instagram (lokal membaca ekstensi Chrome, produksi membaca konfigurasi Graph API), status
perayapan, dan `fetchedAt` tren (waktu permintaan). Daftar `/api/market-intelligence`, yang tidak dipakai halaman mana
pun, masih diurutkan menurut `createdAt` yang berbeda per DB.

Tinjauan independen sebelum push menemukan dua jalur lain yang masih mengikuti letak baris, dan keduanya sudah
diperbaiki. Pertama, urutan simpul tarif per penginapan di Knowledge Graph (`inStableOrder` kini juga mengurutkan tarif).
Kedua, kutipan ulasan dan tema teratas di PDF Rapat Senin: ulasan diurutkan tetap sebelum empat pertama per sisi diambil,
dan tema yang jumlahnya seri diurutkan menurut nama. Langkah sinkron 9 kini memakai registri tugas untuk sumber job
terdaftar di kedua DB, supaya nama baru di registri tidak bolak-balik antara push dan job malam, dan cadangan sebelum
menulis memuat tabel Source.

Bukti: tes baru `tests/unit/stable-order.test.ts` (baris asli DB dibalik, hasil harus sama) dan tes sinkron dengan
fixture asli kedua DB gagal sebelum perbaikan dan lulus sesudahnya; `tsc --noEmit` dan `npm run lint` exit 0; replika CI
berurutan 609 tes, 608 lulus, 0 gagal, 1 dilewati dengan sengaja; `audit:provenance` exit 0; graf Graphify disegarkan dan
`verify-artifacts` OK. Push `6a8e7e2` (23 Nov 2026 08.37 WIB) menyamakan label `ratingSource` tiga kompetitor dan nama
sumber berita di produksi; CI dan deploy Vercel lulus. Sesudah sinkron, probe graf terhadap kedua DB dengan kode yang sama
menghasilkan simpul dan relasi yang identik isi dan urutannya, dan sidik jari analisis keenam outlet sama.

Pada pagi yang sama, "Perbarui Semua Data" di localhost (ditekan 22 Nov 22.42 WIB, selesai 23 Nov 08.52 WIB) mengaktifkan
lagi Novus Jiva dan empat outletnya sebagai acuan, karena tarifnya hilang dari berkas tarif setelah diarsipkan. Keputusan
pemakai 23 Nov 2026: perubahan itu diarsipkan. Kelima baris dikembalikan ke arsip di DB lokal dengan kalimat keputusan
pemakai, sehingga pratinjau klasifikasi ulang memberi 0 perubahan. Tarif hasil pembaruan itu di-commit (`736471c`) dan
ikut ter-deploy.

Pencocokan akhir lewat peramban sesudah deploy `736471c` (25 titik, kolom `id`, `*Id`, `version`, `createdAt`, dan
`updatedAt` diabaikan): 12 titik identik penuh, termasuk Ringkasan (Dasbor) tiga periode, Media Sosial, Galeri,
perbandingan F&B lima outlet, Target, dan Omset. Ringkasan Insight Pasar tiga periode identik 26 dari 29 bagian; sisanya
cap "Data per", `nightlyHeartbeat`, dan `syncStatus`. Knowledge Graph 30 hari, 90 hari, dan tahun ini identik simpul dan
relasinya (ID simpul diganti jenis dan label); yang beda hanya `dataUpdatedAt`. Graf tanpa periode beda di `observedAt` dua
simpul yang diisi waktu permintaan. Daftar kompetitor identik isinya. Yang tersisa tidak tampil di halaman: urutan daftar
`/api/competitors` dan `/api/market-intelligence`, serta penanda `activeFingerprint` pada baris kesimpulan analisis yang
disusun terpisah oleh jadwal malam dan pembaruan lokal. Status sumber sosial, status perayapan, dan `fetchedAt` tren
memang milik tiap lingkungan.

## 9. Dasar harga tarif kamar dan status sarapan (23 Nov 2026)

Pemakai menemukan tarif Sanghyang hari biasa Rp 311.328 di tabel "Perbandingan Tarif Kamar Termurah" PDF, padahal Google
Travel menampilkan termurah sekitar Rp 361.792, dan kolom Sarapan berisi "Belum tercatat". Hasil penelusuran:

- Google Travel memilih tampilan harga dari lokasi alamat internet, bukan dari parameter `gl`. Pembaca tarif properti
  (`collect-rates`) membuka tab Prices tanpa memastikan pilihan tampilan. Akibatnya run GitHub Actions (runner di AS)
  menyimpan harga sebelum pajak dan biaya, sedangkan run lokal menyimpan total per malam. Dari 507 baris paket lama
  "Google Hotels displayed rate", 377 dibaca di dalam run CI (dicocokkan dengan jam run dari API GitHub). Pada 52 pasangan
  hotel dan malam yang sama, bacaan CI lebih rendah, sering tepat 21%. Matriks mengambil harga terendah dari berkas jendela
  (total) dan snapshot DB, sehingga harga sebelum pajak menang di kelima baris hari biasa dan di baris Sanghyang akhir
  pekan (Rp 752.704 = Rp 910.784 ÷ 1,21).
- Bila hotel tidak punya penawaran, parser lama mengambil semua angka "Rp" di halaman, termasuk blok "Hotel serupa".
  Halaman My Pisita hanya berisi "Hubungi pihak properti ini", jadi semua tarifnya adalah harga penginapan lain.
- Penawaran termurah per properti berasal dari OTA yang di Google Travel hanya menampilkan harga (Trip.com, Traveloka,
  Tripadvisor, KAYAK). Status sarapan hanya tersedia untuk penawaran berrincian kamar. Snapshot per kamar dari DB juga
  kehilangan status sarapan yang tersimpan di nama paketnya.

Perbaikan:

- `lib/market/google-hotel-rate.ts` membuka tab Prices dengan Chrome (viewport desktop, `gl=id`, `curr=IDR`), lalu
  memastikan pilihan dialog "Harga yang ditampilkan" `displayNightlyFullPrice` tercentang dan menggantinya bila belum.
  Label tombol tidak ikut berubah saat pilihan diganti, dan pada viewport 800×600 klik pilihan tidak diterima. Uji di
  halaman asli (2 malam): Total menginap Rp 728.416 kembali ke Rp 364.208 per malam. Bila dasar harga tidak bisa
  dipastikan, tarif tidak disimpan. Harga hanya diambil dari penawaran hotel itu sendiri (baris bertombol "Buka situs" dan
  "Lihat opsi lainnya mulai dari"). Jalur Crawl4AI dan tebakan Gemini untuk tarif dihapus karena keduanya tidak bisa
  membuktikan pilihan tampilan.
- `lib/market/rate-basis.ts`: tarif properti baru berpaket "Google Hotels total per malam". Paket lama tidak dipakai di
  matriks, Ringkasan, Dasbor, Knowledge Graph, PDF, briefing pagi, panel admin, cakupan kompset, API tarif, dan bahan
  insight. Barisnya tidak diubah, karena sinkron pre-push memasangkan tarif lewat identitas yang memuat paket. Akibatnya
  riwayat tarif harian sebelum 23 Nov tidak lagi tampil.
- Tabel termurah: penawaran OTA tanpa keterangan sarapan ditandai "Tidak disebutkan" dan disertai harga kamar yang sama
  dengan dan tanpa sarapan (OTA dan tanggal check-in). Snapshot per kamar membawa status sarapan dari nama paketnya. Baris
  dari situs resmi kini membawa tanggal check-in dan status sarapan per jenis hari. Bila harga termurah OTA sama dengan
  harga situs resmi pada malam yang sama dan hanya situs resmi yang menyebut sarapan, baris memakai situs resmi; contohnya
  Sanghyang akhir pekan Rp 800.000 Room Only, yang di Google Travel tampil sebagai baris "Situs Resmi".
- Fixture CI `CompetitorPriceSnapshot` dan `SanghyangPriceSnapshot` diekspor ulang dari DB lokal dengan SQL yang sama
  dengan `ci-fixture.ts export`. Isinya hanya tambahan (75 tarif pesaing dan 12 tarif Sanghyang, termasuk tarif berpaket
  baru dan snapshot per kamar), dan tabel lain tidak disentuh.
