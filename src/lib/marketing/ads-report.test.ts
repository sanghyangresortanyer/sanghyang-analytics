import assert from "node:assert/strict";
import { test } from "vitest";
import type { CampaignRow, ConversionRow, NetworkRow } from "./google-ads.ts";
import { addAdsExtras, campaignFunctions, chatForm, chatReturnUrl, sameOrigin, chatsInPeriod, clickSources, dayLabel, dayOptions, monthOptions, reportPeriods, reportPicker, weekLabel, weekOptions } from "./ads-report.ts";
import { googleWeeklyReport, type GoogleWeek, renderReports } from "./weekly-report.ts";

const sun = new Date("2026-11-22T12:00:00Z"); // Minggu 22 Nov 2026, 19.00 WIB

test("reportPeriods: per minggu, per bulan with the same number of days, and bebas A vs B (owner, 22 Nov)", () => {
  const week = reportPeriods({}, sun);
  assert.equal(week.mode, "minggu");
  assert.deepEqual([week.current, week.previous], [{ since: "2026-11-09", until: "2026-11-15" }, { since: "2026-11-02", until: "2026-11-08" }]);

  const month = reportPeriods({ mode: "bulan" }, sun);
  assert.deepEqual([month.current, month.previous], [{ since: "2026-11-01", until: "2026-11-21" }, { since: "2026-10-01", until: "2026-10-21" }], "this month up to yesterday vs the same dates last month");
  assert.deepEqual(month.labels, { prev: "Oktober 2026", curr: "November 2026" });
  const oct = reportPeriods({ mode: "bulan", bulan: "2026-10" }, sun);
  assert.deepEqual([oct.current, oct.previous], [{ since: "2026-10-01", until: "2026-10-30" }, { since: "2026-09-01", until: "2026-09-30" }], "September has 30 days, so October is cut to 30 too");
  const mar = reportPeriods({ mode: "bulan", bulan: "2026-03" }, sun);
  assert.deepEqual(mar.previous, { since: "2026-02-01", until: "2026-02-28" });
  assert.throws(() => reportPeriods({ mode: "bulan", bulan: "2026-12" }, sun), /belum ada data/);
  assert.throws(() => reportPeriods({ mode: "bulan", bulan: "2026-1" }, sun), /YYYY-MM/);

  const free = reportPeriods({ mode: "bebas", since: "2026-11-15", until: "2026-11-21", since2: "2026-10-15", until2: "2026-10-21" }, sun);
  assert.deepEqual([free.current, free.previous], [{ since: "2026-11-15", until: "2026-11-21" }, { since: "2026-10-15", until: "2026-10-21" }]);
  assert.match(reportPeriods({ mode: "bebas", since: "2026-11-15", until: "2026-11-21", since2: "2026-10-01", until2: "2026-10-31" }, sun).note ?? "", /Jumlah hari berbeda/);
  assert.deepEqual(reportPeriods({ mode: "bebas", since: "2026-11-15", until: "2026-11-21" }, sun).previous, { since: "2026-11-08", until: "2026-11-14" }, "B empty: same days right before A");
  assert.throws(() => reportPeriods({ mode: "bebas", since: "2026-11-15", until: "2026-11-21", since2: "2026-10-15" }, sun), /periode B/);
  const open = reportPeriods({ mode: "bebas" }, sun);
  assert.deepEqual([open.current, open.previous], [{ since: "2026-11-15", until: "2026-11-21" }, { since: "2026-11-08", until: "2026-11-14" }], "tab opened without dates: last 7 full days, not an error (owner, 23 Nov)");
  assert.throws(() => reportPeriods({ mode: "bebas", since: "2026-11-15" }, sun), /periode A/);
  assert.equal(reportPeriods({ since: "2026-11-15", until: "2026-11-21" }, sun).mode, "bebas", "old links keep working");
});

