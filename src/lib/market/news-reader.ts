/**
 * Pembaca isi berita langsung dari situs penerbitnya, supaya setiap item RSS Google News dibaca isinya sebelum dinilai.
 *
 * Tautan item RSS (news.google.com/rss/articles/...) tidak diikuti: robots.txt news.google.com melarang path itu. Artikel
 * dicari di situs penerbit lewat jalur yang memang disediakan untuk dibaca mesin, berurutan: API WordPress publik yang
 * diumumkan berandanya, feed RSS/Atom, lalu sitemap yang dicantumkan robots.txt. Identitas perayap jujur
 * (PROFILE_CRAWLER_UA), robots.txt diperiksa untuk setiap URL termasuk tujuan pengalihan, dan jawaban 401/403/429 atau
 * halaman tantangan WAF/CAPTCHA menghentikan pembacaan penerbit itu tanpa mencoba jalur lain.
 */
import { extractFromHtml } from "@extractus/article-extractor";
import { PROFILE_CRAWLER_UA, parseRobots, robotsAllows, robotsRulesForStatus } from "./official-pages";

export interface PublisherArticleQuery {
  /** Judul RSS tanpa akhiran " - NamaPenerbit". */
  title: string;
  /** Origin situs penerbit, misalnya "https://www.bantenraya.com". */
  publisherOrigin: string;
  publishedAt: Date | null;
}

export type PublisherArticle =
  | { ok: true; url: string; title: string; text: string; via: "wordpress-api" | "feed" | "sitemap" }
  | { ok: false; reason: string };

type RobotsRules = ReturnType<typeof parseRobots>;
type Via = Extract<PublisherArticle, { ok: true }>["via"];

export interface RobotsPolicy {
  rules: RobotsRules;
  sitemaps: string[];
  crawlDelayMs: number | null;
}

export interface MatchCandidate {
  url: string;
  title: string | null;
  publishedAt: Date | null;
}

export interface SitemapEntry extends MatchCandidate {
  lastmod: Date | null;
}

export type Sitemap = { kind: "index" | "urlset"; entries: SitemapEntry[] };

export interface WordPressPost {
  url: string;
  title: string;
  publishedAt: Date | null;
  html: string;
}

/**
 * Ambang kemiripan judul (koefisien Dice atas kata, lihat titleSimilarity), diukur 18 Nov 2026 pada data asli. Semua
 * pasangan benar dari uji nyata (judul RSS dengan judul pos wp-json, entri sitemap, dan halaman artikelnya) bernilai 1.
 * Dari 14.980 pasangan judul RSS berbeda dari penerbit yang sama di DB lokal, yang tertinggi 0,875 ("Kota Tangerang
 * juara umum Festival Olahraga Masyarakat 2026" dan "Kota Tangerang optimistis juara umum ..."), lalu 0,842 ("Penutupan
 * Festival ..." dan "Pembukaan Festival ..."). Ambang 0,9 menolak semua pasangan berbeda itu dan masih menerima beda huruf
 * besar, tanda baca, entitas, akhiran nama situs, satu kata tambahan, atau satu kata berganti pada judul sepuluh kata.
 */
export const TITLE_MATCH_THRESHOLD = 0.9;
/**
 * Ambang usulan dari slug URL (uji nyata: slug artikel yang benar 1, 1.068 slug lain di sitemap yang sama paling tinggi
 * 0,133). Halaman yang diusulkan tetap harus lolos TITLE_MATCH_THRESHOLD pada judulnya sendiri.
 */
export const SLUG_MATCH_THRESHOLD = 0.6;
/**
 * Teks hasil ekstraksi di bawah ini biasanya hanya keterangan foto atau kerangka halaman, belum isi berita. Artikel yang
 * terbaca pada uji nyata 18 Nov 2026 berisi 1.418 sampai 3.780 huruf.
 */
export const MIN_ARTICLE_LETTERS = 400;
/** Satu artikel tidak boleh memicu lebih dari sepuluh permintaan, termasuk robots.txt dan setiap pengalihan. */
export const MAX_REQUESTS_PER_ARTICLE = 10;

const REQUEST_TIMEOUT_MS = 15_000;
/** Jawaban lebih besar dari ini bukan artikel atau sitemap biasa; membacanya hanya menghabiskan bandwidth penerbit. */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** RFC 9309 2.3.1.2: pengalihan robots.txt diikuti paling sedikit lima kali. */
const ROBOTS_MAX_REDIRECTS = 5;
/** RFC 9309 2.4: salinan robots.txt tidak dipakai lebih dari 24 jam. */
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
/** Ciri situs (WordPress atau bukan, feed yang diumumkan) jarang berubah; beranda dibaca sekali sehari per penerbit. */
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
/** Penerbit yang menolak (401/403/429, WAF) tidak dihubungi lagi selama sehari, termasuk untuk artikel berikutnya. */
const REFUSAL_MEMORY_MS = 24 * 60 * 60 * 1000;
/** Galat jaringan bisa sementara, jadi penerbitnya dicoba lagi setelah satu jam, bukan di artikel berikutnya. */
const NETWORK_MEMORY_MS = 60 * 60 * 1000;
/**
 * Jeda antarpermintaan ke host yang sama. Situs berita daerah umumnya berada di hosting bersama yang kecil; dua detik
 * membuat satu artikel (paling banyak sepuluh permintaan) tidak terasa seperti lonjakan. Crawl-delay yang lebih panjang
 * di robots.txt didahulukan.
 */
