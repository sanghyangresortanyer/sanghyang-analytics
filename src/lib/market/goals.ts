/**
 * Tujuan bulanan per outlet (diisi tim digital marketing) dan potret bulanan untuk perbandingan "vs bulan lalu".
 * Omset hanya keluar sebagai persen pertumbuhan; angka rupiah tidak pernah dikirim ke klien.
 */
import { OUTLET_KEYS, isOutletKey, type OutletKey } from "./outlet-filters";

export const TEXT_LIMIT = 2000;
export const NAME_LIMIT = 80;

export interface GoalRecord {
  id: string;
  outletKey: string;
  month: string;
  targetRevenueGrowthPct: number | null;
  targetRating: number | null;
  strategy: string;
  decisions: string;
  filledBy: string;
  evaluation: string | null;
  evaluatedAt: string | null;
  updatedAt: string;
  version: number;
}

export interface GoalInput {
  outletKey: OutletKey;
  month: string;
  targetRevenueGrowthPct: number | null;
  targetRating: number | null;
  strategy: string;
  decisions: string;
  filledBy: string;
  evaluation: string | null;
  /** Versi yang terakhir dibaca klien; null = tujuan baru. */
  version: number | null;
}

/** "2026-11" -> "2026-11-01"; null bila formatnya salah. */
export function monthStart(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return `${value}-01`;
}