test("dropdowns: bulan A vs bulan B and pekan A vs pekan B, both cut to the same number of days (owner, 23 Nov)", () => {
  const m = reportPeriods({ mode: "bulan", bulan: "2026-11", bulan2: "2026-09" }, sun);
  assert.deepEqual([m.current, m.previous], [{ since: "2026-11-01", until: "2026-11-21" }, { since: "2026-09-01", until: "2026-09-21" }]);
  assert.deepEqual(m.labels, { prev: "September 2026", curr: "November 2026" });
  const full = reportPeriods({ mode: "bulan", bulan: "2026-08", bulan2: "2026-02" }, sun);
  assert.deepEqual([full.current.until, full.previous.until], ["2026-08-28", "2026-02-28"], "February has 28 days, so August is cut to 28");
  assert.throws(() => reportPeriods({ mode: "bulan", bulan: "2026-10", bulan2: "2026-10" }, sun), /berbeda/);

  const w = reportPeriods({ mode: "minggu", pekan: "2026-11-16", pekan2: "2026-10-19" }, new Date("2026-11-23T03:00:00Z"));
  assert.deepEqual([w.current, w.previous], [{ since: "2026-11-16", until: "2026-11-22" }, { since: "2026-10-19", until: "2026-10-25" }]);
  assert.deepEqual(w.labels, { prev: "Pekan 19–25 Okt", curr: "Pekan 16–22 Nov" });
  assert.throws(() => reportPeriods({ mode: "minggu", pekan: "2026-11-17" }, sun), /Senin|belum selesai/);
  assert.equal(weekLabel({ since: "2026-10-26", until: "2026-11-01" }), "26 Okt–1 Nov");

  assert.deepEqual(monthOptions(sun).slice(0, 2), [{ value: "2026-11", label: "November 2026" }, { value: "2026-10", label: "Oktober 2026" }]);
  assert.equal(monthOptions(sun).at(-1)?.value, "2026-01");
  assert.deepEqual(weekOptions(sun, "Asia/Jakarta", 2), [{ value: "2026-11-09", label: "9–15 Nov 2026" }, { value: "2026-11-02", label: "2–8 Nov 2026" }], "only finished weeks");
});

test("Harian uses the same report: yesterday vs the same weekday a week earlier, or two chosen days (owner, 23 Nov)", () => {
  const mon = new Date("2026-11-23T03:00:00Z"); // Senin 23 Nov, 10.00 WIB
  const d = reportPeriods({ mode: "hari" }, mon);
  assert.deepEqual([d.current, d.previous], [{ since: "2026-11-22", until: "2026-11-22" }, { since: "2026-11-15", until: "2026-11-15" }]);
  assert.deepEqual(d.labels, { prev: "Minggu 15 Nov", curr: "Minggu 22 Nov" });
  assert.equal(d.title, "Perbandingan iklan Google per hari");
  const pick = reportPeriods({ mode: "hari", hari: "2026-11-20", hari2: "2026-11-19" }, mon);
  assert.deepEqual([pick.current.since, pick.previous.since], ["2026-11-20", "2026-11-19"]);
  assert.throws(() => reportPeriods({ mode: "hari", hari: "2026-11-24" }, mon), /melewati hari ini/);
  assert.throws(() => reportPeriods({ mode: "hari", hari: "2026-11-20", hari2: "2026-11-20" }, mon), /berbeda/);
  assert.equal(dayLabel("2026-11-23"), "Senin 23 Nov");
  assert.deepEqual(dayOptions(mon, "Asia/Jakarta", 2), [{ value: "2026-11-22", label: "Minggu 22 Nov 2026" }, { value: "2026-11-21", label: "Sabtu 21 Nov 2026" }]);
  const html = reportPicker({ mode: "hari" }, d, mon);
  assert.ok(html.includes('<option value="hari" selected>Per hari</option>') && html.includes('<select name="hari2"') && html.includes('<option value="2026-11-15" selected>'));
});

