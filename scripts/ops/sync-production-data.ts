/**
 * Menyamakan DB produksi dengan DB kerja lokal (127.0.0.1:55432). Permintaan pemakai 19 Nov 2026: produksi harus sama
 * dengan localhost:3001, termasuk setiap kali push; dijalankan hook pre-push lewat sync-before-push.ts.
 *
 * Dua jenis data, dua aturan:
 * - Registri dan kurasi mengikuti lokal, tempat keduanya dikelola lewat skrip: kolom registri pesaing (peran pembanding,
 *   outlet, hotel induk, tautan, jarak), fakta situs resmi, dan arsip ulasan. Baris produksi bernama lama yang tautannya
 *   sama dengan baris lokal diganti namanya; bila nama barunya sudah ada, anak barisnya dipindah lalu baris lama yang
 *   sudah kosong dihapus, supaya registri kedua DB sama persis.
 * - Pengamatan digabung ke dua arah, karena job malam dan ekstensi menulis ke produksi sedangkan perayapan dan pembacaan
 *   lokal menulis ke lokal: berita beserta hasil bacaannya, ulasan, promo dan event, tarif, rating listing, statistik
 *   makro, koordinat, omset, snapshot bulanan, tujuan bulanan, dan insight. Baris yang hanya ada di satu sisi disalin ke
 *   sisi lain. Untuk baris yang ada di kedua sisi: bacaan berita yang berhasil mengalahkan bacaan gagal (tidak_terbaca),
 *   lalu yang lebih baru; rating, insight, snapshot, dan tujuan memakai yang lebih baru; ulasan memakai teks utuh bila
 *   sisi lain terpotong, tema yang sudah dipilah per outlet, dan arsip dari sisi mana pun. Rating dengan waktu baca sama
 *   mengikuti lokal, jadi koreksi rating langsung di produksi tanpa waktu baca baru tertimpa nilai lokal saat push.
 * Log operasional per lingkungan (ScrapeRun, ScrapeError, ScrapeLock, heartbeat malam) tidak disalin. Baris Source juga
 * tidak disalin, tetapi nama dan kategorinya disamakan (langkah 9): sumber job terdaftar mengikuti registri tugas
 * (DEFAULT_JOB_SOURCES) di kedua DB, sumber lain yang ada di kedua DB mengikuti lokal.
 *
 * Bawaannya uji kering: hanya membaca dan mencetak rencana. `--apply` menulis; untuk DB jarak jauh pengaman lib/db.ts
 * mewajibkan ALLOW_PRODUCTION_WRITE=1. Sebelum menulis, baris yang bisa berubah di kedua DB dicadangkan ke backups/ (10
 * cadangan terbaru disimpan).
 * Setiap perubahan baris memakai OCC; skrip aman dijalankan ulang dan tidak mengubah apa pun bila kedua DB sudah sama.
 * Klien produksi memakai socket_timeout (SYNC_SOCKET_TIMEOUT_S): kueri yang tidak dijawab menjadi galat P1008, sinkron
 * berhenti, dan hook membatalkan push. Menjalankan ulang melanjutkan dari keadaan kedua DB saat itu.
 *
 *   Uji kering: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/ops/sync-production-data.ts
 *   Terapkan:   ALLOW_PRODUCTION_WRITE=1 node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/ops/sync-production-data.ts --apply
 */
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Prisma, type CompetitorPromotion, type NewsReadStatus, type PrismaClient } from "@prisma/client";
import { createDatabaseClient, getDatabaseTarget, getDatabaseUrl, type DbEnv } from "@/lib/db";
import { HEARTBEAT_FINGERPRINT } from "@/lib/market/refresh-outcome";
import { TAGGED_MARKER } from "@/lib/market/review-outlet-tagger";
import { DEFAULT_JOB_SOURCES } from "@/lib/market/scrape-log";
import { isTruncatedVersionOf } from "@/lib/market/scrape-new-reviews";

const LOCAL_WORK_DB = { hosts: new Set(["127.0.0.1", "localhost"]), port: "55432" };
const BACKUPS_KEPT = 10;

/**
 * Batas tunggu satu kueri ke produksi, dalam detik (parameter Prisma socket_timeout). Sinkron 22 Nov 2026 macet 17 menit:
 * respons SELECT Article berhenti di tengah jalan, sesi pooler "idle in transaction / ClientRead", soket klien diam.
 * Tanpa batas ini klien menunggu selamanya dan hook pre-push tidak pernah membatalkan push.
 * Nilainya dari kueri terbesar yang terukur (DB lokal 22 Nov 2026): halaman artikel (ARTICLE_PAGE_SIZE) ≈ 0,6 MB di
 * kabel, butir pasar per 1.000 artikel paling besar ≈ 1,7 MB, dan kueri tanpa halaman lainnya (cadangan, promo, ulasan)
 * ≤ 0,7 MB. Cadangan produksi pada sinkron yang sama membaca ≈ 1,2 MB data dalam 4,9 dtk termasuk semua bolak-baliknya,
 * jadi laju terburuk ≈ 0,25 MB/dtk dan kueri terbesar selesai dalam ≈ 7 dtk. 60 dtk memberi faktor aman ≥ 8 untuk
 * jaringan yang melambat, dan tetap jauh di bawah 17 menit.
 */
export const SYNC_SOCKET_TIMEOUT_S = 60;

/** URL klien produksi khusus sinkron: DATABASE_URL dengan parameter bawaan lib/db.ts, ditambah socket_timeout. */
export function syncRemoteUrl(env: DbEnv = process.env, socketTimeoutS = SYNC_SOCKET_TIMEOUT_S): string {
  const url = getDatabaseUrl(env);
  return url.includes("socket_timeout=") ? url : `${url}${url.includes("?") ? "&" : "?"}socket_timeout=${socketTimeoutS}`;
}

/** Klien produksi khusus sinkron. Pengaman tulis lib/db.ts tetap berlaku karena env yang sama dipakai. */
export const createSyncRemoteClient = (env: DbEnv = process.env): PrismaClient => createDatabaseClient({ ...env, DATABASE_URL: syncRemoteUrl(env) });

const ARTICLE_REF = {
  id: true, version: true, sourceId: true, canonicalUrl: true, contentHash: true, normalizedTitle: true, publishedAt: true, publisherUrl: true,
  source: { select: { domain: true, method: true } },
} as const;
export const ARTICLE_PAGE_SIZE = 1000;

/**
 * Kolom pencocokan semua artikel satu DB, dibaca per halaman menurut id. Dengan pgbouncer=true Prisma membungkus setiap
 * kueri dalam BEGIN, DEALLOCATE ALL, dan COMMIT, jadi selama respons belum habis diterima, sesi pooler tertahan di dalam
 * transaksi. Satu kueri untuk seluruh tabel (12.120 artikel, ≈ 7,2 MB di DB lokal 22 Nov 2026) macet di tengah jalan;
 * halaman ≈ 0,6 MB membuat setiap respons singkat sehingga SYNC_SOCKET_TIMEOUT_S bisa ketat.
 */
export async function loadArticleRefs(client: PrismaClient, pageSize = ARTICLE_PAGE_SIZE) {
  type ArticleRef = Prisma.ArticleGetPayload<{ select: typeof ARTICLE_REF }>;
  const rows: ArticleRef[] = [];
  for (let after: string | null = null; ; ) {
    const page: ArticleRef[] = await client.article.findMany({ select: ARTICLE_REF, where: after ? { id: { gt: after } } : {}, orderBy: { id: "asc" }, take: pageSize });
    rows.push(...page);
    if (page.length < pageSize) return rows;
    after = page[page.length - 1].id;
  }
}

