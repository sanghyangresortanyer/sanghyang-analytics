# Phase 5: Ekstensi Chrome Sinkronisasi Media Sosial

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-004, ADR-012

## 1. Tujuan

Menyediakan ekstensi Chrome Manifest V3 khusus (cross-platform Ubuntu Linux dan Windows, tanpa biaya publikasi toko aplikasi, dapat diunduh sebagai `.zip`) beserta titik akhir sinkronisasi dan antarmuka dasbor agar tim marketing dapat menyegarkan data Instagram serta TikTok milik Sanghyang dan pembanding dari komputer kerja tanpa server 24 jam.

## 2. Ruang lingkup

- Masuk:
  - Dokumentasi ADR-012 di `docs/architecture/ARCHITECTURE.md` dan rencana kerja tervalidasi `plan_architect.py`.
  - Paket ekstensi Manifest V3 di `extension/sanghyang-social-sync/` (manifest ber-key terpin, ikon PNG bersih tanpa emoji, `parsers.js`, `content-social.js`, `background.js`, popup bahasa Indonesia).
  - Generator arsip `.zip` tanpa ketergantungan eksternal (`lib/market/extension-zip.ts`) dan rute unduh terotentikasi (`/api/admin/social-extension/download`), termasuk konfigurasi `outputFileTracingIncludes` di `next.config.ts`.
  - Titik akhir `GET/POST /api/marketing-sosmed/browser-sync` dan pustaka `lib/market/browser-social-sync.ts` (target dinamis basis data + `OFFICIAL_SOCIAL_ACCOUNTS`, anonimisasi komentar dua lapis, penyimpanan metrik `Postingan Sosmed Tayang` dengan `inquiriesWa: null` saat kosong dan OCC `version`).
  - Integrasi panel ekstensi pada `UpdateAllButton`, `StepKataTamu`, `StepPromo`, dan `/marketing-sosmed` termasuk jeda login/CAPTCHA interaktif untuk diselesaikan pengguna di tab Chrome.
  - Perbaikan kontrak pendukung: validasi permalink ketat `isVerifiedReviewSource`, pemilahan pujian/keluhan berating `0` di PDF Rapat Senin (`lib/meeting-report/`), dan pengenalan label sumber TikTok di `summary/route.ts` serta Knowledge Graph (`assemble.ts`).
  - Pengujian TDD di `tests/unit/browser-social-sync.test.ts`, pembersihan skrip/prototipe usang (layanan prototipe lokal, skrip `.bat`, berkas yatim), penyelarasan `scripts/ops/migrate-production.mjs`, pembaruan dokumentasi aktif (`README.md`, panduan staf Windows, `scripts/ops/README.md`, `ROLLOUT_PRODUKSI.md`), pembaruan graf pengetahuan `--strict`, dan rilis ke GitHub serta Vercel.
- Tidak masuk:
  - Otomasi pengisian login atau pemecahan CAPTCHA.
  - Penulisan langsung skrip pengembangan ke basis data produksi tanpa izin pemilik.

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 004 | Perayapan patuh dan pemisahan sumber publik vs sesi akun | Diperbarui lewat ADR-012 agar sinkronisasi memakai browser Chrome staf secara eksplisit tanpa menyuntik cookie ke server |
| 012 | Ekstensi Chrome Staf MV3 unpacked dengan jeda login/CAPTCHA manusia | Menetapkan kontrak `host_permissions` minim izin, jeda fail-closed pada tantangan, anonimisasi komentar, dan distribusi `.zip` terotentikasi |

## 4. Langkah kerja

