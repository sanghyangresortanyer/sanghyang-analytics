"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/skeuo/ui";
import { mergeRefreshedGraph } from "@/lib/knowledge-graph/merge-refresh";
import {
  APP_MODULES,
  APP_MODULE_META,
  NODE_KINDS,
  NODE_KIND_LABEL,
  type AppModuleKey,
  type GraphLink,
  type GraphNode,
  type KnowledgeGraph,
  type KnowledgeGraphModuleSummary,
  type NodeKind,
} from "@/lib/knowledge-graph/types";
import { MarketingApiError, OUTLET_TABS, marketingApiErrorFromResponse, type OutletChoice } from "@/lib/marketing/market-intelligence-types";
import { REFRESH_CHANNEL, isRefreshEnded } from "@/lib/marketing/refresh-follow";
import { cn } from "@/lib/utils";
import { appRoute } from "./app-routes";
import { COLOR_GROUPS, KIND_TOKEN } from "./kind-colors";
import { NodePanel } from "./node-panel";
import { matchingIds, tableOrder, visibleGraph } from "./visible-graph";

const MAP_NOTICE = "flex h-full items-center justify-center rounded-[22px] bg-cream-100 p-6 text-center text-base text-navy-700";

const Graph3D = dynamic(() => import("./graph-3d").then((m) => m.Graph3D), {
  ssr: false,
  loading: () => <div className={MAP_NOTICE}>Memuat peta 3D…</div>,
});

type GraphPayload = KnowledgeGraph & { dataUpdatedAt: string | null };
type Period = "all" | "30d" | "90d" | "year";

const PERIODS: readonly { id: Period; label: string }[] = [
  { id: "all", label: "Semua data berjalan" },
  { id: "30d", label: "30 hari terakhir" },
  { id: "90d", label: "90 hari terakhir" },
  { id: "year", label: "Tahun ini" },
];

const FIELD =
  "h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-100";
const LABEL = "text-base font-semibold text-navy-900";
const SWATCH = "h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/25";
const NO_NODES: GraphNode[] = [];
const NO_LINKS: GraphLink[] = [];
const outletLabel = new Map<string, string>(OUTLET_TABS.map((t) => [t.key, t.label]));
const wib = (iso: string) => `${new Date(iso).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" })} WIB`;