const HOST_GAP_MS = 2_000;
/** Tanggal Google News hanya tanggal (jamnya dibuang), dan zona waktu penerbit bisa berbeda; selisih tiga hari masih wajar. */
const DATE_TOLERANCE_MS = 3 * 24 * 60 * 60 * 1000;
const SEARCH_TERM_COUNT = 4;
/** Feed utama situs biasanya tersedia di beberapa alamat dengan isi sama; dua percobaan cukup sebelum beralih ke sitemap. */
const MAX_FEEDS = 2;
/** Sitemap berita, indeks, lalu satu anak indeks. */
const MAX_SITEMAPS = 3;
const MIN_TITLE_TOKENS = 3;

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8";
const XML_ACCEPT = "application/xml, text/xml;q=0.9, */*;q=0.5";
const HTML_ACCEPT = "text/html, application/xhtml+xml;q=0.9";
const CRAWLER_TOKEN = PROFILE_CRAWLER_UA.split("/")[0].toLowerCase();
const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/i;

// ---------- teks dan judul ----------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** Kata judul yang diseragamkan. Entitas didekode dua kali karena feed WordPress sering menyandikannya ganda (&amp;#8217;). */
export function titleTokens(text: string): string[] {
  return decodeEntities(decodeEntities(text))
    .normalize("NFKD")
    .replace(/[\p{M}\p{Cf}]/gu, "")
    .toLowerCase()
    .replace(/(\d)[.,](?=\d{3}(?!\d))/g, "$1")
    .replace(/['’‘`´]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Pemisah judul dan nama situs ("Judul - Situs", "Judul | Situs"); tanda hubung di dalam kata seperti "Anyer-Cinangka" bukan pemisah. */
const TITLE_SEPARATOR = /\s+[-–—|»]\s+|\s*\|\s*/;

/**
 * Judul utuh ditambah awalannya yang berakhir di pemisah. Hanya awalan: judul berita ada di depan dan nama situs di
 * belakang, jadi potongan nama situs saja ("Pandeglang News") tidak pernah dibandingkan sendirian.
 */
function titleVariants(text: string): string[][] {
  const segments = decodeEntities(decodeEntities(text)).split(TITLE_SEPARATOR).map(titleTokens);
  const variants: string[][] = [];
  for (let end = segments.length; end >= 1; end--) {
    const tokens = segments.slice(0, end).flat();
    if (end === segments.length || tokens.length >= MIN_TITLE_TOKENS) variants.push(tokens);
  }
  return variants;
}

function dice(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return (2 * shared) / (left.size + right.size);
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, "");

/**
 * Kemiripan dua judul dari 0 sampai 1: koefisien Dice atas himpunan kata setelah entitas HTML, tanda baca, huruf besar,
 * dan diakritik diseragamkan. Beda satu dua kata menurunkan nilai sedikit demi sedikit, dan akhiran nama situs di salah
 * satu sisi tidak menurunkannya karena awalan sebelum pemisah ikut dibandingkan.
 */
export function titleSimilarity(a: string, b: string): number {
  let best = 0;
  for (const left of titleVariants(a)) for (const right of titleVariants(b)) best = Math.max(best, dice(left, right));
  return round(best);
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    // ZERO-FALLBACK: segmen dengan persen rusak tetap dibandingkan apa adanya; galat lain bukan urusan pencocokan.
    if (error instanceof URIError) return segment;
    throw error;
  }
}

/** Kata dari slug URL: segmen path dengan kata terbanyak, tanpa ekstensi dan tanpa nomor ID panjang. */
export function slugTokens(url: string): string[] {
  if (!URL.canParse(url)) return [];
  let slug = "";
  for (const segment of new URL(url).pathname.split("/")) {
    if (segment.split(/[-_]/).length > slug.split(/[-_]/).length) slug = segment;
  }
  return titleTokens(decodePathSegment(slug).replace(/\.(html?|php|aspx?)$/i, "")).filter((token) => !/^\d{5,}$/.test(token));
}

/**
 * Kemiripan slug dengan judul. Slug sering memendekkan judul (kata sambung dibuang atau dipotong), jadi yang diukur
 * bagian slug yang ada di judul, lalu dikurangi bila slug hanya mencakup kurang dari separuh kata judul supaya slug
 * pendek yang umum ("wisata-pantai-anyer") tidak menang.
 */
export function slugSimilarity(url: string, title: string): number {
  const slug = new Set(slugTokens(url));
  const words = new Set(titleTokens(title));
  if (slug.size < MIN_TITLE_TOKENS || !words.size) return 0;
  let shared = 0;
  for (const token of slug) if (words.has(token)) shared++;
  return round((shared / slug.size) * Math.min(1, (2 * shared) / words.size));
}

const SEARCH_STOPWORDS = new Set([
  "yang", "dari", "untuk", "dengan", "pada", "akan", "juga", "dalam", "oleh", "atau", "tidak", "bisa", "lebih", "para",
  "sebagai", "karena", "hingga", "saat", "setelah", "usai", "jelang", "bagi", "kepada", "agar", "jadi", "buat", "cuma",
  "bukan", "masih", "sudah", "telah", "sejak", "antara", "tetap", "makin", "kian", "ternyata", "menjadi", "mulai",
  "with", "from", "this", "that",
]);

/**
 * Kata kunci pencarian wp-json: kata judul terpanjang di luar kata sambung. Pencarian WordPress mensyaratkan setiap kata
 * ada di pos, jadi beberapa kata yang paling khas lebih tahan terhadap judul yang disunting daripada judul utuh.
 */
export function searchTerms(title: string): string {
  const tokens = [...new Set(titleTokens(title))].filter((t) => t.length >= 4 && !SEARCH_STOPWORDS.has(t) && !/^\d+$/.test(t));
  return tokens.sort((a, b) => b.length - a.length).slice(0, SEARCH_TERM_COUNT).join(" ");
}

/** Teks polos dari HTML artikel; batas paragraf dipertahankan sebagai baris baru. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr|figure|figcaption|section|article|ul|ol|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export const countLetters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;

// ---------- format feed, sitemap, wp-json ----------

const parseDate = (text: string | null): Date | null => {
  if (!text) return null;
  const date = new Date(text.trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

const xmlText = (raw: string) => decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();

function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? xmlText(match[1]) : null;
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}

/** Butir feed RSS 2.0 dan Atom. Tautan relatif diselesaikan oleh pemanggil terhadap URL feed. */
export function parseFeed(xml: string): MatchCandidate[] {
  const items: MatchCandidate[] = [];
  for (const [, block] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = tagText(block, "title");
    const guid = block.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
    const permalink = guid && !/isPermaLink\s*=\s*["']false/i.test(guid[0]) ? xmlText(guid[1]) : null;
    const url = tagText(block, "link") || permalink;
    if (title && url) items.push({ url, title, publishedAt: parseDate(tagText(block, "pubDate") ?? tagText(block, "dc:date")) });
  }
  for (const [, block] of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const title = tagText(block, "title");
    const link = [...block.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag).find((tag) => (attribute(tag, "rel") ?? "alternate") === "alternate");
    const url = link ? attribute(link, "href") : null;
    if (title && url) items.push({ url, title, publishedAt: parseDate(tagText(block, "published") ?? tagText(block, "updated")) });
  }
  return items;
}

/**
 * Indeks sitemap, urlset (termasuk judul dan tanggal Google News bila ada), atau feed RSS/Atom yang dicantumkan sebagai
 * sitemap (format yang diakui sitemaps.org). null bila isinya bukan salah satunya.
 */
export function parseSitemap(xml: string): Sitemap | null {
  if (/<sitemapindex\b/i.test(xml)) {
    const entries = [...xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)].flatMap(([, block]) => {
      const url = tagText(block, "loc");
      return url ? [{ url, title: null, publishedAt: null, lastmod: parseDate(tagText(block, "lastmod")) }] : [];
    });
    return { kind: "index", entries };
  }
  if (/<urlset\b/i.test(xml)) {
    const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap(([, block]) => {
      const url = tagText(block, "loc");
      const news = block.match(/<news:news\b[^>]*>([\s\S]*?)<\/news:news>/i)?.[1] ?? "";
      return url
        ? [{ url, title: tagText(news, "news:title"), publishedAt: parseDate(tagText(news, "news:publication_date")), lastmod: parseDate(tagText(block, "lastmod")) }]
        : [];
    });
    return { kind: "urlset", entries };
  }
  if (/<(rss|feed)\b/i.test(xml)) return { kind: "urlset", entries: parseFeed(xml).map((item) => ({ ...item, lastmod: null })) };
  return null;
}

const NEWS_SITEMAP = /(?:^|[-_/.])(?:news|gn)(?:[-_/.]|$)/i;
/** Anak sitemap yang bukan daftar artikel: kategori, tag, penulis, pengguna, halaman statis, lampiran, media. */
const NON_ARTICLE_SITEMAP =
  /(?:^|[-_/.])(?:category|categories|kategori|tags?|post_tag|authors?|users?|penulis|pages?|attachment|videos?|images?|web-?stor(?:y|ies)|products?|topics?|labels?|misc|tax)(?:[-_/.]|$)/i;

const monthMarks = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return [`${year}-${month}`, `${year}/${month}`, `${year}${month}`, `${year}_${month}`];
};

/**
 * Urutan anak indeks sitemap yang dibuka: sitemap berita, lalu yang namanya memuat bulan publishedAt, lalu yang lastmod-nya
 * paling awal tetapi tidak sebelum publishedAt (sitemap pos bernomor terisi dari lama ke baru, jadi itulah potongan yang
 * memuat artikelnya), lalu yang terbaru. Tanpa lastmod, entri yang lebih belakang di indeks dianggap lebih baru.
 */
export function rankSitemapChildren(entries: SitemapEntry[], publishedAt: Date | null): string[] {
  const marks = publishedAt ? monthMarks(publishedAt) : [];
  const ranked = entries.flatMap((entry, index) => {
    if (!URL.canParse(entry.url)) return [];
    const path = new URL(entry.url).pathname.toLowerCase();
    if (NON_ARTICLE_SITEMAP.test(path)) return [];
    const covers = Boolean(publishedAt && entry.lastmod && entry.lastmod.getTime() >= publishedAt.getTime());
    const rank = (NEWS_SITEMAP.test(path) ? 4 : 0) + (marks.some((mark) => path.includes(mark)) ? 2 : 0) + (covers ? 1 : 0);
    return [{ url: entry.url, index, rank, covers, time: entry.lastmod?.getTime() ?? 0 }];
  });
  ranked.sort((a, b) => b.rank - a.rank || (a.covers && b.covers ? a.time - b.time : b.time - a.time) || b.index - a.index);
  return ranked.map((entry) => entry.url);
}

/** Pos dari GET /wp-json/wp/v2/posts. null bila jawabannya bukan daftar pos WordPress. */
export function parseWordPressPosts(body: string): WordPressPost[] | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    // ZERO-FALLBACK: situs non-WordPress menjawab path ini dengan HTML; itu hasil "bukan WordPress", bukan galat program.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!Array.isArray(data)) return null;
  const posts: WordPressPost[] = [];
  for (const raw of data) {
    const post = raw as { link?: unknown; date?: unknown; title?: { rendered?: unknown }; content?: { rendered?: unknown } };
    if (typeof post.link !== "string" || typeof post.title?.rendered !== "string") return null;
    posts.push({
      url: post.link,
      title: decodeEntities(post.title.rendered.replace(/<[^>]+>/g, "")).trim(),
      // `date` WordPress adalah waktu lokal situs tanpa zona; selisih jamnya jauh di bawah toleransi tanggal.
      publishedAt: typeof post.date === "string" ? parseDate(post.date) : null,
      html: typeof post.content?.rendered === "string" ? post.content.rendered : "",
    });
  }
  return posts;
}

