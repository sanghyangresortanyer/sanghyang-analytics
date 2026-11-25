import { after, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createMarketingSosmedHandlers, GET as GET_UNAUTH } from "../../src/app/api/marketing-sosmed/route";
import { db } from "../../src/lib/db";
import crawledSosmed from "../../src/lib/market/marketing-sosmed.data.json";

const { GET, POST } = createMarketingSosmedHandlers(async () => null);

after(() => db.$disconnect());

test("D10: GET /api/marketing-sosmed menolak tanpa login (401) dan mengembalikan daftar postingan saat berwenang", async () => {
  const unauth = await GET_UNAUTH();
  assert.equal(unauth.status, 401);

  const res = await GET();
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.success, true);
  assert.ok(Array.isArray(json.posts), "Harus memuat array posts");
  assert.ok(json.posts.length > 0, "Harus memuat postingan terindeks");
  assert.ok(Array.isArray(json.accounts), "Harus memuat info akun resmi");
});

test("D10: POST /api/marketing-sosmed menyimpan postingan tayang dengan OCC version ke DB", async () => {
  const uniqueUrl = `https://instagram.com/p/test-d10-${Date.now()}`;
  const testPayload = {
    outletKey: "sunset-grill",
    platform: "instagram",
    postType: "reels",
    postedAt: "2026-11-13",
    postUrl: uniqueUrl,
    caption: "Promo Spesial Sunset Seafood Dinner hemat diskon 20%! Hubungi WhatsApp reservasi sekarang.",
    metrics: {
      views: 1250,
      likes: 85,
      comments: 12,
      shares: 6,
      inquiriesWa: 4,
    },
  };

  // 1. Simpan postingan baru (OCC insert -> version 1)
  const req1 = new NextRequest("http://localhost:3001/api/marketing-sosmed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testPayload),
  });

  const res1 = await POST(req1);
  assert.equal(res1.status, 200);

  const json1 = await res1.json();
  assert.equal(json1.success, true);
  assert.equal(json1.version, 1, "Postingan baru harus ber-version 1");
  assert.equal(json1.post.outletKey, "sunset-grill");
  assert.equal(json1.post.postUrl, uniqueUrl);
  assert.ok(json1.post.audit, "Harus memiliki evaluasi skor transparan");
  assert.ok(json1.post.audit.hookScore > 70, "Hook score harus tinggi karena ada kata pemicu");

  // 2. Verifikasi langsung ke DB lokal
  const inDb = await db.competitorPromotion.findFirst({
    where: { sourceUrl: uniqueUrl },
  });
  assert.ok(inDb, "Baris harus ada di tabel competitorPromotion");
  assert.equal(inDb.category, "Postingan Sosmed Tayang");
  assert.equal(inDb.version, 1);

  // 3. Update postingan yang sama (OCC update -> version 2)
  const updatedPayload = {
    ...testPayload,
    caption: "Update Promo Sunset: Promo Spesial Sunset Seafood hemat diskon 25%! Reservasi link di bio sekarang.",
    metrics: {
      views: 2500,
      likes: 180,
      comments: 25,
      shares: 15,
      inquiriesWa: 9,
    },
  };

  const req2 = new NextRequest("http://localhost:3001/api/marketing-sosmed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updatedPayload),
  });

  const res2 = await POST(req2);
  assert.equal(res2.status, 200);

  const json2 = await res2.json();
  assert.equal(json2.success, true);
  assert.equal(json2.version, 2, "Update postingan harus menaikkan version menjadi 2");

  const inDbUpdated = await db.competitorPromotion.findFirst({
    where: { sourceUrl: uniqueUrl },
  });
  assert.ok(inDbUpdated);
  assert.equal(inDbUpdated.version, 2, "Version di DB lokal harus naik menjadi 2");

  // Cleanup data tes
  await db.competitorPromotion.deleteMany({
    where: { sourceUrl: uniqueUrl },
  });
});

// Keterangan asli postingan @dspasanghyang (crawl 10 Nov 2026), dipakai sebagai isi postingan uji.
const DSPA_CAPTION = (crawledSosmed as { posts: { url: string; caption: string }[] }).posts.find(
  (p) => p.url === "https://www.instagram.com/dspasanghyang/p/CvLyXDtPNeD/",
)!.caption;

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost:3001/api/marketing-sosmed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("postingan tim tersimpan di baris unit bisnis yang dipilih, bukan baris resort", async () => {
  const url = `https://www.instagram.com/p/uji-outlet-dspa-${Date.now()}/`;
  try {
    const res = await POST(postRequest({ outletKey: "dspa", platform: "instagram", postType: "feed", postedAt: "2026-11-13", postUrl: url, caption: DSPA_CAPTION }));
    assert.equal(res.status, 200);
    const row = await db.competitorPromotion.findFirst({ where: { sourceUrl: url }, select: { competitor: { select: { placeId: true } } } });
    assert.equal(row?.competitor.placeId, "dspa_sanghyang");
  } finally {
    await db.competitorPromotion.deleteMany({ where: { sourceUrl: url } });
  }
});

test("postingan tanpa tautan ditolak, bukan diberi tautan Instagram buatan", async () => {
  const before = await db.competitorPromotion.count({ where: { category: "Postingan Sosmed Tayang" } });
  const res = await POST(postRequest({ outletKey: "dspa", postedAt: "2026-11-13", caption: DSPA_CAPTION }));
  const json = await res.json();
  try {
    assert.equal(res.status, 400);
    assert.match(json.error ?? "", /Tautan postingan wajib diisi/);
  } finally {
    if (json.post?.id) await db.competitorPromotion.delete({ where: { id: json.post.id } });
  }
  assert.equal(await db.competitorPromotion.count({ where: { category: "Postingan Sosmed Tayang" } }), before);
});

