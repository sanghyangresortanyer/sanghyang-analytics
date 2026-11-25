import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MIN_ARTICLE_LETTERS,
  TITLE_MATCH_THRESHOLD,
  bestMatch,
  countLetters,
  htmlToText,
  parseFeed,
  parseSitemap,
  parseWordPressPosts,
  rankSitemapChildren,
  readPublisherArticle,
  refusalReason,
  robotsPolicy,
  searchTerms,
  siteProfileFromHtml,
  slugSimilarity,
  titleSimilarity,
} from "../../src/lib/market/news-reader";
import { PROFILE_CRAWLER_UA, parseRobots, robotsAllows } from "../../src/lib/market/official-pages";

// Semua data di sini jawaban asli situs penerbit (18 Nov 2026) dan judul RSS asli dari DB lokal; sumbernya di bundel.
const fixture = (name: string) => readFileSync(path.resolve(process.cwd(), "tests/fixtures/news-reader", name), "utf8");

interface Recorded {
  url: string;
  status: number;
  contentType: string | null;
  body?: string;
  file?: string;
}

const bundle = JSON.parse(fixture("penerbit-pendukung-2026-11-18.json")) as {
  kueri: Record<string, { title: string; publishedAt: string; origin: string }>;
  transkrip: Recorded[];
  robots: Record<string, string>;
};

const query = (key: string) => {
  const q = bundle.kueri[key];
  return { title: q.title, publisherOrigin: q.origin, publishedAt: new Date(q.publishedAt) };
};
const recordedBody = (url: string) => {
  const hit = bundle.transkrip.find((r) => r.url === url);
  assert.ok(hit, `transkrip memuat ${url}`);
  return hit.file ? fixture(hit.file) : (hit.body ?? "");
};

/**
 * fetch yang hanya menyajikan jawaban asli dari transkrip. URL di luar transkrip langsung gagal, jadi tes ikut membuktikan
 * modul tidak meminta apa pun selain yang direkam (termasuk news.google.com).
 */
function recordedFetch() {
  const requests: { url: string; userAgent: string | null }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, userAgent: new Headers(init?.headers).get("user-agent") });
    const hit = bundle.transkrip.find((r) => r.url === url);
    if (!hit) throw new Error(`tidak ada jawaban asli untuk ${url}`);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Memberi giliran ke pembacaan lain yang berjalan bersamaan; jalur tunggal modul harus tetap menahannya.
    await new Promise((resolve) => setImmediate(resolve));
    inFlight--;
    const body = hit.file ? fixture(hit.file) : (hit.body ?? "");
    return new Response(body || null, { status: hit.status, headers: hit.contentType ? { "content-type": hit.contentType } : {} });
  };
  return { fetchImpl, requests, maxInFlight: () => maxInFlight };
}

/** Jam yang maju satu menit setiap dibaca, supaya jeda sopan antarpermintaan ke host yang sama tidak membuat tes menunggu. */
function advancingClock() {
  let time = Date.parse("2026-11-18T01:10:00Z");
  return () => new Date((time += 60_000));
}

test("judul: entitas HTML, huruf besar, tanda baca, dan akhiran nama situs tidak menurunkan kemiripan", () => {
  // title.rendered asli wp-json mediabanten.com dan judul RSS-nya.
  assert.equal(titleSimilarity("Pemkab Serang Promosikan Batik Daerah di Bandara Soekarno – Hatta", "Pemkab Serang Promosikan Batik Daerah di Bandara Soekarno &#8211; Hatta"), 1);
  const rss = bundle.kueri.pandeglangnews.title;
  assert.match(rss, / - Pandeglang News$/, "judul RSS asli ini masih membawa akhiran nama situs");
  const page = fixture("pandeglangnews-artikel-2026-11-18.html");
  const h1 = page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1].trim() ?? "";
  assert.doesNotMatch(h1, /Pandeglang News/);
  assert.equal(titleSimilarity(rss, h1), 1, "h1 tanpa akhiran tetap sama dengan judul RSS berakhiran");
  assert.equal(titleSimilarity(rss.toUpperCase().replace(/[,!]/g, ""), h1), 1);
});