/** Feed yang diumumkan beranda lewat <link rel="alternate">, tanpa feed komentar. */
export function feedLinksFromHtml(html: string, pageUrl: string): string[] {
  const links: string[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attribute(tag, "rel") ?? "";
    const type = attribute(tag, "type") ?? "";
    const href = attribute(tag, "href");
    if (!href || !/\balternate\b/i.test(rel) || !/application\/(rss|atom)\+xml/i.test(type)) continue;
    if (/comment|komentar/i.test(`${href} ${attribute(tag, "title") ?? ""}`) || !URL.canParse(href, pageUrl)) continue;
    links.push(new URL(href, pageUrl).href);
  }
  return links;
}

export interface SiteProfile {
  /** Basis REST API WordPress situs, null bila beranda tidak menandakan WordPress. */
  wordpressApi: string | null;
  feeds: string[];
}

/**
 * Ciri situs dari beranda. API WordPress diambil dari pengumumannya sendiri (<link rel="https://api.w.org/"> atau header
 * Link), atau /wp-json/ bila aset tema dimuat dari /wp-content/ situs itu sendiri. Path /wp-json/ tidak ditebak di situs
 * yang bukan WordPress: banten.tribunnews.com dan www.beritasatu.com menjawab tebakan itu dengan 403.
 */
