import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import {
  CRAWLED_POSTS,
  FOLLOWERS,
  OFFICIAL_SOCIAL_ACCOUNTS,
  captionScore,
  parseStoredSocialPost,
} from "../../src/lib/market/marketing-sosmed";
import {
  accountsForOutlet,
  groupPostsByOutlet,
  latestFollowersByAccount,
  postsForOutlet,
  sosmedStats,
  summarizeSocialAccountCoverage,
} from "../../src/lib/market/marketing-sosmed-outlets";
import { OWN_SOCIAL_POST_CATEGORY } from "../../src/lib/market/promo-radar";
import { OUTLET_KEYS } from "../../src/lib/market/outlet-filters";

after(() => db.$disconnect());

/** Postingan akun resmi yang tersimpan dari sinkron ekstensi dan isian tim (DB lokal), digabung dengan crawl 10 Nov. */
async function storedOwnPosts() {
  const rows = await db.competitorPromotion.findMany({
    where: { category: OWN_SOCIAL_POST_CATEGORY },
    select: { id: true, title: true, description: true, startsAt: true, source: true, sourceUrl: true, createdAt: true, capturedAt: true },
  });
  return { rows, posts: rows.map(parseStoredSocialPost).filter((p): p is NonNullable<typeof p> => p !== null) };
}

// Angka harapan dihitung terpisah dari marketing-sosmed.data.json (crawl Instagram 10 Nov 2026): 47 postingan dari
// 5 akun, 551 likes publik; akun induk dibagi ke outlet menurut keterangannya.
const DSPA_PROMO_INDUK = "https://www.instagram.com/sanghyangresort/p/DfYxoUkPW4k/";

test("postingan disaring per outlet: akun outlet ditambah postingan akun induk yang membahas outlet itu", () => {
  const dspa = postsForOutlet(CRAWLED_POSTS, "dspa");
  assert.equal(dspa.length, 13);
  assert.ok(dspa.every((p) => p.outletKey === "dspa"));
  assert.equal(dspa.filter((p) => p.account === "dspasanghyang").length, 12);
  assert.ok(dspa.some((p) => p.postUrl === DSPA_PROMO_INDUK), "promo d’Spa dari akun induk ikut tampil");
  assert.equal(postsForOutlet(CRAWLED_POSTS, "dbar").length, 0);
  assert.equal(postsForOutlet(CRAWLED_POSTS, "all").length, 47);
});

test("Semua Outlet dikelompokkan per unit bisnis dalam urutan pemilih, outlet tanpa postingan tetap terlihat", () => {
  assert.deepEqual(
    groupPostsByOutlet(CRAWLED_POSTS).map((g) => [g.outlet, g.posts.length]),
    [["sunset-grill", 10], ["dragon-beach-club", 11], ["resort", 9], ["dbistro", 4], ["dbar", 0], ["dspa", 13]],
  );
});

test("akun resmi per outlet: akun Dragon Beach Club & d'Bar dipakai bersama, kanal akun induk milik Kamar & Resort", () => {
  const labels = (outlet: Parameters<typeof accountsForOutlet>[0]) => accountsForOutlet(outlet).map((a) => `${a.platform}:${a.label}`);
  assert.deepEqual(labels("dbar"), ["instagram:@dragonbeachclub"]);
  assert.deepEqual(labels("sunset-grill"), ["instagram:@sunsetgrillsanghyang", "tiktok:@sunsetgrill.sanghyang"]);
  assert.deepEqual(labels("dspa"), ["instagram:@dspasanghyang"]);
  for (const own of ["instagram:@sanghyangresort", "facebook:SanghyangIndahSpa", "whatsapp:0811-9011-600 (reservasi)"]) {
    assert.ok(labels("resort").includes(own), own);
  }
  assert.equal(accountsForOutlet("all").length, OFFICIAL_SOCIAL_ACCOUNTS.length);
  for (const a of OFFICIAL_SOCIAL_ACCOUNTS) assert.ok(a.outlets.length > 0, `${a.label} terhubung ke unit bisnis`);
});

