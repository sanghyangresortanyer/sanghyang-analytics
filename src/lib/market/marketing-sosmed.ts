/**
 * Modul Marketing Sosmed: evaluasi postingan promosi Sanghyang yang sudah tayang.
 *
 * Akun induk = tautan di sanghyang.com. Akun outlet = link "bagikan profil" dari aplikasi (crawler/research/scripts/
 * asset_crawler.py, parameter igsh/_t), profilnya dicek ada 10 Nov 2026. Postingan = crawl akun Instagram itu
 * (scripts/crawl-own-posts.ts -> marketing-sosmed.data.json): caption, likes (halaman embed), pengikut (profil).
 * Views, komentar, chat WA hanya ada di Instagram Insights (login pemilik), jadi null sampai diisi tim.
 */

import { wibDay } from "./date-range";
import { isOutletKey, type OutletKey } from "./outlet-filters";
import crawled from "./marketing-sosmed.data.json";

export type SocialPlatform = "instagram" | "tiktok" | "facebook";

export interface OfficialSocialAccount {
  platform: SocialPlatform | "whatsapp" | "linktree";
  label: string;
  url: string;
  /** Pemilik akun: "Akun induk" atau nama outlet. */
  owner: string;
  /** Unit bisnis yang dilayani akun ini; kanal akun induk tercatat di Kamar & Resort. */
  outlets: OutletKey[];
}

export const OFFICIAL_ACCOUNTS_SOURCE = "https://sanghyang.com/";
export const OFFICIAL_SOCIAL_ACCOUNTS: OfficialSocialAccount[] = [
  { platform: "instagram", label: "@sanghyangresort", url: "https://www.instagram.com/sanghyangresort/", owner: "Akun induk (Resort)", outlets: ["resort"] },
  { platform: "instagram", label: "@sunsetgrillsanghyang", url: "https://www.instagram.com/sunsetgrillsanghyang/", owner: "Sunset Grill", outlets: ["sunset-grill"] },
  { platform: "instagram", label: "@dragonbeachclub", url: "https://www.instagram.com/dragonbeachclub/", owner: "Dragon Beach Club & d'Bar", outlets: ["dragon-beach-club", "dbar"] },
  { platform: "instagram", label: "@dbistro.anyer", url: "https://www.instagram.com/dbistro.anyer/", owner: "D'Bistro", outlets: ["dbistro"] },
  { platform: "instagram", label: "@dspasanghyang", url: "https://www.instagram.com/dspasanghyang/", owner: "D'Spa", outlets: ["dspa"] },
  { platform: "tiktok", label: "@sanghyangsparesort", url: "https://www.tiktok.com/@sanghyangsparesort", owner: "Akun induk (TikTok)", outlets: ["resort"] },
  { platform: "tiktok", label: "@sunsetgrill.sanghyang", url: "https://www.tiktok.com/@sunsetgrill.sanghyang", owner: "Sunset Grill (TikTok)", outlets: ["sunset-grill"] },
  { platform: "tiktok", label: "@dragonbeachclub", url: "https://www.tiktok.com/@dragonbeachclub", owner: "Dragon Beach Club (TikTok)", outlets: ["dragon-beach-club"] },
  { platform: "facebook", label: "SanghyangIndahSpa", url: "https://www.facebook.com/SanghyangIndahSpa/", owner: "Akun induk (Facebook)", outlets: ["resort"] },
  { platform: "linktree", label: "linktr.ee/sanghyangresort", url: "https://linktr.ee/sanghyangresort", owner: "Linktree Resmi", outlets: ["resort"] },
  { platform: "whatsapp", label: "0811-9011-600 (reservasi)", url: "https://wa.me/628119011600", owner: "Reservasi WhatsApp", outlets: ["resort"] },
];

