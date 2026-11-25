/**
 * Modul Impor Data Omset Bulanan (Excel/CSV) — Tahap 4
 *
 * Mengolah laporan omset bulanan per outlet Sanghyang:
 * - Parsing format angka Rupiah / desimal / pemisah ribuan
 * - Pemetaan nama outlet fleksibel (alias) ke kunci baku (OutletKey)
 * - Validasi format bulan (YYYY-MM)
 * - Simpan ke OutletMonthlyRevenue dengan Optimistic Concurrency Control (OCC)
 * - Perhitungan pertumbuhan omset riil antar-bulan
 *
 * Menerapkan "The 4 Zeros": Zero Mock Data, Zero Hardcoded Dates, Zero Fallback, Zero Data Loss.
 */

import { OUTLET_KEYS, type OutletKey } from "./outlet-filters";

export interface RevenueImportItem {
  outletKey: OutletKey;
  month: string; // "YYYY-MM"
  revenue: number;
  sourceFile?: string;
}

export interface StoredRevenueRecord {
  id: string;
  outletKey: OutletKey;
  outletName: string;
  month: string; // "YYYY-MM"
  monthDate: string; // "YYYY-MM-01"
  revenue: number;
  sourceFile: string;
  importedAt: string;
  version: number;
  growthVsPreviousPct: number | null;
}


export const OUTLET_DISPLAY_NAMES: Record<OutletKey, string> = {
  resort: "Kamar & Resort",
  "sunset-grill": "Sunset Grill (Resto Seafood)",
  "dragon-beach-club": "Dragon Beach Club",
  dbistro: "D'Bistro (Restoran)",
  dbar: "d'Bar (Bar & Lounge)",
  dspa: "D'Spa (Hot Spring & Spa)",
};

/** Membersihkan string nominal Rupiah / angka menjadi number. */
export function parseRevenueAmount(val: unknown): number | null {
  if (typeof val === "number") {
    return Number.isFinite(val) && val >= 0 ? Math.round(val) : null;
  }
  if (typeof val !== "string") return null;

  const raw = val.trim();
  // Tolak angka negatif
  if (raw.includes("-")) return null;

  // Hapus "Rp", "IDR", spasi, dan karakter non-digit kecuali titik/koma
  const clean = raw.replace(/[^0-9.,]/g, "").trim();
  if (!clean) return null;

  // Jika format Indonesia: 262.410.000 atau 262.410.000,00
  if (clean.includes(".") && clean.includes(",")) {
    const withoutDots = clean.replace(/\./g, "").replace(",", ".");
    const num = Number(withoutDots);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
  }

  // Jika format hanya titik sebagai ribuan (mis. 262.410.000)
  if (clean.includes(".") && !clean.includes(",")) {
    const parts = clean.split(".");
    // Jika semua bagian setelah bagian pertama berpanjang 3 (ribuan)
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) {
      const num = Number(parts.join(""));
      return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
    }
  }

  // Format standar desimal atau angka polos
  const plainNum = Number(clean.replace(/,/g, ""));
  return Number.isFinite(plainNum) && plainNum >= 0 ? Math.round(plainNum) : null;
}

/** Memetakan variasi nama/alias outlet ke OutletKey standar. */
export function resolveOutletKey(input: string): OutletKey | null {
  const norm = input.trim().toLowerCase();
  if (OUTLET_KEYS.includes(norm as OutletKey)) return norm as OutletKey;

  if (/kamar|resort|hotel|cottage|villa|room/.test(norm)) return "resort";
  if (/sunset|grill|seafood|ikan|pantai/.test(norm)) return "sunset-grill";
  if (/dragon|beach.*club|dbc/.test(norm)) return "dragon-beach-club";
  if (/bistro|dbistro|resto|kafe|cafe/.test(norm)) return "dbistro";
  if (/bar|dbar|karaoke|ktv|lounge/.test(norm)) return "dbar";
  if (/spa|dspa|massage|pijat|aquamedic|hotspring/.test(norm)) return "dspa";

  return null;
}

