/**
 * Perbandingan harga outlet F&B, bar, dan spa Sanghyang dengan pesaing pembandingnya: rentang harga per kategori menu,
 * selisih harga item sebanding, serta filter pita jarak dan jenis pesaing. Dipakai Langkah 3 Insight Pasar dan halaman
 * Untuk Direksi. Modul ini tidak memuat berkas data menu supaya bisa dipakai komponen browser; item menu pesaing yang
 * lengkap dikirim route /api/market-intelligence/fnb-compare (fnb-compare-data.ts).
 */
import type { GalleryPhoto, PlaceGroup } from "./competitor-gallery";
import type { CompetitorMenuCard, MenuExclusion, PerPersonRange } from "./competitor-menu";
import { radiusBand } from "./hotel-compset";
import type { OfficialMenu } from "./menu-text";
import { OUTLET_KEYS, type OutletKey } from "./outlet-filters";
import type { BenchmarkCompetitorItem, MenuItemComparison } from "./pricing-rules";
import type { PlaceSpecs } from "./place-specs";

export type FnbOutletKey = Exclude<OutletKey, "resort">;
export const FNB_OUTLET_KEYS = OUTLET_KEYS.filter((k): k is FnbOutletKey => k !== "resort");
export const isFnbOutlet = (value: unknown): value is FnbOutletKey => FNB_OUTLET_KEYS.includes(value as FnbOutletKey);

export type MenuGroup = "makanan" | "minuman" | "paket" | "sewa-ruangan";
export type GroupFilter = MenuGroup | "all";
export const MENU_GROUP_LABEL: Record<MenuGroup, string> = {
  makanan: "Makanan",
  minuman: "Minuman",
  paket: "Paket",
  "sewa-ruangan": "Sewa ruangan",
};

export interface FnbItem {
  name: string;
  category: string | null;
  price: number;
  priceMax: number | null;
  /** null untuk harga per porsi atau per item; selain itu "per ons", "per kg", "per jam", atau "per orang". */
  unit: string | null;
  group: MenuGroup;
  /**
   * Tambahan dan biaya kemasan bukan item menu; paket promo berlaku sementara; paket untuk beberapa orang dan sewa ruang
   * bukan harga per porsi. Semuanya tidak masuk rentang dan perbandingan.
   */
  excluded: MenuExclusion | null;
}

const BUNDLE = /\bpaket\b|\bbundling\b|\bpackage\b/i;
const DRINK =
  /minuman|drinks?\b|beverage|coffee|kopi|espresso|latte|cappuc+ino|americano|\btea\b|\bteh\b|juice|\bjus\b|mocktail|mojito|milk ?shake|smoothie|squash|coconut|kelapa|\bsoda\b|\bcola\b|\bpunch\b|\bbeer\b|\bbir\b|cocktail|spirits?\b|whiske?y|liqueur|lequeur|aperitif|apperitif|\bwine\b|\balcohol\b|squeez|mineral|infused water/i;

/**
 * Kategori menu satu item. Judul bagian di menu sumbernya paling bisa dipercaya ("Coconut Jelly" di bagian DESSERT tetap
 * makanan); nama item hanya dipakai bila judul bagiannya tidak terbaca. Sewa ruangan karaoke dijual per jam.
 */
export function menuGroup(item: { name: string; category: string | null; unit: string | null }): MenuGroup {
  if (item.unit === "per jam") return "sewa-ruangan";
  if (BUNDLE.test(item.category ?? "") || BUNDLE.test(item.name)) return "paket";
  return DRINK.test(item.category ?? item.name) ? "minuman" : "makanan";
}

/** Item menu resmi Sanghyang; satuan "porsi" disamakan dengan harga per porsi pesaing (unit null). */
export function officialFnbItems(menu: OfficialMenu | null): FnbItem[] {
  return (menu?.items ?? []).map((i) => {
    const unit = i.unit === "porsi" ? null : i.unit;
    return { name: i.name, category: i.category, price: i.price, priceMax: null, unit, group: menuGroup({ name: i.name, category: i.category, unit }), excluded: null };
  });
}

const inGroup = (item: Pick<FnbItem, "group">, group: GroupFilter) => group === "all" || item.group === group;
/** Satuan harga yang dibandingkan: sewa ruangan per jam, selain itu per porsi atau per item. */
export const unitFor = (group: GroupFilter) => (group === "sewa-ruangan" ? "per jam" : null);

