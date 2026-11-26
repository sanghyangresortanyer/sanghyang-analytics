/**
 * Kategori promosi (lib/market/promo-type.ts) untuk setiap baris yang tampil sebagai promo di tabel web dan PDF, termasuk
 * unggahan mentah kompetitor yang lolos penyaring radar: AI membaca judul, ringkasan, isi paket, syarat, angka harga, dan
 * sumbernya, lalu memilih tepat satu kategori menurut urutan prioritas. Baris tanpa jawaban yang sah tetap null
 * ("belum ada data") dan dicatat sebagai kegagalan; tidak ada kategori cadangan. Dipanggil setelah
 * classifyPromotionKinds pada penyegaran promo, jadi promo baru dari "Perbarui Semua Data" dan jadwal malam ikut terbaca.
 */
import type { Prisma } from "@prisma/client";
import { stripLoneSurrogates, truncateText } from "../text/safe-truncate";
import { PROMO_ANALYST } from "./promo-extractor";
import { classifyPromoOrEvent, extractPromoPlainText, NOT_PROMO_CATEGORY, type PromoOrEventInput } from "./promo-radar";
import { isPromotionType, PROMOTION_TYPE_INFO, PROMOTION_TYPES, type PromotionTypeKey } from "./promo-type";

/** Baris per permintaan AI; satu permintaan untuk banyak baris menghemat kuota harian. */
const BATCH_SIZE = 25;
const MAX_PER_RUN = 150;
const SUMMARY_CHARS = 400;
const MAX_LINES = 8;
const LINE_CHARS = 160;

export interface TypeCandidate {
  id: string;
  competitor: string;
  title: string;
  category: string;
  description: string | null;
  details: string[];
  terms: string[];
  price: number | null;
  originalPrice: number | null;
  discount: number | null;
  source: string;
}

/**
 * Baris yang perlu kategori: yang tampil sebagai promo menurut klasifikasi Langkah 4 (summary, halaman Strategy, PDF).
 * Unggahan mentah kompetitor yang judulnya tegas promo ikut; unggahan umum dan event tidak.
 */
export const isTypeCandidate = (row: PromoOrEventInput): boolean => classifyPromoOrEvent(row) === "promo";

/** Label sumber tanpa keterangan mesin baca: "Situs resmi (dibaca Gemini)" menjadi "Situs resmi". */
const sourceLabel = (source: string) => source.replace(/\s*\(dibaca[^)]*\)/gi, "").trim();
const clean = (text: string, max: number) => truncateText(stripLoneSurrogates(text.trim()), max);

/** Contoh dari pemilik (21 Nov 2026): harga biasa yang tercantum tidak menjadikan pengenalan fasilitas sebuah diskon. */
const OWNER_CALIBRATION = `Contoh kalibrasi dari pemilik: "Seaside Candlelight Dinner" Mambruk Hotel & Convention di situs resmi, Rp 950.000 per pasangan, memperkenalkan makan malam romantis dengan pemandangan laut tanpa potongan, bonus, atau sebutan promo = "brand_awareness".`;

export function buildTypePrompt(rows: TypeCandidate[]): string {
  const definitions = PROMOTION_TYPES.map(
    (key, i) => `${i + 1}. "${key}" (${PROMOTION_TYPE_INFO[key].label}): ${PROMOTION_TYPE_INFO[key].definition}`,
  ).join("\n");
  const items = rows.map((r) => {
    // Judul tanpa penanda jenis unggahan; ringkasan = takarir unggahan atau ringkasan sumber, tanpa usulan "Versi kita".
    const { title, body } = extractPromoPlainText(r);
    return {
      id: r.id,
      tempat: r.competitor,
      judul: title,
      kategori: r.category,
      ringkasan: clean(body, SUMMARY_CHARS),
      isiPaket: r.details.slice(0, MAX_LINES).map((d) => clean(d, LINE_CHARS)),
      syarat: r.terms.slice(0, MAX_LINES).map((t) => clean(t, LINE_CHARS)),
      harga: r.price,
      hargaNormal: r.originalPrice,
      diskonPersen: r.discount,
      sumber: sourceLabel(r.source),
    };
  });
  return `${PROMO_ANALYST}
Tentukan kategori promosi setiap penawaran berikut, yaitu cara penawaran itu membujuk calon tamu. Tidak semua promosi berupa potongan harga.
Kategori, diurutkan menurut prioritas (bila beberapa cocok, pakai yang nomornya paling kecil):
${definitions}
Pilih tepat satu kategori untuk setiap penawaran, hanya dari fakta yang tertulis di judul, ringkasan, isi paket, syarat, angka harga, dan sumbernya. Harga biasa yang tercantum bukan potongan harga maupun harga spesial: potongan harga butuh harga normal, persen, atau kata diskon yang tertulis, dan harga spesial butuh sebutan promo, spesial, hemat, atau batas waktu.
${OWNER_CALIBRATION}

Penawaran:
${JSON.stringify(items, null, 1)}

Jawab HANYA JSON {"items": [{"id": "...", "promotionType": ${PROMOTION_TYPES.map((k) => `"${k}"`).join(" | ")}}]} untuk setiap id di atas.`;
}

