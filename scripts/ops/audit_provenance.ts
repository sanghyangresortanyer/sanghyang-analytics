/**
 * scripts/audit_provenance.ts
 *
 * Audit Provenans Data & Zero Mock (Temuan D2).
 * Memverifikasi bahwa setiap metrik pasar, omset, tarif, dan perbandingan
 * bersumber secara sah dari salah satu 3 kategori:
 * 1. OBSERVATION: Hasil observasi riil (URL sumber & tanggal pengamatan jelas).
 * 2. OWNER_INPUT: Input pembukuan resmi pemilik (database OutletMonthlyRevenue).
 * 3. DOCUMENTED_FORMULA: Rumus industri terdokumentasi (misal BPS Banten TPK Hotel Berbintang).
 * Atau berlabel eksplisit "NO_DATA" / null / "Belum ada data".
 *
 * Skrip ini memastikan 0 metrik tanpa sumber (unsourced metrics).
 */

import { OUTLET_MARKET_SHARE_DATA, ALL_OUTLETS_MARKET_SHARE_DATA } from "@/lib/market/pricing-benchmark";
import { OUTLET_HEAD_TO_HEAD_COMPARISONS } from "@/lib/market/competitor-comparison";
import fs from "node:fs";
import path from "node:path";

interface MetricAuditResult {
  entity: string;
  metric: string;
  value: unknown;
  provenance: "OBSERVATION" | "OWNER_INPUT" | "DOCUMENTED_FORMULA" | "NO_DATA";
  sourceDetail: string;
  valid: boolean;
  issue?: string;
}

const auditLog: MetricAuditResult[] = [];
let unsourcedCount = 0;

function recordMetric(
  entity: string,
  metric: string,
  value: unknown,
  provenance: MetricAuditResult["provenance"],
  sourceDetail: string,
  valid: boolean,
  issue?: string
) {
  if (!valid) {
    unsourcedCount++;
  }
  auditLog.push({
    entity,
    metric,
    value,
    provenance,
    sourceDetail,
    valid,
    issue,
  });
}

console.log("=================================================================");
console.log("  AUDIT PROVENANS DATA & ZERO MOCK (SANGHYANG INTELLIGENCE D2)");
console.log("=================================================================\n");

// 1. Audit Metrik Outlet Market Share Data
console.log("--- 1. Audit Metrik Pangsa Pasar Outlet (pricing-benchmark.ts) ---");
const allOutlets = [...Object.values(OUTLET_MARKET_SHARE_DATA), ALL_OUTLETS_MARKET_SHARE_DATA];

