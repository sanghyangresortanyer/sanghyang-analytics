import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countVerdicts,
  crashedOutcome,
  describeCounts,
  heartbeatSummary,
  isSkippedRun,
  macroOutcome,
  newsOutcome,
  promoStatusOutcome,
  ratesOutcome,
  ratingsOutcome,
  refreshFailed,
  refreshHeadline,
  refreshMarkdownSummary,
  reviewsOutcome,
  runStatusFor,
  SKIP_PREFIX,
  socialOutcome,
  taggingOutcome,
  verdictFromCounts,
  websiteOutcome,
  withExtraFailure,
  type StepRecord,
} from "../../src/lib/market/refresh-outcome";
import { REFRESH_STEPS } from "../../src/lib/market/refresh-progress";
import { instagramCollectionStatus } from "../../src/lib/market/scrape-social-buzz";
import { syncBpsTpk } from "../../src/lib/market/bps-tpk";

// Nama tempat dan angka di bawah berasal dari DB lokal (registri Competitor dan ScrapeRun 14 Nov 2026).
const MAMBRUK = "Mambruk Hotel & Convention";
const JAYAKARTA = "The Jayakarta Villas Anyer Beach Resort";

test("tanpa masukan berarti dilewati; gagal total berarti gagal", () => {
  assert.equal(verdictFromCounts(0, 0), "dilewati");
  assert.equal(verdictFromCounts(16, 0), "berhasil");
  assert.equal(verdictFromCounts(14, 2), "sebagian");
  assert.equal(verdictFromCounts(0, 2), "gagal");
});

test("berita: run gagal ditandai gagal dan dicatat sebagai kendala", () => {
  assert.equal(newsOutcome("success").status, "berhasil");
  assert.equal(newsOutcome("success").issue, null);
  const partial = newsOutcome("partial");
  assert.equal(partial.status, "sebagian");
  assert.ok(partial.issue);
  const failed = newsOutcome("failed");
  assert.equal(failed.status, "gagal");
  assert.match(failed.issue ?? "", /berita/);
});

test("tarif yang gagal untuk semua hotel ditandai gagal, bukan hijau", () => {
  const failures = [`${MAMBRUK} (2026-11-16): harga tidak tampil di Google Hotels`, `${JAYAKARTA} (2026-11-16): fetch failed`];
  const all = ratesOutcome({ saved: 0, failures });
  assert.equal(all.status, "gagal");
  assert.match(all.issue ?? "", /Mambruk/);
  assert.equal(ratesOutcome({ saved: 14, failures: failures.slice(0, 1) }).status, "sebagian");
  assert.equal(ratesOutcome({ saved: 16, failures: [] }).status, "berhasil");
  const none = ratesOutcome({ saved: 0, failures: [] });
  assert.equal(none.status, "dilewati");
  assert.doesNotMatch(none.detail, /^0 tarif/);
});

test("ulasan: semua properti gagal berarti gagal; tanpa target berarti dilewati", () => {
  const failures = [`${MAMBRUK}: Timed out after waiting 60000ms`, `${JAYAKARTA}: Timed out after waiting 60000ms`];
  assert.equal(reviewsOutcome({ attempted: 2, totalInserted: 0, failures }).status, "gagal");
  assert.equal(reviewsOutcome({ attempted: 12, totalInserted: 0, failures: failures.slice(0, 1) }).status, "sebagian");
  assert.equal(reviewsOutcome({ attempted: 12, totalInserted: 0, failures: [] }).status, "berhasil");
  assert.equal(reviewsOutcome({ attempted: 0, totalInserted: 0, failures: [] }).status, "dilewati");
});

test("sosmed tanpa akses resmi Instagram dilewati beserta alasannya", () => {
  const reason = instagramCollectionStatus({}).reason;
  const skipped = socialOutcome({ attempted: 0, newPosts: 0, blocked: [], failures: [], skippedReason: reason });
  assert.equal(skipped.status, "dilewati");
  assert.match(skipped.detail, /Instagram/);
  assert.equal(skipped.issue, `sosmed dilewati: ${reason}`);
  const blocked = socialOutcome({ attempted: 2, newPosts: 0, blocked: [MAMBRUK, JAYAKARTA], failures: [] });
  assert.equal(blocked.status, "gagal", "semua akun meminta login = tidak ada data yang terbaca");
  const unread = socialOutcome({ attempted: 2, newPosts: 3, blocked: [], failures: [], readFailures: [`${MAMBRUK}: jawaban Gemini tidak valid`] });
  assert.equal(unread.status, "sebagian");
  assert.doesNotMatch(unread.detail, /Gemini/);
});

