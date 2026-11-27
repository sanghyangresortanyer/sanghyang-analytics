"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Bath,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Hotel,
  Image as ImageIcon,
  Lightbulb,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Tv,
  Users,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { SkeuoCard } from "@/components/skeuo/ui";
import {
  OUTLET_LABELS,
  fmtCompactRupiah,
  fmtRupiah,
  priceVerdict,
  type SnBreakfastOfferPoint,
  type SnCheapestRow,
  type SnCompetitorComparison,
  type SnEvidencePoint,
  type SnFnbMatrixEntry,
  type SnHeadToHeadNarrative,
  type SnHotelMatrixEntry,
  type SnOutletFinding,
  type SnOutletMarketShare,
  type SnOutletMatrix,
  type SnResortMarketSize,
  type SnReviewShareRow,
  type SnSourceRef,
} from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";
import {
  SnBreakfastBadge,
  SnExtLink,
  SnFnbDetailModal,
  SnHotelDetailModal,
  SnOfficialPrice,
  SnOtaSides,
  SnPhotoGalleryModal,
  checkInLabel,
  sanitizePublicText,
} from "./sn-competitor-detail-modal";

const PILLARS = [
  { key: "strengths", label: "Keunggulan Kompetitor", ownLabel: "Keunggulan Layanan", icon: CheckCircle2, tone: "text-emerald-800" },
  { key: "gaps", label: "Kelemahan & Celah Layanan", ownLabel: "Area Peningkatan", icon: ShieldAlert, tone: "text-ember-700" },
  { key: "opportunities", label: "Peluang Rebut Pasar", ownLabel: "Peluang Pengembangan", icon: Lightbulb, tone: "text-navy-900" },
  { key: "observed", label: "Fakta teramati", ownLabel: "Fakta teramati", icon: Eye, tone: "text-navy-700" },
] as const;

const SEGMENT_COLORS = [
  "bg-emerald-700",
  "bg-sky-600",
  "bg-amber-600",
  "bg-orange-500",
  "bg-navy-600",
  "bg-emerald-400",
  "bg-sky-400",
];

const ROOM_CATEGORY_LABEL: Record<string, string> = {
  standard: "Kamar standar",
  suite: "Suite",
  villa: "Villa",
  condo: "Condo",
  cottage: "Cottage",
};

const RESORT_DEFAULT_COLUMNS = [
  "No",
  "Tempat",
  "Bintang",
  "Jarak",
  "Tipe Kamar",
  "Luas",
  "Tarif kamar (biasa / akhir pekan)",
  "Rating Google",
  "Kamar",
  "Smart TV",
  "Bathtub",
  "Kolam / Air Panas",
  "Gaya Desain",
  "Audit pembanding",
];

const FNB_DEFAULT_COLUMNS = [
  "No",
  "Tempat",
  "Jarak",
  "Rating Google",
  "Kisaran Menu / Paket",
  "Rincian Menu & Harga",
  "Fasilitas & Suasana",
  "Audit pembanding",
];

