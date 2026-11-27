import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { db } from "../../src/lib/db";
import { pesanKuota } from "../../src/lib/gemini";
import { buildKnowledgeGraph } from "../../src/lib/knowledge-graph/build";
import { buildOutletKnowledgeContext } from "../../src/lib/knowledge-graph/context";
import {
  ANALYSIS_FINGERPRINT_PREFIX,
  buildDeterministicAnalysis,
  latestOutletActions,
  OutletAnalysisError,
  stripAiModelMentions,
  synthesizeOutletAnalysis,
  type RecommendationFactor,
} from "../../src/lib/ai/market-analyst";
import { parseDayRange, rangeLabel } from "../../src/lib/market/date-range";
import { DISPROVEN_FACILITY_CLAIM } from "../../src/lib/market/resort-strategy";

after(() => db.$disconnect());

const AI_MODEL_LEAK = /\b(gemini|flash-lite|flash\s+lite|claude|openai|chatgpt|gpt-?\d|llm)\b/i;
const REQUIRED_FACTORS: readonly RecommendationFactor[] = ["sosmed", "harga", "fasilitas", "promo", "reputasi"];
const VALID_AARRR = new Set(["Acquisition", "Activation", "Retention", "Referral", "Revenue"]);

test("pesanKuota di lib/gemini.ts tidak menyebut nama mesin AI", () => {
  const busy = pesanKuota("429 RESOURCE_EXHAUSTED retryDelay 10s");
  const daily = pesanKuota("429 RESOURCE_EXHAUSTED GenerateRequestsPerDay");
  assert.ok(busy && busy.length > 10);
  assert.ok(daily && daily.length > 10);
  assert.doesNotMatch(`${busy} ${daily}`, AI_MODEL_LEAK);
});

test("stripAiModelMentions menghapus nama model/mesin AI sambil menjaga fakta dan sumber", () => {
  const samples = [
    "Analisis oleh Gemini 3.5 Flash Lite pada 19 Nov 2026 menunjukkan tarif naik.",
    "Instagram (dibaca Gemini) · sumber foto menu dibaca Flash-Lite.",
    "Ringkasan dari Claude, OpenAI, ChatGPT, GPT-4, dan LLM internal.",
  ];
  for (const raw of samples) {
    const cleaned = stripAiModelMentions(raw);
    assert.doesNotMatch(cleaned, AI_MODEL_LEAK, `masih bocor dari: ${raw} -> ${cleaned}`);
    assert.ok(cleaned.length > 5, "teks inti tidak boleh ikut hilang seluruhnya");
  }
  const kept = stripAiModelMentions("Instagram (dibaca Gemini) · 19 Nov 2026 · Rp 1.250.000");
  assert.match(kept, /Instagram/);
  assert.match(kept, /19 Nov 2026/);
  assert.match(kept, /Rp 1\.250\.000/);
});

test("buildDeterministicAnalysis tidak memakai angka TPK BPS cadangan 52.4 saat tpkPercent null (Zero Mock)", async () => {
  const novRange = parseDayRange("2026-11-01", "2026-11-19");
  assert.ok(novRange && novRange !== "invalid");
  const graph = await buildKnowledgeGraph(novRange);
  const baseCtx = buildOutletKnowledgeContext(graph, "resort", rangeLabel(novRange));
  const ctxWithoutTpk = {
    ...baseCtx,
    macro: { ...baseCtx.macro, tpkPercent: null, tpkPeriod: null },
    sanghyang: baseCtx.sanghyang
      ? { ...baseCtx.sanghyang, pricing: { ...baseCtx.sanghyang.pricing, menuItemCount: 0 } }
      : null,
  };

  const result = buildDeterministicAnalysis(ctxWithoutTpk, "test-zero-mock-tpk");
  const joined = result.headToHeadNarrative.teramati.join(" ");
  assert.doesNotMatch(joined, /52[.,]4%/, "tidak boleh memakai angka cadangan statis 52.4% saat TPK null");
  assert.match(joined, /TPK BPS Banten belum tersedia/i, "ketiadaan TPK wajib dinyatakan jujur");
});