test("judul: satu kata beda masih cocok, judul berbeda dari penerbit yang sama tidak", () => {
  // Judul RSS asli dari DB lokal. Dua pasangan pertama cerita yang sama dengan sedikit beda kata.
  const close = [
    ["Pemkab Serang Promosikan Batik Daerah di Bandara Soekarno – Hatta", "Pemkab Serang promosikan batik khas daerah di Bandara Soekarno Hatta"],
    ["Nemuru Grand Anyer Palazo Tawarkan BBQ Dinner Tepi Pantai", "Nemuru Grand Anyer Palazo Tawarkan Paket BBQ Dinner Tepi Pantai"],
  ];
  for (const [a, b] of close) assert.ok(titleSimilarity(a, b) >= TITLE_MATCH_THRESHOLD, `${a} | ${b}`);
  // Artikel berbeda dari penerbit yang sama: pasangan termirip di antara 14.980 pasangan DB lokal.
  const different = [
    ["Kota Tangerang juara umum Festival Olahraga Masyarakat 2026", "Kota Tangerang optimistis juara umum Festival Olahraga Masyarakat"],
    ["Penutupan Festival Olahraga Masyarakat Provinsi (Forprov) Banten II Tahun 2026", "Pembukaan Festival Olahraga Masyarakat Provinsi (FORPROV) II Banten 2026"],
    ["Pemkab Serang dan PHRI Bersiap Sambut Wisatawan Jelang Libur Nataru", "Pemkab Serang Siapkan Strategi Sambut Wisatawan Saat Libur Nataru"],
  ];
  for (const [a, b] of different) assert.ok(titleSimilarity(a, b) < TITLE_MATCH_THRESHOLD, `${a} | ${b}`);
});

test("slug sitemap: slug artikel yang sama tinggi, slug artikel lain rendah", () => {
  // URL asli dari sitemap tangselpos.id; slug memendekkan judul (tanda & hilang).
  const title = bundle.kueri.tangselpos.title;
  assert.equal(slugSimilarity("https://tangselpos.id/detail/57273/wisata-di-carita-aman-nyaman-phri-pandeglang-prediksi-nataru-meningkat", title), 1);
  assert.ok(slugSimilarity("https://tangselpos.id/detail/57473/jumlah-siswa-di-sekolah-swasta-meningkat", title) < 0.2);
});

test("feed RSS: judul, tautan, dan tanggal butir dibaca; artikel lama tidak ada di butir terbaru", () => {
  const items = parseFeed(fixture("tangselpos-feedberita-2026-11-18.xml"));
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], {
    url: "https://tangselpos.id/detail/57576/wali-kota-serang-takziah-ke-rumah-mari-ulfah-pmi-yang-meninggal-di-taiwan",
    title: "Wali Kota Serang Takziah ke Rumah Mari Ulfah, PMI yang Meninggal di Taiwan",
    publishedAt: new Date("2026-11-17T13:38:00Z"),
  });
  assert.equal(bestMatch(items, { title: bundle.kueri.tangselpos.title, publishedAt: new Date(bundle.kueri.tangselpos.publishedAt) }), null);
});

test("sitemap: indeks mendahulukan sitemap berita dan melewati sitemap gambar; judul Google News dibaca", () => {
  const index = parseSitemap(recordedBody("https://www.pandeglangnews.co.id/sitemap.xml"));
  assert.equal(index?.kind, "index");
  const q = query("pandeglangnews");
  assert.deepEqual(rankSitemapChildren(index?.entries ?? [], q.publishedAt), [
    "https://www.pandeglangnews.co.id/sitemap-news.xml",
    "https://www.pandeglangnews.co.id/sitemap-web.xml",
  ]);
  const news = parseSitemap(fixture("pandeglangnews-sitemap-news-2026-11-18.xml"));
  assert.equal(news?.kind, "urlset");
  assert.equal(news?.entries.length, 5);
  assert.equal(news?.entries[0].title, "Bupati Pandeglang Tolak Pemindahan Badak Jawa ke Alas Purwo: Jangan Pindahkan Amanah Leluhur!");
  assert.deepEqual(news?.entries[0].publishedAt, new Date("2026-11-17T16:26:43Z"));
  const match = bestMatch(news?.entries ?? [], q);
  assert.match(match?.url ?? "", /\/news\/16317912303\/bupati-dewi-setiani-beri-penghargaan-kepada-dalang-cilik-pandeglang/);
});