/** Kolom registri yang disalin apa adanya dari lokal. */
export const REGISTRY_FIELDS = [
  "category", "group", "outlets", "placeId", "googleMapsUrl", "mapsUrl", "roadKm", "driveMinutes", "straightKm", "distanceSource",
  "address", "starRating", "roomCount", "websiteUrl", "instagramUrl", "facebookUrl", "tiktokUrl", "location", "bookingUrl", "ratesUrl",
  "socialUrl", "active", "compsetRole", "retiredReason", "verifiedAt", "notes",
] as const;
/** Rating listing: bacaan yang lebih baru menang di kedua arah (job rating malam mengisinya di produksi). */
export const RATING_FIELDS = ["rating", "reviewCount", "ratingSource", "ratingSourceUrl", "ratingObservedAt"] as const;
/** Tautan yang menunjuk satu tempat; dipakai mengenali baris produksi bernama lama. */
const LINK_FIELDS = ["instagramUrl", "websiteUrl", "googleMapsUrl", "mapsUrl"] as const;
/** Kolom MarketItem yang disalin dari bacaan pemenang. */
const ITEM_FIELDS = [
  "kind", "location", "venue", "organizer", "brand", "description", "targetAudience", "relevanceScore", "startsAt", "endsAt", "tags",
  "readStatus", "readAt", "readNote", "readSummary", "outlets", "articleUrl", "distanceKm",
] as const;
const INSIGHT_FIELDS = ["type", "title", "summary", "evidence", "sourceReferences", "priority", "confidence", "status", "generatedAt"] as const;
/**
 * Kolom ulasan berpasangan yang mengikuti lokal. Pasangan lewat teks bisa beda kunci dan tanggal karena tanggal relatif
 * ("1 minggu lalu") dihitung saat dibaca; perayap juga mencocokkan lewat teks, jadi kunci lokal aman dipakai produksi.
 */
export const REVIEW_FIELDS = ["externalId", "rating", "reviewDate", "title", "sourceUrl", "capturedAt"] as const;
/** Isi tangkapan promo yang disamakan (judul dan waktu tangkap bagian dari kunci). */
export const PROMO_FIELDS = [
  "category", "description", "startsAt", "endsAt", "price", "originalPrice", "discount", "source", "sourceUrl", "imageUrl", "status", "kind", "details", "terms", "promotionType",
] as const;

type Row = Record<string, unknown> & { id: string; name: string };
type Side = { label: "lokal" | "produksi"; client: PrismaClient };

const normLink = (u: unknown) => (typeof u === "string" ? u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "") : "");
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? "" : String(v));
const pick = (row: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.map((f) => [f, row[f] ?? null]));

/** Nilai yang sama walau tipenya berbeda (Decimal, Date, larik, JSON). */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v instanceof Date ? v.getTime() : v !== null && typeof v === "object" && "toFixed" in (v as object) ? String(v) : JSON.stringify(v ?? null));
  return norm(a) === norm(b);
}

export function changedFields(source: Record<string, unknown>, target: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (!sameValue(source[f], target[f])) out[f] = source[f] ?? null;
  return out;
}

/** Bacaan rating a lebih baru dari b: waktu bacanya lebih baru, atau b belum punya waktu baca. */
const ratingNewer = (a: Row, b: Row | undefined) => !b || !b.ratingObservedAt || (a.ratingObservedAt instanceof Date && a.ratingObservedAt > (b.ratingObservedAt as Date));

/**
 * Kolom yang disalin dari baris registri lokal ke baris produksi bernama sama. Rating ikut bila bacaan lokal lebih baru,
 * atau bacaannya sama (waktu baca sama): label sumber yang dirapikan di lokal tanpa membaca ulang, misalnya nama alat
 * yang dibuang dari ratingSource, tetap sampai ke produksi.
 */
export function registryFieldsToRemote(local: Row, remote: Row | undefined): readonly string[] {
  const ratingFromLocal = ratingNewer(local, remote) || sameValue(local.ratingObservedAt, remote?.ratingObservedAt);
  return [...REGISTRY_FIELDS, ...(ratingFromLocal ? RATING_FIELDS : [])];
}

export type SourceRow = { id: string; name: string; domain: string; method: string; category: string; enabled: boolean; version: number };
type SourceLabel = Partial<Pick<SourceRow, "name" | "category">>;
export type SourceRegistryEntry = Pick<SourceRow, "domain" | "method" | "name" | "category">;
export type SourcePlanItem = { side: Side["label"]; id: string; version: number; domain: string; method: string; from: SourceLabel; data: SourceLabel };

/**
 * Baris Source yang nama atau kategorinya disamakan, di kedua DB. Nama sumber tampil sebagai label penerbit berita dan
 * sumber di Knowledge Graph. Sumber job terdaftar mengikuti registri tugas, karena job di lokal maupun di produksi menulis
 * nama dari registri itu: nama baru di registri tidak bolak-balik antara push dari lokal yang job-nya belum berjalan dan
 * job malam di produksi. Sumber lain yang ada di kedua DB mengikuti lokal. Sumber tak terdaftar yang hanya ada di satu DB
 * adalah catatan job yang pernah berjalan di sana, jadi dibiarkan.
 */
export function planSourceNames(local: SourceRow[], remote: SourceRow[], registry: readonly SourceRegistryEntry[]): SourcePlanItem[] {
  const key = (s: { domain: string; method: string }) => `${s.domain}|${s.method}`;
  const registered = new Map(registry.map((r) => [key(r), r]));
  const localByKey = new Map(local.map((s) => [key(s), s]));
  const plan: SourcePlanItem[] = [];
  const align = (side: SourcePlanItem["side"], rows: SourceRow[], wantOf: (row: SourceRow) => SourceRegistryEntry | undefined) => {
    for (const row of [...rows].sort((a, b) => key(a).localeCompare(key(b), "id"))) {
      const want = wantOf(row);
      if (!want) continue;
      const data = changedFields(want, row, ["name", "category"]) as SourceLabel;
      if (!Object.keys(data).length) continue;
      const from = Object.fromEntries(Object.keys(data).map((f) => [f, row[f as keyof SourceLabel]])) as SourceLabel;
      plan.push({ side, id: row.id, version: row.version, domain: row.domain, method: row.method, from, data });
    }
  };
  align("lokal", local, (row) => registered.get(key(row)));
  align("produksi", remote, (row) => registered.get(key(row)) ?? localByKey.get(key(row)));
  return plan;
}

export interface LegacyPlan {
  renames: { id: string; from: string; to: string }[];
  merges: { fromId: string; from: string; intoName: string }[];
  /** Baris produksi tanpa pasangan lokal sama sekali: baris baru dari produksi, disalin ke lokal. */
  newRows: { id: string; name: string }[];
  /** Baris produksi yang cocok dengan beberapa baris lokal sama kuatnya: perlu keputusan orang. */
  ambiguous: { id: string; name: string; candidates: string[] }[];
}

/**
 * Baris produksi yang namanya tidak ada di lokal dicocokkan ke baris lokal lewat tautan yang sama. Kandidat dengan
 * tautan cocok terbanyak dipilih; seri berarti tidak bisa diputuskan.
 */
