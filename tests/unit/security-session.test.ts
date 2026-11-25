/**
 * tests/unit/security-session.test.ts
 *
 * Verifikasi keamanan autentikasi & otorisasi Sanghyang Analytics:
 * 1. Perbandingan rahasia waktu konstan `timingSafeEqual` untuk `CRON_SECRET`.
 * 2. Validasi header `Authorization: Bearer <CRON_SECRET>` (`isAuthorizedCronRequest`).
 * 3. Penjaga akses API Marketing tunggal (`requireMarketingApiAccess` -> 401/403 JSON, 0 APP_PASSWORD/SESSION_SECRET).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCronRequest, timingSafeSecretMatch } from "../../src/lib/auth/cron-secret";
import { requireMarketingApiAccess } from "../../src/lib/marketing/api-auth";

describe("Keamanan Cron Secret (timingSafeEqual)", () => {
  test("timingSafeSecretMatch membandingkan rahasia secara waktu konstan dan akurat", () => {
    assert.equal(timingSafeSecretMatch("sanghyang-cron-2026", "sanghyang-cron-2026"), true);
    assert.equal(timingSafeSecretMatch("salah-ketik", "sanghyang-cron-2026"), false);
    assert.equal(timingSafeSecretMatch("", "sanghyang-cron-2026"), false);
    assert.equal(timingSafeSecretMatch(null, "sanghyang-cron-2026"), false);
    assert.equal(timingSafeSecretMatch(12345, "sanghyang-cron-2026"), false);
    assert.equal(timingSafeSecretMatch("sanghyang-cron-2026", ""), false);
  });

  test("isAuthorizedCronRequest memvalidasi Bearer CRON_SECRET dan gagal tertutup saat kosong", () => {
    const okReq = new Request("http://localhost:3001/api/cron/scrape", {
      headers: { authorization: "Bearer rahasia-cron-valid" },
    });
    assert.equal(isAuthorizedCronRequest(okReq, "rahasia-cron-valid"), true);
    assert.equal(isAuthorizedCronRequest(okReq, "rahasia-berbeda"), false);
    assert.equal(isAuthorizedCronRequest(okReq, ""), false);

    const noPrefix = new Request("http://localhost:3001/api/cron/scrape", {
      headers: { authorization: "rahasia-cron-valid" },
    });
    assert.equal(isAuthorizedCronRequest(noPrefix, "rahasia-cron-valid"), false);

    const missingHeader = new Request("http://localhost:3001/api/cron/scrape");
    assert.equal(isAuthorizedCronRequest(missingHeader, "rahasia-cron-valid"), false);
  });
});

describe("Keamanan Penjaga Akses API Tunggal (Supabase Auth + MARKETING_PROPERTY_ID)", () => {
  test("requireMarketingApiAccess mengembalikan 401 JSON saat sesi tidak valid atau di luar request scope", async () => {
    const res401 = await requireMarketingApiAccess(async () => new Response("Silakan login.", { status: 401 }));
    assert.ok(res401);
    assert.equal(res401.status, 401);
    assert.deepEqual(await res401.json(), {
      ok: false,
      error: "Sesi login telah berakhir. Silakan login ulang.",
    });

    const resOutsideScope = await requireMarketingApiAccess(async () => {
      throw new Error("`cookies` was called outside a request scope.");
    });
    assert.ok(resOutsideScope);
    assert.equal(resOutsideScope.status, 401);
  });

  test("requireMarketingApiAccess mengembalikan 403 JSON saat properti tidak cocok dan null saat diizinkan", async () => {
    const res403 = await requireMarketingApiAccess(
      async () => new Response("Tidak ada akses ke Marketing properti ini.", { status: 403 }),
    );
    assert.ok(res403);
    assert.equal(res403.status, 403);
    assert.deepEqual(await res403.json(), {
      ok: false,
      error: "Tidak ada akses ke Marketing properti ini.",
    });

    const allowed = await requireMarketingApiAccess(async () => null);
    assert.equal(allowed, null);
  });
});
