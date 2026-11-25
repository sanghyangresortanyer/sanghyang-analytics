// Laporan Google Ads per bulan, bagian "pengaruh iklan ke revenue kamar" (pemilik, 24 Nov 2026: "harus ada
// pembuktian … 3 campaign itu berpengaruh ga ke revenue … setidaknya kita check perbulan"). Tiap kampanye
// dibanding revenue kamar (Lodging VHP) bulan demi bulan. OTA jadi pembanding: tamu OTA tidak memesan lewat
// iklan kita, jadi hasil iklan yang naik-turun bersama OTA lebih mungkin karena musim. Data ini tidak pernah
// bisa membuktikan sebab-akibat; kesimpulan paling tinggi adalah "Ada petunjuk".
import type { MonthlyActionRow, MonthlyCampaignRow } from "./google-ads.ts";
import { type MonthSlot, monthLabel, rangeLabel } from "./monthly-analysis.ts";
import { CALL, CHAT, type DetailTable, MAPS, type Period } from "./weekly-report.ts";

export type CampaignMonth = { cost: number; /** chat WA + telepon dari iklan */ contacts: number; /** minta rute di Maps */ maps: number };
export type HotelRooms = { fit: number; walkIn: number; ota: number };
export type ImpactMonth = {
  month: string;
  period: Period;
  partial: boolean;
  /** per campaign name; null = Google Ads could not be read */
  ads: Record<string, CampaignMonth> | null;
  /** room revenue (Lodging); null = no VHP data */
  hotel: HotelRooms | null;
};

const MIN_STEPS = 6;
const NO_DATA = "Belum ada data";
const NONE: CampaignMonth = { cost: 0, contacts: 0, maps: 0 };
const jt = (v: number) => `Rp${(v / 1e6).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} jt`;
const int = (v: number) => Math.round(v).toLocaleString("id-ID");
const dayCount = (p: Period) => Math.round((Date.parse(p.until) - Date.parse(p.since)) / 86_400_000) + 1;

/** Google's rows per month and campaign → the figures of each slot. */
export function impactMonths(slots: MonthSlot[], google: { costs: MonthlyCampaignRow[]; actions: MonthlyActionRow[] } | null, hotel: Map<string, HotelRooms>): ImpactMonth[] {
  return slots.map((s) => {
    const ads: Record<string, CampaignMonth> = {};
    const cell = (name: string) => (ads[name] ??= { ...NONE });
    for (const r of google?.costs ?? []) if (r.month === s.month) cell(r.campaign).cost += r.cost;
    for (const r of google?.actions ?? []) {
      if (r.month !== s.month) continue;
      if (CHAT.includes(r.action) || CALL.includes(r.action)) cell(r.campaign).contacts += r.allConversions;
      else if (MAPS.includes(r.action)) cell(r.campaign).maps += r.allConversions;
    }
    return { month: s.month, period: s.period, partial: s.partial, ads: google ? ads : null, hotel: hotel.get(s.month) ?? null };
  });
}

/** Local store visits is set up for Maps routes to the hotel; the others bring chats and calls. */
const role = (campaign: string) =>
  /\blocal\b|store visits/i.test(campaign)
    ? { guests: "WALK IN", result: "rute Maps", of: (c: CampaignMonth) => c.maps, revenue: (h: HotelRooms) => h.walkIn }
    : { guests: "FIT", result: "chat + telepon", of: (c: CampaignMonth) => c.contacts, revenue: (h: HotelRooms) => h.fit };

type Match = { same: number; steps: number };
/** How often two series move the same way from one month to the next (unchanged months say nothing). */
function together(a: number[], b: number[]): Match {
  let same = 0;
  let steps = 0;
  for (let i = 1; i < a.length; i++) {
    if (a[i] === a[i - 1] || b[i] === b[i - 1]) continue;
    steps++;
    if (a[i] > a[i - 1] === b[i] > b[i - 1]) same++;
  }
  return { same, steps };
}
const said = (m: Match) => (m.steps ? `${m.same} dari ${m.steps}` : NO_DATA);
const part = (m: Match) => (m.steps ? m.same / m.steps : 0);
const often = (m: Match) => part(m) >= 0.8;

