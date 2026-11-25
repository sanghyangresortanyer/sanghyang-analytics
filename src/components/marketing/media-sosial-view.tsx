"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, HelpCircle, Lightbulb, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { SkeuoCard, StatusPill } from "@/components/skeuo/ui";
import {
  OFFICIAL_ACCOUNTS_SOURCE,
  OUTLET_LABELS,
  OUTLET_TABS,
  computeSosmedStats,
  fmtDateShort,
  formatMarketingClientError,
  groupSocialPostsByOutlet,
  likeRatePercent,
  marketingApiErrorFromResponse,
  postDayWib,
  postOverallScore,
  socialAccountKey,
  summarizeSocialAccountCoverage,
  type OutletChoice,
  type OutletKey,
  type SnOfficialSocialAccount,
  type SnPlatformSosmedStats,
  type SnSocialAccountCoverage,
  type SnSocialApiResponse,
  type SnSocialPost,
} from "@/lib/marketing/market-intelligence-types";
import { cn } from "@/lib/utils";
import { SnExtensionPanel, useSocialExtensionSync, type UseSocialExtensionSyncResult } from "./sn-extension-panel";

const VERDICT_OPTIONS = [
  { key: "all", label: "Semua status efektivitas" },
  { key: "high_performing", label: "Efektif" },
  { key: "weak_cta", label: "CTA lemah (perlu tautan WA)" },
  { key: "needs_hook_revision", label: "Hook perlu revisi" },
  { key: "low_traction", label: "Kurang traksi" },
] as const;

const VERDICT_TONE: Record<string, "green" | "amber" | "ember" | "muted"> = {
  high_performing: "green",
  weak_cta: "amber",
  needs_hook_revision: "ember",
  low_traction: "muted",
};

const VERDICT_LABEL: Record<string, string> = {
  high_performing: "Efektif",
  weak_cta: "CTA lemah",
  needs_hook_revision: "Hook perlu revisi",
  low_traction: "Kurang traksi",
};

const fmtInt = (n: number) => n.toLocaleString("id-ID");
const numOrDash = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? fmtInt(n) : "-");

