/**
 * Membaca isi foto Galeri Pesaing, satu panggilan model per tempat:
 * - setiap foto dinilai apakah memperlihatkan tempat usaha itu sendiri. Foto yang tidak (orang berpose, kendaraan, jalan,
 *   bangunan lain, acara pribadi, dokumen) tetap disimpan beserta alasannya sebagai arsip dan tidak ditampilkan;
 * - foto Google Maps diberi kategori & keterangan dari isinya; keterangan foto situs resmi dan nama kamar OTA dipertahankan;
 * - ringkasan gaya interior per tempat dibangun hanya dari foto yang relevan -> competitor-visual-insights.data.json.
 * Tanpa --places, semua tempat yang tampil di Galeri Pesaing dibaca; tempat arsip dilewati supaya kuota hemat.
 * Jalankan: node --env-file=.env.development.local node_modules/tsx/dist/cli.mjs scripts/ops/read-gallery-photos.ts [--places=id1,id2] [--dry]
 * Foto outlet di dalam hotel dikumpulkan scripts/ops/collect-venue-photos.ts dengan penilaian yang sama.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { GROUP_LABEL, validateGallery, type GalleryPhoto } from "@/lib/market/competitor-gallery";
import { applyVerdict, buildPhotoPrompt, insightFromReading, parsePhotoReading, type VisualInsight } from "@/lib/market/competitor-visual-insights";
import { generateWithRetry, model } from "@/lib/gemini";
import { groupFor, loadGalleryByOutlet, registryPlaceIds } from "@/lib/market/gallery-outlets";

const GALLERY_FILE = "src/lib/market/competitor-gallery.data.json";
const INSIGHT_FILE = "src/lib/market/competitor-visual-insights.data.json";
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Kalimat sumber yang tampil di halaman galeri; tanggalnya diganti setiap kali penilaian dijalankan. */
const RELEVANCE_SOURCE = /\s*Foto yang tidak memperlihatkan tempat usahanya disimpan sebagai arsip, tidak ditampilkan \(dinilai [^)]*\)\./;

type GalleryFile = { source: string; updatedAt: string; places: { placeId: string; photos: GalleryPhoto[] }[] };
type InsightFile = { readAt: string; model: string; insights: Record<string, VisualInsight> };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

async function download(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
  if (!res.ok || !mimeType.startsWith("image/")) throw new Error(`HTTP ${res.status} ${mimeType || "tanpa tipe"}`);
  return { data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType };
}

