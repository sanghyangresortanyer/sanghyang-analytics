/**
 * Membaca isi berita kandidat yang tertunda (lib/market/news-relevance.ts readCandidateNews) dengan batas lebih besar
 * dari langkah berita malam, misalnya sesudah origin penerbit berita lama diisi (backfill-news-publishers.ts).
 * Pengaman tulis lib/db.ts menolak DB jarak jauh kecuali pemilik menjalankannya dengan ALLOW_PRODUCTION_WRITE=1.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/read-news-backlog.ts [--limit 200]
 */
import { db } from "@/lib/db";
import { readCandidateNews } from "@/lib/market/news-relevance";

async function main() {
  const at = process.argv.indexOf("--limit");
  const limit = at > 0 ? Number(process.argv[at + 1]) : 200;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`--limit harus bilangan bulat positif, bukan ${process.argv[at + 1]}`);
  const run = await readCandidateNews({ limit });
  console.log(`${run.candidates} berita kandidat, ${run.read} dinilai dari isinya.`, run.counts);
  for (const f of run.failures) console.log(`  - ${f}`);
  if (run.failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
