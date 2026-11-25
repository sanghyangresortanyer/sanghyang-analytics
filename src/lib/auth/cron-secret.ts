import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Perbandingan rahasia waktu konstan (SHA-256 menyamakan panjang kedua sisi menjadi 32 bita).
 * Dipakai untuk validasi `CRON_SECRET` pada endpoint cron terjadwal.
 */
export function timingSafeSecretMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || !provided || !expected) return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/** Verifikasi header `Authorization: Bearer <CRON_SECRET>` secara timing-safe. */
export function isAuthorizedCronRequest(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  const expected = secret?.trim();
  const header = request.headers.get("authorization");
  if (!expected || !header || !header.startsWith("Bearer ")) return false;
  return timingSafeSecretMatch(header.slice(7).trim(), expected);
}