async function main() {
  const only = arg("places")?.split(",").filter(Boolean);
  const dry = process.argv.includes("--dry");
  const gallery = JSON.parse(readFileSync(GALLERY_FILE, "utf8")) as GalleryFile;
  const insightFile = JSON.parse(readFileSync(INSIGHT_FILE, "utf8")) as InsightFile;
  const registry = new Map(
    (await db.competitor.findMany({ where: { placeId: { not: null } }, select: { placeId: true, name: true, category: true } })).map((r) => [r.placeId as string, r]),
  );
  // Tempat yang tampil di Galeri Pesaing, termasuk hotel induk yang fotonya dipinjam outletnya.
  const shown = new Set(Object.values(await loadGalleryByOutlet()).flat().flatMap((p) => [p.placeId, p.photoPlaceId]));
  const failures: string[] = [];
  let calls = 0;
  let judged = 0;
  let archived = 0;

  for (const placeId of only ?? [...shown]) {
    const place = gallery.places.find((p) => p.placeId === placeId);
    const live = (place?.photos ?? []).flatMap((photo, index) => (photo.expired ? [] : [{ photo, index }]));
    if (!place || !live.length) {
      if (only) failures.push(`${placeId}: tidak punya foto hidup di data galeri`);
      continue;
    }
    const row = registry.get(placeId);
    if (!row) {
      failures.push(`${placeId}: tidak ada di registri pesaing`);
      continue;
    }
    const images: { index: number; image: { data: string; mimeType: string } }[] = [];
    for (const { photo, index } of live) {
      try {
        images.push({ index, image: await download(photo.url) });
      } catch (error) {
        failures.push(`${placeId}: foto ${index + 1} tidak bisa diunduh (${(error as Error).message})`);
      }
    }
    if (!images.length) continue;

    calls++;
    let answer: string;
    try {
      const kind = GROUP_LABEL[groupFor(row.category, placeId === "sanghyang")];
      const res = await generateWithRetry({
        model: model(),
        contents: [{ role: "user", parts: [{ text: buildPhotoPrompt(row.name, kind, images.length) }, ...images.map((x) => ({ inlineData: x.image }))] }],
        config: { responseMimeType: "application/json", temperature: 0.1 },
      });
      answer = res.text ?? "";
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      failures.push(`${placeId}: ${message.slice(0, 160)}`);
      if (/PerDay/i.test(message)) break; // jatah harian habis: tempat berikutnya pasti gagal juga
      continue;
    }
    const reading = parsePhotoReading(answer, images.length);
    if (!reading) {
      failures.push(`${placeId}: jawaban model bukan JSON`);
      continue;
    }

    const photoAt = (n: number) => place.photos[images[n - 1].index];
    for (const [n, verdict] of reading.photos) {
      const photo = photoAt(n);
      applyVerdict(photo, verdict);
      judged++;
      if (!verdict.relevant) {
        archived++;
        console.log(`  ${placeId} foto ${images[n - 1].index + 1} diarsipkan: ${verdict.reason}`);
      }
      if (photo.sourceType !== "Google Maps") continue; // keterangan situs resmi dan nama kamar OTA = data asli
      photo.category = verdict.category;
      photo.outlet = null; // label outlet lama tidak dicek terhadap isi foto
      photo.caption = `${row.name} - ${verdict.caption}`.slice(0, 120);
    }
    const missing = images.flatMap((x, k) => (reading.photos.has(k + 1) ? [] : [x.index + 1]));
    if (missing.length) failures.push(`${placeId}: foto ${missing.join(", ")} tidak dinilai, penilaian lamanya dipertahankan`);
    for (const problem of reading.problems) failures.push(`${placeId}: jawaban model dibuang sebagian (${problem})`);

    const insight = insightFromReading(reading, (n) => photoAt(n).url);
    // Ringkasan lama dihapus bila tidak ada pengganti: bisa jadi dibangun dari foto yang tidak relevan.
    if (insight) insightFile.insights[placeId] = insight;
    else delete insightFile.insights[placeId];
    const relevant = [...reading.photos.values()].filter((v) => v.relevant).length;
    console.log(`${placeId}: ${relevant}/${images.length} foto relevan; ${insight ? `ringkasan dari ${insight.photoCount} foto` : "tanpa ringkasan"}`);
  }

  const problems = validateGallery(gallery, await registryPlaceIds());
  if (problems.length) throw new Error(`hasil tidak lolos validasi galeri:\n${problems.slice(0, 20).join("\n")}`);
  if (!dry && calls) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const day = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
    gallery.source = `${gallery.source.replace(RELEVANCE_SOURCE, "")} Foto yang tidak memperlihatkan tempat usahanya disimpan sebagai arsip, tidak ditampilkan (dinilai ${day}).`;
    gallery.updatedAt = today;
    insightFile.readAt = today;
    insightFile.model = model();
    writeFileSync(GALLERY_FILE, `${JSON.stringify(gallery, null, 2)}\n`);
    writeFileSync(INSIGHT_FILE, `${JSON.stringify(insightFile, null, 2)}\n`);
  }
  console.log(`[galeri] ${calls} panggilan model; ${judged} foto dinilai, ${archived} diarsipkan karena tidak memperlihatkan tempat usahanya${dry ? "; uji kering, berkas tidak ditulis" : ""}.`);
  if (failures.length) {
    console.log(`Gagal:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[galeri] gagal:", (error as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
