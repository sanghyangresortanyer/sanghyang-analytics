// Dashboard Sanghyang: halaman /sanghyang (Google Ads + GA4) dan /sosmed. Baca-saja.
// Desain dan token: docs/design/DESIGN.md. Setiap halaman dikumpulkan terpisah: satu sumber gagal tidak menjatuhkan halaman.
// Tidak ada laporan Telegram untuk Sanghyang (keputusan owner 18 Nov): pengingat dan pantauan harian tampil di halaman ini.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { GoogleAdsClient } from "./google-ads.ts";
import { googleAdsDailySection } from "./google-ads-daily.ts";
import { loadPeriod, monthlyPeriods, type PeriodData, totals } from "./sanghyang-monthly.ts";

const TZ = "Asia/Jakarta";

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };
/** watch = baris pantauan kemarin vs rata-rata 7 hari (lihat google-ads-daily.ts). */
export type SanghyangData = { current: PeriodData; previous: PeriodData; complete: boolean; watch: string[] };
export type SocialAccount = { platform: string; handle: string };
export type SocialData = {
  instagram: { brand: string; handle: string }[];
  tiktok: string[];
  facebookPages: string[];
  websites: string[];
  promo: { folder: string; title: string; source: string; images: string[] } | null;
};

async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function loadSanghyang(ads: GoogleAdsClient, env: Record<string, string | undefined>, now = new Date()): Promise<SanghyangData> {
  const periods = monthlyPeriods(undefined, now);
  const [current, previous, watch] = await Promise.all([
    loadPeriod(ads, env, periods.current),
    loadPeriod(ads, env, periods.previous),
    googleAdsDailySection(env, now),
  ]);
  return { current, previous, complete: periods.complete, watch };
}

