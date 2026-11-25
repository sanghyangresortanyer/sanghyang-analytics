/**
 * Pembaca halaman situs resmi tempat (hotel, resto, spa) untuk pengumpul fakta profil. Identitas perayap jujur,
 * robots.txt dipatuhi, dan halaman dianggap siap saat teksnya tampil (bukan "networkidle2" yang di situs berat sering
 * tidak pernah selesai dan menjadi sebab timeout).
 */
import type { Page } from "puppeteer";
import type { PageImage } from "./venue-photos";

export const PROFILE_CRAWLER_UA = "SanghyangNewsCrawler/1.0 (profil pesaing untuk riset pasar internal; sumber dicantumkan)";
const UA_TOKEN = "sanghyangnewscrawler";
const GOTO_TIMEOUT_MS = 45_000;
const TEXT_TIMEOUT_MS = 20_000;
/** Teks sependek ini biasanya masih kerangka halaman; ditunggu sampai isinya tampil. */
const MIN_TEXT_CHARS = 400;
const MAX_TEXT_CHARS = 12_000;
const IMAGES_TIMEOUT_MS = 20_000;
/** Gambar sekecil ini biasanya ikon, logo, atau gambar mini, bukan foto tempat. */
const MIN_PHOTO_WIDTH = 400;
const MIN_PHOTO_HEIGHT = 250;

/** Halaman yang biasanya memuat fakta profil: kamar, fasilitas, ruang rapat, restoran, spa, atau tentang kami. */
export const PROFILE_LINK = /room|kamar|accommodation|akomodasi|suite|villa|facilit|fasilitas|meeting|mice|event|wedding|ballroom|dining|restaurant|restoran|spa|about|tentang|overview/i;
/** Halaman restoran, bar, dan spa hotel; dipakai mode --fokus outlet untuk mencari outlet pesaing di dalam hotel. */
export const OUTLET_LINK = /dining|restaurant|restoran|resto\b|kuliner|culinary|food|eat|bar\b|lounge|beach-club|f-b|f&b|spa\b|wellness|massage|pijat/i;

/** Situs yang layak dibaca sebagai sumber resmi; Instagram, Linktree, dan Google Maps bukan situs tempat itu. */
export const isProfileSource = (url: string | null | undefined): url is string =>
  Boolean(url) && URL.canParse(url as string) && !/instagram\.com|linktr\.ee|google\.[a-z.]+\/maps|maps\.google|google\.com\/maps/i.test(url as string);

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

const robotsCache = new Map<string, RobotsRules>();

/** Aturan robots.txt untuk perayap kita (grup khusus bila ada, selain itu grup "*"). 404 berarti tidak ada larangan. */
export function parseRobots(text: string): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { disallow: [], allow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow" && value) current.rules.disallow.push(value);
    if (field === "allow" && value) current.rules.allow.push(value);
  }
  const own = groups.find((g) => g.agents.some((a) => a !== "*" && UA_TOKEN.includes(a)));
  return (own ?? groups.find((g) => g.agents.includes("*")))?.rules ?? { disallow: [], allow: [] };
}

/**
 * Cocokkan path dengan satu aturan robots.txt (`*` = apa saja, `$` di akhir = path harus berakhir di situ) tanpa
 * membangun regex dari teks situs luar, supaya aturan yang aneh tidak bisa memicu backtracking berlebihan.
 */
export function robotsRuleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const parts = (anchored ? rule.slice(0, -1) : rule).split("*");
  if (!path.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (anchored && i === parts.length - 1) return path.endsWith(part) && path.length - part.length >= pos;
    const found = path.indexOf(part, pos);
    if (found < 0) return false;
    pos = found + part.length;
  }
  return anchored ? pos === path.length : true;
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) => Math.max(-1, ...list.filter((r) => robotsRuleMatches(r, path)).map((r) => r.length));
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  return disallow < 0 || allow >= disallow;
}

/**
 * Aturan menurut status jawaban robots.txt (RFC 9309 bagian 2.3.1): 2xx dibaca isinya, 4xx berarti tidak ada larangan,
 * dan 5xx atau status lain berarti larangan penuh, karena server yang bermasalah tidak boleh dibaca sebagai izin.
 */
export function robotsRulesForStatus(status: number, text: string): RobotsRules {
  if (status >= 200 && status < 300) return parseRobots(text);
  if (status >= 400 && status < 500) return { disallow: [], allow: [] };
  return { disallow: ["/"], allow: [] };
}

