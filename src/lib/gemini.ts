/**
 * Ringkasan Bahasa Indonesia via Gemini (BACKEND.md §9).
 *
 * Prompt sudah direvisi sekali setelah baseline: aturan 1 dulu terlalu abstrak
 * (kalimat pembuka artikel tersalin 19 kata), dan target 120-180 kata yang
 * dipatok keras MEMAKSA Gemini mengarang saat artikel sumbernya pendek.
 */
import { GoogleGenAI } from '@google/genai';

/**
 * Satu model tanpa cadangan (keputusan pemilik 26 Nov 2026): model hanya dari PRIMARY_MODEL dan tingkat penalaran
 * dari PRIMARY_THINKING_LEVEL, keduanya wajib dan tanpa nilai bawaan; env kosong atau salah langsung gagal. Kena batas
 * laju berarti menunggu lalu mencoba model yang sama.
 *
 * Pilihan model mengikuti kuota harian, bukan sebaliknya: Free Tier gemini-4-hydrogen hanya 20 permintaan per hari,
 * sedangkan refresh harian butuh sekitar 50-150 panggilan (heartbeat 25 Nov 2026: berita, situs, kategori promo, tipe
 * kamar, menu, analisis 6 outlet). Pemilik lalu memilih gemini-3.5-flash-lite (500 per hari) dengan penalaran high:
 * kuota dihitung per permintaan, dan high hanya memperlama panggilan (25 promo: 14,7 detik, low 6,1 detik).
 *
 * Setiap panggilan membawa ringkasan Knowledge Graph 30 hari terakhir di instruksi sistem (knowledge-graph/ai-grounding.ts,
 * keputusan pemilik 27 Nov 2026), terlepas dari toggle menu Knowledge Graph di Pengaturan. Pengecualiannya hanya pemanggil
 * yang prompt-nya sudah memuat konteks graf lengkap (knowledgeGraph: 'included').
 *
 * Lewat Interactions API seperti proyek web, bukan models.generateContent: 26 Nov 2026 generateContent ke
 * gemini-4-hydrogen dengan thinkingLevel XHIGH baru menjawab 503 "high demand" setelah 123 detik, sedangkan
 * Interactions API selesai dalam 9,6 detik. Interactions API tidak menerima temperature untuk model berpikir, jadi
 * pemanggil tidak lagi mengirimnya.
 */
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/** Token berpikir ikut dihitung dalam batas keluaran; di bawah angka ini jawaban JSON panjang terpotong. */
const MIN_OUTPUT_TOKENS = 16_384;

export type AiConfig = { apiKey: string; model: string; thinkingLevel: ThinkingLevel };

const isThinkingLevel = (value: string): value is ThinkingLevel => (THINKING_LEVELS as readonly string[]).includes(value);

export function aiConfig(env: Readonly<Record<string, string | undefined>> = process.env): AiConfig {
  const apiKey = env.GEMINI_API_KEY?.trim() ?? '';
  if (!apiKey) throw new Error('GEMINI_API_KEY belum diisi');
  const model = env.PRIMARY_MODEL?.trim() ?? '';
  if (!model) throw new Error('PRIMARY_MODEL belum diisi; tidak ada model cadangan');
  const level = env.PRIMARY_THINKING_LEVEL?.trim().toLowerCase() ?? '';
  if (!isThinkingLevel(level)) {
    throw new Error(`PRIMARY_THINKING_LEVEL wajib salah satu dari ${THINKING_LEVELS.join(', ')}`);
  }
  return { apiKey, model, thinkingLevel: level };
}

/** Nama model yang benar-benar dipakai, untuk dicatat di metadata hasil. */
export const model = () => aiConfig().model;
const MAX_TEXT = 8000;
/**
 * Di bawah ini sumbernya benar-benar tipis. Dulu 300 dan itu terlalu tinggi:
 * diukur pada 57 artikel yang berhasil dibaca, medianya 388 kata dan kuartil
 * bawahnya 329 — jadi 300 memberi label pada 19% artikel yang sehat-sehat saja.
 * Yang memicu penyelidikan: berita SatelitNews 272 kata, dua narasumber, angka
 * lengkap, ringkasannya justru yang terbaik — tapi dilabeli "Sumber terbatas".
 * Pada 180 hanya 4% yang kena, dan itu memang artikel rintisan.
 *
 * Perlu diingat: targetKata() SUDAH menyusutkan target ringkasan sebanding
 * panjang sumbernya (272 kata → target 109-136, rasio 2,0x — sama sehatnya
 * dengan sumber 300 kata). Jadi label ini bukan pengaman kualitas ringkasan,
 * cuma pemberi tahu bahwa bahannya sedikit.
 */
