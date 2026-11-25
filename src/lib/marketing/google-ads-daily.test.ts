import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { type DailyData, formatGoogleDaily, reminderLines } from "./google-ads-daily.ts";

const day = (cost: number, clicks: number, chats = 0, calls = 0, maps = 0) => ({ cost, clicks, chats, calls, maps });
function data(yesterday: { mp: [number, number, number]; lb?: [number, number] }, web: Record<string, number> = {}): DailyData {
  const days: DailyData["days"] = {};
  for (let i = 1; i <= 7; i++) days[`2026-11-${String(9 + i).padStart(2, "0")}`] = { "MONTHLY PROMO": day(80000, 30, 1, 0), "Local store visits": day(140000, 30, 0, 0, 20) };
  days["2026-11-17"] = { "MONTHLY PROMO": day(yesterday.mp[0], yesterday.mp[1], yesterday.mp[2]), ...(yesterday.lb ? { "Leads/ Booking": day(yesterday.lb[0], yesterday.lb[1]) } : {}) };
  return { days, web };
}

test("formatGoogleDaily compares yesterday with the 7-day average and lists campaigns", () => {
  const lines = formatGoogleDaily(data({ mp: [90000, 30, 3], lb: [20000, 80] }, { "2026-11-17": 1 }), "2026-11-17");
  assert.equal(lines[0], "SANGHYANG — GOOGLE ADS (kemarin 2026-11-17)");
  assert.match(lines[1] ?? "", /Kontak dari iklan: 4 ▲ \(chat 3, telepon 0, klik WA\/telp web 1\) · rata-rata 7 hari 1,0\/hari/);
  assert.ok(lines.some((l) => l.includes("MONTHLY PROMO: Rp90.000, 30 klik, chat 3")));
  assert.ok(!lines.some((l) => l.startsWith("⚠️")));
});

test("formatGoogleDaily warns on two days without contacts and on a CPC spike", () => {
  const d = data({ mp: [90000, 10, 0] });
  d.days["2026-11-16"] = { "MONTHLY PROMO": day(80000, 30, 0) };
  const lines = formatGoogleDaily(d, "2026-11-17");
  assert.ok(lines.includes("⚠️ 2 hari berturut-turut tanpa kontak dari iklan Google. Minta Claude mengecek."));
  assert.ok(lines.some((l) => l.startsWith("⚠️ Biaya per klik MONTHLY PROMO Rp9.000")));
});

test("reminderLines shows only today's reminders and survives a broken file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rem-"));
  const file = join(dir, "r.json");
  writeFileSync(file, JSON.stringify([{ date: "2026-11-22", text: "kerjakan C dan D" }, { date: "2026-11-23", text: "penilaian" }]));
  assert.deepEqual(reminderLines("2026-11-22", file), ["PENGINGAT HARI INI", "🔔 kerjakan C dan D"]);
  assert.deepEqual(reminderLines("2026-11-21", file), []);
  assert.deepEqual(reminderLines("2026-11-22", join(dir, "missing.json")), []);
  writeFileSync(file, "{rusak");
  assert.match(reminderLines("2026-11-22", file)[0] ?? "", /Pengingat tidak terbaca/);
});