export function siteProfileFromHtml(html: string, linkHeader: string | null, pageUrl: string): SiteProfile {
  const site = siteOf(new URL(pageUrl).hostname);
  const sameSite = (href: string) => URL.canParse(href, pageUrl) && siteOf(new URL(href, pageUrl).hostname) === site;
  const fromHeader = linkHeader?.match(/<([^>]+)>\s*;\s*rel="?https:\/\/api\.w\.org\/"?/i)?.[1] ?? null;
  const headLink = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => tag).find((tag) => attribute(tag, "rel") === "https://api.w.org/");
  const advertised = fromHeader ?? (headLink ? attribute(headLink, "href") : null);
  let wordpressApi = advertised && sameSite(advertised) ? new URL(advertised, pageUrl).href : null;
  if (!wordpressApi) {
    const ownAssets = [...html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)].some(
      ([, href]) => sameSite(href) && /^\/wp-(?:content|includes)\//.test(new URL(href, pageUrl).pathname),
    );
    if (ownAssets) wordpressApi = new URL("/wp-json/", pageUrl).href;
  }
  return { wordpressApi, feeds: feedLinksFromHtml(html, pageUrl).filter(sameSite) };
}

/** URL daftar pos dari basis API yang diumumkan, baik bentuk /wp-json/ maupun ?rest_route=/. */
export function wordPressPostsUrl(apiBase: string, params: Record<string, string>): URL {
  const base = new URL(apiBase);
  const url = base.searchParams.has("rest_route") ? base : new URL("wp/v2/posts", base.href.endsWith("/") ? base.href : `${base.href}/`);
  if (url === base) url.searchParams.set("rest_route", "/wp/v2/posts");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

/** Calon judul halaman artikel: hasil ekstraksi, og:title, h1 pertama, dan <title>. */
export function pageTitles(html: string, extractedTitle: string | undefined): string[] {
  const og = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => tag).find((tag) => /^og:title$/i.test(attribute(tag, "property") ?? attribute(tag, "name") ?? ""));
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1].replace(/<[^>]+>/g, " ");
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return [extractedTitle, og ? attribute(og, "content") : null, h1, titleTag]
    .flatMap((title) => (title ? [decodeEntities(title).replace(/\s+/g, " ").trim()] : []))
    .filter(Boolean);
}

// ---------- robots.txt ----------

/**
 * Aturan robots.txt untuk perayap ini beserta baris "Sitemap:" dan Crawl-delay. parseRobots hanya membaca grup pertama
 * yang cocok, padahal RFC 9309 2.2.1 meminta grup untuk agen yang sama digabung (www.bantennews.co.id dan bantentv.com
 * menulis "User-agent: *" dua kali). Jadi teks dipecah per grup, setiap grup dibaca parseRobots, lalu aturannya digabung.
 */
export function robotsPolicy(text: string): RobotsPolicy {
  const groups: { agents: string[]; lines: string[] }[] = [];
  const sitemaps: string[] = [];
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !groups.length) groups.push({ agents: [], lines: [] });
      groups[groups.length - 1].agents.push(value.toLowerCase());
      groups[groups.length - 1].lines.push(line);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "sitemap") {
      if (URL.canParse(value) && !sitemaps.includes(value)) sitemaps.push(value);
      continue;
    }
    groups.at(-1)?.lines.push(line);
  }
  const own = groups.filter((group) => group.agents.some((agent) => agent !== "*" && CRAWLER_TOKEN.includes(agent)));
  const chosen = own.length ? own : groups.filter((group) => group.agents.includes("*"));
  const rules: RobotsRules = { disallow: [], allow: [] };
  let crawlDelayMs: number | null = null;
  for (const group of chosen) {
    const parsed = parseRobots(group.lines.join("\n"));
    rules.disallow.push(...parsed.disallow);
    rules.allow.push(...parsed.allow);
    for (const line of group.lines) {
      const delay = line.match(/^crawl-delay\s*:\s*(\d+(?:\.\d+)?)$/i);
      if (delay) crawlDelayMs = Math.max(crawlDelayMs ?? 0, Number(delay[1]) * 1000);
    }
  }
  return { rules, sitemaps, crawlDelayMs };
}