test("ringkasan angka per outlet memakai likes publik hasil crawl, bukan nol, dan data kosong ditulis null", () => {
  const all = sosmedStats(CRAWLED_POSTS, "all");
  assert.equal(all.posts, 47);
  assert.equal(all.instagramAccounts, 5);
  // Crawl 10 Nov tidak punya angka profil akun aktif @sunsetgrillsanghyang (tidak boleh meminjam 164 dari akun lama @sunset_grillsanghyang).
  assert.equal(all.followers, 7818 + 5124 + 218 + 413);
  assert.deepEqual(all.likes, { total: 551, counted: 47, average: 12 });
  assert.equal(all.waLeads, null, "chat WA belum diisi tim: belum ada data, bukan 0");

  const dspa = sosmedStats(postsForOutlet(CRAWLED_POSTS, "dspa"), "dspa");
  assert.equal(dspa.instagramAccounts, 1);
  assert.equal(dspa.followers, 413);
  assert.deepEqual(dspa.likes, { total: 50, counted: 13, average: 4 });

  const dbar = sosmedStats(postsForOutlet(CRAWLED_POSTS, "dbar"), "dbar");
  assert.equal(dbar.posts, 0);
  assert.equal(dbar.likes, null);
  assert.equal(dbar.caption, null);
});

test("skor mutu caption memakai bobot di rumus yang ditampilkan (Hook 35%, Copy 35%, CTA 30%), bukan skor hook saja", () => {
  // Promo d’Spa akun induk: hook 80 (promo, spesial), copy 75 (ada "30%", tanpa kata manfaat), CTA 88 ("Booking now").
  const post = CRAWLED_POSTS.find((p) => p.postUrl === DSPA_PROMO_INDUK);
  assert.ok(post);
  assert.deepEqual([post.audit.hookScore, post.audit.copyScore, post.audit.ctaScore], [80, 75, 88]);
  assert.equal(captionScore(post.audit), 81, "0,35×80 + 0,35×75 + 0,30×88 = 80,65");
  assert.deepEqual(sosmedStats([post], "dspa").caption, { hook: 80, copy: 75, cta: 88, score: 81 });
});

test("SosmedStats memisahkan metrik Instagram dan TikTok berdampingan untuk setiap outlet", () => {
  const all = sosmedStats(CRAWLED_POSTS, "all");
  assert.equal(all.instagram.accounts, 5);
  assert.equal(all.instagram.posts, 47);
  assert.equal(all.instagram.followers, 7818 + 5124 + 218 + 413);
  assert.deepEqual(all.instagram.likes, { total: 551, counted: 47, average: 12 });
  assert.equal(all.tiktok.accounts, 3); // sanghyangsparesort, sunsetgrill.sanghyang, dragonbeachclub

  const sunset = sosmedStats(postsForOutlet(CRAWLED_POSTS, "sunset-grill"), "sunset-grill");
  assert.equal(sunset.instagram.accounts, 1);
  assert.equal(sunset.instagram.followers, null, "akun aktif @sunsetgrillsanghyang tidak boleh meminjam pengikut 164 akun lama @sunset_grillsanghyang");
  assert.equal(sunset.tiktok.accounts, 1);

  // Crawl 10 Nov hanya membaca profil Instagram: akun TikTok @dragonbeachclub tidak boleh meminjam pengikut Instagram bernama sama.
  assert.equal(all.tiktok.followers, null);

  const dbistro = sosmedStats(postsForOutlet(CRAWLED_POSTS, "dbistro"), "dbistro");
  assert.equal(dbistro.instagram.accounts, 1);
  assert.equal(dbistro.tiktok.accounts, 0);
  assert.equal(dbistro.tiktok.followers, null);
  assert.equal(dbistro.tiktok.posts, 0);
  assert.equal(dbistro.tiktok.likes, null);
});

