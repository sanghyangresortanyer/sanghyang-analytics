import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { db } from "../../src/lib/db";
import { isVerifiedReviewSource } from "../../src/lib/market/resort-strategy";
import { assembleGraph } from "../../src/lib/knowledge-graph/assemble";

const require = createRequire(import.meta.url);

after(() => db.$disconnect());

test("ekstensi parser murni: parseHumanCount, canonicalizeSocialPostUrl, stripCommentPii, dan deteksi tantangan", () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  assert.equal(parsers.parseHumanCount("12.4K"), 12400);
  assert.equal(parsers.parseHumanCount("1,2 rb"), 1200);
  assert.equal(parsers.parseHumanCount("3,5 jt"), 3500000);
  assert.equal(parsers.parseHumanCount("1.240"), 1240);
  assert.equal(parsers.parseHumanCount(""), null);
  assert.equal(parsers.parseHumanCount("Belum ada"), null);

  assert.equal(
    parsers.canonicalizeSocialPostUrl("https://www.instagram.com/sanghyangresort/reel/DfeUWFsv-pk/?igsh=xyz", "instagram"),
    "https://www.instagram.com/sanghyangresort/reel/DfeUWFsv-pk/",
  );
  assert.equal(
    parsers.canonicalizeSocialPostUrl("https://www.tiktok.com/@astonanyerofficial/video/7412345678901234567?_t=1&_r=1", "tiktok"),
    "https://www.tiktok.com/@astonanyerofficial/video/7412345678901234567",
  );
  assert.equal(parsers.canonicalizeSocialPostUrl("https://www.instagram.com/astonanyer/", "instagram"), null);
  assert.equal(parsers.canonicalizeSocialPostUrl("http://www.instagram.com/p/abc/", "instagram"), null);
  assert.equal(parsers.canonicalizeSocialPostUrl("https://evil.example/p/abc/", "instagram"), null);

  const sanitized = parsers.stripCommentPii("Halo @budi_tamu cek WA 0812-3456-7890 atau tamu@example.com NIK 3604123456789012 info @sanghyangresort", ["sanghyangresort"]);
  assert.doesNotMatch(sanitized, /@budi_tamu|0812|tamu@example\.com|3604123456789012/);
  assert.match(sanitized, /@sanghyangresort/);
  assert.match(sanitized, /@\[pengguna\]/);
  assert.match(sanitized, /\[telepon\]/);
  assert.match(sanitized, /\[email\]/);
  assert.match(sanitized, /\[angka-pribadi\]/);
  assert.equal(parsers.stripLoneSurrogates("Pantai ✨🏨 \ud800rusak"), "Pantai ✨🏨 rusak");
  assert.equal(parsers.stripLoneSurrogates("Promo Sunset 🔥🌴 di Anyer"), "Promo Sunset 🔥🌴 di Anyer");

  const piiEdge = parsers.stripCommentPii("Hubungi +62 812-3456-7890 atau 0812.3456.7890, harga Rp 100.000, @a@b ke @sanghyangresort.", ["sanghyangresort"]);
  assert.doesNotMatch(piiEdge, /812|@a\b|@b\b/);
  assert.match(piiEdge, /Rp 100\.000/);
  assert.match(piiEdge, /@sanghyangresort/);

  const igLogin = parsers.detectSocialChallenge({
    url: "https://www.instagram.com/accounts/login/?next=%2Fastonanyer%2F",
    title: "Login • Instagram",
    bodyText: "Log in to continue",
    hasLoginForm: true,
    hasCaptchaDom: false,
  });
  assert.equal(igLogin.blocked, true);
  assert.equal(igLogin.kind, "login");

  const ttCaptcha = parsers.detectSocialChallenge({
    url: "https://www.tiktok.com/@mambrukhotelanyer",
    title: "TikTok",
    bodyText: "Drag the slider to verify you are not a robot",
    hasLoginForm: false,
    hasCaptchaDom: true,
  });
  assert.equal(ttCaptcha.blocked, true);
  assert.equal(ttCaptcha.kind, "captcha");

  const clean = parsers.detectSocialChallenge({
    url: "https://www.tiktok.com/@mambrukhotelanyer",
    title: "Mambruk Hotel (@mambrukhotelanyer)",
    bodyText: "Pantai tenang di Anyer",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(clean.blocked, false);
});

test("ekstensi parser murni: parseSocialDateText menangani tanggal ISO, bulan sebelum tanggal, dan relatif secara jujur", () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const nowMs = Date.parse("2026-11-18T10:00:00.000Z");

  assert.equal(parsers.parseSocialDateText("2026-11-16T08:00:00.000Z", nowMs), "2026-11-16T08:00:00.000Z");
  assert.equal(parsers.parseSocialDateText("2026-11-15", nowMs), "2026-11-15T05:00:00.000Z");
  const twoDaysAgo = parsers.parseSocialDateText("2 hari yang lalu", nowMs);
  assert.ok(twoDaysAgo && twoDaysAgo.startsWith("2026-11-16"), `2 hari lalu -> ${twoDaysAgo}`);
  assert.ok(parsers.parseSocialDateText("November 5", nowMs)?.startsWith("2026-11-05"), "format US Month Day");
  assert.ok(parsers.parseSocialDateText("November 5, 2026", nowMs)?.startsWith("2026-11-05"), "format US Month Day, Year");
  assert.ok(parsers.parseSocialDateText("· 6d ago", nowMs)?.startsWith("2026-11-12"), "format middot TikTok");
  assert.ok(parsers.parseSocialDateText("5d", nowMs)?.startsWith("2026-11-13"), "format ringkas IG");
  assert.equal(parsers.parseSocialDateText("teks acak tidak dikenal", nowMs), null);
});

test("archive builder: menghasilkan PKZIP valid dengan parsers.js terpaket utuh, content_scripts valid, dan manifest bebas izin berbahaya", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const {
    buildExtensionZipArchive,
    extractExtensionZipEntries,
    loadExtensionManifestInfo,
    validateManifestReferencedFiles,
  } = await import("../../src/lib/market/extension-zip");
  const manifestInfo = loadExtensionManifestInfo();
  assert.equal(manifestInfo.manifest.manifest_version, 3);
  assert.match(manifestInfo.manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifestInfo.manifest.key && manifestInfo.manifest.key.length > 100, "public key terpin agar Extension ID sama di Ubuntu & Windows");
  assert.match(manifestInfo.extensionId, /^[a-p]{32}$/, "Extension ID valid format Chrome 32 huruf a-p");
  assert.ok(!manifestInfo.manifest.permissions.includes("tabs"), "tanpa izin tabs global");
  assert.ok(!manifestInfo.manifest.permissions.includes("cookies"), "tanpa izin cookies");
  assert.ok(!(manifestInfo.manifest.host_permissions as string[]).some((h) => h.includes("*://*/*") || h.includes("*.vercel.app")));
  assert.ok(Array.isArray(manifestInfo.manifest.content_scripts) && manifestInfo.manifest.content_scripts.length >= 2, "content_scripts wajib memuat MAIN world (feed-tap.js) dan isolated world");
  const mainCs = manifestInfo.manifest.content_scripts!.find((c) => c.world === "MAIN");
  assert.ok(mainCs, "feed-tap.js wajib terdaftar pada content_scripts world MAIN");
  assert.deepEqual(mainCs.js, ["feed-tap.js"]);
  assert.equal(mainCs.run_at, "document_start");
  assert.ok(mainCs.matches.includes("https://www.instagram.com/*"));
  assert.ok(mainCs.matches.includes("https://www.tiktok.com/*"));
  const primaryCs = manifestInfo.manifest.content_scripts!.find((c) => c.world !== "MAIN");
  assert.ok(primaryCs, "isolated content_scripts wajib terdaftar");
  assert.deepEqual(
    primaryCs.js,
    ["feed-parsers.js", "parsers.js", "content-social.js"],
    "urutan injeksi isolated wajib feed-parsers.js -> parsers.js -> content-social.js",
  );
  assert.equal(primaryCs.run_at, "document_idle");
  assert.ok(primaryCs.matches.includes("https://www.instagram.com/*"));
  assert.ok(primaryCs.matches.includes("https://www.tiktok.com/*"));
  assert.doesNotThrow(() => validateManifestReferencedFiles(manifestInfo.manifest));

  const archive = buildExtensionZipArchive();
  assert.ok(archive.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "header lokal PKZIP");
  assert.ok(archive.files.some((f) => f.name === "sanghyang-social-sync/manifest.json"), "manifest.json berada dalam folder induk rapi");
  assert.ok(archive.files.some((f) => f.name === "sanghyang-social-sync/feed-tap.js" && f.size > 1000), "feed-tap.js wajib terpaket utuh dalam ZIP");
  assert.ok(archive.files.some((f) => f.name === "sanghyang-social-sync/feed-parsers.js" && f.size > 1000), "feed-parsers.js wajib terpaket utuh dalam ZIP");
  assert.ok(archive.files.some((f) => f.name === "sanghyang-social-sync/parsers.js" && f.size > 1000), "parsers.js wajib terpaket utuh dalam ZIP");
  assert.ok(archive.files.some((f) => f.name === "sanghyang-social-sync/content-social.js" && f.size > 500), "content-social.js wajib terpaket dalam ZIP");
  assert.ok(!archive.files.some((f) => f.name.includes("..") || f.name.endsWith(".pem") || f.name.includes(".env")));

  // Dekompresi langsung buffer PKZIP dan verifikasi kecocokan byte-per-byte untuk seluruh skrip ekstensi & manifest.json
  const extracted = extractExtensionZipEntries(archive.buffer);
  for (const rel of ["manifest.json", "feed-tap.js", "feed-parsers.js", "parsers.js", "content-social.js", "background.js"]) {
    const zipBytes = extracted.get(`sanghyang-social-sync/${rel}`);
    assert.ok(zipBytes, `${rel} wajib ada saat ZIP diekstrak`);
    const diskBytes = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync", rel));
    assert.equal(zipBytes.equals(diskBytes), true, `isi ${rel} di ZIP harus identik byte-per-byte dengan disk`);
    assert.equal(zipBytes[0] === 0xef && zipBytes[1] === 0xbb && zipBytes[2] === 0xbf, false, `${rel} bebas UTF-8 BOM`);
  }
  const bgSource = extracted.get("sanghyang-social-sync/background.js")!.toString("utf8");
  assert.match(bgSource, /SanghyangParsers/, "background.js memeriksa SanghyangParsers sebelum injeksi ulang");
  assert.match(bgSource, /extension_reload/, "background.js menangani galat Could not load file secara terstruktur");
  assert.match(bgSource, /Tempat Sampah/, "jeda menjelaskan cara memulihkan folder ekstensi yang terhapus");
  assert.ok(manifestInfo.manifest.permissions.includes("unlimitedStorage"), "antrean sinkron tanpa batas tidak terhenti kuota storage 10 MB");

  const { assertSafeRelativePath } = await import("../../src/lib/market/extension-zip");
  assert.throws(() => assertSafeRelativePath("../rahasia.pem"), /tidak aman/i);
  assert.throws(() => assertSafeRelativePath(".env.local"), /tidak aman/i);

  const { createExtensionDownloadGet, GET: GET_UNAUTH } = await import("../../src/app/api/admin/social-extension/download/route");
  const unauthRes = await GET_UNAUTH();
  assert.equal(unauthRes.status, 401);

  const GET = createExtensionDownloadGet(async () => null);
  const authRes = await GET();
  assert.equal(authRes.status, 200);
  assert.equal(authRes.headers.get("content-type"), "application/zip");
  assert.equal(authRes.headers.get("x-extension-version"), manifestInfo.manifest.version, "versi unduhan mengikuti manifest");
  assert.equal(authRes.headers.get("x-content-type-options"), "nosniff");
  assert.equal(authRes.headers.get("cache-control"), "no-store");
  assert.match(authRes.headers.get("x-content-sha256") ?? "", /^[0-9a-f]{64}$/);
});

test("browser-sync validasi & penyimpanan DB: fail-closed rahasia, idempoten, anonim, OCC, dan inquiriesWa null", async () => {
  const { createBrowserSyncHandlers, GET: GET_UNAUTH } = await import("../../src/app/api/marketing-sosmed/browser-sync/route");

  const unauthGet = await GET_UNAUTH();
  assert.equal(unauthGet.status, 401);

  const { GET, POST } = createBrowserSyncHandlers(async () => null);
  const cookie = "";
  {
    const okGet = await GET();
    assert.equal(okGet.status, 200);
    const getBody = await okGet.json();
    assert.ok(Array.isArray(getBody.targets) && getBody.targets.length > 0, "target diambil dinamis dari DB & akun resmi");
    assert.ok(getBody.targets.some((t: { targetType: string }) => t.targetType === "competitor"));
    assert.ok(getBody.targets.some((t: { targetType: string }) => t.targetType === "own"));
    assert.match(getBody.extensionId, /^[a-p]{32}$/);

    // Tolak CSRF origin luar
    const badOrigin = await POST(
      new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
        method: "POST",
        headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ posts: [] }),
      }),
    );
    assert.equal(badOrigin.status, 403);

    // Tolak penyelundupan cookie / sessionid / rawHtml
    const smuggledRes = await POST(
      new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3001", "content-type": "application/json" },
        body: JSON.stringify({
          targetKey: "own:instagram:sanghyangresort",
          posts: [],
          cookies: "sessionid=secret",
        }),
      }),
    );
    assert.equal(smuggledRes.status, 422);

    // Tolak competitorId non-UUID dengan 422 (bukan P2023 500) dan handle /tag/
    const { profileHandleFromUrl } = await import("../../src/lib/market/browser-social-sync");
    assert.equal(profileHandleFromUrl("https://www.tiktok.com/tag/anyer", "tiktok"), null);
    assert.equal(profileHandleFromUrl("https://www.instagram.com/explore/tags/anyer/", "instagram"), null);
    assert.equal(profileHandleFromUrl("https://www.instagram.com/astonanyer/", "instagram"), "astonanyer");

    const badUuidRes = await POST(
      new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
        method: "POST",
        headers: { cookie, origin: "http://localhost:3001", "content-type": "application/json" },
        body: JSON.stringify({
          posts: [
            {
              targetType: "competitor",
              competitorId: "bukan-uuid",
              platform: "instagram",
              sourceUrl: "https://www.instagram.com/p/TestUuidCheck/",
            },
          ],
        }),
      }),
    );
    assert.equal(badUuidRes.status, 422);

    const ownPostUrl = `https://www.instagram.com/sanghyangresort/p/UjiSyncOwn${Date.now()}/`;
    const ownDspaUrl = `https://www.instagram.com/dspasanghyang/p/UjiSyncDspa${Date.now()}/`;
    const comp = await db.competitor.findFirst({ where: { active: true, tiktokUrl: { not: null } }, select: { id: true, name: true, tiktokUrl: true } });
    assert.ok(comp && comp.tiktokUrl);
    const handleMatch = comp.tiktokUrl.match(/(@[A-Za-z0-9._-]+)/);
    assert.ok(handleMatch);
    const compTikTokUrl = `https://www.tiktok.com/${handleMatch[1]}/video/${Date.now()}123`;
    const commentText = "Keren banget pantainya @tamu_uji WA 08119001122 untuk keluarga";

    const createdRunIds: string[] = [];
    try {
      const payload = {
        runStartedAt: "2026-11-18T10:00:00.000Z",
        finalizeRun: true,
        posts: [
          {
            targetType: "own",
            outletKey: "resort",
            account: "sanghyangresort",
            platform: "instagram",
            postType: "feed",
            sourceUrl: ownPostUrl,
            postedAt: "2026-11-17T08:00:00.000Z",
            caption: "Weekend Santai di Sanghyang resort pinggir pantai Anyer.",
            metrics: { views: null, likes: 32, comments: 4, shares: null },
            comments: [],
          },
          {
            targetType: "own",
            outletKey: "dspa",
            account: "dspasanghyang",
            platform: "instagram",
            postType: "feed",
            sourceUrl: ownDspaUrl,
            postedAt: "2026-11-17T09:00:00.000Z",
            caption: "Suasana tenang akhir pekan bersama keluarga.",
            metrics: { views: null, likes: 12, comments: null, shares: null },
            comments: [],
          },
          {
            targetType: "competitor",
            competitorId: comp.id,
            platform: "tiktok",
            postType: "tiktok_video",
            sourceUrl: compTikTokUrl,
            postedAt: "2026-11-17T07:00:00.000Z",
            caption: "Promo sunset staycation diskon 20%",
            metrics: { views: 4100, likes: 120, comments: 15, shares: 9 },
            comments: [
              {
                commentToken: "tok-uji-1",
                text: commentText,
                commentAt: "2026-11-17T09:00:00.000Z",
              },
            ],
          },
        ],
      };

      const res1 = await POST(
        new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
          method: "POST",
          headers: { cookie, origin: "http://localhost:3001", "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      assert.equal(res1.status, 200);
      const j1 = await res1.json();
      if (typeof j1.syncRunId === "string") createdRunIds.push(j1.syncRunId);
      assert.equal(j1.postsSaved, 3);
      assert.equal(j1.commentsInserted, 1);

      const savedOwn = await db.competitorPromotion.findFirst({ where: { sourceUrl: ownPostUrl } });
      assert.ok(savedOwn);
      assert.equal(savedOwn.category, "Postingan Sosmed Tayang");
      const ownDesc = JSON.parse(savedOwn.description ?? "{}");
      assert.equal(ownDesc.metrics.views, null, "views kosong dari feed IG tetap null, bukan 0");
      assert.equal(ownDesc.metrics.likes, 32);
      assert.equal(ownDesc.metrics.shares, null);
      assert.equal(ownDesc.metrics.inquiriesWa, null, "inquiriesWa kosong dari ekstensi wajib null, bukan 0");

      const savedDspa = await db.competitorPromotion.findFirst({
        where: { sourceUrl: ownDspaUrl },
        select: { competitor: { select: { placeId: true } } },
      });
      assert.equal(savedDspa?.competitor.placeId, "dspa_sanghyang", "akun khusus outlet tetap masuk outletnya walau takarir generik");

      const savedReview = await db.competitorReview.findFirst({ where: { sourceUrl: compTikTokUrl } });
      assert.ok(savedReview);
      assert.equal(savedReview.source, "TikTok");
      assert.equal(Number(savedReview.rating), 0);
      assert.doesNotMatch(savedReview.text, /@tamu_uji|08119001122/);

      // Re-run dengan komentar sama harus skip (idempoten), dan update metrik post sendiri mempertahankan inquiriesWa
      await db.competitorPromotion.update({
        where: { id: savedOwn.id },
        data: {
          description: JSON.stringify({
            ...ownDesc,
            metrics: { ...ownDesc.metrics, inquiriesWa: 7 },
          }),
          version: { increment: 1 },
        },
      });
      const res2 = await POST(
        new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
          method: "POST",
          headers: { cookie, origin: "http://localhost:3001", "content-type": "application/json" },
          body: JSON.stringify({
            ...payload,
            posts: [{ ...payload.posts[0], metrics: { views: 1050, likes: 40, comments: 5, shares: 3 } }, payload.posts[2]],
          }),
        }),
      );
      assert.equal(res2.status, 200);
      const j2 = await res2.json();
      if (typeof j2.syncRunId === "string") createdRunIds.push(j2.syncRunId);
      assert.equal(j2.commentsSkipped, 1, "komentar duplikat dilewati");
      const updatedOwn = await db.competitorPromotion.findFirst({ where: { sourceUrl: ownPostUrl } });
      const updatedDesc = JSON.parse(updatedOwn?.description ?? "{}");
      assert.equal(updatedDesc.metrics.views, 1050);
      assert.equal(updatedDesc.metrics.inquiriesWa, 7, "inquiriesWa isian staf tidak tertimpa saat ekstensi sinkron ulang");
    } finally {
      await db.competitorReview.deleteMany({ where: { sourceUrl: compTikTokUrl } });
      await db.competitorPromotion.deleteMany({ where: { sourceUrl: { in: [ownPostUrl, ownDspaUrl, compTikTokUrl] } } });
      if (createdRunIds.length > 0) {
        await db.scrapeError.deleteMany({ where: { runId: { in: createdRunIds } } });
        await db.scrapeRun.deleteMany({ where: { id: { in: createdRunIds } } });
      }
    }
  }
});

test("kontrak ulasan sosial: validasi permalink ketat, PDF Rapat Senin tidak melabeli pujian sosmed sebagai Keluhan 0/5, dan KG melabeli TikTok", async () => {
  assert.equal(isVerifiedReviewSource("https://www.instagram.com/p/DfTxAQ9hugH/"), true);
  assert.equal(isVerifiedReviewSource("https://www.instagram.com/sanghyangresort/reel/DfeUWFsv-pk/"), true);
  assert.equal(isVerifiedReviewSource("https://www.instagram.com/a/b/p/palsu/"), false);
  assert.equal(isVerifiedReviewSource("https://www.tiktok.com/@mambrukhotelanyer/video/741234567890"), true);
  assert.equal(isVerifiedReviewSource("https://www.tiktok.com/@mambrukhotelanyer/video/bukanangka"), false);

  const { renderPlaceSubsectionReviews } = await import("../../src/lib/meeting-report/sections");
  const revSection = renderPlaceSubsectionReviews({
    name: "Mambruk Hotel & Convention",
    role: "inti",
    category: "hotel",
    starRating: 4,
    roadKm: 1.5,
    driveMinutes: null,
    distanceSource: null,
    address: null,
    rating: 4.5,
    reviewCount: 100,
    ratingObservedAt: null,
    websiteUrl: null,
    mapsUrl: null,
    roomCount: null,
    roomCountSource: null,
    auditRationale: null,
    facts: [],
    reviews: [
      {
        rating: 0,
        sentiment: "positive",
        text: "Pantainya bersih dan staf ramah sekali",
        source: "Instagram",
        sourceUrl: "https://www.instagram.com/mambrukhotelanyer/p/ABC123/",
        reviewDate: "2026-11-17T08:00:00.000Z",
        themes: ["pelayanan & staf"],
      },
    ],
    promos: [],
    rates: [],
    rateRange: null,
    market: null,
    actualShare: null,
    menu: [],
    menuSources: [],
    perPerson: null,
    menuChecked: [],
    menuListed: false,
  });
  const bullets = revSection.bullets.join("\n");
  assert.match(bullets, /^Pujian:.*Komentar publik/m);
  assert.doesNotMatch(bullets, /Keluhan:/);
  assert.doesNotMatch(bullets, /0\/5/);

  const { loadResortMarketSize } = await import("../../src/lib/market/market-size");
  const marketSize = await loadResortMarketSize();
  const kg = assembleGraph({
    now: new Date("2026-11-18T10:00:00Z"),
    ownOutlets: [{ outletKey: "resort", competitorName: "Sanghyang Indah Spa Resort", label: "Kamar & Resort" }],
    competitors: [
      { id: "own1", name: "Sanghyang Indah Spa Resort", category: "resort", outlets: ["resort"], placeId: "sanghyang", roadKm: 0, starRating: 4, rating: 4.5, reviewCount: 100, ratingSource: "Google", ratingSourceUrl: null, websiteUrl: null, mapsUrl: null, compsetRole: null, active: true, retiredReason: null, observedAt: null, parentId: null, parentMapsUrl: null },
      { id: "c1", name: "Novus Jiva Anyer", category: "hotel", outlets: ["resort"], placeId: "novus", roadKm: 5, starRating: 4, rating: 4.6, reviewCount: 200, ratingSource: "Google", ratingSourceUrl: null, websiteUrl: null, mapsUrl: null, compsetRole: "inti", active: true, retiredReason: null, observedAt: null, parentId: null, parentMapsUrl: null },
    ],
    rates: [],
    ratesCapturedAt: "2026-11-17T00:00:00Z",
    revenues: [],
    promos: [
      { id: "p-tt", competitorId: "c1", title: "Promo TikTok Stay", category: "Postingan Sosmed Baru", discount: 20, source: "TikTok", sourceUrl: "https://www.tiktok.com/@novusjivaanyer/video/741234567890", capturedAt: new Date("2026-11-17T08:00:00Z"), startsAt: new Date("2026-11-17T08:00:00Z"), endsAt: null, status: "new", kind: "promo", details: [], competitor: { active: true, name: "Novus Jiva Anyer" } },
    ],
    reviews: [],
    articles: [],
    tpk: null,
    marketSize,
  });
  const ttPromoNode = kg.nodes.find((n) => n.id === "promo:p-tt");
  assert.ok(ttPromoNode);
  assert.equal(ttPromoNode.sources[0]?.label, "Postingan TikTok");
});

test("ekstraksi DOM IG & TikTok: mengambil jumlah tayang, suka, caption, dan membuang nama komentator", () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  const mkEl = (opts: {
    text?: string;
    attrs?: Record<string, string>;
    selectors?: Record<string, unknown[]>;
  }) => ({
    textContent: opts.text ?? "",
    innerText: opts.text ?? "",
    src: opts.attrs?.src ?? "",
    getAttribute: (k: string) => opts.attrs?.[k] ?? null,
    querySelector: (sel: string) => {
      for (const s of sel.split(",").map((x) => x.trim())) {
        const hit = opts.selectors?.[s]?.[0];
        if (hit) return hit;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      const out: unknown[] = [];
      for (const s of sel.split(",").map((x) => x.trim())) {
        if (opts.selectors?.[s]) out.push(...opts.selectors[s]);
      }
      return out;
    },
    closest: () => null,
    parentElement: null,
  });

  const igProfileDoc = mkEl({
    selectors: {
      'a[href*="/p/"]': [
        mkEl({
          attrs: { href: "/sanghyangresort/reel/DfeUWFsv-pk/" },
          text: "1,4K",
          selectors: { img: [mkEl({ attrs: { src: "https://cdninstagram.com/thumb.jpg" } })] },
        }),
      ],
    },
  });
  const igItems = parsers.extractInstagramProfileItems(igProfileDoc, 5);
  assert.equal(igItems.length, 1);
  assert.equal(igItems[0].gridViews, 1400);

  const igDetailDoc = mkEl({
    selectors: {
      "time[datetime]": [mkEl({ attrs: { datetime: "2026-11-16T08:00:00.000Z" } })],
      'meta[property="og:image"]': [mkEl({ attrs: { content: "https://cdninstagram.com/poster.jpg" } })],
      "article h1": [mkEl({ text: "Promo Grill Sunset 🔥" })],
      "section span": [mkEl({ text: "45 suka" })],
      "article ul ul li": [
        mkEl({
          text: "Mantap view pantainya @teman_tamu",
          selectors: { "time[datetime]": [mkEl({ attrs: { datetime: "2026-11-16T09:00:00.000Z" } })] },
        }),
      ],
    },
  });
  const igPost = parsers.extractInstagramPostDetail(
    igDetailDoc,
    "https://www.instagram.com/sanghyangresort/reel/DfeUWFsv-pk/",
    1400,
    ["sanghyangresort"],
    Date.parse("2026-11-18T10:00:00Z"),
  );
  assert.equal(igPost.metrics.views, 1400);
  assert.equal(igPost.metrics.likes, 45);
  assert.equal(igPost.caption, "Promo Grill Sunset 🔥");
  assert.equal(igPost.comments.length, 1);
  assert.doesNotMatch(igPost.comments[0].text, /@teman_tamu/);

  const ttDetailDoc = mkEl({
    selectors: {
      '[data-e2e="browse-video-desc"]': [mkEl({ text: "Promo Makan Malam Anyer #anyer" })],
      '[data-e2e="like-count"]': [mkEl({ text: "320" })],
      '[data-e2e="comment-count"]': [mkEl({ text: "14" })],
      '[data-e2e="share-count"]': [mkEl({ text: "7" })],
      '[data-e2e="browser-nickname"] span:last-child': [mkEl({ text: "2026-11-16" })],
      '[data-e2e="comment-level-1"]': [mkEl({ text: "Seru banget tempatnya @pengunjung_uji" })],
    },
  });
  const ttPost = parsers.extractTikTokVideoDetail(
    ttDetailDoc,
    "https://www.tiktok.com/@sunsetgrill.sanghyang/video/741234567890",
    5600,
    ["sunsetgrill.sanghyang"],
    Date.parse("2026-11-18T10:00:00Z"),
  );
  assert.equal(ttPost.metrics.views, 5600);
  assert.equal(ttPost.metrics.likes, 320);
  assert.equal(ttPost.metrics.shares, 7);
  assert.equal(ttPost.comments.length, 1);
  assert.doesNotMatch(ttPost.comments[0].text, /@pengunjung_uji/);
});

