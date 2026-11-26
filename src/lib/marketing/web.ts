// Google Ads + GA4 pages inside Sanghyang Analytics. The pages keep
// the old dashboard's HTML, which was checked number by number against the Google APIs (83/83, 60/60),
// and are served under /marketing/* after login. Read-only: nothing here changes the Google Ads account.
import "server-only";
import { cache } from "react";
import { currentUser } from "@/lib/auth/role";
import { invalidateTags, withCache, withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL, INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { loadPromoAudits, type PromoAuditItem } from "./social-promo.ts";
import { REMINDERS_FILE } from "./config.ts";
import { reminderLines } from "./google-ads-daily.ts";
import { GoogleAdsClient, googleAdsSettingsFromEnv } from "./google-ads.ts";
import { todayIn } from "./metrics.ts";
import { pageSources, renderSanghyangPage } from "./overview.ts";
import { averageWeek, hotelPeriods, vhpSection } from "./vhp-week.ts";
import { rangeText } from "@/lib/format-date";
import { lastVhpDay, loadHotelRooms, loadVhpWeeks } from "./vhp-load.ts";
import { campaignImpact, impactMonths } from "./campaign-impact.ts";
import { monthPeriods } from "./monthly-analysis.ts";
import { adsBalance, type AdsBalance, campaignReport, monthlyCampaigns, networkReport } from "./google-ads.ts";
import { addDays } from "./metrics.ts";
import { googleNumbers, googleWeeklyReport, loadGoogleWeek, type Period, renderReports, type WeeklyReport } from "./weekly-report.ts";
import { addAdsExtras, bookingForm, type ReportQuery, reportPeriods, reportPicker, type WaImportInfo, type WaPeriod } from "./ads-report.ts";
import { bookingsIn, parseWaBookings, type WaNight, waNightsIn } from "./wa-bookings.ts";
import { createClient } from "@/lib/supabase/server";

const TZ = "Asia/Jakarta";
let client: GoogleAdsClient | null = null;
// Settings are read on first use, so a missing key shows inside the page instead of breaking the app.
const ads = () => (client ??= new GoogleAdsClient(googleAdsSettingsFromEnv(process.env)));
const pages = pageSources({ googleAds: ads, env: process.env });

/**
 * Google Ads + GA4 data is the resort's (MARKETING_PROPERTY_ID). Sanghyang Analytics can hold several properties, so a
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

/** The old dashboard linked to /sanghyang and /laporan; inside Sanghyang Analytics they live under /marketing. */
export function underMarketing(html: string): string {
  return html.replace(/(href|src|action)="\/(sanghyang|laporan)/g, '$1="/marketing/$2');
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
 * Google Ads + GA4, with campaign functions, click sources and WhatsApp bookings from CS's file.
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
  const propertyId = me?.propertyId ?? process.env.MARKETING_PROPERTY_ID?.trim() ?? "";
  // The last import is part of the key: a file CS just imported shows at once, on every server.
  const waInfo = propertyId ? await waImportInfo(propertyId).catch(() => undefined) : undefined;
  if (q.refresh === "1") {
    return buildReportPage(q, periods, problem, propertyId, waInfo);
  }
  const cacheProp = propertyId || "unknown";
  const keyParts = [
    "marketing-weekly-report",
    cacheProp,
    periods.mode,
    periods.current.since,
    periods.current.until,
    periods.previous.since,
    periods.previous.until,
    problem,
    waInfo === undefined ? "unreadable" : JSON.stringify(waInfo),
  ];
  return withCache(() => buildReportPage(q, periods, problem, propertyId, waInfo), keyParts, {
    tags: [
      CACHE_TAGS.marketingAds(cacheProp),
      CACHE_TAGS.vhpSales(cacheProp),
      CACHE_TAGS.whatsappChats(cacheProp),
      CACHE_TAGS.waBookings(cacheProp),
    ],
    revalidate: CACHE_TTL.marketingAds,
  });
}

async function buildReportPage(
  q: ReportQuery & { refresh?: string },
  periods: ReturnType<typeof reportPeriods>,
  problem: string,
  propertyId: string,
  waInfo: WaImportInfo | null | undefined,
): Promise<string> {
  const c = ads();
  const softly = <T,>(job: Promise<T>) => job.catch(() => null);
  const [curr, prev, netCurr, netPrev, wa] = await Promise.all([
    loadGoogleWeek(c, process.env, periods.current),
    loadGoogleWeek(c, process.env, periods.previous),
    softly(networkReport(c, periods.current.since, periods.current.until)),
    softly(networkReport(c, periods.previous.since, periods.previous.until)),
    waInfo === undefined || !propertyId ? null : waPeriods(propertyId, periods.current, periods.previous, waInfo).catch(() => null),
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
    wa,
    google: { chats: a.chats, webClicks: a.webTracked ? a.web : null, cost: a.cost, prevCost: b.cost, perContact: a.perContact, prevPerContact: b.perContact, comparable: a.webTracked === b.webTracked },
  });
  // Whether room revenue went up decides the comparison: it opens the conclusions (owner, 24 Nov).
  if (roomVerdict) report.highlights.unshift(roomVerdict);
  if (periods.mode === "bulan") await addImpact(report, q.refresh === "1");
  const notice = problem ? `<p style="color:#C62F1D;font-weight:600;margin:0">Pilihan tadi tidak bisa dipakai: ${escapeHtml(problem)}. Ditampilkan pilihan bawaan.</p>` : "";
  return underMarketing(renderReports([report], new Date(), { toolbar: true, picker: notice + reportPicker(q, periods) + (waInfo === undefined ? "" : bookingForm(periods, waInfo)), title: `${report.title} · ${periods.current.since}` }));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Largest file accepted: CS's list is a few kilobytes. */
const MAX_BOOKING_FILE = 2 * 1024 * 1024;

/**
 * Imports CS's file BOOKING BY WA (owner, 25 Nov 2026). Only row number, check-in, check-out and rooms are kept;
 * names and WhatsApp numbers are never read into the database. Returns null when saved, else the reason.
 */
export async function importWaBookings(form: FormData): Promise<string | null> {
  const me = await currentUser();
  if (!me?.propertyId) return "Silakan login.";
  const file = form.get("booking");
  if (!(file instanceof File) || file.size === 0) return "Pilih file BOOKING BY WA dulu.";
  if (file.size > MAX_BOOKING_FILE) return "File terlalu besar untuk daftar booking (maksimal 2 MB).";
  if (!/\.xlsx$/i.test(file.name)) return "File harus Excel (.xlsx), seperti BOOKING BY WA.xlsx.";
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(await file.arrayBuffer());
  } catch {
    return "File tidak bisa dibuka sebagai Excel.";
  }
  const sheet = book.worksheets[0];
  if (!sheet) return "File tidak punya sheet.";
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const v = cell.value as unknown;
      values[col - 1] = v && typeof v === "object" && !(v instanceof Date) && "result" in (v as object) ? (v as { result: unknown }).result : v;
    });
    rows.push(values);
  });
  const parsed = parseWaBookings(rows);
  if (parsed.problems.length) return `File belum bisa diimport. ${parsed.problems.slice(0, 5).join(" ")}${parsed.problems.length > 5 ? ` (dan ${parsed.problems.length - 5} lagi)` : ""}`;
  if (parsed.bookings.length === 0) return "File tidak berisi booking.";
  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_wa_bookings", { p_rows: parsed.bookings });
  if (error) return `Gagal menyimpan: ${error.message}`;
  invalidateTags(INVALIDATION_GROUPS.forWhatsappChatMutation(me.propertyId));
  return null;
}

