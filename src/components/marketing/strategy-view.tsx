"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  Gift,
  Globe,
  Lightbulb,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Tags,
  Target,
  X,
} from "lucide-react";
import { SkeuoCard, StatusPill } from "@/components/skeuo/ui";
import {
  OUTLET_TABS,
  PROMOTION_TYPE_INFO,
  activeRoomPromos,
  buildOutletActionPlan,
  computeResortReputation,
  counterStrategyFor,
  deepestCompetitorDiscount,
  fmtCompactRupiah,
  fmtDateShort,
  formatMarketingClientError,
  groupPromosByCompetitor,
  isPromoEvent,
  isPromotionType,
  marketingApiErrorFromResponse,
  ownPromoMatchesOutletKey,
  ownPromoSourceSummary,
  priceVerdict,
  promoMatchesOutletKey,
  promoPeriodText,
  promoPriceDiscountText,
  promotionTypeLabel,
  sanitizeStrategyText,
  sentimentVerdict,
  verifiedFeedback,
  visibleMarketRank,
  type OutletChoice,
  type SnGeneratedDraft,
  type SnOutletReview,
  type SnRadarPromo,
  type SnSummary,
} from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";
import { SnKnowledgeRecommendations } from "./sn-knowledge-recommendations";
import { SnOutletSelector } from "./sn-outlet-selector";
import { SnPromoTable } from "./sn-promo-table";

export type StrategySubTab = "semua" | "rekomendasi" | "radar";

const STATUS_LABELS: Record<string, string> = {
  all: "Semua",
  active: "Aktif",
  upcoming: "Segera datang",
  expired: "Sudah berakhir",
};

const SOURCE_LINK_LABEL: Record<string, string> = {
  website: "Buka situs resmi",
  instagram: "Buka postingan Instagram",
  tiktok: "Buka postingan TikTok",
  facebook: "Buka postingan Facebook",
};

const MAX_COMPLAINTS = 5;
const MAX_PRAISES = 3;
const QUOTE_LENGTH = 150;

