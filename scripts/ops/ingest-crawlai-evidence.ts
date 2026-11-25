import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ReviewSentiment, MarketInsightType } from '@prisma/client';
import { db as prisma } from '@/lib/db';

type RawEntity = {
  id: string;
  name: string;
  kind: string;
  parent_id?: string | null;
  official_url?: string;
  location?: string;
  notes?: string;
};

type RawEvidence = {
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

type RawFinding = {
  entity_id: string;
  title: string;
  action: string;
  priority: string;
  rationale: string;
  evidence_ids?: string[];
  steps?: string[];
};

type RawComparison = {
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

type IngestData = {
  run_id: string;
  summary: string;
  findings: RawFinding[];
  comparisons: RawComparison[];
  entities: RawEntity[];
  evidence: RawEvidence[];
  stats: Record<string, number>;
};

function parseRating(r: string | number | undefined): number {
  if (r == null) return 4.0;
  if (typeof r === 'number') {
    if (r > 5) return Number((r / 2).toFixed(1)); // scale 10-point to 5-point
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

function parseSentiment(s: string | undefined): ReviewSentiment {
  const norm = (s || '').toLowerCase();
  if (norm === 'positive') return ReviewSentiment.positive;
  if (norm === 'negative') return ReviewSentiment.negative;
  return ReviewSentiment.neutral;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function main() {
  const dataPath = path.resolve(process.cwd(), 'data/crawlai_ingest_data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found at ${dataPath}. Jalankan scripts/ops/export_crawlai_for_ingest.py terlebih dahulu.`);
  }

  const rawJson: IngestData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`[Ingest] Memuat data riset run ${rawJson.run_id}`);
  console.log(`[Ingest] Entities: ${rawJson.entities.length}, Evidence: ${rawJson.evidence.length}, Findings: ${rawJson.findings.length}, Comparisons: ${rawJson.comparisons.length}`);

  // 1. Petakan entitas riset ke pesaing yang SUDAH ada dan aktif di registri (seed-competitor-registry.ts).
  // Skrip ini tidak membuat pesaing baru dan tidak menulis rating, jumlah ulasan, atau status aktif: dulu daftar di sini
  // menanam angka karangan (mis. "Bale-Bale Spa ASTON" 4,7 dari 190 ulasan, tempat yang tidak ada di Anyer) dan
  // mengaktifkan ulang pesaing yang sudah diarsipkan. Entitas yang tidak ada di registri dilewati dengan peringatan.
  const activeCompetitors = await prisma.competitor.findMany({ where: { active: true }, select: { id: true, name: true } });
  const competitorMap = new Map<string, string>(); // entity_id -> competitorId
  const ENTITY_REGISTRY_NAMES: Record<string, string> = {
    business: 'Sanghyang Indah Spa Resort',
    'sunset-grill': 'Sunset Grill (Sanghyang)',
    'dragon-beach-club': 'Dragon Beach Club (Sanghyang)',
    dbistro: "D'Bistro (Sanghyang)",
    dbar: "D'Bar & Karaoke (Sanghyang)",
    dspa: "D'Spa & Hot Spring Aquamedic (Sanghyang)",
    'competitor-aston': 'Aston Anyer Beach Hotel',
    'competitor-mambruk': 'Mambruk Hotel & Convention',
    'competitor-uppercircle': 'The Upper Circle Novus Jiva',
    'competitor-lighthouse': 'Lighthouse Restaurant & Bar Mambruk',
  };
  for (const [entityId, registryName] of Object.entries(ENTITY_REGISTRY_NAMES)) {
    const comp = activeCompetitors.find((c) => c.name === registryName);
    if (comp) competitorMap.set(entityId, comp.id);
    else console.warn(`[Ingest] ${registryName} tidak ada atau tidak aktif di registri; bukti untuk ${entityId} dilewati.`);
  }

  // 2. Ingest Evidence -> CompetitorReview
  console.log(`[Ingest] Memeriksa keaslian ${rawJson.evidence.length} rekaman bukti ulasan...`);
  let reviewsInserted = 0;
  let reviewsSkipped = 0;
  let reviewsRejected = 0;

  // Kompetitor yang sudah dikeluarkan dari daftar terverifikasi; ulasan lamanya tetap di DB.
  const RETIRED_ENTITY_IDS = new Set(['competitor-patra']);
  const retiredSkipped = rawJson.evidence.filter((ev) => RETIRED_ENTITY_IDS.has(ev.entity_id)).length;
  if (retiredSkipped) console.log(`[Ingest] ${retiredSkipped} ulasan kompetitor non-aktif (${[...RETIRED_ENTITY_IDS].join(', ')}) dilewati.`);

  // Import validasi keaslian dari lib/market/ingest-crawlai-evidence
  const { validateEvidenceRecord } = await import('@/lib/market/ingest-crawlai-evidence');

  for (const ev of rawJson.evidence) {
    if (RETIRED_ENTITY_IDS.has(ev.entity_id)) continue;

    // Tolak keras ulasan dengan sourceUrl tidak valid atau pola buatan (?cid=...)
    const validation = validateEvidenceRecord(ev);
    if (!validation.valid) {
      console.warn(`[Ingest] REJECTED (Zero Mock): ${validation.reason} [${ev.id}]`);
      reviewsRejected++;
      continue;
    }

    const compId = competitorMap.get(ev.entity_id);
    if (!compId) {
      console.warn(`[Ingest] Entity ${ev.entity_id} tidak ditemukan untuk ulasan ${ev.id}`);
      reviewsSkipped++;
      continue;
    }

    const reviewDate = ev.published_at ? new Date(ev.published_at) : new Date('2026-01-01T00:00:00Z');
    const validDate = isNaN(reviewDate.getTime()) ? new Date('2026-01-01T00:00:00Z') : reviewDate;
    const ratingDec = parseRating(ev.rating);
    const sentiment = parseSentiment(ev.sentiment);
    const source = ev.platform || 'Google Reviews';
    const themes = [ev.entity_id, ...(ev.aspects?.map((a) => a.name) || [])];
    const title = (ev.quote || (ev.aspects?.[0]?.name ? `Ulasan ${ev.aspects[0].name}` : 'Ulasan Tamu')).slice(0, 160);

    try {
      await prisma.competitorReview.upsert({
        where: {
          competitorId_source_externalId: {
            competitorId: compId,
            source: source,
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
      if (reviewsInserted % 50 === 0 || reviewsInserted === rawJson.evidence.length) {
        console.log(`[Ingest] Progres ulasan: ${reviewsInserted}/${rawJson.evidence.length} diproses...`);
      }
    } catch (err) {
      console.error(`[Ingest] Gagal menyimpan review ${ev.id}:`, err);
    }
  }
  console.log(`[Ingest] Selesai ulasan: ${reviewsInserted} berhasil diupsert, ${reviewsRejected} ditolak (Zero Mock), ${reviewsSkipped} dilewati.`);

  // 3. Ingest Findings & Comparisons -> MarketInsight
  console.log('[Ingest] Menyimpan temuan aksi (Actionable Findings) ke MarketInsight...');
  let insightsInserted = 0;

  for (const f of rawJson.findings) {
    const outletName = ENTITY_REGISTRY_NAMES[f.entity_id] ?? f.entity_id;
    const type: MarketInsightType = f.action === 'maintain' ? 'recommendation' : 'opportunity';
    const title = `[${outletName}] ${f.title}`;
    const summary = f.rationale;
    const fp = sha256(JSON.stringify([type, title.trim(), summary.trim()]));

    const evidenceData = {
      outlet: f.entity_id,
      outletName,
      action: f.action,
      priority: f.priority,
      steps: f.steps || [],
      evidenceIds: f.evidence_ids || [],
    };

    const sources = ['Google Reviews', 'Traveloka', 'Tripadvisor', 'Agoda'];

    await prisma.marketInsight.upsert({
      where: {
        id: (await prisma.marketInsight.findFirst({ where: { fingerprint: fp } }))?.id || '00000000-0000-0000-0000-000000000000',
      },
      update: {
        title,
        summary,
        evidence: evidenceData,
        sourceReferences: sources,
        priority: f.priority === 'high' ? 95 : 75,
        confidence: 95,
        status: 'active',
        activeFingerprint: fp,
      },
      create: {
        fingerprint: fp,
        activeFingerprint: fp,
        type,
        title,
        summary,
        evidence: evidenceData,
        sourceReferences: sources,
        priority: f.priority === 'high' ? 95 : 75,
        confidence: 95,
        status: 'active',
        version: 1,
      },
    });
    insightsInserted++;
  }

  // Ingest Head-to-Head Comparisons
  console.log('[Ingest] Menyimpan komparasi kompetitor (Head-to-Head Comparisons) ke MarketInsight...');
  for (const c of rawJson.comparisons) {
    const compName = ENTITY_REGISTRY_NAMES[c.competitor_id] ?? c.competitor_id;
    const title = `[Komparasi] Sanghyang vs ${compName}: ${c.aspect}`;
    const summary = c.observation;
    const fp = sha256(JSON.stringify(['insight', title.trim(), summary.trim()]));

    const evidenceData = {
      type: 'comparison',
      competitorId: c.competitor_id,
      competitorName: compName,
      aspect: c.aspect,
      limitations: c.limitations,
      entityStrengths: c.entity_strengths || [],
      entityWeaknesses: c.entity_weaknesses || [],
      competitorStrengths: c.competitor_strengths || [],
      competitorWeaknesses: c.competitor_weaknesses || [],
      evidenceIds: c.evidence_ids || [],
    };

    const sources = ['Traveloka', 'Google Maps', 'Agoda', 'Tripadvisor'];

    await prisma.marketInsight.upsert({
      where: {
        id: (await prisma.marketInsight.findFirst({ where: { fingerprint: fp } }))?.id || '00000000-0000-0000-0000-000000000000',
      },
      update: {
        title,
        summary,
        evidence: evidenceData,
        sourceReferences: sources,
        priority: 90,
        confidence: 92,
        status: 'active',
        activeFingerprint: fp,
      },
      create: {
        fingerprint: fp,
        activeFingerprint: fp,
        type: 'insight',
        title,
        summary,
        evidence: evidenceData,
        sourceReferences: sources,
        priority: 90,
        confidence: 92,
        status: 'active',
        version: 1,
      },
    });
    insightsInserted++;
  }

  // Ingest Executive Summary
  if (rawJson.summary) {
    const title = '[Siklus Riset Pasar] Sinkronisasi Multi-Outlet Anyer–Carita';
    const summary = rawJson.summary;
    const fp = sha256(JSON.stringify(['insight', title.trim(), summary.trim()]));

    await prisma.marketInsight.upsert({
      where: {
        id: (await prisma.marketInsight.findFirst({ where: { fingerprint: fp } }))?.id || '00000000-0000-0000-0000-000000000000',
      },
      update: {
        title,
        summary,
        evidence: rawJson.stats,
        sourceReferences: ['CRAWLAIBWP Engine', 'Google Reviews', 'OTA Platforms'],
        priority: 100,
        confidence: 98,
        status: 'active',
        activeFingerprint: fp,
      },
      create: {
        fingerprint: fp,
        activeFingerprint: fp,
        type: 'insight',
        title,
        summary,
        evidence: rawJson.stats,
        sourceReferences: ['CRAWLAIBWP Engine', 'Google Reviews', 'OTA Platforms'],
        priority: 100,
        confidence: 98,
        status: 'active',
        version: 1,
      },
    });
    insightsInserted++;
  }

  console.log(`[Ingest] Berhasil menyimpan ${insightsInserted} MarketInsight (temuan aksi, perbandingan, & ringkasan eksekutif)!`);
  console.log('[Ingest] Seluruh integrasi data selesai dengan sukses.');
}

main()
  .catch((e) => {
    console.error('[Ingest] Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