test("chatsInPeriod sums CS entries inside the period and never counts a day twice", () => {
  const e = (date_from: string, date_to: string, chats_closing: number | null, chats_total: number | null) => ({ date_from, date_to, chats_closing, chats_total, chats_from_ads: null });
  const entries = [
    e("2026-11-16", "2026-11-22", 4, 30),
    e("2026-11-16", "2026-11-16", 1, 5), // inside the week above
    e("2026-11-09", "2026-11-09", 2, null),
    e("2026-11-14", "2026-11-16", 3, 9), // crosses the period start
  ];
  assert.deepEqual(chatsInPeriod(entries, { since: "2026-11-16", until: "2026-11-22" }), { closing: 4, total: 30, fromAds: null, days: 7, periodDays: 7 });
  assert.deepEqual(chatsInPeriod(entries, { since: "2026-11-09", until: "2026-11-15" }), { closing: 2, total: null, fromAds: null, days: 1, periodDays: 7 }, "an empty 'all chats' stays unknown");
  assert.deepEqual(chatsInPeriod([], { since: "2026-11-09", until: "2026-11-15" }), { closing: null, total: null, fromAds: null, days: 0, periodDays: 7 });
});
const camp = (name: string, channel: string, bidding: string, cost: number): CampaignRow => ({ id: name, name, status: "ENABLED", channel, budgetResource: "", budgetPerDay: 92000, budgetShared: false, bidding, cost, impressions: 1000, clicks: 100, conversions: 0, allConversions: 0 });
const net = (campaign: string, network: string, clicks: number, cost: number): NetworkRow => ({ campaign, network, clicks, impressions: clicks * 10, cost });
const conv = (campaign: string, action: string, n: number): ConversionRow => ({ campaign, action, conversions: n, allConversions: n });

test("campaignFunctions explains each campaign from its settings, clicks and results in plain words", () => {
  const t = campaignFunctions(
    [camp("MONTHLY PROMO", "SEARCH", "MAXIMIZE_CONVERSION_VALUE", 660000), camp("Leads/ Booking", "PERFORMANCE_MAX", "MAXIMIZE_CONVERSION_VALUE", 111000)],
    [conv("MONTHLY PROMO", "Conversation started", 9), conv("Leads/ Booking", "Local actions - Menu views", 20), conv("Leads/ Booking", "Booking", 3)],
    [net("MONTHLY PROMO", "SEARCH", 248, 660000), net("Leads/ Booking", "CONTENT", 239, 65000), net("Leads/ Booking", "DISCOVER", 168, 13000), net("Leads/ Booking", "YOUTUBE", 121, 31000), net("Leads/ Booking", "MAPS", 48, 1000)],
  );
  assert.equal(t.textCols, 4);
  assert.match(t.rows[0]![1]!, /Pencarian Google: muncul saat orang mengetik/);
  assert.equal(t.rows[0]![2], "Pencarian Google 248 (100%)");
  assert.equal(t.rows[0]![3], "chat WA dimulai 9");
  assert.match(t.rows[1]![1]!, /Performance Max/);
  assert.equal(t.rows[1]![2], "Situs & aplikasi mitra 239 (41%) · Discover & Gmail 168 (29%) · YouTube 121 (21%)");
  assert.equal(t.rows[1]![3], "lihat menu di Maps 20 · buka halaman booking 3");
  assert.equal(campaignFunctions([camp("X", "SEARCH", "", 1)], [], null).rows[0]![2], "Belum ada data");
});

test("contact totals are not compared when website clicks were tracked in only one period", () => {
  const r = googleWeeklyReport(gweek("2026-11-01", 900000, 10), gweek("2026-10-01", 600000, 5));
  addAdsExtras(r, {
    periods: reportPeriods({ mode: "bulan" }, sun),
    campaigns: [],
    conversions: [],
    networks: { curr: null, prev: null },
    chats: null,
    google: { chats: 10, webClicks: 3, cost: 900000, prevCost: 600000, perContact: 1, prevPerContact: 2, comparable: false },
  });
  const total = r.groups.flatMap((g) => g.rows).find((x) => x.metric === "Total orang menghubungi");
  assert.equal(total?.prev, null);
  assert.equal(total?.empty, "tidak setara");
  assert.match(total?.note ?? "", /belum tercatat di Oktober 2026/);
  assert.ok(r.highlights.includes("Biaya per orang menghubungi: Rp1 periode ini."));
});