const shortQuote = (text: string) => (text.length > QUOTE_LENGTH ? `${text.slice(0, QUOTE_LENGTH).trimEnd()}…` : text);
const shortHotelName = (name: string) => name.split(" ").slice(0, 2).join(" ");
const fmtDec = (n: number) => n.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function VerifiedReviewEvidence({ reviews }: { reviews: readonly SnOutletReview[] }) {
  const fb = verifiedFeedback(reviews);
  if (fb.total === 0) {
    return (
      <p className="text-xs text-navy-600">
        Belum ada ulasan terverifikasi dalam periode terpilih untuk unit bisnis ini.
      </p>
    );
  }
  return (
    <div className="space-y-2 text-xs">
      {fb.complaints.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-2.5">
          <p className="font-bold text-red-800">
            Keluhan nyata ({fb.complaints.length} dari {fb.total} ulasan bersumber)
          </p>
          <ul className="mt-1 space-y-1 text-red-950">
            {fb.complaints.slice(0, MAX_COMPLAINTS).map((r) => (
              <li key={r.id}>
                &ldquo;{shortQuote(r.text)}&rdquo;{" "}
                <span className="text-[11px] text-red-800/80">
                  ({r.source}
                  {r.rating > 0 ? `, ${r.rating}/5` : ""})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fb.praises.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5">
          <p className="font-bold text-emerald-900">Pujian nyata</p>
          <ul className="mt-1 space-y-1 text-emerald-950">
            {fb.praises.slice(0, MAX_PRAISES).map((r) => (
              <li key={r.id}>
                &ldquo;{shortQuote(r.text)}&rdquo;{" "}
                <span className="text-[11px] text-emerald-800/80">
                  ({r.source}
                  {r.rating > 0 ? `, ${r.rating}/5` : ""})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Tab Strategy Sanghyang Analytics:
 * Rekomendasi dari semua faktor / ringkasan lintas outlet, Rekomendasi Pemasaran 5 pilar Resort & 4 pilar F&B,
 * serta Radar Promo Kompetitor, Strategi Tanggapan, dan Pembuat Draf Konten — TANPA Omset dan TANPA Target).
 */
export function StrategyView({
  startDate,
  endDate,
  isCustomRange,
  activeSubTab,
  initialOutlet,
}: {
  startDate: string;
  endDate: string;
  isCustomRange: boolean;
  activeSubTab: StrategySubTab;
  initialOutlet?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlOutletRaw = searchParams.get("outlet") ?? initialOutlet;
  const urlOutlet: OutletChoice = OUTLET_TABS.some((t) => t.key === urlOutletRaw)
    ? (urlOutletRaw as OutletChoice)
    : "resort";
  const [outletOverride, setOutletOverride] = useState<{ base: OutletChoice; value: OutletChoice } | null>(null);
  const selectedOutlet: OutletChoice =
    outletOverride && outletOverride.base === urlOutlet ? outletOverride.value : urlOutlet;
  const [summary, setSummary] = useState<SnSummary | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kindTab, setKindTab] = useState<"promo" | "event">("promo");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "upcoming" | "expired">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [draftModal, setDraftModal] = useState<{ title: string; draft: SnGeneratedDraft } | null>(null);
  // Judul draf yang pernah dibuat per promo; dikirim lagi supaya klik berikutnya menghasilkan versi yang berbeda.
  const [draftHeadlines, setDraftHeadlines] = useState<Record<string, string[]>>({});
  const [draftTab, setDraftTab] = useState<"reels" | "tiktok" | "carousel">("reels");
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDraftModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draftModal]);

  const queryKey = isCustomRange
    ? `period=30d&from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`
    : "period=30d";
  const loading = loadedQuery !== queryKey;

  useEffect(() => {
    let live = true;
    fetch(`/api/market-intelligence/summary?${queryKey}&segment=all`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as (SnSummary & { error?: string }) | null;
        if (!res.ok || !json || !Array.isArray(json.outlets)) {
          throw marketingApiErrorFromResponse(res.status, json?.error);
        }
        return json;
      })
      .then((json) => {
        if (!live) return;
        setSummary(json);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(
          formatMarketingClientError(
            err,
            (detail) => `Data Strategy tidak dapat dimuat (${detail}). Coba muat ulang halaman beberapa saat lagi.`,
          ),
        );
      })
      .finally(() => {
        if (live) setLoadedQuery(queryKey);
      });
    return () => {
      live = false;
    };
  }, [queryKey]);

  const handleSelectOutlet = (key: OutletChoice) => {
    setOutletOverride({ base: urlOutlet, value: key });
    const next = new URLSearchParams(searchParams.toString());
    next.set("bagian", "strategy");
    next.set("lihat", activeSubTab);
    next.set("outlet", key);
    if (isCustomRange) {
      next.set("startDate", startDate);
      next.set("endDate", endDate);
    }
    router.replace(`/marketing?${next.toString()}`, { scroll: false });
  };

  const outletLabel = OUTLET_TABS.find((t) => t.key === selectedOutlet)?.label ?? "Semua Outlet";
  const market = summary?.outletMarketShare?.[selectedOutlet] ?? null;
  const strategy = market?.digitalMarketingStrategy ?? null;
  const isResort = selectedOutlet === "resort";

  const verifiedReviews = useMemo(() => {
    const outlets = summary?.outlets ?? [];
    if (selectedOutlet === "all") return outlets.flatMap((o) => o.verifiedReviews ?? []);
    return outlets.find((o) => o.key === selectedOutlet)?.verifiedReviews ?? [];
  }, [summary?.outlets, selectedOutlet]);

  const actionPlan = useMemo(
    () => (summary && selectedOutlet !== "all" ? buildOutletActionPlan(summary, selectedOutlet) : []),
    [summary, selectedOutlet],
  );

  const resortReputation = useMemo(() => (summary && isResort ? computeResortReputation(summary) : null), [summary, isResort]);
  const resortRoomPromos = useMemo(
    () => (summary && isResort ? activeRoomPromos(summary.competitorSocialRadar ?? []) : []),
    [summary, isResort],
  );
  const deepestDiscount = useMemo(
    () => (summary && isResort ? deepestCompetitorDiscount(summary.competitorSocialRadar ?? []) : null),
    [summary, isResort],
  );

  const resortDiagnosis = useMemo(() => {
    if (!summary || !isResort || !market) return [];
    const items: { title: string; text: string }[] = [];
    const ppi = market.pricePositioningIndex;
    const cheapest = summary.competitorMatrix?.resort?.cheapestComparison;
    if (ppi !== null) {
      const wdPrice = cheapest?.weekday?.sanghyang?.priceLabel;
      const wePrice = cheapest?.weekend?.sanghyang?.priceLabel;
      items.push({
        title: ppi < 90 ? "Harga di bawah koridor pasar bintang 4" : ppi > 110 ? "Harga di atas koridor pasar bintang 4" : "Harga seimbang dengan koridor bintang 4",
        text: `${
          wdPrice || wePrice
            ? `Penawaran OTA termurah Sanghyang ${wdPrice ?? "belum ada data"} (hari biasa) dan ${wePrice ?? "belum ada data"} (akhir pekan). `
            : ""
        }Indeks harga ${ppi}: harga Sanghyang sekitar ${Math.round(ppi)}% dari rata-rata kamar setara di hotel bintang 4.`,
      });
    }
    if (resortReputation) {
      items.push({
        title: resortReputation.meetsMedian ? "Kualitas setara pasar, ruang optimalisasi harga terbuka" : "Kualitas mendekati median pasar bintang 4",
        text: `Rating Google ${fmtDec(resortReputation.sanghyang)} di peringkat ${resortReputation.rank} dari ${resortReputation.total} hotel bintang 4 pembanding (median ${fmtDec(resortReputation.median)}).`,
      });
    }
    const fb = verifiedFeedback(verifiedReviews);
    if (fb.complaints.length > 0) {
      items.push({
        title: "Keluhan nyata perlu dituntaskan sebelum menaikkan harga",
        text: `${fb.complaints.length} dari ${fb.total} ulasan terverifikasi bernilai 3 ke bawah. Perbaikan operasional dan respons cepat menjaga rating saat harga naik.`,
      });
    }
    if (deepestDiscount !== null) {
      items.push({
        title: "Kompetitor sedang berpromo diskon kamar",
        text: `Diskon kamar kompetitor terdalam mencapai ${deepestDiscount}%. Balas lewat paket nilai tambah (Hot Spring Aquamedic, F&B, late check-out) daripada memotong harga di bawah lantai P25.`,
      });
    }
    return items;
  }, [summary, isResort, market, resortReputation, verifiedReviews, deepestDiscount]);

  const ownBuckets = useMemo(() => {
    const list = (summary?.ownPromos ?? []).filter(
      (p) =>
        ownPromoMatchesOutletKey(p, selectedOutlet) &&
        (statusFilter === "all" ? (summary?.range?.custom ? true : p.status !== "expired") : p.status === statusFilter),
    );
    return {
      promos: list.filter((p) => !isPromoEvent(p)),
      events: list.filter((p) => isPromoEvent(p)),
    };
  }, [summary?.ownPromos, summary?.range?.custom, selectedOutlet, statusFilter]);

  const rivalItems = useMemo(() => {
    const list = (summary?.competitorSocialRadar ?? []).filter((p) => !p.isOwn && promoMatchesOutletKey(p, selectedOutlet));
    return {
      allPromos: list.filter((p) => !isPromoEvent(p)),
      allEvents: list.filter((p) => isPromoEvent(p)),
    };
  }, [summary?.competitorSocialRadar, selectedOutlet]);

  const groupedRivals = useMemo(() => {
    const source = kindTab === "event" ? rivalItems.allEvents : rivalItems.allPromos;
    const filtered = statusFilter === "all" ? source : source.filter((p) => p.status === statusFilter);
    return groupPromosByCompetitor(filtered);
  }, [rivalItems, kindTab, statusFilter]);

  const visibleRivalCount = useMemo(
    () => groupedRivals.reduce((sum, g) => sum + g.promos.length, 0),
    [groupedRivals],
  );

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000);
    } catch {
      setDraftError("Teks tidak dapat disalin otomatis. Salin secara manual.");
    }
  };

  const handleGenerateDraft = async (promo: SnRadarPromo, counterText: string) => {
    setGeneratingId(promo.id);
    setDraftError(null);
    try {
      const res = await fetch("/api/market-intelligence/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorName: promo.competitorName,
          promoTitle: promo.title,
          promoCategory: promo.category ?? "Promo",
          counterStrategy: counterText,
          outletName: outletLabel,
          previousHeadlines: draftHeadlines[promo.id] ?? [],
        }),
      });
      const json = (await res.json().catch(() => null)) as { data?: SnGeneratedDraft; error?: string } | null;
      if (!res.ok || !json?.data) {
        throw marketingApiErrorFromResponse(res.status, json?.error);
      }
      setDraftTab("reels");
      setDraftModal({ title: `${promo.competitorName}: ${promo.title}`, draft: json.data });
      const made = [json.data.reels?.headline, json.data.tiktok?.headline, json.data.carousel?.headline].filter((h): h is string => Boolean(h));
      setDraftHeadlines((prev) => ({ ...prev, [promo.id]: [...(prev[promo.id] ?? []), ...made].slice(-9) }));
    } catch (err) {
      setDraftError(formatMarketingClientError(err, (detail) => `Draf konten belum bisa dibuat: ${detail}`));
    } finally {
      setGeneratingId(null);
    }
  };

  const showRekomendasi = activeSubTab === "semua" || activeSubTab === "rekomendasi";
  const showRadar = activeSubTab === "semua" || activeSubTab === "radar";

  return (
    <div className="space-y-4">
      <SkeuoCard>
        <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Ruang Strategi Outlet</p>
        <h2 className="mt-0.5 text-xl font-bold text-navy-900">Strategy Pemasaran: {outletLabel}</h2>
        <p className="mt-0.5 text-sm text-navy-600">
          Periode aktif:{" "}
          <strong className="text-navy-900">
            {summary?.range?.label ?? `${fmtDateShort(startDate)} – ${fmtDateShort(endDate)}`}
          </strong>{" "}
          · Rekomendasi lintas faktor, pilar pemasaran digital, radar promo &amp; event kompetitor, strategi tanggapan, dan draf konten.
        </p>
      </SkeuoCard>

      <SnOutletSelector
        selectedOutlet={selectedOutlet}
        outlets={summary?.outlets ?? []}
        summary={summary}
        onSelectOutlet={handleSelectOutlet}
        title="Pilih unit bisnis untuk strategi pemasaran"
        description="Klik salah satu outlet untuk menyaring rekomendasi lintas faktor, pilar pemasaran, promo Sanghyang, dan radar promo kompetitor."
      />

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      {loading && !summary && (
        <SkeuoCard className="flex items-center justify-center gap-2 py-12 text-navy-600">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Memuat strategi pemasaran…
        </SkeuoCard>
      )}

      {/* BAGIAN 1: REKOMENDASI DARI SEMUA FAKTOR / RINGKASAN 6 UNIT BISNIS (TANPA OMSET & TARGET) */}
      {summary && showRekomendasi && (
        <SkeuoCard className="space-y-4">
          <div className="border-b border-cream-300 pb-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Fokus Strategi Periode Ini</p>
            <h3 className="mt-0.5 text-lg font-semibold text-navy-900">
              {selectedOutlet === "all"
                ? "Ringkasan posisi strategis 6 unit bisnis"
                : `Rekomendasi dari semua faktor (${outletLabel})`}
            </h3>
            <p className="mt-0.5 text-xs text-navy-600">
              {selectedOutlet === "all"
                ? "Klik nama unit bisnis untuk melihat rencana aksi detail dan pilar pemasarannya."
                : "Disusun dari ulasan tamu, rating Google, harga/pasar, promo Sanghyang, promo kompetitor, dan berita relevan pada periode terpilih."}
            </p>
          </div>

          {selectedOutlet === "all" ? (
            <div className="relative overflow-x-auto rounded-2xl border border-cream-300 bg-white">
              <table className="w-full min-w-[46rem] text-left text-xs">
                <thead className="border-b border-cream-300 bg-cream-100 text-navy-700">
                  <tr>
                    <th scope="col" className="px-3.5 py-2.5 font-semibold">Outlet</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Rating Google</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Sentimen Ulasan</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Indeks Harga</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Pangsa Pasar</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Promo Kompetitor</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Temuan Prioritas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream-200">
                  {OUTLET_TABS.filter((t) => t.key !== "all").map((tab) => {
                    const outlet = summary.outlets.find((o) => o.key === tab.key);
                    const m = summary.outletMarketShare?.[tab.key];
                    const sent = outlet
                      ? sentimentVerdict(outlet.sentimentDistribution.positive, outlet.sentimentDistribution.total, outlet.sentimentDistribution.negative)
                      : null;
                    const pv = priceVerdict(m?.pricePositioningIndex);
                    const rivalActive = (summary.competitorSocialRadar ?? []).filter(
                      (p) => !p.isOwn && p.status === "active" && promoMatchesOutletKey(p, tab.key),
                    ).length;
                    const improveCount = (outlet?.findings ?? []).filter((f) => f.action !== "maintain").length;
                    return (
                      <tr key={tab.key} className="hover:bg-cream-50">
                        <td className="px-3.5 py-2.5">
                          <button
                            type="button"
                            onClick={() => handleSelectOutlet(tab.key)}
                            className="text-left font-bold text-navy-900 underline-offset-2 hover:underline"
                          >
                            {tab.label}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-semibold tabular-nums text-navy-900">
                          {outlet?.rating != null
                            ? `${outlet.rating.toLocaleString("id-ID")} (${outlet.reviewCount.toLocaleString("id-ID")})`
                            : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {sent?.pct != null ? (
                            <span
                              className={cn(
                                "inline-block rounded-full px-2 py-0.5 text-[11px] font-bold",
                                sent.tone === "good"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : sent.tone === "warn"
                                    ? "bg-amber-100 text-amber-900"
                                    : sent.tone === "bad"
                                      ? "bg-red-100 text-red-800"
                                      : "bg-cream-200 text-navy-700",
                              )}
                            >
                              {sent.pct}% positif · {outlet?.sentimentDistribution.total ?? 0} ulasan
                            </span>
                          ) : (
                            <span className="text-navy-500">Belum ada ulasan</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {m?.pricePositioningIndex != null ? `${m.pricePositioningIndex} · ${pv.label}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 font-semibold tabular-nums text-navy-900">
                          {m?.marketSharePercentage != null ? `${m.marketSharePercentage.toLocaleString("id-ID")}%` : "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-navy-700">{rivalActive} aktif</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-[11px] font-bold",
                              improveCount > 0 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800",
                            )}
                          >
                            {improveCount > 0 ? `${improveCount} perlu tindakan` : "Aman"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-cream-200 rounded-2xl border border-cream-300 bg-white px-4">
              {actionPlan.map((item) => (
                <li key={`${item.factor}|${item.finding}`} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                  <span className="text-xs font-bold uppercase tracking-wide text-navy-800">{item.factor}</span>
                  <div className="space-y-1 text-sm">
                    <p className="text-navy-900">{item.finding}</p>
                    <p className="text-xs leading-relaxed text-navy-600">
                      <strong className="text-navy-900">Langkah:</strong> {item.action}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SkeuoCard>
      )}

      {/* BAGIAN 1B: REKOMENDASI DARI KNOWLEDGE GRAPH (kesimpulan analisis_graf, disusun ulang tiap Perbarui Semua Data) */}
      {summary && showRekomendasi && selectedOutlet !== "all" && (
        <SnKnowledgeRecommendations analysis={summary.outletAnalyses?.[selectedOutlet]} outletLabel={outletLabel} />
      )}

      {/* BAGIAN 2: REKOMENDASI PEMASARAN (5 PILAR RESORT / 4 PILAR F&B) */}
      {summary && showRekomendasi && (
        <SkeuoCard className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-300 pb-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Strategi Digital Marketing</p>
              <h3 className="mt-0.5 text-lg font-semibold text-navy-900">
                Rekomendasi Pemasaran untuk Mendongkrak Pangsa Pasar ({outletLabel})
              </h3>
              {market && (
                <p className="text-xs text-navy-600">
                  {market.marketSegmentName}
                  {visibleMarketRank(market.marketRank) ? ` · ${visibleMarketRank(market.marketRank)}` : ""} · Berdasarkan situs resmi, ulasan terverifikasi, tarif OTA, dan radar promo kompetitor.
                </p>
              )}
            </div>
            {market?.pricePositioningCategory && (
              <StatusPill tone="muted">Posisi Harga: {market.pricePositioningCategory}</StatusPill>
            )}
          </div>

          {!strategy ? (
            <p className="rounded-xl bg-cream-100 p-6 text-center text-sm text-navy-600">
              Data rekomendasi pemasaran untuk {outletLabel} belum tersedia.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Diagnosis Utama Khusus Resort */}
              {isResort && resortDiagnosis.length > 0 && (
                <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                  <p className="text-sm font-bold text-amber-950">Diagnosis utama Kamar &amp; Resort</p>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    {resortDiagnosis.map((d) => (
                      <div key={d.title} className="rounded-xl border border-amber-200/80 bg-white/90 p-3 text-xs text-navy-800">
                        <p className="font-bold text-navy-900">{d.title}</p>
                        <p className="mt-1 leading-relaxed text-navy-700">{d.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Pilar 1: Optimasi Harga */}
                <article className={cn("space-y-2.5 rounded-2xl border border-cream-300 bg-white p-4", isResort && "lg:col-span-2")}>
                  <h4 className="flex items-center gap-2 border-b border-cream-200 pb-2 text-sm font-bold text-navy-900">
                    <Tags className="h-4 w-4 text-navy-800" aria-hidden />
                    Pilar 1: {strategy.pricingOptimization.title}
                  </h4>
                  <p className="text-sm leading-relaxed text-navy-700">
                    {sanitizeStrategyText(strategy.pricingOptimization.currentAnalysis)}
                  </p>
                  {strategy.pricingOptimization.recommendationItems?.length ? (
                    <div className="space-y-3 rounded-xl bg-cream-100 p-3 text-sm text-navy-900">
                      <p className="font-bold">Langkah per tipe kamar</p>
                      {strategy.pricingOptimization.recommendationItems.map((item) => (
                        <div key={item.room}>
                          <p className="font-semibold">{sanitizeStrategyText(item.room)}</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed text-navy-800">
                            {item.lines.map((line) => (
                              <li key={line}>{sanitizeStrategyText(line)}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-cream-100 p-3 text-sm font-medium text-navy-900">
                      <strong>Langkah:</strong> {sanitizeStrategyText(strategy.pricingOptimization.recommendation)}
                    </p>
                  )}
                  {isResort && (
                    <div className="rounded-xl border border-cream-200 bg-cream-50 p-3 text-xs text-navy-700">
                      <p className="font-bold uppercase tracking-wide text-navy-900">Syarat naik ke Fase 2</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        <li>
                          {resortReputation
                            ? `Rating Google >= ${fmtDec(resortReputation.median)} (median hotel bintang 4; saat ini ${fmtDec(resortReputation.sanghyang)}) melalui perbaikan Pilar 2.`
                            : "Rating Google meningkat setelah keluhan utama di Pilar 2 dituntaskan."}
                        </li>
                        {strategy.financialProjection?.breakEvenOccupancyDropPercent !== undefined && (
                          <li>
                            Okupansi setelah Fase 1 tidak turun lebih dari{" "}
                            {strategy.financialProjection.breakEvenOccupancyDropPercent.toLocaleString("id-ID")}% (batas aman penurunan okupansi).
                          </li>
                        )}
                        <li>Harga tiap tipe kamar sudah konsisten (paritas Rp 0 selisih) di seluruh kanal OTA (Pilar 5).</li>
                      </ul>
                    </div>
                  )}
                </article>

                {/* Pilar 2: Sentimen & Reputasi */}
                <article className="space-y-3 rounded-2xl border border-cream-300 bg-white p-4">
                  <h4 className="flex items-center gap-2 border-b border-cream-200 pb-2 text-sm font-bold text-navy-900">
                    <Star className="h-4 w-4 text-amber-600" aria-hidden />
                    Pilar 2: {strategy.sentimentLeverage.title}
                  </h4>

                  {isResort && resortReputation && (
                    <div className="space-y-1">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-navy-600">
                        Rating Google vs hotel bintang 4 pembanding
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { name: "Sanghyang", rating: resortReputation.sanghyang, self: true },
                          ...resortReputation.peers.map((p) => ({ name: shortHotelName(p.name), rating: p.rating, self: false })),
                        ]
                          .sort((a, b) => b.rating - a.rating)
                          .map((p) => (
                            <span
                              key={p.name}
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                                p.self ? "bg-navy-900 text-cream-50" : "bg-cream-200 text-navy-800",
                              )}
                            >
                              {p.name} {fmtDec(p.rating)}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}

                  <VerifiedReviewEvidence reviews={verifiedReviews} />

                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-xl bg-emerald-50/80 p-2.5">
                      <p className="font-semibold text-emerald-800">Keunggulan resmi untuk diamplifikasi</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-emerald-950">
                        {strategy.sentimentLeverage.positiveDrivers.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-xl bg-ember-50/80 p-2.5">
                      <p className="font-semibold text-ember-700">Gesekan tamu (perlu perbaikan)</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ember-700">
                        {strategy.sentimentLeverage.negativeFriction.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {isResort && (
                    <ol className="list-decimal space-y-1 pl-5 text-xs text-navy-700">
                      <li>Tuntaskan keluhan berulang sebelum menaikkan harga: checklist housekeeping harian, perawatan bangunan dan kolam, serta SOP respons staf.</li>
                      <li>Balas setiap ulasan negatif di Google &amp; OTA maksimal 1x24 jam dengan solusi konkret.</li>
                      <li>Minta ulasan tamu puas saat check-out (QR Google Review) untuk mendorong rating di atas median bintang 4.</li>
                    </ol>
                  )}

                  <p className="text-xs font-medium text-navy-900">
                    <strong>Angle pemasaran:</strong> {sanitizeStrategyText(strategy.sentimentLeverage.marketingAngle)}
                  </p>
                </article>

                {/* Pilar 3: Tanggapan Promo Kompetitor */}
                <article className="space-y-3 rounded-2xl border border-cream-300 bg-white p-4">
                  <h4 className="flex items-center gap-2 border-b border-cream-200 pb-2 text-sm font-bold text-navy-900">
                    <ShieldCheck className="h-4 w-4 text-navy-800" aria-hidden />
                    Pilar 3: {strategy.competitorCounterPromo.title}
                  </h4>
                  <p className="text-sm leading-relaxed text-navy-700">
                    <strong>Langkah Kompetitor:</strong> {sanitizeStrategyText(strategy.competitorCounterPromo.competitorAction)}
                  </p>
                  {isResort && resortRoomPromos.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950">
                      <p className="font-bold uppercase tracking-wide">Promo kamar kompetitor yang aktif</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {resortRoomPromos.map((p) => (
                          <li key={p.id}>
                            {shortHotelName(p.competitorName)}: {p.title}
                            {typeof p.discount === "number" && p.discount > 0 && <strong> ({p.discount}%)</strong>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="rounded-xl bg-cream-100 p-3 text-sm font-medium text-navy-900">
                    <strong>Strategi Tanggapan Sanghyang:</strong> {sanitizeStrategyText(strategy.competitorCounterPromo.ourCounterStrategy)}
                  </p>
                </article>

                {/* Pilar 4: Formulasi Promo Tepat Sasaran */}
                <article className="space-y-2.5 rounded-2xl border border-cream-300 bg-white p-4">
                  <h4 className="flex items-center gap-2 border-b border-cream-200 pb-2 text-sm font-bold text-navy-900">
                    <Gift className="h-4 w-4 text-navy-800" aria-hidden />
                    Pilar 4: Formulasi promo tepat sasaran
                  </h4>
                  <p className="text-base font-semibold text-navy-900">{strategy.promoFormulation.promoName}</p>
                  <p className="text-sm italic text-navy-700">&ldquo;{strategy.promoFormulation.headline}&rdquo;</p>
                  <dl className="grid grid-cols-1 gap-1.5 text-xs text-navy-700">
                    <div>
                      <dt className="inline font-semibold text-navy-900">Mekanisme: </dt>
                      <dd className="inline">{strategy.promoFormulation.discountStructure}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-navy-900">Target tamu: </dt>
                      <dd className="inline">{strategy.promoFormulation.targetAudience}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-navy-900">Syarat: </dt>
                      <dd className="inline">{strategy.promoFormulation.terms}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-navy-900">Lintas outlet: </dt>
                      <dd className="inline">{strategy.promoFormulation.crossSellingOutlet}</dd>
                    </div>
                  </dl>
                </article>

                {/* Pilar 5 Khusus Resort: Kanal OTA, Paritas Harga & Reservasi Langsung */}
                {isResort && (
                  <article className="space-y-2.5 rounded-2xl border border-cream-300 bg-white p-4 lg:col-span-2">
                    <h4 className="flex items-center gap-2 border-b border-cream-200 pb-2 text-sm font-bold text-navy-900">
                      <Globe className="h-4 w-4 text-navy-800" aria-hidden />
                      Pilar 5: Kanal OTA, paritas harga, dan reservasi langsung
                    </h4>
                    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-navy-700">
                      <li>Samakan harga tiap tipe kamar di semua OTA lewat channel manager; tutup penawaran yang jatuh di bawah lantai harga P25.</li>
                      <li>Reservasi langsung (WhatsApp/website) memakai harga setara OTA plus nilai tambah (voucher Hot Spring Aquamedic, late check-out), bukan potongan harga.</li>
                      <li>Perbarui listing OTA per tipe kamar: foto kamar terbaru, deskripsi Hot Spring Aquamedic dan fasilitas resmi, serta balasan ulasan agar konversi naik saat harga dinaikkan.</li>
                    </ol>
                  </article>
                )}
              </div>

              {/* Indikator Mingguan Resort (Tanpa Nominal Omset Pembukuan) */}
              {isResort && (
                <div className="space-y-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 text-xs text-emerald-950">
                  <p className="text-sm font-bold text-emerald-900">Indikator mingguan &amp; pagar keamanan strategi</p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-xl border border-emerald-200 bg-white px-3.5 py-2.5">
                      <span className="block text-[11px] font-semibold text-navy-600">Batas aman penurunan okupansi</span>
                      <span className="mt-0.5 block text-base font-bold tabular-nums text-navy-900">
                        {strategy.financialProjection?.breakEvenOccupancyDropPercent !== undefined
                          ? `${strategy.financialProjection.breakEvenOccupancyDropPercent.toLocaleString("id-ID")}%`
                          : "Belum ada data"}
                      </span>
                      <span className="block text-[11px] text-navy-600">
                        Batas rem okupansi saat penyesuaian tarif dilakukan bertahap.
                      </span>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-white px-3.5 py-2.5">
                      <span className="block text-[11px] font-semibold text-navy-600">Pangsa pasar kamar resort</span>
                      <span className="mt-0.5 block text-base font-bold tabular-nums text-navy-900">
                        {market?.marketSharePercentage != null
                          ? `${market.marketSharePercentage.toLocaleString("id-ID")}%`
                          : "Belum ada data"}
                      </span>
                      <span className="block text-[11px] text-navy-600">
                        Estimasi ukuran pasar kawasan: {fmtCompactRupiah(market?.totalMarketSizeEstimated)} per bulan.
                      </span>
                    </div>
                  </div>
                  <p className="leading-relaxed">
                    <strong>KPI mingguan:</strong> Harga bersih tiap tipe kamar tidak di bawah lantai P25 di semua OTA ·
                    {strategy.financialProjection?.breakEvenOccupancyDropPercent !== undefined
                      ? ` okupansi tidak turun >${strategy.financialProjection.breakEvenOccupancyDropPercent.toLocaleString("id-ID")}% ·`
                      : ""}{" "}
                    rating Google {resortReputation ? `menuju >= ${fmtDec(resortReputation.median)}` : "meningkat"} · selisih harga kamar yang sama antar OTA = Rp 0.
                  </p>
                </div>
              )}
            </div>
          )}
        </SkeuoCard>
      )}

      {/* BAGIAN 3: RADAR PROMO & EVENT KOMPETITOR + DRAF KONTEN */}
      {summary && showRadar && (
        <SkeuoCard className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cream-300 pb-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">
                Radar promo media sosial &amp; draf kampanye
              </p>
              <h3 className="mt-0.5 text-lg font-semibold text-navy-900">
                Promo &amp; event kompetitor ({outletLabel})
              </h3>
              <p className="mt-0.5 text-xs text-navy-600">
                Promo adalah penawaran harga atau manfaat; event adalah kegiatan terjadwal atau dokumentasi acara. Keduanya dikelompokkan per kompetitor.
              </p>
            </div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
              {visibleRivalCount} {kindTab === "event" ? "event" : "promo"} dari {groupedRivals.length} kompetitor
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="skeuo-inset flex gap-1 p-1 text-xs" role="group" aria-label="Pilih promo atau event">
              <button
                type="button"
                onClick={() => setKindTab("promo")}
                aria-pressed={kindTab === "promo"}
                className={cn("rounded-full px-3 py-1 font-semibold", kindTab === "promo" ? "skeuo-pill-dark" : "text-navy-600")}
              >
                Promo ({rivalItems.allPromos.length})
              </button>
              <button
                type="button"
                onClick={() => setKindTab("event")}
                aria-pressed={kindTab === "event"}
                className={cn("rounded-full px-3 py-1 font-semibold", kindTab === "event" ? "skeuo-pill-dark" : "text-navy-600")}
              >
                Events ({rivalItems.allEvents.length})
              </button>
            </div>

            <div className="skeuo-inset flex flex-wrap gap-1 p-1 text-xs" role="group" aria-label="Saring status promo">
              {(["all", "active", "upcoming", "expired"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                  className={cn("rounded-full px-3 py-1 font-semibold", statusFilter === s ? "skeuo-pill-dark" : "text-navy-600")}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {draftError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-800">
              {draftError}
            </p>
          )}

          {/* Promo & Event Berjalan Sanghyang (2 tabel terpisah + baris sumber) */}
          <div className="space-y-3 rounded-2xl border border-navy-200 bg-cream-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-300 pb-2">
              <h4 className="text-sm font-bold text-navy-900">Promo &amp; Event Berjalan Sanghyang ({outletLabel})</h4>
              <div className="flex gap-1.5 text-xs font-semibold">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-800">{ownBuckets.promos.length} Promo</span>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-amber-900">{ownBuckets.events.length} Event</span>
              </div>
            </div>
            <p className="text-[11px] text-navy-600">
              Sumber: {ownPromoSourceSummary([...ownBuckets.promos, ...ownBuckets.events])}
            </p>
            <div className="space-y-2 rounded-xl border border-cream-300 bg-white p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-navy-900">
                <Tag className="h-3.5 w-3.5" aria-hidden /> Promo Sanghyang ({ownBuckets.promos.length})
              </p>
              {ownBuckets.promos.length === 0 ? (
                <p className="text-xs text-navy-500">Belum ada promo Sanghyang untuk saringan status ini.</p>
              ) : (
                <SnPromoTable items={ownBuckets.promos} kind="promo" caption={`Promo Sanghyang (${outletLabel})`} showDescription />
              )}
            </div>
            <div className="space-y-2 rounded-xl border border-cream-300 bg-white p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-navy-900">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Event Sanghyang ({ownBuckets.events.length})
              </p>
              {ownBuckets.events.length === 0 ? (
                <p className="text-xs text-navy-500">Belum ada event Sanghyang untuk saringan status ini.</p>
              ) : (
                <SnPromoTable items={ownBuckets.events} kind="event" caption={`Event Sanghyang (${outletLabel})`} showDescription />
              )}
            </div>
          </div>

          <h4 className="pt-2 text-base font-semibold text-navy-900">
            {kindTab === "event" ? "Event" : "Promo"} kompetitor ({outletLabel})
          </h4>

          {groupedRivals.length === 0 ? (
            <p className="rounded-xl bg-cream-100 p-8 text-center text-sm text-navy-600">
              Belum ada {kindTab === "event" ? "event" : "promo"} kompetitor yang cocok dengan saringan ini.
            </p>
          ) : (
            <div className="space-y-6">
              {groupedRivals.map((group) => (
                <div key={group.competitorName} className="space-y-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h5 className="text-base font-semibold text-navy-900">{group.competitorName}</h5>
                      {group.handle && group.handle !== "@" && (
                        <span className="font-mono text-xs text-navy-600">{group.handle}</span>
                      )}
                      {typeof group.roadKm === "number" && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-cream-200 px-2 py-0.5 text-[11px] font-semibold text-navy-800">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {group.roadKm.toLocaleString("id-ID")} km
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-navy-500">
                      {group.activeCount} aktif · {group.promos.length} tercatat
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {group.promos.map((p) => {
                      const isEvent = isPromoEvent(p);
                      const counter = counterStrategyFor(p, selectedOutlet);
                      const sources = p.sources?.length
                        ? p.sources
                        : p.sourceUrl
                          ? [{ platform: p.platform, url: p.sourceUrl, label: p.source }]
                          : [];
                      const priceText = promoPriceDiscountText(p);

                      return (
                        <article key={p.id} className="flex flex-col justify-between space-y-3 rounded-2xl border border-cream-300 bg-white p-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 border-b border-cream-200 pb-2 text-xs text-navy-500">
                              <span>{promoPeriodText(p)}</span>
                              <span
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                  p.status === "active"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : p.status === "upcoming"
                                      ? "border-sky-200 bg-sky-50 text-sky-800"
                                      : "border-cream-300 bg-cream-100 text-navy-600",
                                )}
                              >
                                {STATUS_LABELS[p.status] ?? p.status}
                              </span>
                            </div>

                            <h6 className="font-semibold text-navy-900">{p.title}</h6>

                            {!isEvent && (
                              <p className="text-xs text-navy-600">
                                <span className="font-semibold text-navy-900">Kategori promosi:</span>{" "}
                                <span
                                  title={
                                    isPromotionType(p.promotionType)
                                      ? PROMOTION_TYPE_INFO[p.promotionType].definition
                                      : undefined
                                  }
                                >
                                  {promotionTypeLabel(p.promotionType)}
                                </span>
                              </p>
                            )}

                            {p.description && <p className="text-xs leading-relaxed text-navy-700">{p.description}</p>}

                            {p.details && p.details.length > 0 && (
                              <div className="space-y-0.5 text-xs">
                                <p className="font-semibold text-navy-900">{isEvent ? "Rangkaian acara" : "Isi paket"}</p>
                                <ul className="list-disc space-y-0.5 pl-4 text-navy-700">
                                  {p.details.map((d, idx) => (
                                    <li key={idx}>{d}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {p.terms && p.terms.length > 0 && (
                              <div className="space-y-0.5 text-xs">
                                <p className="font-semibold text-navy-900">Syarat dan masa berlaku</p>
                                <ul className="list-disc space-y-0.5 pl-4 text-navy-600">
                                  {p.terms.map((term, idx) => (
                                    <li key={idx}>{term}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {priceText !== "—" && (
                              <p className="text-xs font-semibold text-emerald-800">
                                {isEvent ? "Harga" : "Tarif promo"}: {priceText}
                              </p>
                            )}

                            {counter && (
                              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-950">
                                <p className="flex items-center gap-1.5 font-semibold text-emerald-900">
                                  <Target className="h-3.5 w-3.5" aria-hidden /> Strategi tanggapan Sanghyang
                                </p>
                                <p className="mt-1 leading-relaxed">{counter}</p>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cream-200 pt-2.5 text-xs">
                            {sources.length > 0 ? (
                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                {sources.map((s) => (
                                  <a
                                    key={s.url}
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 font-semibold text-navy-800 underline hover:text-navy-900"
                                  >
                                    <ExternalLink className="h-3 w-3" aria-hidden />
                                    {SOURCE_LINK_LABEL[s.platform] ?? s.label ?? "Buka sumber"}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <span className="text-navy-500">Tanpa tautan sumber</span>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              {counter && (
                                <button
                                  type="button"
                                  onClick={() => void handleCopy(counter, p.id)}
                                  className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold"
                                >
                                  {copiedId === p.id ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" aria-hidden />
                                  )}
                                  {copiedId === p.id ? "Tersalin" : "Salin strategi"}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={generatingId !== null}
                                onClick={() =>
                                  void handleGenerateDraft(
                                    p,
                                    counter ?? `Tanggapan kampanye terhadap ${p.title} untuk ${outletLabel}`,
                                  )
                                }
                                className="skeuo-pill-dark inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold disabled:opacity-50"
                              >
                                {generatingId === p.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                                )}
                                {generatingId === p.id ? "Menyusun…" : "Draf konten"}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SkeuoCard>
      )}

      {/* Modal Draf Konten (Reels, TikTok, Carousel — switcher tab seperti ContentDraftModal asli) */}
      {draftModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDraftModal(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <div className="skeuo-card max-h-[88vh] w-full max-w-2xl space-y-4 overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3 border-b border-cream-300 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">Draf Konten Pemasaran</p>
                <h3 className="text-lg font-semibold text-navy-900">{draftModal.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDraftModal(null)}
                aria-label="Tutup dialog"
                className="rounded-full p-1 text-navy-600 hover:bg-cream-200"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="skeuo-inset flex gap-1 p-1 text-xs">
              {(
                [
                  ["reels", "Instagram Reels"],
                  ["tiktok", "TikTok Video"],
                  ["carousel", "Carousel Feed"],
                ] as const
              ).map(([fmtKey, label]) => (
                <button
                  key={fmtKey}
                  type="button"
                  onClick={() => setDraftTab(fmtKey)}
                  className={cn(
                    "flex-1 rounded-full py-1.5 font-semibold",
                    draftTab === fmtKey ? "skeuo-pill-dark" : "text-navy-600 hover:text-navy-900",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {draftTab === "reels" && draftModal.draft.reels && (
              <div className="space-y-3 rounded-xl border border-cream-300 bg-white p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-navy-900">{draftModal.draft.reels.headline}</p>
                  <button
                    type="button"
                    onClick={() => void handleCopy(draftModal.draft.reels!.caption, "modal-reels")}
                    className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold"
                  >
                    {copiedId === "modal-reels" ? <Check className="h-3 w-3 text-emerald-700" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                    {copiedId === "modal-reels" ? "Tersalin" : "Salin caption"}
                  </button>
                </div>
                <div className="rounded-xl bg-cream-50 p-3">
                  <p className="font-bold text-navy-900">Hook 3 detik:</p>
                  <p className="mt-0.5 text-navy-800">&ldquo;{draftModal.draft.reels.hook3Sec}&rdquo;</p>
                </div>
                <p className="whitespace-pre-line rounded-xl border border-cream-200 bg-cream-50 p-3 text-sm leading-relaxed text-navy-900">
                  {draftModal.draft.reels.caption}
                </p>
                <p className="text-navy-700">
                  <strong className="text-navy-900">CTA:</strong> {draftModal.draft.reels.callToAction}
                </p>
                <div className="rounded-xl bg-cream-50 p-3 text-navy-700">
                  <p className="flex items-center gap-1 font-bold text-navy-900">
                    <Lightbulb className="h-3.5 w-3.5 text-amber-700" aria-hidden /> Panduan Visual &amp; Audio
                  </p>
                  <p className="mt-0.5">
                    {draftModal.draft.reels.visualDirection} · Audio: {draftModal.draft.reels.audioRecommendation}
                  </p>
                </div>
              </div>
            )}

            {draftTab === "tiktok" && draftModal.draft.tiktok && (
              <div className="space-y-3 rounded-xl border border-cream-300 bg-white p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-navy-900">{draftModal.draft.tiktok.headline}</p>
                  <button
                    type="button"
                    onClick={() => void handleCopy(draftModal.draft.tiktok!.caption, "modal-tiktok")}
                    className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold"
                  >
                    {copiedId === "modal-tiktok" ? <Check className="h-3 w-3 text-emerald-700" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                    {copiedId === "modal-tiktok" ? "Tersalin" : "Salin caption"}
                  </button>
                </div>
                <div className="rounded-xl bg-cream-50 p-3">
                  <p className="font-bold text-navy-900">Hook POV:</p>
                  <p className="mt-0.5 text-navy-800">&ldquo;{draftModal.draft.tiktok.hookPOV}&rdquo;</p>
                </div>
                {draftModal.draft.tiktok.storyline && draftModal.draft.tiktok.storyline.length > 0 && (
                  <div className="rounded-xl bg-cream-50 p-3">
                    <p className="font-bold text-navy-900">Alur Cerita:</p>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-navy-700">
                      {draftModal.draft.tiktok.storyline.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <p className="whitespace-pre-line rounded-xl border border-cream-200 bg-cream-50 p-3 text-sm leading-relaxed text-navy-900">
                  {draftModal.draft.tiktok.caption}
                </p>
                <p className="text-navy-700">
                  <strong className="text-navy-900">CTA:</strong> {draftModal.draft.tiktok.callToAction} ·{" "}
                  <strong className="text-navy-900">Tren Audio:</strong> {draftModal.draft.tiktok.soundTrend}
                </p>
              </div>
            )}

            {draftTab === "carousel" && draftModal.draft.carousel && (
              <div className="space-y-3 rounded-xl border border-cream-300 bg-white p-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-navy-900">{draftModal.draft.carousel.headline}</p>
                  <button
                    type="button"
                    onClick={() => void handleCopy(draftModal.draft.carousel!.caption, "modal-carousel")}
                    className="skeuo-pill-light inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold"
                  >
                    {copiedId === "modal-carousel" ? <Check className="h-3 w-3 text-emerald-700" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                    {copiedId === "modal-carousel" ? "Tersalin" : "Salin caption"}
                  </button>
                </div>
                {draftModal.draft.carousel.slides && draftModal.draft.carousel.slides.length > 0 && (
                  <div className="space-y-1.5">
                    {draftModal.draft.carousel.slides.map((sl) => (
                      <div key={sl.slideNo} className="rounded-lg border border-cream-200 bg-cream-50 p-2.5 text-navy-800">
                        <p className="font-semibold text-navy-900">
                          Slide {sl.slideNo}: {sl.title}
                        </p>
                        <p className="mt-0.5 text-navy-700">{sl.description}</p>
                        {sl.visualNote && <p className="mt-0.5 text-[11px] text-navy-500">Visual: {sl.visualNote}</p>}
                      </div>
                    ))}
                  </div>
                )}
                <p className="whitespace-pre-line rounded-xl border border-cream-200 bg-cream-50 p-3 text-sm leading-relaxed text-navy-900">
                  {draftModal.draft.carousel.caption}
                </p>
                {draftModal.draft.carousel.promoOffer && (
                  <p className="text-navy-700">
                    <strong className="text-navy-900">Penawaran Utama:</strong> {draftModal.draft.carousel.promoOffer}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end border-t border-cream-200 pt-3">
              <button
                type="button"
                onClick={() => setDraftModal(null)}
                className="skeuo-pill-dark rounded-full px-5 py-2 text-xs font-semibold"
              >
                Selesai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
