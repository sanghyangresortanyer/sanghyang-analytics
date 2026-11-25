/**
 * Penyaring radar promo kompetitor yang dipakai summary API, halaman Strategy, dan laporan PDF.
 *
 * Tabel CompetitorPromotion menyimpan setiap tangkapan sebagai baris baru (riwayat), jadi promo yang sama bisa muncul
 * berkali-kali. Radar hanya menampilkan tangkapan terbaru per kompetitor dan judul, dari kompetitor yang masih aktif di
 * daftar pembanding, dan tidak menampilkan postingan yang bukan promo/event atau baris yang sudah diarsipkan.
 */
import { isOutletKey } from "./outlet-filters";
import { byText, newestFirst } from "./stable-order";

export const NOT_PROMO_CATEGORY = "Postingan Sosmed (bukan promo)";
export const OWN_SOCIAL_POST_CATEGORY = "Postingan Sosmed Tayang";
export const RAW_COMPETITOR_SOCIAL_CATEGORY = "Postingan Sosmed Baru";
const INTERNAL_PROGRAM_CATEGORY = "Program pemasaran";

export type ClassifiedPromoKind = "promo" | "event";

export interface PromoOrEventInput {
  title?: string | null;
  category?: string | null;
  description?: string | null;
  kind?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  price?: unknown;
  discount?: unknown;
  details?: string[] | null;
  terms?: string[] | null;
}

const RAW_POST_TITLE_PREFIX = /^\[(REELS|FEED|CAROUSEL|TIKTOK_VIDEO|STORY)\]\s*/i;
const OUR_VERSION_SPLIT = "\nVersi kita: ";
const OWN_OFFICIAL_SITE_SOURCE = "Situs resmi Sanghyang (penawaran)";

const APP_OR_TECH_ANNOUNCEMENT =
  /\b(chatgpt|openai|no\s+sliders|no\s+dropdowns|install\s+and\s+try|download\s+(?:the|our)\s+app|integrasi\s+(?:ai|chatgpt|openai)|booking\s+kamar\s+otomatis)\b/i;
