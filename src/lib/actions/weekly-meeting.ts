"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/auth/role";
import { invalidateTags, withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL, INVALIDATION_GROUPS } from "@/lib/cache/tags";
import { parseRestaurantJournal } from "@/lib/sales/restaurant-journal-parser";
import { isJournalByBill, parseJournalByBill, type JournalByBillParseResult } from "@/lib/sales/journal-by-bill-parser";
import { isJournalByArticle, parseJournalByArticle } from "@/lib/sales/journal-by-article";
import { isFoJournal, parseFoJournal, type FoJournalParseResult } from "@/lib/sales/fo-journal-parser";
import { isFoTurnoverReport, parseFoTurnoverReport } from "@/lib/parsers/fo-turnover-parser";
import { parsePurchaseReceipts } from "@/lib/parsers/purchase-receipts";
import { isClosedReceivingReport } from "@/lib/parsers/closed-receiving";
import { vhpPrintedAt } from "@/lib/parsers/vhp-date";
import { printedDay, supersededProvisional } from "@/lib/dashboard/data-status";
import { parseInventorySpreadsheet } from "@/lib/parsers/inventory-spreadsheet";
import {
  buildWeeklyComparison,
  type PreviousMeetingBaseline,
  type WeeklyComparisonReport,
} from "@/lib/comparison/weekly-aggregator";
import { computeRange } from "@/lib/dashboard/range-data";
import { groupPurchases, type PurchaseGroup } from "@/lib/dashboard/purchase-groups";
import { NO_FILE, type DateSpan, type RevenueSource } from "@/lib/dashboard/range-report";

export interface SavedWeeklyMeeting {
  id: string;
  meeting_date: string;
  period_start: string;
  period_end: string;
  title: string;
  notes: string | null;
  revenue_filename: string;
  purchase_filename: string;
  inventory_filename: string;
  total_revenue: number;
  total_purchase: number;
  total_inventory: number;
  purchase_to_revenue_pct: number;
  inventory_to_revenue_ratio: number;
  has_outlet_inventory: boolean;
  journal_filename?: string | null;
  revenue_source?: "fo" | "journal" | null;
  revenue_exported_at?: string | null;
  journal_exported_at?: string | null;
  purchase_exported_at?: string | null;
  fo_journal_filename?: string | null;
  fo_journal_exported_at?: string | null;
  /** Turnover's last day still had room revenue 0 (VHP had not closed that day). */
  revenue_open_day?: boolean | null;
  version: number;
  created_at: string;
}

export interface FullWeeklyMeetingData {
  meeting: SavedWeeklyMeeting;
  previous: SavedWeeklyMeeting | null;
  outlets: {
    outlet_name: string;
    revenue_amount: number;
    revenue_qty: number;
    revenue_share_pct: number;
    inventory_amount: number | null;
    prev_revenue_amount: number | null;
    /** False when no source covers this outlet for the period (shown as "—", never 0). */
    revenue_available?: boolean;
    revenue_source?: Exclude<RevenueSource, "none"> | null;
  }[];
  suppliers: {
    supplier_name: string;
    purchase_amount: number;
    line_count: number;
  }[];
  /** Every purchased item by VHP article group (range view only). */
  purchaseGroups?: PurchaseGroup[];
  purchaseItems: {
    ingredient_code: string;
    description: string;
    unit: string;
    total_qty: number;
    total_amount: number;
  }[];
  inventoryItems: {
    outlet_name: string | null;
    item_code: string | null;
    item_name: string;
    unit: string | null;
    qty: number;
    unit_price: number;
    total_value: number;
  }[];
  outletItems?: {
    outlet_name: string;
    art_no: string | null;
    description: string;
    total_qty: number;
    total_amount: number;
    /** "journal": menu lines; "fo": F/O revenue articles (outlets without a journal). */
    source?: "journal" | "fo";
  }[];
  /** How the period's figures were sourced; present for date-range data. */
  range?: {
    revenueSource: RevenueSource;
    revenueNotes: string[];
    missingOutlets: string[];
    purchaseNotes: string[];
    salesCoverage: DateSpan[];
    purchaseCoverage: DateSpan[];
    journalFilename: string | null;
  };
}

type UploadParse = {
  report: WeeklyComparisonReport;
  filenames: { revenue: string; purchase: string; inventory: string; journal: string | null; foJournal: string | null };
  exportedAt: { revenue: string | null; journal: string | null; purchase: string | null; foJournal: string | null };
  foParsed: ReturnType<typeof parseFoTurnoverReport> | null;
  foJournal: FoJournalParseResult | null;
  oldJournal: ReturnType<typeof parseRestaurantJournal> | null;
  journal: JournalByBillParseResult | null;
  purParsed: ReturnType<typeof parsePurchaseReceipts> | null;
  invParsed: Awaited<ReturnType<typeof parseInventorySpreadsheet>> | null;
};