for (const outlet of allOutlets) {
  const isResortOrAll = outlet.outletKey === "resort" || outlet.outletKey === "all";

  // A. Omset Aktual (revenueActual)
  if (outlet.revenueActual === null) {
    recordMetric(
      outlet.outletName,
      "revenueActual",
      null,
      "NO_DATA",
      "Wajib dimuat dinamis dari DB OutletMonthlyRevenue (impor pemilik). Nilai null di kode sumber = Zero Hardcode.",
      true
    );
  } else {
    // Di kode sumber statis, angka omset tidak boleh ditanam
    recordMetric(
      outlet.outletName,
      "revenueActual",
      outlet.revenueActual,
      "OWNER_INPUT",
      "Angka omset tertanam di kode sumber",
      false,
      "Angka omset tidak boleh ditanam di kode sumber; harus dimuat dari DB."
    );
  }

  // B. Total Market Size (TAM)
  if (isResortOrAll) {
    if (outlet.totalMarketSizeEstimated !== null && outlet.totalMarketSizeEstimated > 0) {
      recordMetric(
        outlet.outletName,
        "totalMarketSizeEstimated",
        outlet.totalMarketSizeEstimated,
        "DOCUMENTED_FORMULA",
        "Dihitung dari rumus compset kamar: roomCount x 30 x TPK BPS Banten (rilis BPS di MarketMacroStat) x ADR OTA.",
        true
      );
    } else {
      recordMetric(
        outlet.outletName,
        "totalMarketSizeEstimated",
        outlet.totalMarketSizeEstimated,
        "NO_DATA",
        "Belum ada data",
        true
      );
    }
  } else {
    if (outlet.totalMarketSizeEstimated === null) {
      recordMetric(
        outlet.outletName,
        "totalMarketSizeEstimated",
        null,
        "NO_DATA",
        "Non-resort outlet tidak mengarang TAM tiruan. Menampilkan null / Belum ada data.",
        true
      );
    } else {
      recordMetric(
        outlet.outletName,
        "totalMarketSizeEstimated",
        outlet.totalMarketSizeEstimated,
        "DOCUMENTED_FORMULA",
        "Non-hotel TAM tanpa metodologi BPS resmi",
        false,
        "TAM non-resort tidak memiliki metodologi resmi dan tidak boleh berupa tebakan statis."
      );
    }
  }

  // C. Market Rank
  if (outlet.marketRank.startsWith("Belum ada data") || (isResortOrAll && outlet.marketRank.includes("Bintang 4"))) {
    recordMetric(
      outlet.outletName,
      "marketRank",
      outlet.marketRank,
      outlet.marketRank.startsWith("Belum ada data") ? "NO_DATA" : "DOCUMENTED_FORMULA",
      "Peringkat resmi berbasis compset atau Belum ada data",
      true
    );
  } else {
    recordMetric(
      outlet.outletName,
      "marketRank",
      outlet.marketRank,
      "NO_DATA",
      "Peringkat fiktif tanpa dasar",
      false,
      `Peringkat fiktif terdeteksi: "${outlet.marketRank}".`
    );
  }

  // D. Kompetitor Benchmark Per Outlet
  for (const comp of outlet.benchmarkCompetitors) {
    // Estimasi omset kompetitor
    if (isResortOrAll) {
      if (comp.estimatedRevenue !== null && comp.estimatedRevenue !== undefined) {
        recordMetric(
          `${outlet.outletKey} -> ${comp.name}`,
          "estimatedRevenue",
          comp.estimatedRevenue,
          "DOCUMENTED_FORMULA",
          "Kamar x 30 x TPK BPS Banten x ADR",
          true
        );
      } else {
        recordMetric(
          `${outlet.outletKey} -> ${comp.name}`,
          "estimatedRevenue",
          null,
          "NO_DATA",
          "Belum ada data observasi tarif",
          true
        );
      }
    } else {
      if (comp.estimatedRevenue === null || comp.estimatedRevenue === undefined) {
        recordMetric(
          `${outlet.outletKey} -> ${comp.name}`,
          "estimatedRevenue",
          null,
          "NO_DATA",
          "Zero Mock: Omset kompetitor non-hotel tidak ditebak",
          true
        );
      } else {
        recordMetric(
          `${outlet.outletKey} -> ${comp.name}`,
          "estimatedRevenue",
          comp.estimatedRevenue,
          "DOCUMENTED_FORMULA",
          "Estimasi tanpa sumber",
          false,
          "Omset kompetitor non-hotel tidak boleh ditebak."
        );
      }
    }

    // Skor relevansi palsu
    if (comp.relevanceScore === null || comp.relevanceScore === undefined) {
      recordMetric(
        `${outlet.outletKey} -> ${comp.name}`,
        "relevanceScore",
        null,
        "NO_DATA",
        "Skor relevansi palsu telah dihapus",
        true
      );
    } else {
      recordMetric(
        `${outlet.outletKey} -> ${comp.name}`,
        "relevanceScore",
        comp.relevanceScore,
        "NO_DATA",
        "Skor relevansi statis tertanam",
        false,
        "Skor relevansi palsu tidak boleh ditanam di kode."
      );
    }

    // URL Sumber Bukti
    if (comp.evidenceSourceUrl) {
      const isValidUrl = comp.evidenceSourceUrl.startsWith("http://") || comp.evidenceSourceUrl.startsWith("https://");
      recordMetric(
        `${outlet.outletKey} -> ${comp.name}`,
        "evidenceSourceUrl",
        comp.evidenceSourceUrl,
        "OBSERVATION",
        "Tautan observasi web/maps resmi kompetitor",
        isValidUrl,
        isValidUrl ? undefined : "URL observasi tidak valid"
      );
    }
  }
}

// 2. Audit Head to Head Comparisons
console.log("--- 2. Audit Head-to-Head Comparisons (competitor-comparison.ts) ---");
for (const comp of OUTLET_HEAD_TO_HEAD_COMPARISONS) {
  // Verifikasi ketiadaan skor relevansi karangan
  if (comp.relevanceScore === null || comp.relevanceScore === undefined) {
    recordMetric(
      `Komparasi: ${comp.outletName} vs ${comp.competitorName}`,
      "relevanceScore",
      null,
      "NO_DATA",
      "Skor relevansi buatan dihapus",
      true
    );
  } else {
    recordMetric(
      `Komparasi: ${comp.outletName} vs ${comp.competitorName}`,
      "relevanceScore",
      comp.relevanceScore,
      "NO_DATA",
      "Skor relevansi tertanam",
      false,
      "Skor relevansi buatan tidak boleh ada."
    );
  }

  // Verifikasi URL Sumber Bukti
  if (comp.evidenceSourceUrl) {
    const isValidUrl = comp.evidenceSourceUrl.startsWith("http://") || comp.evidenceSourceUrl.startsWith("https://");
    recordMetric(
      `Komparasi: ${comp.outletName} vs ${comp.competitorName}`,
      "evidenceSourceUrl",
      comp.evidenceSourceUrl,
      "OBSERVATION",
      "Tautan bukti verifikasi resmi",
      isValidUrl,
      isValidUrl ? undefined : "URL bukti tidak valid"
    );
  } else {
    recordMetric(
      `Komparasi: ${comp.outletName} vs ${comp.competitorName}`,
      "evidenceSourceUrl",
      null,
      "NO_DATA",
      "Tautan bukti verifikasi tidak tersedia",
      false,
      "Setiap komparasi head-to-head wajib memiliki evidenceSourceUrl terverifikasi."
    );
  }

  // Verifikasi ketiadaan klaim audit karangan
  if (!comp.auditRationale || !comp.auditRationale.includes("Lolos 5 kriteria Master Prompt")) {
    recordMetric(
      `Komparasi: ${comp.outletName} vs ${comp.competitorName}`,
      "auditRationale",
      comp.auditRationale ?? "none",
      "OBSERVATION",
      "Bebas klaim audit fiktif",
      true
    );
  } else {
    recordMetric(
      `Komparasi: ${comp.outletName} vs ${comp.competitorName}`,
      "auditRationale",
      comp.auditRationale,
      "NO_DATA",
      "Klaim audit karangan",
      false,
      "Klaim 'Lolos 5 kriteria Master Prompt' adalah teks karangan."
    );
  }
}