/** Akun Instagram yang di-crawl; outlet null = akun induk, outlet ditebak dari caption. */
export const INSTAGRAM_ACCOUNTS: { username: string; outlet: OutletKey | null }[] = [
  { username: "sanghyangresort", outlet: null },
  { username: "sunsetgrillsanghyang", outlet: "sunset-grill" },
  { username: "dragonbeachclub", outlet: "dragon-beach-club" },
  { username: "dbistro.anyer", outlet: "dbistro" },
  { username: "dspasanghyang", outlet: "dspa" },
];

/**
 * Akun Instagram cadangan/lama milik Sanghyang yang sempat dipakai pada arsip crawl 10 Nov 2026
 * (berhenti 10 Mar 2024; akun aktif resmi 11K pengikut di Linktree & asset_crawler.py adalah @sunsetgrillsanghyang).
 */
export const LEGACY_OFFICIAL_SOCIAL_OUTLETS: Readonly<Record<string, OutletKey>> = {
  sunset_grillsanghyang: "sunset-grill",
};

export interface SocialPostMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  inquiriesWa: number | null;
}

export interface SocialPromoPostInput {
  id?: string;
  outletKey: OutletKey;
  platform: SocialPlatform;
  postType: "reels" | "feed" | "story" | "tiktok_video" | "carousel";
  postedAt: string; // YYYY-MM-DD
  postUrl: string;
  caption: string;
  /** null = belum diisi tim dari Insights. */
  metrics: SocialPostMetrics | null;
  /** Username Instagram pemilik postingan (hasil crawl). */
  account?: string;
}

export interface SocialPromoAiAudit {
  hookScore: number; // 0 - 100
  hookFeedback: string;
  copyScore: number; // 0 - 100
  copyFeedback: string;
  ctaScore: number; // 0 - 100
  ctaFeedback: string;
  /** null bila angka belum diisi. */
  engagementRatePercent: number | null;
  engagementHealth: "viral" | "healthy" | "average" | "underperforming" | "unknown";
  statusVerdict: "high_performing" | "needs_hook_revision" | "weak_cta" | "low_traction";
  verdictLabel: string;
  recommendedRevisionHeadline: string;
  actionDirective: string;
}

export interface SocialPromoPostRecord extends SocialPromoPostInput {
  id: string;
  createdAt: string;
  audit: SocialPromoAiAudit;
  /** Pengikut akun pemilik saat postingan disinkron ekstensi; tidak ada untuk crawl 10 Nov dan isian tim. */
  followers?: number | null;
  /** Waktu sinkron angka pengikut di atas (ISO). */
  followersObservedAt?: string | null;
  /** Jumlah total postingan asli pada profil akun saat disinkron ekstensi (untuk audit kelengkapan). */
  profilePostsTotal?: number | null;
}

/** Bobot Skor Mutu Caption, sama dengan rumus yang ditampilkan di jendela Rumus Skor Caption. */
export const CAPTION_SCORE_WEIGHTS = { hook: 0.35, copy: 0.35, cta: 0.3 } as const;

export const captionScore = (a: Pick<SocialPromoAiAudit, "hookScore" | "copyScore" | "ctaScore">): number =>
  Math.round(a.hookScore * CAPTION_SCORE_WEIGHTS.hook + a.copyScore * CAPTION_SCORE_WEIGHTS.copy + a.ctaScore * CAPTION_SCORE_WEIGHTS.cta);

/** Nama & kategori 6 outlet Sanghyang. */
export const SANGHYANG_OFFICIAL_OUTLETS: Record<OutletKey, { name: string; category: string }> = {
  resort: { name: "Kamar & Resort", category: "Resort & Hotel" },
  "sunset-grill": { name: "Sunset Grill", category: "Restoran Seafood" },
  "dragon-beach-club": { name: "Dragon Beach Club", category: "Venue Hiburan" },
  dbistro: { name: "D'Bistro", category: "Restoran" },
  dbar: { name: "D'Bar & Karaoke", category: "Bar & Karaoke" },
  dspa: { name: "D'Spa & Hot Spring", category: "Spa & Wellness" },
};

