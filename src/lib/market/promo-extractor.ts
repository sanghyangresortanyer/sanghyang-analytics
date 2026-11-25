/**
 * Gemini membaca postingan Instagram pesaing (caption + gambar poster) dan memutuskan apakah isinya promo atau event.
 * Hasilnya disimpan terstruktur (jenis, judul, kategori, tanggal, harga/diskon, isi paket dan syarat yang disalin dari
 * sumber, usulan versi Sanghyang) di baris postingan yang sama; postingan biasa ditandai "bukan promo". Tidak ada baris
 * yang dihapus. Halaman postingan hanya terbuka dari internet rumah (Instagram menolak IP server), jadi ini jalan di
 * tombol lokal.
 */
import type { Page } from "puppeteer";
import { fetchAman } from "../urlaman";
import { stripLoneSurrogates, truncateText } from "../text/safe-truncate";
import { SOCIAL_POST_CATEGORY } from "./outlet-filters";
import { DEEP_DISCOUNT_PERCENT } from "./plain-language";
import { DISPROVEN_FACILITY_CLAIM } from "./resort-strategy";

export const PROMO_CATEGORIES = ["Kamar & Menginap", "F&B & Kuliner", "Acara & Live Music", "Keluarga & Anak", "Wellness & Relaksasi", "Digital & Booking"] as const;
export type PromoCategory = (typeof PROMO_CATEGORIES)[number];
/** Jenis penawaran yang diputuskan AI dari isi sumber (definisinya di KIND_RULES), bukan dari daftar kata kunci. */
export const PROMO_KINDS = ["promo", "event"] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];
import { NOT_PROMO_CATEGORY } from "./promo-radar";
export { NOT_PROMO_CATEGORY };
export const EXTRACTED_SOURCE = "Instagram (dibaca Gemini)";
/** Pemisah antara ringkasan promo dan usulan versi Sanghyang di kolom description. */
export const OUR_VERSION_MARKER = "\nVersi kita: ";
/** Batas wajar tanggal promo terhadap tanggal posting, untuk menolak tanggal hasil salah baca. */
const DATE_WINDOW_DAYS = { before: 60, after: 240 };
const MAX_PER_RUN = 60;
const MAX_DETAILS = 12;
const MAX_TERMS = 4;
/** Butir lebih panjang dari ini hampir pasti paragraf utuh, bukan satu butir isi paket. */
const MAX_LINE_CHARS = 300;

/**
 * Definisi promo dan event untuk AI (pemilik, 17 Nov 2026). Promo menjual harga atau manfaat; event adalah kegiatan
 * pada tanggal tertentu. Kata kunci tidak dipakai karena judul pesaing jarang memakai kata yang sama.
 */
export const KIND_RULES = `"kind": "promo" bila intinya penawaran harga atau manfaat untuk dibeli: potongan harga atau persen, harga khusus, beli 1 gratis 1, kode promo, voucher, atau paket menginap/makan/spa reguler dengan bonus (mis. 3 hari 2 malam dengan afternoon tea gratis).
"kind": "event" bila intinya kegiatan yang berlangsung pada tanggal atau jam tertentu maupun dokumentasi event: pertunjukan, konser, live music/DJ bertanggal, corporate/family gathering, outing rombongan, fun games, cooking class, marshmallow time, festival, lomba, perayaan hari besar, gala dinner, meet & greet (mis. pertunjukan putri duyung di kolam renang pada satu tanggal), walaupun ada tiket, paket, atau harga.`;

/** Aturan isi yang disalin, supaya kartu menampilkan isi paket yang sebenarnya dan bukan parafrase. */
const COPY_RULES = `"details": daftar isi paket, manfaat, atau rangkaian acara PERSIS seperti tertulis di sumber (salin kata per kata dalam bahasa aslinya, satu butir per baris, jangan diterjemahkan, diringkas, atau ditambah), maks ${MAX_DETAILS}; [] bila sumber tidak merinci.
"terms": syarat dan masa berlaku PERSIS seperti tertulis di sumber (mis. minimal menginap, hari berlaku, cara pesan), maks ${MAX_TERMS}; [] bila tidak ada.
"summary": 1 kalimat bahasa Indonesia sederhana yang hanya memuat fakta tertulis di sumber; jangan menambah "dan lainnya", "fasilitas menarik", atau klaim lain yang tidak tertulis.`;
export interface ExtractedPromo {
  /** true untuk promo maupun event; false untuk postingan biasa. */
  isPromo: boolean;
  kind: PromoKind;
  title: string;
  category: PromoCategory;
  startsAt: string | null;
  endsAt: string | null;
  price: number | null;
  discountPercent: number | null;
  summary: string;
  /** Isi paket atau rangkaian acara yang benar-benar tertulis di sumber (groundedLines). */
  details: string[];
  terms: string[];
  ourVersion: string | null;
}

const groundKey = (t: string) =>
  t
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();

/**
 * Butir jawaban AI yang benar-benar tertulis di teks sumber (huruf besar-kecil, tanda baca, dan aksen diabaikan).
 * Butir karangan, terjemahan, atau ringkasan dibuang, begitu juga butir ganda.
 */
