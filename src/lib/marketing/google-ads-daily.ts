// Pantauan harian Google Ads Sanghyang (baca-saja) untuk kartu di dashboard /sanghyang dan perintah `daily`, plus
// pengingat terjadwal dari docs/reminders.json. Perbaikan tidak dijalankan dari sini: owner menyetujui setiap perubahan di chat.
import { existsSync, readFileSync } from "node:fs";
import { REMINDERS_FILE } from "./config.ts";
import { ga4DailyContacts } from "./ga4.ts";
import { GoogleAdsClient, googleAdsSettingsFromEnv } from "./google-ads.ts";
import { addDays, todayIn } from "./metrics.ts";

const CHAT = ["Conversation started"];
const CALL = ["Klik untuk menelepon", "Calls from Smart Campaign Ads", "Smart campaign ad clicks to call", "Smart campaign map clicks to call"];
const MAPS = ["Tindakan lokal - Rute"];

export type DayCampaign = { cost: number; clicks: number; chats: number; calls: number; maps: number };
/** date → campaign name → numbers; `web` = klik WA/telepon di website dari sesi iklan (GA4). */
export type DailyData = { days: Record<string, Record<string, DayCampaign>>; web: Record<string, number> };

export async function loadGoogleDaily(ads: GoogleAdsClient, env: Record<string, string | undefined>, since: string, until: string, fetchImpl: typeof fetch = fetch): Promise<DailyData> {
  const W = `segments.date BETWEEN '${since}' AND '${until}' AND campaign.status = 'ENABLED'`;
  const [perf, conv, web] = await Promise.all([
    ads.search(`SELECT segments.date, campaign.name, metrics.cost_micros, metrics.clicks FROM campaign WHERE ${W}`),
    ads.search(`SELECT segments.date, campaign.name, segments.conversion_action_name, metrics.all_conversions FROM campaign WHERE ${W}`),
    ga4DailyContacts(env, since, until, fetchImpl),
  ]);
  const days: DailyData["days"] = {};
  const cell = (d: string, c: string): DayCampaign => {
    const byCampaign = days[d] ?? {};
    days[d] = byCampaign;
    const found = byCampaign[c] ?? { cost: 0, clicks: 0, chats: 0, calls: 0, maps: 0 };
    byCampaign[c] = found;
    return found;
  };
  type Row = { segments: { date: string; conversionActionName?: string }; campaign: { name: string }; metrics: { costMicros?: string; clicks?: string; allConversions?: number } };
  for (const r of perf as unknown as Row[]) {
    const x = cell(r.segments.date, r.campaign.name);
    x.cost += Number(r.metrics.costMicros ?? 0) / 1e6;
    x.clicks += Number(r.metrics.clicks ?? 0);
  }
  for (const r of conv as unknown as Row[]) {
    const x = cell(r.segments.date, r.campaign.name);
    const n = Number(r.metrics.allConversions ?? 0);
    const a = String(r.segments.conversionActionName);
    if (CHAT.includes(a)) x.chats += n;
    else if (CALL.includes(a)) x.calls += n;
    else if (MAPS.includes(a)) x.maps += n;
  }
  return { days, web };
}

const rp = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const n = (v: number) => Math.round(v).toLocaleString("id-ID");
const total = (d: Record<string, DayCampaign> | undefined) =>
  Object.values(d ?? {}).reduce((s, x) => ({ cost: s.cost + x.cost, clicks: s.clicks + x.clicks, chats: s.chats + x.chats, calls: s.calls + x.calls, maps: s.maps + x.maps }), { cost: 0, clicks: 0, chats: 0, calls: 0, maps: 0 });