/** The last import of CS's booking file, or null when it was never imported, cached per propertyId. */
const waImportInfo = cache(async (propertyId: string): Promise<WaImportInfo | null> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["marketing-wa-import-info"],
    tags: [CACHE_TAGS.waBookings(propertyId), CACHE_TAGS.whatsappChats(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("wa_bookings")
        .select("imported_at, check_in")
        .eq("property_id", propertyId)
        .order("check_in", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { imported_at: string; check_in: string }[];
      if (rows.length === 0) return null;
      return {
        importedAt: rows.reduce((m, r) => (r.imported_at > m ? r.imported_at : m), rows[0].imported_at),
        count: rows.length,
        firstCheckIn: rows[0].check_in,
        lastCheckIn: rows.at(-1)!.check_in,
      };
    },
  }),
);

/** When CS's booking file was last imported (null: never), for the notification bell. */
export async function lastWaImport(): Promise<string | null> {
  const me = await currentUser();
  if (!me?.propertyId) return null;
  return (await waImportInfo(me.propertyId))?.importedAt ?? null;
}

/** Closings and WA room nights of both report periods, cached per propertyId without calling cookies() inside unstable_cache. */
async function waPeriods(
  propertyId: string,
  curr: Period,
  prev: Period,
  info: WaImportInfo | null,
): Promise<{ importedAt: string | null; curr: WaPeriod; prev: WaPeriod }> {
  const none: WaPeriod = { closing: 0, nights: 0, revenue: 0, bySegment: {}, missing: [] };
  if (!info) return { importedAt: null, curr: none, prev: none };
  const from = prev.since < curr.since ? prev.since : curr.since;
  const to = prev.until > curr.until ? prev.until : curr.until;
  const [waData, last] = await Promise.all([
    withPropertySupabaseCache({
      propertyId,
      keyParts: ["marketing-wa-raw", from, to, info.importedAt],
      tags: [CACHE_TAGS.waBookings(propertyId), CACHE_TAGS.whatsappChats(propertyId), CACHE_TAGS.vhpSales(propertyId)],
      revalidate: CACHE_TTL.vhp,
      query: async (supabase) => {
        const [bookings, nights] = await Promise.all([
          supabase
            .from("wa_bookings")
            .select("check_in")
            .eq("property_id", propertyId)
            .gte("check_in", from)
            .lte("check_in", to),
          supabase.rpc("wa_booking_nights", { p_property: propertyId, p_from: from, p_to: to }),
        ]);
        if (bookings.error) throw new Error(bookings.error.message);
        if (nights.error) throw new Error(nights.error.message);
        return {
          list: ((bookings.data ?? []) as { check_in: string }[]).map((b) => ({ checkIn: b.check_in })),
          rows: (
            (nights.data ?? []) as { row_no: number | null; night: string; room: string; lodging: unknown; segment: string | null }[]
          ).map(
            (n): WaNight => ({
              row_no: n.row_no,
              night: n.night,
              room: n.room,
              lodging: n.lodging === null ? null : Number(n.lodging),
              segment: n.segment,
            }),
          ),
        };
      },
    }),
    lastVhpDay(propertyId),
  ]);
  const of = (p: Period): WaPeriod => ({ closing: bookingsIn(waData.list, p), ...waNightsIn(waData.rows, p, last) });
  return { importedAt: info.importedAt, curr: of(curr), prev: of(prev) };
}

