/**
 * Baris promo yang belum punya jenis (data sebelum 17 Nov 2026, promo Sanghyang dari situs dan tim marketing, postingan
 * yang dicatat manual) dibaca AI dari judul dan ringkasannya untuk memisahkan promo dan event dengan definisi yang sama
 * seperti pembacaan situs dan Instagram (KIND_RULES). Untuk event tanpa tanggal selesai, AI juga membaca tanggal acaranya:
 * tanggal tercatat baris lama bisa berupa tanggal posting, bukan tanggal acara. Isi paket tidak diisi di sini karena teks
 * sumbernya tidak tersimpan. Dipanggil di langkah "situs" pada penyegaran, jadi berjalan untuk tombol "Perbarui Semua
 * Data" dan jadwal malam.
 */
import { stripLoneSurrogates, truncateText } from "../text/safe-truncate";
import { wibDay } from "./date-range";
import { SOCIAL_POST_CATEGORY } from "./outlet-filters";
import { isPlausiblePromoDay, KIND_RULES, OUR_VERSION_MARKER, parseIsoDay, PROMO_ANALYST, PROMO_KINDS, promoDayRange, type PromoKind } from "./promo-extractor";
import { NOT_PROMO_CATEGORY } from "./promo-radar";

/** Baris per permintaan AI; satu permintaan untuk banyak baris menghemat kuota harian. */
const BATCH_SIZE = 25;
const MAX_PER_RUN = 150;
const SUMMARY_CHARS = 400;

export interface KindCandidate {
  id: string;
  competitor: string;
  title: string;
  category: string;
  description: string | null;
  /** Tanggal tercatat (WIB): tanggal mulai tertulis, tanggal posting, atau tanggal baca. */
  recordedDay: string;
}

export interface KindAnswer {
  kind: PromoKind;
  /** Tanggal acara untuk event bila tertulis atau pasti dari nama hari besarnya; null bila tidak pasti. */
  eventDate: string | null;
  eventEndDate: string | null;
}

export function buildKindPrompt(rows: KindCandidate[]): string {
  const items = rows.map((r) => ({
    id: r.id,
    kompetitor: r.competitor,
    judul: r.title,
    kategori: r.category,
    tanggalTercatat: r.recordedDay,
    ringkasan: truncateText(stripLoneSurrogates((r.description ?? "").split(OUR_VERSION_MARKER)[0].trim()), SUMMARY_CHARS),
  }));
  return `${PROMO_ANALYST}
Tentukan jenis setiap penawaran kompetitor berikut dari judul dan ringkasannya.
${KIND_RULES}
Untuk event, isi "eventDate" (YYYY-MM-DD) hanya bila tanggal acaranya tertulis di judul atau ringkasan, atau pasti dari nama hari besarnya (mis. malam tahun baru 2026 = 2026-12-31); "eventEndDate" bila acaranya lebih dari satu hari. "tanggalTercatat" bisa berupa tanggal posting, jadi jangan disalin sebagai tanggal acara. Tidak pasti = null. Untuk promo, keduanya null.

Penawaran:
${JSON.stringify(items, null, 1)}

Jawab HANYA JSON {"items": [{"id": "...", "kind": "promo" | "event", "eventDate": "YYYY-MM-DD" | null, "eventEndDate": "YYYY-MM-DD" | null}]} untuk setiap id di atas.`;
}

/** Jawaban per id; id yang tidak diminta atau jenis di luar daftar dibuang, tanggal yang tidak sah menjadi null. */
export function parseKindAnswer(raw: string, ids: readonly string[]): Map<string, KindAnswer> {
  const out = new Map<string, KindAnswer>();
  let j: unknown;
  try {
    j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return out;
  }
  const list = Array.isArray(j) ? j : (j as { items?: unknown })?.items;
  if (!Array.isArray(list)) return out;
  const wanted = new Set(ids);
  for (const item of list) {
    const { id, kind, eventDate, eventEndDate } = (item ?? {}) as Record<string, unknown>;
    const k = PROMO_KINDS.find((x) => typeof kind === "string" && x === kind.trim().toLowerCase());
    if (typeof id !== "string" || !wanted.has(id) || !k) continue;
    const start = k === "event" ? parseIsoDay(eventDate) : null;
    const end = start ? parseIsoDay(eventEndDate) : null;
    out.set(id, { kind: k, eventDate: start, eventEndDate: end && end >= start! ? end : null });
  }
  return out;
}

/**
 * Tanggal mulai dan selesai event lama dari jawaban AI: hanya untuk event yang belum punya tanggal selesai, dan hanya bila
 * tanggal acaranya wajar terhadap tanggal tercatat (jendela yang sama dengan parseExtraction).
 */
export function eventDatesFor(
  row: { startsAt: Date; endsAt: Date | null },
  answer: KindAnswer,
): { startsAt: Date; endsAt: Date } | null {
  if (answer.kind !== "event" || row.endsAt || !answer.eventDate || !isPlausiblePromoDay(answer.eventDate, row.startsAt)) return null;
  const days = promoDayRange(answer.eventDate, answer.eventEndDate ?? answer.eventDate);
  return { startsAt: days.startsAt!, endsAt: days.endsAt! };
}

export async function classifyPromotionKinds(limit = MAX_PER_RUN): Promise<{ checked: number; promos: number; events: number; failures: string[] }> {
  const { db } = await import("../db");
  const { generateWithRetry } = await import("../gemini");
  const rows = await db.competitorPromotion.findMany({
    where: { kind: null, category: { notIn: [NOT_PROMO_CATEGORY, SOCIAL_POST_CATEGORY] } },
    select: { id: true, title: true, category: true, description: true, startsAt: true, endsAt: true, version: true, competitor: { select: { name: true } } },
    orderBy: { capturedAt: "desc" },
    take: limit,
  });
  const result = { checked: 0, promos: 0, events: 0, failures: [] as string[] };
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const res = await generateWithRetry({
        contents: buildKindPrompt(
          batch.map((r) => ({ id: r.id, competitor: r.competitor.name, title: r.title, category: r.category, description: r.description, recordedDay: wibDay(r.startsAt) })),
        ),
        config: { responseMimeType: "application/json" },
      });
      const answers = parseKindAnswer(res.text ?? "", batch.map((r) => r.id));
      for (const row of batch) {
        const answer = answers.get(row.id);
        if (!answer) {
          result.failures.push(`${row.competitor.name}: jenis "${row.title}" tidak terbaca`);
          continue;
        }
        const dates = eventDatesFor(row, answer);
        const r = await db.competitorPromotion.updateMany({
          where: { id: row.id, version: row.version },
          data: { kind: answer.kind, ...(dates ?? {}), version: { increment: 1 } },
        });
        if (r.count !== 1) throw new Error(`konflik versi saat menandai "${row.title}"`);
        result.checked++;
        if (answer.kind === "event") result.events++;
        else result.promos++;
      }
    } catch (error) {
      result.failures.push(`jenis promo: ${(error as Error).message.slice(0, 120)}`);
    }
  }
  return result;
}
