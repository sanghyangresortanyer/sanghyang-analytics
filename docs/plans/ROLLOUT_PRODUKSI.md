# Rencana Penerapan ke Produksi (Rollout Plan)

Dokumen ini adalah panduan operasional langkah demi langkah bagi pemilik repositori untuk menerapkan perubahan skema, perbaikan integritas data, dan migrasi registri kompetitor ke lingkungan basis data produksi (Supabase PostgreSQL 17.11).

> [!IMPORTANT]
> Sesuai Aturan Keras No. 2, agen/worker dalam swarm **DILARANG KERAS** menjalankan migrasi, modifikasi, atau penulisan langsung ke basis data produksi. Seluruh langkah di bawah ini disiapkan untuk dieksekusi secara aman dan mandiri oleh pemilik setelah pengujian di lingkungan lokal selesai dan terverifikasi 100%.

---

## 1. Ringkasan Perubahan

| Komponen | Perubahan | Dampak di Produksi |
|---|---|---|
| **Enum `ScrapeJob`** | Penambahan nilai: `rates`, `reviews`, `social`, `promos`, `website`, `ratings`, `photos`, `room_rates`. | Tidak memecah data lama (nilai `news` tetap utuh). Memungkinkan logging dan penguncian job scraper non-berita. |
| **Model `Competitor`** | Penambahan kolom: `category`, `group`, `outlets`, `placeId`, `mapsUrl`, `roadKm`, `driveMinutes`, `straightKm`, `distanceSource`, `address`, `starRating`, `roomCount`, `ratesUrl`, `retiredReason`, `verifiedAt`. | Kolom baru bersifat opsional (nullable) atau memiliki nilai bawaan (`outlets` default `[]`), sehingga tidak mengganggu kueri lama. |
| **Integritas Aston** | Penggabungan duplikat "Aston Anyer Beach Hotel & Aquavillas" ke entri tunggal "Aston Anyer Beach Hotel" (`10000000-0000-4000-8000-000000000001`). | Menyatukan 15 promo aktif ke baris utama yang telah memiliki 44 harga dan 27 ulasan. Menghilangkan split metrik. |
| **Pensiun Patra** | Pembaruan status `Patra Anyer Hotel` menjadi `active: false` dengan `retiredReason`. | Menghentikan upaya crawling gagal setiap malam (`ERR_NAME_NOT_RESOLVED`). |
| **Registri Tunggal** | Penambahan data properti compset (Hawaii Resort dan venue outlet; Anyer Family KTV tidak dimasukkan karena tempat fiktif) ke DB. | Menghilangkan ketergantungan pada array hardcoded di kode sumber. |

---

## 2. Prasyarat & Pencadangan (Pre-flight Backup)

Sebelum menjalankan perintah perubahan apa pun di produksi:

1. **Buat Cadangan Penuh (Full Database Dump) Produksi:**
   ```bash
   mkdir -p backups && umask 077
   # Menggunakan DIRECT_URL produksi dari lingkungan aman pemilik
   docker run --rm postgres:17 pg_dump "$DIRECT_URL" \
     --format=custom \
     --no-owner \
     --no-privileges \
     > backups/sanghyang_prod_backup_$(date +%Y%m%d_%H%M%S).dump
   ```
2. **Pastikan Tidak Ada Scraper yang Sedang Berjalan:**
   Periksa tabel `ScrapeLock` dan pastikan tidak ada proses scraper malam yang sedang memegang kunci.

---

## 3. Langkah 1: Terapkan migrasi skema

Koreksi 26 Nov 2026 (auditor basis data): perintah lama `prisma migrate deploy` dicabut. Produksi `omuqbpxierdlfjascngz` tidak punya tabel `_prisma_migrations`, sehingga Prisma akan mencoba menerapkan semua migrasinya dari awal. Sejak ADR-014 skema produksi hanya diubah lewat berkas SQL di `supabase/migrations/`; migrasi Prisma `20261113000000_competitor_registry_and_jobs` milik produksi lama, sedangkan di produksi baru tabel Market Intelligence dibuat oleh `0085_market_intelligence_tables.sql`.

Cara yang berlaku (dijalankan pemilik):

1. **Pra-cek katalog.** Baca ledger migrasi dan pastikan migrasi yang akan diterapkan belum tercatat:
   ```sql
   SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
   ```
   Lalu pastikan objek barunya memang belum ada: tabel `public.wa_bookings`, kolom `weekly_sales_lines.bill_no`, dan kolom `sheet_hk_months.store`.
2. **Terapkan satu per satu lewat `apply_migration` Supabase**, dengan `name` persis nama berkas tanpa `.sql` dan isi kueri sama dengan isi berkas, berurutan: `0086_wa_bookings`, `0087_sales_bill_no_and_dbar_parts`, `0088_sheet_stores`. Cara ini mencatat tiap migrasi di ledger `supabase_migrations.schema_migrations`. SQL Editor dan `psql` tidak dipakai karena tidak mencatat ledger.
3. **Pasca-cek katalog.** Ketiga nama tercatat di ledger, lalu jalankan kueri verifikasi di bagian "Tambahan 26 Nov 2026" §5.

---

## 4. Langkah 2: Gabungkan Duplikat Aston Anyer Beach Hotel di Produksi

Jalankan transaksi SQL berikut di Supabase SQL Editor atau via `psql`:

```sql
BEGIN;

-- 1. Verifikasi ID kedua baris Aston
-- Baris Utama (Target): 10000000-0000-4000-8000-000000000001
-- Baris Duplikat: 0be15f5b-b4ba-40d7-9e41-2e76d015f146 (atau cari berdasarkan nama)

DO $$
DECLARE
  v_target_id UUID := '10000000-0000-4000-8000-000000000001';
  v_dup_id UUID;
BEGIN
  SELECT id INTO v_dup_id FROM "Competitor"
  WHERE id != v_target_id AND name ILIKE '%Aston Anyer Beach Hotel & Aquavillas%'
  LIMIT 1;

  IF v_dup_id IS NOT NULL THEN
    RAISE NOTICE 'Memindahkan relasi dari duplikat % ke target %', v_dup_id, v_target_id;

    -- Pindahkan promosi
    UPDATE "CompetitorPromotion"
    SET "competitorId" = v_target_id
    WHERE "competitorId" = v_dup_id;

    -- Pindahkan ulasan (jika ada)
    UPDATE "CompetitorReview"
    SET "competitorId" = v_target_id
    WHERE "competitorId" = v_dup_id;

    -- Pindahkan harga (jika ada)
    UPDATE "CompetitorPriceSnapshot"
    SET "competitorId" = v_target_id
    WHERE "competitorId" = v_dup_id;

    -- Hapus baris duplikat
    DELETE FROM "Competitor"
    WHERE id = v_dup_id;

    RAISE NOTICE 'Penggabungan duplikat Aston selesai.';
  ELSE
    RAISE NOTICE 'Baris duplikat Aston tidak ditemukan atau sudah digabung.';
  END IF;
END $$;

COMMIT;
```

---

## 5. Langkah 3: Sinkronisasi Registri Terpadu Kompetitor

Jalankan skrip seed registri terverifikasi terhadap produksi:

```bash
ALLOW_PRODUCTION_WRITE=1 node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/seed-competitor-registry.ts
```

