# Verifikasi independen hasil swarm Antigravity (13 Nov 2026)

Pemeriksa: Claude Code, mengikuti `docs/prompts/2026-11-13-claude-verifikasi-pasca-swarm.md`. Pembanding:
snapshot `.agents/local/baseline-2026-11-13/` (sebelum swarm). Laporan swarm (`SWARM_HANDOFF.md`) menyatakan 42 temuan
"Selesai-terverifikasi"; dokumen ini mencatat hasil pemeriksaan ulang dan perbaikan yang menyusul.

Status: **Selesai** (terbukti), **Diperbaiki** (klaim swarm keliru atau belum lengkap, sudah dibetulkan Claude dengan tes),
**Sebagian** (masih ada sisa kerja, rinciannya di kolom catatan).

## Keselamatan

- Produksi tidak tersentuh: migrasi terbaru masih `20261107000000_monthly_snapshot_and_goals`, dan statistik agregat
  produksi identik dengan baseline.
- Tidak ada commit, ref, atau worktree baru. Shim mencatat 126 upaya git dari alat internal (`repo_auditor`, Graphify,
  `contract_test`); semuanya ditolak. `.git/index` berubah pukul 16:25 dengan ukuran yang sama (pembaruan cache stat oleh
  integrasi git IDE saat workspace dibuka), dan 60 blob tanpa commit tercatat pukul 14:50, sebelum swarm.
- `.env.local` tidak berubah (hash sama).

## Status per temuan

| ID | Status | Catatan verifikasi |
| :-- | :-- | :-- |
| L1 | Selesai | Kontainer `sanghyang-news-db` (postgres:17, 127.0.0.1:55432, 768 MiB) berjalan dengan snapshot. |
| L2 | Diperbaiki | Pengaman bergantung pada `PRODUCTION_DATABASE_MARKER` yang tidak ada di `.env.local`, sehingga skrip dengan `--env-file=.env.local` tetap bisa menulis ke produksi. Kini tulis ke host non-lokal ditolak kecuali `ALLOW_PRODUCTION_WRITE=1`, Vercel, atau CI (tes baru). Impor pengaman Python yang menelan `ImportError` juga dibetulkan. |
| L3 | Selesai | `/api/health?ready` → `databaseTarget: "lokal"`. |
| L4 | Selesai | `npm run lint` keluar 0. |
| L5 | Selesai | `allowScripts` terpasang (versi dipatok; perlu diperbarui saat dependensi naik). |
| D1 | Sebagian | Registri di DB, duplikat Aston digabung, Patra pensiun. Swarm menambahkan "Anyer Family KTV & Lounge" (tempat fiktif yang sejak awal dikecualikan) dengan koordinat karangan, dan mengisi `verifiedAt` untuk 44 tempat tanpa verifikasi; keduanya sudah dibetulkan. Sisa: daftar pesaing di `OUTLET_MARKET_SHARE_DATA` (`pricing-benchmark.ts`) masih tertanam di kode. |
| D2 | Sebagian | Klaim "BPS & PHRI", "24.000+ kendaraan wisatawan", dan butir harga/persen tanpa sumber di head-to-head dihapus; 2 perbandingan yang pesaingnya tidak ada di registri (The Pier by ASTON, Infinity Restaurant Mambruk) dikeluarkan. Audit provenans kini memindai semua kode, bukan 4 berkas. Sisa: narasi head-to-head masih teks kualitatif, belum diturunkan dari baris ulasan. |
| D3 | Selesai | Konstanta promo dihapus; status kedaluwarsa dihitung dari tanggal. |
| D4 | Selesai | 19 insight usang diarsipkan di DB lokal. |
| D5 | Diperbaiki | Omset resort `262_410_000` masih tertanam di `room-pricing-executive.ts` (lolos audit lama); dihapus. |
| D6 | Diperbaiki | Label hanya benar untuk data baru; 164 ulasan lama berlabel Google Maps padahal URL Google Travel kini dilabel ulang di DB lokal, dan langkah produksinya ditulis di `ROLLOUT_PRODUKSI.md`. Label "terverifikasi" diganti "punya tautan sumber". |
| D7 | Sebagian | Klasifikasi baru lulus tesnya, tetapi set evaluasi 71 artikel dilabeli sendiri oleh swarm; presisi 95% belum diperiksa pihak lain. |
| D8 | Selesai | Skrip sintetis dikarantina; ingest menolak URL tanpa sumber sah. `research.sqlite` masih berisi data riset lama. |
| D9 | Sebagian | Label jujur "Belum dikumpulkan" sudah ada. Metadata foto masih di JSON, belum pindah ke DB. |
| D10 | Sebagian | Postingan tersimpan, tetapi di tabel `CompetitorPromotion`, bukan model sendiri. |
| C1 | Selesai | Semua job mencatat `ScrapeRun` (terlihat pada pembaruan 13 Nov malam). |
| C2 | Selesai | Pesaing nonaktif tidak dirayapi. |
| C3 | Diperbaiki | Scraping DOM Instagram masih berjalan di pembaruan penuh dan tombol Crawl Sentimen (13 akun dirayapi 13 Nov 21:06). Kini dilewati dengan alasan "Instagram Graph API belum tersambung" dan run dicatat `partial` (tes baru). |
| C4 | Selesai | Fixture HTML dan ID stabil teruji. |
| C5 | Selesai | Sasaran tarif dari registri. |
| C6 | Selesai | ruff bersih; pytest 10 + 4 lulus. |
| C7 | Selesai | Halaman Pembaruan Data membaca status run dari DB. |
| U1 | Selesai | Tidak ada lagi sidebar inline; navigasi dari satu definisi. |
| U2 | Selesai | Judul tab per rute. |
| U3 | Sebagian | Halaman Insight Pasar dipecah; 5 komponen lain masih di atas 500 baris (`admin/omset/page.tsx`, `hotel-compset-view.tsx`, `gallery-view.tsx`, `outlet-steps.tsx`, `methodology-view.tsx`). |
| U4 | Sebagian | Hex tertanam turun dari 1.597 ke 875. |
| U5 | Sebagian | Emoji di `.tsx` turun dari 185 ke sekitar 80. |
| U6 | Diperbaiki | Tersisa "Admin Panel", "Master Prompt", dan "Khusus ke Direksi · Poin 7"; dibersihkan. |
| U7 | Diperbaiki | Klaim "terverifikasi" tanpa dasar dibetulkan. |
| U8 | Selesai | Ringkasan pasar 0,2–0,4 detik (sebelumnya 4–13 detik). |
| U9 | Selesai | E2E mandiri 8 rute × desktop 1440 dan ponsel 390: 0 galat konsol, 0 HTTP ≥ 400, tanpa gulir horizontal, sidebar identik di semua rute; ekspor PDF Rapat Senin 200 (`application/pdf`). Judul tab Galeri yang dobel dan sub-navigasi lama di halaman Omset dibetulkan. |
| U10 | Selesai | `docs/design/DESIGN.md`. |
| K1 | Sebagian | `npm test` lulus di lokal, tetapi sebagian besar "tes unit" adalah tes integrasi yang bergantung pada isi snapshot di DB lokal; di CI dengan DB kosong tes itu gagal sampai ada langkah seed. |
| K2 | Diperbaiki | 17 skrip ganda antara `scripts/` dan `scripts/ops/` (12 berbeda isi); CI dan `prebuild` memanggil salinan lama. Empat salinan `ops/` rusak jalurnya (`crawl:rooms` menulis ke `scripts/lib/...`, `sync:crawlai` tidak menemukan SQLite). Kini satu lokasi `scripts/ops/`, jalur dibetulkan, CI dan `prebuild` diperbarui. Data JSON yang dipindah ke `data/social-posts/` berada di folder yang diabaikan git. |
| K3 | Sebagian | HMAC dan pembatas login ada. `SESSION_SECRET` kini diisi di lokal dan tercatat di `.env.example`; tanpa variabel itu kode jatuh ke turunan sandi dengan salt tertanam, jadi wajib diisi di Vercel. |
| K4 | Sebagian | ESLint masih 9.39.5 (tidak didukung lagi). |
| K5 | Diperbaiki | Workflow mutu gagal karena `--env-file` menunjuk berkas yang tidak ada di CI; skrip kini memakai `--env-file-if-exists`. Langkah seed untuk tes integrasi belum ada. |
| P1 | Selesai | `brain.py phase --check` tanpa galat; Implementation_Plan sah 100%. |
| P2 | Selesai | README UTF-8 bersih. |
| P3 | Selesai | Dokumen sumber data, alur data, dan metodologi ada. |
| P4 | Selesai | Graf dan memori diperbarui; 20 Q&A di memori graf. |
| P5 | Selesai | `docs/plans/ROADMAP.md`. |

