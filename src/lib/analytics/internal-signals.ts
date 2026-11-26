/**
 * Lapisan agregasi data operasional internal VHP untuk Knowledge Graph, strategi, dan analis pasar.
 *
 * Membaca tabel & RPC operasional VHP langsung dari PostgreSQL terpadu (`public.weekly_sales_lines`,
 * `public.outlet_targets`, `public.room_types`, `public.social_promo_events`, `public.whatsapp_chat_counts`,
 * `dbar_parts`, `occupancy_by_night`, `occupancy_for_segments`, `room_revenue_by_segment`,
 * `room_revenue_by_room`, `menu_activity`, `menu_last_sale`), lalu membuang seluruh nominal rupiah
 * sebelum mengembalikan `InternalOutletSignalsMap` (Zero Rupiah Leak by type contract).
 */
import type { PrismaClient } from "@prisma/client";
import { withCache } from "../cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "../cache/tags";
import { db } from "../db";
import { dbarSplit } from "../dashboard/dbar-split";
import { DEFAULT_MENU_RULES, menuBaseline, windowStart } from "../dashboard/menu-activity";
import { occupancy } from "../dashboard/occupancy";
import { outletKey as normOutletKey, revenueOutletFor } from "../dashboard/outlet-match";
import { mergeTargets } from "../dashboard/outlet-targets";
import { samePeriodLastMonth } from "../dashboard/revenue-nett";
import { mergeRoomTypes, revenueByRoomType } from "../dashboard/room-types";
import { OUTLET_KEYS, type OutletKey } from "../market/outlet-filters";
import { tillOutlet } from "../marketing/promo-detect";
import { computePromoLift, portions, PROMO_DAYS, shiftDate } from "../marketing/social-promo";
import type {
  InternalAcquisitionSignal,
  InternalMenuHealthSignal,
  InternalOutletSignals,
  InternalOutletSignalsMap,
  InternalPerformanceSignal,
  InternalPromoAuditSignal,
  InternalResortStaySignal,
  PerformanceStatus,
} from "./internal-signals-types";

export * from "./internal-signals-types";

const RETAIL_OCC_SEGMENTS = ["FIT", "WALK IN", "FIT-TA"];
const TENTHS_RE = /^\(0[.,]1\s*ons\)/i;
const DISC_RE = /\bdisc/i;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function toIsoDay(value?: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(value);
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function computeProgressStatus(achievedPct: number | null, dataThrough: string): PerformanceStatus | null {
  if (achievedPct === null || !Number.isFinite(achievedPct)) return null;
  if (achievedPct >= 100) return "tercapai";
  const ym = dataThrough.slice(0, 7);
  const day = Number(dataThrough.slice(8, 10));
  const totalDays = daysInMonth(ym);
  if (!Number.isFinite(day) || !Number.isFinite(totalDays) || totalDays <= 0) return null;
  const expectedPacePct = (day / totalDays) * 100;
  return achievedPct >= expectedPacePct * 0.9 ? "on_track" : "tertinggal";
}

function isMissingOperationalSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown };
  const pgCode = typeof err.meta?.code === "string" ? err.meta.code : "";
  if (pgCode === "42P01" || pgCode === "42883") return true;
  const msg = `${typeof err.message === "string" ? err.message : ""} ${typeof err.meta?.message === "string" ? err.meta.message : ""}`;
  return err.code === "P2010" && /(42P01|42883|does not exist)/i.test(msg);
}

async function resolvePropertyId(client: PrismaClient): Promise<string | null> {
  const fromEnv = process.env.MARKETING_PROPERTY_ID?.trim();
  if (fromEnv && /^[0-9a-f-]{36}$/i.test(fromEnv)) return fromEnv;
  const rows = await client.$queryRaw<{ id: string }[]>`
    select id::text as id from public.properties order by created_at asc limit 1
  `;
  return rows[0]?.id ?? null;
}

function emptySignalsMap(): InternalOutletSignalsMap {
  return Object.fromEntries(
    OUTLET_KEYS.map((key) => [
      key,
      {
        outletKey: key,
        source: "vhp" as const,
        dataThrough: null,
        performance: null,
        resortStay: null,
        menuHealth: null,
        promoAudit: null,
        acquisition: null,
      },
    ]),
  ) as InternalOutletSignalsMap;
}

export interface LoadInternalSignalsOptions {
  client?: PrismaClient;
  /** Batas tanggal maksimum data VHP (untuk rentang historis KG); kosong = tanggal terbaru di DB. */
  asOf?: Date | string | null;
  /** TPK hotel bintang Banten (BPS, %) untuk menghitung selisih tpkGapPts. */
  tpkPercent?: number | null;
}

