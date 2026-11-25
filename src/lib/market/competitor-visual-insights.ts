/**
 * Gaya interior & suasana tiap tempat di Galeri Pesaing, dibaca dari foto galeri tempat itu sendiri
 * (scripts/ops/read-gallery-photos.ts). Versi lama ditulis tangan dan memuat klaim yang tidak terlihat di foto, jadi
 * diganti 10 Nov 2026. Sejak 15 Nov 2026 setiap foto juga dinilai apakah memperlihatkan tempat usahanya, karena foto
 * unggahan pengunjung Google Maps sering salah tempat. Ringkasan hanya dibangun dari foto yang relevan, dan daftar foto
 * sumbernya disimpan supaya bisa diperiksa sebelum ditampilkan.
 */
import data from "./competitor-visual-insights.data.json";
import { galleryPhotosOf, isShownPhoto, PHOTO_CATEGORIES, type GalleryPhoto, type PhotoCategory } from "./competitor-gallery";

export interface VisualInsight {
  designStyle: string;
  ambience: string;
  keyVisualElements: string[];
  materialsAndLighting: string;
  marketingOpportunity: string;
  /** Jumlah foto sumber ringkasan ini. */
  photoCount: number;
  /** URL foto sumbernya, semuanya foto yang relevan. Kosong pada ringkasan lama sebelum 15 Nov 2026 (tempat arsip). */
  photoUrls?: string[];
}

export const VISUAL_INSIGHTS_SOURCE = { readAt: data.readAt, model: data.model };

/** Ringkasan hanya ditampilkan bila semua foto sumbernya relevan dan masih tampil di galeri tempat itu. */
export function getVisualInsight(placeId: string): VisualInsight | null {
  const insight = (data.insights as Record<string, VisualInsight>)[placeId];
  if (!insight?.photoUrls?.length) return null;
  const shown = new Set(galleryPhotosOf(placeId).filter(isShownPhoto).map((p) => p.url));
  return insight.photoUrls.every((url) => shown.has(url)) ? insight : null;
}

export function buildPhotoPrompt(name: string, kind: string, count: number): string {
  return `Kamu melihat ${count} foto yang ditautkan ke "${name}" (${kind}) di Banten. Foto bernomor 1 sampai ${count} sesuai urutan. Foto unggahan pengunjung sering salah tempat, jadi nilai setiap foto sendiri-sendiri.

Untuk SETIAP foto tulis:
- "subject": subjek utama foto. Periksa berurutan dan pakai yang PERTAMA cocok:
  1. "orang": foto tentang orangnya: berpose atau menghadap kamera, swafoto, foto bersama, keluarga, bayi, atau satu orang yang memenuhi sebagian besar foto, walaupun ruangan, meja, atau bangunan tempat itu terlihat di latar.
  2. "acara": rapat, pertemuan, arisan, ulang tahun, atau acara lain yang menonjolkan pesertanya.
  3. "kendaraan": mobil, motor, atau kendaraan lain.
  4. "jalan": jalan raya, gang, atau lalu lintas.
  5. "dokumen": struk, nota, tiket, tangkapan layar, atau dokumen pihak lain.
  6. "bangunan-lain": bangunan, rumah, atau proyek konstruksi yang bukan tempat usaha itu.
  7. "pemandangan": alam, laut, atau langit tanpa bangunan, kursi, payung, atau area milik tempat itu.
  8. "menu": menu, daftar harga, atau paket harga milik tempat itu.
  9. "hidangan": makanan atau minuman yang disajikan.
  10. "tempat": bangunan atau tampak depan, interior, kamar, area makan, bar, atau fasilitas tempat itu (kolam, taman, ruang karaoke, ruang spa, pantai dengan kursi atau payungnya). Pengunjung yang duduk, makan, atau bersantai tanpa berpose ke kamera boleh terlihat selama area tempat itu tetap jelas.
  11. "tidak-jelas": isi foto tidak bisa dikenali.
- "category": "kamar" (kamar tidur, kamar mandi, ruang dalam unit), "fasilitas" (kolam, lobi, taman, gedung, pantai atau area luar milik tempat, ruang karaoke, ruang spa), "restoran-outlet" (area makan, bar, dapur, kasir, etalase), atau "lainnya" (makanan/minuman, menu, dan foto lain)
- "caption": maks 70 huruf, Bahasa Indonesia, HANYA yang terlihat di foto. Jangan menebak nama menu, harga, atau nama tempat lain.

Lalu "insight" tempat ini HANYA dari foto bersubjek "tempat", "hidangan", atau "menu", minimal satu foto "tempat", dan tulis nomor foto yang kamu pakai di "fromPhotos". Bila tidak ada foto bersubjek "tempat", isi "insight": null.
- "designStyle": maks 60 huruf
- "ambience": maks 100 huruf
- "keyVisualElements": 3-4 butir, tiap maks 90 huruf
- "materialsAndLighting": maks 160 huruf
- "marketingOpportunity": 1 kalimat maks 160 huruf, ide sudut foto atau konten yang bisa dipelajari tim marketing. JANGAN menyebut fasilitas Sanghyang.
Jangan menyebut apa pun yang tidak terlihat di foto (misalnya "satu-satunya", "terbaik", jarak, harga).

Jawab HANYA JSON: {"photos":[{"i":1,"subject":"...","category":"...","caption":"..."}],"insight":{"fromPhotos":[1],"designStyle":"...","ambience":"...","keyVisualElements":["..."],"materialsAndLighting":"...","marketingOpportunity":"..."}}`;
}