test("wp-json: hasil pencarian dibaca, pos yang benar dipilih, isinya cukup panjang tanpa membuka halaman", () => {
  const q = query("bantenraya");
  assert.equal(searchTerms(q.title), "bercerita kesehatan festival cilegon", "kata kunci yang dipakai pada rekaman asli");
  const posts = parseWordPressPosts(fixture("bantenraya-wp-json-2026-11-18.json"));
  assert.equal(posts?.length, 6, "pencarian WordPress juga mengembalikan pos lain");
  const match = bestMatch(posts ?? [], q);
  assert.equal(match?.url, "https://www.bantenraya.com/daerah/16080847/rki-kota-cilegon-gelar-festival-ayah-bercerita-dan-edukasi-kesehatan");
  const post = posts?.find((p) => p.url === match?.url);
  assert.ok(countLetters(htmlToText(post?.html ?? "")) >= MIN_ARTICLE_LETTERS);
  assert.equal(parseWordPressPosts(recordedBody("https://banten.tribunnews.com/")), null, "HTML bukan daftar pos");
});

test("robots.txt: grup ganda digabung, Sitemap dikumpulkan, larangan path dipatuhi", () => {
  const bantennews = robotsPolicy(bundle.robots["www.bantennews.co.id"]);
  assert.ok(!parseRobots(bundle.robots["www.bantennews.co.id"]).disallow.includes("/?s="), "parseRobots hanya membaca grup * pertama");
  assert.ok(bantennews.rules.disallow.includes("/?s="), "larangan di grup * kedua ikut berlaku (RFC 9309 2.2.1)");
  assert.deepEqual(bantennews.sitemaps, ["https://www.bantennews.co.id/sitemap_index.xml", "https://www.bantennews.co.id/news-sitemap.xml"]);
  // bantentv.com: grup * pertama "Allow: /", grup * terakhir "Disallow: /"; aturan setara dimenangkan Allow (RFC 9309 2.2.2).
  assert.equal(robotsAllows(robotsPolicy(bundle.robots["bantentv.com"]).rules, "/hiburan/kuliner/nasi-kulit"), true);
  const banpos = robotsPolicy(bundle.robots["banpos.co"]);
  assert.equal(robotsAllows(banpos.rules, "/2026/11/12/arsip"), false);
  assert.equal(robotsAllows(banpos.rules, "/artikel/2026/11/12/aspirasi-masyarakat-harus-jadi-rujukan-raperda-penyelenggaraan-kepariwisataan/"), true);
  assert.ok(banpos.sitemaps.includes("https://banpos.co/feed/gn"));
  const tangselpos = robotsPolicy(bundle.robots["tangselpos.id"]).rules;
  assert.equal(robotsAllows(tangselpos, "/berita/57273"), false);
  assert.equal(robotsAllows(tangselpos, "/detail/57273/wisata-di-carita-aman-nyaman-phri-pandeglang-prediksi-nataru-meningkat"), true);
});

test("beranda: API WordPress hanya dipakai bila diumumkan situsnya; feed komentar dilewati", () => {
  assert.deepEqual(siteProfileFromHtml(recordedBody("https://www.bantenraya.com/"), null, "https://www.bantenraya.com/"), {
    wordpressApi: "https://www.bantenraya.com/wp-json/",
    feeds: ["https://www.bantenraya.com/feed"],
  });
  assert.deepEqual(siteProfileFromHtml(recordedBody("https://www.pandeglangnews.co.id/"), null, "https://www.pandeglangnews.co.id/"), {
    wordpressApi: null,
    feeds: [],
  });
});

test("penolakan: 403 tantangan Cloudflare dan 403 biasa dikenali, halaman artikel biasa tidak", () => {
  const headers = (contentType: string) => new Headers({ "content-type": contentType });
  assert.equal(refusalReason(403, headers("text/html; charset=UTF-8"), fixture("kabarbanten-beranda-403-2026-11-18.html")), "HTTP 403 dengan halaman tantangan WAF");
  assert.equal(refusalReason(403, headers("text/html"), recordedBody("https://banten.tribunnews.com/")), "HTTP 403 (akses ditolak)");
  assert.equal(refusalReason(200, headers("text/html; charset=UTF-8"), fixture("pandeglangnews-artikel-2026-11-18.html")), null);
});

