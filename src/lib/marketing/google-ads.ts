// Google Ads API (Sanghyang 793-128-8995). Read = GAQL search. Write = mutate, which defaults to
// validateOnly (Google checks the change without applying it); only `apply: true` changes the account.
// Writes are run only after the owner approves the exact before→after in chat.
import { googleCredentials } from "./config.ts";

export const GOOGLE_ADS_API_VERSION = "v23";
type Json = Record<string, unknown>;

export type GoogleAdsSettings = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId?: string;
  developerToken?: string;
};

/** Reads OAuth client from GA4_CREDENTIALS_FILE and the Google Ads keys from env. Errors name keys only. */
export function googleAdsSettingsFromEnv(env: Record<string, string | undefined> = process.env): GoogleAdsSettings {
  const missing = ["GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_CUSTOMER_ID"].filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(missing.map((k) => `${k} missing`).join(", "));
  const { client_id, client_secret } = googleCredentials(env);
  if (!client_id || !client_secret) throw new Error("client_id/client_secret missing in GA4_CREDENTIALS_FILE");
  return {
    clientId: client_id,
    clientSecret: client_secret,
    refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN!.trim(),
    customerId: env.GOOGLE_ADS_CUSTOMER_ID!.trim().replaceAll("-", ""),
    loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim().replaceAll("-", "") || undefined,
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || undefined,
  };
}

function apiError(status: number, body: Json): string {
  const error = (body.error ?? {}) as Json;
  const details = (error.details as Json[] | undefined)?.flatMap((d) => (d.errors as Json[] | undefined) ?? []) ?? [];
  const detail = details.map((d) => d.message).filter(Boolean).join("; ");
  return `${status}: ${detail || error.message || "unknown Google Ads error"}`;
}

export class GoogleAdsClient {
  #s: GoogleAdsSettings;
  #fetch: typeof fetch;
  #token: string | undefined;
  #tokenUntil = 0;

  constructor(settings: GoogleAdsSettings, fetchImpl: typeof fetch = fetch) {
    this.#s = settings;
    this.#fetch = fetchImpl;
  }

  get customerId(): string {
    return this.#s.customerId;
  }

  async #headers(): Promise<Record<string, string>> {
    // Google access tokens live one hour; a warm server reused the first one forever, so every call
    // failed after an hour. Renew a minute before it ends (and after a 401, see #post).
    if (!this.#token || Date.now() > this.#tokenUntil) {
      const res = await this.#fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.#s.clientId, client_secret: this.#s.clientSecret, refresh_token: this.#s.refreshToken, grant_type: "refresh_token" }),
      });
      const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
      if (!json.access_token) throw new Error(`GOOGLE_ADS_TOKEN_FAILED: ${res.status} ${json.error ?? "no access_token"}`);
      this.#token = json.access_token;
      this.#tokenUntil = Date.now() + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000;
    }
    const headers: Record<string, string> = { authorization: `Bearer ${this.#token}`, "content-type": "application/json" };
    if (this.#s.loginCustomerId) headers["login-customer-id"] = this.#s.loginCustomerId;
    if (this.#s.developerToken) headers["developer-token"] = this.#s.developerToken;
    return headers;
  }

  async #post(path: string, body: Json, retried = false): Promise<Json> {
    const res = await this.#fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${this.#s.customerId}/${path}`, {
      method: "POST",
      headers: await this.#headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      this.#token = undefined; // revoked or expired early: get a new one and try once more
      return this.#post(path, body, true);
    }
    const json = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok || json.error) throw new Error(`GOOGLE_ADS_FAILED: ${apiError(res.status, json)}`);
    return json;
  }

  /** GAQL search; follows nextPageToken. */
  async search(query: string): Promise<Json[]> {
    const rows: Json[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.#post("googleAds:search", pageToken ? { query, pageToken } : { query });
      rows.push(...((page.results as Json[] | undefined) ?? []));
      pageToken = page.nextPageToken as string | undefined;
    } while (pageToken);
    return rows;
  }

  /** e.g. mutate("campaignBudgets", [...]). Without apply:true Google only validates (nothing changes). */
  async mutate(service: string, operations: Json[], { apply = false } = {}): Promise<Json> {
    return this.#post(`${service}:mutate`, { operations, validateOnly: !apply });
  }
}

