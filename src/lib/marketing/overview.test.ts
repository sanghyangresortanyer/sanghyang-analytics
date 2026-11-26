import assert from "node:assert/strict";
import { test } from "vitest";
import { cachedSection, type Fetched, type PageSources, renderSanghyangPage, type SanghyangData } from "./overview.ts";

const at = new Date("2026-11-17T04:00:00Z");
const pages = (): PageSources => ({
  sanghyang: async (): Promise<Fetched<SanghyangData>> => ({ section: { ok: false, error: "GOOGLE_ADS_TOKEN_FAILED: 400 invalid_grant" }, at }),
});

test("Sanghyang page shows reminders and the daily watch above the numbers; a failed source keeps its own card", async () => {
  const p = pages();
  const failedPage = renderSanghyangPage(await p.sanghyang(), ["PENGINGAT HARI INI", "🔔 kerjakan C dan D"]);
  assert.equal((failedPage.match(/<h1/g) ?? []).length, 1);
  assert.match(failedPage, /Pengingat hari ini<\/h3><ul class="plain"><li>🔔 kerjakan C dan D<\/li>/);
  assert.match(failedPage, /Data Google Ads \/ GA4 tidak terbaca<\/h3><p>GOOGLE_ADS_TOKEN_FAILED/);
  // Inside Sanghyang Analytics the Marketing tabs link the pages: the Google page has no link to Sosmed or the weekly report.
  assert.ok(!failedPage.includes('href="/laporan"') && !failedPage.includes('href="/sosmed"') && !failedPage.includes("/amp"));
  const ok = renderSanghyangPage({
    section: {
      ok: true,
      data: {
        complete: false,
        watch: ["SANGHYANG — GOOGLE ADS (kemarin 2026-11-16)", "• Kontak dari iklan: 4 ▲", "⚠️ 2 hari berturut-turut tanpa kontak"],
        current: { period: { since: "2026-11-01", until: "2026-11-16" }, campaigns: [], conversions: [], ga4: zeroGa4() },
        previous: { period: { since: "2026-10-01", until: "2026-10-16" }, campaigns: [], conversions: [], ga4: zeroGa4() },
      },
    },
    at,
  });
  assert.match(ok, /<h3>SANGHYANG — GOOGLE ADS \(kemarin 2026-11-16\)<\/h3>/);
  assert.match(ok, /<li class="alert">⚠️ 2 hari berturut-turut tanpa kontak<\/li>/);
  assert.ok(!ok.includes("Pengingat hari ini"), "no reminder card on days without reminders");
});

function zeroGa4() {
  const z = { all: 0, ads: 0 };
  return { whatsapp: z, phone: z, checkout: z, purchase: z, value: z };
}

test("cachedSection reuses data inside the TTL, refreshes on demand and never caches a failure", async () => {
  let calls = 0;
  let now = 0;
  const get = cachedSection(async () => ++calls, 1000, () => now);
  assert.deepEqual((await get()).section, { ok: true, data: 1 });
  await get();
  assert.equal(calls, 1);
  now = 2000;
  await get();
  await get(true);
  assert.equal(calls, 3);
  let fail = true;
  const flaky = cachedSection(
    async () => {
      if (fail) throw new Error("down");
      return "up";
    },
    60_000,
    () => 0,
  );
  assert.deepEqual((await flaky()).section, { ok: false, error: "down" });
  fail = false;
  assert.deepEqual((await flaky()).section, { ok: true, data: "up" }, "a failed load is retried on the next request");
});
