# Panduan Integrasi API Resmi (C3 & ADR-004)

Dokumen ini menjelaskan arsitektur adaptor API resmi, langkah pendaftaran, kuota, perkiraan biaya, dan konfigurasi variabel lingkungan untuk menghubungkan sumber data eksternal ke Sanghyang News.

---

## 1. Latar Belakang dan Prinsip Kepatuhan (ADR-004)

Berdasarkan audit 13 November 2026 dan keputusan arsitektur ADR-004:
1. **Zero Cookie Injection / Tanpa Penembusan Login**: Aplikasi tidak melakukan scraping DOM atau injeksi cookie sesi terotentikasi pada platform pihak ketiga (seperti Instagram, Facebook, TikTok) yang mewajibkan autentikasi pengguna.
2. **Status "Belum Tersambung" yang Jujur**: Apabila kredensial API resmi belum diatur oleh pemilik, sistem secara transparan menampilkan status **"Belum tersambung"** (Zero Mock), tanpa merekayasa data atau memicu loop kegagalan.
3. **Keputusan Pemilik**: Pendaftaran akun pengembang, penerbitan token, dan pembayaran kuota API pihak ketiga merupakan keputusan pemilik repo (*USER.md*).

---

## 2. Rincian Adaptor API Resmi & Pemisahan Jalur Publik vs Akun Sendiri

> **Catatan ADR-004 (Pembaruan 17 Nov 2026):** Data sosial publik tanpa login akun Sanghyang (mis. postingan publik akun bisnis pesaing lewat Business Discovery dan `TikTok oEmbed`) dijalankan secara terpisah dari **OAuth akun milik Sanghyang sendiri** yang hanya dibutuhkan untuk analitik konten internal, data iklan, serta izin komentar postingan milik Sanghyang (`instagram_manage_comments`).

### A. Google Business Profile API
- **Tujuan**: Mengambil ulasan autentik, rating, dan tanggapan manajemen untuk properti Sanghyang Indah Spa Resort beserta outlet-outletnya secara langsung.
- **Kredensial yang Dibutuhkan**:
  - `GOOGLE_BUSINESS_PROFILE_API_KEY` (atau OAuth 2.0 Access Token)
  - `GOOGLE_BUSINESS_ACCOUNT_ID` (ID Akun Bisnis Google)
  - `GOOGLE_BUSINESS_LOCATION_ID` (ID Lokasi Properti)
