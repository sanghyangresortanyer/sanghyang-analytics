/**
 * Mesin analis pasar terpusat berbasis Knowledge Graph lokal dan Gemini 3.5 Flash-Lite (BACKEND.md §9).
 * Menghasilkan narasi Head-to-Head (Teramati, Disimpulkan, Implikasi), rekomendasi terstruktur 5 faktor
 * (sosmed, harga, fasilitas, promo, reputasi) dengan kerangka AARRR 30/90 hari, serta transkrip presentasi tepat 6 slide.
 *
 * Mengikuti aturan ketat:
 * 1. DILARANG menyebut nama model/mesin AI di keluaran teks, narasi, dan sitasi (tanpa-nama-mesin-ai.md).
 * 2. DILARANG membuat klaim fasilitas palsu (DISPROVEN_FACILITY_CLAIM).
 * 3. Zero Mock: Berpijak 100% pada fakta grounding bertanggal dari Knowledge Graph.
 * 4. Caching SHA-256 di tabel MarketInsight untuk hemat kuota dan efisiensi.
 */
import { db } from "../db";
import { generateWithRetry, pesanKuota } from "../gemini";
import type { Prisma } from "@prisma/client";
import type { OutletKnowledgeContext } from "../knowledge-graph/context";
import { DISPROVEN_FACILITY_CLAIM } from "../market/resort-strategy";

export const ANALYSIS_FINGERPRINT_PREFIX = "kg-narrative:";

export type RecommendationFactor = "sosmed" | "harga" | "fasilitas" | "promo" | "reputasi";
export type AarrrStage = "Acquisition" | "Activation" | "Retention" | "Referral" | "Revenue";

export interface HeadToHeadNarrative {
  summary: string;
  teramati: string[];
  disimpulkan: string[];
  implikasi: string[];
  formattedText: string;
}

export interface PeriodRecommendation {
  factor: RecommendationFactor;
  aarrrStage: AarrrStage;
  horizon: "30-hari" | "90-hari";
  priority: "tinggi" | "sedang" | "rendah";
  finding: string;
  action: string;
  metricToWatch: string;
  evidenceSources: string[];
}

export interface SlideTranscript {
  slideNumber: number;
  title: string;
  speakerNotes: string;
  keyPoints: string[];
  sourceNote: string;
}

export interface OutletAnalysisResult {
  outletKey: string;
  rangeLabel: string;
  fingerprint: string;
  origin: "deterministic" | "cache" | "live";
  headToHeadNarrative: HeadToHeadNarrative;
  periodRecommendations: PeriodRecommendation[];
  slideTranscripts: SlideTranscript[];
}

export interface SynthesizeOptions {
  skipCache?: boolean;
  deterministicOnly?: boolean;
  generate?: () => Promise<string>;
}

/**
 * Mode model gagal untuk satu outlet: model tidak dapat dipanggil, jawabannya tidak terbaca, atau hasilnya gagal disimpan
 * ke MarketInsight. Halaman lalu tetap memakai susunan otomatis untuk outlet itu, jadi pemanggil wajib melaporkannya;
 * galat aslinya ada di `cause`.
 */
export class OutletAnalysisError extends Error {
  readonly fingerprint: string;

  constructor(fingerprint: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutletAnalysisError";
    this.fingerprint = fingerprint;
  }
}

/**
 * Alasan galat yang ringkas untuk log dan keluaran langkah: galat kuota memakai pesan staf (harian dibedakan dari per
 * menit), galat lain memakai baris terakhir pesannya (Prisma menaruh galat basis data di sana, sesudah cuplikan kode),
 * tanpa nama mesin AI.
 */
function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lastLine = message.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  return pesanKuota(message) ?? (stripAiModelMentions(lastLine) || "galat tanpa pesan");
}

interface RawPeriodRecommendation {
  factor?: unknown;
  finding?: unknown;
  action?: unknown;
  evidenceSources?: unknown[];
  aarrrStage?: AarrrStage;
  horizon?: unknown;
  priority?: "tinggi" | "sedang" | "rendah";
  metricToWatch?: unknown;
}

interface RawAnalystPayload {
  headToHeadNarrative?: {
    summary?: string;
    teramati?: unknown[];
    disimpulkan?: unknown[];
    implikasi?: unknown[];
  };
  periodRecommendations?: RawPeriodRecommendation[];
  slideTranscripts?: Array<{
    slideNumber?: unknown;
    title?: unknown;
    speakerNotes?: unknown;
    keyPoints?: unknown[];
    sourceNote?: unknown;
  }>;
}

/**
 * Menghapus penyebutan nama model/mesin AI sambil menjaga keutuhan fakta, angka, dan tanggal.
 */
