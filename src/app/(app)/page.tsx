import { Suspense } from "react";
import { UploadCloud } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/config";
import { SetupNeeded } from "@/components/setup-needed";
import { DashboardFilterBar } from "@/components/dashboard-filter-bar";
import { dashboardFilterKey } from "@/lib/dashboard/filter-range";
import { PageHeader, PillLink, SkeuoCard } from "@/components/skeuo/ui";
import { NeedsBell, NeedsBellLoading } from "@/components/dashboard/needs-box";
import { DataBanner } from "@/components/dashboard/upload-reminder";
import { ReportButton } from "@/components/dashboard/report-sheet";
import { buildReportSheet } from "@/lib/dashboard/report-sheet";
import { SkeuoDashboard } from "@/components/dashboard/skeuo-dashboard";
import { rangeText } from "@/lib/format-date";
import { getUnifiedDashboardData } from "@/lib/dashboard/dashboard-data";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ meeting?: string; mode?: string; startDate?: string; endDate?: string; month?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNeeded />;

  const params = await searchParams;
  const d = await getUnifiedDashboardData({
    mode: params.mode,
    meetingId: params.meeting,
    startDate: params.startDate,
    endDate: params.endDate,
    month: params.month,
  });
  const { query } = d;

  if (query.allMeetings.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-10 text-center">
        <PageHeader title="Belum ada data meeting" />
        <p className="mt-3 text-navy-500">
          Unggah Revenue VHP dan Pembelian VHP periode ini untuk mulai membandingkan revenue, pembelian, dan inventory.
        </p>
        <div className="mt-6 flex justify-center">
          <PillLink href="/upload-mingguan" icon={UploadCloud}>
            Upload data mingguan
          </PillLink>
        </div>
      </div>
    );
  }

  const filter = (
    <DashboardFilterBar
      key={dashboardFilterKey(query.mode, query.startDate, query.endDate)}
      activeMode={query.mode}
      activeStartDate={query.startDate}
      activeEndDate={query.endDate}
    />
  );

  if (!query.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard Sanghyang Analytics" actions={<PillLink href="/upload-mingguan" icon={UploadCloud}>Upload baru</PillLink>} />
        {filter}
        <SkeuoCard className="py-10 text-center">
          <p className="text-xl font-semibold text-navy-800">
            Tidak ada data pada rentang {query.startDate} s.d. {query.endDate}
          </p>
          <p className="mt-2 text-navy-400">Pilih tanggal lain atau Reset untuk kembali ke sesi terbaru.</p>
        </SkeuoCard>
      </div>
    );
  }

  const { meeting } = query.data;
  const reportSheet = buildReportSheet({
    from: meeting.period_start,
    to: meeting.period_end,
    outlets: query.data.outlets,
    totalPurchase: query.data.purchaseGroups ? query.data.purchaseGroups.reduce((s, g) => s + g.total, 0) : meeting.total_purchase,
    purchaseGroups: query.data.purchaseGroups ?? [],
    suppliers: query.data.suppliers,
    inventory: d.inventory.departments,
    outletItems: query.data.outletItems ?? [],
    menuActivity: d.menuActivity,
  });

  const headerActions = (
    <>
      <Suspense fallback={<NeedsBellLoading />}>
        <NeedsBell reminders={d.reminders} />
      </Suspense>
      <ReportButton sheet={reportSheet} />
      <PillLink href="/upload-mingguan" icon={UploadCloud}>
        Upload baru
      </PillLink>
    </>
  );

  const notices = d.sourceErrors.length > 0 && (
    <div role="alert" className="skeuo-inset px-4 py-3 text-sm text-ember-700">
      <p className="font-semibold">Sebagian data Google Sheets gagal dibaca; angkanya tidak ditampilkan sebagai 0:</p>
      <ul className="mt-1 list-disc pl-5">
        {d.sourceErrors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <SkeuoDashboard
      subtitle={`Periode ${rangeText(meeting.period_start, meeting.period_end)}`}
      headerActions={headerActions}
      banner={<DataBanner reminders={d.reminders} />}
      filter={filter}
      notices={notices}
      data={query.data}
      hkLedger={d.hkLedger}
      hkLocations={d.hkLocations}
      hkUnpricedEntries={d.hkUnpricedEntries}
      hkSyncedAt={d.hkSyncedAt}
      dmlPurchases={d.dmlPurchases}
      dmlTotalAmount={d.dmlTotalAmount}
      dmlSheetsUsed={d.dmlSheetsUsed}
      revenueMerged={d.revenueMerged}
      monthToDate={d.monthToDate}
      outletTargets={d.outletTargets}
      divisionBudgets={d.divisionBudgets}
      roomTypes={d.roomTypes}
      dbarSplit={d.dbarSplit}
      revenueCharts={d.revenueCharts}
      previousRevenue={d.previousRevenue}
      roomSegments={d.roomSegments}
      occupancy={d.occupancy}
      menuActivity={d.menuActivity}
      inventory={d.inventory}
    />
  );
}