test("ekstraksi DOM Instagram 2026 (React DIV tanpa ul li, Reels grid, meta) dan TikTok __UNIVERSAL_DATA_FOR_REHYDRATION__", () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  type NodeStub = {
    tagName?: string;
    textContent: string;
    innerText: string;
    src: string;
    attrs: Record<string, string>;
    children: NodeStub[];
    parentElement: NodeStub | null;
    getAttribute: (k: string) => string | null;
    querySelector: (sel: string) => NodeStub | null;
    querySelectorAll: (sel: string) => NodeStub[];
    closest: (sel: string) => NodeStub | null;
    cloneNode: (deep?: boolean) => NodeStub;
    remove: () => void;
  };

  const matchOne = (el: NodeStub, sel: string): boolean => {
    const s = sel.trim();
    if (s === "time[datetime]") return (el.tagName || "") === "TIME" && Boolean(el.attrs.datetime);
    if (s === "time") return (el.tagName || "") === "TIME";
    if (s === "img") return (el.tagName || "") === "IMG";
    if (s === "span") return (el.tagName || "") === "SPAN";
    if (s === 'span[dir="auto"]' || s === "span[dir='auto']") return (el.tagName || "") === "SPAN" && el.attrs.dir === "auto";
    if (s === 'a[href*="/c/"]') return (el.tagName || "") === "A" && (el.attrs.href || "").includes("/c/");
    if (s === 'a[href^="/"]' || s === "a[href]") return (el.tagName || "") === "A" && Boolean(el.attrs.href);
    if (s === 'a[href*="/p/"]') return (el.tagName || "") === "A" && (el.attrs.href || "").includes("/p/");
    if (s === 'a[href*="/reel/"]') return (el.tagName || "") === "A" && (el.attrs.href || "").includes("/reel/");
    if (s === 'svg[aria-label]') return (el.tagName || "") === "SVG" && Boolean(el.attrs["aria-label"]);
    if (s === 'meta[name="description"]') return (el.tagName || "") === "META" && el.attrs.name === "description";
    if (s === 'meta[property="og:image"]') return (el.tagName || "") === "META" && el.attrs.property === "og:image";
    if (s === "#__UNIVERSAL_DATA_FOR_REHYDRATION__") return el.attrs.id === "__UNIVERSAL_DATA_FOR_REHYDRATION__";
    if (s === '[data-e2e="comment-level-1"]') return el.attrs["data-e2e"] === "comment-level-1";
    if (s === '[data-e2e="video-desc"]') return el.attrs["data-e2e"] === "video-desc";
    if (s === '[data-e2e="like-count"]') return el.attrs["data-e2e"] === "like-count";
    if (s === '[data-e2e="comment-count"]') return el.attrs["data-e2e"] === "comment-count";
    if (s === '[data-e2e="share-count"]') return el.attrs["data-e2e"] === "share-count";
    if (s === "button" || s === '[role="button"]') return (el.tagName || "") === "BUTTON" || el.attrs.role === "button";
    return false;
  };

  const makeNode = (opts: {
    tag?: string;
    text?: string;
    attrs?: Record<string, string>;
    children?: NodeStub[];
  }): NodeStub => {
    const node: NodeStub = {
      tagName: (opts.tag || "DIV").toUpperCase(),
      textContent: opts.text ?? "",
      innerText: opts.text ?? "",
      src: opts.attrs?.src ?? "",
      attrs: opts.attrs ?? {},
      children: opts.children ?? [],
      parentElement: null,
      getAttribute: (k: string) => node.attrs[k] ?? null,
      querySelectorAll(sel: string) {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        const out: NodeStub[] = [];
        const walk = (cur: NodeStub) => {
          for (const ch of cur.children) {
            if (parts.some((p) => matchOne(ch, p))) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel: string) {
        return this.querySelectorAll(sel)[0] ?? null;
      },
      closest(sel: string) {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        let cur: NodeStub | null = node;
        while (cur) {
          if (parts.some((p) => matchOne(cur!, p))) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      cloneNode(deep = false): NodeStub {
        const cloned = makeNode({
          tag: this.tagName,
          text: this.textContent,
          attrs: { ...this.attrs },
          children: deep ? this.children.map((c) => c.cloneNode(true)) : [],
        });
        const computeText = (n: NodeStub): string =>
          n.children.length > 0 ? n.children.map(computeText).join(" ").replace(/\s+/g, " ").trim() : n.textContent;
        if (deep && cloned.children.length > 0) {
          cloned.textContent = computeText(cloned);
          cloned.innerText = cloned.textContent;
        }
        return cloned;
      },
      remove() {
        if (!this.parentElement) return;
        this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      },
    };
    for (const ch of node.children) ch.parentElement = node;
    return node;
  };

  // 1. IG Profile: tolak akun pihak ketiga yang hanya men-tag target, baca angka Reels grid [10, 10, 1, 1, 417, 417]
  const thirdPartyLink = makeNode({ tag: "A", attrs: { href: "/kiranaliu99/reel/C10zP-AvJoN/" } });
  const ownReelsCard = makeNode({
    tag: "A",
    attrs: { href: "/astonanyer/reel/DfoJf-wT7Pm/" },
    text: "10\n1\n417",
    children: [
      makeNode({ tag: "SPAN", text: "10" }),
      makeNode({ tag: "SPAN", text: "10" }),
      makeNode({ tag: "SPAN", text: "1" }),
      makeNode({ tag: "SPAN", text: "1" }),
      makeNode({ tag: "SPAN", text: "417" }),
      makeNode({ tag: "SPAN", text: "417" }),
    ],
  });
  const igProfileDoc = makeNode({ children: [thirdPartyLink, ownReelsCard] });
  const filteredItems = parsers.extractInstagramProfileItems(igProfileDoc, 5, "astonanyer");
  assert.equal(filteredItems.length, 1, "postingan akun lain (/kiranaliu99/) harus tersaring");
  assert.equal(filteredItems[0].sourceUrl, "https://www.instagram.com/astonanyer/reel/DfoJf-wT7Pm/");
  assert.equal(filteredItems[0].gridViews, 417);
  assert.equal(filteredItems[0].gridLikes, 10);
  assert.equal(filteredItems[0].gridComments, 1);

  // 2. IG Detail React <div> (tanpa article ul ul li), angka di svg[aria-label] parent, komentar punya a[href*="/c/"]
  const igCommentTime = makeNode({ tag: "TIME", attrs: { datetime: "2026-11-12T14:02:59.000Z" }, text: "5d" });
  const igCommentBlock = makeNode({
    tag: "DIV",
    text: "rahmi_nb2 5d include breakfast kah? Like Reply",
    children: [
      makeNode({ tag: "A", attrs: { href: "/rahmi_nb2/", role: "link" }, text: "rahmi_nb2", children: [makeNode({ tag: "SPAN", text: "rahmi_nb2" })] }),
      makeNode({ tag: "A", attrs: { href: "/p/DfoJf-wT7Pm/c/18094986071499795/" }, text: "5d", children: [igCommentTime] }),
      makeNode({ tag: "SPAN", attrs: { dir: "auto" }, text: "include breakfast kah?" }),
      makeNode({ tag: "BUTTON", text: "Like" }),
      makeNode({ tag: "BUTTON", text: "Reply" }),
    ],
  });
  const igMetricsSection = makeNode({
    tag: "DIV",
    text: "21 3 7",
    children: [
      makeNode({ tag: "DIV", text: "21", children: [makeNode({ tag: "DIV", attrs: { role: "button" }, children: [makeNode({ tag: "SVG", attrs: { "aria-label": "Like" } })] }), makeNode({ tag: "SPAN", text: "21" })] }),
      makeNode({ tag: "DIV", text: "3", children: [makeNode({ tag: "DIV", attrs: { role: "button" }, children: [makeNode({ tag: "SVG", attrs: { "aria-label": "Comment" } })] }), makeNode({ tag: "SPAN", text: "3" })] }),
      makeNode({ tag: "DIV", text: "7", children: [makeNode({ tag: "DIV", attrs: { role: "button" }, children: [makeNode({ tag: "SVG", attrs: { "aria-label": "Share" } })] }), makeNode({ tag: "SPAN", text: "7" })] }),
    ],
  });
  const igModernDoc = makeNode({
    children: [
      makeNode({ tag: "TIME", attrs: { datetime: "2026-11-12T04:01:37.000Z" }, text: "6d" }),
      makeNode({
        tag: "META",
        attrs: {
          name: "description",
          content: '21 likes, 3 comments - astonanyer on November 12, 2026: "Promo akhir tahun 25% OFF ✨".',
        },
      }),
      makeNode({ tag: "META", attrs: { property: "og:image", content: "https://cdninstagram.com/reel.jpg" } }),
      igMetricsSection,
      igCommentBlock,
    ],
  });
  const modernIg = parsers.extractInstagramPostDetail(
    igModernDoc,
    "https://www.instagram.com/astonanyer/reel/DfoJf-wT7Pm/",
    417,
    ["astonanyer"],
    Date.parse("2026-11-18T10:00:00Z"),
  );
  assert.ok(modernIg);
  assert.equal(modernIg.metrics.views, 417);
  assert.equal(modernIg.metrics.likes, 21);
  assert.equal(modernIg.metrics.comments, 3);
  assert.equal(modernIg.metrics.shares, 7);
  assert.equal(modernIg.caption, "Promo akhir tahun 25% OFF ✨", "tanda kutip dan titik di akhir meta description terbersihkan");
  assert.equal(modernIg.comments.length, 1, "komentar React <div> modern harus terekstrak");
  assert.equal(modernIg.comments[0].text, "include breakfast kah?");

  // 3. TikTok __UNIVERSAL_DATA_FOR_REHYDRATION__ + komentar tanpa [data-e2e="comment-time-1"]
  const rehydrationPayload = JSON.stringify({
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        itemInfo: {
          itemStruct: {
            id: "741234567890",
            createTime: "1794528000", // valid epoch sec
            desc: "Sunset Grill Live BBQ Anyer",
            stats: { playCount: 890, diggCount: 45, commentCount: 6, shareCount: 3 },
          },
        },
      },
    },
  });
  const ttModernDoc = makeNode({
    children: [
      makeNode({ tag: "SCRIPT", attrs: { id: "__UNIVERSAL_DATA_FOR_REHYDRATION__" }, text: rehydrationPayload }),
      makeNode({ tag: "SPAN", attrs: { "data-e2e": "comment-level-1" }, text: "Seru banget tempatnya buat keluarga @budi123" }),
    ],
  });
  const modernTt = parsers.extractTikTokVideoDetail(
    ttModernDoc,
    "https://www.tiktok.com/@sunsetgrill.sanghyang/video/741234567890",
    null,
    ["sunsetgrill.sanghyang"],
    Date.parse("2026-11-18T10:00:00Z"),
  );
  assert.ok(modernTt);
  assert.ok(modernTt.postedAt, "postedAt terbaca dari __UNIVERSAL_DATA_FOR_REHYDRATION__");
  assert.equal(modernTt.metrics.views, 890);
  assert.equal(modernTt.metrics.likes, 45);
  assert.equal(modernTt.metrics.comments, 6);
  assert.equal(modernTt.metrics.shares, 3);
  assert.equal(modernTt.caption, "Sunset Grill Live BBQ Anyer");
  assert.equal(modernTt.comments.length, 1);
  assert.doesNotMatch(modernTt.comments[0].text, /@budi123/);
});

test("multi-batch browser-sync menjaga satu ScrapeRun & mencegah kebocoran komentar kompetitor ke resort Sanghyang", async () => {
  const { createBrowserSyncHandlers } = await import("../../src/app/api/marketing-sosmed/browser-sync/route");
  const { createSummaryGet } = await import("../../src/app/api/market-intelligence/summary/route");
  const { POST } = createBrowserSyncHandlers(async () => null);
  const GET_SUMMARY = createSummaryGet(async () => null);

  const cookie = "";
  {
    const comp = await db.competitor.findFirst({
      where: { active: true, outlets: { has: "resort" }, NOT: { placeId: "sanghyang" } },
      select: { id: true, name: true },
    });
    assert.ok(comp);
    const ts = Date.now();
    const postUrl1 = `https://www.instagram.com/sanghyangresort/p/Batch1${ts}/`;
    const postUrl2 = `https://www.instagram.com/astonanyer/reel/Batch2${ts}/`;
    const createdRunIds: string[] = [];
    let createdRunId: string | null = null;

    try {
      // Batch 1 (belum finalize): ScrapeRun harus terbuka (finishedAt null)
      const res1 = await POST(
        new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
          method: "POST",
          headers: { cookie, origin: "http://localhost:3001", "content-type": "application/json" },
          body: JSON.stringify({
            syncRunId: null,
            finalizeRun: false,
            posts: [
              {
                targetType: "own",
                outletKey: "resort",
                account: "sanghyangresort",
                platform: "instagram",
                postType: "feed",
                sourceUrl: postUrl1,
                postedAt: "2026-11-17T08:00:00.000Z",
                caption: "Promo kamar tepi pantai Sanghyang",
                metrics: { views: null, likes: 15, comments: 0, shares: null },
                comments: [],
              },
            ],
          }),
        }),
      );
      assert.equal(res1.status, 200);
      const j1 = await res1.json();
      createdRunId = j1.syncRunId;
      if (typeof createdRunId === "string") createdRunIds.push(createdRunId);
      const runMid = await db.scrapeRun.findUnique({ where: { id: createdRunId! } });
      assert.equal(runMid?.status, "running");
      assert.equal(runMid?.finishedAt, null, "Batch 1 tanpa finalizeRun tidak boleh menutup ScrapeRun terlalu cepat");

      // Batch 2 (pakai syncRunId yang sama + finalizeRun: true + komentar kompetitor resort)
      const res2 = await POST(
        new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
          method: "POST",
          headers: { cookie, origin: "http://localhost:3001", "content-type": "application/json" },
          body: JSON.stringify({
            syncRunId: createdRunId,
            finalizeRun: true,
            posts: [
              {
                targetType: "competitor",
                competitorId: comp.id,
                outletKey: "resort",
                account: "astonanyer",
                platform: "instagram",
                postType: "reels",
                sourceUrl: postUrl2,
                postedAt: "2026-11-17T09:00:00.000Z",
                caption: "Early Bird Staycation Anyer",
                metrics: { views: 417, likes: 21, comments: 1, shares: 7 },
                comments: [
                  {
                    commentToken: `tok-batch2-${ts}`,
                    text: "Kolam renang dan kamarnya sangat nyaman untuk liburan keluarga",
                    commentAt: "2026-11-17T11:00:00.000Z",
                  },
                ],
              },
            ],
          }),
        }),
      );
      assert.equal(res2.status, 200);
      const j2 = await res2.json();
      assert.equal(j2.syncRunId, createdRunId, "Batch 2 harus memperbarui ScrapeRun yang sama");
      const runDone = await db.scrapeRun.findUnique({ where: { id: createdRunId! } });
      assert.equal(runDone?.status, "success");
      assert.ok(runDone?.finishedAt !== null);

      const savedRev = await db.competitorReview.findFirst({ where: { sourceUrl: postUrl2 } });
      assert.ok(savedRev);
      assert.ok(!savedRev.themes.includes("resort"), "komentar sosmed kompetitor tidak boleh disusupi outletKey Sanghyang");

      const sumRes = await GET_SUMMARY(
        new NextRequest("http://localhost:3001/api/market-intelligence/summary?period=30d&segment=all", {
          headers: { cookie },
        }),
      );
      assert.equal(sumRes.status, 200);
      const sumJson = await sumRes.json();
      const resortOutlet = sumJson.outlets.find((o: { key: string }) => o.key === "resort");
      assert.ok(resortOutlet);
      const matchedCard = resortOutlet.reviews.find((r: { sourceUrl: string }) => r.sourceUrl === postUrl2);
      assert.ok(!matchedCard, "komentar Instagram kompetitor tidak boleh bocor ke ulasan resort Sanghyang");

      // Promo terkurasi Gemini tidak boleh ditimpa judul mentah IG saat re-sync sourceUrl sama
      const postUrl3 = `https://www.instagram.com/astonanyer/reel/UjiKurasi${ts}/`;
      const curatedPromo = await db.competitorPromotion.create({
        data: {
          competitorId: comp.id,
          title: "Judul Kurasi Gemini Khusus Uji",
          category: "Kamar & Menginap",
          description: "Ringkasan terkurasi.\nVersi kita: Penawaran pembanding.",
          startsAt: new Date("2026-11-10T00:00:00.000Z"),
          source: "Instagram (dibaca Gemini)",
          sourceUrl: postUrl3,
          kind: "promo",
          capturedAt: new Date("2026-11-10T00:00:00.000Z"),
          status: "new",
          version: 1,
        },
      });
      try {
        const resCurated = await POST(
          new NextRequest("http://localhost:3001/api/marketing-sosmed/browser-sync", {
            method: "POST",
            headers: { cookie, origin: "http://localhost:3001", "content-type": "application/json" },
            body: JSON.stringify({
              syncRunId: null,
              finalizeRun: true,
              posts: [
                {
                  targetType: "competitor",
                  competitorId: comp.id,
                  outletKey: "resort",
                  account: "astonanyer",
                  platform: "instagram",
                  postType: "reels",
                  sourceUrl: postUrl3,
                  postedAt: "2026-11-17T09:00:00.000Z",
                  caption: "Teks mentah tidak boleh menimpa judul kurasi",
                  metrics: { views: null, likes: 1, comments: 0, shares: null },
                  comments: [],
                },
              ],
            }),
          }),
        );
        assert.equal(resCurated.status, 200);
        const jCurated = await resCurated.json();
        if (typeof jCurated.syncRunId === "string") createdRunIds.push(jCurated.syncRunId);
        const afterCurated = await db.competitorPromotion.findUnique({ where: { id: curatedPromo.id } });
        assert.equal(afterCurated?.title, "Judul Kurasi Gemini Khusus Uji");
      } finally {
        await db.competitorPromotion.deleteMany({ where: { id: curatedPromo.id } });
      }
    } finally {
      await db.competitorReview.deleteMany({ where: { sourceUrl: postUrl2 } });
      await db.competitorPromotion.deleteMany({ where: { sourceUrl: { in: [postUrl1, postUrl2] } } });
      if (createdRunIds.length > 0) {
        await db.scrapeError.deleteMany({ where: { runId: { in: createdRunIds } } });
        await db.scrapeRun.deleteMany({ where: { id: { in: createdRunIds } } });
      }
    }
  }
});

// Urutan feed nyata: 47 postingan akun Instagram resmi Sanghyang hasil crawl 10 Nov 2026 (lib/market/marketing-sosmed.data.json),
// terbaru dulu seperti grid profil.
async function realProfileFeed() {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const data = (await import("../../src/lib/market/marketing-sosmed.data.json")).default as {
    posts: { url: string; postedAt: string; likes?: number | null }[];
  };
  return [...data.posts]
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .map((p) => ({
      sourceUrl: parsers.canonicalizeSocialPostUrl(p.url, "instagram") as string,
      postType: p.url.includes("/reel/") ? "reels" : "feed",
      gridViews: null,
      gridLikes: p.likes ?? null,
      gridComments: null,
      imageUrl: null,
    }));
}

const SCAN_TUNING = { staleRounds: 3, minItemsPerRound: 3, maxRoundsUnknown: 400 };

test("sinkron profil menggulir sampai postingan paling awal: grid bervirtualisasi dikumpulkan per putaran", async () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const feed = await realProfileFeed();
  assert.equal(feed.length, 47);
  assert.ok(feed.every((f) => typeof f.sourceUrl === "string" && f.sourceUrl.startsWith("https://www.instagram.com/")));

  // DOM hanya memuat 12 kartu sekaligus dan bergeser 6 kartu tiap gulir (baris lama dibuang seperti grid bervirtualisasi).
  const virtualGrid = () => {
    let start = 0;
    return {
      collect: () => feed.slice(start, start + 12),
      advance: async () => {
        start = Math.min(start + 6, feed.length - 12);
      },
    };
  };

  const byCount = virtualGrid();
  const res = await parsers.collectFeedItems({ ...byCount, maxItems: 0, expectedTotal: feed.length, ...SCAN_TUNING });
  assert.equal(res.collected, 47, "semua postingan terkumpul, bukan hanya 12 kartu yang tersisa di DOM");
  assert.equal(res.stoppedBy, "expected");
  assert.equal(res.items[res.items.length - 1].sourceUrl, feed[feed.length - 1].sourceUrl, "postingan paling awal ikut terbaca");
  assert.equal(byCount.collect().length, 12, "membaca DOM sekali di akhir hanya mendapat 12 kartu");

  // Jumlah postingan profil tidak tertulis: berhenti setelah grid tidak bertambah 3 putaran berturut-turut.
  const byStale = virtualGrid();
  const stale = await parsers.collectFeedItems({ ...byStale, maxItems: 0, expectedTotal: null, ...SCAN_TUNING });
  assert.equal(stale.collected, 47);
  assert.equal(stale.stoppedBy, "stale");

  const limited = await parsers.collectFeedItems({ ...virtualGrid(), maxItems: 5, expectedTotal: feed.length, ...SCAN_TUNING });
  assert.equal(limited.items.length, 5);
  assert.equal(limited.stoppedBy, "limit");

  const blocked = await parsers.collectFeedItems({ ...virtualGrid(), isBlocked: () => true, maxItems: 0, expectedTotal: feed.length, ...SCAN_TUNING });
  assert.equal(blocked.stoppedBy, "blocked");
  assert.equal(blocked.rounds, 0);

  // Feed yang terus bertambah tanpa jumlah tertulis berhenti di batas putaran dan melaporkannya.
  let grow = 12;
  const endless = await parsers.collectFeedItems({
    collect: () => Array.from({ length: grow }, (_, i) => ({ ...feed[i % feed.length], sourceUrl: `${feed[i % feed.length].sourceUrl}?putaran=${i}` })),
    advance: async () => {
      grow += 6;
    },
    maxItems: 0,
    expectedTotal: null,
    ...SCAN_TUNING,
    maxRoundsUnknown: 4,
  });
  assert.equal(endless.stoppedBy, "maxRounds");
  assert.equal(endless.rounds, 4);

  // Angka grid yang baru muncul di putaran berikutnya digabung ke item yang sama, tidak digandakan.
  const first = { ...feed[0], gridViews: null };
  const later = { ...feed[0], gridViews: 1400 };
  let turn = 0;
  const merged = await parsers.collectFeedItems({
    collect: () => (turn === 0 ? [first] : [later]),
    advance: async () => {
      turn++;
    },
    maxItems: 0,
    expectedTotal: null,
    ...SCAN_TUNING,
  });
  assert.equal(merged.collected, 1);
  assert.equal(merged.items[0].gridViews, 1400);
});

test("profil Instagram dan TikTok: pengikut dan jumlah postingan terbaca sebagai target gulir", () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const docWithMeta = (content: string) => ({
    querySelector: (sel: string) =>
      sel.includes("og:description") ? { getAttribute: (k: string) => (k === "content" ? content : null) } : null,
    querySelectorAll: () => [],
  });
  // Angka pengikut @sanghyangresort hasil sinkron 16 Nov 2026 di DB lokal (7.822).
  assert.deepEqual(
    parsers.extractInstagramProfileMeta(docWithMeta("7,822 Followers, 159 Following, 1,234 Posts - See Instagram photos and videos from Sanghyang (@sanghyangresort)")),
    { followers: 7822, posts: 1234 },
  );
  assert.deepEqual(
    parsers.extractInstagramProfileMeta(docWithMeta("7.822 Pengikut, 159 Mengikuti, 1.234 Postingan - Lihat foto dan video Instagram dari Sanghyang")),
    { followers: 7822, posts: 1234 },
  );
  assert.deepEqual(parsers.extractInstagramProfileMeta(docWithMeta("")), { followers: null, posts: null });

  const ttDoc = {
    querySelector: (sel: string) =>
      sel === "#__UNIVERSAL_DATA_FOR_REHYDRATION__"
        ? { textContent: JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo: { stats: { followerCount: 5123, videoCount: 87 } } } } }) }
        : null,
    querySelectorAll: () => [],
  };
  assert.deepEqual(parsers.extractTikTokProfileMeta(ttDoc), {
    followers: 5123,
    posts: 87,
    isEmptyProfile: false,
    notFound: false,
  });
});

test("metrik postingan lama diperbarui per bidang: angka baru menggantikan, bacaan kosong tidak menghapus angka lama", async () => {
  const { mergeObservedMetrics } = await import("../../src/lib/market/browser-social-sync");
  const before = { views: 1200, likes: 45, comments: 3, shares: null };
  assert.deepEqual(mergeObservedMetrics(before, { views: 1850, likes: null, comments: 4, shares: null }), {
    views: 1850,
    likes: 45,
    comments: 4,
    shares: null,
  });
  assert.deepEqual(mergeObservedMetrics(before, { views: null, likes: null, comments: null, shares: null }), before);
  assert.deepEqual(mergeObservedMetrics(null, { views: 10, likes: null, comments: null, shares: 2 }), {
    views: 10,
    likes: null,
    comments: null,
    shares: 2,
  });
  assert.deepEqual(mergeObservedMetrics({ likes: "bukan angka" }, { views: null, likes: null, comments: null, shares: null }), {
    views: null,
    likes: null,
    comments: null,
    shares: null,
  });
});

test("klien ekstensi tidak menanam nomor versi: versi wajib dibaca dari manifest lewat server", async () => {
  const { socialExtensionClient } = await import("../../src/lib/marketing/social-extension-client");
  assert.equal(socialExtensionClient.getSnapshot().requiredVersion, null);
  assert.equal(socialExtensionClient.getSnapshot().assetsMissing, false);
});

test("Vercel file tracing menyertakan berkas ekstensi untuk download dan browser-sync", async () => {
  const nextConfigMod = await import("../../next.config");
  const cfg = nextConfigMod.default as { outputFileTracingIncludes?: Record<string, string[]> };
  const inc = cfg.outputFileTracingIncludes ?? {};
  assert.ok(
    Array.isArray(inc["/api/admin/social-extension/download"]) &&
      inc["/api/admin/social-extension/download"].some((p) => p.includes("extension/sanghyang-social-sync")),
  );
  assert.ok(
    Array.isArray(inc["/api/marketing-sosmed/browser-sync"]) &&
      inc["/api/marketing-sosmed/browser-sync"].some((p) => p.includes("extension/sanghyang-social-sync")),
  );
});

test("antrean sinkron ekstensi: akun resmi Sanghyang (Instagram lalu TikTok) sebelum akun kompetitor, supaya TikTok resmi tidak menunggu 13 akun Instagram", async () => {
  const { buildSocialSyncTargets } = await import("../../src/lib/market/browser-social-sync");
  const { targets } = await buildSocialSyncTargets();
  const groups = targets.map((t) => `${t.targetType}:${t.platform}`);
  const order = ["own:instagram", "own:tiktok", "competitor:instagram", "competitor:tiktok"];
  const firstSeen = order.map((g) => groups.indexOf(g));
  assert.ok(firstSeen.every((i) => i >= 0), `keempat kelompok ada di antrean: ${JSON.stringify(firstSeen)}`);
  // Setiap kelompok utuh dan berurutan: tidak ada target kelompok yang lebih awal muncul sesudah kelompok berikutnya mulai.
  const rank = groups.map((g) => order.indexOf(g));
  for (let i = 1; i < rank.length; i++) assert.ok(rank[i] >= rank[i - 1], `target ${i + 1} (${groups[i]}) keluar urutan sesudah ${groups[i - 1]}`);
});