Skrip ini akan:
1. Memperbarui metadata Aston Anyer Beach Hotel (roadKm: 12.0, placeId: "aston_anyer", starRating: 3, roomCount: 101, ratesUrl terverifikasi).
2. Memperbarui seluruh properti compset (Mambruk, Jayakarta, Marbella, Novus Jiva, Mutiara Carita, Mövenpick, Allisa, Sanghyang).
3. Memastikan Patra Anyer Hotel nonaktif (`active: false`) dengan `retiredReason = 'Operasional hotel dihentikan/tutup permanen'`.
4. Memasukkan entri baru untuk properti yang sebelumnya hanya ada di JSON statis (Hawaii Resort Family Suites serta venue outlet Sunset Grill dan D'Bar). Anyer Family KTV TIDAK dimasukkan: tempat fiktif yang sejak awal dikecualikan.

---

## 6. Langkah 4: Verifikasi Pasca-Rollout

Jalankan kueri verifikasi berikut untuk memastikan data produksi bersih dan konsisten:

```sql
-- 1. Pastikan hanya ada 1 baris Aston Anyer Beach Hotel
SELECT id, name, active, "placeId", "roadKm", "ratesUrl"
FROM "Competitor"
WHERE name ILIKE '%Aston%';

-- 2. Pastikan promo Aston tersambung dengan benar ke baris utama
SELECT count(*) AS total_promo_aston
FROM "CompetitorPromotion"
WHERE "competitorId" = '10000000-0000-4000-8000-000000000001';

-- 3. Pastikan Patra nonaktif
SELECT id, name, active, "retiredReason"
FROM "Competitor"
WHERE name ILIKE '%Patra%';

-- 4. Periksa ringkasan jumlah kompetitor aktif per kategori
SELECT category, count(*) AS total_aktif
FROM "Competitor"
WHERE active = true
GROUP BY category
ORDER BY total_aktif DESC;

-- 5. Periksa migrasi Prisma yang tercatat
SELECT migration_name, finished_at
FROM _prisma_migrations
ORDER BY started_at DESC
LIMIT 3;
```

Kriteria Keberhasilan:
- `migration_name` memuat `20261113000000_competitor_registry_and_jobs` dengan `finished_at` terisi.
- Hanya 1 baris Aston Anyer Beach Hotel yang aktif, memiliki promo > 0 dan harga > 0.
- Patra Anyer Hotel memiliki `active = false`.
- Total kompetitor aktif di produksi tercatat 43 entri terverifikasi.

---

## 7. Rencana Kontingensi & Rollback

Bila terjadi kendala saat proses rollout:

1. **Rollback Skema (Down Migration):**
   ```sql
   BEGIN;
   DROP INDEX IF EXISTS "Competitor_placeId_idx";
   DROP INDEX IF EXISTS "Competitor_active_category_idx";
   ALTER TABLE "Competitor"
     DROP COLUMN IF EXISTS "category",
     DROP COLUMN IF EXISTS "group",
     DROP COLUMN IF EXISTS "outlets",
     DROP COLUMN IF EXISTS "placeId",
     DROP COLUMN IF EXISTS "mapsUrl",
     DROP COLUMN IF EXISTS "roadKm",
     DROP COLUMN IF EXISTS "driveMinutes",
     DROP COLUMN IF EXISTS "straightKm",
     DROP COLUMN IF EXISTS "distanceSource",
     DROP COLUMN IF EXISTS "address",
     DROP COLUMN IF EXISTS "starRating",
     DROP COLUMN IF EXISTS "roomCount",
     DROP COLUMN IF EXISTS "ratesUrl",
     DROP COLUMN IF EXISTS "retiredReason",
     DROP COLUMN IF EXISTS "verifiedAt";
   DELETE FROM _prisma_migrations WHERE migration_name = '20261113000000_competitor_registry_and_jobs';
   COMMIT;
   ```
2. **Pemulihan Penuh dari Backup:**
   Jika integritas data terganggu, pulihkan dari cadangan dump pre-flight yang dibuat pada Bagian 2 menggunakan `pg_restore`.

---

## 8. Langkah Pengarsipan MarketInsight Usang (Temuan D4)

Jalankan query berikut di Supabase SQL Editor atau via `psql` untuk mengarsipkan insight intelijen pasar sebelum 1 November 2026 yang memiliki nilai confidence/prioritas statis lama:

```sql
UPDATE "MarketInsight"
SET status = 'archived', "activeFingerprint" = NULL
WHERE status = 'active' AND "generatedAt" < '2026-11-01';
```

**Kriteria Keberhasilan:**
- Insight usang bertanggal 2026-10-22 dengan prioritas 95–100 dan confidence 92–98 diubah statusnya menjadi `archived`.
- Tidak ada spanduk insight usang yang memuat data karangan yang tampil di antarmuka publik.


## Tambahan dari verifikasi Claude Code (13 Nov 2026)

Langkah berikut melengkapi rencana di atas dan hanya dijalankan pemilik repo.

1. **Jalur skrip pindah ke `scripts/ops/`.** `package.json` (`prebuild`) dan workflow `nightly-market-scrape.yml` serta
   `morning-market-briefing.yml` kini memanggil `scripts/ops/…`. Ketiganya harus ter-deploy bersamaan; salinan lama di
   akar `scripts/` sudah dihapus. `scripts/ops/migrate-production.mjs` kini mencari migrasi di `../../prisma/migrations/`.
2. **Label sumber ulasan.** Ulasan berlabel `Google Maps` yang URL-nya Google Travel dilabel ulang (di lokal: 164 baris):
   `UPDATE "CompetitorReview" SET source = 'Google Travel', version = version + 1 WHERE source = 'Google Maps' AND "sourceUrl" LIKE '%/travel/%';`
   Uji kering dulu dengan `SELECT count(*)` memakai syarat yang sama.
3. **Registri pembanding.** Kolom `verifiedAt` dibiarkan kosong saat seed; isi hanya bila tempat benar-benar diperiksa.
   Anyer Family KTV tidak dimasukkan (tempat fiktif).
4. **Pengaman tulis.** `lib/db.ts` kini menolak tulis ke basis data non-lokal dari mesin kerja kecuali
   `ALLOW_PRODUCTION_WRITE=1`. Runtime Vercel (`VERCEL=1`) dan GitHub Actions (`CI=true`) tetap boleh menulis, jadi job
   malam dan aplikasi live tidak terpengaruh.
5. **Sosmed.** Scraping DOM Instagram dihentikan (ADR-004). Job malam mencatat langkah sosmed sebagai `partial` dengan
   alasan "Instagram Graph API belum tersambung" sampai kredensial resmi diisi.
6. **Variabel baru.** `SESSION_SECRET` (wajib di Vercel; mengganti nilainya mencabut semua sesi) dan
   `PUPPETEER_NO_SANDBOX` (hanya untuk mesin Linux lokal, jangan diisi di Vercel).

## Tambahan 14 Nov 2026: perombakan Insight Pasar (Claude Code)

Semua langkah di bawah dijalankan pemilik. Tidak ada yang sudah diterapkan ke produksi; DB lokal sudah memakai semuanya.
Setiap skrip tulis menolak basis data produksi kecuali `ALLOW_PRODUCTION_WRITE=1` diset sengaja.

1. **Migrasi** (otomatis lewat prebuild `scripts/ops/migrate-production.mjs` saat deploy):
   `20261114000000_competitor_compset_role`, `20261114010000_market_macro_stat`, `20261114020000_competitor_fact`.
2. **Registri pembanding** (ADR-008): `scripts/ops/seed-competitor-registry.ts`. Mengarsipkan Allisa, Mutiara Carita,
   Dewa Laut, Resort Prima, West Cove, MaxOne, Anyer Wonderland, dan empat nama sub-venue Aston dari skrip sintetis
   (termasuk Bale-Bale Spa ASTON yang ada di Jakarta); mengganti nama Lighthouse; menambah Daiva Spa dan Bliss Spa;
   mengisi `compsetRole`, jarak tempuh, jumlah kamar, dan situs resmi. Hawaii Resort menjadi acuan.
3. **Rating dan jumlah ulasan karangan**: jalankan isi `q9` berikut setelah uji kering dengan `SELECT count(*)` memakai
   syarat yang sama, lalu biarkan job rating malam mengisi ulang dari Google Maps.
   ```sql
   UPDATE "Competitor" SET rating = NULL, "reviewCount" = NULL, "ratingSource" = NULL, "ratingSourceUrl" = NULL, version = version + 1
   WHERE category IN ('resto','bar','spa') AND "ratingObservedAt" IS NULL AND (rating IS NOT NULL OR "reviewCount" IS NOT NULL);
   UPDATE "Competitor" SET "reviewCount" = NULL, version = version + 1
   WHERE category IN ('resto','bar','spa') AND "ratingObservedAt" IS NOT NULL AND "reviewCount" IS NOT NULL;
   ```
4. **Ulasan ganda**: snapshot produksi 13 Nov memuat ulasan yang sama dengan dua externalId (versi lama crawler
   memasukkan tanggal relatif ke externalId). `scripts/ops/archive-duplicate-reviews.ts` tanpa argumen hanya menghitung;
   `--apply` mengarsipkan (bukan menghapus). Jumlah barisnya dibaca dari uji kering sebelum `--apply`.
5. **TPK BPS**: `scripts/ops/fetch-bps-tpk.ts` dengan URL rilis BPS Banten 4 Mei 2026 (TPK Maret 2026 47,14%). Untuk
   menemukan rilis baru otomatis, daftarkan kunci gratis BPS WebAPI lalu isi `BPS_WEBAPI_KEY` di Vercel dan secret
   GitHub Actions. Tanpa kunci, langkah "makro" pembaruan penuh dilewati dengan alasan tertulis.
6. **Fakta profil pesaing** (ADR-009): `scripts/ops/collect-competitor-profiles.ts` (sekitar 40 panggilan Gemini).
   Tempat tanpa situs resmi atau yang situsnya tidak menghasilkan kutipan terverifikasi tampil "Belum ada data" di PDF.
7. **Omset September 2026**: angka 262.410.000 di DB lokal adalah angka pemilik yang dulu tertanam di kode, dipakai
   lokal atas persetujuan pemakai. Di produksi, impor angka pembukuan lewat halaman Omset, Target dan Strategy.
8. **Dependensi baru**: `3d-force-graph@1.73.4` (dipatok, sama dengan `graphify-out/graph.html`). Jalankan `npm ci`.
9. **Verifikasi setelah deploy**: Insight Pasar menampilkan Market Cap kamar resort, Langkah 3 memuat audit pembanding
   dan rekomendasi pemasaran, Knowledge Graph memuat peta 3D, dan PDF Rapat Senin per outlet berisi Bagian 1 Sanghyang
   plus satu bagian per pembanding.

## Tambahan 14 Nov 2026 (lanjutan): outlet di dalam hotel, minimal ulasan, dan Galeri Pesaing per outlet

Lanjutan bagian di atas, juga dijalankan pemilik. DB lokal sudah memakai semuanya. Urutannya penting karena seed
registri menulis ulang outlet dan peran setiap baris.

1. **Migrasi** `20261114030000_competitor_parent` (kolom `Competitor.parentId`, otomatis lewat prebuild saat deploy).
2. **Seed registri** `scripts/ops/seed-competitor-registry.ts`. Mengarsipkan enam resto dan bar mandiri yang ulasan
   Google-nya di bawah 50 (Pondok Cirebone, The Bellezza Pool Bar, Chrysoberil Lounge, ALPS Sky Lounge, Rumah makan Way
   Muli Anyer, Pondok Ikan Bakar Khas BAROKAH), menautkan Upper Circle, Lighthouse, Daiva Spa, dan Bliss Spa ke hotel
   induknya, dan menambah D'Bistro ke outlet Lighthouse.
3. **Aturan pembanding** `scripts/ops/apply-compset-rules.ts`: tanpa argumen hanya menampilkan baris yang akan
   diarsipkan; `--apply` mengarsipkan dengan alasan dan tanggal. Jalankan setelah job rating malam mengisi jumlah ulasan.
4. **Fakta outlet hotel** `scripts/ops/collect-competitor-profiles.ts --fokus outlet` (paling banyak 4 halaman per
   hotel, satu panggilan Gemini per halaman; 14 Nov lokal memakai sekitar 25 panggilan). Data resmi operator
   Archipelago (Aston) dibaca dari llms.txt tanpa Gemini. Laporan skrip menyebut setiap fakta yang ditolak beserta
   alasannya.
5. **Outlet hotel ke registri** `scripts/ops/sync-hotel-venues.ts` lalu `--apply`. Di DB lokal hasilnya 14 outlet hotel,
   termasuk Serai Restaurant dan Sarasa Lounge (Novus Jiva) yang baru terbaca setelah perbaikan bagian fakta.
6. **Foto outlet hotel** `scripts/ops/collect-venue-photos.ts` lalu `--apply` (satu panggilan Gemini per outlet yang
   punya foto). Skrip ini menulis `lib/market/competitor-gallery.data.json` dan
   `lib/market/competitor-visual-insights.data.json`, jadi hasilnya ikut commit dan deploy, bukan ditulis ke DB. Berkas
   yang sekarang sudah memuat 10 foto resmi dari 9 outlet hotel (14 Nov).
7. **Verifikasi setelah deploy**: Langkah 2 D'Bistro menampilkan 11 pesaing termasuk restoran hotel; Galeri Pesaing
   Dragon Beach Club tidak menampilkan foto kamar, kolam, atau kamar mandi; Knowledge Graph menautkan outlet hotel ke
   hotel induknya ("berada di dalam").

## Tambahan 14 Nov 2026 (lanjutan): jumlah kamar Sanghyang, promo Sanghyang, dan PDF Semua Outlet

Juga dijalankan pemilik. DB lokal sudah memakai semuanya. Tidak ada migrasi skema.

1. **Jumlah kamar Sanghyang 61** (data internal tim, disampaikan pemakai). Angka 103 sebelumnya tidak punya sumber. Seed
   registri (`scripts/ops/seed-competitor-registry.ts`) dan `lib/market/hotel-compset.data.json` sudah memakai 61, jadi
   menjalankan seed mengoreksi baris produksi. Market Cap kamar turun dari Rp 20,41 M menjadi Rp 20,11 M per bulan;
   pangsa aktual dari pembukuan tidak berubah.
2. **Status jumlah kamar pesaing** (sumbernya tertulis di `hotel-compset.data.json`): Mövenpick 219, Aston 101, Novus Jiva
   136 (kamar hotel, tanpa vila), dan Jayakarta Villas 48 dari situs resmi atau data resmi operator; Hawaii 73 dari lima
   OTA yang konsisten; Mambruk 133 dan Marbella 300 hanya dari listing OTA dan belum terkonfirmasi resmi. Konfirmasi dari
   tim (mis. lewat PHRI atau kontak langsung) bisa langsung mengganti angka dan sumbernya.
3. **Promo Sanghyang** `scripts/ops/collect-own-promos.ts` (juga berjalan di langkah "situs" pembaruan penuh): kartu
   penawaran https://sanghyang.com/offers dibaca tanpa Gemini, dan program bulanan tim marketing diimpor dari
   `lib/market/own-promos-team.data.json`. Berkas itu perlu diperbarui tim setiap bulan; setiap butir membawa status
   verifikasi ke situs resmi dan media sosial.
4. **Verifikasi media sosial**: Instagram @sanghyangresort dan Facebook resmi melarang perayap di robots.txt dan butuh
   login, jadi belum bisa dibaca backend. Jalur sahnya Instagram Graph API untuk akun Sanghyang sendiri: isi
   `INSTAGRAM_GRAPH_ACCESS_TOKEN` dan `INSTAGRAM_BUSINESS_ACCOUNT_ID` di Vercel dan secret GitHub Actions.
5. **Verifikasi setelah deploy**: PDF "Semua Outlet" berisi ringkasan enam outlet lalu enam bab (57 halaman di DB
   lokal); bagian Sanghyang di setiap PDF outlet memuat promo aktif beserta status verifikasinya; Knowledge Graph punya
   jenis simpul "Promo Sanghyang" yang terpisah dari "Promo pesaing".
6. **Hawaii Resort dikeluarkan** (permintaan pemakai 14 Nov 2026): seed registri mengarsipkannya dengan alasan bintang 3,
   jadi peran acuan tidak lagi muncul di PDF maupun tampilan. PDF "Semua Outlet" menjadi 55 halaman di DB lokal.

## Tambahan 15 Nov 2026: harga menu pesaing dan istilah "pengelola"

Tidak ada migrasi skema dan tidak ada tulisan ke DB produksi; datanya ikut deploy sebagai berkas.

1. **Harga menu pesaing** ada di `lib/market/competitor-menu.data.json` (24 pembanding F&B, bar, dan spa). Sumbernya:
   toko daring resmi Beach Point (iSeller, 100 item), unggahan Instagram resmi Andalan, dan foto menu unggahan pengguna
   di tab Menu Google Maps untuk 10 tempat yang dibaca Gemini lewat `scripts/ops/read-competitor-menus.ts --apply`
   (8 tempat menghasilkan harga; foto Ikan Bakar Tanjung Pinang 88 dan Omah Laut tidak memuat harga). Kunci foto dan
   kisaran "per orang" diambil lewat Chrome pemakai karena Chrome headless di server tidak mendapat tab Menu.
2. **Hasil di PDF**: subbagian "Harga menu & layanan" memuat jumlah item, rentang harga per porsi atau per item (tanpa
   tambahan, biaya kemasan, dan harga per berat atau per jam), 12 contoh dari tiap kategori, dan sumbernya. Kisaran
   belanja per orang dari pengguna Google Maps dicetak terpisah dan diberi label. Sembilan venue hotel tanpa harga
   menulis Belum ada data beserta sumber yang sudah diperiksa (situs resmi, Google Maps, pencarian web).
3. **Batas data**: tanggal foto unggahan pengguna tidak tercatat, jadi harganya bisa lebih lama dari harga sekarang.
   Sorotan "MENU" Instagram hanya terbuka setelah login, dan Instagram resmi hotel pembanding belum diperiksa. Harga
   pesaing belum dicocokkan per item dengan menu Sanghyang, jadi indeks harga F&B di dasbor tetap kosong.
4. **Istilah**: "Profil dan identitas operator" menjadi "Profil dan identitas usaha", label "Operator / jaringan" menjadi
   "Pengelola / merek" (isinya pengelola, grup hotel, atau merek; "jaringan" terbaca seperti jaringan internet), dan teks
   fakta llms.txt menjadi "menurut data resmi pengelola hotel". Prompt fakta profil (`lib/market/competitor-facts.ts`)
   kini meminta kata "dikelola", "grup", atau "merek". Fakta Aston dan Marbella yang tersimpan di produksi masih memakai
   teks lama sampai profilnya dikumpulkan ulang (`scripts/ops/collect-competitor-profiles.ts "Aston Anyer Beach Hotel"
   "Marbella Place Anyer by Jayakarta"`, juga bagian dari pembaruan penuh). Di DB lokal keduanya sudah diperbarui.
5. **Verifikasi setelah deploy**: PDF Sunset Grill 20 halaman, D'Bistro 19, D'Bar 15, Semua Outlet 64 di DB lokal;
   kolom "Harga menu (rentang)" matriks terisi untuk tempat yang punya sumber; kata "operator" tidak tercetak.
6. **Knowledge Graph**: seret simpul dimatikan (`enableNodeDrag(false)` di `components/knowledge-graph/graph-3d.tsx`).
   Setiap klik simpul sebelumnya melempar `TypeError: Cannot read properties of undefined (reading 'x')`, karena
   3d-force-graph 1.73.4 mengirim `pointerup` buatan yang tidak cocok dengan OrbitControls three 0.187. Klik simpul, putar,
   dan zoom tetap berfungsi; diverifikasi di browser dengan 0 galat.
7. **Harga menu pesaing di web**: langkah 3 Insight Pasar (outlet F&B, bar, dan spa) menampilkan daftar "Harga menu pesaing"
   per outlet: rentang harga per porsi, kisaran per orang dari pengguna Google Maps, 8 contoh item, sumber, dan sumber
   yang sudah diperiksa untuk tempat tanpa harga. Datanya ikut respons `GET /api/market-intelligence/summary`
   (`competitorMenus`) dari `lib/market/competitor-menu.ts`; URL foto menu tidak dikirim ke browser. Semua Outlet dan
   Kamar & Resort tidak menampilkan daftar ini. Diverifikasi di browser pada lebar desktop dan ponsel (390 px), papan
   ketik, dan konsol tanpa galat.
8. **Hasil tinjauan subagen `code_reviewer` (15 Nov 2026, vonis "siap dengan perbaikan kecil") sudah diterapkan**:
   - `normalizeMenuItems` gagal cepat bila jawaban Gemini bukan daftar.
   - Skrip baca menolak menimpa daftar berisi dengan hasil kosong (kecuali `--izinkan-kosong`) dan menyimpan per tempat.
   - Kategori dibandingkan tanpa token harga, hidangan sama di dua versi menu tidak dicatat dua kali, dan satuan
     berpengali ditolak.
   - Paket promo dan baris "Add …" tidak masuk rentang harga; matriks Andalan kini memakai kisaran per orang
     (Rp 50.000–75.000, 43 pengguna).
   - Koreksi nama Kalani tercatat beserta alasannya di berkas data.
   - robots.txt yang menjawab 5xx kini dianggap larangan penuh (RFC 9309).
   - Teks web dan PDF tidak lagi menjanjikan daftar lengkap di PDF dan tidak menunjuk "di bawah" di tempat yang salah.
   - Sepuluh foto-maps dibaca ulang: RM.MUARO 90 item, Kalani 56, BM Seaside 60, tanpa duplikat.

## Tambahan 15 Nov 2026 (lanjutan): periode, radar promo multi-sumber, berita per outlet, dan susunan halaman

Tidak ada migrasi skema. Semua berlaku setelah deploy; diverifikasi di DB lokal dan browser.

1. **Tanpa nama mesin AI**: PDF dan web tidak lagi menyebut nama mesin AI atau model; cukup sumber dan tanggal
   pembacaan. Kolom "Peran" di matriks PDF dihapus.
2. **Radar promo multi-sumber** (`lib/market/promo-radar.ts` `mergePromoCaptures`): penawaran yang sama dari Instagram
   dan situs resmi menjadi satu kartu dengan tombol untuk setiap sumber; tanggal dari poster, platform dari URL. Dipakai
   radar web, PDF, dan Knowledge Graph. Halaman penawaran Marbella memang tidak punya tautan per penawaran, jadi promo
   yang hanya ada di situs tetap menaut ke /offers/.
3. **Periode Insight Pasar** (`lib/market/date-range.ts`): pemilih rentang (30 hari, 90 hari, tahun ini, atau kustom
   dalam hari WIB). Summary API menerima `from`/`to`; promo tampil bila berlaku atau diumumkan di rentang, berita dan
   tarif disaring tanggalnya. Ulasan tetap memakai jendelanya sendiri karena ulasan outlet terlalu jarang (30 hari
   terakhir: 0 ulasan baru untuk lima outlet F&B).
4. **Berita per outlet di Insight Pasar** (`lib/market/news-outlets.ts`, bagian "Berita relevan"); menu Newsletter
   dihapus dari navigasi, penyusun newsletter tetap di rute `/` lewat tautan "Susun newsletter".
5. **Rekomendasi pemasaran** dipindah dari Langkah 3 Insight Pasar ke halaman Omset, Target dan Strategy (`#rekomendasi`).
   Bagian tujuan per outlet kini memuat "Rekomendasi dari semua faktor" (`lib/market/outlet-action-plan.ts`): kata
   tamu, rating dibanding median pesaing, harga menu pesaing atau pangsa pasar kamar, promo pesaing, dan berita.
6. **robots.txt 5xx** dianggap larangan penuh (RFC 9309), 4xx tetap berarti tidak ada larangan.
7. **Relevansi Galeri Pesaing**: setiap foto dinilai subjek utamanya; foto orang berpose, kendaraan, bangunan lain,
   rapat, dokumen, atau pemandangan tanpa tempat usaha diarsipkan beserta alasannya dan tidak tampil (28 dari 166 foto;
   Star Queen tinggal 1 foto etalase makanan). Data ikut deploy sebagai berkas JSON.
8. **Akun sosial registri**: Star Queen mendapat Instagram resmi @starqueen2236 dan alamat lengkap dari bio (dicek
   pemakai, alamat sama dengan Google Maps); instagramUrl Kalani yang berupa URL pencarian Maps dan 12 tiktokUrl
   halaman tagar dikosongkan. DB lokal sudah; untuk produksi pemilik menjalankan
   `scripts/ops/fix-competitor-social.ts --apply` dengan env produksi (tanpa flag hanya uji kering).
9. **Pembaruan penuh dan tombol**: status jujur per langkah (gagal, sebagian, dilewati beserta alasan); GET panel tidak
   menulis ke DB (lingkungan yang menolak tulis kini mendapat 403 berpenjelasan, bukan 500); SSE dengan ping 15 detik dan
   sambung ulang; Knowledge Graph mengambil ulang data setelah pembaruan, saat jendela kembali dilihat, dan lewat tombol
   "Muat ulang"; kegagalan Crawl4AI di workflow malam tidak lagi menghentikan job (tarif lewat cadangan Chrome).
   Akibatnya job malam merah bila satu langkah gagal total; perlu keputusan pemilik bila itu terlalu ketat.
10. **Penemuan pesaing baru** (`scripts/ops/discover-competitors.ts`, uji kering bawaan; `--apply` hanya atas keputusan
    pemilik): pencarian Google Maps per kategori di sekitar Sanghyang, cocokkan ke registri, jarak tempuh lewat OSRM,
    lalu aturan pembanding. Uji kering 16 Nov: 287 tempat, 252 kandidat baru, 37 lolos aturan. Daftar itu masih memuat
    tempat yang tidak sejenis secara bisnis (pantai umum, layanan pijat panggilan, warung kecil), jadi belum dipasang ke
    pembaruan otomatis. Server demo OSRM hanya untuk pemakaian ringan; untuk jadwal rutin perlu OSRM sendiri atau API
    rute berbayar.

## Tambahan 16 Nov 2026: pesaing D'Bistro dan Sunset Grill, promo per outlet, dan alasan pembanding

Tidak ada migrasi skema. Satu perubahan data registri (kolom `outlets`) dijalankan pemilik; sisanya berlaku setelah
deploy. Semua sudah diterapkan dan diuji di DB lokal.

1. **Pemetaan pesaing resto (keputusan pemilik)**: restoran di dalam hotel pembanding bersaing dengan D'Bistro, bukan
   Sunset Grill; resto dan kafe mandiri bersaing dengan Sunset Grill, bukan D'Bistro. Outlet lain tetap (Kamalika dan
   Beach Point juga Dragon Beach Club; Lighthouse Restaurant & Bar Mambruk tetap D'Bistro, D'Bar, dan Dragon Beach
   Club). Hanya pembanding aktif yang diubah; baris yang diarsipkan dibiarkan seperti saat diarsipkan.
   - Uji kering dengan env produksi (hanya membaca):
     `node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/ops/remap-resto-outlets.ts`
     Di DB lokal hasilnya 14 resto pembanding diperiksa dan 6 berubah: Hotel Pier Aston Anyer dan Sunset Cafe Aston Anyer
     menjadi `dbistro`; Andalan Beach Resto & Coffee, BM Seaside View Cafe & Resto, Kalani Beach Resto Anyer, dan Omah
     Laut Cafe & Resto menjadi `sunset-grill`. Simpan keluaran uji kering produksi: baris `nama: lama -> baru` adalah
     catatan untuk mengembalikan nilai lama bila pemilik memutuskan rollback.
   - Terapkan (setelah cadangan di bagian 2):
     `ALLOW_PRODUCTION_WRITE=1 node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/ops/remap-resto-outlets.ts --apply --produksi`
     Tanpa `--produksi` skrip menolak menulis ke DB selain DB kerja lokal (127.0.0.1:55432/sanghyang_news). Setiap baris
     ditulis dengan OCC (kolom `version`); konflik menghentikan skrip tanpa menimpa.
   - Ulangi uji kering: harus "0 perlu diperbarui".
   - Seed registri (`scripts/ops/seed-competitor-registry.ts`) dan `scripts/ops/sync-hotel-venues.ts` sudah memakai aturan
     yang sama, jadi pemasangan ulang tidak mengembalikan pemetaan lama. Penemuan pesaing baru
     (`lib/market/competitor-discovery.ts`) kini memetakan resto dan kafe mandiri ke Sunset Grill.
