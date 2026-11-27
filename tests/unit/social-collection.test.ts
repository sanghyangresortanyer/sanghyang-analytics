import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { instagramCollectionStatus, socialStepOutcome } from "../../src/lib/market/scrape-social-buzz";
import { socialSourceStatuses } from "../../src/lib/market/social-sources";
import { channelFromSource } from "../../src/lib/market/outlet-filters";
import { isVerifiedReviewSource } from "../../src/lib/market/resort-strategy";
import { businessDiscoveryRequest, redactAccessToken } from "../../src/lib/market/adapters/instagram-graph";
import { isTikTokPhotoUrl, isTikTokVideoUrl, parseTikTokOEmbed, tiktokOEmbedUrl } from "../../src/lib/market/adapters/tiktok-oembed";

// Jawaban nyata endpoint oEmbed TikTok 16 Nov 2026 (lihat _sumber di fixture).
const oembed = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests/fixtures/tiktok-oembed-2026-11-16.json"), "utf8")) as {
  video: { requestUrl: string; status: number; body: unknown };
  profile: { requestUrl: string; status: number; body: unknown };
};
const NO_TARGETS = { tiktokVideos: 0 };

// ADR-004: Instagram hanya boleh diambil lewat Instagram Graph API resmi. Scraping DOM profil (yang sering dialihkan ke
// halaman login) dihentikan, jadi tanpa kredensial job sosmed dilewati dengan alasan yang jujur.
test("C3: tanpa kredensial Graph API, pengumpulan Instagram memakai jalur Ekstensi Chrome tanpa membocorkan nama variabel lingkungan", () => {
  const status = instagramCollectionStatus({});
  assert.equal(status.runDomScraper, false, "scraping DOM Instagram tidak boleh berjalan");
  assert.equal(status.label, "Belum tersambung");
  assert.match(status.reason, /Ekstensi Chrome Sanghyang Market Sync/);
  assert.doesNotMatch(status.reason, /INSTAGRAM_GRAPH_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID|Perlu login ulang di Chrome/);
});

test("C3: dengan kredensial, Instagram dibaca lewat Business Discovery, scraping DOM tetap tidak dipakai", () => {
  const status = instagramCollectionStatus({ INSTAGRAM_GRAPH_ACCESS_TOKEN: "x", INSTAGRAM_BUSINESS_ACCOUNT_ID: "1" });
  assert.equal(status.runDomScraper, false);
  assert.equal(status.label, "Tersambung");
  assert.match(status.reason, /Business Discovery/);
  assert.doesNotMatch(status.reason, /ROADMAP|belum diaktifkan/);
});

