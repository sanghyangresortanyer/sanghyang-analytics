import type { NodeKind } from "@/lib/knowledge-graph/types";

// Colours of the 3D map, as theme tokens (docs/design/DESIGN.md: --color-era-ink behind the map, node colours here).
// Twenty kinds cannot get twenty colours that people tell apart, so kinds share five groups and the legend, tooltip,
// side panel and table name the kind. Sky and pink pass the dataviz palette check against --color-era-ink in dark mode
// for every pair, colour-blind vision included (27 Nov 2026). Lemon sits brighter than that band on purpose: it is the
// Tampilan A highlight, and Sanghyang's own data is what the map is read around. Red and green stay out, they mean
// down and up elsewhere in the app.
const SANGHYANG = "--color-lemon";
const COMPETITOR = "--color-sky-500";
const PRODUCT = "--color-pink-500";
const MARKET = "--color-navy-300";
const RETIRED = "--color-navy-500";

export const KIND_TOKEN: Record<NodeKind, string> = {
  outlet: SANGHYANG,
  kamar: SANGHYANG,
  "promo-sanghyang": SANGHYANG,
  "event-sanghyang": SANGHYANG,
  operasional: SANGHYANG,
  strategi: SANGHYANG,
  pesaing: COMPETITOR,
  acuan: COMPETITOR,
  promo: COMPETITOR,
  event: COMPETITOR,
  menu: PRODUCT,
  fasilitas: PRODUCT,
  visual: PRODUCT,
  sosmed: PRODUCT,
  tema: MARKET,
  berita: MARKET,
  statistik: MARKET,
  kawasan: MARKET,
  sumber: MARKET,
  dikeluarkan: RETIRED,
};

/** What each colour means, in the order of the legend under the map. */
export const COLOR_GROUPS: readonly { token: string; label: string }[] = [
  { token: SANGHYANG, label: "Milik Sanghyang: outlet, kamar, promo, event, sinyal VHP, strategi" },
  { token: COMPETITOR, label: "Kompetitor beserta promo dan event-nya" },
  { token: PRODUCT, label: "Menu, fasilitas, galeri, dan media sosial" },
  { token: MARKET, label: "Ulasan tamu, berita, tarif, kawasan, dan sumber data" },
  { token: RETIRED, label: "Kompetitor yang dikeluarkan" },
];

/** Map background (scoped alias set by the page), the dimmed nodes, and the links. */
export const GRAPH_TOKENS = {
  background: "--color-era-ink",
  dimNode: "--color-navy-700",
  link: "--color-navy-400",
  linkActive: "--color-lemon",
} as const;