test("baris postingan tanpa angka isian tim dikirim dengan metrics null, bukan nol buatan", async () => {
  const resort = await db.competitor.findFirst({ where: { placeId: "sanghyang" }, select: { id: true } });
  assert.ok(resort, "baris resort ada di DB lokal");
  const url = `https://www.instagram.com/p/uji-tanpa-angka-${Date.now()}/`;
  await db.competitorPromotion.create({
    data: {
      competitorId: resort.id,
      title: "[FEED] uji tanpa angka",
      category: "Postingan Sosmed Tayang",
      description: JSON.stringify({ outletKey: "resort", platform: "instagram", postType: "feed", caption: DSPA_CAPTION }),
      startsAt: new Date("2026-11-13T00:00:00Z"),
      source: "Instagram",
      sourceUrl: url,
      capturedAt: new Date(),
      status: "new",
    },
  });
  try {
    const json = await (await GET()).json();
    const post = json.posts.find((p: { postUrl: string }) => p.postUrl === url);
    assert.ok(post, "baris uji ikut terkirim");
    assert.equal(post.metrics, null);
  } finally {
    await db.competitorPromotion.deleteMany({ where: { sourceUrl: url } });
  }
});

test("tikTokPostedAtFromUrl memulihkan tanggal UTC dari Snowflake ID video/photo dan sanitizeBrowserSyncPayload memakainya saat postedAt kosong", async () => {
  const mod = await import("../../src/lib/market/browser-social-sync");
  const nowMs = Date.parse("2026-11-24T12:00:00.000Z");

  // Video nyata @sunsetgrill.sanghyang (8 Nov 2026): BigInt("7705662298588859700") >> BigInt(32) = 1794114201
  const videoDate = mod.tikTokPostedAtFromUrl(
    "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
    nowMs,
  );
  assert.ok(videoDate instanceof Date, "Snowflake ID video TikTok valid harus menghasilkan Date");
  assert.equal(videoDate.toISOString().slice(0, 10), "2026-11-08");
  assert.equal(Math.floor(videoDate.getTime() / 1000), Number(BigInt("7705662298588859700") >> BigInt(32)));

  // Carousel /photo/ nyata @dragonbeachclub: BigInt("7555358674382769419") >> BigInt(32) = 1759119257
  const photoDate = mod.tikTokPostedAtFromUrl(
    "https://www.tiktok.com/@dragonbeachclub/photo/7555358674382769419",
    nowMs,
  );
  assert.ok(photoDate instanceof Date, "Snowflake ID /photo/ TikTok valid harus menghasilkan Date");
  assert.equal(Math.floor(photoDate.getTime() / 1000), Number(BigInt("7555358674382769419") >> BigInt(32)));

  // ID pendek sintetis, masa depan, atau URL non-TikTok wajib ditolak (null)
  assert.equal(mod.tikTokPostedAtFromUrl("https://www.tiktok.com/@akun/video/741234567890", nowMs), null);
  assert.equal(mod.tikTokPostedAtFromUrl("https://www.instagram.com/p/DfTxAQ9hugH/", nowMs), null);
  const futureSnowflake = ((BigInt(Math.floor(nowMs / 1000) + 86400 * 30) << BigInt(32)) | BigInt(12345)).toString();
  assert.equal(mod.tikTokPostedAtFromUrl(`https://www.tiktok.com/@akun/video/${futureSnowflake}`, nowMs), null);

  // sanitizeBrowserSyncPayload memakai tanggal Snowflake ketika postedAt TikTok null (bukan jatuh ke now)
  const sanitized = mod.sanitizeBrowserSyncPayload(
    {
      posts: [
        {
          targetType: "own",
          outletKey: "sunset-grill",
          account: "sunsetgrill.sanghyang",
          platform: "tiktok",
          postType: "tiktok_video",
          sourceUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
          postedAt: null,
          caption: "Sunset vibes di Anyer",
          metrics: { views: 768, likes: 14, comments: 1, shares: 0 },
          comments: [],
        },
      ],
    },
    ["sunsetgrill.sanghyang"],
    new Date(nowMs),
  );
  assert.equal(sanitized.posts[0].postDateWritten, true, "tanggal Snowflake terverifikasi harus menandai postDateWritten=true");
  assert.equal(sanitized.posts[0].postedAt.toISOString().slice(0, 10), "2026-11-08");
});