export function planLegacyNames(source: Row[], targetRows: Row[]): LegacyPlan {
  const sourceNames = new Set(source.map((s) => s.name));
  const targetNames = new Set(targetRows.map((t) => t.name));
  const plan: LegacyPlan = { renames: [], merges: [], newRows: [], ambiguous: [] };
  for (const t of targetRows.filter((r) => !sourceNames.has(r.name))) {
    const scored = source
      .map((s) => ({ s, score: LINK_FIELDS.filter((k) => normLink(t[k]) && normLink(t[k]) === normLink(s[k])).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) {
      plan.newRows.push({ id: t.id, name: t.name });
      continue;
    }
    if (scored[1] && scored[1].score === scored[0].score) {
      plan.ambiguous.push({ id: t.id, name: t.name, candidates: scored.map((x) => x.s.name) });
      continue;
    }
    const to = scored[0].s.name;
    if (targetNames.has(to) || plan.renames.some((r) => r.to === to)) plan.merges.push({ fromId: t.id, from: t.name, intoName: to });
    else plan.renames.push({ id: t.id, from: t.name, to });
  }
  return plan;
}

/** Bacaan berita: belum dibaca 0, gagal dibaca 1, berhasil dibaca (apa pun putusannya) 2. */
export function readingRank(status: NewsReadStatus | string | null | undefined): number {
  if (!status) return 0;
  return status === "tidak_terbaca" ? 1 : 2;
}

type Reading = { readStatus: string | null; readAt: Date | null };
/** Bacaan mana yang dipakai kedua DB: yang berhasil mengalahkan yang gagal, lalu yang lebih baru. */
export function betterReading(a: Reading, b: Reading): "a" | "b" | "sama" {
  const ra = readingRank(a.readStatus);
  const rb = readingRank(b.readStatus);
  if (ra !== rb) return ra > rb ? "a" : "b";
  const ta = a.readAt?.getTime() ?? 0;
  const tb = b.readAt?.getTime() ?? 0;
  return ta === tb ? "sama" : ta > tb ? "a" : "b";
}

type ArticleRef = { canonicalUrl: string | null; contentHash: string | null; normalizedTitle: string; publishedAt: Date | null };
/** Kunci pencocokan artikel lintas DB, dari yang paling kuat. Alamat Google News bisa berbeda untuk berita yang sama. */
export function articleKeys(a: ArticleRef): string[] {
  return [a.canonicalUrl ? `url:${a.canonicalUrl}` : null, a.contentHash ? `hash:${a.contentHash}` : null, `judul:${a.normalizedTitle}|${iso(a.publishedAt)}`].filter(
    (k): k is string => k !== null,
  );
}

type ReviewContent = { text: string; sentiment: string; themes: string[]; archivedAt: Date | null };
/**
 * Isi ulasan yang sama di kedua DB: arsip dari sisi mana pun (kurasi lokal, waktu arsip paling awal), teks utuh bila
 * satu sisi terpotong (sentimen ikut teksnya), tema yang sudah dipilah per outlet, selain itu tema lokal.
 */
export function mergeReview(local: ReviewContent, remote: ReviewContent): ReviewContent {
  const archived = [local.archivedAt, remote.archivedAt].filter((d): d is Date => d instanceof Date).sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
  const textFrom = isTruncatedVersionOf(local.text, remote.text) ? remote : local;
  const tagged = (r: ReviewContent) => r.themes.includes(TAGGED_MARKER);
  const themesFrom = tagged(remote) && !tagged(local) ? remote : local;
  return { text: textFrom.text, sentiment: textFrom.sentiment, themes: themesFrom.themes, archivedAt: archived };
}

/**
 * Identitas tangkapan tarif dan promo tidak memuat nama pesaing: alamat sumbernya sudah menunjuk listing atau
 * postingannya. Dengan begitu tangkapan yang dipindah ke pesaing lain oleh skrip koreksi lokal (mis. tarif entity Resort
 * Prima yang dulu tercatat sebagai Jayakarta) tetap berpasangan dan atribusinya mengikuti lokal, bukan dianggap baru.
 * Nama pesaing hanya dipakai bila alamat sumber kosong. Alamat ikut untuk promo karena satu batch postingan sosmed
 * menyimpan banyak baris "Postingan baru @akun" dengan judul dan waktu tangkap yang sama.
 */
type RateRef = { roomName: string | null; packageName: string | null; checkIn: Date | null; checkOut: Date | null; observedAt: Date; source: string; guests: number; sourceUrl: string | null };
export const rateIdentity = (owner: string, r: RateRef) =>
  [r.sourceUrl ?? `pesaing:${owner}`, r.roomName, r.packageName, iso(r.checkIn), iso(r.checkOut), iso(r.observedAt), r.source, r.guests].join("|");
export const promoIdentity = (owner: string, p: { title: string; capturedAt: Date; sourceUrl: string | null }) => `${p.sourceUrl ?? `pesaing:${owner}`}|${p.title}|${iso(p.capturedAt)}`;

/**
 * Baris promo yang disalin ke DB lain: identitas tangkapan ditambah seluruh isinya (PROMO_FIELDS, daftar yang sama dengan
 * penyamaan pasangan). Daftar kolom yang ditulis satu per satu pernah tertinggal promotionType (sinkron 22 Nov 2026).
 * competitorId adalah id pesaing yang sama di DB tujuan.
 */
export function promoCopyData(p: CompetitorPromotion, competitorId: string): Prisma.CompetitorPromotionCreateManyInput {
  return { ...(pick(p, PROMO_FIELDS) as Omit<Prisma.CompetitorPromotionCreateManyInput, "competitorId" | "title" | "capturedAt">), competitorId, title: p.title, capturedAt: p.capturedAt, createdAt: p.createdAt };
}

export interface IdentityPlan {
  /** [id lokal, id produksi] */
  pairs: [string, string][];
  onlyLocal: string[];
  onlyRemote: string[];
  /** Identitas yang muncul lebih dari sekali di salah satu DB: tidak dipasangkan dan tidak disalin, perlu dibereskan orang. */
  duplicates: string[];
}

/** Memasangkan baris lewat identitas; identitas ganda di salah satu DB dikeluarkan supaya tidak menebak. */
export function pairByIdentity(localRows: { id: string; key: string }[], remoteRows: { id: string; key: string }[]): IdentityPlan {
  const group = (rows: { id: string; key: string }[]) => {
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(r.key, [...(m.get(r.key) ?? []), r.id]);
    return m;
  };
  const l = group(localRows);
  const r = group(remoteRows);
  const duplicates = [...new Set([...l, ...r].filter(([, ids]) => ids.length > 1).map(([k]) => k))].sort();
  const dup = new Set(duplicates);
  const plan: IdentityPlan = { pairs: [], onlyLocal: [], onlyRemote: [], duplicates };
  for (const [k, ids] of l) {
    if (dup.has(k)) continue;
    const other = r.get(k);
    if (other) plan.pairs.push([ids[0], other[0]]);
    else plan.onlyLocal.push(ids[0]);
  }
  for (const [k, ids] of r) if (!dup.has(k) && !l.has(k)) plan.onlyRemote.push(ids[0]);
  return plan;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
/** Baris yang sama di kedua DB: nilai lokal dipakai, kecuali kolom yang kosong di lokal diisi nilai produksi. */
export function localFirst(local: Record<string, unknown>, remote: Record<string, unknown>, fields: readonly string[]) {
  const toRemote: Record<string, unknown> = {};
  const toLocal: Record<string, unknown> = {};
  for (const f of fields) {
    if (sameValue(local[f], remote[f])) continue;
    if (isEmpty(local[f]) && !isEmpty(remote[f])) toLocal[f] = remote[f];
    else toRemote[f] = local[f] ?? null;
  }
  return { toRemote, toLocal };
}

type PairInput = { id: string; competitor: string; source: string; externalId: string; text: string; archivedAt: Date | null };
export interface ReviewPlan {
  /** [id lokal, id produksi] */
  pairs: [string, string][];
  copyFromLocal: string[];
  copyFromRemote: string[];
  /** Tiruan aktif dari teks ulasan yang sudah berpasangan, diarsipkan di sisinya sendiri. */
  archiveInLocal: string[];
  archiveInRemote: string[];
}

/**
 * Pasangan ulasan satu-satu: lewat sumber dan ID ulasan dulu (tanpa nama pesaing, supaya ulasan yang dipindah ke pesaing
 * lain tetap berpasangan; ID yang muncul di dua pesaing dalam satu DB tidak dipakai), lalu lewat teks per pesaing di
 * antara yang belum berpasangan.
 */
export function pairReviews(localRows: PairInput[], remoteRows: PairInput[]): ReviewPlan {
  const idKey = (r: PairInput) => `${r.source}|id:${r.externalId}`;
  const txtKey = (r: PairInput) => `${r.competitor}|${r.source}|txt:${r.text.trim()}`;
  const plan: ReviewPlan = { pairs: [], copyFromLocal: [], copyFromRemote: [], archiveInLocal: [], archiveInRemote: [] };
  const pairedL = new Set<string>();
  const pairedR = new Set<string>();
  const pair = (l: PairInput, r: PairInput) => {
    plan.pairs.push([l.id, r.id]);
    pairedL.add(l.id);
    pairedR.add(r.id);
  };
  const counts = (rows: PairInput[]) => rows.reduce((m, r) => m.set(idKey(r), (m.get(idKey(r)) ?? 0) + 1), new Map<string, number>());
  const localIds = counts(localRows);
  const remoteIds = counts(remoteRows);
  const uniqueId = (r: PairInput) => (localIds.get(idKey(r)) ?? 0) <= 1 && (remoteIds.get(idKey(r)) ?? 0) <= 1;
  const remoteById = new Map(remoteRows.filter(uniqueId).map((r) => [idKey(r), r]));
  for (const l of localRows.filter(uniqueId)) {
    const r = remoteById.get(idKey(l));
    if (r && !pairedR.has(r.id)) pair(l, r);
  }
  const remoteByText = new Map<string, PairInput[]>();
  for (const r of remoteRows.filter((x) => !pairedR.has(x.id))) remoteByText.set(txtKey(r), [...(remoteByText.get(txtKey(r)) ?? []), r]);
  for (const l of localRows.filter((x) => !pairedL.has(x.id))) {
    const r = remoteByText.get(txtKey(l))?.find((x) => !pairedR.has(x.id));
    if (r) pair(l, r);
  }
  const localTexts = new Set(localRows.map(txtKey));
  const remoteTexts = new Set(remoteRows.map(txtKey));
  for (const l of localRows.filter((x) => !pairedL.has(x.id))) {
    if (!remoteTexts.has(txtKey(l))) plan.copyFromLocal.push(l.id);
    else if (!l.archivedAt) plan.archiveInLocal.push(l.id);
  }
  for (const r of remoteRows.filter((x) => !pairedR.has(x.id))) {
    if (!localTexts.has(txtKey(r))) plan.copyFromRemote.push(r.id);
    else if (!r.archivedAt) plan.archiveInRemote.push(r.id);
  }
  return plan;
}

/** Prisma menolak null polos untuk kolom JSON; NULL basis data ditulis lewat Prisma.DbNull. */
const JSON_COLUMNS = new Set(["tags"]);
const dbJson = (data: Record<string, unknown>) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === null && JSON_COLUMNS.has(k) ? Prisma.DbNull : v]));