test("ekstensi menangani TikTok HTTP 403 / Access Denied & 429 tanpa menyimpan postingan kosong dan menyediakan SKIP_TARGET", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  // 1. Halaman Chrome HTTP ERROR 403 (Bahasa Inggris & Indonesia) dan HTTP 429 wajib terdeteksi sebagai error_page
  const tt403En = parsers.detectSocialChallenge({
    url: "https://www.tiktok.com/@dragonbeachclub/video/7666024882114710792",
    title: "www.tiktok.com",
    bodyText: "Access to www.tiktok.com was denied\nYou don't have authorization to view this page.\nHTTP ERROR 403",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(tt403En.blocked, true, "HTTP ERROR 403 TikTok wajib memicu jeda tantangan");
  assert.equal(tt403En.kind, "error_page");
  assert.match(tt403En.reason, /403|Incognito|TikTok/i);

  const tt403Id = parsers.detectSocialChallenge({
    url: "https://www.tiktok.com/@dragonbeachclub/video/7666024882114710792",
    title: "www.tiktok.com",
    bodyText: "Akses ke www.tiktok.com ditolak\nAnda tidak memiliki otorisasi untuk melihat halaman ini.\nHTTP ERROR 403",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(tt403Id.blocked, true, "HTTP 403 berbahasa Indonesia wajib memicu jeda tantangan");
  assert.equal(tt403Id.kind, "error_page");

  const tt429 = parsers.detectSocialChallenge({
    url: "https://www.tiktok.com/@dragonbeachclub",
    title: "429 Too Many Requests",
    bodyText: "HTTP ERROR 429 Too Many Requests",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(tt429.blocked, true);
  assert.equal(tt429.kind, "error_page");

  // 2. Halaman video TikTok kosong / 403 tanpa rehydration JSON maupun metrik DOM wajib mengembalikan null (Zero Fallback)
  const emptyDoc = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const hollow = parsers.extractTikTokVideoDetail(
    emptyDoc,
    "https://www.tiktok.com/@dragonbeachclub/video/7666024882114710792",
    { gridViews: 500 },
    ["dragonbeachclub"],
    Date.parse("2026-11-24T09:00:00Z"),
  );
  assert.equal(hollow, null, "Halaman error TikTok kosong tidak boleh menghasilkan objek postingan hampa");

  // 3. background.js wajib menangkap error frame Chrome ("showing error page" / "chrome-error") sebagai jeda error_page + mendukung SKIP_TARGET
  const bg = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");
  assert.match(bg, /showing error page|error page/i, "background.js wajib menangkap galat executeScript pada halaman HTTP 403 Chrome");
  assert.match(bg, /incognito/i, "background.js wajib memberi petunjuk jelas jika tab terbuka di mode Incognito");
  assert.match(bg, /SKIP_TARGET/, "background.js wajib menyediakan perintah SKIP_TARGET agar pengguna bisa melewati akun yang dibatasi");
});

test("ekstensi & backend mencegah sinkron sosmed terpotong: deteksi dinding login IG 12-post, #scrollview, kolaborasi resmi, TikTok /photo/, dan profilePostsTotal", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  // 1. Dinding login Instagram 2026 tanpa input[name=username] (mode Incognito / belum login memotong profil di ~12 postingan)
  const igGuestWall = parsers.detectSocialChallenge({
    url: "https://www.instagram.com/dragonbeachclub/",
    title: "Dragon Beach Club & Karaoke (@dragonbeachclub) • Instagram photos and videos",
    bodyText: "Log In Sign Up dragonbeachclub 5,124 followers Show more posts from dragonbeachclub",
    dialogText: "See photos, videos and more from dragonbeachclub Sign up and never miss a post from dragonbeachclub. Sign up Log in",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(igGuestWall.blocked, true, "dinding 12-postingan Instagram tanpa login wajib terdeteksi dan menjeda sinkronisasi");
  assert.equal(igGuestWall.kind, "login");
  assert.match(igGuestWall.reason, /12|login|Incognito/i);

  const igShowMoreWall = parsers.detectSocialChallenge({
    url: "https://www.instagram.com/dbistro.anyer/",
    title: "D'Bistro Restaurant (@dbistro.anyer)",
    bodyText: "Log In Sign Up dbistro.anyer Show more posts from dbistro.anyer",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(igShowMoreWall.blocked, true, "tautan 'Show more posts from' saat belum login wajib memicu jeda login");
  assert.equal(igShowMoreWall.kind, "login");

  // 2. Shortcode helper + pelestarian kolaborasi resmi lintas outlet Sanghyang (tetap menolak pihak ketiga seperti kiranaliu99)
  assert.equal(parsers.instagramShortcodeFromUrl("https://www.instagram.com/sanghyangresort/reel/DgAA8cYSZib/"), "DgAA8cYSZib");
  assert.equal(parsers.instagramShortcodeFromUrl("https://www.instagram.com/dragonbeachclub/reel/DgAA8cYSZib/"), "DgAA8cYSZib");
  assert.equal(parsers.instagramShortcodeFromUrl("https://www.instagram.com/p/Df-87YXEsC7/"), "Df-87YXEsC7");

  const mkAnchor = (href: string, text = "") => ({
    getAttribute: (k: string) => (k === "href" ? href : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: text,
    innerText: text,
    closest: () => null,
    parentElement: null,
  });
  const collabDoc = {
    querySelectorAll: () => [
      mkAnchor("/dragonbeachclub/reel/DfL-JyBhOvd/"),
      mkAnchor("/sanghyangresort/reel/DgAA8cYSZib/"),
      mkAnchor("/kiranaliu99/reel/C10zP-AvJoN/"),
    ],
  };
  const kept = parsers.extractInstagramProfileItems(collabDoc, 0, "dragonbeachclub", ["sanghyangresort", "dragonbeachclub", "dbistro.anyer"]);
  assert.equal(kept.length, 2, "postingan sendiri + kolaborasi akun resmi Sanghyang wajib ikut tersinkron, pihak ketiga tetap ditolak");
  assert.ok(kept.some((x: { sourceUrl: string }) => x.sourceUrl.includes("DgAA8cYSZib")));
  assert.ok(!kept.some((x: { sourceUrl: string }) => x.sourceUrl.includes("kiranaliu99")));

  // 3. TikTok /photo/ carousel didukung penuh di parser ekstensi, canonicalizeVerifiedSocialUrl, dan isVerifiedReviewSource
  const ttPhotoUrl = "https://www.tiktok.com/@dragonbeachclub/photo/7555358674382769419?is_from_webapp=1";
  assert.equal(
    parsers.canonicalizeSocialPostUrl(ttPhotoUrl, "tiktok"),
    "https://www.tiktok.com/@dragonbeachclub/photo/7555358674382769419",
  );
  assert.equal(isVerifiedReviewSource("https://www.tiktok.com/@dragonbeachclub/photo/7555358674382769419"), true);

  const ttProfileDoc = {
    querySelectorAll: () => [
      mkAnchor("/@dragonbeachclub/video/7662293096746552597"),
      mkAnchor("/@dragonbeachclub/photo/7555358674382769419"),
      mkAnchor("/@akun_lain_saran/video/9999999999999999999"),
    ],
  };
  const ttItems = parsers.extractTikTokProfileItems(ttProfileDoc, 0, "dragonbeachclub");
  assert.equal(ttItems.length, 2, "video dan photo milik akun target ikut diambil; saran akun lain disaring");
  assert.equal(ttItems[1].postType, "carousel");

  // 4. Fallback statsV2.videoCount pada extractTikTokProfileMeta
  const ttMetaV2Doc = {
    querySelector: (sel: string) =>
      sel === "#__UNIVERSAL_DATA_FOR_REHYDRATION__"
        ? { textContent: JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo: { statsV2: { followerCount: "2193", videoCount: "116" } } } } }) }
        : null,
    querySelectorAll: () => [],
  };
  assert.deepEqual(parsers.extractTikTokProfileMeta(ttMetaV2Doc), {
    followers: 2193,
    posts: 116,
    isEmptyProfile: false,
    notFound: false,
  });

  // 5. content-social.js wajib menggulir kontainer #scrollview/overflow dan mendukung /photo/ TikTok
  const contentSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/content-social.js"), "utf8");
  assert.match(contentSrc, /#scrollview|findScrollTargets/, "content-social.js wajib menggulir kontainer scroll nyata Instagram (#scrollview)");
  assert.match(contentSrc, /\/photo\//, "content-social.js wajib mengenali tautan /photo/ TikTok");

  // 6. background.js wajib menjaga batas cakupan (tidak diam-diam sukses 0/N), memakai shortcode saat gabung Reels, dan tidak keliru mencocokkan /reels ke profil
  const bgSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");
  assert.doesNotMatch(bgSrc, /!expectedPath\.includes\(curPath\)/, "navigateAndWaitComplete tidak boleh menganggap URL profil selesai untuk /reels/");
  assert.match(bgSrc, /profilePostsTotal/, "background.js wajib meneruskan total postingan profil asli ke server");
  assert.match(bgSrc, /knownPostUrls/, "background.js wajib mendukung sinkronisasi inkremental agar akun ribuan postingan bisa tuntas");

  // 7. Backend sanitizeBrowserSyncPayload menerima profilePostsTotal & TikTok /photo/ serta buildSocialSyncTargets mengembalikan knownPostUrls
  const { buildSocialSyncTargets, canonicalizeVerifiedSocialUrl, sanitizeBrowserSyncPayload } = await import("../../src/lib/market/browser-social-sync");
  assert.equal(
    canonicalizeVerifiedSocialUrl(ttPhotoUrl, "tiktok"),
    "https://www.tiktok.com/@dragonbeachclub/photo/7555358674382769419",
  );
  const sanitized = sanitizeBrowserSyncPayload(
    {
      posts: [
        {
          targetType: "own",
          outletKey: "dragon-beach-club",
          account: "dragonbeachclub",
          followers: 5124,
          profilePostsTotal: 1350,
          platform: "tiktok",
          postType: "carousel",
          sourceUrl: ttPhotoUrl,
          postedAt: "2026-11-20T08:00:00.000Z",
          caption: "Galeri malam Dragon Beach Club Anyer",
          metrics: { views: 2500, likes: 95, comments: 4, shares: 2 },
          comments: [],
        },
      ],
    },
    ["dragonbeachclub"],
    new Date("2026-11-24T10:00:00.000Z"),
  );
  assert.equal(sanitized.posts[0].profilePostsTotal, 1350);
  assert.equal(sanitized.posts[0].postType, "carousel");

  const meta = await buildSocialSyncTargets();
  assert.ok(Array.isArray(meta.knownPostUrls), "buildSocialSyncTargets wajib mengembalikan daftar knownPostUrls untuk sinkronisasi inkremental");
});

test("v1.1.5 regresi gulir & dinding login IG: spinner height tidak memutus tunggu, deteksi ID/EN >4000 char, tombol button login, dan versi 1.1.5", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const { loadExtensionManifestInfo } = await import("../../src/lib/market/extension-zip");

  // 1. Versi manifest wajib 1.1.11 dengan key & Extension ID tetap
  const info = loadExtensionManifestInfo();
  assert.equal(info.manifest.version, "1.1.11");

  // 2. Dinding login IG berbahasa Indonesia asli 2026 ("Tampilkan postingan lainnya dari", "Lihat foto, video, dan banyak lagi", "Daftar dan jangan lewatkan postingan")
  const igIdBodyWall = parsers.detectSocialChallenge({
    url: "https://www.instagram.com/dragonbeachclub/",
    title: "Dragon Beach Club & Karaoke (@dragonbeachclub) • Foto dan video Instagram",
    bodyText: "Masuk\nDaftar\ndragonbeachclub\n5.124 pengikut\nTampilkan postingan lainnya dari dragonbeachclub",
    dialogText: "",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(igIdBodyWall.blocked, true, "teks 'Tampilkan postingan lainnya dari' wajib terdeteksi sebagai dinding login IG");
  assert.equal(igIdBodyWall.kind, "login");

  const igIdDialogWall = parsers.detectSocialChallenge({
    url: "https://www.instagram.com/dragonbeachclub/",
    title: "Dragon Beach Club & Karaoke (@dragonbeachclub)",
    bodyText: "dragonbeachclub\n5.124 pengikut",
    dialogText: "Lihat foto, video, dan banyak lagi dari dragonbeachclub\nDaftar dan jangan lewatkan postingan dari dragonbeachclub.\nDaftar\nMasuk",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(igIdDialogWall.blocked, true, "dialog 'Lihat foto, video, dan banyak lagi' wajib terdeteksi sebagai dinding login IG");
  assert.equal(igIdDialogWall.kind, "login");

  // Profil IG yang sudah login (tanpa banner/dialog tamu) tidak boleh false-positive
  const igLoggedInClean = parsers.detectSocialChallenge({
    url: "https://www.instagram.com/dragonbeachclub/",
    title: "Dragon Beach Club & Karaoke (@dragonbeachclub) • Foto dan video Instagram",
    bodyText: "dragonbeachclub\n1.350 kiriman\n5.124 pengikut\n1.810 diikuti\nA Nightlife Experience\nBeranda\nCari\nReels\nPesan\nProfil",
    dialogText: "",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(igLoggedInClean.blocked, false, "profil Instagram yang sudah login tidak boleh memicu false-positive dinding login");

  // 3. collectFeedItems meneruskan konteks (seenUrls, stale, hasNewItem) ke advance()
  const seenContexts: { round: number; stale: number; collected: number; hasNewItemType: string }[] = [];
  let cursor = 0;
  const rows = [
    { sourceUrl: "https://www.instagram.com/p/PostA1/", postType: "feed" },
    { sourceUrl: "https://www.instagram.com/p/PostA2/", postType: "feed" },
    { sourceUrl: "https://www.instagram.com/p/PostA3/", postType: "feed" },
  ];
  await parsers.collectFeedItems({
    collect: () => rows.slice(0, cursor + 1),
    advance: async (ctx: { round: number; stale: number; collected: number; hasNewItem: () => boolean }) => {
      assert.ok(ctx && typeof ctx === "object", "collectFeedItems wajib meneruskan objek konteks ke advance()");
      seenContexts.push({
        round: ctx.round,
        stale: ctx.stale,
        collected: ctx.collected,
        hasNewItemType: typeof ctx.hasNewItem,
      });
      if (cursor === 0) {
        assert.equal(ctx.hasNewItem(), false, "sebelum kartu baru masuk DOM, hasNewItem() harus false");
      }
      cursor = Math.min(cursor + 1, rows.length - 1);
      if (ctx.round === 1) {
        assert.equal(ctx.hasNewItem(), true, "sesudah URL baru masuk DOM, hasNewItem() harus true");
      }
    },
    maxItems: 0,
    expectedTotal: 3,
    staleRounds: 2,
    minItemsPerRound: 1,
    maxRoundsUnknown: 10,
  });
  assert.equal(seenContexts.length, 2);
  assert.equal(seenContexts[0].hasNewItemType, "function");

  // 4. Jalankan content-social.js nyata di VM:
  //    (a) inspectChallengeNow menangkap dinding login di ujung bodyText (>4500 karakter)
  //    (b) detectLoggedOutNav menangkap tombol <button>Masuk</button> tanpa <a href="/accounts/login">
  //    (c) scrollAndWaitForGrowth TIDAK boleh selesai dini karena tinggi spinner bertambah, dan baru selesai saat URL baru muncul
  const contentSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/content-social.js"), "utf8");
  const observers: { cb: () => void; active: boolean }[] = [];
  class FakeMutationObserver {
    private cb: () => void;
    private rec: { cb: () => void; active: boolean };
    constructor(cb: () => void) {
      this.cb = cb;
      this.rec = { cb, active: false };
      observers.push(this.rec);
    }
    observe() {
      this.rec.active = true;
    }
    disconnect() {
      this.rec.active = false;
    }
  }
  const triggerMutation = () => {
    for (const o of [...observers]) {
      if (o.active) o.cb();
    }
  };

  class FakeHTMLElement {
    tagName = "DIV";
    id = "";
    scrollTop = 0;
    scrollHeight = 2000;
    clientHeight = 900;
    innerText = "";
    textContent = "";
    attrs: Record<string, string> = {};
    parentElement: FakeHTMLElement | null = null;
    scrollIntoViewCalls: unknown[] = [];
    dispatchedEvents: string[] = [];
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    }
    scrollIntoView(opts?: unknown) {
      this.scrollIntoViewCalls.push(opts);
    }
    dispatchEvent(ev: { type?: string }) {
      this.dispatchedEvents.push(String(ev?.type || ""));
      return true;
    }
    querySelectorAll() {
      return [];
    }
    querySelector() {
      return null;
    }
  }

  const scrollviewEl = new FakeHTMLElement();
  scrollviewEl.id = "scrollview";
  scrollviewEl.scrollHeight = 2000;
  scrollviewEl.clientHeight = 900;

  let currentAnchors: FakeHTMLElement[] = [];
  const makeAnchorEl = (href: string) => {
    const a = new FakeHTMLElement();
    a.tagName = "A";
    a.attrs = { href };
    a.parentElement = scrollviewEl;
    return a;
  };
  currentAnchors = Array.from({ length: 12 }, (_, i) => makeAnchorEl(`/dragonbeachclub/p/PostInit${i}/`));

  let bodyTextValue = `${"A".repeat(4600)}\nTampilkan postingan lainnya dari dragonbeachclub`;
  const navLoginBtn = new FakeHTMLElement();
  navLoginBtn.tagName = "BUTTON";
  navLoginBtn.innerText = "Masuk";
  navLoginBtn.textContent = "Masuk";

  let windowScrollY = 0;
  const fakeDoc = {
    title: "Dragon Beach Club (@dragonbeachclub)",
    hidden: false,
    readyState: "complete",
    body: {
      get innerText() {
        return bodyTextValue;
      },
      scrollHeight: 900,
      clientHeight: 900,
      scrollTop: 0,
    },
    documentElement: {
      scrollHeight: 900,
      clientHeight: 900,
      scrollTop: 0,
    },
    scrollingElement: scrollviewEl,
    querySelector: (sel: string) => {
      if (sel === "#scrollview") return scrollviewEl;
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes('a[href*="/p/"]')) return currentAnchors;
      if (sel.includes("header") && sel.includes("button")) return [navLoginBtn];
      return [];
    },
  };

  const sandbox: Record<string, unknown> = {
    SanghyangParsers: parsers,
    document: fakeDoc,
    window: {
      location: { href: "https://www.instagram.com/dragonbeachclub/", pathname: "/dragonbeachclub/" },
      scrollTo: (opts: { top?: number }) => {
        if (typeof opts?.top === "number") windowScrollY = opts.top;
      },
      scrollBy: (_x: number, y: number) => {
        windowScrollY = Math.max(0, windowScrollY + y);
      },
      getComputedStyle: () => ({ overflowY: "auto" }),
      dispatchEvent: () => true,
    },
    HTMLElement: FakeHTMLElement,
    MutationObserver: FakeMutationObserver,
    Event: class FakeEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    WheelEvent: class FakeWheelEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    Set,
    Map,
    Array,
    Math,
    Boolean,
    Number,
    String,
    RegExp,
    globalThis: {} as Record<string, unknown>,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(contentSrc, sandbox);

  const hooks = sandbox.__sanghyangContentTestHooks as
    | {
        inspectChallengeNow: () => { blocked: boolean; kind: string | null };
        detectLoggedOutNav: () => boolean;
        scrollAndWaitForGrowth: (
          platform: string,
          ctx: { stale: number; hasNewItem: () => boolean; waitMs?: number },
        ) => Promise<void>;
      }
    | undefined;
  assert.ok(hooks, "content-social.js wajib menyediakan __sanghyangContentTestHooks untuk verifikasi perilaku DOM nyata");

  // (a) Dinding login di ekor bodyText > 4500 char wajib tertangkap
  const tailChallenge = hooks.inspectChallengeNow();
  assert.equal(tailChallenge.blocked, true, "dinding login di akhir bodyText (>4000 karakter) tidak boleh terpotong slice(0, 4000)");
  assert.equal(tailChallenge.kind, "login");

  // (b) Tombol login berbentuk <button>Masuk</button> tanpa <a href="/accounts/login"> wajib terdeteksi
  assert.equal(hooks.detectLoggedOutNav(), true, "tombol <button>Masuk</button> di header/nav wajib terdeteksi sebagai logged-out nav");

  // (c) Uji perilaku scrollAndWaitForGrowth terhadap spinner height jitter vs URL postingan baru
  bodyTextValue = "dragonbeachclub\n1.350 kiriman\n5.124 pengikut";
  const seenSet = new Set(currentAnchors.map((a) => `https://www.instagram.com${a.getAttribute("href")}`));
  const hasNewItem = () =>
    currentAnchors.some((a) => {
      const u = `https://www.instagram.com${a.getAttribute("href")}`;
      return !seenSet.has(u);
    });

  let resolvedAtMs = 0;
  const startedAt = Date.now();
  const waitPromise = hooks.scrollAndWaitForGrowth("instagram", { stale: 0, hasNewItem, waitMs: 400 }).then(() => {
    resolvedAtMs = Date.now() - startedAt;
  });

  // t=25ms: Instagram menyisipkan spinner 60px (height naik 2000 -> 2060) TANPA URL baru
  await new Promise((r) => setTimeout(r, 25));
  scrollviewEl.scrollHeight = 2060;
  triggerMutation();
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(resolvedAtMs, 0, "scrollAndWaitForGrowth TIDAK boleh selesai dini hanya karena tinggi spinner bertambah +60px");

  // t=90ms: GraphQL mengembalikan postingan baru -> langsung selesai segera (jauh sebelum waitMs 400ms)
  await new Promise((r) => setTimeout(r, 30));
  currentAnchors.push(makeAnchorEl("/dragonbeachclub/p/PostBaru13/"));
  triggerMutation();
  await waitPromise;
  assert.ok(resolvedAtMs >= 80 && resolvedAtMs < 350, `harus selesai tepat sesudah URL baru masuk (${resolvedAtMs}ms), bukan di 25ms maupun timeout 400ms`);

  // Pastikan scrollIntoView terakhir bukan { block: "end" } yang menarik gulir mundur di atas sentinel
  const firstLastAnchor = currentAnchors[11];
  assert.ok(
    !firstLastAnchor.scrollIntoViewCalls.some((c) => typeof c === "object" && c !== null && (c as { block?: string }).block === "end"),
    'scrollAndWaitForGrowth tidak boleh memanggil scrollIntoView({ block: "end" }) yang menyembunyikan sentinel di bawah viewport',
  );
});

test("v1.1.5 regresi background.js: jeda Incognito instan, navigasi TikTok 35s + readyState interactive + retry 1x, dan tidak diam-diam lewati TikTok 0 item", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const bgSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");

  type TabRecord = { id: number; url: string; status: string; incognito: boolean; windowId: number; active: boolean };
  function loadBgHarness(opts: {
    windows?: { id: number; incognito: boolean }[];
    onCreateTab?: (createOpts: Record<string, unknown>, tab: TabRecord) => void;
    onUpdateTab?: (tabId: number, updateOpts: Record<string, unknown>, tab: TabRecord) => void;
    onExecuteScript?: (arg: { target: { tabId: number }; func?: (...a: unknown[]) => unknown; args?: unknown[]; files?: string[] }) => unknown;
  }) {
    const storageMap = new Map<string, unknown>();
    const tabs = new Map<number, TabRecord>();
    let nextTabId = 100;
    const onUpdatedListeners = new Set<(tabId: number, info: { status?: string; url?: string }, tab: TabRecord) => void>();
    const createCalls: Record<string, unknown>[] = [];
    const updateCalls: { tabId: number; opts: Record<string, unknown> }[] = [];

    const emitTabUpdated = (tabId: number, info: { status?: string; url?: string }) => {
      const tab = tabs.get(tabId);
      if (!tab) return;
      if (info.status) tab.status = info.status;
      if (info.url) tab.url = info.url;
      for (const fn of [...onUpdatedListeners]) fn(tabId, info, { ...tab });
    };

    const fakeChrome = {
      storage: {
        local: {
          get: async (k: string) => ({ [k]: storageMap.get(k) }),
          set: async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) storageMap.set(k, v);
          },
        },
      },
      windows: {
        getAll: async () => opts.windows ?? [{ id: 1, incognito: false }],
        update: async () => ({}),
      },
      tabs: {
        get: async (id: number) => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          return { ...t };
        },
        create: async (createOpts: Record<string, unknown>) => {
          createCalls.push(createOpts);
          const win = (opts.windows ?? [{ id: 1, incognito: false }]).find((w) => w.id === createOpts.windowId) ??
            (opts.windows ?? [{ id: 1, incognito: false }])[0];
          const tab: TabRecord = {
            id: nextTabId++,
            url: String(createOpts.url || ""),
            status: "loading",
            incognito: Boolean(win?.incognito),
            windowId: typeof createOpts.windowId === "number" ? createOpts.windowId : (win?.id ?? 1),
            active: Boolean(createOpts.active),
          };
          tabs.set(tab.id, tab);
          opts.onCreateTab?.(createOpts, tab);
          return { ...tab };
        },
        update: async (tabId: number, updateOpts: Record<string, unknown>) => {
          updateCalls.push({ tabId, opts: updateOpts });
          const tab = tabs.get(tabId);
          if (!tab) throw new Error("No tab");
          if (typeof updateOpts.url === "string") tab.url = updateOpts.url;
          if (typeof updateOpts.active === "boolean") tab.active = updateOpts.active;
          opts.onUpdateTab?.(tabId, updateOpts, tab);
          return { ...tab };
        },
        remove: async (tabId: number) => {
          tabs.delete(tabId);
        },
        onUpdated: {
          addListener: (fn: (tabId: number, info: { status?: string; url?: string }, tab: TabRecord) => void) =>
            onUpdatedListeners.add(fn),
          removeListener: (fn: (tabId: number, info: { status?: string; url?: string }, tab: TabRecord) => void) =>
            onUpdatedListeners.delete(fn),
        },
      },
      scripting: {
        executeScript: async (arg: { target: { tabId: number }; func?: (...a: unknown[]) => unknown; args?: unknown[]; files?: string[] }) => {
          const res = opts.onExecuteScript ? opts.onExecuteScript(arg) : true;
          return [{ result: res }];
        },
      },
      runtime: {
        getManifest: () => ({ version: "1.1.5" }),
        getURL: (f: string) => `chrome-extension://test/${f}`,
        onMessageExternal: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
    };

    const sandbox: Record<string, unknown> = {
      chrome: fakeChrome,
      URL,
      Set,
      Map,
      Array,
      Math,
      Date,
      Promise,
      Error,
      Boolean,
      Number,
      String,
      RegExp,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      globalThis: {} as Record<string, unknown>,
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(bgSrc, sandbox);
    const hooks = sandbox.__sanghyangBackgroundTestHooks as
      | {
          PROFILE_NAV_TIMEOUT_MS: number;
          POST_NAV_TIMEOUT_MS: number;
          navigateAndWaitComplete: (
            existingTabId: number | null,
            targetUrl: string,
            timeoutMs: number,
            navOpts?: { dashboardWindowId?: number | null; interactivePollMs?: number; interactiveMinElapsedMs?: number },
          ) => Promise<number>;
          navigateWithRetry: (
            existingTabId: number | null,
            targetUrl: string,
            timeoutMs: number,
            navOpts?: { dashboardWindowId?: number | null; interactivePollMs?: number; interactiveMinElapsedMs?: number },
          ) => Promise<number>;
          handleCommand: (msg: Record<string, unknown>, origin: string | null, senderTab?: { id?: number; windowId?: number; incognito?: boolean } | null) => Promise<Record<string, unknown>>;
          readState: () => Promise<Record<string, unknown>>;
        }
      | undefined;
    assert.ok(hooks, "background.js wajib menyediakan __sanghyangBackgroundTestHooks untuk uji perilaku");
    return { hooks, emitTabUpdated, tabs, createCalls, updateCalls };
  }

  // 1. Timeout navigasi TikTok/IG minimal 35000ms + race condition tab sudah complete saat tabs.create selesai
  const h1 = loadBgHarness({
    windows: [{ id: 10, incognito: false }],
    onCreateTab: (_opts, tab) => {
      tab.status = "complete"; // selesai sebelum listener sempat menerima event!
    },
  });
  assert.ok(h1.hooks.PROFILE_NAV_TIMEOUT_MS >= 35_000, "timeout navigasi profil minimal 35 detik untuk TikTok/IG");
  assert.ok(h1.hooks.POST_NAV_TIMEOUT_MS >= 35_000, "timeout navigasi detail postingan minimal 35 detik");
  const resolvedTabId = await h1.hooks.navigateAndWaitComplete(null, "https://www.tiktok.com/@dragonbeachclub", 500, {
    dashboardWindowId: 99,
  });
  assert.equal(typeof resolvedTabId, "number", "tab yang sudah status=complete saat create harus langsung selesai tanpa timeout");
  assert.equal(h1.createCalls[0]?.active, true, "tab pekerja di jendela normal berbeda dari dashboard wajib active=true agar bebas throttling latar belakang");

  // 2. Retry navigasi 1x sebelum gagal (percobaan ke-1 timeout, percobaan ke-2 sukses)
  let navAttempts = 0;
  const h2 = loadBgHarness({
    windows: [{ id: 10, incognito: false }],
    onCreateTab: () => {
      navAttempts++;
    },
    onUpdateTab: (tabId) => {
      navAttempts++;
      setTimeout(() => h2.emitTabUpdated(tabId, { status: "complete" }), 20);
    },
  });
  const retriedId = await h2.hooks.navigateWithRetry(null, "https://www.tiktok.com/@dragonbeachclub", 120);
  assert.equal(typeof retriedId, "number", "retry navigasi ke-2 yang berhasil tidak boleh gagal");
  assert.equal(navAttempts, 2, "harus tepat 1x retry navigasi sesudah timeout pertama");

  // 3. TikTok tetap status=loading dengan readyState=interactive & anchor sudah tampil -> selesai tanpa timeout
  const h3 = loadBgHarness({
    windows: [{ id: 10, incognito: false }],
    onCreateTab: (_opts, tab) => {
      tab.status = "loading";
    },
    onExecuteScript: () => true,
  });
  const interactiveId = await h3.hooks.navigateAndWaitComplete(null, "https://www.tiktok.com/@dragonbeachclub", 600, {
    interactiveMinElapsedMs: 20,
    interactivePollMs: 25,
  });
  assert.equal(typeof interactiveId, "number", "TikTok dengan readyState=interactive dan konten terrender harus selesai tanpa menunggu onload selamanya");

  // 4. Mode Incognito (tab.incognito === true) langsung menjeda sebelum gulir 12 postingan
  let extractorCalledInIncognito = false;
  const h4 = loadBgHarness({
    windows: [{ id: 5, incognito: true }],
    onCreateTab: (_opts, tab) => {
      tab.incognito = true;
      tab.status = "complete";
    },
    onExecuteScript: (arg) => {
      if (arg.args && arg.args[0] === "__sanghyangRunProfile") extractorCalledInIncognito = true;
      return true;
    },
  });
  await h4.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      targets: [
        {
          targetKey: "own:instagram:dragonbeachclub",
          targetType: "own",
          name: "Dragon Beach Club",
          platform: "instagram",
          handle: "dragonbeachclub",
          profileUrl: "https://www.instagram.com/dragonbeachclub/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 5, incognito: true },
  );
  await new Promise((r) => setTimeout(r, 80));
  const stIncog = await h4.hooks.readState();
  assert.equal(stIncog.status, "needs_human_action", "tab pekerja Incognito wajib langsung menjeda sinkronisasi");
  assert.equal(stIncog.pausedKind, "incognito", "pausedKind harus 'incognito' saat tab pekerja berada di mode Incognito");
  assert.match(String(stIncog.pausedReason || ""), /Incognito/i);
  assert.equal(extractorCalledInIncognito, false, "tidak boleh membuang waktu menggulir profil di mode Incognito");

  // 5. TikTok 0 postingan saat expectedTotal=null & followers=null (interstitial "Please wait...") wajib menjeda, bukan diam-diam selesai
  const h5 = loadBgHarness({
    windows: [{ id: 10, incognito: false }],
    onCreateTab: (_opts, tab) => {
      tab.status = "complete";
    },
    onExecuteScript: (arg) => {
      if (arg.args && arg.args[0] === "__sanghyangRunProfile") {
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: null, posts: null },
          isLoggedOutNav: false,
          hadInterstitial: true,
          scan: { rounds: 6, expected: null, collected: 0, stoppedBy: "stale" },
        };
      }
      return true;
    },
  });
  await h5.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      targets: [
        {
          targetKey: "own:tiktok:sanghyangsparesort",
          targetType: "own",
          name: "Akun induk (TikTok)",
          platform: "tiktok",
          handle: "sanghyangsparesort",
          profileUrl: "https://www.tiktok.com/@sanghyangsparesort",
        },
      ],
    },
    "http://localhost:3001",
    { id: 2, windowId: 10, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 80));
  const stTtEmpty = await h5.hooks.readState();
  assert.equal(stTtEmpty.status, "needs_human_action", "TikTok 0 item dengan profil belum terhidrasi wajib menjeda alih-alih diam-diam selesai 0 video");

  // 6. ALLOWED_APP_ORIGINS menerima localhost/127.0.0.1:3001 & produksi sanghyang-analytics.vercel.app dan menolak port 3002/origin luar
  const origins = (h5.hooks as { ALLOWED_APP_ORIGINS?: Set<string> }).ALLOWED_APP_ORIGINS;
  assert.ok(origins instanceof Set, "background.js wajib mengekspos ALLOWED_APP_ORIGINS di test hooks");
  assert.equal(origins.has("http://localhost:3001"), true);
  assert.equal(origins.has("http://127.0.0.1:3001"), true);
  assert.equal(origins.has("http://localhost:3002"), false, "port lama 3002 wajib ditolak setelah konsolidasi ADR-014");
  assert.equal(origins.has("http://127.0.0.1:3002"), false, "port lama 127.0.0.1:3002 wajib ditolak setelah konsolidasi ADR-014");
  assert.equal(origins.has("https://sanghyang-analytics.vercel.app"), true);
  assert.equal(origins.has("https://evil.example"), false);
});

test("v1.1.6 regresi TikTok parser: tanggal 2026 (sunsetgrill.sanghyang · 11-8, 2025-4-6), Snowflake ID, statsV2 string, profil notFound/empty, dan rehydration itemList", async () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const nowMs = Date.parse("2026-11-24T12:00:00.000Z");

  // 1. Format tanggal TikTok 2026: username · 11-8, newline · 11-8, dan YYYY-M-D non-zero-padded (2025-4-6)
  assert.equal(
    parsers.parseSocialDateText("sunsetgrill.sanghyang · 11-8", nowMs),
    "2026-11-08T05:00:00.000Z",
    "format sidebar TikTok 'username · 11-8' wajib terbaca 8 Nov 2026",
  );
  assert.equal(
    parsers.parseSocialDateText("Sunset Grill Sanghyang\n\n· 11-8", nowMs),
    "2026-11-08T05:00:00.000Z",
    "format header TikTok 2026 dengan newline 'Nama\\n\\n· 11-8' wajib terbaca 8 Nov 2026",
  );
  assert.equal(
    parsers.parseSocialDateText("2025-4-6", nowMs),
    "2025-04-06T05:00:00.000Z",
    "format YYYY-M-D tanpa nol depan wajib terbaca",
  );
  assert.equal(
    parsers.parseSocialDateText("sunsetgrill.sanghyang · 2025-4-6", nowMs),
    "2025-04-06T05:00:00.000Z",
    "format username · YYYY-M-D wajib terbaca",
  );
  assert.equal(parsers.parseSocialDateText("sunsetgrill.sanghyang · bukan tanggal", nowMs), null);

  // 2. Ekstraksi timestamp Snowflake 64-bit TikTok (7705662298588859700 >> 32 = 1794114312 = 2026-11-08T05:05:12Z)
  assert.equal(typeof parsers.tiktokTimestampFromVideoId, "function", "parsers wajib mengekspor tiktokTimestampFromVideoId");
  const snowIso = parsers.tiktokTimestampFromVideoId(
    "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
    nowMs,
  );
  assert.equal(snowIso, "2026-11-08T05:05:12.000Z", `Snowflake video 8 Nov 2026 -> ${snowIso}`);
  assert.equal(
    parsers.tiktokTimestampFromVideoId("https://www.tiktok.com/@sunsetgrill.sanghyang/video/741234567890", nowMs),
    null,
    "ID pendek non-64-bit (tahun 1970) wajib ditolak rentang tanggal wajar",
  );

  // 3. Halaman detail TikTok 2026 nyata: tanpa browser-nickname, share-count bertuliskan 'Bagikan', angka di statsV2 string, tanggal TUXText '· 11-8'
  const tt2026Doc = {
    querySelector: (sel: string) => {
      if (sel.includes("#__UNIVERSAL_DATA_FOR_REHYDRATION__")) {
        return {
          textContent: JSON.stringify({
            __DEFAULT_SCOPE__: {
              "webapp.video-detail": {
                itemInfo: {
                  itemStruct: {
                    id: "7705662298588859700",
                    desc: "dasar semua cwk sama aja hmphh #sunset #anyerbeach",
                    statsV2: { playCount: "768", diggCount: "14", commentCount: "1", shareCount: "0" },
                  },
                },
              },
            },
          }),
        };
      }
      if (sel.includes('[data-e2e="share-count"]')) return { textContent: "Bagikan" };
      if (sel.includes('[data-e2e="like-count"]')) return { textContent: "14" };
      if (sel.includes('[data-e2e="comment-count"]')) return { textContent: "1" };
      if (sel.includes('[data-e2e="recommend-list-item-container"]')) {
        return { textContent: "Sunset Grill Sanghyang\n\n· 11-8" };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const detail2026 = parsers.extractTikTokVideoDetail(
    tt2026Doc,
    "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
    null,
    ["sunsetgrill.sanghyang"],
    nowMs,
  );
  assert.ok(detail2026);
  assert.equal(detail2026.postedAt, "2026-11-08T05:00:00.000Z", "tanggal · 11-8 di header TikTok 2026 wajib terbaca");
  assert.equal(detail2026.metrics.views, 768, "views wajib membaca statsV2 string");
  assert.equal(detail2026.metrics.likes, 14);
  assert.equal(detail2026.metrics.comments, 1);
  assert.equal(detail2026.metrics.shares, 0, "share-count 'Bagikan' wajib fallback ke statsV2.shareCount = 0");

  // 4. Video TikTok nyata tanpa createTime & tanpa DOM tanggal tetap mendapat tanggal akurat dari Snowflake ID (bukan null)
  const ttNoDateDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('[data-e2e="video-desc"]')) return { textContent: "Sunset BBQ malam ini di Anyer" };
      if (sel.includes('[data-e2e="like-count"]')) return { textContent: "14" };
      return null;
    },
    querySelectorAll: () => [],
  };
  const detailSnowflake = parsers.extractTikTokVideoDetail(
    ttNoDateDoc,
    "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700",
    { gridViews: 768 },
    ["sunsetgrill.sanghyang"],
    nowMs,
  );
  assert.ok(detailSnowflake);
  assert.equal(
    detailSnowflake.postedAt,
    "2026-11-08T05:05:12.000Z",
    `fallback Snowflake harus mengisi postedAt 2026-11-08T05:05:12.000Z, dapat: ${detailSnowflake.postedAt}`,
  );

  // 5. extractTikTokProfileMeta: deteksi notFound (statusCode 10221 seperti @mambrukhotelanyer) & isEmptyProfile (videoCount=0 atau teks kosong)
  const notFoundDoc = {
    body: { innerText: "Tidak dapat menemukan akun ini" },
    querySelector: (sel: string) =>
      sel === "#__UNIVERSAL_DATA_FOR_REHYDRATION__"
        ? { textContent: JSON.stringify({ __DEFAULT_SCOPE__: { "webapp.user-detail": { statusCode: 10221, userInfo: null } } }) }
        : null,
    querySelectorAll: () => [],
  };
  const nfMeta = parsers.extractTikTokProfileMeta(notFoundDoc, "mambrukhotelanyer");
  assert.equal(nfMeta.notFound, true, "statusCode 10221 wajib menandai notFound=true");
  assert.equal(nfMeta.isEmptyProfile, false);

  const emptyDocProfile = {
    body: { innerText: "Akun Baru\nBelum ada video" },
    querySelector: (sel: string) =>
      sel === "#__UNIVERSAL_DATA_FOR_REHYDRATION__"
        ? {
            textContent: JSON.stringify({
              __DEFAULT_SCOPE__: {
                "webapp.user-detail": {
                  statusCode: 0,
                  userInfo: { user: { uniqueId: "akunbaru" }, stats: { followerCount: 10, videoCount: 0 } },
                },
              },
            }),
          }
        : null,
    querySelectorAll: () => [],
  };
  const emptyMeta = parsers.extractTikTokProfileMeta(emptyDocProfile, "akunbaru");
  assert.equal(emptyMeta.posts, 0);
  assert.equal(emptyMeta.isEmptyProfile, true, "videoCount=0 wajib menandai isEmptyProfile=true");
  assert.equal(emptyMeta.notFound, false);

  // 6. extractTikTokProfileItems membaca tambahan item dari JSON rehydration bila DOM hanya merender sebagian
  const partialDomDoc = {
    querySelector: (sel: string) =>
      sel === "#__UNIVERSAL_DATA_FOR_REHYDRATION__"
        ? {
            textContent: JSON.stringify({
              __DEFAULT_SCOPE__: {
                "webapp.user-detail": {
                  itemList: [
                    {
                      id: "7705662298588859700",
                      author: { uniqueId: "sunsetgrill.sanghyang" },
                      stats: { playCount: 768 },
                      video: { cover: "https://p16-sign-sg.tiktokcdn.com/cover.jpg" },
                    },
                    {
                      id: "7705000000000000001",
                      author: { uniqueId: "akun_lain" },
                      stats: { playCount: 99 },
                    },
                  ],
                },
              },
            }),
          }
        : null,
    querySelectorAll: () => [],
  };
  const rehydratedItems = parsers.extractTikTokProfileItems(partialDomDoc, 0, "sunsetgrill.sanghyang");
  assert.equal(rehydratedItems.length, 1, "item rehydration milik handle target wajib ikut terekstrak meski DOM kosong");
  assert.equal(rehydratedItems[0].sourceUrl, "https://www.tiktok.com/@sunsetgrill.sanghyang/video/7705662298588859700");
  assert.equal(rehydratedItems[0].gridViews, 768);

  // 7. Deteksi puzzle TikTok 2026 ("fit the puzzle")
  const ttPuzzle = parsers.detectSocialChallenge({
    url: "https://www.tiktok.com/@sunsetgrill.sanghyang",
    title: "Sunset Grill Sanghyang (@sunsetgrill.sanghyang)",
    bodyText: "114 Followers\nDrag the slider to fit the puzzle",
    hasLoginForm: false,
    hasCaptchaDom: false,
  });
  assert.equal(ttPuzzle.blocked, true);
  assert.equal(ttPuzzle.kind, "captcha");
});

test("v1.1.6 regresi background.js: TikTok 0 item dengan followers terbaca wajib retry aktif + pause (tidak 0 error), prioritas video baru di atas knownPostUrls + pinned, dan summarizeState lengkap", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const { loadExtensionManifestInfo } = await import("../../src/lib/market/extension-zip");
  const bgSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");

  // 1. Versi manifest wajib 1.1.11 dengan Extension ID tetap
  const manifestInfo = loadExtensionManifestInfo();
  assert.equal(manifestInfo.manifest.version, "1.1.11");
  assert.equal(manifestInfo.extensionId, "kabomdcpiamnnncoifohknncamcddahl");

  type TabRec = { id: number; url: string; status: string; incognito: boolean; windowId: number; active: boolean };
  function makeBg(opts: {
    onExecuteScript: (arg: { target: { tabId: number }; func?: (...a: unknown[]) => unknown; args?: unknown[] }) => unknown;
  }) {
    const storage = new Map<string, unknown>();
    const tabs = new Map<number, TabRec>();
    let nextId = 200;
    const tabUpdates: { tabId: number; opts: Record<string, unknown> }[] = [];
    const fakeChrome = {
      storage: {
        local: {
          get: async (k: string) => ({ [k]: storage.get(k) }),
          set: async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) storage.set(k, v);
          },
        },
      },
      windows: {
        getAll: async () => [{ id: 1, incognito: false }],
        update: async () => ({}),
      },
      tabs: {
        get: async (id: number) => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          return { ...t };
        },
        create: async (c: Record<string, unknown>) => {
          const t: TabRec = {
            id: nextId++,
            url: String(c.url || ""),
            status: "complete",
            incognito: false,
            windowId: 1,
            active: Boolean(c.active),
          };
          tabs.set(t.id, t);
          return { ...t };
        },
        update: async (id: number, u: Record<string, unknown>) => {
          tabUpdates.push({ tabId: id, opts: u });
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          if (typeof u.url === "string") {
            t.url = u.url;
            t.status = "complete";
          }
          if (typeof u.active === "boolean") t.active = u.active;
          return { ...t };
        },
        remove: async (id: number) => {
          tabs.delete(id);
        },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      scripting: {
        executeScript: async (arg: { target: { tabId: number }; func?: (...a: unknown[]) => unknown; args?: unknown[] }) => {
          // Probe ketersediaan content_scripts hanya mengirim 1 argumen ([fnName]); kembalikan true agar tidak menginjeksi file.
          if (Array.isArray(arg.args) && arg.args.length === 1) {
            return [{ result: true }];
          }
          return [{ result: opts.onExecuteScript(arg) }];
        },
      },
      runtime: {
        getManifest: () => ({ version: "1.1.6" }),
        getURL: (f: string) => `chrome-extension://test/${f}`,
        onMessageExternal: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
    };
    const sb: Record<string, unknown> = {
      chrome: fakeChrome,
      URL,
      Set,
      Map,
      Array,
      Math,
      Date,
      Promise,
      Error,
      Boolean,
      Number,
      String,
      RegExp,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      globalThis: {} as Record<string, unknown>,
    };
    sb.globalThis = sb;
    vm.runInNewContext(bgSrc, sb);
    return {
      hooks: sb.__sanghyangBackgroundTestHooks as {
        handleCommand: (
          msg: Record<string, unknown>,
          origin: string | null,
          senderTab?: { id?: number; windowId?: number; incognito?: boolean } | null,
        ) => Promise<{ ok: boolean; state: Record<string, unknown>; errors?: string[]; finalizeRun?: boolean }>;
        readState: () => Promise<Record<string, unknown>>;
      },
      tabUpdates,
    };
  }

  // 2. Kasus Run 870df479: TikTok dengan followers=114, expected=null, collected=0, isEmptyProfile=false
  //    WAJIB melakukan 1x retry dengan tab active=true lalu jeda needs_human_action (TIDAK pernah lewat diam-diam 0 error!)
  let profileCalls = 0;
  const bgTtZero = makeBg({
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        profileCalls++;
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: 114, posts: null, isEmptyProfile: false, notFound: false },
          isLoggedOutNav: false,
          wasHidden: profileCalls === 1,
          hadInterstitial: false,
          scan: { rounds: 6, expected: null, collected: 0, stoppedBy: "stale" },
        };
      }
      return true;
    },
  });
  await bgTtZero.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      targets: [
        {
          targetKey: "own:tiktok:sunsetgrill.sanghyang",
          targetType: "own",
          name: "Sunset Grill (TikTok)",
          platform: "tiktok",
          handle: "sunsetgrill.sanghyang",
          profileUrl: "https://www.tiktok.com/@sunsetgrill.sanghyang",
        },
      ],
    },
    "http://localhost:3001",
    { id: 10, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 120));
  const stZero = (await bgTtZero.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state;
  assert.equal(profileCalls, 2, "TikTok 0 item wajib mencoba 1x retry dengan aktivasi tab sebelum menjeda");
  assert.ok(
    bgTtZero.tabUpdates.some((u) => u.opts.active === true),
    "retry TikTok 0 item wajib mengaktifkan tab pekerja",
  );
  assert.equal(stZero.status, "needs_human_action", "TikTok 0 item dengan followers=114 & expected=null TIDAK boleh lewat diam-diam 0 error");
  assert.equal(stZero.currentTargetHandle, "sunsetgrill.sanghyang");
  assert.equal(stZero.currentTargetPlatform, "tiktok");

  // 3. Kasus TikTok notFound (statusCode 10221) -> catat error & targetResults status='not_found', lanjut selesai tanpa pause
  const bgNotFound = makeBg({
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: null, posts: null, isEmptyProfile: false, notFound: true },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 0, expected: null, collected: 0, stoppedBy: "stale" },
        };
      }
      return true;
    },
  });
  await bgNotFound.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      targets: [
        {
          targetKey: "comp:mambruk:tiktok",
          targetType: "competitor",
          name: "Mambruk Hotel",
          platform: "tiktok",
          handle: "mambrukhotelanyer",
          profileUrl: "https://www.tiktok.com/@mambrukhotelanyer",
        },
      ],
    },
    "http://localhost:3001",
    { id: 11, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 120));
  const stNf = (await bgNotFound.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state;
  assert.equal(stNf.status, "completed");
  assert.ok(Array.isArray(stNf.errors) && stNf.errors.length >= 1, "akun TikTok tidak ditemukan wajib dicatat di errors");
  const nfResults = stNf.targetResults as Array<{ handle?: string; status?: string }>;
  assert.ok(Array.isArray(nfResults) && nfResults.some((r) => r.handle === "mambrukhotelanyer" && r.status === "not_found"));

  // 4. Kasus Instagram retry aktivasi tab tetap melestarikan expectedTotal (tidak tertimpa null) + melaporkan error cakupan < 90% + targetResults + prioritas item unseen di atas knownPostUrls
  const visitedDetailUrls: string[] = [];
  let igProfileAttempt = 0;
  const knownUrls = Array.from({ length: 18 }, (_, i) => `https://www.instagram.com/sanghyangresort/p/Known${i}/`);
  const igItemsFromProfile = [
    ...knownUrls.slice(0, 14).map((u) => ({ sourceUrl: u, postType: "feed" })),
    { sourceUrl: "https://www.instagram.com/sanghyangresort/p/UnseenBaru15/", postType: "feed" },
    ...knownUrls.slice(14, 18).map((u) => ({ sourceUrl: u, postType: "feed" })),
  ];
  const bgIgPartial = makeBg({
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        igProfileAttempt++;
        if (igProfileAttempt === 1) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: igItemsFromProfile.slice(0, 12),
            profile: { followers: 7828, posts: 1739 },
            isLoggedOutNav: false,
            wasHidden: true,
            hadInterstitial: false,
            scan: { rounds: 6, expected: 1739, collected: 12, stoppedBy: "stale" },
          };
        }
        if (igProfileAttempt === 2) {
          // Simulasi retry di posisi scroll bawah: header tervirtualisasi sehingga retryRes.scan.expected = null!
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: igItemsFromProfile,
            profile: { followers: 7828, posts: null },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 6, expected: null, collected: igItemsFromProfile.length, stoppedBy: "stale" },
          };
        }
        // Tab /reels/
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: 7828, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 1, expected: null, collected: 0, stoppedBy: "stale" },
        };
      }
      if (arg.args?.[0] === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        visitedDetailUrls.push(postUrl);
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Konten uji",
            imageUrl: null,
            metrics: { views: null, likes: 10, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });
  await bgIgPartial.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: knownUrls,
      targets: [
        {
          targetKey: "own:instagram:sanghyangresort",
          targetType: "own",
          name: "Akun induk (Resort)",
          platform: "instagram",
          handle: "sanghyangresort",
          profileUrl: "https://www.instagram.com/sanghyangresort/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 12, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 200));
  const stIg = (await bgIgPartial.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state;
  assert.equal(stIg.status, "completed");
  assert.ok(
    Array.isArray(stIg.errors) && (stIg.errors as string[]).some((e) => e.includes("1739")),
    `error cakupan <90% (expected 1739) tidak boleh hilang meski retryRes.scan.expected=null; dapat: ${JSON.stringify(stIg.errors)}`,
  );
  assert.equal(
    visitedDetailUrls[0],
    "https://www.instagram.com/sanghyangresort/p/UnseenBaru15/",
    "item baru yang belum ada di knownPostUrls wajib diprioritaskan paling depan dan tidak pernah terlewati",
  );
  const igRes = stIg.targetResults as Array<{ handle?: string; collected?: number; expected?: number | null; status?: string }>;
  assert.ok(
    Array.isArray(igRes) && igRes.some((r) => r.handle === "sanghyangresort" && r.expected === 1739 && r.status === "partial"),
    `targetResults wajib memuat ringkasan akun sanghyangresort (partial, expected 1739), dapat: ${JSON.stringify(igRes)}`,
  );
});

test("v1.1.7 TDD virtualisasi React 619 postingan: 100% (619/619) tertangkap dengan jendela 18 anchor, absorpsi mutasi kontinu, gap-fill sweep, dan maxRounds 2000+", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const contentSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/content-social.js"), "utf8");

  // 1. Simulasi penuh Grid Virtualisasi React 619 postingan (207 baris × 3 kolom = 619 item):
  //    - Hanya 6 baris (maks 18 anchor) terpasang di DOM pada satu waktu berdasarkan scrollTop!
  //    - Baris lama langsung di-unmount begitu scrollTop naik (tidak ada di DOM lagi).
  //    - Jaringan GraphQL memuat progresif 12 baris (36 postingan = +3600px) tiap kali mendekati batas bawah muatan.
  //    - Termasuk postingan kolaborasi eksternal (/dj_eksternal/reel/..., /influencer_anyer/p/...) di dalam <main>
  //      dan tautan pengecoh di [role="dialog"], <nav>, <aside>, dan di luar <main>.
  const TOTAL_POSTS = 619;
  const COLS = 3;
  const ROW_H = 300;
  const VIEWPORT_H = 900;
  const WINDOW_ROWS = 6; // 6 baris × 3 = tepat 18 anchor terpasang di DOM!
  const TOTAL_ROWS = Math.ceil(TOTAL_POSTS / COLS);

  const allPosts = Array.from({ length: TOTAL_POSTS }, (_, idx) => {
    const code = `Post619_${String(idx + 1).padStart(4, "0")}`;
    if (idx % 17 === 0) return `/dj_anyer_live/reel/${code}/`;
    if (idx % 23 === 0) return `/influencer_banten/p/${code}/`;
    if (idx % 11 === 0) return `/p/${code}/`;
    return `/sunsetgrillsanghyang/p/${code}/`;
  });

  function createVirtualGridEnv(opts?: { delayedBatchRange?: [number, number] }) {
    const observers: { cb: () => void; active: boolean }[] = [];
    class FakeMutationObserver {
      private rec: { cb: () => void; active: boolean };
      constructor(cb: () => void) {
        this.rec = { cb, active: false };
        observers.push(this.rec);
      }
      observe() {
        this.rec.active = true;
      }
      disconnect() {
        this.rec.active = false;
      }
    }
    const emitMutation = () => {
      for (const o of [...observers]) {
        if (o.active) o.cb();
      }
    };

    class VNode {
      tagName: string;
      id = "";
      attrs: Record<string, string>;
      textContent = "";
      innerText = "";
      parentElement: VNode | null = null;
      children: VNode[] = [];
      scrollHeight = 0;
      clientHeight = VIEWPORT_H;
      private _scrollTop = 0;
      onScrollChange?: (nextTop: number, prevTop: number) => void;

      constructor(tag: string, attrs: Record<string, string> = {}, text = "") {
        this.tagName = tag.toUpperCase();
        this.attrs = attrs;
        this.textContent = text;
        this.innerText = text;
      }
      get scrollTop() {
        return this._scrollTop;
      }
      set scrollTop(v: number) {
        const prev = this._scrollTop;
        const maxTop = Math.max(0, this.scrollHeight - this.clientHeight);
        this._scrollTop = Math.max(0, Math.min(maxTop, Number(v) || 0));
        if (this.onScrollChange) this.onScrollChange(this._scrollTop, prev);
      }
      getAttribute(k: string) {
        return this.attrs[k] ?? null;
      }
      appendChild(ch: VNode) {
        ch.parentElement = this;
        this.children.push(ch);
        return ch;
      }
      matchesSimple(sel: string): boolean {
        const s = sel.trim();
        if (!s) return false;
        if (s === "main") return this.tagName === "MAIN";
        if (s === "nav") return this.tagName === "NAV";
        if (s === "header") return this.tagName === "HEADER";
        if (s === "footer") return this.tagName === "FOOTER";
        if (s === "aside") return this.tagName === "ASIDE";
        if (s === '[role="dialog"]') return this.attrs.role === "dialog";
        if (s === '[role="alertdialog"]') return this.attrs.role === "alertdialog";
        if (s === '[data-e2e="suggested"]') return this.attrs["data-e2e"] === "suggested";
        if (s.includes("aria-label*=")) {
          const m = s.match(/aria-label\*="([^"]+)"/i);
          if (m) return (this.attrs["aria-label"] || "").toLowerCase().includes(m[1].toLowerCase());
        }
        if (s === 'a[href*="/p/"]') return this.tagName === "A" && (this.attrs.href || "").includes("/p/");
        if (s === 'a[href*="/reel/"]') return this.tagName === "A" && (this.attrs.href || "").includes("/reel/");
        if (s === "img") return this.tagName === "IMG";
        if (s === "span") return this.tagName === "SPAN";
        return false;
      }
      closest(sel: string): VNode | null {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        if (parts.some((p) => this.matchesSimple(p))) return this;
        let cur: VNode | null = this.parentElement;
        while (cur) {
          if (parts.some((p) => cur!.matchesSimple(p))) return cur;
          cur = cur.parentElement;
        }
        return null;
      }
      querySelectorAll(sel: string): VNode[] {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        const out: VNode[] = [];
        const walk = (n: VNode) => {
          for (const ch of n.children) {
            if (parts.some((p) => ch.matchesSimple(p))) out.push(ch);
            walk(ch);
          }
        };
        walk(this);
        return out;
      }
      querySelector(sel: string): VNode | null {
        return this.querySelectorAll(sel)[0] ?? null;
      }
      scrollIntoView() {
        // Tidak mengubah scrollTop secara paksa agar scrollTop dikendalikan murni oleh algoritma gulir
      }
      dispatchEvent() {
        return true;
      }
    }

    let loadedRows = 12; // 36 postingan awal (3600px)
    let maxStepJumpPx = 0;
    let maxMountedAnchors = 0;
    let delayedHiddenOnce = Boolean(opts?.delayedBatchRange);
    let sawResetToTop = false;

    const scrollview = new VNode("DIV", { id: "scrollview" });
    scrollview.id = "scrollview";
    scrollview.clientHeight = VIEWPORT_H;
    scrollview.scrollHeight = loadedRows * ROW_H;

    const mainEl = new VNode("MAIN");
    const gridContainer = new VNode("DIV");
    mainEl.appendChild(gridContainer);

    // Pengecoh di dalam <main> (header, dialog, aside) dan di luar <main> (nav)
    const dialogInMain = new VNode("DIV", { role: "dialog" });
    dialogInMain.appendChild(new VNode("A", { href: "/pengecoh_modal/p/DecoyModal1/" }));
    mainEl.appendChild(dialogInMain);

    const asideInMain = new VNode("ASIDE");
    asideInMain.appendChild(new VNode("A", { href: "/pengecoh_aside/reel/DecoyAside1/" }));
    mainEl.appendChild(asideInMain);

    const navOutside = new VNode("NAV");
    navOutside.appendChild(new VNode("A", { href: "/pengecoh_nav/p/DecoyNav1/" }));

    const rootBody = new VNode("BODY", {}, `sunsetgrillsanghyang\n${TOTAL_POSTS} kiriman\n2.100 pengikut`);
    rootBody.appendChild(navOutside);
    scrollview.appendChild(mainEl);
    rootBody.appendChild(scrollview);

    const renderWindow = () => {
      const startRow = Math.max(0, Math.floor(scrollview.scrollTop / ROW_H));
      const endRow = Math.min(loadedRows, startRow + WINDOW_ROWS);
      gridContainer.children = [];
      for (let r = startRow; r < endRow; r++) {
        if (
          delayedHiddenOnce &&
          !sawResetToTop &&
          opts?.delayedBatchRange &&
          r >= opts.delayedBatchRange[0] &&
          r < opts.delayedBatchRange[1]
        ) {
          // Simulasi keterlambatan render React di baris tengah pada sapuan pertama
          continue;
        }
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          if (idx >= TOTAL_POSTS) break;
          gridContainer.appendChild(new VNode("A", { href: allPosts[idx] }));
        }
      }
      if (gridContainer.children.length > maxMountedAnchors) {
        maxMountedAnchors = gridContainer.children.length;
      }
    };

    renderWindow();

    scrollview.onScrollChange = (nextTop, prevTop) => {
      if (nextTop > prevTop) {
        maxStepJumpPx = Math.max(maxStepJumpPx, nextTop - prevTop);
      }
      if (nextTop === 0 && prevTop > VIEWPORT_H) {
        sawResetToTop = true;
        delayedHiddenOnce = false;
      }
      // Sentinel GraphQL di dekat batas bawah muatan: tambah 12 baris (+3600px) per permintaan
      if (nextTop + VIEWPORT_H >= scrollview.scrollHeight - 400 && loadedRows < TOTAL_ROWS) {
        loadedRows = Math.min(TOTAL_ROWS, loadedRows + 12);
        scrollview.scrollHeight = loadedRows * ROW_H;
      }
      renderWindow();
      emitMutation();
    };

    const metaDesc = new VNode("META", {
      property: "og:description",
      content: `2,100 Followers, 100 Following, ${TOTAL_POSTS} Posts - Sunset Grill`,
    });

    const fakeDoc = {
      title: "Sunset Grill (@sunsetgrillsanghyang)",
      hidden: false,
      readyState: "complete",
      location: { pathname: "/sunsetgrillsanghyang/" },
      body: rootBody,
      documentElement: { scrollHeight: VIEWPORT_H, clientHeight: VIEWPORT_H, scrollTop: 0 },
      scrollingElement: scrollview,
      querySelector: (sel: string) => {
        if (sel === "#scrollview") return scrollview;
        if (sel === "main") return mainEl;
        if (sel.includes("og:description")) return metaDesc;
        if (sel.includes('a[href*="/p/"]')) return gridContainer.children[0] ?? null;
        return null;
      },
      querySelectorAll: (sel: string) => rootBody.querySelectorAll(sel),
    };

    const sb: Record<string, unknown> = {
      SanghyangParsers: parsers,
      document: fakeDoc,
      window: {
        location: { href: "https://www.instagram.com/sunsetgrillsanghyang/", pathname: "/sunsetgrillsanghyang/" },
        innerHeight: VIEWPORT_H,
        scrollTo: () => {},
        scrollBy: () => {},
        getComputedStyle: () => ({ overflowY: "auto" }),
        dispatchEvent: () => true,
      },
      HTMLElement: VNode,
      MutationObserver: FakeMutationObserver,
      Event: class FakeEvent {
        type: string;
        constructor(t: string) {
          this.type = t;
        }
      },
      WheelEvent: class FakeWheelEvent {
        type: string;
        constructor(t: string) {
          this.type = t;
        }
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Promise,
      Set,
      Map,
      Array,
      Math,
      Boolean,
      Number,
      String,
      RegExp,
      URL,
      globalThis: {} as Record<string, unknown>,
    };
    sb.globalThis = sb;
    vm.runInNewContext(contentSrc, sb);
    return {
      runProfile: sb.__sanghyangRunProfile as (
        platform: string,
        maxItems: number,
        targetHandle: string,
        allowedCollabHandles: string[],
        runOpts?: Record<string, unknown>,
      ) => Promise<{
        items: Array<{ sourceUrl: string }>;
        scan: { rounds: number; expected: number | null; collected: number; stoppedBy: string; reachedBottom?: boolean; sweepRan?: boolean };
      }>,
      getStats: () => ({ maxStepJumpPx, maxMountedAnchors, loadedRows }),
    };
  }

  // (a) Simulasi penuh 619 postingan dengan jendela ketat 18 anchor -> WAJIB 619/619 (100%) + 0 decoy
  const env619 = createVirtualGridEnv();
  const res619 = await env619.runProfile("instagram", 0, "sunsetgrillsanghyang", ["sanghyangresort", "sunsetgrillsanghyang"], {
    stepWaitMs: 5,
    bottomWaitMs: 15,
    sweepStepWaitMs: 5,
  });
  const stats619 = env619.getStats();
  assert.equal(stats619.maxMountedAnchors, 18, "simulasi virtualisasi benar-benar hanya memasang 18 anchor di DOM pada satu waktu");
  assert.equal(res619.items.length, 619, `grid virtualisasi 619 postingan wajib tertangkap 619/619 (100%), dapat ${res619.items.length}`);
  assert.equal(res619.scan.collected, 619);
  assert.equal(res619.scan.reachedBottom, true, "scan 619/619 wajib melaporkan reachedBottom=true");
  assert.ok(
    stats619.maxStepJumpPx <= Math.floor(VIEWPORT_H * 0.75),
    `gulir inkremental tidak boleh melompat lebih dari ~72% viewport (${VIEWPORT_H}px), teramati lompatan ${stats619.maxStepJumpPx}px`,
  );
  assert.ok(
    res619.items.some((x) => x.sourceUrl.includes("/dj_anyer_live/reel/Post619_0001/")),
    "postingan kolaborasi eksternal di <main> wajib ikut tertangkap",
  );
  assert.ok(
    !res619.items.some((x) => /pengecoh_/.test(x.sourceUrl)),
    "tautan pengecoh di [role=dialog], <nav>, dan <aside> tidak boleh masuk hasil grid profil",
  );

  // (b) Simulasi keterlambatan render di baris 60..72 (36 postingan hilang di sapuan turun pertama) -> 1x gap-fill sweep wajib memulihkan ke 619/619!
  const envGap = createVirtualGridEnv({ delayedBatchRange: [60, 72] });
  const resGap = await envGap.runProfile("instagram", 0, "sunsetgrillsanghyang", ["sanghyangresort", "sunsetgrillsanghyang"], {
    stepWaitMs: 5,
    bottomWaitMs: 15,
    sweepStepWaitMs: 5,
  });
  assert.equal(resGap.scan.sweepRan, true, "ketika batas bawah tercapai namun <95% expected, 1x gap-fill sweep wajib berjalan");
  assert.equal(resGap.items.length, 619, `gap-fill sweep wajib memulihkan baris yang tertunda hingga 619/619, dapat ${resGap.items.length}`);

  // (c) Absorpsi mutasi kontinu (absorbNow): kartu yang muncul sebentar di tengah advance() lalu di-unmount SEBELUM advance() selesai tetap terserap!
  let transientDom: Array<{ sourceUrl: string; postType: string }> = [
    { sourceUrl: "https://www.instagram.com/sunsetgrillsanghyang/p/Row1/", postType: "feed" },
  ];
  const transientRes = await parsers.collectFeedItems({
    collect: () => transientDom,
    advance: async (ctx: { absorbNow?: () => number }) => {
      assert.equal(typeof ctx.absorbNow, "function", "collectFeedItems wajib menyediakan ctx.absorbNow() untuk absorpsi kontinu");
      // Baris 2 muncul sesaat lalu langsung di-unmount oleh React sebelum advance() selesai
      transientDom = [{ sourceUrl: "https://www.instagram.com/sunsetgrillsanghyang/p/TransientRow2/", postType: "feed" }];
      ctx.absorbNow!();
      transientDom = [{ sourceUrl: "https://www.instagram.com/sunsetgrillsanghyang/p/Row3/", postType: "feed" }];
    },
    maxItems: 0,
    expectedTotal: 3,
    staleRounds: 3,
    minItemsPerRound: 3,
    maxRoundsUnknown: 20,
  });
  assert.equal(transientRes.collected, 3, "baris sementara yang muncul & hilang sebelum advance() selesai wajib tetap terserap lewat absorbNow()");
  assert.ok(transientRes.items.some((x: { sourceUrl: string }) => x.sourceUrl.includes("TransientRow2")));

  // (d) Rumus maxRounds untuk akun 2.000+ postingan (langkah kecil ~0.5 item/putaran = >1.500 putaran) tidak boleh berhenti oleh maxRounds
  let idx2k = 0;
  let round2k = 0;
  const total2k = 1000; // butuh 2000 putaran (> 1000/3 = 334 putaran lama!)
  const res2k = await parsers.collectFeedItems({
    collect: () => [{ sourceUrl: `https://www.instagram.com/sanghyangresort/p/Big${idx2k}/`, postType: "feed" }],
    advance: async () => {
      round2k++;
      if (round2k % 2 === 0 && idx2k < total2k - 1) idx2k++;
      return { moved: true, atBottom: idx2k >= total2k - 1 };
    },
    maxItems: 0,
    expectedTotal: total2k,
    staleRounds: 7,
    minItemsPerRound: 3,
    maxRoundsUnknown: 600,
  });
  assert.equal(res2k.collected, total2k, "akun besar dengan langkah gulir kecil tidak boleh berhenti dini oleh maxRounds lama");
  assert.equal(res2k.stoppedBy, "expected");
});

