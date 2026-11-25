// Google Ads + GA4 pages inside Sanghyang Analytics. The pages keep
// the old dashboard's HTML, which was checked number by number against the Google APIs (83/83, 60/60),
// and are served under /marketing/* after login. Read-only: nothing here changes the Google Ads account.
import "server-only";
import { cache } from "react";
import { currentUser } from "@/lib/auth/role";
import { invalidateTags, withCache, withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL, INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { readFileSync } from "node:fs";
import { loadPromoAudits, type PromoAuditItem } from "./social-promo.ts";
import { REMINDERS_FILE, SOCIAL_ACCOUNTS_FILE, SOSMED_ROOT } from "./config.ts";
import { reminderLines } from "./google-ads-daily.ts";
import { GoogleAdsClient, googleAdsSettingsFromEnv } from "./google-ads.ts";
import { todayIn } from "./metrics.ts";
import { pageSources, renderSanghyangPage, renderSosmedPage, sosmedImagePath } from "./overview.ts";
import { averageWeek, hotelPeriods, vhpSection } from "./vhp-week.ts";
import { rangeText } from "@/lib/format-date";
import { lastVhpDay, loadHotelRooms, loadVhpWeeks } from "./vhp-load.ts";
import { campaignImpact, impactMonths } from "./campaign-impact.ts";
import { monthPeriods } from "./monthly-analysis.ts";
import { adsBalance, type AdsBalance, campaignReport, monthlyCampaigns, networkReport } from "./google-ads.ts";
import { addDays } from "./metrics.ts";
import { googleNumbers, googleWeeklyReport, loadGoogleWeek, type Period, renderReports, type WeeklyReport, weekPeriods } from "./weekly-report.ts";
import { addAdsExtras, type ChatEntry, chatForm, chatsInPeriod, type ReportQuery, reportPeriods, reportPicker } from "./ads-report.ts";
import { parseChatCount } from "./chat-counts.ts";
import { createClient } from "@/lib/supabase/server";

const TZ = "Asia/Jakarta";
let client: GoogleAdsClient | null = null;
// Settings are read on first use, so a missing key shows inside the page instead of breaking the app.
const ads = () => (client ??= new GoogleAdsClient(googleAdsSettingsFromEnv(process.env)));
const pages = pageSources({ googleAds: ads, env: process.env, accountsFile: SOCIAL_ACCOUNTS_FILE, sosmedRoot: SOSMED_ROOT });

/**
 * Google Ads + GA4 data is the hotel's (MARKETING_PROPERTY_ID). Sanghyang Analytics can hold several properties, so a
 * session alone is not enough: the user must belong to that property. Fails closed when unset.
 * Returns a refusal response, or null when access is allowed.
 */
export async function marketingAccess(): Promise<Response | null> {
  const me = await currentUser();
  if (!me) return new Response("Silakan login.", { status: 401 });
  const owner = process.env.MARKETING_PROPERTY_ID?.trim();
  if (!owner) return new Response("Marketing belum diatur (MARKETING_PROPERTY_ID).", { status: 403 });
  if (me.propertyId !== owner) return new Response("Tidak ada akses ke Marketing properti ini.", { status: 403 });
  return null;
}

/** The old dashboard linked to /sanghyang, /sosmed, /laporan; inside Sanghyang Analytics they live under /marketing. */
export function underMarketing(html: string): string {
  return html.replace(/(href|src|action)="\/(sanghyang|sosmed|laporan)/g, '$1="/marketing/$2');
}

export const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  // Shown in an iframe of the Sanghyang Analytics Marketing page: only this app itself may frame it.
  "content-security-policy": "frame-ancestors 'self'; form-action 'self'",
  "x-frame-options": "SAMEORIGIN",
};

export async function sanghyangPage(refresh: boolean): Promise<string> {
  return underMarketing(renderSanghyangPage(await pages.sanghyang(refresh), reminderLines(todayIn(TZ), REMINDERS_FILE)));
}

export async function sosmedPage(refresh: boolean): Promise<string> {
  return underMarketing(renderSosmedPage(await pages.sosmed(refresh)));
}

/** Audit promo outlet di-cache per properti di Next.js Data Cache dan diinvalidasi saat tarik/abaikan promo atau upload VHP. */
export const loadPromoAuditsCached = cache(
  async (propertyId: string): Promise<{ audits: PromoAuditItem[]; problem: string | null; dataUntil: string | null }> =>
    withPropertySupabaseCache({
      propertyId,
      keyParts: ["marketing-promo-audits"],
      tags: [CACHE_TAGS.socialPromos(propertyId), CACHE_TAGS.vhpSales(propertyId)],
      revalidate: CACHE_TTL.vhp,
      query: (supabase) => loadPromoAudits(supabase, propertyId),
    }),
);

/**
 * Marketing → Google Ads → Laporan: per minggu, per bulan (same number of days) or bebas (A vs B), live from
 * Google Ads + GA4, with campaign functions, click sources and the WhatsApp chats CS counted.
 */
export async function weeklyReportPage(q: ReportQuery & { refresh?: string }): Promise<string> {
  let periods: ReturnType<typeof reportPeriods>;
  let problem = "";
  try {
    periods = reportPeriods(q);
  } catch (error) {
    // A wrong choice keeps the picker on screen with the reason, instead of a bare error page.
    problem = (error as Error).message;
    q = { mode: q.mode };
    periods = reportPeriods(q);
  }
  // The report holds one property's data: resolve propertyId outside unstable_cache.
  const me = await currentUser();
  const propertyId = me?.propertyId ?? process.env.MARKETING_PROPERTY_ID?.trim() ?? "unknown";
  // The chat counts are part of the key: a number CS just saved shows at once, on every server.
  const earliest = periods.previous.since < periods.current.since ? periods.previous.since : periods.current.since;
  const chatRows = me?.propertyId ? await chatEntries(me.propertyId, earliest).catch(() => null) : null;
  if (q.refresh === "1") {
    return buildReportPage(q, periods, problem, chatRows);
  }
  const keyParts = [
    "marketing-weekly-report",
    propertyId,
    periods.mode,
    periods.current.since,
    periods.current.until,
    periods.previous.since,
    periods.previous.until,
    problem,
    JSON.stringify(chatRows ?? []),
  ];
  return withCache(() => buildReportPage(q, periods, problem, chatRows), keyParts, {
    tags: [
      CACHE_TAGS.marketingAds(propertyId),
      CACHE_TAGS.vhpSales(propertyId),
      CACHE_TAGS.whatsappChats(propertyId),
    ],
    revalidate: CACHE_TTL.marketingAds,
  });
}

async function buildReportPage(q: ReportQuery & { refresh?: string }, periods: ReturnType<typeof reportPeriods>, problem: string, chatRows: ChatEntry[] | null): Promise<string> {
  const c = ads();
  const softly = <T,>(job: Promise<T>) => job.catch(() => null);
  const [curr, prev, netCurr, netPrev] = await Promise.all([
    loadGoogleWeek(c, process.env, periods.current),
    loadGoogleWeek(c, process.env, periods.previous),
    softly(networkReport(c, periods.current.since, periods.current.until)),
    softly(networkReport(c, periods.previous.since, periods.previous.until)),
  ]);
  const report = googleWeeklyReport(curr, prev);
  const roomVerdict = await addHotelResults(report, curr, prev);
  const a = googleNumbers(curr);
  const b = googleNumbers(prev);
  addAdsExtras(report, {
    periods,
    campaigns: curr.campaigns,
    conversions: curr.conversions,
    networks: { curr: netCurr, prev: netPrev },
    chats: chatRows ? { curr: chatsInPeriod(chatRows, periods.current), prev: chatsInPeriod(chatRows, periods.previous) } : null,
    google: { chats: a.chats, webClicks: a.webTracked ? a.web : null, cost: a.cost, prevCost: b.cost, perContact: a.perContact, prevPerContact: b.perContact, comparable: a.webTracked === b.webTracked },
  });
  // Whether room revenue went up decides the comparison: it opens the conclusions (owner, 24 Nov).
  if (roomVerdict) report.highlights.unshift(roomVerdict);
  if (periods.mode === "bulan") await addImpact(report, q.refresh === "1");
  const notice = problem ? `<p style="color:#C62F1D;font-weight:600;margin:0">Pilihan tadi tidak bisa dipakai: ${escapeHtml(problem)}. Ditampilkan pilihan bawaan.</p>` : "";
  return underMarketing(renderReports([report], new Date(), { toolbar: true, picker: notice + reportPicker(q, periods) + chatForm(periods, chatRows), title: `${report.title} · ${periods.current.since}` }));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Saves the number CS typed above the report (same period again = replaced). Null = saved, else the reason. */
export async function saveChats(form: FormData): Promise<string | null> {
  const me = await currentUser();
  if (!me?.propertyId) return "Silakan login.";
  const parsed = parseChatCount(form, todayIn(TZ));
  if ("error" in parsed) return parsed.error;
  const c = parsed.ok;
  const supabase = await createClient();
  const { error } = await supabase.from("whatsapp_chat_counts").upsert(
    { property_id: me.propertyId, date_from: c.from, date_to: c.to, chats_closing: c.closing, chats_total: c.total, updated_at: new Date().toISOString(), updated_by: me.id },
    { onConflict: "property_id,date_from,date_to" },
  );
  if (error) return `Gagal menyimpan: ${error.message}`;
  invalidateTags(INVALIDATION_GROUPS.forWhatsappChatMutation(me.propertyId));
  return null;
}

/** CS's WhatsApp chat counts (filled above the report) from `since` on, cached per propertyId. */
const chatEntries = cache(async (propertyId: string, since: string): Promise<ChatEntry[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["marketing-wa-chats", since],
    tags: [CACHE_TAGS.whatsappChats(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("whatsapp_chat_counts")
        .select("date_from, date_to, chats_total, chats_from_ads, chats_closing")
        .eq("property_id", propertyId)
        .gte("date_from", since);
      if (error) throw new Error(error.message);
      return (data ?? []) as ChatEntry[];
    },
  }),
);

/** The last finished Monday–Sunday week when CS has not filled its chat count yet, else null. */
export async function openChatWeek(): Promise<{ since: string; until: string } | null> {
  const me = await currentUser();
  if (!me?.propertyId) return null;
  const week = weekPeriods(undefined, new Date(), TZ).current;
  return chatsInPeriod(await chatEntries(me.propertyId, week.since), week).closing === null ? week : null;
}

/**
 * Laporan Senin: the hotel's side (VHP room revenue per segment, check-ins) next to the Google Ads
 * cost and contacts of the same weeks. A failure here leaves the Google part intact and says why.
 */
async function addHotelResults(report: WeeklyReport, curr: Awaited<ReturnType<typeof loadGoogleWeek>>, prev: Awaited<ReturnType<typeof loadGoogleWeek>>): Promise<string | null> {
  const propertyId = process.env.MARKETING_PROPERTY_ID?.trim();
  if (!propertyId) return null; // marketingAccess() already refused the request
  try {
    // VHP data can stop inside the period (pulled up to yesterday): compare the same days on both sides.
    const h = hotelPeriods(curr.period, prev.period, await lastVhpDay(propertyId));
    const vhp = await loadVhpWeeks(propertyId, h.curr, h.prev);
    const a = googleNumbers(curr);
    const b = googleNumbers(prev);
    // Ad cost of the same days as the hotel figures, for "Biaya Google Ads" of the hotel part.
    const cost = async (p: Period, whole: number) => (h.cut ? (await campaignReport(ads(), p.since, p.until)).reduce((t, c) => t + c.cost, 0) : whole);
    const [costA, costB] = await Promise.all([cost(h.curr, a.cost), cost(h.prev, b.cost)]);
    const s = vhpSection(vhp.curr, vhp.prev, averageWeek(vhp.range), {
      curr: { cost: costA },
      prev: { cost: costB },
    });
    if (h.cut) {
      s.group.source = `Data VHP · ${rangeText(h.curr.since, h.curr.until)} dibanding ${rangeText(h.prev.since, h.prev.until)}`;
      report.limits.push(`Tamu hotel dihitung ${rangeText(h.curr.since, h.curr.until)} dibanding ${rangeText(h.prev.since, h.prev.until)}, karena data VHP baru sampai ${rangeText(h.curr.until, h.curr.until)}. Kolom tanggal di atas berlaku untuk angka iklan.`);
    }
    report.groups.push(s.group);
    report.details.unshift(s.detail);
    report.limits.push(...s.limits);
    return s.verdict;
  } catch (error) {
    report.limits.push(`Data hotel (VHP) tidak bisa dibaca: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Laporan per bulan: every campaign next to room revenue FIT / WALK IN / OTA since January 2026 (owner,
 * 24 Nov). A source that cannot be read is said in the limits and leaves the rest of the report intact.
 */
async function addImpact(report: WeeklyReport, refresh: boolean) {
  const propertyId = process.env.MARKETING_PROPERTY_ID?.trim();
  if (!propertyId) return; // marketingAccess() already refused the request
  try {
    const last = await lastVhpDay(propertyId);
    const slots = monthPeriods("2026-01", todayIn(TZ), last).filter((s) => s.hotel);
    if (slots.length === 0) return;
    const untilKey = slots.at(-1)!.period.until;
    const loadImpact = async () => {
      const [google, hotel] = await Promise.all([
        monthlyCampaigns(ads(), slots[0].period.since, untilKey),
        loadHotelRooms(propertyId, slots),
      ]);
      return campaignImpact(impactMonths(slots, google, hotel));
    };
    const data = refresh
      ? await loadImpact()
      : await withCache(loadImpact, ["marketing-campaign-impact", propertyId, untilKey], {
          tags: [CACHE_TAGS.marketingAds(propertyId), CACHE_TAGS.vhpSales(propertyId)],
          revalidate: CACHE_TTL.marketingImpact,
        });
    report.details.unshift(...data.tables);
  } catch (error) {
    report.limits.push(`Iklan dan revenue kamar per bulan tidak bisa dibaca: ${(error as Error).message}`);
  }
}

/** Sisa saldo iklan Google for the Marketing page; null balance = the account has no prepaid budget to read. */
export async function adsBalanceData(): Promise<{ balance: AdsBalance | null; at: string } | { error: string }> {
  const today = todayIn(TZ);
  const propertyId = process.env.MARKETING_PROPERTY_ID?.trim() || "default";
  try {
    return await withCache(
      async () => ({
        balance: await adsBalance(ads(), addDays(today, -7), addDays(today, -1)),
        at: new Date().toISOString(),
      }),
      ["marketing-ads-balance", propertyId, today],
      {
        tags: [CACHE_TAGS.marketingAds(propertyId)],
        revalidate: CACHE_TTL.marketingAds,
      },
    );
  } catch (error) {
    return { error: `Saldo iklan tidak bisa dibaca dari Google Ads: ${(error as Error).message}` };
  }
}

/** A promotion picture from docs/marketing/sanghyang-sosmed, or null (path checked by sosmedImagePath). */
export function sosmedImage(rel: string): { body: Buffer; type: string } | null {
  const file = sosmedImagePath(SOSMED_ROOT, rel);
  if (!file) return null;
  const type = /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg";
  return { body: readFileSync(file), type };
}