const MIN_KATA_SUMBER = 180;

export type ArtikelUntukRingkas = { title: string; sourceName: string; fullText: string };

export type SummaryResult = {
  summary: string | null;
  error?: string;                // mentah, untuk log — JANGAN ditampilkan ke staf
  pesanUser?: string;            // sudah aman ditampilkan apa adanya
  targetKata: [number, number];  // target yang dikirim ke prompt, dihitung dari panjang artikel
  warnings: string[];            // 'artikel-pendek'
  dibuangSanitizer: string[];    // baris yang dipotong sanitizer — kalau terisi, aturan 6 gagal
};

const jumlahKata = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Lapisan pengaman KEDUA setelah aturan 6 di prompt.
 * PDF referensi klien bocor kalimat "This translation preserves the original
 * meaning..." ke publikasi. Aturan di prompt saja terbukti tidak cukup.
 */
const POLA_BUANG = [
  'translation preserves',
  'ringkasan ini',
  'berikut adalah',
  'semoga membantu',
  'sebagai editor',
  'artikel di atas',
];

/**
 * Buang penanda markdown, sisakan teksnya.
 *
 * Flash-Lite memiringkan istilah asing sendiri (*booth*, *infinity pool*) padahal
 * tidak diminta. Template hanya meng-escape HTML, jadi tanda bintangnya bocor
 * mentah ke PDF.
 *
 * Syarat pasangan sengaja ketat supaya bintang yang memang bagian teks selamat:
 * penandanya harus mengapit teks tanpa spasi di sisi dalam ("2 * 3" dan "5*"
 * tidak tersentuh), dan isinya tidak boleh memuat baris baru.
 */
export function buangMarkdown(teks: string): string {
  return teks
    .replace(/\*\*(?!\s)([^*\n]*[^\s*])\*\*/g, '$1')   // **tebal**
    .replace(/(?<![*\w])\*(?!\s)([^*\n]*[^\s*])\*(?!\w)/g, '$1')
    .replace(/(?<![_\w])__(?!\s)([^_\n]*[^\s_])__(?!\w)/g, '$1')
    .replace(/(?<![_\w])_(?!\s)([^_\n]*[^\s_])_(?!\w)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '');               // judul markdown
}

export function sanitize(teks: string): { bersih: string; dibuang: string[] } {
  const dibuang: string[] = [];
  const baris = teks.split('\n').filter((b) => {
    const l = b.toLowerCase();
    if (POLA_BUANG.some((p) => l.includes(p))) { dibuang.push(b.trim()); return false; }
    return true;
  });
  return {
    bersih: buangMarkdown(baris.join('\n')).replace(/\n{3,}/g, '\n\n').trim(),
    dibuang,
  };
}

/**
 * Target 40-50% dari panjang artikel, dibatasi 60-180 kata.
 * Rentang dijaga minimal 20 kata supaya promptnya tidak jadi perintah mustahil.
 */
export function targetKata(kataSumber: number): [number, number] {
  const jepit = (n: number) => Math.min(180, Math.max(60, Math.round(n)));
  let lo = jepit(kataSumber * 0.4);
  let hi = jepit(kataSumber * 0.5);
  if (hi - lo < 20) hi = Math.min(180, lo + 20);
  if (hi - lo < 20) lo = Math.max(60, hi - 20);
  return [lo, hi];
}