test("v1.1.7 TDD kolaborasi eksternal di <main> profil IG: terima semua kartu grid profil utama, tolak dialog/nav/header/footer/aside/suggested dan halaman /tagged/", () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  type SimpleNode = {
    tagName: string;
    attrs: Record<string, string>;
    textContent: string;
    innerText: string;
    children: SimpleNode[];
    parentElement: SimpleNode | null;
    getAttribute: (k: string) => string | null;
    querySelectorAll: (sel: string) => SimpleNode[];
    querySelector: (sel: string) => SimpleNode | null;
    closest: (sel: string) => SimpleNode | null;
  };
  const matchSimple = (el: SimpleNode, sel: string): boolean => {
    const s = sel.trim();
    if (s === "main") return el.tagName === "MAIN";
    if (s === "nav") return el.tagName === "NAV";
    if (s === "header") return el.tagName === "HEADER";
    if (s === "footer") return el.tagName === "FOOTER";
    if (s === "aside") return el.tagName === "ASIDE";
    if (s === '[role="dialog"]') return el.attrs.role === "dialog";
    if (s === '[role="alertdialog"]') return el.attrs.role === "alertdialog";
    if (s === '[data-e2e="suggested"]') return el.attrs["data-e2e"] === "suggested";
    if (s.includes("aria-label*=")) {
      const m = s.match(/aria-label\*="([^"]+)"/i);
      if (m) return (el.attrs["aria-label"] || "").toLowerCase().includes(m[1].toLowerCase());
    }
    if (s === 'a[href*="/p/"]') return el.tagName === "A" && (el.attrs.href || "").includes("/p/");
    if (s === 'a[href*="/reel/"]') return el.tagName === "A" && (el.attrs.href || "").includes("/reel/");
    return false;
  };
  const mk = (tag: string, attrs: Record<string, string> = {}, children: SimpleNode[] = []): SimpleNode => {
    const node: SimpleNode = {
      tagName: tag.toUpperCase(),
      attrs,
      textContent: "",
      innerText: "",
      children,
      parentElement: null,
      getAttribute: (k) => node.attrs[k] ?? null,
      querySelectorAll(sel) {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        const out: SimpleNode[] = [];
        const walk = (n: SimpleNode) => {
          for (const c of n.children) {
            if (parts.some((p) => matchSimple(c, p))) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] ?? null;
      },
      closest(sel) {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        let cur: SimpleNode | null = node;
        while (cur) {
          if (parts.some((p) => matchSimple(cur!, p))) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
    };
    for (const c of children) c.parentElement = node;
    return node;
  };

  const mainGrid = mk("main", {}, [
    mk("header", {}, [mk("a", { href: "/hdr_user/p/Hdr001/" })]),
    mk("div", {}, [
      mk("a", { href: "/sunsetgrillsanghyang/p/Own001/" }),
      mk("a", { href: "/p/NoHandle002/" }),
      mk("a", { href: "/dj_banten_eksternal/reel/Collab003/" }),
      mk("a", { href: "/vendor_musik_anyer/p/Collab004/" }),
    ]),
    mk("div", { role: "dialog" }, [mk("a", { href: "/modal_user/p/Modal001/" })]),
    mk("aside", {}, [mk("a", { href: "/aside_user/reel/Aside001/" })]),
    mk("section", { "aria-label": "Suggested posts" }, [mk("a", { href: "/sugg_user/p/Sugg001/" })]),
    mk("footer", {}, [mk("a", { href: "/ftr_user/p/Ftr001/" })]),
  ]);
  const doc = Object.assign(
    mk("div", {}, [
      mk("nav", {}, [mk("a", { href: "/nav_user/p/Nav001/" })]),
      mainGrid,
      mk("div", {}, [mk("a", { href: "/outside_user/p/Out001/" })]),
    ]),
    { location: { pathname: "/sunsetgrillsanghyang/" } },
  );

  const items = parsers.extractInstagramProfileItems(doc, 0, "sunsetgrillsanghyang", ["sanghyangresort"]);
  assert.equal(items.length, 4, `wajib menangkap tepat 4 kartu grid utama <main> termasuk 2 kolaborasi eksternal, dapat ${items.length}`);
  assert.ok(items.some((x: { sourceUrl: string }) => x.sourceUrl.includes("/dj_banten_eksternal/reel/Collab003/")));
  assert.ok(items.some((x: { sourceUrl: string }) => x.sourceUrl.includes("/vendor_musik_anyer/p/Collab004/")));
  assert.ok(!items.some((x: { sourceUrl: string }) => /(Hdr001|Modal001|Aside001|Sugg001|Ftr001|Nav001|Out001)/.test(x.sourceUrl)));

  // Pada tab /tagged/, filter handle ketat tetap berlaku agar postingan tag pihak ketiga tidak ikut masuk
  const taggedDoc = Object.assign(mainGrid, { location: { pathname: "/sunsetgrillsanghyang/tagged/" } });
  const taggedItems = parsers.extractInstagramProfileItems(taggedDoc, 0, "sunsetgrillsanghyang", ["sanghyangresort"]);
  assert.ok(!taggedItems.some((x: { sourceUrl: string }) => x.sourceUrl.includes("dj_banten_eksternal")), "halaman /tagged/ tetap menyaring handle pihak ketiga");
});

test("v1.1.7 TDD background.js: gabung /reels/ SEBELUM cek kelengkapan, status jujur reachedBottom, dan fase progres (profile/reels/details)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const bgSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");

  type TabRec = { id: number; url: string; status: string; incognito: boolean; windowId: number; active: boolean };
  function makeBgV117(opts: {
    onExecuteScript: (arg: { target: { tabId: number }; args?: unknown[] }) => Promise<unknown> | unknown;
  }) {
    const storage = new Map<string, unknown>();
    const tabs = new Map<number, TabRec>();
    let nextId = 300;
    const fakeChrome = {
      storage: {
        local: {
          get: async (k: string) => ({ [k]: storage.get(k) }),
          set: async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) storage.set(k, v);
          },
        },
      },
      windows: { getAll: async () => [{ id: 1, incognito: false }], update: async () => ({}) },
      tabs: {
        get: async (id: number) => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          return { ...t };
        },
        create: async (c: Record<string, unknown>) => {
          const t: TabRec = { id: nextId++, url: String(c.url || ""), status: "complete", incognito: false, windowId: 1, active: Boolean(c.active) };
          tabs.set(t.id, t);
          return { ...t };
        },
        update: async (id: number, u: Record<string, unknown>) => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          if (typeof u.url === "string") {
            t.url = u.url;
            t.status = "complete";
          }
          if (typeof u.active === "boolean") t.active = u.active;
          return { ...t };
        },
        remove: async (id: number) => {
          tabs.delete(id);
        },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      scripting: {
        executeScript: async (arg: { target: { tabId: number }; args?: unknown[] }) => {
          if (Array.isArray(arg.args) && arg.args.length === 1) return [{ result: true }];
          const res = await opts.onExecuteScript(arg);
          return [{ result: res }];
        },
      },
      runtime: {
        getManifest: () => ({ version: "1.1.7" }),
        getURL: (f: string) => `chrome-extension://test/${f}`,
        onMessageExternal: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
    };
    const sb: Record<string, unknown> = {
      chrome: fakeChrome,
      URL,
      Set,
      Map,
      Array,
      Math,
      Date,
      Promise,
      Error,
      Boolean,
      Number,
      String,
      RegExp,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      globalThis: {} as Record<string, unknown>,
    };
    sb.globalThis = sb;
    vm.runInNewContext(bgSrc, sb);
    return sb.__sanghyangBackgroundTestHooks as {
      handleCommand: (
        msg: Record<string, unknown>,
        origin: string | null,
        senderTab?: { id?: number; windowId?: number; incognito?: boolean } | null,
      ) => Promise<{ ok: boolean; state: Record<string, unknown> }>;
    };
  }

  // 1. Grid 96/100 (>=95%) + 12 Reels-only -> profileCollected=96, reelsAdded=12, collected=108, status="ok",
  //    0 error "gulir berhenti lebih awal", dan fase progres (profile -> reels -> details) terpantau di summarizeState!
  const observedPhases: Array<{
    phase: unknown;
    detailIndex: unknown;
    detailTotal: unknown;
  }> = [];
  let runCall = 0;
  const profileItems96 = Array.from({ length: 96 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/sunsetgrillsanghyang/p/Prof${i + 1}/`,
    postType: "feed",
  }));
  const reelsItems15 = [
    // 3 tumpang tindih shortcode dengan profil (beda format URL /reel/ vs /p/ untuk uji dedup ig:<shortcode>)
    { sourceUrl: "https://www.instagram.com/reel/Prof1/", postType: "reels", gridViews: 900 },
    { sourceUrl: "https://www.instagram.com/reel/Prof2/", postType: "reels", gridViews: 800 },
    { sourceUrl: "https://www.instagram.com/reel/Prof3/", postType: "reels", gridViews: 700 },
    // 12 Reels-only yang tidak tampil di grid profil utama
    ...Array.from({ length: 12 }, (_, i) => ({
      sourceUrl: `https://www.instagram.com/sunsetgrillsanghyang/reel/ReelOnly${i + 1}/`,
      postType: "reels",
      gridViews: 500 + i,
    })),
  ];

  const bgReels = makeBgV117({
    onExecuteScript: async (arg) => {
      const fn = arg.args?.[0];
      const stNow = (await bgReels.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state;
      observedPhases.push({
        phase: stNow.currentPhase,
        detailIndex: stNow.currentDetailIndex,
        detailTotal: stNow.currentDetailTotal,
      });
      if (fn === "__sanghyangRunProfile") {
        runCall++;
        if (runCall === 1) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: profileItems96,
            profile: { followers: 2100, posts: 100 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 20, expected: 100, collected: 96, stoppedBy: "stale", reachedBottom: true },
          };
        }
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: reelsItems15,
          profile: { followers: 2100, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 5, expected: null, collected: 15, stoppedBy: "stale", reachedBottom: true },
        };
      }
      if (fn === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: postUrl.includes("/reel/") ? "reels" : "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Sunset Grill",
            imageUrl: null,
            metrics: { views: 500, likes: 12, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });

  // Semua 96 item profil sudah dikenal, hanya 12 Reels-only + 15 recent yang perlu detail (total 27 detail)
  await bgReels.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: profileItems96.map((x) => x.sourceUrl),
      targets: [
        {
          targetKey: "own:instagram:sunsetgrillsanghyang",
          targetType: "own",
          name: "Sunset Grill (IG)",
          platform: "instagram",
          handle: "sunsetgrillsanghyang",
          profileUrl: "https://www.instagram.com/sunsetgrillsanghyang/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 250));
  const stReels = (await bgReels.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state;
  assert.equal(stReels.status, "completed");
  assert.deepEqual(
    Array.from((stReels.errors as string[]) || []),
    [],
    `grid 96/100 (>=95%) + 12 Reels-only tidak boleh menghasilkan error; dapat: ${JSON.stringify(stReels.errors)}`,
  );
  const reelsResult = (stReels.targetResults as Array<Record<string, unknown>>)[0];
  assert.equal(reelsResult?.profileCollected, 96, "profileCollected harus mencatat 96 item grid utama sebelum merge Reels");
  assert.equal(reelsResult?.collected, 108, "collected harus mencerminkan hasil gabungan profil + Reels-only (108)");
  assert.equal(reelsResult?.reelsAdded, 12, "reelsAdded harus mencatat 12 Reels-only baru");
  assert.equal(reelsResult?.reachedBottom, true);
  assert.equal(reelsResult?.status, "ok", "96/100 (>=95%) grid dengan reachedBottom=true harus berstatus ok");
  assert.equal(observedPhases[0]?.phase, "profile", "fase pertama wajib 'profile'");
  assert.equal(observedPhases[1]?.phase, "reels", "fase kedua wajib 'reels'");
  assert.equal(observedPhases[2]?.phase, "details", "fase ketiga wajib 'details'");
  assert.equal(observedPhases[2]?.detailIndex, 0);
  assert.equal(observedPhases[2]?.detailTotal, 27);

  // 2. reachedBottom=true di bawah 95% (misal 520/619 setelah profil & Reels mentok bawah) ->
  //    TIDAK boleh menulis pesan menyesatkan "gulir berhenti lebih awal"!
  let bottomCall = 0;
  const items520 = Array.from({ length: 520 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/sunsetgrillsanghyang/p/Bot${i + 1}/`,
    postType: "feed",
  }));
  const bgBottom = makeBgV117({
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        bottomCall++;
        if (bottomCall === 1) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: items520,
            profile: { followers: 2100, posts: 619 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 90, expected: 619, collected: 520, stoppedBy: "stale", reachedBottom: true },
          };
        }
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: 2100, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 2, expected: null, collected: 0, stoppedBy: "stale", reachedBottom: true },
        };
      }
      if (arg.args?.[0] === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Konten",
            imageUrl: null,
            metrics: { views: null, likes: 5, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });
  await bgBottom.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: items520.map((x) => x.sourceUrl),
      targets: [
        {
          targetKey: "own:instagram:sunsetgrillsanghyang",
          targetType: "own",
          name: "Sunset Grill (IG)",
          platform: "instagram",
          handle: "sunsetgrillsanghyang",
          profileUrl: "https://www.instagram.com/sunsetgrillsanghyang/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 2, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 250));
  const stBot = (await bgBottom.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state;
  assert.equal(stBot.status, "completed");
  const botErrors = (stBot.errors as string[]) || [];
  assert.ok(
    !botErrors.some((e) => /gulir berhenti lebih awal/i.test(e)),
    `ketika reachedBottom=true, tidak boleh ada pesan menyesatkan "gulir berhenti lebih awal"; dapat: ${JSON.stringify(botErrors)}`,
  );
  const botRes = (stBot.targetResults as Array<Record<string, unknown>>)[0];
  assert.equal(botRes?.reachedBottom, true);
  assert.equal(botRes?.status, "partial");
  assert.match(String(botRes?.reason || ""), /mencapai batas bawah profil/i);
  assert.doesNotMatch(String(botRes?.reason || ""), /gulir berhenti lebih awal/i);

  // 3. Tab /reels/ gagal muat (timeout/error) TIDAK boleh ditelan catch{} diam-diam: wajib catat error & reachedBottom=false!
  let errReelsCall = 0;
  const bgReelsErr = makeBgV117({
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        errReelsCall++;
        if (errReelsCall === 1) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: items520.slice(0, 50),
            profile: { followers: 2100, posts: 100 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 10, expected: 100, collected: 50, stoppedBy: "stale", reachedBottom: true },
          };
        }
        throw new Error("Batas waktu muat tab Reels terlampaui");
      }
      if (arg.args?.[0] === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Konten",
            imageUrl: null,
            metrics: { views: null, likes: 5, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });
  await bgReelsErr.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: items520.slice(0, 50).map((x) => x.sourceUrl),
      targets: [
        {
          targetKey: "own:instagram:sunsetgrillsanghyang",
          targetType: "own",
          name: "Sunset Grill (IG)",
          platform: "instagram",
          handle: "sunsetgrillsanghyang",
          profileUrl: "https://www.instagram.com/sunsetgrillsanghyang/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 3, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 250));
  const stReelsErr = (await bgReelsErr.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state;
  const errList = (stReelsErr.errors as string[]) || [];
  assert.ok(
    errList.some((e) => /tab Reels/i.test(e)),
    `kegagalan tab /reels/ wajib tercatat di errors (Zero Fallback), bukan ditelan catch{}; dapat: ${JSON.stringify(errList)}`,
  );
  const errRes = (stReelsErr.targetResults as Array<Record<string, unknown>>)[0];
  assert.equal(errRes?.reachedBottom, false, "bila tab /reels/ gagal dimuat, reachedBottom tidak boleh true");
});

test("v1.1.7 TDD forensik parser IG: angka View Count Icon 2-angka di /reels/ dan prioritas tanggal postingan (bukan komentar non-/c/ seperti CrK_8oQrHiV)", () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  type DomNode = {
    tagName: string;
    attrs: Record<string, string>;
    textContent: string;
    innerText: string;
    children: DomNode[];
    parentElement: DomNode | null;
    getAttribute: (k: string) => string | null;
    querySelectorAll: (sel: string) => DomNode[];
    querySelector: (sel: string) => DomNode | null;
    closest: (sel: string) => DomNode | null;
  };
  const matchDom = (el: DomNode, sel: string): boolean => {
    const s = sel.trim();
    if (s === "main") return el.tagName === "MAIN";
    if (s === "a") return el.tagName === "A";
    if (s === "span") return el.tagName === "SPAN";
    if (s === "time[datetime]") return el.tagName === "TIME" && Boolean(el.attrs.datetime);
    if (s === "time") return el.tagName === "TIME";
    if (s === "ul ul li") return el.tagName === "LI" && el.parentElement?.tagName === "UL" && el.parentElement?.parentElement?.tagName === "UL";
    if (s === "[data-sanghyang-comment]") return Boolean(el.attrs["data-sanghyang-comment"]);
    if (s === 'a[href*="/p/"]') return el.tagName === "A" && (el.attrs.href || "").includes("/p/");
    if (s === 'a[href*="/reel/"]') return el.tagName === "A" && (el.attrs.href || "").includes("/reel/");
    if (s === 'a[href*="/c/"]') return el.tagName === "A" && (el.attrs.href || "").includes("/c/");
    if (s === 'svg[aria-label]') return el.tagName === "SVG" && Boolean(el.attrs["aria-label"]);
    if (s.startsWith("svg[aria-label*=")) {
      const m = s.match(/aria-label\*="([^"]+)"/i);
      return el.tagName === "SVG" && Boolean(m && (el.attrs["aria-label"] || "").toLowerCase().includes(m[1].toLowerCase()));
    }
    return false;
  };
  const mk = (tag: string, attrs: Record<string, string> = {}, text = "", children: DomNode[] = []): DomNode => {
    const node: DomNode = {
      tagName: tag.toUpperCase(),
      attrs,
      textContent: text,
      innerText: text,
      children,
      parentElement: null,
      getAttribute: (k) => node.attrs[k] ?? null,
      querySelectorAll(sel) {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        const out: DomNode[] = [];
        const walk = (n: DomNode) => {
          for (const c of n.children) {
            if (parts.some((p) => matchDom(c, p))) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] ?? null;
      },
      closest(sel) {
        const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
        let cur: DomNode | null = node;
        while (cur) {
          if (parts.some((p) => matchDom(cur!, p))) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
    };
    for (const c of children) c.parentElement = node;
    return node;
  };

  // 1. Kartu /reels/ dengan 2 angka (likes=63 + View Count Icon=4,195): gridViews wajib 4195 (bukan null!)
  const reelsCard = mk("a", { href: "/sunsetgrillsanghyang/reel/DfjHYwnOPrC/" }, "63\n4,195", [
    mk("div", {}, "63", [mk("span", {}, "63")]),
    mk("div", {}, "4,195", [
      mk("svg", { "aria-label": "View Count Icon" }),
      mk("span", {}, "4,195"),
    ]),
  ]);
  const reelsDoc = mk("div", {}, "", [mk("main", {}, "", [reelsCard])]);
  const reelItems = parsers.extractInstagramProfileItems(reelsDoc, 0, "sunsetgrillsanghyang");
  assert.equal(reelItems.length, 1);
  assert.equal(reelItems[0].gridViews, 4195, "angka di sebelah svg[aria-label='View Count Icon'] wajib terbaca sebagai gridViews meski hanya 2 angka di kartu");

  // 2. Kasus CrK_8oQrHiV: <time> komentar 2023-09-01 (tanpa a[href*="/c/"]) muncul lebih dulu di DOM daripada <time> postingan 2023-04-18
  const commentTimeLater = mk("time", { datetime: "2023-09-01T10:00:00.000Z" }, "1 Sep 2023");
  const postTimeAnchor = mk("a", { href: "/p/CrK_8oQrHiV/" }, "18 Apr 2023", [
    mk("time", { datetime: "2023-04-18T08:00:00.000Z" }, "18 Apr 2023"),
  ]);
  const postDetailDoc = mk("div", {}, "", [
    mk("ul", {}, "", [mk("ul", {}, "", [mk("li", {}, "Komentar telat", [commentTimeLater])])]),
    postTimeAnchor,
  ]);
  const detail = parsers.extractInstagramPostDetail(
    postDetailDoc,
    "https://www.instagram.com/sunsetgrillsanghyang/p/CrK_8oQrHiV/",
    null,
    ["sunsetgrillsanghyang"],
    Date.parse("2026-11-24T12:00:00.000Z"),
  );
  assert.ok(detail);
  assert.equal(
    detail.postedAt,
    "2023-04-18T08:00:00.000Z",
    `postedAt wajib memilih tanggal postingan di permalink (2023-04-18), bukan tanggal komentar belakangan (2023-09-01); dapat ${detail.postedAt}`,
  );
});

test("v1.1.8 TDD regresi footer-sentinel IG (footer 500px di bawah grid) & deteksi moved sejati pada kontainer read-only", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const contentSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/content-social.js"), "utf8");

  // 1. Regresi fatal v1.1.7: #scrollview memiliki <footer> setinggi 500px di bawah grid.
  //    Saat scrollTop mentok di scrollHeight - clientHeight, viewport menatap area <footer> sehingga sentinel
  //    IntersectionObserver TIDAK pernah masuk tengah viewport kecuali anchors[last].scrollIntoView({ block: "center" }) dipanggil!
  const TOTAL_POSTS = 180;
  const COLS = 3;
  const ROW_H = 300;
  const VIEWPORT_H = 900;
  const FOOTER_H = 500;
  const TOTAL_ROWS = Math.ceil(TOTAL_POSTS / COLS);

  const allUrls = Array.from({ length: TOTAL_POSTS }, (_, idx) => `/sanghyangresort/p/FooterFix_${String(idx + 1).padStart(4, "0")}/`);
  const observers: { cb: () => void; active: boolean }[] = [];
  class FooterMutationObserver {
    private rec: { cb: () => void; active: boolean };
    constructor(cb: () => void) {
      this.rec = { cb, active: false };
      observers.push(this.rec);
    }
    observe() {
      this.rec.active = true;
    }
    disconnect() {
      this.rec.active = false;
    }
  }
  const emitMutation = () => {
    for (const o of [...observers]) {
      if (o.active) o.cb();
    }
  };

  let loadedRows = 12; // 36 postingan awal
  let centerScrollIntoViewTriggers = 0;

  class FooterNode {
    tagName: string;
    id = "";
    attrs: Record<string, string>;
    textContent = "";
    innerText = "";
    parentElement: FooterNode | null = null;
    children: FooterNode[] = [];
    scrollHeight = 0;
    clientHeight = VIEWPORT_H;
    rowIndex = 0;
    private _scrollTop = 0;
    readOnlyScroll = false;
    onScrollChange?: (nextTop: number, prevTop: number) => void;
    onScrollIntoView?: (node: FooterNode, opts?: unknown) => void;

    constructor(tag: string, attrs: Record<string, string> = {}, text = "") {
      this.tagName = tag.toUpperCase();
      this.attrs = attrs;
      this.textContent = text;
      this.innerText = text;
    }
    get scrollTop() {
      return this._scrollTop;
    }
    set scrollTop(v: number) {
      if (this.readOnlyScroll) return;
      const prev = this._scrollTop;
      const maxTop = Math.max(0, this.scrollHeight - this.clientHeight);
      this._scrollTop = Math.max(0, Math.min(maxTop, Number(v) || 0));
      if (this.onScrollChange) this.onScrollChange(this._scrollTop, prev);
    }
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    }
    appendChild(ch: FooterNode) {
      ch.parentElement = this;
      this.children.push(ch);
      return ch;
    }
    getBoundingClientRect() {
      const top = this.rowIndex * ROW_H - scrollview.scrollTop;
      return { top, bottom: top + ROW_H, height: ROW_H, width: 300, left: 0, right: 300 };
    }
    scrollIntoView(opts?: unknown) {
      if (this.onScrollIntoView) this.onScrollIntoView(this, opts);
    }
    dispatchEvent() {
      return true;
    }
    matchesSimple(sel: string): boolean {
      const s = sel.trim();
      if (!s) return false;
      if (s === "main") return this.tagName === "MAIN";
      if (s === "footer") return this.tagName === "FOOTER";
      if (s === 'a[href*="/p/"]') return this.tagName === "A" && (this.attrs.href || "").includes("/p/");
      if (s === 'a[href*="/reel/"]') return this.tagName === "A" && (this.attrs.href || "").includes("/reel/");
      return false;
    }
    closest(sel: string): FooterNode | null {
      const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.some((p) => this.matchesSimple(p))) return this;
      let cur: FooterNode | null = this.parentElement;
      while (cur) {
        if (parts.some((p) => cur!.matchesSimple(p))) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(sel: string): FooterNode[] {
      const parts = sel.split(",").map((x) => x.trim()).filter(Boolean);
      const out: FooterNode[] = [];
      const walk = (n: FooterNode) => {
        for (const c of n.children) {
          if (parts.some((p) => c.matchesSimple(p))) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel: string): FooterNode | null {
      return this.querySelectorAll(sel)[0] ?? null;
    }
  }

  const scrollview = new FooterNode("DIV", { id: "scrollview" });
  scrollview.id = "scrollview";
  scrollview.clientHeight = VIEWPORT_H;
  scrollview.scrollHeight = loadedRows * ROW_H + FOOTER_H;

  const mainEl = new FooterNode("MAIN");
  const gridContainer = new FooterNode("DIV");
  const footerEl = new FooterNode("FOOTER");
  mainEl.appendChild(gridContainer);
  scrollview.appendChild(mainEl);
  scrollview.appendChild(footerEl);
  const rootBody = new FooterNode("BODY", {}, `sanghyangresort\n${TOTAL_POSTS} kiriman\n7.828 pengikut`);
  rootBody.appendChild(scrollview);

  const renderGrid = () => {
    const startRow = Math.max(0, Math.floor(scrollview.scrollTop / ROW_H) - 1);
    const endRow = Math.min(loadedRows, startRow + 8);
    gridContainer.children = [];
    for (let r = Math.max(0, startRow); r < endRow; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        if (idx >= TOTAL_POSTS) break;
        const a = new FooterNode("A", { href: allUrls[idx] });
        a.rowIndex = r;
        a.onScrollIntoView = (node, opts) => {
          const block = typeof opts === "object" && opts !== null ? (opts as { block?: string }).block : "start";
          const targetTop =
            block === "center"
              ? Math.max(0, node.rowIndex * ROW_H - Math.floor((VIEWPORT_H - ROW_H) / 2))
              : block === "end"
                ? Math.max(0, (node.rowIndex + 1) * ROW_H - VIEWPORT_H)
                : Math.max(0, node.rowIndex * ROW_H);
          scrollview.scrollTop = targetTop;
          // Sentinel Instagram hanya terpicu saat kartu terakhir ditempatkan tepat di tengah viewport (tidak tertutup footer 500px)!
          if (block === "center" && node.rowIndex >= loadedRows - 2 && loadedRows < TOTAL_ROWS) {
            centerScrollIntoViewTriggers++;
            loadedRows = Math.min(TOTAL_ROWS, loadedRows + 12);
            scrollview.scrollHeight = loadedRows * ROW_H + FOOTER_H;
            renderGrid();
            emitMutation();
          }
        };
        gridContainer.appendChild(a);
      }
    }
  };
  renderGrid();
  scrollview.onScrollChange = () => {
    renderGrid();
    emitMutation();
  };

  const metaDesc = new FooterNode("META", {
    property: "og:description",
    content: `7,828 Followers, 159 Following, ${TOTAL_POSTS} Posts - Sanghyang`,
  });
  const fakeDoc = {
    title: "Sanghyang (@sanghyangresort)",
    hidden: false,
    readyState: "complete",
    location: { pathname: "/sanghyangresort/" },
    body: rootBody,
    documentElement: { scrollHeight: VIEWPORT_H, clientHeight: VIEWPORT_H, scrollTop: 0 },
    scrollingElement: scrollview,
    querySelector: (sel: string) => {
      if (sel === "#scrollview") return scrollview;
      if (sel === "main") return mainEl;
      if (sel.includes("og:description")) return metaDesc;
      if (sel.includes('a[href*="/p/"]')) return gridContainer.children[0] ?? null;
      return null;
    },
    querySelectorAll: (sel: string) => rootBody.querySelectorAll(sel),
  };

  const sb: Record<string, unknown> = {
    SanghyangParsers: parsers,
    document: fakeDoc,
    window: {
      location: { href: "https://www.instagram.com/sanghyangresort/", pathname: "/sanghyangresort/" },
      innerHeight: VIEWPORT_H,
      scrollY: 0,
      scrollTo: () => {},
      scrollBy: () => {},
      getComputedStyle: () => ({ overflowY: "auto" }),
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    HTMLElement: FooterNode,
    MutationObserver: FooterMutationObserver,
    CustomEvent: class FakeCustomEvent {
      type: string;
      detail: unknown;
      constructor(t: string, init?: { detail?: unknown }) {
        this.type = t;
        this.detail = init?.detail;
      }
    },
    Event: class FakeEvent {
      type: string;
      constructor(t: string) {
        this.type = t;
      }
    },
    WheelEvent: class FakeWheelEvent {
      type: string;
      deltaY: number;
      constructor(t: string, init?: { deltaY?: number }) {
        this.type = t;
        this.deltaY = init?.deltaY ?? 0;
      }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    Set,
    Map,
    Array,
    Math,
    Boolean,
    Number,
    String,
    RegExp,
    URL,
    JSON,
    globalThis: {} as Record<string, unknown>,
  };
  sb.globalThis = sb;
  vm.runInNewContext(contentSrc, sb);

  const runProfile = sb.__sanghyangRunProfile as (
    platform: string,
    maxItems: number,
    targetHandle: string,
    allowedCollabHandles: string[],
    runOpts?: Record<string, unknown>,
  ) => Promise<{
    items: Array<{ sourceUrl: string }>;
    scan: { collected: number; expected: number | null; stoppedBy: string; reachedBottom: boolean };
  }>;

  const resFooter = await runProfile("instagram", 0, "sanghyangresort", ["sanghyangresort"], {
    stepWaitMs: 5,
    bottomWaitMs: 30,
    sweepStepWaitMs: 5,
  });
  assert.ok(
    centerScrollIntoViewTriggers >= 4,
    `Hybrid Sentinel Scroll wajib memanggil anchors[last].scrollIntoView({ block: "center" }) agar sentinel di atas footer 500px terpicu (tercatat ${centerScrollIntoViewTriggers}x)`,
  );
  assert.equal(
    resFooter.items.length,
    TOTAL_POSTS,
    `profil Instagram ber-footer 500px wajib menangkap 100% (${TOTAL_POSTS}/${TOTAL_POSTS}) postingan, bukan macet di 36/96! Dapat ${resFooter.items.length}`,
  );
  assert.equal(resFooter.scan.reachedBottom, true);

  // 2. Uji moved sejati: jika el.scrollTop terkunci (read-only) dan window.scrollY tidak berubah, moved WAJIB false!
  const hooks = sb.__sanghyangContentTestHooks as {
    scrollAndWaitForGrowth: (platform: string, ctx: Record<string, unknown>) => Promise<{ moved: boolean }>;
  };
  scrollview.scrollTop = 100;
  scrollview.readOnlyScroll = true;
  const stuckRes = await hooks.scrollAndWaitForGrowth("instagram", {
    stale: 0,
    hasNewItem: () => false,
    waitMs: 15,
  });
  assert.equal(
    stuckRes.moved,
    false,
    "jika scrollTop tidak benar-benar naik (actualTop === prevTop), moved wajib false (tidak boleh mengandalkan nextTop > prevTop)",
  );
});

test("v1.1.8 TDD anti-false reachedBottom: hasNextPage===true atau 250/1739 wajib reachedBottom=false, sedangkan hasNextPage===false selesai cepat", async () => {
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");

  // 1. Server menyatakan hasNextPage === true -> walau atBottom=true & stale habis, reachedBottom WAJIB false!
  const items100 = Array.from({ length: 100 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/sanghyangresort/p/NextPage_${i + 1}/`,
    postType: "feed",
  }));
  const resHasNext = await parsers.collectFeedItems({
    collect: () => items100,
    advance: async () => ({ moved: false, wasAtBottom: true, atBottom: true, hasSpinner: false }),
    isAtBottom: () => true,
    hasSpinner: () => false,
    getHasNextPage: () => true,
    maxItems: 0,
    expectedTotal: 150,
    staleRounds: 3,
    minItemsPerRound: 3,
    maxRoundsUnknown: 50,
  });
  assert.equal(
    resHasNext.reachedBottom,
    false,
    "ketika pagination server menyatakan hasNextPage === true, reachedBottom TIDAK boleh pernah true",
  );
  assert.equal(resHasNext.hasNextPage, true);
  assert.ok(resHasNext.rounds > 3, "bila hasNextPage === true saat stale menumpuk, gulir wajib memberi tambahan kesabaran/osilasi");

  // 2. Kasus nyata @sanghyangresort 250 / 1.739 (14% < 50%) tanpa sinyal hasNextPage -> reachedBottom WAJIB false!
  const items250 = Array.from({ length: 250 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/sanghyangresort/p/LowCov_${i + 1}/`,
    postType: "feed",
  }));
  const res250 = await parsers.collectFeedItems({
    collect: () => items250,
    advance: async () => ({ moved: false, wasAtBottom: true, atBottom: true, hasSpinner: false }),
    isAtBottom: () => true,
    hasSpinner: () => false,
    getHasNextPage: () => null,
    maxItems: 0,
    expectedTotal: 1739,
    staleRounds: 3,
    minItemsPerRound: 3,
    maxRoundsUnknown: 50,
  });
  assert.equal(
    res250.reachedBottom,
    false,
    "250 / 1.739 (14% < 50% dari expected >= 50) TIDAK BOLEH PERNAH diberi reachedBottom=true",
  );

  // 3. Server resmi menyatakan hasNextPage === false & atBottom === true -> selesai bersih dalam <= 2 putaran (tanpa tunggu 7 putaran)
  const items80 = Array.from({ length: 80 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/sunsetgrillsanghyang/p/DoneFeed_${i + 1}/`,
    postType: "feed",
  }));
  const resDone = await parsers.collectFeedItems({
    collect: () => items80,
    advance: async () => ({ moved: false, wasAtBottom: true, atBottom: true, hasSpinner: false }),
    isAtBottom: () => true,
    hasSpinner: () => false,
    getHasNextPage: () => false,
    maxItems: 0,
    expectedTotal: 100,
    staleRounds: 7,
    minItemsPerRound: 3,
    maxRoundsUnknown: 50,
  });
  assert.ok(resDone.rounds <= 2, `saat server hasNextPage === false & atBottom, wajib selesai dalam <= 2 putaran (dapat ${resDone.rounds})`);
  assert.equal(resDone.reachedBottom, true, "halaman terakhir terkonfirmasi server (80/100 >= 50%) wajib reachedBottom=true");
  assert.equal(resDone.hasNextPage, false);
});