test("status promo tanpa masukan dilewati, bukan 'berhasil 0 dari 0'", () => {
  const idle = promoStatusOutcome({ received: 0, totalSynced: 0, activeCount: 0, expiredCount: 0 });
  assert.equal(idle.status, "dilewati");
  assert.doesNotMatch(idle.detail, /0 dari 0|0 promo aktif/);
  const expired = promoStatusOutcome({ received: 0, totalSynced: 0, activeCount: 0, expiredCount: 3 });
  assert.equal(expired.status, "berhasil");
  assert.match(expired.detail, /3 promo/);
  assert.equal(promoStatusOutcome({ received: 2, totalSynced: 0, activeCount: 0, expiredCount: 0 }).status, "gagal");
});

test("situs: terbaca tanpa promo baru tetap berhasil; satu situs gagal bukan gagal total", () => {
  // ScrapeRun website 14 Nov 2026: 6 situs dibaca, 0 promo baru, tanpa kendala.
  assert.equal(websiteOutcome({ sites: 6, saved: 0, siteFailures: [], ownFailure: null }).status, "berhasil");
  const one = websiteOutcome({ sites: 6, saved: 0, siteFailures: [`${MAMBRUK}: situs melarang perayap di robots.txt`], ownFailure: null });
  assert.equal(one.status, "sebagian", "dulu tertulis gagal karena belum ada promo baru");
  const all = websiteOutcome({ sites: 2, saved: 0, siteFailures: [`${MAMBRUK}: net::ERR_NAME_NOT_RESOLVED`, `${JAYAKARTA}: Timed out after waiting 30000ms`], ownFailure: "fetch failed" });
  assert.equal(all.status, "gagal");
  assert.equal(websiteOutcome({ sites: 0, saved: 0, siteFailures: [], ownFailure: null }).status, "dilewati");
});

test("rating, penandaan, dan TPK: gagal total, dilewati, dan nama mesin AI tidak tampil", async () => {
  assert.equal(ratingsOutcome({ updated: [], failures: ["resort: rating tidak terbaca di listing"], reviewsInserted: 0 }).status, "gagal");
  assert.equal(ratingsOutcome({ updated: [], failures: [], reviewsInserted: 0 }).status, "dilewati");
  const tagIdle = taggingOutcome({ attempted: 0, checked: 0, tagged: 0, failures: [] });
  assert.equal(tagIdle.status, "dilewati");
  const tagFailed = taggingOutcome({ attempted: 40, checked: 0, tagged: 0, failures: ["jawaban Gemini tidak valid"] });
  assert.equal(tagFailed.status, "gagal");
  assert.equal(taggingOutcome({ attempted: 40, checked: 30, tagged: 5, failures: [] }).status, "sebagian", "ulasan yang tidak dijawab belum selesai");
  assert.doesNotMatch(`${tagIdle.detail} ${tagFailed.detail}`, /Gemini/);

  const noKey = macroOutcome(await syncBpsTpk({}));
  assert.equal(noKey.status, "dilewati");
  assert.match(noKey.issue ?? "", /BPS_WEBAPI_KEY/);
  assert.equal(macroOutcome({ saved: 0, listed: 3 }).status, "gagal", "rilis ada tetapi judulnya tidak dikenali");
  assert.equal(macroOutcome({ saved: 0, listed: 0 }).status, "dilewati");
  assert.equal(macroOutcome({ saved: 2, listed: 2 }).status, "berhasil");
});

test("kegagalan tambahan menurunkan status, dan galat tak terduga menjadi gagal", () => {
  const ok = ratingsOutcome({ updated: ["resort 4.4"], failures: [], reviewsInserted: 0 });
  assert.equal(withExtraFailure(ok, "Potret bulanan belum tersimpan.", "potret bulanan gagal").status, "sebagian");
  assert.equal(withExtraFailure(taggingOutcome({ attempted: 0, checked: 0, tagged: 0, failures: [] }), "Potret bulanan belum tersimpan.", "potret bulanan gagal").status, "gagal");
  const crash = crashedOutcome("Tarif Google Hotels tidak dapat dibaca.", new Error("connect ECONNREFUSED 127.0.0.1:8000"));
  assert.equal(crash.status, "gagal");
  assert.match(crash.issue ?? "", /ECONNREFUSED/);
  assert.doesNotMatch(crash.detail, /ECONNREFUSED/, "pesan teknis tidak tampil ke tim pemasaran");
});