const HOME_RECIPE_POST =
  /\b(buat\s+sendiri\s+di\s+rumah|resep\s+(?:berikut|masakan)|#resepmasakan|bahan-bahan\s*:)/i;
const JOB_OR_GREETING_POST =
  /\b(dibutuhkan\s+segera|lowongan\s+kerja|selamat\s+(?:hari|tahun\s+baru|datang,\s*tahun\s+baru|menunaikan|idul)|hari\s+kelahiran\s+pancasila)\b/i;
const VIRAL_OR_AMBIANCE_ONLY =
  /\b(video\s+grounding|review\s+viral|menyorot\s+keunikan|sensasi\s+menginap)\b/i;

const COMMERCIAL_PACKAGE_TITLE =
  /\b(meeting\s*&\s*outing\s*package|new\s*year\s*package|christmas\s*package|year[\s-]*end\s*(?:special|staycation)|early\s*bird|flash\s*sale|late\s*night\s*sale|day\s*use|stay\s*more|book\s*early|buy\s+\d+\s+get\s+\d+|bundling\s+promo|special\s+promo|promo\s+diskon)\b/i;

const EVENT_STRONG_SIGNAL =
  /\b(live\s*music|guest\s*dj|special\s*guest\s*dj|\bf?dj\s+[a-z0-9_]+|event\s*dj|night\s*party|friday\s*night|saturday\s*night|halloween|viva\s*la\s*fiesta|new\s*year[’']?s\s*eve|feast\s*&\s*folly|mermaid|fire\s*dance|tari\s*api|yoga|fun\s*games|cooking\s*class|marshmallow\s*time|gala\s*dinner|pesta\s*kembang\s*api|festival|konser|pertunjukan|meet\s*(?:&|and)\s*greet)\b/i;

const EVENT_GATHERING_SIGNAL =
  /\b(family\s*gathering|corporate\s*outing|team\s*building|building\s*stronger\s*teams|lunch\s*group|welcome\s+(?:pt|cv|tim|rombongan|keluarga)\b|telah\s+mempercayakan\s+momen\s+kebersamaan|keseruan\s+hari\s+ini\s+bersama\s+keluarga|#gathering\w*|#familygathering\w*|#nightparty\b|#fridayparty\b|#djperfome\b)\b/i;

/**
 * Dokumentasi makan bersama rombongan di unggahan Sanghyang ("Eat together, laugh together, make memories together!"),
 * yang menurut pemakai (20 Nov 2026) adalah event. Hanya dipakai bila teks tidak memuat harga atau kata penawaran,
 * supaya paket makan bersama yang berharga tetap promo.
 */
const OWN_GROUP_MEAL_SIGNAL = /\b(?:eat|dine)\s+together\b|\bmakan\s+bersama\b/i;

const PRICE_OR_DISCOUNT_TEXT =
  /(?:\b(?:rp\.?|idr)\s*\d[\d.,]*|\b\d{1,2}\s*%\s*(?:off|diskon|discount)?\b|\b\d{2,4}\s*k(?:\+\+|\b))/i;

const PROMO_OFFER_KEYWORDS =
  /\b(promo|diskon|discount|special\s*offer|exclusive\s*(?:weekend\s*)?offer|best\s*deal|best\s*price|flash\s*sale|late\s*night\s*sale|early\s*bird|book\s*early|save\s*more|hemat|ramah\s*(?:di\s*)?kantong|free\s+(?:ice\s*tea|afternoon\s*tea|flow|drink|access|voucher|entry|ticket)|gratis|buy\s+\d+\s+get\s+\d+|beli\s+\d+\s+gratis\s+\d+|bundling|voucher|giveaway|reward\s*points|poin\s*reward|kode\s*promo|promo\s*code|loyalitas|loyalty|j\s*club|explorer\s*passport|paket|package|midweek\s*full\s*reset|coastal\s*escape|day\s*use|room\s*for\s*the\s*day|afternoon\s*tea|high\s*tea|floating\s*breakfast|candlelight\s*dinner|romantic\s*dinner|bonfire\s*dinner|cabana\s*feast|sizzling\s*grill|prosperity\s*cruise|60\s*seconds\s*to\s*tokyo)\b/i;

const RAW_COMPETITOR_TITLE_PROMO =
  /\b(promo|diskon|discount|%|voucher|bundling|paket|package|gratis|free|buy\s+\d+\s+get|beli\s+\d+\s+gratis|flash\s*sale|early\s*bird|special\s*offer|giveaway)\b/i;

const RAW_COMPETITOR_TITLE_EVENT =
  /\b(live\s*music|guest\s*dj|\bf?dj\b|party|halloween|festival|gathering|outing|gala\s*dinner|fun\s*games|cooking\s*class|yoga|fire\s*dance|konser|perayaan|celebration|mermaid)\b/i;

/** Mengurai teks bersih judul dan isi promo/postingan (membuka JSON takarir sosmed & membuang usulan "Versi kita"). */
export function extractPromoPlainText(item: Pick<PromoOrEventInput, "title" | "description">): { title: string; body: string } {
  const title = (item.title ?? "").replace(RAW_POST_TITLE_PREFIX, "").trim();
  let body = (item.description ?? "").trim();
  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as { caption?: unknown };
      if (typeof parsed.caption === "string") body = parsed.caption.trim();
    } catch {
      // Biarkan isi mentah bila bukan JSON takarir valid.
    }
  }
  body = (body.split(OUR_VERSION_SPLIT)[0] ?? "").trim();
  return { title, body };
}

function hasPositiveNumber(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * Klasifikasi ketat Promo vs Event + penyaring postingan non-promo/non-event (dipakai bersama oleh summary API,
 * komponen Langkah 4, halaman Strategy, dan laporan PDF).
 *
 * - `"promo"`: penawaran harga, diskon %, kode voucher, paket menginap/F&B/spa, gratis/bonus, early bird, flash sale.
 * - `"event"`: acara/kegiatan terjadwal atau dokumentasi event (live music/DJ, corporate/family gathering, kelas, festival).
 * - `null`: postingan gaya hidup atau suasana tanpa penawaran, fitur aplikasi, resep rumahan, dan ucapan umum tanpa promo
 *   maupun acara. Promo yang lolos lalu diberi kategori promosi terpisah (promo-type.ts), termasuk "Brand awareness" untuk
 *   pengenalan fasilitas berharga biasa.
 */
export function classifyPromoOrEvent(item: PromoOrEventInput): ClassifiedPromoKind | null {
  if (item.category === NOT_PROMO_CATEGORY || item.category === INTERNAL_PROGRAM_CATEGORY) return null;
  if (item.source && isArchivedPromoSource(item.source)) return null;

  const { title, body } = extractPromoPlainText(item);
  if (!title && !body) return null;
  const combined = `${title}\n${body}`;

  const hasExplicitOfferNumbers = hasPositiveNumber(item.price) || hasPositiveNumber(item.discount);
  const normalizedKind = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : null;

  // Tolak pengumuman fitur aplikasi/AI, resep masakan rumahan, lowongan/ucapan hari besar, dan showcase viral tanpa penawaran.
  if (HOME_RECIPE_POST.test(combined) || JOB_OR_GREETING_POST.test(combined)) return null;
  if (!hasExplicitOfferNumbers && APP_OR_TECH_ANNOUNCEMENT.test(combined)) return null;
  if (!hasExplicitOfferNumbers && !PROMO_OFFER_KEYWORDS.test(title) && VIRAL_OR_AMBIANCE_ONLY.test(combined)) return null;

  // Postingan sosmed mentah kompetitor ("Postingan Sosmed Baru") yang belum dikurasi hanya lolos bila judulnya sendiri
  // secara tegas menyatakan promo atau event (mencegah takarir gaya hidup/meme/fitur bocor ke radar & PDF).
  if (item.category === RAW_COMPETITOR_SOCIAL_CATEGORY) {
    if (RAW_COMPETITOR_TITLE_EVENT.test(title)) return "event";
    if (hasExplicitOfferNumbers || RAW_COMPETITOR_TITLE_PROMO.test(title)) return "promo";
    return null;
  }

  const isOwnSocialPost = item.category === OWN_SOCIAL_POST_CATEGORY;
  const isOfficialOwnSite = item.source === OWN_OFFICIAL_SITE_SOURCE;

  // Paket komersial eksplisit (mis. Meeting & Outing Package, Year-End Staycation 25% OFF) tetap berupa promo.
  if (COMMERCIAL_PACKAGE_TITLE.test(title)) return "promo";

  // Deteksi event: kegiatan terjadwal, hiburan malam/DJ, festival, atau dokumentasi gathering rombongan/korporat.
  if (EVENT_GATHERING_SIGNAL.test(combined)) return "event";
  if (normalizedKind === "event" || EVENT_STRONG_SIGNAL.test(title)) return "event";
  if ((isOwnSocialPost || !hasExplicitOfferNumbers) && normalizedKind !== "promo" && EVENT_STRONG_SIGNAL.test(body)) {
    return "event";
  }

  // Deteksi promo: angka harga/diskon nyata, kartu penawaran situs resmi Sanghyang, atau sinyal penawaran komersial.
  const hasDetails = Array.isArray(item.details) && item.details.length > 0;
  const hasTerms = Array.isArray(item.terms) && item.terms.length > 0;

  if (isOfficialOwnSite || hasExplicitOfferNumbers) return "promo";
  if (isOwnSocialPost) {
    if (PRICE_OR_DISCOUNT_TEXT.test(combined) || PROMO_OFFER_KEYWORDS.test(combined)) return "promo";
    return OWN_GROUP_MEAL_SIGNAL.test(combined) ? "event" : null;
  }

  if (PRICE_OR_DISCOUNT_TEXT.test(combined) || PROMO_OFFER_KEYWORDS.test(combined) || hasDetails || hasTerms) {
    return "promo";
  }

  return null;
}

/** true bila item lolos saringan sebagai promo komersial atau event nyata (bukan postingan lifestyle/brand awareness). */
export const isGenuinePromoOrEvent = (item: PromoOrEventInput): boolean => classifyPromoOrEvent(item) !== null;

/** true bila item diklasifikasikan sebagai event/kegiatan nyata. */
export const isClassifiedEvent = (item: PromoOrEventInput): boolean => classifyPromoOrEvent(item) === "event";

/** true bila item diklasifikasikan sebagai promo/penawaran nyata. */
export const isClassifiedPromo = (item: PromoOrEventInput): boolean => classifyPromoOrEvent(item) === "promo";

/**
 * Pembersihan data sebelumnya mengarsipkan tangkapan situs resmi versi lama dengan melabeli sumbernya, misalnya
 * "Situs resmi (versi lama, diganti)" atau "Situs resmi (duplikat)". Baris itu riwayat, bukan promo yang berjalan.
 */
export const isArchivedPromoSource = (source: string) => /\((versi lama|duplikat)/i.test(source);

/** Kunci judul: huruf kecil, tanpa diakritik dan tanda baca, spasi dirapatkan. */
export function promoTitleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

export interface PromoRow {
  competitorId: string;
  title: string;
  category: string;
  capturedAt: Date;
  /** Label sumber tangkapan; baris tanpa label dianggap tangkapan biasa. */
  source?: string;
  competitor: { active: boolean };
}

/**
 * Tangkapan terbaru per (pesaing, judul) dari pesaing aktif, tanpa postingan bukan-promo.
 * Urutan masukan bebas; keluaran diurutkan dari tangkapan terbaru.
 */
export function latestPromoCaptures<T extends PromoRow>(rows: T[]): T[] {
  const newest = new Map<string, T>();
  for (const row of rows) {
    if (!row.competitor.active || row.category === NOT_PROMO_CATEGORY || (row.source && isArchivedPromoSource(row.source))) continue;
    const key = `${row.competitorId}|${promoTitleKey(row.title)}`;
    const seen = newest.get(key);
    if (!seen || row.capturedAt > seen.capturedAt) newest.set(key, row);
  }
  return [...newest.values()].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
}

const STOP = new Set(["the", "and", "with", "for", "dan", "di", "untuk", "yang", "dengan"]);
const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
/** Judul promo yang sama walau ditulis sedikit beda ("Best Deal with Breakfast" vs "... & Terrace Discount"). */
export function sameOffer(a: string, b: string): boolean {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

export type PromoPlatform = "instagram" | "tiktok" | "facebook" | "website";

/** Platform sumber dari alamatnya; label sumber bisa menyebut "Gemini" atau nama lain yang tidak menunjukkan asal tautan. */
export function platformOf(url: string | null | undefined): PromoPlatform | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  if (/(^|\.)(facebook|fb)\.com$/.test(host)) return "facebook";
  return "website";
}

export interface PromoSourceRef {
  platform: PromoPlatform;
  url: string;
  /** Label sumber asli tangkapan, untuk keterangan di laporan. */
  label: string;
  capturedAt: Date;
}

export interface MergeablePromoRow extends PromoRow {
  /** Nama pesaing wajib di sini: tanpa nama, tangkapan seri lintas pesaing kembali berurutan menurut letak baris di DB. */
  competitor: { active: boolean; name: string };
  sourceUrl: string | null;
  imageUrl?: string | null;
  description?: string | null;
  startsAt: Date;
  endsAt: Date | null;
  price?: unknown;
  discount?: unknown;
  /** Promo atau event menurut pembacaan AI; null bila belum dibaca. */
  kind?: string | null;
  /** Kategori promosi menurut pembacaan AI (lib/market/promo-type.ts); null bila belum dibaca. */
  promotionType?: string | null;
  /** Isi paket atau rangkaian acara yang disalin dari sumber. */
  details?: string[];
  terms?: string[];
}

const WIB_DAY = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
/** Tanggal promo atau event menurut kalender WIB: "7 Nov 2026" atau "1 Okt 2026 – 13 Des 2026". */
export function promoDayLabel(startsAt: Date, endsAt: Date | null): string {
  const start = WIB_DAY.format(startsAt);
  const end = endsAt ? WIB_DAY.format(endsAt) : null;
  return !end || end === start ? start : `${start} – ${end}`;
}

const DAY_MS = 86_400_000;
/** Batas usia maksimum promo bertanggal tertulis (3 bulan) sebelum tanggal acuan periode. */
export const PROMO_MAX_AGE_DAYS = 90;
/** Situs resmi tanpa tanggal tertulis menyimpan tanggal tangkap sebagai tanggal mulai; tanggal itu bukan tanggal promo. */
export const startDateWritten = (r: { startsAt: Date; capturedAt: Date }) => Math.abs(r.startsAt.getTime() - r.capturedAt.getTime()) > DAY_MS;

const SOCIAL_PLATFORMS = new Set<PromoPlatform>(["instagram", "tiktok", "facebook"]);

export interface RecencyCheckPromo {
  startsAt: Date | string;
  endsAt?: Date | string | null;
  capturedAt?: Date | string | null;
  /** Bila sudah dihitung sebelumnya (mis. pada RadarPromoJson), dipakai langsung tanpa menghitung ulang dari capturedAt. */
  startWritten?: boolean;
  status?: string | null;
  sourceUrl?: string | null;
  platform?: PromoPlatform | null;
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Menyaring promo menurut aturan kebaruan pemilik:
 * - Promo bertanggal tertulis (postingan media sosial atau memiliki startsAt/endsAt nyata) ditolak bila tanggal acuannya
 *   (`endsAt` jika ada, jika tidak `startsAt`) lebih tua dari `maxAgeDays` (bawaan 90 hari) sebelum `referenceDate`.
 * - Promo tanpa tanggal tertulis (mis. kartu penawaran aktif di situs resmi tanpa tanggal posting) tetap diizinkan
 *   selama `status !== "expired"`.
 */
export function isPromoWithinRecencyWindow(
  promo: RecencyCheckPromo,
  referenceDate: Date = new Date(),
  maxAgeDays = PROMO_MAX_AGE_DAYS,
): boolean {
  const startsAt = toValidDate(promo.startsAt);
  if (!startsAt) return false;
  const endsAt = toValidDate(promo.endsAt);
  const capturedAt = toValidDate(promo.capturedAt);
  const platform = promo.platform ?? platformOf(promo.sourceUrl);
  const isSocial = platform !== null && SOCIAL_PLATFORMS.has(platform);
  const hasWrittenStart =
    typeof promo.startWritten === "boolean"
      ? promo.startWritten
      : capturedAt !== null
        ? startDateWritten({ startsAt, capturedAt })
        : true;
  const hasWrittenDate = hasWrittenStart || endsAt !== null || isSocial;

  if (!hasWrittenDate) {
    return promo.status !== "expired";
  }

  const anchor = endsAt ?? startsAt;
  const cutoffMs = referenceDate.getTime() - maxAgeDays * DAY_MS;
  return anchor.getTime() >= cutoffMs;
}

/** Sabuk pengaman klien & server: true bila item promo berasal dari outlet Sanghyang sendiri, bukan pesaing. */
export function isOwnPromoItem(promo: { isOwn?: boolean; competitorName?: string | null }): boolean {
  if (promo.isOwn) return true;
  return Boolean(promo.competitorName && /sanghyang/i.test(promo.competitorName));
}

/**
 * Promo Sanghyang milik satu outlet. Promo sendiri sudah tersimpan di baris daftar outlet asalnya (kartu situs resmi per
 * outlet, postingan per akun atau takarir), jadi outletnya dibaca dari baris itu seperti laporan PDF, tidak ditebak
 * dari judul dan kategori seperti promo kompetitor: "Paket Babakaran" di baris resort tetap milik Kamar & Resort.
 */
export const ownPromosForOutlet = <T extends { competitorOutlets?: string[] }>(list: T[], outlet: string): T[] =>
  isOutletKey(outlet) ? list.filter((p) => (p.competitorOutlets ?? []).includes(outlet)) : list;

const OWN_SOURCE_LABELS: [PromoPlatform, string][] = [
  ["website", "Situs resmi"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
];

/**
 * Ringkasan asal promo dan event Sanghyang: "Situs resmi 3 · Instagram 3 · TikTok belum ada data". Situs resmi,
 * Instagram, dan TikTok selalu disebut supaya sumber yang kosong terlihat; Facebook hanya bila ada butirnya.
 */
export function ownPromoSourceSummary(items: { platform: PromoPlatform }[]): string {
  const count = (platform: PromoPlatform) => items.filter((p) => p.platform === platform).length;
  const parts = OWN_SOURCE_LABELS.map(([platform, label]) => (count(platform) > 0 ? `${label} ${count(platform)}` : `${label} belum ada data`));
  if (count("facebook") > 0) parts.push(`Facebook ${count("facebook")}`);
  return parts.join(" · ");
}
const hasWrittenDates = (r: MergeablePromoRow) => r.endsAt !== null || startDateWritten(r);
const priceOf = (r: MergeablePromoRow) => (r.price === null || r.price === undefined ? null : Number(r.price));
/** Tautan postingan lebih spesifik daripada halaman daftar penawaran, jadi didahulukan sebagai tautan utama. */
const PLATFORM_ORDER: PromoPlatform[] = ["instagram", "tiktok", "facebook", "website"];

/**
 * Satu kartu per penawaran. Tahap 1 mengelompokkan tangkapan berjudul sama (huruf dan tanda baca diabaikan). Tahap 2
 * menggabungkan kelompok yang judulnya mirip menurut sameOffer hanya bila platform sumbernya tidak bertumpang-tindih dan
 * harganya tidak bertentangan, karena dua postingan berbeda di platform yang sama ("Year End Special 2026" dan "Year End
 * Special Christmas") adalah dua promo. Baris utama adalah tangkapan terbaru, tanggal dari tangkapan yang menulis tanggal,
 * poster dari tangkapan yang punya poster, dan setiap sumber disimpan supaya tautan postingan tidak tertimpa halaman
 * daftar penawaran.
 */
export function mergePromoCaptures<T extends MergeablePromoRow>(rows: T[], opts?: { includeOwnSocial?: boolean }): (T & { sources: PromoSourceRef[] })[] {
  const allowOwnSocial = opts?.includeOwnSocial ?? true;
  // Baris dari DB datang dalam urutan bebas, dan tangkapan satu batch berwaktu tangkap sama. Urutan tetap ini membuat
  // kartu utama, poster, sumber, dan urutan kartu sama di setiap DB; pengurutan berikutnya stabil terhadapnya.
  const ordered = [...rows].sort(
    (a, b) =>
      newestFirst(a.capturedAt, b.capturedAt) ||
      byText(a.title, b.title) ||
      byText(a.sourceUrl, b.sourceUrl) ||
      byText(a.competitor.name, b.competitor.name) ||
      byText(a.source, b.source) ||
      byText(a.imageUrl, b.imageUrl) ||
      newestFirst(a.startsAt, b.startsAt),
  );
  const eligible = ordered.filter(
    (r) =>
      r.competitor.active &&
      r.category !== NOT_PROMO_CATEGORY &&
      (allowOwnSocial || r.category !== OWN_SOCIAL_POST_CATEGORY) &&
      !(r.source && isArchivedPromoSource(r.source)),
  );
  const byTitle = new Map<string, T[]>();
  for (const row of eligible) {
    const key = `${row.competitorId}|${promoTitleKey(row.title)}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), row]);
  }
  const platformsOf = (g: T[]) => new Set(g.map((r) => platformOf(r.sourceUrl)));
  const pricesOf = (g: T[]) => new Set(g.map(priceOf).filter((n): n is number => n !== null));
  const isRawSocial = (r: T) => r.category === OWN_SOCIAL_POST_CATEGORY || r.category === RAW_COMPETITOR_SOCIAL_CATEGORY;
  const isOfficialSite = (r: T) => r.source === OWN_OFFICIAL_SITE_SOURCE || platformOf(r.sourceUrl) === "website";
  const kindsOf = (g: T[]) =>
    new Set(
      g
        .map((r) => classifyPromoOrEvent(r))
        .filter((k): k is ClassifiedPromoKind => k !== null),
    );
  const groups: T[][] = [];
  for (const group of byTitle.values()) {
    const partner = groups.find((g) => {
      if (g[0].competitorId !== group[0].competitorId || !sameOffer(g[0].title, group[0].title)) return false;
      const theirs = platformsOf(g);
      if ([...platformsOf(group)].some((p) => theirs.has(p))) return false;
      // Postingan sosmed mentah (judul potongan takarir) tidak boleh menelan kartu penawaran situs resmi.
      if ((g.some(isRawSocial) && group.some(isOfficialSite)) || (group.some(isRawSocial) && g.some(isOfficialSite))) {
        return false;
      }
      // Jangan gabungkan promo dengan event walau sama-sama menyebut nama outlet.
      const aKinds = kindsOf(g);
      const bKinds = kindsOf(group);
      if (aKinds.size > 0 && bKinds.size > 0 && ![...aKinds].some((k) => bKinds.has(k))) return false;
      const a = pricesOf(g);
      const b = pricesOf(group);
      return !a.size || !b.size || [...a].some((n) => b.has(n));
    });
    if (partner) partner.push(...group);
    else groups.push([...group]);
  }
  const cards = groups.map((members) => {
    const captures = [...members].sort((a, b) => newestFirst(a.capturedAt, b.capturedAt));
    const primary = captures[0];
    const dated = captures.find(hasWrittenDates);
    const poster = captures.find((r) => r.imageUrl);
    // Isi paket dan jenis diambil dari tangkapan yang memuatnya; postingan sering lebih baru tetapi tanpa rincian.
    const detailed = captures.find((r) => r.details?.length);
    const termed = captures.find((r) => r.terms?.length);
    const kinded = captures.find((r) => r.kind);
    // Tangkapan baru belum tentu sudah dibaca kategorinya; kategori tangkapan lama penawaran yang sama tetap berlaku.
    const typed = captures.find((r) => r.promotionType);
    const sources: PromoSourceRef[] = [];
    for (const r of captures) {
      const platform = platformOf(r.sourceUrl);
      if (!platform || !r.sourceUrl || sources.some((s) => s.url === r.sourceUrl)) continue;
      sources.push({ platform, url: r.sourceUrl, label: r.source ?? "", capturedAt: r.capturedAt });
    }
    sources.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
    return {
      ...primary,
      startsAt: dated?.startsAt ?? primary.startsAt,
      endsAt: dated ? dated.endsAt : primary.endsAt,
      imageUrl: poster?.imageUrl ?? primary.imageUrl ?? null,
      sourceUrl: sources[0]?.url ?? primary.sourceUrl,
      kind: kinded?.kind ?? primary.kind ?? null,
      promotionType: typed?.promotionType ?? primary.promotionType ?? null,
      details: detailed?.details ?? primary.details ?? [],
      terms: termed?.terms ?? primary.terms ?? [],
      sources,
    };
  });
  return cards.sort((a, b) => newestFirst(a.capturedAt, b.capturedAt));
}