/** Kategori per id; id yang tidak diminta, jawaban ganda, dan kunci di luar daftar dibuang tanpa diganti. */
export function parseTypeAnswer(raw: string, ids: readonly string[]): Map<string, PromotionTypeKey> {
  const out = new Map<string, PromotionTypeKey>();
  let j: unknown;
  try {
    j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    // ZERO-FALLBACK: jawaban rusak = peta kosong; pemanggil mencatat setiap baris sebagai kegagalan.
    return out;
  }
  const list = Array.isArray(j) ? j : (j as { items?: unknown })?.items;
  if (!Array.isArray(list)) return out;
  const wanted = new Set(ids);
  for (const item of list) {
    const { id, promotionType } = (item ?? {}) as Record<string, unknown>;
    const key = typeof promotionType === "string" ? promotionType.trim().toLowerCase() : null;
    if (typeof id !== "string" || !wanted.has(id) || out.has(id) || !isPromotionType(key)) continue;
    out.set(id, key);
  }
  return out;
}

export interface TypeClassificationResult {
  checked: number;
  byType: Partial<Record<PromotionTypeKey, number>>;
  failures: string[];
}

const PENDING_SELECT = {
  id: true,
  title: true,
  category: true,
  description: true,
  details: true,
  terms: true,
  price: true,
  originalPrice: true,
  discount: true,
  source: true,
  sourceUrl: true,
  kind: true,
  version: true,
  competitor: { select: { name: true } },
} as const;
/** Baris tertunda per kueri saat mencari kandidat. */
const PENDING_PAGE_SIZE = 200;

/**
 * Baris tanpa kategori promosi yang tampil sebagai promo, tangkapan terbaru dulu, paling banyak `limit` per putaran.
 * Event dan unggahan umum tidak pernah mendapat kategori, jadi antreannya terus bertambah; antrean dibaca per halaman dan
 * berhenti begitu kandidatnya cukup. Penyaring kandidat (isTypeCandidate) membaca teks, jadi tidak bisa dipindah ke SQL:
 * `take` langsung pada kueri bisa terisi baris bukan kandidat dan melewatkan kandidat di halaman berikutnya.
 */
export async function pendingTypeCandidates(
  limit = MAX_PER_RUN,
  pageSize = PENDING_PAGE_SIZE,
  client?: Pick<Prisma.TransactionClient, "competitorPromotion">,
) {
  const db = client ?? (await import("../db")).db;
  const { OWN_TEAM_SOURCE } = await import("./own-promos");
  type PendingRow = Prisma.CompetitorPromotionGetPayload<{ select: typeof PENDING_SELECT }>;
  const rows: PendingRow[] = [];
  let scanned = 0;
  for (let cursor: string | null = null; rows.length < limit; ) {
    const page: PendingRow[] = await db.competitorPromotion.findMany({
      where: {
        promotionType: null,
        category: { not: NOT_PROMO_CATEGORY },
        // Catatan internal tim marketing dan promo kompetitor yang sudah dikeluarkan tidak tampil di web maupun PDF.
        source: { not: OWN_TEAM_SOURCE },
        competitor: { active: true },
      },
      select: PENDING_SELECT,
      orderBy: [{ capturedAt: "desc" }, { id: "asc" }],
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    scanned += page.length;
    rows.push(...page.filter(isTypeCandidate).slice(0, limit - rows.length));
    if (page.length < pageSize) break;
    cursor = page[page.length - 1].id;
  }
  return { rows, scanned };
}

export async function classifyPromotionTypes(limit = MAX_PER_RUN): Promise<TypeClassificationResult> {
  const { db } = await import("../db");
  const { generateWithRetry } = await import("../gemini");
  const { rows } = await pendingTypeCandidates(limit);
  const result: TypeClassificationResult = { checked: 0, byType: {}, failures: [] };
  const asNumber = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    let answers: Map<string, PromotionTypeKey>;
    try {
      const res = await generateWithRetry({
        contents: buildTypePrompt(
          batch.map((r) => ({
            id: r.id,
            competitor: r.competitor.name,
            title: r.title,
            category: r.category,
            description: r.description,
            details: r.details,
            terms: r.terms,
            price: asNumber(r.price),
            originalPrice: asNumber(r.originalPrice),
            discount: asNumber(r.discount),
            source: r.source,
          })),
        ),
        config: { responseMimeType: "application/json" },
      });
      answers = parseTypeAnswer(res.text ?? "", batch.map((r) => r.id));
    } catch (error) {
      const message = (error as Error).message;
      result.failures.push(`kategori promosi: ${message.slice(0, 120)}`);
      // Kuota harian habis: batch berikutnya pasti ditolak juga.
      if (/PerDay/i.test(message)) break;
      continue;
    }
    for (const row of batch) {
      const type = answers.get(row.id);
      if (!type) {
        result.failures.push(`${row.competitor.name}: kategori promosi "${row.title}" tidak terbaca`);
        continue;
      }
      const updated = await db.competitorPromotion.updateMany({
        where: { id: row.id, version: row.version },
        data: { promotionType: type, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        result.failures.push(`${row.competitor.name}: konflik versi saat menandai kategori "${row.title}"`);
        continue;
      }
      result.checked++;
      result.byType[type] = (result.byType[type] ?? 0) + 1;
    }
  }
  return result;
}
