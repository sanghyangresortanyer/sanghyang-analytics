import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { buildKnowledgeGraph } from "../../src/lib/knowledge-graph/build";
import { mergeRefreshedGraph } from "../../src/lib/knowledge-graph/merge-refresh";
import { lastRefreshAt } from "../../src/lib/market/refresh-heartbeat";
import { HEARTBEAT_FINGERPRINT } from "../../src/lib/market/refresh-outcome";
import { createKnowledgeGraphGet, GET as GET_UNAUTH } from "../../src/app/api/knowledge-graph/route";

after(() => db.$disconnect());

const DAY_MS = 86_400_000;

test("waktu data Knowledge Graph = heartbeat pembaruan penuh terakhir di DB", async () => {
  const row = await db.marketInsight.findFirst({ where: { fingerprint: HEARTBEAT_FINGERPRINT }, select: { evidence: true, generatedAt: true } });
  const syncedAt = (row?.evidence as { syncedAt?: unknown } | null)?.syncedAt;
  const expected = row ? (typeof syncedAt === "string" ? syncedAt : row.generatedAt.toISOString()) : null;
  assert.equal(await lastRefreshAt(), expected);
});

test("API Knowledge Graph menolak akses tanpa login (401) dan mengirim graf dari DB beserta waktu datanya, tanpa cache", async () => {
  const unauth = await GET_UNAUTH(new Request("http://127.0.0.1:3001/api/knowledge-graph"));
  assert.equal(unauth.status, 401);

  const GET = createKnowledgeGraphGet(async () => null);
  const res = await GET(new Request("http://127.0.0.1:3001/api/knowledge-graph"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as { dataUpdatedAt: string | null; generatedAt: string; nodes: unknown[] };
  assert.equal(body.dataUpdatedAt, await lastRefreshAt());
  assert.ok(body.nodes.length > 0);
  assert.ok(Date.parse(body.generatedAt) > Date.now() - 60_000, "graf dirakit saat diminta");
});

test("muat ulang tanpa perubahan data memakai larik simpul lama supaya kamera 3D tidak melompat", async () => {
  const first = await buildKnowledgeGraph();
  const second = await buildKnowledgeGraph();
  const merged = mergeRefreshedGraph(first, second);
  assert.equal(merged.nodes, first.nodes);
  assert.equal(merged.links, first.links);
  assert.equal(merged.generatedAt, second.generatedAt, "waktu muat tetap diperbarui");
});

test("muat ulang dengan data berbeda memakai graf baru", async (t) => {
  const current = await buildKnowledgeGraph();
  // Jendela berita 30 hari dan promo 60 hari: graf per 40 hari lalu memuat data yang berbeda dari DB yang sama.
  const earlier = await buildKnowledgeGraph(new Date(Date.now() - 40 * DAY_MS));
  if (JSON.stringify(earlier.nodes) === JSON.stringify(current.nodes)) return t.skip("DB lokal tidak punya data dalam jendela waktu berbeda");
  const merged = mergeRefreshedGraph(earlier, current);
  assert.equal(merged.nodes, current.nodes);
  assert.equal(merged.links, current.links);
  assert.equal(mergeRefreshedGraph(null, current), current);
});