// 3. Scan Kode Sumber untuk Hardcoded Omset
console.log("--- 3. Audit Kode Sumber Bebas Nilai Omset Tertanam ---");
const forbiddenPatterns = [
  { name: "RESORT_REVENUE_ACTUAL = 262410000", regex: /262410000/ },
  { name: "Sunset Grill Omset = 101800000", regex: /101800000/ },
  { name: "Dragon Beach Club Omset = 210000000", regex: /210000000/ },
  { name: "DBistro Omset = 44454500", regex: /44454500/ },
  { name: "DBar Omset = 21000000", regex: /\b21000000\b/ },
  { name: "DSpa Omset = 16390000", regex: /16390000/ },
  { name: "SEPTEMBER_2026_BASELINE hardcode", regex: /SEPTEMBER_2026_BASELINE/ },
  { name: "Simpan Cepat Baseline September UI", regex: /Simpan Cepat Baseline September/ },
];

// Angka omset bisa ditulis dengan pemisah ribuan (262_410_000), jadi pemisah dibuang dulu sebelum dicocokkan, dan
// setiap berkas kode aplikasi dipindai, bukan daftar berkas tetap. Pola umum menangkap nilai omset baru yang belum dikenal.
forbiddenPatterns.push({ name: "Nilai omset tertanam (kunci revenue/omset ≥ 7 digit)", regex: /(revenue|omset)\w*["']?\s*[:=]\s*\d{7,}/i });

function sourceFiles(dir: string): string[] {
  const full = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

const scannedFiles = ["src"].flatMap(sourceFiles);
const violations: string[] = [];
for (const relPath of scannedFiles) {
  const content = fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8").replace(/(\d)_(?=\d)/g, "$1");
  for (const pattern of forbiddenPatterns) {
    if (pattern.regex.test(content)) {
      violations.push(relPath);
      recordMetric(
        relPath,
        pattern.name,
        "Ditemukan di berkas",
        "NO_DATA",
        "Pelanggaran Zero Hardcode / Zero Mock",
        false,
        `Pola terlarang "${pattern.name}" masih ditemukan di ${relPath}`
      );
    }
  }
}
// Satu baris ringkas untuk pemindaian: berkas yang bersih tidak dihitung sebagai "metrik lulus".
console.log(`Pemindaian omset tertanam: ${scannedFiles.length} berkas, ${violations.length} pelanggaran.`);

// Ringkasan Hasil
console.log("\n=================================================================");
console.log("  RINGKASAN AUDIT PROVENANS");
console.log("=================================================================");
console.log(`Total Metrik & Titik Data Diperiksa : ${auditLog.length}`);
console.log(`Metrik Tervalidasi Sah (Pass)        : ${auditLog.filter((m) => m.valid).length}`);
console.log(`Metrik Tanpa Sumber Sah (Fail)       : ${unsourcedCount}`);

if (unsourcedCount > 0) {
  console.error("\n❌ GAGAL: Ditemukan metrik tanpa sumber sah:");
  for (const m of auditLog.filter((m) => !m.valid)) {
    console.error(` - [${m.entity}] ${m.metric}: ${m.issue} (Sumber: ${m.sourceDetail})`);
  }
  process.exit(1);
} else {
  console.log("\n✅ LULUS 100%: 0 metrik tanpa sumber!");
  console.log("Seluruh angka, metrik, dan perbandingan memiliki provenans yang sah");
  console.log("(OBSERVATION, OWNER_INPUT, DOCUMENTED_FORMULA, atau berlabel NO_DATA).");
  process.exit(0);
}
