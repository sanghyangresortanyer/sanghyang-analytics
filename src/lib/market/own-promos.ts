/**
 * Promo Sanghyang sendiri, dari dua sumber:
 * - kartu penawaran di situs resmi (https://sanghyang.com/offers), dibaca tanpa LLM dari blok CMS judul dan isinya;
 * - program bulanan tim marketing (own-promos-team.data.json) beserta hasil verifikasinya ke situs dan media sosial.
 * Keduanya disimpan di CompetitorPromotion pada baris registri outlet Sanghyang, sama seperti ulasan dan rating outlet
 * sendiri. Karena itu setiap tampilan "promo pesaing" wajib memakai NOT_OWN_PROMO.
 */
import { PromotionStatus, Prisma } from "@prisma/client";
import { db } from "../db";
import type { OutletKey } from "./outlet-filters";
import { OWN_OUTLETS } from "./outlet-ratings";
import { classifyPromoOrEvent, promoTitleKey } from "./promo-radar";
import { PROMO_CATEGORIES, type PromoCategory } from "./promo-extractor";
import team from "./own-promos-team.data.json";

export const OWN_OFFERS_URL = "https://sanghyang.com/offers";
export const OWN_SITE_SOURCE = "Situs resmi Sanghyang (penawaran)";
export const OWN_TEAM_SOURCE = "Tim marketing Sanghyang";
export const PROGRAM_CATEGORY = "Program pemasaran";
export const OWN_COMPETITOR_NAMES = OWN_OUTLETS.map((o) => o.competitorName);
const OWN_COMPETITOR_NAME_SET = new Set<string>(OWN_COMPETITOR_NAMES);
/** true bila nama entitas registri adalah outlet Sanghyang sendiri (tidak boleh masuk daftar pesaing). */
export const isOwnCompetitorName = (name: string): boolean =>
  OWN_COMPETITOR_NAME_SET.has(name) || /sanghyang/i.test(name);
/** Filter Prisma untuk tampilan promo pesaing: baris outlet Sanghyang tidak ikut. */
export const NOT_OWN_PROMO = { competitor: { name: { notIn: OWN_COMPETITOR_NAMES } } } satisfies Prisma.CompetitorPromotionWhereInput;

export interface TeamPromoItem {
  outlet: OutletKey;
  kind: "promo" | "program";
  title: string;
  category: string;
  price: number | null;
  discount: number | null;
  verification: { status: "situs-resmi" | "sebagian" | "belum"; note: string };
}

export const TEAM_PROMOS = team as {
  source: string;
  period: { start: string; end: string };
  checkedAt: string;
  checked: string[];
  items: TeamPromoItem[];
};

export interface OwnOffer {
  outletKey: OutletKey;
  title: string;
  description: string;
  category: PromoCategory;
  price: number | null;
  discount: number | null;
}