async function loadGraph(period: Period, signal: AbortSignal): Promise<GraphPayload> {
  const res = await fetch(period === "all" ? "/api/knowledge-graph" : `/api/knowledge-graph?period=${period}`, { cache: "no-store", signal });
  if (!res.ok) {
    // ZERO-FALLBACK: an error page may not be JSON; the status code still reaches the message.
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw marketingApiErrorFromResponse(res.status, payload?.error);
  }
  return (await res.json()) as GraphPayload;
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** One or two plain sentences for the alert; a lapsed session or missing access says so instead of "try again". */
function describeLoadError(err: unknown): string {
  if (err instanceof MarketingApiError) {
    return err.status >= 500 ? `${sentence(err.message)} Tekan Muat ulang untuk mencoba lagi.` : sentence(err.message);
  }
  if (err instanceof TypeError) return "Server tidak bisa dihubungi. Periksa koneksi internet, lalu tekan Muat ulang.";
  if (err instanceof SyntaxError) return "Jawaban server tidak terbaca. Tekan Muat ulang untuk mencoba lagi.";
  return sentence(err instanceof Error ? err.message : String(err));
}

/** A score only exists for competitors: missing there means not measured yet, elsewhere it does not apply. */
function ScoreCell({ node }: { node: GraphNode }) {
  if (typeof node.holisticScore === "number") return <span className="font-semibold tabular-nums text-navy-900">{node.holisticScore}/100</span>;
  if (node.holisticScore === null) return <span className="text-navy-600">Belum ada data</span>;
  return (
    <>
      <span aria-hidden className="text-navy-500">–</span>
      <span className="sr-only">Tidak berlaku</span>
    </>
  );
}

/**
 * Knowledge Graph: every part of the app (VHP operations, Insight Pasar, prices, competitors, social media, strategy)
 * as one 3D map from /api/knowledge-graph, with a table that holds the same data for keyboard and screen reader use.
 * The API keeps revenue in rupiah out of the graph (internal signals are percentages only), so nothing here adds any.
 */
export function KnowledgeGraphView() {
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef<AbortController | null>(null);
  const [kinds, setKinds] = useState<Set<NodeKind>>(() => new Set(NODE_KINDS));
  const [activeModule, setActiveModule] = useState<AppModuleKey | "all">("all");
  const [outlet, setOutlet] = useState<OutletChoice>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const requestGraph = useCallback((p: Period) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    loadGraph(p, controller.signal)
      .then(
        (next) => {
          setGraph((prev) => mergeRefreshedGraph(prev, next));
          setError(null);
        },
        (err: unknown) => {
          if (!controller.signal.aborted) setError(describeLoadError(err));
        },
      )
      .finally(() => {
        if (inFlight.current !== controller) return;
        inFlight.current = null;
        setLoading(false);
      });
    return controller;
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    requestGraph(period);
  }, [requestGraph, period]);

  useEffect(() => {
    const controller = requestGraph(period);
    return () => controller.abort();
  }, [requestGraph, period]);

  // Coming back to the tab, or "Perbarui Semua Data" finishing in another tab, loads the newest graph.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !inFlight.current) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    if (typeof BroadcastChannel === "undefined") return () => document.removeEventListener("visibilitychange", onVisible);
    const channel = new BroadcastChannel(REFRESH_CHANNEL);
    channel.onmessage = (message: MessageEvent<unknown>) => {
      if (isRefreshEnded(message.data)) reload();
    };
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      channel.close();
    };
  }, [reload]);

  const graphNodes = graph?.nodes ?? NO_NODES;
  const graphLinks = graph?.links ?? NO_LINKS;
  const byId = useMemo(() => new Map(graphNodes.map((n) => [n.id, n])), [graphNodes]);
  const visible = useMemo(
    () => visibleGraph(graphNodes, graphLinks, { kinds, outlet, module: activeModule }),
    [graphNodes, graphLinks, kinds, outlet, activeModule],
  );
  const matches = useMemo(() => matchingIds(visible.nodes, query), [visible.nodes, query]);
  // A choice that a filter or another period hid would dim every node on the map; the panel still shows it.
  const selectedOnMap = useMemo(
    () => (selectedId && visible.nodes.some((n) => n.id === selectedId) ? selectedId : null),
    [selectedId, visible.nodes],
  );
  const tableRows = useMemo(
    () => tableOrder(query.trim() ? visible.nodes.filter((n) => matches.has(n.id)) : visible.nodes),
    [visible.nodes, matches, query],
  );
  const counts = useMemo(() => {
    const c = new Map<NodeKind, number>();
    for (const n of graphNodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [graphNodes]);
  const moduleCards = useMemo<KnowledgeGraphModuleSummary[]>(() => {
    if (graph?.moduleSummary?.length) return graph.moduleSummary;
    return APP_MODULES.map((mod) => ({
      module: mod,
      label: APP_MODULE_META[mod].label,
      shortLabel: APP_MODULE_META[mod].shortLabel,
      href: APP_MODULE_META[mod].href,
      nodeCount: graphNodes.filter((n) => n.modules?.includes(mod)).length,
      linkCount: graphLinks.filter((l) => l.modules?.includes(mod)).length,
      avgLinkWeight: null,
    }));
  }, [graph, graphNodes, graphLinks]);

  const select = useCallback((id: string) => setSelectedId(id), []);
  const toggleKind = (kind: NodeKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  return (
    // The map surface token named in docs/design/DESIGN.md; globals.css has no era scale, so the page maps it to ink.
    <div className="w-full space-y-4 [--color-era-ink:var(--color-navy-950)]">
      <PageHeader
        title="Knowledge Graph"
        subtitle="Peta hubungan data Sanghyang: outlet, kamar, kompetitor, harga, promo, ulasan tamu, berita kawasan, dan strategi."
        actions={
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="skeuo-pill-light inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-base font-semibold disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            {loading ? "Memuat…" : "Muat ulang"}
          </button>
        }
      />

      {graph && (
        <p className="text-sm text-navy-600">
          Periode: {graph.range ? graph.range.label : "semua data berjalan"} · {visible.nodes.length} dari {graph.nodes.length} titik tampil ·{" "}
          {visible.links.length} dari {graph.links.length} hubungan · data terakhir diperbarui{" "}
          {graph.dataUpdatedAt ? wib(graph.dataUpdatedAt) : "Belum ada data"} · peta dimuat {wib(graph.generatedAt)}
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">
          {graph
            ? `Peta terbaru belum bisa dimuat. ${error} Yang tampil adalah peta yang dimuat ${wib(graph.generatedAt)}.`
            : `Peta belum bisa dimuat. ${error}`}
        </p>
      )}

      <section aria-label="Hubungan per bagian aplikasi" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {moduleCards.map((m) => {
          const selected = activeModule === m.module;
          const page = appRoute(m.href);
          return (
            <div key={m.module} className={cn("flex flex-col justify-between gap-2 p-3", selected ? "skeuo-pill-dark rounded-[22px]" : "skeuo-card")}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setActiveModule((prev) => (prev === m.module ? "all" : m.module))}
                className="rounded-lg text-left"
              >
                <span className={cn("block text-sm font-semibold", selected ? "text-white" : "text-navy-700")}>{m.label}</span>
                <span className={cn("mt-1 block text-2xl font-semibold", selected ? "text-lemon" : "text-navy-900")}>
                  <span className="tabular-nums">{m.nodeCount}</span> <span className="text-sm font-normal">titik</span>
                </span>
                <span className={cn("block text-sm", selected ? "text-navy-200" : "text-navy-600")}>
                  <span className="tabular-nums">{m.linkCount}</span> hubungan
                  {m.avgLinkWeight !== null && (
                    <>
                      {" "}
                      · bobot rata-rata <span className="tabular-nums">{m.avgLinkWeight}</span>
                    </>
                  )}
                </span>
              </button>
              <Link
                href={page.href}
                prefetch={false}
                className={cn("inline-flex items-center gap-1 text-sm font-semibold underline-offset-2 hover:underline", selected ? "text-white" : "text-navy-800")}
              >
                Buka {page.label}
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </Link>
            </div>
          );
        })}
      </section>

      <section aria-label="Saring peta" className="skeuo-card space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className={LABEL}>Cari nama</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tableRows[0]) select(tableRows[0].id);
              }}
              placeholder="Kompetitor, tipe kamar, promo, tema ulasan, berita, atau strategi"
              className={FIELD}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={LABEL}>Bagian aplikasi</span>
            <select value={activeModule} onChange={(e) => setActiveModule(e.target.value as AppModuleKey | "all")} className={FIELD}>
              <option value="all">Semua bagian ({APP_MODULES.length})</option>
              {APP_MODULES.map((m) => (
                <option key={m} value={m}>
                  {APP_MODULE_META[m].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={LABEL}>Outlet</span>
            <select value={outlet} onChange={(e) => setOutlet(e.target.value as OutletChoice)} className={FIELD}>
              {OUTLET_TABS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className={LABEL}>Periode</span>
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as Period);
                setLoading(true);
              }}
              className={FIELD}
            >
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className={LABEL}>Jenis data</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {NODE_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => {
              const on = kinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleKind(kind)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold",
                    on ? "skeuo-pill-light" : "bg-cream-200 text-navy-500 line-through",
                  )}
                >
                  <span aria-hidden className={SWATCH} style={{ background: `var(${KIND_TOKEN[kind]})` }} />
                  {NODE_KIND_LABEL[kind]} <span className="tabular-nums">({counts.get(kind)})</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-2">
          <div className="h-[60vh] min-h-[420px]">
            {!graph ? (
              <div className={MAP_NOTICE}>{error ? "Peta belum bisa dimuat. Lihat pesan di atas." : "Memuat peta…"}</div>
            ) : visible.nodes.length === 0 ? (
              <div className={MAP_NOTICE}>Belum ada data untuk pilihan ini. Ubah penyaring di atas.</div>
            ) : (
              <Graph3D nodes={visible.nodes} links={visible.links} selectedId={selectedOnMap} highlightIds={matches} onSelect={select} />
            )}
          </div>
          <ul aria-label="Arti warna titik di peta" className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-navy-700">
            {COLOR_GROUPS.map((g) => (
              <li key={g.token} className="inline-flex items-center gap-2">
                <span aria-hidden className={SWATCH} style={{ background: `var(${g.token})` }} />
                {g.label}
              </li>
            ))}
          </ul>
        </div>
        <NodePanel
          node={selectedId ? (byId.get(selectedId) ?? null) : null}
          links={graphLinks}
          byId={byId}
          onSelect={select}
          onClose={() => setSelectedId(null)}
        />
      </div>

      <section aria-labelledby="kg-table-title" className="skeuo-card p-5">
        <h2 id="kg-table-title" className="text-xl font-semibold text-navy-900">
          Daftar data <span className="tabular-nums">({tableRows.length})</span>
        </h2>
        <p className="mt-1 text-base text-navy-600">Isinya sama dengan titik di peta. Pilih nama untuk membuka rinciannya.</p>
        <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl bg-white">
          <table className="w-full min-w-[760px] text-left text-base">
            <thead className="sticky top-0 z-10">
              <tr>
                <th scope="col">Jenis</th>
                <th scope="col">Nama</th>
                <th scope="col">Skor kemiripan</th>
                <th scope="col">Bagian aplikasi</th>
                <th scope="col">Outlet</th>
                <th scope="col">Sumber</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-navy-600">
                    {graph ? "Belum ada data untuk pilihan ini." : "Belum ada data"}
                  </td>
                </tr>
              ) : (
                tableRows.map((n) => (
                  <tr key={n.id} className={n.id === selectedId ? "bg-lemon/40" : undefined}>
                    <td className="text-navy-600">{NODE_KIND_LABEL[n.kind]}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => select(n.id)}
                        aria-current={n.id === selectedId ? "true" : undefined}
                        className="text-left font-semibold text-navy-900 underline-offset-2 hover:underline"
                      >
                        {n.label}
                      </button>
                    </td>
                    <td>
                      <ScoreCell node={n} />
                    </td>
                    <td className="text-sm text-navy-600">{n.modules?.map((m) => APP_MODULE_META[m].shortLabel).join(", ") || "Belum ada data"}</td>
                    <td className="text-navy-600">{n.outlets.length ? n.outlets.map((k) => outletLabel.get(k) ?? k).join(", ") : "Umum"}</td>
                    <td className="text-navy-600">{n.sources[0]?.label ?? "Belum ada data"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
