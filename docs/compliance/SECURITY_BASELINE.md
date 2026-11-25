# Standar dasar keamanan dan anti-bot: Sanghyang News

Dibuat 2026-11-13. Isi pada gerbang G3 dengan skill `web-security-baseline` dan `anti-bot-abuse-protection`. Kolom Status
hanya berisi **Diterapkan**, **Tidak berlaku** (dengan alasan), **Belum**, atau **Risiko diterima** (dengan tanggal
kedaluwarsa). Kolom Bukti menunjuk tes atau job CI, bukan niat.

## 1. Header dan CSP

| Kontrol | Implementasi (berkas) | Bukti (tes atau CI) | Status |
| :--- | :--- | :--- | :--- |
| CSP: nonce di rute transaksi, allowlist statis di halaman ber-cache | | | Belum |
| Rute ber-nonce tidak pernah statis | | | Belum |
| HSTS, nosniff, Referrer-Policy, COOP, X-Frame-Options, Permissions-Policy | | | Belum |
| noindex di host pratinjau dan non-kanonik | | | Belum |

## 2. Autentikasi dan permukaan admin

| Kontrol | Implementasi (berkas) | Bukti (tes atau CI) | Status |
| :--- | :--- | :--- | :--- |
| Admin di path non-bawaan; rute bawaan dan rute pengembangan 404 di produksi | | | Belum |
| Login staf, peran per unit, usia sesi maksimum | | | Belum |
| Kunci akun setelah gagal berulang; cookie Strict dan Secure | | | Belum |

## 3. Basis data

| Kontrol | Implementasi (berkas) | Bukti (tes atau CI) | Status |
| :--- | :--- | :--- | :--- |
| Peran runtime tanpa BYPASSRLS dan DDL, dengan batas waktu | | | Belum |
| RLS ENABLE dan FORCE di semua tabel | | | Belum |
| REVOKE EXECUTE dari PUBLIC, search_path kosong | | | Belum |
| Log audit hanya-tambah | | | Belum |

## 4. Rahasia dan data pribadi

| Kontrol | Implementasi (berkas) | Bukti (tes atau CI) | Status |
| :--- | :--- | :--- | :--- |
| Env tervalidasi; berkas contoh dan dokumen sinkron | | | Belum |
| Pemindai rahasia di CI dan pre-push | | | Belum |
| Enkripsi kolom data pribadi dan kolom HMAC pencarian | | | Belum |
| Tanpa pelacak di halaman bertoken atau berdata pribadi | | | Belum |

## 5. Titik masuk

| Kontrol | Implementasi (berkas) | Bukti (tes atau CI) | Status |
| :--- | :--- | :--- | :--- |
| Verifikasi tanda tangan webhook dengan jendela anti-putar-ulang | | | Belum |
| Idempotency-Key di setiap POST yang mengubah keadaan | | | Belum |
| Unggahan lewat URL bertanda tangan, MIME di-allowlist | | | Belum |
| Galat problem+json tanpa data pribadi | | | Belum |

## 6. Anti-bot dan penyalahgunaan

| Kontrol | Implementasi (berkas) | Bukti (tes atau CI) | Status |
| :--- | :--- | :--- | :--- |
| Tantangan anti-bot di setiap tulis publik, gagal tertutup | | | Belum |
| Batas laju per IP (HMAC) dengan Retry-After | | | Belum |
| Aturan firewall: jalur vendor dan crawler pencarian tidak ditantang | | | Belum |
| robots.txt statis; crawler pelatihan dilarang; llms.txt cocok dengan data terstruktur | | | Belum |
| Penjaga kuota: polling, cron bergerbang SQL, monitor ke berkas statis | | | Belum |

## 7. CI, rantai pasok, cadangan

| Kontrol | Implementasi (berkas) | Bukti (tes atau CI) | Status |
| :--- | :--- | :--- | :--- |
| Gerbang CI berurutan; action dipin SHA; biner dipin SHA-256 | | | Belum |
| SAST dan pemindai kerentanan memblokir temuan tinggi | | | Belum |
| Cadangan terenkripsi; pemulihan pernah dilatih | | | Belum |
| Migrasi produksi lewat workflow manual berkonfirmasi | | | Belum |

## Risiko yang diterima

| Risiko | Alasan | Diterima oleh | Kedaluwarsa |
| :--- | :--- | :--- | :--- |
| | | | |
