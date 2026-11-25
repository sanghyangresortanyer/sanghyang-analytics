// Laporan mingguan siap cetak, mengikuti Template_Laporan_Mingguan_Google_Ads_Analytics.pdf.
// Google Ads + GA4 untuk Sanghyang Indah Spa Resort. Baca-saja; dibuat saat owner meminta.
// Aturan kejujuran (.agents/skills/ads/references/audit-guardrails.md): angka yang tidak tersedia = null ("diisi manual"),
// klik halaman booking dan rute Maps tidak dihitung sebagai kontak.
import { type Ga4Summary, type Ga4Traffic, ga4Summary, ga4Traffic } from "./ga4.ts";
import { type CampaignRow, type ConversionRow, campaignReport, conversionsByAction, type GoogleAdsClient } from "./google-ads.ts";
import { addDays, todayIn } from "./metrics.ts";

export type Period = { since: string; until: string };
type Fmt = "int" | "rp" | "pct" | "dec";
/** null = tidak ada data ("–"); bila `manual`, null berarti belum diisi admin/tim sales ("diisi manual"). */
/** better: arah yang baik ("up" = naik itu baik, "down" = turun itu baik); kosong = netral, bukan baik/buruk. */
export type ReportRow = { metric: string; sub?: string; prev: number | null; curr: number | null; fmt: Fmt; note: string; total?: boolean; manual?: boolean; better?: "up" | "down"; /** angka persen: perubahannya dalam poin (28,3% → 32,0% = +3,7 poin), bukan persen */ points?: boolean; /** teks bila angka kosong, mis. "Belum ada data" */ empty?: string };
export type ReportGroup = { title: string; source: string; rows: ReportRow[] };
export type DetailTable = { title: string; head: string[]; rows: string[][]; note?: string; /** tampil di layar, tidak ikut PDF */ screenOnly?: boolean; /** jumlah kolom teks di kiri (rata kiri); bawaan 1 */ textCols?: number; /** tampil paling akhir, sebelum kesimpulan (pemilik, 24 Nov) */ last?: boolean };
export type WeeklyReport = {
  kind: "google";
  title: string;
  subtitle: string;
  business: string;
  url: string;
  period: Period;
  previous: Period;
  /** Penjelasan rentang, mis. "sejak iklan mulai tayang". */
  periodNote?: string;
  /** periode ini memuat hari ini (belum lengkap) */
  partial?: boolean;
  /** Judul kolom pembanding dan periode laporan; bawaan "Periode lalu" / "Periode ini". */
  labels?: { prev: string; curr: string };
  kpis: { label: string; value: string; sub: string }[];
  groups: ReportGroup[];
  details: DetailTable[];
  /** Sorotan otomatis; dicetak di terminal, tidak di PDF (owner menghapus bagian evaluasi 17 Nov). */
  highlights: string[];
  limits: string[];
};

/** Pekan Senin–Minggu terakhir yang sudah selesai (WIB), atau 7 hari mulai `since`. Pembanding = 7 hari sebelumnya. */
export function weekPeriods(since?: string, now = new Date(), timezone = "Asia/Jakarta"): { current: Period; previous: Period } {
  const today = todayIn(timezone, now);
  let start = since;
  if (start !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("--since must be YYYY-MM-DD");
  } else {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Minggu
    start = addDays(today, -((dow + 6) % 7) - 7); // Senin pekan lalu
  }
  const until = addDays(start, 6);
  if (until >= today) throw new Error(`pekan ${start} s/d ${until} belum selesai; pilih --since yang berakhir sebelum ${today}`);
  return { current: { since: start, until }, previous: { since: addDays(start, -7), until: addDays(start, -1) } };
}

