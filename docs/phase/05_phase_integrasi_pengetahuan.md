# Phase 4: Pengetahuan, Graf & Serah Terima

Status: **Selesai** · Peta fase: [00](00_master_execution_flow.md) · ADR terkait: ADR-007

## 1. Tujuan

Mengonsolidasikan seluruh lapisan dokumentasi proyek (README UTF-8 yang bersih, panduan operasional staf dan pengembang, inventaris sumber data, metodologi transparan, dan diagram alur data), memperbarui graf pengetahuan Graphify dan memori Hermes, menjalankan verifikasi akhir seluruh gerbang mutu secara berurutan, serta menyiapkan laporan serah terima komprehensif (`docs/plans/SWARM_HANDOFF.md`) untuk Claude Code.

## 2. Ruang lingkup

- Masuk:
  - Pembaruan `README.md` dengan encoding UTF-8 yang bersih dan instruksi akurat (P2).
  - Konsolidasi dokumen lama di akar ke subdirektori `docs/` (`architecture/`, `plans/`, `guides/`, `design/`, `research/`) (P2).
  - Panduan staf Windows (tanpa sandi terbuka) dan panduan pengembang Linux (P2).
  - Dokumentasi inventaris sumber data dan kepatuhan perayapan `docs/research/sumber-data.md` (P3).
  - Diagram Mermaid alur data ujung-ke-ujung `docs/architecture/alur-data.md` (P3).
  - Metodologi analitik pasar transparan `docs/research/metodologi.md` (P3).
  - Pembaruan graf pengetahuan via `graph_bridge.py --action update --strict`, verifikasi artefak dan cakupan (P4).
  - Perekaman minimal 15 Q&A bernilai tinggi ke memori Graphify dan refleksi `LESSONS.md` (P4).
  - Penyusunan dokumen peta jalan kelanjutan proyek `docs/plans/ROADMAP.md` (P5).
  - Verifikasi independen seluruh gerbang mutu akhir oleh `@verifier`.
  - Penyusunan laporan serah terima final `docs/plans/SWARM_HANDOFF.md`.
- Tidak masuk:
  - Ekstraksi semantik graf memakai Gemini API produksi.
  - Perintah commit, push, atau migrasi otomatis ke server produksi.

## 3. Keputusan terkait

| ADR | Ringkasan | Dampak ke fase ini |
| :---: | :--- | :--- |
| 007 | Lapisan pengetahuan terstruktur | Menstandarkan pemeliharaan artefak graf, memori, dan dokumen serah terima |

## 4. Langkah kerja

| # | Langkah | Bukti (perintah + hasil, tautan, atau tangkapan layar) | Status |
| :---: | :--- | :--- | :--- |
| 1 | Rapikan `README.md` (UTF-8, port, jadwal riil cron 22:23 WIB) | `README.md` ditulis ulang UTF-8 bersih, port 55432 & 3001 akurat (board #83) | Selesai |
| 2 | Pindahkan dokumen v1 dari akar ke hierarki `docs/` | Berkas legacy v1 dikonsolidasi ke `docs/archive/legacy-v1/` (board #83) | Selesai |
| 3 | Tulis panduan operasional di `docs/guides/` | `panduan-staf-windows.md` (tanpa sandi) & `panduan-pengembang-linux.md` (board #83) | Selesai |
| 4 | Tulis `docs/research/sumber-data.md` dan `metodologi.md` | Matriks sumber data, batasan koridor, klaster compset, Zero Mock di `docs/research/` (board #83) | Selesai |
| 5 | Buat diagram arsitektur alur data di `docs/architecture/alur-data.md` | Diagram Mermaid (`flowchart TD`) komprehensif alur data end-to-end (board #83) | Selesai |
| 6 | Jalankan pembaruan graf dan verifikasi artefak Graphify | Update strict 100% (500/500 berkas, 4.224 simpul, 7.497 relasi), artefak OK (board #83, #89) | Selesai |
| 7 | Catat 15 Q&A bernilai tinggi ke memori dan lakukan refleksi | 15 Q&A tersimpan, 20 pelajaran di `LESSONS.md`, `MEMORY.md` 1.784 char (board #83) | Selesai |
| 8 | Susun dokumen peta jalan kelanjutan proyek | `docs/plans/ROADMAP.md` resmi 6 fase menggantikan TODO.md (board #83) | Selesai |
| 9 | Jalankan pengujian E2E Puppeteer dan tangkapan layar desktop/ponsel | `npm run test:e2e` via resource guard: 20/20 lulus, 0 galat konsol, 0 overflow 390px, 20 screenshot di `docs/design/layar/` (board #89) | Selesai |
| 10 | Verifikasi seluruh gerbang mutu akhir oleh verifier independen | Seluruh 8 gerbang mutu akhir terverifikasi LULUS 100% oleh `@verifier` (board #89) | Selesai |
| 11 | Susun laporan serah terima akhir `docs/plans/SWARM_HANDOFF.md` | Laporan serah terima komprehensif disiapkan untuk Claude Code (board #89) | Selesai |

## 5. Berkas utama

- `README.md`
- `docs/plans/ROADMAP.md`
- `docs/plans/SWARM_HANDOFF.md`
- `docs/plans/ROLLOUT_PRODUKSI.md`
- `docs/research/sumber-data.md`
- `docs/research/metodologi.md`
- `docs/architecture/alur-data.md`
- `docs/guides/`
- `graphify-out/`
- `LESSONS.md`

## 6. Verifikasi

- `python3 .agents/scripts/brain.py phase --check` -> 0 galat.
- `python3 .agents/scripts/graph_bridge.py --action verify-artifacts` -> OK.
- `python3 .agents/scripts/contract_test.py` -> lulus (19 uji asap & 470 flag).
- `pytest .agents/tests` -> 485 passed.
- Verifikasi akhir seluruh gerbang mutu terbukti empiris (board #89).

## 7. Kriteria keluar

- [x] Seluruh dokumen panduan, metodologi, dan alur data terisi lengkap dalam Bahasa Indonesia baku
- [x] Graf pengetahuan dan memori proyek terbarui dan tersinkronisasi
- [x] Seluruh gerbang mutu akhir terverifikasi lulus berturut-turut tanpa pemalsuan (board #89)
- [x] Laporan serah terima `docs/plans/SWARM_HANDOFF.md` lengkap dan disetujui (board #89)
