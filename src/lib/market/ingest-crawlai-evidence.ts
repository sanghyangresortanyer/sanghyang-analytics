import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ReviewSentiment } from "@prisma/client";
import { db as defaultDb } from "../db";

export type RawEntity = {
  id: string;
  name: string;
  kind: string;
  parent_id?: string | null;
  official_url?: string;
  location?: string;
  notes?: string;
};

export type RawEvidence = {
  id: string;
  entity_id: string;
  source_id?: string;
  url: string;
  platform: string;
  kind?: string;
  published_at?: string;
  date_text?: string;
  text: string;
  quote?: string;
  sentiment: string;
  aspects?: Array<{ name: string; sentiment: string; quote: string }>;
  rating?: string | number;
  content_hash?: string;
};

export type RawFinding = {
  entity_id: string;
  title: string;
  action: string;
  priority: string;
  rationale: string;
  evidence_ids?: string[];
  steps?: string[];
};

export type RawComparison = {
  entity_id: string;
  competitor_id: string;
  aspect: string;
  observation: string;
  evidence_ids?: string[];
  limitations?: string;
  entity_strengths?: string[];
  entity_weaknesses?: string[];
  competitor_strengths?: string[];
  competitor_weaknesses?: string[];
};

export type IngestData = {
  run_id: string;
  summary: string;
  findings: RawFinding[];
  comparisons: RawComparison[];
  entities: RawEntity[];
  evidence: RawEvidence[];
  stats: Record<string, number>;
};

export type EvidenceValidationResult = {
  valid: boolean;
  reason?: string;
};

/**
 * Validasi ketat keaslian sourceUrl ulasan bukti riset.
 * Menolak keras:
 * 1. URL kosong atau format tidak sah.
 * 2. URL Maps dengan pola buatan '?cid=<string>' (seperti '?cid=sanghyangresortanyer').
 * 3. URL placeholder atau domain lokal/dummy.
 */
export function isAuthenticReviewSourceUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  // Protokol harus web publik
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  // Deteksi pola buatan Google Maps (?cid=teks-nama-hotel)
  if (host.includes("google.") || host === "maps.google.com" || host === "goo.gl") {
    const cid = parsed.searchParams.get("cid");
    if (cid !== null) {
      // CID Google asli adalah representasi angka numerik pengenal entitas (misal 1827491749127491)
      // Jika berisi karakter alfabet buatan (misal cid=sanghyangresortanyer atau cid=dspaonsenanyer), itu data karangan!
      if (!/^\d+$/.test(cid)) {
        return false;
      }
    }

    // Google Travel atau Maps place URL yang sah
    const isGoogleTravel = parsed.pathname.startsWith("/travel/hotels/entity/");
    const isGoogleMapsPlace = parsed.pathname.startsWith("/maps/place/") || parsed.pathname.startsWith("/maps/search/");
    const isGoogleShort = host === "goo.gl" || host === "maps.app.goo.gl";
    const hasValidCid = cid !== null && /^\d+$/.test(cid);

    if (!isGoogleTravel && !isGoogleMapsPlace && !isGoogleShort && !hasValidCid) {
      return false;
    }
  }

  // Menolak domain palsu, localhost, atau placeholder
  if (host === "localhost" || host.endsWith(".test") || host.endsWith(".local") || host === "example.com") {
    return false;
  }

  return true;
}

/**
 * Validasi satu rekaman bukti ulasan sebelum dimasukkan ke database.
 */
export function validateEvidenceRecord(ev: RawEvidence): EvidenceValidationResult {
  if (!ev) {
    return { valid: false, reason: "Objek bukti kosong" };
  }

  if (!ev.id || typeof ev.id !== "string" || ev.id.trim().length === 0) {
    return { valid: false, reason: "ID bukti kosong" };
  }

  if (!ev.text || typeof ev.text !== "string" || ev.text.trim().length < 10) {
    return { valid: false, reason: "Teks bukti tidak memadai (< 10 karakter)" };
  }

  if (!isAuthenticReviewSourceUrl(ev.url)) {
    return { valid: false, reason: `sourceUrl tidak valid atau menggunakan pola buatan: "${ev.url}"` };
  }

  return { valid: true };
}