export type ReportRange = { since?: string; until?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayCount = (p: Period) => Math.round((Date.parse(p.until) - Date.parse(p.since)) / 86_400_000) + 1;

/** Rentang pilihan owner (dari–sampai). Pembanding = jumlah hari yang sama tepat sebelumnya. */
export function rangePeriods(since: string, until: string, now = new Date(), timezone = "Asia/Jakarta"): { current: Period; previous: Period; partialToday: boolean } {
  if (!DATE.test(since) || !DATE.test(until)) throw new Error("tanggal harus berformat YYYY-MM-DD");
  if (since > until) throw new Error("tanggal mulai harus sebelum atau sama dengan tanggal sampai");
  const today = todayIn(timezone, now);
  if (until > today) throw new Error(`tanggal sampai tidak boleh melewati hari ini (${today})`);
  const days = dayCount({ since, until });
  if (days > 92) throw new Error("rentang maksimal 92 hari");
  return { current: { since, until }, previous: { since: addDays(since, -days), until: addDays(since, -1) }, partialToday: until === today };
}

/** Periode pilihan owner: dari–sampai, atau 7 hari mulai `since`. null = pakai bawaan tiap platform. */
export function chosenPeriods(range: ReportRange, now = new Date()): { current: Period; previous: Period; note?: string; partial?: boolean } | null {
  if (range.until && !range.since) throw new Error("isi juga tanggal mulai");
  if (range.since && range.until) {
    const r = rangePeriods(range.since, range.until, now);
    return { current: r.current, previous: r.previous, partial: r.partialToday, note: r.partialToday ? "Rentang pilihan sampai hari ini; hari ini belum lengkap dan angkanya masih bisa bertambah" : "Rentang tanggal pilihan" };
  }
  if (range.since) return weekPeriods(range.since, now);
  return null;
}

/** Google's names for what counts as a contact or a route (one list for every report). */
export const CHAT = ["Conversation started"];
export const CALL = ["Klik untuk menelepon", "Calls from Smart Campaign Ads", "Smart campaign ad clicks to call", "Smart campaign map clicks to call"];
export const MAPS = ["Tindakan lokal - Rute"];
const sumActions = (conv: ConversionRow[], names: string[], campaign?: string) =>
  Math.round(conv.filter((c) => names.includes(c.action) && (!campaign || c.campaign === campaign)).reduce((s, c) => s + c.allConversions, 0));

// ------------------------------------------------------------------ Google Ads + GA4 (Sanghyang)

export type GoogleWeek = { period: Period; campaigns: CampaignRow[]; conversions: ConversionRow[]; ga4: Ga4Summary; traffic: Ga4Traffic };

export async function loadGoogleWeek(ads: GoogleAdsClient, env: Record<string, string | undefined>, period: Period, fetchImpl: typeof fetch = fetch): Promise<GoogleWeek> {
  const [campaigns, conversions, ga4, traffic] = await Promise.all([
    campaignReport(ads, period.since, period.until),
    conversionsByAction(ads, period.since, period.until),
    ga4Summary(env, period.since, period.until, fetchImpl),
    ga4Traffic(env, period.since, period.until, fetchImpl),
  ]);
  return { period, campaigns, conversions, ga4, traffic };
}

export function googleNumbers(w: Pick<GoogleWeek, "campaigns" | "conversions" | "ga4">) {
  const cost = w.campaigns.reduce((s, c) => s + c.cost, 0);
  const impressions = w.campaigns.reduce((s, c) => s + c.impressions, 0);
  const clicks = w.campaigns.reduce((s, c) => s + c.clicks, 0);
  const chats = sumActions(w.conversions, CHAT);
  const calls = sumActions(w.conversions, CALL);
  const web = w.ga4.whatsapp.ads + w.ga4.phone.ads;
  const contacts = chats + calls + web;
  return {
    cost,
    impressions,
    clicks,
    ctr: impressions ? (clicks / impressions) * 100 : null,
    cpc: clicks ? cost / clicks : null,
    chats,
    calls,
    web,
    webTracked: w.ga4.whatsapp.all + w.ga4.phone.all > 0,
    contacts,
    perContact: contacts ? cost / contacts : null,
    bookingPage: sumActions(w.conversions, ["Booking"]),
    maps: sumActions(w.conversions, MAPS),
  };
}

export function googleWeeklyReport(curr: GoogleWeek, prev: GoogleWeek): WeeklyReport {
  const a = googleNumbers(curr);
  const b = googleNumbers(prev);
  const budget = curr.campaigns.filter((c) => c.status === "ENABLED").reduce((s, c) => s + c.budgetPerDay, 0);
  const share = curr.traffic.users ? Math.round((curr.traffic.adsUsers / curr.traffic.users) * 100) : 0;
  const perCampaign = curr.campaigns
    .filter((c) => c.cost > 0 || c.status === "ENABLED")
    .map((c) => {
      const contacts = sumActions(curr.conversions, CHAT, c.name) + sumActions(curr.conversions, CALL, c.name);
      return { c, contacts, per: contacts ? c.cost / contacts : null };
    });
  const best = perCampaign.filter((x) => x.per !== null).sort((x, y) => (x.per ?? 0) - (y.per ?? 0))[0];
  const highlights = [
    trend("Kontak nyata dari iklan (chat + telepon Google + klik WA/telepon website)", a.contacts, b.contacts, b.webTracked === a.webTracked),
    trend("Biaya per klik", a.cpc, b.cpc, true, true),
    best ? `Kampanye paling efisien: ${best.c.name}, ${best.contacts} kontak dengan biaya ${rp(best.per)} per kontak.` : "",
    a.bookingPage > 0 && curr.ga4.purchase.ads === 0
      ? `Klik halaman booking tercatat ${a.bookingPage}, tetapi booking website dari iklan 0: sinyal "Booking" di Google Ads belum mencerminkan booking nyata.`
      : "",
  ].filter(Boolean);
  return {
    kind: "google",
    title: "Laporan mingguan Google Ads",
    subtitle: "Pengunjung website, hasil iklan, dan calon tamu yang menghubungi",
    business: "Sanghyang Indah Spa Resort",
    url: "sanghyang.com · Google Ads 793-128-8995 · GA4 216046044",
    period: curr.period,
    previous: prev.period,
    kpis: [
      { label: "Total biaya iklan", value: rp(a.cost), sub: "Biaya Google Ads periode ini" },
      { label: "Pengunjung website", value: n(curr.traffic.users), sub: "Dari semua sumber" },
      { label: "Orang menghubungi", value: n(a.contacts), sub: "Chat WA + telepon dari iklan dan website" },
      { label: "Biaya per orang menghubungi", value: rp(a.perContact), sub: "Biaya iklan ÷ orang menghubungi" },
    ],
    groups: [
      {
        title: "1. Pengunjung website",
        source: "Google Analytics",
        rows: [
          { better: "up", metric: "Pengunjung website", sub: "semua sumber", prev: prev.traffic.users, curr: curr.traffic.users, fmt: "int", note: "Jumlah orang, bukan jumlah kunjungan" },
          { better: "up", metric: "Pengunjung dari iklan Google", prev: prev.traffic.adsUsers, curr: curr.traffic.adsUsers, fmt: "int", note: `${share}% dari semua pengunjung` },
          { better: "up", metric: "Pengunjung yang benar-benar membaca", sub: "semua sumber", prev: prev.traffic.engagementRate * 100, curr: curr.traffic.engagementRate * 100, fmt: "pct", note: `Pengunjung dari iklan: ${pct(curr.traffic.adsEngagementRate * 100)}` },
        ],
      },
      {
        title: "2. Hasil iklan",
        source: "Google Ads",
        rows: [
          { better: "up", metric: "Iklan tampil", prev: b.impressions, curr: a.impressions, fmt: "int", note: "Berapa kali iklan muncul" },
          { better: "up", metric: "Klik iklan", prev: b.clicks, curr: a.clicks, fmt: "int", note: "Termasuk klik di Google Maps dan YouTube" },
          { better: "up", metric: "Persen yang klik", sub: "klik ÷ iklan tampil", prev: b.ctr, curr: a.ctr, fmt: "pct", note: "Makin tinggi, iklan makin menarik" },
          { better: "down", metric: "Biaya per klik", prev: b.cpc, curr: a.cpc, fmt: "rp", note: "Makin kecil makin hemat" },
          { metric: "Total biaya iklan", prev: b.cost, curr: a.cost, fmt: "rp", note: `Anggaran aktif ${rp(budget)}/hari (≈ ${rp(budget * dayCount(curr.period))} untuk ${dayCount(curr.period)} hari)` },
        ],
      },
      {
        title: "3. Calon tamu yang menghubungi",
        source: "Google Ads + Google Analytics",
        rows: [
          { better: "up", metric: "Chat WhatsApp dari iklan", prev: b.chats, curr: a.chats, fmt: "int", note: "Dicatat Google Ads" },
          { better: "up", metric: "Telepon dari iklan", prev: b.calls, curr: a.calls, fmt: "int", note: "Google Ads" },
          { better: "up", metric: "Klik WA / telepon di website", sub: "pengunjung dari iklan", prev: b.webTracked ? b.web : null, curr: a.webTracked ? a.web : null, fmt: "int", note: "Tombol ditekan, belum tentu pesan terkirim" },
          { better: "up", metric: "Total orang menghubungi", prev: b.contacts, curr: a.contacts, fmt: "int", note: "Calon tamu yang menghubungi", total: true },
          { better: "down", metric: "Biaya per orang menghubungi", prev: b.perContact, curr: a.perContact, fmt: "rp", note: "Biaya iklan ÷ orang menghubungi" },
          { metric: "Buka halaman booking", sub: "belum tentu jadi booking", prev: b.bookingPage, curr: a.bookingPage, fmt: "int", note: "Tidak dihitung sebagai orang menghubungi" },
          { better: "up", metric: "Minta rute ke hotel di Google Maps", sub: "dari iklan", prev: b.maps, curr: a.maps, fmt: "int", note: "Potensi walk-in, belum tentu datang" },
        ],
      },
      {
        title: "4. Booking",
        source: "Website & admin",
        rows: [
          { better: "up", metric: "Booking website", sub: "semua sumber", prev: prev.ga4.purchase.all, curr: curr.ga4.purchase.all, fmt: "int", note: `Nilai ${rp(curr.ga4.value.all)}` },
          { better: "up", metric: "Booking website dari iklan", prev: prev.ga4.purchase.ads, curr: curr.ga4.purchase.ads, fmt: "int", note: `Nilai ${rp(curr.ga4.value.ads)}` },
          { better: "up", metric: "Total booking semua sumber", prev: null, curr: null, fmt: "int", note: "Diisi manual oleh admin dari Exely", manual: true },
        ],
      },
    ],
    details: [
      {
      title: "Rincian per kampanye",
      head: ["Kampanye", "Anggaran/hari", "Biaya", "Klik", "Chat", "Telepon", "Biaya per orang menghubungi"],
      rows: perCampaign.map(({ c, per }) => [c.name, rp(c.budgetPerDay), rp(c.cost), n(c.clicks), n(sumActions(curr.conversions, CHAT, c.name)), n(sumActions(curr.conversions, CALL, c.name)), rp(per)]),
      note: "Biaya per orang menghubungi per kampanye hanya dari chat + telepon yang dicatat Google; klik WA/telepon di website tidak bisa dipisah per kampanye. Kampanye Local store visits mengejar orang yang minta rute di Maps, bukan chat.",
      },
    ],
    highlights,
    limits: [
      "Google mencatat chat dan telepon pada tanggal orang klik iklan, jadi angka beberapa hari terakhir masih bisa bertambah.",
      "Klik WA/telepon di website diambil dari Google Analytics saja supaya tidak terhitung dua kali.",
      "Booking lewat WhatsApp/telepon dicatat di Exely dan tidak terlihat di Google Ads maupun Google Analytics.",
    ],
  };
}

// ------------------------------------------------------------------ render (siap cetak A4)

const rp = (v: number | null): string => (v === null ? "–" : `Rp${Math.round(v).toLocaleString("id-ID")}`);
const n = (v: number): string => Math.round(v).toLocaleString("id-ID");
const pct = (v: number): string => `${v.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const dec = (v: number): string => v.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const cell = (v: number | null, f: Fmt, manual = false, empty?: string): string => (v === null ? (empty ?? (manual ? "diisi manual" : "–")) : f === "rp" ? rp(v) : f === "pct" ? pct(v) : f === "dec" ? dec(v) : n(v));

/** Perubahan + arti: ▲/▼ arah, lalu membaik / memburuk / netral menurut `better` baris. */
export function change(prev: number | null, curr: number | null, better?: "up" | "down"): { text: string; verdict: string; tone: "good" | "bad" | "neutral" } {
  if (prev === null || curr === null) return { text: "–", verdict: "", tone: "neutral" };
  if (prev === 0) return curr === 0 ? { text: "0%", verdict: "tetap", tone: "neutral" } : { text: "baru", verdict: "pembanding 0", tone: "neutral" };
  const d = Math.round(((curr - prev) / prev) * 100);
  if (d === 0) return { text: "0%", verdict: "tetap", tone: "neutral" };
  const text = `${d > 0 ? "▲ +" : "▼ "}${d}%`;
  if (!better) return { text, verdict: `${d > 0 ? "naik" : "turun"}, netral`, tone: "neutral" };
  const good = better === "up" ? d > 0 : d < 0;
  return { text, verdict: good ? "membaik" : "memburuk", tone: good ? "good" : "bad" };
}

/** Change between two percentages, in points: 28,3% → 32,0% is +3,7 poin. */
export function changePoints(prev: number | null, curr: number | null, better?: "up" | "down"): ReturnType<typeof change> {
  if (prev === null || curr === null) return { text: "–", verdict: "", tone: "neutral" };
  const d = Math.round((curr - prev) * 10) / 10;
  if (d === 0) return { text: "0 poin", verdict: "tetap", tone: "neutral" };
  const text = `${d > 0 ? "▲ +" : "▼ "}${d.toLocaleString("id-ID")} poin`;
  if (!better) return { text, verdict: `${d > 0 ? "naik" : "turun"}, netral`, tone: "neutral" };
  const good = better === "up" ? d > 0 : d < 0;
  return { text, verdict: good ? "membaik" : "memburuk", tone: good ? "good" : "bad" };
}

export function trend(label: string, curr: number | null, prev: number | null, comparable: boolean, lowerIsBetter = false): string {
  if (curr === null) return "";
  const fmt = (v: number) => (label.startsWith("Biaya") ? rp(v) : n(v));
  if (!comparable || prev === null) return `${label}: ${fmt(curr)} periode ini.`;
  if (prev === 0) return `${label}: ${fmt(curr)} (periode lalu 0).`;
  const d = Math.round(((curr - prev) / prev) * 100);
  if (d === 0) return `${label} sama dengan periode lalu: ${fmt(curr)}.`;
  const better = lowerIsBetter ? d < 0 : d > 0;
  return `${label} ${d > 0 ? "naik" : "turun"} ${Math.abs(d)}% (${better ? "membaik" : "memburuk"}): ${fmt(prev)} → ${fmt(curr)}.`;
}

const tanggal = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const CSS = `
@page{size:A4;margin:9mm 9mm}
/* Look A (owner, 24 Nov 2026): black headings, grey bands, up dark green, down red. */
:root{--navy:#17191C;--ink:#17191C;--muted:#4F565D;--line:#D6DBE0;--band:#EEF0F2;--total:#E7F1EA;--green:#14532D;--red:#C62F1D;--lemon:#D5F34D}
*{box-sizing:border-box}body{margin:0;color:var(--ink);font:12.5px/1.45 "Segoe UI",Arial,Helvetica,sans-serif;background:#fff;font-variant-numeric:tabular-nums}
.page{max-width:820px;margin:0 auto;padding:24px 16px}
.page+.page{border-top:6px solid var(--band)}
h1{color:var(--navy);font-size:22px;margin:0;letter-spacing:.2px}.sub{color:var(--muted);margin:4px 0 14px}
.meta{width:100%;border-collapse:collapse;margin-bottom:14px}.meta td{border:1px solid var(--line);padding:7px 10px;vertical-align:top}.meta td:nth-child(odd){font-weight:600;background:#F3F5F6;width:17%}
hr{border:0;border-top:3px solid var(--navy);margin:0 0 14px}
h2{font-size:14px;color:var(--navy);background:var(--band);border-left:5px solid var(--lemon);padding:8px 12px;margin:18px 0 10px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line)}.kpi{padding:10px 12px;border-right:1px solid var(--line)}.kpi:last-child{border-right:0}
.kpi .l{font-size:11px;font-weight:600;color:var(--muted)}.kpi .v{font-size:19px;font-weight:700;margin:6px 0;padding-bottom:6px;border-bottom:1px dashed var(--line);overflow-wrap:anywhere}.kpi .s{font-size:11px;color:var(--muted)}
table.main,table.detail{width:100%;border-collapse:collapse}table.main th,table.main td,table.detail th,table.detail td{border:1px solid var(--line);padding:7px 8px;vertical-align:top}
thead th{background:var(--navy);color:#fff;text-align:left;font-weight:600}table.detail th{white-space:normal}thead th small{display:block;font-weight:400;font-size:10.5px;opacity:.9;white-space:nowrap}
.chg small{display:block;font-size:10px;font-weight:600}.chg.good{color:var(--green)}.chg.bad{color:var(--red)}.chg.neutral{color:var(--muted)}
.legend{color:var(--muted);font-size:11px;margin:6px 0 0}.legend .good{color:var(--green);font-weight:600}.legend .bad{color:var(--red);font-weight:600}
.stage{background:#F3F5F6;color:var(--navy);text-align:left;width:15%}.stage small{display:block;color:var(--muted);font-weight:400;margin-top:2px}
.metric span{color:var(--muted)}.num{text-align:right;white-space:nowrap}.note{color:var(--muted);font-size:11.5px;width:34%}
.manual{color:var(--muted);font-style:italic}tr.total td{background:var(--total);color:var(--green);font-weight:700}
.facts{margin:4px 0 0;padding-left:18px}.facts li{margin:2px 0}.limits{color:var(--muted);font-size:11px;margin-top:8px}.limits ul{margin:4px 0;padding-left:16px}
footer{text-align:center;color:var(--muted);font-size:11px;border-top:1px solid var(--line);margin-top:14px;padding-top:8px}
.toolbar{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;justify-content:space-between;background:#F3F5F6;border-bottom:1px solid var(--line);padding:10px 16px;font-size:13px}.toolbar a{color:var(--navy);font-weight:600}.toolbar form{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}.toolbar form.chat{background:#fff;border:1px solid var(--line);border-radius:14px;padding:8px 12px}.toolbar form.chat b{margin-right:4px}.toolbar input,.toolbar select{font:inherit;padding:5px 8px;margin-left:6px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink)}.toolbar select:focus-visible,.toolbar input:focus-visible,.toolbar button:focus-visible{outline:2px solid var(--navy);outline-offset:2px}.toolbar small{color:var(--muted)}.toolbar button{font:inherit;padding:6px 12px;border:1px solid var(--navy);background:var(--navy);color:#fff;border-radius:6px;cursor:pointer}.toolbar form button{background:#fff;color:var(--navy)}
@media (max-width:640px){.kpis{grid-template-columns:1fr 1fr}.kpi:nth-child(2){border-right:0}.kpi:nth-child(-n+2){border-bottom:1px solid var(--line)}table.main,table.detail{font-size:12px}.detail-wrap{overflow-x:auto}}
@media print{body{font-size:10.5px}.toolbar,.screen-only{display:none}.chg small{display:inline;margin-left:4px;font-size:9px}.legend{font-size:9.5px;margin-top:3px}.page{padding:0;max-width:none;zoom:.86}.page+.page{border:0;break-before:page}h1{font-size:18px}.sub{margin-bottom:8px}h2{font-size:12px;margin:10px 0 6px;padding:5px 9px}table.main th,table.main td,table.detail th,table.detail td{padding:3px 6px}.note{font-size:9.5px}.kpi{padding:6px 9px}.kpi .v{font-size:15px;margin:3px 0;padding-bottom:3px}.meta td{padding:4px 7px}.meta{margin-bottom:8px}hr{margin-bottom:8px}tr,h2{break-inside:avoid}footer{margin-top:8px}}
`;

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2–8 Nov · 7 hari", "28 Okt–3 Nov · 7 hari". */
export function shortRange(p: Period): string {
  const [y1, m1, d1] = p.since.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = p.until.split("-").map(Number) as [number, number, number];
  const days = dayCount(p);
  const left = m1 === m2 && y1 === y2 ? `${d1}` : `${d1} ${BULAN[m1 - 1]}${y1 === y2 ? "" : ` ${y1}`}`;
  const range = p.since === p.until ? `${d2} ${BULAN[m2 - 1]}` : `${left}–${d2} ${BULAN[m2 - 1]}`;
  return `${range} · ${days} hari`;
}

function changeCell(row: ReportRow): string {
  const c = (row.points ? changePoints : change)(row.prev, row.curr, row.better);
  return `<td class="num chg ${c.tone}">${esc(c.text)}${c.verdict ? `<small>${esc(c.verdict)}</small>` : ""}</td>`;
}

function reportBody(r: WeeklyReport, preparedAt: Date): string {
  const body = r.groups
    .map((g) =>
      g.rows
        .map(
          (row, i) =>
            `<tr${row.total ? ' class="total"' : ""}>${i === 0 ? `<th scope="rowgroup" rowspan="${g.rows.length}" class="stage">${esc(g.title)}<small>${esc(g.source)}</small></th>` : ""}<td class="metric"><b>${esc(row.metric)}</b>${row.sub ? ` <span>(${esc(row.sub)})</span>` : ""}</td><td class="num${row.prev === null && row.manual ? " manual" : ""}">${cell(row.prev, row.fmt, row.manual, row.empty)}</td><td class="num${row.curr === null && row.manual ? " manual" : ""}">${cell(row.curr, row.fmt, row.manual, row.empty)}</td>${changeCell(row)}<td class="note">${esc(row.note)}</td></tr>`,
        )
        .join(""),
    )
    .join("");
  // Tables marked `last` come after the others; the conclusions follow all tables (owner, 24 Nov).
  const details = [...r.details.filter((d) => !d.last), ...r.details.filter((d) => d.last)]
    .map(
      (d) =>
        `<div${d.screenOnly ? ' class="screen-only"' : ""}><h2>${esc(d.title)}</h2><div class="detail-wrap"><table class="detail"><thead><tr>${d.head.map((h, i) => `<th${i >= (d.textCols ?? 1) ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${d.rows.map((row) => `<tr>${row.map((v, i) => `<td${i >= (d.textCols ?? 1) ? ' class="num"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${d.note ? `<p class="limits">${esc(d.note)}</p>` : ""}</div>`,
    )
    .join("");
  const made = preparedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `<div class="page"><h1>${esc(r.title)}</h1><p class="sub">${esc(r.subtitle)}</p>
<table class="meta"><tr><td>Bisnis</td><td>${esc(r.business)}</td><td>Periode laporan</td><td>${esc(tanggal(r.period.since))} – ${esc(tanggal(r.period.until))}<br>${r.periodNote ? `<span class="manual">${esc(r.periodNote)}</span><br>` : ""}<span class="manual">pembanding ${esc(tanggal(r.previous.since))} – ${esc(tanggal(r.previous.until))}</span></td></tr>
<tr><td>Sumber</td><td>${esc(r.url)}</td><td>Disusun</td><td>Otomatis dari API, ${esc(made)} WIB</td></tr></table>
<hr><h2>1. Ringkasan</h2><div class="kpis">${r.kpis.map((k) => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v">${esc(k.value)}</div><div class="s">${esc(k.sub)}</div></div>`).join("")}</div>
<h2>2. Rincian</h2><table class="main"><thead><tr><th>Bagian</th><th>Angka</th><th class="num">${esc(r.labels?.prev ?? "Periode lalu")}<small>${esc(shortRange(r.previous))}</small></th><th class="num">${esc(r.labels?.curr ?? "Periode ini")}<small>${esc(shortRange(r.period))}${r.partial ? " · belum lengkap" : ""}</small></th><th class="num">Perubahan</th><th>Keterangan</th></tr></thead><tbody>${body}</tbody></table><p class="legend">Perubahan = ${esc(r.labels?.curr ?? "periode ini")} dibanding ${esc(r.labels?.prev ?? "periode lalu")}${dayCount(r.period) === dayCount(r.previous) ? " dengan jumlah hari yang sama" : ` (jumlah hari berbeda: ${dayCount(r.period)} dan ${dayCount(r.previous)} hari)`}. ▲ naik, ▼ turun. <span class="good">Hijau = membaik</span>, <span class="bad">merah = memburuk</span>, abu-abu = netral (naik/turun bukan tanda baik atau buruk).${r.partial ? " Periode ini memuat hari ini yang belum selesai, jadi angkanya masih bisa bertambah." : ""}</p>
${details}
${r.highlights.length ? `<h2>3. Kesimpulan dari angka</h2><ul class="facts">${r.highlights.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${r.limits.length ? `<div class="limits"><b>Perlu diketahui</b><ul>${r.limits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
<footer>${esc(r.title)} · ${esc(r.business)}</footer></div>`;
}

/** Satu atau beberapa laporan dalam satu dokumen (tiap laporan mulai di halaman baru saat dicetak). `toolbar` hanya untuk dashboard. */
export function renderReports(reports: WeeklyReport[], preparedAt = new Date(), opts: { toolbar?: boolean; title?: string; range?: ReportRange; /** pilihan periode buatan sendiri (menggantikan Dari–Sampai bawaan) */ picker?: string } = {}): string {
  const first = reports[0];
  if (!first) throw new Error("tidak ada laporan untuk dirender");
  const title = opts.title ?? `${first.title} · ${first.period.since}`;
  const range = opts.range ?? {};
  const picker = opts.picker ?? `<form method="get" class="range"><label>Dari <input type="date" name="since" value="${esc(range.since ?? "")}" required></label><label>Sampai <input type="date" name="until" value="${esc(range.until ?? "")}"></label><button type="submit">Tampilkan</button><a href="?">Otomatis</a></form>`;
  const toolbar = opts.toolbar ? `<div class="toolbar">${picker}<button type="button" onclick="window.print()">Cetak / simpan PDF</button></div>` : "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="icon" href="data:,"><style>${CSS}</style></head><body>${toolbar}${reports.map((r) => reportBody(r, preparedAt)).join("")}</body></html>`;
}

export const renderWeeklyReport = (r: WeeklyReport, preparedAt = new Date(), opts: { toolbar?: boolean } = {}): string => renderReports([r], preparedAt, opts);