export function previousMonth(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/** Bulan berjalan di WIB (UTC+7), dipakai server saat klien tidak mengirim bulan. */
export function currentMonthWib(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

const numberOrNull = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : undefined;
};
const text = (v: unknown, limit: number): string | undefined =>
  v === undefined || v === null ? "" : typeof v === "string" && v.length <= limit ? v.trim() : undefined;

/** Validasi isian dari klien; mengembalikan pesan bahasa sederhana bila ada yang salah. */
export function parseGoalInput(body: unknown): { ok: true; value: GoalInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Isian tidak terbaca." };
  const b = body as Record<string, unknown>;
  if (!isOutletKey(b.outletKey)) return { ok: false, error: `Outlet tidak dikenal. Pilihan: ${OUTLET_KEYS.join(", ")}.` };
  const month = monthStart(b.month);
  if (!month) return { ok: false, error: "Bulan harus berformat TTTT-BB, misalnya 2026-11." };
  const growth = numberOrNull(b.targetRevenueGrowthPct, -100, 1000);
  if (growth === undefined) return { ok: false, error: "Target kenaikan omset harus angka persen antara -100 dan 1000." };
  const rating = numberOrNull(b.targetRating, 1, 5);
  if (rating === undefined) return { ok: false, error: "Target rating harus angka antara 1 dan 5." };
  const strategy = text(b.strategy, TEXT_LIMIT);
  const decisions = text(b.decisions, TEXT_LIMIT);
  const evaluation = text(b.evaluation, TEXT_LIMIT);
  if (strategy === undefined || decisions === undefined || evaluation === undefined) {
    return { ok: false, error: `Strategi, keputusan, dan evaluasi maksimal ${TEXT_LIMIT} huruf.` };
  }
  const filledBy = text(b.filledBy, NAME_LIMIT);
  if (!filledBy) return { ok: false, error: "Tulis nama pengisi (maksimal 80 huruf)." };
  const version = b.version === null || b.version === undefined ? null : Number(b.version);
  if (version !== null && (!Number.isInteger(version) || version < 1)) return { ok: false, error: "Versi isian tidak sah. Muat ulang halaman." };
  return {
    ok: true,
    value: { outletKey: b.outletKey, month, targetRevenueGrowthPct: growth, targetRating: rating, strategy, decisions, filledBy, evaluation: evaluation || null, version },
  };
}

/** Kenaikan omset bulan ini vs bulan lalu dalam persen (satu desimal); null bila salah satu bulan belum diimpor. */
export function revenueGrowthPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export class GoalConflict extends Error {}


export interface MonthlySnapshot {
  outletKey: string;
  month: string;
  googleRating: number | null;
  pricePositioningIndex: number | null;
  reviewsRecorded: number;
}

/** Target strategi tiap outlet berlaku untuk program 60 hari (Card 3 lama). */
export const PROGRAM_DAYS = 60;

/** Target bulanan dari target program 60 hari, dibagi rata secara majemuk (mis. +76,9%/60 hari -> +33%/bulan). */
export function monthlyFromProgramLift(liftPct: number): number {
  return Math.round((Math.pow(1 + liftPct / 100, 30 / PROGRAM_DAYS) - 1) * 1000) / 10;
}

/** Tujuan otomatis bila tim belum mengisi: tim tidak wajib mengetik apa pun. */
export interface SuggestedGoal {
  targetRevenueGrowthPct: number | null;
  strategy: string;
  basis: string;
}

export interface OutletGoals {
  suggested: SuggestedGoal;
  goal: GoalRecord | null;
  previousGoal: GoalRecord | null;
  snapshot: MonthlySnapshot | null;
  previousSnapshot: MonthlySnapshot | null;
  /** Kenaikan omset dalam persen; rupiah tidak pernah dikirim. */
  revenueGrowthPct: number | null;
  previousRevenueGrowthPct: number | null;
}

/** Bentuk respons GET /api/market-intelligence/goals. */
export interface GoalsResponse {
  month: string;
  previousMonth: string;
  outlets: Record<string, OutletGoals>;
}

export interface GoalRepository {
  list(months: string[]): Promise<GoalRecord[]>;
  /** Membuat tujuan baru (version null) atau memperbarui bila versi cocok; GoalConflict bila tidak. */
  save(input: GoalInput, now: Date): Promise<GoalRecord>;
  snapshots(months: string[]): Promise<MonthlySnapshot[]>;
  revenues(months: string[]): Promise<{ outletKey: string; month: string; revenue: number }[]>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** Implementasi Prisma; di-import dinamis agar fungsi murni di atas bisa diuji tanpa database. */
export async function prismaGoalRepository(): Promise<GoalRepository> {
  const { db } = await import("../db");
  const { Prisma } = await import("@prisma/client");
  const toRecord = (g: Awaited<ReturnType<typeof db.marketingGoal.findFirstOrThrow>>): GoalRecord => ({
    id: g.id,
    outletKey: g.outletKey,
    month: iso(g.month),
    targetRevenueGrowthPct: num(g.targetRevenueGrowthPct),
    targetRating: num(g.targetRating),
    strategy: g.strategy,
    decisions: g.decisions,
    filledBy: g.filledBy,
    evaluation: g.evaluation,
    evaluatedAt: g.evaluatedAt?.toISOString() ?? null,
    updatedAt: g.updatedAt.toISOString(),
    version: g.version,
  });
  const dates = (months: string[]) => months.map((m) => new Date(`${m}T00:00:00Z`));
  return {
    async list(months) {
      return (await db.marketingGoal.findMany({ where: { month: { in: dates(months) } } })).map(toRecord);
    },
    async save(input, now) {
      const month = new Date(`${input.month}T00:00:00Z`);
      const fields = {
        targetRevenueGrowthPct: input.targetRevenueGrowthPct === null ? null : new Prisma.Decimal(input.targetRevenueGrowthPct),
        targetRating: input.targetRating === null ? null : new Prisma.Decimal(input.targetRating),
        strategy: input.strategy,
        decisions: input.decisions,
        filledBy: input.filledBy,
        evaluation: input.evaluation,
        evaluatedAt: input.evaluation ? now : null,
      };
      if (input.version === null) {
        try {
          return toRecord(await db.marketingGoal.create({ data: { outletKey: input.outletKey, month, ...fields } }));
        } catch (error) {
          // Tujuan bulan itu sudah dibuat orang lain sejak halaman dibuka.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new GoalConflict();
          throw error;
        }
      }
      const updated = await db.marketingGoal.updateMany({
        where: { outletKey: input.outletKey, month, version: input.version },
        data: { ...fields, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new GoalConflict();
      return toRecord(await db.marketingGoal.findFirstOrThrow({ where: { outletKey: input.outletKey, month } }));
    },
    async snapshots(months) {
      return (await db.outletMonthlySnapshot.findMany({ where: { month: { in: dates(months) } } })).map((s) => ({
        outletKey: s.outletKey,
        month: iso(s.month),
        googleRating: num(s.googleRating),
        pricePositioningIndex: num(s.pricePositioningIndex),
        reviewsRecorded: s.reviewsRecorded,
      }));
    },
    async revenues(months) {
      return (await db.outletMonthlyRevenue.findMany({ where: { month: { in: dates(months) } } })).map((r) => ({
        outletKey: r.outletKey,
        month: iso(r.month),
        revenue: Number(r.revenue.toString()),
      }));
    },
  };
}
