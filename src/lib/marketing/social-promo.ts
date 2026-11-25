/**
 * Audit Promo: sales of a promoted menu in the 7 days before and the 7 days from the post (owner, 2026-11-23;
 * rules tightened 24 Nov: the first version judged after 2 days and called 0 → 0 portions a failure).
 */
import { tillOutlet } from "./promo-detect.ts";

export type PromoVerdict = "NAIK" | "NAIK_TIPIS" | "TIDAK_NAIK" | "SEDIKIT" | "MENUNGGU_DATA";
export const PROMO_DAYS = 7;
/** Fewer portions than this over both weeks together say nothing. */
export const MIN_PORTIONS = 10;
const CLEAR_RISE_PCT = 25;

export interface DailySalesItem {
  saleDate: string; // YYYY-MM-DD
  qty: number;
  amount: number;
}

export interface PromoLift {
  beforeDays: number;
  afterDays: number;
  beforeQty: number;
  afterQty: number;
  beforeAmount: number;
  afterAmount: number;
  /** Change in portions, week against week (each weekday once on both sides); null without a base. */
  qtyPct: number | null;
  verdict: PromoVerdict;
  reason: string;
  days: { date: string; after: boolean; isPost: boolean; hasData: boolean; qty: number; amount: number }[];
}

export interface PromoEventRecord {
  id: string;
  post_date: string;
  platform: string;
  outlet_name: string;
  promo_title: string;
  menu_keyword: string;
  post_url?: string | null;
  source_post_id?: string | null;
}

export interface PromoAuditItem {
  event: PromoEventRecord;
  lift: PromoLift;
  menus: string[];
}

export function shiftDate(dateStr: string, dayOffset: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset)).toISOString().slice(0, 10);
}

/** A weighed dish is sold as "(Ons) X" plus "(0.1 Ons) X" for the tenths: ten tenths are one ons. */
export const portions = (description: string, qty: number): number => (/^\(0[.,]1\s*ons\)/i.test(description) ? qty / 10 : qty);

const num = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 1 });

export function computePromoLift(postDate: string, sales: DailySalesItem[], latestDataDate: string): PromoLift {
  const byDate = new Map<string, { qty: number; amount: number }>();
  for (const r of sales) {
    const x = byDate.get(r.saleDate) ?? { qty: 0, amount: 0 };
    byDate.set(r.saleDate, { qty: x.qty + r.qty, amount: x.amount + r.amount });
  }
  const days: PromoLift["days"] = [];
  for (let o = -PROMO_DAYS; o < PROMO_DAYS; o++) {
    const date = shiftDate(postDate, o);
    days.push({ date, after: o >= 0, isPost: o === 0, hasData: date <= latestDataDate, ...(byDate.get(date) ?? { qty: 0, amount: 0 }) });
  }
  const sum = (after: boolean, k: "qty" | "amount") => days.filter((d) => d.after === after && d.hasData).reduce((t, d) => t + d[k], 0);
  const afterDays = days.filter((d) => d.after && d.hasData).length;
  const beforeQty = sum(false, "qty");
  const afterQty = sum(true, "qty");
  const full = afterDays === PROMO_DAYS;
  const qtyPct = full && beforeQty > 0 ? Math.round(((afterQty - beforeQty) / beforeQty) * 100) : null;
  let verdict: PromoVerdict;
  let reason: string;
  if (!full) {
    verdict = "MENUNGGU_DATA";
    reason = `Baru ${afterDays} dari ${PROMO_DAYS} hari sejak tayang yang datanya sudah masuk. Dinilai setelah lengkap.`;
  } else if (beforeQty + afterQty < MIN_PORTIONS) {
    verdict = "SEDIKIT";
    reason = `Penjualannya terlalu sedikit untuk dinilai (${num(beforeQty)} porsi sebelum, ${num(afterQty)} sesudah).`;
  } else if (qtyPct === null || qtyPct >= CLEAR_RISE_PCT) {
    verdict = "NAIK";
    reason = `Porsi naik dari ${num(beforeQty)} menjadi ${num(afterQty)}${qtyPct === null ? "" : ` (+${qtyPct}%)`}. Belum tentu karena postingan: cek juga tamu rombongan dan hari libur.`;
  } else if (qtyPct > 0) {
    verdict = "NAIK_TIPIS";
    reason = `Porsi naik tipis dari ${num(beforeQty)} menjadi ${num(afterQty)} (+${qtyPct}%), masih bisa naik turun biasa.`;
  } else {
    verdict = "TIDAK_NAIK";
    reason = `Porsi tidak naik: ${num(beforeQty)} menjadi ${num(afterQty)} (${qtyPct}%).`;
  }
  return { beforeDays: days.filter((d) => !d.after && d.hasData).length, afterDays, beforeQty, afterQty, beforeAmount: sum(false, "amount"), afterAmount: sum(true, "amount"), qtyPct, verdict, reason, days };
}

