import type { PrismaClient } from "@prisma/client";
import type {
  ScrapeError,
  ScrapeJob,
  ScrapeMethod,
  ScrapeRun,
  ScrapeRunStatus,
  ScrapeStage,
  Source,
  SourceCategory,
} from "../db-types";
import { isSkippedRun } from "./refresh-outcome";

export type {
  ScrapeError,
  ScrapeJob,
  ScrapeMethod,
  ScrapeRun,
  ScrapeRunStatus,
  ScrapeStage,
  Source,
  SourceCategory,
} from "../db-types";

export type ScrapeLogClient = Pick<
  PrismaClient,
  "$transaction" | "scrapeError" | "scrapeRun" | "source"
>;

const ERROR_MESSAGE_MAX_LENGTH = 500;

export const DEFAULT_JOB_SOURCES: Record<
  ScrapeJob,
  {
    name: string;
    domain: string;
    category: SourceCategory;
    method: ScrapeMethod;
    cronSchedule: string;
    manualTriggerSupported: boolean;
  }
> = {
  news: {
    name: "Google News Anyer",
    domain: "news.google.com",
    category: "news",
    method: "rss",
    cronSchedule: "22:23 WIB (GitHub Actions nightly)",
    manualTriggerSupported: true,
  },
  rates: {
    name: "Tarif Google Hotels",
    domain: "google.com/travel",
    category: "review",
    method: "http",
    cronSchedule: "22:23 WIB (GitHub Actions nightly)",
    manualTriggerSupported: true,
  },
  reviews: {
    name: "Ulasan Google Maps",
    domain: "google.com/maps",
    category: "review",
    method: "browser",
    cronSchedule: "22:23 WIB (GitHub Actions nightly)",
    manualTriggerSupported: true,
  },
  social: {
    name: "Media Sosial Kompetitor",
    domain: "instagram.com",
    category: "competitor",
    method: "http",
    cronSchedule: "22:23 WIB / Manual Lokal",
    manualTriggerSupported: true,
  },
  promos: {
    name: "Promo & Event Kompetitor",
    domain: "instagram.com/promos",
    category: "competitor",
    method: "http",
    cronSchedule: "22:23 WIB (GitHub Actions nightly)",
    manualTriggerSupported: true,
  },
  website: {
    name: "Situs Resmi Kompetitor",
    domain: "competitor-websites",
    category: "competitor",
    method: "browser",
    cronSchedule: "22:23 WIB (GitHub Actions nightly)",
    manualTriggerSupported: true,
  },
  ratings: {
    name: "Rating Outlet Sanghyang",
    domain: "sanghyang-outlet-ratings",
    category: "review",
    method: "http",
    cronSchedule: "22:23 WIB (GitHub Actions nightly)",
    manualTriggerSupported: true,
  },
  photos: {
    name: "Foto Kompetitor",
    domain: "competitor-photos",
    category: "competitor",
    method: "browser",
    cronSchedule: "Sesuai Kebutuhan",
    manualTriggerSupported: false,
  },
  room_rates: {
    name: "Tarif Kamar Resort Sanghyang",
    domain: "sanghyang.com/rates",
    category: "review",
    method: "http",
    cronSchedule: "Sesuai Kebutuhan",
    manualTriggerSupported: false,
  },
};

