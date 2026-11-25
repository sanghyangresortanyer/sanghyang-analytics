/**
 * Dasar harga tarif kamar yang dibandingkan di seluruh aplikasi: harga per malam termasuk pajak dan biaya, yaitu pilihan
 * Google Travel "Total per malam" dan penawaran tab Prices yang dibuka dengan wilayah Indonesia (room-offers.ts).
 *
 * Tarif properti berpaket lama ("Google Hotels displayed rate") dibaca tanpa memastikan pilihan tampilan harga. Google
 * memilih tampilan dari lokasi alamat internet: dari komputer lokal di Indonesia hasilnya total per malam, dari runner
 * GitHub di AS hasilnya harga sebelum pajak dan biaya. Per 23 Nov 2026, 377 dari 507 baris paket lama dibaca di dalam run
 * GitHub Actions; contohnya Sanghyang check-in 24 Nov dibaca CI Rp 311.328 dan dibaca lokal Rp 361.792 (sama dengan
 * halaman). Isi baris tidak membedakan keduanya, jadi paket lama tidak dipakai di perbandingan mana pun dan tetap tersimpan
 * sebagai arsip (sinkron DB memasangkan tarif lewat identitas tangkapan, jadi barisnya tidak diubah).
 */
export const PROPERTY_RATE_PACKAGE = "Google Hotels total per malam";
export const LEGACY_PROPERTY_RATE_PACKAGE = "Google Hotels displayed rate";

/** Nama paket tangkapan per kamar yang menyimpan status sarapan penawaran (full-refresh.ts). */
export const WITH_BREAKFAST_PACKAGE = "Termasuk sarapan";
export const WITHOUT_BREAKFAST_PACKAGE = "Tanpa sarapan";

/** Tarif termurah properti tanpa nama kamar, paket baru maupun lama. */
export const isPropertyRatePackage = (packageName: string | null | undefined): boolean =>
  packageName === PROPERTY_RATE_PACKAGE || packageName === LEGACY_PROPERTY_RATE_PACKAGE;

/** Tangkapan yang dasar harganya total per malam: semua kecuali tarif properti paket lama. */
export const isComparableRate = (row: { packageName?: string | null }): boolean => row.packageName !== LEGACY_PROPERTY_RATE_PACKAGE;

/** Saringan Prisma setara isComparableRate. `not` saja membuang baris tanpa paket (NULL di SQL), jadi NULL disebut. */
export const COMPARABLE_RATE_WHERE = {
  OR: [{ packageName: null }, { packageName: { not: LEGACY_PROPERTY_RATE_PACKAGE } }],
};

/** Status sarapan penawaran per kamar dari nama paketnya; null untuk paket lain (tarif properti). */
export function breakfastFromPackage(packageName: string | null | undefined): boolean | null {
  if (packageName === WITH_BREAKFAST_PACKAGE) return true;
  if (packageName === WITHOUT_BREAKFAST_PACKAGE) return false;
  return null;
}
