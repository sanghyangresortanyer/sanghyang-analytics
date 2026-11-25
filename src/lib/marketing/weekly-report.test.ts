import assert from "node:assert/strict";
import { test } from "vitest";
import type { Ga4Summary } from "./ga4.ts";
import type { CampaignRow } from "./google-ads.ts";
import { findBrowser } from "./pdf.ts";
import { change, changePoints, chosenPeriods, type GoogleWeek, googleWeeklyReport, rangePeriods, renderReports, renderWeeklyReport, shortRange, weekPeriods } from "./weekly-report.ts";

test("weekPeriods picks the last finished Monday–Sunday week and refuses an unfinished one", () => {
  const tue = new Date("2026-11-17T04:00:00Z");
  assert.deepEqual(weekPeriods(undefined, tue), { current: { since: "2026-11-09", until: "2026-11-15" }, previous: { since: "2026-11-02", until: "2026-11-08" } });
  assert.deepEqual(weekPeriods(undefined, new Date("2026-11-16T01:00:00Z")).current, { since: "2026-11-09", until: "2026-11-15" });
  assert.deepEqual(weekPeriods(undefined, new Date("2026-11-15T10:00:00Z")).current, { since: "2026-11-02", until: "2026-11-08" });
  assert.deepEqual(weekPeriods("2026-11-02", tue).previous, { since: "2026-10-26", until: "2026-11-01" });
  assert.throws(() => weekPeriods("2026-11-12", tue), /belum selesai/);
  assert.throws(() => weekPeriods("12-11-2026", tue), /YYYY-MM-DD/);
});

test("rangePeriods compares a chosen date range with the same number of days right before it", () => {
  const tue = new Date("2026-11-17T04:00:00Z");
  assert.deepEqual(rangePeriods("2026-11-13", "2026-11-16", tue), { current: { since: "2026-11-13", until: "2026-11-16" }, previous: { since: "2026-11-09", until: "2026-11-12" }, partialToday: false });
  assert.equal(rangePeriods("2026-11-01", "2026-11-17", tue).partialToday, true);
  assert.deepEqual(rangePeriods("2026-11-01", "2026-11-30", new Date("2026-12-05T04:00:00Z")).previous, { since: "2026-10-02", until: "2026-10-31" });
  assert.throws(() => rangePeriods("2026-11-16", "2026-11-13", tue), /sebelum atau sama/);
  assert.throws(() => rangePeriods("2026-11-13", "2026-11-18", tue), /melewati hari ini/);
  assert.throws(() => rangePeriods("2026-01-01", "2026-11-16", tue), /92 hari/);
  assert.throws(() => rangePeriods("2026-11-13'); DROP", "2026-11-16", tue), /YYYY-MM-DD/);
  assert.equal(chosenPeriods({}, tue), null, "no dates: each platform keeps its automatic period");
  assert.deepEqual(chosenPeriods({ since: "2026-11-02" }, tue)?.current, { since: "2026-11-02", until: "2026-11-08" });
  assert.match(chosenPeriods({ since: "2026-11-13", until: "2026-11-17" }, tue)?.note ?? "", /hari ini belum lengkap/);
  assert.throws(() => chosenPeriods({ until: "2026-11-16" }, tue), /tanggal mulai/);
});

const ga4 = (wa: number, phone: number, all = wa + phone): Ga4Summary => ({
  whatsapp: { all, ads: wa },
  phone: { all: 0, ads: phone },
  checkout: { all: 0, ads: 0 },
  purchase: { all: 1, ads: 0 },
  value: { all: 365000, ads: 0 },
});
const camp = (name: string, cost: number, clicks: number, impressions: number): CampaignRow => ({ id: name, name, status: "ENABLED", channel: "SEARCH", budgetResource: "", budgetPerDay: 92000, budgetShared: false, bidding: "", cost, impressions, clicks, conversions: 0, allConversions: 0 });
const week = (since: string, chats: number, web: Ga4Summary): GoogleWeek => ({
  period: { since, until: since },
  campaigns: [camp("MONTHLY PROMO", 600000, 150, 2000)],
  conversions: [
    { campaign: "MONTHLY PROMO", action: "Conversation started", conversions: chats, allConversions: chats },
    { campaign: "MONTHLY PROMO", action: "Klik untuk menelepon", conversions: 0, allConversions: 1 },
    { campaign: "MONTHLY PROMO", action: "Booking", conversions: 40, allConversions: 40 },
    { campaign: "MONTHLY PROMO", action: "Tindakan lokal - Rute", conversions: 0, allConversions: 30 },
  ],
  ga4: web,
  traffic: { users: 1000, engagementRate: 0.4, adsUsers: 600, adsEngagementRate: 0.35 },
});

test("googleWeeklyReport counts only chats, calls and website contact clicks as contacts", () => {
  const r = googleWeeklyReport(week("2026-11-09", 5, ga4(3, 1)), week("2026-11-02", 10, ga4(0, 0, 0)));
  const rows = new Map(r.groups.flatMap((g) => g.rows).map((x) => [x.metric, x]));
  assert.equal(rows.get("Total orang menghubungi")?.curr, 5 + 1 + 3 + 1, "booking page clicks and Maps directions are not contacts");
  assert.equal(rows.get("Buka halaman booking")?.curr, 40);
  assert.equal(rows.get("Klik WA / telepon di website")?.prev, null, "untracked previous week shows no number");
  assert.equal(rows.get("Biaya per orang menghubungi")?.curr, 60000);
  assert.equal(rows.get("Total booking semua sumber")?.manual, true);
  assert.equal(r.kpis[2]?.value, "10");
  assert.match(r.highlights.join(" "), /booking website dari iklan 0/);
});