function buatPrompt(a: ArtikelUntukRingkas, [lo, hi]: [number, number]): string {
  return `Kamu adalah editor newsletter internal Sanghyang Resort (Anyer, Banten).

Ringkas artikel berita berikut untuk newsletter internal.

ATURAN KERAS:
1. Tulis ulang sepenuhnya dengan kalimatmu sendiri. DILARANG menyalin
   kalimat utuh dari artikel asli.
   DILARANG memulai ringkasan dengan kalimat pembuka artikel asli —
   mulailah dari fakta yang menurutmu paling penting, bukan dari
   urutan artikel.
   Kalau satu rangkaian lebih dari 10 kata sama persis dengan artikel
   asli, susun ulang kalimat itu.
2. Panjang: ${lo}-${hi} kata, dibagi jadi 2-4 paragraf pendek.
3. Bahasa Indonesia formal-jurnalistik. Netral, tanpa opini.
4. Pertahankan fakta penting: nama orang, jabatan, angka, tanggal,
   nama tempat, nama institusi.
   Nama orang, jabatan resmi, nama institusi, nama produk, dan istilah
   teknis boleh ditulis persis seperti aslinya — itu bukan penyalinan.
5. Kutipan langsung boleh MAKSIMAL satu kalimat pendek.
6. JANGAN tulis pengantar, penutup, atau komentar tentang hasil
   ringkasanmu. Keluarkan HANYA teks ringkasan.
7. Pastikan ejaan nama institusi benar
   (contoh: "Satuan Polisi Pamong Praja (Satpol PP)").
8. JANGAN menambahkan informasi, penilaian, atau kalimat pemanis yang
   tidak ada di artikel asli. Kalau artikelnya pendek, ringkasannya
   juga pendek. Lebih baik singkat daripada mengarang.
   JANGAN menyimpulkan atau melengkapi informasi yang tidak tertulis di
   artikel. Kalau sumber hanya menulis "Minggu", tulis "Minggu" — jangan
   tambahkan tanggalnya. Kalau sumber tidak menyebut angka, jangan
   menghitungnya sendiri.
   JANGAN memperluas cakupan pernyataan sumber. Kalau sumber menulis
   "setiap tipe kamar", jangan tulis "seluruh kamar"; kalau sumber
   menulis "sebagian", jangan tulis "semua". Pertahankan persis sekuat
   apa yang sumber nyatakan, tidak lebih.

JUDUL: ${a.title}
SUMBER: ${a.sourceName}
ARTIKEL:
${a.fullText.slice(0, MAX_TEXT)}`;
}

type BagianMasukan = { text?: string; inlineData?: { data?: string; mimeType?: string } };

/** Bentuk permintaan para pemanggil: teks, atau satu pesan berisi teks dan gambar base64. Model tidak bisa dipilih di sini. */
export type GenerateParams = {
  contents: string | { role?: string; parts?: BagianMasukan[] }[];
  config?: { responseMimeType?: string; maxOutputTokens?: number; systemInstruction?: string; abortSignal?: AbortSignal };
  /** "included": prompt pemanggil sudah memuat konteks Knowledge Graph lengkap, jadi ringkasan graf tidak dikirim dua kali. */
  knowledgeGraph?: 'included';
};

type MasukanInteraction = { type: 'text'; text: string } | { type: 'image'; data: string; mime_type: string };
type InteractionRequest = {
  model: string;
  input: string | MasukanInteraction[];
  store: false;
  generation_config: { max_output_tokens: number; thinking_level: ThinkingLevel };
  response_format?: { type: 'text'; mime_type: string };
  system_instruction?: string;
};
type InteractionOptions = { retries: { strategy: 'none' }; fetch_options?: { signal: AbortSignal } };

function keMasukan(part: BagianMasukan): MasukanInteraction {
  if (typeof part.text === 'string') return { type: 'text', text: part.text };
  if (part.inlineData?.data && part.inlineData.mimeType) {
    return { type: 'image', data: part.inlineData.data, mime_type: part.inlineData.mimeType };
  }
  throw new Error('Bagian masukan AI tidak dikenal: hanya teks dan gambar inlineData yang didukung');
}

/** Terjemahkan permintaan ke Interactions API. store false: interaksi tidak disimpan Google, sama seperti proyek web. */
export function buildInteraction(params: GenerateParams, config: AiConfig): { request: InteractionRequest; options: InteractionOptions } {
  const request: InteractionRequest = {
    model: config.model,
    input: typeof params.contents === 'string' ? params.contents : params.contents.flatMap((c) => c.parts ?? []).map(keMasukan),
    store: false,
    generation_config: {
      max_output_tokens: Math.max(params.config?.maxOutputTokens ?? 0, MIN_OUTPUT_TOKENS),
      thinking_level: config.thinkingLevel,
    },
  };
  // Interactions API menolak response_mime_type tanpa response_format ("responseFormat must be set"), jadi
  // keluaran JSON diminta lewat response_format seperti proyek web.
  if (params.config?.responseMimeType) request.response_format = { type: 'text', mime_type: params.config.responseMimeType };
  if (params.config?.systemInstruction) request.system_instruction = params.config.systemInstruction;
  // Coba ulang SDK dimatikan: kebijakan menunggu ada di generateWithRetry supaya tidak berlipat.
  const options: InteractionOptions = { retries: { strategy: 'none' } };
  if (params.config?.abortSignal) options.fetch_options = { signal: params.config.abortSignal };
  return { request, options };
}