test("pengikut akun resmi memakai pengamatan sinkron terbaru di DB; akun tanpa pengamatan memakai crawl profil 10 Nov", async () => {
  const { rows, posts } = await storedOwnPosts();
  assert.ok(rows.length > 0, "DB lokal memuat postingan akun resmi hasil sinkron");
  assert.equal(posts.length, rows.length, "setiap baris bertautan asli terurai menjadi postingan");

  // Hitung ulang terpisah dari baris DB: angka pengikut di baris dengan capturedAt paling baru per platform dan akun.
  const expected = new Map<string, { followers: number; at: number }>();
  for (const r of rows) {
    const meta = JSON.parse(r.description ?? "{}") as { account?: unknown; followers?: unknown; platform?: unknown };
    if (typeof meta.account !== "string" || typeof meta.followers !== "number") continue;
    const key = `${meta.platform === "tiktok" ? "tiktok" : "instagram"}:${meta.account}`;
    const prev = expected.get(key);
    if (!prev || r.capturedAt.getTime() > prev.at) expected.set(key, { followers: meta.followers, at: r.capturedAt.getTime() });
  }
  assert.ok(expected.size > 0, "minimal satu akun punya angka pengikut hasil sinkron");

  const followers = latestFollowersByAccount(posts);
  for (const acc of OFFICIAL_SOCIAL_ACCOUNTS.filter((a) => a.platform === "instagram" || a.platform === "tiktok")) {
    const handle = acc.label.replace(/^@/, "");
    const key = `${acc.platform}:${handle}`;
    const crawl = acc.platform === "instagram" ? FOLLOWERS[handle] ?? null : null;
    assert.equal(followers[key], expected.get(key)?.followers ?? crawl, `pengikut ${acc.platform} ${acc.label}`);
  }

  const resort = sosmedStats(postsForOutlet(posts, "resort"), "resort", followers);
  assert.equal(resort.instagram.followers, expected.get("instagram:sanghyangresort")?.followers ?? FOLLOWERS.sanghyangresort);
  // Akun bersama @dragonbeachclub juga melayani D'Bar walau postingannya dicatat di Dragon Beach Club.
  const dbar = sosmedStats(postsForOutlet(posts, "dbar"), "dbar", followers);
  assert.equal(dbar.instagram.followers, followers["instagram:dragonbeachclub"]);
  // Instagram dan TikTok @dragonbeachclub adalah dua akun berbeda; TikTok belum pernah terbaca.
  const dbc = sosmedStats(postsForOutlet(posts, "dragon-beach-club"), "dragon-beach-club", followers);
  assert.equal(dbc.tiktok.followers, expected.get("tiktok:dragonbeachclub")?.followers ?? null);
  // Pengikut akun lama @sunset_grillsanghyang tidak boleh tercampur ke akun resmi aktif @sunsetgrillsanghyang.
  assert.equal(
    followers["instagram:sunsetgrillsanghyang"],
    expected.get("instagram:sunsetgrillsanghyang")?.followers ?? null,
    "pengikut @sunsetgrillsanghyang tidak boleh mewarisi angka akun lama @sunset_grillsanghyang",
  );
});