export function groundedLines(items: unknown, sourceText: string, max: number): string[] {
  if (!Array.isArray(items) || !sourceText) return [];
  const source = ` ${groundKey(sourceText)} `;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") continue;
    const text = stripLoneSurrogates(item.replace(/\s+/g, " ").trim());
    const key = groundKey(text);
    if (text.length > MAX_LINE_CHARS || key.length < 3 || seen.has(key) || !source.includes(` ${key} `)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Tanggal promo menurut kalender WIB: mulai 00.00.00 WIB, berakhir 23.59.59 WIB pada tanggal yang tertulis. */
export function promoDayRange(startsAt: string | null, endsAt: string | null): { startsAt: Date | null; endsAt: Date | null } {
  return {
    startsAt: startsAt ? new Date(`${startsAt}T00:00:00+07:00`) : null,
    endsAt: endsAt ? new Date(`${endsAt}T23:59:59+07:00`) : null,
  };
}

export const PROMO_ANALYST = `Kamu analis pemasaran untuk Sanghyang Indah Spa Resort di Anyer (resort tepi pantai dengan Hot Spring Aquamedic, Sunset Grill, Dragon Beach Club, D'Bistro, D'Bar & Karaoke, D'Spa).`;
const CAPTION_CHARS = 2000;

/** Bentuk satu objek jawaban; dipakai prompt Instagram dan situs resmi. */
export const PROMO_JSON_SHAPE = `{"isPromo": boolean, "kind": "promo" | "event", "title": "judul promo atau event singkat (maks 100 huruf)", "category": salah satu ${JSON.stringify(PROMO_CATEGORIES)},
 "startsAt": "YYYY-MM-DD atau null (untuk event: tanggal acara)", "endsAt": "YYYY-MM-DD atau null", "price": angka rupiah atau null, "discountPercent": angka atau null,
 "summary": "1 kalimat", "details": ["..."], "terms": ["..."],
 "ourVersion": "1 kalimat usulan tandingan Sanghyang yang memakai nilai tambah (bonus, paket, pengalaman, atau acara sendiri), BUKAN potongan harga besar; null bila bukan promo atau event"}`;

export const PROMO_FIELD_RULES = `${KIND_RULES}
${COPY_RULES}
Jangan mengarang tanggal atau harga yang tidak tertulis: isi null.`;

export function buildPrompt(competitor: string, caption: string, postedAt: Date): string {
  return `${PROMO_ANALYST}
Baca postingan Instagram kompetitor berikut (caption dan gambar poster bila ada). Tentukan apakah isinya PROMO atau EVENT yang bisa dibeli, dipesan, atau didatangi tamu. Konten suasana, gaya hidup, brand awareness, pengumuman fitur aplikasi/AI, resep masakan rumahan, testimoni, atau ucapan BUKAN promo maupun event (isPromo false).

Kompetitor: ${competitor}
Tanggal posting: ${postedAt.toISOString().slice(0, 10)}
Caption: ${truncateText(stripLoneSurrogates(caption), CAPTION_CHARS)}

Jawab HANYA JSON:
${PROMO_JSON_SHAPE}
${PROMO_FIELD_RULES}`;
}

const isoDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
export const parseIsoDay = isoDay;
const within = (day: string | null, postedAt: Date) => {
  if (!day) return true;
  const diff = (Date.parse(`${day}T00:00:00Z`) - postedAt.getTime()) / 86_400_000;
  return diff >= -DATE_WINDOW_DAYS.before && diff <= DATE_WINDOW_DAYS.after;
};
/** Tanggal promo atau event yang wajar terhadap tanggal posting atau tanggal tercatat (menolak tanggal salah baca). */
export const isPlausiblePromoDay = (day: string, anchor: Date) => within(day, anchor);

/**
 * Validasi ketat jawaban Gemini; null bila tidak bisa dipercaya. `sourceText` adalah teks yang dibaca AI: isi paket dan
 * syarat hanya diterima bila tertulis di sana.
 */
export function parseExtraction(raw: string, postedAt: Date, sourceText = ""): ExtractedPromo | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (typeof j.isPromo !== "boolean") return null;
  if (!j.isPromo)
    return { isPromo: false, kind: "promo", title: "", category: PROMO_CATEGORIES[0], startsAt: null, endsAt: null, price: null, discountPercent: null, summary: "", details: [], terms: [], ourVersion: null };
  const title = typeof j.title === "string" ? j.title.trim().slice(0, 120) : "";
  const category = PROMO_CATEGORIES.find((c) => c === j.category);
  const kind = PROMO_KINDS.find((k) => k === (typeof j.kind === "string" ? j.kind.trim().toLowerCase() : null));
  if (!title || !category || !kind) return null;
  let startsAt = isoDay(j.startsAt);
  let endsAt = isoDay(j.endsAt);
  if (!within(startsAt, postedAt)) startsAt = null;
  if (!within(endsAt, postedAt) || (startsAt && endsAt && endsAt < startsAt)) endsAt = null;
  // Event bertanggal tanpa tanggal selesai berlangsung pada hari itu saja; tanpa ini event lampau terus berstatus aktif.
  if (kind === "event" && startsAt && !endsAt) endsAt = startsAt;
  const price = typeof j.price === "number" && j.price > 0 && j.price < 100_000_000 ? Math.round(j.price) : null;
  const discountPercent = typeof j.discountPercent === "number" && j.discountPercent > 0 && j.discountPercent <= 90 ? Math.round(j.discountPercent) : null;
  const summary = typeof j.summary === "string" ? truncateText(stripLoneSurrogates(j.summary.trim()), 300) : "";
  let ourVersion = typeof j.ourVersion === "string" ? truncateText(stripLoneSurrogates(j.ourVersion.trim()), 300) : null;
  // Usulan versi kita tidak boleh memotong harga dalam-dalam atau mengklaim fasilitas yang tidak ada di situs resmi.
  const ourDiscount = Number(ourVersion?.match(/(\d{1,2})\s*%/)?.[1] ?? 0);
  if (ourVersion && (ourDiscount >= DEEP_DISCOUNT_PERCENT || DISPROVEN_FACILITY_CLAIM.test(ourVersion))) ourVersion = null;
  const details = groundedLines(j.details, sourceText, MAX_DETAILS);
  const terms = groundedLines(j.terms, sourceText, MAX_TERMS);
  return { isPromo: true, kind, title, category, startsAt, endsAt, price, discountPercent, summary, details, terms, ourVersion: ourVersion || null };
}

/** Caption & gambar dari meta halaman postingan (terbuka tanpa login dari internet rumah). */
export async function readPost(page: Page, url: string) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
  return page.evaluate(() => ({
    caption: document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "",
    image: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    blocked: location.href.includes("/accounts/login"),
  }));
}