const n = (v: unknown): number => Number(v ?? 0) || 0;
const rupiah = (micros: unknown): number => Math.round(n(micros) / 1e6);
const idr = (v: number): string => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const get = (row: Json, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Json | undefined)?.[k], row);
const assertDate = (d: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`invalid date ${d}`);
  return d;
};

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  channel: string;
  budgetResource: string;
  budgetPerDay: number;
  budgetShared: boolean;
  bidding: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  allConversions: number;
};

export function toCampaignRows(rows: Json[]): CampaignRow[] {
  return rows.map((r) => ({
    id: String(get(r, "campaign.id")),
    name: String(get(r, "campaign.name")),
    status: String(get(r, "campaign.status")),
    channel: String(get(r, "campaign.advertisingChannelType") ?? ""),
    budgetResource: String(get(r, "campaignBudget.resourceName") ?? ""),
    budgetPerDay: rupiah(get(r, "campaignBudget.amountMicros")),
    budgetShared: get(r, "campaignBudget.explicitlyShared") === true,
    bidding: String(get(r, "campaign.biddingStrategyType") ?? ""),
    cost: rupiah(get(r, "metrics.costMicros")),
    impressions: n(get(r, "metrics.impressions")),
    clicks: n(get(r, "metrics.clicks")),
    conversions: n(get(r, "metrics.conversions")),
    allConversions: n(get(r, "metrics.allConversions")),
  }));
}

export async function campaignReport(client: GoogleAdsClient, since: string, until: string): Promise<CampaignRow[]> {
  const rows = await client.search(
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type,
       campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared,
       metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.all_conversions
     FROM campaign WHERE segments.date BETWEEN '${assertDate(since)}' AND '${assertDate(until)}' AND campaign.status != 'REMOVED'`,
  );
  return toCampaignRows(rows).sort((a, b) => b.cost - a.cost);
}

/** Clicks per campaign and per place the ad was shown (Pencarian, Maps, YouTube, situs mitra, …). */
export type NetworkRow = { campaign: string; network: string; clicks: number; impressions: number; cost: number };

export function toNetworkRows(rows: Json[]): NetworkRow[] {
  return rows.map((r) => ({
    campaign: String(get(r, "campaign.name")),
    network: String(get(r, "segments.adNetworkType") ?? "UNKNOWN"),
    clicks: n(get(r, "metrics.clicks")),
    impressions: n(get(r, "metrics.impressions")),
    cost: rupiah(get(r, "metrics.costMicros")),
  }));
}

export async function networkReport(client: GoogleAdsClient, since: string, until: string): Promise<NetworkRow[]> {
  const rows = await client.search(
    `SELECT campaign.name, segments.ad_network_type, metrics.clicks, metrics.impressions, metrics.cost_micros
     FROM campaign WHERE segments.date BETWEEN '${assertDate(since)}' AND '${assertDate(until)}' AND campaign.status != 'REMOVED'`,
  );
  return toNetworkRows(rows).filter((r) => r.clicks > 0 || r.impressions > 0 || r.cost > 0);
}

/**
 * What is left of the ad money (owner, 23 Nov: "sisa anggaran bisa ditarik?"). The account pays in
 * advance; Google keeps an account budget whose spending limit grows with each top-up, so
 * limit + adjustments (credits) − amount served ≈ the balance left. Checked 23 Nov against "Dana yang
 * tersedia" in Penagihan (Rp1.863.242): without the adjustments it was Rp975 rb too low. Runway uses
 * the average daily cost of the last 7 days.
 */
export type AdsBalance = { limit: number; adjustments: number; served: number; remaining: number; avgDaily7: number; daysLeft: number | null; since7: string; until7: string };

export function toAdsBalance(budgets: Json[], cost7Micros: number, since7: string, until7: string): AdsBalance | null {
  const active = budgets.map((r) => (get(r, "accountBudget") ?? {}) as Json).filter((b) => String(b.status) === "APPROVED" && !b.approvedEndDateTime);
  if (active.length === 0) return null;
  const limit = active.reduce((s, b) => s + rupiah(b.approvedSpendingLimitMicros), 0);
  const adjustments = active.reduce((s, b) => s + rupiah(b.totalAdjustmentsMicros), 0);
  const served = active.reduce((s, b) => s + rupiah(b.amountServedMicros), 0);
  const remaining = Math.max(0, limit + adjustments - served);
  const avgDaily7 = Math.round(n(cost7Micros) / 1e6 / 7);
  return { limit, adjustments, served, remaining, avgDaily7, daysLeft: avgDaily7 > 0 ? Math.floor(remaining / avgDaily7) : null, since7, until7 };
}

export async function adsBalance(client: GoogleAdsClient, since7: string, until7: string): Promise<AdsBalance | null> {
  const [budgets, cost] = await Promise.all([
    client.search("SELECT account_budget.status, account_budget.approved_spending_limit_micros, account_budget.amount_served_micros, account_budget.total_adjustments_micros, account_budget.approved_end_date_time FROM account_budget"),
    client.search(`SELECT metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${assertDate(since7)}' AND '${assertDate(until7)}'`),
  ]);
  const cost7 = cost.reduce((s, r) => s + n(get(r, "metrics.costMicros")), 0);
  return toAdsBalance(budgets, cost7, since7, until7);
}