function localClient(): PrismaClient {
  const env = readFileSync(path.join(process.cwd(), ".env.development.local"), "utf8");
  const url = env.match(/^DATABASE_URL="?([^"\n]+)"?/m)?.[1];
  if (!url) throw new Error("DATABASE_URL tidak ada di .env.development.local");
  const { hostname, port } = new URL(url);
  if (!LOCAL_WORK_DB.hosts.has(hostname) || port !== LOCAL_WORK_DB.port) throw new Error(`sumber harus DB kerja lokal 127.0.0.1:${LOCAL_WORK_DB.port}`);
  return createDatabaseClient({ DATABASE_URL: url });
}

/** Samakan DB tujuan (DATABASE_URL) dengan DB kerja lokal; `apply` false berarti uji kering. */
export async function syncProductionData(apply: boolean): Promise<void> {
  if (getDatabaseTarget() !== "produksi") throw new Error("DATABASE_URL harus DB produksi (jalankan dengan --env-file=.env.local)");
  const local: Side = { label: "lokal", client: localClient() };
  const remote: Side = { label: "produksi", client: createSyncRemoteClient() };
  try {
    await syncSides(local, remote, apply);
  } finally {
    await Promise.all([local.client.$disconnect(), remote.client.$disconnect()]);
  }
}

