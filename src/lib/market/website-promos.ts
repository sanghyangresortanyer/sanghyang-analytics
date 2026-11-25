/**
 * Gemini membaca halaman promo/penawaran di situs resmi hotel pesaing dan menyimpannya sebagai promo atau event
 * terstruktur. Validasi sama dengan promo Instagram (parseExtraction), dan isi paket hanya diterima bila tertulis di
 * halaman. Penawaran yang sudah tersimpan (judul sama menurut sameOffer) diperbarui dari bacaan terbaru, bukan dilewati,
 * supaya kartu mengikuti isi situs saat tombol "Perbarui Semua Data" atau jadwal malam berjalan.
 */
import { stripLoneSurrogates } from "../text/safe-truncate";
import { OUR_VERSION_MARKER, parseExtraction, PROMO_ANALYST, PROMO_FIELD_RULES, PROMO_JSON_SHAPE, promoDayRange, type ExtractedPromo } from "./promo-extractor";
import { sameOffer } from "./promo-radar";

export const WEBSITE_SOURCE = "Situs resmi (dibaca Gemini)";
const OFFER_LINK = /promo|offer|penawaran|special|package|paket|deal/i;
const MAX_OFFER_PAGES = 2;
/**
 * Halaman penawaran hotel memuat banyak paket berurutan (Novus Jiva: 12.653 huruf). Batas lama 2.000 huruf memotong
 * isi paket kedua dan seterusnya, sehingga ringkasan AI mengisi sendiri yang tidak terbaca.
 */
const MAX_TEXT = 40_000;

/** Situs yang bisa dibaca; Instagram, linktree, dan Google Maps bukan situs resmi. */
export const isOfficialSite = (url: string | null) => Boolean(url) && !/instagram\.com|linktr\.ee|google\.com|sanghyang\.com/i.test(url!);

export function buildWebsitePrompt(competitor: string, pageText: string, today: Date): string {
  return `${PROMO_ANALYST}
Baca halaman situs resmi kompetitor berikut. Halaman bisa berisi BEBERAPA promo atau event; masing-masing punya bagian sendiri (judul, lalu isinya sampai judul berikutnya). Isi "details", "terms", tanggal, dan harga setiap butir HANYA dari bagiannya sendiri; jangan mencampur isi penawaran lain.
Daftar harga kamar biasa (tipe kamar + harga tanpa penawaran khusus) BUKAN promo. Promo jaringan global yang tidak khusus untuk hotel ini (mis. diskon seluruh dunia, promo kartu kredit lintas negara) BUKAN promo.

Kompetitor: ${competitor}
Tanggal baca: ${today.toISOString().slice(0, 10)}
Isi halaman:
${stripLoneSurrogates(pageText).slice(0, MAX_TEXT)}

Jawab HANYA JSON {"promos": [ ... ]}, setiap objek berbentuk:
${PROMO_JSON_SHAPE}
${PROMO_FIELD_RULES}
Masukkan hanya yang isPromo true. Tidak ada promo maupun event = {"promos": []}.`;
}

/** Pencocokan judul penawaran dipakai bersama radar promo; definisinya di promo-radar.ts. */
export { sameOffer };

/**
 * Setiap promo divalidasi sama ketatnya dengan promo Instagram; yang tidak lolos dibuang. `pageText` adalah teks halaman
 * yang dibaca AI, dipakai untuk menerima hanya isi paket yang benar-benar tertulis.
 */
export function parseWebsitePromos(raw: string, today: Date, pageText = ""): ExtractedPromo[] {
  let j: unknown;
  try {
    j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return [];
  }
  const list = Array.isArray(j) ? j : (j as { promos?: unknown })?.promos;
  if (!Array.isArray(list)) return [];
  return list.map((p) => parseExtraction(JSON.stringify({ isPromo: true, ...p }), today, pageText)).filter((p): p is ExtractedPromo => Boolean(p?.isPromo));
}

export type CompetitorWebsiteTarget = {
  id: string;
  name: string;
  websiteUrl: string | null;
  active?: boolean;
  parentId?: string | null;
};

export function filterActiveWebsiteTargets(competitors: CompetitorWebsiteTarget[]): CompetitorWebsiteTarget[] {
  const ordered = [...competitors].sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)));
  const activeOnly = ordered.filter(
    (c) => (c.active !== undefined ? Boolean(c.active) : true) && isOfficialSite(c.websiteUrl)
  );
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  return activeOnly.filter(
    (c, i) => activeOnly.findIndex((x) => host(x.websiteUrl!) === host(c.websiteUrl!)) === i
  );
}

export type CompetitorWebsiteDbClient = {
  competitor: {
    findMany(args: {
      where?: { active?: boolean; websiteUrl?: { not: null } };
      select?: { id?: boolean; name?: boolean; websiteUrl?: boolean; active?: boolean; parentId?: boolean };
      orderBy?: { createdAt?: "asc" | "desc" };
    }): Promise<CompetitorWebsiteTarget[]>;
  };
};

