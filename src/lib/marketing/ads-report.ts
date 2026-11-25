// Laporan Google Ads di aplikasi (pemilik, 22 Nov 2026): pilih per minggu, per bulan (jumlah hari sama),
// atau bebas (A vs B); fungsi tiap kampanye, asal klik, hitungan chat WA dari CS, dan kesimpulan angka.
// Baca-saja. "Kontak" = chat WA dimulai + telepon dari iklan + klik WA/telepon di website (googleNumbers);
// Contact Us, rute Maps, lihat menu, interaksi lokal, dan Booking tidak dihitung.
import type { CampaignRow, ConversionRow, NetworkRow } from "./google-ads.ts";
import { addDays, todayIn } from "./metrics.ts";
import { type DetailTable, type Period, rangePeriods, type ReportRow, trend, type WeeklyReport, weekPeriods } from "./weekly-report.ts";

export type ReportMode = "hari" | "minggu" | "bulan" | "bebas";
export type ReportQuery = { mode?: string; since?: string; until?: string; since2?: string; until2?: string; bulan?: string; bulan2?: string; pekan?: string; pekan2?: string; hari?: string; hari2?: string };
export type ReportPeriods = { mode: ReportMode; current: Period; previous: Period; note?: string; partial?: boolean; labels: { prev: string; curr: string }; title: string };

