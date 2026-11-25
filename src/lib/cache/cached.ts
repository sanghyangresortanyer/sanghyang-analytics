import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const OUTSIDE_NEXT_CACHE_SCOPE_RE = /incrementalCache missing|static generation store missing/i;

export type AdminSupabaseClient = ReturnType<typeof createAdminClient>;

let warnedMissingAdminKey = false;

/** Mengembalikan true bila kredensial admin Supabase tersedia untuk pembacaan di dalam `unstable_cache`. */
export function hasAdminSupabaseKey(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SECRET_KEY?.trim());
}

/** Mendeteksi galat invariant khas Next.js saat fungsi cache dipanggil dari CLI atau unit test di luar runtime Next.js. */
export function isOutsideNextCacheScopeError(error: unknown): boolean {
  return error instanceof Error && OUTSIDE_NEXT_CACHE_SCOPE_RE.test(error.message);
}

/**
 * Pembungkus `unstable_cache` Next.js 16.4.6.
 * JANGAN PERNAH memanggil `cookies()`, `headers()`, atau `createClient()` berbasis sesi di dalam `fn`.
 */
export async function withCache<T>(
  fn: () => Promise<T>,
  keyParts: readonly string[],
  options: { tags: readonly string[]; revalidate: number },
): Promise<T> {
  const cachedFn = unstable_cache(fn, [...keyParts], {
    tags: [...options.tags],
    revalidate: options.revalidate,
  });
  try {
    return await cachedFn();
  } catch (error) {
    if (isOutsideNextCacheScopeError(error)) {
      // ZERO-FALLBACK: pemanggilan dari CLI atau unit test di luar server Next.js tidak memiliki incrementalCache;
      // jalankan kueri asli langsung tanpa menelan galat aplikasi atau basis data.
      return fn();
    }
    throw error;
  }
}

/**
 * Varian `withCache` untuk nilai bertipe `Map<K, V>`.
 * `unstable_cache` menserialisasi JSON (yang mengubah `Map` menjadi `{}`), sehingga entri disimpan sebagai array `[K, V][]`.
 */
export async function withCachedMap<K extends string, V>(
  fn: () => Promise<Map<K, V>>,
  keyParts: readonly string[],
  options: { tags: readonly string[]; revalidate: number },
): Promise<Map<K, V>> {
  const entries = await withCache(
    async () => Array.from((await fn()).entries()),
    keyParts,
    options,
  );
  return new Map<K, V>(entries);
}

/**
 * Mematikan tag cache secara instan dengan tanda tangan resmi Next.js 16.4.6 (`{ expire: 0 }`).
 */
export function invalidateTags(tags: readonly string[]): void {
  const unique = new Set(tags);
  for (const tag of unique) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (error) {
      if (isOutsideNextCacheScopeError(error)) {
        // ZERO-FALLBACK: route handler mutasi yang diuji langsung di luar runtime Next.js tidak memiliki static generation store.
        continue;
      }
      throw error;
    }
  }
}

/**
 * Pembaca data operasional multi-tenant yang aman untuk Next.js 16.4.6:
 * - Pemanggil WAJIB memverifikasi sesi & `propertyId` di luar fungsi ini (via `currentUser()`).
 * - Ketika `SUPABASE_SECRET_KEY` tersedia (dev & produksi Vercel), kueri dijalankan di dalam `unstable_cache`
 *   memakai `createAdminClient()` (tanpa `cookies()`) dengan `propertyId` di `keyParts` dan filter eksplisit di SQL/PostgREST.
 * - Jika `SUPABASE_SECRET_KEY` belum diisi pada lingkungan lokal sementara, kueri berjalan DI LUAR `unstable_cache`
 *   memakai `createClient()` berbasis sesi agar tidak ada error `cookies()` maupun data kosong tiruan.
 */
export async function withPropertySupabaseCache<T>(opts: {
  propertyId: string;
  keyParts: readonly string[];
  tags: readonly string[];
  revalidate: number;
  query: (supabase: AdminSupabaseClient) => Promise<T>;
}): Promise<T> {
  const propertyId = opts.propertyId.trim();
  if (!propertyId) {
    throw new Error("propertyId wajib diisi untuk kueri operasional ter-cache.");
  }
  if (hasAdminSupabaseKey()) {
    return withCache(
      () => opts.query(createAdminClient()),
      [...opts.keyParts, propertyId],
      { tags: opts.tags, revalidate: opts.revalidate },
    );
  }
  if (!warnedMissingAdminKey) {
    warnedMissingAdminKey = true;
    console.warn("[cache] SUPABASE_SECRET_KEY belum terisi; pembacaan operasional berjalan langsung lewat sesi tanpa Data Cache.");
  }
  const sessionClient = (await createClient()) as unknown as AdminSupabaseClient;
  return opts.query(sessionClient);
}