test("v1.1.8 TDD background.js fast-save feed-tap (DETAIL_COMMENT_WINDOW=25), skippedKnown/feedSaved/hasNextPage, PEEK limit 15..25, dan anti-false reachedBottom 250/1739", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const bgSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");

  type TabRec = { id: number; url: string; status: string; incognito: boolean; windowId: number; active: boolean };
  function makeBgV118(opts: {
    onExecuteScript: (arg: { target: { tabId: number }; args?: unknown[] }) => Promise<unknown> | unknown;
  }) {
    const storage = new Map<string, unknown>();
    const tabs = new Map<number, TabRec>();
    const tabUpdates: { tabId: number; opts: Record<string, unknown> }[] = [];
    let nextId = 400;
    const fakeChrome = {
      storage: {
        local: {
          get: async (k: string) => ({ [k]: storage.get(k) }),
          set: async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) storage.set(k, v);
          },
        },
      },
      windows: { getAll: async () => [{ id: 1, incognito: false }], update: async () => ({}) },
      tabs: {
        get: async (id: number) => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          return { ...t };
        },
        create: async (c: Record<string, unknown>) => {
          const t: TabRec = { id: nextId++, url: String(c.url || ""), status: "complete", incognito: false, windowId: 1, active: Boolean(c.active) };
          tabs.set(t.id, t);
          return { ...t };
        },
        update: async (id: number, u: Record<string, unknown>) => {
          tabUpdates.push({ tabId: id, opts: u });
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          if (typeof u.url === "string") {
            t.url = u.url;
            t.status = "complete";
          }
          if (typeof u.active === "boolean") t.active = u.active;
          return { ...t };
        },
        remove: async (id: number) => {
          tabs.delete(id);
        },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      scripting: {
        executeScript: async (arg: { target: { tabId: number }; args?: unknown[]; files?: string[]; world?: string }) => {
          if (Array.isArray(arg.args) && arg.args.length === 1) return [{ result: true }];
          if (Array.isArray(arg.files)) return [{ result: true }];
          const res = await opts.onExecuteScript(arg);
          return [{ result: res }];
        },
      },
      runtime: {
        getManifest: () => ({ version: "1.1.8" }),
        getURL: (f: string) => `chrome-extension://test/${f}`,
        onMessageExternal: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
    };
    const sb: Record<string, unknown> = {
      chrome: fakeChrome,
      URL,
      Set,
      Map,
      Array,
      Math,
      Date,
      Promise,
      Error,
      Boolean,
      Number,
      String,
      RegExp,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      globalThis: {} as Record<string, unknown>,
    };
    sb.globalThis = sb;
    vm.runInNewContext(bgSrc, sb);
    return {
      hooks: sb.__sanghyangBackgroundTestHooks as {
        handleCommand: (
          msg: Record<string, unknown>,
          origin: string | null,
          senderTab?: { id?: number; windowId?: number; incognito?: boolean } | null,
        ) => Promise<Record<string, unknown>>;
      },
      tabUpdates,
    };
  }

  // 1. Fast-save 72 postingan historis lengkap dari feed-tap, skip 100 known, dan buka detail HANYA 28 item (25 terbaru + 3 historis tak lengkap)
  const items200 = Array.from({ length: 200 }, (_, i) => {
    const isReel = i % 5 === 0;
    const base = {
      sourceUrl: `https://www.instagram.com/sanghyangresort/${isReel ? "reel" : "p"}/FeedItem${String(i + 1).padStart(4, "0")}/`,
      postType: isReel ? "reels" : "feed",
      postedAt: new Date(Date.UTC(2026, 10, 20) - i * 86_400_000).toISOString(),
      caption: `Promo pantai Sanghyang #${i + 1}`,
      imageUrl: `https://cdninstagram.com/img_${i + 1}.jpg`,
      gridViews: isReel ? 1200 + i : null,
      gridLikes: 40 + i,
      gridComments: 3,
      gridShares: 2,
      fromFeedTap: true,
    };
    if (i === 25) return { ...base, postedAt: null }; // tidak lengkap: tanpa postedAt
    if (i === 26) return { ...base, caption: "", imageUrl: null, gridViews: null, gridLikes: null, gridComments: null, gridShares: null }; // tidak lengkap: kosong total
    if (i === 27) return { ...base, fromFeedTap: false, postType: "reels", gridViews: null }; // tidak lengkap: DOM-only reel tanpa gridViews
    return base;
  });
  const known100 = items200.slice(40, 140).map((x) => x.sourceUrl);
  const visitedDetails: string[] = [];
  const detailsPhaseCapture: { state: Record<string, unknown> | null } = { state: null };
  let callNum = 0;

  const bgFast = makeBgV118({
    onExecuteScript: async (arg) => {
      const fn = arg.args?.[0];
      if (fn === "__sanghyangRunProfile") {
        callNum++;
        if (callNum === 1) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: items200,
            profile: { followers: 7828, posts: 200 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 10, expected: 200, collected: 200, stoppedBy: "expected", reachedBottom: true, hasNextPage: false },
          };
        }
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: 7828, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 2, expected: null, collected: 0, stoppedBy: "end_of_feed", reachedBottom: true, hasNextPage: false },
        };
      }
      if (fn === "__sanghyangRunPost") {
        if (!detailsPhaseCapture.state) {
          detailsPhaseCapture.state = ((await bgFast.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state ?? null) as Record<string, unknown> | null;
        }
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        visitedDetails.push(postUrl);
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: postUrl.includes("/reel/") ? "reels" : "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Detail penuh",
            imageUrl: null,
            metrics: { views: 1500, likes: 50, comments: 4, shares: 1 },
            comments: [],
          },
        };
      }
      return true;
    },
  });

  await bgFast.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: known100,
      targets: [
        {
          targetKey: "own:instagram:sanghyangresort",
          targetType: "own",
          name: "Sanghyang Resort",
          platform: "instagram",
          handle: "sanghyangresort",
          profileUrl: "https://www.instagram.com/sanghyangresort/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 300));
  const stFast = (await bgFast.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(stFast.status, "completed");
  assert.equal(
    visitedDetails.length,
    28,
    `hanya 25 terbaru + 3 historis tak lengkap yang boleh dibuka detailnya (dapat ${visitedDetails.length})`,
  );
  assert.equal(stFast.pendingCount, 100, "72 fast-save dari feed + 28 detail = 100 postingan di pendingPosts");
  assert.equal(stFast.syncedPostsCount, 100);
  assert.equal(detailsPhaseCapture.state?.currentSkippedKnown, 100, "summarizeState wajib mengekspos currentSkippedKnown=100 saat fase details");
  assert.equal(detailsPhaseCapture.state?.currentFeedSaved, 72, "summarizeState wajib mengekspos currentFeedSaved=72 saat fase details");
  assert.equal(detailsPhaseCapture.state?.currentDetailTotal, 28, "currentDetailTotal wajib 28");
  assert.equal(detailsPhaseCapture.state?.currentHasNextPage, false, "summarizeState wajib mengekspos currentHasNextPage");
  const fastTarget = (stFast.targetResults as Array<Record<string, unknown>>)[0];
  assert.equal(fastTarget?.skippedKnown, 100);
  assert.equal(fastTarget?.feedSaved, 72);
  assert.equal(fastTarget?.hasNextPage, false);

  // PEEK_PENDING_BATCH wajib mendukung limit hingga 25 (termasuk 15 untuk VRP batching 3x lebih cepat)
  const peek15 = await bgFast.hooks.handleCommand({ type: "PEEK_PENDING_BATCH", limit: 15 }, "http://localhost:3001");
  assert.equal((peek15.posts as unknown[]).length, 15, "PEEK_PENDING_BATCH(limit: 15) wajib mengembalikan 15 postingan");
  const peek25 = await bgFast.hooks.handleCommand({ type: "PEEK_PENDING_BATCH", limit: 25 }, "http://localhost:3001");
  assert.equal((peek25.posts as unknown[]).length, 25, "PEEK_PENDING_BATCH(limit: 25) wajib mengembalikan 25 postingan");

  // 2. Anti-false reachedBottom pada 250 / 1.739 + hasNextPage===true: wajib retry aktif tab 1x, reachedBottom=false, status="partial", & error "gulir berhenti lebih awal"
  const items250 = Array.from({ length: 250 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/sanghyangresort/p/Stuck${i + 1}/`,
    postType: "feed",
  }));
  let stuckCalls = 0;
  const bgStuck = makeBgV118({
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        stuckCalls++;
        if (stuckCalls <= 2) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: items250,
            profile: { followers: 7828, posts: 1739 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            // Bahkan jika scan keliru melaporkan reachedBottom: true, background.js wajib menolaknya saat 250/1739 atau hasNextPage===true!
            scan: { rounds: 10, expected: 1739, collected: 250, stoppedBy: "stale", reachedBottom: true, hasNextPage: true },
          };
        }
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: 7828, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 2, expected: null, collected: 0, stoppedBy: "end_of_feed", reachedBottom: true, hasNextPage: false },
        };
      }
      if (arg.args?.[0] === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Konten",
            imageUrl: null,
            metrics: { views: null, likes: 5, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });
  await bgStuck.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: items250.map((x) => x.sourceUrl),
      targets: [
        {
          targetKey: "own:instagram:sanghyangresort",
          targetType: "own",
          name: "Sanghyang Resort",
          platform: "instagram",
          handle: "sanghyangresort",
          profileUrl: "https://www.instagram.com/sanghyangresort/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 2, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 300));
  const stStuck = (await bgStuck.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(stStuck.status, "completed");
  assert.ok(stuckCalls >= 3, `hasNextPage===true / 250/1739 wajib memicu retry aktif tab sebelum tab Reels (tercatat ${stuckCalls} panggilan)`);
  assert.ok(bgStuck.tabUpdates.some((u) => u.opts.active === true), "retry hasNextPage===true wajib mengaktifkan tab pekerja");
  const stuckTarget = (stStuck.targetResults as Array<Record<string, unknown>>)[0];
  assert.equal(stuckTarget?.reachedBottom, false, "250 / 1.739 atau hasNextPage===true WAJIB reachedBottom=false");
  assert.equal(stuckTarget?.status, "partial");
  assert.equal(stuckTarget?.hasNextPage, true);
  assert.match(String(stuckTarget?.reason || ""), /gulir berhenti lebih awal/i);
  assert.doesNotMatch(String(stuckTarget?.reason || ""), /mencapai batas bawah profil/i);
});

test("v1.1.8 TDD integrasi passive feed-tap + DOM di content-social.js: replay document_start + 100% item terserap meski virtualizer menghapus DOM + hasNextPage resmi", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const feedParsers = require("../../extension/sanghyang-social-sync/feed-parsers.js");
  const feedTapSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/feed-tap.js"), "utf8");
  const contentSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/content-social.js"), "utf8");

  // Simulasikan jembatan MAIN world (feed-tap.js) <-> ISOLATED world (feed-parsers.js + parsers.js + content-social.js)
  // lewat window CustomEvent (seperti isolasi world Chrome MV3: tidak berbagi window.* property, hanya CustomEvent!).
  const eventListeners = new Map<string, Array<(ev: unknown) => void>>();
  const sharedAddEventListener = (type: string, fn: (ev: unknown) => void) => {
    const list = eventListeners.get(type) ?? [];
    list.push(fn);
    eventListeners.set(type, list);
  };
  const sharedRemoveEventListener = (type: string, fn: (ev: unknown) => void) => {
    const list = eventListeners.get(type) ?? [];
    eventListeners.set(type, list.filter((x) => x !== fn));
  };
  const sharedDispatchEvent = (ev: { type: string; detail?: unknown }) => {
    for (const fn of [...(eventListeners.get(ev.type) ?? [])]) {
      fn(ev);
    }
    return true;
  };
  class SharedCustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  // 3 halaman JSON GraphQL (total 18 item: 6 dari document_start sebelum content-social berjalan + 12 saat scroll),
  // sementara DOM virtualizer hanya pernah merender 3 kartu terakhir (sehingga tanpa feed-tap 15 item hilang!).
  const makeIgEdge = (idx: number) => ({
    node: {
      code: `TapPost${String(idx).padStart(3, "0")}`,
      media_type: idx % 3 === 0 ? 2 : 1,
      product_type: idx % 3 === 0 ? "clips" : "feed",
      taken_at: 1794500000 - idx * 3600,
      caption: { text: `Postingan feed-tap asli #${idx}` },
      like_count: 50 + idx,
      comment_count: 2 + (idx % 5),
      play_count: idx % 3 === 0 ? 1500 + idx * 10 : null,
      reshare_count: 3,
      user: { username: idx === 5 ? "partner_collab_anyer" : "sanghyangresort" },
      image_versions2: { candidates: [{ url: `https://scontent.cdninstagram.com/tap_${idx}.jpg` }] },
    },
  });

  const pagePayloads = [
    {
      data: {
        user: { edge_followed_by: { count: 7828 }, edge_owner_to_timeline_media: { count: 18 } },
        xdt_api__v1__feed__user_timeline_graphql_connection: {
          edges: Array.from({ length: 6 }, (_, i) => makeIgEdge(i + 1)),
          page_info: { has_next_page: true },
        },
      },
    },
    {
      data: {
        xig_user_by_username: {
          follower_count: 7828,
          all_media_count: 18,
          polaris_ordered_timeline_connection: {
            edges: Array.from({ length: 6 }, (_, i) => makeIgEdge(i + 7)),
            page_info: { has_next_page: true },
          },
          lox_highlights_connection: {
            edges: [{ node: { id: "highlight:1" } }],
            page_info: { has_next_page: true },
          },
        },
      },
    },
    {
      data: {
        node: {
          __typename: "User",
          polaris_ordered_timeline_connection: {
            edges: Array.from({ length: 6 }, (_, i) => makeIgEdge(i + 13)),
            page_info: { has_next_page: false },
          },
        },
      },
    },
  ];

  // 1. Jalankan feed-tap.js di MAIN world dulu (simulasi document_start)
  let nextFetchPage = 0;
  const mainWindow: Record<string, unknown> = {
    location: {
      href: "https://www.instagram.com/sanghyangresort/",
      origin: "https://www.instagram.com",
      hostname: "www.instagram.com",
      pathname: "/sanghyangresort/",
    },
    addEventListener: sharedAddEventListener,
    removeEventListener: sharedRemoveEventListener,
    dispatchEvent: sharedDispatchEvent,
    fetch: async () => {
      const payload = pagePayloads[Math.min(nextFetchPage, pagePayloads.length - 1)];
      nextFetchPage++;
      const text = JSON.stringify(payload);
      return {
        ok: true,
        status: 200,
        clone: () => ({ text: async () => text }),
        text: async () => text,
      };
    },
  };
  const mainSb: Record<string, unknown> = {
    window: mainWindow,
    CustomEvent: SharedCustomEvent,
    URL,
    Set,
    Map,
    WeakMap,
    Array,
    Math,
    Date,
    Promise,
    JSON,
    Number,
    String,
    Boolean,
    RegExp,
    Intl,
    BigInt,
    globalThis: {} as Record<string, unknown>,
  };
  mainSb.globalThis = mainSb;
  vm.runInNewContext(feedTapSrc, mainSb);

  // Batch halaman 1 datang saat document_start SEBELUM content-social.js dimuat!
  await (mainWindow.fetch as (url: string) => Promise<unknown>)("https://www.instagram.com/graphql/query?doc_id=123");
  await new Promise((r) => setTimeout(r, 15));

  // 2. Sekarang muat content-social.js di ISOLATED world (terpisah dari mainWindow!)
  class DomStub {
    tagName: string;
    id = "";
    attrs: Record<string, string>;
    textContent = "";
    innerText = "";
    parentElement: DomStub | null = null;
    children: DomStub[] = [];
    scrollHeight = 1800;
    clientHeight = 900;
    scrollTop = 0;
    constructor(tag: string, attrs: Record<string, string> = {}, text = "") {
      this.tagName = tag.toUpperCase();
      this.attrs = attrs;
      this.textContent = text;
      this.innerText = text;
    }
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    }
    appendChild(ch: DomStub) {
      ch.parentElement = this;
      this.children.push(ch);
      return ch;
    }
    scrollIntoView() {
      // Simulasi halaman memicu fetch GraphQL halaman berikutnya saat scroll menyentuh sentinel,
      // namun virtualizer langsung menghapus kartu lama sehingga DOM hanya selalu menyisakan 3 kartu terakhir!
      if (nextFetchPage < pagePayloads.length) {
        const currentPage = nextFetchPage;
        void (mainWindow.fetch as (url: string) => Promise<unknown>)("https://www.instagram.com/api/graphql").then(() => {
          const base = currentPage * 6;
          gridDiv.children = [
            new DomStub("A", { href: `/sanghyangresort/p/TapPost${String(base + 4).padStart(3, "0")}/` }),
            new DomStub("A", { href: `/sanghyangresort/p/TapPost${String(base + 5).padStart(3, "0")}/` }),
            new DomStub("A", { href: `/sanghyangresort/reel/TapPost${String(base + 6).padStart(3, "0")}/` }),
          ];
          for (const c of gridDiv.children) c.parentElement = gridDiv;
        });
      }
    }
    dispatchEvent() {
      return true;
    }
    closest() {
      return null;
    }
    querySelectorAll(sel: string): DomStub[] {
      const out: DomStub[] = [];
      const walk = (n: DomStub) => {
        for (const c of n.children) {
          if ((sel.includes('a[href*="/p/"]') && c.tagName === "A" && (c.attrs.href || "").includes("/p/")) ||
              (sel.includes('a[href*="/reel/"]') && c.tagName === "A" && (c.attrs.href || "").includes("/reel/"))) {
            out.push(c);
          }
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel: string): DomStub | null {
      return this.querySelectorAll(sel)[0] ?? null;
    }
  }

  const scrollview = new DomStub("DIV", { id: "scrollview" });
  scrollview.id = "scrollview";
  const mainEl = new DomStub("MAIN");
  const gridDiv = new DomStub("DIV");
  // Hanya 2 kartu DOM awal (4 item awal lainnya langsung di-unmount virtualizer!)
  gridDiv.appendChild(new DomStub("A", { href: "/sanghyangresort/p/TapPost005/" }));
  gridDiv.appendChild(new DomStub("A", { href: "/sanghyangresort/reel/TapPost006/" }));
  mainEl.appendChild(gridDiv);
  scrollview.appendChild(mainEl);
  const bodyEl = new DomStub("BODY", {}, "sanghyangresort\n18 kiriman\n7.828 pengikut");
  bodyEl.appendChild(scrollview);

  class SimpleObserver {
    observe() {}
    disconnect() {}
  }

  const isoSb: Record<string, unknown> = {
    SanghyangParsers: parsers,
    SanghyangFeedParsers: feedParsers,
    document: {
      title: "Sanghyang (@sanghyangresort)",
      hidden: false,
      readyState: "complete",
      location: { pathname: "/sanghyangresort/" },
      body: bodyEl,
      documentElement: { scrollHeight: 900, clientHeight: 900, scrollTop: 0 },
      scrollingElement: scrollview,
      querySelector: (sel: string) => {
        if (sel === "#scrollview") return scrollview;
        if (sel === "main") return mainEl;
        if (sel.includes('a[href*="/p/"]')) return gridDiv.children[0] ?? null;
        return null;
      },
      querySelectorAll: (sel: string) => bodyEl.querySelectorAll(sel),
    },
    window: {
      location: {
        href: "https://www.instagram.com/sanghyangresort/",
        origin: "https://www.instagram.com",
        hostname: "www.instagram.com",
        pathname: "/sanghyangresort/",
      },
      innerHeight: 900,
      scrollY: 0,
      scrollTo: () => {},
      scrollBy: () => {},
      getComputedStyle: () => ({ overflowY: "auto" }),
      addEventListener: sharedAddEventListener,
      removeEventListener: sharedRemoveEventListener,
      dispatchEvent: sharedDispatchEvent,
    },
    HTMLElement: DomStub,
    MutationObserver: SimpleObserver,
    CustomEvent: SharedCustomEvent,
    Event: class FakeEvent {
      type: string;
      constructor(t: string) {
        this.type = t;
      }
    },
    WheelEvent: class FakeWheelEvent {
      type: string;
      constructor(t: string) {
        this.type = t;
      }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    Set,
    Map,
    Array,
    Math,
    Boolean,
    Number,
    String,
    RegExp,
    URL,
    JSON,
    globalThis: {} as Record<string, unknown>,
  };
  isoSb.globalThis = isoSb;
  vm.runInNewContext(contentSrc, isoSb);

  const runProfile = isoSb.__sanghyangRunProfile as (
    platform: string,
    maxItems: number,
    targetHandle: string,
    allowedCollabHandles: string[],
    runOpts?: Record<string, unknown>,
  ) => Promise<{
    items: Array<{ sourceUrl: string; postedAt?: string | null; caption?: string | null; gridViews?: number | null; gridLikes?: number | null }>;
    profile: { followers: number | null; posts: number | null };
    scan: { collected: number; expected: number | null; reachedBottom: boolean; hasNextPage?: boolean | null };
  }>;

  const resTap = await runProfile("instagram", 0, "sanghyangresort", ["sanghyangresort"], {
    stepWaitMs: 10,
    bottomWaitMs: 40,
    sweepStepWaitMs: 10,
  });

  assert.equal(
    resTap.items.length,
    18,
    `passive feed-tap + replay document_start wajib menangkap 18/18 (100%) walau virtualizer menghapus DOM; dapat ${resTap.items.length}`,
  );
  assert.equal(resTap.profile.followers, 7828, "profileMeta dari feed-tap wajib melengkapi followers");
  assert.equal(resTap.profile.posts, 18, "profileMeta dari feed-tap wajib melengkapi posts");
  assert.equal(resTap.scan.hasNextPage, false, "hasNextPage halaman terakhir (false) wajib diteruskan di scan");
  assert.equal(resTap.scan.reachedBottom, true);
  const firstTap = resTap.items.find((x) => x.sourceUrl.includes("TapPost001"));
  assert.ok(firstTap, "batch awal dari document_start (TapPost001) wajib terserap lewat __sanghyang_feed_replay_req__");
  assert.ok(firstTap?.postedAt, "postedAt JSON feed-tap wajib terisi pada item hasil scan");
  assert.equal(firstTap?.caption, "Postingan feed-tap asli #1");
  const collabTap = resTap.items.find((x) => x.sourceUrl.includes("TapPost005"));
  assert.ok(collabTap?.sourceUrl.includes("partner_collab_anyer"), "kolaborasi eksternal dari feed-tap wajib ikut terserap");
  const reelTap = resTap.items.find((x) => x.sourceUrl.includes("TapPost003"));
  assert.equal(reelTap?.gridViews, 1530, "gridViews reel dari feed-tap wajib terbaca akurat");
});

test("v1.1.9 TDD TikTok Photo Mode (/photo/<id>): rehydration webapp.photo-detail, imagePost.images[0], DOM photo, content-social replay, & background verified feed-tap merge", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const parsers = require("../../extension/sanghyang-social-sync/parsers.js");
  const feedParsers = require("../../extension/sanghyang-social-sync/feed-parsers.js");
  const contentSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/content-social.js"), "utf8");
  const bgSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");
  const nowMs = Date.parse("2026-11-25T10:00:00.000Z");

  // 1. parsers.js: membaca webapp.photo-detail + imagePost.images[0].imageURL.urlList[0] + Snowflake ID postedAt
  const photoRehydration = JSON.stringify({
    __DEFAULT_SCOPE__: {
      "webapp.photo-detail": {
        itemInfo: {
          itemStruct: {
            id: "7703084124281703698",
            desc: "",
            imagePost: {
              title: "Promo Liburan Tepi Pantai Sanghyang",
              images: [
                { imageURL: { urlList: ["https://p16-sign-sg.tiktokcdn.com/photo-slide-1.jpeg"] } },
              ],
            },
            stats: { playCount: 4200, diggCount: 185, commentCount: 11, shareCount: 19 },
          },
        },
      },
    },
  });
  const photoRehydDoc = {
    querySelector: (sel: string) => {
      if (sel === "#__UNIVERSAL_DATA_FOR_REHYDRATION__") return { textContent: photoRehydration };
      return null;
    },
    querySelectorAll: () => [],
  };
  const parsedPhoto = parsers.extractTikTokVideoDetail(
    photoRehydDoc,
    "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698",
    null,
    ["sanghyangsparesort"],
    nowMs,
  );
  assert.ok(parsedPhoto, "TikTok /photo/ dengan webapp.photo-detail wajib terbaca");
  assert.equal(parsedPhoto.postType, "carousel");
  assert.equal(parsedPhoto.caption, "Promo Liburan Tepi Pantai Sanghyang");
  assert.equal(parsedPhoto.imageUrl, "https://p16-sign-sg.tiktokcdn.com/photo-slide-1.jpeg");
  assert.equal(
    parsedPhoto.postedAt,
    parsers.tiktokTimestampFromVideoId("7703084124281703698", nowMs),
    "tanpa createTime, postedAt /photo/ wajib jatuh ke Snowflake ID 64-bit",
  );
  assert.equal(parsedPhoto.metrics.views, 4200);
  assert.equal(parsedPhoto.metrics.likes, 185);
  assert.equal(parsedPhoto.metrics.comments, 11);
  assert.equal(parsedPhoto.metrics.shares, 19);

  // 2. parsers.js: DOM Photo Mode ([data-e2e="detail-photo"] img + [data-e2e="new-desc-span"]) tanpa JSON rehydration
  const photoDomOnlyDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('[data-e2e="detail-photo"] img')) {
        return { getAttribute: (k: string) => (k === "src" ? "https://p16-sign-sg.tiktokcdn.com/dom-slide.jpeg" : null) };
      }
      if (sel.includes('[data-e2e="new-desc-span"]')) return { textContent: "Galeri Sunset Grill Anyer" };
      return null;
    },
    querySelectorAll: () => [],
  };
  const parsedPhotoDom = parsers.extractTikTokVideoDetail(
    photoDomOnlyDoc,
    "https://www.tiktok.com/@sanghyangsparesort/photo/7680164747412557064",
    { gridViews: 910 },
    ["sanghyangsparesort"],
    nowMs,
  );
  assert.ok(parsedPhotoDom, "TikTok /photo/ dengan DOM [data-e2e=detail-photo] wajib terbaca walau rehydration kosong");
  assert.equal(parsedPhotoDom.postType, "carousel");
  assert.equal(parsedPhotoDom.imageUrl, "https://p16-sign-sg.tiktokcdn.com/dom-slide.jpeg");
  assert.equal(parsedPhotoDom.caption, "Galeri Sunset Grill Anyer");
  assert.equal(parsedPhotoDom.metrics.views, 910);
  assert.ok(parsedPhotoDom.postedAt, "postedAt wajib terisi dari Snowflake ID 64-bit");

  // 3. content-social.js: __sanghyangRunPost pada halaman /photo/ dengan readySelectors Photo Mode + replay /api/item/detail/
  const eventListeners = new Map<string, Array<(ev: unknown) => void>>();
  const detailEventApi = {
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      const list = eventListeners.get(type) ?? [];
      list.push(fn);
      eventListeners.set(type, list);
    },
    dispatchEvent: (ev: { type: string; detail?: unknown }) => {
      if (ev.type === "__sanghyang_feed_replay_req__") {
        const chunkDetail = JSON.stringify({
          __sanghyangCleanChunk: true,
          version: 1,
          platform: "tiktok",
          url: "https://www.tiktok.com/api/item/detail/",
          pageHref: "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698",
          capturedAt: nowMs,
          hasNextPage: null,
          profileMeta: null,
          items: [
            {
              sourceUrl: "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698",
              postType: "carousel",
              postedAt: parsers.tiktokTimestampFromVideoId("7703084124281703698", nowMs),
              caption: "Detail photo dari /api/item/detail/",
              imageUrl: "https://p16-sign-sg.tiktokcdn.com/tapped-photo.jpeg",
              gridViews: 3300,
              gridLikes: 92,
              gridComments: 5,
              gridShares: 8,
              ownerHandle: "sanghyangsparesort",
            },
          ],
        });
        for (const fn of [...(eventListeners.get("__sanghyang_feed_chunk__") ?? [])]) {
          fn({ type: "__sanghyang_feed_chunk__", detail: chunkDetail });
        }
      }
      return true;
    },
  };
  class SimpleObs {
    observe() {}
    disconnect() {}
  }
  const photoContentSb: Record<string, unknown> = {
    SanghyangParsers: parsers,
    SanghyangFeedParsers: feedParsers,
    document: {
      title: "Sanghyang (@sanghyangsparesort) | TikTok",
      hidden: false,
      readyState: "complete",
      location: { pathname: "/@sanghyangsparesort/photo/7703084124281703698" },
      body: { innerText: "Sanghyang Photo Mode" },
      documentElement: {},
      querySelector: (sel: string) => (sel.includes('[data-e2e="detail-photo"]') ? { tagName: "DIV" } : null),
      querySelectorAll: () => [],
    },
    window: {
      location: {
        href: "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698",
        origin: "https://www.tiktok.com",
        hostname: "www.tiktok.com",
        pathname: "/@sanghyangsparesort/photo/7703084124281703698",
      },
      addEventListener: detailEventApi.addEventListener,
      removeEventListener: () => {},
      dispatchEvent: detailEventApi.dispatchEvent,
    },
    HTMLElement: class {},
    MutationObserver: SimpleObs,
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(t: string, o?: { detail?: unknown }) {
        this.type = t;
        this.detail = o?.detail;
      }
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Promise,
    Set,
    Map,
    Array,
    Math,
    Boolean,
    Number,
    String,
    RegExp,
    URL,
    JSON,
    globalThis: {} as Record<string, unknown>,
  };
  photoContentSb.globalThis = photoContentSb;
  vm.runInNewContext(contentSrc, photoContentSb);
  const runPost = photoContentSb.__sanghyangRunPost as (
    platform: string,
    postUrl: string,
    gridStats: unknown,
    allowedHandles: string[],
  ) => Promise<{ challenge: { blocked: boolean }; post: Record<string, unknown> | null }>;
  const photoRunRes = await runPost(
    "tiktok",
    "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698",
    { gridViews: 3300 },
    ["sanghyangsparesort"],
  );
  assert.equal(photoRunRes.challenge.blocked, false);
  assert.ok(photoRunRes.post, "__sanghyangRunPost wajib membaca /photo/ dari replay /api/item/detail/ walau DOM minim");
  assert.equal(photoRunRes.post?.postType, "carousel");
  assert.equal(photoRunRes.post?.caption, "Detail photo dari /api/item/detail/");
  assert.equal((photoRunRes.post?.metrics as Record<string, unknown>)?.likes, 92);

  // 4. background.js:
  //    a) Top-25 /photo/ item dari feed-tap yg tab detailnya mengembalikan post:null -> digabung dari metadata feed-tap terverifikasi (0 error!)
  //    b) Post #26+ /photo/ item tanpa caption & gridViews null dari feed-tap -> fast-save langsung (carousel bukan video!)
  //    c) Item DOM kosong (tanpa fromFeedTap & tanpa postedAt) yg detailnya post:null -> tetap gagal jujur (Zero Fallback!)
  type TabRec = { id: number; url: string; status: string; incognito: boolean; windowId: number; active: boolean };
  const storage = new Map<string, unknown>();
  const tabs = new Map<number, TabRec>();
  let nextTabId = 700;
  const openedDetailUrls: string[] = [];

  const profileItems = [
    // idx 0 (top 25): TikTok /photo/ lengkap dari feed-tap, detail tab akan mengembalikan post: null
    {
      sourceUrl: "https://www.tiktok.com/@sanghyangsparesort/photo/7703084124281703698",
      postType: "carousel",
      postedAt: "2026-11-01T08:00:00.000Z",
      caption: "Slide foto kamar resort Sanghyang",
      imageUrl: "https://p16-sign-sg.tiktokcdn.com/feed-photo-0.jpeg",
      gridViews: 1900,
      gridLikes: 64,
      gridComments: 3,
      gridShares: 5,
      fromFeedTap: true,
    },
    // idx 1 (top 25): item DOM-only tanpa fromFeedTap & tanpa postedAt -> detail post:null WAJIB tetap jadi error
    {
      sourceUrl: "https://www.tiktok.com/@sanghyangsparesort/video/7680164747412557064",
      postType: "tiktok_video",
      gridViews: 200,
    },
    // idx 2..25: 24 video filler known agar idx 26 berada di luar DETAIL_COMMENT_WINDOW (25)
    ...Array.from({ length: 24 }, (_, k) => ({
      sourceUrl: `https://www.tiktok.com/@sanghyangsparesort/video/${BigInt("7670000000000000000") + BigInt(k)}`,
      postType: "tiktok_video",
      postedAt: "2026-10-10T05:00:00.000Z",
      caption: `Video lama ${k}`,
      gridViews: 500 + k,
      fromFeedTap: true,
    })),
    // idx 26 (>25): TikTok /photo/ tanpa caption & gridViews null & postType kosong (harus dikenali sebagai carousel & fast-save!)
    {
      sourceUrl: "https://www.tiktok.com/@sanghyangsparesort/photo/7660164747412557064",
      postedAt: "2026-09-15T05:00:00.000Z",
      caption: "",
      imageUrl: "https://p16-sign-sg.tiktokcdn.com/feed-photo-26.jpeg",
      gridViews: null,
      gridLikes: 38,
      gridComments: 1,
      gridShares: 2,
      fromFeedTap: true,
    },
  ];
  const knownFiller = profileItems.slice(2, 26).map((x) => x.sourceUrl);

  const fakeChrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: storage.get(k) }),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v);
        },
      },
    },
    windows: { getAll: async () => [{ id: 1, incognito: false }], update: async () => ({}) },
    tabs: {
      get: async (id: number) => ({ ...tabs.get(id)! }),
      create: async (c: Record<string, unknown>) => {
        const t: TabRec = { id: nextTabId++, url: String(c.url || ""), status: "complete", incognito: false, windowId: 1, active: Boolean(c.active) };
        tabs.set(t.id, t);
        return { ...t };
      },
      update: async (id: number, u: Record<string, unknown>) => {
        const t = tabs.get(id)!;
        if (typeof u.url === "string") {
          t.url = u.url;
          t.status = "complete";
        }
        return { ...t };
      },
      remove: async (id: number) => {
        tabs.delete(id);
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: {
      executeScript: async (arg: { target: { tabId: number }; args?: unknown[]; files?: string[] }) => {
        if (Array.isArray(arg.args) && arg.args.length === 1) return [{ result: true }];
        if (Array.isArray(arg.files)) return [{ result: true }];
        const fn = arg.args?.[0];
        if (fn === "__sanghyangRunProfile") {
          return [
            {
              result: {
                challenge: { blocked: false, kind: null, reason: null },
                items: profileItems,
                profile: { followers: 2100, posts: profileItems.length, isEmptyProfile: false, notFound: false },
                isLoggedOutNav: false,
                wasHidden: false,
                hadInterstitial: false,
                scan: { rounds: 2, expected: profileItems.length, collected: profileItems.length, stoppedBy: "expected", reachedBottom: true, hasNextPage: false },
              },
            },
          ];
        }
        if (fn === "__sanghyangRunPost") {
          const url = String((arg.args?.[1] as unknown[])?.[1] || "");
          openedDetailUrls.push(url);
          if (url.includes("/photo/7703084124281703698") || url.includes("/video/7680164747412557064")) {
            return [{ result: { challenge: { blocked: false, kind: null, reason: null }, post: null } }];
          }
          return [
            {
              result: {
                challenge: { blocked: false, kind: null, reason: null },
                post: {
                  platform: "tiktok",
                  postType: "tiktok_video",
                  sourceUrl: url,
                  postedAt: "2026-10-10T05:00:00.000Z",
                  caption: "Detail video ok",
                  imageUrl: null,
                  metrics: { views: 600, likes: 20, comments: 1, shares: 0 },
                  comments: [],
                },
              },
            },
          ];
        }
        return [{ result: true }];
      },
    },
    runtime: {
      getManifest: () => ({ version: "1.1.9" }),
      getURL: (f: string) => `chrome-extension://test/${f}`,
      onMessageExternal: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
  };
  const bgSb: Record<string, unknown> = {
    chrome: fakeChrome,
    URL,
    Set,
    Map,
    Array,
    Math,
    Date,
    Promise,
    Error,
    Boolean,
    Number,
    String,
    RegExp,
    setTimeout: (fn: (...a: unknown[]) => void, ms?: number) => setTimeout(fn, Math.min(Number(ms) || 0, 5)),
    clearTimeout,
    setInterval,
    clearInterval,
    globalThis: {} as Record<string, unknown>,
  };
  bgSb.globalThis = bgSb;
  vm.runInNewContext(bgSrc, bgSb);
  const bgHooks = bgSb.__sanghyangBackgroundTestHooks as {
    handleCommand: (msg: Record<string, unknown>, origin: string | null, senderTab?: unknown) => Promise<Record<string, unknown>>;
  };

  await bgHooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: knownFiller,
      targets: [
        {
          targetKey: "own:tiktok:sanghyangsparesort",
          targetType: "own",
          name: "Sanghyang TikTok",
          platform: "tiktok",
          handle: "sanghyangsparesort",
          profileUrl: "https://www.tiktok.com/@sanghyangsparesort",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 350));

  const finalState = (await bgHooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as {
    status: string;
    errors: string[];
    pendingCount: number;
  };
  assert.equal(finalState.status, "completed");
  assert.equal(
    openedDetailUrls.includes("https://www.tiktok.com/@sanghyangsparesort/photo/7660164747412557064"),
    false,
    "TikTok /photo/ historis dari feed-tap (>25) wajib ikut fast-save tanpa membuka tab detail",
  );
  assert.equal(
    finalState.errors.some((e) => e.includes("7703084124281703698")),
    false,
    "TikTok /photo/ dengan metadata feed-tap terverifikasi TIDAK boleh gagal 'detail postingan kosong/tidak terbaca'",
  );
  assert.equal(
    finalState.errors.some((e) => e.includes("7680164747412557064") && e.includes("detail postingan kosong/tidak terbaca")),
    true,
    "Item DOM-only tanpa metadata terverifikasi yg detailnya kosong WAJIB tetap melaporkan error jujur (Zero Fallback)",
  );

  const peek = (await bgHooks.handleCommand({ type: "PEEK_PENDING_BATCH", limit: 25 }, "http://localhost:3001")) as {
    posts: Array<{ sourceUrl: string; postType: string; caption: string; postedAt: string | null; imageUrl: string | null; metrics: Record<string, number | null> }>;
  };
  const savedPhotoTop = peek.posts.find((p) => p.sourceUrl.includes("7703084124281703698"));
  assert.ok(savedPhotoTop, "TikTok /photo/ top-25 wajib tersimpan dari metadata feed-tap terverifikasi");
  assert.equal(savedPhotoTop?.postType, "carousel");
  assert.equal(savedPhotoTop?.caption, "Slide foto kamar resort Sanghyang");
  assert.equal(savedPhotoTop?.imageUrl, "https://p16-sign-sg.tiktokcdn.com/feed-photo-0.jpeg");
  assert.equal(savedPhotoTop?.metrics.views, 1900);
  assert.equal(savedPhotoTop?.metrics.likes, 64);

  const savedPhotoFast = peek.posts.find((p) => p.sourceUrl.includes("7660164747412557064"));
  assert.ok(savedPhotoFast, "TikTok /photo/ historis fast-save wajib masuk pendingPosts");
  assert.equal(savedPhotoFast?.postType, "carousel");
  assert.equal(savedPhotoFast?.imageUrl, "https://p16-sign-sg.tiktokcdn.com/feed-photo-26.jpeg");
  assert.equal(savedPhotoFast?.metrics.likes, 38);
});

test("v1.1.10 TDD background.js: profileCollected vs reelsAdded, anti-badai detail IG Reels, window kompetitor 15, rotasi tab + pacing, dan pemulihan rate-limit sejati", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const vm = await import("node:vm");
  const bgSrc = fs.readFileSync(path.resolve(process.cwd(), "extension/sanghyang-social-sync/background.js"), "utf8");

  type TabRec = { id: number; url: string; status: string; incognito: boolean; windowId: number; active: boolean };
  function makeBgV1110(opts: {
    onExecuteScript: (arg: { target: { tabId: number }; args?: unknown[] }) => Promise<unknown> | unknown;
    onTimeoutScheduled?: (ms: number) => void;
  }) {
    const storage = new Map<string, unknown>();
    const tabs = new Map<number, TabRec>();
    const createdTabIds: number[] = [];
    const removedTabIds: number[] = [];
    const tabUpdates: { tabId: number; opts: Record<string, unknown> }[] = [];
    const scheduledDelays: number[] = [];
    let nextId = 800;

    const fakeChrome = {
      storage: {
        local: {
          get: async (k: string) => ({ [k]: storage.get(k) }),
          set: async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) storage.set(k, v);
          },
        },
      },
      windows: { getAll: async () => [{ id: 1, incognito: false }], update: async () => ({}) },
      tabs: {
        get: async (id: number) => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          return { ...t };
        },
        create: async (c: Record<string, unknown>) => {
          const t: TabRec = {
            id: nextId++,
            url: String(c.url || ""),
            status: "complete",
            incognito: false,
            windowId: 1,
            active: Boolean(c.active),
          };
          tabs.set(t.id, t);
          createdTabIds.push(t.id);
          return { ...t };
        },
        update: async (id: number, u: Record<string, unknown>) => {
          tabUpdates.push({ tabId: id, opts: u });
          const t = tabs.get(id);
          if (!t) throw new Error("No tab");
          if (typeof u.url === "string") {
            t.url = u.url;
            t.status = "complete";
          }
          if (typeof u.active === "boolean") t.active = u.active;
          return { ...t };
        },
        remove: async (id: number) => {
          removedTabIds.push(id);
          tabs.delete(id);
        },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      scripting: {
        executeScript: async (arg: { target: { tabId: number }; args?: unknown[]; files?: string[] }) => {
          if (Array.isArray(arg.args) && arg.args.length === 1) return [{ result: true }];
          if (Array.isArray(arg.files)) return [{ result: true }];
          const res = await opts.onExecuteScript(arg);
          return [{ result: res }];
        },
      },
      runtime: {
        getManifest: () => ({ version: "1.1.10" }),
        getURL: (f: string) => `chrome-extension://test/${f}`,
        onMessageExternal: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
    };

    const sb: Record<string, unknown> = {
      chrome: fakeChrome,
      URL,
      Set,
      Map,
      Array,
      Math,
      Date,
      Promise,
      Error,
      Boolean,
      Number,
      String,
      RegExp,
      setTimeout: (fn: (...a: unknown[]) => void, ms?: number) => {
        const delay = Number(ms) || 0;
        scheduledDelays.push(delay);
        opts.onTimeoutScheduled?.(delay);
        return setTimeout(fn, Math.min(delay, 2));
      },
      clearTimeout,
      setInterval,
      clearInterval,
      globalThis: {} as Record<string, unknown>,
    };
    sb.globalThis = sb;
    vm.runInNewContext(bgSrc, sb);
    return {
      hooks: sb.__sanghyangBackgroundTestHooks as {
        INTER_TARGET_PACING_MS: number;
        HEAVY_TARGET_PACING_MS: number;
        HEAVY_TAB_ROTATE_THRESHOLD: number;
        RATE_LIMIT_COOLDOWN_MS: number;
        COMPETITOR_DETAIL_COMMENT_WINDOW: number;
        DETAIL_COMMENT_WINDOW: number;
        isCompleteFeedItem: (item: Record<string, unknown>, platform: string) => boolean;
        shouldRetryProfileScan: (profileRes: Record<string, unknown>, platform: string) => boolean;
        evaluateTargetCompleteness: (params: Record<string, unknown>) => Record<string, unknown>;
        handleCommand: (
          msg: Record<string, unknown>,
          origin: string | null,
          senderTab?: { id?: number; windowId?: number; incognito?: boolean } | null,
        ) => Promise<Record<string, unknown>>;
      },
      createdTabIds,
      removedTabIds,
      tabUpdates,
      scheduledDelays,
    };
  }

  // 1. Konstanta & helper murni di __sanghyangBackgroundTestHooks
  const pureBg = makeBgV1110({ onExecuteScript: () => true });
  assert.equal(pureBg.hooks.INTER_TARGET_PACING_MS, 2500);
  assert.equal(pureBg.hooks.HEAVY_TARGET_PACING_MS, 5000);
  assert.equal(pureBg.hooks.HEAVY_TAB_ROTATE_THRESHOLD, 200);
  assert.equal(pureBg.hooks.RATE_LIMIT_COOLDOWN_MS, 35_000);
  assert.equal(pureBg.hooks.COMPETITOR_DETAIL_COMMENT_WINDOW, 15);
  assert.equal(pureBg.hooks.DETAIL_COMMENT_WINDOW, 25);

  // isCompleteFeedItem: terima IG Reel lama dari feed-tap meski gridViews === null & terima IG feed tanpa caption bila ada imageUrl/metrik
  assert.equal(
    pureBg.hooks.isCompleteFeedItem(
      {
        sourceUrl: "https://www.instagram.com/astonanyer/reel/OldReelNullViews/",
        postType: "reels",
        postedAt: "2026-08-01T05:00:00.000Z",
        caption: "Reels lama Aston Anyer",
        imageUrl: "https://scontent.cdninstagram.com/reel.jpg",
        gridViews: null,
        gridLikes: 42,
        fromFeedTap: true,
      },
      "instagram",
    ),
    true,
    "IG Reel dari feed-tap dengan views null tetap lengkap agar tidak membuka 267 tab detail",
  );
  assert.equal(
    pureBg.hooks.isCompleteFeedItem(
      {
        sourceUrl: "https://www.instagram.com/astonanyer/p/NoCaptionWithImg/",
        postType: "feed",
        postedAt: "2026-08-01T05:00:00.000Z",
        caption: "",
        imageUrl: "https://scontent.cdninstagram.com/feed.jpg",
        gridViews: null,
        gridLikes: null,
        fromFeedTap: true,
      },
      "instagram",
    ),
    true,
    "IG feed dari feed-tap tanpa caption tetap lengkap jika memiliki imageUrl HTTPS",
  );
  assert.equal(
    pureBg.hooks.isCompleteFeedItem(
      {
        sourceUrl: "https://www.instagram.com/astonanyer/p/EmptyFeedTap/",
        postType: "feed",
        postedAt: "2026-08-01T05:00:00.000Z",
        caption: "",
        imageUrl: null,
        gridViews: null,
        gridLikes: null,
        gridComments: null,
        gridShares: null,
        fromFeedTap: true,
      },
      "instagram",
    ),
    false,
    "IG feed-tap tanpa caption, gambar, maupun metrik tetap dianggap belum lengkap",
  );
  assert.equal(
    pureBg.hooks.isCompleteFeedItem(
      {
        sourceUrl: "https://www.tiktok.com/@astonanyerofficial/video/7705662298588859700",
        postType: "tiktok_video",
        postedAt: "2026-10-01T05:00:00.000Z",
        caption: "Video TikTok tanpa views",
        imageUrl: "https://p16-sign-sg.tiktokcdn.com/vid.jpg",
        gridViews: null,
        gridLikes: 20,
        fromFeedTap: true,
      },
      "tiktok",
    ),
    false,
    "TikTok video tetap wajib memiliki gridViews",
  );

  // shouldRetryProfileScan
  assert.equal(
    pureBg.hooks.shouldRetryProfileScan(
      { isLoggedOutNav: false, scan: { stoppedBy: "rate_limited", rateLimited: true, collected: 89, expected: 1295 } },
      "instagram",
    ),
    true,
  );
  assert.equal(
    pureBg.hooks.shouldRetryProfileScan(
      {
        isLoggedOutNav: false,
        wasHidden: false,
        scan: { stoppedBy: "stale", collected: 95, expected: 375, reachedBottom: false, hasNextPage: null },
      },
      "instagram",
    ),
    true,
    "cakupan <95% dengan !reachedBottom wajib memicu retry meski wasHidden=false",
  );
  assert.equal(
    pureBg.hooks.shouldRetryProfileScan(
      {
        isLoggedOutNav: true,
        scan: { stoppedBy: "rate_limited", rateLimited: true, collected: 12, expected: 500 },
      },
      "instagram",
    ),
    false,
    "navigasi belum login tidak boleh retry, harus masuk jeda login",
  );

  // evaluateTargetCompleteness: bedakan profileCollected (grid) vs reelsAdded vs collected (total)
  const dragonEval = pureBg.hooks.evaluateTargetCompleteness({
    platform: "instagram",
    name: "Dragon Beach Club",
    maxPostsPerTarget: 0,
    profileCollected: 1348,
    mergedCollected: 1354,
    reelsAdded: 6,
    expected: 1350,
    profileStoppedBy: "stale",
    profileReachedBottom: true,
    profileHasNextPage: false,
    reelsReachedBottom: true,
    reelsHasNextPage: false,
  });
  assert.equal(dragonEval.scanStatus, "ok", "1.348/1.350 grid + 6 Reels wajib status ok");
  assert.equal(dragonEval.profileCollected, 1348);
  assert.equal(dragonEval.collected, 1354);
  assert.equal(dragonEval.reelsAdded, 6);

  const halfGridEval = pureBg.hooks.evaluateTargetCompleteness({
    platform: "instagram",
    name: "Akun Separuh Grid",
    maxPostsPerTarget: 0,
    profileCollected: 60,
    mergedCollected: 98,
    reelsAdded: 38,
    expected: 100,
    profileStoppedBy: "stale",
    profileReachedBottom: false,
    profileHasNextPage: true,
    reelsReachedBottom: true,
    reelsHasNextPage: false,
  });
  assert.equal(
    halfGridEval.scanStatus,
    "partial",
    "38 Reels-only tidak boleh menyamarkan grid yang baru tergulir 60/100 menjadi status ok",
  );

  // 2. Kompetitor IG: 50 grid (35 Reels views=null dari feed-tap) + 6 Reels-only = 56 total
  //    -> profileCollected=50, reelsAdded=6, collected=56, status="ok", hanya 15 detail dibuka (COMPETITOR_DETAIL_COMMENT_WINDOW=15)
  const compGrid50 = Array.from({ length: 50 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/astonanyer/${i < 35 ? "reel" : "p"}/AstonItem${String(i + 1).padStart(3, "0")}/`,
    postType: i < 35 ? "reels" : "feed",
    postedAt: new Date(Date.UTC(2026, 10, 20) - i * 86_400_000).toISOString(),
    caption: `Promo Aston #${i + 1}`,
    imageUrl: `https://scontent.cdninstagram.com/aston_${i + 1}.jpg`,
    gridViews: null,
    gridLikes: 25 + i,
    gridComments: 2,
    gridShares: null,
    fromFeedTap: true,
  }));
  const compReelsOnly6 = Array.from({ length: 6 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/astonanyer/reel/AstonReelOnly${i + 1}/`,
    postType: "reels",
    postedAt: new Date(Date.UTC(2026, 9, 1) - i * 86_400_000).toISOString(),
    caption: `Reels eksklusif #${i + 1}`,
    imageUrl: `https://scontent.cdninstagram.com/aston_r_${i + 1}.jpg`,
    gridViews: null,
    gridLikes: 14,
    fromFeedTap: true,
  }));
  const compVisitedDetails: string[] = [];
  const compDetailsCapture: { state: Record<string, unknown> | null } = { state: null };
  let compProfileCall = 0;

  const bgComp = makeBgV1110({
    onExecuteScript: async (arg) => {
      const fn = arg.args?.[0];
      if (fn === "__sanghyangRunProfile") {
        compProfileCall++;
        if (compProfileCall === 1) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: compGrid50,
            profile: { followers: 18500, posts: 50 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 4, expected: 50, collected: 50, stoppedBy: "expected", reachedBottom: true, hasNextPage: false },
          };
        }
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: compReelsOnly6,
          profile: { followers: 18500, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 2, expected: null, collected: 6, stoppedBy: "end_of_feed", reachedBottom: true, hasNextPage: false },
        };
      }
      if (fn === "__sanghyangRunPost") {
        if (!compDetailsCapture.state) {
          compDetailsCapture.state = ((await bgComp.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state ?? null) as Record<string, unknown> | null;
        }
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        compVisitedDetails.push(postUrl);
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: postUrl.includes("/reel/") ? "reels" : "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Detail Aston",
            imageUrl: null,
            metrics: { views: null, likes: 30, comments: 2, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });

  await bgComp.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: [],
      targets: [
        {
          targetKey: "comp:aston:instagram",
          targetType: "competitor",
          competitorId: "10000000-0000-4000-8000-000000000001",
          name: "Aston Anyer Beach Hotel",
          platform: "instagram",
          handle: "astonanyer",
          profileUrl: "https://www.instagram.com/astonanyer/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 200));
  const stComp = (await bgComp.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(stComp.status, "completed");
  assert.equal(
    compVisitedDetails.length,
    15,
    `kompetitor hanya boleh membuka 15 tab detail (bukan 56!) untuk Reels views=null dari feed-tap; dapat ${compVisitedDetails.length}`,
  );
  assert.equal(compDetailsCapture.state?.currentProfileCollected, 50, "summarizeState wajib mengekspos currentProfileCollected=50");
  assert.equal(compDetailsCapture.state?.currentTargetCollected, 56);
  assert.equal(compDetailsCapture.state?.currentReelsAdded, 6);
  const compRes = (stComp.targetResults as Array<Record<string, unknown>>)[0];
  assert.equal(compRes?.profileCollected, 50);
  assert.equal(compRes?.reelsAdded, 6);
  assert.equal(compRes?.collected, 56);
  assert.equal(compRes?.expected, 50);
  assert.equal(compRes?.feedSaved, 41);
  assert.equal(compRes?.status, "ok");

  // 3. Rotasi tab pekerja & jeda sopan antar target berat Instagram (>=200 post -> tutup tab lama + buka tab baru, >=400 post -> 5000ms)
  const heavyItems420 = Array.from({ length: 420 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/astonanyer/p/Heavy${String(i + 1).padStart(4, "0")}/`,
    postType: "feed",
    postedAt: new Date(Date.UTC(2026, 10, 20) - i * 86_400_000).toISOString(),
    caption: `Heavy #${i + 1}`,
    imageUrl: "https://scontent.cdninstagram.com/heavy.jpg",
    gridLikes: 10,
    fromFeedTap: true,
  }));
  const smallItems5 = Array.from({ length: 5 }, (_, i) => ({
    sourceUrl: `https://www.instagram.com/mambrukhotelanyer/p/Mambruk${i + 1}/`,
    postType: "feed",
    postedAt: new Date(Date.UTC(2026, 10, 20) - i * 86_400_000).toISOString(),
    caption: `Mambruk #${i + 1}`,
    imageUrl: "https://scontent.cdninstagram.com/mambruk.jpg",
    gridLikes: 8,
    fromFeedTap: true,
  }));
  const profileTabsUsed: number[] = [];
  let rotProfileCall = 0;
  const bgRotate = makeBgV1110({
    onExecuteScript: (arg) => {
      const fn = arg.args?.[0];
      if (fn === "__sanghyangRunProfile") {
        rotProfileCall++;
        if (rotProfileCall === 1) {
          profileTabsUsed.push(arg.target.tabId);
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: heavyItems420,
            profile: { followers: 18500, posts: 420 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 20, expected: 420, collected: 420, stoppedBy: "expected", reachedBottom: true, hasNextPage: false },
          };
        }
        if (rotProfileCall === 2) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: [],
            profile: { followers: 18500, posts: null },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 1, expected: null, collected: 0, stoppedBy: "end_of_feed", reachedBottom: true, hasNextPage: false },
          };
        }
        if (rotProfileCall === 3) {
          profileTabsUsed.push(arg.target.tabId);
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: smallItems5,
            profile: { followers: 9000, posts: 5 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 1, expected: 5, collected: 5, stoppedBy: "expected", reachedBottom: true, hasNextPage: false },
          };
        }
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: 9000, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 1, expected: null, collected: 0, stoppedBy: "end_of_feed", reachedBottom: true, hasNextPage: false },
        };
      }
      if (fn === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Ok",
            imageUrl: null,
            metrics: { views: null, likes: 10, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });

  await bgRotate.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: [...heavyItems420.map((x) => x.sourceUrl), ...smallItems5.map((x) => x.sourceUrl)],
      targets: [
        {
          targetKey: "comp:aston:instagram",
          targetType: "competitor",
          name: "Aston Anyer",
          platform: "instagram",
          handle: "astonanyer",
          profileUrl: "https://www.instagram.com/astonanyer/",
        },
        {
          targetKey: "comp:mambruk:instagram",
          targetType: "competitor",
          name: "Mambruk Hotel",
          platform: "instagram",
          handle: "mambrukhotelanyer",
          profileUrl: "https://www.instagram.com/mambrukhotelanyer/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 250));
  const stRot = (await bgRotate.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(stRot.status, "completed");
  assert.equal(profileTabsUsed.length, 2);
  assert.notEqual(
    profileTabsUsed[0],
    profileTabsUsed[1],
    "sesudah target berat >=200 post selesai, workerTabId lama wajib ditutup dan target berikutnya memakai tab BARU",
  );
  assert.ok(bgRotate.removedTabIds.includes(profileTabsUsed[0]), "tab pekerja lama wajib ditutup lewat chrome.tabs.remove");
  const totalPacingDelay = bgRotate.scheduledDelays.filter((d) => d > 0 && d <= 5000).reduce((a, b) => a + b, 0);
  assert.ok(totalPacingDelay >= 5000, `target berat >=400 post wajib jeda minimal 5000ms (tercatat ${totalPacingDelay}ms)`);

  // 4. Rate-limit cooldown (35.000ms bertahap + fase "cooldown") -> tutup tab lama + buka tab BARU -> pulih & selesai
  const rlTabs: number[] = [];
  let sawCooldownPhase = false;
  let rlCall = 0;
  const bgRlRecover = makeBgV1110({
    onTimeoutScheduled: () => {
      void bgRlRecover.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001").then((r) => {
        if ((r.state as Record<string, unknown>)?.currentPhase === "cooldown") {
          sawCooldownPhase = true;
        }
      });
    },
    onExecuteScript: (arg) => {
      const fn = arg.args?.[0];
      if (fn === "__sanghyangRunProfile") {
        rlCall++;
        if (rlCall === 1) {
          rlTabs.push(arg.target.tabId);
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: smallItems5.slice(0, 2),
            profile: { followers: 9000, posts: 5 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 3, expected: 5, collected: 2, stoppedBy: "rate_limited", rateLimited: true, reachedBottom: false, hasNextPage: true },
          };
        }
        if (rlCall === 2) {
          rlTabs.push(arg.target.tabId);
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: smallItems5,
            profile: { followers: 9000, posts: 5 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 2, expected: 5, collected: 5, stoppedBy: "expected", rateLimited: false, reachedBottom: true, hasNextPage: false },
          };
        }
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: [],
          profile: { followers: 9000, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 1, expected: null, collected: 0, stoppedBy: "end_of_feed", reachedBottom: true, hasNextPage: false },
        };
      }
      if (fn === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Ok",
            imageUrl: null,
            metrics: { views: null, likes: 10, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });

  await bgRlRecover.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: smallItems5.map((x) => x.sourceUrl),
      targets: [
        {
          targetKey: "comp:mambruk:instagram",
          targetType: "competitor",
          name: "Mambruk Hotel",
          platform: "instagram",
          handle: "mambrukhotelanyer",
          profileUrl: "https://www.instagram.com/mambrukhotelanyer/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 300));
  const stRlRec = (await bgRlRecover.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(stRlRec.status, "completed");
  assert.equal(sawCooldownPhase, true, "cooldown rate-limit wajib menyetel currentPhase='cooldown'");
  assert.equal(rlTabs.length, 2);
  assert.notEqual(rlTabs[0], rlTabs[1], "retry rate-limit wajib menutup tab lama dan membuka tab BARU yang 100% segar");
  assert.ok(bgRlRecover.removedTabIds.includes(rlTabs[0]), "tab lama yang rate-limited wajib ditutup");
  const cooldownSum = bgRlRecover.scheduledDelays.filter((d) => d >= 500 && d <= 2000).reduce((a, b) => a + b, 0);
  assert.ok(cooldownSum >= 35_000, `cooldown rate-limit wajib menunggu total 35.000ms secara bertahap (tercatat ${cooldownSum}ms)`);

  // 5. Rate-limit persisten sesudah retry segar -> pauseOnChallenge kind="rate_limit" dengan alasan Bahasa Indonesia
  let rlPersistCalls = 0;
  const bgRlPause = makeBgV1110({
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        rlPersistCalls++;
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: smallItems5.slice(0, 2),
          profile: { followers: 9000, posts: 1295 },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 3, expected: 1295, collected: 89, stoppedBy: "rate_limited", rateLimited: true, reachedBottom: false, hasNextPage: true },
        };
      }
      return true;
    },
  });
  await bgRlPause.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: [],
      targets: [
        {
          targetKey: "comp:mambruk:instagram",
          targetType: "competitor",
          name: "Mambruk Hotel",
          platform: "instagram",
          handle: "mambrukhotelanyer",
          profileUrl: "https://www.instagram.com/mambrukhotelanyer/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 300));
  const stRlPause = (await bgRlPause.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(rlPersistCalls, 2, "wajib mencoba 1x retry segar sebelum menjeda rate_limit");
  assert.equal(stRlPause.status, "needs_human_action");
  assert.equal(stRlPause.pausedKind, "rate_limit");
  assert.match(String(stRlPause.pausedReason || ""), /Instagram membatasi permintaan sementara/i);
  assert.match(String(stRlPause.pausedReason || ""), /Mambruk Hotel/);
  assert.match(String(stRlPause.pausedReason || ""), /Lanjutkan.*Lewati Akun Ini/i);

  // 6. CANCEL_SYNC di tengah cooldown wajib berhenti segera tanpa membuka tab retry
  let cancelRetryCalls = 0;
  let cancelFired = false;
  const bgCancel = makeBgV1110({
    onTimeoutScheduled: (ms) => {
      if (!cancelFired && ms >= 500 && ms <= 2000) {
        cancelFired = true;
        void bgCancel.hooks.handleCommand({ type: "CANCEL_SYNC" }, "http://localhost:3001");
      }
    },
    onExecuteScript: (arg) => {
      if (arg.args?.[0] === "__sanghyangRunProfile") {
        cancelRetryCalls++;
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: smallItems5.slice(0, 1),
          profile: { followers: 9000, posts: 500 },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 2, expected: 500, collected: 1, stoppedBy: "rate_limited", rateLimited: true, reachedBottom: false, hasNextPage: true },
        };
      }
      return true;
    },
  });
  await bgCancel.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: [],
      targets: [
        {
          targetKey: "comp:mambruk:instagram",
          targetType: "competitor",
          name: "Mambruk Hotel",
          platform: "instagram",
          handle: "mambrukhotelanyer",
          profileUrl: "https://www.instagram.com/mambrukhotelanyer/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 150));
  const stCancel = (await bgCancel.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(stCancel.status, "cancelled");
  assert.equal(cancelRetryCalls, 1, "CANCEL_SYNC saat cooldown wajib menghentikan retry sebelum membuka tab baru");

  // 7. Rate-limit pada tab /reels/ wajib cooldown 35.000ms + tutup tab lama + buka tab BARU lalu pulih
  const reelsRlTabs: number[] = [];
  let reelsRlCall = 0;
  const bgReelsRl = makeBgV1110({
    onExecuteScript: (arg) => {
      const fn = arg.args?.[0];
      if (fn === "__sanghyangRunProfile") {
        reelsRlCall++;
        if (reelsRlCall === 1) {
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: smallItems5,
            profile: { followers: 9000, posts: 5 },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 1, expected: 5, collected: 5, stoppedBy: "expected", reachedBottom: true, hasNextPage: false },
          };
        }
        if (reelsRlCall === 2) {
          reelsRlTabs.push(arg.target.tabId);
          return {
            challenge: { blocked: false, kind: null, reason: null },
            items: [],
            profile: { followers: 9000, posts: null },
            isLoggedOutNav: false,
            wasHidden: false,
            hadInterstitial: false,
            scan: { rounds: 2, expected: null, collected: 0, stoppedBy: "rate_limited", rateLimited: true, reachedBottom: false, hasNextPage: true },
          };
        }
        reelsRlTabs.push(arg.target.tabId);
        return {
          challenge: { blocked: false, kind: null, reason: null },
          items: compReelsOnly6.slice(0, 2),
          profile: { followers: 9000, posts: null },
          isLoggedOutNav: false,
          wasHidden: false,
          hadInterstitial: false,
          scan: { rounds: 1, expected: null, collected: 2, stoppedBy: "end_of_feed", rateLimited: false, reachedBottom: true, hasNextPage: false },
        };
      }
      if (fn === "__sanghyangRunPost") {
        const postUrl = String((arg.args?.[1] as unknown[])?.[1] || "");
        return {
          challenge: { blocked: false, kind: null, reason: null },
          post: {
            platform: "instagram",
            postType: postUrl.includes("/reel/") ? "reels" : "feed",
            sourceUrl: postUrl,
            postedAt: "2026-11-20T05:00:00.000Z",
            caption: "Ok",
            imageUrl: null,
            metrics: { views: null, likes: 10, comments: 0, shares: null },
            comments: [],
          },
        };
      }
      return true;
    },
  });
  await bgReelsRl.hooks.handleCommand(
    {
      type: "START_SYNC",
      maxPostsPerTarget: 0,
      knownPostUrls: smallItems5.map((x) => x.sourceUrl),
      targets: [
        {
          targetKey: "comp:mambruk:instagram",
          targetType: "competitor",
          name: "Mambruk Hotel",
          platform: "instagram",
          handle: "mambrukhotelanyer",
          profileUrl: "https://www.instagram.com/mambrukhotelanyer/",
        },
      ],
    },
    "http://localhost:3001",
    { id: 1, windowId: 1, incognito: false },
  );
  await new Promise((r) => setTimeout(r, 300));
  const stReelsRl = (await bgReelsRl.hooks.handleCommand({ type: "GET_STATE" }, "http://localhost:3001")).state as Record<string, unknown>;
  assert.equal(stReelsRl.status, "completed");
  assert.equal(reelsRlTabs.length, 2);
  assert.notEqual(reelsRlTabs[0], reelsRlTabs[1], "retry rate-limit pada tab /reels/ wajib membuka tab BARU");
  const reelsRlRes = (stReelsRl.targetResults as Array<Record<string, unknown>>)[0];
  assert.equal(reelsRlRes?.profileCollected, 5);
  assert.equal(reelsRlRes?.reelsAdded, 2);
  assert.equal(reelsRlRes?.collected, 7);
});
