/**
 * Foto restoran, bar, dan spa di dalam hotel pembanding dari situs resmi. Sebuah foto dipakai untuk satu outlet hanya
 * bila nama outlet itu tertulis di alt, nama berkas, atau judul bagian tempat foto berada, sehingga foto kolam, kamar,
 * atau lobi hotel tidak masuk ke galeri restoran. Pengambilan halamannya ada di scripts/ops/collect-venue-photos.ts.
 */

export interface PageImage {
  url: string;
  alt: string;
  /** Teks bagian terdekat yang membungkus foto; judul bagiannya ada di awal. */
  context: string;
  pageUrl: string;
  /** og:image halaman: gambar wakil halaman itu, jadi alamat halamannya ikut dicocokkan. */
  og: boolean;
}

/** Judul bagian biasanya di awal teks pembungkus; sisanya bisa menyebut outlet lain. */
const CONTEXT_HEAD = 80;
/** Kata yang tidak membedakan satu outlet dari yang lain. */
const GENERIC = new Set(
  "restaurant restoran resto dining cafe kafe bistro grill bar lounge pub spa pool the el la de del and dan by hotel resort".split(" "),
);
/** Kata pemandangan yang muncul di banyak foto; outlet yang namanya hanya kata ini harus tertulis lengkap. */
const COMMON_SCENERY = new Set("sunset beach ocean sea garden pool sky lagoon infinity blue view terrace".split(" "));

const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const fileWords = (url: string) => {
  const { pathname } = new URL(url);
  return normalize(decodeURIComponent(pathname.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, ""));
};

/** Nama outlet tanpa nama hotel induk di belakangnya: "El Patio Marbella" di Marbella Place menjadi "el patio". */
export function venueKey(venueName: string, parentName: string): string {
  const venue = normalize(venueName).split(" ");
  const parent = normalize(parentName).split(" ");
  for (let k = Math.min(venue.length - 1, parent.length); k > 0; k--) {
    if (venue.slice(-k).join(" ") === parent.slice(0, k).join(" ")) return venue.slice(0, -k).join(" ");
  }
  return venue.join(" ");
}

export function imageMatchesVenue(image: PageImage, key: string): boolean {
  const haystack = normalize(
    [image.alt, fileWords(image.url), image.context.slice(0, CONTEXT_HEAD), image.og ? new URL(image.pageUrl).pathname : ""].join(" "),
  );
  if (` ${haystack} `.includes(` ${key} `)) return true;
  const distinctive = key.split(" ").filter((w) => !GENERIC.has(w));
  if (!distinctive.length || distinctive.every((w) => COMMON_SCENERY.has(w))) return false;
  const words = new Set(haystack.split(" "));
  return distinctive.every((w) => words.has(w));
}

/** Nama berkas foto tanpa ekstensi dan akhiran ukuran ("El-Patio-Outdoor-1024x683.jpg" menjadi "el-patio-outdoor"). */
const photoStem = (url: string) =>
  decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[-_]\d+x\d+$/, "");

/**
 * Foto resmi yang sama sering dipakai ulang dalam ukuran atau folder lain, mis. banner "novus-jiva-daiva-spa.jpg" dan
 * kartu "facilities/daiva-spa.jpg". Dianggap sama bila nama berkasnya sama atau yang satu menjadi akhiran yang lain.
 */
function sameOfficialPhoto(a: string, b: string): boolean {
  const [x, y] = [photoStem(a), photoStem(b)];
  return x === y || x.endsWith(`-${y}`) || y.endsWith(`-${x}`) || x.endsWith(`_${y}`) || y.endsWith(`_${x}`);
}

/** Foto yang cocok untuk outlet, tanpa salinan slider atau foto yang sama dalam ukuran lain, paling banyak `max`. */
export function pickVenueImages(images: PageImage[], key: string, max: number): PageImage[] {
  const picked: PageImage[] = [];
  for (const image of images) {
    if (picked.length >= max || !imageMatchesVenue(image, key)) continue;
    if (picked.some((p) => p.url.split("?")[0] === image.url.split("?")[0] || sameOfficialPhoto(p.url, image.url))) continue;
    picked.push(image);
  }
  return picked;
}