test("synthesizeOutletAnalysis menghasilkan narasi Head-to-Head, rekomendasi 5 faktor AARRR, dan tepat 6 transkrip slide dari KG lokal (Zero Mock)", async () => {
  const novRange = parseDayRange("2026-11-01", "2026-11-19");
  assert.ok(novRange && novRange !== "invalid");
  const graph = await buildKnowledgeGraph(novRange);
  const ctx = buildOutletKnowledgeContext(graph, "resort", rangeLabel(novRange));

  const analysis = await synthesizeOutletAnalysis(ctx, { skipCache: true, deterministicOnly: true });
  assert.equal(analysis.outletKey, "resort");
  assert.equal(analysis.rangeLabel, rangeLabel(novRange));
  // Istilah awam di laporan (kompetitor, daftar kompetitor) dan tanpa sumber omset internal yang belum dipakai.
  assert.doesNotMatch(JSON.stringify(analysis), /registri|pesaing|pembukuan internal/i);
  assert.ok(analysis.fingerprint.startsWith(ANALYSIS_FINGERPRINT_PREFIX));
  assert.equal(analysis.origin, "deterministic");

  // 1. Head-to-Head memisahkan Teramati, Disimpulkan, Implikasi
  assert.ok(analysis.headToHeadNarrative.summary.trim().length > 30);
  assert.ok(analysis.headToHeadNarrative.teramati.length >= 2, "harus memuat fakta Teramati");
  assert.ok(analysis.headToHeadNarrative.disimpulkan.length >= 1, "harus memuat lapisan Disimpulkan");
  assert.ok(analysis.headToHeadNarrative.implikasi.length >= 1, "harus memuat lapisan Implikasi");
  assert.match(analysis.headToHeadNarrative.formattedText, /Teramati:/);
  assert.match(analysis.headToHeadNarrative.formattedText, /Disimpulkan:/);
  assert.match(analysis.headToHeadNarrative.formattedText, /Implikasi:/);

  // 2. Rekomendasi terstruktur per 5 faktor + AARRR 30/90 hari
  const factorSet = new Set(analysis.periodRecommendations.map((r) => r.factor));
  for (const f of REQUIRED_FACTORS) {
    assert.ok(factorSet.has(f), `rekomendasi harus mencakup faktor ${f}`);
  }
  for (const rec of analysis.periodRecommendations) {
    assert.ok(VALID_AARRR.has(rec.aarrrStage), `tahap AARRR tidak sah: ${rec.aarrrStage}`);
    assert.ok(rec.horizon === "30-hari" || rec.horizon === "90-hari");
    assert.ok(rec.finding.trim().length > 10);
    assert.ok(rec.action.trim().length > 10);
    assert.ok(rec.evidenceSources.length > 0, `rekomendasi ${rec.factor} wajib menyebut sumber`);
  }

  // 3. Tepat 6 transkrip slide non-kosong + kesimpulan & strategi terpadu di Slide 6
  assert.equal(analysis.slideTranscripts.length, 6, "wajib tepat 6 slide per outlet");
  for (let i = 0; i < 6; i++) {
    const slide = analysis.slideTranscripts[i];
    assert.equal(slide.slideNumber, i + 1);
    assert.ok(slide.title.trim().length > 5);
    assert.ok(slide.speakerNotes.trim().length > 40, `speakerNotes slide ${i + 1} terlalu pendek`);
    assert.ok(slide.keyPoints.length >= 2, `keyPoints slide ${i + 1} minimal 2 butir`);
    assert.ok(slide.sourceNote.trim().length > 5, `sourceNote slide ${i + 1} wajib ada`);
  }
  assert.match(analysis.slideTranscripts[5].title, /Kesimpulan|Strategi/i);
  assert.match(analysis.slideTranscripts[5].speakerNotes, /Acquisition|Activation|Retention|Referral|Revenue|30 hari|90 hari/i);

  // 4. Bebas nama mesin AI dan bebas klaim fasilitas palsu
  const serialized = JSON.stringify(analysis);
  assert.doesNotMatch(serialized, AI_MODEL_LEAK, "keluaran analis tidak boleh menyebut nama mesin AI");
  assert.doesNotMatch(serialized, DISPROVEN_FACILITY_CLAIM, "keluaran analis tidak boleh memuat klaim fasilitas palsu");
});