const GENERIC_MATCH_LABEL = "padanan umum: jenis ikan tidak disebut";

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "Belum ada data";
  return `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
}

function monthLabel(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function FacilityBadge({ icon: Icon, label, title }: { icon: LucideIcon; label: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border border-cream-300 bg-cream-50 px-2.5 py-0.5 text-[10px] font-semibold text-navy-800"
    >
      <Icon className="h-3 w-3 text-navy-700" aria-hidden />
      {label}
    </span>
  );
}

function CardThumbnail({ url, alt }: { url: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- foto eksternal berizin */}
      <img
        src={url}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-16 w-24 shrink-0 rounded-xl border border-cream-300 object-cover"
      />
    </a>
  );
}

function EvidenceList({ items }: { items: SnEvidencePoint[] }) {
  return (
    <ul className="mt-1 space-y-1.5 text-[11px] text-navy-800">
      {items.map((item, idx) => (
        <li key={idx} className="border-l-2 border-cream-300 pl-2">
          <span>{sanitizePublicText(item.text)}</span>
          {item.quote && <q className="block italic text-navy-600">{sanitizePublicText(item.quote)}</q>}
          {item.sources && item.sources.length > 0 && (
            <span className="block text-[10px] text-navy-500">
              Sumber:{" "}
              {item.sources.map((s, i) => (
                <span key={`${s.label}-${i}`}>
                  {i > 0 ? "; " : ""}
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline hover:text-navy-900">
                      {sanitizePublicText(s.label)}
                    </a>
                  ) : (
                    sanitizePublicText(s.label)
                  )}
                </span>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Narasi terstruktur Head-to-Head (Teramati, Disimpulkan, Implikasi) dari Knowledge Graph. */
export function SnHeadToHeadNarrative({
  narrative,
  sources = [],
  originText,
}: {
  narrative?: SnHeadToHeadNarrative | null;
  sources?: SnSourceRef[];
  /** Kapan dan untuk periode apa kesimpulan disusun (knowledgeAnalysisOriginText). */
  originText?: string | null;
}) {
  if (!narrative) return null;
  const hasContent =
    (narrative.teramati?.length ?? 0) > 0 ||
    (narrative.disimpulkan?.length ?? 0) > 0 ||
    (narrative.implikasi?.length ?? 0) > 0;
  if (!hasContent && !narrative.summary) return null;

  return (
    <div className="rounded-2xl border border-navy-200 bg-cream-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-300 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-navy-800" aria-hidden />
          <h4 className="text-sm font-bold text-navy-900">Sintesis Analisis Head-to-Head &amp; Implikasi Bisnis</h4>
        </div>
        <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[10px] font-bold text-navy-800">
          Knowledge Graph Terpadu
        </span>
      </div>
      {originText && <p className="text-[11px] text-navy-600">{originText}</p>}

      {narrative.summary && (
        <p className="text-xs leading-relaxed font-medium text-navy-800">{sanitizePublicText(narrative.summary)}</p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {narrative.teramati && narrative.teramati.length > 0 && (
          <div className="rounded-xl border border-cream-300 bg-white p-3 space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-navy-900">
              <Eye className="h-3.5 w-3.5 text-navy-700" aria-hidden /> Teramati (Fakta Pasar)
            </span>
            <ul className="space-y-1 text-[11px] leading-relaxed text-navy-700">
              {narrative.teramati.map((item, idx) => (
                <li key={idx} className="border-l-2 border-navy-300 pl-2">
                  {sanitizePublicText(item)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {narrative.disimpulkan && narrative.disimpulkan.length > 0 && (
          <div className="rounded-xl border border-cream-300 bg-white p-3 space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <Scale className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> Disimpulkan (Peluang Pasar)
            </span>
            <ul className="space-y-1 text-[11px] leading-relaxed text-navy-700">
              {narrative.disimpulkan.map((item, idx) => (
                <li key={idx} className="border-l-2 border-emerald-300 pl-2">
                  {sanitizePublicText(item)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {narrative.implikasi && narrative.implikasi.length > 0 && (
          <div className="rounded-xl border border-cream-300 bg-white p-3 space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
              <Target className="h-3.5 w-3.5 text-amber-700" aria-hidden /> Implikasi (Aksi Pengelola)
            </span>
            <ul className="space-y-1 text-[11px] leading-relaxed text-navy-700">
              {narrative.implikasi.map((item, idx) => (
                <li key={idx} className="border-l-2 border-amber-300 pl-2">
                  {sanitizePublicText(item)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-cream-200 pt-2 text-[10px] text-navy-500 space-y-1">
        <p>
          Dasar narasi: daftar kompetitor aktif, fakta fasilitas situs resmi dan OTA, ulasan Google Maps, harga menu, dan
          tarif kamar.
        </p>
        {sources.length > 0 && (
          <p>
            Sumber bukti di langkah ini:{" "}
            {sources.map((s, i) => (
              <span key={`${s.label}-${i}`}>
                {i > 0 ? "; " : ""}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline hover:text-navy-900">
                    {sanitizePublicText(s.label)}
                  </a>
                ) : (
                  sanitizePublicText(s.label)
                )}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/** Kartu perbandingan kompetitor / titik acuan Sanghyang lengkap dengan fasilitas, foto, sumber, dan semua 4 pilar bukti. */
export function SnComparisonCard({
  comp,
  ratingInfo,
}: {
  comp: SnCompetitorComparison;
  ratingInfo?: { rating: number | null; reviewCount?: number | null };
}) {
  const displayName = comp.name ?? comp.competitorName;
  const isOwn = Boolean(comp.isSanghyang || displayName.toLowerCase().includes("sanghyang"));
  const subtitle = comp.parentName ? `Outlet di dalam ${comp.parentName}` : null;
  const specs = comp.specs;
  const fac = specs?.facilities;
  const photos = specs?.visual?.photoUrls ?? [];

  const hasFacilityPills =
    fac &&
    (specs?.roomCount != null ||
      fac.roomSizeRangeLabel != null ||
      fac.smartTv != null ||
      fac.bathtub === true ||
      fac.infinityPool === true ||
      fac.hotSpring === true);

  return (
    <article
      className={cn(
        "rounded-2xl border p-4 space-y-3",
        isOwn ? "border-navy-800/40 bg-cream-50 ring-1 ring-navy-800/10" : "border-cream-300 bg-white",
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-cream-200 pb-2">
        <div className="flex items-start gap-2">
          {isOwn ? (
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-navy-800" aria-hidden />
          ) : (
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-navy-700" aria-hidden />
          )}
          <div>
            <h4 className="text-sm font-bold text-navy-900">{displayName}</h4>
            <p className="text-[11px] text-navy-500">
              {subtitle ?? comp.outletName}
              {typeof specs?.roadKm === "number" && !isOwn ? ` · ${specs.roadKm.toFixed(1)} km` : ""}
              {typeof specs?.starRating === "number" ? ` · Bintang ${specs.starRating}` : ""}
              {typeof ratingInfo?.rating === "number"
                ? ` · Rating ${ratingInfo.rating.toFixed(1)}${ratingInfo.reviewCount ? ` (${ratingInfo.reviewCount.toLocaleString("id-ID")})` : ""}`
                : ""}
            </p>
          </div>
        </div>
        {isOwn ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
            Titik Acuan (Sanghyang)
          </span>
        ) : comp.compsetRole === "benchmark" || comp.compsetRole === "acuan" ? (
          <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
            Acuan
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-cream-200 px-2.5 py-0.5 text-[10px] font-bold text-navy-800">
            Kompetitor Inti
          </span>
        )}
      </div>

      {fac && hasFacilityPills && (
        <div className="flex flex-wrap gap-1.5">
          {specs?.roomCount != null && <FacilityBadge icon={Hotel} label={`${specs.roomCount} Kamar`} />}
          {fac.roomSizeRangeLabel && <FacilityBadge icon={Hotel} label={`Luas ${fac.roomSizeRangeLabel}`} />}
          {fac.smartTv === true && <FacilityBadge icon={Tv} label="Smart TV" title={fac.smartTvNote ?? undefined} />}
          {fac.smartTv === false && <FacilityBadge icon={Tv} label="TV Layar Datar" title={fac.smartTvNote ?? undefined} />}
          {fac.bathtub === true && <FacilityBadge icon={Bath} label="Bathtub" title={fac.bathtubNote ?? undefined} />}
          {fac.hotSpring === true && <FacilityBadge icon={Sparkles} label="Air Panas Alami" title={fac.hotSpringNote ?? undefined} />}
          {fac.infinityPool === true && (
            <FacilityBadge icon={Waves} label={fac.poolType ? "Infinity / Sea Pool" : "Kolam Renang"} title={fac.poolType ?? undefined} />
          )}
        </div>
      )}

      {fac?.usp && (
        <p className="rounded-xl bg-cream-50 p-2.5 text-[11px] leading-relaxed text-navy-700">
          <strong className="text-navy-900">Pembeda Utama: </strong>
          {sanitizePublicText(fac.usp)}
        </p>
      )}

      {(specs?.visual?.ambience || specs?.visual?.designStyle) && (
        <p className="rounded-xl bg-cream-50 p-2.5 text-[11px] leading-relaxed text-navy-700">
          <strong className="text-navy-900">Karakter &amp; Suasana: </strong>
          {sanitizePublicText(specs.visual.ambience ?? specs.visual.designStyle ?? "")}
        </p>
      )}

      {photos.length > 0 && (
        <div className="space-y-1">
          <span className="flex items-center gap-1 text-[10px] font-semibold text-navy-500">
            <ImageIcon className="h-3 w-3" aria-hidden /> Foto Suasana Terverifikasi:
          </span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.slice(0, 3).map((url, idx) => (
              <CardThumbnail key={`${url}-${idx}`} url={url} alt={`${displayName} galeri ${idx + 1}`} />
            ))}
          </div>
        </div>
      )}

      {specs?.sources && specs.sources.length > 0 && (
        <div className="border-t border-cream-200 pt-1.5 text-[10px] text-navy-500">
          Sumber:{" "}
          {specs.sources.map((s, idx) => (
            <span key={`${s.label}-${idx}`}>
              {idx > 0 ? "; " : ""}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="underline hover:text-navy-900">
                  {sanitizePublicText(s.label)}
                </a>
              ) : (
                sanitizePublicText(s.label)
              )}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2.5 text-xs">
        {PILLARS.filter((p) => (comp.evidence?.[p.key]?.length ?? 0) > 0).map((p) => {
          const Icon = p.icon;
          const items = comp.evidence?.[p.key] ?? [];
          return (
            <div key={p.key}>
              <span className={cn("flex items-center gap-1 font-semibold", p.tone)}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {isOwn ? p.ownLabel : p.label}:
              </span>
              <EvidenceList items={items} />
            </div>
          );
        })}
      </div>

      {(specs?.websiteUrl || specs?.mapsUrl) && (
        <div className="flex flex-wrap gap-3 border-t border-cream-200 pt-2 text-xs font-semibold text-navy-700">
          {specs?.websiteUrl && <SnExtLink href={specs.websiteUrl}>Situs Resmi</SnExtLink>}
          {specs?.mapsUrl && <SnExtLink href={specs.mapsUrl}>Google Maps</SnExtLink>}
        </div>
      )}
    </article>
  );
}

/** Panel ukuran pasar & pangsa pasar untuk Langkah 3 (Resort: Omset aktual + Market Cap + distribusi; F&B: pangsa ulasan Google). */
export function SnMarketSharePanel({
  isResort,
  outletName,
  marketData,
  marketSize,
  reviewRows,
}: {
  isResort: boolean;
  outletName: string;
  marketData: SnOutletMarketShare | null;
  marketSize?: SnResortMarketSize;
  reviewRows?: SnReviewShareRow[];
}) {
  const verdict = priceVerdict(marketData?.pricePositioningIndex);

  return (
    <SkeuoCard className="space-y-4">
      <div className="border-b border-cream-300 pb-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Ukuran Pasar &amp; Posisi Harga</p>
        <h3 className="text-lg font-semibold text-navy-900">Market Cap dan pangsa pasar ({outletName})</h3>
        {marketData && (
          <p className="mt-1 text-sm font-semibold text-navy-800">
            <span
              className={cn(
                "mr-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold",
                verdict.tone === "good"
                  ? "bg-emerald-50 text-emerald-800"
                  : verdict.tone === "warn"
                    ? "bg-amber-50 text-amber-800"
                    : verdict.tone === "bad"
                      ? "bg-red-50 text-red-800"
                      : "bg-cream-200 text-navy-700",
              )}
            >
              {verdict.label}
            </span>
            {verdict.sentence}
          </p>
        )}
      </div>

      {isResort && marketSize ? (
        (() => {
          const counted = marketSize.rows.filter((r) => r.share !== null).sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
          const others = marketSize.rows.filter((r) => r.role !== "sanghyang").sort((a, b) => a.roadKm - b.roadKm);
          const share = marketSize.sanghyang.actual?.share ?? marketSize.sanghyang.estimatedShare;
          const tpk = marketSize.tpk;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-cream-300 bg-white p-3.5">
                  <p className="text-xs font-semibold text-navy-500">Basis Data Kamar &amp; Resort (VHP)</p>
                  <p className="mt-1 text-xl font-bold text-navy-900">
                    {marketSize.sanghyang.actual ? monthLabel(marketSize.sanghyang.actual.month) : "Belum ada data"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-navy-600">
                    {marketSize.sanghyang.actual
                      ? `${marketSize.sanghyang.actual.sourceFile} · nominal rupiah hanya tampil di Dashboard Operasional.`
                      : "Belum ada catatan operasional kamar VHP."}
                  </p>
                </div>

                <div className="rounded-2xl border border-cream-300 bg-white p-3.5">
                  <p className="text-xs font-semibold text-navy-500">Market Cap segmen (perkiraan kasar)</p>
                  <p className="mt-1 text-xl font-bold text-navy-900">
                    {marketSize.marketCapMonthly === null ? "Belum ada data" : `${fmtCompactRupiah(marketSize.marketCapMonthly)}/bln`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-navy-600">
                    {counted.length} resort bintang 4–5 dalam 25 km, termasuk Sanghyang.
                  </p>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                  <p className="text-xs font-semibold text-emerald-900">
                    {marketSize.sanghyang.actual ? "Pangsa pasar (omset aktual)" : "Pangsa pasar (perkiraan)"}
                  </p>
                  <p className="mt-1 text-xl font-bold text-emerald-950">
                    {pct(share)}
                    {marketSize.sanghyang.rank ? (
                      <span className="ml-1.5 text-xs font-normal text-emerald-800">
                        #{marketSize.sanghyang.rank} dari {marketSize.sanghyang.rankOf}
                      </span>
                    ) : null}
                  </p>
                  <span className="mt-1.5 block h-1.5 rounded-full bg-emerald-200" aria-hidden>
                    <span
                      className="block h-1.5 rounded-full bg-emerald-700"
                      style={{ width: `${Math.min(100, share ?? 0)}%` }}
                    />
                  </span>
                  <p className="mt-1 text-[11px] text-emerald-800">
                    {marketSize.sanghyang.actual
                      ? "Omset aktual dibanding perkiraan omset pembanding."
                      : "Perkiraan Sanghyang dengan rumus yang sama seperti pembanding."}
                  </p>
                </div>

                <div className="rounded-2xl border border-cream-300 bg-white p-3.5">
                  <p className="text-xs font-semibold text-navy-500">Indeks posisi harga</p>
                  <p className="mt-1 text-xl font-bold text-navy-900">
                    {marketData?.pricePositioningIndex != null
                      ? marketData.pricePositioningIndex.toLocaleString("id-ID")
                      : "Belum ada data"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-navy-600">100 = sama dengan rata-rata tarif pembanding bintang 4.</p>
                </div>
              </div>

              {counted.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-navy-800">Peta distribusi pangsa pasar (perkiraan kasar)</p>
                  <div
                    className="flex h-3 overflow-hidden rounded-full bg-cream-200"
                    role="img"
                    aria-label={counted.map((r) => `${r.name} ${pct(r.share)}`).join(", ")}
                  >
                    {counted.map((r, idx) => (
                      <span
                        key={r.hotelId}
                        className={r.role === "sanghyang" ? "bg-navy-900" : SEGMENT_COLORS[idx % SEGMENT_COLORS.length]}
                        style={{ width: `${r.share ?? 0}%` }}
                        title={`${r.name}: ${pct(r.share)}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {others.length > 0 && (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {others.map((r) => (
                    <article
                      key={r.hotelId}
                      className={cn(
                        "rounded-xl border p-3 text-xs",
                        r.role === "benchmark" ? "border-amber-200 bg-amber-50/50" : "border-cream-300 bg-white",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-bold text-navy-900">{r.name}</span>
                        <span className="font-bold tabular-nums text-navy-900">{r.share === null ? "—" : pct(r.share)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-navy-600">
                        {r.stars ? `Bintang ${r.stars}` : "Bintang belum diketahui"} · {r.roadKm.toLocaleString("id-ID")} km ·{" "}
                        <span title={r.roomCountSource}>
                          {r.roomCount === null ? "Jumlah kamar belum tercantum" : `${r.roomCount} kamar`}
                        </span>
                      </p>
                      <p className="mt-1 font-semibold text-navy-800">
                        {r.estimatedMonthlyRevenue === null
                          ? "Perkiraan omset belum ada"
                          : `${fmtCompactRupiah(r.estimatedMonthlyRevenue)}/bln`}
                        {r.priceVsSanghyang !== null ? (
                          <span className="font-normal text-navy-600"> · tarif {r.priceVsSanghyang}% dari Sanghyang</span>
                        ) : null}
                      </p>
                      <span
                        className={cn(
                          "mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          r.role === "benchmark" ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800",
                        )}
                      >
                        {r.role === "benchmark" ? "Acuan, tidak dihitung" : "Pembanding"}
                      </span>
                    </article>
                  ))}
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-navy-500">
                Rumus: kamar × {marketSize.daysPerMonth} hari × TPK hotel bintang Banten × tarif OTA terbobot (5 malam
                hari biasa + 2 malam akhir pekan).{" "}
                {tpk ? (
                  <>
                    TPK {tpk.percent.toLocaleString("id-ID")}% untuk {monthLabel(tpk.period)} dari{" "}
                    <a href={tpk.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-navy-800 underline">
                      rilis BPS Banten
                    </a>
                    .
                  </>
                ) : (
                  "TPK BPS belum tersedia, jadi perkiraan omset belum bisa dihitung."
                )}{" "}
                Tarif OTA dari pantauan Google Travel {marketSize.ratesCapturedAt ?? "(belum ada)"}. Sumber jumlah kamar
                tampil saat kursor diarahkan ke angka kamar.
              </p>
            </div>
          );
        })()
      ) : (
        <div className="space-y-3">
          {(() => {
            const rows = reviewRows ?? [];
            const own = rows.find((r) => r.isSanghyang);
            return (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-cream-300 bg-white p-3.5">
                    <p className="text-xs font-semibold text-navy-500">Market Cap segmen</p>
                    <p className="mt-1 text-lg font-bold text-navy-900">Belum ada data</p>
                    <p className="mt-0.5 text-[11px] text-navy-600">
                      Butuh kapasitas kursi dan rata-rata belanja per tamu dari sumber resmi.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                    <p className="text-xs font-semibold text-emerald-900">Pangsa ulasan Google</p>
                    <p className="mt-1 text-xl font-bold text-emerald-950">{own ? pct(own.share) : "Belum ada data"}</p>
                    <p className="mt-0.5 text-[11px] text-emerald-800">
                      Proksi popularitas di antara outlet ini dan pembandingnya, bukan omset.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-cream-300 bg-white p-3.5">
                    <p className="text-xs font-semibold text-navy-500">Rating Google</p>
                    <p className="mt-1 text-xl font-bold text-navy-900">
                      {own?.rating ? `${own.rating.toLocaleString("id-ID")} / 5` : "Belum ada data"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-navy-600">
                      {own ? `${own.reviewCount.toLocaleString("id-ID")} ulasan di Google Maps` : `${outletName} belum terbaca di Google Maps.`}
                    </p>
                  </div>
                </div>
                {rows.length > 0 && (
                  <div className="relative overflow-x-auto rounded-2xl border border-cream-300 bg-white">
                    <table className="table-compact w-full min-w-[540px] text-left text-xs">
                      <thead>
                        <tr>
                          <th>Tempat</th>
                          <th>Jarak</th>
                          <th>Rating</th>
                          <th>Ulasan Google</th>
                          <th>Pangsa ulasan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cream-200">
                        {rows.map((r) => (
                          <tr key={r.name} className={r.isSanghyang ? "bg-emerald-50/70 font-semibold" : ""}>
                            <td className="text-navy-900">{r.name}</td>
                            <td className="text-navy-600">{r.roadKm === null ? "—" : `${r.roadKm.toLocaleString("id-ID")} km`}</td>
                            <td className="text-navy-600">{r.rating === null ? "—" : r.rating.toLocaleString("id-ID")}</td>
                            <td className="text-navy-700">
                              <span className="tabular-nums">{r.reviewCount.toLocaleString("id-ID")}</span>
                            </td>
                            <td className="font-semibold text-navy-900">
                              <span className="tabular-nums">{pct(r.share)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-navy-500">
                  Jumlah ulasan dibaca dari Google Maps pada pembaruan terakhir.{" "}
                  {marketData?.pricePositioningIndex
                    ? ""
                    : "Indeks harga menu belum dihitung: harga pembanding belum dicocokkan per item dengan menu Sanghyang."}
                </p>
              </>
            );
          })()}
        </div>
      )}
    </SkeuoCard>
  );
}

function cheapestVerdict(label: string, own?: SnCheapestRow | null, rival?: SnCheapestRow | null): string {
  if (!own && !rival) return `${label}: belum ada tarif.`;
  if (!rival) return `${label}: hanya tarif Sanghyang yang terpantau (${own!.priceLabel}).`;
  if (!own) return `${label}: tarif Sanghyang belum terpantau; kompetitor termurah ${rival.hotelName} ${rival.priceLabel}.`;
  if (own.price <= rival.price) return `${label}: Sanghyang termurah (${own.priceLabel}); kompetitor termurah ${rival.hotelName} ${rival.priceLabel}.`;
  const gap = rival.diffPercent != null ? `, ${Math.abs(rival.diffPercent).toLocaleString("id-ID")}% lebih murah dari Sanghyang` : "";
  return `${label}: termurah ${rival.hotelName} ${rival.priceLabel}${gap} (Sanghyang ${own.priceLabel}).`;
}

function CheapestBreakfastOffers({
  offers,
}: {
  offers: { withBreakfast: SnBreakfastOfferPoint | null; withoutBreakfast: SnBreakfastOfferPoint | null };
}) {
  const line = (label: string, offer: SnBreakfastOfferPoint | null) =>
    offer ? (
      <span className="block">
        {label} <span className="tabular-nums font-semibold">{fmtRupiah(offer.price)}</span> via {offer.otaName}, check-in{" "}
        {checkInLabel(offer.checkIn)}
      </span>
    ) : null;
  if (!offers.withBreakfast && !offers.withoutBreakfast) return null;
  return (
    <span className="mt-1 block text-[10px] leading-snug text-navy-600">
      {line("Dengan sarapan", offers.withBreakfast)}
      {line("Tanpa sarapan", offers.withoutBreakfast)}
    </span>
  );
}

/** Matriks Harga Kamar & Resort 14 kolom lengkap + 2 sub-baris Resmi & OTA per tipe kamar + Tarif Termurah + Modal Detail & Foto. */
export function SnResortMatrixSection({ matrix }: { matrix: SnOutletMatrix }) {
  const entries = matrix.hotelEntries ?? [];
  const columns = matrix.columns?.length ? matrix.columns : RESORT_DEFAULT_COLUMNS;
  const totalRoomTypes = entries.reduce((sum, h) => sum + h.roomTypes.length, 0);
  const hasOtherNightOfficial = entries.some((h) =>
    h.roomTypes.some(
      (rt) =>
        rt.officialRate &&
        (rt.officialRate.weekdayOtherNightPrice != null || rt.officialRate.weekendOtherNightPrice != null),
    ),
  );
  const [showAllSubRows, setShowAllSubRows] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [detailHotel, setDetailHotel] = useState<SnHotelMatrixEntry | null>(null);
  const [photoHotel, setPhotoHotel] = useState<SnHotelMatrixEntry | null>(null);

  const isExpanded = (id: string) => (showAllSubRows ? !collapsed[id] : Boolean(collapsed[id]));
  const toggleHotel = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const cheapestPriceForStay = (stay: "weekday" | "weekend") => {
    const rows = (matrix.cheapestComparison?.rows ?? []).filter((r) => r.stay === stay);
    return rows.length ? Math.min(...rows.map((r) => r.price)) : null;
  };

  return (
    <SkeuoCard className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h4 className="flex items-center gap-1.5 text-lg font-semibold text-navy-900">
            <Scale className="h-4 w-4 text-navy-800" aria-hidden />
            Ringkasan Kompetitor: {matrix.outletName} ({entries.length} tempat)
          </h4>
          <p className="text-xs leading-relaxed text-navy-600">
            Tiap tipe kamar punya dua sub-baris: harga di situs resmi dan harga OTA termurah (klik untuk membuka
            penawarannya), lengkap dengan tanggal check-in dan status sarapan. Rentang tarif di baris tempat sama dengan
            harga terendah dan tertinggi di sub-barisnya.
            {hasOtherNightOfficial ? " Harga situs resmi yang malamnya beda dengan tarif OTA ditandai dan tidak dihitung." : null}
          </p>
          {matrix.ratesWindowNote && <p className="text-[11px] text-navy-500">{sanitizePublicText(matrix.ratesWindowNote)}</p>}
        </div>
        {totalRoomTypes > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowAllSubRows((v) => !v);
              setCollapsed({});
            }}
            className="skeuo-pill-light shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold"
          >
            {showAllSubRows ? "Ringkas sub-baris tipe kamar" : `Tampilkan semua tipe kamar (${totalRoomTypes})`}
          </button>
        )}
      </div>

      <div className="relative overflow-x-auto rounded-2xl border border-cream-300 bg-white">
        <table className="table-compact w-full min-w-[1440px] text-left text-xs">
          <caption className="sr-only">
            Ringkasan kompetitor Kamar &amp; Resort: Sanghyang dan kompetitor aktif, dengan sub-baris situs resmi dan OTA termurah per tipe kamar.
          </caption>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  className={cn(
                    col === "Tempat" && "sticky left-0 z-10 min-w-[200px] border-r border-cream-300",
                    col === "Tipe Kamar" && "min-w-[165px]",
                    col === "Tarif kamar (biasa / akhir pekan)" && "min-w-[260px]",
                    col === "Gaya Desain" && "min-w-[145px]",
                    col === "Audit pembanding" && "min-w-[260px]",
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200">
            {entries.map((h) => {
              const open = isExpanded(h.competitorId);
              const own = h.role === "sanghyang";
              const muted = h.role === "acuan";
              const roomTypes = h.roomTypes ?? [];
              const multiCount = roomTypes.filter((rt) => (rt.bedrooms ?? 0) >= 2).length;
              const typeSummary =
                roomTypes.length > 0
                  ? `${roomTypes.length} tipe${multiCount > 0 ? ` (${multiCount} unit 2BR+)` : ""}`
                  : "Belum ada data";
              const visualPhotos = h.specs?.visual?.photoUrls ?? [];
              const photoBtnCount = visualPhotos.length;
              const rowBg = own ? "bg-emerald-50/75" : muted ? "bg-cream-100/80 text-navy-600" : "bg-cream-50/60";
              const stickyBg = own ? "bg-[#eef8f3]" : muted ? "bg-cream-100" : "bg-cream-50";

              return (
                <Fragment key={h.competitorId}>
                  <tr className={cn("border-t-2 border-cream-300", rowBg)} data-row="tempat">
                    <td className="!align-top font-bold text-navy-900">
                      <span className="tabular-nums">{h.no}</span>
                    </td>
                    <th scope="row" className={cn("sticky left-0 z-[1] !align-top border-b border-r border-cream-200 px-2.5 py-2.5 text-left font-normal", stickyBg)}>
                      <div className="flex items-start gap-1.5">
                        {roomTypes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleHotel(h.competitorId)}
                            aria-expanded={open}
                            aria-label={`${open ? "Tutup" : "Buka"} rincian tipe kamar ${h.name}`}
                            className="mt-0.5 rounded p-0.5 text-navy-600 hover:bg-cream-200"
                          >
                            {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                        )}
                        <div className="min-w-0">
                          <div className={cn("font-bold", own ? "text-emerald-950" : "text-navy-900")}>{h.name}</div>
                          {own && (
                            <span className="mt-0.5 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              Outlet kita
                            </span>
                          )}
                          {muted && (
                            <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                              Acuan
                            </span>
                          )}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <button
                              type="button"
                              onClick={() => setDetailHotel(h)}
                              className="rounded-full border border-navy-300 bg-cream-50 px-2 py-0.5 text-[10px] font-semibold text-navy-900 hover:bg-cream-200"
                            >
                              Lihat detail lengkap
                            </button>
                            {photoBtnCount > 0 && (
                              <button
                                type="button"
                                onClick={() => setPhotoHotel(h)}
                                className="rounded-full border border-cream-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-navy-700 hover:bg-cream-100"
                              >
                                {photoBtnCount} foto
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </th>
                    <td className="!align-top whitespace-nowrap font-medium">{h.starLabel}</td>
                    <td className="!align-top whitespace-nowrap font-medium">{h.distanceLabel}</td>
                    <td className="!align-top font-semibold text-navy-900">{typeSummary}</td>
                    <td className="!align-top whitespace-nowrap font-semibold">
                      <span className="tabular-nums">{h.areaSummaryLabel}</span>
                    </td>
                    <td className="!align-top font-semibold text-navy-900">
                      <span className="block">{h.otaRateLabel}</span>
                      {h.breakfastSummaryLabel && (
                        <span className="mt-1 inline-block">
                          <SnBreakfastBadge status={h.breakfastSummaryLabel} />
                        </span>
                      )}
                    </td>
                    <td className="!align-top whitespace-nowrap">
                      <span className="tabular-nums">{h.ratingLabel}</span>
                    </td>
                    <td className="!align-top whitespace-nowrap font-medium">
                      <span className="tabular-nums">{h.roomCountLabel}</span>
                    </td>
                    <td className="!align-top whitespace-nowrap">{h.smartTvLabel}</td>
                    <td className="!align-top whitespace-nowrap">{h.bathtubLabel}</td>
                    <td className="!align-top">{h.poolLabel}</td>
                    <td className="!align-top text-[11px] leading-snug text-navy-700">{sanitizePublicText(h.designStyleLabel)}</td>
                    <td className="!align-top text-[11px] leading-relaxed text-navy-800">{sanitizePublicText(h.auditRationale)}</td>
                  </tr>

                  {open &&
                    roomTypes.map((rt, idx) => {
                      const bedTag = rt.bedrooms ? `${rt.bedrooms} KT` : (ROOM_CATEGORY_LABEL[rt.category] ?? rt.category);
                      const highlights = rt.highlights ?? [];
                      const midInfo = highlights[0] ? sanitizePublicText(highlights[0]) : "—";
                      const noteTail = rt.conflictNote
                        ? sanitizePublicText(rt.conflictNote)
                        : highlights.length > 1
                          ? highlights.slice(1, 3).map(sanitizePublicText).join("; ")
                          : "—";
                      const officialHref =
                        rt.officialRate?.sourceUrl ?? (rt.sourcePriority === "official" ? rt.sourceUrl : null) ?? h.websiteUrl;
                      const officialLabel = rt.officialRate
                        ? sanitizePublicText(rt.officialRate.sourceLabel)
                        : officialHref
                          ? `Situs resmi ${hostOf(officialHref)}`
                          : "Situs resmi belum tercatat";
                      const ota = rt.otaLowest;

                      return (
                        <Fragment key={`${h.competitorId}-rt-${idx}`}>
                          <tr data-layer="official" className="bg-white text-[11px] text-navy-700">
                            <td colSpan={4} className="!align-top pl-7 text-navy-600">
                              ↳ <span className="font-semibold text-navy-800">{bedTag}</span> ·{" "}
                              {officialHref ? (
                                <SnExtLink href={officialHref} className="font-medium">
                                  {officialLabel}
                                </SnExtLink>
                              ) : (
                                officialLabel
                              )}
                            </td>
                            <td rowSpan={2} className="!align-top font-semibold text-navy-900">
                              {rt.name}
                              {rt.sourcePriority === "ota" && (
                                <span className="block text-[10px] font-normal text-navy-500">
                                  Nama dari {sanitizePublicText(rt.sourceLabel)}
                                </span>
                              )}
                            </td>
                            <td rowSpan={2} className="!align-top whitespace-nowrap font-medium text-navy-900">
                              <span className="tabular-nums">{rt.areaLabel}</span>
                            </td>
                            <td className="!align-top">
                              <SnOfficialPrice rt={rt} />
                            </td>
                            <td colSpan={2} rowSpan={2} className="!align-top text-navy-600">
                              {midInfo}
                            </td>
                            <td rowSpan={2} className="!align-top whitespace-nowrap">
                              {rt.smartTvLabel}
                            </td>
                            <td rowSpan={2} className="!align-top whitespace-nowrap">
                              {rt.bathtubLabel}
                            </td>
                            <td colSpan={3} rowSpan={2} className="!align-top text-navy-600">
                              {noteTail}
                            </td>
                          </tr>
                          <tr data-layer="ota" className="bg-cream-50/70 text-[11px] text-navy-700">
                            <td colSpan={4} className="!align-top pl-7 text-navy-600">
                              ↳ <span className="font-semibold text-navy-800">OTA termurah</span>
                              {ota ? ` · ${ota.otaName}` : ""}
                            </td>
                            <td className="!align-top">
                              <SnOtaSides ota={ota} />
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-navy-500">{sanitizePublicText(matrix.note)}</p>

      {matrix.cheapestComparison && matrix.cheapestComparison.rows.length > 0 && (
        <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4 space-y-2.5">
          <div>
            <h5 className="text-xs font-bold uppercase tracking-wider text-navy-900">
              Tarif termurah hari biasa dan akhir pekan
            </h5>
            <p className="mt-0.5 text-xs text-navy-600">{sanitizePublicText(matrix.cheapestComparison.subtitle)}</p>
            {(matrix.cheapestComparison.weekday || matrix.cheapestComparison.weekend) && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-navy-800">
                <li>
                  {cheapestVerdict(
                    "Hari biasa",
                    matrix.cheapestComparison.weekday?.sanghyang,
                    matrix.cheapestComparison.weekday?.cheapestCompetitor,
                  )}
                </li>
                <li>
                  {cheapestVerdict(
                    "Akhir pekan",
                    matrix.cheapestComparison.weekend?.sanghyang,
                    matrix.cheapestComparison.weekend?.cheapestCompetitor,
                  )}
                </li>
              </ul>
            )}
          </div>
          <div className="relative overflow-x-auto rounded-xl border border-cream-300 bg-white">
            <table className="table-compact w-full min-w-[680px] text-left text-xs">
              <caption className="sr-only">
                Tarif kamar termurah hari biasa dan akhir pekan, Sanghyang dan kompetitor
              </caption>
              <thead>
                <tr>
                  <th>Hari</th>
                  <th>Tempat</th>
                  <th>Tipe kamar</th>
                  <th>Tarif termurah</th>
                  <th>Sarapan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200">
                {matrix.cheapestComparison.rows.map((r, i) => {
                  const isOwn = r.role === "sanghyang";
                  const minStay = cheapestPriceForStay(r.stay);
                  const isCheapest = minStay !== null && r.price === minStay;
                  return (
                    <tr
                      key={`${r.stay}-${r.hotelName}-${i}`}
                      className={isOwn ? "bg-emerald-50/70 font-medium" : "hover:bg-cream-50"}
                    >
                      <td className="!align-top whitespace-nowrap font-semibold text-navy-900">
                        {r.stay === "weekday" ? "Hari biasa" : "Akhir pekan"}
                      </td>
                      <th scope="row" className="!align-top border-b border-cream-200 px-2.5 py-2 text-left font-normal">
                        <span className={cn("font-bold", isOwn ? "text-emerald-950" : "text-navy-900")}>
                          {r.hotelName}
                        </span>
                        {isCheapest && (
                          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                            Termurah
                          </span>
                        )}
                      </th>
                      <td className="!align-top">
                        <span className="font-semibold text-navy-900">{r.roomTypeName}</span>
                        <span className="block text-[10px] text-navy-500">{r.areaLabel}</span>
                      </td>
                      <td className="!align-top">
                        <span className="font-bold tabular-nums text-navy-900">{r.priceLabel}</span>{" "}
                        <a
                          href={r.otaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-navy-800 underline"
                        >
                          via {r.otaName} <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden />
                        </a>
                        <span className="block text-[10px] text-navy-500">
                          {r.checkIn ? `check-in ${checkInLabel(r.checkIn)} · ` : ""}
                          {isOwn ? "acuan" : r.diffLabel}
                        </span>
                      </td>
                      <td className="!align-top min-w-[11rem]">
                        <SnBreakfastBadge status={r.breakfastLabel} />
                        {r.breakfastOffers && <CheapestBreakfastOffers offers={r.breakfastOffers} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailHotel && <SnHotelDetailModal hotel={detailHotel} onClose={() => setDetailHotel(null)} />}
      {photoHotel && (
        <SnPhotoGalleryModal
          name={photoHotel.name}
          detail={[photoHotel.starLabel, photoHotel.role === "sanghyang" ? null : `${photoHotel.distanceLabel} dari Sanghyang`]
            .filter(Boolean)
            .join(" · ")}
          mapsUrl={photoHotel.mapsUrl}
          photos={photoHotel.specs?.visual?.photoUrls ?? []}
          onClose={() => setPhotoHotel(null)}
        />
      )}
    </SkeuoCard>
  );
}

function bandOf(roadKm: number | null | undefined): string | null {
  if (roadKm === null || roadKm === undefined) return null;
  if (roadKm <= 5) return "≤ 5 km";
  if (roadKm <= 15) return "5–15 km";
  return "15–25 km";
}

function GapPill({ percent }: { percent: number }) {
  const tone = percent > 0 ? "text-red-700" : percent < 0 ? "text-emerald-700" : "text-navy-600";
  return <b className={cn("tabular-nums", tone)}>{percent > 0 ? `+${percent}` : percent}%</b>;
}

/** Matriks F&B/Bar/Spa 8 kolom lengkap: filter pita jarak, filter jenis tempat, Lihat detail lengkap, foto, dan item sebanding. */
export function SnFnbMatrixSection({ matrix }: { matrix: SnOutletMatrix }) {
  const entries = useMemo(() => matrix.fnbEntries ?? [], [matrix.fnbEntries]);
  const columns = matrix.columns?.length ? matrix.columns : FNB_DEFAULT_COLUMNS;
  const items = matrix.itemComparisons ?? [];
  const [band, setBand] = useState("all");
  const [placement, setPlacement] = useState<"all" | "hotel" | "mandiri">("all");
  const [detailEntry, setDetailEntry] = useState<SnFnbMatrixEntry | null>(null);
  const [photoEntry, setPhotoEntry] = useState<SnFnbMatrixEntry | null>(null);

  const bands = useMemo(() => {
    const order = ["≤ 5 km", "5–15 km", "15–25 km"];
    const found = new Set(entries.filter((e) => e.role !== "sanghyang").map((e) => bandOf(e.roadKm)).filter(Boolean));
    return order.filter((b) => found.has(b));
  }, [entries]);

  const hasHotel = entries.some((e) => e.role !== "sanghyang" && e.parentName);
  const hasMandiri = entries.some((e) => e.role !== "sanghyang" && !e.parentName);

  const visibleEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (e.role === "sanghyang") return true;
        if (band !== "all" && bandOf(e.roadKm) !== band) return false;
        if (placement === "hotel" && !e.parentName) return false;
        if (placement === "mandiri" && e.parentName) return false;
        return true;
      }),
    [entries, band, placement],
  );

  const visibleRivalNames = useMemo(
    () => new Set(visibleEntries.filter((e) => e.role !== "sanghyang").map((e) => e.name)),
    [visibleEntries],
  );

  return (
    <SkeuoCard className="space-y-4">
      <div>
        <h4 className="flex items-center gap-1.5 text-lg font-semibold text-navy-900">
          <Scale className="h-4 w-4 text-navy-800" aria-hidden />
          Ringkasan Kompetitor: matriks komparasi {entries.length} tempat ({matrix.outletName})
        </h4>
        <p className="mt-0.5 text-xs text-navy-600">
          Kolom, daftar menu terverifikasi, fasilitas, dan Audit pembanding selaras dengan laporan PDF.
        </p>
      </div>

      {(bands.length > 1 || (hasHotel && hasMandiri)) && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-cream-300 bg-cream-50 px-3.5 py-2.5 text-xs">
          {bands.length > 1 && (
            <div role="group" aria-label="Pita jarak" className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-navy-600">Jarak:</span>
              {[{ v: "all", l: "Semua" }, ...bands.map((b) => ({ v: b, l: b }))].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  aria-pressed={band === o.v}
                  onClick={() => setBand(o.v)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-semibold",
                    band === o.v ? "skeuo-pill-dark" : "border border-cream-300 bg-white text-navy-700",
                  )}
                >
                  {o.l}
                </button>
              ))}
            </div>
          )}
          {hasHotel && hasMandiri && (
            <div role="group" aria-label="Jenis tempat" className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-navy-600">Jenis:</span>
              {([["all", "Semua"], ["hotel", "Di dalam hotel"], ["mandiri", "Mandiri"]] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={placement === v}
                  onClick={() => setPlacement(v)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-semibold",
                    placement === v ? "skeuo-pill-dark" : "border border-cream-300 bg-white text-navy-700",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto text-[11px] text-navy-600">
            Menampilkan {visibleEntries.filter((e) => e.role !== "sanghyang").length} dari{" "}
            {entries.filter((e) => e.role !== "sanghyang").length} kompetitor
          </span>
        </div>
      )}

      <div className="relative overflow-x-auto rounded-2xl border border-cream-300 bg-white">
        <table className="table-compact w-full min-w-[1140px] text-left text-xs">
          <caption className="sr-only">
            Matriks komparasi {matrix.outletName} dan pembanding aktif beserta kolom Audit pembanding.
          </caption>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  className={cn(
                    col === "Tempat" && "sticky left-0 z-10 min-w-[200px] border-r border-cream-300",
                    col === "Kisaran Menu / Paket" && "min-w-[140px]",
                    col === "Rincian Menu & Harga" && "min-w-[220px]",
                    col === "Fasilitas & Suasana" && "min-w-[175px]",
                    col === "Audit pembanding" && "min-w-[260px]",
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-200">
            {visibleEntries.map((e) => {
              const own = e.role === "sanghyang";
              const muted = e.role === "acuan";
              const photoCount = e.specs?.visual?.photoUrls?.length ?? 0;
              const stickyBg = own ? "bg-[#eef8f3]" : muted ? "bg-cream-100" : "bg-white";

              return (
                <tr
                  key={e.competitorId}
                  className={cn(own ? "bg-emerald-50/70" : muted ? "bg-cream-100/70 text-navy-600" : "hover:bg-cream-50")}
                >
                  <td className="!align-top font-bold text-navy-900">
                    <span className="tabular-nums">{e.no}</span>
                  </td>
                  <th scope="row" className={cn("sticky left-0 z-[1] !align-top border-b border-r border-cream-200 px-2.5 py-2.5 text-left font-normal", stickyBg)}>
                    <div className={cn("font-bold", own ? "text-emerald-950" : "text-navy-900")}>{e.name}</div>
                    <div className="text-[10px] text-navy-500">
                      {own ? "Outlet kita" : e.parentName ? `Di dalam ${e.parentName}` : "Tempat mandiri"}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setDetailEntry(e)}
                        className="rounded-full border border-navy-300 bg-cream-50 px-2 py-0.5 text-[10px] font-semibold text-navy-900 hover:bg-cream-200"
                      >
                        Lihat detail lengkap
                      </button>
                      {photoCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setPhotoEntry(e)}
                          className="rounded-full border border-cream-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-navy-700 hover:bg-cream-100"
                        >
                          {photoCount} foto
                        </button>
                      )}
                    </div>
                  </th>
                  <td className="!align-top whitespace-nowrap font-medium">{e.distanceLabel}</td>
                  <td className="!align-top whitespace-nowrap">
                    <span className="tabular-nums">{e.ratingLabel}</span>
                  </td>
                  <td className="!align-top font-semibold text-navy-900">
                    <div>{e.menuRangeLabel}</div>
                    {e.comparableGap && (
                      <span className="mt-0.5 block text-[10px] font-normal text-navy-600">
                        Selisih: <GapPill percent={e.comparableGap.percent} /> ({e.comparableGap.items} item)
                      </span>
                    )}
                  </td>
                  <td className="!align-top text-[11px] leading-snug text-navy-700">{sanitizePublicText(e.menuDetailLabel)}</td>
                  <td className="!align-top text-[11px] leading-snug text-navy-700">{sanitizePublicText(e.facilitiesLabel)}</td>
                  <td className="!align-top text-[11px] leading-relaxed text-navy-800">{sanitizePublicText(e.auditRationale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-navy-500">{sanitizePublicText(matrix.note)}</p>

      {items.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-sm font-bold text-navy-900">
            Perbandingan per item yang sebanding ({matrix.outletName} vs Kompetitor Inti)
          </h5>
          <div className="relative overflow-x-auto rounded-2xl border border-cream-300 bg-white">
            <table className="table-compact w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr>
                  <th>Item Sanghyang</th>
                  <th>Harga Sanghyang</th>
                  <th>Item sebanding di menu kompetitor</th>
                  <th>Rata-rata kompetitor inti</th>
                  <th>Selisih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200">
                {items.map((row) => {
                  const shown = row.matches.filter((m) => visibleRivalNames.has(m.rival));
                  const coreMatches = shown.filter((m) => m.core !== false);
                  const avg = coreMatches.length
                    ? Math.round(coreMatches.reduce((s, m) => s + m.price, 0) / coreMatches.length)
                    : null;
                  const avgGap =
                    avg !== null && row.sanghyangPrice > 0
                      ? Math.round(((avg - row.sanghyangPrice) / row.sanghyangPrice) * 100)
                      : null;

                  return (
                    <tr key={row.itemName} className="hover:bg-cream-50">
                      <th scope="row" className="!align-top border-b border-cream-200 px-2.5 py-2 text-left font-normal">
                        <span className="block font-bold text-navy-900">{row.itemName}</span>
                        {row.category && <span className="block text-[11px] text-navy-500">{row.category}</span>}
                      </th>
                      <td className="!align-top whitespace-nowrap font-bold text-navy-900">
                        <span className="tabular-nums">{fmtRupiah(row.sanghyangPrice)}</span>
                        {row.unit ? ` ${row.unit}` : ""}
                      </td>
                      <td className="!align-top text-[11px] text-navy-700">
                        {shown.length === 0 ? (
                          <span className="text-navy-500">Belum ada data</span>
                        ) : (
                          <ul className="space-y-1.5">
                            {shown.map((m) => (
                              <li key={m.rival}>
                                <span className="font-semibold text-navy-900">{m.rival}</span>
                                {m.core === false ? " (acuan, tidak dihitung)" : ""}:{" "}
                                <b className="tabular-nums">{fmtRupiah(m.price)}</b> <GapPill percent={m.gapPercent} />
                                <span className="block text-[11px] text-navy-600">{m.items.join(", ")}</span>
                                {m.generic && (
                                  <span className="block text-[11px] font-semibold text-amber-800">{GENERIC_MATCH_LABEL}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="!align-top whitespace-nowrap font-bold">
                        {avg !== null ? (
                          <>
                            <span className="tabular-nums text-navy-900">{fmtRupiah(avg)}</span>
                            {coreMatches.some((m) => m.generic) && (
                              <span className="block text-[10px] font-normal text-navy-500">termasuk padanan umum</span>
                            )}
                          </>
                        ) : (
                          <span className="font-normal text-navy-500">Belum ada data</span>
                        )}
                      </td>
                      <td className="!align-top whitespace-nowrap">
                        {avgGap !== null ? <GapPill percent={avgGap} /> : <span className="text-navy-500">Belum ada data</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailEntry && <SnFnbDetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />}
      {photoEntry && (
        <SnPhotoGalleryModal
          name={photoEntry.name}
          detail={[
            photoEntry.parentName
              ? `Di dalam ${photoEntry.parentName}`
              : photoEntry.role === "sanghyang"
                ? "Outlet Sanghyang"
                : "Tempat mandiri",
            photoEntry.distanceLabel,
          ]
            .filter(Boolean)
            .join(" · ")}
          mapsUrl={photoEntry.mapsUrl}
          photos={photoEntry.specs?.visual?.photoUrls ?? []}
          onClose={() => setPhotoEntry(null)}
        />
      )}
    </SkeuoCard>
  );
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - start.getTime()) / 86_400_000 + 1) / 7)).padStart(2, "0")}`;
}

function loadWeeklyDone(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Daftar 3 tindakan prioritas minggu ini dengan centang tersimpan di localStorage + Salin WhatsApp. */
export function SnWeeklyActions({ findings, outletKey }: { findings: SnOutletFinding[]; outletKey: string }) {
  const actions = useMemo(
    () =>
      findings
        .filter((f) => f.action !== "maintain")
        .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high"))
        .slice(0, 3),
    [findings],
  );
  const storageKey = `langkah-minggu-ini:${outletKey}:${isoWeek(new Date())}`;
  const [doneByKey, setDoneByKey] = useState<Record<string, string[]>>({});
  const [copied, setCopied] = useState(false);

  const done = doneByKey[storageKey] ?? loadWeeklyDone(storageKey);

  const toggle = (findingId: string) => {
    const next = done.includes(findingId) ? done.filter((x) => x !== findingId) : [...done, findingId];
    setDoneByKey((prev) => ({ ...prev, [storageKey]: next }));
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Mode privat: centang hanya bertahan di sesi ini.
    }
  };

  const copyToWhatsApp = () => {
    const week = isoWeek(new Date());
    const outletLabel = OUTLET_LABELS[outletKey] ?? (outletKey === "all" ? "Semua Outlet" : outletKey);
    const lines = [
      `*RINGKASAN AKSI RAPAT SENIN - SANGHYANG INDAH*`,
      `*Outlet:* ${outletLabel} · *Minggu:* ${week}`,
      "",
      `*3 TINDAKAN PRIORITAS MINGGU INI:*`,
      ...actions.map((f, i) => {
        const title = f.title.replace(/^\[[^\]]*\]\s*/, "");
        const prefix = done.includes(f.id) ? "[Selesai]" : "[Belum Selesai]";
        const step = f.steps[0] ? `\n   Langkah: ${f.steps[0]}` : "";
        return `${i + 1}. ${prefix} *${f.outletName ? `${f.outletName}: ` : ""}${title}*${step}`;
      }),
    ];
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(lines.join("\n")).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      });
    }
  };

  if (actions.length === 0) {
    return <p className="text-sm text-emerald-800">Tidak ada tindakan mendesak. Pertahankan yang sudah berjalan baik.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {actions.map((f) => {
          const checked = done.includes(f.id);
          return (
            <li key={f.id} className="rounded-xl border border-cream-300 bg-white p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(f.id)}
                  className="mt-1 h-4 w-4 accent-navy-900"
                />
                <span className="text-sm">
                  <span className={cn("font-bold", checked ? "text-navy-400 line-through" : "text-navy-900")}>
                    {f.outletName ? `${f.outletName}: ` : ""}
                    {f.title.replace(/^\[[^\]]*\]\s*/, "")}
                  </span>
                  {f.steps[0] && <span className="mt-0.5 block text-xs text-navy-600">Caranya: {f.steps[0]}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-cream-200 pt-2.5">
        <span className="text-[11px] text-navy-500">
          Centang tindakan yang sudah diselesaikan tim minggu ini. Tersimpan di peramban ini.
        </span>
        <button
          type="button"
          onClick={copyToWhatsApp}
          className="skeuo-pill-light inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          <span>{copied ? "Tersalin" : "Salin ringkasan aksi (WhatsApp)"}</span>
        </button>
      </div>
    </div>
  );
}
