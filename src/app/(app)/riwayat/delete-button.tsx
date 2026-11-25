"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteWeeklyMeeting } from "@/lib/actions/weekly-meeting";

export function DeleteMeetingButton({ meetingId, version }: { meetingId: string; version: number }) {
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm("Hapus arsip meeting ini?")) return;
    setBusy(true);
    try {
      const res = await deleteWeeklyMeeting(meetingId, version);
      if (!res.ok) alert(res.error ?? "Gagal menghapus");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      title="Hapus Meeting"
      className="rounded-lg border border-slate-200 p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
