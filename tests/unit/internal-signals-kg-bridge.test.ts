import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { createDatabaseClient, db } from "../../src/lib/db";
import { loadInternalOutletSignals, type InternalOutletSignals } from "../../src/lib/analytics/internal-signals";
import { buildKnowledgeGraph } from "../../src/lib/knowledge-graph/build";
import { buildOutletKnowledgeContext } from "../../src/lib/knowledge-graph/context";
import { APP_MODULES, APP_MODULE_META } from "../../src/lib/knowledge-graph/types";
import { loadResortMarketSize } from "../../src/lib/market/market-size";
import { OUTLET_KEYS } from "../../src/lib/market/outlet-filters";
import { buildOutletActionPlan } from "../../src/lib/market/outlet-action-plan";
import { buildOutletActionPlan as buildClientOutletActionPlan } from "../../src/lib/marketing/market-intelligence-types";
import { synthesizeOutletAnalysis } from "../../src/lib/ai/market-analyst";
import { parseDayRange } from "../../src/lib/market/date-range";
import { createSummaryGet } from "../../src/app/api/market-intelligence/summary/route";

const FORBIDDEN_RUPIAH_KEYS = new Set([
  "revenue",
  "revenueActual",
  "sales_amount",
  "salesAmount",
  "monthly_target",
  "monthlyTarget",
  "lodging",
  "arr",
  "beforeAmount",
  "afterAmount",
]);

/** Angka rupiah mentah VHP (Nov/Okt 2026 & total) yang tidak boleh pernah bocor ke sinyal/KG/summary. */
const RAW_VHP_RUPIAH_FRAGMENTS = [
  "257541138",
  "257.541.138",
  "309893008",
  "309.893.008",
  "219988000",
  "219.988.000",
  "160083377",
  "160.083.377",
  "64084623",
  "64.084.623",
  "117511260",
  "117.511.260",
  "174346030",
  "174.346.030",
  "12290928410",
  "12.290.928.410",
];

function collectForbiddenKeys(value: unknown, path = "$", found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => collectForbiddenKeys(item, `${path}[${idx}]`, found));
    return found;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = `${path}.${k}`;
      if (FORBIDDEN_RUPIAH_KEYS.has(k)) found.push(next);
      collectForbiddenKeys(v, next, found);
    }
  }
  return found;
}

function getAnalyticsClient(): { client: PrismaClient; owned: boolean } {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return { client: db, owned: false };
  const parsed = new URL(raw);
  if (parsed.pathname === "/sanghyang_analytics") {
    return { client: db, owned: false };
  }
  parsed.pathname = "/sanghyang_analytics";
  return {
    client: createDatabaseClient({ ...process.env, DATABASE_URL: parsed.toString() }),
    owned: true,
  };
}

const analyticsHandle = getAnalyticsClient();
const analyticsDb = analyticsHandle.client;

after(async () => {
  await db.$disconnect();
  if (analyticsHandle.owned) {
    await analyticsDb.$disconnect();
  }
});

