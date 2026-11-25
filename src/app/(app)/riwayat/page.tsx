import Link from "next/link";
import { UploadCloud } from "lucide-react";
import { listWeeklyMeetings } from "@/lib/actions/weekly-meeting";
import { isSupabaseConfigured } from "@/lib/config";
import { SetupNeeded } from "@/components/setup-needed";
import { MeetingsTable } from "./meetings-table";

export default async function RiwayatPage() {
  if (!isSupabaseConfigured()) return <SetupNeeded />;

  const meetings = await listWeeklyMeetings();

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Riwayat Upload</h1>
          <p className="mt-1 text-base text-slate-600">
            Semua data VHP yang sudah diunggah.
          </p>
        </div>
        <Link
          href="/upload-mingguan"
          className="inline-flex items-center gap-2 rounded-xl bg-navy-700 px-4 py-2.5 text-base font-semibold text-white hover:bg-navy-800"
        >
          <UploadCloud className="h-4 w-4" />
          Upload Baru
        </Link>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-base text-slate-500">
          Belum ada riwayat meeting yang tersimpan.
        </div>
      ) : (
        <MeetingsTable meetings={meetings} />
      )}
    </div>
  );
}
