"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileDown,
  Loader2,
  MapPin,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  ThumbsUp,
  X,
} from "lucide-react";
import { SkeuoCard } from "@/components/skeuo/ui";
import {
  MIN_REVIEWS_FOR_VERDICT,
  OUTLET_KEYS,
  OUTLET_TABS,
  aspectHighlights,
  channelFromSource,
  fmtDateShort,
  formatMarketingClientError,
  groupPromosByCompetitor,
  isPromoEvent,
  marketingApiErrorFromResponse,
  ownPromoMatchesOutletKey,
  ownPromoSourceSummary,
  promoMatchesOutletKey,
  sentimentVerdict,
  type OutletChoice,
  type SnNewsItem,
  type SnOutletMatrix,
  type SnSourceRef,
  type SnSummary,
} from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";
import { SnExtensionPanel, useSocialExtensionSync } from "./sn-extension-panel";
import {
  SnComparisonCard,
  SnFnbMatrixSection,
  SnHeadToHeadNarrative,
  SnMarketSharePanel,
  SnResortMatrixSection,
  SnWeeklyActions,
} from "./sn-market-steps";
import { SnMethodologyView } from "./sn-methodology-view";
import { SnOutletSelector } from "./sn-outlet-selector";
import { SnPromoTable } from "./sn-promo-table";
import { SnLastUpdateDetails, SnUpdateAllButton } from "./sn-update-all";

export type InsightSubTab = "ringkasan" | "kata-tamu" | "kompetitor" | "harga" | "promo" | "langkah";

const REVIEW_PAGE_SIZE = 15;
const NEWS_FIRST_PAGE = 8;

