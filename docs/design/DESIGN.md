# Panduan Desain Antarmuka: Sanghyang Analytics

Dibuat: 2026-11-13. Diperbarui: 2026-11-25 (ADR-014): cangkang UI utama Sanghyang Analytics di `src/` memakai **Tampilan A** ([`tampilan-a-sanghyang-analytics.md`](tampilan-a-sanghyang-analytics.md)), sedangkan prinsip ruang kerja padat bukti, provenans data, tanpa emoji sebagai ikon, dan kontras WCAG AA di bawah tetap mengikat seluruh tab Marketing (Insight Pasar, Media Sosial, Strategy) serta PDF Rapat Senin.

Dokumen ini melengkapi panduan Tampilan A untuk menjaga keseragaman visual, ketenangan kognitif, dan kepatuhan aksesibilitas di seluruh rute Sanghyang Analytics.

---

## 1. Filosofi dan Prinsip Desain

Sanghyang Analytics adalah ruang kerja operasional VHP dan intelijen pasar internal untuk manajemen serta tim pemasaran Sanghyang Indah Spa Resort (Anyer, Banten). Pengguna utamanya adalah manajemen hotel dan tim pemasaran yang menggunakan aplikasi ini untuk pemantauan harian dan evaluasi mingguan (Rapat Senin).

### 1.1 Prinsip Inti
1. **Ruang Kerja Tenang (Quiet Data Workspace)**:
   - Menghindari stimulasi visual berlebih, gradasi ungu-biru yang mencolok, maupun animasi dekoratif yang tidak perlu.
   - Latar pasir hangat (`--color-surface-base` / `#fbf8f3`) dengan teks tinta (`#1f2b4d`) yang memenuhi kontras WCAG AA.
2. **Padat Informasi dan Berbobot (High Information Density with Provenance)**:
   - Setiap angka dan metrik disajikan bersama cap waktu pengamatan (`observedAt`) dan label sumber verifikasi yang jelas dalam ukuran kecil (8–11px).
   - Bila data belum tersedia, tampilkan status jujur "Belum ada data" beserta alasan yang jelas (Zero Mock & Zero Fallback), bukan angka nol fiktif atau elemen kosong.
3. **Satu Aksen Terkendali (Controlled Single Accent)**:
   - Sidebar dan blok penting memakai hijau velvet merek (`#22382d`). Aksi utama memakai sunset (`#a94617`), tautan memakai lagoon (`#0f5673`), dan palem (`#375b49`) untuk status pembanding. Skala lengkap (sand, mineral, palm, sunset, gold, ink, lagoon) ada di `app/styles/tokens.css`.
4. **Tipografi Terbaca Cepat**:
   - `Archivo` untuk teks, `Noto Serif Display` untuk judul (kelas `font-display`), dan `JetBrains Mono` untuk angka dan kode, dimuat lewat `next/font` di `app/layout.tsx`.
5. **Ikonografi Fungsional Tanpa Emoji (Zero Emoji as Icon)**:
   - Seluruh elemen antarmuka, tombol, tab, dan navigasi WAJIB menggunakan ikon SVG vektor yang seragam (`lucide-react`). Dilarang menggunakan emoji karakter Unicode sebagai ikon atau bullet list.

---

## 2. Struktur Tata Letak (Unified AppShell)

Seluruh rute aplikasi dibungkus oleh kerangka kerja tunggal `AppShell` (`components/layout/app-shell.tsx`):