/**
 * Laporan Senin: the resort's side (VHP room revenue per segment, check-ins) next to the Google Ads
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
    // Ad cost of the same days as the resort figures, for "Biaya Google Ads" of the resort part.
    const cost = async (p: Period, whole: number) => (h.cut ? (await campaignReport(ads(), p.since, p.until)).reduce((t, c) => t + c.cost, 0) : whole);
    const [costA, costB] = await Promise.all([cost(h.curr, a.cost), cost(h.prev, b.cost)]);
    const s = vhpSection(vhp.curr, vhp.prev, averageWeek(vhp.range), {
      curr: { cost: costA },
      prev: { cost: costB },
    });
    if (h.cut) {
      s.group.source = `Data VHP · ${rangeText(h.curr.since, h.curr.until)} dibanding ${rangeText(h.prev.since, h.prev.until)}`;
      report.limits.push(`Tamu resort dihitung ${rangeText(h.curr.since, h.curr.until)} dibanding ${rangeText(h.prev.since, h.prev.until)}, karena data VHP baru sampai ${rangeText(h.curr.until, h.curr.until)}. Kolom tanggal di atas berlaku untuk angka iklan.`);
    }
    report.groups.push(s.group);
    report.details.unshift(s.detail);
    report.limits.push(...s.limits);
    return s.verdict;
  } catch (error) {
    report.limits.push(`Data resort (VHP) tidak bisa dibaca: ${(error as Error).message}`);
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