async function askGemini(prompt: string, image: { data: string; mimeType: string } | null): Promise<string> {
  const { generateWithRetry, model } = await import("../gemini");
  const parts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [{ text: prompt }];
  if (image) parts.push({ inlineData: image });
  const res = await generateWithRetry({
    model: model(),
    contents: [{ role: "user", parts }],
    // Suhu 0: jenis promo/event dan isi paket harus sama pada setiap penyegaran, bukan berganti antar bacaan.
    config: { responseMimeType: "application/json", temperature: 0 },
  });
  return res.text ?? "";
}

/** Baca postingan Instagram pesaing yang belum dibaca; kembalikan ringkasan hitungan. */
export async function classifyRawPosts(limit = MAX_PER_RUN): Promise<{ checked: number; promos: number; notPromos: number; failures: string[] }> {
  const { db } = await import("../db");
  const { Prisma } = await import("@prisma/client");
  const rows = await db.competitorPromotion.findMany({
    where: { category: SOCIAL_POST_CATEGORY, sourceUrl: { not: null } },
    select: { id: true, sourceUrl: true, startsAt: true, version: true, competitor: { select: { name: true } } },
    orderBy: { startsAt: "desc" },
    take: limit,
  });
  const result = { checked: 0, promos: 0, notPromos: 0, failures: [] as string[] };
  if (!rows.length) return result;
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"] });
  try {
    const page = await browser.newPage();
    for (const row of rows) {
      try {
        const post = await readPost(page, row.sourceUrl!);
        if (post.blocked) throw new Error("Instagram meminta login");
        let image: { data: string; mimeType: string } | null = null;
        if (post.image) {
          const res = await fetchAman(post.image);
          if (res.ok) image = { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg" };
        }
        const parsed = parseExtraction(await askGemini(buildPrompt(row.competitor.name, post.caption, row.startsAt), image), row.startsAt, post.caption);
        if (!parsed) throw new Error("jawaban Gemini tidak valid");
        const days = promoDayRange(parsed.startsAt, parsed.endsAt);
        const data = parsed.isPromo
          ? {
              category: parsed.category,
              kind: parsed.kind,
              details: parsed.details,
              terms: parsed.terms,
              title: parsed.title,
              description: `${parsed.summary}${parsed.ourVersion ? `${OUR_VERSION_MARKER}${parsed.ourVersion}` : ""}`,
              startsAt: days.startsAt ?? row.startsAt,
              endsAt: days.endsAt,
              price: parsed.price === null ? null : new Prisma.Decimal(parsed.price),
              discount: parsed.discountPercent === null ? null : new Prisma.Decimal(parsed.discountPercent),
              source: EXTRACTED_SOURCE,
              imageUrl: post.image,
            }
          : { category: NOT_PROMO_CATEGORY, description: truncateText(stripLoneSurrogates(post.caption), 500) || null };
        const r = await db.competitorPromotion.updateMany({ where: { id: row.id, version: row.version }, data: { ...data, version: { increment: 1 } } });
        if (r.count !== 1) throw new Error("OCC conflict");
        result.checked++;
        if (parsed.isPromo) result.promos++;
        else result.notPromos++;
      } catch (error) {
        result.failures.push(`${row.competitor.name}: ${(error as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }
  return result;
}
