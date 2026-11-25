import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRestaurantJournal } from "./restaurant-journal-parser";

// Export penjualan asli: data operasional, di luar git — dilewati kalau tidak ada.
const SALES_EXPORT = "fixtures/arsip/2026-09-01_to_2026-09-08/Penjualan tgl 1-8 Septmber.txt";
const itSalesExport = it.skipIf(!existsSync(SALES_EXPORT));

// Dua baris data asli, disalin apa adanya (212 karakter) supaya pemotongan
// kolom tetap teruji walaupun fixture besarnya tidak ikut masuk git.
// Yang kedua sengaja beramount lebar: "1,650,000.00" mulai di kolom 103,
// menembus jauh ke dalam blok yang dipakai bersama kolom Qty.
const NARROW_AMOUNT_LINE = "02/09/26     43        65478        128 Free Kacang Bali             d'Bar Karaoke & DBC      1                0.00 00:04:32 462 HENDRA LESMANA,  MR.                               Food d'Bar                      ";
const WIDE_AMOUNT_LINE = "04/09/26     14        65486       2502 DBC BACARDI LIGHT BOTTLE     d'Bar Karaoke & DBC      1        1,650,000.00 22:23:07 492 Mr.ADEN NAUFAL(GH533)                              Beverage Alcoholic d'Bar        ";

describe("parseRestaurantJournal", () => {
  it("reads every column of a data line", () => {
    const { rows, stats } = parseRestaurantJournal(NARROW_AMOUNT_LINE);
    expect(stats).toMatchObject({ totalLineCount: 1, nonDataLineCount: 0, unreadableCount: 0, rowCount: 1 });
    expect(rows[0]).toEqual({
      lineNo: 1,
      saleDate: "2026-09-02",
      tbNo: "43",
      billNo: "65478",
      artNo: "128",
      description: "Free Kacang Bali",
      department: "d'Bar Karaoke & DBC",
      qty: 1,
      amount: 0,
      time: "00:04:32",
      foArtikel: "Food d'Bar",
    });
  });

  // Qty dan Amount berbagi satu blok tanpa batas tetap — kalau blok itu
  // dipotong di posisi mati, amount lebar terbelah jadi "1,650," + "000.00".
  it("splits the shared Qty/Amount block on a wide amount", () => {
    const { rows } = parseRestaurantJournal(WIDE_AMOUNT_LINE);
    expect(rows[0]).toMatchObject({ artNo: "2502", description: "DBC BACARDI LIGHT BOTTLE", qty: 1, amount: 1650000, time: "22:23:07" });
  });

  // Format lama "Rest. Transaction Journal by BillNo" barisnya jauh lebih
  // pendek, jadi blok Qty/Amount-nya kosong: masuk hitungan gagal dibaca,
  // bukan terbaca diam-diam dengan kolom tergeser.
  it("counts an old-format line as unreadable instead of misreading it", () => {
    const result = parseRestaurantJournal(`Rest. Transaction Journal by BillNo
12/08/26   12   65215   d'Bistro   9936   Debit BCA1591   1   0   35,000   OK   01:08:48`);
    expect(result.rows).toHaveLength(0);
    expect(result.fatal).toBe(true);
    expect(result.stats).toMatchObject({ totalLineCount: 2, nonDataLineCount: 1, unreadableCount: 1, rowCount: 0 });
  });

  it("rejects impossible calendar dates", () => {
    const result = parseRestaurantJournal(NARROW_AMOUNT_LINE.replace("02/09/26", "31/02/26"));
    expect(result.rows).toHaveLength(0);
    expect(result.stats.unreadableCount).toBe(1);
  });

  itSalesExport("parses the real 1-8 September journal", () => {
    const result = parseRestaurantJournal(readFileSync(SALES_EXPORT, "latin1"));
    expect(result.fatal).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.stats).toEqual({
      totalLineCount: 1811, nonDataLineCount: 282, unreadableCount: 0,
      rowCount: 1529, dateCount: 8, articleCount: 291, departmentCount: 5,
    });
  });

  // Jaminan kelengkapan: tiap baris fisik jatuh di tepat satu kategori.
  itSalesExport("accounts for every physical line", () => {
    const { stats } = parseRestaurantJournal(readFileSync(SALES_EXPORT, "latin1"));
    expect(stats.nonDataLineCount + stats.unreadableCount + stats.rowCount).toBe(stats.totalLineCount);
  });

  // Kontrol paling kuat yang tersedia: total cetakan laporannya sendiri.
  // Baris "Grand TOTAL" di file berbunyi 2056 dan 1,025,000.00.
  itSalesExport("matches the report's own printed Grand TOTAL", () => {
    const { rows } = parseRestaurantJournal(readFileSync(SALES_EXPORT, "latin1"));
    expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(2056);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBeCloseTo(1025000, 2);
  });

  itSalesExport("keeps the five raw department names unmapped", () => {
    const { rows } = parseRestaurantJournal(readFileSync(SALES_EXPORT, "latin1"));
    expect([...new Set(rows.map((r) => r.department))].sort()).toEqual([
      "Room Service", "Sunset Grill", "d'Bar Karaoke & DBC", "d'Bistro", "d'Spa",
    ]);
  });
});
