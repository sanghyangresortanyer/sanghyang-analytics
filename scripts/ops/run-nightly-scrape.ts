import { appendFileSync } from "node:fs";
import { db } from "@/lib/db";
import { runFullRefresh, type FullRefreshOptions } from "@/lib/market/full-refresh";
import { refreshMarkdownSummary } from "@/lib/market/refresh-outcome";
import { silentReporter } from "@/lib/market/refresh-progress";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function readArgValue(prefix: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

// Cron malam memakai jendela kesegaran bawaan 7 hari dan batas panggilan ekstraksi agar kuota harian terjaga,
// namun tetap mencakup seluruh 6 outlet Sanghyang termasuk klasifikasi kompetitor holistik.
const refreshOptions: FullRefreshOptions = {
  staleAfterDays: parsePositiveInt(readArgValue("--stale-days=") ?? process.env.DYNAMIC_REFRESH_STALE_DAYS, 7),
  forceDynamicRefresh: process.argv.includes("--force-dynamic") || process.env.DYNAMIC_REFRESH_FORCE === "1",
  skipDynamicSteps: process.argv.includes("--skip-dynamic") || process.env.DYNAMIC_REFRESH_SKIP === "1",
  maxDynamicAiCalls: parsePositiveInt(readArgValue("--max-dynamic-calls=") ?? process.env.DYNAMIC_REFRESH_MAX_CALLS, 12),
  include14NightRoomRates: process.argv.includes("--include-14night-rates") || process.env.REFRESH_14NIGHT_RATES === "1",
  skipHolisticClassification: process.argv.includes("--skip-holistic") || process.env.REFRESH_SKIP_HOLISTIC === "1",
};

runFullRefresh("github", silentReporter, refreshOptions)
  .then(({ failed, steps }) => {
    // Tabel per langkah di ringkasan job GitHub Actions, supaya langkah yang gagal atau dilewati terlihat tanpa membuka log.
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) appendFileSync(summaryFile, refreshMarkdownSummary(steps));
    if (failed) process.exitCode = 1;
  })
  .catch((error) => {
    console.error("[nightly] unexpected failure:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