/** true bila robots.txt situs mengizinkan URL ini. Galat jaringan saat membaca robots.txt dilempar (tidak dianggap izin). */
export async function isCrawlAllowed(url: string): Promise<boolean> {
  const { origin, pathname, search } = new URL(url);
  let rules = robotsCache.get(origin);
  if (!rules) {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": PROFILE_CRAWLER_UA }, redirect: "follow" });
    rules = robotsRulesForStatus(res.status, res.ok ? await res.text() : "");
    robotsCache.set(origin, rules);
  }
  return robotsAllows(rules, `${pathname}${search}`);
}

/** Buka halaman lalu tunggu teksnya tampil; kembalikan teks berspasi rapat dan tautan dalam situs yang sama. */
/**
 * `keepLines` mempertahankan baris baru (daftar isi paket di halaman penawaran tetap per butir), dan `maxChars` menaikkan
 * batas teks untuk halaman yang memuat banyak penawaran berurutan.
 */
export async function readOfficialPage(
  page: Page,
  url: string,
  options: { maxChars?: number; keepLines?: boolean } = {},
): Promise<{ url: string; text: string; links: { href: string; text: string }[] }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT_MS });
  await page
    .waitForFunction((min: number) => document.body !== null && document.body.innerText.length > min, { timeout: TEXT_TIMEOUT_MS }, MIN_TEXT_CHARS)
    // ZERO-FALLBACK: halaman yang memang pendek tetap dibaca; fakta yang tidak tertulis tidak akan lolos verifikasi kutipan.
    .catch(() => undefined);
  const finalUrl = page.url();
  const raw = await page.evaluate(() => (document.body ? document.body.innerText : ""));
  const squeezed = options.keepLines ? raw.replace(/[^\S\n]+/g, " ").replace(/ ?\n\s*/g, "\n") : raw.replace(/\s+/g, " ");
  const text = squeezed.trim().slice(0, options.maxChars ?? MAX_TEXT_CHARS);
  const host = new URL(finalUrl).hostname;
  const links = (await page.$$eval("a[href]", (as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a as HTMLElement).innerText || "" }))))
    .filter((l) => URL.canParse(l.href) && new URL(l.href).hostname === host && !/\.(pdf|jpe?g|png|webp|zip)$/i.test(l.href))
    .map((l) => ({ href: l.href.split("#")[0], text: l.text.replace(/\s+/g, " ").trim() }));
  return { url: finalUrl, text, links };
}

/**
 * Foto besar di halaman yang sudah dibuka readOfficialPage, beserta alt dan teks bagian pembungkusnya, ditambah og:image.
 * Halaman digulir per layar supaya gambar lazy ikut dimuat, lalu ditunggu sampai semua gambar selesai dimuat.
 */
export async function collectPageImages(page: Page): Promise<PageImage[]> {
  // Fungsi di dalam page.evaluate tidak boleh diberi nama: tsx membungkusnya dengan helper __name yang tidak ada di peramban.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), { timeout: IMAGES_TIMEOUT_MS })
    // ZERO-FALLBACK: satu gambar yang macet tidak menahan foto lain; gambar yang belum dimuat lebarnya 0 dan tersaring di bawah.
    .catch(() => undefined);
  const pageUrl = page.url();
  const found = await page.evaluate(
    (minWidth: number, minHeight: number) => {
      const og = Array.from(document.querySelectorAll('meta[property="og:image"]')).map((m) => ({
        url: (m as HTMLMetaElement).content,
        alt: "",
        context: document.title,
        og: true,
      }));
      const photos = Array.from(document.images)
        .filter((img) => img.naturalWidth >= minWidth && img.naturalHeight >= minHeight)
        .map((img) => {
          // Teks bagian terdekat yang membungkus foto, biasanya diawali judul bagiannya.
          let context = "";
          for (let node = img.parentElement, depth = 0; node && depth < 6 && !context; depth++, node = node.parentElement) {
            const text = (node.innerText || "").replace(/\s+/g, " ").trim();
            if (text.length >= 20) context = text.slice(0, 200);
          }
          return { url: img.currentSrc || img.src, alt: img.alt || "", context, og: false };
        });
      return [...og, ...photos];
    },
    MIN_PHOTO_WIDTH,
    MIN_PHOTO_HEIGHT,
  );
  return found
    .filter((i) => URL.canParse(i.url) && new URL(i.url).protocol === "https:" && !/logo|icon|avatar|sprite|badge|flag/i.test(i.url))
    .map((i) => ({ ...i, pageUrl }));
}