function PlatformSummaryCard({
  platform,
  label,
  dotClass,
  stats,
  isCustomRange,
  startDate,
  endDate,
  activeOutlet,
  outletLabel,
  extSync,
}: {
  platform: "instagram" | "tiktok";
  label: string;
  dotClass: string;
  stats: SnPlatformSosmedStats;
  isCustomRange: boolean;
  startDate: string;
  endDate: string;
  activeOutlet: OutletChoice;
  outletLabel: string;
  extSync: UseSocialExtensionSyncResult;
}) {
  const metrics = [
    { key: "followers", label: "Pengikut", value: numOrDash(stats.followers) },
    { key: "posts", label: "Postingan", value: numOrDash(stats.posts) },
    { key: "views", label: "Views", value: numOrDash(stats.views?.total) },
    { key: "likes", label: "Likes", value: numOrDash(stats.likes?.total) },
  ];

  const hasAccount = stats.accounts > 0;
  const hasProfileTotal = stats.profilePostsTotal !== null && stats.profilePostsTotal > 0;
  const incomplete = hasProfileTotal && stats.syncedAccountPosts < stats.profilePostsTotal!;
  const syncPct = hasProfileTotal ? Math.min(100, Math.round((stats.syncedAccountPosts / stats.profilePostsTotal!) * 100)) : null;

  const syncedSummary = hasProfileTotal
    ? `${fmtInt(stats.syncedAccountPosts)} / ${fmtInt(stats.profilePostsTotal!)} profil`
    : `${fmtInt(stats.syncedAccountPosts)} postingan`;
  const latestSuffix = stats.latestSyncedPostAt ? ` (terbaru ${fmtDateShort(stats.latestSyncedPostAt)})` : "";

  const totalOutsideCount = stats.syncedAccountPosts > 0 ? stats.syncedAccountPosts : stats.outletAllPostsCount;
  const latestOutsideDate = stats.latestSyncedPostAt ?? stats.latestOutletPostAt;
  const hasDataOutsideRange = isCustomRange && stats.posts === 0 && totalOutsideCount > 0;

  const syncBusy =
    extSync.savingBatch ||
    extSync.state?.status === "running" ||
    extSync.state?.status === "needs_human_action";
  const canQuickSync = hasAccount && extSync.extensionInstalled && !extSync.needsUpdate && !syncBusy;
  const resetRangeHref = `/marketing?bagian=media-sosial&lihat=${encodeURIComponent(activeOutlet)}`;

  const parentOnly =
    stats.parentHandles.length > 0 &&
    stats.parentHandles.every((h) => /^@(sanghyangresort|sanghyangsparesort)$/i.test(h));
  const contributorLabel = parentOnly
    ? `akun induk ${stats.parentHandles.join(", ")} yang menyebut ${outletLabel}`
    : `akun ${stats.parentHandles.join(", ")} (termasuk akun induk / arsip akun lama)`;

  return (
    <div data-platform-card={platform}>
      <SkeuoCard className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-cream-300 pb-2.5">
        <h3 className="flex items-center gap-2 text-base font-bold text-navy-900">
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dotClass)} aria-hidden />
          {label}
        </h3>
        <span className="min-w-0 truncate text-xs font-semibold text-navy-500">
          {stats.handles.length > 0 ? stats.handles.join(", ") : `Belum ada akun ${label}`}
        </span>
      </div>

      <dl className="grid grid-cols-4 gap-2 text-center">
        {metrics.map((m) => (
          <div key={m.key}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-navy-500">{m.label}</dt>
            <dd className="mt-1 text-base font-bold tabular-nums text-navy-900">{m.value}</dd>
          </div>
        ))}
      </dl>

      {stats.parentAccountPosts > 0 && (
        <p className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-1.5 text-[11px] text-navy-700">
          {stats.ownAccountPosts === 0
            ? `Semua ${fmtInt(stats.posts)} postingan ${isCustomRange ? "periode ini " : ""}berasal dari ${contributorLabel}${hasAccount ? `; akun ${stats.handles.join(", ")} belum memiliki postingan ${isCustomRange ? "pada periode ini" : "tersinkron"}` : ""}.`
            : `Termasuk ${fmtInt(stats.parentAccountPosts)} postingan dari ${contributorLabel}.`}
        </p>
      )}

      {!hasAccount ? (
        isCustomRange ? (
          <p className="text-[11px] text-navy-600">
            Periode aktif {fmtDateShort(startDate)} – {fmtDateShort(endDate)} · Belum ada akun {label} khusus {outletLabel}.
          </p>
        ) : null
      ) : isCustomRange ? (
        <div className="space-y-2">
          <p className="text-[11px] text-navy-600">
            Periode aktif {fmtDateShort(startDate)} – {fmtDateShort(endDate)} · Total tersinkron akun: {syncedSummary}
            {latestSuffix}
          </p>

          {hasDataOutsideRange ? (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
              <p className="leading-relaxed">
                Tidak ada postingan {label} pada rentang {fmtDateShort(startDate)} – {fmtDateShort(endDate)}. Sebanyak{" "}
                <strong>{fmtInt(totalOutsideCount)} postingan</strong> tersinkron berada di luar rentang tanggal terpilih
                {latestOutsideDate ? ` (terbaru ${fmtDateShort(latestOutsideDate)})` : ""}.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={resetRangeHref}
                  prefetch={false}
                  className="inline-flex items-center gap-1 rounded-full border border-navy-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy-900 hover:bg-cream-100"
                >
                  Lihat semua periode
                </Link>
                {canQuickSync ? (
                  <button
                    type="button"
                    onClick={() => void extSync.startSync({ outletKey: activeOutlet, platform })}
                    className="inline-flex items-center gap-1 rounded-full bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-cream-50 hover:bg-navy-800"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden />
                    Sinkron ulang {label}
                  </button>
                ) : !syncBusy ? (
                  <span className="text-[10px] text-amber-900">
                    Sinkronkan ulang lewat panel Ekstensi Chrome di atas untuk mengambil postingan terbaru.
                  </span>
                ) : null}
              </div>
            </div>
          ) : stats.posts === 0 && stats.syncedAccountPosts === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cream-300 bg-cream-50 px-3 py-1.5 text-[11px] text-navy-700">
              <span>Belum ada postingan {label} yang tersinkron untuk akun ini.</span>
              {canQuickSync && (
                <button
                  type="button"
                  onClick={() => void extSync.startSync({ outletKey: activeOutlet, platform })}
                  className="inline-flex items-center gap-1 rounded-full bg-navy-900 px-2.5 py-0.5 text-[11px] font-semibold text-cream-50 hover:bg-navy-800"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  Sinkron {label}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : incomplete ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900">
          <span>
            Tersinkron {fmtInt(stats.syncedAccountPosts)} dari {fmtInt(stats.profilePostsTotal!)} postingan profil ({syncPct}%
            {stats.latestSyncedPostAt ? `, terbaru ${fmtDateShort(stats.latestSyncedPostAt)}` : ""}). Sinkronkan lewat Chrome biasa yang sudah login agar seluruh riwayat terbaca.
          </span>
          {canQuickSync && (
            <button
              type="button"
              onClick={() => void extSync.startSync({ outletKey: activeOutlet, platform })}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-cream-50 hover:bg-navy-800"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Sinkron ulang {label}
            </button>
          )}
        </div>
      ) : hasProfileTotal ? (
        <p className="text-[11px] font-medium text-emerald-800">
          Cakupan profil lengkap: {fmtInt(stats.syncedAccountPosts)} / {fmtInt(stats.profilePostsTotal!)} postingan tersinkron
          {latestSuffix}.
        </p>
      ) : stats.syncedAccountPosts > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-navy-600">
          <span>
            Total tersinkron akun: {fmtInt(stats.syncedAccountPosts)} postingan{latestSuffix}.
          </span>
          {canQuickSync && (
            <button
              type="button"
              onClick={() => void extSync.startSync({ outletKey: activeOutlet, platform })}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cream-300 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-navy-800 hover:bg-cream-100"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Sinkron ulang {label}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cream-300 bg-cream-50 px-3 py-1.5 text-[11px] text-navy-700">
          <span>Belum ada postingan {label} tersinkron untuk akun ini.</span>
          {canQuickSync && (
            <button
              type="button"
              onClick={() => void extSync.startSync({ outletKey: activeOutlet, platform })}
              className="inline-flex items-center gap-1 rounded-full bg-navy-900 px-2.5 py-0.5 text-[11px] font-semibold text-cream-50 hover:bg-navy-800"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Sinkron {label}
            </button>
          )}
        </div>
      )}
      </SkeuoCard>
    </div>
  );
}

function SocialPostCard({
  post,
  accountFollowers,
}: {
  post: SnSocialPost;
  accountFollowers: number | null;
}) {
  const score = postOverallScore(post.audit);
  const followers = post.followers ?? post.metrics?.followers ?? accountFollowers;
  const likeRate = likeRatePercent(post.metrics?.likes, followers);
  const outletName = OUTLET_LABELS[post.outletKey] ?? post.outletKey;

  return (
    <article className="flex flex-col justify-between space-y-3 rounded-2xl border border-cream-300 bg-white p-4">
      {/* Header Postingan */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-200 pb-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-cream-300 bg-cream-50 px-2 py-0.5 text-[10px] font-bold uppercase text-navy-900">
            {outletName}
          </span>
          <span className="font-semibold text-navy-700">
            {post.account ? `@${post.account.replace(/^@/, "")}` : post.platform.toUpperCase()}
            {Array.isArray(post.collabAccounts) && post.collabAccounts.length > 0
              ? ` × ${post.collabAccounts.map((h) => `@${h.replace(/^@/, "")}`).join(", ")}`
              : ""}{" "}
            · {post.postType}
          </span>
          <span className="text-navy-500">Tayang: {fmtDateShort(post.postedAt)}</span>
          <a
            href={post.postUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-navy-800 underline hover:text-navy-900"
          >
            <span>Buka postingan</span>
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={VERDICT_TONE[post.audit.statusVerdict] ?? "muted"}>
            {post.audit.verdictLabel ?? VERDICT_LABEL[post.audit.statusVerdict] ?? post.audit.statusVerdict} ({score}/100)
          </StatusPill>
          {typeof post.audit.engagementRatePercent === "number" && (
            <span className="rounded-full border border-cream-300 bg-cream-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-navy-700">
              Eng: {post.audit.engagementRatePercent.toLocaleString("id-ID")}%
            </span>
          )}
        </div>
      </div>

      {/* Caption Lengkap (dapat digulir) */}
      <div className="max-h-40 overflow-y-auto whitespace-pre-line rounded-xl border border-cream-200 bg-cream-50 p-3 text-xs leading-relaxed text-navy-800 italic">
        &ldquo;{post.caption}&rdquo;
      </div>

      {/* Metrik Performa 5 Kolom */}
      {post.metrics === null ? (
        <p className="rounded-xl border border-dashed border-cream-300 p-2.5 text-center text-xs text-navy-600">
          {post.platform === "tiktok"
            ? "Views, komentar, dan shares diperbarui otomatis saat sinkronisasi akun lewat Ekstensi Chrome."
            : "Views, komentar, shares, dan chat WA belum terisi (sinkronkan lewat Ekstensi Chrome atau isi dari Instagram Insights)."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-cream-200 bg-cream-50 p-2.5 text-center text-xs sm:grid-cols-5">
          <div>
            <div className="text-[10px] font-semibold text-navy-500">Views</div>
            <div className="font-extrabold tabular-nums text-navy-900">
              {post.metrics.views !== null ? fmtInt(post.metrics.views) : "-"}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-navy-500">Likes</div>
            <div className="font-extrabold tabular-nums text-navy-900">
              {post.metrics.likes !== null ? fmtInt(post.metrics.likes) : "-"}
            </div>
            {likeRate !== null && (
              <div className="text-[10px] tabular-nums text-navy-500">
                {likeRate.toLocaleString("id-ID")}% pengikut
              </div>
            )}
          </div>
          <div>
            <div className="text-[10px] font-semibold text-navy-500">Komentar</div>
            <div className="font-extrabold tabular-nums text-navy-900">
              {post.metrics.comments !== null ? fmtInt(post.metrics.comments) : "-"}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-navy-500">Shares</div>
            <div className="font-extrabold tabular-nums text-navy-900">
              {post.metrics.shares !== null ? fmtInt(post.metrics.shares) : "-"}
            </div>
          </div>
          <div className="col-span-2 rounded-lg border border-cream-300 bg-white p-1 sm:col-span-1">
            <div className="text-[10px] font-semibold text-navy-500">
              {post.platform === "tiktok" ? "Interaksi" : "Leads WA"}
            </div>
            <div className="font-bold tabular-nums text-navy-900">
              {post.platform === "tiktok"
                ? post.metrics.shares !== null
                  ? `${fmtInt(post.metrics.shares)} share`
                  : "-"
                : post.metrics.inquiriesWa !== null
                  ? `+${fmtInt(post.metrics.inquiriesWa)} chat`
                  : "-"}
            </div>
          </div>
        </div>
      )}

      {/* 3 Pilar Audit Caption */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-cream-300 bg-white p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-navy-900">Daya Tarik Hook</span>
            <span className="font-extrabold tabular-nums text-navy-900">{post.audit.hookScore}/100</span>
          </div>
          {post.audit.hookFeedback && (
            <p className="mt-1 text-[11px] leading-snug text-navy-600">{post.audit.hookFeedback}</p>
          )}
        </div>

        <div className="rounded-xl border border-cream-300 bg-white p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-navy-900">Kejelasan Copy</span>
            <span className="font-extrabold tabular-nums text-navy-900">{post.audit.copyScore}/100</span>
          </div>
          {post.audit.copyFeedback && (
            <p className="mt-1 text-[11px] leading-snug text-navy-600">{post.audit.copyFeedback}</p>
          )}
        </div>

        <div className="rounded-xl border border-cream-300 bg-white p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-navy-900">Kekuatan CTA</span>
            <span
              className={cn(
                "font-extrabold tabular-nums",
                post.audit.ctaScore < 60 ? "text-red-700" : "text-navy-900",
              )}
            >
              {post.audit.ctaScore}/100
            </span>
          </div>
          {post.audit.ctaFeedback && (
            <p className="mt-1 text-[11px] leading-snug text-navy-600">{post.audit.ctaFeedback}</p>
          )}
        </div>
      </div>

      {/* Rekomendasi Perbaikan */}
      {(post.audit.recommendedRevisionHeadline || post.audit.actionDirective) && (
        <div className="space-y-1 rounded-xl border border-cream-300 bg-cream-50 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-navy-900">
            <Lightbulb className="h-3.5 w-3.5 text-amber-700" aria-hidden />
            <span>Rekomendasi Perbaikan</span>
          </div>
          {post.audit.recommendedRevisionHeadline && (
            <p className="font-semibold text-navy-900">
              Contoh pembuka alternatif: &ldquo;{post.audit.recommendedRevisionHeadline}&rdquo;
            </p>
          )}
          {post.audit.actionDirective && (
            <p className="text-[11px] leading-relaxed text-navy-700">
              <strong className="text-navy-900">Saran perbaikan:</strong> {post.audit.actionDirective}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export function MediaSosialView({
  startDate,
  endDate,
  isCustomRange,
  activeOutlet,
}: {
  startDate: string;
  endDate: string;
  isCustomRange: boolean;
  activeOutlet: OutletChoice;
}) {
  const [posts, setPosts] = useState<SnSocialPost[]>([]);
  const [accounts, setAccounts] = useState<SnOfficialSocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<string>("all");
  const [showFormula, setShowFormula] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [customOutlet, setCustomOutlet] = useState<OutletKey | null>(null);
  const formOutlet: OutletKey = customOutlet ?? (activeOutlet === "all" ? "resort" : activeOutlet);
  const [formPlatform, setFormPlatform] = useState<"instagram" | "tiktok" | "facebook">("instagram");
  const [formType, setFormType] = useState<"reels" | "feed" | "carousel" | "tiktok_video" | "story">("reels");
  const [formDate, setFormDate] = useState<string>(endDate);
  const [formUrl, setFormUrl] = useState("");
  const [formCaption, setFormCaption] = useState("");
  const [formViews, setFormViews] = useState("");
  const [formLikes, setFormLikes] = useState("");
  const [formComments, setFormComments] = useState("");
  const [formShares, setFormShares] = useState("");
  const [formWa, setFormWa] = useState("");

  const reloadPosts = useCallback(() => setReloadTick((t) => t + 1), []);
  const extSync = useSocialExtensionSync(reloadPosts);

  useEffect(() => {
    let live = true;
    fetch("/api/marketing-sosmed", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as (SnSocialApiResponse & { error?: string }) | null;
        if (!res.ok || !json || !Array.isArray(json.posts)) {
          throw marketingApiErrorFromResponse(res.status, json?.error);
        }
        return json;
      })
      .then((json) => {
        if (!live) return;
        setPosts(json.posts);
        setAccounts(json.officialAccounts ?? []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(
          formatMarketingClientError(
            err,
            (detail) => `Data Media Sosial tidak dapat dimuat (${detail}). Coba muat ulang halaman beberapa saat lagi.`,
          ),
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reloadTick]);

  const latestDay = useMemo(
    () =>
      posts.reduce<string | null>(
        (best, p) =>
          typeof p.postedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.postedAt) && (!best || p.postedAt.slice(0, 10) > best)
            ? p.postedAt.slice(0, 10)
            : best,
        null,
      ),
    [posts],
  );

  // Semua postingan untuk outlet aktif (sebelum saringan tanggal kustom) agar rasio periode terlihat jelas.
  const outletAllPosts = useMemo(
    () => (activeOutlet === "all" ? posts : posts.filter((p) => p.outletKey === activeOutlet)),
    [posts, activeOutlet],
  );

  // Default (isCustomRange === false) menampilkan SELURUH data tercatat; saat filter diterapkan manual, saring sesuai rentang WIB.
  const periodPosts = useMemo(() => {
    if (!isCustomRange || !startDate || !endDate) return outletAllPosts;
    return outletAllPosts.filter((p) => {
      const day = postDayWib(p.postedAt);
      return day >= startDate && day <= endDate;
    });
  }, [outletAllPosts, isCustomRange, startDate, endDate]);

  const shownPosts = useMemo(
    () => (verdictFilter === "all" ? periodPosts : periodPosts.filter((p) => p.audit.statusVerdict === verdictFilter)),
    [periodPosts, verdictFilter],
  );

  const visibleAccounts = useMemo(() => {
    if (activeOutlet === "all") return accounts;
    return accounts.filter((a) => a.outlets.includes(activeOutlet));
  }, [accounts, activeOutlet]);

  const parentInstagram = useMemo(
    () => accounts.find((a) => a.platform === "instagram" && a.outlets.includes("resort"))?.label ?? "@sanghyangresort",
    [accounts],
  );

  const accountCoverage: Record<string, SnSocialAccountCoverage> = useMemo(
    () => summarizeSocialAccountCoverage(posts, accounts),
    [posts, accounts],
  );

  const stats = useMemo(
    () => computeSosmedStats(periodPosts, visibleAccounts, accountCoverage, outletAllPosts),
    [periodPosts, visibleAccounts, accountCoverage, outletAllPosts],
  );

  const groupedTotals = useMemo(
    () => new Map(groupSocialPostsByOutlet(periodPosts).map((g) => [g.outlet, g.posts.length])),
    [periodPosts],
  );
  const groupedShown = useMemo(() => groupSocialPostsByOutlet(shownPosts), [shownPosts]);

  const followersForPost = (post: SnSocialPost): number | null => {
    if (!post.account) return null;
    return accountCoverage[socialAccountKey(post.platform, post.account)]?.followers ?? null;
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch("/api/marketing-sosmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletKey: formOutlet,
          platform: formPlatform,
          postType: formType,
          postedAt: formDate,
          postUrl: formUrl.trim(),
          caption: formCaption.trim(),
          metrics: {
            views: formViews ? Number(formViews) : null,
            likes: formLikes ? Number(formLikes) : null,
            comments: formComments ? Number(formComments) : null,
            shares: formShares ? Number(formShares) : null,
            inquiriesWa: formWa ? Number(formWa) : null,
          },
        }),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; post?: SnSocialPost; error?: string } | null;
      if (!res.ok || !json?.success || !json.post) {
        throw marketingApiErrorFromResponse(res.status, json?.error);
      }
      setPosts((prev) => [json.post!, ...prev.filter((p) => p.postUrl !== json.post!.postUrl)]);
      setShowAddForm(false);
      setFormUrl("");
      setFormCaption("");
      setFormViews("");
      setFormLikes("");
      setFormComments("");
      setFormShares("");
      setFormWa("");
      setFeedback(`Postingan berhasil disimpan ke basis data lokal untuk ${OUTLET_LABELS[json.post.outletKey] ?? json.post.outletKey}.`);
    } catch (err) {
      setError(formatMarketingClientError(err, (detail) => `Gagal menyimpan postingan: ${detail}`));
    } finally {
      setSaving(false);
    }
  };

  const outletLabel = OUTLET_LABELS[activeOutlet] ?? "Semua Outlet";
  const likeSplit = `Instagram ${stats.instagram.likes ? fmtInt(stats.instagram.likes.total) : "-"} · TikTok ${stats.tiktok.likes ? fmtInt(stats.tiktok.likes.total) : "-"}`;

  return (
    <div className="space-y-4">
      <SkeuoCard className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Media Sosial Resmi</p>
            <h2 className="mt-0.5 text-xl font-semibold text-navy-900">Marketing Media Sosial: {outletLabel}</h2>
            <p className="mt-0.5 text-sm text-navy-600">
              {isCustomRange
                ? `Menampilkan ${fmtInt(periodPosts.length)} postingan pada periode ${fmtDateShort(startDate)} – ${fmtDateShort(endDate)} (dari ${fmtInt(outletAllPosts.length)} catatan ${outletLabel}).`
                : `Menampilkan seluruh ${fmtInt(periodPosts.length)} postingan tercatat beserta akun resmi dan evaluasi mutu caption (hook, copy, CTA).`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFormula((v) => !v)}
              className="skeuo-pill-light inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold"
            >
              <HelpCircle className="h-4 w-4" aria-hidden />
              Rumus skor caption
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              aria-expanded={showAddForm}
              className="skeuo-pill-dark inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Catat postingan tayang
            </button>
          </div>
        </div>

        <p role="note" className="rounded-xl border border-cream-300 bg-cream-50 px-3.5 py-2.5 text-xs leading-relaxed text-navy-700">
          {latestDay ? `Postingan akun Instagram & TikTok resmi terakhir tercatat ${fmtDateShort(latestDay)}` : "Postingan akun resmi belum diamati"}
          , ditambah postingan yang dicatat tim (postingan akun induk masuk ke unit bisnis yang disebut di keterangannya). Views, likes, komentar, dan shares disinkronkan lewat Ekstensi Chrome dari akun yang sudah masuk; Leads WA diisi manual oleh tim.
        </p>

        <SnExtensionPanel sync={extSync} outletKey={activeOutlet} outletLabel={outletLabel} />
      </SkeuoCard>

      {feedback && (
        <div role="status" className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            {feedback}
          </span>
          <button type="button" onClick={() => setFeedback(null)} aria-label="Tutup pesan">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      {showFormula && (
        <SkeuoCard className="space-y-3 border border-cream-300">
          <div className="flex items-center justify-between border-b border-cream-200 pb-2.5">
            <h3 className="text-base font-semibold text-navy-900">Transparansi Rumus Skor Mutu Caption (0–100)</h3>
            <button type="button" onClick={() => setShowFormula(false)} className="text-sm font-semibold text-navy-600 hover:text-navy-900">
              Tutup
            </button>
          </div>
          <p className="text-xs text-navy-600">
            Skor Mutu Caption dihitung secara deterministik dari tiga pilar terukur tanpa angka sintetis:
          </p>
          <ul className="space-y-2 rounded-xl border border-cream-200 bg-cream-50 p-3.5 text-xs text-navy-800">
            <li>
              <strong>1. Daya Tarik Awal (Hook · Bobot 35%):</strong> Mendeteksi kata penarik perhatian di baris awal (promo, spesial, terbatas, hemat, diskon) serta retensi format video pendek (Reels/TikTok).
            </li>
            <li>
              <strong>2. Kejelasan Penawaran (Copywriting · Bobot 35%):</strong> Memeriksa kejelasan harga atau persentase hemat serta keunggulan fasilitas pantai/sunset.
            </li>
            <li>
              <strong>3. Ajakan Bertindak (CTA · Bobot 30%):</strong> Mendeteksi kejelasan instruksi pemesanan langsung (WhatsApp, DM, tautan bio, reservasi).
            </li>
          </ul>
          <p className="rounded-lg bg-white px-3 py-2 font-mono text-xs text-navy-900 border border-cream-300">
            Skor Akhir = (Hook × 0.35) + (Copywriting × 0.35) + (CTA × 0.30)
          </p>
        </SkeuoCard>
      )}

      {showAddForm && (
        <SkeuoCard>
          <form onSubmit={(e) => void handleCreatePost(e)} className="space-y-4">
            <h3 className="text-lg font-semibold text-navy-900">Catat Postingan Tayang</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                Unit Bisnis
                <select
                  value={formOutlet}
                  onChange={(e) => setCustomOutlet(e.target.value as OutletKey)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                >
                  {OUTLET_TABS.filter((t) => t.key !== "all").map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                Platform
                <select
                  value={formPlatform}
                  onChange={(e) => setFormPlatform(e.target.value as "instagram" | "tiktok" | "facebook")}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                >
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="facebook">Facebook</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                Format
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as "reels" | "feed" | "carousel" | "tiktok_video" | "story")}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                >
                  <option value="reels">Reels</option>
                  <option value="feed">Feed</option>
                  <option value="carousel">Carousel</option>
                  <option value="tiktok_video">Video TikTok</option>
                  <option value="story">Story</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                Tanggal Tayang
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  required
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                Tautan Postingan Resmi
                <input
                  type="url"
                  required
                  placeholder="https://www.instagram.com/reel/..."
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-navy-900"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                  Views
                  <input type="number" min={0} value={formViews} onChange={(e) => setFormViews(e.target.value)} placeholder="opsional" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                  Likes
                  <input type="number" min={0} value={formLikes} onChange={(e) => setFormLikes(e.target.value)} placeholder="opsional" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                  Komentar
                  <input type="number" min={0} value={formComments} onChange={(e) => setFormComments(e.target.value)} placeholder="opsional" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                  Shares
                  <input type="number" min={0} value={formShares} onChange={(e) => setFormShares(e.target.value)} placeholder="opsional" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
                  Chat WA
                  <input type="number" min={0} value={formWa} onChange={(e) => setFormWa(e.target.value)} placeholder="opsional" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm" />
                </label>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-xs font-semibold text-navy-700">
              Caption Lengkap
              <textarea
                required
                rows={3}
                value={formCaption}
                onChange={(e) => setFormCaption(e.target.value)}
                placeholder="Tempel caption asli dari postingan…"
                className="rounded-lg border border-slate-300 bg-white p-3 text-sm text-navy-900"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="btn-secondary">
                Batal
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? "Menyimpan…" : "Simpan Postingan"}
              </button>
            </div>
          </form>
        </SkeuoCard>
      )}

      {/* Baris 1: 2 Kartu Platform (Instagram & TikTok) — 100% paritas outlet-sections.tsx */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <PlatformSummaryCard
          platform="instagram"
          label="Instagram"
          dotClass="bg-[#E1306C]"
          stats={stats.instagram}
          isCustomRange={isCustomRange}
          startDate={startDate}
          endDate={endDate}
          activeOutlet={activeOutlet}
          outletLabel={outletLabel}
          extSync={extSync}
        />
        <PlatformSummaryCard
          platform="tiktok"
          label="TikTok"
          dotClass="bg-navy-900"
          stats={stats.tiktok}
          isCustomRange={isCustomRange}
          startDate={startDate}
          endDate={endDate}
          activeOutlet={activeOutlet}
          outletLabel={outletLabel}
          extSync={extSync}
        />
      </div>

      {/* Baris 2: 3 Kartu Metrik (Likes terpantau, Skor mutu caption, Chat WA) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SkeuoCard>
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">Likes terpantau</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-navy-900">
            {stats.likes ? `${fmtInt(stats.likes.total)} likes` : "Belum ada data"}
          </p>
          <p className="mt-1 text-xs text-navy-600">
            {stats.likes
              ? `Rata-rata ${fmtInt(stats.likes.average)} per postingan, dari ${fmtInt(stats.likes.counted)} postingan (${likeSplit})`
              : "Likes publik belum terbaca"}
          </p>
        </SkeuoCard>

        <SkeuoCard>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">Skor mutu caption</p>
            <button
              type="button"
              onClick={() => setShowFormula((v) => !v)}
              aria-label="Lihat rumus skor caption"
              className="rounded-full p-1 text-navy-500 hover:bg-cream-200 hover:text-navy-900"
            >
              <HelpCircle className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-navy-900">
            {stats.caption ? `${stats.caption.score}/100` : "Belum ada data"}
          </p>
          <p className="mt-1 text-xs text-navy-600">
            {stats.caption
              ? `Hook ${stats.caption.hook} · Copy ${stats.caption.copy} · CTA ${stats.caption.cta}`
              : "Belum ada postingan untuk dinilai"}
          </p>
        </SkeuoCard>

        <SkeuoCard className="border-emerald-200 bg-emerald-50/40">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">Chat WhatsApp dari postingan</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">
            {stats.waLeads ? `${fmtInt(stats.waLeads.total)} chat` : "Belum diisi"}
          </p>
          <p className="mt-1 text-xs text-emerald-800/90">
            {stats.waLeads
              ? `Dari ${fmtInt(stats.waLeads.filled)} postingan yang angkanya diisi tim`
              : "Diisi tim dari Instagram Insights"}
          </p>
        </SkeuoCard>
      </div>

      {/* Akun Media Sosial Resmi */}
      <SkeuoCard className="space-y-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Akun media sosial resmi</p>
          <h3 className="mt-0.5 text-base font-semibold text-navy-900">
            {activeOutlet === "all" ? "Akun induk dan akun outlet Sanghyang" : `Akun ${outletLabel}`}
          </h3>
          <p className="text-xs text-navy-600">
            Sumber resmi: tautan di{" "}
            <a href={OFFICIAL_ACCOUNTS_SOURCE} target="_blank" rel="noreferrer" className="font-semibold text-navy-800 underline">
              sanghyang.com
            </a>
            .
          </p>
        </div>

        {activeOutlet !== "all" && activeOutlet !== "resort" && (
          <p className="text-xs text-navy-600">
            Akun induk {parentInstagram} juga mempromosikan {outletLabel}; postingannya yang menyebut outlet ini ikut masuk di daftar postingan di bawah.
          </p>
        )}

        {visibleAccounts.length === 0 ? (
          <p className="text-xs text-navy-600">Belum ada akun media sosial khusus {outletLabel}.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {visibleAccounts.map((acc) => {
              const cov =
                acc.platform === "instagram" || acc.platform === "tiktok"
                  ? accountCoverage[socialAccountKey(acc.platform, acc.label)]
                  : undefined;
              return (
                <a
                  key={acc.url}
                  href={acc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 overflow-hidden rounded-xl border border-cream-300 bg-white p-3 transition hover:border-navy-500"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-navy-500">
                    {acc.platform} · {acc.owner}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs font-bold text-navy-900">{acc.label}</p>
                  {cov && (
                    <p
                      className={cn(
                        "mt-1 whitespace-normal break-words text-[11px] leading-snug",
                        cov.incomplete ? "font-medium text-amber-800" : "text-navy-600",
                      )}
                    >
                      {cov.followers !== null ? `${fmtInt(cov.followers)} pengikut · ` : ""}
                      {cov.profilePostsTotal !== null
                        ? `${fmtInt(cov.syncedPosts)} / ${fmtInt(cov.profilePostsTotal)} postingan tersinkron`
                        : `${fmtInt(cov.syncedPosts)} postingan tersinkron`}
                      {cov.latestPostAt ? ` · terbaru ${fmtDateShort(cov.latestPostAt)}` : ""}
                    </p>
                  )}
                </a>
              );
            })}
          </div>
        )}
      </SkeuoCard>

      {/* Evaluasi Efektivitas Konten */}
      <SkeuoCard className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-cream-300 pb-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-navy-500">Evaluasi efektivitas konten</p>
            <h3 className="mt-0.5 text-lg font-semibold text-navy-900">
              {activeOutlet === "all" ? `Postingan per unit bisnis (${fmtInt(shownPosts.length)})` : `Postingan ${outletLabel} (${fmtInt(shownPosts.length)})`}
            </h3>
            <p className="text-xs text-navy-600">
              Daya pikat baris pembuka (hook), kejelasan penawaran (copy), dan ajakan bertindak (CTA) tiap postingan.
            </p>
          </div>
          <select
            value={verdictFilter}
            onChange={(e) => setVerdictFilter(e.target.value)}
            aria-label="Saring status efektivitas"
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-navy-800"
          >
            {VERDICT_OPTIONS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-navy-600">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Memuat data postingan…
          </div>
        ) : activeOutlet === "all" ? (
          <div className="space-y-6">
            {groupedShown.map((group) => {
              const groupName = OUTLET_LABELS[group.outlet] ?? group.outlet;
              const groupTotal = groupedTotals.get(group.outlet) ?? 0;
              return (
                <section key={group.outlet} aria-labelledby={`postingan-${group.outlet}`} className="space-y-3">
                  <h4 id={`postingan-${group.outlet}`} className="border-b border-cream-300 pb-1.5 text-base font-bold text-navy-900">
                    {groupName}{" "}
                    <span className="font-normal text-navy-500">· {fmtInt(group.posts.length)} postingan</span>
                  </h4>
                  {group.posts.length > 0 ? (
                    <div className="space-y-3">
                      {group.posts.map((post) => (
                        <SocialPostCard key={post.id} post={post} accountFollowers={followersForPost(post)} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-navy-600">
                      {groupTotal === 0
                        ? `Belum ada postingan ${groupName} yang tercatat${isCustomRange ? " pada periode terpilih" : ""}.`
                        : `Tidak ada postingan ${groupName} yang cocok dengan saringan efektivitas.`}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        ) : shownPosts.length === 0 ? (
          <p className="rounded-xl bg-cream-100 p-8 text-center text-sm text-navy-600">
            {periodPosts.length === 0
              ? `Belum ada postingan ${outletLabel} yang tercatat${isCustomRange ? " pada periode yang dipilih" : ""}.`
              : `Tidak ada postingan ${outletLabel} yang cocok dengan saringan efektivitas.`}
          </p>
        ) : (
          <div className="space-y-3">
            {shownPosts.map((post) => (
              <SocialPostCard key={post.id} post={post} accountFollowers={followersForPost(post)} />
            ))}
          </div>
        )}
      </SkeuoCard>
    </div>
  );
}
