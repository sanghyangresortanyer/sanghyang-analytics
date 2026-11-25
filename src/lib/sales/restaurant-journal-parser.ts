import { parseVhpNumber } from "@/lib/parser/number";
import { parseVhpDate } from "@/lib/parsers/vhp-date";

export interface ParsedRestaurantSalesRow {
  lineNo: number;
  saleDate: string; // YYYY-MM-DD
  tbNo: string;
  billNo: string;
  artNo: string;
  description: string;
  department: string; // nama departemen mentah dari file, belum dipetakan
  qty: number;
  amount: number; // satu kolom bertanda: negatif untuk baris pembayaran/diskon
  time: string; // HH:MM:SS
  foArtikel: string;
}

interface RestaurantJournalWarning {
  lineNo: number;
  message: string;
}

export interface RestaurantJournalParseResult {
  rows: ParsedRestaurantSalesRow[];
  warnings: RestaurantJournalWarning[];
  stats: {
    // Rekonsiliasi yang bisa diaudit, pola sama dengan purchase-receipts.ts:
    //   totalLineCount = nonDataLineCount + unreadableCount + rowCount
    totalLineCount: number; // baris fisik di file, apa adanya
    nonDataLineCount: number; // header halaman/garis/T O T A L/kosong
    unreadableCount: number; // baris berawalan tanggal yang formatnya tidak dikenali
    rowCount: number;
    dateCount: number;
    articleCount: number;
    departmentCount: number;
  };
  fatal: boolean;
}

// Posisi kolom fixed-width dari export VHP "Restaurant Transaction Journal"
// (fixtures/arsip/2026-09-01_to_2026-09-08/Penjualan tgl 1-8 Septmber.txt, 212 karakter per baris data),
// diturunkan dari baris header laporannya sendiri:
//
//   Date  TbNo  Bill-No  ArtNo Description  Department  Qty  Amount Time  ID
//   GuestName  OT  Room No  F/O Artikel
//
// Tiap field membentang sampai awal field berikutnya; [start, end) untuk
// slice(). ID/GuestName/OT/Room No sengaja tidak dibaca -- tidak dipakai
// untuk apa pun di alur OUT, jadi tidak perlu diangkut.
const COLS = {
  date: [0, 11],
  tbNo: [11, 21],
  billNo: [21, 34],
  artNo: [34, 40],
  description: [40, 69],
  department: [69, 92],
  // Qty dan Amount berbagi satu blok. Keduanya rata-kanan dan lebar Amount
  // berubah-ubah -- "1,650,000.00" mulai di kolom 103, "0.00" di kolom 111 --
  // jadi tidak ada batas tetap yang bisa memisahkan keduanya. Blok diambil
  // utuh lalu dipecah spasi: selalu tepat dua bagian di seluruh 1.529 baris
  // data fixture.
  qtyAmount: [92, 116],
  time: [116, 125],
  foArtikel: [180], // sampai akhir baris
} as const;

const field = (line: string, [start, end]: readonly [number, number?]) => line.slice(start, end).trim();

// Baris data selalu diawali DD/MM/YY diikuti spasi. Semua baris lain --
// header halaman "SANGHYANG...", alamat, "Restaurant Transaction Journal",
// baris header kolom, garis "---", "T O T A L", "Grand TOTAL", baris kosong
// -- tidak, jadi satu pola ini cukup memisahkan data dari furniture tanpa
// harus menyebut tiap jenis furniture. Baris "Date   : 09/09/26" di kop surat
// diawali kata "Date", bukan tanggal, jadi tidak ikut tertangkap.
const DATA_LINE_RE = /^\d{2}\/\d{2}\/\d{2}\s/;

function toIsoDate(vhpDate: string): string | null {
  return parseVhpDate(vhpDate);
}

/**
 * Membaca export VHP "Restaurant Transaction Journal" jadi baris terstruktur.
 * Murni pembacaan: pemetaan departemen, penyaringan baris pembayaran, dan
 * pemetaan ke resep TIDAK dilakukan di sini.
 *
 * Laporan VHP lama "Rest. Transaction Journal by BillNo" punya urutan kolom
 * berbeda dan dibaca parser terpisah (transaction-journal-parser.ts) -- baris
 * format lama jauh lebih pendek dari 116 karakter, jadi blok Qty/Amount-nya
 * kosong dan barisnya masuk hitungan "gagal dibaca", bukan diam-diam terbaca
 * dengan kolom tergeser.
 */
export function parseRestaurantJournal(text: string): RestaurantJournalParseResult {
  // Kode kontrol printer (0x0F Shift-In, 0x0C form feed, 0x1B ESC) muncul
  // sebagai baris liar atau menempel di baris asli -- dibersihkan sekali di
  // depan, bukan ditebak per baris. CR/LF sengaja tidak ikut dibuang supaya
  // jumlah baris fisik tidak berubah.
  const cleaned = text.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/g, "");
  const rawLines = cleaned.split(/\r?\n/);
  const rows: ParsedRestaurantSalesRow[] = [];
  const warnings: RestaurantJournalWarning[] = [];
  const dates = new Set<string>();
  const articles = new Set<string>();
  const departments = new Set<string>();
  // Dihitung eksplisit, bukan diturunkan dari warnings.length atau selisih
  // rawLines.length - rows.length -- supaya jenis warning baru nanti tidak
  // diam-diam merusak rekonsiliasinya.
  let nonDataLineCount = 0;
  let unreadableCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const lineNo = i + 1;

    if (!DATA_LINE_RE.test(line)) {
      nonDataLineCount++;
      continue;
    }

    const saleDate = toIsoDate(field(line, COLS.date));
    const artNo = field(line, COLS.artNo);
    const numbers = field(line, COLS.qtyAmount).split(/\s+/).filter(Boolean);
    const qty = numbers.length === 2 ? parseVhpNumber(numbers[0]) : null;
    const amount = numbers.length === 2 ? parseVhpNumber(numbers[1]) : null;
    if (!saleDate || !artNo || qty === null || amount === null) {
      unreadableCount++;
      warnings.push({ lineNo, message: `Baris ${lineNo}: format tidak dikenali, dilewati — "${line.slice(0, 60).trim()}"` });
      continue;
    }

    const department = field(line, COLS.department);
    rows.push({
      lineNo,
      saleDate,
      tbNo: field(line, COLS.tbNo),
      billNo: field(line, COLS.billNo),
      artNo,
      description: field(line, COLS.description),
      department,
      qty,
      amount,
      time: field(line, COLS.time),
      foArtikel: field(line, COLS.foArtikel),
    });
    dates.add(saleDate);
    articles.add(artNo);
    departments.add(department);
  }

  return {
    rows,
    warnings,
    stats: {
      totalLineCount: rawLines.length,
      nonDataLineCount,
      unreadableCount,
      rowCount: rows.length,
      dateCount: dates.size,
      articleCount: articles.size,
      departmentCount: departments.size,
    },
    fatal: rows.length === 0,
  };
}
