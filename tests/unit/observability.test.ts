import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db } from "../../src/lib/db";
import {
  filterActiveWebsiteTargets,
  getActiveCompetitorWebsites,
  isOfficialSite,
  type CompetitorWebsiteTarget,
} from "../../src/lib/market/website-promos";
import {
  createScrapeRunTracker,
  DEFAULT_JOB_SOURCES,
  ensureSourceForJob,
  getAllJobsStatusSummary,
  getJobStatusSummary,
  sanitizeScrapeError,
  type ScrapeJob,
} from "../../src/lib/market/scrape-log";
import { createScrapingStatusGet, GET as GET_UNAUTH } from "../../src/app/api/admin/scraping/status/route";

const GET = createScrapingStatusGet(async () => null);

test("C2: filterActiveWebsiteTargets mengabaikan sasaran nonaktif dan pensiun", () => {
  const dummyCompetitors: CompetitorWebsiteTarget[] = [
    {
      id: "comp-1",
      name: "Novus Jiva Anyer",
      websiteUrl: "https://www.novusjiva.com",
      active: true,
    },
    {
      id: "comp-2",
      name: "Patra Anyer Hotel",
      websiteUrl: "https://www.patra-hotelsandresorts.com",
      active: false, // Pensiun / nonaktif
    },
    {
      id: "comp-3",
      name: "Aston Anyer Beach Hotel",
      websiteUrl: "https://www.astonhotelsinternational.com/anyer",
      active: true,
    },
    {
      id: "comp-4",
      name: "Aston Anyer Aquavillas",
      websiteUrl: "https://www.astonhotelsinternational.com/anyer-villas", // Duplikat hostname
      active: true,
    },
    {
      id: "comp-5",
      name: "Akun Sosmed Pesaing",
      websiteUrl: "https://www.instagram.com/pesaing_anyer", // Bukan situs resmi
      active: true,
    },
  ];

  const filtered = filterActiveWebsiteTargets(dummyCompetitors);

  // 1. Patra yang nonaktif tidak boleh diambil
  const patraFound = filtered.some((c) => c.name.toLowerCase().includes("patra"));
  assert.equal(patraFound, false, "Pesaing pensiun (Patra) tidak boleh ada di daftar aktif");

  // 2. Sosmed Instagram bukan situs resmi
  const instaFound = filtered.some((c) => c.websiteUrl?.includes("instagram.com"));
  assert.equal(instaFound, false, "URL media sosial tidak boleh dianggap situs resmi");

  // 3. Duplikat hostname Aston hanya diambil satu kali
  const astonMatches = filtered.filter((c) => c.websiteUrl?.includes("astonhotelsinternational.com"));
  assert.equal(astonMatches.length, 1, "Situs dengan hostname sama harus dideduplikasi");

  // 4. Novus Jiva aktif harus ada
  const novusFound = filtered.some((c) => c.id === "comp-1");
  assert.equal(novusFound, true, "Sasaran aktif harus lolos filter");
});

test("C2: getActiveCompetitorWebsites terhadap DB lokal tidak menyertakan Patra", async () => {
  const activeSites = await getActiveCompetitorWebsites(db);
  assert.ok(activeSites.length > 0, "Harus menemukan setidaknya satu kompetitor aktif di DB lokal");

  const patra = activeSites.find((s) => s.name.toLowerCase().includes("patra"));
  assert.equal(
    patra,
    undefined,
    "Patra Anyer Hotel (active: false) tidak boleh diambil dari database lokal"
  );

  for (const site of activeSites) {
    assert.equal(site.active, true, `Sasaran '${site.name}' wajib berstatus active: true`);
    assert.equal(
      isOfficialSite(site.websiteUrl),
      true,
      `URL '${site.websiteUrl}' wajib berupa situs resmi yang sah`
    );
  }
});

test("C1: sanitizeScrapeError membersihkan data sensitif dan membatasi panjang", () => {
  const rawMsg =
    "Error connection to postgresql://postgres:mysecret123@aws-pooler.supabase.com:6543/db at line 42 with token=secretTokenAbc123 and cookie: session=xyz";
  const cleaned = sanitizeScrapeError(rawMsg);

  assert.equal(cleaned.includes("mysecret123"), false, "Password database harus disamarkan");
  assert.equal(cleaned.includes("secretTokenAbc123"), false, "Token API harus disamarkan");
  assert.equal(cleaned.includes("session=xyz"), false, "Cookie harus disamarkan");

  const superLong = "A".repeat(1000);
  const shortened = sanitizeScrapeError(superLong);
  assert.ok(shortened.length <= 500, "Pesan error maksimal 500 karakter");
});

test("C1: ensureSourceForJob membuat/mengambil Source valid untuk tiap ScrapeJob", async () => {
  const jobs: ScrapeJob[] = [
    "news",
    "rates",
    "reviews",
    "social",
    "promos",
    "website",
    "ratings",
    "photos",
    "room_rates",
  ];

  for (const job of jobs) {
    const source = await ensureSourceForJob(job);
    assert.ok(source.id, `Source untuk job '${job}' harus memiliki ID`);
    assert.equal(source.enabled, true, `Source untuk job '${job}' harus aktif`);
    assert.equal(
      source.domain,
      DEFAULT_JOB_SOURCES[job].domain,
      `Domain source harus selaras dengan konfigurasi DEFAULT_JOB_SOURCES`
    );
  }
});

