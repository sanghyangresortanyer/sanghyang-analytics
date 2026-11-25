# Panduan Pengembang Linux · Sanghyang News

Panduan teknis dan operasional untuk pengembang yang bekerja pada repositori Sanghyang News di lingkungan Linux.

---

## 1. Aturan Keamanan & Lingkungan Kerja

1. **Koneksi Git & GitHub Tingkat Proyek**:
   - Kredensial GitHub diisolasi khusus untuk proyek ini melalui [`.git/config`](../../.git/config) (`credential.helper` global dikosongkan lalu diarahkan ke `.git/.git-credentials`), sehingga akun proyek lain di tingkat pengguna (`~/.gitconfig` / `~/.git-credentials`) tidak tercampur.
   - Untuk masuk dengan Personal Access Token (PAT) dan menyetel `user.name` / `user.email` lokal proyek:
     ```bash
     node scripts/ops/github-login.mjs
     ```
   - Perintah baca-saja (`git status`, `git diff`, `git log`) diizinkan bagi agen; `git commit`, `git push`, dan deploy tetap hanya dijalankan oleh pemilik atau atas instruksi eksplisit.
2. **Pengaman Tulis Produksi**:
   - Berkas `.env.local` merujuk ke Supabase produksi.
   - Pengembangan lokal wajib menggunakan basis data lokal (`.env.development.local`).
   - Lapisan Prisma (`lib/db.ts`) secara otomatis menolak seluruh operasi mutasi tulis jika mendeteksi penanda basis data produksi tanpa flag izin khusus.
3. **Disiplin Sumber Daya (RAM 14 GiB)**:
   - Jalankan perintah komputasi berat (pemeriksaan tipe, pengujian penuh, pembaruan graf) secara bergantian menggunakan pembungkus `resource_guard.py`:
     ```bash
     python3 .agents/scripts/resource_guard.py --profile light -- <perintah>
     python3 .agents/scripts/resource_guard.py --profile graph -- <perintah>
     python3 .agents/scripts/resource_guard.py --profile e2e -- <perintah>
     ```

---

## 2. Arsitektur Basis Data Lokal

Aplikasi menggunakan PostgreSQL 17 di dalam kontainer Docker:
- **Nama kontainer**: `sanghyang-news-db`
- **Host & Port**: `127.0.0.1:55432`
- **Database**: `sanghyang_local`
- **Pengaturan env**: Terkonfigurasi di `.env.development.local` (`DATABASE_URL` dan `DIRECT_URL`).

Untuk menjalankan atau memeriksa status kontainer basis data lokal:
```bash
docker ps -f name=sanghyang-news-db
```

Menjalankan migrasi skema ke basis data lokal:
```bash
node --env-file=.env.development.local node_modules/prisma/build/index.js migrate deploy
```

---

## 3. Server Pengembangan Lokal

Server Next.js dev telah dikonfigurasi sebagai layanan systemd pengguna bernama `sanghyang-news-dev` yang berjalan di port 3001:
- **Alamat URL**: `http://127.0.0.1:3001`
- **Pemeriksaan status**:
  ```bash
  systemctl --user status sanghyang-news-dev
  ```
- **Memeriksa log**:
  ```bash
  journalctl --user -u sanghyang-news-dev -n 50 -f
  ```
- **Memulai ulang layanan**:
  ```bash
  systemctl --user restart sanghyang-news-dev
  ```
- **Verifikasi koneksi basis data lokal**:
  ```bash
  curl -s http://127.0.0.1:3001/api/health?ready
  # Pastikan keluaran JSON menunjukkan: "databaseTarget":"lokal"
  ```

---

## 4. Pengujian & Verifikasi Mutu

Sebelum mengajukan perubahan atau menyatakan tugas selesai, jalankan rangkaian pengujian mutu:

1. **Pemeriksaan Tipe TypeScript**:
   ```bash
   npm run typecheck
   ```
2. **Pemeriksaan Lint (ESLint)**:
   ```bash
   npm run lint
   ```
3. **Pengujian Unit & Integrasi (Node test runner + `tsx`)**:
   ```bash
   npm test
   ```
   *Catatan: `npm test` berjalan terhadap basis data lokal, tanpa memanggil jaringan eksternal dan tanpa mengonsumsi kuota Gemini.*
4. **Audit Provenans Metrik Pasar**:
   ```bash
   npm run audit:provenance
   ```
   *Memastikan 100% metrik pasar di UI dan PDF terhubung ke baris observasi atau formula berlabel.*
5. **Pengujian Modul Python (Crawler & Research Engine)**:
   ```bash
   (cd crawler && uv run ruff check . && uv run pytest tests)
   (cd crawler/research && uv run ruff check . && uv run pytest tests)
   ```

---

## 5. Tata Kelola Pengetahuan & Graf

Untuk menjaga konsistensi arsitektur dan memori jangka panjang:
1. Periksa kepatuhan fase:
   ```bash
   python3 .agents/scripts/brain.py phase --check
   ```
2. Pembaruan Graf Pengetahuan ketat:
   ```bash
   python3 .agents/scripts/resource_guard.py --profile graph -- python3 .agents/scripts/graph_bridge.py --action update --strict
   python3 .agents/scripts/graph_bridge.py --action verify-artifacts
   python3 .agents/scripts/graph_bridge.py --action coverage
   ```
3. Menjawab dan menyimpan pemahaman baru:
   ```bash
   python3 .agents/scripts/graph_bridge.py --action save-result --question "<pertanyaan>" --answer "<jawaban>" --outcome useful
   ```