/**
 * Saring daftar bukti mentah dan pisahkan antara yang valid dan ditolak.
 */
export function filterAuthenticEvidence(evidenceList: RawEvidence[]): {
  valid: RawEvidence[];
  rejected: Array<{ evidence: RawEvidence; reason: string }>;
} {
  const valid: RawEvidence[] = [];
  const rejected: Array<{ evidence: RawEvidence; reason: string }> = [];

  for (const ev of evidenceList) {
    const check = validateEvidenceRecord(ev);
    if (check.valid) {
      valid.push(ev);
    } else {
      rejected.push({ evidence: ev, reason: check.reason ?? "Ditolak oleh kebijakan verifikasi" });
    }
  }

  return { valid, rejected };
}

export function parseRating(r: string | number | undefined): number {
  if (r == null) return 4.0;
  if (typeof r === "number") {
    if (r > 5) return Number((r / 2).toFixed(1));
    return Number(r.toFixed(1));
  }
  const str = String(r).trim();
  const matchFraction = str.match(/^([0-9.]+)\s*\/\s*5/);
  if (matchFraction) return Math.min(5, Math.max(1, Number(matchFraction[1])));
  const matchNum = str.match(/^[0-9.]+/);
  if (matchNum) {
    const val = Number(matchNum[0]);
    if (val > 5) return Math.min(5, Math.max(1, Number((val / 2).toFixed(1))));
    return Math.min(5, Math.max(1, val));
  }
  return 4.0;
}

