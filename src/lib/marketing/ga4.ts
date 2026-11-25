// Read-only GA4 Data API (property 216046044) for Sanghyang: WhatsApp/phone clicks, bookings, traffic.
import { googleCredentials } from "./config.ts";
import { addDays, todayIn } from "./metrics.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const EVENTS = ["whatsapp_click", "phone_click", "purchase", "begin_checkout"] as const;

type Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type Count = { all: number; ads: number };
export type Ga4Summary = { whatsapp: Count; phone: Count; checkout: Count; purchase: Count; value: Count };

const isGoogleAds = (sourceMedium: string): boolean => /^google \/ cpc$/i.test(sourceMedium.trim());

export function summarizeGa4(rows: readonly Row[]): Ga4Summary {
  const zero = (): Count => ({ all: 0, ads: 0 });
  const s: Ga4Summary = { whatsapp: zero(), phone: zero(), checkout: zero(), purchase: zero(), value: zero() };
  const bucket: Record<string, Count> = { whatsapp_click: s.whatsapp, phone_click: s.phone, begin_checkout: s.checkout, purchase: s.purchase };
  for (const row of rows) {
    const [event = "", sourceMedium = ""] = (row.dimensionValues ?? []).map((d) => d.value ?? "");
    const [count = 0, value = 0] = (row.metricValues ?? []).map((m) => Number(m.value ?? 0));
    const target = bucket[event];
    if (!target) continue;
    const ads = isGoogleAds(sourceMedium);
    target.all += count;
    if (ads) target.ads += count;
    if (event === "purchase") {
      s.value.all += value;
      if (ads) s.value.ads += value;
    }
  }
  return s;
}

// One report asked Google for a new GA4 token per call (4 per Laporan). Keep it until a minute before
// it ends; keyed by the fetch used so tests with their own fetch never share a token.
const tokens = new WeakMap<typeof fetch, Map<string, { token: string; until: number }>>();

async function accessToken(creds: Record<string, string>, fetchImpl: typeof fetch): Promise<string> {
  const byFetch = tokens.get(fetchImpl) ?? new Map<string, { token: string; until: number }>();
  tokens.set(fetchImpl, byFetch);
  const hit = byFetch.get(creds.refresh_token ?? "");
  if (hit && Date.now() < hit.until) return hit.token;
  const token = await newAccessToken(creds, fetchImpl);
  byFetch.set(creds.refresh_token ?? "", { token: token.token, until: Date.now() + Math.max(60, token.expiresIn - 60) * 1000 });
  return token.token;
}

async function newAccessToken(creds: Record<string, string>, fetchImpl: typeof fetch): Promise<{ token: string; expiresIn: number }> {
  if (creds.type !== "authorized_user") throw new Error(`GA4 credentials type ${creds.type ?? "unknown"} not supported (need authorized_user)`);
  const { client_id, client_secret, refresh_token } = creds;
  if (!client_id || !client_secret || !refresh_token) throw new Error("GA4 credentials file is missing client_id, client_secret or refresh_token");
  const body = new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: "refresh_token" });
  const res = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`GA4 token refresh failed: ${res.status} ${json.error ?? ""}`.trim());
  return { token: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

async function runReport(token: string, propertyId: string, since: string, until: string, fetchImpl: typeof fetch): Promise<Ga4Summary> {
  const res = await fetchImpl(`${DATA_API}/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: since, endDate: until }],
      dimensions: [{ name: "eventName" }, { name: "sessionSourceMedium" }],
      metrics: [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: [...EVENTS] } } },
      limit: 1000,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { rows?: Row[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`GA4 runReport failed: ${res.status} ${json.error?.message ?? ""}`.trim());
  return summarizeGa4(json.rows ?? []);
}

/** GA4 summary for any date range; throws when GA4 env is missing or the API fails. */
export async function ga4Summary(env: Record<string, string | undefined>, since: string, until: string, fetchImpl: typeof fetch = fetch): Promise<Ga4Summary> {
  const credentialsFile = env.GOOGLE_OAUTH_CLIENT_JSON?.trim() || env.GA4_CREDENTIALS_FILE?.trim();
  const propertyId = env.GA4_PROPERTY_ID?.trim();
  if (!credentialsFile || !propertyId) throw new Error("GOOGLE_OAUTH_CLIENT_JSON or GA4_CREDENTIALS_FILE / GA4_PROPERTY_ID missing");
  return runReport(await accessToken(googleCredentials(env), fetchImpl), propertyId, since, until, fetchImpl);
}

/** Klik WhatsApp + telepon di website dari sesi iklan Google (google / cpc) per tanggal YYYY-MM-DD. */
export async function ga4DailyContacts(env: Record<string, string | undefined>, since: string, until: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, number>> {
  const credentialsFile = env.GOOGLE_OAUTH_CLIENT_JSON?.trim() || env.GA4_CREDENTIALS_FILE?.trim();
  const propertyId = env.GA4_PROPERTY_ID?.trim();
  if (!credentialsFile || !propertyId) return {};
  const token = await accessToken(googleCredentials(env), fetchImpl);
  const res = await fetchImpl(`${DATA_API}/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: since, endDate: until }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            { filter: { fieldName: "sessionSourceMedium", stringFilter: { matchType: "EXACT", value: "google / cpc" } } },
            { filter: { fieldName: "eventName", inListFilter: { values: ["whatsapp_click", "phone_click"] } } },
          ],
        },
      },
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { rows?: Row[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`GA4 runReport failed: ${res.status} ${json.error?.message ?? ""}`.trim());
  const out: Record<string, number> = {};
  for (const row of json.rows ?? []) {
    const d = row.dimensionValues?.[0]?.value ?? "";
    if (/^\d{8}$/.test(d)) out[`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`] = Number(row.metricValues?.[0]?.value ?? 0);
  }
  return out;
}

