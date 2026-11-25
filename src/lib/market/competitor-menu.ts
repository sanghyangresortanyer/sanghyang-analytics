/**
 * Harga menu pesaing F&B, bar, dan spa dari sumber yang bisa ditelusuri: toko daring resmi, situs resmi, buku menu
 * digital publik, unggahan resmi media sosial, liputan publik, dan foto menu unggahan pengguna di Google Maps
 * (scripts/ops/read-competitor-menus.ts).
 * Kisaran "per orang" di Google Maps adalah laporan pengguna, bukan daftar harga, jadi disimpan terpisah dari item.
 * Tempat tanpa harga mencatat sumber yang sudah diperiksa, supaya "Belum ada data" bisa dipertanggungjawabkan.
 */
import data from "./competitor-menu.data.json";
import { dateLabel, type MenuItemKind } from "./menu-format";

export type { MenuItemKind };

export type MenuSourceKind = "toko-daring" | "media-sosial" | "foto-maps" | "situs-resmi" | "dokumen-menu" | "liputan-publik";

export interface CompetitorMenuItem {
  name: string;
  category: string | null;
  price: number;
  /** Harga tertinggi bila foto menu yang berbeda mencantumkan harga berbeda untuk item yang sama. */
  priceMax: number | null;
  /** "per ons", "per kg", "per jam", atau "per orang"; null untuk harga per porsi atau per item. */
  unit: string | null;
  /**
   * Ditandai di berkas data setelah sumbernya diperiksa: paket untuk beberapa orang atau sewa ruang. Item ini tetap tampil
   * berlabel, tetapi tidak masuk kisaran per porsi, rata-rata, dan perbandingan per item.
   */
  kind?: MenuItemKind;
  /** Jumlah orang dalam paket-bersama bila sumbernya menyebut ("2 pax", "2 orang"). */
  pax?: number;
  /** Nomor urut foto sumber (mulai 1) tempat harga ini terbaca; hanya untuk item hasil baca foto menu. */
  photo?: number;
}

export interface MenuSource {
  kind: MenuSourceKind;
  label: string;
  url: string;
  capturedAt: string;
  /** URL foto menu yang dibaca; hanya untuk foto-maps. */
  photos?: string[];
}

export interface PerPersonRange {
  min: number;
  max: number;
  /** Jumlah pengguna yang melaporkan kisaran itu, bila Google Maps menampilkannya. */
  reporters: number | null;
  url: string;
  capturedAt: string;
}

export interface CompetitorMenu {
  items: CompetitorMenuItem[];
  sources: MenuSource[];
  perPerson: PerPersonRange | null;
  /** Sumber yang sudah diperiksa tanpa menghasilkan harga. */
  checked: string[];
  /** Koreksi nama hasil baca foto yang sudah dicek ke fotonya, diterapkan sebelum item digabung. */
  corrections?: { from: string; to: string; reason: string }[];
  /** Model Gemini dan tanggal pembacaan foto menu; null bila tidak ada foto yang dibaca. */
  readBy: { model: string; readAt: string } | null;
}

const MENUS = data.places as unknown as Record<string, CompetitorMenu>;

export function competitorMenu(name: string): CompetitorMenu | null {
  return MENUS[name] ?? null;
}

export function competitorMenuNames(): string[] {
  return Object.keys(MENUS);
}

export const menuSourceLabel = (s: MenuSource) => `${s.label}${s.photos?.length ? ` (${s.photos.length} foto)` : ""}, diambil ${dateLabel(s.capturedAt)}`;

/** Sumber yang dicetak hanya bila memang menghasilkan item; tempat tanpa item cukup menyebut yang sudah diperiksa. */
export const pricedSources = (menu: CompetitorMenu) => (menu.items.length ? menu.sources.map((s) => ({ label: menuSourceLabel(s), url: s.url })) : []);

