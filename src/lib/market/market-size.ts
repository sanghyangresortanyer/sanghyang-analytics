/**
 * Ukuran pasar dan pangsa yang ditampilkan di Langkah Harga, Metodologi, dan laporan PDF. Semua angka dihitung dari data
 * yang punya sumber, dihitung di server, dan diberi label "perkiraan kasar":
 *
 *   Pendapatan kamar per bulan = kamar × 30 hari × TPK hotel bintang Banten (BPS) × tarif OTA terbobot (crawl Google Travel)
 *
 * Market Cap = jumlah perkiraan Sanghyang dan pembanding inti (bintang 4–5, ≤ 25 km). Hotel acuan tampil, tetapi tidak
 * dihitung. Omset aktual Sanghyang dibaca dari impor pembukuan (OutletMonthlyRevenue). Untuk outlet F&B belum ada data
 * kapasitas kursi dan rata-rata belanja, jadi yang ditampilkan adalah pangsa ulasan Google sebagai proksi popularitas.
 */
import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { loadResortActualMarketShareFromVhp } from "../analytics/internal-signals";
import { withCache } from "../cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "../cache/tags";
import { db } from "../db";
import { latestTpk } from "./bps-tpk";
import { calculatePrecisionMarketShare, COMPSET_HOTELS } from "./hotel-compset";
import { RESORT_ROOM_RATE_SOURCE } from "./resort-room-rates";
import type { OutletKey } from "./outlet-filters";

export interface ResortMarketRow {
  hotelId: string;
  name: string;
  stars: number | null;
  roadKm: number;
  roomCount: number | null;
  roomCountSource: string;
  adr: number | null;
  estimatedMonthlyRevenue: number | null;
  /** Persen dari Market Cap; null untuk acuan atau bila tarif belum terbaca. */
  share: number | null;
  /** Tarif terbobot dibanding Sanghyang dalam persen (100 = sama). */
  priceVsSanghyang: number | null;
  role: "sanghyang" | "inti" | "benchmark";
}