test("GET /api/marketing-sosmed mengirim pengikut sinkron terbaru dan tanggal WIB ke halaman Media Sosial", async () => {
  const { createMarketingSosmedHandlers } = await import("../../src/app/api/marketing-sosmed/route");
  const { GET } = createMarketingSosmedHandlers(async () => null);
  const { wibDay } = await import("../../src/lib/market/date-range");
  const { latestCapturePerPost } = await import("../../src/lib/market/marketing-sosmed");
  // Ambil snapshot DB SEBELUM GET() agar sisipan baru dari sinkron Chrome yang sedang berjalan tidak memicu race.
  const { rows: beforeRows, posts: beforePosts } = await storedOwnPosts();
  const res = await GET();
  assert.equal(res.status, 200);
  const json = (await res.json()) as {
    posts: { postUrl: string; postedAt: string; account?: string; followers?: number | null; followersObservedAt?: string | null }[];
  };
  // Satu postingan bisa tersimpan sekali per tangkapan sinkron; halaman hanya menerima tangkapan terbaru per tautan.
  assert.equal(new Set(json.posts.map((p) => p.postUrl)).size, json.posts.length, "tidak ada kartu ganda untuk tautan yang sama");
  const byUrl = new Map(json.posts.map((p) => [p.postUrl, p]));
  let withFollowers = 0;
  for (const r of latestCapturePerPost(beforeRows)) {
    const post = byUrl.get(r.sourceUrl as string);
    assert.ok(post, `postingan ${r.sourceUrl} terkirim`);
    assert.equal(post.postedAt, wibDay(r.startsAt), "tanggal tayang menurut kalender WIB");
    const meta = JSON.parse(r.description ?? "{}") as { followers?: unknown };
    if (typeof meta.followers === "number") {
      withFollowers++;
      if (post.followersObservedAt === r.capturedAt.toISOString()) {
        assert.equal(post.followers, meta.followers);
      } else {
        assert.equal(typeof post.followers, "number");
        assert.ok((post.followersObservedAt ?? "") >= r.capturedAt.toISOString());
      }
    }
  }
  assert.ok(withFollowers > 0, "DB lokal memuat postingan sinkron dengan angka pengikut");
  // Bandingkan pengikut terbaru pada irisan URL konsisten dari snapshot awal.
  const beforeUrlSet = new Set(beforeRows.map((r) => r.sourceUrl).filter((u): u is string => Boolean(u)));
  const apiFollowers = latestFollowersByAccount(
    json.posts.filter((p) => beforeUrlSet.has(p.postUrl)) as Parameters<typeof latestFollowersByAccount>[0],
  );
  assert.equal(apiFollowers["instagram:sanghyangresort"], latestFollowersByAccount(beforePosts)["instagram:sanghyangresort"]);
});

test("summarizeSocialAccountCoverage menghitung postingan kolaborasi eksternal dan kolaborasi internal ke akun resmi yang tepat", () => {
  const samplePosts = [
    {
      ...CRAWLED_POSTS[0],
      id: "ext-collab-1",
      outletKey: "sunset-grill" as const,
      platform: "instagram" as const,
      postType: "feed" as const,
      postedAt: "2026-11-22",
      postUrl: "https://www.instagram.com/dj_external_anyer/p/ExtCollab99/",
      account: "sunsetgrillsanghyang",
      followers: 11200,
      followersObservedAt: "2026-11-24T12:00:00.000Z",
      profilePostsTotal: 619,
    },
    {
      ...CRAWLED_POSTS[0],
      id: "int-collab-2",
      outletKey: "sunset-grill" as const,
      platform: "instagram" as const,
      postType: "reels" as const,
      postedAt: "2026-11-23",
      postUrl: "https://www.instagram.com/sunsetgrillsanghyang/reel/IntCollab88/",
      account: "sunsetgrillsanghyang",
      collabAccounts: ["sanghyangresort"],
      followers: 11250,
      followersObservedAt: "2026-11-24T13:00:00.000Z",
      profilePostsTotal: 619,
    },
  ];

  const cov = summarizeSocialAccountCoverage(samplePosts, OFFICIAL_SOCIAL_ACCOUNTS);
  assert.equal(cov["instagram:sunsetgrillsanghyang"].syncedPosts, 2);
  assert.equal(cov["instagram:sunsetgrillsanghyang"].followers, 11250);
  assert.equal(cov["instagram:sunsetgrillsanghyang"].profilePostsTotal, 619);
  assert.equal(cov["instagram:sunsetgrillsanghyang"].latestPostAt, "2026-11-23");
  assert.equal(cov["instagram:dj_external_anyer"], undefined, "handle kolaborator eksternal tidak boleh mengambil alih hitungan");
  assert.equal(cov["instagram:sanghyangresort"].syncedPosts, 1, "kolaborasi internal tetap terhitung di cakupan akun induk");
  assert.equal(cov["instagram:sanghyangresort"].followers, null, "followers akun outlet tidak boleh meracuni akun induk");
  assert.equal(cov["instagram:sanghyangresort"].profilePostsTotal, null, "profilePostsTotal akun outlet tidak boleh meracuni akun induk");
});
