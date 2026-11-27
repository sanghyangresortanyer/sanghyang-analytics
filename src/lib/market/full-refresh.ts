/**
 * Pembaruan data lengkap lintas seluruh 6 outlet Sanghyang (Kamar & Resort, Sunset Grill, Dragon Beach Club,
 * D'Bistro, D'Bar & Karaoke, D'Spa & Hot Spring): berita, tarif Google Hotels + jendela 14 malam H+1..H+14 & sarapan,
 * ulasan Google Travel & Maps, sosmed, promo/event, situs resmi, rating 6 outlet, penandaan ulasan, TPK BPS,
 * spesifikasi tipe kamar, daftar menu kompetitor F&B/Bar/Spa, klasifikasi kompetitor holistik (hanya diterapkan dari
 * mesin kerja lokal), serta invalidasi cache narasi & pembaruan heartbeat.
 *
 * Status tiap langkah ditentukan refresh-outcome.ts: gagal total = gagal, tanpa masukan = dilewati beserta alasannya.
 * Satu langkah gagal membuat hasilnya failed (job malam merah); sebagian dan dilewati tidak.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectGoogleHotelMarketRates, RATE_BATCH_WINDOW_MS } from "./collect-rates";
import { NewsRunInProgressError, runNewsNow } from "./run-news";
import { syncCompetitorSocialPromoEvents } from "./sync-social-promos";
import { scrapeNewGoogleReviews } from "./scrape-new-reviews";
import { readCandidateNews } from "./news-relevance";
import { scrapeSocialBuzz, socialStepOutcome } from "./scrape-social-buzz";
import { classifyRawPosts } from "./promo-extractor";
import { tagResortReviews } from "./review-outlet-tagger";
import { scrapeWebsitePromos } from "./website-promos";
import { classifyPromotionKinds } from "./promo-kind";
import { classifyPromotionTypes, type TypeClassificationResult } from "./promo-type-classifier";
import { promotionTypeLabel } from "./promo-type";
import { importTeamPromos, scrapeOwnOffers } from "./own-promos";
import { refreshOwnOutletRatings, upsertMonthlySnapshots } from "./outlet-ratings";
import { currentMonthWib } from "./goals";
import { createScrapeRunTracker, type ScrapeJob, type ScrapeStage } from "./scrape-log";
import { ALL_REFRESH_STEPS, silentReporter, type RefreshReporter, type RefreshStepKey } from "./refresh-progress";
import { syncBpsTpk } from "./bps-tpk";
import { recordRefreshHeartbeat } from "./refresh-heartbeat";
import { refreshDynamicRoomTypes, roomTypesRefreshOutcome } from "./refresh-room-types";
import { competitorMenusRefreshOutcome, refreshDynamicCompetitorMenus } from "./refresh-competitor-menus";
import { sanitizeAiModelText } from "./hotel-room-types";
import { OUTLET_KEYS } from "./outlet-filters";
import { reclassifyRegistry, type RegistryDecision } from "./competitor-holistic-matcher";
import { loadHolisticRegistry, type HolisticRegistry } from "./compset-audit";
import { refreshCompetitorOfficialRates } from "./competitor-official-rates-refresh";
import { refreshOfficialRoomRates } from "./official-room-rates-refresh";
import { WITH_BREAKFAST_PACKAGE, WITHOUT_BREAKFAST_PACKAGE } from "./rate-basis";
import { presetRange } from "./date-range";
import { refreshOutletAnalysesFromGraph, type RefreshedOutletAnalysis } from "../knowledge-graph/refresh-analyses";
import { latestOutletActions } from "../ai/market-analyst";
import {
  buildRoomRateData,
  crawlRoomRates,
  nextStayDates,
  ROOM_RATE_HOTELS,
  stayWindow,
  validateRoomRateData,
  type HotelCrawl,
} from "./room-offers";
import { isWriteAllowed } from "../db";
import {
  countVerdicts,
  crashedOutcome,
  describeCounts,
  macroOutcome,
  newsOutcome,
  promoStatusOutcome,
  ratesOutcome,
  ratingsOutcome,
  refreshFailed,
  reviewsOutcome,
  runStatusFor,
  skipErrorMessage,
  skippedOutcome,
  taggingOutcome,
  verdictFromCounts,
  websiteOutcome,
  withExtraFailure,
  type StepOutcome,
  type StepRecord,
} from "./refresh-outcome";

export type RefreshOrigin = "github" | "lokal";
export type FullRefreshResult = { failed: boolean; issues: string[]; steps: StepRecord[]; outletsRefreshed: readonly string[] };
export const ALL_REFRESH_OUTLETS = OUTLET_KEYS;

export interface FullRefreshOptions {
  /** Jendela kesegaran data tipe kamar & menu kompetitor (hari). Default 7 hari untuk cron malam; tombol lokal memaksa pembaruan segar. */
  staleAfterDays?: number;
  /** Paksa pembaruan tipe kamar & menu kompetitor walau masih dalam jendela `staleAfterDays`. Default true untuk tombol lokal. */
  forceDynamicRefresh?: boolean;
  /** Batas panggilan ekstraksi otomatis per langkah dinamis agar kuota harian terjaga. */
  maxDynamicAiCalls?: number;
  /** Lewati langkah tipe_kamar dan menu_pesaing (opsional). */
  skipDynamicSteps?: boolean;
  /** Jalankan crawl jendela 14 malam H+1..H+14 & status sarapan pada langkah tarif. Default true untuk tombol lokal. */
  include14NightRoomRates?: boolean;
  /** Lewati langkah klasifikasi kompetitor holistik (opsional). */
  skipHolisticClassification?: boolean;
}

const NARRATIVE_CACHE_PREFIX = "kg-narrative:";

/**
 * Hasil langkah analisis_graf: outlet yang analisisnya tidak berasal dari model (kunci kosong, kuota, atau jawaban
 * tidak terbaca) disebut apa adanya, supaya kesimpulan deterministik tidak terbaca sebagai hasil model.
 */
