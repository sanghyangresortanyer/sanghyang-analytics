import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDmlSheet, parseDmlSheetDate, type DmlSheet, type SheetRow } from "./dml-parser";
import { parseHkWorkbook, type HkMonth, type HkParseResult } from "./hk-parser";
import { downloadSheetXlsx, sheetFileId, SHEET_SOURCES, type SheetSource, type StockStore } from "./source";
import { dropImplausibleValues, nameUnnamedStockTab, parseBeverageStore, priceTabRows, withPriceTab } from "./store-sheets";
import { readWorkbookRows } from "./workbook-reader";

export interface SourceSyncResult {
  source: SheetSource;
  label: string;
  status: "changed" | "unchanged" | "error" | "not_configured";
  message: string;
}

type Admin = ReturnType<typeof createAdminClient>;

const MAX_STORED_WARNINGS = 300;
/** DML sheets per RPC call, to keep each request body well under a few MB. */
const DML_SHEETS_PER_CALL = 8;

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function writeState(admin: Admin, row: Record<string, unknown>) {
  const { error } = await admin.from("sheet_sync_state").upsert(row, { onConflict: "property_id,source" });
  if (error) throw new Error(`Status sinkron gagal disimpan: ${error.message}`);
}

const monthStart = (month: string) => `${month}-01`;

function hkItemPayload(m: HkMonth) {
  return m.items.map((i) => ({
    period_month: monthStart(m.month),
    row_no: i.rowNo,
    item_code: i.itemCode,
    item_name: i.itemName,
    unit: i.unit,
    content: i.content,
    stock_awal: i.stockAwal,
    total_in: i.totalIn,
    total_out: i.totalOut,
    stock_akhir: i.stockAkhir,
    average_price: i.averagePrice,
    last_price: i.lastPrice,
    stock_value: i.stockValue,
  }));
}

function hkMovementPayload(m: HkMonth) {
  return m.movements.map((mv) => ({
    period_month: monthStart(m.month),
    movement_date: mv.date,
    item_code: mv.itemCode,
    day: mv.day,
    qty_in: mv.qtyIn,
    qty_out: mv.qtyOut,
    location: mv.location,
  }));
}

/** What one pull shares between sources: today (WIB) and a VHP price list for the sheet without one. */
interface PullContext {
  today: string;
  priceRows: SheetRow[] | null;
}

/** Reads one stock sheet into month tabs; Main Store, Engineering and the beverage store differ from HK (store-sheets.ts). */
function parseStore(store: StockStore, sheets: Map<string, SheetRow[]>, ctx: PullContext): HkParseResult {
  if (store === "bev") return parseBeverageStore(sheets, ctx.today);
  const named = store === "hk" ? { sheets, warnings: [] } : nameUnnamedStockTab(sheets, ctx.today);
  const parsed = parseHkWorkbook(store === "eng" ? withPriceTab(named.sheets, ctx.priceRows) : named.sheets);
  return { ...parsed, warnings: [...named.warnings, ...parsed.warnings] };
}

