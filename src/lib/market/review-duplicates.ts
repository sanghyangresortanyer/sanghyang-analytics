/**
 * Ulasan ganda: teks yang sama dari sumber yang sama untuk tempat yang sama. Muncul dari versi lama crawler yang
 * memasukkan tanggal relatif ("2 minggu lalu") ke externalId, sehingga ulasan lama tersimpan lagi saat tanggalnya
 * bergeser, dan dari kartu Google Maps yang tertangkap terpotong lalu tersimpan lagi utuh. Sisanya diarsipkan (bukan
 * dihapus) oleh scripts/ops/archive-duplicate-reviews.ts.
 */
export interface ReviewRowForDedupe {
  id: string;
  competitorId: string;
  source: string;
  text: string;
  /** Untuk ulasan Google Maps memuat reviewid kartu, penanda satu ulasan yang paling andal. */
  sourceUrl?: string;
  capturedAt: Date;
}

export const normalizeReviewText = (text: string) => text.trim().replace(/\s+/g, " ");

const reviewIdOf = (sourceUrl?: string) => sourceUrl?.match(/[?&]reviewid=([^&]+)/)?.[1] ?? null;

/**
 * Id baris yang harus diarsipkan. Satu ulasan = review id Google yang sama, atau teks yang sama bila review id tidak
 * ada. Di tiap kelompok disimpan teks terlengkap (versi tidak terpotong); bila sama panjang, yang paling awal ditangkap.
 */
export function findDuplicateReviews(rows: ReviewRowForDedupe[]): string[] {
  const groups = new Map<string, ReviewRowForDedupe[]>();
  for (const row of rows) {
    const reviewId = reviewIdOf(row.sourceUrl);
    const key = `${row.competitorId}|${row.source}|${reviewId ? `rid:${reviewId}` : `txt:${normalizeReviewText(row.text)}`}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((group) =>
    group
      .sort(
        (a, b) =>
          normalizeReviewText(b.text).length - normalizeReviewText(a.text).length ||
          a.capturedAt.getTime() - b.capturedAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice(1)
      .map((row) => row.id),
  );
}
