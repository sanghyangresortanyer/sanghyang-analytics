"use client";

import Link from "next/link";
import { ArrowUpRight, ExternalLink, X } from "lucide-react";
import { APP_MODULE_META, NODE_KIND_LABEL, type GraphLink, type GraphNode } from "@/lib/knowledge-graph/types";
import { appRoute, type AppRoute } from "./app-routes";
import { KIND_TOKEN } from "./kind-colors";

const PANEL = "skeuo-card p-5 lg:max-h-[62vh] lg:overflow-y-auto";
const SUBHEAD = "text-sm font-semibold text-navy-600";

const observed = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }) : "Belum ada data";

const pathOf = (href: string) => href.split("?")[0];

/** Pages of this app for the node: its own link first, then each part of the app that uses it, without repeats. */
function destinations(node: GraphNode): AppRoute[] {
  const hrefs = [
    ...(node.href ? [node.href] : []),
    ...(node.modules ?? []).map((m) => {
      const moduleHref = APP_MODULE_META[m].href;
      // The node's own link is more precise (it carries the outlet) when it opens the same page as the module.
      return node.href && pathOf(node.href) === pathOf(moduleHref) ? node.href : moduleHref;
    }),
  ];
  const unique = new Map<string, AppRoute>();
  for (const route of hrefs.map(appRoute)) if (!unique.has(route.href)) unique.set(route.href, route);
  return [...unique.values()];
}

/** Details of the chosen node: facts, comparability score, pages to open, sources with dates, and its links. */
export function NodePanel({
  node,
  links,
  byId,
  onSelect,
  onClose,
}: {
  node: GraphNode | null;
  links: GraphLink[];
  byId: Map<string, GraphNode>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  if (!node) {
    return (
      <aside className={PANEL} aria-live="polite">
        <p className="text-base text-navy-700">Pilih titik di peta atau nama di tabel untuk melihat rincian, sumber, dan hubungannya.</p>
      </aside>
    );
  }

  const related = links
    .filter((l) => l.source === node.id || l.target === node.id)
    .flatMap((l) => {
      const other = byId.get(l.source === node.id ? l.target : l.source);
      return other ? [{ other, label: l.label, weight: l.weight, outgoing: l.source === node.id }] : [];
    })
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  const pages = destinations(node);

  return (
    <aside className={`${PANEL} space-y-5`} aria-live="polite" aria-labelledby="kg-node-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full bg-cream-200 px-3 py-1 text-sm font-semibold text-navy-700">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${KIND_TOKEN[node.kind]})` }} />
            {NODE_KIND_LABEL[node.kind]}
          </p>
          <h2 id="kg-node-title" className="mt-2 text-xl font-semibold leading-snug text-navy-900">
            {node.label}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup rincian"
          className="skeuo-knob inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {typeof node.holisticScore === "number" && (
        <div className="skeuo-inset p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-semibold text-navy-900">Skor kemiripan dengan outlet Sanghyang</span>
            <span className="text-lg font-bold tabular-nums text-navy-900">{node.holisticScore}/100</span>
          </div>
          {node.holisticFactors && node.holisticFactors.length > 0 && (
            <ul className="mt-3 space-y-2">
              {node.holisticFactors.map((f) => (
                <li key={f.key} className="text-sm">
                  <div className="flex items-center justify-between gap-2 text-navy-700">
                    <span>
                      {f.label} <span className="text-navy-500">(bobot {Math.round(f.weight * 100)}%)</span>
                    </span>
                    <span className="font-semibold tabular-nums text-navy-900">{f.score}</span>
                  </div>
                  <div
                    className="skeuo-track mt-1 h-2 w-full"
                    role="progressbar"
                    aria-label={f.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={f.score}
                  >
                    <div className="h-full rounded-full bg-navy-800" style={{ width: `${Math.max(4, Math.min(100, f.score))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {pages.length > 0 && (
        <div>
          <p className={SUBHEAD}>Buka di aplikasi</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {pages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                prefetch={false}
                className="skeuo-pill-light inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold hover:brightness-[1.02]"
              >
                {page.label}
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ))}
          </div>
        </div>
      )}

      {node.detail.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-base text-navy-700">
          {node.detail.map((d, idx) => (
            <li key={`${idx}-${d}`}>{d}</li>
          ))}
        </ul>
      )}

      <div>
        <p className={SUBHEAD}>Sumber</p>
        {node.sources.length > 0 ? (
          <ul className="mt-1 space-y-1 text-base">
            {node.sources.map((s) => (
              <li key={`${s.label}-${s.url ?? ""}`}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-navy-900 underline underline-offset-2">
                    {s.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : (
                  <span className="text-navy-700">{s.label}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-base text-navy-700">Belum ada data</p>
        )}
        <p className="mt-1 text-sm text-navy-600">Tanggal data: {observed(node.observedAt)}</p>
      </div>

      <div>
        <p className={SUBHEAD}>Hubungan ({related.length})</p>
        {related.length === 0 ? (
          <p className="mt-1 text-base text-navy-700">Belum ada data</p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto text-base">
            {related.map((r, i) => (
              <li key={`${r.other.id}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelect(r.other.id)}
                  className="flex w-full items-baseline justify-between gap-2 rounded-xl bg-white/70 px-3 py-2 text-left hover:bg-white"
                >
                  <span className="min-w-0">
                    <span className="text-sm text-navy-600">{r.outgoing ? `${r.label} → ` : `← ${r.label}: `}</span>
                    <span className="font-semibold text-navy-900">{r.other.label}</span>
                  </span>
                  {typeof r.weight === "number" && (
                    <span className="shrink-0 rounded-full bg-cream-200 px-2 py-0.5 text-sm font-semibold tabular-nums text-navy-700" title="Bobot hubungan (0–100)">
                      {r.weight}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
