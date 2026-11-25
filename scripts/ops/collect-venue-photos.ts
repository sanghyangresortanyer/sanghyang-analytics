/**
 * Foto restoran, bar, dan spa di dalam hotel pembanding dari situs resmi hotelnya, untuk Galeri Pesaing per outlet.
 * Sebuah foto dipakai hanya bila nama outletnya tertulis di alt, nama berkas, atau judul bagian tempat foto itu berada
 * (lib/market/venue-photos.ts). Gemini lalu memberi kategori dan keterangan dari isi foto serta menilai apakah foto itu
 * memperlihatkan outletnya (lib/market/competitor-visual-insights.ts), satu panggilan per outlet.
 * Hanya URL asli foto dan halaman sumbernya yang disimpan. Robots.txt dipatuhi dan perayap memperkenalkan diri.
 *
 *   PUPPETEER_NO_SANDBOX=1 node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/collect-venue-photos.ts [--apply] [nama outlet ...]
 *
 * Tanpa nama, semua outlet hotel diproses. Tanpa --apply hanya menampilkan foto yang cocok per outlet, tanpa memanggil
 * Gemini dan tanpa menulis berkas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { generateWithRetry, model } from "@/lib/gemini";
import { GROUP_LABEL, validateGallery, type GalleryPhoto, type PlaceGroup } from "@/lib/market/competitor-gallery";
import { applyVerdict, buildPhotoPrompt, insightFromReading, parsePhotoReading, type VisualInsight } from "@/lib/market/competitor-visual-insights";
import { registryPlaceIds } from "@/lib/market/gallery-outlets";
import { collectPageImages, isCrawlAllowed, isProfileSource, OUTLET_LINK, PROFILE_CRAWLER_UA, readOfficialPage } from "@/lib/market/official-pages";
import { pickVenueImages, venueKey, type PageImage } from "@/lib/market/venue-photos";

const GALLERY_FILE = "src/lib/market/competitor-gallery.data.json";
const INSIGHT_FILE = "src/lib/market/competitor-visual-insights.data.json";
const MAX_PHOTOS = 6;
/** Subhalaman restoran, bar, dan spa yang diikuti dari halaman utama hotel. */
const MAX_SUBPAGES = 4;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const VENUE_SOURCE = /\s*Foto outlet di dalam hotel dari situs resmi hotelnya \([^)]*\)\./;

type GalleryFile = { source: string; updatedAt: string; places: { placeId: string; photos: GalleryPhoto[] }[] };
type InsightFile = { readAt: string; model: string; insights: Record<string, VisualInsight> };

/** Halaman HTML yang bisa dibaca perayap; data llms.txt (.md, .json) tidak memuat foto. */
const isHtmlSource = (url: string | null): url is string => isProfileSource(url) && !/\.(md|json|txt)$/i.test(new URL(url).pathname);

