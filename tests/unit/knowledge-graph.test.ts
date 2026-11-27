import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../src/lib/db";
import { buildKnowledgeGraph } from "../../src/lib/knowledge-graph/build";
import { buildOutletKnowledgeContext } from "../../src/lib/knowledge-graph/context";
import { APP_MODULES, DATA_KINDS, type GraphLink, type GraphLinkFactor } from "../../src/lib/knowledge-graph/types";
import { synthesizeOutletAnalysis } from "../../src/lib/ai/market-analyst";
import { loadCompsetAudit } from "../../src/lib/market/compset-audit";
import { loadResortMarketSize } from "../../src/lib/market/market-size";
import { GUEST_REVIEWS_ONLY, OUTLET_KEYS } from "../../src/lib/market/outlet-filters";
import { parseDayRange, rangeLabel } from "../../src/lib/market/date-range";
import { HOTEL_PACKAGE_NAME, RATE_BATCH_WINDOW_MS } from "../../src/lib/market/collect-rates";
import { OWN_OUTLETS } from "../../src/lib/market/outlet-ratings";
import { createKnowledgeGraphGet } from "../../src/app/api/knowledge-graph/route";

after(() => db.$disconnect());

const LODGING = new Set(["hotel", "resort"]);
const mapsOf = (row: { mapsUrl: string | null; googleMapsUrl: string | null } | null) => (row ? row.mapsUrl ?? row.googleMapsUrl : null);

test("graf pengetahuan terpadu lintas modul dari DB lokal: relasi berbobot utuh, simpul data bersumber, terhubung ke seluruh 6 modul aplikasi", async () => {
  const graph = await buildKnowledgeGraph();
  const ids = new Set(graph.nodes.map((n) => n.id));
  assert.equal(ids.size, graph.nodes.length, "id simpul harus unik");

  for (const l of graph.links) {
    assert.ok(ids.has(l.source) && ids.has(l.target), `relasi yatim ${l.source} -> ${l.target}`);
    assert.ok(l.label.trim().length > 0, "setiap relasi punya label");
    assert.ok(typeof l.weight === "number" && l.weight >= 0 && l.weight <= 100, `relasi ${l.source}->${l.target} wajib memiliki weight 0..100`);
  }
  const linked = new Set(graph.links.flatMap((l) => [l.source, l.target]));
  for (const n of graph.nodes) {
    assert.ok(linked.has(n.id), `${n.id} tidak terhubung ke apa pun`);
    if (DATA_KINDS.includes(n.kind)) assert.ok(n.sources.length > 0, `${n.id} (${n.kind}) tanpa sumber`);
    assert.ok(n.modules && n.modules.length > 0, `${n.id} wajib terhubung ke minimal 1 modul aplikasi`);
  }

  const kinds = new Set(graph.nodes.map((n) => n.kind));
  for (const k of ["outlet", "kamar", "pesaing", "dikeluarkan", "statistik", "strategi", "fasilitas", "visual", "menu", "sosmed", "sumber"] as const) {
    assert.ok(kinds.has(k), `jenis simpul ${k} wajib ada di graf terpadu`);
  }
  assert.equal(graph.nodes.filter((n) => n.kind === "outlet").length, 6, "enam outlet Sanghyang");
  assert.ok(graph.nodes.filter((n) => n.kind === "kamar").length >= 5, "tipe kamar resmi Sanghyang terpetakan di graf");

  // Pastikan seluruh 6 modul aplikasi terhubung
  assert.ok(graph.moduleSummary && graph.moduleSummary.length === APP_MODULES.length);
  for (const mod of graph.moduleSummary) {
    assert.ok(mod.nodeCount > 0, `modul ${mod.module} (${mod.label}) harus memiliki simpul terhubung`);
    assert.ok(mod.linkCount > 0, `modul ${mod.module} (${mod.label}) harus memiliki relasi terhubung`);
  }
});

test("graf pengetahuan: Bale-Bale dan Allisa hanya muncul sebagai dikeluarkan", async () => {
  const graph = await buildKnowledgeGraph();
  for (const name of [/Bale-Bale/, /Allisa/, /Mutiara/]) {
    const nodes = graph.nodes.filter((n) => name.test(n.label));
    assert.ok(nodes.length > 0, `${name} tercatat di graf sebagai yang dikeluarkan`);
    for (const n of nodes) assert.equal(n.kind, "dikeluarkan");
    const asCore = graph.links.filter((l) => nodes.some((n) => n.id === l.target) && l.label === "kompetitor inti");
    assert.equal(asCore.length, 0, `${name} tidak boleh tersambung sebagai kompetitor inti`);
  }
});

