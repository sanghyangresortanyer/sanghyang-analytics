/**
 * Origin situs penerbit untuk berita kandidat yang tersimpan sebelum 18 Nov 2026, ketika RSS Google News belum
 * menyimpan atribut <source url>. Urutannya:
 * 1. Peta nama penerbit -> origin dari berita yang sudah punya origin di DB, ditambah berkas peta `--map <berkas.json>`
 *    yang dibaca dari atribut <source url> RSS Google News (berkasnya mencatat sumber dan tanggal bacanya).
 * 2. `--rss`: berita yang penerbitnya belum ada di peta dicari judul persisnya di RSS Google News pada tanggal terbitnya
 *    (jalur yang sama dengan job berita malam). Jawaban 429 menghentikan pencarian; Google sedang membatasi permintaan.
 * Pembacaan isinya dilakukan readCandidateNews (lib/market/news-relevance.ts).
 *
 * Di produksi kolom ini terisi sendiri oleh job berita sejak rilis ini; berita lama hanya diisi bila pemilik menjalankan
 * skrip ini dengan ALLOW_PRODUCTION_WRITE=1 (pengaman tulis di lib/db.ts menolak DB jarak jauh tanpa itu).
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/backfill-news-publishers.ts [--map berkas.json] [--rss] [--dry-run]
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "@/lib/db";
import { fetchQuery, nextDay } from "@/lib/googlenews";
import { cleanTitleForDedupe, isMarketRelevant } from "@/lib/market/classifier";
import { splitNewsTitle } from "@/lib/market/news-relevance";
import { wibDay } from "@/lib/market/date-range";

const CANDIDATE_DAYS = 120;
/** Jeda antar permintaan RSS, sama sopannya dengan pencarian berita malam (lib/googlenews.ts). */
const PAUSE_MS = 300;
const DAY_MS = 86_400_000;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const since = new Date(Date.now() - CANDIDATE_DAYS * DAY_MS);
  const rows = await db.marketItem.findMany({
    where: { article: { canonicalUrl: { startsWith: "https://news.google.com/" }, publisherUrl: null, publishedAt: { gte: since } } },
    select: { description: true, article: { select: { id: true, title: true, publishedAt: true, version: true } } },
    orderBy: { article: { publishedAt: "desc" } },
  });
  const candidates = rows.filter((r) => isMarketRelevant({ title: r.article.title, text: (r.description ?? "").replace(/<[^>]+>/g, " ") }));
  console.log(`${candidates.length} berita kandidat tanpa origin penerbit (dari ${rows.length} item Google News ${CANDIDATE_DAYS} hari terakhir).`);

  // 1. Peta nama penerbit -> origin: berita yang sudah punya origin, lalu berkas peta (yang dari DB didahulukan).
  const known = await db.article.findMany({
    where: { canonicalUrl: { startsWith: "https://news.google.com/" }, publisherUrl: { not: null } },
    select: { title: true, publisherUrl: true },
  });
  const votes = new Map<string, Map<string, number>>();
  for (const k of known) {
    const name = splitNewsTitle(k.title).publisher;
    if (!name || !k.publisherUrl) continue;
    const byOrigin = votes.get(name) ?? new Map<string, number>();
    byOrigin.set(k.publisherUrl, (byOrigin.get(k.publisherUrl) ?? 0) + 1);
    votes.set(name, byOrigin);
  }
  const map = new Map([...votes].map(([name, byOrigin]) => [name, [...byOrigin].sort((a, b) => b[1] - a[1])[0][0]]));
  const mapArg = process.argv.indexOf("--map");
  if (mapArg > 0) {
    const file = JSON.parse(readFileSync(process.argv[mapArg + 1], "utf8")) as { _sumber: string; peta: Record<string, string> };
    console.log(`Berkas peta: ${file._sumber}`);
    for (const [name, origin] of Object.entries(file.peta)) if (!map.has(name)) map.set(name, origin);
  }
  console.log(`Peta penerbit: ${map.size} nama.`);

  let mapped = 0;
  const unmapped: typeof candidates = [];
  for (const c of candidates) {
    const origin = map.get(splitNewsTitle(c.article.title).publisher ?? "");
    if (!origin) {
      unmapped.push(c);
      continue;
    }
    mapped++;
    if (dryRun) continue;
    const res = await db.article.updateMany({ where: { id: c.article.id, version: c.article.version }, data: { publisherUrl: origin, version: { increment: 1 } } });
    if (res.count !== 1) throw new Error(`konflik versi saat mengisi origin penerbit "${c.article.title}"`);
  }
  console.log(`Dari peta: ${mapped} berita terisi; ${unmapped.length} penerbitnya belum ada di peta.`);

  // 2. Pencarian judul per berita di RSS Google News, hanya bila diminta.
  if (!process.argv.includes("--rss")) return;
  let found = 0;
  const missing: string[] = [];
  for (const { article } of unmapped) {
    const day = wibDay(article.publishedAt ?? new Date());
    const before = new Date(Date.parse(`${day}T00:00:00Z`) - 2 * DAY_MS).toISOString().slice(0, 10);
    let items: Awaited<ReturnType<typeof fetchQuery>>;
    try {
      items = await fetchQuery(`"${splitNewsTitle(article.title).title}"`, before, nextDay(nextDay(day)));
    } catch (error) {
      if (/HTTP 429/.test((error as Error).message)) {
        console.log("Google News menjawab 429 (permintaan dibatasi); pencarian dihentikan, sisanya dicoba lain waktu.");
        break;
      }
      throw error;
    }
    const key = cleanTitleForDedupe(article.title);
    const match = items.find((it) => cleanTitleForDedupe(it.title) === key && it.sourceUrl);
    if (!match) {
      missing.push(article.title);
    } else {
      found++;
      if (!dryRun) {
        const res = await db.article.updateMany({ where: { id: article.id, version: article.version }, data: { publisherUrl: match.sourceUrl, version: { increment: 1 } } });
        if (res.count !== 1) throw new Error(`konflik versi saat mengisi origin penerbit "${article.title}"`);
      }
    }
    await sleep(PAUSE_MS);
  }
  console.log(`Dari RSS: origin ditemukan untuk ${found} berita; ${missing.length} tidak ditemukan.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
