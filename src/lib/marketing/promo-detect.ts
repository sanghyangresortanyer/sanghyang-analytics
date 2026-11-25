// Audit Promo, automatic (owner, 24 Nov: "tiap tarik data dia bisa otomatis"): which Instagram posts carry an
// offer, for which menus of the VHP till. Read from the post TEXT only (photos are not read). Checked on 200
// real posts of 24 Nov 2026 (data/raw/instagram_api_20261124.json). An offer counts only when its sentence
// also names a menu sold in the till, so "free entry" or "free kiss" never becomes an audit.

export type VhpMenu = { outlet: string; description: string };
export type PromoPost = { id: string; caption?: string; timestamp: string; permalink: string; outlet_username: string };
export type PromoItem = { outlet: string; keyword: string; title: string };
export type DetectedPromo = { date: string; permalink: string; items: PromoItem[] };

/** Outlet names as stored in social_promo_events, the name in the till, and how posts refer to them. */
const OUTLETS = [
  { name: "d'Spa", till: "d'Spa", said: /d['’`]?\s?spa\b|#dspa|aquamedic|treatments?\b|sanghyang\s?massage/i },
  { name: "Dragon Beach Club (Indoor)", till: "d'Bar Karaoke & DBC", said: /dragon\s?beach\s?club|#?dragonbeachclub|\bdbc\b|d['’`]?\s?bar\b|karaoke/i },
  { name: "d'Bistro", till: "d'Bistro", said: /d['’`]?\s?bistro|#dbistro/i },
  { name: "Sunset Grill", till: "Sunset Grill", said: /sunset\s?grill/i },
] as const;

const OFFER =
  /(?:disk?on|disc(?:ount)?\.?)\s*(?:hingga|up to|s\/d)?\s*\d{1,2}\s*%|\d{1,2}\s*%\s*(?:off|disc|disk)|buy\s*\d+\s*(?:get|disc)|beli\s*\d+\s*(?:gratis|disk|disc|dapat)|\b(?:gratis|free)\s+(?!entry|park|parkir|tiket|masuk|wifi|live)\w+/i;
/** What is given away is not what is promoted: "Lobster gratis 2 Mocktails" → Lobster. */
const GIVEAWAY = /\b(?:gratis|free|bonus)\s+[^,.!?\n]*?(?=\s+(?:untuk|for|setiap|tiap)\b|[,.!?\n]|$)/gi;
/** Words posts use for a menu the till names differently. */
const SAME: Record<string, string> = { crab: "kepiting", crabs: "kepiting", cocktails: "cocktail", mocktails: "mocktail", lobsters: "lobster" };
/** Too general to point at a menu on their own. */
const STOP = new Set(
  "ayam ikan nasi goreng bakar saus asam manis pedas panas dingin besar kecil spesial special hari semua varian menu promo november desember oktober sunset grill seafood sanghyang indah resort hotspring hair spa single couple bottle dengan untuk yang dari saja gratis free item all alami segar enak paket package beach club dragon tequila vodka regal plata kerang ice with and fresh hangat rasa original royal classic premium party night malam member members disc disct diskon discount off buy beli get happy hour".split(" "),
);

/** "Herradura" = "HERADURA", "Grey Goose" = "GREYGOOSE", "Martell" = "MARTEL": letters and digits only, doubled letters once. */
const squeeze = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").replace(/([a-z])\1+/g, "$1");
const words = (s: string) => s.normalize("NFKD").match(/[A-Za-z0-9]+/g) ?? [];
const wibDate = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/** Every run of 1–3 words of the outlet's menu names, by its squeezed form → the words as the till writes them. */
function phrases(menus: VhpMenu[], till: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of menus) {
    // Tenths of a weighed dish and the till's own discount lines are not menus.
    if (m.outlet !== till || /^\(0[.,]1\s*ons\)/i.test(m.description) || /\bdisc/i.test(m.description)) continue;
    const w = words(m.description.replace(/^\(ons\)/i, "").replace(/\(\d+\s*m\)/gi, ""));
    for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) {
      const run = w.slice(i, i + n);
      const key = squeeze(run.join(""));
      if (key.length >= 4 && !out.has(key)) out.set(key, run.join(" "));
    }
  }
  return out;
}

function menusIn(sentence: string, till: string, menus: VhpMenu[]): string[] {
  const known = phrases(menus, till);
  const w = words(sentence).map((x) => SAME[x.toLowerCase()] ?? x);
  const used = new Array<boolean>(w.length).fill(false);
  const hits: { at: number; keyword: string }[] = [];
  for (let n = 3; n >= 1; n--) for (let i = 0; i + n <= w.length; i++) {
    if (used.slice(i, i + n).some(Boolean)) continue;
    const run = w.slice(i, i + n);
    // A run made only of general words, or starting/ending on one, says nothing about a menu.
    if (run.every((x) => STOP.has(x.toLowerCase()) || /^\d+$/.test(x))) continue;
    if (n === 1 && (run[0].length < 4 || STOP.has(run[0].toLowerCase()))) continue;
    const keyword = known.get(squeeze(run.join("")));
    if (!keyword) continue;
    used.fill(true, i, i + n);
    hits.push({ at: i, keyword });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.keyword);
}

/** The offer in a post, or null when the post makes none. `items` is empty when no till menu is named. */
export function detectPromo(post: PromoPost, menus: VhpMenu[]): DetectedPromo | null {
  const text = post.caption ?? "";
  const clean = text.replace(/#\w+/g, " ");
  // A sentence ends at . ! ? or a line break; "30%." and "PT.JMP" style dots are harmless here.
  const offers = clean.split(/[.!?]+(?=\s|$)|\n+/).map((s) => s.trim()).filter((s) => OFFER.test(s));
  if (offers.length === 0) return null;
  const items: PromoItem[] = [];
  const push = (outlet: string, keyword: string, title: string) => {
    if (!items.some((i) => i.outlet === outlet && i.keyword.toLowerCase() === keyword.toLowerCase())) items.push({ outlet, keyword, title });
  };
  for (const sentence of offers) {
    const own = OUTLETS.filter((o) => o.said.test(sentence));
    const whole = OUTLETS.filter((o) => o.said.test(text));
    const account = OUTLETS.filter((o) => squeeze(post.outlet_username).includes(squeeze(o.name.split(" ")[0] === "Dragon" ? "dragonbeach" : o.name)));
    const outlets = own.length ? own : whole.length ? whole : account;
    const promoted = sentence.replace(GIVEAWAY, " ").replace(/sunset\s?grill(\s?seafood)?|dragon\s?beach\s?club|sanghyang indah spa resort/gi, " ");
    const title = sentence.replace(/\s+/g, " ").slice(0, 140);
    for (const o of outlets) {
      if (o.name === "d'Spa" && /\ball\s+treatments?\b|semua\s+treatment/i.test(sentence)) push(o.name, "*", title);
      else for (const keyword of menusIn(promoted, o.till, menus)) push(o.name, keyword, title);
    }
  }
  return { date: wibDate(post.timestamp), permalink: post.permalink, items };
}

export type PromoEventKey = { source_post_id?: string | null; post_date: string; outlet_name: string; menu_keyword: string };
export type NewPromoEvent = PromoEventKey & { source_post_id: string; platform: "instagram"; promo_title: string; post_url: string };

/**
 * Events to add after a pull: one per promoted menu of a post, skipping what is already there (also the
 * ignored ones, so "Abaikan" stays). `unknown` = offers whose menu the till does not know.
 */
export function newPromoEvents(posts: PromoPost[], menus: VhpMenu[], have: PromoEventKey[], since: string): { events: NewPromoEvent[]; existing: number; unknown: DetectedPromo[]; promos: number } {
  const key = (e: PromoEventKey) => `${e.post_date}|${e.outlet_name}|${e.menu_keyword.toLowerCase()}`;
  const seen = new Set(have.map(key));
  const events: NewPromoEvent[] = [];
  const unknown: DetectedPromo[] = [];
  let existing = 0;
  let promos = 0;
  for (const post of posts) {
    const promo = detectPromo(post, menus);
    if (!promo || promo.date < since) continue;
    promos++;
    if (promo.items.length === 0) unknown.push(promo);
    for (const item of promo.items) {
      const e: NewPromoEvent = { source_post_id: post.id, platform: "instagram", post_date: promo.date, outlet_name: item.outlet, menu_keyword: item.keyword, promo_title: item.title, post_url: post.permalink };
      if (seen.has(key(e))) { existing++; continue; }
      seen.add(key(e));
      events.push(e);
    }
  }
  return { events, existing, unknown, promos };
}

/** The till's outlet name behind an outlet of the audit. */
export const tillOutlet = (name: string): string => OUTLETS.find((o) => o.name === name)?.till ?? name;
