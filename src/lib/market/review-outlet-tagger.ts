/**
 * Gemini membaca ulasan resort dan menandai outlet yang disebut tamu (Sunset Grill, Dragon, D'Bistro, D'Bar, D'Spa)
 * beserta sentimen untuk outlet itu saja: "kamar kotor tapi spa enak" = positif untuk D'Spa.
 * Tag disimpan di kolom themes ulasan yang sama, jadi summary/PDF menghitungnya untuk outlet tersebut. Tidak ada baris dihapus.
 */
import { GUEST_REVIEWS_ONLY } from "./outlet-filters";

const RESORT_NAME = "Sanghyang Indah Spa Resort";
/** Penanda ulasan yang sudah dibaca, supaya tidak dibaca ulang tiap malam. */
export const TAGGED_MARKER = "outlet-dibaca-gemini";
const SENTIMENTS = ["positive", "neutral", "negative"] as const;
type Sentiment = (typeof SENTIMENTS)[number];
const BATCH = 10;

export const TAGGABLE_OUTLETS = {
  "sunset-grill": "Sunset Grill (restoran tepi pantai, seafood, makan malam sunset)",
  "dragon-beach-club": "Dragon Beach Club (venue/ruangan khusus hiburan & musik di area Sanghyang, bukan tepi pantai, tanpa kolam)",
  dbistro: "D'Bistro (restoran/kafe di dalam resort, sarapan, menu harian)",
  dbar: "D'Bar & Karaoke (bar, karaoke, lounge)",
  dspa: "D'Spa & Hot Spring Aquamedic (spa, pijat, kolam air panas/hot spring)",
} as const;
type TaggableOutlet = keyof typeof TAGGABLE_OUTLETS;
const OUTLET_KEYS = Object.keys(TAGGABLE_OUTLETS) as TaggableOutlet[];

export interface OutletMention { outlet: TaggableOutlet; sentiment: Sentiment }

/** Tema yang boleh tampil sebagai label aspek (tanpa tag sentimen per outlet dan penanda). */
export const visibleThemes = (themes: string[]) => themes.filter((t) => t !== TAGGED_MARKER && !t.includes(":"));

/** Sentimen ulasan untuk outlet tertentu bila Gemini menandainya, selain itu null. */
export function outletSentiment(themes: string[], outlet: string): Sentiment | null {
  const s = themes.find((t) => t.startsWith(`${outlet}:`))?.slice(outlet.length + 1);
  return SENTIMENTS.find((x) => x === s) ?? null;
}

export function buildTagPrompt(reviews: { id: string; text: string }[]): string {
  return `Kamu membaca ulasan tamu Sanghyang Indah Spa Resort di Anyer. Resort ini punya outlet:
${Object.entries(TAGGABLE_OUTLETS).map(([k, v]) => `- "${k}": ${v}`).join("\n")}

Untuk setiap ulasan, sebutkan outlet yang JELAS dibahas tamu dan sentimen tamu khusus untuk outlet itu (bukan untuk resort secara umum).
Kamar, resepsionis, parkir, pantai umum, dan sarapan tanpa menyebut restoran tertentu BUKAN outlet. Kolam air panas/hot spring = "dspa". Ragu = jangan ditandai.
Teks yang BUKAN pengalaman tamu (deskripsi hotel, iklan, teks situs resmi, judul video) = "outlets": [].

Ulasan:
${reviews.map((r) => `[${r.id}] ${r.text.slice(0, 1200).replace(/\s+/g, " ")}`).join("\n")}

Jawab HANYA JSON: {"reviews":[{"id":"...","outlets":[{"outlet":"dspa","sentiment":"positive|neutral|negative"}]}]}
Ulasan tanpa outlet tetap ditulis dengan "outlets": [].`;
}