export interface ResortMarketSize {
  tpk: { percent: number; period: string; sourceTitle: string; sourceUrl: string } | null;
  ratesCapturedAt: string;
  daysPerMonth: number;
  rows: ResortMarketRow[];
  marketCapMonthly: number | null;
  sanghyang: {
    estimatedMonthlyRevenue: number | null;
    estimatedShare: number | null;
    rank: number | null;
    rankOf: number;
    /** Pangsa pasar aktual Sanghyang (%) yang dihitung di server dari VHP tanpa mengekspos nominal rupiah. */
    actual: { month: string; sourceFile: string; share: number | null } | null;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const loadResortMarketSizeDefault = cache(async (): Promise<ResortMarketSize> =>
  withCache(
    () => computeResortMarketSize(db),
    ["mi-resort-market-size"],
    {
      tags: [CACHE_TAGS.marketSize, CACHE_TAGS.internalSignals, CACHE_TAGS.marketCompetitors],
      revalidate: CACHE_TTL.marketIntelligence,
    },
  ),
);

export async function loadResortMarketSize(options?: { client?: PrismaClient }): Promise<ResortMarketSize> {
  if (!options?.client) return loadResortMarketSizeDefault();
  return computeResortMarketSize(options.client);
}

async function computeResortMarketSize(client: PrismaClient): Promise<ResortMarketSize> {
  const tpk = await latestTpk();
  const precision = calculatePrecisionMarketShare(tpk?.rate ?? null, "all");
  const byId = new Map(COMPSET_HOTELS.map((h) => [h.hotelId, h]));
  const own = precision.rows.find((r) => r.isSanghyang);
  const ownAdr = own?.adr ?? null;
  const counted = precision.rows.filter((r) => r.countsInMarket && r.monthlyRevenue !== null);
  const marketCap = counted.length ? counted.reduce((sum, r) => sum + (r.monthlyRevenue as number), 0) : null;
  const ownEstimate = own?.monthlyRevenue ?? null;

  // Hitung pangsa pasar kamar aktual di server dari VHP weekly_sales_lines (Front Office);
  // hanya kembali ke arsip OutletMonthlyRevenue bila data VHP belum tersedia — tanpa pernah mengeluarkan rupiah.
  let actual = await loadResortActualMarketShareFromVhp({
    marketCapMonthly: marketCap,
    ownEstimate,
    client,
  });
  if (!actual) {
    const archiveRow = await client.outletMonthlyRevenue.findFirst({ where: { outletKey: "resort" }, orderBy: { month: "desc" } });
    const archiveRevenue = archiveRow ? Number(archiveRow.revenue) : null;
    if (archiveRow && archiveRevenue !== null && archiveRevenue > 0) {
      actual = {
        month: archiveRow.month.toISOString().slice(0, 7),
        sourceFile: archiveRow.sourceFile,
        share:
          marketCap !== null && ownEstimate !== null
            ? round2((archiveRevenue / (marketCap - ownEstimate + archiveRevenue)) * 100)
            : null,
      };
    }
  }

  const rows: ResortMarketRow[] = precision.rows.map((r) => ({
    hotelId: r.hotelId,
    name: r.name,
    stars: r.stars,
    roadKm: r.roadKm,
    roomCount: r.roomCount,
    roomCountSource: byId.get(r.hotelId)?.roomCountSource ?? "",
    adr: r.adr,
    estimatedMonthlyRevenue: r.monthlyRevenue,
    share: r.countsInMarket && r.monthlyRevenue !== null && marketCap ? round2((r.monthlyRevenue / marketCap) * 100) : null,
    priceVsSanghyang: r.adr !== null && ownAdr ? Math.round((r.adr / ownAdr) * 100) : null,
    role: r.isSanghyang ? "sanghyang" : r.compsetRole === "inti" ? "inti" : "benchmark",
  }));

  const ranked = [...counted].sort((a, b) => (b.monthlyRevenue as number) - (a.monthlyRevenue as number));
  const rankIndex = ranked.findIndex((r) => r.isSanghyang);

  return {
    tpk: tpk
      ? { percent: round2(tpk.rate * 100), period: tpk.period.toISOString().slice(0, 7), sourceTitle: tpk.sourceTitle, sourceUrl: tpk.sourceUrl }
      : null,
    ratesCapturedAt: RESORT_ROOM_RATE_SOURCE.capturedAt,
    daysPerMonth: precision.daysPerMonth,
    rows,
    marketCapMonthly: marketCap,
    sanghyang: {
      estimatedMonthlyRevenue: ownEstimate,
      estimatedShare: ownEstimate !== null && marketCap ? round2((ownEstimate / marketCap) * 100) : null,
      rank: rankIndex >= 0 ? rankIndex + 1 : null,
      rankOf: ranked.length,
      actual,
    },
  };
}

export interface ReviewShareRow {
  name: string;
  rating: number | null;
  reviewCount: number;
  roadKm: number | null;
  share: number;
  isSanghyang: boolean;
}

/**
 * Pangsa ulasan Google per outlet F&B: jumlah ulasan outlet Sanghyang dan pembandingnya (registri, diamati job rating).
 * Ini proksi popularitas, bukan omset; tempat tanpa jumlah ulasan tidak dihitung.
 */
export async function loadReviewShares(ownNames: Record<Exclude<OutletKey, "resort">, string>): Promise<Record<string, ReviewShareRow[]>> {
  const sig = Object.entries(ownNames)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
  return withCache(
    async () => {
      const competitors = await db.competitor.findMany({
        where: { active: true, reviewCount: { not: null } },
        select: { name: true, rating: true, reviewCount: true, roadKm: true, outlets: true, compsetRole: true },
      });
      const out: Record<string, ReviewShareRow[]> = {};
      for (const [outlet, ownName] of Object.entries(ownNames)) {
        const own = competitors.find((c) => c.name === ownName);
        const rivals = competitors.filter((c) => c.name !== ownName && c.compsetRole === "inti" && c.outlets.includes(outlet));
        // Tanpa satu pun pembanding yang jumlah ulasannya terbaca, pangsa tidak berarti apa-apa (selalu 100%).
        if (!rivals.length) {
          out[outlet] = [];
          continue;
        }
        const pool = [...(own ? [own] : []), ...rivals];
        const total = pool.reduce((sum, c) => sum + (c.reviewCount ?? 0), 0);
        out[outlet] = pool
          .map((c) => ({
            name: c.name,
            rating: c.rating === null ? null : Number(c.rating),
            reviewCount: c.reviewCount as number,
            roadKm: c.roadKm,
            share: total ? round2(((c.reviewCount as number) / total) * 100) : 0,
            isSanghyang: c.name === ownName,
          }))
          .sort((a, b) => b.reviewCount - a.reviewCount);
      }
      return out;
    },
    ["mi-review-shares", sig],
    { tags: [CACHE_TAGS.marketSize, CACHE_TAGS.marketCompetitors], revalidate: CACHE_TTL.marketIntelligence },
  );
}
