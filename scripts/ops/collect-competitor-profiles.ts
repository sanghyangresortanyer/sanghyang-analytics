/**
 * Kumpulkan fakta profil (operator, tipe kamar, fasilitas, lokasi, segmen) dari situs resmi outlet Sanghyang dan
 * pembanding aktif ke tabel CompetitorFact. Setiap fakta membawa kutipan dari halaman sumbernya; yang tidak terbukti
 * dibuang. Robots.txt dipatuhi dan perayap memperkenalkan diri apa adanya.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/collect-competitor-profiles.ts [--fokus outlet] [nama tempat ...]
 *
 * Tanpa nama, semua tempat diproses. Satu panggilan Gemini per halaman: hotel paling banyak 4 halaman, outlet 1 halaman.
 * `--fokus outlet` hanya membaca hotel dan memilih halaman restoran, bar, dan spa (untuk pesaing outlet di dalam hotel).
 */
import { db } from "@/lib/db";
import { generateWithRetry, model } from "@/lib/gemini";
import { buildFactPrompt, parseVerifiedFacts, saveFacts } from "@/lib/market/competitor-facts";
import { findPropertyIndexUrl, readLlmsProfile } from "@/lib/market/llms-profile";
import { isCrawlAllowed, isProfileSource, OUTLET_LINK, PROFILE_CRAWLER_UA, PROFILE_LINK, readOfficialPage } from "@/lib/market/official-pages";
import { OWN_OUTLETS } from "@/lib/market/outlet-ratings";

const MAX_SUBPAGES = 3;
/** Halaman dengan teks sependek ini tidak dikirim ke Gemini. */
const MIN_PAGE_TEXT = 200;

async function main() {
  const args = process.argv.slice(2);
  const outletFocus = args[0] === "--fokus" && args[1] === "outlet";
  const only = new Set(outletFocus ? args.slice(2) : args);
  const subpageLink = outletFocus ? OUTLET_LINK : PROFILE_LINK;
  const ownNames = new Set(OWN_OUTLETS.map((o) => o.competitorName));
  const rows = await db.competitor.findMany({
    where: { active: true },
    select: { id: true, name: true, category: true, websiteUrl: true, compsetRole: true },
    orderBy: { name: "asc" },
  });
  const targets = rows.filter(
    (r) =>
      (ownNames.has(r.name) || r.compsetRole !== null) &&
      (!outletFocus || r.category === "hotel" || r.category === "resort") &&
      (only.size === 0 || only.has(r.name)),
  );
  const report: string[] = [];
  let failures = 0;

  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"] });
  try {
    for (const t of targets) {
      if (!isProfileSource(t.websiteUrl)) {
        report.push(`${t.name}: belum ada situs resmi di registri, dilewati`);
        continue;
      }
      const lodging = t.category === "hotel" || t.category === "resort";
      if (lodging) {
        // Data resmi operator lewat llms.txt (tanpa LLM); halaman situs tetap dibaca sesudahnya.
        const indexUrl = await findPropertyIndexUrl(t.websiteUrl);
        if (indexUrl) {
          const facts = await readLlmsProfile(indexUrl);
          const bySource = new Map<string, typeof facts>();
          for (const f of facts) bySource.set(f.sourceUrl, [...(bySource.get(f.sourceUrl) ?? []), f]);
          let saved = 0;
          for (const [sourceUrl, list] of bySource) saved += await saveFacts(t.id, sourceUrl, list);
          report.push(`${t.name}: ${saved} fakta dari data resmi operator (${indexUrl})`);
        }
      }
      const page = await browser.newPage();
      await page.setUserAgent(PROFILE_CRAWLER_UA);
      try {
        const queue = [t.websiteUrl];
        const seen = new Set<string>();
        let pages = 0;
        let saved = 0;
        const rejected: string[] = [];
        while (queue.length && pages < (lodging ? 1 + MAX_SUBPAGES : 1)) {
          const url = queue.shift() as string;
          if (seen.has(url)) continue;
          seen.add(url);
          if (!(await isCrawlAllowed(url))) {
            report.push(`${t.name}: ${url} dilarang robots.txt`);
            continue;
          }
          const read = await readOfficialPage(page, url);
          seen.add(read.url);
          pages++;
          if (pages === 1 && lodging) {
            const sub = read.links.filter((l) => subpageLink.test(`${l.href} ${l.text}`)).map((l) => l.href);
            queue.push(...[...new Set(sub)].filter((h) => !seen.has(h)).slice(0, MAX_SUBPAGES));
          }
          if (read.text.length < MIN_PAGE_TEXT) continue;
          const res = await generateWithRetry({
            model: model(),
            contents: buildFactPrompt(t.name, read.url, read.text),
            config: { responseMimeType: "application/json", temperature: 0 },
          });
          const result = parseVerifiedFacts(res.text ?? "", read.text);
          rejected.push(...result.rejections.map((r) => `${r.key}: ${r.reason} [${r.quote}]`));
          saved += await saveFacts(t.id, read.url, result.facts);
        }
        report.push(
          `${t.name}: ${pages} halaman, ${saved} fakta tersimpan, ${rejected.length} ditolak verifikasi${rejected.length ? `:\n  - ${rejected.join("\n  - ")}` : ""}`,
        );
      } catch (error) {
        failures++;
        report.push(`${t.name}: gagal (${(error as Error).message.slice(0, 160)})`);
      } finally {
        await page.close().catch(() => undefined); // ZERO-FALLBACK: tab yang frame-nya putus tidak bisa ditutup; browser ditutup di bawah.
      }
    }
  } finally {
    await browser.close();
  }
  console.log(report.join("\n"));
  if (failures) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[profil-pesaing] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