const MONTH = /^\d{4}-\d{2}$/;
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const days = (p: Period) => Math.round((Date.parse(p.until) - Date.parse(p.since)) / 86_400_000) + 1;
const monthLength = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const prevMonth = (ym: string) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthName = (ym: string) => `${BULAN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
/** "Minggu 22 Nov". */
export const dayLabel = (d: string) => `${HARI[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8, 10))} ${SINGKAT[Number(d.slice(5, 7)) - 1]}`;

/** Days a daily report can pick, newest first: yesterday and the 59 days before it. */
export function dayOptions(now = new Date(), timezone = "Asia/Jakarta", count = 60): { value: string; label: string }[] {
  const yesterday = addDays(todayIn(timezone, now), -1);
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(yesterday, -i);
    return { value: d, label: `${dayLabel(d)} ${d.slice(0, 4)}` };
  });
}
const isMonday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
/** "16–22 Nov", "27 Okt–2 Nov". */
export function weekLabel(p: Period): string {
  const [, m1, d1] = p.since.split("-").map(Number) as [number, number, number];
  const [, m2, d2] = p.until.split("-").map(Number) as [number, number, number];
  return m1 === m2 ? `${d1}–${d2} ${SINGKAT[m2 - 1]}` : `${d1} ${SINGKAT[m1 - 1]}–${d2} ${SINGKAT[m2 - 1]}`;
}

/** Months a report can pick, newest first: from January 2026 up to the month of yesterday. */
export function monthOptions(now = new Date(), timezone = "Asia/Jakarta", from = "2026-01"): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = addDays(todayIn(timezone, now), -1).slice(0, 7); m >= from; m = prevMonth(m)) out.push({ value: m, label: monthName(m) });
  return out;
}

/** Finished Monday–Sunday weeks, newest first (26 = half a year). */
export function weekOptions(now = new Date(), timezone = "Asia/Jakarta", count = 26): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  let monday = weekPeriods(undefined, now, timezone).current.since;
  for (let i = 0; i < count; i++, monday = addDays(monday, -7)) {
    const p = { since: monday, until: addDays(monday, 6) };
    out.push({ value: monday, label: `${weekLabel(p)} ${monday.slice(0, 4)}` });
  }
  return out;
}

/** Which two periods the report compares. Without a mode: old links (since+until = bebas, since = minggu). */
export function reportPeriods(q: ReportQuery, now = new Date(), timezone = "Asia/Jakarta"): ReportPeriods {
  const mode: ReportMode = q.mode === "hari" || q.mode === "bulan" || q.mode === "bebas" || q.mode === "minggu" ? q.mode : q.since && q.until ? "bebas" : "minggu";
  const today = todayIn(timezone, now);

  if (mode === "hari") {
    // Tab Harian uses this same report (owner, 23 Nov: "jenis laporannya sama biar konsisten"). Default:
    // yesterday against the same weekday a week earlier, since weekends and weekdays differ for a hotel.
    const a = q.hari || addDays(today, -1);
    const b = q.hari2 || addDays(a, -7);
    const pa = rangePeriods(a, a, now, timezone);
    rangePeriods(b, b, now, timezone);
    if (a === b) throw new Error("pilih dua hari yang berbeda");
    return {
      mode,
      current: pa.current,
      previous: { since: b, until: b },
      partial: pa.partialToday,
      labels: { prev: dayLabel(b), curr: dayLabel(a) },
      title: "Perbandingan iklan Google per hari",
      note: addDays(a, -7) === b ? "Dibanding hari yang sama pekan sebelumnya" : "Hari A dibanding hari B pilihan",
    };
  }

  if (mode === "bulan") {
    // Bulan A vs bulan B (owner, 23 Nov: two dropdowns). Both are cut to the same number of days: the
    // shorter month, or A up to yesterday while A is still running.
    const yesterday = addDays(today, -1);
    const latest = yesterday.slice(0, 7);
    const a = q.bulan || latest;
    const b = q.bulan2 || prevMonth(a);
    for (const m of [a, b]) {
      if (!MONTH.test(m)) throw new Error("bulan harus berformat YYYY-MM");
      if (m > latest) throw new Error(`${monthName(m)} belum ada datanya; pilih bulan sampai ${monthName(latest)}`);
    }
    if (a === b) throw new Error("pilih dua bulan yang berbeda");
    const lastOf = (m: string) => (m === latest ? Number(yesterday.slice(8, 10)) : monthLength(m));
    const n = Math.min(lastOf(a), lastOf(b));
    const dd = String(n).padStart(2, "0");
    const cut = n < monthLength(a) || n < monthLength(b);
    return {
      mode,
      current: { since: `${a}-01`, until: `${a}-${dd}` },
      previous: { since: `${b}-01`, until: `${b}-${dd}` },
      note: cut ? `Tanggal 1–${n} kedua bulan (jumlah hari sama)` : "Dua bulan penuh",
      labels: { prev: monthName(b), curr: monthName(a) },
      title: "Perbandingan iklan Google per bulan",
    };
  }

  if (mode === "bebas") {
    // Opened from the tab without dates: start with the last 7 full days (owner, 23 Nov: the link showed an error).
    if (!q.since && !q.until) return reportPeriods({ ...q, since: addDays(today, -7), until: addDays(today, -1) }, now, timezone);
    if (!q.since || !q.until) throw new Error("isi tanggal Dari dan Sampai untuk periode A");
    const a = rangePeriods(q.since, q.until, now, timezone);
    const labels = { prev: "Periode B", curr: "Periode A" };
    if (!q.since2 && !q.until2) {
      return { mode, current: a.current, previous: a.previous, partial: a.partialToday, labels, title: "Perbandingan iklan Google, tanggal pilihan", note: "Periode B otomatis: jumlah hari yang sama tepat sebelum periode A" };
    }
    if (!q.since2 || !q.until2) throw new Error("isi tanggal Dari dan Sampai untuk periode B, atau kosongkan keduanya");
    const b = rangePeriods(q.since2, q.until2, now, timezone);
    const same = days(a.current) === days(b.current);
    return {
      mode,
      current: a.current,
      previous: b.current,
      partial: a.partialToday || b.partialToday,
      labels,
      title: "Perbandingan iklan Google, tanggal pilihan",
      note: same ? "Periode A dibanding periode B pilihan" : `Jumlah hari berbeda (A ${days(a.current)} hari, B ${days(b.current)} hari): total tidak setara, bandingkan juga angka per hari`,
    };
  }

  // Pekan A vs pekan B (Senin–Minggu, owner 23 Nov). B empty = the week before A. `since` = old links.
  const wa = weekPeriods(q.pekan || q.since || undefined, now, timezone);
  const wb = q.pekan2 ? weekPeriods(q.pekan2, now, timezone).current : wa.previous;
  if (!isMonday(wa.current.since) || !isMonday(wb.since)) throw new Error("pekan harus dimulai hari Senin");
  if (wb.since === wa.current.since) throw new Error("pilih dua pekan yang berbeda");
  return { mode, current: wa.current, previous: wb, labels: { prev: `Pekan ${weekLabel(wb)}`, curr: `Pekan ${weekLabel(wa.current)}` }, title: "Perbandingan iklan Google per minggu", note: "Senin–Minggu" };
}

// ------------------------------------------------------------------ fungsi kampanye & asal klik

export const NETWORK_LABEL: Record<string, string> = {
  SEARCH: "Pencarian Google",
  SEARCH_PARTNERS: "Mitra pencarian Google",
  CONTENT: "Situs & aplikasi mitra",
  YOUTUBE: "YouTube",
  YOUTUBE_SEARCH: "YouTube",
  YOUTUBE_WATCH: "YouTube",
  DISCOVER: "Discover & Gmail",
  MAPS: "Google Maps",
  GOOGLE_TV: "Google TV",
  MIXED: "Campuran (tidak dipisah Google)",
};
const networkLabel = (n: string) => NETWORK_LABEL[n] ?? "Lainnya";

const CHANNEL: Record<string, string> = {
  SEARCH: "Iklan teks di Pencarian Google: muncul saat orang mengetik kata kunci yang dipilih.",
  PERFORMANCE_MAX: "Iklan otomatis (Performance Max): Google sendiri memilih tempat tampil di Pencarian, Maps, YouTube, Discover, dan situs mitra.",
  DISPLAY: "Iklan gambar di situs dan aplikasi mitra Google.",
  VIDEO: "Iklan video di YouTube.",
  SMART: "Iklan Smart: versi sederhana yang diatur otomatis oleh Google.",
  LOCAL: "Iklan lokal di Google Maps dan Pencarian.",
  DEMAND_GEN: "Iklan gambar dan video di YouTube, Discover, dan Gmail.",
};
const BIDDING: Record<string, string> = {
  MAXIMIZE_CONVERSION_VALUE: "Google mengejar nilai konversi sebesar-besarnya (konversi bernilai tinggi lebih dikejar).",
  MAXIMIZE_CONVERSIONS: "Google mengejar jumlah konversi sebanyak-banyaknya.",
  TARGET_SPEND: "Google mengejar klik sebanyak-banyaknya.",
  TARGET_CPA: "Google menjaga biaya per konversi sesuai target.",
  TARGET_ROAS: "Google menjaga nilai konversi per biaya sesuai target.",
  MANUAL_CPC: "Biaya per klik diatur manual.",
  TARGET_IMPRESSION_SHARE: "Google mengejar iklan sering tampil di posisi atas.",
};
/** Conversion names as Google stores them → plain words for hotel staff. */
const ACTION: Record<string, string> = {
  "Conversation started": "chat WA dimulai",
  "Klik untuk menelepon": "klik telepon di iklan",
  "Calls from Smart Campaign Ads": "telepon dari iklan",
  "Smart campaign ad clicks to call": "klik telepon di iklan",
  "Smart campaign map clicks to call": "klik telepon di Maps",
  "Tindakan lokal - Rute": "minta rute di Maps",
  "Local actions - Other engagements": "interaksi lain di Maps",
  "Local actions - Menu views": "lihat menu di Maps",
  "Local actions - Website visits": "buka website dari Maps",
  Booking: "buka halaman booking",
  "Sanghyang (web) whatsapp_click": "klik WA di website",
  "Sanghyang (web) phone_click": "klik telepon di website",
  "Sanghyang (web) purchase": "booking website",
  "Store visits": "kunjungan ke lokasi (perkiraan Google)",
};
const actionLabel = (a: string) => ACTION[a] ?? (/contact/i.test(a) ? "buka Contact Us" : a);
const int = (v: number) => Math.round(v).toLocaleString("id-ID");
const rp = (v: number | null) => (v === null ? "–" : `Rp${Math.round(v).toLocaleString("id-ID")}`);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** One row per active campaign: what kind of ad it is, what Google aims for, where its clicks came from, what it got. */
export function campaignFunctions(campaigns: CampaignRow[], conversions: ConversionRow[], networks: NetworkRow[] | null): DetailTable {
  const rows = campaigns
    .filter((c) => c.cost > 0 || c.status === "ENABLED")
    .map((c) => {
      const kind = [CHANNEL[c.channel] ?? `Jenis ${c.channel || "tidak diketahui"}.`, BIDDING[c.bidding] ?? ""].filter(Boolean).join(" ");
      const own = (networks ?? []).filter((x) => x.campaign === c.name && x.clicks > 0).sort((a, b) => b.clicks - a.clicks);
      const clicks = own.reduce((s, x) => s + x.clicks, 0);
      const from = networks === null ? "Belum ada data" : own.length === 0 ? "Belum ada klik" : own.slice(0, 3).map((x) => `${networkLabel(x.network)} ${int(x.clicks)} (${share(x.clicks, clicks)}%)`).join(" · ");
      const got = conversions
        .filter((x) => x.campaign === c.name && x.allConversions >= 0.5)
        .sort((a, b) => b.allConversions - a.allConversions)
        .slice(0, 3)
        .map((x) => `${actionLabel(x.action)} ${int(x.allConversions)}`)
        .join(" · ");
      return [`${c.name}${c.status === "ENABLED" ? "" : " (dijeda)"}`, kind, from, got || "Belum ada hasil tercatat"];
    });
  return {
    title: "Fungsi tiap kampanye",
    last: true,
    head: ["Kampanye", "Jenis iklan & tujuan Google", "Klik terbanyak dari", "Hasil terbanyak yang dicatat Google"],
    rows,
    textCols: 4,
    note: "Nama kampanye hanya label; isi kolom ini dibaca dari pengaturan dan hasil kampanye di Google Ads. Hasil yang dicatat Google belum tentu kontak: hanya chat WA, telepon, dan klik WA/telepon website yang dihitung sebagai orang menghubungi.",
  };
}

/** Clicks per place the ads were shown, both periods side by side. */
export function clickSources(curr: NetworkRow[], prev: NetworkRow[] | null, labels: { prev: string; curr: string }): DetailTable {
  const sum = (rows: NetworkRow[] | null, label: string, key: "clicks" | "cost") => (rows ?? []).filter((r) => networkLabel(r.network) === label).reduce((s, r) => s + r[key], 0);
  const names = [...new Set([...curr, ...(prev ?? [])].filter((r) => r.clicks > 0).map((r) => networkLabel(r.network)))];
  const total = curr.reduce((s, r) => s + r.clicks, 0);
  const rows = names
    .map((name) => ({ name, now: sum(curr, name, "clicks"), before: sum(prev, name, "clicks"), cost: sum(curr, name, "cost") }))
    .sort((a, b) => b.now - a.now || b.before - a.before)
    .map((r) => [r.name, prev === null ? "–" : int(r.before), int(r.now), `${share(r.now, total)}%`, rp(r.cost), r.now ? rp(r.cost / r.now) : "–"]);
  return {
    title: "Asal klik iklan",
    head: ["Tempat iklan tampil", `Klik ${labels.prev}`, `Klik ${labels.curr}`, "% klik", `Biaya ${labels.curr}`, "Biaya per klik"],
    rows,
    note: "Situs & aplikasi mitra = situs dan aplikasi lain yang memasang iklan Google. Discover = beranda aplikasi Google dan Gmail.",
  };
}

// ------------------------------------------------------------------ chat WA dari CS

export type ChatEntry = { date_from: string; date_to: string; chats_total: number | null; chats_from_ads: number | null; chats_closing: number | null };
export type ChatCount = { closing: number | null; total: number | null; fromAds: number | null; days: number; periodDays: number };

/**
 * WhatsApp chats counted by CS inside a period. Only entries fully inside the period count; when entries
 * overlap (a week and a day of that week), the longer one wins so no day is counted twice. A number left
 * empty in any entry used leaves that total unknown (null), never 0.
 */
export function chatsInPeriod(entries: ChatEntry[], period: Period): ChatCount {
  const inside = entries.filter((e) => e.date_from >= period.since && e.date_to <= period.until && e.date_from <= e.date_to);
  const picked: ChatEntry[] = [];
  for (const e of [...inside].sort((a, b) => days({ since: b.date_from, until: b.date_to }) - days({ since: a.date_from, until: a.date_to }) || a.date_from.localeCompare(b.date_from))) {
    if (picked.every((p) => e.date_to < p.date_from || e.date_from > p.date_to)) picked.push(e);
  }
  const covered = picked.reduce((s, e) => s + days({ since: e.date_from, until: e.date_to }), 0);
  const add = (k: "chats_closing" | "chats_total" | "chats_from_ads") => (picked.length && picked.every((e) => e[k] !== null) ? picked.reduce((s, e) => s + (e[k] ?? 0), 0) : null);
  return { closing: add("chats_closing"), total: add("chats_total"), fromAds: add("chats_from_ads"), days: covered, periodDays: days(period) };
}

const chatNote = (c: ChatCount) => (c.days === 0 ? "" : `diisi ${c.days} dari ${c.periodDays} hari`);

// ------------------------------------------------------------------ gabungkan ke laporan

export type AdsExtras = {
  periods: ReportPeriods;
  campaigns: CampaignRow[];
  conversions: ConversionRow[];
  networks: { curr: NetworkRow[] | null; prev: NetworkRow[] | null };
  chats: { curr: ChatCount; prev: ChatCount } | null;
  /** Google's own counts for the CS comparison line. */
  google: { chats: number; webClicks: number | null; cost: number; prevCost: number; perContact: number | null; prevPerContact: number | null; /** false when website clicks were tracked in only one period */ comparable: boolean };
};

/** Spend going up or down is neither good nor bad by itself, so this sentence carries no verdict. */
function costLine(curr: number, prev: number): string {
  if (!prev) return `Biaya iklan ${rp(curr)}.`;
  const d = Math.round(((curr - prev) / prev) * 100);
  return d === 0 ? `Biaya iklan sama: ${rp(curr)}.` : `Biaya iklan ${d > 0 ? "naik" : "turun"} ${Math.abs(d)}%: ${rp(prev)} → ${rp(curr)}.`;
}

/** Adds campaign functions, click sources, the CS chat row and the numeric conclusions to a Google report. */
export function addAdsExtras(report: WeeklyReport, x: AdsExtras): WeeklyReport {
  const p = x.periods;
  report.title = p.title;
  report.period = p.current;
  report.previous = p.previous;
  report.labels = p.labels;
  if (p.note) report.periodNote = p.note;
  if (p.partial) report.partial = true;

  const contacts = report.groups.find((g) => g.title.startsWith("3."));
  if (contacts) {
    const at = contacts.rows.findIndex((r) => r.metric === "Total orang menghubungi");
    const unread = "Hitungan CS tidak bisa dibaca";
    const rows: ReportRow[] = [
      {
        better: "up",
        metric: "Chat WA closing menurut CS",
        sub: "jadi booking, semua sumber",
        prev: x.chats?.prev.closing ?? null,
        curr: x.chats?.curr.closing ?? null,
        fmt: "int",
        empty: "Belum ada data",
        note: x.chats === null ? unread : [chatNote(x.chats.curr), "Diisi CS di atas laporan"].filter(Boolean).join(" · "),
      },
    ];
    contacts.rows.splice(at < 0 ? contacts.rows.length : at + 1, 0, ...rows);
    // Website WA/phone clicks were tracked in only one period: totals would compare different things.
    if (!x.google.comparable) {
      for (const r of contacts.rows.filter((r) => r.metric === "Total orang menghubungi" || r.metric === "Biaya per orang menghubungi")) {
        r.prev = null;
        r.empty = "tidak setara";
        r.note = `${r.note} · tidak dibandingkan: klik WA/telepon website belum tercatat di ${p.labels.prev}`;
      }
    }
  }

  report.details.unshift(campaignFunctions(x.campaigns, x.conversions, x.networks.curr));
  if (x.networks.curr) report.details.push(clickSources(x.networks.curr, x.networks.prev, p.labels));
  else report.limits.push("Asal klik tidak bisa dibaca dari Google Ads saat laporan dibuat.");

  const g = x.google;
  const lines = [
    costLine(g.cost, g.prevCost),
    trend("Biaya per orang menghubungi", g.perContact, g.prevPerContact, g.comparable, true),
  ];
  const net = x.networks.curr;
  if (net && net.length) {
    const total = net.reduce((s, r) => s + r.clicks, 0);
    const byPlace = new Map<string, { clicks: number; cost: number }>();
    for (const r of net) {
      const k = networkLabel(r.network);
      const v = byPlace.get(k) ?? { clicks: 0, cost: 0 };
      byPlace.set(k, { clicks: v.clicks + r.clicks, cost: v.cost + r.cost });
    }
    const top = [...byPlace.entries()].sort((a, b) => b[1].clicks - a[1].clicks)[0];
    if (top && total) lines.push(`Klik terbanyak dari ${top[0]}: ${int(top[1].clicks)} dari ${int(total)} klik (${share(top[1].clicks, total)}%), biaya ${rp(top[1].cost)}.`);
  }
  const cs = x.chats?.curr;
  if (cs && cs.closing !== null) {
    const google = `Google mencatat ${int(g.chats)} chat WA dimulai dari iklan${g.webClicks === null ? "" : ` dan ${int(g.webClicks)} klik WA/telepon di website dari iklan`}`;
    lines.push(`CS mencatat ${int(cs.closing)} chat closing (jadi booking) untuk ${cs.days} dari ${cs.periodDays} hari. ${google}.`);
  } else if (x.chats) {
    lines.push("Chat WA closing dari CS belum diisi untuk periode ini (isi di atas laporan).");
  }
  report.highlights = [...report.highlights.slice(0, 1), ...lines, ...report.highlights.slice(1)].filter(Boolean);
  return report;
}

// ------------------------------------------------------------------ pilihan periode (toolbar)

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/**
 * Period picker above the report (hidden when printing), owner 23 Nov: "Bandingkan" per bulan / per
 * minggu / tanggal bebas, then two dropdowns (A dengan B). Changing "Bandingkan" reloads with that choice.
 */
export function reportPicker(q: ReportQuery, p: ReportPeriods, now = new Date()): string {
  // A chosen value outside the list (e.g. an older day) is added, so the dropdown never shows a wrong choice.
  const select = (name: string, list: { value: string; label: string }[], value: string, label: string, options = list.some((o) => o.value === value) ? list : [...list, { value, label: value }]) =>
    `<select name="${name}" aria-label="${esc(label)}">${options.map((o) => `<option value="${esc(o.value)}"${o.value === value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
  const modes = [
    { value: "hari", label: "Per hari" },
    { value: "bulan", label: "Per bulan" },
    { value: "minggu", label: "Per minggu" },
    { value: "bebas", label: "Tanggal bebas" },
  ];
  const date = (name: string, value: string | undefined, label: string) => `<input type="date" name="${name}" value="${esc(value ?? "")}" aria-label="${esc(label)}">`;
  let fields: string;
  if (p.mode === "hari") {
    const days = dayOptions(now);
    fields = `<span>Hari</span> ${select("hari", days, p.current.since, "Hari A")} <span>dengan</span> ${select("hari2", days, p.previous.since, "Hari B")}`;
  } else if (p.mode === "bulan") {
    const months = monthOptions(now);
    fields = `${select("bulan", months, p.current.since.slice(0, 7), "Bulan A")} <span>dengan</span> ${select("bulan2", months, p.previous.since.slice(0, 7), "Bulan B")}`;
  } else if (p.mode === "minggu") {
    const weeks = weekOptions(now);
    fields = `<span>Pekan</span> ${select("pekan", weeks, p.current.since, "Pekan A")} <span>dengan</span> ${select("pekan2", weeks, p.previous.since, "Pekan B")}`;
  } else {
    fields = `<span>A</span> ${date("since", q.since || p.current.since, "Periode A dari")}–${date("until", q.until || p.current.until, "Periode A sampai")} <span>dengan B</span> ${date("since2", q.since2, "Periode B dari")}–${date("until2", q.until2, "Periode B sampai")} <small>(B kosong = jumlah hari sama tepat sebelum A)</small>`;
  }
  // Switching "Bandingkan" submits only the new choice, so the other dropdowns start from their defaults.
  const modeSelect = `<label>Bandingkan <select name="mode" onchange="location.search='?mode='+this.value">${modes.map((m) => `<option value="${m.value}"${m.value === p.mode ? " selected" : ""}>${m.label}</option>`).join("")}</select></label>`;
  return `<form method="get" class="range">${modeSelect} ${fields}<button type="submit">Tampilkan</button><button type="submit" name="refresh" value="1" title="Data disimpan 10 menit; tekan untuk ambil yang terbaru dari Google">Ambil ulang data</button></form>`;
}

// ------------------------------------------------------------------ isian chat WA oleh CS

/**
 * The box CS fills above the report (owner, 24 Nov: pick the dates first, then only the chats that became a
 * booking; Google already counts the chats). Starts on the report's dates up to
 * yesterday; saving the same dates again corrects the numbers. Overlapping entries are never counted twice
 * (chatsInPeriod keeps the longest).
 */
export function chatForm(p: ReportPeriods, entries: ChatEntry[] | null): string {
  if (entries === null) return "";
  // Today is not over: the box starts at yesterday at the latest.
  const until = p.partial ? addDays(p.current.until, -1) : p.current.until;
  if (until < p.current.since) return "";
  const since = p.current.since;
  const saved = entries.find((e) => e.date_from === since && e.date_to === until);
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const keep = hidden("mode", p.mode) + hidden("from", p.current.since) + hidden("to", p.current.until) + hidden("vs", p.previous.since) + hidden("vsto", p.previous.until);
  const num = (name: string, label: string, value: number | null | undefined) => `<label>${label} <input name="${name}" inputmode="numeric" pattern="[0-9]{1,5}" size="4" required value="${value ?? ""}"></label>`;
  return `<form method="post" action="/marketing/laporan" class="range chat">${keep}<b>Chat WA dari CS</b><label>Dari <input type="date" name="chat_from" value="${esc(since)}" max="${esc(until)}" required></label><label>Sampai <input type="date" name="chat_to" value="${esc(until)}" max="${esc(until)}" required></label>${num("closing", "Chat closing (jadi booking)", saved?.chats_closing)}<button type="submit">Simpan</button><small>${saved ? "tanggal ini sudah diisi, simpan lagi untuk mengganti · " : ""}pilih tanggal dulu, lalu isi angka</small></form>`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Where the browser goes after saving: the same report. Anything that is not a known mode or a date is dropped. */
export function chatReturnUrl(form: FormData): string {
  const get = (k: string) => String(form.get(k) ?? "");
  const [mode, from, to, vs, vsto] = ["mode", "from", "to", "vs", "vsto"].map(get);
  const ok = (...d: string[]) => d.every((x) => ISO.test(x));
  const base = "/marketing/laporan";
  if (mode === "hari" && ok(from)) return `${base}?mode=hari&hari=${from}${ok(vs) ? `&hari2=${vs}` : ""}`;
  if (mode === "minggu" && ok(from)) return `${base}?mode=minggu&pekan=${from}${ok(vs) ? `&pekan2=${vs}` : ""}`;
  if (mode === "bulan" && ok(from)) return `${base}?mode=bulan&bulan=${from.slice(0, 7)}${ok(vs) ? `&bulan2=${vs.slice(0, 7)}` : ""}`;
  if (mode === "bebas" && ok(from, to)) return `${base}?mode=bebas&since=${from}&until=${to}${ok(vs, vsto) ? `&since2=${vs}&until2=${vsto}` : ""}`;
  return base;
}

/** True only for a form sent from the app's own pages (the session cookie alone is not proof of that). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