async function syncSides(local: Side, remote: Side, apply: boolean): Promise<void> {
  console.log(`Lokal <-> produksi. Mode: ${apply ? "TERAPKAN" : "uji kering (tidak menulis)"}.`);
  const occ = async (fn: () => Promise<{ count: number }>, what: string) => {
    if (!apply) return;
    const res = await fn();
    if (res.count !== 1) throw new Error(`konflik versi: ${what} (${res.count} baris cocok); jalankan ulang skrip`);
  };
  const other = (side: Side) => (side === local ? remote : local);

  if (apply) {
    const dir = path.join(process.cwd(), "backups");
    mkdirSync(dir, { recursive: true });
    const snapshot = async (c: PrismaClient) => ({
      competitor: await c.competitor.findMany(),
      competitorFact: await c.competitorFact.findMany(),
      ulasan: await c.competitorReview.findMany({ select: { id: true, archivedAt: true, text: true, sentiment: true, themes: true } }),
      bacaanBerita: await c.marketItem.findMany({ where: { readStatus: { not: null } }, select: { id: true, articleId: true, ...Object.fromEntries(ITEM_FIELDS.map((f) => [f, true])) } }),
      insight: await c.marketInsight.findMany(),
      tujuan: await c.marketingGoal.findMany(),
      sumber: await c.source.findMany({ select: { id: true, name: true, domain: true, method: true, category: true, version: true } }),
    });
    const file = path.join(dir, `sinkron-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ produksi: await snapshot(remote.client), lokal: await snapshot(local.client) }));
    console.log(`Cadangan kedua DB sebelum diubah: ${file}`);
    // Hook pre-push menulis satu cadangan tiap push; yang disimpan hanya BACKUPS_KEPT terbaru.
    for (const old of readdirSync(dir).filter((f) => /^sinkron-\d{4}-.*\.json$/.test(f)).sort().slice(0, -BACKUPS_KEPT)) unlinkSync(path.join(dir, old));
  }

  // 1. Registri: lokal menentukan; baris yang hanya ada di produksi disalin ke lokal.
  const localRows = (await local.client.competitor.findMany({ include: { parent: { select: { name: true } } } })) as unknown as (Row & { parent: { name: string } | null })[];
  let remoteRows = (await remote.client.competitor.findMany({ include: { parent: { select: { name: true } } } })) as unknown as (Row & { parent: { name: string } | null })[];
  const legacy = planLegacyNames(localRows, remoteRows);
  console.log(`\n[Registri] nama lama diganti: ${legacy.renames.length}, digabung: ${legacy.merges.length}, baris baru dari produksi: ${legacy.newRows.length}, tidak terputuskan: ${legacy.ambiguous.length}`);
  for (const r of legacy.renames) console.log(`  ganti nama: "${r.from}" -> "${r.to}"`);
  for (const m of legacy.merges) console.log(`  gabung: "${m.from}" -> "${m.intoName}" (baris lama dihapus setelah anak barisnya dipindah)`);
  for (const n of legacy.newRows) console.log(`  baru dari produksi: "${n.name}"`);
  if (legacy.ambiguous.length) {
    throw new Error(`baris registri produksi cocok dengan beberapa baris lokal: ${legacy.ambiguous.map((u) => `"${u.name}" (${u.candidates.join(" / ")})`).join("; ")}. Putuskan pasangannya dulu.`);
  }
  for (const r of legacy.renames) {
    const row = remoteRows.find((t) => t.id === r.id)!;
    await occ(() => remote.client.competitor.updateMany({ where: { id: r.id, version: row.version as number }, data: { name: r.to, version: { increment: 1 } } }), `ganti nama ${r.from}`);
  }
  for (const m of legacy.merges) {
    const into = remoteRows.find((t) => t.name === m.intoName)!;
    const row = remoteRows.find((t) => t.id === m.fromId)!;
    if (!apply) continue;
    await remote.client.$transaction(async (tx) => {
      await tx.competitorPromotion.updateMany({ where: { competitorId: m.fromId }, data: { competitorId: into.id } });
      await tx.competitorReview.updateMany({ where: { competitorId: m.fromId }, data: { competitorId: into.id } });
      await tx.competitorPriceSnapshot.updateMany({ where: { competitorId: m.fromId }, data: { competitorId: into.id } });
      await tx.competitorFact.updateMany({ where: { competitorId: m.fromId }, data: { competitorId: into.id } });
      await tx.competitor.updateMany({ where: { parentId: m.fromId }, data: { parentId: into.id } });
      const res = await tx.competitor.deleteMany({ where: { id: m.fromId, version: row.version as number } });
      if (res.count !== 1) throw new Error(`konflik versi: gabung ${m.from}; jalankan ulang skrip`);
    }, { timeout: 60_000, maxWait: 15_000 });
  }
  if (apply) remoteRows = (await remote.client.competitor.findMany({ include: { parent: { select: { name: true } } } })) as unknown as typeof remoteRows;
  else {
    for (const r of legacy.renames) remoteRows = remoteRows.map((t) => (t.id === r.id ? { ...t, name: r.to } : t));
    remoteRows = remoteRows.filter((t) => !legacy.merges.some((m) => m.fromId === t.id));
  }

  const remoteByName = new Map(remoteRows.map((t) => [t.name, t]));
  const localByName = new Map(localRows.map((t) => [t.name, t]));
  let created = 0;
  let updated = 0;
  let pulled = 0;
  let ratingsPulled = 0;
  const changedCols = new Map<string, number>();
  for (const s of localRows) {
    const t = remoteByName.get(s.name);
    const fields = registryFieldsToRemote(s, t);
    if (!t) {
      created++;
      if (apply) await remote.client.competitor.create({ data: { ...(pick(s, fields) as Prisma.CompetitorUncheckedCreateInput), name: s.name, outlets: (s.outlets as string[]) ?? [] } });
      continue;
    }
    const diff = changedFields(s, t, fields);
    if (Object.keys(diff).length) {
      updated++;
      for (const f of Object.keys(diff)) changedCols.set(f, (changedCols.get(f) ?? 0) + 1);
      await occ(() => remote.client.competitor.updateMany({ where: { id: t.id, version: t.version as number }, data: { ...(diff as Prisma.CompetitorUpdateManyMutationInput), version: { increment: 1 } } }), `registri ${s.name}`);
    }
    if (ratingNewer(t, s) && !sameValue(t.ratingObservedAt, s.ratingObservedAt)) {
      const ratings = changedFields(t, s, RATING_FIELDS);
      if (Object.keys(ratings).length) {
        ratingsPulled++;
        await occ(() => local.client.competitor.updateMany({ where: { id: s.id, version: s.version as number }, data: { ...(ratings as Prisma.CompetitorUpdateManyMutationInput), version: { increment: 1 } } }), `rating ${s.name}`);
      }
    }
  }
  for (const n of legacy.newRows) {
    const t = remoteRows.find((x) => x.id === n.id);
    if (!t || localByName.has(t.name)) continue;
    pulled++;
    if (apply) await local.client.competitor.create({ data: { ...(pick(t, [...REGISTRY_FIELDS, ...RATING_FIELDS]) as Prisma.CompetitorUncheckedCreateInput), name: t.name, outlets: (t.outlets as string[]) ?? [] } });
  }
  console.log(`[Registri] produksi dibuat: ${created}, diperbarui: ${updated}; kolom: ${[...changedCols].map(([k, n]) => `${k} ${n}`).join(", ") || "-"}; rating produksi yang lebih baru ke lokal: ${ratingsPulled}; baris produksi disalin ke lokal: ${pulled}`);

  // Hotel induk menurut nama, di kedua DB (baris yang baru dibuat ikut).
  const ids = async (side: Side) => {
    const rows = await side.client.competitor.findMany({ select: { id: true, name: true, version: true, parentId: true } });
    return { rows, idOf: new Map(rows.map((r) => [r.name, r.id])), nameOf: new Map(rows.map((r) => [r.id, r.name])) };
  };
  const parentOf = new Map<string, string | null>([...remoteRows.filter((t) => legacy.newRows.some((n) => n.id === t.id)), ...localRows].map((r) => [r.name, r.parent?.name ?? null]));
  let parents = 0;
  for (const side of [remote, local]) {
    const { rows, idOf } = await ids(side);
    for (const r of rows) {
      if (!parentOf.has(r.name)) continue;
      const parentName = parentOf.get(r.name)!;
      const wanted = parentName ? (idOf.get(parentName) ?? null) : null;
      if ((r.parentId ?? null) === wanted) continue;
      parents++;
      await occ(() => side.client.competitor.updateMany({ where: { id: r.id, version: r.version }, data: { parentId: wanted, version: { increment: 1 } } }), `hotel induk ${r.name} (${side.label})`);
    }
  }
  console.log(`[Registri] hotel induk dipasang atau diperbaiki: ${parents}`);

  // Ringkasan memakai updatedAt registri sebagai tanggal baris tempat yang belum punya waktu baca rating, jadi nilainya
  // ikut lokal (dijalankan sesudah rating produksi ditarik, yang ikut mengubah updatedAt lokal).
  {
    const [lr2, rr2] = await Promise.all([
      local.client.competitor.findMany({ select: { name: true, updatedAt: true } }),
      remote.client.competitor.findMany({ select: { id: true, name: true, version: true, updatedAt: true } }),
    ]);
    const localStamp = new Map(lr2.map((r) => [r.name, r.updatedAt]));
    let stamped = 0;
    for (const r of rr2) {
      const want = localStamp.get(r.name);
      if (!want || want.getTime() === r.updatedAt.getTime()) continue;
      stamped++;
      await occ(() => remote.client.competitor.updateMany({ where: { id: r.id, version: r.version }, data: { updatedAt: want, version: { increment: 1 } } }), `waktu ubah ${r.name}`);
    }
    console.log(`[Registri] waktu ubah produksi disamakan dengan lokal: ${stamped}`);
  }

  // Peta nama <-> id per sisi. Uji kering: baris yang akan dibuat diberi id sementara supaya anak barisnya terhitung.
  const maps = new Map<Side, { idOf: Map<string, string>; nameOf: Map<string, string> }>();
  for (const side of [local, remote]) {
    const { idOf, nameOf } = await ids(side);
    maps.set(side, { idOf, nameOf });
  }
  if (!apply) {
    const rm = maps.get(remote)!;
    for (const r of legacy.renames) {
      rm.nameOf.set(r.id, r.to);
      rm.idOf.delete(r.from);
      rm.idOf.set(r.to, r.id);
    }
    for (const m of legacy.merges) {
      rm.nameOf.set(m.fromId, m.intoName);
      rm.idOf.delete(m.from);
    }
    for (const s of localRows) if (!rm.idOf.has(s.name)) rm.idOf.set(s.name, `baru:${s.name}`);
    for (const n of legacy.newRows) if (!maps.get(local)!.idOf.has(n.name)) maps.get(local)!.idOf.set(n.name, `baru:${n.name}`);
  }
  /** id pesaing di sisi `to` untuk id pesaing di sisi `from`. */
  const mapCompetitor = (from: Side, id: string) => maps.get(other(from))!.idOf.get(maps.get(from)!.nameOf.get(id) ?? "") ?? null;
  const nameOf = (side: Side, id: string) => maps.get(side)!.nameOf.get(id) ?? `?${id}`;

  // 2. Fakta situs resmi: lokal menentukan isinya; fakta yang hanya ada di produksi disalin ke lokal.
  {
    const [lf, rf] = await Promise.all([local.client.competitorFact.findMany(), remote.client.competitorFact.findMany()]);
    const key = (side: Side, f: { competitorId: string; section: string; key: string }) => `${nameOf(side, f.competitorId)}|${f.section}|${f.key}`;
    const rBy = new Map(rf.map((f) => [key(remote, f), f]));
    const lKeys = new Set(lf.map((f) => key(local, f)));
    const toRemote: Prisma.CompetitorFactCreateManyInput[] = [];
    let factUpdates = 0;
    for (const f of lf) {
      const competitorId = mapCompetitor(local, f.competitorId);
      if (!competitorId) continue;
      const data = { value: f.value as Prisma.InputJsonValue, sourceUrl: f.sourceUrl, observedAt: f.observedAt, verifiedAt: f.verifiedAt };
      const existing = rBy.get(key(local, f));
      if (!existing) toRemote.push({ competitorId, section: f.section, key: f.key, ...data });
      else if (!sameValue(existing.value, f.value) || existing.sourceUrl !== f.sourceUrl || !sameValue(existing.observedAt, f.observedAt) || !sameValue(existing.verifiedAt, f.verifiedAt)) {
        factUpdates++;
        await occ(() => remote.client.competitorFact.updateMany({ where: { id: existing.id, version: existing.version }, data: { ...data, version: { increment: 1 } } }), `fakta ${f.key}`);
      }
    }
    const toLocal = rf
      .filter((f) => !lKeys.has(key(remote, f)))
      .flatMap((f) => {
        const competitorId = mapCompetitor(remote, f.competitorId);
        return competitorId ? [{ competitorId, section: f.section, key: f.key, value: f.value as Prisma.InputJsonValue, sourceUrl: f.sourceUrl, observedAt: f.observedAt, verifiedAt: f.verifiedAt }] : [];
      });
    if (apply && toRemote.length) await remote.client.competitorFact.createMany({ data: toRemote, skipDuplicates: true });
    if (apply && toLocal.length) await local.client.competitorFact.createMany({ data: toLocal, skipDuplicates: true });
    console.log(`\n[Fakta] ke produksi: ${toRemote.length} baru, ${factUpdates} diperbarui; ke lokal: ${toLocal.length} baru`);
  }

  // 3. Tabel pengamatan sederhana: baris yang hanya ada di satu sisi disalin; untuk yang ada di kedua sisi, yang lebih baru menang.
  async function union<T extends Record<string, unknown> & { id: string; version?: number }>(opts: {
    label: string;
    load: (side: Side) => Promise<T[]>;
    key: (side: Side, row: T) => string | null;
    create: (to: Side, rows: { row: T; from: Side }[]) => Promise<unknown>;
    newer?: { stamp: (row: T) => Date | null; fields: readonly string[]; update: (to: Side, row: T, data: Record<string, unknown>) => Promise<{ count: number }> };
  }) {
    const rows = new Map<Side, T[]>([[local, await opts.load(local)], [remote, await opts.load(remote)]]);
    const byKey = new Map<Side, Map<string, T>>();
    for (const side of [local, remote]) {
      const m = new Map<string, T>();
      for (const r of rows.get(side)!) {
        const k = opts.key(side, r);
        if (k && !m.has(k)) m.set(k, r);
      }
      byKey.set(side, m);
    }
    const report: string[] = [];
    for (const from of [local, remote]) {
      const to = other(from);
      const missing = [...byKey.get(from)!].filter(([k]) => !byKey.get(to)!.has(k)).map(([, row]) => ({ row, from }));
      if (apply && missing.length) await opts.create(to, missing);
      report.push(`ke ${to.label}: ${missing.length} baru`);
    }
    if (opts.newer) {
      let n = 0;
      for (const [k, l] of byKey.get(local)!) {
        const r = byKey.get(remote)!.get(k);
        if (!r) continue;
        const tl = opts.newer.stamp(l)?.getTime() ?? 0;
        const tr = opts.newer.stamp(r)?.getTime() ?? 0;
        if (tl === tr) continue;
        const [win, lose, to] = tl > tr ? [l, r, remote] : [r, l, local];
        const data = changedFields(win, lose, opts.newer.fields);
        if (!Object.keys(data).length) continue;
        n++;
        await occ(() => opts.newer!.update(to, lose, data), `${opts.label} ${k}`);
      }
      report.push(`diperbarui dari bacaan yang lebih baru: ${n}`);
    }
    console.log(`[${opts.label}] ${report.join("; ")}`);
  }

  await union({
    label: "Makro",
    load: (s) => s.client.marketMacroStat.findMany(),
    key: (_s, m) => `${m.key}|${iso(m.period)}`,
    create: (to, rows) => to.client.marketMacroStat.createMany({ data: rows.map(({ row: m }) => ({ key: m.key, period: m.period, value: m.value, unit: m.unit, sourceTitle: m.sourceTitle, sourceUrl: m.sourceUrl, observedAt: m.observedAt })), skipDuplicates: true }),
  });
  await union({
    label: "Koordinat",
    load: (s) => s.client.geoPlace.findMany(),
    key: (_s, p) => p.query,
    create: (to, rows) => to.client.geoPlace.createMany({ data: rows.map(({ row: p }) => ({ query: p.query, name: p.name, lat: p.lat, lng: p.lng, mapsUrl: p.mapsUrl, note: p.note, observedAt: p.observedAt })), skipDuplicates: true }),
  });
  await union({
    label: "Omset",
    load: (s) => s.client.outletMonthlyRevenue.findMany(),
    key: (_s, r) => `${r.outletKey}|${iso(r.month)}`,
    create: (to, rows) => to.client.outletMonthlyRevenue.createMany({ data: rows.map(({ row: r }) => ({ outletKey: r.outletKey, month: r.month, revenue: r.revenue, sourceFile: r.sourceFile, importedAt: r.importedAt })), skipDuplicates: true }),
  });
  await union({
    label: "Snapshot bulanan",
    load: (s) => s.client.outletMonthlySnapshot.findMany(),
    key: (_s, r) => `${r.outletKey}|${iso(r.month)}`,
    create: (to, rows) => to.client.outletMonthlySnapshot.createMany({ data: rows.map(({ row: r }) => ({ outletKey: r.outletKey, month: r.month, googleRating: r.googleRating, pricePositioningIndex: r.pricePositioningIndex, reviewsRecorded: r.reviewsRecorded, capturedAt: r.capturedAt })), skipDuplicates: true }),
    newer: {
      stamp: (r) => r.capturedAt,
      fields: ["googleRating", "pricePositioningIndex", "reviewsRecorded", "capturedAt"],
      update: (to, r, data) => to.client.outletMonthlySnapshot.updateMany({ where: { id: r.id, version: r.version }, data: { ...data, version: { increment: 1 } } }),
    },
  });
  await union({
    label: "Tujuan bulanan",
    load: (s) => s.client.marketingGoal.findMany(),
    key: (_s, r) => `${r.outletKey}|${iso(r.month)}`,
    create: (to, rows) => to.client.marketingGoal.createMany({
      data: rows.map(({ row: r }) => ({ outletKey: r.outletKey, month: r.month, targetRevenueGrowthPct: r.targetRevenueGrowthPct, targetRating: r.targetRating, strategy: r.strategy, decisions: r.decisions, filledBy: r.filledBy, evaluation: r.evaluation, evaluatedAt: r.evaluatedAt })),
      skipDuplicates: true,
    }),
    newer: {
      stamp: (r) => r.updatedAt,
      fields: ["targetRevenueGrowthPct", "targetRating", "strategy", "decisions", "filledBy", "evaluation", "evaluatedAt"],
      update: (to, r, data) => to.client.marketingGoal.updateMany({ where: { id: r.id, version: r.version }, data: { ...data, version: { increment: 1 } } }),
    },
  });

  // 4. Tarif pesaing: dipasangkan lewat identitas tangkapan (rateIdentity); atribusi pesaing pada pasangan mengikuti lokal.
  const rateKey = (r: { roomName: string | null; packageName: string | null; checkIn: Date | null; checkOut: Date | null; observedAt: Date; source: string; guests: number }) =>
    [r.roomName, r.packageName, iso(r.checkIn), iso(r.checkOut), iso(r.observedAt), r.source, r.guests].join("|");
  {
    const load = (s: Side) => s.client.competitorPriceSnapshot.findMany();
    const [lr, rr] = await Promise.all([load(local), load(remote)]);
    const plan = pairByIdentity(
      lr.map((r) => ({ id: r.id, key: rateIdentity(nameOf(local, r.competitorId), r) })),
      rr.map((r) => ({ id: r.id, key: rateIdentity(nameOf(remote, r.competitorId), r) })),
    );
    const byId = new Map<Side, Map<string, (typeof lr)[number]>>([[local, new Map(lr.map((r) => [r.id, r]))], [remote, new Map(rr.map((r) => [r.id, r]))]]);
    const report: string[] = [];
    for (const [from, ids2] of [[local, plan.onlyLocal], [remote, plan.onlyRemote]] as const) {
      const to = other(from);
      const data = ids2.flatMap((id) => {
        const r = byId.get(from)!.get(id)!;
        const competitorId = mapCompetitor(from, r.competitorId);
        return competitorId
          ? [{ competitorId, roomName: r.roomName, packageName: r.packageName, price: r.price, originalPrice: r.originalPrice, discount: r.discount, currency: r.currency, guests: r.guests, checkIn: r.checkIn, checkOut: r.checkOut, source: r.source, sourceUrl: r.sourceUrl, observedAt: r.observedAt, createdAt: r.createdAt }]
          : [];
      });
      if (apply && data.length) await to.client.competitorPriceSnapshot.createMany({ data });
      report.push(`ke ${to.label}: ${data.length} baru`);
    }
    let moved = 0;
    for (const [lid, rid] of plan.pairs) {
      const l = byId.get(local)!.get(lid)!;
      const r = byId.get(remote)!.get(rid)!;
      if (nameOf(local, l.competitorId) === nameOf(remote, r.competitorId)) continue;
      const competitorId = mapCompetitor(local, l.competitorId);
      if (!competitorId) continue;
      moved++;
      await occ(() => remote.client.competitorPriceSnapshot.updateMany({ where: { id: r.id, version: r.version }, data: { competitorId, version: { increment: 1 } } }), `atribusi tarif ${r.id}`);
    }
    if (plan.duplicates.length) console.log(`  PERINGATAN: ${plan.duplicates.length} identitas tarif ganda dalam satu DB tidak disentuh; contoh: ${plan.duplicates[0].slice(0, 140)}`);
    console.log(`[Tarif pesaing] berpasangan: ${plan.pairs.length}; ${report.join("; ")}; atribusi pesaing mengikuti lokal: ${moved}; identitas ganda: ${plan.duplicates.length}`);
  }
  await union({
    label: "Tarif Sanghyang",
    load: (s) => s.client.sanghyangPriceSnapshot.findMany(),
    key: (_s, r) => rateKey(r),
    create: (to, rows) => to.client.sanghyangPriceSnapshot.createMany({
      data: rows.map(({ row: r }) => ({ roomName: r.roomName, packageName: r.packageName, price: r.price, originalPrice: r.originalPrice, discount: r.discount, currency: r.currency, guests: r.guests, checkIn: r.checkIn, checkOut: r.checkOut, source: r.source, sourceUrl: r.sourceUrl, observedAt: r.observedAt })),
    }),
  });

  // 5. Promo dan event: setiap tangkapan ada di kedua DB. Untuk tangkapan yang sama, isi dan atribusi pesaing lokal
  // (tempat skrip koreksi data dijalankan) menang, kecuali kolom yang kosong di lokal diisi dari
  // produksi.
  {
    const load = (s: Side) => s.client.competitorPromotion.findMany({ orderBy: { createdAt: "asc" } });
    const [lp, rp] = await Promise.all([load(local), load(remote)]);
    const plan = pairByIdentity(
      lp.map((p) => ({ id: p.id, key: promoIdentity(nameOf(local, p.competitorId), p) })),
      rp.map((p) => ({ id: p.id, key: promoIdentity(nameOf(remote, p.competitorId), p) })),
    );
    const byId = new Map<Side, Map<string, (typeof lp)[number]>>([[local, new Map(lp.map((p) => [p.id, p]))], [remote, new Map(rp.map((p) => [p.id, p]))]]);
    const report: string[] = [];
    for (const [from, ids2] of [[local, plan.onlyLocal], [remote, plan.onlyRemote]] as const) {
      const to = other(from);
      const data = ids2.flatMap((id) => {
        const p = byId.get(from)!.get(id)!;
        const competitorId = mapCompetitor(from, p.competitorId);
        return competitorId ? [promoCopyData(p, competitorId)] : [];
      });
      if (apply && data.length) await to.client.competitorPromotion.createMany({ data });
      report.push(`ke ${to.label}: ${data.length} baru`);
    }
    const updated2 = { produksi: 0, lokal: 0 };
    for (const [lid, rid] of plan.pairs) {
      const l = byId.get(local)!.get(lid)!;
      const r = byId.get(remote)!.get(rid)!;
      const { toRemote, toLocal } = localFirst(l, r, PROMO_FIELDS);
      if (nameOf(local, l.competitorId) !== nameOf(remote, r.competitorId)) {
        const competitorId = mapCompetitor(local, l.competitorId);
        if (competitorId) toRemote.competitorId = competitorId;
      }
      for (const [to, row, data] of [[remote, r, toRemote], [local, l, toLocal]] as const) {
        if (!Object.keys(data).length) continue;
        updated2[to.label]++;
        await occ(() => to.client.competitorPromotion.updateMany({ where: { id: row.id, version: row.version }, data: { ...(data as Prisma.CompetitorPromotionUncheckedUpdateManyInput), version: { increment: 1 } } }), `promo ${l.title} (${to.label})`);
      }
    }
    if (plan.duplicates.length) console.log(`  PERINGATAN: ${plan.duplicates.length} identitas promo ganda dalam satu DB tidak disentuh; contoh: ${plan.duplicates[0].slice(0, 140)}`);
    console.log(`[Promo] berpasangan: ${plan.pairs.length}; ${report.join("; ")}; isi atau atribusi disamakan: produksi ${updated2.produksi}, lokal ${updated2.lokal}; identitas ganda: ${plan.duplicates.length}`);
  }

  // 6. Ulasan: dipasangkan satu-satu lewat kunci ulasan, lalu lewat teks. Pasangan disatukan isinya (arsip, teks utuh,
  // tema per outlet). Baris tanpa pasangan disalin ke sisi lain, kecuali tiruan teks ulasan yang sudah berpasangan:
  // tiruan itu diarsipkan di sisinya sendiri, seperti scripts/ops/archive-duplicate-reviews.ts di lokal.
  {
    const load = (s: Side) => s.client.competitorReview.findMany({ orderBy: { capturedAt: "asc" } });
    const [lr, rr] = await Promise.all([load(local), load(remote)]);
    const plan = pairReviews(
      lr.map((r) => ({ ...r, competitor: nameOf(local, r.competitorId) })),
      rr.map((r) => ({ ...r, competitor: nameOf(remote, r.competitorId) })),
    );
    const byId = new Map<Side, Map<string, (typeof lr)[number]>>([[local, new Map(lr.map((r) => [r.id, r]))], [remote, new Map(rr.map((r) => [r.id, r]))]]);
    const report: string[] = [];
    for (const [from, ids2] of [[local, plan.copyFromLocal], [remote, plan.copyFromRemote]] as const) {
      const to = other(from);
      const data = ids2.flatMap((id) => {
        const r = byId.get(from)!.get(id)!;
        const competitorId = mapCompetitor(from, r.competitorId);
        return competitorId
          ? [{ competitorId, externalId: r.externalId, source: r.source, sourceUrl: r.sourceUrl, rating: r.rating, reviewDate: r.reviewDate, title: r.title, text: r.text, sentiment: r.sentiment, themes: r.themes, capturedAt: r.capturedAt, archivedAt: r.archivedAt }]
          : [];
      });
      if (apply && data.length) await to.client.competitorReview.createMany({ data, skipDuplicates: true });
      report.push(`ke ${to.label}: ${data.length} baru`);
    }
    let merged = 0;
    let archived = 0;
    const write = async (side: Side, row: (typeof lr)[number], diff: Record<string, unknown>) =>
      occ(() => side.client.competitorReview.updateMany({ where: { id: row.id, version: row.version }, data: { ...(diff as Prisma.CompetitorReviewUncheckedUpdateManyInput), version: { increment: 1 } } }), `ulasan ${row.id} (${side.label})`);
    for (const [lid, rid] of plan.pairs) {
      const l = byId.get(local)!.get(lid)!;
      const r = byId.get(remote)!.get(rid)!;
      const want = mergeReview(l, r);
      const { toRemote, toLocal } = localFirst(l, r, REVIEW_FIELDS);
      // Ulasan yang dipindah ke pesaing lain oleh skrip koreksi lokal: atribusinya mengikuti lokal.
      if (nameOf(local, l.competitorId) !== nameOf(remote, r.competitorId)) {
        const competitorId = mapCompetitor(local, l.competitorId);
        if (competitorId) toRemote.competitorId = competitorId;
      }
      for (const [side, row, extra] of [[local, l, toLocal], [remote, r, toRemote]] as const) {
        const diff = { ...changedFields(want, row, ["text", "sentiment", "themes", "archivedAt"]), ...extra };
        if (!Object.keys(diff).length) continue;
        merged++;
        if ("archivedAt" in diff) archived++;
        await write(side, row, diff);
      }
    }
    let duplicates = 0;
    for (const [side, ids2] of [[local, plan.archiveInLocal], [remote, plan.archiveInRemote]] as const) {
      for (const id of ids2) {
        duplicates++;
        await write(side, byId.get(side)!.get(id)!, { archivedAt: new Date() });
      }
    }
    console.log(`\n[Ulasan] berpasangan: ${plan.pairs.length}; ${report.join("; ")}; isi disatukan: ${merged} baris (arsip ${archived}); tiruan teks diarsipkan: ${duplicates}`);
  }

  // 7. Berita: artikel yang hanya ada di satu sisi disalin beserta hasil bacaannya; bacaan artikel yang sama disatukan.
  // Setiap kueri ke produksi di tahap ini berbatas: artikel per halaman, salinan per 200, butir pasar per 1.000 artikel.
  {
    const [la, ra] = await Promise.all([loadArticleRefs(local.client), loadArticleRefs(remote.client)]);
    type Art = (typeof la)[number];
    // Kunci judul hanya dipakai bila unik di kedua sisi; berita bersalinan dengan judul sama tidak ditebak pasangannya.
    const index = (rows: Art[]) => {
      const m = new Map<string, Art | null>();
      for (const a of rows) for (const k of articleKeys(a)) m.set(k, m.has(k) && m.get(k)?.id !== a.id ? null : a);
      return m;
    };
    const li = index(la);
    const ri = index(ra);
    const pairs = new Map<string, Art>();
    const pairedRemote = new Set<string>();
    for (const a of la) {
      for (const k of articleKeys(a)) {
        const b = ri.get(k);
        const back = li.get(k);
        if (!b || !back || back.id !== a.id || pairedRemote.has(b.id)) continue;
        pairs.set(a.id, b);
        pairedRemote.add(b.id);
        break;
      }
    }
    const sourceIds = new Map<Side, Map<string, string>>();
    for (const side of [local, remote]) {
      sourceIds.set(side, new Map((await side.client.source.findMany({ select: { id: true, domain: true, method: true } })).map((s) => [`${s.domain}|${s.method}`, s.id])));
    }
    let copied = 0;
    let itemsCopied = 0;
    const report: string[] = [];
    for (const [from, rows] of [[local, la.filter((a) => !pairs.has(a.id))], [remote, ra.filter((a) => !pairedRemote.has(a.id))]] as const) {
      const to = other(from);
      const missingSource = rows.filter((a) => !sourceIds.get(to)!.has(`${a.source.domain}|${a.source.method}`));
      if (missingSource.length) throw new Error(`sumber berita ${[...new Set(missingSource.map((a) => a.source.domain))].join(", ")} belum ada di ${to.label}`);
      report.push(`ke ${to.label}: ${rows.length} artikel`);
      if (!apply || !rows.length) continue;
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const full = await from.client.article.findMany({ where: { id: { in: chunk.map((a) => a.id) } }, include: { marketItem: true, source: { select: { domain: true, method: true } } } });
        await to.client.article.createMany({
          data: full.map((a) => ({
            sourceId: sourceIds.get(to)!.get(`${a.source.domain}|${a.source.method}`)!, title: a.title, canonicalUrl: a.canonicalUrl, normalizedTitle: a.normalizedTitle, publishedAt: a.publishedAt,
            description: a.description, content: a.content, imageUrl: a.imageUrl, publisherUrl: a.publisherUrl, contentHash: a.contentHash, status: a.status, createdAt: a.createdAt,
          })),
          skipDuplicates: true,
        });
        copied += full.length;
        const withItem = full.filter((a) => a.marketItem);
        if (!withItem.length) continue;
        const newIds = new Map(
          (await to.client.article.findMany({ where: { canonicalUrl: { in: withItem.map((a) => a.canonicalUrl).filter((u): u is string => Boolean(u)) } }, select: { id: true, canonicalUrl: true } })).map((a) => [a.canonicalUrl, a.id]),
        );
        const items = withItem.flatMap((a) => {
          const articleId = newIds.get(a.canonicalUrl);
          return articleId ? [{ articleId, createdAt: a.marketItem!.createdAt, ...(pick(a.marketItem as unknown as Record<string, unknown>, ITEM_FIELDS) as Omit<Prisma.MarketItemCreateManyInput, "articleId">) }] : [];
        });
        if (items.length) await to.client.marketItem.createMany({ data: items.map((x) => ({ ...x, tags: x.tags ?? undefined })), skipDuplicates: true });
        itemsCopied += items.length;
      }
    }
    // Artikel berpasangan: origin penerbit dan bacaan pemenang dipakai di kedua sisi.
    const itemsOf = async (side: Side, articleIds: string[]) => {
      const m = new Map<string, Record<string, unknown> & { id: string; version: number; articleId: string; readStatus: string | null; readAt: Date | null }>();
      for (let i = 0; i < articleIds.length; i += 1000) {
        for (const it of await side.client.marketItem.findMany({ where: { articleId: { in: articleIds.slice(i, i + 1000) } } })) m.set(it.articleId, it as never);
      }
      return m;
    };
    const lItems = await itemsOf(local, [...pairs.keys()]);
    const rItems = await itemsOf(remote, [...pairs.values()].map((b) => b.id));
    const laById = new Map(la.map((a) => [a.id, a]));
    let publishers = 0;
    let readings = 0;
    let itemStamps = 0;
    let itemsCreated = 0;
    for (const [lid, b] of pairs) {
      const a = laById.get(lid)!;
      for (const [to, mine, theirs] of [[remote, b, a], [local, a, b]] as const) {
        if (mine.publisherUrl || !theirs.publisherUrl) continue;
        publishers++;
        await occ(() => to.client.article.updateMany({ where: { id: mine.id, version: mine.version }, data: { publisherUrl: theirs.publisherUrl, version: { increment: 1 } } }), `origin penerbit (${to.label})`);
      }
      const li2 = lItems.get(a.id);
      const ri2 = rItems.get(b.id);
      if (!li2 && !ri2) continue;
      if (!li2 || !ri2) {
        const [to, item, articleId] = li2 ? [remote, li2, b.id] : [local, ri2!, a.id];
        itemsCreated++;
        if (apply) {
          const data = pick(item, ITEM_FIELDS) as Omit<Prisma.MarketItemCreateManyInput, "articleId">;
          await to.client.marketItem.createMany({ data: [{ ...data, articleId, createdAt: item.createdAt as Date, tags: data.tags ?? undefined }], skipDuplicates: true });
        }
        continue;
      }
      // Bacaan pemenang dipakai kedua sisi; bila waktunya sama tetapi isinya beda, lokal yang dipakai. createdAt menjadi
      // tanggal cadangan berita tanpa tanggal terbit, jadi ikut lokal.
      const verdict = betterReading(li2, ri2);
      const toRemote: Record<string, unknown> = verdict === "b" ? {} : changedFields(li2, ri2, ITEM_FIELDS);
      const toLocal: Record<string, unknown> = verdict === "b" ? changedFields(ri2, li2, ITEM_FIELDS) : {};
      if (Object.keys(toRemote).length || Object.keys(toLocal).length) readings++;
      if (!sameValue(li2.createdAt, ri2.createdAt)) {
        if (!Object.keys(toRemote).length) itemStamps++;
        toRemote.createdAt = li2.createdAt;
      }
      for (const [to, row, data] of [[remote, ri2, toRemote], [local, li2, toLocal]] as const) {
        if (!Object.keys(data).length) continue;
        await occ(() => to.client.marketItem.updateMany({ where: { id: row.id, version: row.version }, data: { ...(dbJson(data) as Prisma.MarketItemUpdateManyMutationInput), version: { increment: 1 } } }), `bacaan berita (${to.label})`);
      }
    }
    console.log(`\n[Berita] berpasangan: ${pairs.size}; disalin: ${report.join(", ")} (${copied} artikel, ${itemsCopied} butir pasar); butir pasar dibuat untuk pasangan: ${itemsCreated}; bacaan disatukan: ${readings}; waktu dibuat disamakan: ${itemStamps}; origin penerbit diisi: ${publishers}`);
  }

  // 8. Insight aktif (selain heartbeat malam yang milik tiap lingkungan): baris terbaru per sidik jari dipakai kedua DB.
  {
    const load = async (s: Side) => {
      const rows = await s.client.marketInsight.findMany({ where: { fingerprint: { not: HEARTBEAT_FINGERPRINT } }, orderBy: { generatedAt: "desc" } });
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (!latest.has(r.fingerprint)) latest.set(r.fingerprint, r);
      return latest;
    };
    const [li, ri] = await Promise.all([load(local), load(remote)]);
    let created2 = 0;
    let updated2 = 0;
    for (const [from, mine] of [[local, li], [remote, ri]] as const) {
      const to = other(from);
      const theirs = from === local ? ri : li;
      for (const [fp, row] of mine) {
        const t = theirs.get(fp);
        if (!t) {
          created2++;
          if (apply) {
            await to.client.marketInsight.create({
              data: { ...(pick(row, INSIGHT_FIELDS) as Prisma.MarketInsightCreateInput), fingerprint: fp, activeFingerprint: row.status === "active" ? fp : null, createdAt: row.createdAt },
            });
          }
          continue;
        }
        if (row.generatedAt <= t.generatedAt) continue;
        const diff = changedFields(row, t, INSIGHT_FIELDS);
        if (!Object.keys(diff).length) continue;
        updated2++;
        await occ(
          () => to.client.marketInsight.updateMany({ where: { id: t.id, version: t.version }, data: { ...(diff as Prisma.MarketInsightUpdateManyMutationInput), activeFingerprint: row.status === "active" ? fp : null, version: { increment: 1 } } }),
          `insight ${row.title} (${to.label})`,
        );
      }
    }
    console.log(`[Insight] dibuat: ${created2}, diperbarui dari yang lebih baru: ${updated2}`);
  }

  // 9. Sumber data: nama dan kategori sumber job terdaftar mengikuti registri tugas di kedua DB; sumber lain yang ada di
  // kedua DB mengikuti lokal (label penerbit berita dan sumber graf).
  {
    const select = { id: true, name: true, domain: true, method: true, category: true, enabled: true, version: true } as const;
    const [ls, rs] = await Promise.all([local.client.source.findMany({ select }), remote.client.source.findMany({ select })]);
    const plan = planSourceNames(ls, rs, Object.values(DEFAULT_JOB_SOURCES));
    for (const p of plan) {
      const side = p.side === local.label ? local : remote;
      await occ(
        () => side.client.source.updateMany({ where: { id: p.id, version: p.version }, data: { ...(p.data as Prisma.SourceUpdateManyMutationInput), version: { increment: 1 } } }),
        `sumber ${p.domain}|${p.method} (${p.side})`,
      );
    }
    console.log(`\n[Sumber] disamakan: ${plan.length}`);
    for (const p of plan) console.log(`  ${p.side} ${p.domain}|${p.method}: ${JSON.stringify(p.from)} -> ${JSON.stringify(p.data)}`);
  }
}

if (process.argv[1]?.endsWith("sync-production-data.ts")) {
  syncProductionData(process.argv.includes("--apply")).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