/** Reads and checks every uploaded file once; preview and save both start here. */
async function parseUpload(
  formData: FormData,
  propertyId: string,
): Promise<{ ok: true; value: UploadParse } | { ok: false; error: string }> {
  const periodStart = String(formData.get("periodStart") ?? "").trim();
  const periodEnd = String(formData.get("periodEnd") ?? "").trim();
  const optionalFile = (name: string) => {
    const raw = formData.get(name);
    return raw instanceof File && raw.size > 0 ? raw : null;
  };
  const revenueFile = optionalFile("revenueFile");
  // Optional: a daily upload has revenue and sales only; purchases come in their own exports.
  const purchaseFile = optionalFile("purchaseFile");
  const inventoryFile = optionalFile("inventoryFile");
  const journalFile = optionalFile("journalFile");
  // F/O Journal Transaction: dated Front Office revenue and room-package postings to outlets.
  const foJournalFile = optionalFile("foJournalFile");

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(periodStart) || !isoDate.test(periodEnd) || periodEnd < periodStart) {
    return { ok: false, error: "Rentang tanggal periode tidak valid." };
  }
  // Any VHP report on its own is a valid upload: history is pulled per month and report by report.
  if (!revenueFile && !purchaseFile && !journalFile && !foJournalFile) {
    return { ok: false, error: "Belum ada file VHP yang diunggah." };
  }

  const [revText, purText, journalText, foJournalText, invBuf] = await Promise.all([
    revenueFile ? revenueFile.text() : Promise.resolve(""),
    purchaseFile ? purchaseFile.text() : Promise.resolve(null),
    journalFile ? journalFile.text() : Promise.resolve(null),
    foJournalFile ? foJournalFile.text() : Promise.resolve(null),
    inventoryFile ? inventoryFile.arrayBuffer() : Promise.resolve(null),
  ]);
  if (foJournalText !== null && !isFoJournal(foJournalText)) {
    return { ok: false, error: "File F/O Journal tidak dikenali. Pakai ekspor VHP F/O Journal Transaction." };
  }
  const foJournal = foJournalText !== null ? parseFoJournal(foJournalText) : null;
  if (foJournal?.fatal) return { ok: false, error: `File F/O Journal gagal dibaca: ${foJournal.error}` };
  if (foJournal && foJournal.unreadable > 0) {
    return { ok: false, error: `${foJournal.unreadable} baris F/O Journal tidak terbaca; periksa file ekspor sebelum disimpan.` };
  }

  // Revenue slot: F/O Turnover (official totals) or a journal. Penjualan slot: the menu-level journal.
  if (journalText !== null && revenueFile && isJournalByBill(revText)) {
    return { ok: false, error: "Slot Revenue dan slot Penjualan sama-sama berisi Journal. Isi slot Revenue dengan F/O Turnover." };
  }
  const foParsed = revenueFile && isFoTurnoverReport(revText) ? parseFoTurnoverReport(revText) : null;
  const journalSource = journalText ?? (revenueFile && isJournalByBill(revText) ? revText : null);
  if (journalText !== null && !isJournalByBill(journalText) && !isJournalByArticle(journalText)) {
    return { ok: false, error: "File Penjualan tidak dikenali. Pakai ekspor VHP Restaurant Transaction Journal (per artikel atau per bill)." };
  }
  const journal =
    journalSource === null ? null : isJournalByArticle(journalSource) ? parseJournalByArticle(journalSource) : parseJournalByBill(journalSource);
  const oldJournal = revenueFile && !foParsed && !journal ? parseRestaurantJournal(revText) : null;

  if (foParsed && (foParsed.fatal || foParsed.departments.length === 0)) {
    return { ok: false, error: foParsed.error ?? "File F/O Turnover VHP gagal dibaca." };
  }
  if (journal?.fatal) {
    return { ok: false, error: `File Penjualan (Journal) gagal dibaca: ${journal.error}` };
  }
  if (journal && journal.unreadable > 0) {
    return { ok: false, error: `${journal.unreadable} baris Journal tidak terbaca; periksa file ekspor sebelum disimpan.` };
  }
  if (oldJournal && (oldJournal.fatal || oldJournal.rows.length === 0)) {
    return { ok: false, error: "File Revenue VHP tidak dapat dibaca atau tidak memiliki baris transaksi." };
  }

  // The closed report cuts supplier names to 12 characters; full names from earlier uploads restore them.
  const suppliers = purText !== null && isClosedReceivingReport(purText) ? await knownSuppliers(propertyId) : [];
  const purParsed = purText !== null ? parsePurchaseReceipts(purText, suppliers) : null;
  if (purParsed && (purParsed.fatal || purParsed.rows.length === 0)) {
    return { ok: false, error: "File Pembelian VHP (Receive Item) tidak dapat dibaca atau kosong." };
  }

  const invParsed = inventoryFile && invBuf ? await parseInventorySpreadsheet(invBuf, inventoryFile.name) : null;
  if (invParsed?.fatal) {
    return { ok: false, error: invParsed.error ?? "Spreadsheet Inventory gagal diproses." };
  }

  const supabase = await createClient();
  const { data: prevRow } = await supabase
    .from("weekly_meetings")
    .select("id, meeting_date, period_start, period_end, total_revenue, total_purchase, total_inventory")
    .eq("property_id", propertyId)
    .lt("period_end", periodStart)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  let previousMeeting: PreviousMeetingBaseline | null = null;
  if (prevRow) {
    const { data: prevOutlets } = await supabase
      .from("weekly_outlet_metrics")
      .select("outlet_name, revenue_amount")
      .eq("meeting_id", prevRow.id);
    const outletRevenues: Record<string, number> = {};
    for (const o of prevOutlets ?? []) outletRevenues[o.outlet_name] = Number(o.revenue_amount);
    previousMeeting = {
      meetingDate: prevRow.meeting_date,
      periodStart: prevRow.period_start,
      periodEnd: prevRow.period_end,
      totalRevenue: Number(prevRow.total_revenue),
      totalPurchase: Number(prevRow.total_purchase),
      totalInventory: Number(prevRow.total_inventory),
      outletRevenues,
    };
  }

  const knownOutlets = foParsed ? foParsed.departments.map((d) => d.departmentName) : await knownFoOutlets(propertyId);
  const report = buildWeeklyComparison({
    periodStart,
    periodEnd,
    revenueRows: oldJournal?.rows ?? [],
    foTurnover: foParsed,
    // Without Turnover, revenue = Penjualan per Artikel plus the F/O Journal's revenue postings.
    journalRows: foParsed
      ? []
      : [
          ...(journal?.rows ?? []),
          ...(foJournal?.revenue ?? []).map((r) => ({
            lineNo: r.lineNo,
            saleDate: r.saleDate,
            billNo: r.billNo,
            department: r.department,
            artNo: r.artNo,
            description: r.description,
            qty: 0,
            sales: r.amount,
            payment: 0,
            isComplimentary: false,
          })),
        ],
    knownOutlets,
    purchaseRows: purParsed?.rows ?? [],
    inventoryResult: invParsed,
    previousMeeting,
  });
  if (foParsed && journal) {
    const outside = journal.rows.filter((r) => r.saleDate < periodStart || r.saleDate > periodEnd).length;
    if (outside > 0) report.warnings.push(`${outside} baris Journal di luar periode ${periodStart} s.d. ${periodEnd} tidak disimpan.`);
  }

  return {
    ok: true,
    value: {
      report,
      filenames: {
        revenue: revenueFile ? revenueFile.name : NO_FILE,
        purchase: purchaseFile ? purchaseFile.name : NO_FILE,
        inventory: inventoryFile ? inventoryFile.name : NO_FILE,
        journal: journalFile ? journalFile.name : journal && revenueFile ? revenueFile.name : null,
        foJournal: foJournalFile ? foJournalFile.name : null,
      },
      // Print time of each VHP file: a day is final only if its report was printed after that day.
      exportedAt: {
        revenue: vhpPrintedAt(revText),
        journal: vhpPrintedAt(journalText ?? (journal ? revText : null)),
        purchase: vhpPrintedAt(purText),
        foJournal: vhpPrintedAt(foJournalText),
      },
      foParsed,
      foJournal,
      oldJournal,
      journal,
      purParsed,
      invParsed,
    },
  };
}