test("synthesizeOutletAnalysis menghasilkan analisis dan rekomendasi berbeda untuk 2 periode cut-off berbeda", async () => {
  const octRange = parseDayRange("2026-10-01", "2026-10-31");
  const novRange = parseDayRange("2026-11-01", "2026-11-19");
  assert.ok(octRange && octRange !== "invalid");
  assert.ok(novRange && novRange !== "invalid");

  const [octGraph, novGraph] = await Promise.all([buildKnowledgeGraph(octRange), buildKnowledgeGraph(novRange)]);
  const octCtx = buildOutletKnowledgeContext(octGraph, "sunset-grill", rangeLabel(octRange));
  const novCtx = buildOutletKnowledgeContext(novGraph, "sunset-grill", rangeLabel(novRange));

  const [octAnalysis, novAnalysis] = await Promise.all([
    synthesizeOutletAnalysis(octCtx, { skipCache: true, deterministicOnly: true }),
    synthesizeOutletAnalysis(novCtx, { skipCache: true, deterministicOnly: true }),
  ]);

  assert.notEqual(octAnalysis.fingerprint, novAnalysis.fingerprint, "fingerprint SHA-256 harus berbeda antar periode");
  assert.notEqual(octAnalysis.headToHeadNarrative.formattedText, novAnalysis.headToHeadNarrative.formattedText);
  assert.notEqual(JSON.stringify(octAnalysis.periodRecommendations), JSON.stringify(novAnalysis.periodRecommendations));
  assert.notEqual(octAnalysis.slideTranscripts[0].speakerNotes, novAnalysis.slideTranscripts[0].speakerNotes);
  assert.equal(octAnalysis.slideTranscripts.length, 6);
  assert.equal(novAnalysis.slideTranscripts.length, 6);
});

