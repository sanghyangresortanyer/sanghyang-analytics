import type { ScrapeRun, ScrapeRunStatus, Source } from "@/lib/db-types";
import { invalidateTags } from "@/lib/cache/cached";
import { INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { NewsRunInProgressError, runNewsNow } from "@/lib/market/run-news";
import { ensureSourceForJob, listRecentRuns } from "@/lib/market/scrape-log";
import { getEnabledSources } from "@/lib/market/source-registry";
import { after } from "next/server";
import { createGithubActions, WorkflowDispatchRefused, type GithubActions } from "@/lib/market/github-actions";
import type { FullRefreshResult } from "@/lib/market/full-refresh";
import { beginRefresh, currentRefresh, endRefresh, isRefreshRunning, storeReporter } from "@/lib/market/refresh-progress";
import type { StepRecord } from "@/lib/market/refresh-outcome";
import { HOTEL_PACKAGE_NAME, RATE_BATCH_WINDOW_MS } from "@/lib/market/collect-rates";
import { ProductionWriteBlockedError } from "@/lib/db";
import { requireMarketingApiAccess, type MarketingApiAccessGuard } from "@/lib/marketing/api-auth";

type RunNewsNow = () => Promise<{ runId: string; status: ScrapeRunStatus }>;
type LocalRefresh = { startedAt: string; finishedAt: string | null; failed: boolean | null; issues: string[]; steps: StepRecord[] };

/** Scrape butuh Chrome dan berjalan beberapa menit, jadi di Vercel hanya berjalan lewat GitHub Actions. */
const manualRunAvailable = () => !process.env.VERCEL;

/** Putaran terakhir tiap hotel, satu baris per tanggal menginap, Sanghyang lebih dulu. */
function latestRateBatch<T extends { hotel: string; checkIn: string | null; observedAt: string }>(rates: T[]) {
  const newest = new Map<string, number>();
  for (const rate of rates) newest.set(rate.hotel, Math.max(newest.get(rate.hotel) ?? 0, Date.parse(rate.observedAt)));
  return rates
    .filter((rate) => Date.parse(rate.observedAt) > (newest.get(rate.hotel) ?? 0) - RATE_BATCH_WINDOW_MS)
    .sort((a, b) =>
      (a.checkIn ?? "").localeCompare(b.checkIn ?? "") ||
      Number(b.hotel === "Sanghyang") - Number(a.hotel === "Sanghyang") ||
      a.hotel.localeCompare(b.hotel));
}

const publicSource = (source: Source) => ({
  id: source.id,
  name: source.name,
  domain: safeDomain(source.domain),
  category: source.category,
  enabled: source.enabled,
  priority: source.priority,
  intervalMinutes: source.intervalMinutes,
  lastRunAt: source.lastRunAt,
  lastSuccessAt: source.lastSuccessAt,
  failureCount: source.failureCount,
});

export const publicRun = (run: ScrapeRun) => ({
  id: run.id,
  sourceId: run.sourceId,
  job: run.job,
  status: run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  recordsDiscovered: run.recordsDiscovered,
  recordsSaved: run.recordsSaved,
  duplicates: run.duplicates,
  errors: run.errors,
  createdAt: run.createdAt,
});

function safeDomain(domain: string): string {
  try {
    const url = new URL(domain);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return domain;
  }
}

export function createAdminScrapingHandlers({
  runNewsNow: start = runNewsNow,
  collectHotelRates = async () => {
    const { collectGoogleHotelMarketRates } = await import("@/lib/market/collect-rates");
    return (await collectGoogleHotelMarketRates({ dateMode: "both" })).rates;
  },
  getEnabledSources: sources = () => getEnabledSources("news"),
  listRecentRuns: runs = () => listRecentRuns(20),
  // Nama dan kategori sumber berita dari registri tugas (DEFAULT_JOB_SOURCES), sama dengan job perayapan; nama berbeda
  // di sini dulu membuat label penerbit di kartu berita berganti setiap kali tombol ini ditekan.
  ensureNewsSource = async () => {
    await ensureSourceForJob("news");
  },
  githubActions = createGithubActions(),
  runFullRefresh = async () =>
    (await import("@/lib/market/full-refresh")).runFullRefresh("lokal", storeReporter, {
      forceDynamicRefresh: true,
      include14NightRoomRates: true,
    }),
  checkAccess,
}: {
  runNewsNow?: RunNewsNow;
  collectHotelRates?: () => Promise<Array<{ hotel: string; price: number; currency: string; sourceUrl: string }>>;
  getEnabledSources?: () => Promise<Source[]>;
  listRecentRuns?: () => Promise<ScrapeRun[]>;
  ensureNewsSource?: () => Promise<void>;
  githubActions?: GithubActions;
  runFullRefresh?: () => Promise<FullRefreshResult>;
  checkAccess?: MarketingApiAccessGuard;
} = {}) {
  // ponytail: status di memori proses; hilang bila aplikasi lokal ditutup, cukup untuk satu komputer.
  let localRefresh: LocalRefresh | null = null;

  return {
    // Hanya membaca: panel tetap terbuka di lingkungan yang menolak tulis. Sumber berita disiapkan oleh aksi yang menulis (POST).
    async GET() {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      const { db } = await import("@/lib/db");
      const [sanghyangRates, competitorRates] = await Promise.all([
        db.sanghyangPriceSnapshot.findMany({
          where: { packageName: HOTEL_PACKAGE_NAME },
          orderBy: { observedAt: "desc" },
        }),
        db.competitorPriceSnapshot.findMany({
          where: { packageName: HOTEL_PACKAGE_NAME },
          include: { competitor: { select: { name: true } } },
          orderBy: { observedAt: "desc" },
        }),
      ]);

      const hotelRates = latestRateBatch([
        ...sanghyangRates.map((s) => ({
          hotel: "Sanghyang",
          price: Number(s.price),
          currency: s.currency,
          checkIn: s.checkIn.toISOString(),
          observedAt: s.observedAt.toISOString(),
          sourceUrl: s.sourceUrl,
        })),
        ...competitorRates.map((c) => ({
          hotel: c.competitor?.name ?? "Kompetitor",
          price: Number(c.price),
          currency: c.currency,
          checkIn: c.checkIn?.toISOString() ?? null,
          observedAt: c.observedAt.toISOString(),
          sourceUrl: c.sourceUrl,
        })),
      ]);

      // Status pembaruan lengkap di GitHub Actions; kegagalan membacanya tidak boleh membuat panel kosong.
      const remote = githubActions.configured
        ? await githubActions.latestRun().then(
            (latest) => ({ configured: true, latest, error: null }),
            (error: unknown) => ({ configured: true, latest: null, error: (error as Error).message }),
          )
        : { configured: false, latest: null, error: null };

      return Response.json({
        sources: (await sources()).map(publicSource),
        runs: (await runs()).map(publicRun),
        hotelRates,
        manualRunAvailable: manualRunAvailable(),
        remote,
        localRefresh,
        refresh: currentRefresh(),
      });
    },

    async POST(request: Request) {
      const refused = await requireMarketingApiAccess(checkAccess);
      if (refused) return refused;

      const body: unknown = await request.json().catch(() => undefined);
      const job = (body && typeof body === "object" && typeof (body as { job?: unknown }).job === "string")
        ? (body as { job: string }).job
        : undefined;

      // Pembaruan lengkap: memicu workflow scrape malam di GitHub Actions. Berlaku di Vercel maupun lokal.
      if (job === "remote") {
        try {
          await githubActions.dispatch();
          return Response.json({ status: "queued" }, { status: 202 });
        } catch (error) {
          if (error instanceof WorkflowDispatchRefused) return Response.json({ error: error.message }, { status: error.httpStatus });
          throw error;
        }
      }

      if (!manualRunAvailable()) {
        return Response.json({ error: "Di server web, pengambilan data hanya berjalan lewat GitHub Actions." }, { status: 501 });
      }

      // Pembaruan lengkap dari komputer lokal: Instagram menolak IP pusat data (GitHub Actions) tetapi terbuka dari internet rumah.
      if (job === "local-all") {
        if ((localRefresh && localRefresh.finishedAt === null) || isRefreshRunning()) {
          return Response.json({ error: "Pembaruan dari komputer ini masih berjalan." }, { status: 409 });
        }
        // Berita membutuhkan baris Source Google News; disiapkan di sini supaya basis data yang menolak tulis gagal di awal.
        try {
          await ensureNewsSource();
        } catch (error) {
          console.error("[admin/scraping] sumber berita tidak dapat disiapkan:", error);
          return error instanceof ProductionWriteBlockedError
            ? Response.json({ error: "Basis data ini menolak penulisan (basis data produksi tanpa izin tulis), jadi pembaruan tidak dijalankan." }, { status: 403 })
            : Response.json({ error: `Sumber berita Google News tidak dapat disiapkan (${(error as Error).message}).` }, { status: 500 });
        }
        const state: LocalRefresh = { startedAt: new Date().toISOString(), finishedAt: null, failed: null, issues: [], steps: [] };
        localRefresh = state;
        beginRefresh("lokal");
        const task = runFullRefresh().then(
          (result) => Object.assign(state, result),
          (error: unknown) => Object.assign(state, { failed: true, issues: [(error as Error).message] }),
        ).finally(() => {
          state.finishedAt = new Date().toISOString();
          endRefresh(state.failed === true);
          invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
        });
        try {
          after(() => task);
        } catch {
          // Di luar request Next (uji), task tetap berjalan sendiri.
        }
        return Response.json({ status: "running", localRefresh: state, refresh: currentRefresh() }, { status: 202 });
      }

      await ensureNewsSource();
      const validJobs = ["remote", "local-all", "news", "rates", "all", "reviews", "social", "promos", "website", "ratings"];
      if (!job || !validJobs.includes(job)) {
        return Response.json({ error: `Body must be { job: '${validJobs.join("' | '")}' }.` }, { status: 400 });
      }

      if (job === "rates") {
        try {
          const rates = await collectHotelRates();
          invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
          return Response.json({ job: "rates", status: "success", rates }, { status: 200 });
        } catch (error) {
          console.error("Rates scraping error:", error);
          return Response.json({ job: "rates", status: "failed", error: String(error) }, { status: 500 });
        }
      }

      if (job === "reviews") {
        try {
          const { scrapeNewGoogleReviews } = await import("@/lib/market/scrape-new-reviews");
          const stats = await scrapeNewGoogleReviews();
          invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
          return Response.json({ job: "reviews", status: "success", stats }, { status: 200 });
        } catch (error) {
          console.error("Reviews scraping error:", error);
          return Response.json({ job: "reviews", status: "failed", error: String(error) }, { status: 500 });
        }
      }

      if (job === "social") {
        try {
          const { scrapeSocialBuzz } = await import("@/lib/market/scrape-social-buzz");
          const stats = await scrapeSocialBuzz();
          invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
          return Response.json({ job: "social", status: "success", stats }, { status: 200 });
        } catch (error) {
          console.error("Social scraping error:", error);
          return Response.json({ job: "social", status: "failed", error: String(error) }, { status: 500 });
        }
      }

      if (job === "website" || job === "promos") {
        try {
          const { scrapeWebsitePromos } = await import("@/lib/market/website-promos");
          const stats = await scrapeWebsitePromos();
          invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
          return Response.json({ job, status: "success", stats }, { status: 200 });
        } catch (error) {
          console.error("Website promos scraping error:", error);
          return Response.json({ job, status: "failed", error: String(error) }, { status: 500 });
        }
      }

      if (job === "ratings") {
        try {
          const { refreshOwnOutletRatings } = await import("@/lib/market/outlet-ratings");
          const stats = await refreshOwnOutletRatings();
          invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
          return Response.json({ job: "ratings", status: "success", stats }, { status: 200 });
        } catch (error) {
          console.error("Ratings scraping error:", error);
          return Response.json({ job: "ratings", status: "failed", error: String(error) }, { status: 500 });
        }
      }

      try {
        const task = (async () => {
          const newsRes = await start();
          // Concurrently or immediately after news run, refresh hotel market rates
          await collectHotelRates().catch((err) => {
            console.error("Background hotel rates crawl failed:", err);
          });
          invalidateTags(INVALIDATION_GROUPS.forMarketRefreshMutation());
          return newsRes;
        })();

        try {
          after(async () => { await task.catch(() => undefined); });
          return Response.json({ runId: "pending", status: "running" }, { status: 202 });
        } catch {
          return Response.json(await task, { status: 202 });
        }
      } catch (error) {
        if (error instanceof NewsRunInProgressError) return Response.json({ error: error.message }, { status: 409 });
        throw error;
      }
    },
  };
}

const handlers = createAdminScrapingHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
