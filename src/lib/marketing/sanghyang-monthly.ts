// Monthly WhatsApp/contact report for Sanghyang: Google Ads (spend, chats, calls) + GA4 216046044 (website WA/phone clicks,
// bookings). Read-only. Website clicks come from GA4 only, so they are never double counted with the Ads GA4 import.
import { type Ga4Summary, ga4Summary } from "./ga4.ts";
import { type CampaignRow, type ConversionRow, campaignReport, conversionsByAction, type GoogleAdsClient } from "./google-ads.ts";
import { addDays, todayIn } from "./metrics.ts";

const CHAT_ACTIONS = new Set(["Conversation started"]);
const CALL_ACTIONS = new Set(["Klik untuk menelepon", "Calls from Smart Campaign Ads", "Smart campaign ad clicks to call", "Smart campaign map clicks to call"]);

export type Period = { since: string; until: string };
export type PeriodData = { period: Period; campaigns: CampaignRow[]; conversions: ConversionRow[]; ga4: Ga4Summary };

const lastDayOfMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Month to date (capped at yesterday) and the same day-span of the previous month. */
export function monthlyPeriods(month: string | undefined, now = new Date(), timezone = "Asia/Jakarta"): { current: Period; previous: Period; complete: boolean } {
  const yesterday = addDays(todayIn(timezone, now), -1);
  const m = month ?? yesterday.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Error("--month must be YYYY-MM");
  const since = `${m}-01`;
  if (since > yesterday) throw new Error(`month ${m} has no finished days yet`);
  const end = lastDayOfMonth(m);
  const until = end < yesterday ? end : yesterday;
  const span = Number(until.slice(8, 10));
  const prevMonth = addDays(since, -1).slice(0, 7);
  const prevEnd = lastDayOfMonth(prevMonth);
  const prevUntil = `${prevMonth}-${String(Math.min(span, Number(prevEnd.slice(8, 10)))).padStart(2, "0")}`;
  return { current: { since, until }, previous: { since: `${prevMonth}-01`, until: end === until ? prevEnd : prevUntil }, complete: until === end };
}

export type Totals = {
  cost: number;
  clicks: number;
  chats: number;
  calls: number;
  waWeb: number;
  phoneWeb: number;
  /** false when GA4 recorded no WA/phone click from any source: the website buttons were not tracked yet. */
  webTracked: boolean;
  adsContacts: number;
  contacts: number;
  perContact: number | null;
  perAdsContact: number | null;
  bookings: number;
  bookingValue: number;
};

export function totals(d: PeriodData): Totals {
  const sum = (names: Set<string>) => d.conversions.filter((c) => names.has(c.action)).reduce((s, c) => s + c.allConversions, 0);
  const cost = d.campaigns.reduce((s, c) => s + c.cost, 0);
  const chats = Math.round(sum(CHAT_ACTIONS));
  const calls = Math.round(sum(CALL_ACTIONS));
  const contacts = chats + calls + d.ga4.whatsapp.ads + d.ga4.phone.ads;
  const per = (n: number) => (n ? Math.round(cost / n) : null);
  return {
    cost,
    clicks: d.campaigns.reduce((s, c) => s + c.clicks, 0),
    chats,
    calls,
    waWeb: d.ga4.whatsapp.ads,
    phoneWeb: d.ga4.phone.ads,
    webTracked: d.ga4.whatsapp.all + d.ga4.phone.all > 0,
    adsContacts: chats + calls,
    contacts,
    perContact: per(contacts),
    perAdsContact: per(chats + calls),
    bookings: d.ga4.purchase.ads,
    bookingValue: d.ga4.value.ads,
  };
}