/**
 * Subjek utama foto, dipilih model dengan urutan di buildPhotoPrompt: foto yang menonjolkan orang atau acara tidak
 * relevan walaupun ruangan tempat itu terlihat di latar. Hanya "tempat", "hidangan", dan "menu" yang memperlihatkan
 * tempat usaha itu sendiri. Pertanyaan ya/tidak dicoba lebih dulu (15 Nov 2026) dan model menilai foto rapat serta foto
 * orang berpose di Star Queen relevan padahal keterangannya sendiri menyebut orang, jadi keputusannya kini diturunkan
 * dari subjek. Definisi "orang" dipersempit 16 Nov 2026 setelah area makan berpengunjung ikut diarsipkan.
 */
export const PHOTO_SUBJECTS = ["orang", "acara", "kendaraan", "jalan", "dokumen", "bangunan-lain", "pemandangan", "menu", "hidangan", "tempat", "tidak-jelas"] as const;
export type PhotoSubject = (typeof PHOTO_SUBJECTS)[number];
type ShownSubject = "tempat" | "hidangan" | "menu";
type OffTopicSubject = Exclude<PhotoSubject, ShownSubject>;
const isShownSubject = (s: PhotoSubject): s is ShownSubject => s === "tempat" || s === "hidangan" || s === "menu";

/** Alasan arsip per subjek, ditulis di kode supaya keputusan dan alasannya selalu sejalan. */
const OFF_TOPIC_REASON: Record<OffTopicSubject, string> = {
  orang: "Subjek utamanya orang yang berpose atau berfoto, bukan tempat usahanya",
  acara: "Foto rapat atau acara yang menonjolkan pesertanya, bukan tempat usahanya",
  kendaraan: "Subjek utamanya kendaraan, bukan tempat usahanya",
  jalan: "Subjek utamanya jalan, bukan tempat usahanya",
  dokumen: "Foto dokumen seperti struk, nota, tiket, atau tangkapan layar",
  "bangunan-lain": "Memperlihatkan bangunan atau proyek lain, bukan tempat usahanya",
  pemandangan: "Pemandangan tanpa bagian dari tempat usahanya",
  "tidak-jelas": "Isi foto tidak bisa dikenali",
};

/** Penilaian satu foto; foto yang tidak relevan selalu disertai alasan. */
export type PhotoVerdict = { category: PhotoCategory; caption: string } & (
  | { subject: ShownSubject; relevant: true; reason: null }
  | { subject: OffTopicSubject; relevant: false; reason: string }
);

type InsightText = Omit<VisualInsight, "photoCount" | "photoUrls">;