/** Rentang harga dalam kategori, tanpa item yang dikecualikan (`excluded`); sama dengan menuPriceRange untuk semua kategori. */
export function priceRange(items: FnbItem[], group: GroupFilter): { min: number; max: number } | null {
  const unit = unitFor(group);
  const priced = items.filter((i) => i.excluded === null && i.unit === unit && inGroup(i, group));
  if (!priced.length) return null;
  return { min: Math.min(...priced.map((i) => i.price)), max: Math.max(...priced.map((i) => i.priceMax ?? i.price)) };
}

/** Item bersumber dalam kategori, termasuk paket, sewa ruang, dan harga per ons; tambahan dan biaya kemasan tidak dihitung. */
export const itemCount = (items: FnbItem[], group: GroupFilter) => items.filter((i) => i.excluded !== "tambahan" && inGroup(i, group)).length;

export interface DishKind {
  key: string;
  label: string;
  pattern: RegExp;
  /** Jenis ikan: bila dijual bakar per berat, boleh dibandingkan dengan ikan bakar yang jenisnya tidak disebut. */
  fish?: true;
}

/**
 * Bahan utama hidangan di menu resmi Sanghyang, untuk mencari item sebanding di menu pesaing. Urutan penting: "nasi
 * goreng seafood" dihitung nasi goreng. Item resmi baru tanpa jenis di daftar ini tampil "Belum ada data" sampai
 * jenisnya ditambahkan.
 */
export const DISH_KINDS: DishKind[] = [
  { key: "nasi-goreng", label: "Nasi goreng", pattern: /\bnasi goreng\b|\bnasgor\b|\bfried rice\b/ },
  { key: "sop-buntut", label: "Sop buntut", pattern: /\bbuntut\b|\boxtail\b/ },
  { key: "soto-ayam", label: "Soto ayam", pattern: /\bsoto\b/ },
  { key: "kelapa", label: "Kelapa muda", pattern: /\bkelapa\b|\bcoconut\b/ },
  { key: "udang", label: "Udang", pattern: /\budang\b|\bshrimps?\b|\bprawns?\b/ },
  { key: "cumi", label: "Cumi", pattern: /\bcumi\b|\bsquids?\b|\bcalamari\b/ },
  { key: "kepiting", label: "Kepiting", pattern: /\bkepiting\b|\bcrabs?\b/ },
  { key: "kerapu", label: "Kerapu", pattern: /\bkerapu\b|\bgroupers?\b/, fish: true },
  { key: "kakap", label: "Kakap", pattern: /\bkakap\b|\bsnappers?\b/, fish: true },
  { key: "gurame", label: "Gurame", pattern: /\bgurameh?\b|\bgurami\b|\bgouram[iy]\b/, fish: true },
  { key: "ikan-kwe", label: "Ikan kwe", pattern: /\bikan (kwe|kue)\b/, fish: true },
];

export const dishKind = (name: string): DishKind | null => DISH_KINDS.find((k) => k.pattern.test(name.toLowerCase())) ?? null;

/** Ikan atau cumi asin adalah lauk awetan, bukan hidangan segar yang sebanding ("telur asin" adalah saus, tetap hidangan segar). */
const SALTED = /(?<!\btelur\s+)\basin\b/;
/** Hidangan berbasis nasi goreng, mi, atau pasta tidak dibandingkan dengan lauk utuh seperti sop buntut atau udang bakar. */
const FRIED_RICE = /\bnasi goreng\b|\bnasgor\b|\bfried rice\b/;
const PASTA_OR_NOODLE = /\bpasta\b|\bspaghetti\b|\bfettuc+ine\b|\bmie\b|\bmi\b|\bnoodles?\b/;
/** Judul bagian ikut dibaca: Kalani menulis "BAKAR" di bawah bagian "UDANG / Porsi". */
const itemText = (i: Pick<FnbItem, "name" | "category">) => `${i.category ?? ""} ${i.name}`.toLowerCase();
/** Harga tengah bila sumber mencantumkan rentang (foto menu berbeda atau tertulis "60K-70K"). */
const midPrice = (i: FnbItem) => (i.priceMax === null ? i.price : (i.price + i.priceMax) / 2);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const gap = (price: number, base: number) => ((price - base) / base) * 100;
/** Persen bulat; Math.round(-0,4) menghasilkan -0 yang tercetak "-0%". */
const roundPercent = (x: number) => Math.round(x) || 0;