export function graphAnalysesOutcome(results: RefreshedOutletAnalysis[]): StepOutcome {
  const fromModel = results.filter((r) => r.origin !== "deterministic");
  // Alasan gagal per outlet ikut ke keluaran langkah dan heartbeat, bukan hanya ke log server.
  const fallbackOutlets = results
    .filter((r) => r.origin === "deterministic")
    .map((r) => (r.failure ? `${r.outletKey} (${r.failure})` : r.outletKey));
  const fresh = results.filter((r) => r.origin === "live").length;
  if (results.length > 0 && fallbackOutlets.length === 0) {
    return {
      status: "berhasil",
      detail: `Kesimpulan ${results.length} outlet disusun dari Knowledge Graph (${fresh} baru, ${results.length - fresh} dari simpanan).`,
      issue: null,
    };
  }
  const issue = `analisis graf tanpa model untuk: ${fallbackOutlets.join(", ") || "semua outlet"}`;
  return fromModel.length > 0
    ? {
        status: "sebagian",
        detail: `Kesimpulan ${fromModel.length} dari ${results.length} outlet disusun dari Knowledge Graph; outlet lain memakai susunan otomatis dari data yang sama.`,
        issue,
      }
    : { status: "gagal", detail: "Kesimpulan dari Knowledge Graph tidak dapat disusun lewat model; halaman memakai susunan otomatis dari data.", issue };
}
const ROOM_RATES_JSON_PATH = path.resolve(process.cwd(), "src/lib/market/resort-room-rates.data.json");

type NarrativeCacheClient = {
  marketInsight: {
    deleteMany(args: { where: { fingerprint: { startsWith: string } } }): Promise<{ count: number }>;
  };
};

/**
 * Menghapus baris cache narasi Knowledge Graph (`kg-narrative:*`) yang basi pada tabel `MarketInsight`
 * agar Head-to-Head, Audit Pembanding, dan Laporan Insight Pasar PDF langsung mencerminkan data hasil pembaruan terbaru.
 * Baris heartbeat dan wawasan non-narasi tidak disentuh.
 */
export async function invalidateStaleNarrativeCache(client?: NarrativeCacheClient): Promise<number> {
  if (!client && !isWriteAllowed()) return 0;
  const dbClient = client ?? ((await import("../db")).db as unknown as NarrativeCacheClient);
  const res = await dbClient.marketInsight.deleteMany({
    where: { fingerprint: { startsWith: NARRATIVE_CACHE_PREFIX } },
  });
  return res.count;
}

export interface FourteenNightSyncResult {
  windowStart: string;
  windowEnd: string;
  snapshotsSaved: number;
  breakfastTagged: number;
  jsonUpdated: boolean;
  failures: string[];
}

export interface FourteenNightSyncDbClient {
  competitor: {
    findMany(args: Record<string, unknown>): Promise<Array<{ id: string; placeId: string | null }>>;
  };
  competitorPriceSnapshot: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string; version: number } | null>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
    create(args: Record<string, unknown>): Promise<unknown>;
  };
  sanghyangPriceSnapshot: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string; version: number } | null>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
    create(args: Record<string, unknown>): Promise<unknown>;
  };
}

/**
 * Merayapi tarif OTA jendela 14 malam dinamis (H+1..H+14 mulai hari ini WIB) beserta penawaran tipe kamar
 * dan status sarapan, menyimpannya ke snapshot DB dengan `observedAt` terkini, serta memperbarui berkas
 * `resort-room-rates.data.json` bila seluruh validasi lolos.
 */
