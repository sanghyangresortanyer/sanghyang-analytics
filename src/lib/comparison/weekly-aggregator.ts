import type { ParsedRestaurantSalesRow } from "@/lib/sales/restaurant-journal-parser";
import type { FoTurnoverParseResult } from "@/lib/parsers/fo-turnover-parser";
import type { ParsedPurchaseRow } from "@/lib/parsers/purchase-receipts";
import type { InventorySpreadsheetParseResult } from "@/lib/parsers/inventory-spreadsheet";
import type { JournalByBillRow } from "@/lib/sales/journal-by-bill-parser";
import { resolveJournalOutlet } from "@/lib/dashboard/range-report";

interface OutletComparisonRow {
  outletName: string;
  revenueAmount: number;
  revenueQty: number;
  revenueSharePct: number;
  inventoryAmount: number | null;
  prevRevenueAmount: number | null;
  revenueDeltaPct: number | null;
}

interface SupplierPurchaseSummary {
  supplierName: string;
  purchaseAmount: number;
  lineCount: number;
  sharePct: number;
}

interface TopPurchaseItemSummary {
  ingredientCode: string;
  description: string;
  unit: string;
  totalQty: number;
  totalAmount: number;
}

export interface PreviousMeetingBaseline {
  meetingDate: string;
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalPurchase: number;
  totalInventory: number;
  outletRevenues: Record<string, number>;
}

export interface WeeklyComparisonReport {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalPurchase: number;
  totalInventory: number;
  purchaseToRevenuePct: number;
  inventoryToRevenueRatio: number;
  hasOutletInventory: boolean;
  wow: {
    hasPrevious: boolean;
    previousPeriodLabel: string | null;
    revenueDeltaPct: number | null;
    purchaseDeltaPct: number | null;
    inventoryDeltaPct: number | null;
  };
  outlets: OutletComparisonRow[];
  suppliers: SupplierPurchaseSummary[];
  topPurchaseItems: TopPurchaseItemSummary[];
  callouts: string[];
  audit: {
    inRangeRevenueRows: number;
    includedSalesRows: number;
    excludedPaymentRows: number;
    outOfRangeRevenueRows: number;
    inRangePurchaseRows: number;
    outOfRangePurchaseRows: number;
    validInventoryRows: number;
  };
  warnings: string[];
}

const PAYMENT_DESCRIPTION_RE =
  /\b(cash|debit|credit|visa|master|officer\s*check|company\s*ledger|city\s*ledger|entertain|qris|voucher|transfer|edc|bca|mandiri|bni|bri)\b/i;

function isSettlementOrPaymentRow(row: ParsedRestaurantSalesRow): boolean {
  if (row.amount < 0) return true;
  if (!row.artNo.trim() && PAYMENT_DESCRIPTION_RE.test(row.description)) return true;
  if (!row.department.trim() && PAYMENT_DESCRIPTION_RE.test(row.description)) return true;
  return false;
}