export type ConversionRow = { campaign: string; action: string; conversions: number; allConversions: number };

export async function conversionsByAction(client: GoogleAdsClient, since: string, until: string): Promise<ConversionRow[]> {
  const rows = await client.search(
    `SELECT campaign.name, segments.conversion_action_name, metrics.conversions, metrics.all_conversions
     FROM campaign WHERE segments.date BETWEEN '${assertDate(since)}' AND '${assertDate(until)}' AND campaign.status != 'REMOVED'`,
  );
  return rows
    .map((r) => ({ campaign: String(get(r, "campaign.name")), action: String(get(r, "segments.conversionActionName")), conversions: n(get(r, "metrics.conversions")), allConversions: n(get(r, "metrics.allConversions")) }))
    .filter((r) => r.allConversions > 0);
}

export type MonthlyCampaignRow = { month: string; campaign: string; cost: number };
export type MonthlyActionRow = { month: string; campaign: string; action: string; allConversions: number };

/** Cost and results per campaign and calendar month, cut at since/until; two Google calls for the whole range. */
export async function monthlyCampaigns(client: GoogleAdsClient, since: string, until: string): Promise<{ costs: MonthlyCampaignRow[]; actions: MonthlyActionRow[] }> {
  const when = `segments.date BETWEEN '${assertDate(since)}' AND '${assertDate(until)}'`;
  const [costs, actions] = await Promise.all([
    client.search(`SELECT segments.month, campaign.name, metrics.cost_micros FROM campaign WHERE ${when} AND metrics.cost_micros > 0`),
    client.search(`SELECT segments.month, campaign.name, segments.conversion_action_name, metrics.all_conversions FROM campaign WHERE ${when} AND metrics.all_conversions > 0`),
  ]);
  const month = (r: Json) => String(get(r, "segments.month")).slice(0, 7);
  return {
    costs: costs.map((r) => ({ month: month(r), campaign: String(get(r, "campaign.name")), cost: n(get(r, "metrics.costMicros")) / 1e6 })),
    actions: actions.map((r) => ({ month: month(r), campaign: String(get(r, "campaign.name")), action: String(get(r, "segments.conversionActionName")), allConversions: n(get(r, "metrics.allConversions")) })),
  };
}

