# Kebijakan Keamanan: Sanghyang Analytics

Repositori `sanghyangresortanyer/sanghyang-analytics` menerapkan praktik pengungkapan kerentanan yang bertanggung jawab (*Responsible Vulnerability Disclosure*) serta perlindungan ketat atas data operasional hotel, data keuangan, dan kredensial pihak ketiga.

---

## 1. Pelaporan Kerentanan Keamanan

Bila Anda menemukan celah keamanan, kelemahan kontrol akses, atau potensi kebocoran data pada Sanghyang Analytics:

- **Jangan** membuka public issue atau pull request yang memuat detail eksploitasi maupun kredensial di GitHub.
- Laporkan temuan secara privat kepada Administrator Sistem atau pengelola repositori Sanghyang Indah Spa Resort disertai langkah reproduksi, ruang lingkup dampak, dan perkiraan tingkat keparahan.

---

## 2. Target SLA Penanganan & Notifikasi Insiden

- **Konfirmasi Penerimaan**: tim pengelola menanggapi laporan dalam waktu maksimal 24 jam kerja.
- **Triase & Isolasi**: penilaian dampak, pencabutan kredensial terdampak (bila ada), dan isolasi celah ditangani secara prioritas.
- **Notifikasi Insiden 72 Jam**: pemberitahuan tertulis dan langkah mitigasi atas insiden pelindungan data pribadi disampaikan paling lambat 72 jam sejak diketahui, selaras dengan UU PDP No. 27/2022 Pasal 46 dan prinsip ISO/IEC 27001.

---

## 3. Kontrol Keamanan Inti (ADR-014 & Empat Nol)

1. **Zero Plaintext Secrets**: seluruh kunci rahasia (`SUPABASE_SECRET_KEY`, `DATABASE_URL`, `CRON_SECRET`, `GEMINI_API_KEY`, `GOOGLE_OAUTH_CLIENT_JSON`, token Meta/Exely/GitHub) hanya disimpan pada variabel lingkungan terenkripsi dan tidak pernah masuk repositori. Token OAuth MCP proyek (`.mcp/`) dan klien OAuth Google lokal (`config/marketing/google-oauth-client.json`) dilindungi oleh `.gitignore`.
2. **Autentikasi Tunggal & Isolasi RLS**: seluruh antarmuka dan endpoint API memverifikasi sesi Supabase Auth ES256 (`src/proxy.ts` fail-closed, `marketingAccess()`), sedangkan endpoint cron menggunakan `Authorization: Bearer <CRON_SECRET>` dengan perbandingan constant-time (`crypto.timingSafeEqual`). Seluruh tabel di schema `public` mengaktifkan Row-Level Security, dan seluruh tabel Market Intelligence mencabut izin `anon` serta `authenticated` dari Data API publik.
3. **Perlindungan Privasi Omset (Zero Rupiah Leak)**: angka rupiah omset hotel hanya tersedia di rute operasional berotorisasi dan tidak pernah diteruskan ke `/api/market-intelligence/summary`, Knowledge Graph, maupun PDF Rapat Senin.
4. **Pengaman Basis Data Produksi**: penulisan ke basis data produksi dari mesin lokal ditolak secara bawaan kecuali `ALLOW_PRODUCTION_WRITE=1` diberikan secara sadar oleh pemilik. Tidak ada hook `pre-push` otomatis yang menulis ke basis data produksi.
5. **Perayapan Aman & Integritas Data**: validasi URL anti-SSRF aktif pada seluruh permintaan perayap, pematuhan `robots.txt` ditegakkan, dan entitas yang dapat diubah bersamaan dilindungi Optimistic Concurrency Control (`version`).
