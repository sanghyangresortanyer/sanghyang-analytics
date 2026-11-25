/**
 * lib/market/revenue-baseline.ts
 *
 * Manajemen omset bulanan per outlet.
 * Zero Mock & Zero Hardcode: Angka omset tidak ditanam di kode sumber, melainkan
 * wajib dimuat dari database (tabel OutletMonthlyRevenue) hasil impor pembukuan resmi pemilik.
 * Akses omset hanya melalui API berautentikasi / kode server.
 */

import { db } from "../db";
import { type OutletKey } from "./outlet-filters";

export const BASELINE_MONTH = "2026-09";

/**
 * Mencari bulan omset terakhir yang tersedia di database.
 * Mengembalikan null jika tabel OutletMonthlyRevenue kosong (0 baris).
 */
export async function getLatestAvailableRevenueMonth(): Promise<string | null> {
  const latest = await db.outletMonthlyRevenue.findFirst({
    orderBy: { month: "desc" },
    select: { month: true },
  });
  return latest ? latest.month.toISOString().slice(0, 7) : null;
}

/**
 * Mengambil data omset dari tabel OutletMonthlyRevenue di database.
 * Jika bulan tidak ditentukan, mencari bulan terakhir yang tersedia.
 * Mengembalikan null jika belum diimpor oleh pemilik atau jika tabel kosong.
 */
export async function getOutletRevenueFromDb(
  outletKey: OutletKey,
  month?: string
): Promise<number | null> {
  const targetMonth = month ?? (await getLatestAvailableRevenueMonth());
  if (!targetMonth) return null;

  const record = await db.outletMonthlyRevenue.findFirst({
    where: {
      outletKey,
      month: new Date(`${targetMonth}-01T00:00:00Z`),
    },
  });

  return record ? Number(record.revenue.toString()) : null;
}

/**
 * Mengambil omset seluruh outlet untuk bulan tertentu dari database.
 * Jika bulan tidak ditentukan, mencari bulan terakhir yang tersedia.
 * Mengembalikan null jika tabel kosong (0 baris).
 */
export async function getMonthlyRevenueAllOutlets(
  month?: string
): Promise<Record<OutletKey, { name: string; revenue: number | null }> | null> {
  const targetMonth = month ?? (await getLatestAvailableRevenueMonth());
  if (!targetMonth) {
    return null;
  }

  const records = await db.outletMonthlyRevenue.findMany({
    where: {
      month: new Date(`${targetMonth}-01T00:00:00Z`),
    },
  });

  if (records.length === 0 && !month) {
    return null;
  }

  const recordMap = new Map(records.map((r) => [r.outletKey, Number(r.revenue.toString())]));

  return {
    resort: { name: "Kamar & Resort", revenue: recordMap.get("resort") ?? null },
    "sunset-grill": { name: "Sunset Grill (Resto Seafood)", revenue: recordMap.get("sunset-grill") ?? null },
    "dragon-beach-club": { name: "Dragon Beach Club", revenue: recordMap.get("dragon-beach-club") ?? null },
    dbistro: { name: "D'Bistro (Restoran)", revenue: recordMap.get("dbistro") ?? null },
    dbar: { name: "d'Bar (Bar & Lounge)", revenue: recordMap.get("dbar") ?? null },
    dspa: { name: "D'Spa (Hot Spring & Spa)", revenue: recordMap.get("dspa") ?? null },
  };
}