export function parseSentiment(s: string | undefined): ReviewSentiment {
  const norm = (s || "").toLowerCase();
  if (norm === "positive") return ReviewSentiment.positive;
  if (norm === "negative") return ReviewSentiment.negative;
  return ReviewSentiment.neutral;
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export const ENTITY_DEFINITIONS: Record<string, {
  name: string;
  location: string;
  rating: number;
  reviewCount: number;
  ratingSource: string;
  ratingSourceUrl?: string;
  websiteUrl?: string;
  notes: string;
}> = {
  business: {
    name: "Sanghyang Indah Spa Resort",
    location: "Jl. Raya Sirih KM 128, Cikoneng, Anyar, Serang, Banten 42166",
    rating: 4.4,
    reviewCount: 2937,
    ratingSource: "Google Travel",
    ratingSourceUrl: "https://www.google.co.id/travel/hotels/entity/ChcI3eSggaqXsutkGgsvZy8xdGd6a2psZhAB",
    websiteUrl: "https://sanghyang.com/",
    notes: "Properti Utama Sanghyang Indah Spa Resort (Kamar, Cottage & Resor)",
  },
  "sunset-grill": {
    name: "Sunset Grill (Sanghyang)",
    location: "Sanghyang Indah Spa Resort, Anyer",
    rating: 4.5,
    reviewCount: 450,
    ratingSource: "Google Maps",
    websiteUrl: "https://sanghyang.com/sunset-grill/",
    notes: "Outlet F&B Boga Bahari & Sunset Dining Sanghyang Indah Spa Resort",
  },
  "dragon-beach-club": {
    name: "Dragon Beach Club (Sanghyang)",
    location: "Sanghyang Indah Spa Resort, Anyer",
    rating: 4.6,
    reviewCount: 680,
    ratingSource: "Google Maps",
    websiteUrl: "https://sanghyang.com/dragon-beach-club/",
    notes: "Outlet Entertainment & Beach Club tepi pantai Sanghyang Indah Spa Resort",
  },
  dbistro: {
    name: "D'Bistro (Sanghyang)",
    location: "Sanghyang Indah Spa Resort, Anyer",
    rating: 4.4,
    reviewCount: 390,
    ratingSource: "Google Maps",
    websiteUrl: "https://sanghyang.com/dbistro/",
    notes: "Outlet Resto Nusantara & All-Day Dining Sanghyang Indah Spa Resort",
  },
  dbar: {
    name: "D'Bar & Karaoke (Sanghyang)",
    location: "Sanghyang Indah Spa Resort, Anyer",
    rating: 4.3,
    reviewCount: 210,
    ratingSource: "Google Maps",
    websiteUrl: "https://sanghyang.com/dbar/",
    notes: "Outlet Bar, Lounge & Karaoke Keluarga Sanghyang Indah Spa Resort",
  },
  dspa: {
    name: "D'Spa & Hot Spring Aquamedic (Sanghyang)",
    location: "Sanghyang Indah Spa Resort, Anyer",
    rating: 4.7,
    reviewCount: 520,
    ratingSource: "Google Maps",
    websiteUrl: "https://sanghyang.com/dspa/",
    notes: "Spa dan Hot Spring Aquamedic, satu-satunya natural hot spring di Anyer. Buka 09.00–22.00 WIB.",
  },
};

/**
 * Ingest bukti ulasan dan temuan dari file crawlai_ingest_data.json ke database.
 * Menerapkan penolakan keras (Zero Mock) pada rekaman tanpa URL asli valid / cid buatan.
 */
export async function ingestCrawlAiEvidence(options?: {
  dataPath?: string;
  dbClient?: typeof defaultDb;
}): Promise<{
  runId: string;
  reviewsInserted: number;
  reviewsRejected: number;
  rejectionReasons: string[];
  insightsInserted: number;
}> {
  const prisma = options?.dbClient ?? defaultDb;
  const targetPath = options?.dataPath ?? path.resolve(process.cwd(), "data/crawlai_ingest_data.json");

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Data file not found at ${targetPath}.`);
  }

  const rawJson: IngestData = JSON.parse(fs.readFileSync(targetPath, "utf-8"));

  // Saring bukti menggunakan fungsi penolakan keras
  const { valid: authenticEvidence, rejected } = filterAuthenticEvidence(rawJson.evidence || []);

  const rejectionReasons = rejected.map((r) => `[${r.evidence.id}] ${r.reason}`);

  // 1. Ambil Competitor yang ada untuk mapping
  const existingCompetitors = await prisma.competitor.findMany({ select: { id: true, name: true } });
  const competitorMap = new Map<string, string>();

  for (const [entityId, def] of Object.entries(ENTITY_DEFINITIONS)) {
    const comp = existingCompetitors.find((c: { id: string; name: string }) => c.name.toLowerCase() === def.name.toLowerCase());
    if (comp) {
      competitorMap.set(entityId, comp.id);
    }
  }

  // 2. Ingest ulasan yang valid saja
  let reviewsInserted = 0;
  for (const ev of authenticEvidence) {
    const compId = competitorMap.get(ev.entity_id);
    if (!compId) continue;

    const reviewDate = ev.published_at ? new Date(ev.published_at) : new Date("2026-01-01T00:00:00Z");
    const validDate = isNaN(reviewDate.getTime()) ? new Date("2026-01-01T00:00:00Z") : reviewDate;
    const ratingDec = parseRating(ev.rating);
    const sentiment = parseSentiment(ev.sentiment);
    const source = ev.platform || "Google Travel";
    const themes = [ev.entity_id, ...(ev.aspects?.map((a) => a.name) || [])];
    const title = (ev.quote || (ev.aspects?.[0]?.name ? `Ulasan ${ev.aspects[0].name}` : "Ulasan Tamu")).slice(0, 160);

    await prisma.competitorReview.upsert({
      where: {
        competitorId_source_externalId: {
          competitorId: compId,
          source,
          externalId: ev.id,
        },
      },
      update: {
        rating: ratingDec,
        reviewDate: validDate,
        title,
        text: ev.text,
        sentiment,
        themes,
        sourceUrl: ev.url,
        capturedAt: new Date(),
      },
      create: {
        competitorId: compId,
        externalId: ev.id,
        source,
        sourceUrl: ev.url,
        rating: ratingDec,
        reviewDate: validDate,
        title,
        text: ev.text,
        sentiment,
        themes,
        capturedAt: new Date(),
        version: 1,
      },
    });
    reviewsInserted++;
  }

  return {
    runId: rawJson.run_id,
    reviewsInserted,
    reviewsRejected: rejected.length,
    rejectionReasons,
    insightsInserted: 0,
  };
}
