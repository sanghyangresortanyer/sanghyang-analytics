import assert from "node:assert/strict";
import { test } from "vitest";
import { formatGoogleAdsReport, GoogleAdsClient, setCampaignBudget, setCampaignStatus, setConversionPrimary, setConversionValue, setKeywordStatus, toAdsBalance, toCampaignRows } from "./google-ads.ts";

const settings = { clientId: "c", clientSecret: "s", refreshToken: "r", customerId: "7931288995", loginCustomerId: "9392325223" };
const campaignRow = (shared = false) => ({
  campaign: { id: "1", name: "MONTHLY PROMO", status: "ENABLED", advertisingChannelType: "SEARCH" },
  campaignBudget: { resourceName: "customers/7931288995/campaignBudgets/9", amountMicros: "92000000000", explicitlyShared: shared },
  metrics: { costMicros: "50000000000", impressions: "1000", clicks: "40", conversions: 2, allConversions: 3 },
});

function fakeFetch(shared = false) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const impl: typeof fetch = async (url, init) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t" }));
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify(String(url).endsWith(":mutate") ? { results: [{}] } : { results: [campaignRow(shared)] }));
  };
  return { impl, calls };
}

test("toCampaignRows converts micros to rupiah and formatGoogleAdsReport lists conversions per action", () => {
  const [row] = toCampaignRows([campaignRow()]);
  assert.equal(row?.budgetPerDay, 92000);
  assert.equal(row?.cost, 50000);
  const text = formatGoogleAdsReport("2026-11-09", "2026-11-15", [row!], [{ campaign: "MONTHLY PROMO", action: "whatsapp_click", conversions: 0, allConversions: 3 }]);
  assert.match(text, /MONTHLY PROMO \[ENABLED\] budget Rp92\.000\/hari — biaya Rp50\.000, 1000 tayang, 40 klik · CPC Rp1\.250/);
  assert.match(text, /- whatsapp_click: 3\.0 \(dihitung utama 0\.0\)/);
});

test("budget and status writes are validateOnly unless apply is set, and send login-customer-id", async () => {
  const { impl, calls } = fakeFetch();
  const ads = new GoogleAdsClient(settings, impl);
  const preview = await setCampaignBudget(ads, "1", 100000);
  assert.deepEqual(preview, { campaign: "MONTHLY PROMO", before: 92000, after: 100000, applied: false });
  const mutate = calls.find((c) => c.url.endsWith("campaignBudgets:mutate"));
  assert.equal(mutate?.body.validateOnly, true);
  assert.equal(mutate?.headers["login-customer-id"], "9392325223");
  assert.deepEqual(mutate?.body.operations, [{ update: { resourceName: "customers/7931288995/campaignBudgets/9", amountMicros: "100000000000" }, updateMask: "amount_micros" }]);
  await setCampaignStatus(ads, "1", "PAUSED", { apply: true });
  assert.equal(calls.find((c) => c.url.endsWith("campaigns:mutate"))?.body.validateOnly, false);
});

test("budget write refuses shared budgets and out-of-range amounts", async () => {
  await assert.rejects(setCampaignBudget(new GoogleAdsClient(settings, fakeFetch(true).impl), "1", 100000), /shared/);
  await assert.rejects(setCampaignBudget(new GoogleAdsClient(settings, fakeFetch().impl), "1", 5_000_000), /between/);
  await assert.rejects(setCampaignStatus(new GoogleAdsClient(settings, fakeFetch().impl), "1 OR 1=1", "PAUSED"), /numeric/);
});

