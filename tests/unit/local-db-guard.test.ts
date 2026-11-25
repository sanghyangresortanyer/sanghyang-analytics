import test from "node:test";
import assert from "node:assert/strict";
import { assertLocalWorkDatabase } from "../../scripts/ops/local-db-guard";

// Skrip pengumpul data venue menulis ke DB; pemilik hanya mengizinkan DB kerja lokal (kontainer sanghyang-news-db).
test("penjaga DB kerja lokal: hanya 127.0.0.1:55432 yang boleh ditulis", () => {
  assert.doesNotThrow(() => assertLocalWorkDatabase({ DATABASE_URL: "postgresql://u:rahasia@127.0.0.1:55432/sanghyang_news?schema=public" }));
  assert.throws(() => assertLocalWorkDatabase({ DATABASE_URL: "postgresql://u:rahasia@db.example.supabase.co:5432/postgres" }), /127\.0\.0\.1:55432/);
  assert.throws(() => assertLocalWorkDatabase({ DATABASE_URL: "postgresql://u:rahasia@127.0.0.1:54322/postgres" }), /127\.0\.0\.1:54322/);
  assert.throws(() => assertLocalWorkDatabase({}), /DATABASE_URL/);
});

test("penjaga DB kerja lokal: pesan galat tidak membocorkan sandi", () => {
  try {
    assertLocalWorkDatabase({ DATABASE_URL: "postgresql://u:sandi-rahasia@pooler.supabase.com:6543/postgres" });
    assert.fail("harus ditolak");
  } catch (error) {
    assert.doesNotMatch((error as Error).message, /sandi-rahasia/);
  }
});