/** Label padanan umum di web dan PDF (keputusan pemilik 22 Nov 2026, butir B2). */
export const GENERIC_MATCH_LABEL = "padanan umum: jenis ikan tidak disebut";
const FISH = /\bikan\b|\bfish\b/;
const GRILLED = /\bbakar\b|\bgrill(ed)?\b/;
/** Harga per berat bisa dibandingkan lintas jenis ikan; ukuran porsi ikan per porsi terlalu beragam untuk itu. */
const WEIGHT_UNITS = new Set(["per ons", "per kg"]);
/**
 * Kata yang boleh ada di nama item padanan umum: kata ikan, cara bakar, dan bumbu yang sudah dicek di data menu ("Ikan
 * bakar madu/manado" Kamalika). Kata lain bisa berupa nama jenis ikan (bawal, nila), jadi item itu tidak dipakai; "Belum
 * ada data" lebih jujur daripada padanan yang keliru.
 */
const GENERIC_FISH_WORDS = new Set(["ikan", "fish", "bakar", "grill", "grilled", "madu", "manado"]);
const words = (text: string) => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

/** Ikan Sanghyang yang dibakar dan dijual per berat, misalnya kakap dan kerapu bakar per ons di Sunset Grill. */
const acceptsGenericFish = (item: FnbItem, dish: DishKind) =>
  dish.fish === true && item.unit !== null && WEIGHT_UNITS.has(item.unit) && GRILLED.test(item.name.toLowerCase());

/** Ikan bakar kompetitor yang jenis ikannya tidak disebut, baik di nama item maupun di judul bagiannya. */
function isGenericGrilledFish(c: FnbItem): boolean {
  const text = itemText(c);
  if (!FISH.test(text) || !GRILLED.test(text)) return false;
  if (DISH_KINDS.some((k) => k.fish && k.pattern.test(text))) return false;
  return words(c.name).every((w) => GENERIC_FISH_WORDS.has(w));
}

export interface RivalMenu {
  name: string;
  /** Pembanding inti dihitung dalam rata-rata; acuan hanya ditampilkan. */
  core: boolean;
  items: FnbItem[];
}

export interface RivalMatch {
  rival: string;
  core: boolean;
  /** Nama item pesaing yang dibandingkan, supaya kecocokannya bisa diperiksa. */
  items: string[];
  /** Median harga item sebanding di menu pesaing ini. */
  price: number;
  /** Selisih terhadap harga Sanghyang; plus berarti pesaing lebih mahal. */
  gapPercent: number;
  /** true bila harganya dari padanan umum (ikan bakar per berat tanpa jenis ikan), selalu dicetak dengan GENERIC_MATCH_LABEL. */
  generic: boolean;
}

export interface ItemComparison {
  item: FnbItem;
  dish: DishKind | null;
  matches: RivalMatch[];
  /** Rata-rata harga pesaing inti yang punya item sebanding; null bila belum ada. */
  average: number | null;
  averageGapPercent: number | null;
}

/**
 * Item sebanding = bahan utama sama, satuan harga sama (per porsi dengan per porsi, per ons dengan per ons), dan kategori
 * menu sama, tanpa item yang dikecualikan (tambahan, paket promo, paket beberapa orang, sewa ruang). Cara masak boleh
 * berbeda; nama itemnya ikut ditampilkan. Ikan bakar per berat yang tidak punya pasangan sejenis di menu kompetitor boleh
 * dibandingkan dengan ikan bakar per berat yang jenisnya tidak disebut, ditandai `generic`.
 */