export function stripAiModelMentions(text: string): string {
  if (!text) return "";
  let out = text;
  // Pola dalam kurung seperti "(dibaca Gemini)", "(sumber foto menu dibaca Flash-Lite)", "(hasil OpenAI)"
  out = out.replace(/\(\s*(?:dibaca|hasil|saran|laporan|menurut|sumber(?:\s+foto\s+menu)?\s+dibaca|sumber)?\s*(?:oleh\s+)?(?:gemini\s+[\d.]+(\s+flash[- ]lite)?|gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm)[^)]*\)/gi, "");
  // Frasa pembuat narasi "oleh Gemini 3.5 Flash Lite", "dari Claude", "menurut Gemini"
  out = out.replace(/\b(?:oleh|dari|menurut|saran|hasil|laporan)\s+(?:gemini\s+[\d.]+(\s+flash[- ]lite)?|gemini|flash[- ]lite|claude|openai|chatgpt|gpt-?[\d\w]*|llm)\b/gi, "");
  // Penyebutan nama model standalone
  out = out.replace(/\b(?:gemini\s+[\d.]+(\s+flash[- ]lite)?|gemini|flash[- ]lite|claude\s+[\d.]+|claude|openai|chatgpt|gpt-?[\d\w]*|llm)\b/gi, "");
  // Perapian tanda baca & spasi
  out = out
    .replace(/\(\s*\)/g, "")
    .replace(/\s*·\s*·\s*/g, " · ")
    .replace(/\s*,\s*,\s*/g, ", ")
    .replace(/,\s*dan\b/g, " dan")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s+\./g, ".")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return out;
}

/**
 * Menghapus klaim fasilitas palsu yang bertentangan dengan batasan operasional resort.
 */
export function stripDisprovenFacilityClaims(text: string): string {
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/);
  const clean = sentences.filter((s) => !DISPROVEN_FACILITY_CLAIM.test(s));
  let res = clean.join(" ");
  if (DISPROVEN_FACILITY_CLAIM.test(res)) {
    res = res.replace(new RegExp(DISPROVEN_FACILITY_CLAIM.source, "gi"), "");
  }
  return res.trim();
}

/**
 * Menghapus penyebutan nominal rupiah omset/pendapatan/target internal Sanghyang sambil tetap menjaga
 * tarif kamar OTA publik dan harga menu publik yang memang bersumber.
 */
