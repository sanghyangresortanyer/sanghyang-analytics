import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { competitorMenu, competitorMenuNames } from "../../src/lib/market/competitor-menu";
import type { FnbCompareData } from "../../src/lib/market/fnb-compare";
import { createFnbCompareGet, GET } from "../../src/app/api/market-intelligence/fnb-compare/route";

after(() => db.$disconnect());

const url = (query: string) => `http://127.0.0.1:3001/api/market-intelligence/fnb-compare${query}`;
const authedGet = createFnbCompareGet(async () => null);

test("route pembanding menu menolak pengguna yang belum masuk dan outlet yang bukan F&B, bar, atau spa", async () => {
  assert.equal((await GET(new Request(url("?outlet=sunset-grill")))).status, 401);
  for (const query of ["?outlet=resort", "?outlet=all", ""]) {
    const res = await authedGet(new Request(url(query)));
    assert.equal(res.status, 422, query);
    assert.match(((await res.json()) as { error: string }).error, /Outlet tidak dikenal/);
  }
});

test("route pembanding menu: pesaing sama dengan registri outlet, tanpa URL foto menu dan nama mesin pembaca", async () => {
  const res = await authedGet(new Request(url("?outlet=sunset-grill")));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const text = await res.text();
  const body = JSON.parse(text) as FnbCompareData;

  const registry = (
    await db.competitor.findMany({
      where: { active: true, compsetRole: { not: null }, outlets: { has: "sunset-grill" } },
      select: { name: true, placeId: true, parent: { select: { name: true } } },
    })
  ).filter((r) => r.placeId !== "sanghyang");
  assert.ok(registry.length > 0, "registri lokal punya pembanding Sunset Grill");
  assert.deepEqual(Object.keys(body.rivals).sort(), registry.map((r) => r.name).sort());
  for (const r of registry) assert.equal(body.rivals[r.name].parentName, r.parent?.name ?? null, r.name);

  const menuPhotos = competitorMenuNames().flatMap((name) => competitorMenu(name)!.sources.flatMap((s) => s.photos ?? []));
  assert.ok(menuPhotos.length > 0);
  assert.ok(menuPhotos.every((photo) => !text.includes(photo)), "URL foto menu tidak dikirim ke browser");
  assert.ok(!/gemini/i.test(text), "nama mesin pembaca menu tidak dikirim ke browser");
  const photos = [...Object.values(body.rivals).flatMap((r) => r.photos), ...body.sanghyangPhotos];
  assert.ok(photos.every((p) => p.relevant === true && !p.expired), "hanya foto yang lolos penilaian isi yang tampil");
});