export function compareItems(own: FnbItem[], rivals: RivalMenu[]): ItemComparison[] {
  return own.map((item) => {
    const dish = dishKind(item.name);
    const matches: RivalMatch[] = !dish
      ? []
      : rivals.flatMap((rival) => {
          const comparable = rival.items.filter(
            (c) => c.excluded === null && c.unit === item.unit && c.group === item.group && !SALTED.test(itemText(c)),
          );
          const specific = comparable.filter((c) => {
            const text = itemText(c);
            if (!dish.pattern.test(text)) return false;
            if (dish.key !== "nasi-goreng" && (FRIED_RICE.test(text) || PASTA_OR_NOODLE.test(text))) return false;
            return true;
          });
          // Item yang menyebut jenis ikan yang sama selalu didahulukan; padanan umum hanya pengisi bila tidak ada.
          const generic = !specific.length && acceptsGenericFish(item, dish) ? comparable.filter(isGenericGrilledFish) : [];
          const hits = specific.length ? specific : generic;
          if (!hits.length) return [];
          const price = Math.round(median(hits.map(midPrice)));
          // "BAKAR" saja tidak terbaca tanpa judul bagiannya ("UDANG / Porsi", "IKAN").
          const named = specific.length ? dish.pattern : FISH;
          const labels = hits.map((h) => (named.test(h.name.toLowerCase()) ? h.name : `${h.name} (${h.category})`));
          return [
            { rival: rival.name, core: rival.core, items: labels, price, gapPercent: roundPercent(gap(price, item.price)), generic: !specific.length },
          ];
        });
    const core = matches.filter((m) => m.core);
    const average = core.length ? Math.round(core.reduce((sum, m) => sum + m.price, 0) / core.length) : null;
    return { item, dish, matches, average, averageGapPercent: average === null ? null : roundPercent(gap(average, item.price)) };
  });
}

/**
 * Rata-rata selisih harga item sebanding satu pesaing terhadap Sanghyang, dalam kategori terpilih. Padanan umum tidak
 * ikut, supaya ringkasan per kompetitor tetap dari item yang jenisnya sama; padanan umum tampil di tabel per item.
 */
export function rivalGap(comparisons: ItemComparison[], rival: string, group: GroupFilter): { percent: number; items: number } | null {
  const gaps = comparisons
    .filter((c) => inGroup(c.item, group))
    .flatMap((c) => c.matches.filter((m) => m.rival === rival && !m.generic).map((m) => gap(m.price, c.item.price)));
  return gaps.length ? { percent: roundPercent(gaps.reduce((a, b) => a + b, 0) / gaps.length), items: gaps.length } : null;
}

export type Placement = "hotel" | "mandiri";
export const PLACEMENT_LABEL: Record<Placement, string> = { hotel: "Di dalam hotel", mandiri: "Tempat mandiri" };

/** Data per pesaing dari route fnb-compare: hotel induk dan jenis tempat dari registri, foto galeri, item menu lengkap, dan spesifikasi fasilitas. */
export interface FnbRivalExtra {
  parentName: string | null;
  group: PlaceGroup;
  photos: GalleryPhoto[];
  /** null bila tempat ini belum ada di berkas data menu (sumber harganya belum diperiksa). */
  items: FnbItem[] | null;
  specs?: PlaceSpecs | null;
}

export interface FnbCompareData {
  outlet: FnbOutletKey;
  /** Foto Sanghyang yang terkait jenis outlet ini (restoran, bar, atau spa). */
  sanghyangPhotos: GalleryPhoto[];
  sanghyangSpecs?: PlaceSpecs | null;
  rivals: Record<string, FnbRivalExtra>;
  placeSpecsMap?: Record<string, PlaceSpecs>;
}

export interface CompareInput {
  own: {
    /** Nama outlet Sanghyang yang ditampilkan di baris pertama. */
    name: string;
    items: FnbItem[];
    rating: number | null;
    reviewCount: number | null;
    /** Halaman menu resmi; null bila outlet belum punya daftar harga di situs Sanghyang. */
    source: { label: string; url: string } | null;
    photos: GalleryPhoto[];
    specs?: PlaceSpecs | null;
  };
  /** Pembanding outlet dari summary (compsetAudit.used), urutan registri. */
  used: Pick<BenchmarkCompetitorItem, "name" | "roadKm" | "rating" | "reviewCount" | "compsetRole" | "mapsUrl">[];
  cards: Record<string, CompetitorMenuCard>;
  extras: Record<string, FnbRivalExtra>;
}

export interface CompareRow {
  name: string;
  sanghyang: boolean;
  core: boolean;
  parentName: string | null;
  placeGroup: PlaceGroup | null;
  /** null untuk baris Sanghyang dan pesaing yang belum terbaca registrinya. */
  placement: Placement | null;
  roadKm: number | null;
  band: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  range: { min: number; max: number } | null;
  perPerson: PerPersonRange | null;
  /** null = sumber harga tempat ini belum diperiksa. */
  itemCount: number | null;
  gap: { percent: number; items: number } | null;
  sources: { label: string; url: string }[];
  checked: string[];
  photos: GalleryPhoto[];
  specs?: PlaceSpecs | null;
}