/** Supplier names seen in earlier purchase uploads. */
async function knownSuppliers(propertyId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("weekly_purchase_lines").select("supplier_name").eq("property_id", propertyId).limit(10000);
  return [...new Set((data ?? []).map((r) => r.supplier_name as string))];
}

/** F/O department names seen in earlier uploads, to expand the journal's 12-character names. */
async function knownFoOutlets(propertyId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data: meetings } = await supabase.from("weekly_meetings").select("id").eq("property_id", propertyId);
  const ids = (meetings ?? []).map((m) => m.id as string);
  if (ids.length === 0) return [];
  const { data } = await supabase.from("weekly_outlet_metrics").select("outlet_name").in("meeting_id", ids);
  return [...new Set((data ?? []).map((r) => r.outlet_name as string))];
}

export async function previewWeeklyUpload(formData: FormData): Promise<
  | { ok: true; report: WeeklyComparisonReport; filenames: { revenue: string; purchase: string; inventory: string } }
  | { ok: false; error: string }
> {
  const me = await currentUser();
  if (!me?.propertyId) return { ok: false, error: "Sesi atau properti belum tersedia." };
  const parsed = await parseUpload(formData, me.propertyId);
  if (!parsed.ok) return parsed;
  return { ok: true, report: parsed.value.report, filenames: parsed.value.filenames };
}

const INSERT_CHUNK = 1000;

async function insertChunked(table: string, rows: Record<string, unknown>[]): Promise<string | null> {
  const supabase = await createClient();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + INSERT_CHUNK));
    if (error) return error.message;
  }
  return null;
}

export async function saveWeeklyMeeting(formData: FormData): Promise<
  | { ok: true; meetingId: string; replaced: number }
  | { ok: false; error: string }
