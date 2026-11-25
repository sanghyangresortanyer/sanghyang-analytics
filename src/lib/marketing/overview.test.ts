import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { cachedSection, type Fetched, loadSocial, type PageSources, renderSanghyangPage, renderSosmedPage, type SanghyangData, type SocialData, sosmedImagePath } from "./overview.ts";
import { serveDashboard } from "./server.ts";

const at = new Date("2026-11-17T04:00:00Z");
const socialData: SocialData = { instagram: [{ brand: "Sanghyang", handle: "sanghyangresort" }], tiktok: [], facebookPages: [], websites: [], promo: null };
const pages = (): PageSources => ({
  sanghyang: async (): Promise<Fetched<SanghyangData>> => ({ section: { ok: false, error: "GOOGLE_ADS_TOKEN_FAILED: 400 invalid_grant" }, at }),
  sosmed: async (): Promise<Fetched<SocialData>> => ({ section: { ok: true, data: socialData }, at }),
});

test("loadSocial reads handles from JSON, never shows login e-mails, and finds the newest promo folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "sosmed-"));
  const accounts = join(dir, "accounts.json");
  writeFileSync(
    accounts,
    JSON.stringify([
      { platform: "GENERAL", handle: "USERNAME / LOGIN" },
      { platform: "Sanghyang Indah Spa Resort", handle: "hotel.sanghyang@gmail.com" },
      { platform: "Sanghyang Indah Spa Resort", handle: "sanghyangresort" },
      { platform: "Sunset Grill", handle: "Fan Pages (Sub-Account FB Sanghyang)" },
      { platform: "TIKTOK", handle: "sunsetgrill.sanghyang" },
      { platform: "WEBSITE", handle: "https://sanghyang.com" },
    ]),
  );
  const root = join(dir, "sosmed");
  mkdirSync(join(root, "2026-11-01-old"), { recursive: true });
  mkdirSync(join(root, "2026-11-13-promo"));
  writeFileSync(join(root, "2026-11-13-promo", "README.md"), "# Promosi Instagram\n\nSumber: tangkapan layar tim.\n");
  writeFileSync(join(root, "2026-11-13-promo", "01-a.png"), "x");
  const s = loadSocial(accounts, root);
  assert.deepEqual(s.instagram, [{ brand: "Sanghyang Indah Spa Resort", handle: "sanghyangresort" }]);
  assert.deepEqual([s.tiktok, s.facebookPages, s.websites], [["sunsetgrill.sanghyang"], ["Sunset Grill"], ["https://sanghyang.com"]]);
  assert.deepEqual(s.promo, { folder: "2026-11-13-promo", title: "Promosi Instagram", source: "tangkapan layar tim.", images: ["01-a.png"] });
  assert.ok(!JSON.stringify(s).includes("gmail"), "no e-mail leaks into the page data");
  assert.deepEqual(loadSocial(join(dir, "missing.json"), root).instagram, [], "missing file: empty list, no crash");
  assert.equal(sosmedImagePath(root, "2026-11-13-promo/01-a.png"), join(root, "2026-11-13-promo", "01-a.png"));
  assert.equal(sosmedImagePath(root, "../secret.png"), null);
  assert.equal(sosmedImagePath(root, "2026-11-13-promo/README.md"), null);
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
  assert.match(renderSosmedPage(await p.sosmed()), /@sanghyangresort/);
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

test("server serves the two pages, the report, and only promo images under the sosmed folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "sosmed-"));
  mkdirSync(join(root, "p"));
  writeFileSync(join(root, "p", "a.png"), "png");
  const server = serveDashboard(0, {
    pages: pages(),
    report: async (range) => {
      if (range.since === "2099-01-05") throw new Error("pekan belum selesai");
      return `<h1>laporan ${range.since ?? "default"}${range.until ? `..${range.until}` : ""}</h1>`;
    },
    reminders: () => [],
    sosmedRoot: root,
  });
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    for (const path of ["/sanghyang", "/sosmed"]) assert.equal((await fetch(`${url}${path}`)).status, 200, path);
    assert.equal((await fetch(`${url}/`, { redirect: "manual" })).headers.get("location"), "/sanghyang");
    assert.equal(await (await fetch(`${url}/laporan?since=2026-11-13&until=2026-11-16`)).text(), "<h1>laporan 2026-11-13..2026-11-16</h1>");
    assert.equal(await (await fetch(`${url}/laporan`)).text(), "<h1>laporan default</h1>");
    assert.equal((await fetch(`${url}/laporan?since=2099-01-05`)).status, 400);
    assert.equal((await fetch(`${url}/amp`)).status, 404, "AMP pages live in the AMP-META-ADS project");
    assert.equal((await fetch(`${url}/sosmed/p/a.png`)).headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${url}/sosmed/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${url}/sosmed/%E0%A4%A`)).status, 404, "malformed escape is a 404, not a crash");
    assert.equal((await fetch(`${url}/sanghyang`)).status, 200, "server still alive after the malformed request");
  } finally {
    server.close();
  }
});