test("synthesizeOutletAnalysis menyaring kebocoran nama model AI, klaim palsu, dan memakai cache SHA-256 di MarketInsight", async () => {
  const novRange = parseDayRange("2026-11-01", "2026-11-19");
  assert.ok(novRange && novRange !== "invalid");
  const graph = await buildKnowledgeGraph(novRange);
  const ctx = buildOutletKnowledgeContext(graph, "dspa", `Uji Cache ${rangeLabel(novRange)}`);

  let calls = 0;
  const stubGenerate = async (): Promise<string> => {
    calls++;
    return JSON.stringify({
      headToHeadNarrative: {
        summary: "Menurut analisis Gemini 3.5 Flash Lite, D'Spa memiliki keunggulan Hot Spring Aquamedic dibanding spa pembanding.",
        teramati: [
          "D'Spa mencatat penawaran Hot Spring Refresh dari situs resmi sanghyang.com (dibaca Gemini).",
          "Fasilitas onsen 24 jam air belerang panas alami tersedia setiap saat.",
        ],
        disimpulkan: ["Laporan Claude dan LLM menunjukkan peluang pembeda wellness keluarga di Anyer."],
        implikasi: ["Tampilkan jam operasional resmi D'Spa dan paket relaksasi tanpa perang diskon (saran ChatGPT)."],
      },
      periodRecommendations: [
        {
          factor: "sosmed",
          aarrrStage: "Acquisition",
          horizon: "30-hari",
          priority: "tinggi",
          finding: "Aktivitas media sosial D'Spa masih terbatas pada periode ini (hasil OpenAI).",
          action: "Unggah konten video pendek suasana Hot Spring Aquamedic dengan tautan WhatsApp reservasi.",
          metricToWatch: "Jumlah tayangan dan interaksi per unggahan",
          evidenceSources: ["Instagram @dspasanghyang (dibaca Gemini)"],
        },
      ],
      slideTranscripts: [
        {
          slideNumber: 1,
          title: "Ringkasan D'Spa oleh Gemini",
          speakerNotes: "Selamat pagi, ringkasan dari Flash-Lite menunjukkan posisi D'Spa di koridor Anyer dengan layanan onsen 24 jam.",
          keyPoints: ["Posisi pasar D'Spa (LLM)", "Keunggulan Hot Spring Aquamedic"],
        },
      ],
    });
  };

  let createdFingerprint: string | null = null;
  try {
    const first = await synthesizeOutletAnalysis(ctx, { generate: stubGenerate });
    createdFingerprint = first.fingerprint;
    assert.equal(calls, 1, "panggilan pertama memanggil generator sekali");
    assert.equal(first.origin, "live");

    const serialized = JSON.stringify(first);
    assert.doesNotMatch(serialized, AI_MODEL_LEAK, "seluruh kebocoran nama model AI dari generator wajib tersaring");
    assert.doesNotMatch(serialized, DISPROVEN_FACILITY_CLAIM, "klaim palsu 'onsen 24 jam' / 'belerang' wajib dibuang");
    assert.equal(first.slideTranscripts.length, 6, "slide yang tidak lengkap dari generator dilengkapi menjadi tepat 6 slide");
    assert.equal(new Set(first.periodRecommendations.map((r) => r.factor)).size, 5, "faktor yang kurang dilengkapi dari KG deterministik");

    // Panggilan kedua dengan konteks & fingerprint sama wajib membaca cache DB tanpa memanggil generator lagi
    const second = await synthesizeOutletAnalysis(ctx, { generate: stubGenerate });
    assert.equal(calls, 1, "panggilan kedua harus memakai cache MarketInsight tanpa memanggil generator");
    assert.equal(second.origin, "cache");
    assert.equal(second.fingerprint, first.fingerprint);
    assert.equal(second.slideTranscripts.length, 6);
  } finally {
    if (createdFingerprint) {
      await db.marketInsight.deleteMany({ where: { fingerprint: createdFingerprint } });
    }
  }
});

test("penyegaran analisis dari Knowledge Graph menyimpan hasil model, lalu Insight Pasar (mode deterministik) membaca simpanan itu", async () => {
  const { refreshOutletAnalysesFromGraph } = await import("../../src/lib/knowledge-graph/refresh-analyses");
  const range = parseDayRange("2026-11-01", "2026-11-19");
  assert.ok(range && range !== "invalid");
  let calls = 0;
  const generate = async () => {
    calls++;
    return JSON.stringify({ headToHeadNarrative: { summary: "Ringkasan uji penyegaran D'Spa dari graf.", teramati: [], disimpulkan: [], implikasi: [] } });
  };
  const created: string[] = [];
  try {
    const results = await refreshOutletAnalysesFromGraph(range, ["dspa"], { generate });
    created.push(...results.map((r) => r.fingerprint));
    assert.deepEqual(results.map((r) => [r.outletKey, r.origin]), [["dspa", "live"]]);
    assert.equal(calls, 1);

    // Jalur summary: KG dibangun ulang untuk rentang yang sama, analisis deterministik membaca simpanan hasil model.
    const graph = await buildKnowledgeGraph(range);
    const fromSummary = await synthesizeOutletAnalysis(buildOutletKnowledgeContext(graph, "dspa", rangeLabel(range)), { deterministicOnly: true });
    assert.equal(fromSummary.origin, "cache");
    assert.equal(fromSummary.fingerprint, results[0].fingerprint);
    assert.equal(calls, 1, "membaca simpanan tidak memanggil model lagi");
  } finally {
    if (created.length) await db.marketInsight.deleteMany({ where: { fingerprint: { in: created } } });
  }
});