/** All audits that are not ignored, newest post first, measured against the till (batched query, zero N+1). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPromoAudits(supabase: any, propertyId: string): Promise<{ audits: PromoAuditItem[]; problem: string | null; dataUntil: string | null }> {
  const [ev, last] = await Promise.all([
    supabase.from("social_promo_events").select("id, post_date, platform, outlet_name, promo_title, menu_keyword, post_url, source_post_id").eq("property_id", propertyId).eq("ignored", false).order("post_date", { ascending: false }),
    supabase.from("weekly_sales_lines").select("sale_date").eq("property_id", propertyId).order("sale_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const dataUntil = (last.data?.sale_date as string | undefined) ?? null;
  if (ev.error || last.error) return { audits: [], problem: "Audit promo tidak bisa dibaca dari database.", dataUntil };

  const events = (ev.data ?? []) as PromoEventRecord[];
  if (events.length === 0) return { audits: [], problem: null, dataUntil };

  const ranges = events.map((event) => ({
    event,
    till: tillOutlet(event.outlet_name),
    fromDate: shiftDate(event.post_date, -PROMO_DAYS),
    toDate: shiftDate(event.post_date, PROMO_DAYS),
    kwLower: event.menu_keyword === "*" ? "*" : event.menu_keyword.replace(/[%_\\]/g, "").toLowerCase(),
  }));
  const tills = [...new Set(ranges.map((r) => r.till))];
  const minFrom = ranges.reduce((min, r) => (r.fromDate < min ? r.fromDate : min), ranges[0].fromDate);
  const maxTo = ranges.reduce((max, r) => (r.toDate > max ? r.toDate : max), ranges[0].toDate);

  type RawLine = { sale_date: string; outlet_name: string; qty: number; sales_amount: number; description: string };
  let problem: string | null = null;
  const allLines: RawLine[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("weekly_sales_lines")
      .select("sale_date, outlet_name, qty, sales_amount, description")
      .eq("property_id", propertyId)
      .in("outlet_name", tills)
      .neq("source", "fo")
      .gte("sale_date", minFrom)
      .lt("sale_date", maxTo)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      problem = "Sebagian penjualan kasir tidak bisa dibaca.";
      break;
    }
    const batch = (data ?? []) as RawLine[];
    allLines.push(...batch);
    if (batch.length < PAGE) break;
  }

  const linesByOutlet = new Map<string, Array<RawLine & { descLower: string }>>();
  for (const l of allLines) {
    const arr = linesByOutlet.get(l.outlet_name) ?? [];
    arr.push({ ...l, descLower: l.description.toLowerCase() });
    linesByOutlet.set(l.outlet_name, arr);
  }

  const audits: PromoAuditItem[] = ranges.map(({ event, till, fromDate, toDate, kwLower }) => {
    const outletLines = linesByOutlet.get(till) ?? [];
    const lines = outletLines.filter(
      (l) => l.sale_date >= fromDate && l.sale_date < toDate && (kwLower === "*" || l.descLower.includes(kwLower)),
    );
    const sales = lines.map((l) => ({
      saleDate: l.sale_date,
      qty: portions(l.description, Number(l.qty || 0)),
      amount: Number(l.sales_amount || 0),
    }));
    return {
      event,
      lift: computePromoLift(event.post_date, sales, dataUntil ?? ""),
      menus: [...new Set(lines.map((l) => l.description.replace(/^\(0[.,]1\s*ons\)/i, "(Ons)")))],
    };
  });
  return { audits, problem, dataUntil };
}