export function formatGoogleAdsReport(since: string, until: string, campaigns: CampaignRow[], conversions: ConversionRow[]): string {
  const lines = [`SANGHYANG — GOOGLE ADS ${since} s/d ${until}`];
  const total = campaigns.reduce((s, c) => s + c.cost, 0);
  const hidden = campaigns.filter((c) => c.status !== "ENABLED" && c.cost === 0).length;
  for (const c of campaigns.filter((x) => x.status === "ENABLED" || x.cost > 0)) {
    const cpc = c.clicks ? ` · CPC ${idr(c.cost / c.clicks)}` : "";
    lines.push(
      `• ${c.name} [${c.status}] budget ${idr(c.budgetPerDay)}/hari${c.budgetShared ? " (shared)" : ""} — biaya ${idr(c.cost)}, ${c.impressions} tayang, ${c.clicks} klik${cpc}, konversi ${c.conversions.toFixed(1)}`,
    );
    for (const k of conversions.filter((x) => x.campaign === c.name).sort((a, b) => b.allConversions - a.allConversions))
      lines.push(`    - ${k.action}: ${k.allConversions.toFixed(1)}${k.conversions !== k.allConversions ? ` (dihitung utama ${k.conversions.toFixed(1)})` : ""}`);
  }
  if (hidden) lines.push(`(${hidden} campaign dijeda tanpa biaya tidak ditampilkan)`);
  lines.push(`Total biaya: ${idr(total)} · budget aktif/hari: ${idr(campaigns.filter((c) => c.status === "ENABLED").reduce((s, c) => s + c.budgetPerDay, 0))}`);
  return lines.join("\n");
}

/** Budget change: preview (validateOnly) unless apply. Refuses shared budgets so one change can't hit several campaigns. */
export async function setCampaignBudget(client: GoogleAdsClient, campaignId: string, rupiahPerDay: number, { apply = false } = {}) {
  if (!/^\d+$/.test(campaignId)) throw new Error("campaign id must be numeric");
  if (!Number.isInteger(rupiahPerDay) || rupiahPerDay < 10_000 || rupiahPerDay > 1_000_000) throw new Error("budget must be a whole rupiah amount between Rp10.000 and Rp1.000.000 per day");
  const [row] = toCampaignRows(
    await client.search(
      `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campaignId}`,
    ),
  );
  if (!row) throw new Error(`campaign ${campaignId} not found`);
  if (row.budgetShared) throw new Error(`budget of ${row.name} is shared; change it in the UI`);
  await client.mutate("campaignBudgets", [{ update: { resourceName: row.budgetResource, amountMicros: String(rupiahPerDay * 1e6) }, updateMask: "amount_micros" }], { apply });
  return { campaign: row.name, before: row.budgetPerDay, after: rupiahPerDay, applied: apply };
}

/** Pause/enable a (positive) keyword by exact text across enabled campaigns: preview unless apply. */
export async function setKeywordStatus(client: GoogleAdsClient, keyword: string, status: "ENABLED" | "PAUSED", { apply = false } = {}) {
  if (!/^[\p{L}\p{N} ]{2,80}$/u.test(keyword)) throw new Error("keyword must be letters, digits and spaces only");
  if (status !== "ENABLED" && status !== "PAUSED") throw new Error("status must be ENABLED or PAUSED");
  const rows = await client.search(
    `SELECT campaign.name, ad_group_criterion.resource_name, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
     FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND campaign.status = 'ENABLED'
     AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.keyword.text = '${keyword}'`,
  );
  if (!rows.length) throw new Error(`keyword "${keyword}" not found in enabled campaigns`);
  await client.mutate("adGroupCriteria", rows.map((r) => ({ update: { resourceName: String(get(r, "adGroupCriterion.resourceName")), status }, updateMask: "status" })), { apply });
  const where = rows.map((r) => `${get(r, "campaign.name")} (${get(r, "adGroupCriterion.keyword.matchType")})`).join(", ");
  return { campaign: `keyword "${keyword}" @ ${where}`, before: rows.map((r) => String(get(r, "adGroupCriterion.status"))).join(","), after: status, applied: apply };
}

