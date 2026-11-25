/**
 * Memotong teks tanpa memutus emoji atau huruf gabungan. `String.slice` bekerja per unit UTF-16, sehingga emoji
 * (pasangan surrogate) bisa terbelah dua; Prisma lalu menolak teksnya dengan "unexpected end of hex escape"
 * (galat promo Marbella 13 Nov 2026). Pemotongan di sini mengikuti batas grafem.
 */
const segmenter = new Intl.Segmenter("id", { granularity: "grapheme" });

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (out.length + segment.length > maxLength) break;
    out += segment;
  }
  return out;
}

/** Titik setelah token sependek ini (Jl., Kp., No., dll.) dibaca sebagai singkatan, bukan akhir kalimat. */
const ABBREVIATION_MAX_LETTERS = 3;
/** Tanda akhir kalimat (boleh diikuti kutip atau kurung tutup) yang disusul spasi lalu awal kalimat berhuruf besar. */
const SENTENCE_END = /(\S*?)([.!?…]+)(["'”’)\]]*)(?=\s+["'“‘(]?\p{Lu})/gu;

/**
 * Memendekkan teks tanpa memotong kalimat: kalimat utuh diambil selama muat dalam maxLength, sisanya dibuang. Kalimat
 * pertama selalu utuh walau lebih panjang, karena teks yang putus di tengah kata menyesatkan pembaca (matriks PDF Rapat
 * Senin, 16 Nov 2026). Teks tanpa akhir kalimat yang bisa dikenali dikembalikan utuh.
 */
export function truncateAtSentence(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const ends = [...text.matchAll(SENTENCE_END)]
    .filter((m) => m[2] !== "." || m[1].replace(/\P{L}/gu, "").length > ABBREVIATION_MAX_LETTERS)
    .map((m) => m.index + m[0].length);
  return text.slice(0, ends.filter((end) => end <= maxLength).at(-1) ?? ends[0] ?? text.length);
}

/** Buang surrogate tunggal yang sudah rusak sejak sumbernya, supaya teks aman disimpan dan dikirim sebagai JSON. */
export const stripLoneSurrogates = (text: string) => text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
