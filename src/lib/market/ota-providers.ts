/**
 * Direktori OTA dinamis: diturunkan sepenuhnya dari hasil pengamatan Google Travel
 * (`lib/market/resort-room-rates.data.json`) serta data runtime basis data (tanpa daftar OTA statis).
 * Situs resmi hotel dipisahkan otomatis (termasuk subdomainnya) agar tetap diklasifikasikan sebagai
 * kanal situs resmi (`website`). Penyedia harga dan sumber ulasan juga dipisahkan.
 */
import rateData from "./resort-room-rates.data.json";

export interface DiscoveredOtaProvider {
  provider: string;
  hosts: string[];
  hotelIds: string[];
  channels: ("prices" | "reviews")[];
}

export interface DynamicOtaDirectory {
  providers: string[];
  reviewProviders: string[];
  hosts: string[];
  reviewHosts: string[];
  byHotel: Record<string, string[]>;
  reviewSourcesByHotel: Record<string, string[]>;
  records: DiscoveredOtaProvider[];
}

interface RateDataShape {
  otaProviders?: DiscoveredOtaProvider[];
  reviewSourcesByHotel?: Record<string, string[]>;
  lowestByHotel?: Array<{
    hotelId?: string;
    weekday?: { source?: string | null };
    weekend?: { source?: string | null };
    range?: {
      weekday?: { min?: { source?: string | null }; max?: { source?: string | null } };
      weekend?: { min?: { source?: string | null }; max?: { source?: string | null } };
    };
  }>;
  evidence?: Array<{ hotelId?: string; provider?: string | null }>;
  rates?: Array<{ hotelId?: string; sanghyangRoom?: string; competitorRoom?: string }>;
}

const NON_OTA_SOURCE_PATTERN =
  /^(google(\s+maps|\s+travel|\s+hotels)?|maps|instagram|tiktok|facebook|youtube|semua(\s+ulasan)?|all\s+reviews|tinjau\s+opsi\s+sumber|review\s+source\s+options|situs\s+resmi|official(\s+site)?|website|tim\s+marketing.*)$/i;

const MULTI_PART_SUFFIX = /\.(co\.id|co\.uk|com\.sg|com\.au|com\.my|web\.id|or\.id|ac\.id)$/i;
const SINGLE_TLD_SUFFIX = /\.(com|net|org|id|sg|my|au|travel|io|co|biz|info)$/i;
const HOST_LOOKALIKE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function stripDomainSuffix(value: string): string {
  const lower = normalizeHost(value);
  if (MULTI_PART_SUFFIX.test(lower)) return lower.replace(MULTI_PART_SUFFIX, "");
  if (SINGLE_TLD_SUFFIX.test(lower)) return lower.replace(SINGLE_TLD_SUFFIX, "");
  return lower;
}

function isHostExcluded(host: string, excludedHosts: Set<string>): boolean {
  const target = normalizeHost(host);
  if (!target) return true;
  for (const ex of excludedHosts) {
    if (target === ex || target.endsWith(`.${ex}`)) return true;
  }
  return false;
}

function isNonOtaSourceLabel(label: string): boolean {
  const clean = label.trim();
  if (!clean) return true;
  if (NON_OTA_SOURCE_PATTERN.test(clean)) return true;
  if (/^google hotels lowest/i.test(clean)) return true;
  if (/^situs resmi/i.test(clean) || /^instagram\b/i.test(clean) || /^tiktok\b/i.test(clean) || /^facebook\b/i.test(clean)) {
    return true;
  }
  return false;
}

function extractParenthesizedProviders(roomLabel: string | undefined): string[] {
  if (!roomLabel) return [];
  const found: string[] = [];
  const matches = roomLabel.matchAll(/\(([^()]+)\)/g);
  for (const m of matches) {
    const raw = m[1].trim();
    const cleaned = raw.replace(/^termurah\s+via\s+/i, "").trim();
    if (cleaned && !isNonOtaSourceLabel(cleaned) && !/^per\s+/i.test(cleaned)) {
      found.push(cleaned);
    }
  }
  return found;
}