// ---------- penolakan dan tantangan WAF ----------

const CHALLENGE_TITLE =
  /<title[^>]*>\s*(?:just a moment|attention required|access denied|security check|verifying you are human|one moment, please|ddos-guard|robot challenge|human verification|captcha|not acceptable)/i;
/** Penanda yang hanya ada di halaman tantangan atau blokir, bukan di halaman biasa yang kebetulan memuat skrip CDN yang sama. */
const CHALLENGE_MARKER =
  /window\._cf_chl_opt|\/\.well-known\/sgcaptcha|access to this site has been limited|Incapsula incident ID|geo\.captcha-delivery\.com|generated by Mod_Security|Sucuri WebSite Firewall - Access Denied/i;

/**
 * Alasan berhenti bila jawabannya penolakan (401/403/429) atau halaman tantangan WAF/CAPTCHA, selain itu null. Penerbit
 * yang menolak tidak dicoba lewat jalur lain.
 */
export function refusalReason(status: number, headers: Headers, body: string): string | null {
  const head = body.slice(0, 20_000);
  const challenge = headers.get("cf-mitigated") === "challenge" || CHALLENGE_TITLE.test(head) || CHALLENGE_MARKER.test(head);
  if (status === 401) return "HTTP 401 (butuh login)";
  if (status === 403) return challenge ? "HTTP 403 dengan halaman tantangan WAF" : "HTTP 403 (akses ditolak)";
  if (status === 429) return "HTTP 429 (terlalu banyak permintaan)";
  if (challenge) return `halaman tantangan WAF/CAPTCHA (HTTP ${status})`;
  return null;
}

// ---------- permintaan HTTP ----------

class ReaderStop extends Error {
  constructor(
    message: string,
    /** Berapa lama penerbit ini tidak dihubungi lagi; null bila hanya artikel ini yang dihentikan. */
    readonly rememberMs: number | null,
  ) {
    super(message);
  }
}

interface CrawlState {
  robots: Map<string, { policy: RobotsPolicy; fetchedAt: number }>;
  profiles: Map<string, { profile: SiteProfile; fetchedAt: number }>;
  stopped: Map<string, { reason: string; until: number }>;
  lastRequestAt: Map<string, number>;
  /** Satu jalur: setiap permintaan menunggu permintaan sebelumnya selesai, walaupun pemanggil berjalan paralel. */
  lane: Promise<void>;
}

/** Keadaan per implementasi fetch, supaya tes dengan fetch tiruan tidak berbagi cache dengan perayap sebenarnya. */
const crawlStates = new WeakMap<typeof fetch, CrawlState>();

function crawlStateFor(fetchImpl: typeof fetch): CrawlState {
  let state = crawlStates.get(fetchImpl);
  if (!state) {
    state = { robots: new Map(), profiles: new Map(), stopped: new Map(), lastRequestAt: new Map(), lane: Promise.resolve() };
    crawlStates.set(fetchImpl, state);
  }
  return state;
}

interface Session {
  origin: URL;
  site: string;
  fetchImpl: typeof fetch;
  now: () => Date;
  state: CrawlState;
  requests: number;
  notes: string[];
}

interface Reply {
  url: URL;
  status: number;
  headers: Headers;
  body: string;
  tooLarge: boolean;
}

type Fetched = { ok: true; url: URL; status: number; headers: Headers; body: string } | { ok: false; note: string };

const isRedirect = (status: number) => status >= 300 && status < 400;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function describeNetworkError(error: Error): string {
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  if (error.name === "TimeoutError") return `tidak menjawab dalam ${REQUEST_TIMEOUT_MS / 1000} detik`;
  if (cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || cause?.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
    return `sertifikat TLS tidak bisa diverifikasi (${cause.code}; rantai sertifikat perantara tidak dikirim server)`;
  }
  return cause?.code ?? cause?.message ?? error.message;
}

function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const charset = contentType?.match(/charset\s*=\s*"?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch (error) {
    // ZERO-FALLBACK: label charset yang tidak dikenal TextDecoder dibaca sebagai UTF-8, pengodean situs berita Indonesia yang umum.
    if (error instanceof RangeError) return new TextDecoder("utf-8").decode(bytes);
    throw error;
  }
}

async function readLimited(res: Response): Promise<{ body: string; tooLarge: boolean }> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) {
    await res.body?.cancel();
    return { body: "", tooLarge: true };
  }
  if (!res.body) return { body: "", tooLarge: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { body: "", tooLarge: true };
    }
    chunks.push(value);
  }
  return { body: decodeBody(Buffer.concat(chunks), res.headers.get("content-type")), tooLarge: false };
}

