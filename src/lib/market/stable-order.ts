/**
 * Pembanding urutan yang hasilnya sama di setiap basis data. Kueri tanpa ORDER BY mengembalikan baris menurut letak
 * fisiknya, ORDER BY teks mengikuti collation (Postgres lokal dan Supabase memakai versi glibc berbeda), dan baris yang
 * nilai urutnya seri (misalnya tanggal terbit RSS yang tersimpan per hari) keluar dalam urutan bebas. Urutan yang tampil
 * di web, PDF, dan Knowledge Graph disusun dengan pembanding ini supaya localhost sama dengan produksi.
 */

/** Waktu dalam milidetik; tanggal kosong atau tidak sah dianggap paling lama. */
const timeOf = (d: Date | null | undefined): number => {
  const t = d?.getTime();
  return t === undefined || Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** Waktu terbaru dulu; nilai kosong atau tidak sah di akhir. */
export const newestFirst = (a: Date | null | undefined, b: Date | null | undefined): number => timeOf(b) - timeOf(a) || 0;

/**
 * Teks menurut abjad Indonesia; nilai kosong dianggap teks kosong. Teks yang setara bagi localeCompare tetapi berbeda
 * titik kodenya (misalnya emoji dengan dan tanpa pemilih variasi di judul Instagram) dipisah per titik kode, supaya
 * urutannya total.
 */
export const byText = (a: string | null | undefined, b: string | null | undefined): number => {
  const x = a ?? "";
  const y = b ?? "";
  return x.localeCompare(y, "id") || (x < y ? -1 : x > y ? 1 : 0);
};

type ArticleOrderKey = { publishedAt: Date | null; title: string; url: string | null };
/** Berita terbaru dulu; tanggal terbit RSS tersimpan per hari, jadi berita bertanggal sama diurutkan menurut judul. */
export const newestArticleFirst = (a: ArticleOrderKey, b: ArticleOrderKey): number =>
  newestFirst(a.publishedAt, b.publishedAt) || byText(a.title, b.title) || byText(a.url, b.url);