test("graf pengetahuan mengikuti daftar kompetitor DB dengan skor & faktor holistik: setiap kompetitor aktif tersambung ke outlet dan hotel induknya", async () => {
  const [graph, rows] = await Promise.all([
    buildKnowledgeGraph(),
    db.competitor.findMany({
      where: { active: true, compsetRole: { in: ["inti", "benchmark"] } },
      select: { id: true, name: true, outlets: true, compsetRole: true, parent: { select: { id: true, active: true, compsetRole: true, outlets: true } } },
    }),
  ]);
  const ownKeys = new Set(OWN_OUTLETS.map((o) => o.outletKey));
  const ownNames = new Set(OWN_OUTLETS.map((o) => o.competitorName));
  let checked = 0;
  for (const r of rows) {
    assert.deepEqual(r.outlets.filter((k) => !ownKeys.has(k)), [], `${r.name}: kunci outlet tidak dikenal`);
    const keys = r.outlets.filter((k) => ownKeys.has(k));
    if (ownNames.has(r.name) || !keys.length) continue;
    const node = graph.nodes.find((n) => n.id === `tempat:${r.id}`);
    assert.ok(node, `${r.name} ada di daftar kompetitor tetapi tidak ada di graf`);
    const inti = r.compsetRole === "inti";
    assert.equal(node.kind, inti ? "pesaing" : "acuan", r.name);
    assert.ok(typeof node.holisticScore === "number" && node.holisticScore >= 0 && node.holisticScore <= 100, `${r.name} wajib punya holisticScore 0..100`);
    assert.ok(node.holisticFactors && node.holisticFactors.length === 6, `${r.name} wajib punya 6 dimensi faktor holistik`);
    assert.deepEqual([...node.outlets].sort(), [...keys].sort(), `${r.name}: outlet terkait`);
    for (const key of keys) {
      const label = inti ? "kompetitor inti" : "kompetitor acuan";
      const edge = graph.links.find((l) => l.source === `outlet:${key}` && l.target === node.id && l.label === label);
      assert.ok(edge, `${r.name} tidak tersambung ke outlet ${key}`);
      assert.ok(typeof edge.weight === "number" && edge.weight >= 0 && edge.weight <= 100, `relasi ${key}->${r.name} wajib berbobot 0..100`);
      assert.ok(edge.factors && edge.factors.length === 6, `relasi ${key}->${r.name} wajib memuat 6 factors holistik`);
    }
    const parent = r.parent;
    if (parent?.active && parent.compsetRole && parent.outlets.some((k) => ownKeys.has(k))) {
      assert.ok(graph.links.some((l) => l.source === node.id && l.target === `tempat:${parent.id}` && l.label === "berada di dalam"), `${r.name}: relasi ke hotel induk`);
    }
    checked++;
  }
  assert.ok(checked > 0, "daftar kompetitor aktif harus terverifikasi");
});

test("graf pengetahuan: relasi 'rating dibaca dari' Google Maps hanya untuk rating yang memang terbaca dari Google Maps", async () => {
  const [graph, rows] = await Promise.all([
    buildKnowledgeGraph(),
    db.competitor.findMany({
      select: {
        id: true,
        name: true,
        rating: true,
        ratingSource: true,
        mapsUrl: true,
        googleMapsUrl: true,
        parent: { select: { mapsUrl: true, googleMapsUrl: true } },
      },
    }),
  ]);
  const outletOf = new Map(OWN_OUTLETS.map((o) => [o.competitorName, `outlet:${o.outletKey}`]));
  let checked = 0;
  for (const r of rows) {
    const node = graph.nodes.find((n) => n.id === (outletOf.get(r.name) ?? `tempat:${r.id}`));
    if (!node || node.kind === "dikeluarkan") continue;
    const readFromMaps = r.rating !== null && /^Google Maps/.test(r.ratingSource ?? "");
    const linked = graph.links.some((l) => l.source === node.id && l.target === "sumber:google-maps" && l.label === "rating dibaca dari");
    assert.equal(linked, readFromMaps, `${r.name}: rating ${r.rating ?? "kosong"} (${r.ratingSource ?? "tanpa sumber"})`);
    const parentListing = mapsOf(r.parent);
    if (!readFromMaps && parentListing && mapsOf(r) === parentListing) {
      assert.ok(!node.sources.some((s) => s.label === "Google Maps" && s.url === parentListing), `${r.name}: listing hotel induk ditulis sebagai sumber Google Maps tempat ini`);
    }
    checked++;
  }
  assert.ok(checked > 0);
});