> {
  const me = await currentUser();
  if (!me?.propertyId) return { ok: false, error: "Sesi atau properti belum tersedia." };
  const propertyId = me.propertyId;

  const parsed = await parseUpload(formData, propertyId);
  if (!parsed.ok) return parsed;
  const { report, filenames, exportedAt, foParsed, foJournal, oldJournal, journal, purParsed, invParsed } = parsed.value;

  const meetingDate = String(formData.get("meetingDate") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || `Meeting Senin ${meetingDate}`;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  // Strict format: the value is also used inside the overwrite filter below.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return { ok: false, error: "Tanggal meeting wajib diisi (format YYYY-MM-DD)." };
  }

  const supabase = await createClient();
  const { data: inserted, error: insertErr } = await supabase
    .from("weekly_meetings")
    .insert({
      property_id: propertyId,
      meeting_date: meetingDate,
      period_start: report.periodStart,
      period_end: report.periodEnd,
      title,
      notes,
      revenue_filename: filenames.revenue,
      purchase_filename: filenames.purchase,
      inventory_filename: filenames.inventory,
      journal_filename: filenames.journal,
      revenue_source: foParsed ? "fo" : filenames.revenue === NO_FILE ? null : "journal",
      revenue_exported_at: foParsed ? exportedAt.revenue : null,
      revenue_open_day: foParsed?.lastDayLodging === 0,
      journal_exported_at: journal ? exportedAt.journal : null,
      purchase_exported_at: purParsed ? exportedAt.purchase : null,
      fo_journal_filename: filenames.foJournal,
      fo_journal_exported_at: foJournal ? exportedAt.foJournal : null,
      total_revenue: report.totalRevenue,
      total_purchase: report.totalPurchase,
      total_inventory: report.totalInventory,
      purchase_to_revenue_pct: report.purchaseToRevenuePct,
      inventory_to_revenue_ratio: report.inventoryToRevenueRatio,
      has_outlet_inventory: report.hasOutletInventory,
      version: 1,
      created_by: me.id,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: insertErr?.message ?? "Gagal menyimpan sesi meeting." };
  }

  const meetingId = inserted.id;

  // A child insert failed: drop the half-saved meeting (children cascade) so no partial session lingers.
  const discard = async (message: string) => {
    await supabase.from("weekly_meetings").delete().eq("id", meetingId);
    return { ok: false as const, error: message };
  };

  if (report.outlets.length > 0) {
    const { error } = await supabase.from("weekly_outlet_metrics").insert(
      report.outlets.map((o) => ({
        meeting_id: meetingId,
        outlet_name: o.outletName,
        revenue_amount: o.revenueAmount,
        // Nett (before service and tax) straight from F/O Turnover; unknown without it.
        revenue_nett: foParsed?.departments.find((d) => d.departmentName === o.outletName)?.mtdNett ?? null,
        revenue_qty: o.revenueQty,
        revenue_share_pct: o.revenueSharePct,
        inventory_amount: o.inventoryAmount,
      }))
    );
    if (error) return discard(`Gagal menyimpan metrik outlet: ${error.message}`);
  }

  if (report.suppliers.length > 0) {
    const { error } = await supabase.from("weekly_purchase_suppliers").insert(
      report.suppliers.map((s) => ({
        meeting_id: meetingId,
        supplier_name: s.supplierName,
        purchase_amount: s.purchaseAmount,
        line_count: s.lineCount,
      }))
    );
    if (error) return discard(`Gagal menyimpan supplier pembelian: ${error.message}`);
  }

  if (report.topPurchaseItems.length > 0) {
    const { error } = await supabase.from("weekly_purchase_items").insert(
      report.topPurchaseItems.map((i) => ({
        meeting_id: meetingId,
        ingredient_code: i.ingredientCode,
        description: i.description,
        unit: i.unit,
        total_qty: i.totalQty,
        total_amount: i.totalAmount,
      }))
    );
    if (error) return discard(`Gagal menyimpan item pembelian: ${error.message}`);
  }

  if (invParsed && invParsed.rows.length > 0) {
    const { error } = await supabase.from("weekly_inventory_items").insert(
      invParsed.rows.slice(0, 500).map((r) => ({
        meeting_id: meetingId,
        outlet_name: r.outletName,
        item_code: r.itemCode,
        item_name: r.itemName,
        unit: r.unit,
        qty: r.qty,
        unit_price: r.unitPrice,
        total_value: r.totalValue,
      }))
    );
    if (error) return discard(`Gagal menyimpan detail inventory: ${error.message}`);
  }

  // F/O revenue articles per department: part of the snapshot used for exact F/O ranges.
  if (foParsed) {
    const foItems = foParsed.departments.flatMap((d) =>
      (d.articles ?? []).map((a) => ({
        meeting_id: meetingId,
        outlet_name: d.departmentName,
        art_no: a.artNo,
        description: a.description,
        total_qty: 0,
        total_amount: a.mtdGros,
      })),
    );
    const err = foItems.length ? await insertChunked("weekly_outlet_items", foItems) : null;
    if (err) return discard(`Gagal menyimpan rincian artikel F/O: ${err}`);
  }

  // Daily lines: every date range on the dashboard is computed from these.
  const inPeriod = (d: string) => d >= report.periodStart && d <= report.periodEnd;
  const salesLines = journal
    ? journal.rows
        .filter((r) => inPeriod(r.saleDate) && (r.sales !== 0 || r.isComplimentary))
        .map((r) => ({
          property_id: propertyId,
          meeting_id: meetingId,
          sale_date: r.saleDate,
          outlet_name: r.department,
          art_no: r.artNo || null,
          description: r.description,
          qty: r.qty,
          sales_amount: r.sales,
          coupon_amount: r.isComplimentary ? -r.payment : 0,
          category: r.category ?? null,
        }))
    : (oldJournal?.rows ?? [])
        .filter((r) => inPeriod(r.saleDate) && r.amount > 0)
        .map((r) => ({
          property_id: propertyId,
          meeting_id: meetingId,
          sale_date: r.saleDate,
          outlet_name: r.department,
          art_no: r.artNo || null,
          description: r.description,
          qty: r.qty,
          sales_amount: r.amount,
          coupon_amount: 0,
        }));
  const foLines = (foJournal?.revenue ?? [])
    .filter((r) => inPeriod(r.saleDate) && r.amount !== 0)
    .map((r) => ({
      property_id: propertyId,
      meeting_id: meetingId,
      sale_date: r.saleDate,
      outlet_name: r.department,
      art_no: r.artNo,
      description: r.description,
      qty: r.qty,
      sales_amount: r.amount,
      coupon_amount: 0,
      source: "fo",
      category: r.description,
      segment: r.segment || null,
      room_no: r.roomNo || null,
    }));
  const purchaseLines = (purParsed?.rows ?? [])
    .filter((r) => inPeriod(r.businessDate))
    .map((r) => ({
      property_id: propertyId,
      meeting_id: meetingId,
      receive_date: r.businessDate,
      supplier_name: r.supplier?.trim() || "Supplier Tidak Tercatat",
      art_no: r.ingredientCode || null,
      description: r.description,
      unit: r.unit || null,
      qty: r.qty,
      amount: r.value ?? r.price * r.qty,
    }));
  const salesErr = salesLines.length ? await insertChunked("weekly_sales_lines", salesLines) : null;
  if (salesErr) return discard(`Gagal menyimpan baris penjualan harian: ${salesErr}`);
  const foErr = foLines.length ? await insertChunked("weekly_sales_lines", foLines) : null;
  if (foErr) return discard(`Gagal menyimpan baris F/O Journal: ${foErr}`);
  const purchaseErr = purchaseLines.length ? await insertChunked("weekly_purchase_lines", purchaseLines) : null;
  if (purchaseErr) return discard(`Gagal menyimpan baris pembelian harian: ${purchaseErr}`);

  // Latest upload wins per date: drop other uploads' lines for the dates this upload covers.
  // Penjualan per Artikel ("pos") and F/O Journal ("fo") lines are replaced separately.
  const dropOlder = (table: string, dateColumn: string, source?: "pos" | "fo") => {
    const q = supabase
      .from(table)
      .delete()
      .eq("property_id", propertyId)
      .neq("meeting_id", meetingId)
      .gte(dateColumn, report.periodStart)
      .lte(dateColumn, report.periodEnd);
    return source ? q.eq("source", source) : q;
  };
  const none = Promise.resolve({ error: null });
  const dropped = await Promise.all([
    journal || oldJournal ? dropOlder("weekly_sales_lines", "sale_date", "pos") : none,
    foJournal ? dropOlder("weekly_sales_lines", "sale_date", "fo") : none,
    // Without a purchase file this upload says nothing about purchases: keep the lines on file.
    purParsed ? dropOlder("weekly_purchase_lines", "receive_date") : none,
  ]);
  const lineErr = dropped.find((d) => d.error)?.error;
  if (lineErr) return { ok: false, error: `Data baru tersimpan, tetapi baris harian lama gagal diganti: ${lineErr.message}` };

  // Re-upload = overwrite, but only for the exact same data period, only after the new session
  // is fully saved, and only an upload that holds nothing this one lacks (an F/O Journal uploaded
  // on its own must not wipe the Penjualan per Artikel of the same month). Daily reports uploaded
  // under one meeting date must all stay: the range engine picks or sums the reports that fit a
  // range, so keeping several never double-counts.
  const kinds = (m: { revenue_filename: string | null; journal_filename: string | null; purchase_filename: string | null; fo_journal_filename: string | null }) => ({
    revenue: Boolean(m.revenue_filename && m.revenue_filename !== NO_FILE),
    journal: Boolean(m.journal_filename && m.journal_filename !== NO_FILE),
    purchase: Boolean(m.purchase_filename && m.purchase_filename !== NO_FILE),
    foJournal: Boolean(m.fo_journal_filename && m.fo_journal_filename !== NO_FILE),
  });
  const mine = kinds({
    revenue_filename: filenames.revenue,
    journal_filename: filenames.journal,
    purchase_filename: filenames.purchase,
    fo_journal_filename: filenames.foJournal,
  });
  const samePeriod = await supabase
    .from("weekly_meetings")
    .select("id, revenue_filename, journal_filename, purchase_filename, fo_journal_filename")
    .eq("property_id", propertyId)
    .neq("id", meetingId)
    .eq("period_start", report.periodStart)
    .eq("period_end", report.periodEnd);
  if (samePeriod.error) return { ok: false, error: `Data baru tersimpan, tetapi sesi lama gagal diperiksa: ${samePeriod.error.message}` };
  const superseded = (samePeriod.data ?? [])
    .filter((m) => Object.entries(kinds(m)).every(([k, has]) => !has || mine[k as keyof typeof mine]))
    .map((m) => m.id as string);
  if (superseded.length) {
    const { error } = await supabase.from("weekly_meetings").delete().in("id", superseded);
    if (error) return { ok: false, error: `Data baru tersimpan, tetapi sesi lama gagal diganti: ${error.message}` };
  }
  // A pull through a day that was still open (printed that same day) is replaced by a later pull
  // of the same start that covers that day (owner, 2026-11-21), so no half-day figure lingers.
  const firstPrinted = (days: (string | null | undefined)[]) => days.map(printedDay).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  const shorter = await supabase
    .from("weekly_meetings")
    .select("id, period_start, period_end, revenue_filename, journal_filename, purchase_filename, fo_journal_filename, revenue_exported_at, journal_exported_at, purchase_exported_at, fo_journal_exported_at, revenue_open_day")
    .eq("property_id", propertyId)
    .neq("id", meetingId)
    .eq("period_start", report.periodStart)
    .lt("period_end", report.periodEnd);
  if (shorter.error) return { ok: false, error: `Data baru tersimpan, tetapi data sementara lama gagal diperiksa: ${shorter.error.message}` };
  const provisional = supersededProvisional(
    {
      start: report.periodStart,
      end: report.periodEnd,
      printed: firstPrinted([
        foParsed ? exportedAt.revenue : null,
        journal ? exportedAt.journal : null,
        purParsed ? exportedAt.purchase : null,
        foJournal ? exportedAt.foJournal : null,
      ]),
      kinds: mine,
    },
    (shorter.data ?? []).map((m) => ({
      id: m.id as string,
      start: m.period_start as string,
      end: m.period_end as string,
      printed: firstPrinted([m.revenue_exported_at, m.journal_exported_at, m.purchase_exported_at, m.fo_journal_exported_at]),
      kinds: kinds(m),
      open: Boolean(m.revenue_open_day),
    })),
  );
  if (provisional.length) {
    const { error } = await supabase.from("weekly_meetings").delete().in("id", provisional);
    if (error) return { ok: false, error: `Data baru tersimpan, tetapi data sementara lama gagal diganti: ${error.message}` };
  }
  const replaced = superseded.length + provisional.length;

  invalidateTags(INVALIDATION_GROUPS.forVhpMutation(propertyId));
  revalidatePath("/");
  revalidatePath("/riwayat");
  revalidatePath("/pengaturan");
  revalidatePath("/marketing");

  return { ok: true, meetingId, replaced };
}

