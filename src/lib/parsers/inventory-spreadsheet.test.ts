import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseFlexibleNumber, parseInventorySpreadsheet } from "./inventory-spreadsheet";

describe("parseFlexibleNumber", () => {
  it("parses Indonesian and English numeric formats", () => {
    expect(parseFlexibleNumber("Rp 1.250.000")).toBe(1250000);
    expect(parseFlexibleNumber("1,250,000.50")).toBe(1250000.5);
    expect(parseFlexibleNumber("1.250.000,75")).toBe(1250000.75);
    expect(parseFlexibleNumber(45000)).toBe(45000);
  });
});

describe("parseInventorySpreadsheet", () => {
  it("parses CSV with outlet, qty, price, and total value", async () => {
    const csv = [
      "Outlet,Kode,Nama Barang,Unit,Qty,Harga,Total Nilai",
      "Bistro,001,Daging Sapi,Kg,10,135000,1350000",
      "Sunset Grill,002,Ikan Kakap,Kg,5,90000,450000",
      "TOTAL,,,,,,1800000",
    ].join("\n");

    const buf = new TextEncoder().encode(csv);
    const res = await parseInventorySpreadsheet(buf, "inventory.csv");

    expect(res.fatal).toBe(false);
    expect(res.hasOutletColumn).toBe(true);
    expect(res.rows).toHaveLength(2);
    expect(res.stats.totalValue).toBe(1800000);
    expect(res.stats.outletCount).toBe(2);
  });

  it("parses XLSX without outlet column using qty * price", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Inventory");
    ws.addRow(["Nama Barang", "Qty", "Harga"]);
    ws.addRow(["Beras Premium", 20, 15000]);
    ws.addRow(["Minyak Goreng", 10, 18000]);
    const buffer = await wb.xlsx.writeBuffer();

    const res = await parseInventorySpreadsheet(new Uint8Array(buffer), "stok-mingguan.xlsx");

    expect(res.fatal).toBe(false);
    expect(res.hasOutletColumn).toBe(false);
    expect(res.rows).toHaveLength(2);
    expect(res.stats.totalValue).toBe(480000);
  });

  it("keeps Indonesian decimal commas intact in semicolon-delimited CSV", async () => {
    const csv = "Nama;Qty;Harga;Total\nGula;10;12.500,50;125.005,00\n";
    const res = await parseInventorySpreadsheet(new TextEncoder().encode(csv), "stok.csv");

    expect(res.fatal).toBe(false);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].unitPrice).toBe(12500.5);
    expect(res.rows[0].totalValue).toBe(125005);
  });

  it("splits tab-delimited exports on tabs only", async () => {
    const tsv = "Nama\tQty\tTotal\nTepung, Terigu\t5\t1,250,000\n";
    const res = await parseInventorySpreadsheet(new TextEncoder().encode(tsv), "stok.txt");

    expect(res.fatal).toBe(false);
    expect(res.rows[0].itemName).toBe("Tepung, Terigu");
    expect(res.rows[0].totalValue).toBe(1250000);
  });

  it("fails fast when required value/qty+price columns are missing", async () => {
    const csv = "Nama,Catatan\nItem A,Kosong";
    const res = await parseInventorySpreadsheet(new TextEncoder().encode(csv), "invalid.csv");
    expect(res.fatal).toBe(true);
    expect(res.error).toBeTruthy();
  });
});