test("keyword pause and conversion primary changes build validateOnly mutations and reject unsafe input", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl: typeof fetch = async (url, init) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t" }));
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    if (String(url).endsWith(":mutate")) return new Response(JSON.stringify({ results: [{}] }));
    const row = String(body.query).includes("conversion_action")
      ? { conversionAction: { name: "Booking", primaryForGoal: true } }
      : { campaign: { name: "MONTHLY PROMO" }, adGroupCriterion: { resourceName: "customers/7931288995/adGroupCriteria/5~6", status: "ENABLED", keyword: { text: "hotel resort", matchType: "BROAD" } } };
    return new Response(JSON.stringify({ results: [row] }));
  };
  const ads = new GoogleAdsClient(settings, impl);
  const kw = await setKeywordStatus(ads, "hotel resort", "PAUSED");
  assert.deepEqual(kw, { campaign: 'keyword "hotel resort" @ MONTHLY PROMO (BROAD)', before: "ENABLED", after: "PAUSED", applied: false });
  assert.deepEqual(calls.find((c) => c.url.endsWith("adGroupCriteria:mutate"))?.body, {
    operations: [{ update: { resourceName: "customers/7931288995/adGroupCriteria/5~6", status: "PAUSED" }, updateMask: "status" }],
    validateOnly: true,
  });
  const conv = await setConversionPrimary(ads, "6623400671", false);
  assert.deepEqual(conv, { campaign: 'konversi "Booking"', before: "primary", after: "secondary", applied: false });
  assert.equal(calls.find((c) => c.url.endsWith("conversionActions:mutate"))?.body.validateOnly, true);
  await assert.rejects(setKeywordStatus(ads, "x' OR '1'='1", "PAUSED"), /letters/);
  await assert.rejects(setConversionPrimary(ads, "abc", true), /numeric/);
});

test("conversion value: preview by default, whole number 1-1000, always the default value (owner 22 Nov, option A)", async () => {
  const { impl, calls } = fakeFetch();
  const ads = new GoogleAdsClient(settings, impl);
  const r = await setConversionValue(ads, "7902826995", 100);
  assert.equal(r.applied, false);
  assert.match(r.after, /100/);
  const mutate = calls.find((c) => c.url.endsWith("conversionActions:mutate"));
  assert.equal(mutate?.body.validateOnly, true);
  assert.deepEqual((mutate?.body.operations as { update: unknown; updateMask: string }[])[0], {
    update: { resourceName: "customers/7931288995/conversionActions/7902826995", valueSettings: { defaultValue: 100, alwaysUseDefaultValue: true } },
    updateMask: "value_settings.default_value,value_settings.always_use_default_value",
  });
  await assert.rejects(setConversionValue(ads, "7902826995", 0), /1/);
  await assert.rejects(setConversionValue(ads, "7902826995", 2.5), /whole/);
  await assert.rejects(setConversionValue(ads, "abc", 100), /numeric/);
});

test("GoogleAdsClient renews its one-hour access token instead of reusing the first one forever (23 Nov)", async () => {
  let now = Date.parse("2026-11-23T01:00:00Z");
  const realNow = Date.now;
  Date.now = () => now;
  try {
    let tokens = 0;
    const seen: string[] = [];
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: `t${++tokens}`, expires_in: 3599 }));
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      seen.push(auth);
      // The first token is refused once to prove a 401 also gets a fresh token.
      if (auth === "Bearer t2" && seen.filter((x) => x === "Bearer t2").length === 1) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;
    const ads = new GoogleAdsClient(settings, impl);
    await ads.search("SELECT campaign.id FROM campaign");
    await ads.search("SELECT campaign.id FROM campaign");
    assert.equal(tokens, 1, "same token within the hour");
    now += 60 * 60 * 1000;
    await ads.search("SELECT campaign.id FROM campaign");
    assert.deepEqual(seen, ["Bearer t1", "Bearer t1", "Bearer t2", "Bearer t3"], "expired → t2; t2 refused (401) → t3 and one retry");
  } finally {
    Date.now = realNow;
  }
});

test("toAdsBalance: money left = account budget limit − amount served, with days left at the last 7 days' pace (owner, 23 Nov)", () => {
  const b = toAdsBalance(
    [{ accountBudget: { status: "APPROVED", approvedSpendingLimitMicros: "323107494000000", totalAdjustmentsMicros: "967670000000", amountServedMicros: "322220004000000" } }],
    1_540_000 * 1e6,
    "2026-11-16",
    "2026-11-22",
  );
  // 23 Nov real values: the Penagihan page showed Dana yang tersedia Rp1.863.242 (a few hours of spend later).
  assert.deepEqual(b, { limit: 323107494, adjustments: 967670, served: 322220004, remaining: 1855160, avgDaily7: 220000, daysLeft: 8, since7: "2026-11-16", until7: "2026-11-22" });
  assert.equal(toAdsBalance([{ accountBudget: { status: "APPROVED", approvedEndDateTime: "2020-01-01", approvedSpendingLimitMicros: "1", amountServedMicros: "0" } }], 0, "a", "b"), null, "an ended budget is not the current balance");
  assert.equal(toAdsBalance([], 0, "a", "b"), null);
});