test("periode bawaan memakai kesimpulan model terbaru outlet saat konteks sudah bergeser, lengkap dengan periode dan waktunya", async () => {
  const period = parseDayRange("2026-11-01", "2026-11-20");
  assert.ok(period && period !== "invalid");
  const graph = await buildKnowledgeGraph(period);
  const ctx = buildOutletKnowledgeContext(graph, "sunset-grill", "1 Nov 2026 – 20 Nov 2026");
  // Kesimpulan yang disusun kemarin untuk jendela lain: sidik jarinya berbeda dari konteks halaman hari ini.
  const shape = await synthesizeOutletAnalysis(ctx, { deterministicOnly: true, skipCache: true });
  const olderFingerprint = `${ANALYSIS_FINGERPRINT_PREFIX}sunset-grill:31 Okt 2026 – 19 Nov 2026:0000000000000000:v1`;
  // Simpanan lama bisa memuat em dash dari jawaban model sebelum pembersih teks ada; saat dibaca harus sudah bersih.
  const [firstRec, ...restRecs] = shape.periodRecommendations;
  const stored = {
    ...shape,
    origin: "live",
    rangeLabel: "31 Okt 2026 – 19 Nov 2026",
    fingerprint: olderFingerprint,
    periodRecommendations: [{ ...firstRec, action: "Tambah Reels — fokus sunset dermaga." }, ...restRecs],
    headToHeadNarrative: { ...shape.headToHeadNarrative, summary: "Sunset Grill unggul — rating 4,6 di Google Maps." },
  };
  const row = await db.marketInsight.create({
    data: {
      fingerprint: olderFingerprint,
      type: "recommendation",
      title: "Analisis Pasar Sunset Grill (uji fallback)",
      summary: JSON.stringify(stored),
      evidence: stored as unknown as Prisma.InputJsonValue,
      sourceReferences: ctx.citations as unknown as Prisma.InputJsonValue,
      priority: 1,
      confidence: 100,
      status: "active",
    },
  });
  try {
    assert.equal((await synthesizeOutletAnalysis(ctx, { deterministicOnly: true })).origin, "deterministic", "tanpa latestFallback hanya konteks yang sama persis");
    const latest = await synthesizeOutletAnalysis(ctx, { deterministicOnly: true, latestFallback: true });
    assert.equal(latest.origin, "cache");
    assert.equal(latest.fingerprint, olderFingerprint);
    assert.equal(latest.rangeLabel, "31 Okt 2026 – 19 Nov 2026", "periode kesimpulan yang dipakai ikut dikirim");
    assert.equal(latest.generatedAt, row.generatedAt.toISOString());
    assert.equal(latest.periodRecommendations[0]?.action, "Tambah Reels, fokus sunset dermaga.");
    assert.equal(latest.headToHeadNarrative.summary, "Sunset Grill unggul, rating 4,6 di Google Maps.");
    assert.doesNotMatch(JSON.stringify(latest), /—/, "simpanan yang dibaca tidak membawa em dash ke halaman, temuan, atau PDF");
  } finally {
    await db.marketInsight.deleteMany({ where: { fingerprint: olderFingerprint } });
  }
});