/** Hasil yang dibaca pemanggil; finishReason dipetakan dari status interaksi supaya pemeriksa jawaban terpotong tetap jalan. */
export type GenerateResult = { text: string; candidates: { finishReason: string | undefined }[]; status: string | null; totalTokens: number | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readInteraction(raw: unknown): GenerateResult {
  const r = isRecord(raw) ? raw : {};
  const status = typeof r.status === 'string' ? r.status : null;
  // output_text ditambahkan SDK; tanpa itu teks diambil dari langkah model_output, bukan dari langkah thought.
  const potongan = (Array.isArray(r.steps) ? r.steps : [])
    .filter(isRecord)
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => (Array.isArray(s.content) ? s.content : []))
    .filter(isRecord)
    .flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : []));
  const text = typeof r.output_text === 'string' ? r.output_text : potongan.join('');
  const finishReason = status === 'completed' ? 'STOP' : status === 'incomplete' ? 'MAX_TOKENS' : status?.toUpperCase();
  const usage = isRecord(r.usage) ? r.usage : {};
  return { text, candidates: [{ finishReason }], status, totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null };
}

let klien: { key: string; api: GoogleGenAI['interactions'] } | null = null;
function interactions(apiKey: string): GoogleGenAI['interactions'] {
  if (klien?.key !== apiKey) klien = { key: apiKey, api: new GoogleGenAI({ apiKey }).interactions };
  return klien.api;
}

/**
 * Berapa lama harus menunggu sebelum coba lagi: angka retryDelay dari Google ("retryDelay": "8s" atau
 * "retry in 39.5s"). Batas per menit pulih paling lama dalam 60 detik, jadi tunggu sampai 65 detik dihormati
 * penuh. Tanpa angka dari Google: 2 detik (5 detik untuk 503) berlipat per percobaan.
 */
export function jedaDari(pesan: string, percobaan: number, acak: () => number = Math.random): number {
  const m = pesan.match(/retry(?:Delay"?\s*:\s*"|\s+in\s+)(\d+(?:\.\d+)?)s/i);
  // 503 "high demand" biasanya reda dalam belasan detik; 2 dan 4 detik terbukti tidak cukup (galat 13 Nov 2026).
  const dasar = /503|UNAVAILABLE|high demand|overloaded/i.test(pesan) ? 5000 : 2000;
  const saran = m ? Math.ceil(Number(m[1]) * 1000) + 500 : dasar * 2 ** percobaan;
  // Jitter supaya beberapa proses yang gagal bersamaan tidak mencoba ulang pada detik yang sama.
  return Math.min(saran + Math.round(acak() * 1000), 65_000);
}

const STATUS_GAGAL = new Set(['failed', 'cancelled', 'budget_exceeded']);
/**
 * Kuota harian: generateContent menulis "GenerateRequestsPerDay", Interactions API menulis "20 requests per day on
 * Free Tier" (26 Nov 2026). Keduanya baru pulih tengah malam Pacific, jadi menunggu di dalam permintaan sia-sia.
 */
const KUOTA_HARIAN = /per\s*day|perday|daily/i;

function detailGalat(e: unknown): string {
  const r = isRecord(e) ? e : {};
  const status = typeof r.status === 'number' ? ` HTTP ${r.status}` : '';
  const isi = r.error === undefined ? '' : ` ${JSON.stringify(r.error)}`;
  return `${e instanceof Error ? e.message : String(e)}${status}${isi}`;
}

type GenerateDeps = {
  create?: (request: InteractionRequest, options: InteractionOptions) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  env?: Readonly<Record<string, string | undefined>>;
  tries?: number;
  /** Ringkasan Knowledge Graph untuk instruksi sistem; bawaannya dibangun dari graf 30 hari terakhir. */
  grounding?: () => Promise<string>;
};

// Impor dinamis: modul graf membaca basis data dan mengimpor modul pasar yang juga memanggil AI lewat berkas ini.
const knowledgeGraphGrounding = async () => (await import('./knowledge-graph/ai-grounding')).knowledgeGraphGrounding();