test("graf pengetahuan: tarif Google Hotels putaran terakhir tiap penginapan tersambung ke simpulnya dengan tanggal check-in, status sarapan, dan sumber", async () => {
  const graph = await buildKnowledgeGraph();
  const [competitorRates, ownRates] = await Promise.all([
    db.competitorPriceSnapshot.findMany({ where: { packageName: HOTEL_PACKAGE_NAME }, select: { competitorId: true, price: true, checkIn: true, observedAt: true } }),
    db.sanghyangPriceSnapshot.findMany({ where: { packageName: HOTEL_PACKAGE_NAME }, select: { price: true, checkIn: true, observedAt: true } }),
  ]);
  const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const day = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const latest = (rates: { price: unknown; checkIn: Date | null; observedAt: Date }[]) => {
    const newest = Math.max(...rates.map((r) => r.observedAt.getTime()));
    return rates.filter((r) => r.observedAt.getTime() > newest - RATE_BATCH_WINDOW_MS);
  };

  const resort = OWN_OUTLETS.find((o) => o.outletKey === "resort");
  const holders = graph.nodes.filter((n) => (n.kind === "pesaing" || n.kind === "acuan") && n.outlets.includes("resort"));
  const lodging = await db.competitor.findMany({ where: { id: { in: holders.map((h) => h.id.slice("tempat:".length)) } }, select: { id: true, category: true } });
  const cases = [
    ...(resort ? [{ holder: "outlet:resort", rates: ownRates }] : []),
    ...lodging.filter((c) => LODGING.has(c.category ?? "")).map((c) => ({ holder: `tempat:${c.id}`, rates: competitorRates.filter((r) => r.competitorId === c.id) })),
  ];
  assert.ok(cases.length > 1, "Sanghyang dan minimal satu penginapan kompetitor");
  for (const { holder, rates } of cases) {
    const holderNode = graph.nodes.find((n) => n.id === holder);
    assert.ok(holderNode, holder);
    const rateLinks = graph.links.filter((l) => l.source === holder && l.label === "tarif kamar");
    if (!rates.length) {
      assert.equal(rateLinks.length, 0, `${holderNode.label}: tanpa tarif tersimpan tidak boleh ada simpul tarif`);
      assert.ok(holderNode.detail.includes("Tarif Google Hotels belum ada data"), `${holderNode.label}: keterangan belum ada data`);
      continue;
    }
    assert.equal(rateLinks.length, 1, `${holderNode.label}: satu simpul tarif`);
    const rateNode = graph.nodes.find((n) => n.id === rateLinks[0].target);
    assert.ok(rateNode && rateNode.kind === "statistik", `${holderNode.label}: simpul tarif`);
    const batch = latest(rates);
    for (const r of batch) {
      const night = r.checkIn ? `Check-in ${day(r.checkIn)}` : "Tanggal check-in tidak tercatat";
      assert.ok(rateNode.detail.some((d) => d.startsWith(night) && d.includes(rp(Number(r.price)))), `${holderNode.label}: ${night} ${rp(Number(r.price))} tidak tertulis (${rateNode.detail.join(" | ")})`);
    }
    assert.equal(rateNode.observedAt, new Date(Math.max(...batch.map((r) => r.observedAt.getTime()))).toISOString());
    assert.ok(rateNode.sources.length > 0 && rateNode.sources.every((s) => s.url?.startsWith("https://www.google.")), `${holderNode.label}: sumber tarif`);
    assert.ok(graph.links.some((l) => l.source === rateNode.id && l.target === "sumber:google-hotels" && l.label === "dibaca dari"), `${holderNode.label}: platform Google Hotels`);
  }
});