test("clickSources puts both periods side by side per place the ads were shown", () => {
  const t = clickSources([net("A", "SEARCH", 90, 600000), net("B", "SEARCH", 10, 60000), net("B", "MAPS", 100, 100000)], [net("A", "SEARCH", 50, 400000)], { prev: "Pekan sebelumnya", curr: "Pekan ini" });
  assert.deepEqual(t.head, ["Tempat iklan tampil", "Klik Pekan sebelumnya", "Klik Pekan ini", "% klik", "Biaya Pekan ini", "Biaya per klik"]);
  assert.deepEqual(t.rows, [
    ["Pencarian Google", "50", "100", "50%", "Rp660.000", "Rp6.600"],
    ["Google Maps", "0", "100", "50%", "Rp100.000", "Rp1.000"],
  ]);
});

const ga4 = { whatsapp: { all: 3, ads: 2 }, phone: { all: 1, ads: 1 }, checkout: { all: 0, ads: 0 }, purchase: { all: 0, ads: 0 }, value: { all: 0, ads: 0 } };
const gweek = (since: string, cost: number, chats: number): GoogleWeek => ({
  period: { since, until: since },
  campaigns: [camp("MONTHLY PROMO", "SEARCH", "MAXIMIZE_CONVERSION_VALUE", cost)],
  conversions: [conv("MONTHLY PROMO", "Conversation started", chats)],
  ga4,
  traffic: { users: 100, engagementRate: 0.5, adsUsers: 60, adsEngagementRate: 0.4 },
});

test("addAdsExtras: CS chats next to Google's count (not added to contacts), new sections and numeric conclusions in the PDF", () => {
  const periods = reportPeriods({ mode: "bulan" }, sun);
  const r = googleWeeklyReport(gweek("2026-11-01", 900000, 10), gweek("2026-10-01", 600000, 5));
  addAdsExtras(r, {
    periods,
    campaigns: [camp("MONTHLY PROMO", "SEARCH", "MAXIMIZE_CONVERSION_VALUE", 900000)],
    conversions: [conv("MONTHLY PROMO", "Conversation started", 10)],
    networks: { curr: [net("MONTHLY PROMO", "SEARCH", 300, 900000)], prev: null },
    chats: { curr: { closing: 5, total: 25, fromAds: null, days: 21, periodDays: 21 }, prev: { closing: null, total: null, fromAds: null, days: 0, periodDays: 21 } },
    google: { chats: 10, webClicks: 3, cost: 900000, prevCost: 600000, perContact: 900000 / 14, prevPerContact: 600000 / 9, comparable: true },
  });
  const rows = r.groups.flatMap((g) => g.rows);
  const cs = rows.find((x) => x.metric === "Chat WA closing menurut CS");
  assert.equal(cs?.curr, 5);
  assert.equal(cs?.prev, null);
  assert.ok(!rows.some((x) => x.metric === "Chat WA baru menurut CS"), "all chats come from Google (owner, 24 Nov)");
  assert.equal(rows.find((x) => x.metric === "Total orang menghubungi")?.curr, 10 + 3, "CS chats are not added to Google's contacts");
  assert.equal(r.title, "Perbandingan iklan Google per bulan");
  assert.deepEqual(r.details.map((d) => d.title), ["Fungsi tiap kampanye", "Rincian per kampanye", "Asal klik iklan"]);
  assert.ok(r.highlights.includes("Biaya iklan naik 50%: Rp600.000 → Rp900.000."), "cost is neutral, never 'membaik'");
  assert.ok(r.highlights.some((h) => /^CS mencatat 5 chat closing \(jadi booking\) untuk 21 dari 21 hari\. Google mencatat 10 chat WA dimulai/.test(h)));
  const html = renderReports([r], sun, { toolbar: true, picker: reportPicker({ mode: "bulan" }, periods, sun) });
  assert.ok(html.includes("Oktober 2026<small>1–21 Okt · 21 hari</small>") && html.includes("November 2026<small>1–21 Nov · 21 hari</small>"));
  assert.ok(html.includes("3. Kesimpulan dari angka"));
  assert.ok(html.includes("Belum ada data"), "empty CS count says so");
  assert.ok(html.includes('<option value="2026-11" selected>November 2026</option>'), "bulan A dropdown");
  assert.ok(html.includes('<select name="bulan2"') && html.includes('<option value="bulan" selected>Per bulan</option>'));
  assert.ok(!html.includes("Pekan mulai Senin"), "the date box for the week is gone (owner, 23 Nov)");
});

