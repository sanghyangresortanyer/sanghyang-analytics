/**
 * Penemuan pesaing baru dari pencarian Google Maps sekitar Anyer–Carita (lib/market/competitor-discovery.ts). Tanpa
 * --apply hanya menampilkan kandidat beserta alasan layak atau tidak layak dan bukti sumbernya. Dengan --apply kandidat
 * yang layak ditambahkan ke registri sebagai pembanding inti yang perlu dicek pemilik; yang tidak layak hanya dicatat
 * di keluaran.
 *
 *   PUPPETEER_NO_SANDBOX=1 node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/discover-competitors.ts [--apply] [--maks=20] [--json=<berkas>]
 *
 * --maks: kartu paling banyak per pencarian. --json: simpan laporan lengkap (kartu, kecocokan registri, jarak) sebagai bukti.
 * Di mesin pengembang jalankan lewat .agents/scripts/resource_guard.py karena Chrome ikut berjalan.
 */
import { writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import {
  applyDiscoveredCompetitors,
  DEFAULT_RESULTS_PER_SEARCH,
  discoverCompetitors,
  type DiscoveryCandidate,
} from "@/lib/market/competitor-discovery";

const TAG = "[penemuan-pesaing]";

function option(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const num = (n: number) => n.toLocaleString("id-ID");

function describe(c: DiscoveryCandidate): string {
  const p = c.place;
  const kind = c.cls ? `${c.cls.category} (${p.googleType})` : (p.googleType ?? "jenis tidak terbaca");
  const stars = p.starRating ? `, bintang ${p.starRating}` : "";
  const rating = p.reviewCount === null ? "ulasan tidak terbaca" : `${p.rating === null ? "tanpa rating" : num(p.rating)} dari ${num(p.reviewCount)} ulasan`;
  const distance = c.road ? `${num(c.road.km)} km tempuh (OSRM), ${num(c.straightKm)} km garis lurus` : `${num(c.straightKm)} km garis lurus`;
  return `${p.name} | ${kind}${stars} | ${rating} | ${distance}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const maks = option("maks");
  const maxResultsPerSearch = maks === null ? DEFAULT_RESULTS_PER_SEARCH : Number(maks);
  if (!Number.isInteger(maxResultsPerSearch) || maxResultsPerSearch < 1) throw new Error(`--maks harus bilangan bulat positif, bukan "${maks}"`);

  const report = await discoverCompetitors({ maxResultsPerSearch, log: (line) => console.log(`${TAG} ${line}`) });
  const eligible = report.candidates.filter((c) => c.reason === null);
  const rejected = report.candidates.filter((c) => c.reason !== null);

  console.log(`\n${TAG} Titik awal jarak: ${report.origin.name} (${report.origin.lat}, ${report.origin.lng}).`);
  console.log(
    `${TAG} ${report.searches.length} pencarian, ${report.known.length + report.candidates.length} tempat unik: ${report.known.length} sudah di registri, ` +
      `${report.candidates.length} kandidat baru (${eligible.length} layak, ${rejected.length} tidak layak).`,
  );

  console.log(`\nLAYAK (${eligible.length}), ditulis sebagai pembanding inti hanya dengan --apply:`);
  for (const c of eligible) {
    console.log(`+ ${describe(c)} -> ${c.cls?.outlets.join(", ")}`);
    console.log(`  alamat: ${c.place.address ?? "tidak tampil"} | pencarian: ${c.place.foundBy.join("; ")}`);
    console.log(`  bukti: ${c.place.mapsUrl}`);
    if (c.nearLodging) console.log(`  catatan: ${num(c.nearLodging.meters)} m dari ${c.nearLodging.name}; bisa jadi outlet di dalam hotel itu.`);
  }

  console.log(`\nTIDAK LAYAK (${rejected.length}), hanya dicatat:`);
  for (const c of [...rejected].sort((a, b) => a.straightKm - b.straightKm)) {
    const near = c.nearLodging ? ` (${num(c.nearLodging.meters)} m dari ${c.nearLodging.name})` : "";
    console.log(`- ${describe(c)}: ${c.reason}${near}`);
  }

  console.log(`\nSUDAH DI REGISTRI (${report.known.length}):`);
  for (const k of report.known) {
    const status = k.match.entry.active ? (k.match.entry.compsetRole ?? "tanpa peran") : "diarsipkan";
    console.log(`= ${k.place.name} -> ${k.match.entry.name} (${k.match.by}; ${status})`);
  }

  if (report.failures.length) {
    console.log(`\nGALAT (${report.failures.length}):`);
    for (const f of report.failures) console.log(`! ${f}`);
  }

  const jsonPath = option("json");
  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 1)}\n`);
    console.log(`\n${TAG} Laporan lengkap disimpan di ${jsonPath}.`);
  }

  if (apply) {
    const added = await applyDiscoveredCompetitors(report);
    console.log(`\n${TAG} ${added.length} pembanding inti ditambahkan ke registri: ${added.join(", ") || "-"}.`);
  } else {
    console.log(`\n${TAG} Uji kering; tidak ada yang ditulis. Jalankan dengan --apply untuk menambahkan kandidat layak.`);
  }
  if (report.failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`${TAG} gagal:`, (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
