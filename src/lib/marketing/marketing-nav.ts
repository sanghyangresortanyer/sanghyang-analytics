// Navigasi halaman Marketing yang dipanggil di server (page.tsx), jadi tidak boleh berada di berkas "use client".

/** Bagian lama yang isinya sudah dilebur ke bagian lain: tab Sosmed Sanghyang kini bagian dari Media Sosial. */
const MERGED_SECTIONS = new Map<string, string>([["sosmed", "media-sosial"]]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Alamat pengganti untuk tautan lama ke bagian yang sudah dilebur, atau null bila bagiannya masih ada. Pilihan `lihat`
 * lama tidak dibawa (artinya lain di bagian baru), jadi halaman membuka outlet bawaan; periode yang sah tetap dibawa.
 */
export function legacyMarketingHref(query: Record<string, string | string[] | undefined>): string | null {
  const bagian = first(query.bagian);
  const target = bagian ? MERGED_SECTIONS.get(bagian) : undefined;
  if (!target) return null;
  const params = new URLSearchParams({ bagian: target });
  const startDate = first(query.startDate);
  const endDate = first(query.endDate);
  if (startDate && endDate && ISO_DAY.test(startDate) && ISO_DAY.test(endDate) && startDate <= endDate) {
    params.set("startDate", startDate);
    params.set("endDate", endDate);
  }
  return `/marketing?${params.toString()}`;
}