2. **Promo pesaing per outlet** (`lib/market/outlet-filters.ts` `promoOutlets`): promo hotel yang menyebut outlet di
   dalam hotel itu (registri) mengikuti outlet venue tersebut; kata nama venue tidak dihitung sebagai kata kunci, jadi
   "Viral Sea Pool ... di Lighthouse Restaurant" masuk Kamar & Resort, bukan D'Bistro. Tanpa venue: kata kunci kata utuh
   (resto hotel, sarapan, makan malam ke D'Bistro; grill, seafood, bakar ke Sunset Grill; bar, lounge, mocktail,
   cocktail, DJ, pesta ke D'Bar dan/atau Dragon Beach Club; spa, pijat ke D'Spa; kamar, menginap, kolam renang ke
   Kamar & Resort), lalu kategori promo. Berlaku di Insight Pasar langkah 4, halaman Omset, dan rencana aksi. API
   ringkasan (`/api/market-intelligence/summary`) mengirim `competitorVenues` per promo dari registri
   (`lib/market/promo-venues.ts`).
3. **"Versi kita" per outlet** (`counterStrategyFor`): usulan yang menyebut outlet lain tidak tampil (mis. usulan
   Sunset Grill pada promo yang tampil di D'Bistro); usulan tanpa nama outlet tetap tampil. Kamar & Resort dan Semua
   Outlet menampilkan usulan paket menginap walau menyebut outlet lain sebagai bonus. Kalimat cadangan umum untuk promo
   tanpa usulan dihapus: tanpa usulan, "Versi kita" tidak tampil.
4. **Daftar "Dikeluarkan dari pembanding" tidak lagi tampil di web** (bagian "Hasil audit & validasi pembanding").
   Alasannya tetap tersimpan di registri. Halaman Metodologi masih menampilkan jumlah dan nama tempat yang dikeluarkan
   serta daftar "Resort yang dikeluarkan"; PDF Rapat Senin masih memuat kolom jumlah "Dikeluarkan" per outlet.
5. **Alasan pembanding spesifik per tempat** (`lib/market/compset-rationale.ts`): kalimat disusun dari fakta bersumber,
   bukan templat aturan. Penginapan: deskripsi dan pembeda dari situs resmi, bintang beserta sumbernya, jumlah kamar
   beserta sumbernya, jarak dan waktu tempuh beserta tanggal ukur, tarif OTA terbobot terhadap Sanghyang, dan rating.
   Resto, bar, dan spa: deskripsi situs resmi, hotel induk atau "mandiri", harga menu atau belanja per orang, ulasan,
   lalu alasan bersaing dengan outlet itu. Teks situs berbahasa Inggris (fakta Aston dari llms.txt) tidak dikutip.
   Kalimat yang sama dipakai kartu audit, tooltip langkah 2, dan PDF (setelah "Peran dalam laporan ini").

## Tambahan 17 Nov 2026: komentar sosmed publik tanpa login akun Sanghyang, Nemuru Grand Anyer Palazo, dan audit kompset seluruh outlet

Tidak ada migrasi skema Prisma. Semua perubahan skrip dan berkas statis (`hotel-compset.data.json`,
`competitor-menu.data.json`, `review-topics.data.json`, `competitor-gallery.data.json`) ikut terpasang saat deploy.

> Catatan 18 Nov 2026: butir 1 di bawah dibatalkan. Jalur YouTube dihapus atas permintaan pemakai; `YOUTUBE_API_KEY` tidak perlu diisi (lihat tambahan 18 Nov 2026).

1. **Komentar sosmed publik YouTube tanpa login akun Sanghyang** (`ADR-004`, `ADR-008`, `lib/market/adapters/youtube-data.ts`,
   `lib/market/social-sources.ts`, `lib/market/scrape-social-buzz.ts`):
   - **Yang perlu disiapkan di produksi (Vercel / `.env` server)**: tambahkan variabel lingkungan `YOUTUBE_API_KEY`
     (kunci proyek Google Cloud dengan **YouTube Data API v3** aktif; kuota baca publik saja, tidak memakai OAuth
     atau login akun YouTube Sanghyang).
   - Kredensial OAuth akun resmi Sanghyang (`INSTAGRAM_GRAPH_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`) tetap
     terpisah dan hanya diperlukan untuk metrik internal konten/iklan akun milik Sanghyang serta Business Discovery
     caption publik Instagram.
   - Komentar YouTube publik yang diambil API disimpan tanpa nama/pegangan pribadi (`author: null`), bertanda
     `rating: 0` ("Komentar publik", tidak dihitung dalam rata-rata bintang ulasan), bertaut ke komentar spesifik
     (`?v=<videoId>&lc=<commentId>`), dan otomatis dipangkas jika berumur lebih dari **30 hari** setiap kali
     pengambilan dijalankan (kepatuhan ToS YouTube III.E.4).
   - Instagram, Facebook (`robots.txt Disallow: /`), dan TikTok (`SlardarWAF`) tetap tidak dirayap komentarnya.

2. **Penerapan audit registri kompetitor ke produksi (`Nemuru Grand Anyer Palazo` & seluruh outlet)**:
   - Di DB kerja lokal, pembaruan registri telah dijalankan dan diuji lewat
     `scripts/ops/sync-comprehensive-audit.ts --apply` (terkunci khusus DB lokal `127.0.0.1:55432`).
   - Untuk menerapkan pembaruan registri yang sama ke produksi (setelah cadangan penuh di Bagian 2):
     1. Pastikan `scripts/ops/seed-competitor-registry.ts` telah disinkronkan (memuat `Nemuru Grand Anyer Palazo`,
        `Mambruk` 145 kamar resmi, status bintang 3 aktif `Patra Anyer` dan `THE WEST COVE HOTEL`, aktifnya kembali
        `The Bellezza Pool Bar` di bawah Nemuru, `Andalan`/`Kalani` pada `dragon-beach-club`, outlet hotel
        `TEMU KATSU RESTO`, `Nemuru Light house lounge and karaoke`, `Lagoon Restaurant Jayakarta`, `Alta Spa Marbella Anyer`,
        `Spa & Wellness Aston Anyer`, serta 10 outlet mandiri baru `sunset-grill`/`dbar`/`dspa`).
     2. Jalankan seed registri pada env produksi (hanya dilakukan pemilik):
        ```bash
        ALLOW_PRODUCTION_WRITE=1 node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/ops/seed-competitor-registry.ts
        ```
     3. Lengkapi kolom rating listing, kanal YouTube (`socialUrl`), Instagram/TikTok resmi Aston, dan fakta resmi
        (`CompetitorFact`) dengan menyalin nilai terverifikasi dari `scripts/ops/sync-comprehensive-audit.ts`
        atau menjalankan ulang job `ratings` serta `sync-hotel-venues.ts` setelah deployment.

3. **Keputusan terbuka untuk pemilik sebelum memasukkan hotel kota Cilegon Bintang 4**:
   - Audit Google Maps menemukan 3 hotel bintang 4 yang berjarak tempuh <= 25 km namun berkarakter hotel bisnis perkotaan
     di Cilegon, bukan resor pantai Anyer–Cinangka:
     - **The Royale Krakatau Hotel** (`19,07 km`, 248 kamar),
     - **Aston Cilegon Boutique Hotel** (`21,83 km`),
     - **Forbis Hotel** (`22,97 km`, 124 kamar).
   - Ketiganya belum dimasukkan ke `Kamar & Resort` sambil menunggu keputusan pemilik apakah pembanding kamar Sanghyang
     juga mencakup hotel bisnis kota di Cilegon.

## Tambahan 17 Nov 2026 (Claude Code): Promo dan Events, isi paket dari sumber, dan koreksi pembanding

1. **Migrasi `20261117000000_promotion_kind_details`** (aditif, aman diterapkan sebelum kode baru):
   enum `PromotionKind` (`promo`, `event`), kolom `kind` (boleh NULL), `details` dan `terms` (`TEXT[]`, bawaan kosong)
   di `CompetitorPromotion`. Perhatikan bahwa `prebuild` (`scripts/ops/migrate-production.mjs`) menerapkan migrasi ini ke
   produksi saat deploy berikutnya. Bila ingin menerapkannya lebih dulu secara manual (setelah cadangan di Bagian 2):
   ```bash
   ALLOW_PRODUCTION_WRITE=1 node --env-file=.env.local node_modules/prisma/build/index.js migrate deploy
   ```
2. **Isi promo dan pemisahan Promo/Events di produksi** tidak butuh skrip terpisah: langkah "situs" pada tombol
   "Perbarui Semua Data" dan jadwal malam membaca ulang halaman penawaran pesaing (teks penuh, isi paket disalin dari
   halaman, tanggal kalender WIB) dan memperbarui baris yang sudah ada, lalu AI menandai jenis baris lain yang belum
   punya jenis. Baris Instagram lama dengan tanggal berakhir `23:59:59Z` tetap tampil sehari lebih lambat sampai digeser;
   SQL berikut sama dengan `scripts/ops/fix-promo-wib-dates.ts` (yang terkunci ke DB lokal). Kolom tanggal Prisma
   bertipe `TIMESTAMP(3)` tanpa zona dan berisi UTC, jadi pergeseran ditulis sebagai interval, bukan `AT TIME ZONE`:
   ```sql
   BEGIN;
   UPDATE "CompetitorPromotion" SET "endsAt" = "endsAt" - interval '7 hours', "version" = "version" + 1
    WHERE "source" IN ('Instagram (dibaca Gemini)', 'Situs resmi (dibaca Gemini)')
      AND to_char("endsAt", 'HH24:MI:SS.MS') = '23:59:59.000';
   UPDATE "CompetitorPromotion" SET "startsAt" = "startsAt" - interval '7 hours', "version" = "version" + 1
    WHERE "source" IN ('Instagram (dibaca Gemini)', 'Situs resmi (dibaca Gemini)')
      AND to_char("startsAt", 'HH24:MI:SS.MS') = '00:00:00.000';
   -- Jam lokal yang tersimpan sebagai UTC (mulai dan berakhir di tanggal UTC yang sama tetapi melewati tengah malam WIB,
   -- mis. A Magical Mermaid Day 09:00Z–18:00Z): jadikan sehari penuh WIB pada tanggal itu karena jamnya tidak bersumber.
   UPDATE "CompetitorPromotion"
      SET "startsAt" = "startsAt"::date - interval '7 hours',
          "endsAt" = "startsAt"::date + interval '17 hours' - interval '1 second',
          "version" = "version" + 1
    WHERE "endsAt" IS NOT NULL
      AND "startsAt"::date = "endsAt"::date
      AND ("startsAt" + interval '7 hours')::date <> ("endsAt" + interval '7 hours')::date;
   COMMIT;
   ```
3. **Registri Kamar & Resort** (lokal: `scripts/ops/fix-resort-compset-2026-11-17.ts --apply`; produksi lewat seed registri
   yang sudah disamakan): Hawaii kembali pembanding (Traveloka 4.0), My Pisita Anyer Resort ditambahkan (Google bintang 4,
   0,7 km), Nemuru berkelompok resort dengan alamat entity Google Hotels, jarak Patra 4,4 km dan Resort Prima 21,6 km
   (OSRM), serta `ratesUrl` Jayakarta diganti entity Jayakarta sendiri. Harga dan ulasan yang terlanjur tercatat sebagai
   Jayakarta padahal dari entity Resort Prima dipindah ke Resort Prima (bukan dihapus):
   ```sql
   BEGIN;
   UPDATE "CompetitorPriceSnapshot" SET "competitorId" = (SELECT "id" FROM "Competitor" WHERE "placeId" = 'prima_anyer')
    WHERE "competitorId" = (SELECT "id" FROM "Competitor" WHERE "placeId" = 'jayakarta')
      AND "sourceUrl" LIKE '%ChgI_9neisz9vOACGgwvZy8xcHpwaGt4MnMQAQ%';
   -- Ulasan: pindahkan yang belum ada di Resort Prima; salinan ganda diarsipkan, bukan dihapus.
   UPDATE "CompetitorReview" r SET "archivedAt" = now(), "version" = r."version" + 1
    WHERE r."competitorId" = (SELECT "id" FROM "Competitor" WHERE "placeId" = 'jayakarta')
      AND r."sourceUrl" LIKE '%ChgI_9neisz9vOACGgwvZy8xcHpwaGt4MnMQAQ%'
      AND EXISTS (SELECT 1 FROM "CompetitorReview" t WHERE t."competitorId" = (SELECT "id" FROM "Competitor" WHERE "placeId" = 'prima_anyer')
                    AND t."source" = r."source" AND t."externalId" = r."externalId");
   UPDATE "CompetitorReview" r SET "competitorId" = (SELECT "id" FROM "Competitor" WHERE "placeId" = 'prima_anyer'), "version" = r."version" + 1
    WHERE r."competitorId" = (SELECT "id" FROM "Competitor" WHERE "placeId" = 'jayakarta')
      AND r."sourceUrl" LIKE '%ChgI_9neisz9vOACGgwvZy8xcHpwaGt4MnMQAQ%' AND r."archivedAt" IS NULL;
   COMMIT;
   ```
   Menit berkendara dari OSRM dikosongkan (`scripts/ops/clear-osrm-drive-minutes.ts`); km tetap dipakai.
4. **Registri resto, bar, spa** (lokal: `scripts/ops/fix-fnb-compset-2026-11-17.ts --apply`; seed dan
   `sync-comprehensive-audit.ts` sudah disamakan): Kamalika, Andalan, dan Kalani hanya pembanding Sunset Grill (tidak lagi
   Dragon Beach Club); Lighthouse Mambruk lepas dari D'Bistro; Hotel Pier Aston pindah ke Sunset Grill; tiga venue Aston
   memakai situs hotel induk; West Cove Terrace (restoran hotel bintang 3 yang dikeluarkan) dan Alta Spa Marbella (tidak
   ada di situs resmi Marbella) diarsipkan dengan alasan tertulis.

## Tambahan 18 Nov 2026 (Claude Code): berita dibaca isinya, ulasan per periode, Langkah 2 bersumber, YouTube dihapus

1. **Migrasi `20261118000000_news_reading`** (ADR-011): kolom `Article.publisherUrl`; kolom hasil pembacaan di
   `MarketItem` (`readStatus`, `readAt`, `readNote`, `readSummary`, `outlets`, `articleUrl`, `distanceKm`); enum
   `NewsReadStatus`; tabel cache `GeoPlace`. Semuanya tambahan, jadi aman diterapkan otomatis oleh `prebuild`
   (`scripts/ops/migrate-production.mjs`) saat deploy. Tidak ada data yang dihapus.
2. **Berita**: sejak rilis ini langkah "berita" (tombol dan jadwal malam) menyimpan origin penerbit dari RSS lalu
   membaca isi paling banyak 40 berita kandidat per jalan. Berita lama di produksi belum punya origin penerbit dan
   belum dibaca, jadi bagian "Berita relevan" baru terisi setelah beberapa malam. Bila pemilik ingin langsung terisi:
   - Isi origin penerbit: `scripts/ops/backfill-news-publishers.ts --map <berkas peta>` (peta nama penerbit dari
     atribut `<source url>` RSS; opsi `--rss` mencari per judul dan berhenti saat Google News menjawab 429, seperti
     yang terjadi di lokal 18 Nov 2026 setelah 126 pencarian).
   - Sesudah aturan penilaian berubah, hasil berstatus tertentu bisa dibaca ulang: `scripts/ops/reset-news-readings.ts --status relevan`.
   - Baca isi berita: `scripts/ops/read-news-backlog.ts` (memanggil `readCandidateNews` dengan batas lebih besar;
     kuota Gemini satu permintaan per 4 berita). Kedua skrip menulis ke basis data, jadi dijalankan pemilik dengan
     `ALLOW_PRODUCTION_WRITE=1` dan `DATABASE_URL` produksi lewat berkas env, bukan argumen perintah.
3. **Label ulasan Google** (ADR-003): ulasan "di Google" yang dibaca dari tab ulasan Google Travel kini berlabel
   `Google Maps`. Perayap baru langsung menulis label itu; baris lama perlu diganti supaya tidak tercatat ganda
   (pencocokan ulasan memakai sumber yang sama). Uji kering lalu jalankan di produksi:

   ```sql
   -- Uji kering: berapa yang berganti label dan berapa yang sudah ada sebagai Google Maps (akan diarsipkan).
   SELECT count(*) FROM "CompetitorReview" WHERE "source" = 'Google Travel';
   SELECT count(*) FROM "CompetitorReview" t
    WHERE t."source" = 'Google Travel'
      AND EXISTS (SELECT 1 FROM "CompetitorReview" m
                   WHERE m."source" = 'Google Maps' AND m."competitorId" = t."competitorId"
                     AND (m."externalId" = t."externalId" OR btrim(m."text") = btrim(t."text")));

   BEGIN;
   UPDATE "CompetitorReview" t
      SET "archivedAt" = NOW(), "version" = t."version" + 1
    WHERE t."source" = 'Google Travel' AND t."archivedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "CompetitorReview" m
                   WHERE m."source" = 'Google Maps' AND m."competitorId" = t."competitorId"
                     AND (m."externalId" = t."externalId" OR btrim(m."text") = btrim(t."text")));
   UPDATE "CompetitorReview" t
      SET "source" = 'Google Maps', "version" = t."version" + 1
    WHERE t."source" = 'Google Travel'
      AND NOT EXISTS (SELECT 1 FROM "CompetitorReview" m
                       WHERE m."source" = 'Google Maps' AND m."competitorId" = t."competitorId"
                         AND (m."externalId" = t."externalId" OR btrim(m."text") = btrim(t."text")));
   COMMIT;
   ```

   Di lokal (`scripts/ops/relabel-google-reviews.ts`): 219 baris berganti label, 0 duplikat.
4. **Perayap ulasan hotel**: urutan "Terbaru" di Google Travel ternyata tidak pernah aktif (kotak pilihan diklik
   tanpa dibuka), jadi yang terbaca selama ini 10 ulasan "Paling berguna". Sejak rilis ini urutan dibuka dengan benar
   dan 10 ulasan terbaru dibaca untuk semua sumber dan untuk tiap sumber (Google, Tripadvisor, Trip.com, dst.).
5. **Ulasan per periode**: summary API kini menyaring ulasan menurut tanggal ulasan di periode terpilih. Tidak ada
   perubahan data.
6. **YouTube dihapus** (ADR-004): hapus variabel `YOUTUBE_API_KEY` di Vercel atau `.env` server bila pernah diisi.
   Lalu bersihkan registri (uji kering dulu):

   ```sql
   SELECT id, name, "socialUrl" FROM "Competitor" WHERE "socialUrl" ~* '(youtube\.com|youtu\.be)';
   SELECT count(*) FROM "CompetitorReview" WHERE lower("source") = 'youtube' AND "archivedAt" IS NULL;

   BEGIN;
   UPDATE "Competitor"
      SET "socialUrl" = NULL, "version" = "version" + 1, "updatedAt" = NOW()
    WHERE "socialUrl" ~* '(youtube\.com|youtu\.be)';
   UPDATE "CompetitorReview"
      SET "archivedAt" = NOW(), "version" = "version" + 1
    WHERE lower("source") = 'youtube' AND "archivedAt" IS NULL;
   COMMIT;
   ```

   Di lokal (`scripts/ops/remove-youtube-social-urls.ts`): 5 `socialUrl` dikosongkan, 0 ulasan diarsipkan.
7. **Langkah 2 dan 4** hanya perubahan tampilan dan summary API; tidak ada perubahan data.

## Tambahan 18 Nov 2026 (lanjutan): Ekstensi Chrome (ADR-012) dan pembaruan `prebuild` migrasi

1. **Pembaruan `scripts/ops/migrate-production.mjs` untuk `prebuild` Vercel**:
   Skrip `prebuild` sebelumnya hanya mengecualikan `20261107000000_monthly_snapshot_and_goals`, sehingga 7 migrasi aditif periode 13–18 November 2026 akan ditolak sebelum `prisma migrate deploy` sempat berjalan. Kini `PENDING_PRODUCTION_MIGRATIONS` mendaftarkan ketujuh migrasi aditif berikut agar diizinkan untuk dijalankan otomatis oleh `prisma migrate deploy` saat `VERCEL_ENV === "production"`:
   - `20261113000000_competitor_registry_and_jobs`
   - `20261114000000_competitor_compset_role`
   - `20261114010000_market_macro_stat`
   - `20261114020000_competitor_fact`
   - `20261114030000_competitor_parent`
   - `20261117000000_promotion_kind_details`
   - `20261118000000_news_reading`

   Fungsi `findMissingHistoricalMigrations()` tetap mewajibkan seluruh migrasi baseline hingga `20261107000000_monthly_snapshot_and_goals` sudah tercatat selesai di `_prisma_migrations` produksi sebelum `prisma migrate deploy` dieksekusi.
2. **Ekstensi Chrome Sanghyang Market Sync (ADR-012) tanpa env atau cookie sosial di server**:
   - Tidak ada migrasi skema baru dan tidak ada variabel lingkungan rahasia baru yang perlu ditambahkan di Vercel.
   - Server tidak menyimpan maupun menerima cookie/login Instagram atau TikTok; sinkronisasi berjalan langsung di sesi Chrome staf melalui `externally_connectable` (ID tetap `kabomdcpiamnnncoifohknncamcddahl`) lalu mengirim batch ke `POST /api/marketing-sosmed/browser-sync` memakai cookie sesi dasbor *same-origin*.
3. **Packaging otomatis di fungsi serverless Vercel (`next.config.ts`)**:
   Konfigurasi `outputFileTracingIncludes` di `next.config.ts` otomatis menyertakan berkas ekstensi ke bundle fungsi Vercel pada dua rute:
   - `/api/admin/social-extension/download`: `./extension/sanghyang-social-sync/**` (merakit unduhan `.zip` terotentikasi secara deterministik melalui `node:zlib`).
   - `/api/marketing-sosmed/browser-sync`: `./extension/sanghyang-social-sync/manifest.json` (membaca versi serta `extensionId` terpin saat runtime).
4. **Kewajiban staf setelah deploy**:
   - Skrip batch Windows lokal lama (`.bat`), berkas teks pengantar lama di akar repo, dan skrip login/sesi peramban riset lokal sudah dihapus; staf langsung mengakses `https://sanghyang-news.vercel.app`.
   - Setiap staf wajib mengunduh ulang paket `.zip` versi terbaru dari tombol **Unduh Ekstensi (.zip)** di `/market-intelligence` atau `/marketing-sosmed`, mengekstrak folder `sanghyang-social-sync`, dan memuat ulang (*Load unpacked* / tombol muat ulang) di `chrome://extensions`.
5. **Verifikasi setelah deploy**:
   - `GET https://sanghyang-news.vercel.app/api/health?ready` mengembalikan status sehat.
   - Setelah masuk di `/login`, akses `/api/admin/social-extension/download` menghasilkan arsip `.zip` dan panel ekstensi di `/market-intelligence` serta `/marketing-sosmed` mendeteksi ekstensi yang terpasang di Chrome.
6. **Sinkronisasi seed & fixture CI (tanpa dampak ke DB produksi)**:
   - `scripts/ops/seed-competitor-registry.ts` telah disinkronkan penuh dengan registri `Competitor` terkini (72 baris, termasuk 10 outlet hotel dan `driveMinutes: null` pada baris OSRM).
   - `scripts/ops/ci-fixture.ts` bersama `tests/fixtures/ci-db/*.json` khusus dipakai untuk mengisi basis data uji loopback kosong pada GitHub Actions CI (`load` menolak host non-loopback dan tidak menyentuh produksi).


## Tambahan 19 Nov 2026 (Claude Code): DB produksi disamakan dengan DB lokal, hook pre-push (ADR-013)

Setelah push 19 Nov 2026 (deploy `f864b67`), Galeri Pesaing kosong dan banyak bagian Insight Pasar di produksi tanpa data,
padahal localhost:3001 lengkap. Skema dan migrasi produksi sudah sama; datanya yang tertinggal. Atas persetujuan pemakai
("Terapkan semuanya sekarang", 19 Nov 2026) DB produksi disamakan langsung dari mesin kerja ini.

1. **Sebab**:
   - Kolom registri pesaing (peran pembanding, outlet, hotel induk, `placeId`), `CompetitorFact`, `MarketMacroStat`,
     `GeoPlace`, omset, dan bacaan berita hanya pernah diisi skrip di DB lokal.
   - Job malam dan "Perbarui Semua Data" di produksi menulis tarif, ulasan, dan promo yang tidak ada di lokal.
   - Penyegaran produksi 19 Nov 03.45 UTC menandai berita "tidak_terbaca" (origin penerbit belum ada) dan bacaan gagal
     itu menimpa bacaan lokal yang berhasil karena lebih baru. Contoh di fixture tes: berita "relevan" di lokal menjadi
     "tidak_terbaca" di produksi.
   - 8 ulasan yang diarsipkan di lokal (duplikat) masih aktif di produksi. 10 promo yang tanggalnya sudah dikoreksi ke
     kalender WIB di lokal masih bertanggal lama di produksi.
2. **Yang dijalankan** (`scripts/ops/sync-production-data.ts --apply`, cadangan kedua DB di `backups/sinkron-*.json`):
   - Registri: duplikat "Aston Anyer Beach Hotel & Aquavillas" digabung ke "Aston Anyer Beach Hotel" lalu dihapus; 48
     rating produksi yang lebih baru ditarik ke lokal; `updatedAt` 72 baris registri produksi disamakan dengan lokal.
   - Pengamatan: 361 artikel berita ke produksi dan 533 ke lokal (51 butir pasar), 91 bacaan berita disatukan, 118 origin
     penerbit diisi, 159 `createdAt` butir pasar disamakan; 116 tarif pesaing dan 11 tarif Sanghyang ke lokal; 38
     tangkapan promo ke produksi dan 44 ke lokal, 10 isi promo dikoreksi di produksi; 14 ulasan ke lokal, 8 ulasan
     diarsipkan di produksi, 2 teks ulasan terpotong diganti teks utuh.
   - Uji kering sesudahnya: nol perubahan di semua langkah. Jumlah baris setiap tabel data sama: Competitor 72, Article
     11.820, MarketItem 893, CompetitorPriceSnapshot 335 (379 sebelum 44 salinan ganda Resort Prima dibuang, lihat butir 4),
     SanghyangPriceSnapshot 65, CompetitorPromotion 254,
     CompetitorReview aktif 530, CompetitorFact 145, GeoPlace 51, MarketInsight aktif 13.
3. **Hook pre-push** (sudah terpasang di mesin kerja ini lewat `bash scripts/ops/install-pre-push-hook.sh`): setiap
   `git push` ke `master` menjalankan `scripts/ops/sync-before-push.ts`: migrasi aditif yang belum tercatat di produksi
   diterapkan dengan `prisma migrate deploy`, lalu sinkron dua arah di atas. Migrasi berisi `DROP`, `RENAME`, atau ganti
   tipe kolom membatalkan push (urutannya: push kode dengan `--no-verify`, tunggu Vercel READY, lalu migrasi dan sinkron
   manual). Sinkron yang gagal juga membatalkan push. Push ke cabang lain tidak menyentuh DB.
4. **Insiden saat sinkron dan perbaikannya**: kunci tarif versi pertama memuat nama pesaing, sehingga 53 tarif entity Resort
   Prima Anyer yang audit 17 Nov sudah dipindah dari Jayakarta ke Resort Prima di lokal tersalin balik dari produksi sebagai
   Jayakarta (tes `resort-compset-audit.test.ts` menangkapnya). `scripts/ops/fix-prima-rates-2026-11-19.ts --apply` di kedua DB:
   44 salinan ganda dihapus, 9 sisanya dipindah ke Resort Prima (cadangan `backups/prima-rates-*.json`). Identitas tarif dan
   promo kini memakai alamat sumber dan atribusi pesaing mengikuti lokal, jadi pemindahan oleh skrip koreksi lokal ikut ke
   produksi. Ringkasan juga kini memakai batas hari WIB (Vercel UTC, mesin kerja WIB) dan urutan cadangan untuk nilai seri.
5. **Yang tetap berbeda menurut rancangan**: heartbeat malam ("Terakhir diperbarui" dan ringkasan langkah) milik tiap
   lingkungan; log `ScrapeRun`/`ScrapeError`/`ScrapeLock`/`Source`.
6. **Kewajiban pemilik**:
   - Sebelum commit berikutnya: `git pull --ff-only origin master`. Job tarif kamar malam meng-commit
     `lib/market/resort-room-rates.data.json` ke `master` (3 commit 19 Nov: `d42c874`, `64d0a50`, `f864b67`), jadi
     ukuran pasar, pangsa pasar, direktori OTA, dan tingkat harga audit pembanding baru sama setelah lokal menarik commit itu.
     Tanpa pull, GitHub menolak push.
   - Commit dan push perubahan kode urutan deterministik dan batas hari WIB (`lib/market/summary.ts`,
     `lib/market/competitor-comparison.ts`, `app/api/market-intelligence/summary/route.ts`) agar kutipan ulasan dan urutan
     baris di produksi sama dengan lokal.
   - Jangan memasang hook ini di komputer lain yang DB lokalnya tidak lengkap: hook menyalin kurasi lokal ke produksi.
7. **Verifikasi setelah deploy**: bandingkan `/api/market-intelligence/summary?period=30d&segment=all` di produksi dan
   localhost:3001 (sidik kanonis per blok). 19 Nov sebelum deploy kode urutan: berita, radar promo, jumlah, rating
   pesaing, menu pesaing, perbandingan tarif, dan pangsa ulasan sudah sama; Galeri Pesaing (15 tempat, 68 foto) dan
   Knowledge Graph (214 simpul, 631 relasi) sama. Perbandingan pesaing dengan kode urutan baru identik 57/57 dari kedua DB
   (`.agents/local/probe/evidence-hash.ts`). Target omset otomatis di Omset (+2,8% produksi, +5,8% lokal) dihitung dari
   `resort-room-rates.data.json`, jadi ikut sama setelah `git pull`.

## Tambahan 22 Nov 2026 (Claude Code): audit swarm Insight Pasar, kategori promosi, dan tarif resmi

Masuk ke produksi lewat push ke `master`. Hook pre-push mesin kerja Linux (ADR-013) menerapkan migrasi aditif lalu
menyamakan DB produksi dengan DB lokal.

- Migrasi aditif `20261121000000_promotion_type`: enum `PromotionType` dan kolom `CompetitorPromotion.promotionType`
  (nullable). Sudah masuk `PENDING_PRODUCTION_MIGRATIONS` di `scripts/ops/migrate-production.mjs` sebagai cadangan bila
  hook tidak berjalan.
- Data yang ikut tersinkron dari DB lokal:
  - Hasil penilaian ulang kompetitor semua outlet (peran inti/acuan, outlet, alasan arsip, catatan keputusan pemakai).
  - Kategori promosi untuk promo yang tampil.
  - 21 teks tersimpan yang istilahnya diseragamkan (bacaan berita dan deskripsi promo; nama sumber dan heartbeat malam
    tidak tersinkron dan berganti saat job produksi berjalan).
- Berkas data yang ter-deploy bersama kode: `lib/market/official-room-rates.data.json` (tarif resmi Sanghyang
  check-in 24 dan 28 Nov 2026), `lib/market/hotel-compset.data.json` (peran hotel selaras dengan daftar kompetitor), dan
  `lib/market/resort-room-rates.data.json` (data CI 21 Nov ditambah My Pisita).
- Dependensi langsung baru: `zod` ^4.4.3 (sebelumnya hanya dependensi turunan). `package-lock.json` kembali selaras
  dengan `package.json`; sisa entri `pptxgenjs` dibuang karena paketnya sudah tidak dipakai.
- Jadwal malam: langkah "Crawl official room rates" di job room-rates memakai GitHub Secrets `EXELY_API_BASE_URL`,
  `EXELY_CLIENT_ID`, `EXELY_CLIENT_SECRET`, dan `EXELY_PROPERTY_ID`. Keempatnya diisi 22 Nov 2026 malam atas permintaan
  pemilik lewat API GitHub dengan token proyek (nilai dienkripsi libsodium sistem dan tidak dicetak).

Tindakan pemilik:
1. Pasang ulang ekstensi dari ZIP v1.1.2 ke folder tetap, atau pulihkan folder lama dari Tempat Sampah.
2. Opsional: hapus basis data replika CI `sanghyang_news_ci_replica_*` di kontainer `sanghyang-news-db`. Hook agen
   menolak perintah penghapusan basis data, jadi keputusan ini milik pemilik.

Catatan lanjutan 22 Nov 2026 (putaran perbaikan):
- Push pertama dibatalkan saat sinkron macet di tahap berita. Registri, fakta, tarif, promo, dan ulasan sudah tersinkron,
  dan migrasi `promotionType` sudah ada di produksi. Push berikutnya menyelesaikan sisanya; setiap baris ditulis dengan
  OCC sehingga aman diulang.
- Mulai rilis ini, jadwal malam di CI menjalankan klasifikasi kompetitor dalam mode laporan (tanpa menulis). Daftar
  kompetitor produksi berubah hanya lewat sinkron saat push dari mesin kerja lokal.
- `verifiedAt` 73 baris lokal dipulihkan dari cadangan sinkron 22 Nov dan ikut ke produksi saat push.
- Sinkron membaca artikel per 1.000 baris dan klien produksinya memakai `socket_timeout` 60 dtk.

## Tambahan 22 Nov 2026 malam (Claude Code): urutan tampilan tetap dan nama sumber satu registri

Tanpa migrasi skema. Perubahan data produksi berjalan lewat hook pre-push (ADR-013), dengan OCC per baris:
- Langkah sinkron baru 9 menyamakan nama sumber yang domain dan metodenya sama dengan lokal. Pada rilis ini dua baris:
  `news.google.com|rss` "Google News" menjadi "Google News Anyer" (label penerbit di kartu berita Ringkasan dan sumber
  berita Knowledge Graph), dan `competitor-websites|browser` "Situs Resmi Pesaing" menjadi "Situs Resmi Kompetitor".
  Sumber yang hanya ada di DB lokal (foto, menu, tipe kamar, tarif resort) adalah catatan job lokal dan tidak disalin.
- Aturan rating: bacaan dengan waktu baca sama kini mengikuti lokal, sehingga label `ratingSource` Daiva Spa Novus Jiva,
  Patra Anyer Hotel, dan THE WEST COVE HOTEL di produksi tidak lagi menyebut nama alat.
- Tombol admin dan `prisma/seed.ts` memakai nama sumber dari registri tugas (`DEFAULT_JOB_SOURCES`), sehingga nama yang
  sudah disamakan tidak berbalik saat tombol "Perbarui Semua Data" ditekan.

Perubahan kode lain tidak menulis data: urutan kartu promo, berita terbaru, dan simpul Knowledge Graph disusun dengan
`lib/market/stable-order.ts`, sehingga web, Ringkasan, PDF, dan graf sama urutannya di localhost dan produksi.

Catatan 23 Nov 2026:
- Push `6a8e7e2` menerapkan langkah 9 dan aturan rating di atas (3 label `ratingSource`, 1 nama sumber berita); CI dan
  deploy Vercel lulus.
- "Perbarui Semua Data" di localhost (22 Nov 22.42 sampai 23 Nov 08.52 WIB) menghasilkan tarif kamar baru yang di-commit
  sebagai `736471c`, dan sempat mengaktifkan lagi Novus Jiva beserta empat outletnya karena tarifnya hilang dari berkas
  tarif setelah diarsipkan. Keputusan pemakai 23 Nov 2026: perubahan itu diarsipkan. Alasan arsip kelima baris kini memuat
  kalimat keputusan pemakai, yang ikut ke produksi lewat sinkron; status di produksi tetap arsip.
- Tombol "Perbarui Semua Data" di produksi menjalankan workflow GitHub Actions `nightly-market-scrape.yml` (terhubung,
  `remote.configured: true`). Workflow menulis langsung ke DB produksi dan meng-commit berkas tarif ke `master`, yang memicu
  deploy berikutnya. Klasifikasi kompetitor di sana berjalan dalam mode laporan. Sesudahnya localhost tertinggal sampai
  push berikutnya dari mesin kerja lokal; sebelum push, tarik dulu commit tarif dari `master`.
- Tipe kamar kompetitor: penyegaran otomatis tipe kamar (langkah 10) sempat menutupi data riset di
  `lib/market/hotel-room-types.data.json`, karena pemuat mengganti seluruh profil hotel dengan hasil penyegaran yang lebih
  baru. Situs resmi Aston baru menampilkan kamar setelah dirender dan tab "Rooms & Suites" diklik, sehingga bacaannya
  kosong dan hanya nama kamar Booking.com yang tersisa. Kini pemuat dan penyegaran menggabungkan lapisan per tipe kamar
  dan per kolom: situs resmi dulu, OTA mengisi kolom kosong, dan bila keduanya berbeda situs resmi yang dipakai. Tanpa
  migrasi; fakta tersimpan berikutnya tidak lagi kehilangan kolom. Sel yang tetap kosong memang tidak tercantum di sumber
  yang boleh dibaca: Smart TV, sebagian luas, dan bathtub My Pisita (situs resmi tidak mencantumkan; Trip.com meminta
  login), "Garden Cottage" Jayakarta (kategori situs grup untuk bungalow 3 dan 4 kamar tidur), dan nama penawaran OTA
  Hawaii "Standard 4 Bed Private".
- Dasar harga tarif kamar: tarif properti Google Hotels yang dibaca CI tersimpan sebagai harga sebelum pajak dan biaya,
  karena Google memilih tampilan harga dari lokasi runner GitHub (AS). Contohnya Sanghyang Rp 311.328 untuk check-in
  24 Nov, padahal totalnya Rp 361.792. Kini pembaca memastikan pilihan "Total per malam" di halaman dan menyimpan tarif
  berpaket "Google Hotels total per malam" (`lib/market/rate-basis.ts`). Paket lama tidak dipakai lagi di tampilan mana
  pun dan barisnya tidak diubah, jadi tidak perlu migrasi atau SQL produksi. Run lokal 23 Nov sudah menyimpan 14 tarif
  baru, yang ikut ke produksi lewat sinkron pre-push. "Perbarui Semua Data" berikutnya di produksi memakai pembaca baru.
  Bila runner menampilkan harga sebelum pajak, log job mencatat "tampilan harga diganti dari ... ke Total per malam".
  Bila pilihan itu tidak bisa dipastikan, tarif hotel itu dicatat gagal, bukan disimpan.

## Tambahan 26 Nov 2026: Sinkronisasi fitur terbaru VRP (Laporan Resort, WA Bookings, Sheet Stores, d'Bar Parts)

Bagian ini mencatat langkah rollout aman untuk 4 pembaruan operasional yang disinkronkan dari folder referensi baca-saja `VRP/` ke `sanghyang-analytics` (proyek Supabase produksi baru `omuqbpxierdlfjascngz`, satu schema `public`). Seluruh perubahan telah diterapkan dan diuji hanya di basis data kerja lokal (`127.0.0.1:55432/sanghyang_analytics`); Supabase produksi `omuqbpxierdlfjascngz` belum disentuh dan tetap berada di 28 migrasi / 40 tabel / 122.937 baris sampai pemilik menjalankan langkah di bawah.

### 1. Ringkasan fitur dan 3 migrasi baru (`0086..0088`)

| Migrasi target (`supabase/migrations/`) | Asal VRP | Perubahan skema & fungsi | Dampak di produksi |
|---|---|---|---|
| `0086_wa_bookings.sql` | `VRP/0085_wa_bookings.sql` | Tabel `public.wa_bookings` ber-RLS + `REVOKE ALL FROM anon`, RPC `replace_wa_bookings(jsonb)` dan `wa_booking_nights(uuid, date, date)` (`GRANT EXECUTE` ke `authenticated, service_role`). | Aditif penuh. Tabel lama `whatsapp_chat_counts` tetap dipertahankan. Nama tamu dan nomor WhatsApp tidak pernah dibaca atau disimpan ke basis data. |
| `0087_sales_bill_no_and_dbar_parts.sql` | `VRP/0086_sales_bill_no_and_dbar_parts.sql` | Kolom nullable `weekly_sales_lines.bill_no` dan RPC `dbar_parts(uuid, date, date)` (`GRANT EXECUTE` ke `authenticated, service_role`). | Aditif penuh. Memisahkan diskon dan compliment `d'Bar & Karaoke` vs `DBC` berdasarkan nomor bon pada unggahan baru; baris lama tetap aman (masuk bagian belum dibagi sampai bulan terkait diunggah ulang). |
| `0088_sheet_stores.sql` | `VRP/0087_sheet_stores.sql` | Constraint `sheet_sync_state_source_check` diperluas ke 5 sumber (`hk`, `dml`, `main`, `eng`, `bev`), kolom `store text not null default 'hk'` pada `sheet_hk_{months,items,movements}` berikut PK/FK/indeks baru, RPC `apply_store_months(...)` dan pembungkus kompatibel `apply_hk_months(...)`. | Kompatibel mundur untuk data HK yang sudah ada (`default 'hk'`). Memungkinkan sinkronisasi gudang Main Store, Engineering, dan Beverages (tab `LH`) tanpa menduplikasi tabel. |

Total skema pasca-rollout pada proyek Supabase `omuqbpxierdlfjascngz`: **31 migrasi bersih** (`0000_core_foundation` + `0059..0088`) dan **41 tabel `public` ber-RLS 100%**.

Fitur kode yang menyertai tanpa migrasi tambahan:
- **Laporan Resort** (`/laporan-resort` dan `/laporan-resort/lihat`): laporan cetak A4 kinerja resort dari data VHP (`revenue_by_day`, `room_revenue_by_segment`, `occupancy_by_night`, `weekly_purchase_lines`, `weekly_outlet_metrics`) terintegrasi caching native Next.js (`withPropertySupabaseCache` + tag `vhpResortReport`).
- **Pembaruan Dasbor & Notifikasi**: pemisahan tab okupansi (`occ`) beserta proyeksi (`OccupancyForecast`), portal lonceng notifikasi `#needs-slot` dengan pengingat impor `BOOKING BY WA`, pemisahan stok per gudang anti-hitung-ganda transfer Main Store ke HK (`store-inventory.ts`), dan pembaruan branding halaman login (tetap mempertahankan dropdown akun `Pilih user…`).
- **Caching native & integrasi Market Intelligence tetap utuh**: seluruh tab Market Intelligence (`Insight Pasar`, `Media Sosial`, `Strategy`), jembatan `src/lib/analytics/internal-signals.ts` (kini memanggil `public.dbar_parts`, tetap Zero Rupiah Leak), dan cache Next.js 16.4.6 (`unstable_cache` + `invalidateTags(..., { expire: 0 })`, termasuk invalidasi otomatis saat impor WA Bookings dan sinkronisasi Sheets multi-store) tetap aktif tanpa regresi.

### 2. Perilaku lingkungan lokal sebelum rollout produksi

Pada `.env.development.local`, **Prisma (`DATABASE_URL`)** menunjuk ke PostgreSQL lokal (`127.0.0.1:55432/sanghyang_analytics` dengan 31 migrasi), sedangkan **Supabase SDK (`NEXT_PUBLIC_SUPABASE_URL`)** menunjuk ke proyek Supabase produksi `omuqbpxierdlfjascngz` (masih 28 migrasi sebelum rollout):
- Kueri Prisma lokal (`internal-signals.ts`, Knowledge Graph, suite `test:market`) sudah mengakses `wa_bookings`, `bill_no`, `dbar_parts`, dan `sheet_hk_*.store` secara penuh.
- Rute `/laporan-resort` hanya membaca tabel dan RPC operasional yang sudah ada sejak migrasi `0059..0084`, sehingga langsung berfungsi di runtime lokal.
- Panggilan Supabase PostgREST ke `omuqbpxierdlfjascngz` untuk objek baru (`dbar_parts`, `sheet_hk_*.store`, `wa_bookings`, `replace_wa_bookings`, `wa_booking_nights`, insert `bill_no`) akan ditolak PostgREST produksi sampai 3 migrasi `0086..0088` diterapkan pemilik ke `omuqbpxierdlfjascngz`. Sesuai aturan Zero Fallback, kegagalan tersebut tidak disamarkan dengan angka tiruan. Koreksi 26 Nov 2026 (auditor kode): kegagalan itu tidak terisolasi per bagian tampilan di semua halaman. `/data-sheets` memuat seluruh datanya dalam satu `try/catch` (`src/app/(app)/data-sheets/page.tsx:197-220`), sehingga satu kolom atau RPC yang belum ada menggagalkan seluruh halaman, dan unggah VHP juga tidak terisolasi. Karena itu ketiga migrasi wajib diterapkan ke produksi sebelum kode di-push.

### 3. Variabel lingkungan baru (opsional)

Tambahkan kunci berikut di Vercel (Environment Variables proyek `sanghyang-analytics`) dan `.env.local` bila gudang tambahan akan disinkronkan (hanya nama kunci; pastikan akses berbagi di Google Drive diset **Pelihat / Viewer**, bukan Editor):
- `GOOGLE_SHEET_MAIN_ID` (ID atau tautan Google Sheet *Daily Opname Main Store*)
- `GOOGLE_SHEET_BEV_ID` (ID atau tautan Google Sheet *Daily Opname Beverages*, membaca tab `LH`)
- `GOOGLE_SHEET_ENG_ID` (ID atau tautan Google Sheet *Daily Opname Eng*)

Variabel lama (`GOOGLE_SHEET_HK_ID`, `GOOGLE_SHEET_DML_ID`, `SHEETS_PROPERTY_ID`, `CRON_SECRET`, `MARKETING_PROPERTY_ID`) tidak berubah.

Koreksi 26 Nov 2026: `DML_MIN_LIST_DATE` berubah dari `2026-11-08` ke `2026-11-01`. Pemilik menyetujui daftar DML 1 Nov ikut masuk (salinan VRP, `HANDOFF.md` entri 26 Nov 11.31, dan `TODO.md` butir 38ao). Ubah di `.env.development.local`, `.env.local`, dan Vercel sebelum tarikan produksi pertama; bila tidak, tarikan berikutnya membuang lagi daftar 1 Nov. Jadwal cron tetap mingguan Senin 01.00 WIB (`0 18 * * 0`) karena tarikan harian ditahan pemilik.

### 4. Urutan aman rollout produksi (dijalankan pemilik)

1. **Cadangan pra-rollout**: buat dump penuh basis data `omuqbpxierdlfjascngz` seperti pada Bagian 2 dokumen ini (`pg_dump "$DIRECT_URL"` ke folder `backups/`).
2. **Terapkan 3 migrasi berurutan ke `omuqbpxierdlfjascngz`** lewat `apply_migration` Supabase dengan pra-cek dan pasca-cek katalog seperti di Langkah 1 (§3 dokumen ini), sebelum kode di-push. SQL Editor dan `psql "$DIRECT_URL"` tidak dipakai karena tidak mencatat ledger `supabase_migrations.schema_migrations`.
   - `supabase/migrations/0086_wa_bookings.sql` (`name`: `0086_wa_bookings`)
   - `supabase/migrations/0087_sales_bill_no_and_dbar_parts.sql` (`name`: `0087_sales_bill_no_and_dbar_parts`)
   - `supabase/migrations/0088_sheet_stores.sql` (`name`: `0088_sheet_stores`)
3. **Atur variabel lingkungan baru**: isi `GOOGLE_SHEET_MAIN_ID`, `GOOGLE_SHEET_BEV_ID`, dan `GOOGLE_SHEET_ENG_ID` di Vercel dan `.env.local` bila sudah siap ditarik.
4. **Deploy kode `sanghyang-analytics` ke Vercel (`sin1`)**: commit dan push cabang `main` setelah pemilik memeriksa diff.

   Pelaksanaan 26 Nov 2026 (UTC): langkah 1 terlewat, jadi dump dibuat sesudah migrasi (`backups/omuqbpxierdlfjascngz-pasca-0088-20261126-1851.dump`, 11,2 MB). Langkah 2: `apply_migration` lewat MCP berakhir "declined" karena dialog konfirmasi server Supabase tidak tampil di editor; atas persetujuan pemilik ketiga berkas diterapkan lewat psql di kontainer DB lokal ke produksi, satu transaksi per berkas berikut baris ledger `supabase_migrations.schema_migrations` berformat sama (versi `20261126100702`, `20261126100717`, `20261126100731`, md5 isi sama dengan berkas), lalu pasca-cek §5 lulus. Langkah 3: env Vercel produksi dipasang dari `.env.local` sanghyang-analytics, termasuk `DML_MIN_LIST_DATE=2026-11-01`. Langkah 4: commit `cd29795`, deploy READY, `/api/health` 200. Langkah 5 menunggu pemilik.
5. **Tindakan operasional pasca-deploy**:
   - Buka `/upload-mingguan` dan unggah ulang laporan VHP *Penjualan per Artikel* bulan berjalan dan bulan pembandingnya (misalnya Oktober bila November dibandingkan dengan Oktober) agar kolom `bill_no` terisi di kedua periode dan pemisahan diskon/compliment `d'Bar & Karaoke` vs `DBC` per nomor bon bisa dibandingkan. Bulan yang belum diunggah ulang tetap tampil "belum dibagi".
   - Buka `/marketing` (tab Google Ads) lalu impor berkas `BOOKING BY WA.xlsx` dari CS melalui formulir "Booking WA" di atas laporan.
   - Buka `/data-sheets` dan tekan **Tarik Data Sekarang** (atau tunggu cron `/api/cron/sync-sheets` yang tetap mingguan Senin 01.00 WIB) untuk menarik Main Store, Engineering, dan Beverages.

### 5. Kueri verifikasi pasca-rollout

Jalankan kueri baca-saja berikut pada Supabase SQL Editor `omuqbpxierdlfjascngz`:

```sql
-- 1. Pastikan seluruh 41 tabel public mengaktifkan RLS
SELECT count(*) AS total_tabel,
       count(*) FILTER (WHERE rowsecurity) AS rls_aktif
FROM pg_tables
WHERE schemaname = 'public';

-- 2. Pastikan kolom baru dan constraint store terpasang
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'weekly_sales_lines' AND column_name = 'bill_no')
    OR (table_name = 'sheet_hk_months' AND column_name = 'store'));

-- 3. Pastikan 4 fungsi baru tersedia dan dapat dieksekusi role yang tepat
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('replace_wa_bookings', 'wa_booking_nights', 'dbar_parts', 'apply_store_months')
ORDER BY p.proname;
```

Kriteria lulus: `total_tabel = 41` dan `rls_aktif = 41`; kedua kolom baru tampil; keempat fungsi terdaftar; rute `/laporan-resort` terproteksi login; `/marketing/laporan` menampilkan kotak impor `BOOKING BY WA`; `/data-sheets` menampilkan tab per gudang.

### 6. Catatan keamanan non-blocking & rencana rollback

- **Header keamanan (`next.config.ts`)**: audit delta menemukan `VRP/next.config.ts` menambahkan `SECURITY_HEADERS` (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`) yang berada di luar cakupan porting kali ini; pemilik dapat menambahkannya pada putaran hardening konfigurasi berikutnya.
- **Rollback**: ketiga migrasi bersifat aditif (`bill_no` nullable, `wa_bookings` tabel terpisah, `sheet_hk_*` ber-default `'hk'`, dan pembungkus `apply_hk_months` tetap ada). Koreksi 26 Nov 2026 (auditor basis data): rollback kode ke commit `9271330` sesudah tarikan multi-gudang tidak aman, karena kode lama membaca `sheet_hk_*` tanpa filter `store` sehingga tampilan HK mencampur empat gudang. Sesudah tarikan multi-gudang pertama, pilihannya tetap di kode baru atau mengembalikan data gudang selain HK atas keputusan pemilik, dengan cadangan lebih dulu. Rollback penuh skema tetap dapat dilakukan dari dump pra-rollout pada Langkah 1 di §4 bagian ini.
