/**
 * Audit kompetitor holistik 6 dimensi untuk seluruh 6 outlet Sanghyang di basis data lokal.
 *
 * Memakai jalur yang sama dengan langkah refresh `klasifikasi_kompetitor` (src/lib/market/full-refresh.ts): seluruh baris
 * daftar kompetitor dinilai ulang dari data bersumber (src/lib/market/compset-audit.ts -> loadHolisticRegistry), keputusan
 * pemakai/pemilik yang tercatat dihormati, dan baris tidak pernah dihapus.
 *
 * Tanpa `--apply` hanya uji kering. `--apply` menulis dengan OCC (`version: { increment: 1 }`) hanya ke DB kerja lokal
 * `127.0.0.1:55432/sanghyang_analytics` (ADR-001/ADR-014), lalu menghapus cache narasi basi `kg-narrative:*`.
 *
 *   node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/audit-holistic-compset.ts [--apply] [--alasan]
 */
import { db } from "@/lib/db";
import { HOLISTIC_SCORE_THRESHOLDS, outletLabel, type RegistryDecision } from "@/lib/market/competitor-holistic-matcher";
import { invalidateStaleNarrativeCache, syncHolisticCompetitorClassification } from "@/lib/market/full-refresh";
import { OUTLET_KEYS } from "@/lib/market/outlet-filters";

const LOCAL_DB = { hosts: new Set(["127.0.0.1", "localhost"]), port: "55432", path: "/sanghyang_analytics" };

export function assertLocalAuditDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (LOCAL_DB.hosts.has(url.hostname) && url.port === LOCAL_DB.port && url.pathname === LOCAL_DB.path) return;
  throw new Error(
    `Tulis ditolak: DATABASE_URL bukan DB kerja lokal (127.0.0.1:${LOCAL_DB.port}${LOCAL_DB.path}). Audit holistik ini khusus lokal.`,
  );
}

const stateText = (s: RegistryDecision["before"]) =>
  `${s.active ? "aktif" : "arsip"}/${s.compsetRole ?? "-"}/[${s.outlets.join(",")}]`;

function printDecisions(decisions: RegistryDecision[], withReasons: boolean) {
  console.log("\n=== PERUBAHAN KLASIFIKASI ===");
  const changed = decisions.filter((d) => d.changed);
  if (changed.length === 0) console.log("(tidak ada perubahan)");
  for (const d of changed) {
    const lock = d.protectedBy ? ` | keputusan dihormati untuk ${d.protectedBy.scope === "semua" ? "seluruh baris" : d.protectedBy.scope.map(outletLabel).join(", ")}` : "";
    const reason = d.after.active ? "" : ` | alasan: ${d.after.retiredReason}`;
    console.log(`[${d.after.active ? (d.after.compsetRole === "inti" ? "INTI" : "ACUAN") : "ARSIP"}] ${d.name} (skor ${d.bestScore}/100): ${stateText(d.before)} -> ${stateText(d.after)}${lock}${reason}`);
  }

  console.log("\n=== DAFTAR KOMPETITOR PER OUTLET (setelah penilaian) ===");
  for (const outlet of OUTLET_KEYS) {
    const list = decisions
      .filter((d) => d.after.active && d.after.outlets.includes(outlet))
      .sort((a, b) => b.scoresByOutlet[outlet].score - a.scoresByOutlet[outlet].score);
    const core = list.filter((d) => d.after.compsetRole === "inti").length;
    console.log(`\n[${outlet}] inti ${core} + acuan ${list.length - core}:`);
    for (const d of list) {
      const s = d.scoresByOutlet[outlet];
      const dm = s.dimensions;
      const engine = s.decision === "arsip" ? "mesin: arsip" : `mesin: ${s.decision === "inti" ? "inti" : "acuan"}`;
      const lock = d.protectedBy && (d.protectedBy.scope === "semua" || d.protectedBy.scope.includes(outlet)) ? `, keputusan pemakai (${engine})` : "";
      console.log(
        `  - ${d.name.padEnd(40)} | ${String(d.after.compsetRole).padEnd(9)} | skor ${String(s.score).padStart(3)}/100 (jarak:${dm.distance.score} konsep:${dm.concept.score} produk:${dm.product.score} fas:${dm.facilities.score} rep:${dm.reputation.score} harga:${dm.priceParity.score})${lock}`,
      );
      if (withReasons) for (const dim of Object.values(dm)) console.log(`      · ${dim.label} (${Math.round(dim.weight * 100)}%): ${dim.reason}`);
    }
  }

  const archivedNear = decisions.filter(
    (d) => d.protectedBy && !d.after.active && OUTLET_KEYS.some((o) => d.scoresByOutlet[o].recommendedRole !== null),
  );
  if (archivedNear.length) {
    console.log(`\n=== MESIN MENILAI COCOK (skor >= ${HOLISTIC_SCORE_THRESHOLDS.benchmark}), TETAPI ARSIP KARENA KEPUTUSAN PEMAKAI/PEMILIK ===`);
    for (const d of archivedNear) {
      const best = OUTLET_KEYS.map((o) => d.scoresByOutlet[o]).sort((a, b) => b.score - a.score)[0];
      console.log(`  - ${d.name}: ${outletLabel(best.outlet)} ${best.score}/100 | ${d.after.retiredReason}`);
    }
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const withReasons = process.argv.includes("--alasan");
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL belum diatur");
  if (apply) assertLocalAuditDatabase(databaseUrl);

  const result = await syncHolisticCompetitorClassification({ apply });
  if (result.skippedReason) throw new Error(result.skippedReason);
  printDecisions(result.decisions, withReasons);

  if (apply && result.changed > 0) {
    console.log(`\n[audit-holistik] Cache narasi kg-narrative:* dibersihkan: ${await invalidateStaleNarrativeCache()} baris.`);
  }
  for (const failure of result.failures) console.error(`[audit-holistik] kendala: ${failure}`);
  console.log(
    `\n[audit-holistik] Selesai: ${result.evaluated} baris dinilai ulang (inti ${result.roles.inti}, acuan ${result.roles.acuan}, arsip ${result.roles.arsip}); berubah=${result.changed}, keputusan pemakai/pemilik=${result.protectedRows}${apply ? " (ditulis ke DB lokal)" : " (uji kering; jalankan dengan --apply untuk menulis ke DB lokal)"}.`,
  );
  if (result.failures.length) process.exitCode = 1;
}

if (/audit-holistic-compset\.ts$/.test(process.argv[1] ?? "")) {
  main()
    .catch((error) => {
      console.error("[audit-holistik] gagal:", (error as Error).message);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
