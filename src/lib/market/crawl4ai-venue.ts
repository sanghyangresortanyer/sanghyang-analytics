/**
 * Membaca Markdown listing Google Maps hasil render Crawl4AI (pipelines/grounding/render_pages.py). Tampilan terbatas
 * untuk perayap jujur memuat rating listing, jumlah ulasan, dan tombol topik ulasan; bintang per ulasan tidak tampil,
 * jadi isi ulasan tidak diambil dari sini (tabel CompetitorReview mewajibkan rating per ulasan).
 */

export interface RenderedListing {
  rating: number;
  reviewCount: number;
  topics: { label: string; count: number }[];
}

// "4,5" lalu "100 ulasan" di Ringkasan ulasan; cadangannya tajuk "4,5(100)" di bawah nama tempat.
const SUMMARY_RATING = /\n(\d),(\d)\s*\n([\d.]+) ulasan\b/;
const HEADER_RATING = /(\d),(\d)\(([\d.]+)\)/;
const TOPIC_LINE = /^(.+?) (\d+)$/;
// Google menyisipkan glif ikon dari area pakai-pribadi Unicode di depan label tombol ("Urutkan", "Semua").
const ICON_GLYPHS = /[-]/g;

/** Rating, jumlah ulasan, dan topik ulasan; null bila panel tempat tidak tersedia untuk tampilan ini. */
export function parseRenderedListing(markdown: string): RenderedListing | null {
  const match = markdown.match(SUMMARY_RATING) ?? markdown.match(HEADER_RATING);
  if (!match) return null;
  const lines = markdown.split("\n").map((line) => line.replace(ICON_GLYPHS, "").trim());
  // Tombol topik berderet sesudah "Urutkan" dan "Semua", sampai tombol "+n" atau baris pengulas pertama.
  const start = lines.findIndex((line, index) => line === "Urutkan" && lines[index + 1] === "Semua");
  const topics: RenderedListing["topics"] = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 2)) {
      const topic = line.match(TOPIC_LINE);
      if (!topic) break;
      topics.push({ label: topic[1], count: Number(topic[2]) });
    }
  }
  return { rating: Number(`${match[1]}.${match[2]}`), reviewCount: Number(match[3].replace(/\./g, "")), topics };
}