test("isCompleteKnownSocialPost mengenali Reels/post IG sah tanpa views/caption, menolak TikTok video tanpa views/caption, dan menolak tanggal tidak valid", async () => {
  const mod = await import("../../src/lib/market/browser-social-sync");
  const nowMs = Date.parse("2026-11-24T12:00:00.000Z");
  const validStart = new Date("2026-11-08T04:23:21.000Z");
  const captured = new Date("2026-11-24T10:00:00.000Z");

  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
        description: JSON.stringify({ caption: "Sunset vibes", metrics: { views: 768, likes: 14 } }),
        source: "TikTok",
        startsAt: validStart,
        capturedAt: captured,
      },
      nowMs,
    ),
    true,
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
        description: JSON.stringify({ caption: "   ", metrics: { views: 768 } }),
        source: "TikTok",
        startsAt: validStart,
        capturedAt: captured,
      },
      nowMs,
    ),
    false,
    "video TikTok dengan caption kosong tidak boleh masuk knownPostUrls",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
        description: JSON.stringify({ caption: "Video TikTok tanpa views", metrics: { views: null, likes: 18 } }),
        source: "TikTok",
        startsAt: validStart,
        capturedAt: captured,
      },
      nowMs,
    ),
    false,
    "video TikTok tanpa views tidak boleh masuk knownPostUrls",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698",
        description: JSON.stringify({ postType: "carousel", caption: "", metrics: { views: null, likes: 38 } }),
        source: "TikTok",
        startsAt: validStart,
        capturedAt: captured,
        imageUrl: "https://p16-sign-sg.tiktokcdn.com/slide.jpeg",
      },
      nowMs,
    ),
    true,
    "TikTok /photo/ tanpa caption tetap masuk knownPostUrls bila memiliki tanggal sah dan metrik atau gambar",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.instagram.com/sanghyangresort/reel/DfeUWFsv-pk/",
        description: JSON.stringify({ caption: "Reels tanpa views", metrics: { views: null, likes: 10 } }),
        source: "Instagram",
        startsAt: validStart,
        capturedAt: captured,
      },
      nowMs,
    ),
    true,
    "reels Instagram dengan tanggal sah dan caption/likes tetap masuk knownPostUrls walau views null",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.instagram.com/astonanyer/p/CaptionKosongAdaGambar/",
        description: JSON.stringify({ caption: "", metrics: { views: null, likes: null } }),
        source: "Instagram",
        startsAt: validStart,
        capturedAt: captured,
        imageUrl: "https://scontent.cdninstagram.com/photo.jpg",
      },
      nowMs,
    ),
    true,
    "postingan Instagram tanpa caption tetap masuk knownPostUrls bila memiliki tanggal sah dan imageUrl HTTPS",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.instagram.com/astonanyer/p/KosongTotal/",
        description: JSON.stringify({ caption: "", metrics: { views: null, likes: null, comments: null, shares: null } }),
        source: "Instagram",
        startsAt: validStart,
        capturedAt: captured,
        imageUrl: null,
      },
      nowMs,
    ),
    false,
    "postingan Instagram tanpa caption, tanpa metrik, dan tanpa imageUrl tidak boleh masuk knownPostUrls",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.instagram.com/sanghyangresort/p/ValidCaption/",
        description: JSON.stringify({ caption: "Tanggal fallback", postDateWritten: false, metrics: { likes: 10 } }),
        source: "Instagram",
        startsAt: validStart,
        capturedAt: captured,
      },
      nowMs,
    ),
    false,
    "postDateWritten=false tidak boleh masuk knownPostUrls",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.instagram.com/sanghyangresort/p/FallbackNow/",
        description: JSON.stringify({ caption: "Tanggal sama dengan capturedAt", metrics: { likes: 10 } }),
        source: "Instagram",
        startsAt: new Date(captured.getTime() - 1000),
        capturedAt: captured,
      },
      nowMs,
    ),
    false,
    "startsAt yang jatuh ke waktu tangkap (<5 detik) dianggap belum punya tanggal tayang valid",
  );
  assert.equal(
    mod.isCompleteKnownSocialPost(
      {
        sourceUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
        description: JSON.stringify({ caption: "Tanggal sebelum era TikTok", metrics: { views: 100 } }),
        source: "TikTok",
        startsAt: new Date("2012-01-01T00:00:00.000Z"),
        capturedAt: captured,
      },
      nowMs,
    ),
    false,
    "tanggal TikTok sebelum 2016 tidak valid",
  );
});