```
+-----------------------------------------------------------------------------------+
|  AppSidebar (Desktop: sticky 260px | Mobile: drawer / responsive header)          |
|  +-----------------------------------------------------------------------------+  |
|  | Brand: Sanghyang Indah                                                      |  |
|  | Subtitle: Ruang Kerja Pemasaran                                              |  |
|  +-----------------------------------------------------------------------------+  |
|  | Navigasi Utama (lib/navigation.ts):                                         |  |
|  | [LayoutDashboard]  Ringkasan             (/dashboard)                       |  |
|  | [Newspaper]        Newsletter            (/)                                |  |
|  | [TrendingUp]       Insight Pasar         (/market-intelligence)             |  |
|  | [Images]           Galeri Pesaing        (/galeri-kompetitor)               |  |
|  | [Share2]           Media Sosial          (/marketing-sosmed)                |  |
|  | [Receipt]          Omset & Target        (/admin/omset)                     |  |
|  | [RefreshCw]        Pembaruan Data        (/admin/scraping)                  |  |
|  | [HelpCircle]       Metodologi            (/market-intelligence#methodology) |  |
|  +-----------------------------------------------------------------------------+  |
|  | Footer Sidebar: Status Lingkungan (Lokal/Produksi) & Versi                   |  |
+-----------------------------------------------------------------------------------+
|  Main Workspace Area (Flex-1, Scrollable, Max-width 7xl, Responsive Padding)      |
|  +-----------------------------------------------------------------------------+  |
|  | Header Rute: Breadcrumb/Kategori, Judul Halaman (H1), Deskripsi Ringkas     |  |
|  +-----------------------------------------------------------------------------+  |
|  | Page Content (Modular Components, Scannable Tables, KPI Cards)             |  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Sistem Token Desain (Tailwind CSS v4 `@theme`)

Token desain didefinisikan secara deklaratif di `app/globals.css` menggunakan sintaks CSS-first Tailwind v4 `@theme`:

### 3.1 Token Warna

Token semantik di `app/globals.css` memetakan skala merek di `app/styles/tokens.css`. Komponen memakai token, bukan HEX langsung (diperiksa tes U4).

| Kategori | Token Tailwind | Nilai | Peruntukan |
| :--- | :--- | :--- | :--- |
| **Latar dasar** | `--color-surface-base` | `#fbf8f3` (sand) | Latar halaman |
| **Latar kartu** | `--color-surface-card` | `#ffffff` | Kartu, panel, tabel |
| **Latar terangkat** | `--color-surface-elevated` | `#f8f3eb` | Panel ringkasan, blok sorotan |
| **Latar halus** | `--color-surface-subtle` | `#f5efe6` | Header tabel, baris bergantian |
| **Sidebar** | `--color-sidebar-bg` | `#22382d` (velvet) | AppSidebar, sampul PDF, header Metodologi |
| **Aksi utama** | `--color-primary` | `#a94617` (sunset) | Tombol utama, eyebrow |
| **Sekunder** | `--color-secondary` | `#375b49` (palm) | Lencana pembanding, status positif |
| **Tautan** | `--color-link` | `#0f5673` (lagoon) | Tautan sumber |
| **Fokus** | `--color-focus` | `#116a8e` | Cincin fokus papan ketik |
| **Teks utama** | `--color-text-main` | `#1f2b4d` (ink) | Teks bacaan dan judul |
| **Teks sekunder** | `--color-text-muted` | `#685a49` | Keterangan, sumber kecil |
| **Garis batas** | `--color-border-card` | `#eae1d3` | Border kartu dan pembatas tabel |
| **Peta 3D** | `--color-era-ink` | tinta gelap | Latar Knowledge Graph; warna simpul per jenis di `components/knowledge-graph/kind-colors.ts` |

### 3.2 Tipografi dan Skala Hierarki

- **Heading 1 (`font-display text-3xl`)**: Judul utama rute (mis. "Insight Pasar", "Peta relasi data pasar").
- **Heading 2 (`font-display text-2xl`)**: Judul seksi, didahului eyebrow (`.eyebrow`, huruf kapital kecil berwarna sunset).
- **Heading 3 (`text-sm font-semibold uppercase tracking-wider text-muted`)**: Subbagian, header tabel.
- **Body (`text-sm text-main leading-relaxed`)**: Paragraf, nilai metrik, ulasan.
- **Caption / Metadata (`text-xs text-dim`)**: Bukti sumber, cap tanggal (`2026-11-13 · Sumber: Google Travel`).

### 3.3 Sudut Membulat (Border Radius)

- Kontainer & Panel Kartu: `rounded-xl` (12px).
- Tombol & Field Input: `rounded-lg` (8px).
- Lencana & Tag Status: `rounded-full` (9999px).

---

## 4. Standar Aksesibilitas dan Interaksi

1. **Fokus Papan Ketik**:
   - Seluruh elemen interaktif (`a`, `button`, `input`, `select`) wajib memiliki cincin fokus `--color-focus` (aturan `:focus-visible` global di `app/globals.css`).
2. **Navigasi Semantik**:
   - AppSidebar menggunakan tag `<aside aria-label="Navigasi Utama">`.
   - Daftar tautan dibungkus dalam tag `<nav>` dengan atribut `aria-current="page"` pada rute aktif.
3. **Penyajian Data Berkurang Gerak (`prefers-reduced-motion`)**:
   - Transisi warna dibatasi 150ms. Animasi dekoratif dihentikan saat preferensi `reduce` aktif. Spinner pemuatan tetap berputar untuk memberi umpan balik operasional.
4. **Responsivitas Ponsel**:
   - Diuji pada viewport 390px × 844px (iPhone 12/13/14) tanpa terjadinya pergeseran horizontal (`overflow-x-hidden`).
   - AppSidebar bertransformasi menjadi header mobile yang kompak dengan navigasi horizontal yang dapat diakses dengan mudah.

---

## 5. Kontrak Definisi Navigasi (`lib/navigation.ts`)

Seluruh tautan dan identitas rute diatur secara terpusat:

```typescript
export interface NavItem {
  id: string;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
  matchPrefix?: boolean;
}
```

Daftar 9 menu kanonis (susunan 13 Nov 2026):
1. `Ringkasan` (`/dashboard`)
2. `Untuk Direksi` (`/direksi`)
3. `Newsletter` (`/`)
4. `Insight Pasar` (`/market-intelligence`): lima langkah per outlet, satu tombol "Perbarui Semua Data"
5. `Galeri Pesaing` (`/galeri-kompetitor`)
6. `Media Sosial` (`/marketing-sosmed`)
7. `Omset, Target dan Strategy` (`/admin/omset`): tujuan bulan ini, omset, radar promo, dan draf konten
8. `Knowledge Graph` (`/knowledge-graph`): peta 3D relasi data dengan tabel sebagai alternatif papan ketik
9. `Metodologi` (`/market-intelligence#methodology`)

Rute lama `/admin/scraping` dialihkan ke Insight Pasar.