async function download(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, { headers: { "User-Agent": PROFILE_CRAWLER_UA }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
  if (!res.ok || !mimeType.startsWith("image/")) throw new Error(`HTTP ${res.status} ${mimeType || "tanpa tipe"}`);
  return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const venues = await db.competitor.findMany({
    where: { active: true, parentId: { not: null }, placeId: { not: null }, ...(only.length ? { name: { in: only } } : {}) },
    select: { name: true, placeId: true, category: true, websiteUrl: true, parent: { select: { id: true, name: true, websiteUrl: true } } },
    orderBy: { name: "asc" },
  });
  const hotels = new Map<string, { name: string; websiteUrl: string | null; venues: typeof venues }>();
  for (const v of venues) {
    if (!v.parent) continue;
    const hotel = hotels.get(v.parent.id) ?? { name: v.parent.name, websiteUrl: v.parent.websiteUrl, venues: [] };
    hotel.venues.push(v);
    hotels.set(v.parent.id, hotel);
  }

  const gallery = JSON.parse(readFileSync(GALLERY_FILE, "utf8")) as GalleryFile;
  const insightFile = JSON.parse(readFileSync(INSIGHT_FILE, "utf8")) as InsightFile;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  const report: string[] = [];
  let saved = 0;
  let failures = 0;

  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=id-ID"] });
  try {
    for (const hotel of hotels.values()) {
      const start = [...new Set([...hotel.venues.map((v) => v.websiteUrl).filter(isHtmlSource), ...(isHtmlSource(hotel.websiteUrl) ? [hotel.websiteUrl] : [])])];
      if (!start.length) {
        report.push(`${hotel.name}: belum ada situs resmi di registri, outletnya dilewati`);
        continue;
      }
      const images: PageImage[] = [];
      const queue = [...start];
      const seen = new Set<string>();
      let subpages = 0;
      let pagesRead = 0;
      const page = await browser.newPage();
      await page.setUserAgent(PROFILE_CRAWLER_UA);
      await page.setViewport({ width: 1366, height: 900 });
      try {
        while (queue.length) {
          const url = queue.shift() as string;
          if (seen.has(url)) continue;
          seen.add(url);
          if (!(await isCrawlAllowed(url))) {
            report.push(`${hotel.name}: ${url} dilarang robots.txt`);
            continue;
          }
          const read = await readOfficialPage(page, url);
          seen.add(read.url);
          pagesRead++;
          images.push(...(await collectPageImages(page)));
          if (url === hotel.websiteUrl) {
            const sub = [...new Set(read.links.filter((l) => OUTLET_LINK.test(`${l.href} ${l.text}`)).map((l) => l.href))].filter((h) => !seen.has(h));
            const room = MAX_SUBPAGES - subpages;
            queue.push(...sub.slice(0, room));
            subpages += Math.min(room, sub.length);
          }
        }
      } catch (error) {
        failures++;
        report.push(`${hotel.name}: gagal membaca situs (${(error as Error).message.slice(0, 160)})`);
        continue;
      } finally {
        await page.close().catch(() => undefined); // ZERO-FALLBACK: tab yang frame-nya putus tidak bisa ditutup; browser ditutup di bawah.
      }

      const usedUrls = new Set(gallery.places.flatMap((p) => p.photos.map((ph) => ph.url)));
      for (const venue of hotel.venues) {
        const placeId = venue.placeId as string;
        const previous = new Set(gallery.places.find((p) => p.placeId === placeId)?.photos.map((ph) => ph.url) ?? []);
        const picked = pickVenueImages(images, venueKey(venue.name, hotel.name), MAX_PHOTOS).filter((i) => previous.has(i.url) || !usedUrls.has(i.url));
        if (!picked.length) {
          report.push(`${venue.name}: tidak ada foto yang menyebut nama outlet ini di ${pagesRead} halaman resmi`);
          continue;
        }
        if (!apply) {
          report.push(`${venue.name}: ${picked.length} foto cocok (${picked.map((i) => i.url.split("/").pop()?.slice(0, 40)).join(", ")})`);
          continue;
        }
        const loaded: { image: PageImage; data: { data: string; mimeType: string } }[] = [];
        for (const image of picked) {
          try {
            loaded.push({ image, data: await download(image.url) });
          } catch (error) {
            report.push(`${venue.name}: foto ${image.url} tidak bisa diunduh (${(error as Error).message})`);
          }
        }
        if (!loaded.length) continue;
        const group = (venue.category ?? "resto") as PlaceGroup;
        const res = await generateWithRetry({
          model: model(),
          contents: [
            {
              role: "user",
              parts: [{ text: buildPhotoPrompt(venue.name, GROUP_LABEL[group] ?? GROUP_LABEL.resto, loaded.length) }, ...loaded.map((x) => ({ inlineData: x.data }))],
            },
          ],
          config: { responseMimeType: "application/json", temperature: 0.1 },
        });
        const reading = parsePhotoReading(res.text ?? "", loaded.length);
        if (!reading) {
          failures++;
          report.push(`${venue.name}: jawaban Gemini bukan JSON, foto tidak disimpan`);
          continue;
        }
        // Foto yang tidak terbaca Gemini tidak disimpan: kategorinya tidak bisa ditebak. Foto yang terbaca tetapi tidak
        // memperlihatkan outlet itu disimpan beserta alasannya sebagai arsip dan tidak ditampilkan.
        const photos: GalleryPhoto[] = [...reading.photos].map(([n, read]) => {
          const photo: GalleryPhoto = {
            url: loaded[n - 1].image.url,
            category: read.category,
            caption: `${venue.name} - ${read.caption}`.slice(0, 120),
            outlet: venue.name,
            sourceType: "situs resmi",
            sourceUrl: loaded[n - 1].image.pageUrl,
            capturedAt: today,
          };
          applyVerdict(photo, read);
          return photo;
        });
        const entry = gallery.places.find((p) => p.placeId === placeId);
        const kept = (entry?.photos ?? []).filter((ph) => ph.sourceType !== "situs resmi");
        if (entry) entry.photos = [...kept, ...photos];
        else gallery.places.push({ placeId, photos });
        // Ringkasan hanya dari foto yang relevan; ringkasan lama tanpa pengganti dihapus.
        const insight = insightFromReading(reading, (n) => loaded[n - 1].image.url);
        if (insight) insightFile.insights[placeId] = insight;
        else delete insightFile.insights[placeId];
        photos.forEach((ph) => usedUrls.add(ph.url));
        saved += photos.length;
        report.push(`${venue.name}: ${photos.length}/${loaded.length} foto resmi tersimpan, ${photos.filter((p) => p.relevant).length} relevan`);
      }
    }
  } finally {
    await browser.close();
  }

  if (apply && saved) {
    const day = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
    gallery.source = `${gallery.source.replace(VENUE_SOURCE, "")} Foto outlet di dalam hotel dari situs resmi hotelnya (${day}).`;
    gallery.updatedAt = today;
    insightFile.readAt = today;
    insightFile.model = model();
    const problems = validateGallery(gallery, await registryPlaceIds());
    if (problems.length) throw new Error(`hasil tidak lolos validasi galeri:\n${problems.slice(0, 20).join("\n")}`);
    writeFileSync(GALLERY_FILE, `${JSON.stringify(gallery, null, 2)}\n`);
    writeFileSync(INSIGHT_FILE, `${JSON.stringify(insightFile, null, 2)}\n`);
  }
  console.log(report.join("\n"));
  console.log(`[foto-outlet-hotel] ${venues.length} outlet hotel diperiksa${apply ? `, ${saved} foto resmi disimpan` : "; uji kering, jalankan dengan --apply"}.`);
  if (failures) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[foto-outlet-hotel] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