/** Outlet yang dibahas caption: nama outlet dulu, lalu kata khas; selain itu promosi resort umum. */
export function outletFromCaption(caption: string): OutletKey {
  const c = caption.toLowerCase();
  if (/sunset grill/.test(c)) return "sunset-grill";
  if (/dragon/.test(c)) return "dragon-beach-club";
  if (/d['’]?\s?bistro/.test(c)) return "dbistro";
  if (/d['’]?\s?bar\b|karaoke/.test(c)) return "dbar";
  if (/d['’]?\s?spa\b|hot ?spring|aquamedic|pijat|massage|treatment|aromaterapi/.test(c)) return "dspa";
  return "resort";
}

/**
 * Mesin Audit AI untuk Mengevaluasi Efektivitas Postingan Promo Sosmed
 */
export function evaluateSocialPromoPost(input: SocialPromoPostInput): SocialPromoAiAudit {
  const { caption, metrics, postType } = input;
  const lowerCaption = caption.toLowerCase();

  // 1. Audit Kualitas Hook (Baris Pembuka & Daya Tarik)
  let hookScore = 70;
  let hookFeedback = "Hook standar. Baris pembuka menyampaikan topik promo.";
  const strongHookWords = ["promo", "spesial", "rahasia", "terbatas", "akhir pekan", "hanya", "diskon", "sunset", "hemat", "gratis"];
  const matchesHook = strongHookWords.filter((w) => lowerCaption.includes(w)).length;

  if (matchesHook >= 3) {
    hookScore = 92;
    hookFeedback = "Hook sangat memikat! Menggunakan kombinasi kata pemicu emosi dan penawaran berbatas waktu.";
  } else if (matchesHook >= 1) {
    hookScore = 80;
    hookFeedback = "Hook cukup kuat dengan penawaran yang jelas di baris awal.";
  } else if (caption.length < 30) {
    hookScore = 55;
    hookFeedback = "Hook terlalu singkat. Penonton cenderung scrolling lewat tanpa menangkap nilai promo.";
  }

  // Bonus retensi untuk video pendek (Reels/TikTok) bila hook kuat
  const isVideoFormat = postType === "reels" || postType === "tiktok_video";
  if (isVideoFormat && matchesHook >= 2) {
    hookScore = Math.min(100, hookScore + 3);
    hookFeedback += " Format video pendek terbukti memperkuat daya tahan tonton pemirsa.";
  }

  // 2. Audit Copywriting & Kelengkapan Penawaran
  let copyScore = 75;
  let copyFeedback = "Informasi promo cukup jelas dan mudah dipahami.";
  const hasPriceOrDiscount = /[0-9]+(\.[0-9]+)?(k|rb|%|ribu|juta|rp)/i.test(caption);
  const hasFeaturesOrBenefits = lowerCaption.includes("pantai") || lowerCaption.includes("segar") || lowerCaption.includes("santai") || lowerCaption.includes("view");

  if (hasPriceOrDiscount && hasFeaturesOrBenefits) {
    copyScore = 90;
    copyFeedback = "Copywriting solid! Mencantumkan benefit emosional sekaligus kejelasan harga/diskon transparan.";
  } else if (!hasPriceOrDiscount) {
    copyScore = 65;
    copyFeedback = "Copywriting kurang mencantumkan transparansi harga atau persentase hemat sehingga penonton ragu bertindak.";
  }

  // 3. Audit Call to Action (CTA)
  let ctaScore = 60;
  let ctaFeedback = "Ajakan bertindak (CTA) kurang spesifik.";
  // Kata utuh: "wa"/"dm" tidak boleh cocok di dalam kata lain ("Wanderis", "admin").
  const hasCta = /\b(whatsapp|wa|dm|reservasi|booking|book now|hubungi|pesan sekarang|link di bio|klik link)\b|\b08\d{2}[-\s]?\d{3,4}/.test(lowerCaption);

  if (hasCta) {
    ctaScore = 88;
    ctaFeedback = "CTA kuat dan langsung mengarahkan audiens ke saluran konversi (WhatsApp / Bio / DM).";
  } else {
    ctaScore = 45;
    ctaFeedback = "PERHATIAN: Postingan tidak memiliki Call-to-Action (CTA) yang jelas. Audiens bingung harus pesan ke mana.";
  }

  // 4. Hitung Engagement Rate (hanya bila angka sudah diisi tim; tanpa views tidak dihitung)
  let engagementRatePercent: number | null = null;
  let engagementHealth: SocialPromoAiAudit["engagementHealth"] = "unknown";
  if (metrics && metrics.views !== null && metrics.views > 0) {
    const interactions = (metrics.likes ?? 0) + (metrics.comments ?? 0) + (metrics.shares ?? 0);
    engagementRatePercent = Math.round((interactions / metrics.views) * 1000) / 10;
    engagementHealth = "average";
    const waLeads = metrics.inquiriesWa;
    if (engagementRatePercent >= 7.0 || (waLeads !== null && waLeads >= 15)) {
      engagementHealth = "viral";
    } else if (engagementRatePercent >= 4.0 || (waLeads !== null && waLeads >= 5)) {
      engagementHealth = "healthy";
    } else if (engagementRatePercent < 2.0 && (waLeads === null || waLeads === 0)) {
      engagementHealth = "underperforming";
    }
  } else if (metrics && metrics.inquiriesWa !== null && metrics.inquiriesWa >= 5) {
    engagementHealth = metrics.inquiriesWa >= 15 ? "viral" : "healthy";
  }

  // 5. Klasifikasi Status Vonis Akhir
  let statusVerdict: SocialPromoAiAudit["statusVerdict"] = "high_performing";
  let verdictLabel =
    engagementHealth === "unknown"
      ? "Caption sudah kuat (angka belum diisi)"
      : "Efektif & Menghasilkan Leads";
  let recommendedRevisionHeadline = "Pertahankan format visual dan lanjutkan promosi serupa di akhir pekan.";
  let actionDirective = "Tingkatkan anggaran jangkauan (boost post) atau tayangkan ulang versi Reels serupanya.";

  if (ctaScore < 60) {
    statusVerdict = "weak_cta";
    verdictLabel = "CTA Lemah (Perlu Tombol/Link WA)";
    recommendedRevisionHeadline = "Tambahkan ajakan eksplisit: 'Reservasi via WhatsApp 0811-9011-600 atau klik link di bio!'";
    actionDirective = "Edit caption sekarang dan sematkan komentar teratas (*pinned comment*) dengan link langsung ke WhatsApp CS.";
  } else if (hookScore < 70) {
    statusVerdict = "needs_hook_revision";
    verdictLabel = "Hook Perlu Dipertajam";
    recommendedRevisionHeadline = "Ganti kalimat pembuka dengan pertanyaan memikat atau tawaran berbatas waktu.";
    actionDirective = "Buat ulang video 3 detik pertama dengan visual close-up hidangan mengepul atau deburan ombak senja.";
  } else if (engagementHealth === "underperforming") {
    statusVerdict = "low_traction";
    verdictLabel = "Jangkauan Rendah (Kurang Traksi)";
    recommendedRevisionHeadline = "Ubah jam tayang ke prime-time Anyer (Kamis sore / Jumat siang jam 16.00-19.00 WIB).";
    actionDirective = "Eksplorasi format video pendek (Reels/TikTok) dengan musik trending, kurangi poster teks statis.";
  }

  return {
    hookScore,
    hookFeedback,
    copyScore,
    copyFeedback,
    ctaScore,
    ctaFeedback,
    engagementRatePercent,
    engagementHealth,
    statusVerdict,
    verdictLabel,
    recommendedRevisionHeadline,
    actionDirective,
  };
}

/** Angka Instagram berbahasa Inggris: "7,818" → 7818, "1.2K" → 1200, "8K" → 8000. null bila bukan angka. */
export function parseInstagramCount(raw: string): number | null {
  const m = raw.trim().match(/^([\d.,]+)\s*([KkMm]?)$/);
  if (!m) return null;
  if (m[2]) return Math.round(parseFloat(m[1].replace(/,/g, "")) * (/k/i.test(m[2]) ? 1_000 : 1_000_000));
  const n = parseInt(m[1].replace(/[.,]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

/** Likes dari teks halaman embed postingan (baris "14 likes"); null bila likes disembunyikan. */
export const likesFromEmbedText = (text: string): number | null => {
  const m = text.match(/^([\d.,]+[KkMm]?) likes?$/m);
  return m ? parseInstagramCount(m[1]) : null;
};

/** Pengikut dari og:description profil ("7,818 Followers, 159 Following, ..."). */
export const followersFromProfileMeta = (meta: string): number | null => {
  const m = meta.match(/^([\d.,]+[KkMm]?) Followers/);
  return m ? parseInstagramCount(m[1]) : null;
};

interface CrawledPost { account?: string; url: string; postedAt: string; postType: "reels" | "feed"; caption: string; likes?: number | null }
const data = crawled as { crawledAt: string; accounts?: Record<string, { followers: number | null }>; posts: CrawledPost[] };
const accountOf = (p: CrawledPost) => p.account ?? "sanghyangresort";

export const TIKTOK_ACCOUNTS: { username: string; outlet: OutletKey }[] = [
  { username: "sanghyangsparesort", outlet: "resort" },
  { username: "sunsetgrill.sanghyang", outlet: "sunset-grill" },
  { username: "dragonbeachclub", outlet: "dragon-beach-club" },
];

/**
 * Pengikut akun Instagram resmi dari crawl profil 10 Nov (og:description). Crawl itu hanya membaca Instagram, jadi akun
 * TikTok yang namanya sama (@dragonbeachclub) tidak ikut di sini.
 */
export const FOLLOWERS: Record<string, number | null> = Object.fromEntries(
  INSTAGRAM_ACCOUNTS.map((a) => [a.username, data.accounts?.[a.username]?.followers ?? null]),
);

/** Kunci angka pengikut per akun; platform ikut karena satu nama akun bisa dipakai di Instagram dan TikTok. */
export const followerKey = (platform: SocialPlatform | "whatsapp" | "linktree", handle: string) => `${platform}:${handle.replace(/^@/, "")}`;

/** Pengikut hasil crawl 10 Nov dengan kunci followerKey (Instagram saja). */
export const CRAWLED_FOLLOWERS: Record<string, number | null> = Object.fromEntries(
  INSTAGRAM_ACCOUNTS.map((a) => [followerKey("instagram", a.username), FOLLOWERS[a.username]]),
);
export const CRAWLED_POSTS_SOURCE = { crawledAt: data.crawledAt };

/** Likes publik per postingan (halaman embed Instagram, tanpa login), diperbarui tiap crawl. */
export const PUBLIC_LIKES: Record<string, number | null> = Object.fromEntries(data.posts.map((p) => [p.url, p.likes ?? null]));

/** Likes ÷ pengikut, persen 2 desimal; null bila salah satunya belum ada. */
export const likeRatePercent = (likes: number | null, followers: number | null) =>
  likes === null || !followers ? null : Math.round((likes / followers) * 10_000) / 100;

export interface StoredSocialPostRow {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  source: string;
  sourceUrl: string | null;
  createdAt: Date;
  capturedAt: Date;
}

const POST_TYPES = new Set<SocialPromoPostInput["postType"]>(["reels", "feed", "story", "tiktok_video", "carousel"]);

/**
 * Satu postingan tersimpan sekali per tangkapan sinkron (identitas baris memuat waktu tangkap), jadi satu tautan bisa
 * punya beberapa baris. Halaman memakai tangkapan terbaru per tautan supaya kartu tidak ganda dan angkanya yang terbaru.
 * Urutan asal dipertahankan.
 */
export function latestCapturePerPost<R extends { sourceUrl: string | null; capturedAt: Date }>(rows: readonly R[]): R[] {
  const latest = new Map<string, R>();
  for (const row of rows) {
    if (!row.sourceUrl) continue;
    const prev = latest.get(row.sourceUrl);
    if (!prev || row.capturedAt > prev.capturedAt) latest.set(row.sourceUrl, row);
  }
  return rows.filter((row) => !row.sourceUrl || latest.get(row.sourceUrl) === row);
}

/**
 * Baris "Postingan Sosmed Tayang" (sinkron ekstensi atau isian tim) menjadi postingan halaman Media Sosial, Ringkasan,
 * dan laporan. Baris tanpa tautan postingan dilewati karena tidak bisa dibuka atau diverifikasi.
 */
export function parseStoredSocialPost(row: StoredSocialPostRow): SocialPromoPostRecord | null {
  if (!row.sourceUrl) return null;
  let meta: Record<string, unknown> = {};
  if (row.description?.trim().startsWith("{")) {
    try {
      meta = JSON.parse(row.description) as Record<string, unknown>;
    } catch {
      // ZERO-FALLBACK: deskripsi JSON rusak dibaca sebagai teks caption; postingan tetap tampil dengan tautan aslinya.
      meta = { caption: row.description };
    }
  } else if (row.description) {
    meta = { caption: row.description };
  }

  const rawPlatform = String(meta.platform ?? row.source).toLowerCase();
  const platform: SocialPlatform = rawPlatform.includes("tiktok") ? "tiktok" : rawPlatform.includes("facebook") ? "facebook" : "instagram";
  const postType = POST_TYPES.has(meta.postType as SocialPromoPostInput["postType"])
    ? (meta.postType as SocialPromoPostInput["postType"])
    : platform === "tiktok"
      ? "tiktok_video"
      : "reels";
  const input: SocialPromoPostInput = {
    outletKey: isOutletKey(meta.outletKey) ? meta.outletKey : "resort",
    platform,
    postType,
    postedAt: wibDay(row.startsAt),
    postUrl: row.sourceUrl,
    caption: typeof meta.caption === "string" && meta.caption.trim() ? meta.caption : row.title,
    // Angka yang belum diisi tim atau belum terbaca tetap null ("Belum ada data"), bukan nol buatan.
    metrics: (meta.metrics as SocialPostMetrics | null | undefined) ?? null,
    ...(typeof meta.account === "string" && meta.account ? { account: meta.account } : {}),
  };
  const followers = typeof meta.followers === "number" && Number.isFinite(meta.followers) ? meta.followers : null;
  const profilePostsTotal =
    typeof meta.profilePostsTotal === "number" && Number.isFinite(meta.profilePostsTotal) ? meta.profilePostsTotal : null;
  return {
    ...input,
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    audit: evaluateSocialPromoPost(input),
    followers,
    followersObservedAt: followers === null ? null : row.capturedAt.toISOString(),
    profilePostsTotal,
  };
}

/** Postingan asli akun Instagram resmi (hasil crawl); views & chat WA belum diisi. */
export const CRAWLED_POSTS: SocialPromoPostRecord[] = data.posts.map((p) => {
  const acc = accountOf(p);
  const input: SocialPromoPostInput = {
    account: acc,
    outletKey:
      INSTAGRAM_ACCOUNTS.find((a) => a.username === acc)?.outlet ??
      LEGACY_OFFICIAL_SOCIAL_OUTLETS[acc] ??
      outletFromCaption(p.caption),
    platform: "instagram",
    postType: p.postType,
    postedAt: p.postedAt,
    postUrl: p.url,
    caption: p.caption,
    metrics: null,
  };
  return { ...input, id: p.url, createdAt: data.crawledAt, audit: evaluateSocialPromoPost(input) };
});
