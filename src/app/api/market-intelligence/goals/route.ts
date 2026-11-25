import { invalidateTags, withCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL, INVALIDATION_GROUPS, PRIVATE_CACHE_CONTROL } from "@/lib/cache/tags";
import { OUTLET_KEYS } from "@/lib/market/outlet-filters";
import { OUTLET_MARKET_SHARE_DATA } from "@/lib/market/pricing-benchmark";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";
import {
  GoalConflict,
  currentMonthWib,
  monthlyFromProgramLift,
  monthStart,
  parseGoalInput,
  prismaGoalRepository,
  previousMonth,
  revenueGrowthPct,
  type GoalRecord,
  type GoalRepository,
  type MonthlySnapshot,
} from "@/lib/market/goals";

/** Tujuan otomatis dari strategi outlet yang sudah ada (hanya persen; omset rupiah tidak keluar). */
function suggestedGoal(key: string) {
  const s = OUTLET_MARKET_SHARE_DATA[key]?.digitalMarketingStrategy;
  if (!s) return { targetRevenueGrowthPct: null, strategy: "", basis: "Belum ada strategi untuk outlet ini." };
  const lift = s.financialProjection.targetRevenueLiftPercent;
  return {
    targetRevenueGrowthPct: lift === null ? null : monthlyFromProgramLift(lift),
    strategy: `${s.promoFormulation.promoName}. ${s.sentimentLeverage.marketingAngle}`,
    basis:
      lift === null
        ? "Belum ada dasar angka untuk target omset outlet ini (omset dan biaya program belum tercatat); target diisi tim."
        : `Dari target strategi ${lift.toLocaleString("id-ID")}% dalam 60 hari, dibagi per bulan.`,
  };
}

/**
 * Tujuan bulanan per outlet. Dilindungi sesi Supabase Auth + MARKETING_PROPERTY_ID.
 * GET  ?month=TTTT-BB  -> tujuan bulan itu & bulan lalu, potret bulanan, dan kenaikan omset dalam persen.
 * PUT  { outletKey, month, ..., version } -> simpan dengan OCC; versi usang = 409.
 */
export function createGoalsHandlers({
  repo = prismaGoalRepository,
  now = () => new Date(),
  checkAccess,
}: {
  repo?: () => Promise<GoalRepository>;
  now?: () => Date;
  checkAccess?: MarketingApiAccessGuard;
} = {}) {
  return {
    async GET(request: Request) {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      const param = new URL(request.url).searchParams.get("month");
      const month = param === null ? currentMonthWib(now()) : monthStart(param);
      if (!month) return Response.json({ error: "Bulan harus berformat TTTT-BB, misalnya 2026-11." }, { status: 400 });
      const prev = previousMonth(month);
      const prev2 = previousMonth(prev);
      const loadPayload = async () => {
        const r = await repo();
        const [goals, snapshots, revenues] = await Promise.all([
          r.list([month, prev]),
          r.snapshots([month, prev]),
          r.revenues([month, prev, prev2]),
        ]);
        const pick = <T extends { outletKey: string; month: string }>(list: T[], key: string, m: string) =>
          list.find((x) => x.outletKey === key && x.month === m) ?? null;
        const revenue = (key: string, m: string) => pick(revenues, key, m)?.revenue ?? null;
        const outlets = Object.fromEntries(
          OUTLET_KEYS.map((key) => [
            key,
            {
              suggested: suggestedGoal(key),
              goal: pick<GoalRecord>(goals, key, month),
              previousGoal: pick<GoalRecord>(goals, key, prev),
              snapshot: pick<MonthlySnapshot>(snapshots, key, month),
              previousSnapshot: pick<MonthlySnapshot>(snapshots, key, prev),
              // Hanya persen: omset rupiah tidak pernah keluar dari server.
              revenueGrowthPct: revenueGrowthPct(revenue(key, month), revenue(key, prev)),
              previousRevenueGrowthPct: revenueGrowthPct(revenue(key, prev), revenue(key, prev2)),
            },
          ]),
        );
        return { month, previousMonth: prev, outlets };
      };
      const payload =
        repo === prismaGoalRepository
          ? await withCache(loadPayload, ["mi-goals", month], {
              tags: [CACHE_TAGS.marketingGoals],
              revalidate: CACHE_TTL.marketIntelligence,
            })
          : await loadPayload();
      return Response.json(payload, { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL.standard } });
    },

    async PUT(request: Request) {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      const parsed = parseGoalInput(await request.json().catch(() => undefined));
      if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
      try {
        const goal = await (await repo()).save(parsed.value, now());
        invalidateTags(INVALIDATION_GROUPS.forGoalsMutation());
        return Response.json({ goal });
      } catch (error) {
        if (error instanceof GoalConflict) {
          return Response.json(
            { error: "Tujuan ini sudah diubah orang lain. Muat ulang halaman, lalu isi lagi." },
            { status: 409 },
          );
        }
        throw error;
      }
    },
  };
}

const handlers = createGoalsHandlers();
export const GET = handlers.GET;
export const PUT = handlers.PUT;