test("renderReports renders the Google report without an evaluation section, escapes text, toolbar only in the dashboard", () => {
  const curr = week("2026-11-09", 5, ga4(3, 1));
  curr.campaigns = [camp("Promo <script>", 600000, 150, 2000)];
  const google = googleWeeklyReport(curr, week("2026-11-02", 10, ga4(0, 0, 0)));
  const html = renderReports([google], new Date("2026-11-17T04:00:00Z"));
  assert.equal((html.match(/<div class="page">/g) ?? []).length, 1);
  assert.ok(!html.includes("Evaluasi &amp; rencana") && !html.includes("Rencana optimasi"));
  assert.equal((html.match(/diisi manual/g) ?? []).length, 2, "total booking × 2 periods");
  assert.ok(html.includes("Promo &lt;script&gt;") && !html.includes("Promo <script>"));
  assert.ok(!html.includes('class="toolbar"'));
  const withToolbar = renderWeeklyReport(google, new Date(), { toolbar: true });
  assert.ok(withToolbar.includes('class="toolbar"') && !withToolbar.includes("Kembali ke dashboard"));
  const filtered = renderReports([google], new Date(), { toolbar: true, range: { since: "2026-11-13", until: "2026-11-16" } });
  assert.ok(filtered.includes('name="since" value="2026-11-13"') && filtered.includes('name="until" value="2026-11-16"') && filtered.includes('href="?">Otomatis'));
});

test("findBrowser prefers CHROME_PATH and otherwise the first installed browser", () => {
  assert.equal(findBrowser({ CHROME_PATH: "X:/chrome.exe" }, (p) => p === "X:/chrome.exe"), "X:/chrome.exe");
  assert.equal(findBrowser({ CHROME_PATH: "X:/missing.exe" }, () => false), null);
  assert.equal(findBrowser({}, (p) => p.endsWith("msedge.exe")), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe");
});

test("a percentage changes in points, not in percent", () => {
  assert.deepEqual(changePoints(28.3, 32.0, "up"), { text: "▲ +3,7 poin", verdict: "membaik", tone: "good" });
  assert.deepEqual(changePoints(32, 28.3, "up"), { text: "▼ -3,7 poin", verdict: "memburuk", tone: "bad" });
  assert.deepEqual(changePoints(30, 30.01, "up"), { text: "0 poin", verdict: "tetap", tone: "neutral" });
  assert.deepEqual(changePoints(null, 30, "up"), { text: "–", verdict: "", tone: "neutral" });
});

test("change says whether a rise or fall is good, bad or neutral", () => {
  assert.deepEqual(change(32, 19, "up"), { text: "▼ -41%", verdict: "memburuk", tone: "bad" });
  assert.deepEqual(change(1369, 937, "down"), { text: "▼ -32%", verdict: "membaik", tone: "good" });
  assert.deepEqual(change(663, 969, "up"), { text: "▲ +46%", verdict: "membaik", tone: "good" });
  assert.deepEqual(change(105, 64), { text: "▼ -39%", verdict: "turun, netral", tone: "neutral" });
  assert.deepEqual(change(null, 5, "up"), { text: "–", verdict: "", tone: "neutral" });
  assert.deepEqual(change(0, 2, "up"), { text: "baru", verdict: "pembanding 0", tone: "neutral" });
});

test("column headers carry the dates and day count; partial periods are labelled", () => {
  assert.equal(shortRange({ since: "2026-11-02", until: "2026-11-08" }), "2–8 Nov · 7 hari");
  assert.equal(shortRange({ since: "2026-10-28", until: "2026-11-03" }), "28 Okt–3 Nov · 7 hari");
  assert.equal(shortRange({ since: "2025-12-29", until: "2026-01-04" }), "29 Des 2025–4 Jan · 7 hari");
  const r = googleWeeklyReport(week("2026-11-13", 5, ga4(3, 1)), week("2026-11-09", 10, ga4(0, 0, 0)));
  r.period = { since: "2026-11-13", until: "2026-11-16" };
  r.previous = { since: "2026-11-09", until: "2026-11-12" };
  r.partial = true;
  const html = renderWeeklyReport(r);
  assert.ok(html.includes("Periode lalu<small>9–12 Nov · 4 hari</small>"));
  assert.ok(html.includes("Periode ini<small>13–16 Nov · 4 hari · belum lengkap</small>"));
  assert.ok(html.includes("@media print{body{font-size:10.5px}.toolbar,.screen-only{display:none}"));
  assert.match(html, /Hijau = membaik/);
});

test("tables marked last and then the conclusions close the report (owner, 24 Nov)", () => {
  const r = googleWeeklyReport(week("2026-11-09", 5, ga4(3, 1)), week("2026-11-02", 10, ga4(0, 0, 0)));
  const table = (title: string, last?: boolean) => ({ title, head: ["A"], rows: [["1"]], ...(last ? { last } : {}) });
  r.details = [table("Fungsi tiap kampanye", true), table("Asal klik iklan"), table("Apakah tiap kampanye berpengaruh", true)];
  r.highlights = ["Satu kesimpulan."];
  const html = renderReports([r]);
  const at = (s: string) => html.indexOf(s);
  assert.ok(at("Asal klik iklan") < at("Fungsi tiap kampanye"));
  assert.ok(at("Fungsi tiap kampanye") < at("Apakah tiap kampanye berpengaruh"));
  assert.ok(at("Apakah tiap kampanye berpengaruh") < at("Kesimpulan dari angka"));
  assert.ok(at("Kesimpulan dari angka") < at("Perlu diketahui"));
});