/** Validasi ketat: hanya id yang dikirim, outlet dan sentimen dari daftar. null bila jawaban rusak. */
export function parseTags(raw: string, ids: string[]): Map<string, OutletMention[]> | null {
  let j: unknown;
  try {
    j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  // Gemini kadang membalas daftar langsung, bukan {"reviews": [...]}.
  const list = Array.isArray(j) ? j : (j as { reviews?: unknown })?.reviews;
  if (!Array.isArray(list)) return null;
  const allowed = new Set(ids);
  const out = new Map<string, OutletMention[]>();
  for (const r of list as { id?: unknown; outlets?: unknown }[]) {
    if (typeof r?.id !== "string" || !allowed.has(r.id) || !Array.isArray(r.outlets)) continue;
    const mentions = new Map<TaggableOutlet, Sentiment>();
    for (const m of r.outlets as { outlet?: unknown; sentiment?: unknown }[]) {
      const outlet = OUTLET_KEYS.find((k) => k === m?.outlet);
      const sentiment = SENTIMENTS.find((s) => s === m?.sentiment);
      if (outlet && sentiment) mentions.set(outlet, sentiment);
    }
    out.set(r.id, [...mentions].map(([outlet, sentiment]) => ({ outlet, sentiment })));
  }
  return out;
}

/** Tema lama + tag outlet + penanda; tag outlet lama dibuang supaya hasil baca ulang tidak menumpuk. */
export function mergeThemes(themes: string[], mentions: OutletMention[]): string[] {
  const isOutletTag = (t: string) => t === TAGGED_MARKER || OUTLET_KEYS.some((k) => t === k || t.startsWith(`${k}:`));
  return [...themes.filter((t) => !isOutletTag(t)), ...mentions.flatMap((m) => [m.outlet, `${m.outlet}:${m.sentiment}`]), TAGGED_MARKER];
}

export const DEFAULT_TAGGER_WINDOW_MONTHS = 24;

export function getTaggerWindowCutoff(months = DEFAULT_TAGGER_WINDOW_MONTHS, now = new Date()): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Baca ulasan resort yang belum ditandai dalam jendela waktu aktif (default 24 bulan);
 * kembalikan hitungan. Ulasan lawas di luar jendela waktu dilewati agar kuota hemat dan analisis relevan.
 * attempted = ulasan yang menunggu ditandai; selisihnya dengan checked adalah yang belum terjawab dan dicoba lagi nanti.
 */
export async function tagResortReviews(
  limit = 200,
  monthsWindow = DEFAULT_TAGGER_WINDOW_MONTHS
): Promise<{ attempted: number; checked: number; tagged: number; failures: string[] }> {
  const { db } = await import("../db");
  const { generateWithRetry } = await import("../gemini");
  const sinceDate = getTaggerWindowCutoff(monthsWindow);
  const rows = await db.competitorReview.findMany({
    where: {
      archivedAt: null,
      competitor: { name: RESORT_NAME },
      reviewDate: { gte: sinceDate },
      NOT: { themes: { has: TAGGED_MARKER } },
      AND: [GUEST_REVIEWS_ONLY],
    },
    select: { id: true, text: true, themes: true, version: true },
    orderBy: { reviewDate: "desc" },
    take: limit,
  });
  const result = { attempted: rows.length, checked: 0, tagged: 0, failures: [] as string[] };
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const res = await generateWithRetry({
        contents: buildTagPrompt(batch),
        config: { responseMimeType: "application/json" },
      });
      const tags = parseTags(res.text ?? "", batch.map((r) => r.id));
      if (!tags) throw new Error("jawaban Gemini tidak valid");
      for (const row of batch) {
        const mentions = tags.get(row.id);
        if (!mentions) continue; // tidak dijawab: dicoba lagi run berikutnya
        const r = await db.competitorReview.updateMany({
          where: { id: row.id, version: row.version },
          data: { themes: mergeThemes(row.themes, mentions), version: { increment: 1 } },
        });
        if (r.count !== 1) {
          result.failures.push(`ulasan ${row.id}: OCC conflict`);
          continue;
        }
        result.checked++;
        if (mentions.length) result.tagged++;
      }
    } catch (error) {
      result.failures.push((error as Error).message.slice(0, 200));
    }
  }
  return result;
}
