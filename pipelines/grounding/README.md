# Grounding data pesaing dengan Crawl4AI

Konfigurasi `grounding_fetch.py` (robots.txt dibaca menurut RFC 9309) dan perender Crawl4AI `render_pages.py` (salinan templat `.agents/templates/pipelines/grounding/`). Hasil perayapan ditulis ke `data/grounding/`, yang tidak ikut git.

| Konfigurasi | Isi | Hasil 17 Nov 2026 |
|---|---|---|
| `maps-venue.config.json` | Listing Google Maps restoran, bar, dan spa pesaing (`/maps/place/` dengan `/@lat,lng,17z/` diizinkan robots.txt) | 15 dari 15 listing menampilkan rating dan jumlah ulasan, serta topik ulasan di 12 tempat |
| `situs-kompset.config.json` | Situs resmi kompset & Sanghyang, booking engine MPCA/JYVA, Accor, Aston `llms`, iSeller Beach Point | 52 halaman dan 4 endpoint JSON terambil (`grounding_fetch.py`) untuk dirender dengan `render_pages.py` |
| `kanal-publik.config.json` | Google Maps 7 hotel induk + outlet hotel tambahan, Agoda kompset | 20 URL dalam konfigurasi; perayapan 17 Nov 2026 (25 halaman, audit 0 masalah) memuat 5 halaman kanal video yang kini sudah dilepas dari konfigurasi, jadi perayapan perlu diulang untuk memperbarui hasil |
| `dbistro-situs.config.json` | Halaman restoran di situs resmi hotel pesaing D'Bistro | 6 halaman terbaca, tanpa harga menu; situs Marbella menolak koneksi |
| `sosmed.config.json` | Akun media sosial pesaing di registri | 11 akun Instagram dilarang robots.txt; 2 akun TikTok diizinkan robots.txt tetapi ketentuan layanan TikTok melarang skrip otomatis, jadi tidak dijalankan |

Urutan menjalankan (dari akar proyek, lewat penjaga memori):

```bash
python3 .agents/scripts/grounding_fetch.py plan --config pipelines/grounding/maps-venue.config.json
python3 .agents/scripts/grounding_fetch.py run --config pipelines/grounding/maps-venue.config.json
python3 .agents/scripts/resource_guard.py --profile build -- crawler/.venv/bin/python pipelines/grounding/render_pages.py --config pipelines/grounding/maps-venue.config.json
node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/ingest-crawl4ai-venues.ts data/grounding/maps-venue --apply
```

Perender memakai Google Chrome yang terpasang (`chrome_channel: chrome`) karena browser Playwright belum diunduh di `crawler/.venv`. Mode penyamaran Crawl4AI tidak dipakai: dinding login, CAPTCHA, dan larangan robots.txt berarti berhenti dan melapor.
