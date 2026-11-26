import { redirect } from "next/navigation";
import { PageHeader } from "@/components/skeuo/ui";
import { currentUser } from "@/lib/auth/role";

export const metadata = { title: "Laporan Resort — Sanghyang Analytics" };
export const dynamic = "force-dynamic";

/** The whole resort in one report (owner, 25 Nov 2026), separate from the Google Ads report. */
export default async function LaporanResortPage() {
  if (!(await currentUser())) redirect("/login");
  return (
    <div className="w-full space-y-4">
      <PageHeader title="Laporan Resort" subtitle="Revenue semua outlet, kamar, dan pembelian. Pilih periode di atas laporan, lalu cetak atau simpan sebagai PDF." />
      <iframe src="/laporan-resort/lihat" title="Laporan Resort" className="h-[calc(100vh-12rem)] min-h-[600px] w-full rounded-xl border border-cream-300 bg-white" />
    </div>
  );
}