test("alur wp-json: robots.txt, beranda, lalu satu pencarian; isi diambil tanpa membuka halaman", async () => {
  const server = recordedFetch();
  const result = await readPublisherArticle(query("bantenraya"), { fetchImpl: server.fetchImpl, now: advancingClock() });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.via, "wordpress-api");
  assert.equal(result.url, "https://www.bantenraya.com/daerah/16080847/rki-kota-cilegon-gelar-festival-ayah-bercerita-dan-edukasi-kesehatan");
  assert.equal(result.title, "RKI Kota Cilegon Gelar Festival Ayah Bercerita dan Edukasi Kesehatan");
  assert.match(result.text, /^BANTENRAYA\.COM – Rumah Keluarga Indonesia atau RKI Kota Cilegon/);
  assert.deepEqual(
    server.requests.map((r) => r.url),
    [
      "https://www.bantenraya.com/robots.txt",
      "https://www.bantenraya.com/",
      "https://www.bantenraya.com/wp-json/wp/v2/posts?search=bercerita+kesehatan+festival+cilegon&per_page=10&_fields=link%2Cdate%2Ctitle%2Ccontent",
    ],
  );
  assert.ok(server.requests.every((r) => r.userAgent === PROFILE_CRAWLER_UA), "identitas perayap jujur di setiap permintaan");
});

test("alur sitemap: feed tidak ada, sitemap berita menunjuk artikel, halaman dibaca dan judulnya diverifikasi", async () => {
  const server = recordedFetch();
  const result = await readPublisherArticle(query("pandeglangnews"), { fetchImpl: server.fetchImpl, now: advancingClock() });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  assert.equal(result.via, "sitemap");
  assert.match(result.url, /\/news\/16317912303\/bupati-dewi-setiani-beri-penghargaan-kepada-dalang-cilik-pandeglang/);
  assert.match(result.title, /^Bupati Dewi Setiani Beri Penghargaan kepada Dalang Cilik Pandeglang/);
  assert.ok(countLetters(result.text) >= MIN_ARTICLE_LETTERS, `${countLetters(result.text)} huruf`);
  assert.match(result.text, /Rizki Wahyu Rohman/);
  assert.deepEqual(
    server.requests.map((r) => new URL(r.url).pathname),
    ["/robots.txt", "/", "/feed/", "/rss", "/sitemap.xml", "/sitemap-news.xml", new URL(result.url).pathname],
  );
});

test("robots.txt yang melarang seluruh situs: hanya robots.txt yang diminta", async () => {
  const server = recordedFetch();
  const result = await readPublisherArticle(query("kabar6"), { fetchImpl: server.fetchImpl, now: advancingClock() });
  assert.deepEqual(result, { ok: false, reason: "robots.txt melarang seluruh situs untuk perayap ini" });
  assert.deepEqual(server.requests.map((r) => r.url), ["https://kabar6.com/robots.txt"]);
});

test("penolakan WAF menghentikan penerbit, dan artikel berikutnya dari penerbit itu tidak memicu permintaan", async () => {
  const server = recordedFetch();
  const now = advancingClock();
  const first = await readPublisherArticle(query("kabarbanten"), { fetchImpl: server.fetchImpl, now });
  assert.deepEqual(first, { ok: false, reason: "kabarbanten.pikiran-rakyat.com/: HTTP 403 dengan halaman tantangan WAF" });
  assert.deepEqual(server.requests.map((r) => r.url), ["https://kabarbanten.pikiran-rakyat.com/robots.txt", "https://kabarbanten.pikiran-rakyat.com/"]);
  const again = await readPublisherArticle(query("kabarbanten"), { fetchImpl: server.fetchImpl, now });
  assert.equal(again.ok, false);
  assert.match(again.ok ? "" : again.reason, /tantangan WAF \(penerbit tidak dihubungi lagi sementara\)$/);
  assert.equal(server.requests.length, 2);

  const tribun = await readPublisherArticle(query("tribunbanten"), { fetchImpl: server.fetchImpl, now });
  assert.deepEqual(tribun, { ok: false, reason: "banten.tribunnews.com/: HTTP 403 (akses ditolak)" });
});

test("tautan Google tidak pernah dibuka", async () => {
  const server = recordedFetch();
  const result = await readPublisherArticle({ ...query("bantenraya"), publisherOrigin: "https://news.google.com" }, { fetchImpl: server.fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(server.requests.length, 0);
});

test("satu jalur: dua pembacaan bersamaan tidak pernah membuat dua permintaan sekaligus", async () => {
  const server = recordedFetch();
  const now = advancingClock();
  const [wordpress, sitemap] = await Promise.all([
    readPublisherArticle(query("bantenraya"), { fetchImpl: server.fetchImpl, now }),
    readPublisherArticle(query("pandeglangnews"), { fetchImpl: server.fetchImpl, now }),
  ]);
  assert.ok(wordpress.ok && sitemap.ok);
  assert.equal(server.requests.length, 10);
  assert.equal(server.maxInFlight(), 1);
});
