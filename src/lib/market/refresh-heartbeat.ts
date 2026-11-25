/**
 * Heartbeat pembaruan penuh: satu MarketInsight berisi hasil per langkah dari pembaruan terakhir (komputer lokal atau
 * GitHub Actions). Dibaca header Insight Pasar ("Terakhir diperbarui"), halaman Knowledge Graph, dan briefing pagi.
 */
import { db } from "../db";
import { countVerdicts, HEARTBEAT_FINGERPRINT, heartbeatSummary, type HeartbeatStats, type StepRecord } from "./refresh-outcome";

import { OUTLET_KEYS } from "./outlet-filters";
import { wibDay } from "./date-range";

const TITLE = "[Otomasi Malam] Sinkronisasi Insight Pasar Terakhir";

export async function recordRefreshHeartbeat(input: {
  origin: "github" | "lokal";
  steps: readonly StepRecord[];
  issues: readonly string[];
  newsStatus: string;
  stats: HeartbeatStats;
}): Promise<string> {
  const now = new Date();
  const summary = heartbeatSummary({ origin: input.origin, finishedAt: now, steps: input.steps, stats: input.stats });
  const evidence = {
    ...input.stats,
    newsStatus: input.newsStatus,
    counts: countVerdicts(input.steps),
    steps: input.steps.map(({ key, label, status, detail }) => ({ key, label, status, detail })),
    issues: [...input.issues],
    outletsRefreshed: [...OUTLET_KEYS],
    checkedDateWib: wibDay(now),
    syncedAt: now.toISOString(),
    timezone: "WIB",
  };
  const sourceReferences = [
    input.origin === "lokal" ? "Komputer lokal (panel admin)" : "GitHub Actions Scheduled Runner",
    "Google Hotels Dynamic Rates",
    "Google Maps Reviews Incremental",
    "Google News Anyer",
    "Instagram & TikTok Competitor Radar",
  ];
  const fields = { title: TITLE, summary, evidence, sourceReferences, confidence: 100, priority: 100, status: "active" as const };

  const existing = await db.marketInsight.findFirst({ where: { fingerprint: HEARTBEAT_FINGERPRINT }, select: { id: true } });
  if (existing) {
    await db.marketInsight.update({ where: { id: existing.id }, data: { ...fields, generatedAt: now, version: { increment: 1 } } });
  } else {
    await db.marketInsight.create({
      data: { ...fields, fingerprint: HEARTBEAT_FINGERPRINT, activeFingerprint: HEARTBEAT_FINGERPRINT, type: "insight", version: 1 },
    });
  }
  return summary;
}

/** Waktu pembaruan penuh terakhir selesai (ISO), null bila belum pernah tercatat. */
export async function lastRefreshAt(): Promise<string | null> {
  const row = await db.marketInsight.findFirst({ where: { fingerprint: HEARTBEAT_FINGERPRINT }, select: { evidence: true, generatedAt: true } });
  if (!row) return null;
  const syncedAt = (row.evidence as { syncedAt?: unknown } | null)?.syncedAt;
  // Heartbeat lama tanpa syncedAt: generatedAt diisi pada saat yang sama oleh penulis heartbeat.
  return typeof syncedAt === "string" ? syncedAt : row.generatedAt.toISOString();
}