export function extractHostnameFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !URL.canParse(rawUrl)) return null;
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // Tautan klik Google Travel menyimpan domain tujuan asli di parameter `pcurl`.
  if (parsed.pathname === "/travel/lodging/clk") {
    const pcurl = parsed.searchParams.get("pcurl");
    if (pcurl && URL.canParse(pcurl)) return normalizeHost(new URL(pcurl).hostname);
  }
  return normalizeHost(parsed.hostname);
}

/** Menggabungkan hasil pengamatan OTA Google Travel dan opsional sumber tambahan dari runtime DB. */
export function buildDynamicOtaDirectory(extra?: {
  records?: DiscoveredOtaProvider[];
  providers?: Iterable<string>;
  reviewProviders?: Iterable<string>;
  hosts?: Iterable<string>;
  reviewHosts?: Iterable<string>;
  excludeHosts?: Iterable<string>;
}): DynamicOtaDirectory {
  const excludedHosts = new Set<string>();
  for (const h of extra?.excludeHosts ?? []) {
    const norm = normalizeHost(h);
    if (norm) excludedHosts.add(norm);
  }

  const byKey = new Map<string, DiscoveredOtaProvider>();
  const standaloneHosts = new Set<string>();
  const standaloneReviewHosts = new Set<string>();

  const upsert = (
    providerRaw: string | null | undefined,
    hosts: string[],
    hotelId: string | undefined,
    channel?: "prices" | "reviews",
  ) => {
    const provider = providerRaw?.trim() ?? "";
    if (!provider || isNonOtaSourceLabel(provider)) return;
    if (HOST_LOOKALIKE.test(provider) && isHostExcluded(provider, excludedHosts)) return;

    const cleanHosts = hosts
      .map(normalizeHost)
      .filter((h) => h && HOST_LOOKALIKE.test(h) && !isHostExcluded(h, excludedHosts));
    if (cleanHosts.length === 0 && HOST_LOOKALIKE.test(provider) && !isHostExcluded(provider, excludedHosts)) {
      cleanHosts.push(normalizeHost(provider));
    }

    const key = provider.toLowerCase();
    const existing = byKey.get(key) ?? { provider, hosts: [], hotelIds: [], channels: [] };
    for (const h of cleanHosts) {
      if (!existing.hosts.includes(h)) existing.hosts.push(h);
    }
    if (hotelId && !existing.hotelIds.includes(hotelId)) existing.hotelIds.push(hotelId);
    if (channel && !existing.channels.includes(channel)) existing.channels.push(channel);
    byKey.set(key, existing);
  };

  const data = rateData as RateDataShape;

  for (const rec of data.otaProviders ?? []) {
    for (const hid of rec.hotelIds.length ? rec.hotelIds : [undefined]) {
      for (const ch of rec.channels.length ? rec.channels : [undefined]) {
        upsert(rec.provider, rec.hosts ?? [], hid, ch);
      }
    }
  }

  for (const [hotelId, sources] of Object.entries(data.reviewSourcesByHotel ?? {})) {
    for (const src of sources) upsert(src, [], hotelId, "reviews");
  }

  for (const row of data.lowestByHotel ?? []) {
    const hid = row.hotelId;
    const candidates = [
      row.weekday?.source,
      row.weekend?.source,
      row.range?.weekday?.min?.source,
      row.range?.weekday?.max?.source,
      row.range?.weekend?.min?.source,
      row.range?.weekend?.max?.source,
    ];
    for (const src of candidates) upsert(src, [], hid, "prices");
  }

  for (const ev of data.evidence ?? []) {
    upsert(ev.provider, [], ev.hotelId, "prices");
  }

  for (const r of data.rates ?? []) {
    for (const p of extractParenthesizedProviders(r.sanghyangRoom)) upsert(p, [], "sanghyang", "prices");
    for (const p of extractParenthesizedProviders(r.competitorRoom)) upsert(p, [], r.hotelId, "prices");
  }

  for (const rec of extra?.records ?? []) {
    for (const hid of rec.hotelIds.length ? rec.hotelIds : [undefined]) {
      for (const ch of rec.channels.length ? rec.channels : [undefined]) {
        upsert(rec.provider, rec.hosts ?? [], hid, ch);
      }
    }
  }

  for (const p of extra?.providers ?? []) {
    upsert(p, [], undefined, undefined);
  }

  for (const p of extra?.reviewProviders ?? []) {
    upsert(p, [], undefined, "reviews");
  }

  for (const h of extra?.hosts ?? []) {
    const norm = normalizeHost(h);
    if (norm && HOST_LOOKALIKE.test(norm) && !isHostExcluded(norm, excludedHosts)) standaloneHosts.add(norm);
  }

  for (const h of extra?.reviewHosts ?? []) {
    const norm = normalizeHost(h);
    if (norm && HOST_LOOKALIKE.test(norm) && !isHostExcluded(norm, excludedHosts)) {
      standaloneHosts.add(norm);
      standaloneReviewHosts.add(norm);
    }
  }

  const records = [...byKey.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  const providers = records.map((r) => r.provider);
  const reviewProviders = records.filter((r) => r.channels.includes("reviews")).map((r) => r.provider);

  const hostsSet = new Set<string>(standaloneHosts);
  const reviewHostsSet = new Set<string>(standaloneReviewHosts);
  const byHotel: Record<string, string[]> = {};
  const reviewSourcesByHotel: Record<string, string[]> = {};

  for (const r of records) {
    const hasReviewChannel = r.channels.includes("reviews");
    for (const h of r.hosts) {
      hostsSet.add(h);
      if (hasReviewChannel) reviewHostsSet.add(h);
    }
    for (const hid of r.hotelIds) {
      if (!byHotel[hid]) byHotel[hid] = [];
      if (!byHotel[hid].includes(r.provider)) byHotel[hid].push(r.provider);
      if (hasReviewChannel) {
        if (!reviewSourcesByHotel[hid]) reviewSourcesByHotel[hid] = [];
        if (!reviewSourcesByHotel[hid].includes(r.provider)) reviewSourcesByHotel[hid].push(r.provider);
      }
    }
  }

  return {
    providers,
    reviewProviders,
    hosts: [...hostsSet].sort(),
    reviewHosts: [...reviewHostsSet].sort(),
    byHotel,
    reviewSourcesByHotel,
    records,
  };
}

const STATIC_DIRECTORY = buildDynamicOtaDirectory();

export function getStaticOtaDirectory(): DynamicOtaDirectory {
  return STATIC_DIRECTORY;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Menentukan apakah label `source` cocok dengan penyedia OTA hasil temuan dinamis. */
export function isKnownOtaProvider(source: string, dynamicProviders?: Iterable<string>): boolean {
  const clean = source.trim().toLowerCase();
  if (!clean || isNonOtaSourceLabel(clean)) return false;

  const catalog = new Set<string>();
  const sourceList = dynamicProviders !== undefined ? dynamicProviders : STATIC_DIRECTORY.providers;
  for (const p of sourceList) {
    if (p && !isNonOtaSourceLabel(p)) catalog.add(p.trim().toLowerCase());
  }

  for (const cand of catalog) {
    if (clean === cand) return true;
    // Cocokkan nama domain penuh atau nama multi-kata penuh tanpa memangkas menjadi kata umum ("hotels", "booking", "tiket").
    const fullBoundary = new RegExp(`(?:^|[\\s(/@,-])${escapeRegExp(cand)}(?:$|[\\s).,/-])`, "i");
    if (fullBoundary.test(clean)) return true;

    // Untuk label berbentuk domain (mis. Traveloka.com), hanya izinkan bentuk merek tunggal panjang >= 8 huruf (tanpa spasi).
    if (HOST_LOOKALIKE.test(cand) && !/\s/.test(clean)) {
      const stem = stripDomainSuffix(cand);
      if (stem.length >= 8 && clean === stem) return true;
    }
  }
  return false;
}

/**
 * Menentukan apakah hostname URL cocok dengan domain OTA hasil temuan dinamis.
 * Hanya menerima kecocokan tepat atau subdomain langsung dari host terdaftar (bukan tebakan TLD lintas domain).
 */
export function isKnownOtaHost(hostname: string, dynamicHosts?: Iterable<string>): boolean {
  const target = normalizeHost(hostname);
  if (!target || !HOST_LOOKALIKE.test(target)) return false;

  const sourceList = dynamicHosts !== undefined ? dynamicHosts : STATIC_DIRECTORY.hosts;
  for (const h of sourceList) {
    const knownHost = normalizeHost(h);
    if (!knownHost) continue;
    if (target === knownHost || target.endsWith(`.${knownHost}`)) return true;
  }
  return false;
}
