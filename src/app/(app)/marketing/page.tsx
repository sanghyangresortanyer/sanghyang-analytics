import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingFilterBar } from "@/components/marketing/marketing-filter-bar";
import { InsightPasarView, type InsightSubTab } from "@/components/marketing/insight-pasar-view";
import { MediaSosialView } from "@/components/marketing/media-sosial-view";
import { StrategyView, type StrategySubTab } from "@/components/marketing/strategy-view";
import { currentUser } from "@/lib/auth/role";
import { rangeText, todayISO } from "@/lib/format-date";
import { legacyMarketingHref } from "@/lib/marketing/marketing-nav";
import { OUTLET_TABS, type OutletChoice } from "@/lib/marketing/market-intelligence-types";
import { PageHeader, SkeuoCard } from "@/components/skeuo/ui";
import { adsBalanceData, loadPromoAuditsCached, marketingAccess } from "@/lib/marketing/web";
import { dayLabel } from "@/lib/marketing/ads-report";
import { addDays } from "@/lib/marketing/metrics";
import { cn } from "@/lib/utils";

export const metadata = { title: "Marketing — Sanghyang Analytics" };
export const dynamic = "force-dynamic";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const SECTIONS = [
  { id: "google", label: "Google Ads" },
  { id: "meta", label: "Meta Ads" },
  { id: "insight-pasar", label: "Insight Pasar" },
  { id: "media-sosial", label: "Media Sosial" },
  { id: "strategy", label: "Strategy" },
] as const;

// One Google Ads report (owner, 24 Nov: "mending dibuat 1 saja"): it opens per week and its "Bandingkan"
// picks per day, week, month or free dates. Old links with lihat=harian still open the daily view.
const REPORT = { minggu: "/marketing/laporan", hari: "/marketing/laporan?mode=hari" } as const;

const INSIGHT_VIEWS: readonly { id: InsightSubTab; label: string }[] = [
  { id: "ringkasan", label: "Ringkasan" },
  { id: "kata-tamu", label: "Kata Tamu" },
  { id: "kompetitor", label: "Kompetitor" },
  { id: "harga", label: "Harga" },
  { id: "promo", label: "Promo & Event" },
  { id: "langkah", label: "Langkah & Berita" },
] as const;

const MEDIA_SOSIAL_VIEWS: readonly { id: OutletChoice; label: string }[] = OUTLET_TABS.map((t) => ({
  id: t.key,
  label: t.label,
}));

const STRATEGY_VIEWS: readonly { id: StrategySubTab; label: string }[] = [
  { id: "semua", label: "Semua Strategy" },
  { id: "rekomendasi", label: "Rekomendasi Pemasaran" },
  { id: "radar", label: "Radar Promo & Draf Konten" },
] as const;

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

/** Sisa saldo iklan Google above the Google Ads tabs (owner, 23 Nov). Amber when it lasts a week or less. */
async function AdsBalanceLine() {
  const data = await adsBalanceData();
  if ("error" in data) return <p className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">{data.error}</p>;
  const b = data.balance;
  if (!b) return <p className="rounded-xl bg-cream-100 px-4 py-3 text-base text-navy-700">Sisa saldo iklan: Belum ada data (akun tidak memakai saldo prabayar).</p>;
  const low = b.daysLeft !== null && b.daysLeft <= 7;
  // Owner, 23 Nov: say on which day the money runs out and the last day to top up.
  const today = todayISO();
  const runsOut = b.daysLeft !== null ? addDays(today, b.daysLeft) : null;
  const at = new Date(data.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className={cn("rounded-xl px-4 py-3 text-base", low ? "bg-amber-50 text-amber-900" : "bg-cream-100 text-navy-800")}>
      <p>
        <span className="font-semibold">Sisa saldo iklan Google: {rupiah(b.remaining)}</span>
        {b.daysLeft !== null && (
          <>
            {" "}
            · cukup ±{b.daysLeft} hari dengan biaya rata-rata {rupiah(b.avgDaily7)}/hari ({rangeText(b.since7, b.until7)})
          </>
        )}
        {runsOut && (
          <span className="font-semibold">
            {" "}
            · habis sekitar {dayLabel(runsOut)} · isi saldo paling lambat {dayLabel(addDays(runsOut, -1))}
          </span>
        )}
        {low && <span className="font-semibold"> · perlu isi saldo</span>}
      </p>
      <p className="text-sm opacity-80">
        Perkiraan dari Google Ads {at} WIB (sama dengan &quot;Dana yang tersedia&quot; di Penagihan, selisih beberapa ribu karena jeda pencatatan biaya).
      </p>
    </div>
  );
}

