/**
 * Fakta restoran, bar, dan spa pesaing dari halaman resminya (halaman outlet di situs hotel induk atau berkas llms.txt
 * pengelola), diambil dengan fetch biasa tanpa peramban: identitas perayap jujur dan robots.txt dipatuhi. Gemini
 * merangkum dengan kutipan wajib; fakta yang kutipannya tidak ada di teks halaman dibuang (competitor-facts.ts).
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/collect-venue-profiles.ts [--apply] [--maks-gemini=N] [nama outlet ...]
 *
 * Satu panggilan Gemini per outlet; halaman yang dipakai beberapa outlet hanya diambil sekali. Tanpa --apply fakta hanya
 * dicetak (Gemini tetap dipanggil). --apply menyimpan ke DB kerja lokal (dijaga local-db-guard.ts).
 */
import { db } from "@/lib/db";
import { generateWithRetry } from "@/lib/gemini";
import { buildVenueFactPrompt, parseVerifiedFacts, saveFacts, textFromHtml } from "@/lib/market/competitor-facts";
import { isCrawlAllowed, isProfileSource, PROFILE_CRAWLER_UA } from "@/lib/market/official-pages";
import { assertLocalWorkDatabase } from "./local-db-guard";

/** Teks sependek ini biasanya kerangka halaman yang isinya dibuat JavaScript; tidak dikirim ke Gemini. */
const MIN_PAGE_TEXT = 200;
const VENUE_CATEGORIES = new Set(["resto", "bar", "spa"]);

function option(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function readPage(url: string): Promise<{ url: string; text: string }> {
  if (!(await isCrawlAllowed(url))) throw new Error(`robots.txt melarang ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": PROFILE_CRAWLER_UA, "Accept-Language": "id-ID,id;q=0.9,en;q=0.8" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${url}`);
  const body = await res.text();
  const type = res.headers.get("content-type") ?? "";
  // Berkas llms.txt pengelola hotel berupa Markdown; penanda tebal dan judul dibuang supaya kutipan Gemini cocok dengan teksnya.
  const text = /text\/(markdown|plain)/i.test(type) ? body.replace(/\*\*|__/g, "").replace(/^#{1,6}\s*/gm, "").trim() : textFromHtml(body);
  return { url: res.url, text };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const only = new Set(args.filter((a) => !a.startsWith("--")));
  const maxGemini = Number(option("maks-gemini") ?? Number.POSITIVE_INFINITY);
  if (apply) assertLocalWorkDatabase();
  const rows = await db.competitor.findMany({
    where: { active: true, compsetRole: { in: ["inti", "benchmark"] } },
    select: { id: true, name: true, category: true, websiteUrl: true, parent: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const targets = rows.filter((r) => VENUE_CATEGORIES.has(r.category ?? "") && (only.size === 0 || only.has(r.name)));
  const pages = new Map<string, Promise<{ url: string; text: string }>>();
  const report: string[] = [];
  let geminiCalls = 0;
  let failures = 0;
  for (const t of targets) {
    if (!isProfileSource(t.websiteUrl)) {
      report.push(`${t.name}: dilewati, registri tidak mencatat situs resmi (${t.websiteUrl ?? "kosong"})`);
      continue;
    }
    if (geminiCalls >= maxGemini) {
      report.push(`${t.name}: dilewati, batas ${maxGemini} panggilan Gemini tercapai`);
      continue;
    }
    try {
      if (!pages.has(t.websiteUrl)) pages.set(t.websiteUrl, readPage(t.websiteUrl));
      const page = await pages.get(t.websiteUrl)!;
      if (page.text.length < MIN_PAGE_TEXT) {
        report.push(`${t.name}: dilewati, teks halaman ${page.text.length} huruf (isi dibuat JavaScript?)`);
        continue;
      }
      geminiCalls++;
      const res = await generateWithRetry({
        contents: buildVenueFactPrompt(t.name, t.parent?.name ?? null, page.url, page.text),
        config: { responseMimeType: "application/json" },
      });
      const result = parseVerifiedFacts(res.text ?? "", page.text);
      const saved = apply ? await saveFacts(t.id, page.url, result.facts) : 0;
      report.push(
        `${t.name}: ${result.facts.length} fakta lolos${apply ? `, ${saved} tersimpan` : ""}, ${result.rejected} ditolak (${page.url})` +
          result.facts.map((f) => `\n  + ${f.key}: ${f.text}`).join("") +
          result.rejections.map((r) => `\n  - ${r.key}: ${r.reason} [${r.quote}]`).join(""),
      );
    } catch (error) {
      failures++;
      report.push(`${t.name}: gagal (${(error as Error).message.slice(0, 200)})`);
    }
  }
  console.log(report.join("\n"));
  console.log(`[profil-venue] ${targets.length} outlet, ${pages.size} halaman diambil, ${geminiCalls} panggilan Gemini.`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[profil-venue] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