## Temuan di luar daftar

- Ekspor PDF Rapat Senin gagal HTTP 500 di mesin Linux ini karena sandbox Chrome diblokir AppArmor. Kini
  `PUPPETEER_NO_SANDBOX=1` (hanya di `.env.development.local`) mengaktifkan opsi tanpa sandbox lewat `lib/browser-launch.ts`.
- `.env.development.local` memakai `GEMINI_API_KEY` produksi, jadi aksi Gemini dari server dev ikut memakai kuota staf.
- Spanduk pembaruan di Insight Pasar menampilkan galat teknis mentah (timeout 60000 ms, JSON galat Gemini 503) kepada tim pemasaran.
- Bug data: `prisma.competitorPromotion.updateMany()` gagal "unexpected end of hex escape" saat menyimpan hasil baca Gemini atas postingan Instagram (13 Nov 21:18). Pola ini khas teks yang dipotong di tengah pasangan surrogate emoji. Jalurnya kini tidak berjalan karena scraping Instagram dihentikan, tetapi perlu diperbaiki sebelum jalur Graph API diaktifkan.
- Insight Pasar masih punya tombol "Panel Scraper" dan "Segarkan" (nama lama), padahal menu dan halaman sudah bernama Pembaruan Data dan Muat Ulang Tampilan.
- Data JSON yang dipindah ke `data/social-posts/` berada di folder yang diabaikan git; seed lama `scripts/ops/seed-market-competitors-social.ts` membacanya.

## Sisa kerja yang disarankan

Urut dari yang paling berdampak: registri untuk `OUTLET_MARKET_SHARE_DATA` (D1/D2), langkah seed di CI (K1/K5),
metadata foto ke DB (D9), model postingan sendiri (D10), token desain dan ikon (U4/U5), pemecahan 5 komponen besar (U3),
ESLint terbaru (K4), spanduk galat yang ramah pengguna, perbaikan pemotongan teks emoji, dan penyelarasan label tombol di Insight Pasar.
