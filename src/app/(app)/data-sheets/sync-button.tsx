"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncSheetsNow } from "@/lib/actions/sheets";
import type { SourceSyncResult } from "@/lib/sheets/sync";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<SourceSyncResult["status"], string> = {
  changed: "diperbarui",
  unchanged: "tidak berubah",
  error: "gagal",
  not_configured: "belum diatur",
};

export function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<SourceSyncResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await syncSheetsNow();
      if (res.ok) setResults(res.results);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-xl bg-navy-700 px-4 py-2.5 text-base font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
      >
        <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} />
        {pending ? "Menarik data… (±20 detik)" : "Tarik Data Sekarang"}
      </button>
      <div aria-live="polite" className="text-sm">
        {error && <p className="text-rose-700">{error}</p>}
        {results?.map((r) => (
          <p key={r.source} className={r.status === "error" ? "text-rose-700" : "text-slate-600"}>
            <span className="font-semibold">{r.label}</span>: {STATUS_TEXT[r.status]} · {r.message}
          </p>
        ))}
      </div>
    </div>
  );
}