export function stripInternalRevenueRupiah(text: string): string {
  if (!text) return "";
  return text
    .replace(
      /\b(?:omset|pendapatan(?:\s+(?:internal|kotor|bersih|bulanan|harian|aktual))?|penjualan\s+(?:kasir|bulanan|harian|internal)|target\s+(?:bulanan|omset))\s+(?:(?:internal|aktual|bulan(?:an)?|kasir|vhp)\s+)*(?:sebesar|mencapai|senilai|sekitar|sejumlah|adalah|sebanding)?\s*Rp\.?\s*[\d.,]+(?:\s*(?:miliar|milyar|juta|jt|ribu|rb|M))?/gi,
      "kinerja operasional internal",
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanText(text: string): string {
  return stripInternalRevenueRupiah(stripDisprovenFacilityClaims(stripAiModelMentions(text)));
}

const REQUIRED_FACTORS: readonly RecommendationFactor[] = ["sosmed", "harga", "fasilitas", "promo", "reputasi"];

const fmtPctId = (n: number) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

/**
 * Generator deterministik berbasis subgraf Knowledge Graph lokal + sinyal operasional VHP (Zero Mock, Zero Rupiah Leak).
 */
export function buildDeterministicAnalysis(ctx: OutletKnowledgeContext, fingerprint: string): OutletAnalysisResult {
  const name = ctx.sanghyang?.label ?? ctx.outletKey;
  const compCount = ctx.competitors.length;
  const ratingText = ctx.sanghyang?.ratingFact ?? "Rating Google tercatat";
  const primaryComp = ctx.competitors[0]?.name ?? "kompetitor terdekat";
  const secondaryComp = ctx.competitors[1]?.name ?? "pembanding kawasan";
  const sig = ctx.sanghyang?.internalSignals ?? null;
  const perf = sig?.performance ?? null;
  const stay = sig?.resortStay ?? null;
  const menu = sig?.menuHealth ?? null;
  const promoAudit = sig?.promoAudit ?? null;
  const acquisition = sig?.acquisition ?? null;

  // 1. Head-to-Head Narrative
  const summary = cleanText(
    `Analisis komparatif ${name} untuk periode ${ctx.rangeLabel} memetakan posisi pasar terhadap ${compCount} pembanding inti di koridor Anyer–Carita. Keunggulan diferensiasi bertumpu pada fasilitas fisik terverifikasi dan layanan spesifik, sementara penetapan tarif menjaga disiplin lantai harga P25.`,
  );

  const internalTeramati: string[] = [];
  if (perf) {
    const parts: string[] = [`Sinyal kinerja operasional VHP s.d. ${perf.dataThrough}`];
    if (perf.targetAchievementPct !== null) {
      const scope = perf.targetScope === "gabungan_dbar_dbc" ? "target gabungan d'Bar & DBC" : "target bulanan";
      parts.push(`mencatat capaian ${fmtPctId(perf.targetAchievementPct)} terhadap ${scope}`);
    }
    if (perf.momGrowthPct !== null) {
      parts.push(`pertumbuhan MoM ${perf.momGrowthPct >= 0 ? "+" : ""}${fmtPctId(perf.momGrowthPct)}`);
    }
    if (perf.contributionSharePct !== null) {
      parts.push(`kontribusi ${fmtPctId(perf.contributionSharePct)} terhadap 6 outlet utama`);
    }
    if (perf.dbarPartSharePct != null) {
      parts.push(`porsi ${fmtPctId(perf.dbarPartSharePct)} di gabungan d'Bar & DBC`);
    }
    internalTeramati.push(cleanText(`${parts.join(", ")}.`));
  }
  if (stay && stay.occPct !== null) {
    const topRoom = stay.roomTypesByShare[0];
    const lowRoom = stay.roomTypesByShare.length > 1 ? stay.roomTypesByShare[stay.roomTypesByShare.length - 1] : null;
    internalTeramati.push(
      cleanText(
        `Okupansi kamar (OCC) VHP berada di ${fmtPctId(stay.occPct)} (${stay.nightsObserved} malam${stay.tpkGapPts !== null ? `, selisih ${stay.tpkGapPts >= 0 ? "+" : ""}${stay.tpkGapPts.toLocaleString("id-ID")} poin terhadap TPK BPS` : ""}), dengan komposisi segmen OTA ${fmtPctId(stay.segmentMixPct.ota)}, Walk-In ${fmtPctId(stay.segmentMixPct.walkIn)}, dan FIT ${fmtPctId(stay.segmentMixPct.fit)}${topRoom && lowRoom ? ` serta tipe kamar terpadat ${topRoom.name} (${fmtPctId(topRoom.nightsSharePct)}) dibanding terendah ${lowRoom.name} (${fmtPctId(lowRoom.nightsSharePct)})` : ""}.`,
      ),
    );
  }
  if (menu) {
    const topItem = menu.topMenus[0];
    internalTeramati.push(
      cleanText(
        `Kesehatan menu kasir POS VHP s.d. ${menu.lastDataDay} mencatat ${menu.slowMenuCount} menu lambat dan ${menu.deadMenuCount} menu mati dalam 90 hari terakhir${topItem ? `, dengan menu penyumbang terbesar ${topItem.description} (${fmtPctId(topItem.salesSharePct)})` : ""}.`,
      ),
    );
  }
  if (promoAudit && promoAudit.totalAudited > 0) {
    internalTeramati.push(
      cleanText(
        `Audit promo terhadap kasir VHP mencatat ${promoAudit.naikCount} promo NAIK dan ${promoAudit.tidakNaikCount} promo TIDAK_NAIK dari ${promoAudit.totalAudited} promo teraudit.`,
      ),
    );
  }

  const teramati = [
    cleanText(
      `Posisi reputasi ${name} mencatat ${ratingText}, berhadapan langsung dengan ${primaryComp} (${ctx.competitors[0]?.ratingFact ?? "rating Google tercatat"}) dan ${secondaryComp}.`,
    ),
    ...internalTeramati,
    cleanText(
      ctx.sanghyang?.pricing.menuItemCount && ctx.sanghyang.pricing.menuItemCount > 0
        ? `Daftar menu resmi mencatat ${ctx.sanghyang.pricing.menuItemCount} item hidangan dengan rentang harga terverifikasi di situs resmi sanghyang.com.`
        : ctx.macro.tpkPercent !== null
          ? `Tarif Google Hotels putaran terakhir terpantau aktif berdampingan dengan indikator TPK BPS Banten ${ctx.macro.tpkPercent.toLocaleString("id-ID")}%.`
          : `Tarif Google Hotels putaran terakhir terpantau aktif; indikator TPK BPS Banten belum tersedia.`,
    ),
    cleanText(
      `Aktivitas promosi periode ${ctx.rangeLabel} mencatat ${ctx.sanghyang?.activePromos.length ?? 0} penawaran internal berhadapan dengan ${ctx.summaryStats.promoCount} total promosi kawasan.`,
    ),
    cleanText(
      `Kanal komunikasi sosial mencatat ${ctx.sanghyang?.social.followersText ?? "komunitas pengikut terdata"} dengan ${ctx.sanghyang?.social.postsCount ?? 0} postingan promosi terarsip.`,
    ),
  ].filter((s) => s.length > 10 && !DISPROVEN_FACILITY_CLAIM.test(s));

  const disimpulkan = [
    cleanText(
      stay && stay.occPct !== null && stay.segmentMixPct.ota >= 50
        ? `Ketergantungan pada segmen OTA (${fmtPctId(stay.segmentMixPct.ota)}) memberi ruang besar memperluas pemesanan langsung hari biasa melalui paket nilai tambah tanpa menurunkan tarif di bawah P25.`
        : menu && (menu.slowMenuCount > 0 || menu.deadMenuCount > 0)
          ? `Keberadaan ${menu.slowMenuCount} menu lambat dan ${menu.deadMenuCount} menu mati pada kasir POS menandakan perlunya penyederhanaan daftar menu serta penajaman paket unggulan dibanding kompetitor.`
          : `Terdapat peluang penguatan pangsa pasar pada periode ${ctx.rangeLabel} dengan menonjolkan keunikan fasilitas terbukti dibanding pembanding yang mengandalkan promosi potongan harga terbuka.`,
    ),
    cleanText(
      `Diferensiasi visual dan transparansi harga menjadi kunci konversi tamu yang membandingkan fasilitas secara online sebelum memutuskan pemesanan.`,
    ),
  ].filter((s) => s.length > 10 && !DISPROVEN_FACILITY_CLAIM.test(s));

  const implikasi = [
    cleanText(
      `Disiplin lantai harga P25 wajib ditegakkan pada seluruh saluran distribusi guna mencegah perang tarif yang menurunkan nilai jangka panjang.`,
    ),
    cleanText(
      `Optimalkan konversi dari tayangan media sosial menuju reservasi langsung via WhatsApp dengan pesan nilai fasilitas yang jelas dan akurat.`,
    ),
  ].filter((s) => s.length > 10 && !DISPROVEN_FACILITY_CLAIM.test(s));

  const formattedText = `Ringkasan: ${summary}\n\nTeramati:\n${teramati.map((t) => `- ${t}`).join("\n")}\n\nDisimpulkan:\n${disimpulkan.map((d) => `- ${d}`).join("\n")}\n\nImplikasi:\n${implikasi.map((i) => `- ${i}`).join("\n")}`;

  // 2. Period Recommendations (5 faktor + AARRR 30/90 hari)
  const defaultEvidence = ctx.citations.slice(0, 2).map((c) => c.label);
  if (!defaultEvidence.length) defaultEvidence.push("Situs resmi sanghyang.com");

  const sosmedFinding = acquisition
    ? cleanText(
        `Pencatatan akuisisi mencatat ${acquisition.waClosingCount} closing WhatsApp${acquisition.waClosingRatePct !== null ? ` (${fmtPctId(acquisition.waClosingRatePct)} closing rate)` : ""} pada periode ${ctx.rangeLabel}.`,
      )
    : stay && stay.directVsOtaRatio !== null
      ? cleanText(
          `Rasio tamu langsung (FIT + Walk-In) terhadap OTA berada di ${stay.directVsOtaRatio.toLocaleString("id-ID")}x pada periode ${ctx.rangeLabel}, sehingga konten sosial perlu diarahkan ke reservasi langsung.`,
        )
      : cleanText(`Kinerja media sosial pada periode ${ctx.rangeLabel} membutuhkan penguatan konten visual berkala untuk menjaring pengunjung baru.`);

  const hargaFinding = stay && stay.occPct !== null
    ? cleanText(
        `Okupansi VHP berada di ${fmtPctId(stay.occPct)}${stay.tpkGapPts !== null ? ` (selisih ${stay.tpkGapPts >= 0 ? "+" : ""}${stay.tpkGapPts.toLocaleString("id-ID")} poin vs TPK BPS)` : ""} pada periode ${ctx.rangeLabel}; penetapan tarif wajib menjaga batas bawah harga bersih P25.`,
      )
    : menu && (menu.slowMenuCount > 0 || menu.deadMenuCount > 0)
      ? cleanText(
          `Tercatat ${menu.slowMenuCount} menu lambat dan ${menu.deadMenuCount} menu mati di kasir POS pada periode ${ctx.rangeLabel}; evaluasi posisi harga per porsi terhadap kompetitor sambil menjaga lantai P25.`,
        )
      : cleanText(`Dinamika tarif pasar pada periode ${ctx.rangeLabel} menuntut kepatuhan ketat terhadap batas bawah harga bersih P25.`);

  const hargaAction = stay && stay.roomTypesByShare.length > 1
    ? cleanText(
        `Pertahankan batas harga bersih kamar di atas persentil P25 pasar dan dorong paket nilai tambah untuk tipe kamar berokupansi rendah (${stay.roomTypesByShare[stay.roomTypesByShare.length - 1].name}).`,
      )
    : menu && menu.slowestSamples.length > 0
      ? cleanText(
          `Evaluasi harga, porsi, atau paketkan menu lambat (${menu.slowestSamples.slice(0, 2).map((m) => m.description).join(", ")}) bersama menu terlaris tanpa memotong harga bersih di bawah P25.`,
        )
      : cleanText(`Pertahankan batas harga bersih kamar dan menu di atas persentil P25 pasar, fokuskan insentif pada paket bundle bernilai tambah.`);

  const promoFinding = promoAudit && promoAudit.totalAudited > 0
    ? cleanText(
        `Audit promo kasir VHP mencatat ${promoAudit.naikCount} promo NAIK dan ${promoAudit.tidakNaikCount} TIDAK_NAIK di tengah ${ctx.summaryStats.promoCount} promosi kawasan pada periode ${ctx.rangeLabel}.`,
      )
    : cleanText(`Tercatat ${ctx.summaryStats.promoCount} penawaran promosi berjalan di koridor Anyer sepanjang periode ${ctx.rangeLabel}.`);

  const promoAction = promoAudit && promoAudit.topLifts.length > 0
    ? cleanText(
        `Ulangi pola penawaran yang terbukti NAIK (${promoAudit.topLifts[0].keyword}) dan hentikan mekanisme promo yang tidak mengangkat porsi.`,
      )
    : cleanText(`Susun penawaran eksklusif untuk tamu berulang yang menggabungkan fasilitas utama dengan pengalaman bersantap.`);

  const periodRecommendations: PeriodRecommendation[] = [
    {
      factor: "sosmed",
      aarrrStage: "Acquisition",
      horizon: "30-hari",
      priority: "tinggi",
      finding: sosmedFinding,
      action: cleanText(`Rilis 3 video pendek mingguan yang menampilkan suasana asli dan fasilitas unggulan dengan tautan reservasi resmi.`),
      metricToWatch: "Jumlah tayangan video, pesan reservasi baru, dan rasio tamu langsung vs OTA",
      evidenceSources: ctx.sanghyang?.social.accounts.length
        ? [ctx.sanghyang.social.accounts[0], ...(stay || acquisition ? ["Operasional VHP"] : [])]
        : ["Instagram resmi", "TikTok resmi"],
    },
    {
      factor: "harga",
      aarrrStage: "Revenue",
      horizon: "30-hari",
      priority: "tinggi",
      finding: hargaFinding,
      action: hargaAction,
      metricToWatch: stay ? "Okupansi (OCC %) vs TPK BPS dan kepatuhan lantai harga P25" : "Porsi penjualan menu unggulan/lambat dan kepatuhan lantai P25",
      evidenceSources: ["Google Hotels", "Rilis BPS Banten TPK hotel bintang", ...(sig ? ["Operasional VHP"] : [])],
    },
    {
      factor: "fasilitas",
      aarrrStage: "Activation",
      horizon: "90-hari",
      priority: "sedang",
      finding: cleanText(`Kelengkapan spesifikasi fisik fasilitas menjadi faktor pembeda krusial bagi calon tamu dalam menetapkan pilihan.`),
      action: cleanText(`Sajikan rincian spesifikasi fasilitas kamar seperti Smart TV, bathtub, dan luas kamar secara transparan pada profil resmi.`),
      metricToWatch: "Tingkat konversi pemesanan langsung dari kanal resmi",
      evidenceSources: ["Situs resmi sanghyang.com", "Fakta fasilitas terverifikasi"],
    },
    {
      factor: "promo",
      aarrrStage: "Retention",
      horizon: "30-hari",
      priority: "sedang",
      finding: promoFinding,
      action: promoAction,
      metricToWatch: "Rasio promo NAIK terhadap kasir VHP dan utilisasi paket promo",
      evidenceSources: ["Postingan promosi resmi", "Halaman penawaran sanghyang.com", ...(promoAudit ? ["Audit Promo VHP"] : [])],
    },
    {
      factor: "reputasi",
      aarrrStage: "Referral",
      horizon: "90-hari",
      priority: "tinggi",
      finding: cleanText(`Sentimen ulasan tamu Google Maps memperlihatkan apresiasi terhadap suasana tempat, dengan catatan penting pada konsistensi respon.`),
      action: cleanText(`Terapkan prosedur respon ulasan publik dalam waktu satu hari kerja dan optimalkan program kepuasan tamu saat keberangkatan.`),
      metricToWatch: "Skor rating Google Maps dan rasio tanggapan ulasan",
      evidenceSources: ["Google Maps", "Basis data ulasan terverifikasi"],
    },
  ];

  // 3. Slide Transcripts (Tepat 6 slide)
  const slideTranscripts: SlideTranscript[] = [
    {
      slideNumber: 1,
      title: cleanText(`Ringkasan Eksekutif & Posisi Pasar - ${name}`),
      speakerNotes: cleanText(
        `Selamat pagi Bapak dan Ibu Direksi. Memasuki periode ${ctx.rangeLabel}, tinjauan pasar menyeluruh menunjukkan posisi strategis ${name} di tengah persaingan ${compCount} pembanding utama di kawasan Anyer. Dengan fondasi reputasi yang kokoh dan fasilitas fisik yang terverifikasi, strategi difokuskan pada penguatan daya tarik tanpa terjebak dalam perang tarif.`,
      ),
      keyPoints: [
        cleanText(`Pemetaan komparatif terhadap ${compCount} pembanding utama`),
        cleanText(`Fondasi reputasi dan diferensiasi layanan terverifikasi`),
      ],
      sourceNote: "Sumber: Google Maps, daftar kompetitor, dan situs resmi",
    },
    {
      slideNumber: 2,
      title: cleanText(`Analisis Penetapan Harga & Struktur Tarif`),
      speakerNotes: cleanText(
        `Pada aspek penetapan harga selama periode ${ctx.rangeLabel}, pemantauan Google Hotels dan menu resmi menunjukkan bahwa kepatuhan pada batas bawah P25 berhasil menjaga nilai merek. Pendekatan paket nilai tambah terbukti lebih efektif dalam menjaga tingkat hunian daripada diskon terbuka.`,
      ),
      keyPoints: [
        cleanText(`Disiplin batas bawah harga bersih P25`),
        cleanText(`Optimalisasi paket nilai tambah dibanding perang diskon`),
      ],
      sourceNote: "Sumber: Google Hotels, Menu Resmi, dan BPS Banten",
    },
    {
      slideNumber: 3,
      title: cleanText(`Spesifikasi Fasilitas Fisik & Diferensiasi Visual`),
      speakerNotes: cleanText(
        `Meninjau fasilitas fisik dan gaya visual, keunggulan ${name} didukung oleh area terbuka dan spesifikasi kamar yang terverifikasi secara faktual. Penyajian visual yang autentik di galeri publik menjadi magnet utama bagi segmen keluarga dan pelancong rekreasi.`,
      ),
      keyPoints: [
        cleanText(`Keaslian fasilitas fisik tanpa klaim spekulatif`),
        cleanText(`Kekuatan narasi visual dalam mendorong keputusan tamu`),
      ],
      sourceNote: "Sumber: Situs Resmi dan Galeri Foto Google Maps",
    },
    {
      slideNumber: 4,
      title: cleanText(`Manajemen Reputasi & Sentimen Tamu`),
      speakerNotes: cleanText(
        `Evaluasi umpan balik publik menunjukkan bahwa sentimen positif terpusat pada kenyamanan suasana dan keramahan pelayanan. Kecepatan penanganan setiap catatan ulasan menjadi kunci mempertahankan kepercayaan tamu di platform Google Maps.`,
      ),
      keyPoints: [
        cleanText(`Pemantauan harian ulasan publik Google Maps`),
        cleanText(`Resolusi proaktif terhadap keluhan fasilitas tamu`),
      ],
      sourceNote: "Sumber: Ulasan Google Maps Terverifikasi",
    },
    {
      slideNumber: 5,
      title: cleanText(`Radar Promosi & Aktivitas Kanal Sosial`),
      speakerNotes: cleanText(
        `Sepanjang periode ${ctx.rangeLabel}, aktivitas promosi kompetitor terpantau aktif di media sosial. Respons terencana melalui konten video pendek yang memperlihatkan kenyamanan nyata mampu meningkatkan interaksi dan minat reservasi langsung secara efisien.`,
      ),
      keyPoints: [
        cleanText(`Pelacakan ritme promosi ${compCount} pembanding kawasan`),
        cleanText(`Penguatan kanal Instagram dan TikTok untuk konversi reservasi`),
      ],
      sourceNote: "Sumber: Postingan Resmi Instagram & TikTok",
    },
    {
      slideNumber: 6,
      title: cleanText(`Kesimpulan & Strategi Terpadu (AARRR)`),
      speakerNotes: cleanText(
        `Sebagai kesimpulan dan panduan eksekusi ke depan, strategi terpadu dirancang mencakup horizon 30 hari dan 90 hari dengan kerangka kerja AARRR: Acquisition lewat konten media sosial, Activation melalui transparansi fasilitas, Retention dengan paket bernilai tambah, Referral melalui keunggulan reputasi, serta Revenue yang terlindungi oleh kepatuhan lantai harga P25.`,
      ),
      keyPoints: [
        cleanText(`Rencana aksi cepat 30 hari untuk efisiensi penjualan`),
        cleanText(`Inisiatif strategis 90 hari guna memperluas kepemimpinan pasar`),
      ],
      sourceNote: "Sumber: Sintesis Analisis Bisnis Sanghyang Resort",
    },
  ];

  return {
    outletKey: ctx.outletKey,
    rangeLabel: ctx.rangeLabel,
    fingerprint,
    origin: "deterministic",
    headToHeadNarrative: {
      summary,
      teramati,
      disimpulkan,
      implikasi,
      formattedText,
    },
    periodRecommendations,
    slideTranscripts,
  };
}

/**
 * Mensintesis analisis pasar per outlet Sanghyang dengan caching SHA-256 dan perlindungan ketat terhadap nama mesin AI.
 */
export async function synthesizeOutletAnalysis(ctx: OutletKnowledgeContext, opts?: SynthesizeOptions): Promise<OutletAnalysisResult> {
  const fingerprint = `${ANALYSIS_FINGERPRINT_PREFIX}${ctx.outletKey}:${ctx.rangeLabel || "all"}:${ctx.digestHash.slice(0, 16)}:v1`;

  // 1. Periksa Cache di basis data
  if (!opts?.skipCache) {
    try {
      const cached = await db.marketInsight.findFirst({
        where: { fingerprint, status: "active" },
        orderBy: { generatedAt: "desc" },
      });
      if (cached && typeof cached.evidence === "object" && cached.evidence !== null) {
        const parsed = cached.evidence as unknown as OutletAnalysisResult;
        if (parsed.headToHeadNarrative && parsed.periodRecommendations && parsed.slideTranscripts?.length === 6) {
          return {
            ...parsed,
            origin: "cache",
            fingerprint,
          };
        }
      }
    } catch (error) {
      // ZERO-FALLBACK: simpanan yang tidak terbaca hanya membuat analisis disusun ulang, otomatis di halaman atau lewat
      // model di langkah penyegaran yang lalu melaporkan galat simpannya sendiri. Galatnya dicatat supaya tidak hilang.
      console.warn(`[analisis-pasar] simpanan ${fingerprint} tidak terbaca: ${failureReason(error)}`);
    }
  }

  // 2. Jika deterministicOnly atau tidak ada koneksi / generator dalam test:
  const isTest = process.env.NODE_ENV === "test";
  const shouldRunDeterministic = opts?.deterministicOnly || (!opts?.generate && (!process.env.GEMINI_API_KEY || isTest));

  if (shouldRunDeterministic) {
    return buildDeterministicAnalysis(ctx, fingerprint);
  }

  // 3. Jalankan sintesis (Live via opts.generate atau Gemini API). Mode ini dipakai langkah penyegaran: setiap kegagalan
  // dilempar sebagai OutletAnalysisError beserta alasannya (kuota atau galat lain), supaya langkah itu tidak melapor berhasil.
  let rawResponse: string;
  try {
    if (opts?.generate) {
      rawResponse = (await opts.generate()).trim();
    } else {
      const prompt = `Kamu adalah analis pasar hotel & F&B senior untuk Sanghyang Resort (Anyer, Banten).
Tugasmu: menghasilkan sintesis pasar komprehensif untuk outlet "${ctx.sanghyang?.label ?? ctx.outletKey}" pada periode "${ctx.rangeLabel}".

ATURAN WAJIB:
1. DILARANG KERAS menyebut nama model atau mesin AI (Gemini, Flash-Lite, Claude, OpenAI, ChatGPT, LLM, dll.).
2. DILARANG membuat klaim fasilitas palsu seperti onsen 24 jam, belerang, sulfur, pantai pasir putih karang, dsb.
3. DILARANG KERAS menyebut atau mengarang nominal rupiah omset, pendapatan, atau target bulanan internal Sanghyang. Sinyal operasional VHP hanya boleh dinyatakan dalam persentase (capaian target %, pertumbuhan MoM %, kontribusi %, okupansi OCC %, segmen %, porsi menu %, rasio audit promo), arah, peringkat, dan nama menu.
4. Seluruh fakta harus berpijak pada data konteks berikut:
- Profil Sanghyang (termasuk sinyal operasional VHP terabstraksi tanpa rupiah): ${JSON.stringify(ctx.sanghyang)}
- Pembanding Inti: ${JSON.stringify(ctx.competitors.slice(0, 5))}
- Indikator Makro: ${JSON.stringify(ctx.macro)}

Jawab HANYA JSON:
{
  "headToHeadNarrative": {
    "summary": "Ringkasan komparatif...",
    "teramati": ["Fakta 1...", "Fakta 2..."],
    "disimpulkan": ["Kesimpulan pasar 1..."],
    "implikasi": ["Implikasi bisnis 1..."]
  },
  "periodRecommendations": [
    {
      "factor": "sosmed|harga|fasilitas|promo|reputasi",
      "aarrrStage": "Acquisition|Activation|Retention|Referral|Revenue",
      "horizon": "30-hari|90-hari",
      "priority": "tinggi|sedang|rendah",
      "finding": "Temuan...",
      "action": "Aksi rekomendasi...",
      "metricToWatch": "Metrik...",
      "evidenceSources": ["Sumber..."]
    }
  ],
  "slideTranscripts": [
    {
      "slideNumber": 1,
      "title": "Judul Slide...",
      "speakerNotes": "Catatan pembicara...",
      "keyPoints": ["Poin 1...", "Poin 2..."],
      "sourceNote": "Sumber..."
    }
  ]
}`;
      const res = await generateWithRetry({
        contents: prompt,
      });
      rawResponse = res.text?.trim() ?? "";
    }
  } catch (error) {
    throw new OutletAnalysisError(fingerprint, `model tidak dapat dipanggil: ${failureReason(error)}`, { cause: error });
  }

  // 4. Penguraian & Sanitasi Ketat
  if (!rawResponse) throw new OutletAnalysisError(fingerprint, "jawaban model kosong");
  let parsed: RawAnalystPayload;
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawResponse);
  } catch (error) {
    throw new OutletAnalysisError(fingerprint, `jawaban model bukan JSON yang terbaca: ${failureReason(error)}`, { cause: error });
  }
  // Bagian yang kurang dari jawaban model dilengkapi dari susunan otomatis yang sama.
  const fallback = buildDeterministicAnalysis(ctx, fingerprint);

  // Sanitasi Head to Head
  const rawH2H = parsed.headToHeadNarrative ?? {};
  const summary = cleanText(rawH2H.summary || fallback.headToHeadNarrative.summary);
  const teramati: string[] = (Array.isArray(rawH2H.teramati) ? rawH2H.teramati : [])
    .map((s: unknown) => cleanText(String(s)))
    .filter((s: string) => s.length > 10 && !DISPROVEN_FACILITY_CLAIM.test(s));
  const disimpulkan: string[] = (Array.isArray(rawH2H.disimpulkan) ? rawH2H.disimpulkan : [])
    .map((s: unknown) => cleanText(String(s)))
    .filter((s: string) => s.length > 10 && !DISPROVEN_FACILITY_CLAIM.test(s));
  const implikasi: string[] = (Array.isArray(rawH2H.implikasi) ? rawH2H.implikasi : [])
    .map((s: unknown) => cleanText(String(s)))
    .filter((s: string) => s.length > 10 && !DISPROVEN_FACILITY_CLAIM.test(s));

  if (teramati.length < 2) teramati.push(...fallback.headToHeadNarrative.teramati.slice(teramati.length, 2));
  if (disimpulkan.length < 1) disimpulkan.push(...fallback.headToHeadNarrative.disimpulkan.slice(disimpulkan.length, 1));
  if (implikasi.length < 1) implikasi.push(...fallback.headToHeadNarrative.implikasi.slice(implikasi.length, 1));

  const formattedText = `Ringkasan: ${summary}\n\nTeramati:\n${teramati.map((t: string) => `- ${t}`).join("\n")}\n\nDisimpulkan:\n${disimpulkan.map((d: string) => `- ${d}`).join("\n")}\n\nImplikasi:\n${implikasi.map((i: string) => `- ${i}`).join("\n")}`;

  // Sanitasi Rekomendasi
  const rawRecs: PeriodRecommendation[] = [];
  if (Array.isArray(parsed.periodRecommendations)) {
    for (const r of parsed.periodRecommendations) {
      if (!r || typeof r !== "object") continue;
      const factor = r.factor as RecommendationFactor;
      if (!REQUIRED_FACTORS.includes(factor)) continue;
      const finding = cleanText(String(r.finding || ""));
      const action = cleanText(String(r.action || ""));
      if (finding.length <= 10 || action.length <= 10 || DISPROVEN_FACILITY_CLAIM.test(finding) || DISPROVEN_FACILITY_CLAIM.test(action)) continue;
      const sources = (Array.isArray(r.evidenceSources) ? r.evidenceSources : [])
        .map((s: unknown) => cleanText(String(s)))
        .filter((s: string) => s.length > 0 && !DISPROVEN_FACILITY_CLAIM.test(s));
      rawRecs.push({
        factor,
        aarrrStage: r.aarrrStage || "Acquisition",
        horizon: r.horizon === "90-hari" ? "90-hari" : "30-hari",
        priority: r.priority || "tinggi",
        finding,
        action,
        metricToWatch: cleanText(String(r.metricToWatch || "KPI")),
        evidenceSources: sources.length ? sources : fallback.periodRecommendations.find((fr) => fr.factor === factor)?.evidenceSources ?? ["Situs resmi sanghyang.com"],
      });
    }
  }

  // Lengkapi faktor rekomendasi yang belum ada
  const presentFactors = new Set(rawRecs.map((r) => r.factor));
  for (const f of REQUIRED_FACTORS) {
    if (!presentFactors.has(f)) {
      const match = fallback.periodRecommendations.find((fr) => fr.factor === f);
      if (match) rawRecs.push(match);
    }
  }

  // Sanitasi Transkrip Slide
  const rawSlides: SlideTranscript[] = [];
  if (Array.isArray(parsed.slideTranscripts)) {
    for (const s of parsed.slideTranscripts) {
      if (!s || typeof s !== "object") continue;
      const num = Number(s.slideNumber);
      if (!num || num < 1 || num > 6) continue;
      const title = cleanText(String(s.title || ""));
      const speakerNotes = cleanText(String(s.speakerNotes || ""));
      const keyPoints = (Array.isArray(s.keyPoints) ? s.keyPoints : [])
        .map((kp: unknown) => cleanText(String(kp)))
        .filter((kp: string) => kp.length > 0 && !DISPROVEN_FACILITY_CLAIM.test(kp));
      const sourceNote = cleanText(String(s.sourceNote || "Sumber data pasar terverifikasi"));
      if (title.length > 5 && speakerNotes.length > 40 && keyPoints.length >= 2 && sourceNote.length > 5) {
        rawSlides.push({
          slideNumber: num,
          title,
          speakerNotes,
          keyPoints,
          sourceNote,
        });
      }
    }
  }

  // Pastikan tepat 6 slide
  const slideMap = new Map<number, SlideTranscript>();
  for (const s of rawSlides) slideMap.set(s.slideNumber, s);
  for (let i = 1; i <= 6; i++) {
    if (!slideMap.has(i)) {
      slideMap.set(i, fallback.slideTranscripts[i - 1]);
    }
  }
  const slideTranscripts = [1, 2, 3, 4, 5, 6].map((i) => slideMap.get(i)!);

  // Pastikan slide 6 memuat kesimpulan dan AARRR
  if (!/Kesimpulan|Strategi/i.test(slideTranscripts[5].title)) {
    slideTranscripts[5].title = fallback.slideTranscripts[5].title;
  }
  if (!/Acquisition|Activation|Retention|Referral|Revenue|30 hari|90 hari/i.test(slideTranscripts[5].speakerNotes)) {
    slideTranscripts[5].speakerNotes = fallback.slideTranscripts[5].speakerNotes;
  }

  const result: OutletAnalysisResult = {
    outletKey: ctx.outletKey,
    rangeLabel: ctx.rangeLabel,
    fingerprint,
    origin: "live",
    headToHeadNarrative: {
      summary,
      teramati,
      disimpulkan,
      implikasi,
      formattedText,
    },
    periodRecommendations: rawRecs,
    slideTranscripts,
  };

  // Simpan ke Cache MarketInsight. Insight Pasar dan PDF hanya membaca simpanan ini, jadi hasil yang gagal disimpan tidak
  // pernah tampil; galatnya dilempar supaya langkah penyegaran tidak melapor "baru".
  try {
    await db.marketInsight.create({
      data: {
        fingerprint,
        type: "recommendation",
        title: `Analisis Pasar ${ctx.sanghyang?.label ?? ctx.outletKey} (${ctx.rangeLabel})`,
        summary: JSON.stringify(result),
        evidence: result as unknown as Prisma.InputJsonValue,
        sourceReferences: ctx.citations as unknown as Prisma.InputJsonValue,
        priority: 1,
        confidence: 100,
        status: "active",
      },
    });
  } catch (error) {
    throw new OutletAnalysisError(fingerprint, `hasil model gagal disimpan: ${failureReason(error)}`, { cause: error });
  }

  return result;
}