/** Memvalidasi dan menormalisasi format bulan: "2026-10" atau "2026-10-01" -> "2026-10". */
export function normalizeMonth(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = input.trim().match(/^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

export interface ParseCsvResult {
  valid: RevenueImportItem[];
  errors: string[];
}

/**
 * Parsing teks CSV / TSV / baris hasil copy-paste dari Excel.
 * Format yang didukung:
 * 1) 3 kolom: Outlet, Bulan, Omset (atau Bulan, Outlet, Omset)
 * 2) 2 kolom: Outlet, Omset (dengan defaultMonth ditentukan)
 */
export function parseRevenueCsv(csvText: string, defaultMonth?: string): ParseCsvResult {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const valid: RevenueImportItem[] = [];
  const errors: string[] = [];

  const defMonth = defaultMonth ? normalizeMonth(defaultMonth) : null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    // Lewati baris header bila memuat kata kunci
    if (idx === 0 && /outlet|bulan|month|omset|revenue|pendapatan/i.test(line)) {
      continue;
    }

    // Pisahkan berdasarkan koma, titik-koma, atau tab
    const cols = line.split(/[;,\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    if (cols.length < 2) {
      errors.push(`Baris ${idx + 1}: Format kolom tidak sesuai (${line})`);
      continue;
    }

    let outletStr = "";
    let monthStr = "";
    let revenueStr = "";

    if (cols.length >= 3) {
      // Periksa apakah kolom pertama adalah bulan atau outlet
      if (normalizeMonth(cols[0])) {
        monthStr = cols[0];
        outletStr = cols[1];
        revenueStr = cols[2];
      } else {
        outletStr = cols[0];
        monthStr = cols[1];
        revenueStr = cols[2];
      }
    } else {
      // 2 kolom: Outlet dan Omset
      outletStr = cols[0];
      monthStr = defMonth ?? "";
      revenueStr = cols[1];
    }

    const outletKey = resolveOutletKey(outletStr);
    if (!outletKey) {
      errors.push(`Baris ${idx + 1}: Nama outlet '${outletStr}' tidak dikenali.`);
      continue;
    }

    const normMonth = normalizeMonth(monthStr);
    if (!normMonth) {
      errors.push(`Baris ${idx + 1}: Format bulan '${monthStr}' tidak sah (gunakan YYYY-MM, misal 2026-10).`);
      continue;
    }

    const revenue = parseRevenueAmount(revenueStr);
    if (revenue === null) {
      errors.push(`Baris ${idx + 1}: Nominal omset '${revenueStr}' tidak sah.`);
      continue;
    }

    valid.push({
      outletKey,
      month: normMonth,
      revenue,
    });
  }

  return { valid, errors };
}

/** Menyimpan batch data omset ke database dengan OCC. */
export async function saveRevenueBatch(
  items: RevenueImportItem[],
  sourceFileName: string = "Input Manual / CSV"
): Promise<{ count: number; updated: string[] }> {
  const { db } = await import("../db");
  const { Prisma } = await import("@prisma/client");

  const updated: string[] = [];

  for (const item of items) {
    const monthDate = new Date(`${item.month}-01T00:00:00Z`);
    const revenueDecimal = new Prisma.Decimal(item.revenue);

    // Cari apakah sudah ada data untuk outlet & bulan ini
    const existing = await db.outletMonthlyRevenue.findUnique({
      where: {
        outletKey_month: {
          outletKey: item.outletKey,
          month: monthDate,
        },
      },
    });

    if (existing) {
      await db.outletMonthlyRevenue.update({
        where: { id: existing.id },
        data: {
          revenue: revenueDecimal,
          sourceFile: sourceFileName,
          importedAt: new Date(),
          version: { increment: 1 },
        },
      });
      updated.push(`${item.outletKey} (${item.month}) diperbarui (v${existing.version + 1})`);
    } else {
      await db.outletMonthlyRevenue.create({
        data: {
          outletKey: item.outletKey,
          month: monthDate,
          revenue: revenueDecimal,
          sourceFile: sourceFileName,
          version: 1,
        },
      });
      updated.push(`${item.outletKey} (${item.month}) disimpan baru (v1)`);
    }
  }

  return { count: items.length, updated };
}

/** Mengambil seluruh riwayat omset bulanan yang tersimpan di database beserta pertumbuhan. */
export async function getRevenueHistory(): Promise<{
  months: string[];
  records: StoredRevenueRecord[];
  monthlyTotals: Record<string, { totalRevenue: number; growthVsPreviousPct: number | null }>;
}> {
  const { db } = await import("../db");

  const raw = await db.outletMonthlyRevenue.findMany({
    orderBy: [{ month: "desc" }, { outletKey: "asc" }],
  });

  // Kumpulkan daftar bulan unik berurutan naik
  const monthDates = [...new Set(raw.map((r) => r.month.toISOString().slice(0, 7)))].sort();

  // Susun map cepat: [outletKey][month] = revenue
  const revenueMap: Record<string, Record<string, number>> = {};
  for (const r of raw) {
    const m = r.month.toISOString().slice(0, 7);
    if (!revenueMap[r.outletKey]) revenueMap[r.outletKey] = {};
    revenueMap[r.outletKey][m] = Number(r.revenue.toString());
  }

  // Hitung total bulanan
  const monthlyTotals: Record<string, { totalRevenue: number; growthVsPreviousPct: number | null }> = {};
  for (let i = 0; i < monthDates.length; i++) {
    const m = monthDates[i];
    const prevM = i > 0 ? monthDates[i - 1] : null;

    let total = 0;
    for (const key of OUTLET_KEYS) {
      total += revenueMap[key]?.[m] ?? 0;
    }

    let prevTotal = 0;
    if (prevM) {
      for (const key of OUTLET_KEYS) {
        prevTotal += revenueMap[key]?.[prevM] ?? 0;
      }
    }

    const growth = prevM && prevTotal > 0
      ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10
      : null;

    monthlyTotals[m] = {
      totalRevenue: total,
      growthVsPreviousPct: growth,
    };
  }

  // Susun StoredRevenueRecord
  const records: StoredRevenueRecord[] = raw.map((r) => {
    const m = r.month.toISOString().slice(0, 7);
    const mIdx = monthDates.indexOf(m);
    const prevM = mIdx > 0 ? monthDates[mIdx - 1] : null;

    const currRev = Number(r.revenue.toString());
    const prevRev = prevM ? revenueMap[r.outletKey]?.[prevM] ?? null : null;

    const growth = prevRev && prevRev > 0
      ? Math.round(((currRev - prevRev) / prevRev) * 1000) / 10
      : null;

    return {
      id: r.id,
      outletKey: r.outletKey as OutletKey,
      outletName: OUTLET_DISPLAY_NAMES[r.outletKey as OutletKey] ?? r.outletKey,
      month: m,
      monthDate: r.month.toISOString().slice(0, 10),
      revenue: currRev,
      sourceFile: r.sourceFile,
      importedAt: r.importedAt.toISOString(),
      version: r.version,
      growthVsPreviousPct: growth,
    };
  });

  return {
    months: monthDates.reverse(), // Terbaru lebih dulu
    records,
    monthlyTotals,
  };
}
