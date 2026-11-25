/**
 * Topik ulasan Google Maps per tempat: kata yang menurut Google paling sering disebut tamu beserta jumlah ulasannya.
 * Diisi scripts/ops/crawl-venue-reviews.ts dari tab Ulasan yang tampil untuk perayap jujur, bukan dari login atau API.
 */
import data from "./review-topics.data.json";
import type { ReviewTopics } from "./competitor-comparison";

const PLACES = data.places as Record<string, ReviewTopics>;

export function reviewTopicsOf(name: string): ReviewTopics | null {
  return PLACES[name] ?? null;
}

/** Tombol topik Google Maps: "lalat, disebutkan dalam 41 ulasan". "Semua ulasan" dan "Lihat 6 Topik lainnya" bukan topik. */
export function parseTopicChips(labels: readonly (string | null)[]): { label: string; count: number }[] {
  const topics: { label: string; count: number }[] = [];
  for (const raw of labels) {
    const m = raw?.trim().match(/^(.+), disebutkan dalam (\d[\d.]*) ulasan$/i);
    if (m) topics.push({ label: m[1].trim(), count: Number(m[2].replace(/\./g, "")) });
  }
  return topics;
}
