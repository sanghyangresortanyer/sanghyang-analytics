# Karantina Skrip Sintetis CrawlAI Research Engine

Berkas di dalam folder ini dikarantina per audit 13 November 2026 (Temuan D8, Konstitusi Inti Pasal I: Zero Mock Data, dan ADR-003 Provenans Data).

## Daftar Berkas yang Dikarantina

1. `crawl_more_sentiment.py`
2. `deepen_sentiment_data.py`
3. `enrich_customer_evidence.py`
4. `execute_new_research_cycle.py`
5. `expand_multichannel_sentiment.py`
6. `update_report_findings.py`

## Alasan Karantina

- **Data Ulasan Sintetis Tertanam**: Skrip-skrip di atas menanamkan lebih dari 94 kutipan ulasan dan komentar konsumen buatan langsung di kode sumber, alih-alih mengambil observasi dari crawl nyata.
- **URL Palsu**: Menghasilkan 49+ tautan palsu dengan parameter buatan seperti `maps.google.com/?cid=sanghyangresortanyer`, `maps.google.com/?cid=sunsetgrillsanghyanganyer`, dll., yang tidak bisa diakses atau diverifikasi di Google Maps.
- **Temuan Karangan**: `update_report_findings.py` menyusun temuan laporan eksekutif dan komparasi berdasarkan data ulasan sintetis tersebut, yang berisiko mencemari data tabel `CompetitorReview` dan `MarketInsight` melalui alur `scripts/export_crawlai_for_ingest.py` dan `scripts/ingest-crawlai-evidence.ts`.

## Kebijakan Penggunaan

- Berkas-berkas ini **DILARANG** dijalankan dalam lingkungan produksi maupun pengujian data aktif.
- Alur `ingest-crawlai-evidence.ts` telah dipasangi filter validasi ketat yang menolak setiap rekaman tanpa `sourceUrl` valid atau yang menggunakan pola buatan `?cid=`.