async function syncStore(admin: Admin, propertyId: string, store: StockStore, label: string, fileId: string, ctx: PullContext): Promise<SourceSyncResult> {
  const sheets = await readWorkbookRows(await downloadSheetXlsx(fileId), () => true);
  // Engineering has no VHP price tab: it borrows the first one met (HK, then Main Store).
  if (!ctx.priceRows) ctx.priceRows = priceTabRows(sheets);
  const parsed = dropImplausibleValues(parseStore(store, sheets, ctx));
  const hashes = new Map(
    parsed.months.map((m) => [m.month, sha256({ s: m.sheetName, i: m.items, mv: m.movements, w: m.warnings })]),
  );

  const { data: stored, error: storedErr } = await admin
    .from("sheet_hk_months")
    .select("period_month, content_hash")
    .eq("property_id", propertyId)
    .eq("store", store);
  if (storedErr) throw new Error(`Data ${label} lama gagal dibaca: ${storedErr.message}`);
  const storedHash = new Map((stored ?? []).map((r) => [String(r.period_month).slice(0, 7), r.content_hash as string]));

  const changed = parsed.months.filter((m) => storedHash.get(m.month) !== hashes.get(m.month));
  const removed = [...storedHash.keys()].filter((month) => !hashes.has(month));
  if (changed.length > 0 || removed.length > 0) {
    const { error } = await admin.rpc("apply_store_months", {
      p_property_id: propertyId,
      p_store: store,
      p_present: parsed.months.map((m) => monthStart(m.month)),
      p_months: changed.map((m) => ({
        period_month: monthStart(m.month),
        sheet_name: m.sheetName,
        content_hash: hashes.get(m.month),
        item_count: m.stats.itemCount,
        total_value: m.stats.totalValue,
        warnings: m.warnings,
      })),
      p_items: changed.flatMap(hkItemPayload),
      p_movements: changed.flatMap(hkMovementPayload),
    });
    if (error) throw new Error(`Data ${label} gagal disimpan: ${error.message}`);
  }

  const { data: prev } = await admin
    .from("sheet_sync_state")
    .select("last_changed_at")
    .eq("property_id", propertyId)
    .eq("source", store)
    .maybeSingle();
  const now = new Date().toISOString();
  const isChanged = changed.length > 0 || removed.length > 0;
  const warnings = [...parsed.warnings, ...parsed.months.flatMap((m) => m.warnings.map((w) => `${m.sheetName}: ${w}`))];
  await writeState(admin, {
    property_id: propertyId,
    source: store,
    status: "ok",
    content_hash: sha256([...hashes].sort()),
    last_checked_at: now,
    last_changed_at: isChanged ? now : prev?.last_changed_at ?? now,
    error: null,
    warnings: warnings.slice(0, MAX_STORED_WARNINGS),
    stats: {
      months: parsed.months.map((m) => ({ month: m.month, sheet: m.sheetName, ...m.stats, movementCount: m.movements.length })),
      priceSheet: parsed.priceSheet,
    },
  });

  const itemCount = parsed.months.reduce((n, m) => n + m.stats.itemCount, 0);
  return {
    source: store,
    label,
    status: isChanged ? "changed" : "unchanged",
    message: `${parsed.months.map((m) => m.sheetName).join(", ")}: ${itemCount} item, ${warnings.length} peringatan${
      isChanged ? ` (${changed.length} bulan diperbarui${removed.length ? `, ${removed.length} dihapus` : ""})` : ""
    }`,
  };
}

function dmlSheetPayload(s: DmlSheet, hash: string) {
  return {
    sheet_name: s.sheetName,
    list_date: s.listDate,
    content_hash: hash,
    total_request: s.totalRequest,
    sheet_grand_total: s.sheetGrandTotal,
    line_count: s.lines.length,
    outlets: s.outlets,
    warnings: s.warnings,
  };
}

function dmlLinePayload(s: DmlSheet) {
  return s.lines.map((l) => ({
    sheet_name: s.sheetName,
    list_date: s.listDate,
    row_no: l.rowNo,
    outlet: l.outlet,
    item_code: l.itemCode,
    item_name: l.itemName,
    unit: l.unit,
    price: l.price,
    soh: l.soh,
    qty_req: l.qtyReq,
    total: l.total,
    purchase_channel: l.purchaseChannel,
    note: l.note,
  }));
}

/**
 * Earliest DML list date to keep (DML_MIN_LIST_DATE, YYYY-MM-DD). Older sheets are
 * skipped and removed from the database; unset keeps every dated sheet.
 */
function dmlMinListDate(): string | null {
  const raw = process.env.DML_MIN_LIST_DATE?.trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`DML_MIN_LIST_DATE harus YYYY-MM-DD, terisi "${raw}".`);
  return raw;
}