| # | Langkah | Bukti (perintah + hasil, tautan, atau tangkapan layar) | Status |
| :---: | :--- | :--- | :--- |
| 1 | Dokumentasi ADR-012, peta fase P5, panduan, & validasi rencana | `brain.py phase --check` konsisten; `plan_architect.py --validate-plan` skor 100% | Selesai |
| 2 | Menulis tes gagal terlebih dahulu (`tests/unit/browser-social-sync.test.ts`) | Terbukti merah 5/5 sebelum kode produk, lalu 6/6 lulus sesudah implementasi | Selesai |
| 3 | Membangun ekstensi Chrome MV3 lintas-platform (`extension/sanghyang-social-sync/`) | ID `kabomdcpiamnnncoifohknncamcddahl`, ikon PNG, parser IG & TikTok teruji | Selesai |
| 4 | Membangun API unduh `.zip` & sinkronisasi (`browser-sync`) + perbaikan kontrak PDF/KG/URL | Live `127.0.0.1:3001` `.zip` `testzip()` bersih (`15.557 B`), API `GET` mengembalikan `23` sasaran / `20` handle, auth & OCC teruji | Selesai |
| 5 | Integrasi UI `UpdateAllButton`, `StepKataTamu`, `StepPromo`, & `/marketing-sosmed` (`<= 300` baris) | `npm run lint` 0, `npm run typecheck` 0, 415 unit tes lulus (1 `skip`), `audit:provenance` 87/87 | Selesai |
| 6 | Pembersihan skrip/prototipe usang, pembaruan dokumen aktif, graf `--strict`, & gerbang mutu penuh | `npm run lint` 0, `npm run typecheck` 0, `audit:provenance` 87/87, `423/423` unit tes lulus di DB CI kosong & DB lokal, Python `ruff` + `14` pytest lulus, graf `--strict` (`4726` berkas) terverifikasi | Selesai |
| 7 | Rilis ke GitHub (`origin master`), CI GitHub Actions, deploy Vercel, & verifikasi endpoint produksi | Commit `6c8a748`, merge `38b513b`, perbaikan CI `2fef250`; Vercel `HdkhYMgVQ1R5AZFW4JsHD3qpCFp4` berstatus `success`; GitHub Actions CI run `44368018678` lulus (`423/423` unit tes, `87/87` provenans, `14` pytest Python); endpoint produksi baca-saja (`/api/health?ready`, `/login`, `/market-intelligence`, `/api/admin/social-extension/download`, `/api/marketing-sosmed/browser-sync`) terverifikasi | Selesai |

## 5. Berkas utama

- `extension/sanghyang-social-sync/`
- `lib/market/extension-zip.ts`
- `lib/market/browser-social-sync.ts`
- `lib/market/social-extension-client.ts`
- `app/api/admin/social-extension/download/route.ts`
- `app/api/marketing-sosmed/browser-sync/route.ts`
- `components/market-intelligence/social-extension-panel.tsx`
- `components/market-intelligence/use-social-extension-sync.ts`
- `components/market-intelligence/refresh-progress-modal.tsx`
- `next.config.ts`
- `scripts/ops/migrate-production.mjs`
- `scripts/ops/ci-fixture.ts`
- `.github/workflows/quality-ci.yml`
- `README.md`
- `docs/guides/panduan-ekstensi-sosmed.md`
- `docs/guides/panduan-staf-windows.md`
- `docs/plans/ROLLOUT_PRODUKSI.md`
- `scripts/ops/README.md`
- `tests/unit/browser-social-sync.test.ts`

## 6. Verifikasi

- `python3 .agents/scripts/brain.py phase --check`
- `python3 .agents/scripts/plan_architect.py --validate-plan docs/plans/2026-11-18-ekstensi-chrome-sinkronisasi-sosmed.md`
- `python3 .agents/scripts/resource_guard.py --profile light -- npm run lint`
- `python3 .agents/scripts/resource_guard.py --profile light -- npm run typecheck`
- `python3 .agents/scripts/resource_guard.py --profile light -- npm run audit:provenance`
- `python3 .agents/scripts/resource_guard.py --profile light -- node --env-file-if-exists=.env.development.local node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/unit/*.test.ts`
- `python3 .agents/scripts/resource_guard.py --profile light -- bash -c "set -o pipefail; (cd crawler && uv run ruff check . && uv run pytest tests) && (cd crawler/research && uv run ruff check . && uv run pytest tests)"`
- `python3 .agents/scripts/graph_bridge.py --action update --strict && python3 .agents/scripts/graph_bridge.py --action verify-artifacts`

## 7. Kriteria keluar

- [x] Pembersihan skrip/prototipe usang, pembaruan dokumen aktif, & seluruh gerbang mutu lokal lulus penuh (0 fail, `423/423` unit tes)
- [x] Graf pengetahuan Graphify (`--strict`) & verifikasi artefak lulus
- [x] Push ke `origin master` (`6c8a748`, `38b513b`, `2fef250`), GitHub Actions CI (`44368018678`) hijau, deploy produksi Vercel (`HdkhYMgVQ1R5AZFW4JsHD3qpCFp4`) berhasil, & verifikasi endpoint produksi baca-saja lulus
- [x] `python3 .agents/scripts/brain.py phase --check` tanpa galat setelah penutupan fase P5