export const rivalMenus = (input: Pick<CompareInput, "used" | "extras">): RivalMenu[] =>
  input.used.map((u) => ({ name: u.name, core: u.compsetRole !== "benchmark", items: input.extras[u.name]?.items ?? [] }));

/** Baris tabel pembanding: outlet Sanghyang lebih dulu, lalu pesaing sesuai urutan registri. */
export function buildCompareRows(input: CompareInput, group: GroupFilter): CompareRow[] {
  const comparisons = compareItems(input.own.items, rivalMenus(input));
  const own: CompareRow = {
    name: input.own.name,
    sanghyang: true,
    core: true,
    parentName: null,
    placeGroup: "own",
    placement: null,
    roadKm: null,
    band: null,
    rating: input.own.rating,
    reviewCount: input.own.reviewCount,
    mapsUrl: null,
    range: priceRange(input.own.items, group),
    perPerson: null,
    itemCount: itemCount(input.own.items, group),
    gap: null,
    sources: input.own.source ? [input.own.source] : [],
    checked: [],
    photos: input.own.photos,
    specs: input.own.specs ?? null,
  };
  const rivals = input.used.map((u): CompareRow => {
    const extra = input.extras[u.name];
    const card = input.cards[u.name];
    const items = extra?.items ?? null;
    return {
      name: u.name,
      sanghyang: false,
      core: u.compsetRole !== "benchmark",
      parentName: extra?.parentName ?? null,
      placeGroup: extra?.group ?? null,
      placement: extra ? (extra.parentName ? "hotel" : "mandiri") : null,
      roadKm: u.roadKm ?? null,
      band: u.roadKm == null ? null : radiusBand(u.roadKm),
      rating: u.rating ?? null,
      reviewCount: u.reviewCount ?? null,
      mapsUrl: u.mapsUrl ?? null,
      range: items ? priceRange(items, group) : null,
      perPerson: card?.perPerson ?? null,
      itemCount: items ? itemCount(items, group) : null,
      gap: rivalGap(comparisons, u.name, group),
      sources: card?.sources ?? [],
      checked: card?.checked ?? [],
      photos: extra?.photos ?? [],
      specs: extra?.specs ?? null,
    };
  });
  return [own, ...rivals];
}

/** Pita jarak yang punya pesaing, terdekat dulu; labelnya sama dengan tabel hotel (radiusBand). */
export function distanceBands(rows: CompareRow[]): string[] {
  const nearest = new Map<string, number>();
  for (const r of rows) {
    if (r.sanghyang || r.band === null || r.roadKm === null) continue;
    nearest.set(r.band, Math.min(nearest.get(r.band) ?? Infinity, r.roadKm));
  }
  return [...nearest.entries()].sort((a, b) => a[1] - b[1]).map(([band]) => band);
}

/** Kategori menu yang punya item di daftar ini, urut seperti MENU_GROUP_LABEL. */
export function presentGroups(lists: FnbItem[][]): MenuGroup[] {
  const present = new Set(lists.flat().filter((i) => i.excluded !== "tambahan").map((i) => i.group));
  return (Object.keys(MENU_GROUP_LABEL) as MenuGroup[]).filter((g) => present.has(g));
}

export interface RowFilter {
  band: string;
  placement: Placement | "all";
}

/** Baris Sanghyang selalu tampil sebagai acuan; pesaing disaring menurut pita jarak dan jenis tempat. */
export const filterRows = (rows: CompareRow[], filter: RowFilter) =>
  rows.filter((r) => r.sanghyang || ((filter.band === "all" || r.band === filter.band) && (filter.placement === "all" || r.placement === filter.placement)));

/** Isi harga pesaing pada baris menu summary dari item sebanding; hanya pesaing inti, sama dengan rata-rata di tabel. */
export function withComparisons(rows: MenuItemComparison[], comparisons: ItemComparison[]): MenuItemComparison[] {
  return rows.map((row) => {
    const found = comparisons.find((c) => c.item.name === row.itemName);
    if (!found) return row;
    return {
      ...row,
      competitorPrices: found.matches
        .filter((m) => m.core)
        .map((m) => ({
          competitorName: m.rival,
          price: m.price,
          differencePercent: m.gapPercent,
          note: m.generic ? `${m.items.join("; ")} · ${GENERIC_MATCH_LABEL}` : m.items.join("; "),
        })),
    };
  });
}