/** Menambahkan selisih terhadap TPK BPS tanpa mengulangi kueri DB. */
export function attachTpkGap(
  signals: InternalOutletSignalsMap | null,
  tpkPercent: number | null,
): InternalOutletSignalsMap | null {
  if (!signals || tpkPercent === null || !signals.resort.resortStay || signals.resort.resortStay.occPct === null) {
    return signals;
  }
  return {
    ...signals,
    resort: {
      ...signals.resort,
      resortStay: {
        ...signals.resort.resortStay,
        tpkGapPts: round1(signals.resort.resortStay.occPct - tpkPercent),
      },
    },
  };
}

function classifySegmentBucket(segment: string): keyof InternalResortStaySignal["segmentMixPct"] {
  const upper = segment.trim().toUpperCase();
  if (upper === "FIT") return "fit";
  if (upper === "WALK IN" || upper === "WALK-IN") return "walkIn";
  if (upper === "FIT-TA" || upper.includes("OTA") || upper.endsWith("-TA")) return "ota";
  if (upper.includes("CORP") || upper.startsWith("GIT")) return "corp";
  return "other";
}

function promoEventToOutletKey(ev: { outlet_name: string; promo_title: string; menu_keyword: string }): OutletKey | null {
  const norm = normOutletKey(ev.outlet_name);
  if (norm === "sunset grill") return "sunset-grill";
  if (norm === "bistro" || norm === "room service" || norm === "banquet") return "dbistro";
  if (norm === "spa") return "dspa";
  if (norm.includes("dragon") || norm.includes("dbc") || norm.includes("bar")) {
    const text = `${ev.promo_title} ${ev.menu_keyword}`;
    if (/d['’]?\s?bar|karaoke/i.test(text) && !/\bdbc\b|dragon/i.test(text)) {
      return "dbar";
    }
    return "dragon-beach-club";
  }
  if (norm === "front office" || norm.includes("resort")) return "resort";
  return null;
}

/**
 * Memuat sinyal operasional internal VHP untuk keenam outlet Sanghyang.
 * Mengembalikan `null` secara bertipe eksplisit apabila tabel operasional VHP belum ada di DB uji parsial.
 */
export async function loadInternalOutletSignals(
  options?: LoadInternalSignalsOptions,
): Promise<InternalOutletSignalsMap | null> {
  const asOfDay = toIsoDay(options?.asOf ?? null);
  const tpkPercent = options?.tpkPercent ?? null;

  if (options?.client) {
    return computeInternalOutletSignals(options.client, asOfDay, tpkPercent);
  }

  const base = await withCache(
    () => computeInternalOutletSignals(db, asOfDay, null),
    ["internal-outlet-signals", asOfDay ?? "latest"],
    { tags: [CACHE_TAGS.internalSignals], revalidate: CACHE_TTL.marketIntelligence },
  );
  return attachTpkGap(base, tpkPercent);
}

async function computeInternalOutletSignals(
  client: PrismaClient,
  asOfDay: string | null,
  tpkPercent: number | null,
): Promise<InternalOutletSignalsMap | null> {
  try {
    const propertyId = await resolvePropertyId(client);
    if (!propertyId) return emptySignalsMap();

    const [boundsRow] = asOfDay
      ? await client.$queryRaw<{ max_day: string | null; max_pos_day: string | null }[]>`
          select
            max(sale_date)::text as max_day,
            max(sale_date) filter (where source = 'pos')::text as max_pos_day
          from public.weekly_sales_lines
          where property_id = ${propertyId}::uuid
            and sale_date <= ${asOfDay}::date
        `
      : await client.$queryRaw<{ max_day: string | null; max_pos_day: string | null }[]>`
          select
            max(sale_date)::text as max_day,
            max(sale_date) filter (where source = 'pos')::text as max_pos_day
          from public.weekly_sales_lines
          where property_id = ${propertyId}::uuid
        `;

    const dataThrough = boundsRow?.max_day ?? null;
    if (!dataThrough) {
      return emptySignalsMap();
    }

    const activeMonth = dataThrough.slice(0, 7);
    const currStart = `${activeMonth}-01`;
    const currEnd = dataThrough;
    const prev = samePeriodLastMonth(currStart, currEnd);
    const posLastDay = boundsRow?.max_pos_day ?? dataThrough;
    const menuFrom = menuBaseline(posLastDay);
    const deadWindowFrom = windowStart(posLastDay, DEFAULT_MENU_RULES.deadDays);
    const slowWindowFrom = windowStart(posLastDay, DEFAULT_MENU_RULES.slowDays);

    const [
      outletPeriodRows,
      dbarCurrRows,
      dbarPrevRows,
      occCurrRows,
      occPrevRows,
      occRetailRows,
      segmentRows,
      roomRows,
      savedRoomTypes,
      savedTargets,
      menuActivityRows,
      menuLastSaleRows,
      promoEventRows,
      waRows,
    ] = await Promise.all([
      client.$queryRaw<{ bucket: string; outlet_name: string; amount: number; open_days: number }[]>`
        select
          case
            when sale_date between ${currStart}::date and ${currEnd}::date then 'curr'
            else 'prev'
          end as bucket,
          outlet_name,
          coalesce(sum(sales_amount - coupon_amount), 0)::float8 as amount,
          count(distinct sale_date) filter (where sales_amount > 0)::int as open_days
        from public.weekly_sales_lines
        where property_id = ${propertyId}::uuid
          and (
            sale_date between ${currStart}::date and ${currEnd}::date
            or sale_date between ${prev.start}::date and ${prev.end}::date
          )
        group by 1, 2
      `,
      client.$queryRaw<{ part: string; menu: number; discount: number; compliment: number; open_days: number }[]>`
        select
          part,
          coalesce(menu, 0)::float8 as menu,
          coalesce(discount, 0)::float8 as discount,
          coalesce(compliment, 0)::float8 as compliment,
          coalesce(open_days, 0)::int as open_days
        from public.dbar_parts(${propertyId}::uuid, ${currStart}::date, ${currEnd}::date)
      `,
      client.$queryRaw<{ part: string; menu: number; discount: number; compliment: number; open_days: number }[]>`
        select
          part,
          coalesce(menu, 0)::float8 as menu,
          coalesce(discount, 0)::float8 as discount,
          coalesce(compliment, 0)::float8 as compliment,
          coalesce(open_days, 0)::int as open_days
        from public.dbar_parts(${propertyId}::uuid, ${prev.start}::date, ${prev.end}::date)
      `,
      client.$queryRaw<{ date: string; rooms: number; lodging: number; pkg: number }[]>`
        select night::text as date, coalesce(rooms, 0)::int as rooms, coalesce(lodging, 0)::float8 as lodging, coalesce(package, 0)::float8 as pkg
        from public.occupancy_by_night(${propertyId}::uuid, ${currStart}::date, ${currEnd}::date)
      `,
      client.$queryRaw<{ date: string; rooms: number; lodging: number; pkg: number }[]>`
        select night::text as date, coalesce(rooms, 0)::int as rooms, coalesce(lodging, 0)::float8 as lodging, coalesce(package, 0)::float8 as pkg
        from public.occupancy_by_night(${propertyId}::uuid, ${prev.start}::date, ${prev.end}::date)
      `,
      client.$queryRaw<{ date: string; rooms: number }[]>`
        select night::text as date, coalesce(rooms, 0)::int as rooms
        from public.occupancy_for_segments(${propertyId}::uuid, ${currStart}::date, ${currEnd}::date, ${RETAIL_OCC_SEGMENTS}::text[])
      `,
      client.$queryRaw<{ segment: string; revenue: number; room_nights: number; lodging: number }[]>`
        select segment, coalesce(revenue, 0)::float8 as revenue, coalesce(room_nights, 0)::float8 as room_nights, coalesce(lodging, 0)::float8 as lodging
        from public.room_revenue_by_segment(${propertyId}::uuid, ${currStart}::date, ${currEnd}::date)
      `,
      client.$queryRaw<{ room_no: string; revenue: number; room_nights: number; lodging: number }[]>`
        select room_no, coalesce(revenue, 0)::float8 as revenue, coalesce(room_nights, 0)::float8 as room_nights, coalesce(lodging, 0)::float8 as lodging
        from public.room_revenue_by_room(${propertyId}::uuid, ${currStart}::date, ${currEnd}::date)
      `,
      client.$queryRaw<{ room_no: string; room_type: string; version: number }[]>`
        select room_no, room_type, version::int as version
        from public.room_types
        where property_id = ${propertyId}::uuid
      `,
      client.$queryRaw<{ outlet: string; monthly_target: number; version: number }[]>`
        select outlet, monthly_target::float8 as monthly_target, version::int as version
        from public.outlet_targets
        where property_id = ${propertyId}::uuid
      `,
      client.$queryRaw<{
        outlet_name: string;
        art_no: string;
        description: string;
        total_qty: number;
        window_qty: number;
        total_sales: number;
        last_sold: string;
        first_sold: string;
      }[]>`
        select
          outlet_name,
          art_no,
          description,
          coalesce(total_qty, 0)::float8 as total_qty,
          coalesce(window_qty, 0)::float8 as window_qty,
          coalesce(total_sales, 0)::float8 as total_sales,
          last_sold::text as last_sold,
          first_sold::text as first_sold
        from public.menu_activity(${propertyId}::uuid, ${menuFrom}::date, ${deadWindowFrom}::date, ${posLastDay}::date)
      `,
      client.$queryRaw<{ outlet_name: string; art_no: string; last_sold: string; last_qty: number }[]>`
        select outlet_name, art_no, last_sold::text as last_sold, coalesce(last_qty, 0)::float8 as last_qty
        from public.menu_last_sale(${propertyId}::uuid, ${deadWindowFrom}::date, ${posLastDay}::date)
      `,
      client.$queryRaw<{
        id: string;
        post_date: string;
        platform: string;
        outlet_name: string;
        promo_title: string;
        menu_keyword: string;
        post_url: string | null;
        source_post_id: string | null;
      }[]>`
        select id::text as id, post_date::text as post_date, platform, outlet_name, promo_title, menu_keyword, post_url, source_post_id
        from public.social_promo_events
        where property_id = ${propertyId}::uuid
          and ignored = false
        order by post_date desc
        limit 100
      `,
      client.$queryRaw<{ date_from: string; date_to: string; chats_total: number | null; chats_closing: number | null }[]>`
        select
          date_from::text as date_from,
          date_to::text as date_to,
          chats_total::int as chats_total,
          chats_closing::int as chats_closing
        from public.whatsapp_chat_counts
        where property_id = ${propertyId}::uuid
        order by date_to desc
        limit 12
      `,
    ]);

    // 1. Hitung total sementara per outlet VHP (HANYA di memori server untuk dikonversi menjadi persen & arah)
    const currByMerged = new Map<string, { amount: number; openDays: number }>();
    const prevByMerged = new Map<string, number>();
    for (const r of outletPeriodRows) {
      const merged = normOutletKey(revenueOutletFor(r.outlet_name));
      if (r.bucket === "curr") {
        const cur = currByMerged.get(merged) ?? { amount: 0, openDays: 0 };
        cur.amount += r.amount;
        cur.openDays = Math.max(cur.openDays, r.open_days);
        currByMerged.set(merged, cur);
      } else {
        prevByMerged.set(merged, (prevByMerged.get(merged) ?? 0) + r.amount);
      }
    }

    const dbarCurr = dbarSplit(dbarCurrRows);
    const dbarPrev = dbarSplit(dbarPrevRows);
    const dbarCurrByPart = new Map(dbarCurrRows.map((r) => [r.part, r]));
    const dbarPrevByPart = new Map(dbarPrevRows.map((r) => [r.part, r]));
    const dbarNet = (r?: { menu: number; discount: number; compliment: number }) =>
      r ? r.menu + r.discount + r.compliment : 0;

    const dbarCurrMenus = (dbarCurrByPart.get("dbc")?.menu ?? 0) + (dbarCurrByPart.get("bar")?.menu ?? 0);
    const dbarCurrDiscount = Math.abs(dbarCurrRows.reduce((s, r) => s + r.discount, 0));
    const dbarDiscountPct = dbarCurrMenus > 0 && dbarCurrDiscount > 0 ? round1((dbarCurrDiscount / dbarCurrMenus) * 100) : null;

    // Angka internal per 6 OutletKey (TIDAK PERNAH diekspor ke keluaran!)
    const internalTotalsCurr: Record<OutletKey, number> = {
      resort: currByMerged.get("front office")?.amount ?? 0,
      "sunset-grill": currByMerged.get("sunset grill")?.amount ?? 0,
      dbistro: currByMerged.get("bistro")?.amount ?? 0,
      "dragon-beach-club": dbarNet(dbarCurrByPart.get("dbc")),
      dbar: dbarNet(dbarCurrByPart.get("bar")),
      dspa: currByMerged.get("spa")?.amount ?? 0,
    };
    const internalTotalsPrev: Record<OutletKey, number> = {
      resort: prevByMerged.get("front office") ?? 0,
      "sunset-grill": prevByMerged.get("sunset grill") ?? 0,
      dbistro: prevByMerged.get("bistro") ?? 0,
      "dragon-beach-club": dbarNet(dbarPrevByPart.get("dbc")),
      dbar: dbarNet(dbarPrevByPart.get("bar")),
      dspa: prevByMerged.get("spa") ?? 0,
    };
    const sixOutletsTotalCurr = OUTLET_KEYS.reduce((s, k) => s + Math.max(0, internalTotalsCurr[k]), 0);

    // Target bulanan via mergeTargets (transparan: version > 0 = "db", version === 0 = "bawaan")
    const mergedTargets = mergeTargets(savedTargets);
    const targetByNorm = new Map(mergedTargets.map((t) => [normOutletKey(t.outlet), t]));

    const buildPerformance = (key: OutletKey): InternalPerformanceSignal | null => {
      const currVal = internalTotalsCurr[key];
      const prevVal = internalTotalsPrev[key];
      const isCombinedDbar = key === "dragon-beach-club" || key === "dbar";

      const targetLookupKey =
        key === "resort"
          ? "front office"
          : key === "sunset-grill"
            ? "sunset grill"
            : key === "dbistro"
              ? "bistro"
              : key === "dspa"
                ? "spa"
                : normOutletKey("d'Bar Karaoke & DBC");
      const targetRow = targetByNorm.get(targetLookupKey);
      const targetVal = targetRow && targetRow.monthlyTarget > 0 ? targetRow.monthlyTarget : null;
      const targetSource: "db" | "bawaan" | null = targetVal !== null ? (targetRow!.version > 0 ? "db" : "bawaan") : null;

      // Untuk DBC & d'Bar, capaian target memakai total gabungan (tidak mengarang split target).
      const achievementNumerator = isCombinedDbar ? dbarCurr.total : currVal;
      const targetAchievementPct = targetVal !== null ? round1((achievementNumerator / targetVal) * 100) : null;
      const momGrowthPct = prevVal > 0 ? round1(((currVal - prevVal) / prevVal) * 100) : null;
      const contributionSharePct = sixOutletsTotalCurr > 0 ? round1((Math.max(0, currVal) / sixOutletsTotalCurr) * 100) : null;

      const openDays = isCombinedDbar
        ? (dbarCurrByPart.get(key === "dragon-beach-club" ? "dbc" : "bar")?.open_days ?? null)
        : (currByMerged.get(targetLookupKey)?.openDays ?? null);

      const hasData = currVal > 0 || prevVal > 0 || (openDays !== null && openDays > 0);
      if (!hasData) return null;

      const partShareRow = isCombinedDbar
        ? dbarCurr.rows.find((r) => (key === "dragon-beach-club" ? r.label === "DBC" : r.label === "d'Bar & Karaoke"))
        : undefined;

      // Pastikan dbarPrev juga dipakai untuk pengecekan keberadaan data sebelumnya
      void dbarPrev;

      return {
        month: activeMonth,
        dataThrough,
        momGrowthPct,
        targetAchievementPct,
        targetSource,
        targetScope: isCombinedDbar ? "gabungan_dbar_dbc" : "outlet",
        contributionSharePct,
        ...(isCombinedDbar ? { dbarPartSharePct: partShareRow?.sharePct != null ? round1(partShareRow.sharePct) : null, dbarDiscountPct } : {}),
        openDays,
        status: computeProgressStatus(targetAchievementPct, dataThrough),
      };
    };

    // 2. Sinyal Okupansi, Segmen & Tipe Kamar Resort (ZERO rupiah!)
    const currOcc = occupancy(occCurrRows);
    const prevOcc = occupancy(occPrevRows);
    const totalRoomsCurr = currOcc?.rooms ?? 0;
    const retailRoomsCurr = occRetailRows.reduce((s, r) => s + r.rooms, 0);

    const segNights: InternalResortStaySignal["segmentMixPct"] = { fit: 0, walkIn: 0, ota: 0, corp: 0, other: 0 };
    const segRevWeights: InternalResortStaySignal["segmentMixPct"] = { fit: 0, walkIn: 0, ota: 0, corp: 0, other: 0 };
    for (const s of segmentRows) {
      const bucket = classifySegmentBucket(s.segment);
      segNights[bucket] += Math.max(0, s.room_nights);
      segRevWeights[bucket] += Math.max(0, s.revenue);
    }
    const totalSegNights = segNights.fit + segNights.walkIn + segNights.ota + segNights.corp + segNights.other;
    const totalSegRev = segRevWeights.fit + segRevWeights.walkIn + segRevWeights.ota + segRevWeights.corp + segRevWeights.other;
    const segBase = totalSegNights > 0 ? segNights : segRevWeights;
    const segDenom = totalSegNights > 0 ? totalSegNights : totalSegRev;
    const toSegPct = (v: number) => (segDenom > 0 ? round1((v / segDenom) * 100) : 0);
    const directVsOtaRatio = segNights.ota > 0 ? round2((segNights.fit + segNights.walkIn) / segNights.ota) : null;

    const mergedRooms = mergeRoomTypes(
      roomRows.map((r) => r.room_no).filter(Boolean),
      savedRoomTypes,
    );
    const byRoomType = revenueByRoomType(roomRows, mergedRooms);
    const totalRoomTypeNights = byRoomType.reduce((s, r) => s + Math.max(0, r.roomNights), 0);
    const totalRoomTypeRev = byRoomType.reduce((s, r) => s + Math.max(0, r.revenue), 0);
    const roomTypesByShare = byRoomType
      .filter((r) => r.code !== null && (r.roomNights > 0 || r.revenue > 0))
      .map((r) => ({
        code: r.code,
        name: r.name,
        nightsSharePct: totalRoomTypeNights > 0 ? round1((Math.max(0, r.roomNights) / totalRoomTypeNights) * 100) : 0,
        revenueSharePct: totalRoomTypeRev > 0 ? round1((Math.max(0, r.revenue) / totalRoomTypeRev) * 100) : 0,
      }))
      .sort((a, b) => b.nightsSharePct - a.nightsSharePct || b.revenueSharePct - a.revenueSharePct);

    const occPctVal = currOcc ? round1(currOcc.occ) : null;
    const prevOccPctVal = prevOcc ? round1(prevOcc.occ) : null;
    const resortStay: InternalResortStaySignal | null =
      currOcc || segmentRows.length > 0 || roomTypesByShare.length > 0
        ? {
            occPct: occPctVal,
            prevOccPct: prevOccPctVal,
            occDeltaPts: occPctVal !== null && prevOccPctVal !== null ? round1(occPctVal - prevOccPctVal) : null,
            tpkGapPts: occPctVal !== null && tpkPercent !== null ? round1(occPctVal - tpkPercent) : null,
            nightsObserved: currOcc?.nights ?? 0,
            retailSegmentsOccSharePct: totalRoomsCurr > 0 ? round1((retailRoomsCurr / totalRoomsCurr) * 100) : null,
            directVsOtaRatio,
            segmentMixPct: {
              fit: toSegPct(segBase.fit),
              walkIn: toSegPct(segBase.walkIn),
              ota: toSegPct(segBase.ota),
              corp: toSegPct(segBase.corp),
              other: toSegPct(segBase.other),
            },
            roomTypesByShare,
          }
        : null;

    // 3. Kesehatan Menu per 5 Outlet F&B/Spa (menu_activity + menu_last_sale, ZERO rupiah!)
    const lastQtyMap = new Map<string, { day: string; qty: number }>();
    for (const lr of menuLastSaleRows) {
      const mergedOutlet = normOutletKey(revenueOutletFor(lr.outlet_name));
      const key = `${mergedOutlet}|${lr.art_no}`;
      const cur = lastQtyMap.get(key);
      if (!cur || lr.last_sold > cur.day) {
        lastQtyMap.set(key, { day: lr.last_sold, qty: lr.last_qty });
      } else if (lr.last_sold === cur.day) {
        cur.qty += lr.last_qty;
      }
    }

    interface InternalMenuItem {
      artNo: string;
      description: string;
      totalQty: number;
      windowQty: number;
      totalSales: number;
      lastSold: string;
      firstSold: string;
      lastQty?: number;
    }

    const menuBuckets = new Map<OutletKey, Map<string, InternalMenuItem>>();
    for (const k of ["sunset-grill", "dbistro", "dragon-beach-club", "dbar", "dspa"] as const) {
      menuBuckets.set(k, new Map());
    }

    for (const row of menuActivityRows) {
      if (TENTHS_RE.test(row.description) || DISC_RE.test(row.description)) continue;
      const mergedOutlet = normOutletKey(revenueOutletFor(row.outlet_name));
      let targetKey: OutletKey | null = null;
      if (mergedOutlet === "sunset grill") targetKey = "sunset-grill";
      else if (mergedOutlet === "bistro") targetKey = "dbistro";
      else if (mergedOutlet === "spa") targetKey = "dspa";
      else if (mergedOutlet === normOutletKey("d'Bar Karaoke & DBC")) {
        targetKey = row.description.trim().toUpperCase().startsWith("DBC") ? "dragon-beach-club" : "dbar";
      }
      if (!targetKey) continue;

      const bucket = menuBuckets.get(targetKey)!;
      const existing = bucket.get(row.art_no);
      const lastInfo = lastQtyMap.get(`${mergedOutlet}|${row.art_no}`);
      const item: InternalMenuItem = existing
        ? {
            ...existing,
            totalQty: existing.totalQty + row.total_qty,
            windowQty: existing.windowQty + row.window_qty,
            totalSales: existing.totalSales + row.total_sales,
            lastSold: existing.lastSold > row.last_sold ? existing.lastSold : row.last_sold,
            firstSold: existing.firstSold < row.first_sold ? existing.firstSold : row.first_sold,
          }
        : {
            artNo: row.art_no,
            description: row.description,
            totalQty: row.total_qty,
            windowQty: row.window_qty,
            totalSales: row.total_sales,
            lastSold: row.last_sold,
            firstSold: row.first_sold,
          };
      if (lastInfo && lastInfo.day === item.lastSold) {
        item.lastQty = lastInfo.qty;
      }
      bucket.set(row.art_no, item);
    }

    const buildMenuHealth = (key: OutletKey): InternalMenuHealthSignal | null => {
      const bucket = menuBuckets.get(key);
      if (!bucket || bucket.size === 0) return null;
      const items = [...bucket.values()];
      const outletSalesSum = items.reduce((s, m) => s + Math.max(0, m.totalSales), 0);

      const topMenus = [...items]
        .filter((m) => m.totalSales > 0)
        .sort((a, b) => b.totalSales - a.totalSales || b.totalQty - a.totalQty || a.description.localeCompare(b.description))
        .slice(0, 5)
        .map((m) => ({
          description: m.description,
          qty: Math.round(m.totalQty),
          salesSharePct: outletSalesSum > 0 ? round1((m.totalSales / outletSalesSum) * 100) : 0,
        }));

      const slowMenus = items
        .filter((m) => m.windowQty > 0 && m.windowQty <= DEFAULT_MENU_RULES.slowBelow && m.firstSold < slowWindowFrom)
        .sort((a, b) => a.windowQty - b.windowQty || a.lastSold.localeCompare(b.lastSold) || a.description.localeCompare(b.description));

      const deadMenus = items
        .filter((m) => m.totalQty > 0 && m.windowQty === 0 && m.firstSold < slowWindowFrom)
        .sort((a, b) => b.lastSold.localeCompare(a.lastSold) || a.description.localeCompare(b.description));

      return {
        lastDataDay: posLastDay,
        topMenus,
        slowMenuCount: slowMenus.length,
        deadMenuCount: deadMenus.length,
        slowestSamples: slowMenus.slice(0, 5).map((m) => ({
          description: m.description,
          windowQty: round1(m.windowQty),
          lastSold: m.lastSold,
          ...(m.lastQty !== undefined ? { lastQty: round1(m.lastQty) } : {}),
        })),
        deadSamples: deadMenus.slice(0, 5).map((m) => ({
          description: m.description,
          lastSold: m.lastSold,
        })),
      };
    };

    // 4. Audit Promo (hanya jika social_promo_events memiliki baris aktif — Zero Mock, 1 kueri batch tanpa N+1!)
    const promoAuditByOutlet = new Map<OutletKey, InternalPromoAuditSignal>();
    if (promoEventRows.length > 0) {
      const prepared = promoEventRows
        .map((ev) => {
          const mappedOutlet = promoEventToOutletKey(ev);
          if (!mappedOutlet) return null;
          const kw = ev.menu_keyword.trim();
          return {
            outletKey: mappedOutlet,
            ev,
            till: tillOutlet(ev.outlet_name),
            fromDate: shiftDate(ev.post_date, -PROMO_DAYS),
            toDate: shiftDate(ev.post_date, PROMO_DAYS),
            kwLower: kw === "*" ? "*" : kw.replace(/[%_\\]/g, "").toLowerCase(),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      const tills = [...new Set(prepared.map((p) => p.till))];
      const allPromoLines =
        prepared.length > 0
          ? await client.$queryRaw<{ sale_date: string; outlet_name: string; qty: number; description: string }[]>`
              select sale_date::text as sale_date, outlet_name, coalesce(qty, 0)::float8 as qty, description
              from public.weekly_sales_lines
              where property_id = ${propertyId}::uuid
                and outlet_name = any(${tills}::text[])
                and source <> 'fo'
                and sale_date >= ${prepared.reduce((min, p) => (p.fromDate < min ? p.fromDate : min), prepared[0].fromDate)}::date
                and sale_date < ${prepared.reduce((max, p) => (p.toDate > max ? p.toDate : max), prepared[0].toDate)}::date
            `
          : [];

      const linesByTill = new Map<string, Array<{ sale_date: string; qty: number; description: string; descLower: string }>>();
      for (const l of allPromoLines) {
        const arr = linesByTill.get(l.outlet_name) ?? [];
        arr.push({ ...l, descLower: l.description.toLowerCase() });
        linesByTill.set(l.outlet_name, arr);
      }

      const evaluated = prepared.map(({ outletKey, ev, till, fromDate, toDate, kwLower }) => {
        const lines = (linesByTill.get(till) ?? []).filter(
          (l) => l.sale_date >= fromDate && l.sale_date < toDate && (kwLower === "*" || l.descLower.includes(kwLower)),
        );
        // Amount 0 karena audit hanya menilai perubahan porsi (qtyPct) — tanpa menyimpan nominal rupiah.
        const daily = lines.map((l) => ({ saleDate: l.sale_date, qty: portions(l.description, l.qty), amount: 0 }));
        const lift = computePromoLift(ev.post_date, daily, dataThrough);
        return { outletKey, ev, lift };
      });

      for (const item of evaluated) {
        if (!item) continue;
        const agg = promoAuditByOutlet.get(item.outletKey) ?? {
          totalAudited: 0,
          naikCount: 0,
          naikTipisCount: 0,
          tidakNaikCount: 0,
          sedikitCount: 0,
          menungguDataCount: 0,
          topLifts: [],
          noLiftSamples: [],
        };
        agg.totalAudited++;
        if (item.lift.verdict === "NAIK") {
          agg.naikCount++;
          agg.topLifts.push({
            title: item.ev.promo_title,
            keyword: item.ev.menu_keyword,
            qtyPct: item.lift.qtyPct,
            postDate: item.ev.post_date,
          });
        } else if (item.lift.verdict === "NAIK_TIPIS") {
          agg.naikTipisCount++;
        } else if (item.lift.verdict === "TIDAK_NAIK") {
          agg.tidakNaikCount++;
          agg.noLiftSamples.push({
            title: item.ev.promo_title,
            keyword: item.ev.menu_keyword,
            qtyPct: item.lift.qtyPct,
            postDate: item.ev.post_date,
          });
        } else if (item.lift.verdict === "SEDIKIT") {
          agg.sedikitCount++;
        } else {
          agg.menungguDataCount++;
        }
        promoAuditByOutlet.set(item.outletKey, agg);
      }

      for (const agg of promoAuditByOutlet.values()) {
        agg.topLifts.sort((a, b) => (b.qtyPct ?? -Infinity) - (a.qtyPct ?? -Infinity)).splice(5);
        agg.noLiftSamples.sort((a, b) => (a.qtyPct ?? Infinity) - (b.qtyPct ?? Infinity)).splice(5);
      }
    }

    // 5. Akuisisi WA Resort (hanya jika whatsapp_chat_counts berisi data — Zero Mock!)
    let resortAcquisition: InternalAcquisitionSignal | null = null;
    if (waRows.length > 0) {
      const closingSum = waRows.reduce((s, r) => s + (r.chats_closing ?? 0), 0);
      const withTotal = waRows.filter((r) => r.chats_total !== null && r.chats_total > 0);
      const totalSum = withTotal.length > 0 ? withTotal.reduce((s, r) => s + (r.chats_total ?? 0), 0) : null;
      const closingWithTotal = withTotal.reduce((s, r) => s + (r.chats_closing ?? 0), 0);
      const earliest = waRows.reduce((min, r) => (r.date_from < min ? r.date_from : min), waRows[0].date_from);
      const latest = waRows.reduce((max, r) => (r.date_to > max ? r.date_to : max), waRows[0].date_to);
      resortAcquisition = {
        waClosingCount: closingSum,
        waTotalChats: totalSum,
        waClosingRatePct: totalSum && totalSum > 0 ? round1((closingWithTotal / totalSum) * 100) : null,
        periodRange: { from: earliest, to: latest },
        adsContactDeltaPct: null,
        campaignVerdicts: [],
      };
    }

    const out = {} as InternalOutletSignalsMap;
    for (const key of OUTLET_KEYS) {
      const signal: InternalOutletSignals = {
        outletKey: key,
        source: "vhp",
        dataThrough,
        performance: buildPerformance(key),
        resortStay: key === "resort" ? resortStay : null,
        menuHealth: key === "resort" ? null : buildMenuHealth(key),
        promoAudit: promoAuditByOutlet.get(key) ?? null,
        acquisition: key === "resort" ? resortAcquisition : null,
      };
      out[key] = signal;
    }
    return out;
  } catch (error) {
    if (isMissingOperationalSchemaError(error)) {
      // ZERO-FALLBACK: tabel operasional belum tersedia di DB uji parsial
      return null;
    }
    throw error;
  }
}

/**
 * Menghitung pangsa pasar kamar aktual Sanghyang (%) langsung di server dari VHP `weekly_sales_lines`
 * (Front Office) untuk bulan penuh terakhir (minimal 28 hari terdata, atau bulan terakhir yang tersedia).
 *
 * Tidak pernah mengembalikan nominal rupiah ke pemanggil.
 */
export async function loadResortActualMarketShareFromVhp(params: {
  marketCapMonthly: number | null;
  ownEstimate: number | null;
  client?: PrismaClient;
}): Promise<{ month: string; sourceFile: string; share: number | null } | null> {
  if (params.client) {
    return computeResortActualMarketShareFromVhp(params.client, params.marketCapMonthly, params.ownEstimate);
  }
  return withCache(
    () => computeResortActualMarketShareFromVhp(db, params.marketCapMonthly, params.ownEstimate),
    ["resort-actual-market-share", String(params.marketCapMonthly ?? "null"), String(params.ownEstimate ?? "null")],
    { tags: [CACHE_TAGS.internalSignals, CACHE_TAGS.marketSize], revalidate: CACHE_TTL.marketIntelligence },
  );
}

async function computeResortActualMarketShareFromVhp(
  client: PrismaClient,
  marketCapMonthly: number | null,
  ownEstimate: number | null,
): Promise<{ month: string; sourceFile: string; share: number | null } | null> {
  try {
    const propertyId = await resolvePropertyId(client);
    if (!propertyId) return null;

    const rows = await client.$queryRaw<{ month: string; revenue: number; days: number }[]>`
      select
        to_char(sale_date, 'YYYY-MM') as month,
        coalesce(sum(sales_amount - coupon_amount), 0)::float8 as revenue,
        count(distinct sale_date)::int as days
      from public.weekly_sales_lines
      where property_id = ${propertyId}::uuid
        and outlet_name = 'Front Office'
        and source = 'fo'
      group by 1
      having sum(sales_amount - coupon_amount) > 0
      order by 1 desc
      limit 12
    `;
    if (rows.length === 0) return null;

    // Pilih bulan kalender penuh terakhir (>= 28 hari) agar sebanding dengan Market Cap 30 hari;
    // bila belum ada bulan penuh, gunakan bulan terakhir yang tersedia.
    const chosen = rows.find((r) => r.days >= 28) ?? rows[0];
    const actualRevenue = chosen.revenue;
    const share =
      marketCapMonthly !== null && ownEstimate !== null && actualRevenue > 0
        ? round2((actualRevenue / (marketCapMonthly - ownEstimate + actualRevenue)) * 100)
        : null;

    return {
      month: chosen.month,
      sourceFile: "Data VHP (Front Office)",
      share,
    };
  } catch (error) {
    if (isMissingOperationalSchemaError(error)) {
      // ZERO-FALLBACK: tabel operasional belum tersedia di DB uji parsial
      return null;
    }
    throw error;
  }
}
