import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readSrc(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("penjaga arsitektur cache native Next.js 16.4.6", () => {
  const cachedQueryModules = [
    "src/lib/dashboard/dashboard-data.ts",
    "src/lib/dashboard/range-data.ts",
    "src/lib/dashboard/occupancy-query.ts",
    "src/lib/dashboard/outlet-targets-query.ts",
    "src/lib/dashboard/settings-query.ts",
    "src/lib/sheets/queries.ts",
    "src/lib/marketing/vhp-load.ts",
    "src/lib/analytics/internal-signals.ts",
    "src/lib/knowledge-graph/build.ts",
    "src/lib/market/competitor-comparison.ts",
    "src/lib/market/ota-directory.server.ts",
    "src/lib/market/hotel-room-types.ts",
    "src/lib/market/place-specs.ts",
    "src/lib/market/refresh-competitor-menus.ts",
    "src/lib/market/promo-venues.ts",
    "src/lib/market/market-size.ts",
    "src/lib/market/gallery-outlets.ts",
    "src/lib/market/fnb-compare-data.ts",
  ];

  it("melarang pemanggilan cookies(), headers(), atau createClient() sesi di dalam modul kueri ter-cache", () => {
    for (const rel of cachedQueryModules) {
      const code = readSrc(rel);
      expect(code, `${rel} tidak boleh memanggil cookies()/headers()`).not.toMatch(/\b(cookies|headers)\s*\(/);
      expect(code, `${rel} tidak boleh mengimpor createClient sesi`).not.toMatch(/@\/lib\/supabase\/server/);
    }
  });

  it("memastikan seluruh titik mutasi memanggil invalidateTags (revalidateTag dengan { expire: 0 })", () => {
    const mutationModules: Array<{ file: string; expectedGroup: string }> = [
      { file: "src/lib/actions/weekly-meeting.ts", expectedGroup: "forVhpMutation" },
      { file: "src/lib/actions/targets.ts", expectedGroup: "forTargetsMutation" },
      { file: "src/lib/actions/settings.ts", expectedGroup: "forRoomsMutation" },
      { file: "src/lib/actions/settings.ts", expectedGroup: "forBudgetsMutation" },
      { file: "src/lib/actions/settings.ts", expectedGroup: "forMenuRulesMutation" },
      { file: "src/lib/actions/sheets.ts", expectedGroup: "forSheetsMutation" },
      { file: "src/lib/actions/social-promo.ts", expectedGroup: "forSocialPromoMutation" },
      { file: "src/lib/marketing/web.ts", expectedGroup: "forWhatsappChatMutation" },
      { file: "src/app/api/marketing-sosmed/route.ts", expectedGroup: "forMarketingSosmedMutation" },
      { file: "src/app/api/marketing-sosmed/browser-sync/route.ts", expectedGroup: "forMarketingSosmedMutation" },
      { file: "src/app/api/market-intelligence/goals/route.ts", expectedGroup: "forGoalsMutation" },
      { file: "src/app/api/market-intelligence/insights/route.ts", expectedGroup: "forMarketItemOrInsightMutation" },
      { file: "src/app/api/market-intelligence/route.ts", expectedGroup: "forMarketItemOrInsightMutation" },
      { file: "src/app/api/cron/sync-sheets/route.ts", expectedGroup: "forSheetsMutation" },
      { file: "src/app/api/cron/scrape/route.ts", expectedGroup: "forMarketRefreshMutation" },
      { file: "src/app/api/admin/scraping/route.ts", expectedGroup: "forMarketRefreshMutation" },
      { file: "src/app/api/competitors/route.ts", expectedGroup: "forMarketRefreshMutation" },
    ];

    for (const { file, expectedGroup } of mutationModules) {
      const code = readSrc(file);
      expect(code, `${file} wajib memanggil invalidateTags`).toContain("invalidateTags(");
      expect(code, `${file} wajib memakai kelompok invalidasi ${expectedGroup}`).toContain(expectedGroup);
    }

    const cachedHelper = readSrc("src/lib/cache/cached.ts");
    expect(cachedHelper).toContain("revalidateTag(tag, { expire: 0 })");
  });

  it("melarang Cache-Control public atau s-maxage pada seluruh endpoint API privat yang dioptimasi", () => {
    const apiRoutes = [
      "src/app/api/market-intelligence/summary/route.ts",
      "src/app/api/knowledge-graph/route.ts",
      "src/app/api/marketing-sosmed/route.ts",
      "src/app/api/market-intelligence/fnb-compare/route.ts",
      "src/app/api/market-intelligence/goals/route.ts",
      "src/app/api/market-intelligence/trends/route.ts",
      "src/app/api/market-intelligence/social-sources/route.ts",
      "src/app/api/market-intelligence/insights/route.ts",
      "src/app/api/market-intelligence/route.ts",
      "src/app/api/competitors/route.ts",
    ];
    for (const rel of apiRoutes) {
      const code = readSrc(rel);
      expect(code, `${rel} dilarang memakai Cache-Control public/s-maxage`).not.toMatch(
        /cache-control["']?\s*:\s*["'][^"']*(?:public|s-maxage)/i,
      );
    }
  });
});
