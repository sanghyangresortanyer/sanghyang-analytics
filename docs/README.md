# Dokumentasi Sanghyang Analytics

Dibuat 2026-11-13 oleh `python3 .agents/scripts/brain.py init`. Dokumen ini adalah sumber kebenaran proyek: kode
mengikuti dokumen, bukan sebaliknya. Setiap perubahan keputusan dicatat sebagai ADR, setiap pekerjaan masuk ke fase.

## Peta dokumen

| Folder | Isi | Kapan diperbarui |
| :--- | :--- | :--- |
| `plans/PROJECT_BRIEF.md` | Tujuan, pengguna, batasan, kuota, kriteria sukses (G0) | Saat pemilik mengubah tujuan atau batasan |
| `architecture/ARCHITECTURE.md` | Arsitektur, prioritas atribut kualitas, register ADR (G1) | Setiap keputusan arsitektur baru atau berubah |
| `plans/Implementation_Plan.md` | Rencana implementasi + gerbang mutu (G2) | Saat rencana disetujui atau direvisi |
| `phase/00_master_execution_flow.md` | Peta fase, dependensi, risiko, RACI, daftar periksa progres (G2) | Setiap fase mulai, selesai, atau berubah |
| `phase/NN_phase_*.md` | Rincian satu fase: langkah, bukti, kriteria keluar | Selama fase berjalan |
| `design/DESIGN.md` | Sistem desain atau desain antarmuka (UI, CLI, API) (G3) | Saat pola desain berubah |
| `compliance/COMPLIANCE_MATRIX.md` | Matriks regulasi, keamanan, dan data pribadi (G3) | Saat data, regulasi, atau integrasi berubah |
| `uat/UAT_SIGNOFF_REPORT.md` | Skenario uji penerimaan dan tanda tangan pemilik | Sebelum setiap rilis besar |

## Prosedur (wajib, sama di Claude Code, Codex, dan Antigravity)

Skill `project-inception` memuat langkah lengkapnya. Ringkasnya:

1. **G0 Ringkasan**: isi `plans/PROJECT_BRIEF.md`, pemilik mengonfirmasi.
2. **G1 Arsitektur**: arketipe proyek, minimal dua opsi, matriks untung rugi, ADR berstatus Usulan, pemilik memilih,
   status menjadi Berlaku.
3. **G2 Fase**: peta fase dan dokumen tiap fase, rencana implementasi tervalidasi.
4. **G3 Dokumen dasar**: desain, kepatuhan, kerangka UAT.
5. **G4 Otak proyek**: hook tiga host, graf 3D + Obsidian, memori bersama.
6. **G5 Eksekusi**: fase pertama berstatus Berjalan. Sebelum G1 dan G5 terpenuhi, hook menolak perubahan di luar
   `docs/` dan konfigurasi agen.

Cek kapan saja: `python3 .agents/scripts/brain.py phase --check`.