function parseFileName(contentDisposition: string | null, fallback: string): string {
  const header = contentDisposition ?? "";
  const extended = header.match(/filename\*\s*=\s*([^;]+)/i)?.[1]?.trim().replace(/^"(.*)"$/, "$1");
  if (extended) {
    const parts = extended.match(/^([^']*)'[^']*'(.+)$/);
    if (parts && parts[1].toUpperCase() === "UTF-8") {
      try {
        return decodeURIComponent(parts[2]);
      } catch {
        return fallback;
      }
    }
  }
  const quoted = header.match(/(?:^|;)\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i)?.[1];
  if (quoted) return quoted.replace(/\\(.)/g, "$1");
  const bare = header.match(/(?:^|;)\s*filename\s*=\s*([^;\s]+)/i)?.[1];
  return bare ?? fallback;
}

export function filterGuestReviews<
  T extends { source: string; sentiment: string; themes?: string[] },
>(
  reviews: readonly T[],
  filters: {
    selectedAspect: string | null;
    sentimentFilter: "all" | "positive" | "neutral" | "negative";
    channelFilter: "all" | "google" | "ota";
    otaProviders?: readonly string[];
  },
): T[] {
  return reviews.filter((r) => {
    if (filters.selectedAspect && !(r.themes ?? []).some((t) => t.toLowerCase() === filters.selectedAspect!.toLowerCase())) {
      return false;
    }
    if (filters.sentimentFilter !== "all" && r.sentiment !== filters.sentimentFilter) return false;
    if (filters.channelFilter !== "all" && channelFromSource(r.source, filters.otaProviders) !== filters.channelFilter) {
      return false;
    }
    return true;
  });
}

function readViaLabel(sourceUrl: string | null | undefined): string | null {
  return sourceUrl && /google\.[a-z.]+\/travel\//.test(sourceUrl) ? "dibaca lewat Google Travel" : null;
}

function newsEventDays(n: SnNewsItem): string | null {
  if (!n.eventStart) return null;
  const start = fmtDateShort(n.eventStart);
  const end = n.eventEnd ? fmtDateShort(n.eventEnd) : null;
  return end && end !== start ? `${start} – ${end}` : start;
}

function newsPlaceLabel(n: SnNewsItem): string | null {
  if (!n.location) return null;
  if (n.distanceKm === null || n.distanceKm === undefined) return n.location;
  return n.distanceKm === 0
    ? `${n.location} (wilayah Sanghyang)`
    : `${n.location} (${n.distanceKm.toLocaleString("id-ID")} km dari Sanghyang)`;
}

export function InsightPasarView({
  startDate,
  endDate,
  isCustomRange,
  activeSubTab,
  initialOutlet,
}: {
  startDate: string;
  endDate: string;
  isCustomRange: boolean;
  activeSubTab: InsightSubTab;
  initialOutlet?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mainView, setMainView] = useState<"insight" | "methodology">("insight");
  const urlOutletRaw = searchParams.get("outlet") ?? initialOutlet;
  const urlOutlet: OutletChoice = OUTLET_TABS.some((t) => t.key === urlOutletRaw)
    ? (urlOutletRaw as OutletChoice)
    : "resort";
  const [outletOverride, setOutletOverride] = useState<{ base: OutletChoice; value: OutletChoice } | null>(null);
  const selectedOutlet: OutletChoice =
    outletOverride && outletOverride.base === urlOutlet ? outletOverride.value : urlOutlet;
  const [data, setData] = useState<SnSummary | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showExecutiveSummary, setShowExecutiveSummary] = useState(false);
  const [channelFilter, setChannelFilter] = useState<"all" | "google" | "ota">("all");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | "positive" | "neutral" | "negative">("all");
  const [reviewLimit, setReviewLimit] = useState(REVIEW_PAGE_SIZE);
  const [selectedAspect, setSelectedAspect] = useState<string | null>(null);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string>("all-competitors");
  const [copiedFindingId, setCopiedFindingId] = useState<string | null>(null);
  const [showAllNews, setShowAllNews] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reloadData = useCallback(() => setReloadTick((t) => t + 1), []);
  const extSync = useSocialExtensionSync(reloadData);

  const queryKey = isCustomRange
    ? `period=30d&from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}&t=${reloadTick}`
    : `period=30d&t=${reloadTick}`;
  const loading = loadedQuery !== queryKey;

  useEffect(() => {
    let live = true;
    const query = isCustomRange
      ? `period=30d&from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`
      : "period=30d";
    fetch(`/api/market-intelligence/summary?${query}&segment=all`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as (SnSummary & { error?: string }) | null;
        if (!res.ok || !json || !Array.isArray(json.outlets)) {
          throw marketingApiErrorFromResponse(res.status, json?.error);
        }
        return json;
      })
      .then((json) => {
        if (!live) return;
        setData(json);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(
          formatMarketingClientError(
            err,
            (detail) => `Data Insight Pasar tidak dapat dimuat (${detail}). Coba muat ulang halaman beberapa saat lagi.`,
          ),
        );
      })
      .finally(() => {
        if (live) setLoadedQuery(queryKey);
      });
    return () => {
      live = false;
    };
  }, [isCustomRange, startDate, endDate, queryKey]);

  const outlets = useMemo(() => data?.outlets ?? [], [data?.outlets]);
  const activeOutlet = useMemo(() => outlets.find((o) => o.key === selectedOutlet), [outlets, selectedOutlet]);
  const selectedOutletLabel = OUTLET_TABS.find((t) => t.key === selectedOutlet)?.label ?? "Semua Outlet";

  const handleSelectOutlet = (key: OutletChoice) => {
    setOutletOverride({ base: urlOutlet, value: key });
    setSelectedAspect(null);
    setSelectedCompetitorId("all-competitors");
    setReviewLimit(REVIEW_PAGE_SIZE);
    setShowAllNews(false);

    const next = new URLSearchParams(searchParams.toString());
    next.set("bagian", "insight-pasar");
    next.set("lihat", activeSubTab);
    next.set("outlet", key);
    if (isCustomRange) {
      next.set("startDate", startDate);
      next.set("endDate", endDate);
    }
    router.replace(`/marketing?${next.toString()}`, { scroll: false });
  };

  const strategyHref = (subTab: "rekomendasi" | "radar") => {
    const params = new URLSearchParams();
    params.set("bagian", "strategy");
    params.set("lihat", subTab);
    params.set("outlet", selectedOutlet);
    if (isCustomRange) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    return `/marketing?${params.toString()}`;
  };

  const otaProviders = useMemo(
    () => data?.otaDirectory?.reviewProviders ?? data?.otaDirectory?.providers,
    [data?.otaDirectory],
  );

  const guestOutlets = useMemo(
    () => (selectedOutlet === "all" ? outlets : activeOutlet ? [activeOutlet] : []),
    [selectedOutlet, outlets, activeOutlet],
  );
  const guestSummary = useMemo(() => {
    const positive = guestOutlets.reduce((n, o) => n + o.sentimentDistribution.positive, 0);
    const total = guestOutlets.reduce((n, o) => n + o.sentimentDistribution.total, 0);
    const negative = guestOutlets.reduce((n, o) => n + o.sentimentDistribution.negative, 0);
    const neutral = guestOutlets.reduce((n, o) => n + o.sentimentDistribution.neutral, 0);
    const verdict = sentimentVerdict(positive, total, negative);
    const single = guestOutlets.length === 1 ? guestOutlets[0] : null;
    const { praised, complaints } = aspectHighlights(single?.topAspects, total);
    const denom = total || 1;
    return {
      positive,
      neutral,
      negative,
      total,
      posPct: Math.round((positive / denom) * 100),
      neuPct: Math.round((neutral / denom) * 100),
      negPct: Math.round((negative / denom) * 100),
      verdict,
      single,
      praised,
      complaints,
    };
  }, [guestOutlets]);

  const visibleReviews = useMemo(() => {
    const raw =
      selectedOutlet === "all"
        ? outlets.flatMap((o) => o.reviews.map((r) => ({ ...r, outletName: o.name })))
        : activeOutlet?.reviews ?? [];

    return filterGuestReviews(raw, {
      selectedAspect,
      sentimentFilter,
      channelFilter,
      otaProviders,
    });
  }, [outlets, activeOutlet, selectedOutlet, selectedAspect, channelFilter, sentimentFilter, otaProviders]);

  const reviewTally = useMemo(
    () => ({
      positive: visibleReviews.filter((r) => r.sentiment === "positive").length,
      negative: visibleReviews.filter((r) => r.sentiment === "negative").length,
      neutral: visibleReviews.filter((r) => r.sentiment === "neutral").length,
    }),
    [visibleReviews],
  );

  const otaSourcePreview = useMemo(() => {
    if (!activeOutlet) return "Ulasan dari portal pemesanan daring";
    const reviewOtas = [
      ...new Set(activeOutlet.reviews.filter((r) => channelFromSource(r.source, otaProviders) === "ota").map((r) => r.source)),
    ];
    const hotelReviewOtas = selectedOutlet === "resort" ? (data?.otaDirectory?.reviewSourcesByHotel?.sanghyang ?? []) : [];
    const listed = reviewOtas.length > 0 ? reviewOtas : hotelReviewOtas;
    if (listed.length === 0) return "Ulasan dari portal pemesanan daring";
    const preview = listed.slice(0, 3).join(", ");
    return listed.length > 3 ? `${preview} +${listed.length - 3} OTA` : preview;
  }, [activeOutlet, otaProviders, selectedOutlet, data?.otaDirectory]);

  const outletComparisons = useMemo(() => {
    const all = data?.comparisons ?? [];
    if (selectedOutlet === "all") return all;
    return all.filter((c) => c.outlet === selectedOutlet);
  }, [data?.comparisons, selectedOutlet]);

  const activeComparisons = useMemo(() => {
    if (selectedCompetitorId === "all-competitors" || selectedOutlet === "all") return outletComparisons;
    return outletComparisons.filter((c) => c.id === selectedCompetitorId);
  }, [outletComparisons, selectedCompetitorId, selectedOutlet]);

  const comparisonGroups = useMemo(() => {
    if (selectedOutlet !== "all") {
      return [{ key: selectedOutlet, label: null as string | null, items: activeComparisons }];
    }
    return OUTLET_TABS.filter((t) => t.key !== "all")
      .map((t) => ({ key: t.key, label: t.label, items: activeComparisons.filter((c) => c.outlet === t.key) }))
      .filter((g) => g.items.length > 0);
  }, [selectedOutlet, activeComparisons]);

  const ownEvidence = selectedOutlet !== "all" ? data?.ownEvidence?.[selectedOutlet] ?? null : null;
  const narrative = data?.outletAnalyses?.[selectedOutlet]?.headToHeadNarrative ?? null;
  const narrativeSources = useMemo<SnSourceRef[]>(() => {
    const map = new Map<string, SnSourceRef>();
    for (const comp of [ownEvidence, ...outletComparisons]) {
      if (!comp?.evidence) continue;
      const points = [
        ...(comp.evidence.observed ?? []),
        ...(comp.evidence.strengths ?? []),
        ...(comp.evidence.gaps ?? []),
        ...(comp.evidence.opportunities ?? []),
      ];
      for (const pt of points) {
        for (const src of pt.sources ?? []) {
          const k = src.url ?? src.label;
          if (k && !map.has(k)) map.set(k, src);
        }
      }
    }
    return [...map.values()].slice(0, 12);
  }, [ownEvidence, outletComparisons]);

  const marketData = data?.outletMarketShare?.[selectedOutlet] ?? null;

  const ownPromos = useMemo(() => {
    const custom = Boolean(data?.range?.custom);
    const raw = (data?.ownPromos ?? []).filter(
      (p) => ownPromoMatchesOutletKey(p, selectedOutlet) && (custom || p.status !== "expired"),
    );
    return {
      promos: raw.filter((p) => !isPromoEvent(p)),
      events: raw.filter((p) => isPromoEvent(p)),
    };
  }, [data?.ownPromos, data?.range?.custom, selectedOutlet]);

  const rivalPromos = useMemo(() => {
    const custom = Boolean(data?.range?.custom);
    const raw = (data?.competitorSocialRadar ?? []).filter(
      (p) => !p.isOwn && promoMatchesOutletKey(p, selectedOutlet) && (custom || p.status !== "expired"),
    );
    const ordered = (items: typeof raw) => groupPromosByCompetitor(items).flatMap((g) => g.promos);
    return {
      promos: ordered(raw.filter((p) => !isPromoEvent(p))),
      events: ordered(raw.filter((p) => isPromoEvent(p))),
    };
  }, [data?.competitorSocialRadar, data?.range?.custom, selectedOutlet]);

  const weeklyFindings = useMemo(
    () =>
      selectedOutlet === "all"
        ? outlets.flatMap((o) => o.findings.map((f) => ({ ...f, outletName: o.name })))
        : activeOutlet?.findings ?? [],
    [outlets, activeOutlet, selectedOutlet],
  );

  const outletNews = useMemo(() => {
    const list = data?.news ?? [];
    if (selectedOutlet === "all") return list;
    return list.filter((n) => n.outlets.includes(selectedOutlet));
  }, [data?.news, selectedOutlet]);

  const visibleNews = showAllNews ? outletNews : outletNews.slice(0, NEWS_FIRST_PAGE);

  const handleCopyFinding = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFindingId(id);
      window.setTimeout(() => setCopiedFindingId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      setActionMsg("Teks aksi tidak dapat disalin otomatis. Pilih teksnya lalu salin manual.");
    }
  };

  const handleDownloadPdf = async () => {
    if (!data) return;
    setExportingPdf(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/market-intelligence/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet: selectedOutlet,
          period: isCustomRange ? "custom" : "30d",
          from: isCustomRange ? startDate : undefined,
          to: isCustomRange ? endDate : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw marketingApiErrorFromResponse(res.status, body?.error);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = parseFileName(res.headers.get("Content-Disposition"), `Laporan Insight Pasar: ${selectedOutletLabel}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setActionMsg(formatMarketingClientError(err, (detail) => `Gagal membuat PDF: ${detail}`));
    } finally {
      setExportingPdf(false);
    }
  };

  const activeMatrix = data?.competitorMatrix?.[selectedOutlet];
  const allMatrices: SnOutletMatrix[] =
    selectedOutlet === "all"
      ? OUTLET_KEYS.map((k) => data?.competitorMatrix?.[k]).filter((m): m is SnOutletMatrix => Boolean(m))
      : activeMatrix
        ? [activeMatrix]
        : [];
  const audit = data?.compsetAudit?.[selectedOutlet];

  if (mainView === "methodology" && data?.outletMarketShare) {
    return (
      <SnMethodologyView
        onBack={() => setMainView("insight")}
        marketShare={data.outletMarketShare}
        marketSize={data.marketSize}
        audit={data.compsetAudit}
      />
    );
  }

  const showAll = activeSubTab === "ringkasan";
  const lastSyncText = data?.syncStatus?.lastSyncAt
    ? `${new Date(data.syncStatus.lastSyncAt).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      })} WIB`
    : "belum ada catatan";

  return (
    <div className="space-y-4">
      {/* Header Utama: Insight Pasar Sanghyang Analytics */}
      <SkeuoCard className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-cream-300 pb-4">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">
              Data Pasar Multi-Outlet · Anyer–Carita
            </p>
            <h2 className="text-2xl font-bold text-navy-900">Insight Pasar</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-600">
              <span>
                Periode:{" "}
                <strong className="text-navy-900">
                  {data?.range?.label ?? `${fmtDateShort(startDate)} – ${fmtDateShort(endDate)}`}
                </strong>
              </span>
              {data?.syncStatus && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    Terakhir diperbarui: <strong className="text-navy-900">{lastSyncText}</strong>
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {data.syncStatus.totalReviews.toLocaleString("id-ID")} ulasan tercatat (
                    {data.syncStatus.verifiedReviews.toLocaleString("id-ID")} punya tautan sumber)
                  </span>
                </>
              )}
            </div>
            <div className="pt-0.5">
              <SnLastUpdateDetails />
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              disabled={!data?.outletMarketShare}
              onClick={() => setMainView("methodology")}
              className="skeuo-pill-light inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4 text-navy-700" aria-hidden />
              Metodologi &amp; Validasi
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={exportingPdf || !data}
              className="skeuo-pill-light inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold disabled:opacity-50"
            >
              {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
              {exportingPdf ? "Membuat PDF…" : `Download Report • ${selectedOutletLabel}`}
            </button>
            <SnUpdateAllButton onFinished={reloadData} />
          </div>
        </div>

        {/* Ringkasan Eksekutif (Buka / Tutup) */}
        {data?.executiveSummary && (
          <div className="rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Ringkasan Eksekutif</span>
                <span className="font-semibold text-navy-900">Laporan Insight Pasar multi-outlet Anyer–Carita</span>
              </div>
              <button
                type="button"
                onClick={() => setShowExecutiveSummary((v) => !v)}
                aria-expanded={showExecutiveSummary}
                className="inline-flex items-center gap-1 text-xs font-semibold text-navy-800 hover:underline"
              >
                {showExecutiveSummary ? "Tutup" : "Buka"}
                {showExecutiveSummary ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </div>
            {showExecutiveSummary && (
              <p className="mt-2.5 border-t border-cream-300 pt-2.5 text-xs leading-relaxed text-navy-700">
                {data.executiveSummary}
              </p>
            )}
          </div>
        )}

        {actionMsg && (
          <p role="status" className="rounded-xl bg-cream-100 px-3.5 py-2 text-xs font-medium text-navy-800">
            {actionMsg}
          </p>
        )}
      </SkeuoCard>

      {/* Pemilih 7 Kartu Unit Bisnis */}
      <SnOutletSelector
        selectedOutlet={selectedOutlet}
        outlets={outlets}
        summary={data}
        onSelectOutlet={handleSelectOutlet}
        description="Klik salah satu outlet di bawah untuk menyesuaikan seluruh urutan analisis 5 langkah."
      />

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      {loading && !data && (
        <SkeuoCard className="flex items-center justify-center gap-2 py-12 text-navy-600">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Memuat data Insight Pasar dari server lokal…
        </SkeuoCard>
      )}

      {data && (
        <div className="space-y-4">
          {/* LANGKAH 1: APA KATA TAMU */}
          {(showAll || activeSubTab === "kata-tamu") && (
            <SkeuoCard className="space-y-4">
              <div className="flex items-start gap-3 border-b border-cream-300 pb-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-cream-50">
                  1
                </span>
                <div>
                  <h3 className="text-lg font-bold text-navy-900">Apa kata tamu ({selectedOutletLabel})</h3>
                  <p className="text-xs text-navy-600">Pendapat tamu menunjukkan apa yang harus dijaga dan apa yang harus diperbaiki.</p>
                </div>
              </div>

              {/* 3 Kartu KPI + Status Strip + Dipuji vs Dikeluhkan */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-cream-300 bg-cream-50 p-3.5">
                  <p className="text-xs font-semibold text-navy-600">Rating Google</p>
                  <p className="mt-1 flex items-center gap-1.5 text-2xl font-extrabold tabular-nums text-navy-900">
                    <Star className="h-5 w-5 fill-amber-500 text-amber-500" aria-hidden />
                    {guestSummary.single?.rating == null ? "—" : `${guestSummary.single.rating.toLocaleString("id-ID")} / 5`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-navy-600">
                    {guestSummary.single ? `${guestSummary.single.reviewCount.toLocaleString("id-ID")} ulasan di Google` : "Pilih satu outlet"}
                  </p>
                </div>
                <div className="rounded-2xl border border-cream-300 bg-cream-50 p-3.5">
                  <p className="text-xs font-semibold text-navy-600">Ulasan yang memuji</p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums text-navy-900">
                    {guestSummary.verdict.pct === null ? "—" : `${guestSummary.verdict.pct}%`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-navy-600">dari ulasan yang tercatat pada periode terpilih</p>
                </div>
                <div className="rounded-2xl border border-cream-300 bg-cream-50 p-3.5">
                  <p className="text-xs font-semibold text-navy-600">Ulasan tercatat</p>
                  <p className="mt-1 text-2xl font-extrabold tabular-nums text-navy-900">
                    {guestSummary.total.toLocaleString("id-ID")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-navy-600">dibaca dari Google dan OTA</p>
                </div>
              </div>

              <p className="text-sm font-semibold text-navy-900">
                <span
                  className={cn(
                    "mr-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold",
                    guestSummary.verdict.tone === "good"
                      ? "bg-emerald-100 text-emerald-800"
                      : guestSummary.verdict.tone === "warn"
                        ? "bg-amber-100 text-amber-900"
                        : guestSummary.verdict.tone === "bad"
                          ? "bg-red-100 text-red-800"
                          : "bg-cream-200 text-navy-700",
                  )}
                >
                  {guestSummary.verdict.label}
                </span>
                {guestSummary.verdict.sentence}
              </p>

              {/* Bar Distribusi Sentimen */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-800">
                    Positif: {guestSummary.positive} ({guestSummary.posPct}%)
                  </span>
                  <span className="rounded-full bg-cream-200 px-2.5 py-0.5 font-semibold text-navy-700">
                    Netral: {guestSummary.neutral} ({guestSummary.neuPct}%)
                  </span>
                  <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-semibold text-red-800">
                    Perlu Atensi: {guestSummary.negative} ({guestSummary.negPct}%)
                  </span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-cream-200">
                  <div style={{ width: `${guestSummary.posPct}%` }} className="bg-emerald-600" />
                  <div style={{ width: `${guestSummary.neuPct}%` }} className="bg-navy-400" />
                  <div style={{ width: `${guestSummary.negPct}%` }} className="bg-red-500" />
                </div>
              </div>

              {guestSummary.single && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs">
                    <p className="font-bold text-emerald-900">Yang paling dipuji</p>
                    {guestSummary.praised.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-emerald-950">
                        {guestSummary.praised.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-navy-600">Belum cukup ulasan untuk disimpulkan.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3.5 text-xs">
                    <p className="font-bold text-red-800">Yang paling dikeluhkan</p>
                    {guestSummary.complaints.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-red-900">
                        {guestSummary.complaints.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-navy-600">
                        {guestSummary.total >= MIN_REVIEWS_FOR_VERDICT
                          ? "Belum ada keluhan yang sering muncul."
                          : "Belum cukup ulasan untuk disimpulkan."}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Kartu kanal ulasan; komentar media sosial bukan ulasan tamu (keputusan pemilik 27 Nov 2026). */}
              {activeOutlet?.channelBreakdown && (
                <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div className="space-y-1 rounded-2xl border border-sky-200 bg-sky-50/50 p-3.5">
                    <div className="flex items-center justify-between font-bold text-sky-950">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" aria-hidden /> Google Maps
                      </span>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px]">
                        {activeOutlet.channelBreakdown.google.count} ulasan
                      </span>
                    </div>
                    <p className="text-lg font-extrabold text-sky-900">
                      {activeOutlet.channelBreakdown.google.rating ?? "—"}/5
                    </p>
                    <p className="text-[11px] text-sky-900/80">Ulasan publik wisatawan dan keluarga</p>
                  </div>
                  <div className="space-y-1 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3.5">
                    <div className="flex items-center justify-between font-bold text-emerald-950">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-4 w-4" aria-hidden /> OTA
                      </span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px]">
                        {activeOutlet.channelBreakdown.ota.count} ulasan
                      </span>
                    </div>
                    <p className="text-lg font-extrabold text-emerald-900">
                      {activeOutlet.channelBreakdown.ota.rating ?? "—"}/5
                    </p>
                    <p className="text-[11px] text-emerald-900/80">{otaSourcePreview}</p>
                  </div>
                </div>
              )}

              {/* Panel Ekstensi Chrome di Langkah 1 */}
              <SnExtensionPanel sync={extSync} compact outletKey={selectedOutlet} outletLabel={selectedOutletLabel} />

              {/* Filter Topik #Aspek Interaktif */}
              {activeOutlet?.topAspects && activeOutlet.topAspects.length > 0 && (
                <div className="rounded-2xl border border-cream-300 bg-white p-3.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-navy-900">Topik yang Sering Dibahas Tamu (klik untuk menyaring):</span>
                    {selectedAspect && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedAspect(null);
                          setReviewLimit(REVIEW_PAGE_SIZE);
                        }}
                        className="inline-flex items-center gap-1 font-semibold text-red-700 hover:underline"
                      >
                        <X className="h-3 w-3" aria-hidden /> Hapus filter (#{selectedAspect})
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeOutlet.topAspects.map((a) => (
                      <button
                        key={a.aspect}
                        type="button"
                        onClick={() => {
                          setSelectedAspect(selectedAspect === a.aspect ? null : a.aspect);
                          setReviewLimit(REVIEW_PAGE_SIZE);
                        }}
                        className={cn(
                          "rounded-full px-3 py-1 font-semibold transition",
                          selectedAspect === a.aspect ? "skeuo-pill-dark" : "bg-cream-200 text-navy-800 hover:bg-cream-300",
                        )}
                      >
                        #{a.aspect} ({a.count})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter Kanal dan Sentimen (mengikuti filter tanggal global di header) */}
              <div className="space-y-2 border-t border-cream-200 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="skeuo-inset flex flex-wrap gap-1 p-1 text-xs">
                    {(
                      [
                        ["all", "Semua Kanal"],
                        ["google", "Google Maps"],
                        ["ota", "OTA"],
                      ] as const
                    ).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setChannelFilter(k);
                          setReviewLimit(REVIEW_PAGE_SIZE);
                        }}
                        className={cn("rounded-full px-3 py-1 font-semibold", channelFilter === k ? "skeuo-pill-dark" : "text-navy-600")}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>

                  <div className="skeuo-inset flex flex-wrap gap-1 p-1 text-xs">
                    {(
                      [
                        ["all", `Semua (${visibleReviews.length})`],
                        ["positive", "Pujian"],
                        ["negative", "Perlu Atensi"],
                        ["neutral", "Netral"],
                      ] as const
                    ).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setSentimentFilter(k);
                          setReviewLimit(REVIEW_PAGE_SIZE);
                        }}
                        className={cn("rounded-full px-3 py-1 font-semibold", sentimentFilter === k ? "skeuo-pill-dark" : "text-navy-600")}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs text-navy-600">
                  <span className="font-semibold text-emerald-800">{reviewTally.positive} pujian</span>
                  <span aria-hidden>·</span>
                  <span className="font-semibold text-red-700">{reviewTally.negative} kritik</span>
                  <span aria-hidden>·</span>
                  <span>{reviewTally.neutral} netral</span>
                </div>
              </div>

              {visibleReviews.length === 0 ? (
                <p className="rounded-xl bg-cream-100 p-6 text-center text-sm text-navy-600">
                  Tidak ada ulasan pada periode dan saringan yang dipilih.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {visibleReviews.slice(0, reviewLimit).map((rev) => {
                      const isNeg = rev.sentiment === "negative";
                      const isPos = rev.sentiment === "positive";
                      const via = readViaLabel(rev.sourceUrl);
                      return (
                        <article
                          key={rev.id}
                          className={cn(
                            "rounded-2xl border bg-white p-4",
                            isNeg
                              ? "border-red-200 border-l-4 border-l-red-500"
                              : isPos
                                ? "border-emerald-200 border-l-4 border-l-emerald-600"
                                : "border-cream-300",
                          )}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-navy-900">{rev.source}</span>
                              <span className="text-navy-500">
                                · {fmtDateShort(rev.reviewDate)}
                                {via ? ` · ${via}` : ""}
                                {rev.outletName && selectedOutlet === "all" ? ` · ${rev.outletName}` : ""}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
                                  isPos
                                    ? "bg-emerald-50 text-emerald-800"
                                    : isNeg
                                      ? "bg-red-50 text-red-800"
                                      : "bg-cream-200 text-navy-700",
                                )}
                              >
                                {isNeg && <AlertTriangle className="h-3 w-3" aria-hidden />}
                                {isPos && <ThumbsUp className="h-3 w-3" aria-hidden />}
                                {rev.rating > 0 ? `${rev.rating}/5 · ` : ""}
                                {isPos ? "Pujian" : isNeg ? "Perlu Atensi" : "Netral"}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                  rev.verified ? "bg-sky-50 text-sky-800" : "bg-cream-100 text-navy-500",
                                )}
                              >
                                {rev.verified ? "Bersumber" : "Tanpa tautan sumber"}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed text-navy-900">{rev.text}</p>
                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-cream-200 pt-2 text-xs text-navy-500">
                            <div className="flex flex-wrap gap-1">
                              {rev.themes.slice(0, 4).map((t) => (
                                <span key={t} className="rounded bg-cream-100 px-1.5 py-0.5 text-[10px] text-navy-700">
                                  #{t}
                                </span>
                              ))}
                            </div>
                            {rev.sourceUrl && (
                              <a
                                href={rev.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-semibold text-navy-800 underline"
                              >
                                Sumber Asli <ExternalLink className="h-3 w-3" aria-hidden />
                              </a>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {visibleReviews.length > reviewLimit && (
                    <button
                      type="button"
                      onClick={() => setReviewLimit((n) => n + REVIEW_PAGE_SIZE)}
                      className="skeuo-pill-light w-full rounded-full py-2.5 text-xs font-semibold"
                    >
                      Tampilkan {Math.min(REVIEW_PAGE_SIZE, visibleReviews.length - reviewLimit)} ulasan lagi ({reviewLimit} dari{" "}
                      {visibleReviews.length})
                    </button>
                  )}
                </div>
              )}
            </SkeuoCard>
          )}

          {/* LANGKAH 2: SIAPA KOMPETITOR KITA */}
          {(showAll || activeSubTab === "kompetitor") && (
            <SkeuoCard className="space-y-4">
              <div className="flex items-start gap-3 border-b border-cream-300 pb-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-cream-50">
                  2
                </span>
                <div>
                  <h3 className="text-lg font-bold text-navy-900">
                    Siapa kompetitor kita ({outletComparisons.length} kompetitor aktif)
                  </h3>
                  <p className="text-xs text-navy-600">
                    Perbandingan head-to-head fasilitas fisik, karakter visual, keunggulan, celah, dan peluang dalam jarak tempuh paling jauh 25 km.
                  </p>
                </div>
              </div>

              {audit && audit.used.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {audit.used.map((r) => (
                    <li
                      key={r.name}
                      title={r.auditRationale}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold",
                        r.compsetRole === "benchmark"
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : "border-cream-300 bg-cream-50 text-navy-800",
                      )}
                    >
                      {r.name}
                      {r.roadKm != null ? <span className="font-normal text-navy-500"> · {r.roadKm.toLocaleString("id-ID")} km</span> : null}
                    </li>
                  ))}
                </ul>
              )}

              <SnHeadToHeadNarrative narrative={narrative} sources={narrativeSources} />

              {/* Filter Pil Lawan Tanding */}
              {selectedOutlet !== "all" && outletComparisons.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-cream-200 pb-3 text-xs">
                  <span className="mr-1 font-semibold text-navy-600">Lawan Tanding:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCompetitorId("all-competitors")}
                    className={cn(
                      "rounded-full px-3 py-1 font-semibold",
                      selectedCompetitorId === "all-competitors" ? "skeuo-pill-dark" : "border border-cream-300 bg-white text-navy-700",
                    )}
                  >
                    Semua ({outletComparisons.length})
                  </button>
                  {outletComparisons.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCompetitorId(c.id)}
                      className={cn(
                        "rounded-full px-3 py-1 font-semibold",
                        selectedCompetitorId === c.id ? "skeuo-pill-dark" : "border border-cream-300 bg-white text-navy-700",
                      )}
                    >
                      {c.name ?? c.competitorName}
                    </button>
                  ))}
                </div>
              )}

              {/* Profil Titik Acuan Sanghyang Sendiri */}
              {ownEvidence && selectedOutlet !== "all" && (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-navy-600">
                    Profil Unit Bisnis Sanghyang (Titik Acuan)
                  </p>
                  <SnComparisonCard comp={ownEvidence} />
                </div>
              )}

              {activeComparisons.length === 0 ? (
                <p className="rounded-xl bg-cream-100 p-6 text-center text-sm text-navy-600">
                  Belum ada profil kompetitor untuk unit bisnis ini.
                </p>
              ) : (
                <div className="space-y-5">
                  {comparisonGroups.map((group) => (
                    <div key={group.key} className="space-y-2.5">
                      {group.label && (
                        <h4 className="border-b border-cream-200 pb-1 text-sm font-bold text-navy-900">
                          {group.label} ({group.items.length})
                        </h4>
                      )}
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {group.items.map((c) => {
                          const ratingInfo = data.competitorRatings?.find((r) => r.name === (c.name ?? c.competitorName));
                          return <SnComparisonCard key={c.id} comp={c} ratingInfo={ratingInfo} />;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {audit && audit.excluded.length > 0 && (
                <details className="rounded-xl bg-cream-100 p-3 text-xs text-navy-700">
                  <summary className="cursor-pointer font-semibold text-navy-800">
                    Kompetitor yang dikeluarkan dari daftar aktif ({audit.excluded.length} tempat)
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {audit.excluded.map((ex) => (
                      <li key={ex.name}>
                        <strong>{ex.name}</strong>
                        {ex.reason ? `: ${ex.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </SkeuoCard>
          )}

          {/* LANGKAH 3: HARGA KITA VS KOMPETITOR */}
          {(showAll || activeSubTab === "harga") && (
            <div className="space-y-4">
              <SnMarketSharePanel
                isResort={selectedOutlet === "resort"}
                outletName={selectedOutletLabel}
                marketData={marketData}
                marketSize={data.marketSize}
                reviewRows={data.reviewShares?.[selectedOutlet]}
              />

              {marketData && marketData.pricePositioningIndex !== null && (
                <SkeuoCard className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">
                        Indeks Posisi Harga (Price Positioning Index)
                      </p>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-2xl font-extrabold tabular-nums text-navy-900">
                          {marketData.pricePositioningIndex}
                        </span>
                        <span className="text-xs font-semibold text-navy-600">
                          (
                          {marketData.pricePositioningCategory === "Premium-Luxury"
                            ? "Zona Premium"
                            : marketData.pricePositioningCategory === "Value-Leader"
                              ? "Zona Terjangkau"
                              : "Zona Seimbang / Pasar"}
                          )
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <div className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-1.5">
                        <span className="text-navy-500">Pangsa Pasar:</span>{" "}
                        <strong className="text-navy-900">
                          {marketData.marketSharePercentage !== null
                            ? `${marketData.marketSharePercentage.toLocaleString("id-ID")}%`
                            : "Belum ada data"}
                        </strong>
                      </div>
                      <div className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-1.5">
                        <span className="text-navy-500">Segmen:</span>{" "}
                        <strong className="text-navy-900">{marketData.marketSegmentName}</strong>
                      </div>
                      <div className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-1.5">
                        <span className="text-navy-500">Peringkat:</span>{" "}
                        <strong className="text-navy-900">{marketData.marketRank}</strong>
                      </div>
                    </div>
                  </div>

                  {marketData.digitalMarketingStrategy?.pricingOptimization?.currentAnalysis && (
                    <p className="text-xs leading-relaxed text-navy-700">
                      {marketData.digitalMarketingStrategy.pricingOptimization.currentAnalysis}
                    </p>
                  )}
                </SkeuoCard>
              )}

              {allMatrices.length === 0 ? (
                <SkeuoCard>
                  <p className="text-sm text-navy-600">Matriks harga belum tersedia untuk unit bisnis ini.</p>
                </SkeuoCard>
              ) : (
                allMatrices.map((mat) =>
                  mat.kind === "resort" ? (
                    <SnResortMatrixSection key={mat.outletKey} matrix={mat} />
                  ) : (
                    <SnFnbMatrixSection key={mat.outletKey} matrix={mat} />
                  ),
                )
              )}

              <Link
                href={strategyHref("rekomendasi")}
                className="flex items-center justify-between gap-3 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm transition hover:border-navy-500 hover:bg-white"
              >
                <span>
                  <span className="font-semibold text-navy-900">Rekomendasi pemasaran {selectedOutletLabel}</span>
                  <span className="block text-xs text-navy-600">
                    Pilar strategi pemasaran dan formulasi promo tersedia di tab Strategy.
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-navy-700" aria-hidden />
              </Link>
            </div>
          )}

          {/* LANGKAH 4: PROMO & EVENT KOMPETITOR */}
          {(showAll || activeSubTab === "promo") && (
            <SkeuoCard className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cream-300 pb-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-cream-50">
                    4
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-navy-900">Promo &amp; Event Kompetitor ({selectedOutletLabel})</h3>
                    <p className="text-xs text-navy-600">
                      Promo (penawaran harga atau manfaat) dan event (kegiatan bertanggal) Sanghyang maupun kompetitor.
                    </p>
                  </div>
                </div>
                <Link
                  href={strategyHref("radar")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-navy-800 underline hover:text-navy-900"
                >
                  Strategi tanggapan &amp; draf konten <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>

              <SnExtensionPanel sync={extSync} compact outletKey={selectedOutlet} outletLabel={selectedOutletLabel} />

              <div className="space-y-3 rounded-2xl border border-navy-200 bg-cream-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-300 pb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-navy-800" aria-hidden />
                    <h4 className="text-sm font-bold text-navy-900">
                      Promo &amp; Event Berjalan Sanghyang ({selectedOutletLabel})
                    </h4>
                  </div>
                  <div className="flex gap-1.5 text-xs font-semibold">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-800">{ownPromos.promos.length} Promo</span>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-900">{ownPromos.events.length} Event</span>
                  </div>
                </div>
                <p className="text-[11px] text-navy-600">
                  Sumber: {ownPromoSourceSummary([...ownPromos.promos, ...ownPromos.events])}
                </p>

                <div className="space-y-2 rounded-xl border border-cream-300 bg-white p-3">
                  <h5 className="text-xs font-bold text-navy-900">Promo Sanghyang ({ownPromos.promos.length})</h5>
                  {ownPromos.promos.length === 0 ? (
                    <p className="text-xs text-navy-500">Belum ada promo Sanghyang yang berjalan pada periode ini.</p>
                  ) : (
                    <SnPromoTable items={ownPromos.promos} kind="promo" caption="Promo Sanghyang" showDescription />
                  )}
                </div>

                <div className="space-y-2 rounded-xl border border-cream-300 bg-white p-3">
                  <h5 className="text-xs font-bold text-navy-900">Event Sanghyang ({ownPromos.events.length})</h5>
                  {ownPromos.events.length === 0 ? (
                    <p className="text-xs text-navy-500">Belum ada event Sanghyang yang terjadwal pada periode ini.</p>
                  ) : (
                    <SnPromoTable items={ownPromos.events} kind="event" caption="Event Sanghyang" showDescription />
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2 rounded-2xl border border-cream-300 bg-white p-4">
                  <h4 className="text-sm font-bold text-navy-900">Promo Kompetitor ({rivalPromos.promos.length})</h4>
                  {rivalPromos.promos.length === 0 ? (
                    <p className="text-xs text-navy-500">Tidak ada promo kompetitor pada periode terpilih.</p>
                  ) : (
                    <SnPromoTable items={rivalPromos.promos} kind="promo" caption="Promo Kompetitor" />
                  )}
                </div>

                <div className="space-y-2 rounded-2xl border border-cream-300 bg-white p-4">
                  <h4 className="text-sm font-bold text-navy-900">Event Kompetitor ({rivalPromos.events.length})</h4>
                  {rivalPromos.events.length === 0 ? (
                    <p className="text-xs text-navy-500">Tidak ada event kompetitor pada periode terpilih.</p>
                  ) : (
                    <SnPromoTable items={rivalPromos.events} kind="event" caption="Event Kompetitor" />
                  )}
                </div>
              </div>
            </SkeuoCard>
          )}

          {/* LANGKAH 5: LANGKAH MINGGU INI & BERITA */}
          {(showAll || activeSubTab === "langkah") && (
            <div className="space-y-4">
              <SkeuoCard className="space-y-4">
                <div className="flex items-start gap-3 border-b border-cream-300 pb-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-cream-50">
                    5
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-navy-900">Langkah minggu ini ({selectedOutletLabel})</h3>
                    <p className="text-xs text-navy-600">
                      Paling banyak 3 hal prioritas yang dikerjakan tim minggu ini, ditambah rincian langkah eksekusi lengkap.
                    </p>
                  </div>
                </div>

                <SnWeeklyActions findings={weeklyFindings} outletKey={selectedOutlet} />

                {weeklyFindings.length > 0 && (
                  <details className="rounded-2xl border border-cream-300 bg-cream-50 p-3.5 text-xs">
                    <summary className="cursor-pointer font-semibold text-navy-800">
                      Lihat semua catatan temuan &amp; langkah eksekusi ({weeklyFindings.length})
                    </summary>
                    <div className="mt-3 space-y-3">
                      {weeklyFindings.map((f) => {
                        const actionLabel =
                          f.action === "improve" ? "PERBAIKI" : f.action === "investigate" ? "TELUSURI" : "PERTAHANKAN";
                        const actionTone =
                          f.action === "improve"
                            ? "border-red-200 bg-red-50 text-red-800"
                            : f.action === "investigate"
                              ? "border-amber-200 bg-amber-50 text-amber-900"
                              : "border-emerald-200 bg-emerald-50 text-emerald-800";
                        return (
                          <article key={f.id} className="space-y-2.5 rounded-xl border border-cream-300 bg-white p-3.5">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-200 pb-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Target className="h-3.5 w-3.5 text-navy-800" aria-hidden />
                                <h4 className="font-semibold text-navy-900">{f.title}</h4>
                                {f.outletName && selectedOutlet === "all" && (
                                  <span className="rounded bg-cream-200 px-2 py-0.5 text-[10px] font-semibold text-navy-800">
                                    {f.outletName}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", actionTone)}>
                                  {actionLabel}
                                </span>
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                    f.priority === "high" ? "bg-red-100 text-red-800" : "bg-cream-200 text-navy-700",
                                  )}
                                >
                                  Prioritas {f.priority === "high" ? "Tinggi" : "Sedang"}
                                </span>
                              </div>
                            </div>

                            <p className="leading-relaxed text-navy-700">{f.summary}</p>

                            {f.steps && f.steps.length > 0 && (
                              <div className="space-y-1 rounded-xl border border-cream-200 bg-cream-50 p-2.5">
                                <p className="flex items-center gap-1 font-bold text-navy-900">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
                                  Rincian Langkah Eksekusi:
                                </p>
                                <ol className="list-inside list-decimal space-y-0.5 text-[11px] leading-relaxed text-navy-700">
                                  {f.steps.map((step, sidx) => (
                                    <li key={sidx}>{step}</li>
                                  ))}
                                </ol>
                              </div>
                            )}

                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyFinding(
                                    `${f.title}\n\n${f.summary}${
                                      f.steps?.length ? `\n\nLangkah:\n${f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : ""
                                    }`,
                                    f.id,
                                  )
                                }
                                className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold"
                              >
                                {copiedFindingId === f.id ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-700" aria-hidden /> Tersalin
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" aria-hidden /> Salin Aksi
                                  </>
                                )}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </details>
                )}
              </SkeuoCard>

              <SkeuoCard className="space-y-3">
                <div className="border-b border-cream-300 pb-3">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-navy-900">
                    <Newspaper className="h-5 w-5 text-navy-800" aria-hidden />
                    Berita relevan untuk {selectedOutletLabel} ({outletNews.length})
                  </h3>
                  <p className="mt-1 text-xs text-navy-600">
                    {outletNews.length} berita{" "}
                    {data?.range?.label ? `periode ${data.range.label}` : "di periode terpilih"}. Lokasinya dalam radius 25 km dari
                    Sanghyang, dan acara hanya yang berlangsung di periode ini atau paling lambat sebulan sesudahnya.
                  </p>
                </div>

                {outletNews.length === 0 ? (
                  <p className="text-sm text-navy-600">Belum ada berita yang berkaitan dengan {selectedOutletLabel} di periode ini.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-cream-200">
                      {visibleNews.map((n, i) => {
                        const evtDays = newsEventDays(n);
                        const place = newsPlaceLabel(n);
                        return (
                          <li key={`${n.date}|${n.title}|${i}`} className="space-y-1.5 py-3 first:pt-0">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <h4 className="font-semibold text-navy-900">
                                {n.url ? (
                                  <a
                                    href={n.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-start gap-1 hover:underline"
                                  >
                                    {n.title}
                                    <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-navy-500" aria-hidden />
                                  </a>
                                ) : (
                                  n.title
                                )}
                              </h4>
                              <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[11px] font-semibold text-navy-700">
                                {n.category}
                              </span>
                            </div>
                            <p className="text-xs text-navy-500">
                              {n.source} · {fmtDateShort(n.date)}
                            </p>
                            {n.summary && <p className="text-sm leading-relaxed text-navy-800">{n.summary}</p>}
                            {(evtDays || place || n.reason) && (
                              <dl className="grid gap-x-4 gap-y-0.5 text-xs text-navy-600 sm:grid-cols-[auto_1fr]">
                                {evtDays && (
                                  <>
                                    <dt className="font-semibold text-navy-800">Tanggal acara</dt>
                                    <dd>{evtDays}</dd>
                                  </>
                                )}
                                {place && (
                                  <>
                                    <dt className="font-semibold text-navy-800">Lokasi</dt>
                                    <dd>{place}</dd>
                                  </>
                                )}
                                {n.reason && (
                                  <>
                                    <dt className="font-semibold text-navy-800">Kaitan</dt>
                                    <dd>{n.reason}</dd>
                                  </>
                                )}
                              </dl>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {outletNews.length > NEWS_FIRST_PAGE && (
                      <button
                        type="button"
                        aria-expanded={showAllNews}
                        onClick={() => setShowAllNews((v) => !v)}
                        className="text-sm font-semibold text-navy-800 underline hover:text-navy-900"
                      >
                        {showAllNews ? "Tampilkan lebih sedikit" : `Tampilkan semua ${outletNews.length} berita`}
                      </button>
                    )}
                  </>
                )}
              </SkeuoCard>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