/** Outlet dan kategori dari isi kartu; urutannya penting (nama outlet lebih dulu daripada kata umum seperti "villa"). */
const OUTLET_RULES: [RegExp, OutletKey, PromoCategory][] = [
  [/sunset grill/i, "sunset-grill", "F&B & Kuliner"],
  [/dragon beach club|\bdbc\b/i, "dragon-beach-club", "Acara & Live Music"],
  [/\bd'?bar\b|karaoke/i, "dbar", "Acara & Live Music"],
  [/\bd'?bistro\b/i, "dbistro", "F&B & Kuliner"],
  [/\bd'?spa\b|hot ?spring|aquamedic|\bspa\b|massage|pijat/i, "dspa", "Wellness & Relaksasi"],
  [/babakaran|\bbbq\b|barbe(cue|que)/i, "resort", "F&B & Kuliner"],
  [/meeting|outing|wedding|\bmice\b/i, "resort", "Kamar & Menginap"],
];

const VERIFICATION_LABEL = { "situs-resmi": "terverifikasi di situs resmi", sebagian: "terverifikasi sebagian", belum: "belum terverifikasi publik" } as const;

/** Harga rupiah (IDR/Rp, atau akhiran K/rb/jt) dan diskon persen yang tertulis di teks; null bila tidak ada. */
export function offerNumbers(text: string): { price: number | null; discount: number | null } {
  const percent = text.match(/(\d{1,2})\s?%/);
  const withCurrency = text.match(/(?:IDR|Rp\.?)\s?(\d{1,3}(?:[.,]\d{3})+|\d+)/i);
  const withSuffix = text.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s?(k|rb|ribu|jt|juta)\b/i);
  let price: number | null = null;
  if (withCurrency) price = Number(withCurrency[1].replace(/[.,]/g, ""));
  else if (withSuffix) {
    const multiplier = /^(jt|juta)$/i.test(withSuffix[2]) ? 1_000_000 : 1_000;
    price = Number(withSuffix[1].replace(/[.,]/g, "")) * multiplier;
  }
  return { price, discount: percent ? Number(percent[1]) : null };
}

export function offersFromCards(cards: { heading: string; body: string }[]): OwnOffer[] {
  return cards
    .filter((c) => c.heading.trim())
    .map((c) => {
      const text = `${c.heading} ${c.body}`;
      const rule = OUTLET_RULES.find(([pattern]) => pattern.test(text));
      // Kartu tanpa nama outlet adalah penawaran resort secara umum.
      const outletKey: OutletKey = rule?.[1] ?? "resort";
      const category: PromoCategory = rule?.[2] ?? PROMO_CATEGORIES[0];
      return { outletKey, category, title: c.heading.trim(), description: c.body.trim(), ...offerNumbers(text) };
    });
}

const numberOrNull = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

interface OwnPromoEntry {
  outletKey: OutletKey;
  title: string;
  category: string;
  description: string;
  price: number | null;
  discount: number | null;
  startsAt: Date;
  endsAt: Date | null;
  sourceUrl: string | null;
}

/**
 * Simpan promo milik Sanghyang per (outlet, sumber, judul): yang baru dibuat, yang berubah diperbarui (OCC), dan bila
 * `expireMissing` promo sumber ini yang sudah tidak ada ditandai berakhir, tidak dihapus.
 */
async function upsertOwnPromos(entries: OwnPromoEntry[], source: string, capturedAt: Date, expireMissing: boolean) {
  const rows = await db.competitor.findMany({ where: { name: { in: OWN_COMPETITOR_NAMES } }, select: { id: true, name: true } });
  const idByOutlet = new Map(OWN_OUTLETS.map((o) => [o.outletKey, rows.find((r) => r.name === o.competitorName)?.id]));
  const existing = await db.competitorPromotion.findMany({
    where: { source, competitorId: { in: rows.map((r) => r.id) } },
    select: { id: true, competitorId: true, title: true, description: true, price: true, discount: true, status: true, version: true },
  });
  const result = { created: 0, updated: 0, expired: 0 };
  const seen = new Set<string>();
  for (const e of entries) {
    const competitorId = idByOutlet.get(e.outletKey);
    if (!competitorId) throw new Error(`Baris daftar outlet Sanghyang "${e.outletKey}" tidak ditemukan`);
    const key = `${competitorId}|${promoTitleKey(e.title)}`;
    seen.add(key);
    const kind = classifyPromoOrEvent({
      title: e.title,
      category: e.category,
      description: e.description,
      source,
      sourceUrl: e.sourceUrl,
      price: e.price,
      discount: e.discount,
    });
    const data = {
      category: e.category,
      description: e.description,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      price: e.price === null ? null : new Prisma.Decimal(e.price),
      discount: e.discount === null ? null : new Prisma.Decimal(e.discount),
      sourceUrl: e.sourceUrl,
      capturedAt,
      ...(kind ? { kind } : {}),
    };
    const old = existing.find((x) => `${x.competitorId}|${promoTitleKey(x.title)}` === key);
    if (!old) {
      await db.competitorPromotion.create({ data: { ...data, competitorId, title: e.title, source, status: PromotionStatus.new } });
      result.created++;
      continue;
    }
    const changed = old.description !== e.description || numberOrNull(old.price) !== e.price || numberOrNull(old.discount) !== e.discount;
    const res = await db.competitorPromotion.updateMany({
      where: { id: old.id, version: old.version },
      data: { ...data, status: changed || old.status === PromotionStatus.expired ? PromotionStatus.changed : old.status, version: { increment: 1 } },
    });
    if (res.count !== 1) throw new Error(`OCC conflict saat memperbarui promo "${old.title}"`);
    result.updated++;
  }
  if (expireMissing) {
    for (const old of existing) {
      if (seen.has(`${old.competitorId}|${promoTitleKey(old.title)}`) || old.status === PromotionStatus.expired) continue;
      const res = await db.competitorPromotion.updateMany({
        where: { id: old.id, version: old.version },
        data: { status: PromotionStatus.expired, endsAt: capturedAt, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new Error(`OCC conflict saat mengakhiri promo "${old.title}"`);
      result.expired++;
    }
  }
  return result;
}

/** Kartu penawaran di situs resmi Sanghyang; penawaran yang hilang dari situs ditandai berakhir. */
export async function scrapeOwnOffers(): Promise<{ offers: number; created: number; updated: number; expired: number }> {
  const { isCrawlAllowed, PROFILE_CRAWLER_UA } = await import("./official-pages");
  if (!(await isCrawlAllowed(OWN_OFFERS_URL))) throw new Error(`robots.txt melarang ${OWN_OFFERS_URL}`);
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(PROFILE_CRAWLER_UA);
    await page.goto(OWN_OFFERS_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector("[data-offer-card] [data-cms-field='heading']", { timeout: 20_000 });
    // Fungsi di dalam $$eval tidak diberi nama: tsx membungkusnya dengan helper __name yang tidak ada di peramban.
    const cards: { heading: string; body: string }[] = await page.$$eval("[data-offer-card]", (els) =>
      els.map((el) => ({
        heading: (el.querySelector("[data-cms-field='heading']")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        body: (el.querySelector("[data-cms-field='body']")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      })),
    );
    const offers = offersFromCards(cards);
    if (!offers.length) throw new Error("Halaman penawaran terbaca, tetapi tidak ada kartu penawaran");
    const now = new Date();
    const saved = await upsertOwnPromos(
      offers.map((o) => ({ ...o, startsAt: now, endsAt: null, sourceUrl: OWN_OFFERS_URL })),
      OWN_SITE_SOURCE,
      now,
      true,
    );
    return { offers: offers.length, ...saved };
  } finally {
    await browser.close();
  }
}

/** Program bulanan dari tim marketing, dengan status verifikasinya di deskripsi. */
export async function importTeamPromos(): Promise<{ items: number; created: number; updated: number; expired: number }> {
  const capturedAt = new Date(`${TEAM_PROMOS.checkedAt}T12:00:00+07:00`);
  const period = { start: new Date(`${TEAM_PROMOS.period.start}T00:00:00+07:00`), end: new Date(`${TEAM_PROMOS.period.end}T23:59:59+07:00`) };
  const saved = await upsertOwnPromos(
    TEAM_PROMOS.items.map((item) => ({
      outletKey: item.outlet,
      title: item.title,
      category: item.kind === "program" ? PROGRAM_CATEGORY : item.category,
      description: `${TEAM_PROMOS.source}. Verifikasi ${TEAM_PROMOS.checkedAt}: ${VERIFICATION_LABEL[item.verification.status]}. ${item.verification.note}`,
      price: item.price,
      discount: item.discount,
      startsAt: period.start,
      endsAt: period.end,
      sourceUrl: null,
    })),
    OWN_TEAM_SOURCE,
    capturedAt,
    true,
  );
  return { items: TEAM_PROMOS.items.length, ...saved };
}