test("langkah kesimpulan sebelumnya dibaca sebelum cache narasi dibersihkan dan ikut ke prompt, supaya rekomendasi baru tidak menyalin", async () => {
  const { refreshOutletAnalysesFromGraph } = await import("../../src/lib/knowledge-graph/refresh-analyses");
  const { range, ctx, fingerprint } = await failureTestRange();
  const oldFingerprint = `${ANALYSIS_FINGERPRINT_PREFIX}dspa:uji langkah lama:0000000000000000:v1`;
  const shape = await synthesizeOutletAnalysis(ctx, { deterministicOnly: true, skipCache: true });
  const oldAction = "Langkah lama uji: unggah 3 video Hot Spring Aquamedic sore hari dengan tautan WhatsApp reservasi.";
  const [firstRec, ...restRecs] = shape.periodRecommendations;
  const old = { ...shape, origin: "live", fingerprint: oldFingerprint, periodRecommendations: [{ ...firstRec, action: oldAction }, ...restRecs] };
  await db.marketInsight.create({
    data: {
      fingerprint: oldFingerprint,
      type: "recommendation",
      title: "Analisis Pasar D'Spa (uji langkah lama)",
      summary: JSON.stringify(old),
      evidence: old as unknown as Prisma.InputJsonValue,
      sourceReferences: ctx.citations as unknown as Prisma.InputJsonValue,
      priority: 1,
      confidence: 100,
      status: "active",
    },
  });
  const prompts: string[] = [];
  try {
    const previous = await latestOutletActions();
    assert.ok(previous.dspa?.includes(oldAction), "langkah lama dibaca dari simpanan terbaru outlet");
    // Langkah analisis_graf membersihkan cache narasi sebelum menyusun ulang; langkah lama tetap terbawa lewat opsi.
    await db.marketInsight.deleteMany({ where: { fingerprint: oldFingerprint } });
    const results = await refreshOutletAnalysesFromGraph(range, ["dspa"], {
      skipCache: true,
      previousActionsByOutlet: previous,
      generate: async (prompt) => {
        prompts.push(prompt);
        return JSON.stringify({ headToHeadNarrative: { summary: "Ringkasan uji langkah baru D'Spa dari graf.", teramati: [], disimpulkan: [], implikasi: [] } });
      },
    });
    assert.deepEqual(results.map((r) => [r.outletKey, r.origin]), [["dspa", "live"]]);
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes(oldAction), "langkah lama ikut ke prompt walaupun simpanannya sudah dihapus");
    // Uji model nyata 27 Nov 2026: langkah lama di awal prompt disalin persis; di akhir prompt beserta larangannya, kelima
    // langkah baru berbeda dari yang lama.
    const tail = prompts[0].slice(prompts[0].lastIndexOf("}"));
    assert.ok(tail.includes(oldAction), "langkah lama berada di akhir prompt, sesudah contoh JSON");
    assert.match(tail, /Jangan memakai lagi langkah di atas, baik kata per kata maupun parafrase dekat/);
    // Model yang hanya menjawab sebagian faktor membuat sisanya diisi susunan otomatis yang selalu sama.
    assert.match(prompts[0], /tepat 5 butir, satu per faktor: sosmed, harga, fasilitas, promo, reputasi/);
  } finally {
    await db.marketInsight.deleteMany({ where: { fingerprint: { in: [oldFingerprint, fingerprint] } } });
  }
});

test("langkah penyegaran 'analisis_graf' terlihat di daftar langkah dan hasilnya dilaporkan apa adanya", async () => {
  const { ALL_REFRESH_STEPS } = await import("../../src/lib/market/refresh-progress");
  const { graphAnalysesOutcome } = await import("../../src/lib/market/full-refresh");
  assert.ok(ALL_REFRESH_STEPS.some((s) => s.key === "analisis_graf"), "langkah analisis graf tampil di modal dan heartbeat");

  const ok = graphAnalysesOutcome([
    { outletKey: "resort", origin: "live", fingerprint: "a", failure: null },
    { outletKey: "dspa", origin: "cache", fingerprint: "b", failure: null },
  ]);
  assert.equal(ok.status, "berhasil");
  assert.equal(ok.issue, null);
  assert.match(ok.detail, /2 outlet/);

  const partial = graphAnalysesOutcome([
    { outletKey: "resort", origin: "live", fingerprint: "a", failure: null },
    { outletKey: "sunset-grill", origin: "deterministic", fingerprint: "c", failure: null },
  ]);
  assert.equal(partial.status, "sebagian");
  assert.match(partial.issue ?? "", /sunset-grill/);

  const failed = graphAnalysesOutcome([{ outletKey: "dbar", origin: "deterministic", fingerprint: "d", failure: null }]);
  assert.equal(failed.status, "gagal");
  assert.doesNotMatch(`${ok.detail} ${partial.detail} ${failed.detail}`, AI_MODEL_LEAK, "kalimat langkah tanpa nama mesin AI");
});

