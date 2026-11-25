/**
 * Galat pengambilan data dalam bahasa tim pemasaran. Pesan teknis aslinya tetap tersimpan di ScrapeError;
 * yang tampil di halaman hanya penjelasan singkat dan nama tempat yang bermasalah.
 */

const SUBJECT = /^(?:Ulasan gagal untuk|Rating gagal untuk|Sosmed gagal untuk|Gemini gagal membaca postingan:|Perlu akses resmi Instagram: login wall untuk)\s*([\s\S]+?)(?::\s+([\s\S]+))?$/;

const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/Timed out after waiting \d+ms|timeout/i, () => "halaman terlalu lama dimuat"],
  [/halaman hotel Google Travel tidak ditemukan/i, () => "halamannya belum ditemukan di Google Travel"],
  [/\b503\b|UNAVAILABLE|high demand|overloaded/i, () => "layanan pembaca otomatis sedang sibuk"],
  [/\b429\b|Terlalu Banyak Permintaan|rate limit/i, () => "sumber membatasi jumlah permintaan"],
  [/unexpected end of hex escape|surrogate/i, () => "teks berisi emoji terpotong saat disimpan"],
  [/Instagram Graph API belum tersambung/i, () => "Instagram belum tersambung lewat akses resmi"],
  // Run tanpa masukan (lihat SKIP_PREFIX di refresh-outcome.ts): alasannya sudah ditulis untuk tim pemasaran.
  [/^Dilewati:\s*([\s\S]+?)\.?$/, (m) => m[1].trim()],
  [/login wall|meminta login/i, () => "Instagram meminta login"],
  [/tidak ada postingan/i, () => "akun tidak menampilkan postingan yang bisa dibaca"],
  [/kontrol urutan "Terbaru" tidak ditemukan|0 kartu ulasan terbaca|tidak ada yang bisa diurai/i, () => "tata letak halaman ulasan berubah"],
  [/rating tidak terbaca/i, () => "rating tidak tampil di Google Maps"],
  [/ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|net::ERR/i, () => "sumber tidak dapat dihubungi"],
  [/OCC conflict/i, () => "data sedang diubah proses lain"],
];

/** Satu kalimat pendek: "<tempat>: <penjelasan>" bila nama tempatnya ada di pesan. */
export function friendlyScrapeIssue(message: string): string {
  const subject = message.match(SUBJECT);
  const place = subject?.[1]?.trim() ?? null;
  const detail = subject?.[2] ?? message;
  const rule = RULES.find(([re]) => re.test(detail));
  const explanation = rule ? rule[1](detail.match(rule[0])!) : `kendala teknis (${detail.replace(/\s+/g, " ").trim().slice(0, 120)})`;
  return place ? `${place}: ${explanation}` : explanation.charAt(0).toUpperCase() + explanation.slice(1);
}

export const JOB_LABEL: Record<string, string> = {
  news: "Berita kawasan Anyer",
  rates: "Tarif kamar kompetitor",
  reviews: "Ulasan kompetitor",
  social: "Media sosial kompetitor",
  promos: "Status promo kompetitor",
  website: "Promo situs resmi kompetitor",
  ratings: "Rating 6 outlet Sanghyang",
  photos: "Foto & menu kompetitor",
  room_rates: "Tarif 14 malam & tipe kamar",
};