test("jembatan VHP internal-signals: memetakan 6 outlet nyata dari 82.062 baris weekly_sales_lines tanpa 1 pun nominal rupiah", async () => {
  const signals = await loadInternalOutletSignals({ client: analyticsDb, tpkPercent: 52.4 });
  assert.ok(signals, "DB sanghyang_analytics wajib menghasilkan sinyal operasional VHP untuk 6 outlet");

  for (const key of OUTLET_KEYS) {
    const s: InternalOutletSignals = signals[key];
    assert.ok(s, `outlet ${key} wajib tersedia`);
    assert.equal(s.outletKey, key);
    assert.equal(s.source, "vhp");
    assert.equal(s.dataThrough, "2026-11-24", `${key}: data VHP terbaru di DB lokal adalah 2026-11-24`);
    assert.ok(s.performance, `${key}: sinyal kinerja (performance) wajib terisi`);
    assert.equal(s.performance.month, "2026-11");
    assert.equal(s.performance.dataThrough, "2026-11-24");
    assert.equal(typeof s.performance.momGrowthPct, "number", `${key}: momGrowthPct wajib terhitung dari periode setara bulan lalu`);
    assert.equal(typeof s.performance.targetAchievementPct, "number", `${key}: targetAchievementPct wajib terhitung`);
    assert.ok(
      s.performance.contributionSharePct !== null && s.performance.contributionSharePct > 0 && s.performance.contributionSharePct < 100,
      `${key}: contributionSharePct harus di rentang (0, 100), dapat ${s.performance.contributionSharePct}`,
    );
  }

  // Total kontribusi 6 outlet utama harus ~100%
  const totalContribution = OUTLET_KEYS.reduce((sum, key) => sum + (signals[key].performance?.contributionSharePct ?? 0), 0);
  assert.ok(totalContribution >= 99 && totalContribution <= 101, `total kontribusi 6 outlet harus ~100%, dapat ${totalContribution}`);

  // 1. Resort: okupansi, segmen, tipe kamar, dan acquisition null jujur (whatsapp_chat_counts = 0 baris)
  const resort = signals.resort;
  assert.equal(resort.performance?.targetScope, "outlet");
  assert.ok(resort.resortStay, "resort wajib memiliki resortStay");
  assert.equal(resort.resortStay.nightsObserved, 24, "Nov 2026 memiliki 24 malam F/O Journal");
  assert.ok(resort.resortStay.occPct !== null && resort.resortStay.occPct > 0 && resort.resortStay.occPct <= 100);
  assert.ok(resort.resortStay.prevOccPct !== null && resort.resortStay.prevOccPct > 0);
  assert.equal(typeof resort.resortStay.occDeltaPts, "number");
  assert.equal(typeof resort.resortStay.tpkGapPts, "number");
  assert.ok(resort.resortStay.retailSegmentsOccSharePct !== null && resort.resortStay.retailSegmentsOccSharePct > 0);
  assert.ok(resort.resortStay.directVsOtaRatio !== null && resort.resortStay.directVsOtaRatio > 0);
  const seg = resort.resortStay.segmentMixPct;
  const segTotal = seg.fit + seg.walkIn + seg.ota + seg.corp + seg.other;
  assert.ok(segTotal >= 99 && segTotal <= 101, `segmentMixPct harus ~100%, dapat ${segTotal}`);
  assert.ok(seg.ota > 40, `FIT-TA (OTA) mendominasi Nov 2026 (>40%), dapat ${seg.ota}%`);
  assert.ok(resort.resortStay.roomTypesByShare.length >= 5, "porsi tipe kamar VHP minimal 5 tipe aktif");
  assert.equal(resort.acquisition, null, "whatsapp_chat_counts 0 baris -> acquisition wajib null (Zero Mock)");

  // 2. Dragon Beach Club & d'Bar: target gabungan + porsi dbar_split yang menjumlah 100%
  const dbc = signals["dragon-beach-club"];
  const dbar = signals.dbar;
  assert.equal(dbc.performance?.targetScope, "gabungan_dbar_dbc");
  assert.equal(dbar.performance?.targetScope, "gabungan_dbar_dbc");
  assert.equal(dbc.performance?.targetAchievementPct, dbar.performance?.targetAchievementPct, "target gabungan tidak boleh dipecah karangan");
  assert.ok(dbc.performance?.dbarPartSharePct && dbc.performance.dbarPartSharePct > 60, "DBC ~71% porsi gabungan Nov");
  assert.ok(dbar.performance?.dbarPartSharePct && dbar.performance.dbarPartSharePct > 20, "d'Bar ~29% porsi gabungan Nov");
  assert.ok(
    Math.abs((dbc.performance?.dbarPartSharePct ?? 0) + (dbar.performance?.dbarPartSharePct ?? 0) - 100) < 0.2,
    "porsi DBC + d'Bar wajib berjumlah ~100%",
  );
  assert.ok((dbc.performance?.openDays ?? 0) > 0);
  assert.ok((dbar.performance?.openDays ?? 0) > 0);
  assert.ok(dbc.menuHealth && dbc.menuHealth.topMenus.every((m) => m.description.toUpperCase().startsWith("DBC")), "menu DBC hanya awalan DBC%");
  assert.ok(dbar.menuHealth && dbar.menuHealth.topMenus.every((m) => !m.description.toUpperCase().startsWith("DBC")), "menu d'Bar non-DBC%");

  // 3. F&B & Spa menuHealth + promoAudit jujur null (social_promo_events = 0 baris)
  for (const key of ["sunset-grill", "dbistro", "dragon-beach-club", "dbar", "dspa"] as const) {
    assert.ok(signals[key].menuHealth, `${key}: menuHealth wajib ada`);
    assert.ok(signals[key].menuHealth!.topMenus.length > 0, `${key}: topMenus wajib terisi`);
    assert.equal(signals[key].promoAudit, null, `${key}: social_promo_events 0 baris -> promoAudit wajib null (Zero Mock)`);
  }

  // 4. ZERO RUPIAH LEAK pada seluruh struktur InternalOutletSignals
  assert.deepEqual(collectForbiddenKeys(signals), [], "InternalOutletSignals dilarang memiliki field rupiah/omset mentah");
  const serialized = JSON.stringify(signals);
  assert.doesNotMatch(serialized, /\bRp\.?\s*[\d.,]+/i, "InternalOutletSignals tidak boleh memuat teks nominal Rp");
  for (const raw of RAW_VHP_RUPIAH_FRAGMENTS) {
    assert.ok(!serialized.includes(raw), `InternalOutletSignals membocorkan nominal VHP: ${raw}`);
  }
});