- **Langkah Pendaftaran**:
  1. Buka [Google Cloud Console](https://console.cloud.google.com/).
  2. Buat proyek atau pilih proyek yang sudah ada.
  3. Aktifkan **Google My Business API** / **Business Information API** dan **Account Management API**.
  4. Ajukan verifikasi kepemilikan bisnis melalui Profil Bisnis Google (Google Business Profile Manager) untuk mendapatkan akses produksi.
  5. Buat kredensial OAuth 2.0 Client ID atau API Key dengan pembatasan domain/IP.
- **Kuota & Biaya**:
  - Kuota gratis: Hingga 180 permintaan per menit per proyek.
  - Biaya: Gratis untuk membaca ulasan lokasi bisnis yang diverifikasi milik sendiri.

---

### B. Instagram Graph API (Meta for Developers)
- **Tujuan**:
  - Mengambil insight dan postingan dari akun Instagram resmi Sanghyang.
  - Memantau postingan publik akun bisnis kompetitor melalui endpoint resmi `ig_user/business_discovery` tanpa scraping DOM atau cookie sesi.
- **Kredensial yang Dibutuhkan**:
  - `INSTAGRAM_GRAPH_ACCESS_TOKEN` (Long-lived User/Page Access Token dengan permission `instagram_basic`, `pages_show_list`, `instagram_manage_insights`)
  - `INSTAGRAM_BUSINESS_ACCOUNT_ID` (ID Akun Bisnis Instagram yang terhubung ke Halaman Facebook)
- **Langkah Pendaftaran**:
  1. Buka [Meta for Developers](https://developers.facebook.com/).
  2. Buat Meta App dengan tipe **Business**.
  3. Pastikan akun Instagram Sanghyang adalah akun Profesional (Bisnis/Kreator) dan terhubung ke Halaman Facebook resmi.
  4. Tambahkan produk **Instagram Graph API**.
  5. Di Graph API Explorer, buat token pengguna dengan izin `instagram_basic` dan tukarkan menjadi long-lived access token (berlaku 60 hari).
- **Kuota & Biaya**:
  - Batas panggilan: 200 panggilan per jam per pengguna aplikasi.
  - Biaya: Gratis untuk platform Meta Graph API dasar.

---

### C. Google Places API (New)
- **Tujuan**: Mengambil data agregat rating bintang, jumlah ulasan publik, jam operasional, dan foto resmi untuk kompetitor di koridor Anyer–Carita.
- **Kredensial yang Dibutuhkan**:
  - `GOOGLE_PLACES_API_KEY` (API Key Google Cloud dengan batasan API `Places API (New)`)
- **Langkah Pendaftaran**:
  1. Buka [Google Cloud Console](https://console.cloud.google.com/).
  2. Aktifkan **Places API (New)** pada menu APIs & Services.
  3. Buat API Key baru di menu **Credentials**.
  4. Berikan pembatasan API (API Restrictions) hanya ke Places API (New) dan pembatasan aplikasi (IP address server).
  5. Gunakan parameter `FieldMask` (seperti `id,displayName,rating,userRatingCount,photos`) agar hanya menagih field yang dibutuhkan.
- **Kuota & Biaya**:
  - Google Cloud memberikan kredit gratis senilai **$200 USD per bulan** untuk setiap akun penagihan aktif.
  - Tarif Places Details (Basic + Atmosphere): ± $0.017 – $0.025 USD per permintaan setelah kuota kredit habis.

---

## 3. Implementasi Kode dan Penanganan Status

Arsitektur adaptor berada di folder `lib/market/adapters/`:
- `lib/market/adapters/types.ts`: Antarmuka standar `OfficialApiAdapter` dan `AdapterStatus`.
- `lib/market/adapters/google-business-profile.ts`: Kelas `GoogleBusinessProfileAdapter`.
- `lib/market/adapters/instagram-graph.ts`: Kelas `InstagramGraphAdapter`.
- `lib/market/adapters/google-places.ts`: Kelas `GooglePlacesAdapter`.
- `lib/market/adapters/index.ts`: Registri terpadu `getAllOfficialAdapters()` dan `getOfficialAdapterStatuses()`.

### Contoh Perilaku Saat Kredensial Kosong
```typescript
import { getAllOfficialAdapters } from '@/lib/market/adapters';

const adapters = getAllOfficialAdapters();
for (const adapter of adapters) {
  const status = adapter.getStatus();
  console.log(`${status.name}: ${status.statusLabel}`);
  // Output:
  // Google Business Profile API: Belum tersambung
  // Instagram Graph API: Belum tersambung
  // Google Places API: Belum tersambung
}
```

---

## 4. Rangkuman Variabel Lingkungan

Tambahkan variabel berikut ke `.env.development.local` (atau setelan Vercel jika disetujui pemilik):

```bash
# Google Business Profile API
GOOGLE_BUSINESS_PROFILE_API_KEY=""
GOOGLE_BUSINESS_ACCOUNT_ID=""
GOOGLE_BUSINESS_LOCATION_ID=""

# Instagram Graph API
INSTAGRAM_GRAPH_ACCESS_TOKEN=""
INSTAGRAM_BUSINESS_ACCOUNT_ID=""

# Google Places API
GOOGLE_PLACES_API_KEY=""
```

Jika variabel di atas kosong atau belum disetel, sistem tetap berfungsi normal dan menampilkan status jujur "Belum tersambung".