const stepsOf = (statuses: Partial<Record<StepRecord["key"], StepRecord["status"]>>): StepRecord[] =>
  REFRESH_STEPS.map((s) => ({ key: s.key, label: s.label, status: statuses[s.key] ?? "berhasil", detail: `${s.label} selesai.` }));

test("ringkasan akhir menghitung berhasil, sebagian, gagal, dan dilewati dengan benar", () => {
  // Uji tombol 14 Nov 2026: 7 berhasil, 2 dilewati (Instagram belum tersambung, kunci BPS kosong).
  const steps = stepsOf({ sosmed: "dilewati", makro: "dilewati" });
  assert.equal(describeCounts(countVerdicts(steps)), "7 berhasil, 0 sebagian, 0 gagal, 2 dilewati");
  assert.equal(refreshFailed(steps), false);
  assert.equal(refreshHeadline({ finishedAt: "2026-11-14T02:46:44.322Z", steps }), "Pembaruan selesai");

  const broken = stepsOf({ tarif: "gagal", ulasan: "sebagian", sosmed: "dilewati" });
  assert.equal(describeCounts(countVerdicts(broken)), "6 berhasil, 1 sebagian, 1 gagal, 1 dilewati");
  assert.equal(refreshFailed(broken), true);
  assert.match(refreshHeadline({ finishedAt: "2026-11-14T02:46:44.322Z", steps: broken }), /gagal/);
  assert.match(refreshHeadline({ finishedAt: "2026-11-14T02:46:44.322Z", steps: stepsOf({ ulasan: "sebagian" }) }), /sebagian/);
  assert.equal(refreshHeadline({ finishedAt: null, steps }), "Pembaruan sedang berjalan");
});

test("heartbeat menyebut hitungan langkah dan alasan yang dilewati, tanpa nama mesin AI", () => {
  const steps = stepsOf({ sosmed: "dilewati", makro: "dilewati" });
  const text = heartbeatSummary({
    origin: "lokal",
    finishedAt: new Date("2026-11-14T02:46:44.322Z"),
    steps,
    stats: { ratesCount: 16, reviewsInserted: 0, reviewsSkipped: 77, socialPostsFound: 0, socialNewPosts: 0 },
  });
  assert.match(text, /^Pembaruan dari komputer lokal selesai pada .+ WIB: 7 berhasil, 0 sebagian, 0 gagal, 2 dilewati\./);
  assert.match(text, /\[Dilewati\] Postingan media sosial kompetitor/);
  assert.match(text, /16 tarif kamar/);
  assert.doesNotMatch(text, /Gemini|success|Semua langkah berhasil|0 dari 0/);
  const allOk = heartbeatSummary({ origin: "github", finishedAt: new Date("2026-11-14T02:46:44.322Z"), steps: stepsOf({}), stats: { ratesCount: 16, reviewsInserted: 0, reviewsSkipped: 77, socialPostsFound: 0, socialNewPosts: 0 } });
  assert.match(allOk, /Semua langkah berhasil\.$/);
});

test("ringkasan job GitHub berupa tabel per langkah dengan isi yang aman", () => {
  const steps = stepsOf({ tarif: "gagal" });
  steps[1].detail = "0 tarif | 4 belum terbaca.";
  const md = refreshMarkdownSummary(steps);
  assert.match(md, /8 berhasil, 0 sebagian, 1 gagal, 0 dilewati/);
  assert.doesNotMatch(md, /Gemini/, "label langkah tidak menyebut nama mesin AI");
  assert.match(md, /\| Tarif kamar kompetitor 14 malam & sarapan \(Google Hotels\) \| Gagal \| 0 tarif \\\| 4 belum terbaca\. \|/);
});

test("run yang hanya berisi catatan dilewati dikenali sebagai dilewati", () => {
  assert.equal(runStatusFor("dilewati"), "partial");
  assert.equal(runStatusFor("gagal"), "failed");
  assert.equal(isSkippedRun([`${SKIP_PREFIX} ${instagramCollectionStatus({}).reason}`]), true);
  assert.equal(isSkippedRun([]), false);
  assert.equal(isSkippedRun([`${SKIP_PREFIX} x`, `Sosmed gagal untuk ${MAMBRUK}: fetch failed`]), false);
});