test("chatForm: CS picks the dates, then only the closing chats (owner, 24 Nov)", () => {
  const mon = new Date("2026-11-24T03:00:00Z");
  const week = reportPeriods({ mode: "minggu", pekan: "2026-11-16" }, mon);
  const empty = chatForm(week, []);
  assert.ok(empty.includes('name="chat_from" value="2026-11-16"') && empty.includes('name="chat_to" value="2026-11-22"'), "starts on the report's dates");
  assert.ok(/name="closing"[^>]*required/.test(empty) && !empty.includes('name="total"'), "one number: closing");
  assert.ok(empty.includes('method="post"') && empty.includes('action="/marketing/laporan"'));
  const filled = chatForm(week, [{ date_from: "2026-11-16", date_to: "2026-11-22", chats_closing: 4, chats_total: 30, chats_from_ads: null }]);
  assert.ok(filled.includes('value="4"') && /sudah diisi/.test(filled), "the saved number can be corrected in place");
  const month = chatForm(reportPeriods({ mode: "bulan" }, mon), []);
  assert.ok(month.includes('name="chat_from" value="2026-11-01"') && month.includes('name="chat_to" value="2026-11-23"'), "also per month, up to yesterday");
  assert.equal(chatForm(reportPeriods({ mode: "hari", hari: "2026-11-24" }, mon), []), "", "today is not over yet");
  assert.equal(chatForm(week, null), "", "unreadable table: no form");
});

test("chatReturnUrl goes back to the same report and never carries unchecked text", () => {
  const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
  assert.equal(chatReturnUrl(form({ mode: "minggu", from: "2026-11-16", vs: "2026-11-09" })), "/marketing/laporan?mode=minggu&pekan=2026-11-16&pekan2=2026-11-09");
  assert.equal(chatReturnUrl(form({ mode: "hari", from: "2026-11-20", vs: "2026-11-13" })), "/marketing/laporan?mode=hari&hari=2026-11-20&hari2=2026-11-13");
  assert.equal(chatReturnUrl(form({ mode: "bulan", from: "2026-11-01", vs: "2026-10-01" })), "/marketing/laporan?mode=bulan&bulan=2026-11&bulan2=2026-10");
  assert.equal(chatReturnUrl(form({ mode: "bebas", from: "2026-11-01", to: "2026-11-10", vs: "2026-10-01", vsto: "2026-10-10" })), "/marketing/laporan?mode=bebas&since=2026-11-01&until=2026-11-10&since2=2026-10-01&until2=2026-10-10");
  assert.equal(chatReturnUrl(form({ mode: "//evil.example", from: "x&y", vs: "z" })), "/marketing/laporan");
});

test("sameOrigin only accepts a form sent from the app itself", () => {
  const req = (h: Record<string, string>) => new Request("https://analytics.example/marketing/laporan", { method: "POST", headers: h });
  assert.equal(sameOrigin(req({ origin: "https://analytics.example", host: "analytics.example" })), true);
  assert.equal(sameOrigin(req({ origin: "https://evil.example", host: "analytics.example" })), false);
  assert.equal(sameOrigin(req({ origin: "null", host: "analytics.example" })), false);
  assert.equal(sameOrigin(req({ host: "analytics.example" })), false, "no origin header: refused");
});