/** Satu permintaan HTTP (satu lompatan, tanpa mengikuti pengalihan) di jalur tunggal, dengan jeda per host dan batas waktu. */
async function send(s: Session, url: URL, accept: string): Promise<Reply> {
  // Host Google tidak pernah dihubungi, juga bila pengalihan robots.txt penerbit mengarah ke sana.
  if (GOOGLE_HOST.test(url.hostname)) throw new ReaderStop(`${url.host} tidak dihubungi; artikel hanya dibaca dari situs penerbit`, null);
  if (s.requests >= MAX_REQUESTS_PER_ARTICLE) throw new ReaderStop(`batas ${MAX_REQUESTS_PER_ARTICLE} permintaan per artikel tercapai`, null);
  s.requests++;
  const run = s.state.lane.then(async (): Promise<Reply> => {
    const gap = Math.max(HOST_GAP_MS, s.state.robots.get(url.origin)?.policy.crawlDelayMs ?? 0);
    const last = s.state.lastRequestAt.get(url.host);
    const waitMs = last === undefined ? 0 : last + gap - s.now().getTime();
    if (waitMs > 0) await pause(waitMs);
    s.state.lastRequestAt.set(url.host, s.now().getTime());
    const res = await s.fetchImpl(url.href, {
      headers: { "User-Agent": PROFILE_CRAWLER_UA, Accept: accept },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (isRedirect(res.status)) {
      await res.body?.cancel();
      return { url, status: res.status, headers: res.headers, body: "", tooLarge: false };
    }
    return { url, status: res.status, headers: res.headers, ...(await readLimited(res)) };
  });
  // ZERO-FALLBACK: kegagalan satu permintaan tidak boleh memutus antrean; galatnya tetap sampai ke pemanggil lewat `run`.
  s.state.lane = run.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await run;
  } catch (error) {
    // Hanya kegagalan jaringan (undici: TypeError "fetch failed") dan batas waktu yang menjadi alasan; galat lain adalah bug.
    const networkFailure =
      (error instanceof TypeError && error.message === "fetch failed") ||
      (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));
    if (!networkFailure) throw error;
    throw new ReaderStop(`gagal menghubungi ${url.host}: ${describeNetworkError(error as Error)}`, NETWORK_MEMORY_MS);
  }
}

/**
 * robots.txt sebuah origin, dari cache bila belum 24 jam. Status mengikuti RFC 9309 lewat robotsRulesForStatus (4xx tidak
 * ada larangan, 5xx larangan penuh), kecuali 401/403/429 dan halaman tantangan: itu penolakan, jadi penerbitnya berhenti.
 */
async function robotsFor(s: Session, origin: string): Promise<RobotsPolicy> {
  const cached = s.state.robots.get(origin);
  if (cached && s.now().getTime() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.policy;
  let url = new URL("/robots.txt", origin);
  for (let hop = 0; hop <= ROBOTS_MAX_REDIRECTS; hop++) {
    const reply = await send(s, url, "text/plain");
    const refusal = refusalReason(reply.status, reply.headers, reply.body);
    if (refusal) throw new ReaderStop(`robots.txt ${url.host}: ${refusal}`, REFUSAL_MEMORY_MS);
    const location = reply.headers.get("location");
    if (isRedirect(reply.status) && location && URL.canParse(location, url)) {
      url = new URL(location, url);
      continue;
    }
    const ok = reply.status >= 200 && reply.status < 300 && !reply.tooLarge;
    const policy = ok ? robotsPolicy(reply.body) : { rules: robotsRulesForStatus(reply.status, ""), sitemaps: [], crawlDelayMs: null };
    s.state.robots.set(origin, { policy, fetchedAt: s.now().getTime() });
    if (!ok && reply.status >= 500) {
      throw new ReaderStop(`robots.txt ${url.host} menjawab HTTP ${reply.status}; menurut RFC 9309 dianggap larangan penuh`, REFUSAL_MEMORY_MS);
    }
    return policy;
  }
  throw new ReaderStop(`robots.txt ${origin} dialihkan lebih dari ${ROBOTS_MAX_REDIRECTS} kali`, REFUSAL_MEMORY_MS);
}

/**
 * Ambil satu sumber di situs penerbit: setiap lompatan pengalihan diperiksa ke robots.txt origin-nya dan harus tetap di
 * situs yang sama. Penolakan dan tantangan WAF dilempar sebagai ReaderStop; hambatan lain dikembalikan sebagai catatan.
 */
async function fetchResource(s: Session, href: string, accept: string): Promise<Fetched> {
  let url = new URL(href);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if ((url.protocol !== "https:" && url.protocol !== "http:") || siteOf(url.hostname) !== s.site) {
      return { ok: false, note: `${url.href} di luar situs penerbit` };
    }
    const policy = await robotsFor(s, url.origin);
    if (!robotsAllows(policy.rules, `${url.pathname}${url.search}`)) return { ok: false, note: `robots.txt melarang ${url.pathname}` };
    const reply = await send(s, url, accept);
    const refusal = refusalReason(reply.status, reply.headers, reply.body);
    if (refusal) throw new ReaderStop(`${url.host}${url.pathname}: ${refusal}`, REFUSAL_MEMORY_MS);
    if (isRedirect(reply.status)) {
      const location = reply.headers.get("location");
      if (!location || !URL.canParse(location, url)) return { ok: false, note: `${url.pathname} HTTP ${reply.status} tanpa tujuan` };
      url = new URL(location, url);
      continue;
    }
    if (reply.tooLarge) return { ok: false, note: `${url.pathname} lebih dari ${MAX_RESPONSE_BYTES / 1024 / 1024} MB` };
    return { ok: true, url, status: reply.status, headers: reply.headers, body: reply.body };
  }
  return { ok: false, note: `${href} dialihkan lebih dari ${MAX_REDIRECTS} kali` };
}

// ---------- strategi ----------

/** Calon dengan kemiripan tertinggi di atas ambang; calon bertanggal di luar toleransi publishedAt dilewati. */
export function bestMatch(candidates: MatchCandidate[], query: { title: string; publishedAt: Date | null }) {
  let best: { url: string; title: string | null; score: number } | null = null;
  for (const candidate of candidates) {
    const { publishedAt } = query;
    if (publishedAt && candidate.publishedAt && Math.abs(candidate.publishedAt.getTime() - publishedAt.getTime()) > DATE_TOLERANCE_MS) continue;
    const score = candidate.title ? titleSimilarity(query.title, candidate.title) : slugSimilarity(candidate.url, query.title);
    if (score < (candidate.title ? TITLE_MATCH_THRESHOLD : SLUG_MATCH_THRESHOLD)) continue;
    if (!best || score > best.score) best = { url: candidate.url, title: candidate.title, score };
  }
  return best;
}