test("jembatan VHP -> Knowledge Graph: modul operasional, 5 keluarga simpul operasional, digestHash dinamis, dan 0 kebocoran rupiah", async () => {
  assert.ok((APP_MODULES as readonly string[]).includes("operasional"), "APP_MODULES wajib memuat modul 'operasional'");
  assert.equal(APP_MODULE_META.operasional.href, "/", "modul operasional menunjuk ke /");
  assert.equal(APP_MODULE_META["omset-strategi"].href, "/marketing?bagian=strategy", "omset-strategi menunjuk ke /marketing?bagian=strategy");

  const octRange = parseDayRange("2026-10-01", "2026-10-31");
  const novRange = parseDayRange("2026-11-01", "2026-11-24");
  assert.ok(octRange && octRange !== "invalid");
  assert.ok(novRange && novRange !== "invalid");

  const [octGraph, novGraph] = await Promise.all([
    buildKnowledgeGraph(octRange, { client: analyticsDb }),
    buildKnowledgeGraph(novRange, { client: analyticsDb }),
  ]);

  // Tidak ada lagi simpul pasif statistik:omset:* dan tidak ada href /admin/omset
  assert.equal(novGraph.nodes.filter((n) => n.id.startsWith("statistik:omset:")).length, 0, "simpul pasif statistik:omset:* wajib diganti");
  for (const n of novGraph.nodes) {
    assert.ok(!n.href?.includes("/admin/omset"), `simpul ${n.id} masih memakai href lama /admin/omset: ${n.href}`);
  }

  // Simpul operasional nyata terbentuk untuk 6 outlet + okupansi resort + 5 outlet menu
  for (const key of OUTLET_KEYS) {
    const perfNode = novGraph.nodes.find((n) => n.id === `operasional:kinerja:${key}`);
    assert.ok(perfNode, `simpul operasional:kinerja:${key} wajib ada`);
    assert.ok(perfNode.modules?.includes("operasional"), `${perfNode.id} wajib masuk modul operasional`);
    assert.ok(perfNode.sources.length > 0, `${perfNode.id} wajib punya sumber`);
  }
  const occNode = novGraph.nodes.find((n) => n.id === "operasional:okupansi:resort");
  assert.ok(occNode, "simpul operasional:okupansi:resort wajib ada");
  assert.ok(occNode.detail.some((d) => /OCC|Okupansi/i.test(d)), "simpul okupansi menyebut OCC");
  assert.ok(occNode.detail.some((d) => /TPK/i.test(d)), "simpul okupansi membandingkan vs TPK BPS");

  for (const key of ["sunset-grill", "dbistro", "dragon-beach-club", "dbar", "dspa"] as const) {
    const menuNode = novGraph.nodes.find((n) => n.id === `operasional:menu:${key}`);
    assert.ok(menuNode, `simpul operasional:menu:${key} wajib ada`);
  }

  // Tidak ada 1 pun rupiah di simpul operasional:* dan tidak ada angka VHP mentah di seluruh KG
  const opNodesText = JSON.stringify(novGraph.nodes.filter((n) => n.id.startsWith("operasional:")));
  assert.doesNotMatch(opNodesText, /\bRp\.?\s*[\d.,]+/i, "simpul operasional:* tidak boleh memuat nominal Rp");
  const fullKgText = JSON.stringify(novGraph);
  for (const raw of RAW_VHP_RUPIAH_FRAGMENTS) {
    assert.ok(!fullKgText.includes(raw), `Knowledge Graph membocorkan angka omset VHP: ${raw}`);
  }

  // Context memuat internalSignals dan digestHash berubah antar periode VHP
  const octCtx = buildOutletKnowledgeContext(octGraph, "resort", "uji-periode-sama");
  const novCtx = buildOutletKnowledgeContext(novGraph, "resort", "uji-periode-sama");
  assert.ok(novCtx.sanghyang?.internalSignals?.resortStay, "context.sanghyang wajib menyertakan internalSignals");
  assert.notEqual(octCtx.digestHash, novCtx.digestHash, "digestHash SHA-256 wajib berubah saat data VHP periode berubah");

  // Analisis deterministik & sanitasi kebocoran omset internal pada keluaran model
  const detResort = await synthesizeOutletAnalysis(novCtx, { skipCache: true, deterministicOnly: true });
  assert.match(detResort.headToHeadNarrative.formattedText, /okupansi|OCC/i, "narasi deterministik resort memakai sinyal okupansi VHP");
  for (const raw of RAW_VHP_RUPIAH_FRAGMENTS) {
    assert.ok(!JSON.stringify(detResort).includes(raw), `analisis deterministik membocorkan angka VHP: ${raw}`);
  }

  const leakGuarded = await synthesizeOutletAnalysis(novCtx, {
    skipCache: true,
    generate: async () =>
      JSON.stringify({
        headToHeadNarrative: {
          summary: "Omset sebesar Rp 257.541.138 tercapai dengan tarif kamar publik Rp 1.250.000 per malam.",
          teramati: [
            "Pendapatan internal mencapai Rp 309,89 juta sementara tarif OTA publik Rp 1.250.000.",
            "Okupansi VHP tercatat dengan dominasi segmen OTA pada periode aktif.",
          ],
          disimpulkan: ["Strategi paket langsung dapat menurunkan ketergantungan OTA."],
          implikasi: ["Jaga lantai harga P25 dan tingkatkan konversi WhatsApp."],
        },
        periodRecommendations: [],
        slideTranscripts: [],
      }),
  });
  // Bersihkan baris cache yang baru ditulis jika ada
  await db.marketInsight.deleteMany({ where: { fingerprint: leakGuarded.fingerprint } });
  const leakText = JSON.stringify(leakGuarded);
  assert.doesNotMatch(leakText, /257\.541\.138|309,89\s*juta/i, "nominal rupiah omset internal wajib disaring dari keluaran AI");
  assert.match(leakText, /Rp 1\.250\.000/, "tarif kamar publik yang sah tetap dipertahankan");
});