export function sanitizeScrapeError(message: string): string {
  return message
    .replace(/\r?\n\s*at\s+.*$/gim, "")
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb):\/\/\S+/gi, "[database-url-redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1[redacted]@")
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi, "$1: [redacted]")
    .replace(/([?&\s](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ERROR_MESSAGE_MAX_LENGTH);
}

export type FinishRunInput = {
  status: ScrapeRunStatus;
  discovered?: number;
  saved?: number;
  duplicates?: number;
  errors?: number;
  itemsFound?: number;
  itemsSaved?: number;
  itemsDuplicate?: number;
  errorsCount?: number;
};

export type RecordScrapeErrorInput = {
  runId: string;
  sourceId?: string;
  url?: string;
  stage: ScrapeStage;
  message: string;
  statusCode?: number;
};

export type JobStatusDetail = {
  job: ScrapeJob;
  name: string;
  category: SourceCategory;
  method: ScrapeMethod;
  enabled: boolean;
  /** "skipped": run terakhir partial yang semua catatannya berawalan SKIP_PREFIX (langkah tanpa masukan). */
  status: "success" | "partial" | "failed" | "running" | "never_run" | "skipped";
  lastRun: {
    id: string;
    status: ScrapeRunStatus;
    startedAt: string;
    finishedAt: string | null;
    durationSeconds: number | null;
    itemsFound: number;
    itemsSaved: number;
    itemsDuplicate: number;
    errorsCount: number;
  } | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  recentErrors: Array<{
    id: string;
    stage: ScrapeStage;
    message: string;
    url: string | null;
    statusCode: number | null;
    createdAt: string;
  }>;
  cronSchedule: string;
  manualTriggerSupported: boolean;
};

export type AllJobsStatusResult = {
  databaseTarget: "lokal" | "produksi";
  updatedAt: string;
  overall: {
    totalRuns: number;
    lastRunAt: string | null;
    activeRunsCount: number;
  };
  jobs: JobStatusDetail[];
};

export function createScrapeLog(client: ScrapeLogClient) {
  return {
    async ensureSourceForJob(job: ScrapeJob): Promise<Source> {
      const meta = DEFAULT_JOB_SOURCES[job] ?? DEFAULT_JOB_SOURCES.news;
      return client.source.upsert({
        where: { domain_method: { domain: meta.domain, method: meta.method } },
        update: { enabled: true, name: meta.name, category: meta.category },
        create: {
          name: meta.name,
          domain: meta.domain,
          category: meta.category,
          method: meta.method,
          enabled: true,
        },
      });
    },

    startRun(sourceId: string, job: ScrapeJob): Promise<ScrapeRun> {
      return client.scrapeRun.create({ data: { sourceId, job } });
    },

    async startJobRun(job: ScrapeJob, options?: { sourceId?: string }): Promise<ScrapeRun> {
      let sourceId = options?.sourceId;
      if (!sourceId) {
        const source = await this.ensureSourceForJob(job);
        sourceId = source.id;
      }
      return client.scrapeRun.create({ data: { sourceId, job } });
    },

    async finishRun(id: string, result: FinishRunInput): Promise<ScrapeRun> {
      const finishedAt = new Date();
      const discovered = result.itemsFound ?? result.discovered ?? 0;
      const saved = result.itemsSaved ?? result.saved ?? 0;
      const duplicates = result.itemsDuplicate ?? result.duplicates ?? 0;
      const errors = result.errorsCount ?? result.errors ?? 0;

      const run = await client.$transaction(async (tx) => {
        const current = await tx.scrapeRun.findUnique({ where: { id } });
        return tx.scrapeRun.update({
          where: { id },
          data: {
            status: result.status,
            finishedAt,
            recordsDiscovered: discovered,
            recordsSaved: saved,
            duplicates: duplicates,
            errors: Math.max(current?.errors ?? 0, errors),
          },
        });
      });

      await client.source.update({
        where: { id: run.sourceId },
        data:
          result.status === "success"
            ? { lastRunAt: finishedAt, lastSuccessAt: finishedAt, failureCount: 0 }
            : { lastRunAt: finishedAt, failureCount: { increment: 1 } },
      });
      return run;
    },

    async recordScrapeError(input: RecordScrapeErrorInput): Promise<ScrapeError> {
      let sourceId = input.sourceId;
      if (!sourceId) {
        const run = await client.scrapeRun.findUnique({
          where: { id: input.runId },
          select: { sourceId: true },
        });
        if (!run) {
          throw new Error(`ScrapeRun dengan ID ${input.runId} tidak ditemukan.`);
        }
        sourceId = run.sourceId;
      }

      return client.$transaction(async (tx) => {
        const error = await tx.scrapeError.create({
          data: {
            runId: input.runId,
            sourceId: sourceId!,
            stage: input.stage,
            message: sanitizeScrapeError(input.message),
            statusCode: input.statusCode,
            ...(input.url ? { url: sanitizeScrapeError(input.url) } : {}),
          },
        });
        await tx.scrapeRun.update({
          where: { id: input.runId },
          data: { errors: { increment: 1 } },
        });
        return error;
      });
    },

    listRecentRuns(limit: number): Promise<ScrapeRun[]> {
      return client.scrapeRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    },

    async getJobStatusSummary(job: ScrapeJob): Promise<JobStatusDetail> {
      const meta = DEFAULT_JOB_SOURCES[job] ?? DEFAULT_JOB_SOURCES.news;
      const [lastRun, lastSuccessRun, lastFailureRun, recentErrors, source] =
        await Promise.all([
          client.scrapeRun.findFirst({
            where: { job },
            orderBy: { createdAt: "desc" },
          }),
          client.scrapeRun.findFirst({
            where: { job, status: "success" },
            orderBy: { finishedAt: "desc" },
          }),
          client.scrapeRun.findFirst({
            where: { job, status: "failed" },
            orderBy: { finishedAt: "desc" },
          }),
          client.scrapeError.findMany({
            where: { run: { job } },
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
          client.source.findUnique({
            where: { domain_method: { domain: meta.domain, method: meta.method } },
          }),
        ]);

      let status: JobStatusDetail["status"] = "never_run";
      if (lastRun) {
        if (lastRun.status === "running") status = "running";
        else if (lastRun.status === "success") status = "success";
        else if (lastRun.status === "partial") status = "partial";
        else status = "failed";
      }
      // ScrapeRunStatus tidak punya status dilewati; run tanpa masukan dicatat partial dengan alasan berawalan "Dilewati:".
      if (lastRun?.status === "partial" && lastRun.errors > 0) {
        const runErrors = await client.scrapeError.findMany({ where: { runId: lastRun.id }, select: { message: true } });
        if (isSkippedRun(runErrors.map((e) => e.message))) status = "skipped";
      }

      const durationSeconds =
        lastRun?.finishedAt && lastRun?.startedAt
          ? Math.max(
              0,
              Math.round(
                (new Date(lastRun.finishedAt).getTime() -
                  new Date(lastRun.startedAt).getTime()) /
                  1000
              )
            )
          : null;

      return {
        job,
        name: meta.name,
        category: meta.category,
        method: meta.method,
        enabled: source?.enabled ?? true,
        status,
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status,
              startedAt: lastRun.startedAt.toISOString(),
              finishedAt: lastRun.finishedAt?.toISOString() ?? null,
              durationSeconds,
              itemsFound: lastRun.recordsDiscovered,
              itemsSaved: lastRun.recordsSaved,
              itemsDuplicate: lastRun.duplicates,
              errorsCount: lastRun.errors,
            }
          : null,
        lastSuccessAt:
          lastSuccessRun?.finishedAt?.toISOString() ??
          source?.lastSuccessAt?.toISOString() ??
          null,
        lastFailureAt: lastFailureRun?.finishedAt?.toISOString() ?? null,
        recentErrors: recentErrors.map((err) => ({
          id: err.id,
          stage: err.stage,
          message: err.message,
          url: err.url,
          statusCode: err.statusCode,
          createdAt: err.createdAt.toISOString(),
        })),
        cronSchedule: meta.cronSchedule,
        manualTriggerSupported: meta.manualTriggerSupported,
      };
    },

    async getAllJobsStatusSummary(): Promise<AllJobsStatusResult> {
      const jobs = Object.keys(DEFAULT_JOB_SOURCES) as ScrapeJob[];
      const [jobSummaries, totalRuns, activeRunsCount, newestRun] = await Promise.all([
        Promise.all(jobs.map((j) => this.getJobStatusSummary(j))),
        client.scrapeRun.count(),
        client.scrapeRun.count({ where: { status: "running" } }),
        client.scrapeRun.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      ]);

      const isProduction =
        Boolean(process.env.DATABASE_URL?.includes("supabase.co")) &&
        process.env.ALLOW_PRODUCTION_WRITE === "1";

      return {
        databaseTarget: isProduction ? "produksi" : "lokal",
        updatedAt: new Date().toISOString(),
        overall: {
          totalRuns,
          lastRunAt: newestRun?.createdAt.toISOString() ?? null,
          activeRunsCount,
        },
        jobs: jobSummaries,
      };
    },
  };
}

async function scrapeLog() {
  const { db } = await import("../db");
  return createScrapeLog(db);
}

export async function ensureSourceForJob(job: ScrapeJob): Promise<Source> {
  return (await scrapeLog()).ensureSourceForJob(job);
}

export async function startRun(sourceId: string, job: ScrapeJob): Promise<ScrapeRun> {
  return (await scrapeLog()).startRun(sourceId, job);
}

export async function startJobRun(job: ScrapeJob, options?: { sourceId?: string }): Promise<ScrapeRun> {
  return (await scrapeLog()).startJobRun(job, options);
}

export async function finishRun(id: string, result: FinishRunInput): Promise<ScrapeRun> {
  return (await scrapeLog()).finishRun(id, result);
}

export async function recordScrapeError(input: RecordScrapeErrorInput): Promise<ScrapeError> {
  return (await scrapeLog()).recordScrapeError(input);
}

export async function listRecentRuns(limit: number): Promise<ScrapeRun[]> {
  return (await scrapeLog()).listRecentRuns(limit);
}

export async function getJobStatusSummary(job: ScrapeJob): Promise<JobStatusDetail> {
  return (await scrapeLog()).getJobStatusSummary(job);
}

export async function getAllJobsStatusSummary(): Promise<AllJobsStatusResult> {
  return (await scrapeLog()).getAllJobsStatusSummary();
}

export async function createScrapeRunTracker(job: ScrapeJob) {
  const log = await scrapeLog();
  const source = await log.ensureSourceForJob(job);
  const run = await log.startRun(source.id, job);

  let itemsFound = 0;
  let itemsSaved = 0;
  let itemsDuplicate = 0;
  let errorsCount = 0;

  return {
    runId: run.id,
    sourceId: source.id,
    job,
    addFound(n = 1) {
      itemsFound += n;
    },
    addSaved(n = 1) {
      itemsSaved += n;
    },
    addDuplicate(n = 1) {
      itemsDuplicate += n;
    },
    async recordError(opts: {
      stage: ScrapeStage;
      message: string;
      url?: string;
      statusCode?: number;
    }) {
      errorsCount++;
      return log.recordScrapeError({
        runId: run.id,
        sourceId: source.id,
        stage: opts.stage,
        message: opts.message,
        url: opts.url,
        statusCode: opts.statusCode,
      });
    },
    async finish(explicitStatus?: ScrapeRunStatus) {
      const derivedStatus: ScrapeRunStatus =
        explicitStatus ??
        (errorsCount === 0
          ? "success"
          : itemsSaved > 0 || itemsDuplicate > 0
          ? "partial"
          : "failed");
      return log.finishRun(run.id, {
        status: derivedStatus,
        itemsFound,
        itemsSaved,
        itemsDuplicate,
        errorsCount,
      });
    },
    getCounts() {
      return { itemsFound, itemsSaved, itemsDuplicate, errorsCount };
    },
  };
}
