import { NextResponse } from "next/server";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS, PRIVATE_CACHE_CONTROL } from "@/lib/cache/tags";
import { db } from "@/lib/db";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";
import { generateInsights, INSIGHT_STATUSES, INSIGHT_TYPES } from "@/lib/market/insights";
import type { GeneratedInsight } from "@/lib/market/insights";
import { insightFingerprint, insightRepository } from "@/lib/market/insight-repository";
import { NOT_OWN_PROMO } from "@/lib/market/own-promos";
import { COMPARABLE_RATE_WHERE } from "@/lib/market/rate-basis";

const valid = (value: unknown, values: readonly string[]) =>
  value === undefined || (typeof value === "string" && values.includes(value));

export async function GET(request: Request) {
  const refused = await requireMarketingApiAccess();
  if (refused) return refused;

  const params = new URL(request.url).searchParams;
  if (!valid(params.get("type") ?? undefined, INSIGHT_TYPES) || !valid(params.get("status") ?? undefined, INSIGHT_STATUSES)) {
    return NextResponse.json({ error: "invalid filters" }, { status: 400 });
  }
  return NextResponse.json(
    await insightRepository.list({
      type: (params.get("type") as never) || undefined,
      status: (params.get("status") as never) || undefined,
    }),
    { headers: { "Cache-Control": PRIVATE_CACHE_CONTROL.standard } },
  );
}

export async function createInsightsPost(
  _request: Request,
  deps: {
    repository: typeof insightRepository;
    generate: typeof generateInsights;
    findData: () => Promise<{
      items: Array<{ createdAt: Date; kind: string; description: string | null }>;
      prices: Array<{ observedAt: Date; source: string; roomName: string | null; packageName: string | null; price: unknown; competitorId: string }>;
      promotions: Array<{ capturedAt: Date; source: string; title: string }>;
      reviews: Array<{ capturedAt: Date; source: string; text: string; sentiment: string }>;
    }>;
    checkAccess?: MarketingApiAccessGuard;
  } = {
    repository: insightRepository,
    generate: generateInsights,
    findData: async () => {
      const [items, prices, promotions, reviews] = await Promise.all([
        db.marketItem.findMany({ orderBy: { createdAt: "desc" } }),
        db.competitorPriceSnapshot.findMany({ where: COMPARABLE_RATE_WHERE, orderBy: { observedAt: "desc" } }),
        db.competitorPromotion.findMany({ where: NOT_OWN_PROMO, orderBy: { capturedAt: "desc" } }),
        db.competitorReview.findMany({ where: { archivedAt: null }, orderBy: { capturedAt: "desc" } }),
      ]);
      return { items, prices, promotions, reviews };
    },
  },
) {
  const refused = await requireMarketingApiAccess(deps.checkAccess);
  if (refused) return refused;

  const { items, prices, promotions, reviews } = await deps.findData();
  const rows = [
    ...items.map((x) => ({
      date: x.createdAt.toISOString(),
      category: x.kind,
      source: "Market news",
      headline: x.description ?? "Market item",
      sentiment: "positive" as const,
    })),
    ...prices.map((x) => ({
      date: x.observedAt.toISOString(),
      category: "competitor",
      source: x.source,
      headline: `${x.roomName ?? x.packageName ?? "Rate"} ${x.price}`,
      sentiment: "neutral" as const,
    })),
    ...promotions.map((x) => ({
      date: x.capturedAt.toISOString(),
      category: "promotion",
      source: x.source,
      headline: x.title,
      sentiment: "neutral" as const,
    })),
    ...reviews.map((x) => ({
      date: x.capturedAt.toISOString(),
      category: "review",
      source: x.source,
      headline: x.text,
      sentiment: x.sentiment as "positive" | "neutral" | "negative",
    })),
  ];
  const generated = await deps.generate({
    rows,
    counts: {
      marketItems: items.length,
      competitors: new Set(prices.map((x) => x.competitorId)).size,
      promotions: promotions.length,
      reviews: reviews.length,
    },
  });
  const active = await deps.repository.list({ status: "active" });
  const existing = new Set(
    active.map((x) => {
      const row = x as { fingerprint?: unknown; type: GeneratedInsight["type"]; title: string; summary: string };
      return typeof row.fingerprint === "string" && row.fingerprint ? row.fingerprint : insightFingerprint(row);
    }),
  );
  const saved = await Promise.all(
    generated.filter((item) => !existing.has(insightFingerprint(item))).map((item) => deps.repository.create(item)),
  );
  if (saved.length > 0) invalidateTags(INVALIDATION_GROUPS.forMarketItemOrInsightMutation());
  return NextResponse.json(saved, { status: 201 });
}

export async function POST(request: Request) {
  return createInsightsPost(request);
}