/**
 * Satu panggilan AI dengan model PRIMARY_MODEL dan penalaran xhigh. Kena batas per menit (429) atau server sibuk
 * (503): tunggu sesuai retryDelay lalu coba lagi dengan model yang sama. Kuota harian habis atau galat permintaan
 * langsung dilempar; tidak ada model lain yang dicoba.
 */
export async function generateWithRetry(params: GenerateParams, deps: GenerateDeps = {}): Promise<GenerateResult> {
  const config = aiConfig(deps.env);
  // Semua panggilan AI membawa ringkasan Knowledge Graph (keputusan pemilik 27 Nov 2026). Graf yang gagal dibangun membuat
  // panggilan ini gagal juga, bukan berjalan tanpa graf.
  const grounding = params.knowledgeGraph === 'included' ? null : await (deps.grounding ?? knowledgeGraphGrounding)();
  const systemInstruction = [grounding, params.config?.systemInstruction].filter(Boolean).join('\n\n') || undefined;
  const { request, options } = buildInteraction({ ...params, config: { ...params.config, systemInstruction } }, config);
  const create =
    deps.create ??
    ((req: InteractionRequest, opt: InteractionOptions) =>
      interactions(config.apiKey).create(req as Parameters<GoogleGenAI['interactions']['create']>[0], opt));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tries = deps.tries ?? 4;
  for (let i = 0; ; i++) {
    try {
      const hasil = readInteraction(await create(request, options));
      if (hasil.status && STATUS_GAGAL.has(hasil.status)) throw new Error(`Jawaban AI berstatus ${hasil.status}`);
      return hasil;
    } catch (e) {
      const pesan = detailGalat(e);
      const bisaDitunggu = /HTTP (429|503)\b|503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|high demand/i.test(pesan);
      if (i + 1 >= tries || KUOTA_HARIAN.test(pesan) || !bisaDitunggu) throw e;
      await sleep(jedaDari(pesan, i));
    }
  }
}

/**
 * Terjemahan galat kuota untuk staf. Membedakan per-menit dari per-hari itu
 * wajib: jatah harian baru pulih tengah malam Pacific, jadi staf yang disuruh
 * "tunggu sebentar" akan menunggu sia-sia berjam-jam.
 *
 * Google mengirim retryDelay ~54 detik untuk kuota HARIAN sekalipun — angka itu
 * menyesatkan, jadi jangan diteruskan. quotaId yang dipercaya.
 * Mengembalikan undefined kalau galatnya bukan soal kuota; pesan mentah tidak
 * pernah boleh sampai ke staf.
 */
export function pesanKuota(galat: string): string | undefined {
  if (!/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(galat)) return undefined;
  return KUOTA_HARIAN.test(galat)
    ? 'Jatah harian AI sudah habis. Coba lagi besok siang.'
    : 'Layanan ringkasan sedang sibuk, tunggu sebentar lalu coba lagi.';
}

/** Tidak pernah melempar — kalau gagal, user tulis ringkasannya sendiri. */
export async function summarizeOne(a: ArtikelUntukRingkas): Promise<SummaryResult> {
  const kata = jumlahKata(a.fullText.slice(0, MAX_TEXT));
  const target = targetKata(kata);
  const warnings = kata < MIN_KATA_SUMBER ? ['artikel-pendek'] : [];
  const gagal = (error: string): SummaryResult =>
    ({ summary: null, error, pesanUser: pesanKuota(error), targetKata: target, warnings, dibuangSanitizer: [] });

  try {
    const res = await generateWithRetry({ contents: buatPrompt(a, target) });
    const teks = res.text.trim();
    if (!teks) return gagal('jawaban kosong');

    const { bersih, dibuang } = sanitize(teks);
    return { summary: bersih || null, targetKata: target, warnings, dibuangSanitizer: dibuang };
  } catch (e) {
    const pesan = (e as Error).message ?? String(e);
    return gagal(pesan);
  }
}

/** Sekuensial — hormati limit RPM free tier. Volume normal ~5 panggilan per newsletter. */
export async function summarizeMany(list: ArtikelUntukRingkas[]): Promise<SummaryResult[]> {
  const out: SummaryResult[] = [];
  for (const a of list) out.push(await summarizeOne(a));
  return out;
}
