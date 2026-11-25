import test from "node:test";
import assert from "node:assert/strict";
import {
  isProductionDatabase,
  isWriteAllowed,
  getDatabaseTarget,
  ProductionWriteBlockedError,
  createDatabaseClient,
} from "../../src/lib/db";

test("Pengaman Produksi - isProductionDatabase", () => {
  const marker = "pooler.supabase.com";

  // Production URLs
  assert.equal(
    isProductionDatabase("postgresql://postgres:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", marker),
    true,
    "Harus mendeteksi host supabase pooler sebagai produksi"
  );
  assert.equal(
    isProductionDatabase("postgresql://user:pass@POOLER.SUPABASE.COM:5432/db", marker),
    true,
    "Harus case-insensitive terhadap marker"
  );

  // Local URLs
  assert.equal(
    isProductionDatabase("postgresql://sanghyang_local:pass@127.0.0.1:55432/sanghyang_news", marker),
    false,
    "Harus mengembalikan false untuk database lokal 127.0.0.1"
  );
  assert.equal(
    isProductionDatabase("postgresql://postgres:pass@localhost:5432/postgres", marker),
    false,
    "Harus mengembalikan false untuk localhost"
  );

  // Empty or missing marker
  assert.equal(
    isProductionDatabase("postgresql://postgres:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", undefined),
    false,
    "Harus mengembalikan false bila marker tidak diset"
  );
  assert.equal(
    isProductionDatabase("postgresql://postgres:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres", ""),
    false,
    "Harus mengembalikan false bila marker kosong"
  );
});

test("Pengaman Produksi - isWriteAllowed", () => {
  const marker = "pooler.supabase.com";
  const prodUrl = "postgresql://postgres:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
  const localUrl = "postgresql://sanghyang_local:secret@127.0.0.1:55432/sanghyang_news";

  // Production without opt-in -> blocked
  assert.equal(
    isWriteAllowed({
      DATABASE_URL: prodUrl,
      PRODUCTION_DATABASE_MARKER: marker,
      ALLOW_PRODUCTION_WRITE: "0",
    }),
    false,
    "Harus menolak tulis jika menargetkan produksi tanpa ALLOW_PRODUCTION_WRITE=1"
  );
  assert.equal(
    isWriteAllowed({
      DATABASE_URL: prodUrl,
      PRODUCTION_DATABASE_MARKER: marker,
    }),
    false,
    "Harus menolak tulis jika ALLOW_PRODUCTION_WRITE tidak didefinisikan"
  );

  // Production with explicit opt-in -> allowed
  assert.equal(
    isWriteAllowed({
      DATABASE_URL: prodUrl,
      PRODUCTION_DATABASE_MARKER: marker,
      ALLOW_PRODUCTION_WRITE: "1",
    }),
    true,
    "Harus mengizinkan tulis jika ALLOW_PRODUCTION_WRITE=1"
  );

  // Local database -> always allowed
  assert.equal(
    isWriteAllowed({
      DATABASE_URL: localUrl,
      PRODUCTION_DATABASE_MARKER: marker,
      ALLOW_PRODUCTION_WRITE: "0",
    }),
    true,
    "Harus mengizinkan tulis ke database lokal meskipun ALLOW_PRODUCTION_WRITE=0"
  );
});

test("Pengaman Produksi - getDatabaseTarget", () => {
  const marker = "pooler.supabase.com";

  assert.equal(
    getDatabaseTarget({
      DATABASE_URL: "postgresql://postgres:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
      PRODUCTION_DATABASE_MARKER: marker,
    }),
    "produksi"
  );

  assert.equal(
    getDatabaseTarget({
      DATABASE_URL: "postgresql://sanghyang_local:secret@127.0.0.1:55432/sanghyang_news",
      PRODUCTION_DATABASE_MARKER: marker,
    }),
    "lokal"
  );
});

