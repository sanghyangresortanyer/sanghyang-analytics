/**
 * Menit berkendara hanya dipercaya dari pengukuran Google Maps. Server demo OSRM memberi jarak km yang wajar, tetapi
 * durasinya jauh lebih pendek dari kenyataan jalan Anyer (19,3 km tercatat 14 menit), jadi menitnya tidak ditampilkan.
 */
const OSRM_SOURCE = /\bosrm\b/i;
const GOOGLE_MAPS_SOURCE = /google maps/i;

export function drivingMinutesFor(distanceSource: string | null | undefined, minutes: number | null | undefined): number | null {
  if (!distanceSource || minutes == null || OSRM_SOURCE.test(distanceSource)) return null;
  return GOOGLE_MAPS_SOURCE.test(distanceSource) ? minutes : null;
}