export interface PhotoReading {
  photos: Map<number, PhotoVerdict>;
  /** Ringkasan dari foto relevan saja; `fromPhotos` berisi nomor foto sumbernya pada panggilan itu. */
  insight: (InsightText & { fromPhotos: number[] }) | null;
  /** Bagian jawaban yang dibuang beserta alasannya, untuk laporan skrip. */
  problems: string[];
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

function readInsight(s: unknown, photos: Map<number, PhotoVerdict>, problems: string[]): PhotoReading["insight"] {
  // null berarti tidak ada foto relevan yang memperlihatkan ruang tempat itu; itu jawaban yang sah.
  if (s === null || s === undefined) return null;
  const o = s as Record<string, unknown>;
  const elements = Array.isArray(o.keyVisualElements) ? o.keyVisualElements.map((e) => text(e, 120)).filter((e): e is string => !!e) : [];
  const fields = {
    designStyle: text(o.designStyle, 80),
    ambience: text(o.ambience, 140),
    materialsAndLighting: text(o.materialsAndLighting, 220),
    marketingOpportunity: text(o.marketingOpportunity, 220),
  };
  if (!Object.values(fields).every(Boolean) || elements.length < 2) {
    problems.push("ringkasan tidak lengkap");
    return null;
  }
  const from = Array.isArray(o.fromPhotos) ? [...new Set(o.fromPhotos as unknown[])] : [];
  const unusable = from.filter((n) => photos.get(n as number)?.relevant !== true);
  if (!from.length || unusable.length) {
    problems.push(from.length ? `ringkasan memakai foto yang tidak relevan atau tidak dinilai: ${unusable.join(", ")}` : "ringkasan tanpa daftar foto sumber");
    return null;
  }
  if (!from.some((n) => photos.get(n as number)?.subject === "tempat")) {
    problems.push("ringkasan hanya dari foto hidangan atau menu, ruang tempat itu tidak terlihat");
    return null;
  }
  return { ...(fields as Record<keyof typeof fields, string>), keyVisualElements: elements.slice(0, 4), fromPhotos: from as number[] };
}

/**
 * Validasi ketat jawaban model: foto atau ringkasan yang tidak lolos dibuang (bukan ditebak) dan dicatat di `problems`.
 * Ringkasan ditolak bila memakai foto yang tidak relevan atau hanya foto hidangan dan menu. null bila JSON rusak.
 */
export function parsePhotoReading(raw: string, count: number): PhotoReading | null {
  let j: { photos?: unknown; insight?: unknown };
  try {
    j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const problems: string[] = [];
  const photos = new Map<number, PhotoVerdict>();
  for (const p of Array.isArray(j?.photos) ? (j.photos as Record<string, unknown>[]) : []) {
    const i = p?.i;
    const category = PHOTO_CATEGORIES.find((c) => c === p?.category);
    const caption = text(p?.caption, 90);
    const validNumber = Number.isInteger(i) && (i as number) >= 1 && (i as number) <= count;
    if (!validNumber || !category || !caption) {
      const invalid = [
        ...(validNumber ? [] : ["nomor"]),
        ...(category ? [] : [`kategori ${JSON.stringify(p?.category)}`]),
        ...(caption ? [] : [`keterangan ${JSON.stringify(p?.caption)?.slice(0, 100)}`]),
      ];
      problems.push(`foto ${String(i)}: ${invalid.join(", ")} tidak sah`);
      continue;
    }
    const subject = PHOTO_SUBJECTS.find((s) => s === p.subject);
    if (!subject) {
      problems.push(`foto ${String(i)}: subjek utama tidak sah (${String(p.subject)})`);
      continue;
    }
    photos.set(
      i as number,
      isShownSubject(subject)
        ? { category, caption, subject, relevant: true, reason: null }
        : { category, caption, subject, relevant: false, reason: OFF_TOPIC_REASON[subject] },
    );
  }
  return { photos, insight: readInsight(j?.insight, photos, problems), problems };
}

/** Simpan penilaian ke foto. Foto yang tidak relevan diarsipkan beserta alasannya, tidak dihapus. */
export function applyVerdict(photo: GalleryPhoto, verdict: PhotoVerdict): void {
  photo.relevant = verdict.relevant;
  if (verdict.relevant) delete photo.irrelevantReason;
  else photo.irrelevantReason = verdict.reason;
}

/** Ringkasan siap simpan beserta foto sumbernya; `urlOf(n)` memberi URL foto nomor n pada panggilan itu. */
export function insightFromReading(reading: PhotoReading, urlOf: (n: number) => string): VisualInsight | null {
  if (!reading.insight) return null;
  const { fromPhotos, ...fields } = reading.insight;
  const photoUrls = fromPhotos.map(urlOf);
  return { ...fields, photoCount: photoUrls.length, photoUrls };
}