export type Ga4Traffic = { users: number; engagementRate: number; adsUsers: number; adsEngagementRate: number };

/** Users and engagement rate, all sources and Google Ads (google / cpc). Users are not additive across sources, so two queries. */
export async function ga4Traffic(env: Record<string, string | undefined>, since: string, until: string, fetchImpl: typeof fetch = fetch): Promise<Ga4Traffic> {
  const credentialsFile = env.GOOGLE_OAUTH_CLIENT_JSON?.trim() || env.GA4_CREDENTIALS_FILE?.trim();
  const propertyId = env.GA4_PROPERTY_ID?.trim();
  if (!credentialsFile || !propertyId) throw new Error("GOOGLE_OAUTH_CLIENT_JSON or GA4_CREDENTIALS_FILE / GA4_PROPERTY_ID missing");
  const token = await accessToken(googleCredentials(env), fetchImpl);
  const query = async (adsOnly: boolean): Promise<[number, number]> => {
    const res = await fetchImpl(`${DATA_API}/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: since, endDate: until }],
        metrics: [{ name: "totalUsers" }, { name: "engagementRate" }],
        ...(adsOnly ? { dimensionFilter: { filter: { fieldName: "sessionSourceMedium", stringFilter: { matchType: "EXACT", value: "google / cpc" } } } } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { rows?: Row[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`GA4 runReport failed: ${res.status} ${json.error?.message ?? ""}`.trim());
    const [users = 0, rate = 0] = (json.rows?.[0]?.metricValues ?? []).map((m) => Number(m.value ?? 0));
    return [users, rate];
  };
  const [[users, engagementRate], [adsUsers, adsEngagementRate]] = await Promise.all([query(false), query(true)]);
  return { users, engagementRate, adsUsers, adsEngagementRate };
}

const rp = (v: number): string => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const pair = (c: Count): string => `${c.all} (iklan Google ${c.ads})`;

export function formatGa4Section(day: string, yesterday: Ga4Summary, monthStart: string, month: Ga4Summary): string[] {
  const block = (s: Ga4Summary) => [
    `• Klik WhatsApp: ${pair(s.whatsapp)}`,
    `• Klik telepon: ${pair(s.phone)}`,
    `• Mulai pesan kamar: ${pair(s.checkout)}`,
    `• Booking website: ${pair(s.purchase)} · ${rp(s.value.all)} (iklan ${rp(s.value.ads)})`,
  ];
  return [
    "SANGHYANG — WEBSITE (GA4 216046044)",
    `Kemarin ${day}:`,
    ...block(yesterday),
    `Bulan ini ${monthStart} s/d ${day}:`,
    ...block(month),
    "Klik WhatsApp = tombol ditekan, belum tentu pesan terkirim.",
  ];
}

export async function ga4ReportSection(env: Record<string, string | undefined> = process.env, now = new Date(), timezone = "Asia/Jakarta", fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const credentialsFile = env.GOOGLE_OAUTH_CLIENT_JSON?.trim() || env.GA4_CREDENTIALS_FILE?.trim();
  const propertyId = env.GA4_PROPERTY_ID?.trim();
  if (!credentialsFile || !propertyId) return [];
  const day = addDays(todayIn(timezone, now), -1);
  const monthStart = `${day.slice(0, 7)}-01`;
  try {
    const token = await accessToken(googleCredentials(env), fetchImpl);
    const [yesterday, month] = await Promise.all([runReport(token, propertyId, day, day, fetchImpl), runReport(token, propertyId, monthStart, day, fetchImpl)]);
    return formatGa4Section(day, yesterday, monthStart, month);
  } catch (error) {
    // A GA4 failure must not block the Meta report.
    return ["SANGHYANG — WEBSITE (GA4)", `Data GA4 gagal dibaca: ${(error as Error).message}`];
  }
}