function verdict(cost: Match, result: Match, ota: Match): string {
  if (cost.steps < MIN_STEPS || result.steps < MIN_STEPS) return "Data belum cukup untuk dinilai";
  const aboveOta = part(result) - part(ota) >= 0.25;
  if (often(cost) && often(result) && aboveOta) return "Ada petunjuk: biaya dan hasil searah revenue, jauh di atas OTA. Perlu diuji dengan menaik-turunkan anggaran";
  if (part(result) >= 0.65 && !aboveOta) return "Belum terbukti: hasil iklan naik-turun bersama OTA juga, lebih mungkin karena musim";
  if (often(result)) return "Belum terbukti: hasil iklan searah revenue, tetapi biaya tidak";
  if (often(cost)) return "Belum terbukti: biaya searah revenue, tetapi hasil iklannya tidak";
  return "Belum terbukti: biaya dan hasil iklan tidak selalu searah revenue";
}

/** Two tables (per month, per campaign) and one sentence for the conclusions. */
export function campaignImpact(months: ImpactMonth[]): { tables: DetailTable[]; line: string | null } {
  const totals = new Map<string, number>();
  for (const m of months) for (const [name, c] of Object.entries(m.ads ?? {})) totals.set(name, (totals.get(name) ?? 0) + c.cost);
  const names = [...totals].filter(([, cost]) => cost > 0).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (names.length === 0) return { tables: [], line: null };

  const perMonth: DetailTable = {
    title: "Iklan dan revenue kamar per bulan",
    head: ["Bulan", ...names.flatMap((n) => [`${n}: biaya`, role(n).result]), "Revenue FIT", "Revenue WALK IN", "Revenue OTA"],
    rows: months.map((m) => [
      // no-break characters: a month stays on one line
      (m.partial ? rangeLabel(m.period) : monthLabel(m.month)).replaceAll(" ", "\u00a0").replaceAll("–", "–\u2060"),
      ...names.flatMap((n) => {
        if (!m.ads) return [NO_DATA, NO_DATA];
        const c = m.ads[n] ?? NONE;
        return [jt(c.cost), int(role(n).of(c))];
      }),
      ...(m.hotel ? [jt(m.hotel.fit), jt(m.hotel.walkIn), jt(m.hotel.ota)] : [NO_DATA, NO_DATA, NO_DATA]),
    ]),
    note: "Revenue kamar saja (Lodging di laporan Revenue VHP). Biaya dan hasil iklan dari Google Ads untuk tanggal yang sama. Klik WA/telepon di website tidak ikut karena tidak bisa dipisah per kampanye.",
  };

  const full = months.filter((m): m is ImpactMonth & { ads: Record<string, CampaignMonth>; hotel: HotelRooms } => !m.partial && m.ads !== null && m.hotel !== null);
  // Per day, so February is not a drop by itself.
  const daily = (f: (m: (typeof full)[number]) => number) => full.map((m) => f(m) / dayCount(m.period));
  const judged = names.map((name) => {
    const r = role(name);
    const spent = daily((m) => (m.ads[name] ?? NONE).cost);
    const got = daily((m) => r.of(m.ads[name] ?? NONE));
    const revenue = daily((m) => r.revenue(m.hotel));
    const cost = together(spent, revenue);
    const result = together(got, revenue);
    const ota = together(got, daily((m) => m.hotel.ota));
    return { name, row: [name, r.guests, said(cost), said(result), said(ota), verdict(cost, result, ota)] };
  });
  const span = full.length ? `${monthLabel(full[0].month)} – ${monthLabel(full[full.length - 1].month)}` : "";
  const perCampaign: DetailTable = {
    title: "Apakah tiap kampanye berpengaruh ke revenue kamar?",
    head: ["Kampanye", "Dikaitkan dengan", "Biaya searah revenue", "Hasil searah revenue", "Hasil searah OTA (pembanding)", "Kesimpulan"],
    rows: judged.map((j) => j.row),
    textCols: 6,
    last: true,
    note: `Dihitung dari bulan lengkap${span ? ` ${span}` : ""}, rata-rata per hari. "Searah" = sama-sama naik atau sama-sama turun dari bulan ke bulan; sekitar separuh bisa terjadi kebetulan. Hasil = rute Maps untuk Local, chat + telepon untuk kampanye lain. OTA jadi pembanding karena tamu OTA tidak memesan lewat iklan kita. Bukti pasti baru ada bila CS dan FO mencatat dari mana tamu tahu, atau bila anggaran sengaja dinaik-turunkan lalu hasilnya dibandingkan.`,
  };
  const hints = judged.filter((j) => j.row[5].startsWith("Ada petunjuk")).map((j) => j.name);
  const finding = hints.length ? `ada petunjuk untuk ${hints.join(", ")}, belum terbukti untuk yang lain` : `belum ada dari ${names.length} kampanye yang terbukti`;
  return { tables: [perMonth, perCampaign], line: `Pengaruh iklan ke revenue kamar${span ? ` (${span})` : ""}: ${finding}. Rinciannya di tabel di bawah.` };
}