test("graf pengetahuan bebas dari nama mesin AI, nama tool (Crawl4AI), kata pesaing, dan kata registri", async () => {
  const graph = await buildKnowledgeGraph();
  const visibleText = [
    ...graph.nodes.flatMap((n) => [n.label, ...n.detail, ...n.sources.map((s) => s.label)]),
    ...graph.links.map((l) => l.label),
  ].join("\n");
  assert.doesNotMatch(visibleText, /\b(gemini|flash-lite|flash lite|claude|openai|chatgpt|llm|crawl4ai|playwright)\b/i, "label, detail, dan sumber KG tidak boleh menyebut mesin AI atau Crawl4AI");
  assert.doesNotMatch(visibleText, /\bregistri\b/i, "teks KG tidak boleh menyebut kata teknis registri");
  assert.doesNotMatch(visibleText, /\bpesaing\b/i, "teks KG harus memakai istilah kompetitor, bukan pesaing");
});

test("graf pengetahuan mendukung filter periode DayRange dan filter modul di API /api/knowledge-graph", async () => {
  const octRange = parseDayRange("2026-10-01", "2026-10-31");
  const novRange = parseDayRange("2026-11-01", "2026-11-19");
  assert.ok(octRange && octRange !== "invalid");
  assert.ok(novRange && novRange !== "invalid");

  const [octGraph, novGraph] = await Promise.all([buildKnowledgeGraph(octRange), buildKnowledgeGraph(novRange)]);
  assert.equal(octGraph.range?.label, rangeLabel(octRange));
  assert.equal(novGraph.range?.label, rangeLabel(novRange));
  assert.notEqual(
    JSON.stringify(octGraph.nodes.map((n) => [n.id, n.detail])),
    JSON.stringify(novGraph.nodes.map((n) => [n.id, n.detail])),
    "dua periode berbeda harus menghasilkan isi graf berbeda",
  );

  const GET = createKnowledgeGraphGet(async () => null);

  const okRes = await GET(new Request("http://127.0.0.1:3001/api/knowledge-graph?from=2026-11-01&to=2026-11-19&module=direksi"));
  assert.equal(okRes.status, 200);
  const okBody = (await okRes.json()) as { range?: { from: string; to: string; label: string } | null; activeModule?: string; nodes: { modules?: string[] }[] };
  assert.equal(okBody.range?.from, "2026-11-01");
  assert.equal(okBody.range?.to, "2026-11-19");
  assert.equal(okBody.activeModule, "direksi");
  assert.ok(okBody.nodes.length > 0);
  assert.ok(okBody.nodes.every((n) => n.modules?.includes("direksi")));

  const badRes = await GET(new Request("http://127.0.0.1:3001/api/knowledge-graph?from=2026-11-19&to=2026-10-01"));
  assert.equal(badRes.status, 400);
});

test("buildOutletKnowledgeContext menyertakan weightedSynthesis, skor holistik, tipe kamar resmi, dan tidak membocorkan kompetitor dikeluarkan", async () => {
  const novRange = parseDayRange("2026-11-01", "2026-11-19");
  assert.ok(novRange && novRange !== "invalid");
  const [graph, audit] = await Promise.all([
    buildKnowledgeGraph(novRange),
    loadCompsetAudit(await loadResortMarketSize()),
  ]);

  for (const key of [...OUTLET_KEYS, "all"] as const) {
    const ctx = buildOutletKnowledgeContext(graph, key, rangeLabel(novRange));
    const leaked = ctx.competitors.filter((c) => (c.role as string) === "dikeluarkan");
    assert.deepEqual(leaked, [], `${key}: node dikeluarkan dilarang masuk context.competitors`);
    assert.equal(ctx.summaryStats.competitorCount, ctx.competitors.length, `${key}: competitorCount harus sama dengan panjang competitors aktif`);
    assert.ok(ctx.weightedSynthesis, `${key}: weightedSynthesis wajib ada`);
    assert.ok(ctx.weightedSynthesis.moduleCoverage.length > 0, `${key}: moduleCoverage terisi`);
  }

  const resortCtx = buildOutletKnowledgeContext(graph, "resort", rangeLabel(novRange));
  const activeResortCount = audit.resort.used.length;
  assert.equal(resortCtx.competitors.length, activeResortCount);
  assert.equal(resortCtx.summaryStats.excludedCount, audit.resort.excluded.length);
  assert.ok(resortCtx.sanghyang && resortCtx.sanghyang.officialRoomTypes.length >= 5, "tipe kamar resmi Sanghyang masuk konteks resort");
  assert.ok(resortCtx.weightedSynthesis.averageHolisticScore !== null && resortCtx.weightedSynthesis.averageHolisticScore > 0);
  assert.ok(resortCtx.weightedSynthesis.topWeightedCompetitors.length > 0);

  const analysis = await synthesizeOutletAnalysis(resortCtx, { skipCache: true, deterministicOnly: true });
  assert.doesNotMatch(
    analysis.headToHeadNarrative.formattedText,
    /Mutiara Carita|Resort Prima Anyer|Allisa/i,
    `narasi Head-to-Head resort tidak boleh menyebut kompetitor dikeluarkan: ${analysis.headToHeadNarrative.formattedText}`,
  );
});