async function readArticlePage(s: Session, query: PublisherArticleQuery, href: string, via: Via): Promise<PublisherArticle> {
  const page = await fetchResource(s, href, HTML_ACCEPT);
  if (!page.ok) return { ok: false, reason: `halaman artikel: ${page.note}` };
  if (page.status !== 200) return { ok: false, reason: `halaman artikel ${href} menjawab HTTP ${page.status}` };
  let extracted: Awaited<ReturnType<typeof extractFromHtml>>;
  try {
    extracted = await extractFromHtml(page.body, page.url.href);
  } catch (error) {
    // Pengurai pihak ketiga atas HTML luar: galatnya dilaporkan sebagai alasan artikel ini gagal, bukan ditelan.
    return { ok: false, reason: `ekstraksi isi ${href} gagal: ${(error as Error).message}` };
  }
  const scored = pageTitles(page.body, extracted?.title).map((title) => ({ title, score: titleSimilarity(query.title, title) }));
  // Judul yang dikembalikan: calon lolos pertama menurut urutan pageTitles (meta dan og:title biasanya tanpa nama situs).
  const matched = scored.find((candidate) => candidate.score >= TITLE_MATCH_THRESHOLD);
  if (!matched) {
    const best = Math.max(0, ...scored.map((candidate) => candidate.score));
    return { ok: false, reason: `judul halaman ${href} tidak cocok (kemiripan ${best} < ${TITLE_MATCH_THRESHOLD})` };
  }
  const text = extracted?.content ? htmlToText(extracted.content) : "";
  const letters = countLetters(text);
  if (letters < MIN_ARTICLE_LETTERS) return { ok: false, reason: `teks artikel ${href} hanya ${letters} huruf (minimal ${MIN_ARTICLE_LETTERS})` };
  return { ok: true, url: page.url.href, title: matched.title, text, via };
}

/** Ciri situs dari beranda, dari cache bila belum sehari; beranda yang gagal dibaca tidak disimpan supaya dicoba lagi. */
async function siteProfileFor(s: Session): Promise<SiteProfile> {
  const cached = s.state.profiles.get(s.origin.origin);
  if (cached && s.now().getTime() - cached.fetchedAt < PROFILE_TTL_MS) return cached.profile;
  const home = await fetchResource(s, s.origin.href, HTML_ACCEPT);
  if (!home.ok || home.status !== 200) {
    s.notes.push(`beranda: ${home.ok ? `HTTP ${home.status}` : home.note}`);
    return { wordpressApi: null, feeds: [] };
  }
  const profile = siteProfileFromHtml(home.body, home.headers.get("link"), home.url.href);
  s.state.profiles.set(s.origin.origin, { profile, fetchedAt: s.now().getTime() });
  return profile;
}

async function viaWordPress(s: Session, query: PublisherArticleQuery, profile: SiteProfile): Promise<PublisherArticle | null> {
  if (!profile.wordpressApi) {
    s.notes.push("wp-json: beranda tidak menandakan WordPress");
    return null;
  }
  const terms = searchTerms(query.title);
  if (!terms) {
    s.notes.push("wp-json: judul tanpa kata kunci");
    return null;
  }
  const api = wordPressPostsUrl(profile.wordpressApi, { search: terms, per_page: "10", _fields: "link,date,title,content" });
  const fetched = await fetchResource(s, api.href, "application/json");
  if (!fetched.ok) {
    s.notes.push(`wp-json: ${fetched.note}`);
    return null;
  }
  const posts = fetched.status === 200 ? parseWordPressPosts(fetched.body) : null;
  if (!posts) {
    s.notes.push(`wp-json: ${fetched.status === 200 ? "jawaban bukan daftar pos WordPress" : `HTTP ${fetched.status}`}`);
    return null;
  }
  const match = bestMatch(posts, query);
  const post = match && posts.find((candidate) => candidate.url === match.url);
  if (!post) {
    s.notes.push(`wp-json: tidak ada judul cocok di ${posts.length} hasil pencarian "${terms}"`);
    return null;
  }
  if (!URL.canParse(post.url) || siteOf(new URL(post.url).hostname) !== s.site) {
    return { ok: false, reason: `wp-json menunjuk ${post.url} di luar situs penerbit` };
  }
  const link = new URL(post.url);
  const policy = await robotsFor(s, link.origin);
  if (!robotsAllows(policy.rules, `${link.pathname}${link.search}`)) {
    return { ok: false, reason: `robots.txt melarang path artikel ${link.pathname}` };
  }
  const text = htmlToText(post.html);
  if (countLetters(text) >= MIN_ARTICLE_LETTERS) return { ok: true, url: post.url, title: post.title, text, via: "wordpress-api" };
  s.notes.push(`wp-json: isi pos hanya ${countLetters(text)} huruf, halaman artikel dibaca`);
  return readArticlePage(s, query, post.url, "wordpress-api");
}

