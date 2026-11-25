import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { getJobStatusSummary } from "../../src/lib/market/scrape-log";
import { isSkippedRun } from "../../src/lib/market/refresh-outcome";

after(() => db.$disconnect());

test("rincian pembaruan: run yang hanya berisi catatan dilewati tampil sebagai dilewati, bukan sebagian", async (t) => {
  // DB lokal (snapshot 13-14 Nov 2026): run sosmed terakhir partial dengan satu catatan "Dilewati: Instagram Graph API ...".
  const run = await db.scrapeRun.findFirst({ where: { job: "social" }, orderBy: { createdAt: "desc" } });
  if (!run) return t.skip("DB lokal belum punya run sosmed");
  const messages = (await db.scrapeError.findMany({ where: { runId: run.id }, select: { message: true } })).map((e) => e.message);
  if (!(run.status === "partial" && isSkippedRun(messages))) return t.skip(`run sosmed terakhir berstatus ${run.status}, bukan run dilewati`);

  const summary = await getJobStatusSummary("social");
  assert.equal(summary.status, "skipped");
  assert.equal(summary.lastRun?.status, "partial", "status run asli tetap terbaca");
});

test("rincian pembaruan: run dengan galat sungguhan tidak disamarkan sebagai dilewati", async () => {
  for (const job of ["news", "rates", "reviews", "website", "ratings"] as const) {
    const run = await db.scrapeRun.findFirst({ where: { job }, orderBy: { createdAt: "desc" } });
    const summary = await getJobStatusSummary(job);
    if (!run) {
      assert.equal(summary.status, "never_run");
      continue;
    }
    const messages = (await db.scrapeError.findMany({ where: { runId: run.id }, select: { message: true } })).map((e) => e.message);
    const expected = run.status === "partial" && isSkippedRun(messages) ? "skipped" : run.status;
    assert.equal(summary.status, expected, `${job}: ${run.status} dengan ${messages.length} catatan`);
  }
});