test("persistBrowserSyncBatch tidak menduplikasi baris saat outletKey/competitorId bergeser dan mempertahankan OCC + inquiriesWa", async () => {
  const { persistBrowserSyncBatch, sanitizeBrowserSyncPayload } = await import("../../src/lib/market/browser-social-sync");
  const testUrl = `https://www.instagram.com/sanghyangresort/p/UjiDedupShift${Date.now()}/`;
  const createdRunIds: string[] = [];
  try {
    // 1. Simpan pertama sebagai resort (caption belum menyebut Sunset Grill)
    const p1 = sanitizeBrowserSyncPayload(
      {
        finalizeRun: true,
        posts: [
          {
            targetType: "own",
            outletKey: "resort",
            account: "sanghyangresort",
            platform: "instagram",
            postType: "feed",
            sourceUrl: testUrl,
            postedAt: "2026-11-18T08:00:00.000Z",
            caption: "Suasana sore santai di pantai Anyer.",
            metrics: { views: null, likes: 10, comments: 1, shares: null },
            comments: [],
          },
        ],
      },
      ["sanghyangresort"],
      new Date("2026-11-24T10:00:00.000Z"),
    );
    const res1 = await persistBrowserSyncBatch(p1);
    createdRunIds.push(res1.syncRunId);

    const row1 = await db.competitorPromotion.findFirst({ where: { sourceUrl: testUrl, category: "Postingan Sosmed Tayang" } });
    assert.ok(row1);
    const meta1 = JSON.parse(row1.description ?? "{}");
    // Staf mengisi leads WA
    await db.competitorPromotion.update({
      where: { id: row1.id },
      data: { description: JSON.stringify({ ...meta1, metrics: { ...meta1.metrics, inquiriesWa: 5 } }) },
    });

    // 2. Sinkron ulang URL yang sama tetapi kini terklasifikasi sebagai sunset-grill (competitorId bergeser!)
    const p2 = sanitizeBrowserSyncPayload(
      {
        finalizeRun: true,
        posts: [
          {
            targetType: "own",
            outletKey: "sunset-grill",
            account: "sunsetgrillsanghyang",
            platform: "instagram",
            postType: "feed",
            sourceUrl: testUrl,
            postedAt: "2026-11-18T08:00:00.000Z",
            caption: "Promo makan malam Sunset Grill tepi pantai Anyer.",
            metrics: { views: null, likes: 24, comments: 3, shares: 1 },
            comments: [],
          },
        ],
      },
      ["sunsetgrillsanghyang"],
      new Date("2026-11-24T11:00:00.000Z"),
    );
    const res2 = await persistBrowserSyncBatch(p2);
    createdRunIds.push(res2.syncRunId);

    const rowsAfter = await db.competitorPromotion.findMany({
      where: { sourceUrl: testUrl, category: "Postingan Sosmed Tayang" },
      include: { competitor: { select: { placeId: true } } },
    });
    assert.equal(rowsAfter.length, 1, "pergeseran competitorId wajib memperbarui baris lama, bukan membuat duplikat");
    assert.equal(rowsAfter[0].id, row1.id);
    assert.equal(rowsAfter[0].version, 2, "OCC version harus naik menjadi 2");
    assert.equal(rowsAfter[0].competitor.placeId, "sunset_grill_sanghyang");
    const meta2 = JSON.parse(rowsAfter[0].description ?? "{}");
    assert.equal(meta2.metrics.inquiriesWa, 5, "inquiriesWa staf wajib tetap utuh saat competitorId berpindah");
    assert.equal(meta2.metrics.likes, 24);
  } finally {
    await db.competitorPromotion.deleteMany({ where: { sourceUrl: testUrl } });
    if (createdRunIds.length > 0) {
      await db.scrapeError.deleteMany({ where: { runId: { in: createdRunIds } } });
      await db.scrapeRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
  }
});

test("DB lokal tidak memiliki baris duplikat sourceUrl pada kategori Postingan Sosmed Tayang", async () => {
  const rows = await db.competitorPromotion.findMany({
    where: { category: "Postingan Sosmed Tayang", sourceUrl: { not: null } },
    select: { sourceUrl: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.sourceUrl) continue;
    counts.set(r.sourceUrl, (counts.get(r.sourceUrl) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
  assert.equal(duplicates.length, 0, `ditemukan ${duplicates.length} sourceUrl duplikat di Postingan Sosmed Tayang`);
});

test("canonicalizeVerifiedSocialUrl & instagramShortcodeFromUrl menerima kolaborasi eksternal dan menolak path reserved", async () => {
  const mod = await import("../../src/lib/market/browser-social-sync");
  assert.equal(
    mod.canonicalizeVerifiedSocialUrl("https://www.instagram.com/DJ_External.Anyer/p/CxCollab01/?igsh=1", "instagram"),
    "https://www.instagram.com/dj_external.anyer/p/CxCollab01/",
  );
  assert.equal(
    mod.canonicalizeVerifiedSocialUrl("https://m.instagram.com/vendor_bandung/reels/CxCollab02/", "instagram"),
    "https://www.instagram.com/vendor_bandung/reel/CxCollab02/",
  );
  assert.equal(
    mod.canonicalizeVerifiedSocialUrl("https://instagram.com/p/CxCollab03", "instagram"),
    "https://www.instagram.com/p/CxCollab03/",
  );
  assert.throws(() => mod.canonicalizeVerifiedSocialUrl("https://www.instagram.com/explore/p/CxBad01/", "instagram"));
  assert.throws(() => mod.canonicalizeVerifiedSocialUrl("https://www.instagram.com/p/p/CxBad02/", "instagram"));

  assert.equal(mod.instagramShortcodeFromUrl("https://www.instagram.com/dj_external/p/AbC123_xY/"), "AbC123_xY");
  assert.equal(mod.instagramShortcodeFromUrl("https://www.instagram.com/p/AbC123_xY/"), "AbC123_xY");
  assert.equal(mod.instagramShortcodeFromUrl("https://www.instagram.com/sanghyangresort/reel/AbC123_xY/"), "AbC123_xY");
  assert.equal(mod.instagramShortcodeFromUrl("https://www.instagram.com/explore/p/AbC123_xY/"), null);
  assert.equal(mod.instagramShortcodeFromUrl("https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700"), null);
});

test("persistBrowserSyncBatch dedup berdasarkan shortcode IG lintas variasi URL & jaga outlet/account kolaborasi tetap konsisten", async () => {
  const { persistBrowserSyncBatch, sanitizeBrowserSyncPayload, buildSocialSyncTargets } = await import(
    "../../src/lib/market/browser-social-sync"
  );
  const ts = String(Date.now()).slice(-7);
  const code = `Collab${ts}Ab`;
  const parentUrl = `https://www.instagram.com/sanghyangresort/reel/${code}/`;
  const outletUrl = `https://www.instagram.com/sunsetgrillsanghyang/reel/${code}/`;
  const bareUrl = `https://www.instagram.com/p/${code}/`;
  const extCollabUrl = `https://www.instagram.com/dj_anyer_ext/p/${code}/`;
  const extOnlyCode = `ExtOnly${ts}Xy`;
  const extOnlyUrl = `https://www.instagram.com/vendor_seafood_ext/p/${extOnlyCode}/`;
  const createdRunIds: string[] = [];

  try {
    // 1. Akun induk (@sanghyangresort) menyinkronkan postingan kolaborasi lebih dulu (caption generik -> resort)
    const run1 = await persistBrowserSyncBatch(
      sanitizeBrowserSyncPayload(
        {
          finalizeRun: true,
          posts: [
            {
              targetType: "own",
              outletKey: "resort",
              account: "sanghyangresort",
              followers: 7822,
              profilePostsTotal: 1739,
              platform: "instagram",
              postType: "reels",
              sourceUrl: parentUrl,
              postedAt: "2026-11-18T08:00:00.000Z",
              caption: "Malam minggu seru di tepi pantai Anyer.",
              metrics: { views: 4200, likes: 50, comments: 4, shares: null },
              comments: [],
            },
          ],
        },
        ["sanghyangresort", "sunsetgrillsanghyang"],
        new Date("2026-11-24T10:00:00.000Z"),
      ),
    );
    createdRunIds.push(run1.syncRunId);

    // 2. Akun outlet (@sunsetgrillsanghyang) menyinkronkan shortcode sama dengan URL outlet -> upgrade ke sunset-grill tanpa duplikat
    const run2 = await persistBrowserSyncBatch(
      sanitizeBrowserSyncPayload(
        {
          finalizeRun: true,
          posts: [
            {
              targetType: "own",
              outletKey: "sunset-grill",
              account: "sunsetgrillsanghyang",
              followers: 11200,
              profilePostsTotal: 619,
              platform: "instagram",
              postType: "reels",
              sourceUrl: outletUrl,
              postedAt: "2026-11-18T08:00:00.000Z",
              caption: "Malam minggu seru di tepi pantai Anyer.",
              metrics: { views: null, likes: 58, comments: 5, shares: 2 },
              comments: [],
            },
          ],
        },
        ["sanghyangresort", "sunsetgrillsanghyang"],
        new Date("2026-11-24T10:30:00.000Z"),
      ),
    );
    createdRunIds.push(run2.syncRunId);

    const afterStep2 = await db.competitorPromotion.findMany({
      where: {
        category: "Postingan Sosmed Tayang",
        sourceUrl: { contains: code },
      },
      include: { competitor: { select: { placeId: true } } },
    });
    assert.equal(afterStep2.length, 1, "shortcode IG sama tidak boleh membuat baris duplikat");
    assert.equal(afterStep2[0].version, 2);
    assert.equal(afterStep2[0].competitor.placeId, "sunset_grill_sanghyang");
    const meta2 = JSON.parse(afterStep2[0].description ?? "{}");
    assert.equal(meta2.outletKey, "sunset-grill");
    assert.equal(meta2.account, "sunsetgrillsanghyang");
    assert.deepEqual(meta2.collabAccounts, ["sanghyangresort"]);
    assert.equal(meta2.followers, 11200);
    assert.equal(meta2.profilePostsTotal, 619);
    assert.equal(meta2.metrics.views, 4200, "views dari sinkron pertama wajib dipertahankan");
    assert.equal(meta2.metrics.likes, 58);

    // 3. Akun induk (@sanghyangresort) menyinkronkan ulang URL bare /p/<CODE>/ -> outletKey/account/followers/profilePostsTotal TIDAK boleh mundur ke resort
    const run3 = await persistBrowserSyncBatch(
      sanitizeBrowserSyncPayload(
        {
          finalizeRun: true,
          posts: [
            {
              targetType: "own",
              outletKey: "resort",
              account: "sanghyangresort",
              followers: 7830,
              profilePostsTotal: 1745,
              platform: "instagram",
              postType: "feed",
              sourceUrl: bareUrl,
              postedAt: "2026-11-18T08:00:00.000Z",
              caption: "Malam minggu seru di tepi pantai Anyer.",
              metrics: { views: 4350, likes: 62, comments: 6, shares: 3 },
              comments: [],
            },
          ],
        },
        ["sanghyangresort", "sunsetgrillsanghyang"],
        new Date("2026-11-24T11:00:00.000Z"),
      ),
    );
    createdRunIds.push(run3.syncRunId);

    // 4. URL kolaborasi eksternal /dj_anyer_ext/p/<CODE>/ dari @sunsetgrillsanghyang -> tetap 1 baris
    const run4 = await persistBrowserSyncBatch(
      sanitizeBrowserSyncPayload(
        {
          finalizeRun: true,
          posts: [
            {
              targetType: "own",
              outletKey: "sunset-grill",
              account: "sunsetgrillsanghyang",
              followers: 11250,
              profilePostsTotal: 619,
              platform: "instagram",
              postType: "feed",
              sourceUrl: extCollabUrl,
              postedAt: "2026-11-18T08:00:00.000Z",
              caption: "Malam minggu seru di tepi pantai Anyer.",
              metrics: { views: null, likes: 65, comments: null, shares: null },
              comments: [],
            },
            {
              targetType: "own",
              outletKey: "sunset-grill",
              account: "sunsetgrillsanghyang",
              followers: 11250,
              profilePostsTotal: 619,
              platform: "instagram",
              postType: "feed",
              sourceUrl: extOnlyUrl,
              postedAt: "2026-11-19T08:00:00.000Z",
              caption: "Kolaborasi spesial seafood grill Anyer bersama vendor lokal.",
              metrics: { views: null, likes: 44, comments: 2, shares: 1 },
              comments: [],
            },
          ],
        },
        ["sanghyangresort", "sunsetgrillsanghyang"],
        new Date("2026-11-24T11:30:00.000Z"),
      ),
    );
    createdRunIds.push(run4.syncRunId);

    const afterStep4 = await db.competitorPromotion.findMany({
      where: {
        category: "Postingan Sosmed Tayang",
        sourceUrl: { contains: code },
      },
      include: { competitor: { select: { placeId: true } } },
    });
    assert.equal(afterStep4.length, 1, "4 variasi URL shortcode sama harus tetap 1 baris di DB");
    assert.equal(afterStep4[0].version, 4);
    assert.equal(afterStep4[0].competitor.placeId, "sunset_grill_sanghyang");
    const meta4 = JSON.parse(afterStep4[0].description ?? "{}");
    assert.equal(meta4.outletKey, "sunset-grill", "outletKey spesifik tidak boleh mundur ke resort");
    assert.equal(meta4.account, "sunsetgrillsanghyang", "account outlet tidak boleh tertimpa akun induk");
    assert.deepEqual(meta4.collabAccounts, ["sanghyangresort"]);
    assert.equal(meta4.postType, "reels", "postType reels tidak boleh turun ke feed");
    assert.equal(meta4.followers, 11250, "followers tetap milik sunsetgrillsanghyang, tidak teracuni sanghyangresort");
    assert.equal(meta4.profilePostsTotal, 619, "profilePostsTotal tetap 619, tidak teracuni 1745");
    assert.equal(meta4.metrics.views, 4350);
    assert.equal(meta4.metrics.likes, 65);

    // 5. GET /api/marketing-sosmed & knownPostUrls mengenali kolaborasi eksternal dan collabAccounts
    const targetsInfo = await buildSocialSyncTargets();
    assert.ok(
      targetsInfo.knownPostUrls.includes(extOnlyUrl),
      "URL kolaborasi eksternal yang lengkap harus masuk knownPostUrls",
    );
    const apiRes = await GET();
    const apiJson = (await apiRes.json()) as {
      posts: Array<{ postUrl: string; account?: string; outletKey: string; collabAccounts?: string[] }>;
    };
    const collabApiPost = apiJson.posts.find((p) => p.postUrl.includes(code));
    assert.ok(collabApiPost);
    assert.equal(collabApiPost.account, "sunsetgrillsanghyang");
    assert.equal(collabApiPost.outletKey, "sunset-grill");
    assert.deepEqual(collabApiPost.collabAccounts, ["sanghyangresort"]);
    const extApiPost = apiJson.posts.find((p) => p.postUrl === extOnlyUrl);
    assert.ok(extApiPost);
    assert.equal(extApiPost.account, "sunsetgrillsanghyang");
    assert.equal(extApiPost.outletKey, "sunset-grill");

    // 6. Akun induk menyinkronkan postingan ber-URL akun outlet resmi (/sunsetgrillsanghyang/p/...) -> outletKey otomatis sunset-grill & collabAccounts mencatat sunsetgrillsanghyang
    const parentSeesOutletCode = `ParOut${ts}Zz`;
    const parentSeesOutletUrl = `https://www.instagram.com/sunsetgrillsanghyang/p/${parentSeesOutletCode}/`;
    const run6 = await persistBrowserSyncBatch(
      sanitizeBrowserSyncPayload(
        {
          finalizeRun: true,
          posts: [
            {
              targetType: "own",
              outletKey: "resort",
              account: "sanghyangresort",
              followers: 7830,
              profilePostsTotal: 1745,
              platform: "instagram",
              postType: "feed",
              sourceUrl: parentSeesOutletUrl,
              postedAt: "2026-11-19T09:00:00.000Z",
              caption: "Sore hangat di tepi pantai Anyer.",
              metrics: { views: null, likes: 30, comments: 1, shares: null },
              comments: [],
            },
          ],
        },
        ["sanghyangresort", "sunsetgrillsanghyang"],
        new Date("2026-11-24T12:00:00.000Z"),
      ),
    );
    createdRunIds.push(run6.syncRunId);
    const parentSeesRow = await db.competitorPromotion.findFirst({
      where: { sourceUrl: parentSeesOutletUrl, category: "Postingan Sosmed Tayang" },
      include: { competitor: { select: { placeId: true } } },
    });
    assert.ok(parentSeesRow);
    assert.equal(parentSeesRow.competitor.placeId, "sunset_grill_sanghyang");
    const parentSeesMeta = JSON.parse(parentSeesRow.description ?? "{}");
    assert.equal(parentSeesMeta.outletKey, "sunset-grill");
    assert.equal(parentSeesMeta.account, "sanghyangresort");
    assert.deepEqual(parentSeesMeta.collabAccounts, ["sunsetgrillsanghyang"]);
    assert.equal(parentSeesMeta.followers, 7830);
    assert.equal(parentSeesMeta.profilePostsTotal, 1745);

    // 7. Pengiriman bersamaan (concurrent) dua tab untuk shortcode sama tidak boleh membuat baris duplikat
    const raceCode = `Race${ts}Ww`;
    const racePayloadA = sanitizeBrowserSyncPayload(
      {
        finalizeRun: true,
        posts: [
          {
            targetType: "own",
            outletKey: "resort",
            account: "sanghyangresort",
            followers: 7830,
            profilePostsTotal: 1745,
            platform: "instagram",
            postType: "reels",
            sourceUrl: `https://www.instagram.com/sanghyangresort/reel/${raceCode}/`,
            postedAt: "2026-11-20T08:00:00.000Z",
            caption: "Momen senja di pantai Anyer.",
            metrics: { views: 1500, likes: 25, comments: 1, shares: null },
            comments: [],
          },
        ],
      },
      ["sanghyangresort", "sunsetgrillsanghyang"],
      new Date("2026-11-24T12:15:00.000Z"),
    );
    const racePayloadB = sanitizeBrowserSyncPayload(
      {
        finalizeRun: true,
        posts: [
          {
            targetType: "own",
            outletKey: "sunset-grill",
            account: "sunsetgrillsanghyang",
            followers: 11250,
            profilePostsTotal: 619,
            platform: "instagram",
            postType: "reels",
            sourceUrl: `https://www.instagram.com/sunsetgrillsanghyang/reel/${raceCode}/`,
            postedAt: "2026-11-20T08:00:00.000Z",
            caption: "Momen senja di pantai Anyer.",
            metrics: { views: null, likes: 25, comments: 1, shares: null },
            comments: [],
          },
        ],
      },
      ["sanghyangresort", "sunsetgrillsanghyang"],
      new Date("2026-11-24T12:15:00.000Z"),
    );
    const [raceResA, raceResB] = await Promise.all([
      persistBrowserSyncBatch(racePayloadA),
      persistBrowserSyncBatch(racePayloadB),
    ]);
    createdRunIds.push(raceResA.syncRunId, raceResB.syncRunId);
    const raceRows = await db.competitorPromotion.findMany({
      where: { category: "Postingan Sosmed Tayang", sourceUrl: { contains: raceCode } },
    });
    assert.equal(raceRows.length, 1, "permintaan sinkron paralel untuk shortcode sama wajib menghasilkan tepat 1 baris");
    const raceMeta = JSON.parse(raceRows[0].description ?? "{}");
    assert.equal(raceMeta.outletKey, "sunset-grill");
    assert.equal(raceMeta.account, "sunsetgrillsanghyang");
    assert.deepEqual(raceMeta.collabAccounts, ["sanghyangresort"]);
    assert.equal(raceMeta.metrics.views, 1500);
  } finally {
    await db.competitorPromotion.deleteMany({
      where: {
        OR: [
          { sourceUrl: { contains: code } },
          { sourceUrl: { contains: extOnlyCode } },
          { sourceUrl: { contains: `ParOut${ts}Zz` } },
          { sourceUrl: { contains: `Race${ts}Ww` } },
        ],
      },
    });
    if (createdRunIds.length > 0) {
      await db.scrapeError.deleteMany({ where: { runId: { in: createdRunIds } } });
      await db.scrapeRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
  }
});

test("DB lokal tidak memiliki baris duplikat shortcode Instagram pada kategori Postingan Sosmed Tayang", async () => {
  const { instagramShortcodeFromUrl } = await import("../../src/lib/market/browser-social-sync");
  const rows = await db.competitorPromotion.findMany({
    where: { category: "Postingan Sosmed Tayang", sourceUrl: { not: null } },
    select: { sourceUrl: true },
  });
  const counts = new Map<string, string[]>();
  for (const r of rows) {
    const code = instagramShortcodeFromUrl(r.sourceUrl);
    if (!code) continue;
    const list = counts.get(code) ?? [];
    list.push(r.sourceUrl ?? "");
    counts.set(code, list);
  }
  const dupCodes = [...counts.entries()].filter(([, urls]) => urls.length > 1);
  assert.equal(
    dupCodes.length,
    0,
    `ditemukan ${dupCodes.length} shortcode IG duplikat di Postingan Sosmed Tayang: ${dupCodes
      .slice(0, 5)
      .map(([c, u]) => `${c} (${u.join(", ")})`)
      .join("; ")}`,
  );
});

test("persistBrowserSyncBatch memproses batch 15 postingan feed-tap historis tanpa duplikat shortcode, menjaga OCC & judul kompetitor", async () => {
  const {
    MAX_POSTS_PER_SYNC_BATCH,
    BrowserSyncValidationError,
    buildSocialSyncTargets,
    persistBrowserSyncBatch,
    sanitizeBrowserSyncPayload,
  } = await import("../../src/lib/market/browser-social-sync");

  assert.ok(MAX_POSTS_PER_SYNC_BATCH >= 25, "backend harus menerima batch minimal 25 postingan");

  const comp = await db.competitor.findFirst({
    where: { active: true, NOT: { placeId: { in: ["sanghyang", "sunset_grill_sanghyang", "dragon_beach_club", "dbistro_sanghyang", "dbar_sanghyang", "dspa_sanghyang"] } } },
    select: { id: true, name: true },
  });
  assert.ok(comp, "harus ada minimal satu kompetitor aktif di DB lokal");

  const ts = String(Date.now()).slice(-7);
  const batchPrefix = `FtBatch${ts}`;
  const dupCode = `${batchPrefix}DupA`;
  const compCode = `${batchPrefix}CompB`;
  const createdRunIds: string[] = [];

  // 1. Batch melebihi MAX_POSTS_PER_SYNC_BATCH (26 item) wajib ditolak 422
  const oversized = Array.from({ length: MAX_POSTS_PER_SYNC_BATCH + 1 }, (_, i) => ({
    targetType: "own",
    outletKey: "resort",
    account: "sanghyangresort",
    platform: "instagram",
    postType: "feed",
    sourceUrl: `https://www.instagram.com/sanghyangresort/p/${batchPrefix}Ov${i}/`,
    postedAt: "2026-10-01T08:00:00.000Z",
    caption: `Postingan uji batas batch #${i}`,
    metrics: { views: null, likes: 10, comments: 1, shares: null },
    comments: [],
  }));
  assert.throws(
    () => sanitizeBrowserSyncPayload({ posts: oversized }, ["sanghyangresort"], new Date("2026-11-25T00:00:00.000Z")),
    (err: unknown) => err instanceof BrowserSyncValidationError && err.status === 422,
  );

  // 2. Batch 15 postingan historis feed-tap (12 IG feed/reels unik + 2 variasi shortcode sama dalam 1 batch + 1 kompetitor)
  const batchPosts = [
    ...Array.from({ length: 12 }, (_, i) => ({
      targetType: "own" as const,
      outletKey: "resort",
      account: "sanghyangresort",
      followers: 7850,
      profilePostsTotal: 1739,
      platform: "instagram" as const,
      postType: i % 2 === 0 ? ("reels" as const) : ("feed" as const),
      sourceUrl:
        i % 2 === 0
          ? `https://www.instagram.com/sanghyangresort/reel/${batchPrefix}It${i}/`
          : `https://www.instagram.com/sanghyangresort/p/${batchPrefix}It${i}/`,
      postedAt: `2026-09-${String(10 + i).padStart(2, "0")}T07:30:00.000Z`,
      caption: `Arsip feed-tap historis Sanghyang #${i}`,
      metrics: { views: i % 2 === 0 ? 1200 + i * 50 : null, likes: 20 + i, comments: 2, shares: 1 },
      comments: [],
    })),
    // Pasangan shortcode sama dalam 1 batch: versi /reel/ diikuti versi /p/ bare tanpa views
    {
      targetType: "own" as const,
      outletKey: "resort",
      account: "sanghyangresort",
      followers: 7850,
      profilePostsTotal: 1739,
      platform: "instagram" as const,
      postType: "reels" as const,
      sourceUrl: `https://www.instagram.com/sanghyangresort/reel/${dupCode}/`,
      postedAt: "2026-09-25T08:00:00.000Z",
      caption: "Reel historis Sanghyang feed-tap",
      metrics: { views: 3400, likes: 88, comments: 5, shares: 3 },
      comments: [],
    },
    {
      targetType: "own" as const,
      outletKey: "resort",
      account: "sanghyangresort",
      followers: 7850,
      profilePostsTotal: 1739,
      platform: "instagram" as const,
      postType: "feed" as const,
      sourceUrl: `https://www.instagram.com/p/${dupCode}/`,
      postedAt: "2026-09-25T08:00:00.000Z",
      caption: "Reel historis Sanghyang feed-tap",
      metrics: { views: null, likes: 92, comments: 6, shares: null },
      comments: [],
    },
    // Postingan kompetitor
    {
      targetType: "competitor" as const,
      competitorId: comp.id,
      account: "kompetitor_uji",
      platform: "instagram" as const,
      postType: "feed" as const,
      sourceUrl: `https://www.instagram.com/kompetitor_uji/p/${compCode}/`,
      postedAt: "2026-09-26T09:00:00.000Z",
      caption: "Promo akhir pekan tepi pantai kompetitor",
      metrics: { views: null, likes: 60, comments: 4, shares: null },
      comments: [],
    },
  ];
  assert.equal(batchPosts.length, 15);

  try {
    const res1 = await persistBrowserSyncBatch(
      sanitizeBrowserSyncPayload(
        { finalizeRun: true, posts: batchPosts },
        ["sanghyangresort", "kompetitor_uji"],
        new Date("2026-11-25T00:00:00.000Z"),
      ),
    );
    createdRunIds.push(res1.syncRunId);
    assert.equal(res1.postsSaved, 15);

    // Pastikan 0 duplikat untuk pasangan shortcode dalam satu batch & OCC naik menjadi 2
    const dupRows = await db.competitorPromotion.findMany({
      where: { category: "Postingan Sosmed Tayang", sourceUrl: { contains: dupCode } },
    });
    assert.equal(dupRows.length, 1, "duplikat shortcode dalam 1 batch 15 item harus tergabung menjadi 1 baris");
    assert.equal(dupRows[0].version, 2, "OCC version harus 2");
    const dupMeta = JSON.parse(dupRows[0].description ?? "{}");
    assert.equal(dupMeta.postType, "reels", "postType reels tidak boleh turun menjadi feed");
    assert.equal(dupMeta.metrics.views, 3400, "views tidak boleh tertimpa null");
    assert.equal(dupMeta.metrics.likes, 92, "likes terbaru harus terpakai");

    // Pastikan semua 13 postingan own lengkap hasil feed-tap langsung masuk knownPostUrls
    const targetsInfo = await buildSocialSyncTargets();
    const knownMatches = targetsInfo.knownPostUrls.filter((u) => u.includes(batchPrefix));
    assert.ok(knownMatches.length >= 14, `minimal 14 postingan lengkap hasil feed-tap masuk knownPostUrls (dapat ${knownMatches.length})`);

    // Sinkron ulang postingan kompetitor tanpa caption tidak boleh menimpa title lama dengan "Postingan Instagram"
    const res2 = await persistBrowserSyncBatch(
      sanitizeBrowserSyncPayload(
        {
          finalizeRun: true,
          posts: [
            {
              targetType: "competitor",
              competitorId: comp.id,
              account: "kompetitor_uji",
              platform: "instagram",
              postType: "feed",
              sourceUrl: `https://www.instagram.com/kompetitor_uji/p/${compCode}/`,
              postedAt: "2026-09-26T09:00:00.000Z",
              caption: "",
              metrics: { views: null, likes: 75, comments: 5, shares: null },
              comments: [],
            },
          ],
        },
        ["kompetitor_uji"],
        new Date("2026-11-25T01:00:00.000Z"),
      ),
    );
    createdRunIds.push(res2.syncRunId);

    const compRow = await db.competitorPromotion.findFirst({
      where: { sourceUrl: { contains: compCode } },
    });
    assert.ok(compRow);
    assert.equal(compRow.version, 2);
    assert.equal(compRow.title, "Promo akhir pekan tepi pantai kompetitor", "judul kompetitor tidak boleh tertimpa teks generik saat sinkron ulang tanpa caption");
  } finally {
    await db.competitorPromotion.deleteMany({
      where: { sourceUrl: { contains: batchPrefix } },
    });
    if (createdRunIds.length > 0) {
      await db.scrapeError.deleteMany({ where: { runId: { in: createdRunIds } } });
      await db.scrapeRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
  }
});

test("buildExtensionZipArchive mengemas feed-tap.js & feed-parsers.js v1.1.8 identik byte-per-byte dan menolak berkas luar allowlist", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  const {
    ALLOWED_EXTENSION_FILES,
    buildExtensionZipArchive,
    extractExtensionZipEntries,
    loadExtensionManifestInfo,
    validateManifestReferencedFiles,
  } = await import("../../src/lib/market/extension-zip");

  assert.ok((ALLOWED_EXTENSION_FILES as readonly string[]).includes("feed-tap.js"), "feed-tap.js wajib masuk allowlist ZIP");
  assert.ok((ALLOWED_EXTENSION_FILES as readonly string[]).includes("feed-parsers.js"), "feed-parsers.js wajib masuk allowlist ZIP");

  const { manifest } = loadExtensionManifestInfo();
  const v118Manifest = {
    ...manifest,
    content_scripts: [
      { matches: ["https://www.instagram.com/*"], js: ["feed-tap.js"], run_at: "document_start", world: "MAIN" as const },
      { matches: ["https://www.instagram.com/*"], js: ["feed-parsers.js", "parsers.js", "content-social.js"], run_at: "document_idle" },
    ],
  };
  assert.doesNotThrow(() => validateManifestReferencedFiles(v118Manifest));
  assert.throws(
    () =>
      validateManifestReferencedFiles({
        ...v118Manifest,
        content_scripts: [{ matches: ["https://www.instagram.com/*"], js: ["tak-terdaftar.js"] }],
      }),
    /ALLOWED_EXTENSION_FILES/,
  );

  const archive = buildExtensionZipArchive();
  const extracted = extractExtensionZipEntries(archive.buffer);
  for (const rel of ["feed-tap.js", "feed-parsers.js", "parsers.js", "content-social.js", "background.js", "manifest.json"]) {
    const zipBytes = extracted.get(`sanghyang-social-sync/${rel}`);
    assert.ok(zipBytes && zipBytes.length > 0, `${rel} wajib terkemas utuh di dalam ZIP`);
    const diskBytes = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync", rel));
    const zipSha = crypto.createHash("sha256").update(zipBytes).digest("hex");
    const diskSha = crypto.createHash("sha256").update(diskBytes).digest("hex");
    assert.equal(zipSha, diskSha, `SHA-256 ${rel} di ZIP harus cocok 100% ke disk`);
    assert.equal(zipBytes[0] === 0xef && zipBytes[1] === 0xbb && zipBytes[2] === 0xbf, false, `${rel} bebas UTF-8 BOM`);
  }
});