/** Make a conversion action primary (counts for bidding) or secondary (report only): preview unless apply. */
export async function setConversionPrimary(client: GoogleAdsClient, conversionActionId: string, primary: boolean, { apply = false } = {}) {
  if (!/^\d+$/.test(conversionActionId)) throw new Error("conversion action id must be numeric");
  const [row] = await client.search(`SELECT conversion_action.name, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.id = ${conversionActionId}`);
  if (!row) throw new Error(`conversion action ${conversionActionId} not found`);
  const resourceName = `customers/${client.customerId}/conversionActions/${conversionActionId}`;
  await client.mutate("conversionActions", [{ update: { resourceName, primaryForGoal: primary }, updateMask: "primary_for_goal" }], { apply });
  const label = (p: unknown) => (p === true ? "primary" : "secondary");
  return { campaign: `konversi "${get(row, "conversionAction.name")}"`, before: label(get(row, "conversionAction.primaryForGoal")), after: label(primary), applied: apply };
}

/**
 * Set how much a conversion action is worth to value bidding (owner 22 Nov, option A: WhatsApp and
 * phone clicks 100, everything else stays 1). Always the default value, so a value sent by GA4 never
 * overrides it. Preview unless apply.
 */
export async function setConversionValue(client: GoogleAdsClient, conversionActionId: string, value: number, { apply = false } = {}) {
  if (!/^\d+$/.test(conversionActionId)) throw new Error("conversion action id must be numeric");
  if (!Number.isInteger(value)) throw new Error("value must be a whole number");
  if (value < 1 || value > 1000) throw new Error("value must be between 1 and 1000");
  const [row] = await client.search(
    `SELECT conversion_action.name, conversion_action.value_settings.default_value, conversion_action.value_settings.always_use_default_value FROM conversion_action WHERE conversion_action.id = ${conversionActionId}`,
  );
  if (!row) throw new Error(`conversion action ${conversionActionId} not found`);
  const resourceName = `customers/${client.customerId}/conversionActions/${conversionActionId}`;
  await client.mutate(
    "conversionActions",
    [{ update: { resourceName, valueSettings: { defaultValue: value, alwaysUseDefaultValue: true } }, updateMask: "value_settings.default_value,value_settings.always_use_default_value" }],
    { apply },
  );
  const before = `nilai ${get(row, "conversionAction.valueSettings.defaultValue") ?? "-"}${get(row, "conversionAction.valueSettings.alwaysUseDefaultValue") === true ? " (selalu)" : ""}`;
  return { campaign: `konversi "${get(row, "conversionAction.name")}"`, before, after: `nilai ${value} (selalu)`, applied: apply };
}

/** Pause/enable a campaign: preview unless apply. */
export async function setCampaignStatus(client: GoogleAdsClient, campaignId: string, status: "ENABLED" | "PAUSED", { apply = false } = {}) {
  if (!/^\d+$/.test(campaignId)) throw new Error("campaign id must be numeric");
  if (status !== "ENABLED" && status !== "PAUSED") throw new Error("status must be ENABLED or PAUSED");
  const [row] = toCampaignRows(await client.search(`SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id = ${campaignId}`));
  if (!row) throw new Error(`campaign ${campaignId} not found`);
  await client.mutate("campaigns", [{ update: { resourceName: `customers/${client.customerId}/campaigns/${campaignId}`, status }, updateMask: "status" }], { apply });
  return { campaign: row.name, before: row.status, after: status, applied: apply };
}