test("skor holistik di graf sama dengan mesin bersama Insight Pasar (loadHolisticEvaluation), tanpa skor cadangan karangan", async () => {
  const { loadHolisticEvaluation } = await import("../../src/lib/market/compset-audit");
  const [graph, evaluation, rows] = await Promise.all([
    buildKnowledgeGraph(),
    loadHolisticEvaluation(),
    db.competitor.findMany({ where: { active: true, compsetRole: { in: ["inti", "benchmark"] } }, select: { id: true, name: true, outlets: true } }),
  ]);
  const byId = new Map(evaluation.decisions.map((d) => [d.id, d]));
  const ownKeys = new Set(OWN_OUTLETS.map((o) => o.outletKey));
  let checked = 0;
  for (const r of rows) {
    const node = graph.nodes.find((n) => n.id === `tempat:${r.id}`);
    const decision = byId.get(r.id);
    if (!node || !decision) continue;
    const keys = r.outlets.filter((k) => ownKeys.has(k)) as (typeof OUTLET_KEYS)[number][];
    const scores = keys.map((k) => decision.scoresByOutlet[k].score);
    assert.equal(node.holisticScore, Math.max(...scores), `${r.name}: skor simpul = skor mesin terbaik di outletnya`);
    for (const k of keys) {
      const edge: GraphLink | undefined = graph.links.find((l) => l.source === `outlet:${k}` && l.target === node.id);
      assert.ok(edge, `${r.name}: relasi ke ${k}`);
      assert.equal(edge.weight, decision.scoresByOutlet[k].score, `${r.name}/${k}: bobot relasi = skor mesin`);
      const engineFactors: (string | number)[][] = Object.values(decision.scoresByOutlet[k].dimensions).map((d) => [d.key, d.score, d.weight]);
      assert.deepEqual(edge.factors?.map((f: GraphLinkFactor) => [f.key, f.score, f.weight]), engineFactors, `${r.name}/${k}: faktor = dimensi mesin`);
    }
    checked++;
  }
  assert.ok(checked > 0, "minimal satu kompetitor aktif diperiksa");
});

test("ulasan di graf disaring menurut tanggal ulasan (reviewDate) dalam periode, sama dengan Insight Pasar", async () => {
  const { loadGraphInput } = await import("../../src/lib/knowledge-graph/build");
  const range = parseDayRange("2026-10-01", "2026-11-20");
  assert.ok(range && range !== "invalid");
  const [input, expected] = await Promise.all([
    loadGraphInput(range),
    db.competitorReview.count({ where: { archivedAt: null, reviewDate: { gte: range.from, lte: range.to }, ...GUEST_REVIEWS_ONLY } }),
  ]);
  assert.equal(input.reviews.length, expected, "jumlah ulasan graf = ulasan tamu DB bertanggal di periode (tanpa komentar media sosial)");
  for (const r of input.reviews) {
    assert.ok(r.reviewDate >= range.from && r.reviewDate <= range.to, `ulasan ${r.sourceUrl} bertanggal di luar periode`);
  }
});