async function syncDml(admin: Admin, propertyId: string, fileId: string): Promise<SourceSyncResult> {
  const minDate = dmlMinListDate();
  const rows = await readWorkbookRows(await downloadSheetXlsx(fileId), (name) => {
    const date = parseDmlSheetDate(name);
    return date !== null && (minDate === null || date >= minDate);
  });
  if (rows.size === 0) {
    throw new Error(
      minDate
        ? `Tidak ada sheet DML bertanggal sejak ${minDate} (DML_MIN_LIST_DATE).`
        : 'Tidak ada sheet bertanggal (contoh "15-11-26") di file DML.',
    );
  }
  const sheets = [...rows].map(([name, r]) => parseDmlSheet(name, r));
  const hashes = new Map(sheets.map((s) => [s.sheetName, sha256({ l: s.lines, o: s.outlets, g: s.sheetGrandTotal, w: s.warnings })]));

  const { data: stored, error: storedErr } = await admin
    .from("sheet_dml_sheets")
    .select("sheet_name, content_hash")
    .eq("property_id", propertyId);
  if (storedErr) throw new Error(`Data DML lama gagal dibaca: ${storedErr.message}`);
  const storedHash = new Map((stored ?? []).map((s) => [s.sheet_name as string, s.content_hash as string]));

  const present = sheets.map((s) => s.sheetName);
  const changedSheets = sheets.filter((s) => storedHash.get(s.sheetName) !== hashes.get(s.sheetName));
  const removed = [...storedHash.keys()].filter((name) => !hashes.has(name));

  const batches: DmlSheet[][] = [];
  for (let i = 0; i < changedSheets.length; i += DML_SHEETS_PER_CALL) batches.push(changedSheets.slice(i, i + DML_SHEETS_PER_CALL));
  if (batches.length === 0 && removed.length > 0) batches.push([]);
  for (const batch of batches) {
    const { error } = await admin.rpc("apply_dml_sheets", {
      p_property_id: propertyId,
      p_present: present,
      p_sheets: batch.map((s) => dmlSheetPayload(s, hashes.get(s.sheetName)!)),
      p_lines: batch.flatMap(dmlLinePayload),
    });
    if (error) throw new Error(`Data DML gagal disimpan: ${error.message}`);
  }

  const changed = changedSheets.length > 0 || removed.length > 0;
  const { data: prev } = await admin
    .from("sheet_sync_state")
    .select("last_changed_at")
    .eq("property_id", propertyId)
    .eq("source", "dml")
    .maybeSingle();
  const now = new Date().toISOString();
  const sorted = [...sheets].sort((a, b) => a.listDate.localeCompare(b.listDate));
  const warnings = sorted.flatMap((s) => s.warnings.map((w) => `${s.sheetName}: ${w}`));
  await writeState(admin, {
    property_id: propertyId,
    source: "dml",
    status: "ok",
    content_hash: sha256([...hashes].sort()),
    last_checked_at: now,
    last_changed_at: changed ? now : prev?.last_changed_at ?? now,
    error: null,
    warnings: warnings.slice(-MAX_STORED_WARNINGS),
    stats: {
      sheetCount: sheets.length,
      lineCount: sheets.reduce((n, s) => n + s.lines.length, 0),
      latestListDate: sorted.at(-1)?.listDate ?? null,
      warningCount: warnings.length,
    },
  });

  return {
    source: "dml",
    label: "DML Pembelian Outlet",
    status: changed ? "changed" : "unchanged",
    message: changed
      ? `${changedSheets.length} sheet diperbarui${removed.length ? `, ${removed.length} dihapus` : ""} dari ${sheets.length}`
      : `${sheets.length} sheet, tidak ada perubahan`,
  };
}

/**
 * Pulls every configured sheet for one property. A failing source is recorded
 * in sheet_sync_state with its error and reported; it never blocks the other.
 */
export async function syncAllSheets(propertyId: string): Promise<SourceSyncResult[]> {
  const admin = createAdminClient();
  const results: SourceSyncResult[] = [];
  const ctx: PullContext = { today: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10), priceRows: null };
  for (const { source, label } of SHEET_SOURCES) {
    try {
      const fileId = sheetFileId(source);
      if (!fileId) {
        results.push({ source, label, status: "not_configured", message: "ID sheet belum diisi di env." });
        continue;
      }
      results.push(source === "dml" ? await syncDml(admin, propertyId, fileId) : await syncStore(admin, propertyId, source, label, fileId, ctx));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ source, label, status: "error", message });
      try {
        await writeState(admin, {
          property_id: propertyId,
          source,
          status: "error",
          error: message,
          last_checked_at: new Date().toISOString(),
        });
      } catch (stateErr) {
        results[results.length - 1].message += ` (status juga gagal disimpan: ${(stateErr as Error).message})`;
      }
    }
  }
  return results;
}