/** Run uji dihapus setelah berkas ini selesai supaya tidak muncul sebagai pembaruan sungguhan di status DB lokal. */
const createdRunIds: string[] = [];
after(async () => {
  if (createdRunIds.length) await db.scrapeRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

test("C1: Menjalankan satu job ke DB lokal menghasilkan baris ScrapeRun dan ScrapeError yang valid", async () => {
  const tracker = await createScrapeRunTracker("rates");
  createdRunIds.push(tracker.runId);
  assert.ok(tracker.runId, "Tracker harus menghasilkan runId ScrapeRun");
  assert.ok(tracker.sourceId, "Tracker harus menghasilkan sourceId Source");

  // Tambah metrik observabilitas
  tracker.addFound(5);
  tracker.addSaved(3);
  tracker.addDuplicate(2);

  // Catat satu error per URL
  const testUrl = "https://www.google.com/travel/hotels/test-hotel";
  const recordedError = await tracker.recordError({
    stage: "fetch",
    message: "HTTP 429 Terlalu Banyak Permintaan dari Google Hotels",
    url: testUrl,
    statusCode: 429,
  });

  assert.ok(recordedError.id, "ScrapeError harus tersimpan dengan id");
  assert.equal(recordedError.runId, tracker.runId);
  assert.equal(recordedError.statusCode, 429);
  assert.equal(recordedError.url, testUrl);

  // Selesaikan run
  const finishedRun = await tracker.finish("partial");

  assert.equal(finishedRun.id, tracker.runId);
  assert.equal(finishedRun.status, "partial");
  assert.equal(finishedRun.recordsDiscovered, 5, "recordsDiscovered harus sama dengan itemsFound");
  assert.equal(finishedRun.recordsSaved, 3, "recordsSaved harus sama dengan itemsSaved");
  assert.equal(finishedRun.duplicates, 2, "duplicates harus sama dengan itemsDuplicate");
  assert.ok(finishedRun.errors >= 1, "errorsCount harus tercatat minimal 1");
  assert.ok(finishedRun.finishedAt instanceof Date, "finishedAt harus berupa Date");

  // Verifikasi langsung ke DB
  const verifiedInDb = await db.scrapeRun.findUnique({
    where: { id: tracker.runId },
    include: { scrapeErrors: true },
  });

  assert.ok(verifiedInDb, "Baris ScrapeRun harus ada di DB lokal");
  assert.equal(verifiedInDb.scrapeErrors.length, 1, "Harus ada 1 baris ScrapeError terkait");
  assert.equal(verifiedInDb.scrapeErrors[0].stage, "fetch");
});

test("Backend C7: getJobStatusSummary dan getAllJobsStatusSummary membaca data aktual", async () => {
  const allStatus = await getAllJobsStatusSummary();

  assert.equal(allStatus.databaseTarget, "lokal");
  assert.equal(allStatus.overall.totalRuns, await db.scrapeRun.count(), "Total runs harus sama dengan isi tabel ScrapeRun");
  assert.equal(allStatus.jobs.length, 9, "Harus memuat status untuk 9 ScrapeJob");

  // Job rates yang baru saja dijalankan di tes sebelumnya harus berstatus 'partial'
  const ratesStatus = allStatus.jobs.find((j) => j.job === "rates");
  assert.ok(ratesStatus, "Job rates harus ditemukan di ringkasan");
  assert.equal(ratesStatus.status, "partial");
  assert.ok(ratesStatus.lastRun, "ratesStatus harus memiliki lastRun");
  assert.equal(ratesStatus.lastRun?.itemsFound, 5);
  assert.equal(ratesStatus.lastRun?.itemsSaved, 3);
  assert.ok(ratesStatus.recentErrors.length >= 1, "recentErrors harus memuat galat yang baru dicatat");

  // Job news yang historis
  const newsStatus = await getJobStatusSummary("news");
  assert.equal(newsStatus.job, "news");
  assert.equal(newsStatus.name, "Google News Anyer");
  assert.equal(newsStatus.status, "success");
  assert.ok(newsStatus.lastSuccessAt, "news harus memiliki lastSuccessAt aktual");
});

test("Backend C7: Endpoint GET /api/admin/scraping/status menolak tanpa login (401) dan mengembalikan JSON status per job saat berwenang", async () => {
  const unauth = await GET_UNAUTH(new NextRequest("http://localhost:3001/api/admin/scraping/status"));
  assert.equal(unauth.status, 401);

  // 1. Panggil semua job
  const reqAll = new NextRequest("http://localhost:3001/api/admin/scraping/status");
  const resAll = await GET(reqAll);
  assert.equal(resAll.status, 200);

  const jsonAll = await resAll.json();
  assert.equal(jsonAll.databaseTarget, "lokal");
  assert.equal(jsonAll.jobs.length, 9);
  assert.ok(Array.isArray(jsonAll.jobs));

  // 2. Panggil satu job spesifik
  const reqSingle = new NextRequest("http://localhost:3001/api/admin/scraping/status?job=rates");
  const resSingle = await GET(reqSingle);
  assert.equal(resSingle.status, 200);

  const jsonSingle = await resSingle.json();
  assert.equal(jsonSingle.job, "rates");
  assert.equal(jsonSingle.name, "Tarif Google Hotels");
  assert.ok(jsonSingle.cronSchedule.includes("22:23 WIB"));

  // 3. Panggil job tidak valid -> 400
  const reqInvalid = new NextRequest(
    "http://localhost:3001/api/admin/scraping/status?job=job_palsu_tidak_ada"
  );
  const resInvalid = await GET(reqInvalid);
  assert.equal(resInvalid.status, 400);
  const jsonInvalid = await resInvalid.json();
  assert.ok(jsonInvalid.error.includes("tidak valid"));
});