test("status per sumber tanpa kunci: belum dikonfigurasi beserta nama kunci yang harus diisi", () => {
  const byId = Object.fromEntries(socialSourceStatuses({}, { tiktokVideos: 1 }).map((s) => [s.id, s]));
  assert.equal(byId["instagram-business-discovery"].state, "belum-dikonfigurasi");
  assert.match(byId["instagram-business-discovery"].detail, /^Belum dikonfigurasi: isi INSTAGRAM_GRAPH_ACCESS_TOKEN dan INSTAGRAM_BUSINESS_ACCOUNT_ID/);
  assert.deepEqual(byId["instagram-business-discovery"].missingEnvKeys, ["INSTAGRAM_GRAPH_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"]);
  assert.equal(byId["tiktok-oembed"].state, "siap", "oEmbed TikTok tidak butuh kunci");
  for (const s of Object.values(byId)) assert.match(s.documentationUrl, /^https:\/\/developers\.(facebook|tiktok)\.com\//);
});

test("jalur YouTube sudah dihapus: tidak ada sumber youtube-data, kanalnya bukan media sosial, permalink komentarnya tidak terverifikasi", () => {
  const ids = socialSourceStatuses({ INSTAGRAM_GRAPH_ACCESS_TOKEN: "t", INSTAGRAM_BUSINESS_ACCOUNT_ID: "1" }, { tiktokVideos: 1 }).map((s) => s.id);
  assert.deepEqual(ids, ["instagram-business-discovery", "tiktok-oembed"]);
  assert.ok(!(ids as string[]).includes("youtube-data"));
  assert.notEqual(channelFromSource("YouTube"), "social");
  assert.equal(channelFromSource("Instagram"), "social");
  assert.equal(channelFromSource("TikTok"), "social");
  assert.equal(isVerifiedReviewSource("https://www.youtube.com/watch?v=isyPb70JH24&lc=Ugx123"), false);
});

test("status per sumber dengan kunci: Instagram Business Discovery siap tanpa login akun Sanghyang", () => {
  const env = { INSTAGRAM_GRAPH_ACCESS_TOKEN: "t", INSTAGRAM_BUSINESS_ACCOUNT_ID: "1" };
  const byId = Object.fromEntries(socialSourceStatuses(env, { tiktokVideos: 1 }).map((s) => [s.id, s]));
  assert.equal(byId["instagram-business-discovery"].state, "siap");
  assert.deepEqual(byId["instagram-business-discovery"].missingEnvKeys, []);
});

test("status TikTok tanpa target menyebut alasannya", () => {
  const byId = Object.fromEntries(socialSourceStatuses({}, NO_TARGETS).map((s) => [s.id, s]));
  assert.equal(byId["tiktok-oembed"].state, "tanpa-target");
  assert.match(byId["tiktok-oembed"].detail, /belum ada URL video TikTok/);
});

test("URL Business Discovery: akun bisnis pesaing, kolom media publik, token tidak tercetak di log", () => {
  const req = businessDiscoveryRequest({ igUserId: "17841400000000000", username: "andalanbeach", limit: 5, token: "TOKEN-RAHASIA", version: "v27.0" });
  const url = new URL(req.url);
  assert.equal(url.origin, "https://graph.facebook.com");
  assert.equal(url.pathname, "/v27.0/17841400000000000");
  assert.equal(
    url.searchParams.get("fields"),
    "business_discovery.username(andalanbeach){username,followers_count,media_count,media.limit(5){id,caption,comments_count,like_count,timestamp,permalink,media_type}}",
  );
  assert.equal(url.searchParams.get("access_token"), "TOKEN-RAHASIA");
  assert.doesNotMatch(redactAccessToken(req.url), /TOKEN-RAHASIA/);
  const unversioned = new URL(businessDiscoveryRequest({ igUserId: "1784", username: "x", limit: 1, token: "t", version: null }).url);
  assert.equal(unversioned.pathname, "/1784", "tanpa versi, Graph API memakai versi di dasbor aplikasi");
  assert.throws(() => businessDiscoveryRequest({ igUserId: "1", username: "a b", limit: 1, token: "t", version: null }), /nama akun/);
});

test("oEmbed TikTok: URL resmi dan jawaban nyata, video tersedia tanpa judul, profil ditolak", () => {
  assert.equal(
    tiktokOEmbedUrl(oembed.video.requestUrl),
    "https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40archipelagohotels%2Fvideo%2F7391827491028374912",
  );
  const video = parseTikTokOEmbed(oembed.video.requestUrl, oembed.video.status, oembed.video.body);
  assert.equal(video.available, true);
  assert.equal(video.embedProductId, "7391827491028374912");
  assert.equal(video.title, null, "jawaban 16 Nov 2026 tidak lagi memuat judul");
  assert.equal(video.authorName, null);
  const profile = parseTikTokOEmbed(oembed.profile.requestUrl, oembed.profile.status, oembed.profile.body);
  assert.equal(profile.available, false);
  assert.throws(() => tiktokOEmbedUrl("https://www.tiktok.com/@mambruk_official"), /URL video/);
});

test("langkah sosmed tanpa kunci dan belum ada sinkron Ekstensi Chrome: dilewati dalam bahasa awam bersih tanpa nama env var", () => {
  const outcome = socialStepOutcome({
    attempted: 0,
    totalDiscovered: 0,
    newPosts: 0,
    blocked: [],
    failures: [],
    skippedReason: "Belum ada data media sosial yang disinkronkan lewat Ekstensi Chrome.",
    sources: socialSourceStatuses({}, { tiktokVideos: 1, extensionSync: { instagramPosts: 0, tiktokPosts: 0, totalPosts: 0, trackedAccounts: 0, latestSyncedAt: null, latestRunStatus: null, activeSyncRunning: false } }),
    tiktok: { checked: 1, available: 1, unavailable: [], failures: [] },
  });
  assert.equal(outcome.status, "dilewati");
  assert.match(outcome.detail ?? "", /Ekstensi Chrome/);
  assert.match(outcome.detail ?? "", /TikTok: 1 dari 1 video tercatat masih tersedia/);
  assert.doesNotMatch(outcome.detail ?? "", /INSTAGRAM_GRAPH_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID|Perlu login ulang di Chrome/);
  assert.doesNotMatch(outcome.issue ?? "", /INSTAGRAM_GRAPH_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID|Perlu login ulang di Chrome/);
});

test("langkah sosmed dengan data Ekstensi Chrome di DB lokal (tanpa Graph API): status berhasil dengan ringkasan fakta nyata DB", () => {
  const extSync = {
    instagramPosts: 6988,
    tiktokPosts: 404,
    totalPosts: 7392,
    trackedAccounts: 18,
    latestSyncedAt: "2026-11-25T03:10:00.000Z",
    latestRunStatus: "success" as const,
    activeSyncRunning: false,
  };
  const sources = socialSourceStatuses({ SOCIAL_RESEARCH_SESSION: "needs_login" }, { tiktokVideos: 10, extensionSync: extSync });
  assert.equal(sources[0].state, "siap");
  assert.deepEqual(sources[0].missingEnvKeys, []);
  assert.doesNotMatch(sources[0].detail, /INSTAGRAM_GRAPH_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID|Perlu login ulang di Chrome/);

  const outcome = socialStepOutcome({
    attempted: 0,
    totalDiscovered: 0,
    newPosts: 0,
    blocked: [],
    failures: [],
    sources,
    tiktok: { checked: 10, available: 10, unavailable: [], failures: [] },
    extensionSync: extSync,
  });
  assert.equal(outcome.status, "berhasil");
  assert.equal(outcome.issue, null);
  assert.match(outcome.detail, /Disinkronkan lewat Ekstensi Chrome:/);
  assert.match(outcome.detail, /6\.988 postingan Instagram & 404 postingan TikTok dari 18 akun terpantau di basis data/);
  assert.match(outcome.detail, /TikTok: 10 dari 10 video tercatat masih tersedia/);
  assert.doesNotMatch(outcome.detail, /INSTAGRAM_GRAPH_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID|Perlu login ulang di Chrome/);

  // Sinkronisasi ekstensi yang masih aktif berjalan tetap berhasil dan mencantumkan keterangan status aktif
  const runningOutcome = socialStepOutcome({
    attempted: 0,
    totalDiscovered: 0,
    newPosts: 0,
    blocked: [],
    failures: [],
    sources,
    tiktok: null,
    extensionSync: { ...extSync, latestRunStatus: "running", activeSyncRunning: true },
  });
  assert.equal(runningOutcome.status, "berhasil");
  assert.match(runningOutcome.detail, /sinkronisasi aktif sedang berjalan/);
  assert.doesNotMatch(runningOutcome.detail, /INSTAGRAM_GRAPH_ACCESS_TOKEN|INSTAGRAM_BUSINESS_ACCOUNT_ID|Perlu login ulang di Chrome/);
});

test("oEmbed TikTok membedakan /video/ vs /photo/ (termasuk handle bertanda hubung) dan 3 berkas server sosmed bebas URL konten statis", () => {
  assert.equal(isTikTokVideoUrl("https://www.tiktok.com/@sunset-grill.anyer/video/7412345678901234567"), true);
  assert.equal(isTikTokVideoUrl("https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698"), false);
  assert.equal(isTikTokPhotoUrl("https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698"), true);
  assert.equal(isTikTokPhotoUrl("https://www.tiktok.com/@sanghyangsparesort/video/7703084124281703698"), false);

  const serverFiles = [
    "src/lib/market/scrape-social-buzz.ts",
    "src/lib/market/social-sources.ts",
    "src/lib/market/adapters/tiktok-oembed.ts",
  ];
  for (const rel of serverFiles) {
    const src = readFileSync(path.resolve(process.cwd(), rel), "utf8");
    assert.doesNotMatch(
      src,
      /https?:\/\/(?:www\.)?(?:instagram\.com\/(?:[^/\s"']+\/)?(?:p|reel)\/[A-Za-z0-9_-]+|tiktok\.com\/@[^/\s"']+\/(?:video|photo)\/\d+)/i,
      `${rel} dilarang menanam URL postingan/konten statis`,
    );
  }
});
