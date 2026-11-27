"use client";

import { useOptimistic, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { saveKnowledgeGraphNav, type KnowledgeGraphNavState } from "./knowledge-graph-nav-action";

/**
 * Pengaturan → last row: a switch that adds Knowledge Graph under Pengaturan in the left rail, for this browser only.
 * The switch flips at once; when the server answers, the page and rail re-render with the saved cookie, and a refused
 * save flips it back with the reason.
 */
export function KnowledgeGraphNavToggle({ shown }: { shown: boolean }) {
  const [on, setOn] = useOptimistic(shown);
  const [result, setResult] = useState<KnowledgeGraphNavState | null>(null);
  const [saving, startTransition] = useTransition();

  const toggle = () =>
    startTransition(async () => {
      const next = !on;
      setOn(next);
      setResult(await saveKnowledgeGraphNav(next));
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* A heading like the other sections, and the label that names the switch. */}
          <h2 className="text-xl font-bold text-slate-900">
            <label htmlFor="kg-nav-switch">Tampilkan Knowledge Graph</label>
          </h2>
          <p id="kg-nav-help" className="mt-1 text-base text-slate-600">
            Menambah menu Knowledge Graph tepat di bawah Pengaturan pada menu kiri. Pilihan ini hanya berlaku di peramban ini.
          </p>
        </div>
        <button
          id="kg-nav-switch"
          type="button"
          role="switch"
          aria-checked={on}
          aria-describedby="kg-nav-help"
          aria-busy={saving}
          onClick={toggle}
          className="inline-flex min-h-11 shrink-0 items-center gap-3 rounded-full py-1 pl-1 pr-2 text-base font-semibold text-navy-800"
        >
          <span
            aria-hidden
            className={cn(
              "relative h-8 w-14 rounded-full transition-colors duration-150 motion-reduce:transition-none",
              on ? "bg-navy-900" : "skeuo-track",
            )}
          >
            <span
              className={cn(
                "absolute left-1 top-1 h-6 w-6 rounded-full transition-transform duration-150 motion-reduce:transition-none",
                on ? "translate-x-6 bg-lemon" : "skeuo-knob",
              )}
            />
          </span>
          <span aria-hidden className="w-12 text-left">
            {on ? "Nyala" : "Mati"}
          </span>
        </button>
      </div>
      {/* Always rendered (empty takes no space), so screen readers announce the message when it arrives. */}
      <p role="status" className="text-base font-medium text-emerald-700 [&:not(:empty)]:mt-2">
        {result?.ok}
      </p>
      {result?.error && (
        <p role="alert" className="mt-2 text-base font-medium text-red-700">
          {result.error}
        </p>
      )}
    </section>
  );
}
