import Link from "next/link";
import { cn } from "@/lib/utils";
import { dataBanner, type DataReminders } from "@/lib/dashboard/data-status";

/**
 * The one data banner (owner, 2026-11-21): red while VHP revenue is 2+ days behind, then amber
 * with what is still to upload until the data is complete; nothing when everything is in.
 */
export function DataBanner({ reminders }: { reminders: DataReminders | null }) {
  const b = dataBanner(reminders);
  if (!b) return null;
  const red = b.tone === "red";
  return (
    <div
      role={red ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 text-base print:hidden",
        red ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-950",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{b.title}</p>
        {b.items.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {b.items.map((it) => (
              <li key={it.label}>
                <span className="font-semibold">{it.label}</span> ({it.missing})
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link href="/upload-mingguan" className={cn("rounded-full px-4 py-1.5 font-semibold text-white", red ? "bg-red-800 hover:bg-red-900" : "bg-amber-800 hover:bg-amber-900")}>
        Unggah sekarang
      </Link>
    </div>
  );
}