/** Ringkasan kemarin vs rata-rata 7 hari sebelumnya, dengan peringatan bila memburuk. */
export function formatGoogleDaily(data: DailyData, yesterday: string): string[] {
  const contacts = (date: string) => {
    const t = total(data.days[date]);
    return Math.round(t.chats + t.calls) + (data.web[date] ?? 0);
  };
  const prior = Array.from({ length: 7 }, (_, i) => addDays(yesterday, -7 + i));
  const y = total(data.days[yesterday]);
  const yContacts = contacts(yesterday);
  const avgContacts = prior.reduce((s, d) => s + contacts(d), 0) / 7;
  const avgCost = prior.reduce((s, d) => s + total(data.days[d]).cost, 0) / 7;
  const arrow = (a: number, b: number) => (b === 0 ? "" : a > b * 1.05 ? " ▲" : a < b * 0.95 ? " ▼" : " =");
  const lines = [
    `SANGHYANG — GOOGLE ADS (kemarin ${yesterday})`,
    `• Kontak dari iklan: ${yContacts}${arrow(yContacts, avgContacts)} (chat ${n(y.chats)}, telepon ${n(y.calls)}, klik WA/telp web ${data.web[yesterday] ?? 0}) · rata-rata 7 hari ${avgContacts.toFixed(1).replace(".", ",")}/hari`,
    `• Biaya ${rp(y.cost)}${arrow(y.cost, avgCost)} · klik ${n(y.clicks)} · rata-rata 7 hari ${rp(avgCost)}/hari`,
  ];
  const mpCpc = (date: string) => {
    const m = data.days[date]?.["MONTHLY PROMO"];
    return m?.clicks ? m.cost / m.clicks : null;
  };
  for (const [name, x] of Object.entries(data.days[yesterday] ?? {}).sort((a, b) => b[1].cost - a[1].cost)) {
    const extra = name === "Local store visits" ? `, rute Maps ${n(x.maps)}` : "";
    lines.push(`  - ${name}: ${rp(x.cost)}, ${n(x.clicks)} klik, chat ${n(x.chats)}, telepon ${n(x.calls)}${extra}`);
  }
  const warnings: string[] = [];
  if (yContacts === 0 && contacts(addDays(yesterday, -1)) === 0) warnings.push("⚠️ 2 hari berturut-turut tanpa kontak dari iklan Google. Minta Claude mengecek.");
  const cpcs = prior.map(mpCpc).filter((v): v is number => v !== null);
  const yCpc = mpCpc(yesterday);
  if (yCpc !== null && cpcs.length >= 3) {
    const avg = cpcs.reduce((s, v) => s + v, 0) / cpcs.length;
    if (yCpc > avg * 1.5) warnings.push(`⚠️ Biaya per klik MONTHLY PROMO ${rp(yCpc)}, lebih dari 1,5× rata-rata 7 hari (${rp(avg)}).`);
  }
  return [...lines, ...warnings];
}

export async function googleAdsDailySection(env: Record<string, string | undefined> = process.env, now = new Date(), timezone = "Asia/Jakarta", fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (!env.GOOGLE_ADS_REFRESH_TOKEN?.trim()) return [];
  const yesterday = addDays(todayIn(timezone, now), -1);
  try {
    const ads = new GoogleAdsClient(googleAdsSettingsFromEnv(env), fetchImpl);
    return formatGoogleDaily(await loadGoogleDaily(ads, env, addDays(yesterday, -7), yesterday, fetchImpl), yesterday);
  } catch (error) {
    return ["SANGHYANG — GOOGLE ADS", `Data Google Ads gagal dibaca: ${(error as Error).message}`];
  }
}

export type Reminder = { date: string; text: string };

/** Pengingat untuk tanggal hari ini (WIB) dari docs/reminders.json. Berkas rusak tidak menghentikan laporan. */
export function reminderLines(date: string, file = REMINDERS_FILE): string[] {
  if (!existsSync(file)) return [];
  try {
    const items = (JSON.parse(readFileSync(file, "utf8")) as Reminder[]).filter((r) => r.date === date && r.text?.trim());
    return items.length ? ["PENGINGAT HARI INI", ...items.map((r) => `🔔 ${r.text.trim()}`)] : [];
  } catch (error) {
    return [`Pengingat tidak terbaca (${(error as Error).message}); periksa docs/reminders.json.`];
  }
}
