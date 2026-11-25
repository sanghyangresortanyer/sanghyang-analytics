"use client";

import { useMemo, useState } from "react";
import { rangeText } from "@/lib/format-date";
import type { InstagramAccount, InstagramMediaItem } from "@/lib/marketing/meta-instagram";
import { SkeuoCard } from "@/components/skeuo/ui";

interface InstagramFeedViewProps {
  accounts: InstagramAccount[];
  posts: InstagramMediaItem[];
  /** What could not be read, in plain words (null = everything was read). */
  problem?: string | null;
  startDate?: string;
  endDate?: string;
  isCustomRange?: boolean;
}

const WIB = "Asia/Jakarta";
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: WIB });

function toWibDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: WIB,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function InstagramFeedView({
  accounts,
  posts,
  problem = null,
  startDate,
  endDate,
  isCustomRange,
}: InstagramFeedViewProps) {
  const [selectedOutlet, setSelectedOutlet] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<"all" | "7d" | "30d">("all");
  const [showFullCaptions, setShowFullCaptions] = useState<boolean>(false);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedMap((prev) => ({ ...prev, [id]: !(prev[id] ?? showFullCaptions) }));
  };

  const hasGlobalRange = Boolean(isCustomRange && startDate && endDate);

  const postsInRange = useMemo(() => {
    if (!hasGlobalRange) return posts;
    return posts.filter((p) => {
      const day = toWibDay(p.timestamp);
      return day >= startDate! && day <= endDate!;
    });
  }, [posts, hasGlobalRange, startDate, endDate]);

  const filteredPosts = useMemo(() => {
    let result = postsInRange;

    // Filter by outlet
    if (selectedOutlet !== "all") {
      result = result.filter((p) => p.outlet_username.toLowerCase() === selectedOutlet.toLowerCase());
    }

    // Local quick range applies only when global period filter is not active
    if (!hasGlobalRange && dateFilter !== "all") {
      const now = new Date().getTime();
      const days = dateFilter === "7d" ? 7 : 30;
      const threshold = now - days * 24 * 60 * 60 * 1000;
      result = result.filter((p) => new Date(p.timestamp).getTime() >= threshold);
    }

    // Filter by search query in caption
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) => p.caption?.toLowerCase().includes(q));
    }

    return result;
  }, [postsInRange, selectedOutlet, hasGlobalRange, dateFilter, searchQuery]);

  // Aggregate stats
  const totalLikes = useMemo(
    () => filteredPosts.reduce((acc, p) => acc + (p.like_count || 0), 0),
    [filteredPosts]
  );
  const totalComments = useMemo(
    () => filteredPosts.reduce((acc, p) => acc + (p.comments_count || 0), 0),
    [filteredPosts]
  );

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/80 p-5 shadow-sm backdrop-blur">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-navy-800">Postingan dan Reels Instagram</h2>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Diambil langsung dari Instagram resmi Sanghyang: 25 postingan terbaru tiap akun
            {posts.length > 0 && ` (${shortDate(posts[posts.length - 1].timestamp)} sampai ${shortDate(posts[0].timestamp)})`}.
          </p>
        </div>

        {/* Account badges */}
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          {accounts.map((acc) => (
            <span
              key={acc.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-cream-50 px-3 py-1.5 text-navy-700 shadow-sm"
            >
              <span className="text-pink-600 font-bold">@</span>
              {acc.username}
            </span>
          ))}
        </div>
      </div>

      {problem && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">
          {problem}
        </p>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SkeuoCard className="p-4">
          <p className="text-sm font-medium text-slate-600">Postingan yang tampil</p>
          <p className="mt-1 text-2xl font-bold text-navy-800">{filteredPosts.length}</p>
        </SkeuoCard>
        <SkeuoCard className="p-4">
          <p className="text-sm font-medium text-slate-600">Total suka</p>
          <p className="mt-1 text-2xl font-bold text-pink-600">{totalLikes.toLocaleString("id-ID")}</p>
        </SkeuoCard>
        <SkeuoCard className="p-4">
          <p className="text-sm font-medium text-slate-600">Total komentar</p>
          <p className="mt-1 text-2xl font-bold text-blue-600">{totalComments.toLocaleString("id-ID")}</p>
        </SkeuoCard>
        <SkeuoCard className="p-4">
          <p className="text-sm font-medium text-slate-600">Rata-rata suka + komentar</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">
            {filteredPosts.length > 0
              ? Math.round((totalLikes + totalComments) / filteredPosts.length)
              : 0}{" "}
            <span className="text-sm font-normal text-slate-600">per postingan</span>
          </p>
        </SkeuoCard>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cream-300 bg-white p-3 shadow-sm">
        {/* Outlet Switcher */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500 mr-1">Outlet:</span>
          <button
            type="button"
            onClick={() => setSelectedOutlet("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              selectedOutlet === "all"
                ? "bg-navy-700 text-white shadow-sm"
                : "bg-cream-100 text-navy-700 hover:bg-cream-200"
            }`}
          >
            Semua ({postsInRange.length})
          </button>
          {accounts.map((acc) => {
            const count = postsInRange.filter((p) => p.outlet_username === acc.username).length;
            const active = selectedOutlet === acc.username;
            return (
              <button
                key={acc.id}
                type="button"
                onClick={() => setSelectedOutlet(acc.username)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-navy-700 text-white shadow-sm"
                    : "bg-cream-100 text-navy-700 hover:bg-cream-200"
                }`}
              >
                @{acc.username} ({count})
              </button>
            );
          })}
        </div>

        {/* Date Filters & Search */}
        <div className="flex flex-wrap items-center gap-2">
          {hasGlobalRange ? (
            <span className="rounded-lg border border-cream-300 bg-cream-50 px-2.5 py-1 text-xs font-medium text-navy-700">
              Periode: {rangeText(startDate!, endDate!)}
            </span>
          ) : (
            <div className="flex rounded-lg border border-cream-300 bg-cream-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setDateFilter("all")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  dateFilter === "all" ? "bg-white text-navy-800 shadow-xs" : "text-slate-600 hover:text-navy-800"
                }`}
              >
                Semua
              </button>
              <button
                type="button"
                onClick={() => setDateFilter("30d")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  dateFilter === "30d" ? "bg-white text-navy-800 shadow-xs" : "text-slate-600 hover:text-navy-800"
                }`}
              >
                30 hari
              </button>
              <button
                type="button"
                onClick={() => setDateFilter("7d")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  dateFilter === "7d" ? "bg-white text-navy-800 shadow-xs" : "text-slate-600 hover:text-navy-800"
                }`}
              >
                7 hari
              </button>
            </div>
          )}

          <input
            type="text"
            placeholder="Cari kata di teks postingan..." aria-label="Cari kata di teks postingan"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-w-0 max-w-full rounded-lg border border-cream-300 bg-white px-3 py-1.5 text-xs text-navy-800 placeholder:text-slate-400 focus:border-navy-500 focus:outline-none"
          />

          <button
            type="button"
            onClick={() => {
              setShowFullCaptions((v) => !v);
              setExpandedMap({});
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition border ${
              showFullCaptions
                ? "border-navy-700 bg-navy-700 text-white shadow-xs"
                : "border-cream-300 bg-cream-50 text-navy-700 hover:bg-cream-100"
            }`}
            title={showFullCaptions ? "Ringkas teks di semua kartu" : "Buka seluruh teks di semua kartu"}
          >
            {showFullCaptions ? "Ringkas semua teks" : "Buka semua teks"}
          </button>
        </div>
      </div>

      {/* Posts Cards Grid */}
      {filteredPosts.length === 0 ? (
        <SkeuoCard className="p-8 text-center text-slate-500">
          <p className="text-base font-medium">
            {accounts.length === 0
              ? "Belum ada data"
              : posts.length === 0
                ? "Belum ada postingan yang terbaca."
                : hasGlobalRange && postsInRange.length === 0
                  ? `Tidak ada postingan pada periode ${rangeText(startDate!, endDate!)}.`
                  : "Tidak ada postingan yang sesuai pilihan."}
          </p>
          {posts.length > 0 && <p className="mt-1 text-sm text-slate-600">Coba ubah rentang tanggal atau kata yang dicari.</p>}
        </SkeuoCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPosts.map((post) => {
            const date = new Date(post.timestamp);
            // Fixed to WIB: the server (UTC) and the browser must print the same time.
            const dateStr = date.toLocaleString("id-ID", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: WIB,
            });
            const isVideo = post.media_type === "VIDEO";
            const isCarousel = post.media_type === "CAROUSEL_ALBUM";
            const imageUrl = post.thumbnail_url || post.media_url;
            const caption = post.caption || "";
            const isExpanded = expandedMap[post.id] ?? showFullCaptions;
            const isLong = caption.length > 90 || caption.includes("\n");

            return (
              <SkeuoCard
                key={post.id}
                className="group flex flex-col justify-between overflow-hidden p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="space-y-3">
                  {/* Card Header: Outlet & Timestamp */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1 rounded-md bg-navy-50 px-2 py-0.5 font-bold text-navy-700">
                      @{post.outlet_username}
                    </span>
                    <span className="text-slate-500 font-medium">{dateStr} WIB</span>
                  </div>

                  {/* Photo / Media Container */}
                  {imageUrl ? (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative block aspect-square w-full overflow-hidden rounded-xl bg-slate-900/5 shadow-inner"
                      title="Buka postingan di Instagram"
                    >
                      {/* Signed Meta CDN URLs span dynamic subdomains and require no-referrer. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt={post.caption ? post.caption.slice(0, 60) : `Postingan @${post.outlet_username}`}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />

                      {/* Top Overlay Badge */}
                      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider shadow-sm backdrop-blur-md ${
                            isVideo
                              ? "bg-purple-900/80 text-purple-100 border border-purple-400/30"
                              : isCarousel
                              ? "bg-amber-900/80 text-amber-100 border border-amber-400/30"
                              : "bg-navy-900/80 text-white border border-white/20"
                          }`}
                        >
                          {isVideo ? "Reels" : isCarousel ? "Beberapa foto" : "Foto"}
                        </span>
                      </div>

                      {/* Video Play Indicator */}
                      {isVideo && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm transition group-hover:scale-110 group-hover:bg-black/60">
                            <svg className="ml-0.5 h-6 w-6 fill-current" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </a>
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
                      Tidak ada foto pratinjau
                    </div>
                  )}

                  {/* Caption */}
                  <div className="space-y-1">
                    <p
                      onClick={() => isLong && toggleExpand(post.id)}
                      className={`text-xs leading-relaxed text-slate-700 whitespace-pre-line break-words ${
                        isLong ? "cursor-pointer" : ""
                      } ${!isExpanded ? "line-clamp-3" : ""}`}
                      title={isLong ? (isExpanded ? "Klik untuk meringkas teks" : "Klik untuk membaca selengkapnya") : undefined}
                    >
                      {caption || "(Tanpa teks)"}
                    </p>

                    {isLong && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(post.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy-700 hover:text-navy-950 transition underline underline-offset-2"
                      >
                        {isExpanded ? "Ringkas teks" : "Lihat selengkapnya"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Card Footer: Engagement & Actions */}
                <div className="mt-4 pt-3 border-t border-cream-200 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 font-semibold text-slate-600">
                    <span className="text-pink-700">{post.like_count ?? 0} suka</span>
                    <span className="text-blue-700">{post.comments_count ?? 0} komentar</span>
                  </div>

                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-navy-700 hover:text-navy-900 transition underline underline-offset-2"
                  >
                    Buka di Instagram
                  </a>
                </div>
              </SkeuoCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