export async function syncRoomRatesWindow14ToDb(options?: {
  now?: Date;
  samples?: number;
  hotelIds?: string[];
  writeJsonFile?: boolean;
  client?: FourteenNightSyncDbClient;
  crawl?: typeof crawlRoomRates;
}): Promise<FourteenNightSyncResult> {
  const now = options?.now ?? new Date();
  const dates = nextStayDates(now);
  const stayNights = stayWindow(now, 14);
  const extraNights = stayNights.filter((n) => n.checkin !== dates.weekday.checkin && n.checkin !== dates.weekend.checkin);
  const hotelIds = options?.hotelIds ?? ROOM_RATE_HOTELS;
  const samples = options?.samples ?? 1;
  const crawlFn = options?.crawl ?? crawlRoomRates;

  const result: FourteenNightSyncResult = {
    windowStart: stayNights[0].checkin,
    windowEnd: stayNights[stayNights.length - 1].checkin,
    snapshotsSaved: 0,
    breakfastTagged: 0,
    jsonUpdated: false,
    failures: [],
  };

  if (!options?.client && !isWriteAllowed()) {
    result.failures.push("basis data bersifat baca-saja");
    return result;
  }

  const crawls: HotelCrawl[] = await crawlFn(dates, samples, hotelIds, undefined, extraNights);
  const data = buildRoomRateData(crawls, dates, now, stayNights);
  const problems = validateRoomRateData(data);
  if (problems.length > 0) {
    result.failures.push(...problems);
  }

  const dbClient = options?.client ?? ((await import("../db")).db as unknown as FourteenNightSyncDbClient);
  const comps = await dbClient.competitor.findMany({
    where: { placeId: { in: hotelIds } },
    select: { id: true, placeId: true },
  });
  const compIdByPlace = new Map(comps.filter((c) => c.placeId).map((c) => [c.placeId!, c.id]));
  const batchCutoff = new Date(now.getTime() - RATE_BATCH_WINDOW_MS);

  for (const ev of data.evidence) {
    const stayDates = ev.stay === "weekend" ? dates.weekend : dates.weekday;
    const checkIn = new Date(`${stayDates.checkin}T00:00:00Z`);
    const checkOut = new Date(`${stayDates.checkout}T00:00:00Z`);
    const packageName = ev.breakfast ? WITH_BREAKFAST_PACKAGE : WITHOUT_BREAKFAST_PACKAGE;
    // Sumber snapshot adalah halaman yang benar-benar dirayapi; bila tidak tercatat, null ("belum ada data"), bukan URL
    // umum Google Travel.
    const sourceUrl = crawls.find((c) => c.hotelId === ev.hotelId)?.[ev.stay]?.url || null;
    const values = { price: ev.price, currency: "IDR", guests: 2, checkOut, sourceUrl, observedAt: now };
    const conflict = `${ev.hotelId} ${ev.roomType} (${packageName}, ${stayDates.checkin}): konflik OCC, snapshot sudah diubah proses lain sejak dibaca`;

    if (ev.hotelId === "sanghyang") {
      const existing = await dbClient.sanghyangPriceSnapshot.findFirst({
        where: { roomName: ev.roomType, packageName, checkIn, source: ev.provider, observedAt: { gte: batchCutoff } },
        select: { id: true, version: true },
      });
      if (existing) {
        const updated = await dbClient.sanghyangPriceSnapshot.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { ...values, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          result.failures.push(conflict);
          continue;
        }
      } else {
        await dbClient.sanghyangPriceSnapshot.create({
          data: { roomName: ev.roomType, packageName, checkIn, source: ev.provider, ...values },
        });
      }
      result.snapshotsSaved++;
      if (ev.breakfast) result.breakfastTagged++;
    } else {
      const competitorId = compIdByPlace.get(ev.hotelId);
      if (!competitorId) continue;
      const existing = await dbClient.competitorPriceSnapshot.findFirst({
        where: { competitorId, roomName: ev.roomType, packageName, checkIn, source: ev.provider, observedAt: { gte: batchCutoff } },
        select: { id: true, version: true },
      });
      if (existing) {
        const updated = await dbClient.competitorPriceSnapshot.updateMany({
          where: { id: existing.id, version: existing.version },
          data: { ...values, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          result.failures.push(conflict);
          continue;
        }
      } else {
        await dbClient.competitorPriceSnapshot.create({
          data: { competitorId, roomName: ev.roomType, packageName, checkIn, source: ev.provider, ...values },
        });
      }
      result.snapshotsSaved++;
      if (ev.breakfast) result.breakfastTagged++;
    }
  }

  if (options?.writeJsonFile !== false && problems.length === 0) {
    const enriched: Record<string, unknown> = { ...data };
    if (existsSync(ROOM_RATES_JSON_PATH)) {
      const prev = JSON.parse(readFileSync(ROOM_RATES_JSON_PATH, "utf8")) as Record<string, unknown>;
      if (prev.otaProviders) enriched.otaProviders = prev.otaProviders;
      if (prev.reviewSourcesByHotel) enriched.reviewSourcesByHotel = prev.reviewSourcesByHotel;
      if (prev.otaDiscoveredAt) enriched.otaDiscoveredAt = prev.otaDiscoveredAt;
    }
    writeFileSync(ROOM_RATES_JSON_PATH, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
    result.jsonUpdated = true;
  }

  return result;
}

export interface HolisticRefreshResult {
  /** true bila keputusan ditulis ke DB; false pada mode laporan atau uji kering, yang hanya menghitung. */
  applied: boolean;
  /** Jumlah baris daftar kompetitor (tanpa outlet Sanghyang sendiri) yang dinilai ulang. */
  evaluated: number;
  /**
   * Diterapkan: baris yang status, peran, outlet, alasan arsip, atau catatannya berubah dan tertulis dengan OCC.
   * Mode laporan: baris yang akan berubah bila diterapkan.
   */
  changed: number;
  unchanged: number;
  /** Baris yang memuat keputusan pemakai/pemilik (dihormati seluruhnya atau untuk outlet yang disebut). */
  protectedRows: number;
  roles: { inti: number; acuan: number; arsip: number };
  failures: string[];
  decisions: RegistryDecision[];
  skippedReason?: string;
}

export type HolisticRefreshDbClient = {
  competitor: {
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
};

type HolisticRegistryLoader = () => Promise<Pick<HolisticRegistry, "candidates" | "references">>;

/**
 * Menilai ulang SEMUA kompetitor di keenam outlet dengan mesin holistik, lalu menulis keputusan inti/acuan/arsip dengan
 * OCC (`where {id, version}`, versi naik satu). Baris tidak pernah dihapus; keputusan pemakai/pemilik yang tercatat
 * dihormati, dan kalimatnya ikut ditulis ke `notes` bila `retiredReason` dikosongkan atau diganti. Tanggal periksa
 * (`verifiedAt`) tidak disentuh karena menilai ulang bukan membaca situs tempat itu. `apply: false` hanya menghitung.
 */
export async function syncHolisticCompetitorClassification(options?: {
  client?: HolisticRefreshDbClient;
  load?: HolisticRegistryLoader;
  apply?: boolean;
}): Promise<HolisticRefreshResult> {
  const apply = options?.apply ?? true;
  const result: HolisticRefreshResult = {
    applied: false,
    evaluated: 0,
    changed: 0,
    unchanged: 0,
    protectedRows: 0,
    roles: { inti: 0, acuan: 0, arsip: 0 },
    failures: [],
    decisions: [],
  };

  if (apply && !options?.client && !isWriteAllowed()) {
    result.skippedReason = "Basis data bersifat baca-saja, jadi klasifikasi kompetitor holistik dilewati.";
    return result;
  }

  const registry = await (options?.load ?? (() => loadHolisticRegistry()))();
  const decisions = reclassifyRegistry(registry.candidates, registry.references);
  result.decisions = decisions;
  result.evaluated = decisions.length;
  for (const d of decisions) {
    if (d.protectedBy) result.protectedRows++;
    if (!d.after.active) result.roles.arsip++;
    else if (d.after.compsetRole === "inti") result.roles.inti++;
    else result.roles.acuan++;
  }
  if (!apply) {
    result.changed = decisions.filter((d) => d.changed).length;
    result.unchanged = decisions.length - result.changed;
    return result;
  }

  const dbClient = options?.client ?? ((await import("../db")).db as unknown as HolisticRefreshDbClient);
  result.applied = true;
  for (const d of decisions) {
    if (!d.changed) {
      result.unchanged++;
      continue;
    }
    try {
      const updated = await dbClient.competitor.updateMany({
        where: { id: d.id, version: d.version },
        data: {
          active: d.after.active,
          compsetRole: d.after.compsetRole,
          outlets: d.after.outlets,
          retiredReason: d.after.retiredReason,
          notes: d.after.notes,
          version: { increment: 1 },
        },
      });
      if (updated.count === 1) result.changed++;
      else result.failures.push(`${d.name}: konflik OCC, baris sudah diubah proses lain sejak dibaca`);
    } catch (error) {
      result.failures.push(`${d.name}: ${messageOf(error).slice(0, 140)}`);
    }
  }

  return result;
}

export function holisticClassificationOutcome(result: HolisticRefreshResult): StepOutcome {
  if (result.skippedReason) {
    const clean = sanitizeAiModelText(result.skippedReason);
    return skippedOutcome(clean, `klasifikasi holistik dilewati: ${clean}`);
  }
  if (result.evaluated === 0) {
    return skippedOutcome("Belum ada entri daftar kompetitor untuk dinilai ulang lintas 6 outlet.");
  }
  const { inti, acuan, arsip } = result.roles;
  const tally = `${result.evaluated} kompetitor lintas 6 outlet dinilai ulang: ${inti} inti, ${acuan} acuan, ${arsip} arsip`;
  if (!result.applied) {
    return {
      status: "berhasil",
      detail: sanitizeAiModelText(
        `Mode laporan: ${tally}; ${result.changed} akan berubah bila diterapkan dari mesin kerja lokal, ${result.protectedRows} memuat keputusan pemakai/pemilik. Daftar kompetitor dikelola dari DB kerja lokal dan dibawa ke produksi saat sinkron, jadi langkah ini tidak menulis apa pun.`,
      ),
      issue: null,
    };
  }
  const succeeded = result.changed + result.unchanged;
  const status = verdictFromCounts(succeeded, result.failures.length);
  const detail = sanitizeAiModelText(
    `${tally}; ${result.changed} berubah, ${result.protectedRows} memuat keputusan pemakai/pemilik yang dihormati${result.failures.length ? `, ${result.failures.length} kendala` : ""}.`,
  );
  return {
    status,
    detail,
    issue: result.failures.length ? `klasifikasi holistik: ${result.failures.slice(0, 4).join("; ")}` : null,
  };
}

/** Mesin kerja lokal (tombol "Perbarui Semua Data" di komputer sendiri), bukan job GitHub Actions. */
export function isLocalWorkstationRun(origin: RefreshOrigin, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return origin === "lokal" && !env.GITHUB_ACTIONS;
}

/**
 * Langkah `klasifikasi_kompetitor`. Daftar kompetitor dan kurasinya mengikuti DB kerja lokal (ADR-013), jadi hanya
 * mesin kerja lokal yang menerapkan keputusan. Bila cron produksi ikut menulis, sinkron saat push menimpanya lagi
 * dengan nilai lokal dan status kompetitor bolak-balik; di CI dan produksi langkah ini hanya menghitung dan melaporkan.
 */
export async function holisticClassificationStep(params: {
  origin: RefreshOrigin;
  writableDb: boolean;
  skip?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
  sync?: (options: { apply: boolean }) => Promise<HolisticRefreshResult>;
}): Promise<StepOutcome> {
  if (params.skip) return skippedOutcome("Langkah klasifikasi kompetitor holistik dinonaktifkan pada pemanggilan ini.");
  const apply = isLocalWorkstationRun(params.origin, params.env);
  if (apply && !params.writableDb) {
    return skippedOutcome("Basis data bersifat baca-saja, jadi klasifikasi kompetitor holistik tidak diperbarui.");
  }
  const sync = params.sync ?? syncHolisticCompetitorClassification;
  return holisticClassificationOutcome(await sync({ apply }));
}

type Tracker = Awaited<ReturnType<typeof createScrapeRunTracker>>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Rincian kategori promosi yang baru ditandai, mis. " (Diskon harga 3, Brand awareness 1)". */
function describePromotionTypes(types: TypeClassificationResult): string {
  const parts = Object.entries(types.byType)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([type, count]) => `${promotionTypeLabel(type)} ${count}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export async function runFullRefresh(
  origin: RefreshOrigin,
  reporter: RefreshReporter = silentReporter,
  options: FullRefreshOptions = {},
): Promise<FullRefreshResult> {
  const steps: StepRecord[] = ALL_REFRESH_STEPS.map((s) => ({ key: s.key, label: s.label, status: "menunggu", detail: null }));
  const stepByKey = Object.fromEntries(steps.map((s) => [s.key, s])) as Record<RefreshStepKey, StepRecord>;
  const issues: string[] = [];
  const stats = { ratesCount: 0, reviewsInserted: 0, reviewsSkipped: 0, socialPostsFound: 0, socialNewPosts: 0 };
  let newsStatus = "unknown";

  const begin = (key: RefreshStepKey) => reporter.step(key, "berjalan");
  const finish = (key: RefreshStepKey, outcome: StepOutcome) => {
    Object.assign(stepByKey[key], { status: outcome.status, detail: outcome.detail });
    if (outcome.issue) issues.push(outcome.issue);
    reporter.step(key, outcome.status, outcome.detail);
    console.log(`[nightly] ${key}: ${outcome.status}. ${outcome.detail}`);
  };
  /** Menutup ScrapeRun sesuai status langkah; langkah dilewati dicatat partial dengan alasan berawalan "Dilewati:". */
  const closeTracker = async (tracker: Tracker, outcome: StepOutcome, skipReason = outcome.detail) => {
    if (outcome.status === "dilewati") await tracker.recordError({ stage: "fetch", message: skipErrorMessage(skipReason) });
    await tracker.finish(runStatusFor(outcome.status));
  };
  /** Mencatat galat langkah ke ScrapeRun; bila pencatatannya sendiri gagal, kendala itu ikut dilaporkan, tidak ditelan. */
  const failTracker = async (tracker: Tracker | null, job: ScrapeJob, error: unknown, stage: ScrapeStage = "fetch") => {
    if (!tracker) return;
    try {
      await tracker.recordError({ stage, message: messageOf(error) });
      await tracker.finish("failed");
    } catch (logError) {
      issues.push(`pencatatan run ${job} gagal (${messageOf(logError)})`);
      console.error(`[nightly] pencatatan run ${job} gagal:`, logError);
    }
  };

  // 1. Berita Google News kawasan Anyer/Banten untuk seluruh 6 outlet Sanghyang
  begin("berita");
  try {
    console.log("[nightly] [1/12] Memulai perayapan berita lintas 6 outlet...");
    const result = await runNewsNow();
    newsStatus = result.status;
    console.log(`[nightly] berita selesai: ${result.status} (${result.runId})`);
    const reading = await readCandidateNews().catch((error: unknown) => ({ error: messageOf(error).slice(0, 200) }));
    finish("berita", newsOutcome(result.status, reading));
  } catch (error) {
    if (error instanceof NewsRunInProgressError) {
      newsStatus = "skipped";
      finish("berita", skippedOutcome("Pengambilan berita lain sedang berjalan, jadi langkah ini tidak mengulanginya.", `berita dilewati: ${error.message}`));
    } else {
      newsStatus = "failed";
      finish("berita", crashedOutcome("Google News tidak dapat dibaca.", error));
      console.error("[nightly] berita gagal:", error);
    }
  }

  // 2. Tarif pasar dinamis Google Hotels + jendela 14 malam H+1..H+14 & status sarapan
  begin("tarif");
  let ratesTracker: Tracker | null = null;
  try {
    ratesTracker = await createScrapeRunTracker("rates");
    console.log("[nightly] [2/12] Memulai perayapan tarif dinamis Google Hotels & jendela 14 malam WIB...");
    const { rates, failures } = await collectGoogleHotelMarketRates({ dateMode: "both" });
    let totalSaved = rates.length;
    const allFailures = [...failures];

    const shouldRun14Night = options.include14NightRoomRates ?? isLocalWorkstationRun(origin);
    let windowNote = "";
    if (shouldRun14Night && isWriteAllowed()) {
      try {
        const winRes = await syncRoomRatesWindow14ToDb({ now: new Date(), samples: 1 });
        totalSaved += winRes.snapshotsSaved;
        if (winRes.failures.length > 0) {
          allFailures.push(...winRes.failures.map((f) => `Jendela 14 malam: ${f}`));
        }
        windowNote = ` Jendela 14 malam (${winRes.windowStart}–${winRes.windowEnd}): ${winRes.snapshotsSaved} penawaran kamar (${winRes.breakfastTagged} termasuk sarapan).`;
        // Tarif situs resmi Sanghyang memakai tanggal check-in dari resort-room-rates.data.json, jadi diambil ulang tepat
        // setelah berkas itu berganti tanggal; tanpa ini lapisan resmi tertinggal di tanggal lama dan tidak tampil.
        if (winRes.jsonUpdated) {
          try {
            const official = await refreshOfficialRoomRates();
            allFailures.push(...official.problems.map((p) => `Tarif situs resmi: ${p}`));
            if (official.written) windowNote += " Tarif situs resmi Sanghyang diperbarui.";
          } catch (officialErr) {
            allFailures.push(`Tarif situs resmi: ${messageOf(officialErr).slice(0, 140)}`);
          }
          try {
            const competitor = await refreshCompetitorOfficialRates();
            allFailures.push(...competitor.problems.map((p) => `Tarif situs resmi kompetitor: ${p}`));
            if (competitor.written) windowNote += " Tarif situs resmi kompetitor diperbarui.";
          } catch (competitorErr) {
            allFailures.push(`Tarif situs resmi kompetitor: ${messageOf(competitorErr).slice(0, 140)}`);
          }
        }
      } catch (winErr) {
        allFailures.push(`Jendela 14 malam: ${messageOf(winErr).slice(0, 140)}`);
      }
    }

    stats.ratesCount = totalSaved;
    ratesTracker.addFound(totalSaved + allFailures.length);
    ratesTracker.addSaved(totalSaved);
    for (const failure of allFailures) await ratesTracker.recordError({ stage: "fetch", message: `Tarif gagal untuk ${failure}` });
    const baseOutcome = ratesOutcome({ saved: totalSaved, failures: allFailures });
    const outcome: StepOutcome = windowNote
      ? { ...baseOutcome, detail: `${baseOutcome.detail}${windowNote}` }
      : baseOutcome;
    await closeTracker(ratesTracker, outcome);
    finish("tarif", outcome);
    for (const rate of rates) {
      console.log(`[nightly] ${rate.hotel} (${rate.checkIn.toISOString().split("T")[0]}): ${rate.currency} ${rate.price}`);
    }
  } catch (error) {
    await failTracker(ratesTracker, "rates", error);
    finish("tarif", crashedOutcome("Tarif Google Hotels tidak dapat dibaca.", error));
    console.error("[nightly] perayapan tarif hotel gagal:", error);
  }

  // 3. Ulasan baru Google Travel (hotel) & Google Maps (semua venue F&B, Bar, Spa kompetitor)
  begin("ulasan");
  let reviewsTracker: Tracker | null = null;
  try {
    reviewsTracker = await createScrapeRunTracker("reviews");
    console.log("[nightly] [3/12] Memulai perayapan ulasan Google Travel & Maps lintas 6 outlet...");
    const reviewStats = await scrapeNewGoogleReviews();
    stats.reviewsInserted += reviewStats.totalInserted;
    stats.reviewsSkipped = reviewStats.totalSkipped;
    reviewsTracker.addFound(reviewStats.totalInserted + reviewStats.totalSkipped);
    reviewsTracker.addSaved(reviewStats.totalInserted);
    reviewsTracker.addDuplicate(reviewStats.totalSkipped);
    for (const failure of reviewStats.failures) await reviewsTracker.recordError({ stage: "fetch", message: `Ulasan gagal untuk ${failure}` });
    const outcome = reviewsOutcome(reviewStats);
    await closeTracker(reviewsTracker, outcome);
    finish("ulasan", outcome);
  } catch (error) {
    await failTracker(reviewsTracker, "reviews", error);
    finish("ulasan", crashedOutcome("Ulasan kompetitor tidak dapat dibaca.", error));
    console.error("[nightly] perayapan ulasan gagal:", error);
  }

  // 4. Radar postingan media sosial kompetitor
  begin("sosmed");
  let socialTracker: Tracker | null = null;
  try {
    socialTracker = await createScrapeRunTracker("social");
    console.log("[nightly] [4/12] Memeriksa media sosial kompetitor lewat jalur resmi...");
    const social = await scrapeSocialBuzz();
    stats.socialPostsFound = social.totalDiscovered;
    stats.socialNewPosts = social.newPosts;
    socialTracker.addFound(social.totalDiscovered);
    socialTracker.addSaved(social.newPosts);
    socialTracker.addDuplicate(Math.max(0, social.totalDiscovered - social.newPosts));
    for (const failure of social.failures) await socialTracker.recordError({ stage: "fetch", message: `Sosmed gagal untuk ${failure}` });
    for (const failure of social.tiktok?.failures ?? []) await socialTracker.recordError({ stage: "fetch", message: failure });
    for (const blocked of social.blocked) {
      await socialTracker.recordError({ stage: "fetch", message: `Perlu akses resmi Instagram: login wall untuk ${blocked}` });
    }
    let readFailures: string[] = [];
    if (!process.env.GITHUB_ACTIONS && social.totalDiscovered > 0) {
      const read = await classifyRawPosts();
      console.log(`[nightly] postingan dibaca otomatis: ${read.checked} (promo ${read.promos}, bukan promo ${read.notPromos})`);
      readFailures = read.failures;
      for (const failure of read.failures) {
        await socialTracker.recordError({ stage: "extract", message: `Gagal membaca isi postingan: ${failure}` });
      }
    }
    const base = socialStepOutcome(social);
    const outcome: StepOutcome =
      readFailures.length && base.status === "berhasil"
        ? { status: "sebagian", detail: `${base.detail} Isi ${readFailures.length} postingan belum terbaca.`, issue: `isi ${readFailures.length} postingan belum terbaca` }
        : base;
    await closeTracker(socialTracker, outcome, social.skippedReason);
    finish("sosmed", outcome);
  } catch (error) {
    await failTracker(socialTracker, "social", error);
    finish("sosmed", crashedOutcome("Postingan media sosial tidak dapat dibaca.", error));
    console.error("[nightly] perayapan sosmed gagal:", error);
  }

  // 5. Status promo dan acara kompetitor
  begin("promo");
  let promoTracker: Tracker | null = null;
  try {
    promoTracker = await createScrapeRunTracker("promos");
    console.log("[nightly] [5/12] Sinkronisasi status promosi & acara kompetitor...");
    const promoSync = await syncCompetitorSocialPromoEvents();
    promoTracker.addFound(promoSync.totalSynced + promoSync.expiredCount);
    promoTracker.addSaved(promoSync.totalSynced + promoSync.expiredCount);
    const outcome = promoStatusOutcome({ received: 0, ...promoSync });
    await closeTracker(promoTracker, outcome);
    finish("promo", outcome);
  } catch (error) {
    await failTracker(promoTracker, "promos", error, "persist");
    finish("promo", crashedOutcome("Status promo tidak dapat diperbarui.", error));
    console.error("[nightly] sinkronisasi promo kompetitor gagal:", error);
  }

  // 6. Promo dan event di situs resmi kompetitor + penawaran Sanghyang semua outlet
  begin("situs");
  let websiteTracker: Tracker | null = null;
  try {
    websiteTracker = await createScrapeRunTracker("website");
    console.log("[nightly] [6/12] Membaca promo & event di situs resmi kompetitor dan Sanghyang...");
    const site = await scrapeWebsitePromos();
    let saved = site.saved;
    let ownFailure: string | null = null;
    try {
      const own = await scrapeOwnOffers();
      const ownTeam = await importTeamPromos();
      saved += own.created + ownTeam.created;
      console.log(`[nightly] promo Sanghyang: ${own.offers} penawaran situs, ${ownTeam.items} butir tim marketing.`);
    } catch (error) {
      ownFailure = messageOf(error);
      console.error("[nightly] promo Sanghyang gagal:", error);
    }
    const kinds = await classifyPromotionKinds();
    console.log(`[nightly] jenis promo: ${kinds.promos} promo, ${kinds.events} event baru ditandai.`);
    // Kategori promosi dibaca sesudah jenis promo/event dipilah, karena hanya baris berjenis promo yang dikategorikan.
    let types: TypeClassificationResult | null = null;
    let typesError: string | null = null;
    try {
      types = await classifyPromotionTypes();
      console.log(`[nightly] kategori promosi: ${types.checked} promo ditandai${describePromotionTypes(types)}.`);
    } catch (error) {
      typesError = messageOf(error);
      console.error("[nightly] kategori promosi gagal:", error);
    }
    websiteTracker.addFound(site.sites);
    websiteTracker.addSaved(saved + site.updated);
    for (const failure of site.failures) await websiteTracker.recordError({ stage: "fetch", message: failure });
    for (const failure of kinds.failures) await websiteTracker.recordError({ stage: "extract", message: failure });
    for (const failure of types?.failures ?? []) await websiteTracker.recordError({ stage: "extract", message: failure });
    if (typesError) await websiteTracker.recordError({ stage: "extract", message: `Kategori promosi: ${typesError}` });
    if (ownFailure) await websiteTracker.recordError({ stage: "fetch", message: `Sanghyang: ${ownFailure}` });
    let outcome = websiteOutcome({ sites: site.sites, saved, updated: site.updated, events: kinds.events, kindFailures: kinds.failures.length, siteFailures: site.failures, ownFailure });
    if (types && types.checked > 0) {
      outcome = { ...outcome, detail: `${outcome.detail} ${types.checked} kategori promosi ditandai${describePromotionTypes(types)}.` };
    }
    const typeFailures = [...(types?.failures ?? []), ...(typesError ? [typesError] : [])];
    if (typeFailures.length) {
      outcome = withExtraFailure(
        outcome,
        `${typeFailures.length} kategori promosi belum terbaca.`,
        `kategori promosi: ${typeFailures.slice(0, 3).map((f) => f.slice(0, 120)).join("; ")}`,
      );
    }
    await closeTracker(websiteTracker, outcome);
    finish("situs", outcome);
  } catch (error) {
    await failTracker(websiteTracker, "website", error);
    finish("situs", crashedOutcome("Situs resmi kompetitor tidak dapat dibaca.", error));
    console.error("[nightly] promo situs kompetitor gagal:", error);
  }

  // 7. Rating Google Maps seluruh 6 outlet Sanghyang + kompetitor aktif & potret bulanan
  begin("rating");
  let ratingsTracker: Tracker | null = null;
  try {
    ratingsTracker = await createScrapeRunTracker("ratings");
    console.log("[nightly] [7/12] Rating 6 outlet Sanghyang & kompetitor di Google Maps + potret bulanan...");
    const ratings = await refreshOwnOutletRatings();
    stats.reviewsInserted += ratings.reviewsInserted;
    ratingsTracker.addFound(ratings.updated.length + ratings.failures.length);
    ratingsTracker.addSaved(ratings.updated.length);
    for (const failure of ratings.failures) await ratingsTracker.recordError({ stage: "fetch", message: `Rating gagal untuk ${failure}` });
    console.log(`[nightly] rating diperbarui: ${ratings.updated.join(", ") || "-"}; ulasan Google Maps outlet +${ratings.reviewsInserted}`);
    let outcome = ratingsOutcome(ratings);
    try {
      const snapshots = await upsertMonthlySnapshots(currentMonthWib());
      console.log(`[nightly] potret bulanan tersimpan: ${snapshots} outlet`);
    } catch (error) {
      outcome = withExtraFailure(outcome, "Potret bulanan belum tersimpan.", `potret bulanan gagal (${messageOf(error)})`);
      await ratingsTracker.recordError({ stage: "persist", message: `Potret bulanan gagal: ${messageOf(error)}` });
      console.error("[nightly] potret bulanan gagal:", error);
    }
    await closeTracker(ratingsTracker, outcome);
    finish("rating", outcome);
  } catch (error) {
    await failTracker(ratingsTracker, "ratings", error);
    finish("rating", crashedOutcome("Rating Google Maps outlet tidak dapat dibaca.", error));
    console.error("[nightly] rating & potret bulanan gagal:", error);
  }

  // 8. Menandai outlet yang disebut di ulasan resort
  begin("penandaan");
  try {
    console.log("[nightly] [8/12] Menandai outlet di ulasan resort...");
    const tags = await tagResortReviews();
    console.log(`[nightly] ulasan resort dibaca: ${tags.checked} dari ${tags.attempted}, ${tags.tagged} menyebut outlet.`);
    finish("penandaan", taggingOutcome(tags));
  } catch (error) {
    finish("penandaan", crashedOutcome("Penandaan outlet di ulasan resort tidak dapat dijalankan.", error));
    console.error("[nightly] penandaan ulasan gagal:", error);
  }

  // 9. TPK hotel bintang Banten dari BPS
  begin("makro");
  try {
    console.log("[nightly] [9/12] Rilis TPK BPS...");
    finish("makro", macroOutcome(await syncBpsTpk()));
  } catch (error) {
    finish("makro", crashedOutcome("Rilis BPS tidak dapat dibaca.", error));
    console.error("[nightly] TPK BPS gagal:", error);
  }

  const dynamicStaleDays = options.staleAfterDays ?? 7;
  // Tombol lokal "Perbarui Semua Data" memaksa pembaruan segar seluruh outlet agar tanggal periksa benar-benar bergerak.
  const dynamicForce = options.forceDynamicRefresh ?? origin === "lokal";
  const dynamicMaxCalls = options.maxDynamicAiCalls ?? (origin === "lokal" ? 24 : 12);
  const hasExtractionKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  const writableDb = isWriteAllowed();

  // 10. Spesifikasi tipe kamar & luas (m²) multi-sumber ke CompetitorFact DB
  begin("tipe_kamar");
  try {
    console.log("[nightly] [10/12] Memperbarui spesifikasi tipe kamar & luas dari situs resmi + OTA...");
    if (options.skipDynamicSteps) {
      finish("tipe_kamar", skippedOutcome("Langkah spesifikasi tipe kamar dinonaktifkan pada pemanggilan ini."));
    } else if (!writableDb) {
      finish("tipe_kamar", skippedOutcome("Basis data bersifat baca-saja, jadi spesifikasi tipe kamar tidak diperbarui."));
    } else if (!hasExtractionKey) {
      finish("tipe_kamar", skippedOutcome("Kunci layanan ekstraksi otomatis belum tersedia, jadi pembaruan tipe kamar dilewati."));
    } else {
      const roomRes = await refreshDynamicRoomTypes({
        staleAfterDays: dynamicStaleDays,
        force: dynamicForce,
        maxGeminiCalls: dynamicMaxCalls,
      });
      finish("tipe_kamar", roomTypesRefreshOutcome(roomRes));
    }
  } catch (error) {
    finish("tipe_kamar", crashedOutcome("Spesifikasi tipe kamar tidak dapat diperbarui.", error));
    console.error("[nightly] pembaruan tipe kamar gagal:", error);
  }

  // 11. Daftar menu & harga kompetitor F&B, Bar, dan Spa lintas 5 outlet non-kamar ke CompetitorFact DB
  begin("menu_pesaing");
  try {
    console.log("[nightly] [11/12] Memperbarui daftar menu & harga kompetitor F&B, Bar, dan Spa...");
    if (options.skipDynamicSteps) {
      finish("menu_pesaing", skippedOutcome("Langkah menu kompetitor dinonaktifkan pada pemanggilan ini."));
    } else if (!writableDb) {
      finish("menu_pesaing", skippedOutcome("Basis data bersifat baca-saja, jadi daftar menu kompetitor tidak diperbarui."));
    } else if (!hasExtractionKey) {
      finish("menu_pesaing", skippedOutcome("Kunci layanan ekstraksi otomatis belum tersedia, jadi pembaruan menu kompetitor dilewati."));
    } else {
      const menuRes = await refreshDynamicCompetitorMenus({
        staleAfterDays: dynamicStaleDays,
        force: dynamicForce,
        maxGeminiCalls: dynamicMaxCalls,
      });
      finish("menu_pesaing", competitorMenusRefreshOutcome(menuRes));
    }
  } catch (error) {
    finish("menu_pesaing", crashedOutcome("Daftar menu kompetitor tidak dapat diperbarui.", error));
    console.error("[nightly] pembaruan menu kompetitor gagal:", error);
  }

  // 12. Klasifikasi kompetitor holistik 6 dimensi lintas 6 outlet; diterapkan hanya dari mesin kerja lokal
  begin("klasifikasi_kompetitor");
  try {
    console.log("[nightly] [12/12] Menilai ulang klasifikasi kompetitor holistik 6 outlet...");
    finish(
      "klasifikasi_kompetitor",
      await holisticClassificationStep({ origin, writableDb, skip: options.skipHolisticClassification }),
    );
  } catch (error) {
    finish("klasifikasi_kompetitor", crashedOutcome("Klasifikasi kompetitor holistik tidak dapat dijalankan.", error));
    console.error("[nightly] klasifikasi kompetitor holistik gagal:", error);
  }

  // Langkah dari kesimpulan sebelumnya dibaca sebelum cache narasi dibersihkan, lalu dikirim ke analisis_graf supaya
  // rekomendasi baru tidak menyalin yang lama kata per kata.
  let previousActionsByOutlet: Record<string, string[]> | undefined;
  try {
    previousActionsByOutlet = await latestOutletActions();
  } catch (error) {
    issues.push(`langkah kesimpulan sebelumnya tidak terbaca (${messageOf(error)})`);
    console.error("[nightly] langkah kesimpulan sebelumnya tidak terbaca:", error);
  }

  // Invalidasi cache narasi analisis (`kg-narrative:*`) agar Head-to-Head, Audit Pembanding, Knowledge Graph, dan Laporan Insight Pasar PDF selalu segar.
  try {
    const invalidated = await invalidateStaleNarrativeCache();
    console.log(`[nightly] cache narasi dibersihkan: ${invalidated} baris.`);
  } catch (error) {
    issues.push(`pembersihan cache narasi gagal (${messageOf(error)})`);
    console.error("[nightly] pembersihan cache narasi gagal:", error);
  }

  // 13. Kesimpulan per outlet dari Knowledge Graph lewat model di .env untuk periode bawaan Insight Pasar (30 hari).
  // Berjalan sesudah cache narasi lama dibersihkan, supaya hasil model yang baru tidak ikut terhapus; Insight Pasar dan
  // PDF membacanya dari MarketInsight lewat sidik jari yang sama.
  begin("analisis_graf");
  try {
    if (!writableDb) {
      finish("analisis_graf", skippedOutcome("Basis data bersifat baca-saja, jadi kesimpulan dari Knowledge Graph tidak disimpan."));
    } else if (!hasExtractionKey) {
      finish("analisis_graf", skippedOutcome("Kunci layanan model belum tersedia, jadi halaman memakai susunan otomatis dari Knowledge Graph."));
    } else {
      // Selalu disusun ulang (skipCache): pemilik 27 Nov 2026 meminta rekomendasi berubah setiap Perbarui Semua Data,
      // walaupun data graf belum berubah. Enam panggilan AI per pembaruan masih jauh di bawah kuota harian.
      finish("analisis_graf", graphAnalysesOutcome(await refreshOutletAnalysesFromGraph(presetRange("30d", new Date()), undefined, { skipCache: true, previousActionsByOutlet })));
    }
  } catch (error) {
    finish("analisis_graf", crashedOutcome("Kesimpulan dari Knowledge Graph tidak dapat disusun.", error));
    console.error("[nightly] analisis graf gagal:", error);
  }

  // Heartbeat: hasil per langkah untuk header Insight Pasar, Knowledge Graph, dan briefing pagi.
  let heartbeatFailed = false;
  try {
    console.log("[nightly] heartbeat tersimpan:", await recordRefreshHeartbeat({ origin, steps, issues, newsStatus, stats }));
  } catch (error) {
    heartbeatFailed = true;
    issues.push(`pencatatan heartbeat gagal (${messageOf(error)})`);
    console.error("[nightly] pencatatan heartbeat gagal:", error);
  }

  console.log(`[nightly] ringkasan: ${describeCounts(countVerdicts(steps))}`);
  return { failed: heartbeatFailed || refreshFailed(steps), issues, steps, outletsRefreshed: [...OUTLET_KEYS] };
}