function pctDelta(current: number, previous: number | null | undefined): number | null {
  if (
    !Number.isFinite(current) ||
    previous === null ||
    previous === undefined ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  return Number.isFinite(delta) ? delta : null;
}

function formatRpCompact(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function buildWeeklyComparison(params: {
  periodStart: string;
  periodEnd: string;
  revenueRows?: ParsedRestaurantSalesRow[];
  foTurnover?: FoTurnoverParseResult | null;
  /** "Rest. Transaction Journal by BillNo" lines; revenue source when no F/O report is given. */
  journalRows?: JournalByBillRow[];
  /** F/O department names already known for this property, to expand the journal's cut names. */
  knownOutlets?: string[];
  purchaseRows: ParsedPurchaseRow[];
  inventoryResult?: InventorySpreadsheetParseResult | null;
  previousMeeting?: PreviousMeetingBaseline | null;
}): WeeklyComparisonReport {
  const { periodStart, periodEnd, revenueRows = [], foTurnover, journalRows = [], knownOutlets = [], purchaseRows, inventoryResult, previousMeeting } = params;
  const warnings: string[] = [...(inventoryResult?.warnings ?? [])];
  if (!inventoryResult) {
    warnings.push("Data Inventory belum diunggah; perbandingan menampilkan Revenue dan Pembelian.");
  }

  // 1. Revenue aggregation: either F/O Turnover Report (MTD-Gros per department) or Transaction Journal
  let outOfRangeRevenueRows = 0;
  let excludedPaymentRows = 0;
  let includedSalesRows = 0;
  let totalRevenue = 0;

  const outletRevMap = new Map<string, { amount: number; qty: number }>();

  if (foTurnover) {
    warnings.push(...foTurnover.warnings);
    for (const dept of foTurnover.departments) {
      includedSalesRows++;
      totalRevenue += dept.mtdGros;
      const outlet = dept.departmentName.trim() || "Tanpa Outlet";
      const cur = outletRevMap.get(outlet) ?? { amount: 0, qty: 0 };
      cur.amount += dept.mtdGros;
      outletRevMap.set(outlet, cur);
    }
    if (foTurnover.periodStart && foTurnover.periodEnd && (foTurnover.periodStart !== periodStart || foTurnover.periodEnd !== periodEnd)) {
      warnings.push(
        `Periode pada file F/O Turnover (${foTurnover.periodStart} s.d. ${foTurnover.periodEnd}) berbeda dengan periode meeting (${periodStart} s.d. ${periodEnd}).`
      );
    }
  } else if (journalRows.length > 0) {
    // Gross sales per outlet, less complimentary payments (coupon, entertain, officer check), as F/O counts it.
    for (const row of journalRows) {
      if (row.saleDate < periodStart || row.saleDate > periodEnd) {
        outOfRangeRevenueRows++;
        continue;
      }
      const amount = row.sales - (row.isComplimentary ? -row.payment : 0);
      if (amount === 0) {
        excludedPaymentRows++;
        continue;
      }
      includedSalesRows++;
      totalRevenue += amount;
      const outlet = resolveJournalOutlet(row.department, knownOutlets) || "Tanpa Outlet";
      const cur = outletRevMap.get(outlet) ?? { amount: 0, qty: 0 };
      cur.amount += amount;
      if (row.sales > 0) cur.qty += row.qty;
      outletRevMap.set(outlet, cur);
    }
    if (outOfRangeRevenueRows > 0) {
      warnings.push(`${outOfRangeRevenueRows} baris Journal berada di luar periode ${periodStart} s.d. ${periodEnd} dan tidak diikutsertakan.`);
    }
    warnings.push("Revenue dari Journal transaksi (tanpa F/O Turnover): Front Office dan outlet di luar Journal tidak termasuk.");
  } else {
    for (const row of revenueRows) {
      if (row.saleDate < periodStart || row.saleDate > periodEnd) {
        outOfRangeRevenueRows++;
        continue;
      }
      if (isSettlementOrPaymentRow(row)) {
        excludedPaymentRows++;
        continue;
      }
      includedSalesRows++;
      totalRevenue += row.amount;
      const outlet = row.department.trim() || "Tanpa Outlet";
      const cur = outletRevMap.get(outlet) ?? { amount: 0, qty: 0 };
      cur.amount += row.amount;
      cur.qty += row.qty;
      outletRevMap.set(outlet, cur);
    }

    if (outOfRangeRevenueRows > 0) {
      warnings.push(
        `${outOfRangeRevenueRows} baris file Revenue berada di luar periode ${periodStart} s.d. ${periodEnd} dan tidak diikutsertakan.`
      );
    }
  }

  // 2. Purchase aggregation (filter strictly to [periodStart, periodEnd])
  let outOfRangePurchaseRows = 0;
  let inRangePurchaseRows = 0;
  let totalPurchase = 0;

  const supplierMap = new Map<string, { amount: number; lineCount: number }>();
  const itemMap = new Map<string, TopPurchaseItemSummary>();

  for (const row of purchaseRows) {
    if (row.businessDate < periodStart || row.businessDate > periodEnd) {
      outOfRangePurchaseRows++;
      continue;
    }
    inRangePurchaseRows++;
    const lineAmount = row.value ?? row.price * row.qty;
    totalPurchase += lineAmount;

    const sup = row.supplier?.trim() || "Supplier Tidak Tercatat";
    const supCur = supplierMap.get(sup) ?? { amount: 0, lineCount: 0 };
    supCur.amount += lineAmount;
    supCur.lineCount += 1;
    supplierMap.set(sup, supCur);

    const itemKey = `${row.ingredientCode}|${row.unit}`;
    const itemCur = itemMap.get(itemKey) ?? {
      ingredientCode: row.ingredientCode,
      description: row.description,
      unit: row.unit,
      totalQty: 0,
      totalAmount: 0,
    };
    itemCur.totalQty += row.qty;
    itemCur.totalAmount += lineAmount;
    itemMap.set(itemKey, itemCur);
  }

  if (outOfRangePurchaseRows > 0) {
    warnings.push(
      `${outOfRangePurchaseRows} baris file Pembelian berada di luar periode ${periodStart} s.d. ${periodEnd} dan tidak diikutsertakan.`
    );
  }

  // 3. Inventory aggregation (never fabricate per-outlet if hasOutletColumn is false or unuploaded)
  const totalInventory = inventoryResult?.stats.totalValue ?? 0;
  const hasOutletInventory = Boolean(inventoryResult?.hasOutletColumn);
  const outletInvMap = new Map<string, number>();
  if (hasOutletInventory && inventoryResult) {
    for (const row of inventoryResult.rows) {
      const outlet = row.outletName?.trim() || "Tanpa Outlet";
      outletInvMap.set(outlet, (outletInvMap.get(outlet) ?? 0) + row.totalValue);
    }
  }

  const allOutlets = new Set<string>([...outletRevMap.keys(), ...outletInvMap.keys()]);
  const outlets: OutletComparisonRow[] = [...allOutlets]
    .map((outletName) => {
      const rev = outletRevMap.get(outletName) ?? { amount: 0, qty: 0 };
      const inv = hasOutletInventory ? (outletInvMap.get(outletName) ?? 0) : null;
      const prevRev = previousMeeting?.outletRevenues[outletName] ?? null;
      return {
        outletName,
        revenueAmount: rev.amount,
        revenueQty: rev.qty,
        revenueSharePct: totalRevenue > 0 ? (rev.amount / totalRevenue) * 100 : 0,
        inventoryAmount: inv,
        prevRevenueAmount: prevRev,
        revenueDeltaPct: pctDelta(rev.amount, prevRev),
      };
    })
    .sort((a, b) => b.revenueAmount - a.revenueAmount);

  const suppliers: SupplierPurchaseSummary[] = [...supplierMap.entries()]
    .map(([supplierName, val]) => ({
      supplierName,
      purchaseAmount: val.amount,
      lineCount: val.lineCount,
      sharePct: totalPurchase > 0 ? (val.amount / totalPurchase) * 100 : 0,
    }))
    .sort((a, b) => b.purchaseAmount - a.purchaseAmount);

  const topPurchaseItems = [...itemMap.values()]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 15);

  const purchaseToRevenuePct = totalRevenue > 0 ? (totalPurchase / totalRevenue) * 100 : 0;
  const inventoryToRevenueRatio = totalRevenue > 0 ? totalInventory / totalRevenue : 0;

  const revenueDeltaPct = pctDelta(totalRevenue, previousMeeting?.totalRevenue);
  const purchaseDeltaPct = pctDelta(totalPurchase, previousMeeting?.totalPurchase);
  const inventoryDeltaPct = pctDelta(totalInventory, previousMeeting?.totalInventory);

  // 4. Factual callouts for Monday meeting slides (no fabrication)
  const callouts: string[] = [];
  if (outlets.length > 0 && outlets[0].revenueAmount > 0) {
    const topOutlet = outlets[0];
    callouts.push(
      `Outlet kontributor tertinggi: ${topOutlet.outletName} sebesar ${formatRpCompact(topOutlet.revenueAmount)} (${topOutlet.revenueSharePct.toFixed(1)}% dari total revenue).`
    );
  }
  if (suppliers.length > 0 && suppliers[0].purchaseAmount > 0) {
    const topSup = suppliers[0];
    callouts.push(
      `Supplier terbesar minggu ini: ${topSup.supplierName} sebesar ${formatRpCompact(topSup.purchaseAmount)} (${topSup.sharePct.toFixed(1)}% dari total pembelian).`
    );
  }
  if (totalRevenue > 0) {
    callouts.push(
      `Rasio Pembelian terhadap Revenue: ${purchaseToRevenuePct.toFixed(1)}% (${formatRpCompact(totalPurchase)} / ${formatRpCompact(totalRevenue)}).`
    );
  }
  if (revenueDeltaPct !== null && purchaseDeltaPct !== null && purchaseDeltaPct > 15 && revenueDeltaPct < 0) {
    callouts.push(
      `Perhatian: Pembelian naik ${purchaseDeltaPct.toFixed(1)}% sementara Revenue turun ${Math.abs(revenueDeltaPct).toFixed(1)}% dibanding periode sebelumnya.`
    );
  }

  return {
    periodStart,
    periodEnd,
    totalRevenue,
    totalPurchase,
    totalInventory,
    purchaseToRevenuePct,
    inventoryToRevenueRatio,
    hasOutletInventory,
    wow: {
      hasPrevious: Boolean(previousMeeting),
      previousPeriodLabel: previousMeeting
        ? `${previousMeeting.periodStart} s.d. ${previousMeeting.periodEnd}`
        : null,
      revenueDeltaPct,
      purchaseDeltaPct,
      inventoryDeltaPct,
    },
    outlets,
    suppliers,
    topPurchaseItems,
    callouts,
    audit: {
      inRangeRevenueRows: includedSalesRows + excludedPaymentRows,
      includedSalesRows,
      excludedPaymentRows,
      outOfRangeRevenueRows,
      inRangePurchaseRows,
      outOfRangePurchaseRows,
      validInventoryRows: inventoryResult?.stats.validRows ?? 0,
    },
    warnings,
  };
}