/** Rentang sendiri untuk tes kegagalan, supaya sidik jarinya tidak bertabrakan dengan simpanan tes lain. */
async function failureTestRange() {
  const range = parseDayRange("2026-11-03", "2026-11-17");
  assert.ok(range && range !== "invalid");
  const graph = await buildKnowledgeGraph(range);
  const ctx = buildOutletKnowledgeContext(graph, "dspa", rangeLabel(range));
  const { fingerprint } = await synthesizeOutletAnalysis(ctx, { skipCache: true, deterministicOnly: true });
  assert.equal(await db.marketInsight.count({ where: { fingerprint } }), 0, "sidik jari uji belum dipakai simpanan lain");
  return { range, ctx, fingerprint };
}

test("Temuan 8: hasil model yang gagal disimpan ke MarketInsight dilaporkan langkah analisis_graf sebagai kegagalan, bukan 'baru'", async () => {
  const { refreshOutletAnalysesFromGraph } = await import("../../src/lib/knowledge-graph/refresh-analyses");
  const { graphAnalysesOutcome } = await import("../../src/lib/market/full-refresh");
  const { range, ctx, fingerprint } = await failureTestRange();
  // PostgreSQL menolak karakter NUL (\u0000) di kolom JSONB, jadi jawaban model yang memuatnya membuat INSERT simpanan
  // gagal di basis data sungguhan, tanpa klien basis data tiruan.
  const generate = async () =>
    JSON.stringify({ headToHeadNarrative: { summary: "Ringkasan uji simpanan D'Spa dari graf\u0000 yang memuat karakter NUL.", teramati: [], disimpulkan: [], implikasi: [] } });
  try {
    const results = await refreshOutletAnalysesFromGraph(range, ["dspa"], { generate });
    assert.equal(results.length, 1);
    assert.equal(results[0].fingerprint, fingerprint);
    assert.equal(results[0].origin, "deterministic", "tanpa simpanan, Insight Pasar tetap memakai susunan otomatis");
    assert.match(results[0].failure ?? "", /gagal disimpan/, "alasan galat simpan ikut dilaporkan");
    assert.equal(await db.marketInsight.count({ where: { fingerprint } }), 0, "tidak ada simpanan yang tertulis");
    const outcome = graphAnalysesOutcome(results);
    assert.equal(outcome.status, "gagal", "langkah tidak boleh melapor berhasil");
    assert.match(outcome.issue ?? "", /dspa/);
    assert.doesNotMatch(outcome.detail, /baru/);

    // Pemanggil langsung juga menerima galatnya, bukan hasil 'live' yang tidak pernah tersimpan.
    await assert.rejects(
      synthesizeOutletAnalysis(ctx, { generate }),
      (error: unknown) => error instanceof OutletAnalysisError && /gagal disimpan/.test(error.message) && error.cause !== undefined,
    );
  } finally {
    await db.marketInsight.deleteMany({ where: { fingerprint } });
  }
});

test("Temuan 8: model yang gagal dipanggil atau jawabannya tidak terbaca dilaporkan dengan alasannya", async () => {
  const { refreshOutletAnalysesFromGraph } = await import("../../src/lib/knowledge-graph/refresh-analyses");
  const { range, fingerprint } = await failureTestRange();
  try {
    const quota = await refreshOutletAnalysesFromGraph(range, ["dspa"], {
      generate: async () => {
        throw new Error("429 RESOURCE_EXHAUSTED GenerateRequestsPerDay");
      },
    });
    assert.deepEqual(quota.map((r) => [r.outletKey, r.origin]), [["dspa", "deterministic"]]);
    assert.match(quota[0].failure ?? "", /Jatah harian AI sudah habis/, "kuota harian dibedakan dari galat lain");

    const unreadable = await refreshOutletAnalysesFromGraph(range, ["dspa"], { generate: async () => "bukan jawaban berformat JSON" });
    assert.deepEqual(unreadable.map((r) => [r.outletKey, r.origin]), [["dspa", "deterministic"]]);
    assert.match(unreadable[0].failure ?? "", /bukan JSON/, "jawaban yang tidak terbaca disebut alasannya");
    assert.doesNotMatch(`${quota[0].failure} ${unreadable[0].failure}`, AI_MODEL_LEAK, "alasan tanpa nama mesin AI");
  } finally {
    await db.marketInsight.deleteMany({ where: { fingerprint } });
  }
});