type Section = (typeof SECTIONS)[number]["id"];

function Tabs<T extends string>({ items, current, href, small }: { items: readonly { id: T; label: string }[]; current: T; href: (id: T) => string; small?: boolean }) {
  return (
    <nav className="skeuo-inset flex flex-wrap gap-1 p-1" aria-label={small ? "Sub-bagian" : "Bagian Marketing"}>
      {items.map((t) => (
        <Link
          key={t.id}
          // No prefetch: each prefetch is one more signed-in request (and Google call) fired at once.
          prefetch={false}
          href={href(t.id)}
          aria-current={t.id === current ? "page" : undefined}
          className={cn("rounded-full font-semibold", small ? "px-4 py-1.5 text-sm" : "px-5 py-2 text-base", t.id === current ? "skeuo-pill-dark" : "text-navy-600 hover:text-navy-900")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const Frame = ({ src, title }: { src: string; title: string }) => (
  <iframe src={src} title={title} className="h-[calc(100vh-14rem)] min-h-[600px] w-full rounded-xl border border-cream-300 bg-white" />
);

function buildMarketingHref(
  base: { bagian: Section; lihat?: string; outlet?: string },
  range: { isCustomRange: boolean; startDate: string; endDate: string },
): string {
  const params = new URLSearchParams();
  params.set("bagian", base.bagian);
  if (base.lihat) params.set("lihat", base.lihat);
  if (base.outlet) params.set("outlet", base.outlet);
  if (range.isCustomRange) {
    params.set("startDate", range.startDate);
    params.set("endDate", range.endDate);
  }
  return `/marketing?${params.toString()}`;
}

function googleReportSrc(lihat: string | undefined, isCustomRange: boolean, startDate: string, endDate: string): string {
  if (isCustomRange) {
    if (startDate === endDate) return `/marketing/laporan?mode=hari&hari=${encodeURIComponent(startDate)}`;
    return `/marketing/laporan?mode=bebas&since=${encodeURIComponent(startDate)}&until=${encodeURIComponent(endDate)}`;
  }
  return lihat === "harian" ? REPORT.hari : REPORT.minggu;
}

/** Marketing terpadu Sanghyang Analytics: satu laporan Google Ads, Meta Ads, Insight Pasar, Media Sosial (termasuk audit promo outlet), dan Strategy. */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ bagian?: string; lihat?: string; outlet?: string; startDate?: string; endDate?: string; refresh?: string }>;
}) {
  const refused = await marketingAccess();
  if (refused) return <p className="rounded-xl border border-cream-300 bg-white p-6 text-base text-navy-700">{await refused.text()}</p>;
  const q = await searchParams;
  // The Sosmed Sanghyang tab was merged into Media Sosial (owner, 26 Nov): old links still land there, on the default outlet.
  const legacy = legacyMarketingHref(q);
  if (legacy) redirect(legacy);
  const section: Section = SECTIONS.some((s) => s.id === q.bagian) ? (q.bagian as Section) : "google";
  const insightView: InsightSubTab = INSIGHT_VIEWS.some((v) => v.id === q.lihat) ? (q.lihat as InsightSubTab) : "ringkasan";
  const mediaSosialView: OutletChoice = MEDIA_SOSIAL_VIEWS.some((v) => v.id === q.lihat) ? (q.lihat as OutletChoice) : "all";
  const strategyView: StrategySubTab = STRATEGY_VIEWS.some((v) => v.id === q.lihat) ? (q.lihat as StrategySubTab) : "semua";
  const validOutlet: OutletChoice | undefined = OUTLET_TABS.some((t) => t.key === q.outlet)
    ? (q.outlet as OutletChoice)
    : undefined;
  const carriedOutlet: OutletChoice | undefined =
    validOutlet ?? (section === "media-sosial" ? mediaSosialView : undefined);

  const today = todayISO();
  const monthStart = `${today.slice(0, 7)}-01`;
  const hasValidRange = Boolean(
    q.startDate && q.endDate && ISO_DAY.test(q.startDate) && ISO_DAY.test(q.endDate) && q.startDate <= q.endDate,
  );
  const startDate = hasValidRange ? q.startDate! : monthStart;
  const endDate = hasValidRange ? q.endDate! : today;
  const rangeState = { isCustomRange: hasValidRange, startDate, endDate };
  const reportSrc = googleReportSrc(q.lihat, hasValidRange, startDate, endDate);

  const activeSubView =
    section === "insight-pasar"
      ? insightView
      : section === "media-sosial"
        ? mediaSosialView
        : section === "strategy"
          ? strategyView
          : undefined;

  const me = section === "media-sosial" ? await currentUser() : null;
  const promo = me?.propertyId ? await loadPromoAuditsCached(me.propertyId) : { audits: [], problem: null, dataUntil: null };

  const sectionHref = (target: Section) => {
    if (target === "insight-pasar" || target === "strategy") {
      return buildMarketingHref({ bagian: target, outlet: carriedOutlet }, rangeState);
    }
    if (target === "media-sosial" && carriedOutlet) {
      return buildMarketingHref({ bagian: target, lihat: carriedOutlet }, rangeState);
    }
    return buildMarketingHref({ bagian: target }, rangeState);
  };

  return (
    <div className="w-full space-y-4">
      <PageHeader title="Marketing" subtitle="Iklan, media sosial, insight pasar, dan strategi pemasaran Sanghyang" />

      <MarketingFilterBar
        key={`${startDate}|${endDate}|${hasValidRange ? "1" : "0"}`}
        section={section}
        view={activeSubView}
        outlet={validOutlet}
        activeStartDate={startDate}
        activeEndDate={endDate}
        isCustomRange={hasValidRange}
        maxDate={today}
      />

      <Tabs items={SECTIONS} current={section} href={sectionHref} />

      {section === "google" && (
        <div className="space-y-4">
          <AdsBalanceLine />
          <Frame src={reportSrc} title="Perbandingan iklan Google" />
        </div>
      )}

      {section === "meta" && (
        <SkeuoCard>
          <h2 className="text-xl font-semibold text-navy-900">Meta Ads (Facebook dan Instagram)</h2>
          {hasValidRange && (
            <p className="mt-1 text-sm font-medium text-navy-600">Periode dipilih: {rangeText(startDate, endDate)}</p>
          )}
          <p className="mt-2 text-2xl font-semibold text-navy-400">Belum ada data</p>
          <p className="mt-2 text-base text-navy-700">Sanghyang belum memakai iklan Meta. Bagian ini akan diisi setelah akun iklan Meta disambungkan ke aplikasi.</p>
        </SkeuoCard>
      )}

      {section === "insight-pasar" && (
        <div className="space-y-4">
          <Tabs
            items={INSIGHT_VIEWS}
            current={insightView}
            href={(id) => buildMarketingHref({ bagian: "insight-pasar", lihat: id, outlet: validOutlet }, rangeState)}
            small
          />
          <InsightPasarView
            startDate={startDate}
            endDate={endDate}
            isCustomRange={hasValidRange}
            activeSubTab={insightView}
            initialOutlet={validOutlet}
          />
        </div>
      )}

      {section === "media-sosial" && (
        <div className="space-y-4">
          <Tabs
            items={MEDIA_SOSIAL_VIEWS}
            current={mediaSosialView}
            href={(id) => buildMarketingHref({ bagian: "media-sosial", lihat: id }, rangeState)}
            small
          />
          <MediaSosialView startDate={startDate} endDate={endDate} activeOutlet={mediaSosialView} promoAudit={promo} />
        </div>
      )}

      {section === "strategy" && (
        <div className="space-y-4">
          <Tabs
            items={STRATEGY_VIEWS}
            current={strategyView}
            href={(id) => buildMarketingHref({ bagian: "strategy", lihat: id, outlet: validOutlet }, rangeState)}
            small
          />
          <StrategyView
            startDate={startDate}
            endDate={endDate}
            isCustomRange={hasValidRange}
            activeSubTab={strategyView}
            initialOutlet={validOutlet}
          />
        </div>
      )}
    </div>
  );
}