async function viaFeed(s: Session, query: PublisherArticleQuery, profile: SiteProfile): Promise<PublisherArticle | null> {
  const candidates = [...profile.feeds, ...["/feed/", "/rss", "/feed"].map((path) => new URL(path, s.origin).href)];
  // "/feed" dan "/feed/" berisi sama di WordPress; garis miring akhir diabaikan supaya tidak dibaca dua kali.
  const seen = new Set<string>();
  let attempts = 0;
  for (const href of candidates) {
    const key = href.replace(/\/+$/, "");
    if (seen.has(key) || siteOf(new URL(href).hostname) !== s.site) continue;
    seen.add(key);
    if (attempts++ >= MAX_FEEDS) break;
    const path = new URL(href).pathname;
    const feed = await fetchResource(s, href, FEED_ACCEPT);
    if (!feed.ok || feed.status !== 200) {
      s.notes.push(`feed ${path}: ${feed.ok ? `HTTP ${feed.status}` : feed.note}`);
      continue;
    }
    const items = parseFeed(feed.body).flatMap((item) => (URL.canParse(item.url, feed.url) ? [{ ...item, url: new URL(item.url, feed.url).href }] : []));
    if (!items.length) {
      s.notes.push(`feed ${path}: bukan feed RSS/Atom`);
      continue;
    }
    const match = bestMatch(items, query);
    if (match) return readArticlePage(s, query, match.url, "feed");
    s.notes.push(`feed ${path}: tidak ada di ${items.length} butir terbaru`);
    return null;
  }
  return null;
}

async function viaSitemap(s: Session, query: PublisherArticleQuery, policy: RobotsPolicy): Promise<PublisherArticle | null> {
  const roots = policy.sitemaps.filter((href) => siteOf(new URL(href).hostname) === s.site);
  if (!roots.length) {
    s.notes.push(policy.sitemaps.length ? "sitemap: robots.txt hanya mencantumkan sitemap di host lain" : "sitemap: robots.txt tidak mencantumkan sitemap");
    return null;
  }
  const queue = [...roots.filter((href) => NEWS_SITEMAP.test(new URL(href).pathname)), ...roots.filter((href) => !NEWS_SITEMAP.test(new URL(href).pathname))];
  let fetchedCount = 0;
  while (queue.length && fetchedCount < MAX_SITEMAPS) {
    const href = queue.shift() as string;
    const path = new URL(href).pathname;
    if (/\.gz$/i.test(path)) {
      s.notes.push(`sitemap ${path}: berkas .gz tidak dibaca`);
      continue;
    }
    fetchedCount++;
    const fetched = await fetchResource(s, href, XML_ACCEPT);
    if (!fetched.ok || fetched.status !== 200) {
      s.notes.push(`sitemap ${path}: ${fetched.ok ? `HTTP ${fetched.status}` : fetched.note}`);
      continue;
    }
    const sitemap = parseSitemap(fetched.body);
    if (!sitemap) {
      s.notes.push(`sitemap ${path}: bukan sitemap XML`);
      continue;
    }
    // Protokol sitemap meminta URL lengkap, tetapi ada situs yang menulis <loc> relatif (bantenprov.go.id).
    const entries = sitemap.entries.flatMap((entry) => (URL.canParse(entry.url, fetched.url) ? [{ ...entry, url: new URL(entry.url, fetched.url).href }] : []));
    if (sitemap.kind === "index") {
      queue.unshift(...rankSitemapChildren(entries, query.publishedAt).slice(0, MAX_SITEMAPS - fetchedCount));
      continue;
    }
    const match = bestMatch(entries, query);
    if (match) return readArticlePage(s, query, match.url, "sitemap");
    s.notes.push(`sitemap ${path}: tidak ada yang cocok di ${entries.length} URL`);
  }
  return null;
}

function publisherOrigin(raw: string): URL | string {
  if (!URL.canParse(raw)) return `origin penerbit tidak sah: ${raw}`;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") return `origin penerbit harus http atau https: ${raw}`;
  if (GOOGLE_HOST.test(url.hostname)) return "situs Google tidak dibaca; artikel dicari di situs penerbitnya";
  if (url.hostname === "localhost" || /^[\d.]+$|^\[/.test(url.hostname)) return `origin penerbit harus nama domain publik: ${raw}`;
  return new URL(url.origin);
}

/**
 * Cari dan baca satu artikel di situs penerbitnya. Tidak pernah membuka news.google.com. Mengembalikan alasan dalam
 * Bahasa Indonesia bila artikel tidak ditemukan, dilarang robots.txt, atau penerbit menolak perayap.
 */
export async function readPublisherArticle(
  query: PublisherArticleQuery,
  deps: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<PublisherArticle> {
  const origin = publisherOrigin(query.publisherOrigin);
  if (typeof origin === "string") return { ok: false, reason: origin };
  if (titleTokens(query.title).length < MIN_TITLE_TOKENS) return { ok: false, reason: "judul RSS terlalu pendek untuk dicocokkan" };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const state = crawlStateFor(fetchImpl);
  const stopped = state.stopped.get(origin.origin);
  if (stopped && stopped.until > now().getTime()) return { ok: false, reason: `${stopped.reason} (penerbit tidak dihubungi lagi sementara)` };
  const s: Session = { origin, site: siteOf(origin.hostname), fetchImpl, now, state, requests: 0, notes: [] };
  try {
    const policy = await robotsFor(s, origin.origin);
    if (!robotsAllows(policy.rules, "/") && !policy.rules.allow.length) return { ok: false, reason: "robots.txt melarang seluruh situs untuk perayap ini" };
    const profile = await siteProfileFor(s);
    const found = (await viaWordPress(s, query, profile)) ?? (await viaFeed(s, query, profile)) ?? (await viaSitemap(s, query, policy));
    return found ?? { ok: false, reason: `artikel tidak ditemukan di wp-json, feed, dan sitemap (${s.notes.join("; ")})` };
  } catch (error) {
    if (!(error instanceof ReaderStop)) throw error;
    if (error.rememberMs !== null) state.stopped.set(origin.origin, { reason: error.message, until: now().getTime() + error.rememberMs });
    return { ok: false, reason: s.notes.length ? `${error.message} (${s.notes.join("; ")})` : error.message };
  }
}
