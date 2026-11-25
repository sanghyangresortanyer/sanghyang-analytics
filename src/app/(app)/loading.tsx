import { Bars } from "@/components/ui/bars";

/**
 * One fallback for every page in the group. Next wraps page.tsx in a Suspense
 * boundary with this, so clicking a sidebar or tab link paints immediately
 * instead of leaving the old screen frozen while the server renders.
 *
 * Kept deliberately light: it has to render before any data is available.
 * Skeleton blocks stay (they preview the shape of what's coming, e.g. a
 * table with rows) — <Bars /> next to the title is the "still working"
 * signal a static pulse doesn't give on a heavier load like Inventory
 * Daily's 421 rows.
 */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Memuat halaman...</span>
      <div className="flex items-center gap-3">
        <Bars className="h-6 w-6 text-navy-600" />
        <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
