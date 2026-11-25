# Panduan Kontribusi: Sanghyang Analytics

Dokumen ini menetapkan standar pengembangan, format commit, dan sepuluh gerbang mutu yang wajib lulus sebelum perubahan diajukan ke cabang `main` repositori `sanghyangresortanyer/sanghyang-analytics`.

---

## 1. Standar Pesan Commit (Conventional Commits 1.0.0)

Gunakan format `<tipe>(<lingkup>): <deskripsi singkat>` dalam Bahasa Indonesia atau teknis yang jelas:

- `feat`: penambahan fitur atau perilaku baru.
- `fix`: perbaikan bug atau penutupan celah keamanan.
- `refactor`: penataan ulang kode tanpa mengubah perilaku eksternal.
- `test`: penambahan atau pembaruan tes unit dan integrasi.
- `docs`: pembaruan dokumentasi, ADR, atau panduan operasional.
- `chore`: pembaruan dependensi, konfigurasi build, atau skrip CI.

---

## 2. Disiplin Arsitektur (ADR-014)

- **Satu aplikasi tunggal (`src/`)**: seluruh halaman, komponen, API, dan pustaka aplikasi berada di dalam `src/`.
- **Satu schema `public`**: migrasi skema basis data mengikuti jalur tunggal `supabase/migrations/` (`0001..0085` dan seterusnya). Setiap tabel baru di `public` wajib mengaktifkan Row-Level Security (`ENABLE ROW LEVEL SECURITY`).
- **Autentikasi tunggal**: seluruh rute UI dan API dilindungi sesi Supabase Auth (`marketingAccess()`), tanpa `APP_PASSWORD` maupun `SESSION_SECRET`.
- **Data VHP lewat UI Upload**: dilarang menulis ke tabel operasional `weekly_*` lewat skrip atau SQL langsung; gunakan halaman `/upload-mingguan`.
- **Istilah domain**: gunakan nama **Sanghyang Analytics** (`sanghyang-analytics`) pada antarmuka dan dokumentasi, pertahankan istilah PMS/POS **`VHP`**, dan jangan mencantumkan nama mesin atau model AI di halaman web maupun PDF.

---

## 3. Sepuluh Gerbang Mutu Dinamis (While-Loop)

Setiap kontribusi diverifikasi secara berurutan dari Gerbang 1 sampai Gerbang 10. Bila satu gerbang gagal, perbaiki akar masalah di hulu lalu ulangi dari Gerbang 1:

1. **Deteksi Kebocoran Rahasia**: `gitleaks detect --no-git --verbose` (0 rahasia bocor; berkas `.env*`, `config/marketing/google-oauth-client.json`, dan `.mcp/` wajib diabaikan `.gitignore`).
2. **Linter Kode Statis (0 galat, 0 peringatan)**: `npm run lint`, `(cd crawler && uv run ruff check .)`, dan `(cd crawler/research && uv run ruff check .)`.
3. **Pemeriksa Tipe Ketat**: `npx next typegen && npm run typecheck`, plus `basedpyright` pada modul Python.
4. **Eliminasi Kode Mati**: pemeriksaan dependensi dan ekspor tak terpakai (`knip` / `vulture`).
5. **Pengujian Otomatis Terpadu**: `npx vitest run`, `npx tsx --test --test-concurrency=2 tests/unit/*.test.ts`, `npm run audit:provenance`, serta `uv run pytest tests` di `crawler/` dan `crawler/research/`.
6. **Audit Keamanan SAST & Rantai Pasok**: pemindaian statis tanpa temuan High/Critical.
7. **Verifikasi Build & Pengemasan**: pemeriksaan build di lingkungan CI pada cabang `main` (di mesin kerja 14 GiB gunakan `resource_guard.py` dan hindari `next build` lokal berulang).
8. **Pemeriksaan Kesehatan Runtime**: `/api/health` (HTTP 200 liveness) dan `/api/health/ready` (kesiapan Supabase, Prisma, dan konfigurasi layanan dalam batas 2 detik).
9. **Kepatuhan Regulasi & Tata Kelola**: verifikasi Empat Nol, kontrol OCC (`version`), RLS 100%, tanpa kebocoran rupiah internal, dan kesesuaian UU PDP No. 27/2022.
10. **Pembaruan Graf Pengetahuan & Memori**: segarkan graf (`graph_bridge.py --action update --strict`) dan catatan memori lintas host setelah perubahan diverifikasi.