export async function getActiveCompetitorWebsites(
  client?: CompetitorWebsiteDbClient
): Promise<CompetitorWebsiteTarget[]> {
  const dbClient = client ?? (await import("../db")).db;
  const raw = await dbClient.competitor.findMany({
    where: { active: true, websiteUrl: { not: null } },
    select: { id: true, name: true, websiteUrl: true, active: true, parentId: true },
    orderBy: { createdAt: "asc" },
  });
  return filterActiveWebsiteTargets(raw);
}

export async function scrapeWebsitePromos(): Promise<{ sites: number; saved: number; updated: number; failures: string[] }> {
  const { db } = await import("../db");
  const { Prisma, PromotionStatus } = await import("@prisma/client");
  const { generateWithRetry, model } = await import("../gemini");
  const sites = await getActiveCompetitorWebsites(db);
  const result = { sites: sites.length, saved: 0, updated: 0, failures: [] as string[] };
  const { isCrawlAllowed, PROFILE_CRAWLER_UA, readOfficialPage } = await import("./official-pages");
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"] });
  try {
    for (const c of sites) {
      // Satu tab per situs: renderer yang mati di satu situs berat tidak ikut menggagalkan situs berikutnya.
      const page = await browser.newPage();
      // Identitas perayap jujur dan robots.txt dipatuhi, sama dengan pengumpul profil (official-pages.ts).
      await page.setUserAgent(PROFILE_CRAWLER_UA);
      try {
        if (!(await isCrawlAllowed(c.websiteUrl!))) {
          result.failures.push(`${c.name}: situs melarang perayap di robots.txt`);
          continue;
        }
        // Halaman dianggap siap saat teksnya tampil; "networkidle2" di situs hotel berat sering tidak pernah selesai.
        const pageOptions = { maxChars: MAX_TEXT, keepLines: true };
        const home = await readOfficialPage(page, c.websiteUrl!, pageOptions);
        const offerPages = [...new Set(home.links.filter((l) => OFFER_LINK.test(`${l.href} ${l.text}`)).map((l) => l.href))].slice(0, MAX_OFFER_PAGES);
        const today = new Date();
        const pagesToRead = offerPages.length ? offerPages : [home.url];
        for (const url of pagesToRead) {
          if (!(await isCrawlAllowed(url))) continue;
          const text = url === home.url ? home.text : (await readOfficialPage(page, url, pageOptions)).text;
          // Suhu 0: jenis promo/event dan isi paket harus sama pada setiap penyegaran, bukan berganti antar bacaan.
          const res = await generateWithRetry({ model: model(), contents: buildWebsitePrompt(c.name, text, today), config: { responseMimeType: "application/json", temperature: 0 } });
          for (const p of parseWebsitePromos(res.text ?? "", today, text)) {
            const days = promoDayRange(p.startsAt, p.endsAt);
            const data = {
              category: p.category,
              kind: p.kind,
              details: p.details,
              terms: p.terms,
              description: `${p.summary}${p.ourVersion ? `${OUR_VERSION_MARKER}${p.ourVersion}` : ""}`,
              startsAt: days.startsAt ?? today,
              endsAt: days.endsAt,
              price: p.price === null ? null : new Prisma.Decimal(p.price),
              discount: p.discountPercent === null ? null : new Prisma.Decimal(p.discountPercent),
              sourceUrl: url,
              capturedAt: today,
            };
            const known = await db.competitorPromotion.findMany({
              where: { competitorId: c.id, source: WEBSITE_SOURCE },
              select: { id: true, title: true, version: true, status: true, details: true, terms: true, startsAt: true, endsAt: true, price: true },
              orderBy: { capturedAt: "desc" },
            });
            const same = known.find((k) => sameOffer(k.title, p.title));
            if (!same) {
              await db.competitorPromotion.create({ data: { ...data, competitorId: c.id, title: p.title, source: WEBSITE_SOURCE, status: PromotionStatus.new } });
              result.saved++;
              continue;
            }
            // Judul lama dipertahankan supaya kartu tidak berganti nama; isi, tanggal, dan harga mengikuti bacaan terbaru.
            // Tanpa tanggal mulai tertulis, tanggal mulai sama dengan tanggal baca (konvensi startDateWritten di
            // promo-radar.ts), jadi pergeserannya bukan perubahan isi.
            const changed =
              same.details.join("\n") !== p.details.join("\n") ||
              same.terms.join("\n") !== p.terms.join("\n") ||
              (days.startsAt !== null && same.startsAt.getTime() !== days.startsAt.getTime()) ||
              (same.endsAt?.getTime() ?? null) !== (data.endsAt?.getTime() ?? null) ||
              (same.price === null ? null : Number(same.price)) !== p.price;
            const moved = await db.competitorPromotion.updateMany({
              where: { id: same.id, version: same.version },
              data: { ...data, status: changed ? PromotionStatus.changed : same.status, version: { increment: 1 } },
            });
            if (moved.count !== 1) throw new Error(`konflik versi saat memperbarui promo "${same.title}"`);
            result.updated++;
          }
        }
      } catch (error) {
        result.failures.push(`${c.name}: ${(error as Error).message.slice(0, 120)}`);
      } finally {
        // ZERO-FALLBACK: tab yang renderernya sudah mati tidak bisa ditutup lagi; galat situsnya sudah tercatat di atas.
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
  return result;
}
