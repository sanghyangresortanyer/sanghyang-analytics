# Phase 0: Fondasi, Isolasi Lingkungan & Tata Kelola

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-001, ADR-007

## 1. Tujuan

Mengamankan lingkungan kerja secara total (basis data lokal Docker terisolasi dari produksi, pengaman tulis aktif, tanpa perintah git langsung), memperbaiki linting dari folder eksternal, dan menginisiasi seluruh dokumen tata kelola (brief, ADR, alur fase, rencana implementasi tervalidasi, pelacak kemajuan).

## 2. Ruang lingkup

- Masuk:
  - Kontainer PostgreSQL 17 lokal (`127.0.0.1:55432`) dengan snapshot data baca-saja dari produksi (L1).
  - Pengaman tulis produksi di `lib/db.ts` dan deteksi lingkungan di endpoint `/api/health?ready` (L2).
  - Peralihan server dev `sanghyang-news-dev` ke DB lokal (L3).
  - Konfigurasi `eslint.config.mjs` untuk mengabaikan `.agents/**` dan `graphify-out/**` (L4).
  - Konfigurasi `allowScripts` di `package.json` untuk instalasi npm 12 (L5).
  - Inisiasi otak proyek `brain.py init`, brief proyek, register ADR-001 s/d ADR-007, peta fase, `Implementation_Plan.md`, dan `SWARM_PROGRESS.md` (P1).
- Tidak masuk:
  - Perubahan skema produksi atau penulisan data ke database Supabase produksi.
  - Perubahan fitur UI atau logika crawler (masuk fase P1 dan P2).

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 001 | Lingkungan pengembangan terpisah (Postgres 17 Docker lokal & pengaman tulis) | Menentukan konfigurasi port 55432, `.env.development.local`, dan guard di `lib/db.ts` |
| 007 | Lapisan pengetahuan terstruktur | Menentukan struktur dokumen `docs/`, penataan register ADR, dan alur fase |

## 4. Langkah kerja

| # | Langkah | Bukti (perintah + hasil, tautan, atau tangkapan layar) | Status |
| :---: | :--- | :--- | :--- |
| 1 | Jalankan `brain.py init --name "Sanghyang News"` | Direktori `docs/` dan template inisiasi terbentuk | Selesai |
| 2 | Lengkapi `docs/plans/PROJECT_BRIEF.md` dan `docs/architecture/ARCHITECTURE.md` (ADR-001–007 Berlaku) | Register ADR 7 item berstatus Berlaku | Selesai |
| 3 | Siapkan alur fase `00_master_execution_flow.md` dan dokumen per fase | Fase P0 selesai, P1 berjalan, P2–P4 belum mulai | Selesai |
| 4 | Susun dan validasi `docs/plans/Implementation_Plan.md` dengan `plan_architect.py` | `plan_architect.py --validate-plan` lulus skor 100% | Selesai |
| 5 | Buat pelacak kemajuan `docs/plans/SWARM_PROGRESS.md` | Matriks seluruh temuan L, D, C, U, K, P tercatat | Selesai |
| 6 | Buat kontainer Docker Postgres 17 lokal dan migrasi skema | Kontainer `sanghyang-news-db` aktif di port 55432 | Selesai |
| 7 | Buat snapshot baca-saja produksi dan pulihkan ke DB lokal | 15 tabel 100% cocok dengan baseline statistik produksi | Selesai |
| 8 | Pasang pengaman tulis produksi di `lib/db.ts` dan uji unit | `tests/unit/production-guard.test.ts` (4 pass, 0 fail) | Selesai |
| 9 | Alihkan server dev ke DB lokal dan periksa `/api/health?ready` | `curl -s http://127.0.0.1:3001/api/health?ready` -> `"databaseTarget":"lokal"` | Selesai |
| 10 | Perbaiki `eslint.config.mjs` dan verifikasi lint bersih | `npm run lint` menghasilkan 0 error, 0 warning | Selesai |
| 11 | Konfigurasi `allowScripts` di `package.json` | `npm install-scripts ls` menunjukkan 0 unreviewed scripts | Selesai |

## 5. Berkas utama

- `docs/plans/PROJECT_BRIEF.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/phase/00_master_execution_flow.md`
- `docs/phase/01_phase_fondasi.md`
- `docs/plans/Implementation_Plan.md`
- `docs/plans/SWARM_PROGRESS.md`
- `.env.development.local`
- `lib/db.ts`
- `app/api/health/route.ts`
- `eslint.config.mjs`
- `package.json`

## 6. Verifikasi

- `python3 .agents/scripts/brain.py phase --check` -> 0 galat.
- `python3 .agents/scripts/plan_architect.py --validate-plan docs/plans/Implementation_Plan.md --check-paths --workspace-root .` -> Sah (100%).
- `curl -s http://127.0.0.1:3001/api/health?ready` -> `"databaseTarget":"lokal"`.
- `npm run lint` -> 0 galat, 0 peringatan.
- `npx tsc --noEmit` -> 0 galat.

## 7. Kriteria keluar

- [x] Basis data lokal PostgreSQL 17 Docker terisi snapshot data produksi dengan baris 15 tabel identik
- [x] Pengaman tulis produksi terbukti aktif menolak mutasi ke URL produksi
- [x] Server dev berjalan di atas basis data lokal
- [x] `npm run lint` dan `npx tsc --noEmit` bersih tanpa galat
- [x] `brain.py phase --check` menghasilkan 0 galat
- [x] `Implementation_Plan.md` tervalidasi 100% dan `SWARM_PROGRESS.md` siap pakai
- [x] Verifikasi independen disetujui oleh `@verifier`