const rp = (v: number | null): string => (v === null ? "-" : `Rp${Math.round(v).toLocaleString("id-ID")}`);
const delta = (a: number, b: number): string => (b === 0 ? (a === 0 ? "=" : "baru") : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`);

export function formatMonthlyReport(current: PeriodData, previous: PeriodData, complete: boolean): string {
  const a = totals(current);
  const b = totals(previous);
  const p = (x: Period) => `${x.since} s/d ${x.until}`;
  const row = (label: string, x: number, y: number, money = false) => `| ${label} | ${money ? rp(x) : x} | ${money ? rp(y) : y} | ${delta(x, y)} |`;
  const web = (label: string, x: number, y: number) => `| ${label} | ${a.webTracked ? x : "belum terlacak"} | ${b.webTracked ? y : "belum terlacak"} | ${a.webTracked && b.webTracked ? delta(x, y) : "-"} |`;
  const perRow = (label: string, x: number | null, y: number | null, comparable = true) => `| ${label} | ${rp(x)} | ${rp(y)} | ${comparable && x && y ? delta(x, y) : "-"} |`;
  const same = a.webTracked === b.webTracked;
  const lines = [
    `# Laporan kontak WhatsApp Sanghyang, ${p(current.period)}${complete ? "" : " (bulan berjalan)"}`,
    "",
    `Pembanding: ${p(previous.period)}. Sumber: Google Ads API 793-128-8995 dan GA4 216046044 (baca-saja).`,
    "",
    "| | Periode ini | Pembanding | Perubahan |",
    "|---|---|---|---|",
    row("Biaya iklan", a.cost, b.cost, true),
    row("Klik iklan", a.clicks, b.clicks),
    row("Chat WA dari iklan (Google)", a.chats, b.chats),
    row("Telepon dari iklan (Google)", a.calls, b.calls),
    row("**Kontak Google (chat + telepon)**", a.adsContacts, b.adsContacts),
    perRow("**Biaya per kontak Google**", a.perAdsContact, b.perAdsContact),
    web("Klik WA di website dari iklan (GA4)", a.waWeb, b.waWeb),
    web("Klik telepon di website dari iklan (GA4)", a.phoneWeb, b.phoneWeb),
    `| Total kontak (Google + website) | ${a.contacts} | ${b.contacts} | ${same ? delta(a.contacts, b.contacts) : "- (definisi beda)"} |`,
    perRow("Biaya per kontak total", a.perContact, b.perContact, same),
    row("Booking website dari iklan (GA4)", a.bookings, b.bookings),
    row("Nilai booking dari iklan (GA4)", a.bookingValue, b.bookingValue, true),
    "",
    `Semua sumber (GA4): klik WA ${current.ga4.whatsapp.all}, klik telepon ${current.ga4.phone.all}, booking website ${current.ga4.purchase.all} senilai ${rp(current.ga4.value.all)}.`,
    "",
    "## Per campaign (periode ini)",
    "",
    "| Campaign | Status | Biaya | Klik | Chat WA | Telepon |",
    "|---|---|---|---|---|---|",
  ];
  for (const c of current.campaigns.filter((x) => x.cost > 0 || x.status === "ENABLED")) {
    const of = (names: Set<string>) => Math.round(current.conversions.filter((k) => k.campaign === c.name && names.has(k.action)).reduce((s, k) => s + k.allConversions, 0));
    lines.push(`| ${c.name} | ${c.status} | ${rp(c.cost)} | ${c.clicks} | ${of(CHAT_ACTIONS)} | ${of(CALL_ACTIONS)} |`);
  }
  lines.push(
    "",
    "## Batas data",
    "",
    "- Kontak = chat WA + telepon dari iklan (Google Ads) + klik WA/telepon di website dari sesi iklan (GA4). Klik website diambil dari GA4 saja supaya tidak dihitung dua kali dengan impor GA4 di Google Ads.",
    "- Klik WA = tombol ditekan, belum tentu pesan terkirim. \"Belum terlacak\" = GA4 tidak mencatat klik WA/telepon dari sumber mana pun pada periode itu (tombol belum dilacak); total kontak tidak dibandingkan bila definisinya beda.",
    "- Konversi Google Ads dicatat pada tanggal klik; beberapa hari terakhir masih bisa bertambah.",
    "- MISSING: booking yang masuk lewat WA/telepon lalu dicatat di Exely tidak kembali ke Google Ads maupun GA4.",
  );
  return lines.join("\n");
}

export async function loadPeriod(ads: GoogleAdsClient, env: Record<string, string | undefined>, period: Period, fetchImpl: typeof fetch = fetch): Promise<PeriodData> {
  const [campaigns, conversions, ga4] = await Promise.all([
    campaignReport(ads, period.since, period.until),
    conversionsByAction(ads, period.since, period.until),
    ga4Summary(env, period.since, period.until, fetchImpl),
  ]);
  return { period, campaigns, conversions, ga4 };
}