/** Akun sosmed dari config/social-accounts.json (tanpa email login), plus folder tangkapan layar promosi terbaru. */
export function loadSocial(accountsFile: string, sosmedRoot: string): SocialData {
  const rows: SocialAccount[] = existsSync(accountsFile) ? JSON.parse(readFileSync(accountsFile, "utf8")) : [];
  const out: SocialData = { instagram: [], tiktok: [], facebookPages: [], websites: [], promo: null };
  for (const row of rows) {
    const p = String(row.platform ?? "").trim();
    const h = String(row.handle ?? "").trim();
    if (/@/.test(h) || /USERNAME|LOGIN/i.test(h) || p === "GENERAL") continue; // never show login e-mails
    if (p === "WEBSITE") out.websites.push(h);
    else if (p === "TIKTOK") out.tiktok.push(h);
    else if (/fan pages/i.test(h)) out.facebookPages.push(p);
    else if (/^[\w.]+$/.test(h)) out.instagram.push({ brand: p, handle: h });
  }
  if (existsSync(sosmedRoot)) {
    const folder = readdirSync(sosmedRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().at(-1);
    if (folder) {
      const dir = resolve(sosmedRoot, folder);
      const readme = existsSync(resolve(dir, "README.md")) ? readFileSync(resolve(dir, "README.md"), "utf8") : "";
      out.promo = {
        folder,
        title: readme.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? folder,
        source: readme.match(/^Sumber:\s*(.+)$/m)?.[1]?.trim() ?? "",
        images: readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort(),
      };
    }
  }
  return out;
}

/** Path of a promo image under sosmedRoot, or null when the request leaves that folder or is not an image. */
export function sosmedImagePath(sosmedRoot: string, rel: string): string | null {
  if (!/^[\w.-]+\/[\w.-]+\.(png|jpe?g|webp)$/i.test(rel) || rel.includes("..")) return null;
  const root = resolve(sosmedRoot);
  const full = resolve(root, rel);
  return full.startsWith(root + sep) && existsSync(full) ? full : null;
}

export type PageKey = "sanghyang" | "sosmed";
export type Fetched<T> = { section: Section<T>; at: Date };
export type PageSources = {
  sanghyang: (refresh?: boolean) => Promise<Fetched<SanghyangData>>;
  sosmed: (refresh?: boolean) => Promise<Fetched<SocialData>>;
};

/** Caches one source for ttlMs so reloading a page does not spend API quota; a failed load is not cached. */
export function cachedSection<T>(load: () => Promise<T>, ttlMs = 10 * 60_000, clock = () => Date.now()) {
  let last: { at: number; data: Promise<Fetched<T>> } | null = null;
  return (refresh = false): Promise<Fetched<T>> => {
    if (refresh || !last || clock() - last.at > ttlMs) {
      const at = clock();
      const entry = {
        at,
        data: section(load).then((s) => {
          if (!s.ok && last === entry) last = null;
          return { section: s, at: new Date(at) };
        }),
      };
      last = entry;
    }
    return last.data;
  };
}

// ---------------------------------------------------------------- render

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const rp = (v: number | null): string => (v === null ? "–" : `Rp${Math.round(v).toLocaleString("id-ID")}`);
const n0 = (v: number): string => Math.round(v).toLocaleString("id-ID");
const failed = (title: string, error: string, fix: string) =>
  `<article class="card span-12 error"><h3>${esc(title)} tidak terbaca</h3><p>${esc(error)}</p><p class="muted">${esc(fix)}</p></article>`;

/** Kartu pengingat (dari docs/reminders.json) di paling atas; baris pertama "PENGINGAT HARI INI" dibuang. */
function remindersCard(lines: string[]): string {
  const items = lines.filter((l) => l !== "PENGINGAT HARI INI");
  return items.length ? `<article class="card span-12 note reminder"><h3>Pengingat hari ini</h3><ul class="plain">${items.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></article>` : "";
}

/** Kartu pantauan kemarin vs rata-rata 7 hari; baris ⚠️ ditonjolkan. */
function watchCard(lines: string[]): string {
  if (!lines.length) return "";
  const [title, ...rest] = lines;
  return `<article class="card span-12 watch"><h3>${esc(title)}</h3><ul class="plain">${rest.map((l) => `<li${l.startsWith("⚠️") ? ' class="alert"' : ""}>${esc(l.replace(/^[•\s-]+/, ""))}</li>`).join("")}</ul></article>`;
}

function renderSanghyang(s: Section<SanghyangData>, reminders: string[]): string {
  if (!s.ok) return remindersCard(reminders) + failed("Data Google Ads / GA4", s.error, "Hubungi admin aplikasi: kunci Google perlu diperiksa.");
  const { current, previous, complete, watch } = s.data;
  const a = totals(current);
  const b = totals(previous);
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const p = (x: { since: string; until: string }) => `${day(x.since)} – ${day(x.until)}`;
  const versus = (x: number, y: number) => (y ? `${x >= y ? "+" : ""}${Math.round(((x - y) / y) * 100)}% vs bulan lalu (${n0(y)})` : "Bulan lalu: 0");
  const camps = current.campaigns
    .filter((c) => c.status === "ENABLED" || c.cost > 0)
    .map((c) => {
      const of = (names: string[]) => Math.round(current.conversions.filter((k) => k.campaign === c.name && names.includes(k.action)).reduce((t, k) => t + k.allConversions, 0));
      const chats = of(["Conversation started"]);
      const calls = of(["Klik untuk menelepon", "Calls from Smart Campaign Ads", "Smart campaign ad clicks to call", "Smart campaign map clicks to call"]);
      return `<article class="card span-4"><h3>${esc(c.name)}</h3><p class="muted small">${c.status === "ENABLED" ? "Aktif" : "Dijeda"} · anggaran ${rp(c.budgetPerDay)}/hari</p>
<dl class="stats"><div><dt>Chat</dt><dd>${n0(chats)}</dd></div><div><dt>Telepon</dt><dd>${n0(calls)}</dd></div><div><dt>Biaya</dt><dd>${rp(c.cost)}</dd></div><div><dt>Klik</dt><dd>${n0(c.clicks)}</dd></div></dl></article>`;
    })
    .join("");
  return `${remindersCard(reminders)}${watchCard(watch)}<article class="card span-6 lead sh"><h3>Orang menghubungi lewat iklan Google</h3><p class="big">${n0(a.adsContacts)}</p><p class="muted">Chat ${n0(a.chats)} + telepon ${n0(a.calls)} · ${esc(versus(a.adsContacts, b.adsContacts))}</p></article>
<article class="card span-3"><h3>Biaya per orang menghubungi</h3><p class="big">${rp(a.perAdsContact)}</p><p class="muted">Bulan lalu ${rp(b.perAdsContact)} · biaya iklan ${rp(a.cost)}</p></article>
<article class="card span-3"><h3>Dari website</h3><p class="big">${n0(a.waWeb + a.phoneWeb)}</p><p class="muted">Klik WA ${n0(a.waWeb)} + telepon ${n0(a.phoneWeb)} dari pengunjung iklan${b.webTracked ? "" : " · bulan lalu belum ada data"}</p></article>
${camps}
<article class="card span-6"><h3>Booking website</h3><p class="big">${n0(current.ga4.purchase.all)} <small>· ${rp(current.ga4.value.all)}</small></p><p class="muted">Dari iklan: ${n0(a.bookings)} (${rp(a.bookingValue)}). Booking lewat WA/telepon dicatat di Exely, tidak terlihat di sini.</p></article>
<article class="card span-6"><h3>Periode</h3><p>${esc(p(current.period))}${complete ? "" : " (bulan berjalan)"}</p><p class="muted">Dibanding ${esc(p(previous.period))}. Klik WA = tombol ditekan di website, belum tentu pesan terkirim.</p></article>`;
}

function renderSocial(s: Section<SocialData>): string {
  if (!s.ok) return failed("Data sosmed", s.error, "Hubungi admin aplikasi: daftar akun sosmed perlu diperiksa.");
  const d = s.data;
  const list = (items: string[]) => (items.length ? `<ul class="plain">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted">Belum terdaftar.</p>`);
  const promo = d.promo
    ? `<article class="card span-12"><h3>${esc(d.promo.title)}</h3>${d.promo.source ? `<p class="muted small">Sumber: ${esc(d.promo.source)}</p>` : ""}<div class="shots">${d.promo.images
        .map((f) => `<a href="/sosmed/${encodeURIComponent(d.promo!.folder)}/${encodeURIComponent(f)}" target="_blank" rel="noopener"><img src="/sosmed/${encodeURIComponent(d.promo!.folder)}/${encodeURIComponent(f)}" alt="${esc(f.replace(/\.\w+$/, "").replace(/[-_]/g, " "))}" loading="lazy"></a>`)
        .join("")}</div></article>`
    : "";
  return `<article class="card span-6 lead social"><h3>Instagram</h3><p class="big">${n0(d.instagram.length)} <small>akun</small></p>${list(d.instagram.map((i) => `@${i.handle} · ${i.brand}`))}</article>
<article class="card span-3"><h3>TikTok</h3><p class="big">${n0(d.tiktok.length)}</p>${list(d.tiktok.map((t) => `@${t}`))}</article>
<article class="card span-3"><h3>Halaman Facebook</h3><p class="big">${n0(d.facebookPages.length)}</p>${list(d.facebookPages)}</article>
<article class="card span-12 note"><h3>Angka sosmed belum otomatis</h3><p>Pengikut, jangkauan, dan hasil promosi Instagram/TikTok belum bisa ditarik otomatis. Sampai akses Meta milik Sanghyang disiapkan, angka diambil dari tangkapan layar tim sosmed (isi manual).</p></article>
${promo}`;
}

const CSS = `
/* Look A (owner, 24 Nov 2026): the same greys, black and lemon as the app. */
:root{--paper:#F3F5F6;--card:#FFFFFF;--ink:#17191C;--muted:#4F565D;--line:#D6DBE0;--sh:#17191C;--social:#3A4047;--ok:#14532D;--warn:#7A4E0A;--bad:#C62F1D;--lemon:#D5F34D}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums}
header{background:var(--card);border-bottom:1px solid var(--line)}
header>*{max-width:1240px;margin:0 auto;padding-left:16px;padding-right:16px}
.brand{margin:0 auto;padding-top:14px;font-size:13px;color:var(--muted);font-weight:600}
nav{display:flex;gap:4px;overflow-x:auto}
.tab{padding:10px 14px 12px;color:var(--muted);text-decoration:none;font-weight:600;border-bottom:3px solid transparent;white-space:nowrap}
.tab:hover{color:var(--ink)}.tab[aria-current=page]{color:var(--ink)}
.tab-sanghyang[aria-current=page]{border-color:var(--sh)}.tab-sosmed[aria-current=page]{border-color:var(--social)}
main{max-width:1240px;margin:0 auto;padding:0 16px 48px}
section{margin-top:24px}
.pagehead{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end;justify-content:space-between;margin-bottom:14px}
h1{font-size:24px;margin:0;display:flex;align-items:center;gap:10px}h1::before{content:"";width:12px;height:12px;border-radius:50%;background:var(--lemon);box-shadow:0 0 0 2px var(--ink)}
.lede{margin:4px 0 0;color:var(--muted);font-size:13px;max-width:70ch}
.actions{margin:0;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;font-size:13px;color:var(--muted)}.actions a{color:var(--ink)}
.button{background:var(--ink);color:#fff!important;text-decoration:none;padding:7px 14px;border-radius:999px;font-weight:600}
#sanghyang{--accent:var(--sh)}#sosmed{--accent:var(--social)}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 6px 16px -8px rgba(40,46,54,.18);padding:16px;min-width:0}
.card h3{font-size:13px;font-weight:600;margin:0 0 6px;color:var(--muted)}
.lead{border-radius:14px;border-top:4px solid var(--accent)}.lead h3{color:var(--ink)}
.span-12{grid-column:span 12}.span-6{grid-column:span 6}.span-4{grid-column:span 4}.span-3{grid-column:span 3}
.big{font-size:36px;font-weight:600;margin:0;line-height:1.15}.big small{font-size:15px;font-weight:400;color:var(--muted)}
.muted{color:var(--muted);margin:6px 0 0}.small{font-size:13px}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin:12px 0}.stats div{min-width:0}.stats dt{font-size:13px;color:var(--muted)}.stats dd{margin:0;font-size:18px;font-weight:600;overflow-wrap:anywhere}
.plain{list-style:none;padding:0;margin:10px 0 0;font-size:13px}.plain li{padding:4px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}
.watch .plain li.alert{color:var(--bad);font-weight:600}.reminder h3{color:var(--warn)}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:10px}.shots img{width:100%;aspect-ratio:9/16;object-fit:cover;object-position:top;border-radius:8px;border:1px solid var(--line);display:block}
.note{background:var(--paper)}.error{border-color:var(--bad)}.error h3{color:var(--bad)}
code{font-size:13px;background:var(--paper);padding:1px 4px;border-radius:4px}
a:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.tab:focus-visible{outline-offset:-2px}
@media (max-width:960px){.span-3,.span-4{grid-column:span 6}.span-6{grid-column:span 12}}
@media (max-width:600px){.grid{grid-template-columns:1fr}.span-3,.span-4,.span-6,.span-12{grid-column:1/-1}.big{font-size:30px}h1{font-size:21px}nav{overflow:visible;gap:0}.tab{flex:1;white-space:normal;text-align:center;padding:8px 6px 10px;font-size:14px;line-height:1.3}}
`;

const PAGES: Record<PageKey, { title: string; lede: string }> = {
  sanghyang: {
    title: "Sanghyang · Google Ads & website",
    lede: "Bulan ini dibanding tanggal yang sama bulan lalu. Orang menghubungi = chat WhatsApp + telepon dari iklan Google.",
  },
  sosmed: { title: "Sosmed Sanghyang", lede: "Akun yang terdaftar dan materi promosi terbaru dari tim sosmed." },
};

function shell(key: PageKey, at: Date, body: string): string {
  const page = PAGES[key];
  const time = at.toLocaleString("id-ID", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  // Shown inside Sanghyang Analytics Marketing tabs, which link the pages; this page carries no links to the others.
  const actions = `<a href="/${key}?refresh=1">Ambil ulang data</a>`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.title)} · Dashboard</title><link rel="icon" href="data:,"><style>${CSS}</style></head><body>
<main><section id="${key}" aria-labelledby="h-page"><div class="pagehead"><div><h1 id="h-page">${esc(page.title)}</h1><p class="lede">${esc(page.lede)}</p></div><p class="actions"><span>Data ${esc(time)} WIB</span>${actions}</p></div><div class="grid">${body}</div></section></main></body></html>`;
}

export const renderSanghyangPage = (f: Fetched<SanghyangData>, reminders: string[] = []): string => shell("sanghyang", f.at, renderSanghyang(f.section, reminders));
export const renderSosmedPage = (f: Fetched<SocialData>): string => shell("sosmed", f.at, renderSocial(f.section));

export function pageSources(deps: { googleAds: () => GoogleAdsClient; env: Record<string, string | undefined>; accountsFile: string; sosmedRoot: string }): PageSources {
  return {
    sanghyang: cachedSection(() => loadSanghyang(deps.googleAds(), deps.env)),
    sosmed: cachedSection(async () => loadSocial(deps.accountsFile, deps.sosmedRoot)),
  };
}