/** Ringkasan menu satu pesaing untuk tampilan web; URL foto menu tidak ikut dikirim ke browser. */
export interface CompetitorMenuCard {
  name: string;
  /** false bila pesaing belum ada di berkas data, artinya sumber harganya belum diperiksa. */
  listed: boolean;
  itemCount: number;
  range: { min: number; max: number } | null;
  perPerson: PerPersonRange | null;
  sample: CompetitorMenuItem[];
  sources: { label: string; url: string }[];
  checked: string[];
}

/** Membersihkan keterangan sumber publik dari penyebutan nama alat teknis atau jargon registri. */
export function sanitizeMenuCheckedNote(note: string): string {
  return note
    .replace(/\b(?:diperiksa|crawl)\s+Crawl4AI\b/gi, "terakhir diperiksa")
    .replace(/\bCrawl4AI\b/gi, "")
    .replace(/\bPlaywright\b/gi, "")
    .replace(/\bRegistri\b/g, "Daftar kompetitor")
    .replace(/\bregistri\b/g, "daftar kompetitor")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function competitorMenuCards(
  names: string[],
  sampleSize: number,
  resolver: (name: string) => CompetitorMenu | null = competitorMenu,
): CompetitorMenuCard[] {
  return names.map((name) => {
    const menu = resolver(name);
    if (!menu) return { name, listed: false, itemCount: 0, range: null, perPerson: null, sample: [], sources: [], checked: [] };
    return {
      name,
      listed: true,
      itemCount: menu.items.length,
      range: menuPriceRange(menu.items),
      perPerson: menu.perPerson,
      sample: sampleItems(menu.items, sampleSize),
      sources: pricedSources(menu),
      checked: menu.checked.map(sanitizeMenuCheckedNote),
    };
  });
}

// Batas kewajaran harga satu item: di bawah Rp 1.000 hampir pasti angka ribuan yang belum dikalikan ("25" untuk 25.000),
// di atas Rp 10 juta bukan harga satu item menu.
const MIN_PRICE = 1_000;
const MAX_PRICE = 10_000_000;
/** Nama lebih panjang dari ini hampir pasti beberapa baris menu yang terbaca menjadi satu. */
const MAX_NAME = 120;

/** Kategori tambahan (es batu, susu kental manis, topping) dan biaya kemasan tidak dihitung sebagai harga menu. */
const ADDON_CATEGORY = /(^|[^\p{L}])(add\.?|add-?ons?|tambahan|extras?|toppings?|take ?away)([^\p{L}]|$)/iu;
/** Baris "Add saus 15K" atau "Tambahan nasi" di dalam kategori hidangan; "Extra Spicy Wings" tetap hidangan. */
const ADDON_NAME = /^(add|tambah(an)?)\b/i;
const FEE_NAME = /kemasan|packaging|service charge/i;

export function isAddon(item: Pick<CompetitorMenuItem, "name" | "category">): boolean {
  return ADDON_CATEGORY.test(item.category ?? "") || ADDON_NAME.test(item.name) || FEE_NAME.test(item.name);
}

/** Paket promo berlaku sementara dan sering belum termasuk pajak (++), jadi bukan patokan harga menu. */
export const isPromo = (item: Pick<CompetitorMenuItem, "category">) => /promo/i.test(item.category ?? "");

/** Item yang dihitung dalam kisaran: per porsi atau per item, bukan tambahan, paket promo, paket beberapa orang, atau sewa ruang. */
export const isCountedMenuItem = (i: CompetitorMenuItem) => !isAddon(i) && !isPromo(i) && i.unit === null && !i.kind;

/**
 * Alasan item tidak dihitung dalam kisaran dan perbandingan per item. Harga bersatuan (per ons, per jam) sudah dipisah
 * lewat `unit`, jadi sewa ruang per jam tetap dibandingkan dengan sewa per jam; yang dikecualikan di sini adalah paket
 * beberapa orang dan paket sewa ruang tanpa satuan, yang tanpa penanda akan terbaca sebagai harga per porsi.
 */
export type MenuExclusion = "tambahan" | "promo" | MenuItemKind;

export const menuExclusion = (i: Pick<CompetitorMenuItem, "name" | "category" | "kind" | "unit">): MenuExclusion | null =>
  isAddon(i) ? "tambahan" : isPromo(i) ? "promo" : i.kind && i.unit === null ? i.kind : null;

/**
 * Rentang harga per porsi atau per item (lihat `isCountedMenuItem`). Harga per ons, per kg, per jam, atau per orang tidak
 * sebanding dengan harga porsi ("Rp 10.000 per ons" bukan menu murah), begitu pula paket untuk beberapa orang dan sewa
 * ruang, jadi tidak ikut. Null bila tidak ada item yang dihitung.
 */
export function menuPriceRange(items: CompetitorMenuItem[]): { min: number; max: number } | null {
  const priced = items.filter(isCountedMenuItem);
  if (!priced.length) return null;
  return { min: Math.min(...priced.map((i) => i.price)), max: Math.max(...priced.map((i) => i.priceMax ?? i.price)) };
}

/** Contoh item untuk tabel laporan: bergilir dari tiap kategori sesuai urutan menu, tanpa tambahan. */
export function sampleItems(items: CompetitorMenuItem[], max: number): CompetitorMenuItem[] {
  const groups = new Map<string, CompetitorMenuItem[]>();
  for (const item of items) {
    if (isAddon(item)) continue;
    const key = item.category ?? "";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const out: CompetitorMenuItem[] = [];
  for (let round = 0; out.length < max; round++) {
    const picked = [...groups.values()].map((g) => g[round]).filter((i): i is CompetitorMenuItem => i !== undefined);
    if (!picked.length) break;
    out.push(...picked.slice(0, max - out.length));
  }
  return out;
}

// Satuan dicocokkan utuh: "persons" bukan "per ons", dan "per 2 jam" atau "1/2 kg" tidak boleh menjadi "per jam" atau
// "per kg" karena pengalinya hilang. Satuan per porsi atau per item menjadi null; selain daftar ini item ditolak.
const UNIT_PATTERNS: [RegExp, string | null][] = [
  [/^(per\s*|\/\s*)?(1\s*)?(ons|100\s*g(r|ram)?)$/, "per ons"],
  [/^(per\s*|\/\s*)?(1\s*)?(kg|kilo(gram)?)$/, "per kg"],
  [/^(per\s*|\/\s*)?(1\s*)?(jam|hour)$/, "per jam"],
  [/^(per\s*|\/\s*)?(orang|pax|person)$/, "per orang"],
  [/^(per\s*|\/\s*)?(porsi|portion|item|pcs|potong|gelas|glass|cup|botol|bottle|pitcher|paket|package|piring|mangkok|bakul|ekor|tusuk)?$/, null],
];

function normalizeUnit(unit: unknown): { unit: string | null } | { unknown: string } {
  if (unit === null || unit === undefined) return { unit: null };
  const text = String(unit).toLowerCase().replace(/\s+/g, " ").trim();
  if (text === "null") return { unit: null };
  const hit = UNIT_PATTERNS.find(([pattern]) => pattern.test(text));
  return hit ? { unit: hit[1] } : { unknown: text };
}

const oneSpace = (text: string) => text.replace(/\s+/g, " ").trim();
const nameKey = (name: string) => oneSpace(name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " "));

/** Judul bagian dibandingkan tanpa harga dan satuan yang ikut terbaca ("CUMI 60K/Porsi" sama dengan "CUMI / Porsi"). */
const categoryKey = (category: string | null) =>
  nameKey((category ?? "").replace(/\d+(?:[.,]\d+)?\s*k\b/gi, " ").replace(/\b(per\s*)?(porsi|ons|kg|potong|pcs)\b/gi, " "));
const sameCategory = (a: string | null, b: string | null) => categoryKey(a) === categoryKey(b);

/**
 * Validasi hasil baca foto menu: nama wajib ada, harga bilangan dalam batas kewajaran. Item yang sama (nama, kategori,
 * dan satuan sama) dari foto berbeda digabung; kategori kosong di satu foto dianggap sama dengan kategori yang terbaca
 * di foto lain. Bila harganya berbeda, keduanya disimpan sebagai rentang karena tanggal foto tidak diketahui dan tidak
 * ada dasar untuk memilih salah satunya. Nama sama di kategori berbeda (ruang "Small" di dua paket) tetap terpisah.
 */
export function normalizeMenuItems(raw: unknown): { items: CompetitorMenuItem[]; rejected: { name: string; reason: string }[] } {
  // Bentuk jawaban yang salah harus menghentikan pembacaan, bukan menjadi daftar kosong yang menimpa data lama.
  if (!Array.isArray(raw)) throw new Error(`Daftar item menu harus berupa array, diterima ${raw === null ? "null" : typeof raw}`);
  const items: CompetitorMenuItem[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const entry of raw) {
    const r = (entry ?? {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? oneSpace(r.name) : "";
    if (!name) {
      rejected.push({ name: "(tanpa nama)", reason: "nama item kosong" });
      continue;
    }
    if (name.length > MAX_NAME) {
      rejected.push({ name: `${name.slice(0, 40)}…`, reason: `nama lebih dari ${MAX_NAME} karakter` });
      continue;
    }
    if (typeof r.price !== "number" || !Number.isFinite(r.price)) {
      rejected.push({ name, reason: `harga bukan angka: ${String(r.price)}` });
      continue;
    }
    const price = Math.round(r.price);
    if (price < MIN_PRICE || price > MAX_PRICE) {
      rejected.push({ name, reason: `harga di luar batas wajar: ${price}` });
      continue;
    }
    // Rentang yang tertulis di menu ("12.000–15.000"); batas atas yang tidak masuk akal diabaikan, bukan ditebak.
    const upper = typeof r.priceMax === "number" && Number.isFinite(r.priceMax) ? Math.round(r.priceMax) : null;
    const priceMax = upper !== null && upper > price && upper <= MAX_PRICE ? upper : null;
    const parsedUnit = normalizeUnit(r.unit);
    if ("unknown" in parsedUnit) {
      rejected.push({ name, reason: `satuan tidak dikenal: ${parsedUnit.unknown}` });
      continue;
    }
    const unit = parsedUnit.unit;
    const category = typeof r.category === "string" && oneSpace(r.category) ? oneSpace(r.category) : null;
    // Nomor foto tempat harga terbaca, supaya harga bisa ditelusuri ke fotonya.
    const photo = typeof r.photo === "number" && Number.isInteger(r.photo) && r.photo > 0 ? r.photo : undefined;
    const twins = items.filter((i) => nameKey(i.name) === nameKey(name) && i.unit === unit);
    const prev = twins.find((i) => sameCategory(i.category, category)) ?? twins.find((i) => i.category === null || category === null);
    // Versi menu lain bisa memberi judul bagian berbeda untuk hidangan yang sama; harga yang persis sama berarti item yang
    // sama. Harga berbeda di judul berbeda tetap terpisah, karena bisa berupa paket berbeda (ruang "Small" di dua paket).
    if (!prev && twins.some((i) => i.price === price && i.priceMax === priceMax)) continue;
    if (!prev) {
      items.push({ name, category, price, priceMax, unit, ...(photo ? { photo } : {}) });
      continue;
    }
    const low = Math.min(prev.price, price);
    const high = Math.max(prev.priceMax ?? prev.price, priceMax ?? price);
    items[items.indexOf(prev)] = { ...prev, category: prev.category ?? category, price: low, priceMax: high > low ? high : null };
  }
  return { items, rejected };
}
