import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db, ProductionWriteBlockedError } from "../../src/lib/db";
import { createAdminScrapingHandlers } from "../../src/app/api/admin/scraping/route";
import { createGithubActions } from "../../src/lib/market/github-actions";
import { isRefreshRunning } from "../../src/lib/market/refresh-progress";

after(() => db.$disconnect());

const GUARD_KEYS = ["PRODUCTION_DATABASE_MARKER", "ALLOW_PRODUCTION_WRITE", "CI", "VERCEL"] as const;

/**
 * Pengaman tulis lib/db.ts yang sebenarnya, diarahkan ke DB lokal: penanda produksi cocok dengan host 127.0.0.1 dan
 * izin tulis tidak diberikan, sama seperti komputer kerja yang memakai URL produksi tanpa ALLOW_PRODUCTION_WRITE=1.
 */
async function withWritesRefused(run: () => Promise<void>) {
  const saved = Object.fromEntries(GUARD_KEYS.map((key) => [key, process.env[key]]));
  process.env.PRODUCTION_DATABASE_MARKER = "127.0.0.1";
  for (const key of GUARD_KEYS.slice(1)) delete process.env[key];
  try {
    await run();
  } finally {
    for (const key of GUARD_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const unconfiguredGithub = () => createGithubActions({ env: {} });

test("panel GET tidak menulis ke DB: tetap 200 saat basis data menolak tulis", async () => {
  await withWritesRefused(async () => {
    await assert.rejects(
      db.source.upsert({
        where: { domain_method: { domain: "news.google.com", method: "rss" } },
        update: {},
        create: { name: "Google News", domain: "news.google.com", category: "news", method: "rss", enabled: true },
      }),
      ProductionWriteBlockedError,
      "prasyarat: lingkungan uji benar-benar menolak tulis",
    );
    const { GET } = createAdminScrapingHandlers({ githubActions: unconfiguredGithub(), checkAccess: async () => null });
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as { manualRunAvailable: boolean; sources: unknown[]; hotelRates: unknown[] };
    assert.equal(body.manualRunAvailable, true);
    assert.ok(Array.isArray(body.sources) && Array.isArray(body.hotelRates));
  });
});

test("Perbarui Semua Data di basis data yang menolak tulis berhenti di awal dengan alasan yang jelas", async () => {
  await withWritesRefused(async () => {
    const { POST } = createAdminScrapingHandlers({
      githubActions: unconfiguredGithub(),
      checkAccess: async () => null,
      runFullRefresh: () => {
        throw new Error("pembaruan penuh tidak boleh dimulai saat basis data menolak tulis");
      },
    });
    const res = await POST(new Request("http://127.0.0.1:3001/api/admin/scraping", { method: "POST", body: JSON.stringify({ job: "local-all" }) }));
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /menolak penulisan/);
    assert.equal(isRefreshRunning(), false, "tidak ada progres palsu yang tertinggal");
  });
});