test("simpul media sosial memakai angka pengikut sinkron terbaru akun resmi dan tanggal data asli, tanpa akun lama/tertanam", async () => {
  const { loadGraphInput } = await import("../../src/lib/knowledge-graph/build");
  const { OFFICIAL_SOCIAL_ACCOUNTS } = await import("../../src/lib/market/marketing-sosmed");
  const officialKeys = new Set(
    OFFICIAL_SOCIAL_ACCOUNTS.filter((a) => a.platform === "instagram" || a.platform === "tiktok").map(
      (a) => `${a.platform}:${a.label.replace(/^@/, "").toLowerCase()}`,
    ),
  );
  const rows = await db.competitorPromotion.findMany({
    where: { category: "Postingan Sosmed Tayang" },
    select: { description: true, capturedAt: true, startsAt: true },
  });
  const latest = new Map<string, { followers: number; at: number }>();
  for (const r of rows) {
    const meta = JSON.parse(r.description ?? "{}") as { account?: unknown; followers?: unknown; platform?: unknown };
    if (typeof meta.account !== "string" || typeof meta.followers !== "number") continue;
    const key = `${meta.platform === "tiktok" ? "tiktok" : "instagram"}:${meta.account.trim().toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || r.capturedAt.getTime() > prev.at) latest.set(key, { followers: meta.followers, at: r.capturedAt.getTime() });
  }
  const input = await loadGraphInput();
  let officialChecked = 0;
  for (const [key, obs] of latest) {
    if (officialKeys.has(key)) {
      assert.equal(input.socialFollowers?.[key]?.followers, obs.followers, `pengikut akun resmi ${key} = sinkron terbaru`);
      officialChecked++;
    } else {
      assert.equal(input.socialFollowers?.[key], undefined, `akun lama/non-resmi ${key} tidak boleh masuk angka pengikut aktif`);
    }
  }
  assert.ok(officialChecked > 0, "minimal satu akun resmi tersinkron diperiksa");
  assert.equal(
    input.socialFollowers?.["tiktok:dragonbeachclub"]?.followers,
    latest.get("tiktok:dragonbeachclub")?.followers,
    "TikTok memakai angka pengikut TikTok sendiri, bukan meminjam pengikut Instagram bernama sama",
  );
  const graph = await buildKnowledgeGraph();
  for (const node of graph.nodes.filter((n) => n.kind === "sosmed")) {
    assert.notEqual(node.observedAt, "2026-11-10T00:26:00.000Z", `${node.label}: tanggal pengamatan tidak boleh tertanam`);
  }
});

test("pengikut akun bersama tidak dihitung dua kali: Instagram dan TikTok @dragonbeachclub dihitung per platform masing-masing", async () => {
  const { loadGraphInput } = await import("../../src/lib/knowledge-graph/build");
  const [input, graph, rows] = await Promise.all([
    loadGraphInput(),
    buildKnowledgeGraph(),
    db.competitorPromotion.findMany({
      where: { category: "Postingan Sosmed Tayang" },
      select: { description: true, capturedAt: true },
    }),
  ]);
  let igLatest: { followers: number; at: number } | null = null;
  let ttLatest: { followers: number; at: number } | null = null;
  for (const r of rows) {
    const meta = JSON.parse(r.description ?? "{}") as { account?: unknown; followers?: unknown; platform?: unknown };
    if (meta.account !== "dragonbeachclub" || typeof meta.followers !== "number") continue;
    if (meta.platform === "tiktok") {
      if (!ttLatest || r.capturedAt.getTime() > ttLatest.at) ttLatest = { followers: meta.followers, at: r.capturedAt.getTime() };
    } else {
      if (!igLatest || r.capturedAt.getTime() > igLatest.at) igLatest = { followers: meta.followers, at: r.capturedAt.getTime() };
    }
  }
  assert.ok(igLatest, "DB lokal memuat pengikut Instagram @dragonbeachclub hasil sinkron");
  assert.equal(input.socialFollowers?.["instagram:dragonbeachclub"]?.followers, igLatest.followers);
  assert.equal(input.socialFollowers?.["tiktok:dragonbeachclub"]?.followers, ttLatest?.followers);

  const expectedTotal = igLatest.followers + (ttLatest?.followers ?? 0);
  const dbc = graph.nodes.find((n) => n.id === "sosmed:outlet:dragon-beach-club");
  assert.ok(dbc, "simpul media sosial Dragon Beach Club");
  const total = dbc.detail.find((d) => /total pengikut/.test(d));
  assert.equal(total, `${expectedTotal.toLocaleString("id-ID")} total pengikut`, "total pengikut = Instagram + TikTok aktual per platform");
  if (ttLatest && ttLatest.followers !== igLatest.followers) {
    assert.notEqual(expectedTotal, igLatest.followers * 2, "TikTok tidak memakai angka ganda dari Instagram");
  }
  const ctx = buildOutletKnowledgeContext(graph, "dragon-beach-club", "uji");
  assert.doesNotMatch(JSON.stringify(ctx.sanghyang?.social ?? {}), new RegExp((igLatest.followers * 2).toLocaleString("id-ID").replace(/\./g, "\\.")));
});