test("penutupan kebocoran rupiah pada loadResortMarketSize, /api/market-intelligence/summary, dan rekomendasi outlet", async () => {
  // 1. loadResortMarketSize menghitung actual.share dari VHP tanpa field revenue rupiah
  const ms = await loadResortMarketSize({ client: analyticsDb });
  assert.ok(ms.sanghyang.actual, "sanghyang.actual wajib terisi dari VHP Front Office");
  assert.equal("revenue" in ms.sanghyang.actual, false, "sanghyang.actual dilarang membawa field revenue rupiah");
  assert.ok(
    typeof ms.sanghyang.actual.share === "number" && ms.sanghyang.actual.share > 0 && ms.sanghyang.actual.share < 100,
    `actual.share harus persen (0..100), dapat ${ms.sanghyang.actual.share}`,
  );
  assert.match(ms.sanghyang.actual.sourceFile, /VHP/i, "sumber aktual harus menyebut VHP");

  // 2. Endpoint /api/market-intelligence/summary bebas revenueActual & bebas actual.revenue
  const GET = createSummaryGet(async () => null);
  const res = await GET(new Request("http://127.0.0.1:3001/api/market-intelligence/summary?period=30d&segment=all"));
  assert.equal(res.status, 200);
  const payload = (await res.json()) as Record<string, unknown>;

  const payloadText = JSON.stringify(payload);
  assert.equal(payloadText.includes('"revenueActual"'), false, "payload summary dilarang memiliki field revenueActual");
  const summaryMs = payload.marketSize as { sanghyang?: { actual?: Record<string, unknown> | null } } | undefined;
  if (summaryMs?.sanghyang?.actual) {
    assert.equal("revenue" in summaryMs.sanghyang.actual, false, "payload summary marketSize.sanghyang.actual dilarang memiliki field revenue");
  }
  for (const raw of RAW_VHP_RUPIAH_FRAGMENTS) {
    assert.ok(!payloadText.includes(raw), `payload /api/market-intelligence/summary membocorkan nominal VHP: ${raw}`);
  }

  // 3. Rekomendasi outlet (server & client helper) memanfaatkan internalSignals bila tersedia tanpa rupiah omset
  const signals = await loadInternalOutletSignals({ client: analyticsDb, tpkPercent: ms.tpk?.percent ?? null });
  const enrichedSummary = {
    ...payload,
    internalSignals: signals,
  } as unknown as Parameters<typeof buildOutletActionPlan>[0];

  for (const key of OUTLET_KEYS) {
    const serverPlan = buildOutletActionPlan(enrichedSummary, key);
    const clientPlan = buildClientOutletActionPlan(enrichedSummary, key);
    assert.ok(serverPlan.some((i) => i.factor === "Operasional"), `${key}: server buildOutletActionPlan wajib menyertakan sinyal Operasional`);
    assert.ok(clientPlan.some((i) => i.factor === "Operasional"), `${key}: client buildOutletActionPlan wajib menyertakan sinyal Operasional`);
    for (const item of [...serverPlan, ...clientPlan]) {
      assert.doesNotMatch(`${item.finding} ${item.action}`, /pesaing|registri|gemini|flash-lite/i);
      for (const raw of RAW_VHP_RUPIAH_FRAGMENTS) {
        assert.ok(!`${item.finding} ${item.action}`.includes(raw), `${key}: rencana aksi membocorkan rupiah VHP`);
      }
      if (item.factor === "Operasional") {
        assert.doesNotMatch(`${item.finding} ${item.action}`, /\bRp\.?\s*[\d.,]+/i, `${key}: butir Operasional dilarang menyebut nominal Rp`);
      }
    }
  }
});

test("ZERO-FALLBACK bertipe eksplisit pada DB uji parsial tanpa tabel VHP", async () => {
  // Jika DB saat ini belum memiliki tabel weekly_sales_lines (mis. sanghyang_news), loadInternalOutletSignals wajib mengembalikan null tanpa crash.
  const currentUrl = process.env.DATABASE_URL ?? "";
  if (currentUrl && !currentUrl.includes("/sanghyang_analytics")) {
    const partialSignals = await loadInternalOutletSignals({ client: db });
    assert.equal(partialSignals, null, "DB tanpa tabel operasional VHP mengembalikan null secara eksplisit");
  } else {
    // Tetap uji perilaku eksplisit dengan range historis sebelum data VHP 2026-01-01
    const preVhp = await loadInternalOutletSignals({ client: analyticsDb, asOf: "2024-03-31" });
    assert.ok(preVhp, "mengembalikan struktur outlet dengan sinyal null jujur sebelum 2026-01-01");
    for (const key of OUTLET_KEYS) {
      assert.equal(preVhp[key].performance, null);
      assert.equal(preVhp[key].resortStay, null);
      assert.equal(preVhp[key].menuHealth, null);
    }
  }
});
