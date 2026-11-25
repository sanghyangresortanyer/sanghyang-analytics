import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { ga4ReportSection, summarizeGa4 } from "./ga4.ts";

const row = (event: string, source: string, count: number, value = 0) => ({ dimensionValues: [{ value: event }, { value: source }], metricValues: [{ value: String(count) }, { value: String(value) }] });

test("summarizeGa4 splits Google Ads (google / cpc) from other sources and sums booking value", () => {
  const s = summarizeGa4([
    row("whatsapp_click", "google / cpc", 3),
    row("whatsapp_click", "google / organic", 2),
    row("purchase", "google / cpc", 1, 600000),
    row("purchase", "(direct) / (none)", 1, 365000),
    row("page_view", "google / cpc", 99),
  ]);
  assert.deepEqual(s.whatsapp, { all: 5, ads: 3 });
  assert.deepEqual(s.purchase, { all: 2, ads: 1 });
  assert.deepEqual(s.value, { all: 965000, ads: 600000 });
  assert.deepEqual(s.phone, { all: 0, ads: 0 });
});

test("ga4ReportSection returns nothing when not configured and an error line when GA4 fails", async () => {
  assert.deepEqual(await ga4ReportSection({}), []);
  const dir = mkdtempSync(join(tmpdir(), "ga4-"));
  const file = join(dir, "creds.json");
  writeFileSync(file, JSON.stringify({ type: "authorized_user", client_id: "c", client_secret: "s", refresh_token: "r" }));
  const env = { GA4_CREDENTIALS_FILE: file, GA4_PROPERTY_ID: "123" };
  const ok: typeof fetch = async (url) =>
    String(url).includes("oauth2")
      ? new Response(JSON.stringify({ access_token: "t" }))
      : new Response(JSON.stringify({ rows: [row("whatsapp_click", "google / cpc", 4)] }));
  const lines = await ga4ReportSection(env, new Date("2026-11-16T04:00:00Z"), "Asia/Jakarta", ok);
  assert.match(lines.join("\n"), /Kemarin 2026-11-15:\n• Klik WhatsApp: 4 \(iklan Google 4\)/);
  assert.match(lines.join("\n"), /Bulan ini 2026-11-01 s\/d 2026-11-15/);
  const down: typeof fetch = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  const failed = await ga4ReportSection(env, new Date("2026-11-16T04:00:00Z"), "Asia/Jakarta", down);
  assert.match(failed.join("\n"), /gagal dibaca: GA4 token refresh failed: 400 invalid_grant/);
});
