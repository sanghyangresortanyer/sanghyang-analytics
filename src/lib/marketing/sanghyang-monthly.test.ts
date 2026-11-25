import assert from "node:assert/strict";
import { test } from "vitest";
import type { Ga4Summary } from "./ga4.ts";
import type { CampaignRow } from "./google-ads.ts";
import { formatMonthlyReport, monthlyPeriods, type PeriodData, totals } from "./sanghyang-monthly.ts";

const ga4 = (wa: number, phone: number, purchase = 0, value = 0): Ga4Summary => ({
  whatsapp: { all: wa + 5, ads: wa },
  phone: { all: phone, ads: phone },
  checkout: { all: 0, ads: 0 },
  purchase: { all: purchase, ads: purchase },
  value: { all: value, ads: value },
});
const camp = (name: string, cost: number, clicks: number): CampaignRow => ({ id: "1", name, status: "ENABLED", channel: "SEARCH", budgetResource: "", budgetPerDay: 92000, budgetShared: false, bidding: "", cost, impressions: 0, clicks, conversions: 0, allConversions: 0 });

const current: PeriodData = {
  period: { since: "2026-11-01", until: "2026-11-15" },
  campaigns: [camp("MONTHLY PROMO", 1_000_000, 300), camp("Leads/ Booking", 500_000, 1000)],
  conversions: [
    { campaign: "MONTHLY PROMO", action: "Conversation started", conversions: 12, allConversions: 12 },
    { campaign: "MONTHLY PROMO", action: "Klik untuk menelepon", conversions: 0, allConversions: 2 },
    { campaign: "MONTHLY PROMO", action: "Booking", conversions: 74, allConversions: 74 },
    { campaign: "Leads/ Booking", action: "Sanghyang (web) whatsapp_click", conversions: 0, allConversions: 3 },
  ],
  ga4: ga4(10, 1, 1, 365000),
};
const untracked: Ga4Summary = { ...ga4(0, 0), whatsapp: { all: 0, ads: 0 } };
const previous: PeriodData = { period: { since: "2026-10-01", until: "2026-10-15" }, campaigns: [camp("MONTHLY PROMO", 1_200_000, 250)], conversions: [], ga4: untracked };

test("monthlyPeriods compares month-to-date with the same days of the previous month, and full months with full months", () => {
  assert.deepEqual(monthlyPeriods(undefined, new Date("2026-11-16T12:00:00Z")), { current: { since: "2026-11-01", until: "2026-11-15" }, previous: { since: "2026-10-01", until: "2026-10-15" }, complete: false });
  assert.deepEqual(monthlyPeriods("2026-10", new Date("2026-11-16T12:00:00Z")), { current: { since: "2026-10-01", until: "2026-10-31" }, previous: { since: "2026-09-01", until: "2026-09-30" }, complete: true });
  assert.deepEqual(monthlyPeriods(undefined, new Date("2026-03-31T12:00:00Z")).previous, { since: "2026-02-01", until: "2026-02-28" });
  assert.throws(() => monthlyPeriods("2026-13"), /YYYY-MM/);
  assert.throws(() => monthlyPeriods("2026-12", new Date("2026-11-16T12:00:00Z")), /no finished days/);
});

test("totals counts chats, calls and GA4 website clicks once, ignoring Booking and the Ads GA4 import", () => {
  const t = totals(current);
  assert.equal(t.contacts, 12 + 2 + 10 + 1);
  assert.equal(t.perContact, Math.round(1_500_000 / 25));
  assert.equal(t.bookings, 1);
  assert.equal(totals(previous).perContact, null);
  assert.equal(totals(previous).webTracked, false);
  assert.equal(t.webTracked, true);
});

test("formatMonthlyReport shows comparison, per-campaign contacts and data limits", () => {
  const text = formatMonthlyReport(current, previous, false);
  assert.match(text, /2026-11-01 s\/d 2026-11-15 \(bulan berjalan\)/);
  assert.match(text, /\| Biaya iklan \| Rp1\.500\.000 \| Rp1\.200\.000 \| \+25% \|/);
  assert.match(text, /\| \*\*Kontak Google \(chat \+ telepon\)\*\* \| 14 \| 0 \| baru \|/);
  assert.match(text, /\| Total kontak \(Google \+ website\) \| 25 \| 0 \| - \(definisi beda\) \|/);
  assert.match(text, /\| MONTHLY PROMO \| ENABLED \| Rp1\.000\.000 \| 300 \| 12 \| 2 \|/);
  assert.match(text, /MISSING: booking yang masuk lewat WA\/telepon/);
});