const listWeeklyMeetingsForProperty = cache(async (propertyId: string): Promise<SavedWeeklyMeeting[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["weekly-meetings-list"],
    tags: [CACHE_TAGS.vhpMeetings(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("weekly_meetings")
        .select("*")
        .eq("property_id", propertyId)
        .order("meeting_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as SavedWeeklyMeeting[];
    },
  }),
);

export async function listWeeklyMeetings(): Promise<SavedWeeklyMeeting[]> {
  const me = await currentUser();
  if (!me?.propertyId) return [];
  return listWeeklyMeetingsForProperty(me.propertyId);
}

const getWeeklyMeetingDataForProperty = cache(
  async (propertyId: string, meetingKey: string): Promise<FullWeeklyMeetingData | null> =>
    withPropertySupabaseCache({
      propertyId,
      keyParts: ["weekly-meeting-detail", meetingKey],
      tags: [CACHE_TAGS.vhpMeetings(propertyId)],
      revalidate: CACHE_TTL.vhp,
      query: async (supabase) => {
        const meetingId = meetingKey === "__latest__" ? undefined : meetingKey;
        const query = supabase.from("weekly_meetings").select("*").eq("property_id", propertyId);
        const { data: meeting } = meetingId
          ? await query.eq("id", meetingId).maybeSingle()
          : await query.order("meeting_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();

        if (!meeting) return null;

        const [{ data: prev }, { data: outlets }, { data: suppliers }, { data: purchaseItems }, { data: inventoryItems }, { data: outletItems }] =
          await Promise.all([
            supabase
              .from("weekly_meetings")
              .select("*")
              .eq("property_id", propertyId)
              .lt("period_end", meeting.period_start)
              .order("period_end", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase.from("weekly_outlet_metrics").select("*").eq("meeting_id", meeting.id).order("revenue_amount", { ascending: false }),
            supabase.from("weekly_purchase_suppliers").select("*").eq("meeting_id", meeting.id).order("purchase_amount", { ascending: false }),
            supabase.from("weekly_purchase_items").select("*").eq("meeting_id", meeting.id).order("total_amount", { ascending: false }),
            supabase.from("weekly_inventory_items").select("*").eq("meeting_id", meeting.id).order("total_value", { ascending: false }),
            supabase.from("weekly_outlet_items").select("*").eq("meeting_id", meeting.id).order("total_amount", { ascending: false }),
          ]);

        let prevOutletMap = new Map<string, number>();
        if (prev) {
          const { data: prevOutlets } = await supabase
            .from("weekly_outlet_metrics")
            .select("outlet_name, revenue_amount")
            .eq("meeting_id", prev.id);
          prevOutletMap = new Map((prevOutlets ?? []).map((o) => [o.outlet_name, Number(o.revenue_amount)]));
        }

        return {
          meeting: meeting as SavedWeeklyMeeting,
          previous: (prev as SavedWeeklyMeeting | null) ?? null,
          outlets: (outlets ?? []).map((o) => ({
            outlet_name: o.outlet_name,
            revenue_amount: Number(o.revenue_amount),
            revenue_qty: Number(o.revenue_qty),
            revenue_share_pct: Number(o.revenue_share_pct),
            inventory_amount: o.inventory_amount === null ? null : Number(o.inventory_amount),
            prev_revenue_amount: prevOutletMap.get(o.outlet_name) ?? null,
          })),
          suppliers: (suppliers ?? []).map((s) => ({
            supplier_name: s.supplier_name,
            purchase_amount: Number(s.purchase_amount),
            line_count: Number(s.line_count),
          })),
          purchaseItems: (purchaseItems ?? []).map((i) => ({
            ingredient_code: i.ingredient_code,
            description: i.description,
            unit: i.unit,
            total_qty: Number(i.total_qty),
            total_amount: Number(i.total_amount),
          })),
          inventoryItems: (inventoryItems ?? []).map((inv) => ({
            outlet_name: inv.outlet_name,
            item_code: inv.item_code,
            item_name: inv.item_name,
            unit: inv.unit,
            qty: Number(inv.qty),
            unit_price: Number(inv.unit_price),
            total_value: Number(inv.total_value),
          })),
          outletItems: (outletItems ?? []).map((it) => ({
            outlet_name: it.outlet_name,
            art_no: it.art_no ?? null,
            description: it.description,
            total_qty: Number(it.total_qty),
            total_amount: Number(it.total_amount),
          })),
        };
      },
    }),
);

export async function getWeeklyMeetingData(meetingId?: string): Promise<FullWeeklyMeetingData | null> {
  const me = await currentUser();
  if (!me?.propertyId) return null;
  return getWeeklyMeetingDataForProperty(me.propertyId, meetingId ?? "__latest__");
}

export async function deleteWeeklyMeeting(meetingId: string, expectedVersion: number): Promise<{ ok: boolean; error?: string }> {
  const me = await currentUser();
  if (!me?.propertyId) return { ok: false, error: "Sesi tidak valid." };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("weekly_meetings")
    .delete()
    .eq("id", meetingId)
    .eq("property_id", me.propertyId)
    .eq("version", expectedVersion)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "OCC Conflict (409): Data meeting telah diubah atau sudah dihapus." };
  }

  invalidateTags(INVALIDATION_GROUPS.forVhpMutation(me.propertyId));
  revalidatePath("/");
  revalidatePath("/riwayat");
  revalidatePath("/pengaturan");
  revalidatePath("/marketing");
  return { ok: true };
}

export type PresentationPeriodMode = "day" | "range" | "month";

export interface PresentationQueryResult {
  allMeetings: SavedWeeklyMeeting[];
  data: FullWeeklyMeetingData | null;
  matchedCount: number;
  mode: PresentationPeriodMode;
  selectedMeetingId: string;
  startDate: string;
  endDate: string;
  month: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Dashboard and presentation data for any period. A session ("day" mode) is the
 * period of that upload; "range" and "month" are free date ranges. All of them are
 * computed from the daily lines and F/O snapshots by computeRange().
 */
export async function getPresentationData(params: {
  mode?: string;
  meetingId?: string;
  startDate?: string;
  endDate?: string;
  month?: string;
  /** Also compute the previous period of equal length ("vs lalu"; off unless asked). */
  compare?: boolean;
}): Promise<PresentationQueryResult> {
  const allMeetings = await listWeeklyMeetings();
  const latest = allMeetings[0] ?? null;

  const mode: PresentationPeriodMode = params.mode === "range" || params.mode === "month" ? params.mode : "day";
  const selected = allMeetings.find((m) => m.id === params.meetingId) ?? latest;
  const selectedMeetingId = selected?.id ?? "";
  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : (latest?.period_end.slice(0, 7) ?? "");

  let startDate = latest?.period_start ?? "";
  let endDate = latest?.period_end ?? "";
  if (mode === "day" && selected) {
    startDate = selected.period_start;
    endDate = selected.period_end;
  } else if (mode === "range") {
    if (params.startDate && ISO_DATE.test(params.startDate)) startDate = params.startDate;
    if (params.endDate && ISO_DATE.test(params.endDate)) endDate = params.endDate;
    if (endDate < startDate) [startDate, endDate] = [endDate, startDate];
  } else if (mode === "month" && month) {
    startDate = `${month}-01`;
    // Up to the last day any upload covers in that month, so month-to-date F/O stays exact.
    const lastCovered = allMeetings.map((m) => m.period_end).filter((d) => d.startsWith(month)).sort().pop();
    endDate = lastCovered ?? lastDayOfMonth(month);
  }

  const empty = { allMeetings, data: null, matchedCount: 0, mode, selectedMeetingId, startDate, endDate, month };
  const me = await currentUser();
  if (!latest || !me?.propertyId) return empty;

  const overlapping = allMeetings.filter((m) => m.period_start <= endDate && m.period_end >= startDate);
  const data = await getRangeMeetingData(me.propertyId, allMeetings, startDate, endDate, overlapping[0] ?? selected ?? latest, params.compare === true);
  return { ...empty, data, matchedCount: overlapping.length };
}

const getInventoryItemsForMeeting = cache(async (propertyId: string, meetingId: string): Promise<Record<string, unknown>[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["weekly-inventory-items", meetingId],
    tags: [CACHE_TAGS.vhpMeetings(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("weekly_inventory_items")
        .select("*")
        .eq("meeting_id", meetingId)
        .order("total_value", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Record<string, unknown>[];
    },
  }),
);

async function getRangeMeetingData(
  propertyId: string,
  meetings: SavedWeeklyMeeting[],
  start: string,
  end: string,
  anchor: SavedWeeklyMeeting,
  compare: boolean,
): Promise<FullWeeklyMeetingData | null> {
  const length = daysBetween(start, end);
  const prevEnd = shiftDays(start, -1);
  const prevStart = shiftDays(prevEnd, -(length - 1));
  const invMeeting = meetings.find((m) => m.inventory_filename !== NO_FILE && m.period_end <= end) ?? null;

  const [range, prev, invItems] = await Promise.all([
    computeRange(propertyId, meetings, start, end),
    // The previous period only feeds comparisons (presentation deck); the dashboard skips it.
    compare ? computeRange(propertyId, meetings, prevStart, prevEnd) : Promise.resolve(null),
    invMeeting ? getInventoryItemsForMeeting(propertyId, invMeeting.id) : Promise.resolve([] as Record<string, unknown>[]),
  ]);

  if (range.revenue.source === "none" && range.purchase.total === 0 && !invMeeting) return null;

  const totalRevenue = range.revenue.total;
  const totalPurchase = range.purchase.total;
  const totalInventory = invMeeting ? Number(invMeeting.total_inventory) : 0;
  const prevAvailable = prev !== null && prev.revenue.source !== "none";
  const prevOutlet = new Map((prev?.revenue.outlets ?? []).map((o) => [o.outlet_name, o.revenue]));

  const meeting: SavedWeeklyMeeting = {
    ...anchor,
    title: `Periode ${start} s.d. ${end}`,
    period_start: start,
    period_end: end,
    total_revenue: totalRevenue,
    total_purchase: totalPurchase,
    total_inventory: totalInventory,
    purchase_to_revenue_pct: totalRevenue > 0 ? (totalPurchase / totalRevenue) * 100 : 0,
    inventory_to_revenue_ratio: totalRevenue > 0 ? totalInventory / totalRevenue : 0,
    inventory_filename: invMeeting?.inventory_filename ?? NO_FILE,
    has_outlet_inventory: invMeeting?.has_outlet_inventory ?? false,
  };

  return {
    meeting,
    previous: prevAvailable
      ? { ...anchor, id: "previous", period_start: prevStart, period_end: prevEnd, total_revenue: prev.revenue.total, total_purchase: prev.purchase.total }
      : null,
    outlets: range.revenue.outlets.map((o) => ({
      outlet_name: o.outlet_name,
      revenue_amount: o.revenue ?? 0,
      revenue_available: o.revenue !== null,
      revenue_source: o.source,
      revenue_qty: o.qty,
      revenue_share_pct: totalRevenue > 0 && o.revenue !== null ? (o.revenue / totalRevenue) * 100 : 0,
      inventory_amount: null,
      prev_revenue_amount: prevAvailable ? (prevOutlet.get(o.outlet_name) ?? null) : null,
    })),
    suppliers: range.purchase.suppliers,
    purchaseItems: range.purchase.items.slice(0, 15),
    purchaseGroups: groupPurchases(range.purchase.items),
    inventoryItems: (invItems ?? []).map((inv) => ({
      outlet_name: (inv.outlet_name as string | null) ?? null,
      item_code: (inv.item_code as string | null) ?? null,
      item_name: String(inv.item_name),
      unit: (inv.unit as string | null) ?? null,
      qty: Number(inv.qty),
      unit_price: Number(inv.unit_price),
      total_value: Number(inv.total_value),
    })),
    outletItems: range.items,
    range: {
      revenueSource: range.revenue.source,
      revenueNotes: range.revenue.notes,
      missingOutlets: range.revenue.missingOutlets,
      purchaseNotes: range.purchase.notes,
      salesCoverage: range.salesCoverage,
      purchaseCoverage: range.purchaseCoverage,
      journalFilename: meetings.find((m) => m.journal_filename && m.period_start <= end && m.period_end >= start)?.journal_filename ?? null,
    },
  };
}