test("Pengaman Produksi - Prisma Client Extension mencegat operasi tulis produksi", async () => {
  const prodEnv = {
    DATABASE_URL: "postgresql://postgres:dummy@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
    PRODUCTION_DATABASE_MARKER: "pooler.supabase.com",
    ALLOW_PRODUCTION_WRITE: "0",
  };

  const client = createDatabaseClient(prodEnv);

  // Test create
  await assert.rejects(
    async () => {
      // @ts-expect-error test mock invocation without full payload
      await client.article.create({ data: { title: "Test" } });
    },
    (err: unknown) => {
      assert(err instanceof ProductionWriteBlockedError);
      assert.equal(err.code, "PRODUCTION_WRITE_BLOCKED");
      assert.equal(err.operation, "create");
      assert.equal(err.model, "Article");
      return true;
    },
    "client.article.create harus melempar ProductionWriteBlockedError"
  );

  // Test update
  await assert.rejects(
    async () => {
      await client.competitor.update({ where: { id: "1" }, data: { name: "Test" } });
    },
    (err: unknown) => {
      assert(err instanceof ProductionWriteBlockedError);
      assert.equal(err.operation, "update");
      assert.equal(err.model, "Competitor");
      return true;
    },
    "client.competitor.update harus melempar ProductionWriteBlockedError"
  );

  // Test delete
  await assert.rejects(
    async () => {
      await client.marketItem.delete({ where: { id: "1" } });
    },
    (err: unknown) => {
      assert(err instanceof ProductionWriteBlockedError);
      assert.equal(err.operation, "delete");
      assert.equal(err.model, "MarketItem");
      return true;
    },
    "client.marketItem.delete harus melempar ProductionWriteBlockedError"
  );

  // Test upsert
  await assert.rejects(
    async () => {
      // @ts-expect-error test mock invocation without full payload
      await client.source.upsert({ where: { id: "1" }, create: {}, update: {} });
    },
    (err: unknown) => {
      assert(err instanceof ProductionWriteBlockedError);
      assert.equal(err.operation, "upsert");
      return true;
    },
    "client.source.upsert harus melempar ProductionWriteBlockedError"
  );

  // Test $executeRaw
  await assert.rejects(
    async () => {
      await client.$executeRaw`DELETE FROM "Article"`;
    },
    (err: unknown) => {
      assert(err instanceof ProductionWriteBlockedError);
      assert.equal(err.operation, "$executeRaw");
      return true;
    },
    "client.$executeRaw harus melempar ProductionWriteBlockedError"
  );

  // Test $executeRawUnsafe
  await assert.rejects(
    async () => {
      await client.$executeRawUnsafe('DELETE FROM "Article"');
    },
    (err: unknown) => {
      assert(err instanceof ProductionWriteBlockedError);
      assert.equal(err.operation, "$executeRawUnsafe");
      return true;
    },
    "client.$executeRawUnsafe harus melempar ProductionWriteBlockedError"
  );
});

// Skenario paling berbahaya: skrip dijalankan dengan `--env-file=.env.local`, yang menunjuk host produksi tetapi tidak
// memuat PRODUCTION_DATABASE_MARKER (penanda hanya ada di .env.development.local). Pengaman tidak boleh bergantung pada
// penanda: dari mesin kerja, tulis ke host non-lokal ditolak kecuali diizinkan eksplisit atau berjalan di Vercel/CI.
test("Pengaman Produksi - host non-lokal tanpa penanda tetap ditolak", () => {
  const remoteUrl = "postgresql://postgres.ref:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
  assert.equal(isWriteAllowed({ DATABASE_URL: remoteUrl }), false, "Host non-lokal tanpa izin harus ditolak");
  assert.equal(isWriteAllowed({ DATABASE_URL: remoteUrl, ALLOW_PRODUCTION_WRITE: "0" }), false);
  assert.equal(isWriteAllowed({ DATABASE_URL: remoteUrl, ALLOW_PRODUCTION_WRITE: "1" }), true, "Izin eksplisit diterima");
  assert.equal(isWriteAllowed({ DATABASE_URL: remoteUrl, VERCEL: "1" }), true, "Runtime Vercel menulis ke basis datanya sendiri");
  assert.equal(isWriteAllowed({ DATABASE_URL: remoteUrl, CI: "true" }), true, "Job CI (GitHub Actions) menulis sesuai jadwal");
  assert.equal(getDatabaseTarget({ DATABASE_URL: remoteUrl }), "produksi", "Host non-lokal dilaporkan sebagai produksi");
});

test("Pengaman Produksi - host loopback selalu boleh ditulis", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const url = `postgresql://user:secret@${host}:55432/sanghyang_news`;
    assert.equal(isWriteAllowed({ DATABASE_URL: url }), true, `${host} adalah basis data lokal`);
    assert.equal(getDatabaseTarget({ DATABASE_URL: url }), "lokal");
  }
});
