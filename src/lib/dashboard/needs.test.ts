import { describe, expect, it } from "vitest";
import { dataReminders } from "./data-status";
import { needs } from "./needs";

const upload = (start: string, end: string, exported: string) => ({
  period_start: start, period_end: end, revenue_source: "fo", journal_filename: "a.txt", purchase_filename: "b.txt", revenue_filename: "c.txt", fo_journal_filename: "d.txt",
  revenue_exported_at: exported, journal_exported_at: exported, purchase_exported_at: exported, fo_journal_exported_at: exported,
});
const reminders = (today: string, end: string) => dataReminders({ today, meetings: [upload("2026-10-01", "2026-10-31", "2026-11-05T03:00:00Z"), upload("2026-11-01", end, `${today}T03:00:00Z`)], notConnected: [] });
const base = { today: "2026-11-24", reminders: null, balance: null, waImport: undefined };

describe("needs: the 'Perlu Anda' box", () => {
  it("is empty when nothing has to be done", () => {
    expect(needs(base).items).toEqual([]);
    expect(needs({ ...base, balance: { remaining: 9e6, daysLeft: 30 } }).items).toEqual([]);
    expect(needs({ ...base, balance: { remaining: 9e6, daysLeft: null } }).items).toEqual([]);
  });

  it("says on which day the ad balance ends and the last day to top up", () => {
    expect(needs({ ...base, balance: { remaining: 1_531_493, daysLeft: 6 } }).items).toEqual([
      { title: "Saldo iklan habis sekitar Senin 30 Nov", detail: "Sisa Rp1.531.493. Isi paling lambat Minggu 29 Nov.", href: "/marketing?bagian=google", action: "Lihat saldo" },
    ]);
    expect(needs({ ...base, balance: { remaining: 1000, daysLeft: 0 } }).items[0].detail).toContain("Isi sekarang");
  });

  it("lists the missing data after the balance, with what is missing", () => {
    const r = needs({ ...base, reminders: reminders("2026-11-24", "2026-11-22"), balance: { remaining: 1e6, daysLeft: 4 } });
    expect(r.items.map((i) => i.title)).toEqual(["Saldo iklan habis sekitar Sabtu 28 Nov", "Unggah data yang belum ada"]);
    expect(r.items[1].detail).toContain("Revenue (23 Nov)");
    expect(r.note).toBeNull();
  });

  it("puts data that is more than a week behind first", () => {
    const r = needs({ ...base, reminders: reminders("2026-11-24", "2026-11-10"), balance: { remaining: 1e6, daysLeft: 4 } });
    expect(r.items[0].title).toMatch(/^Sudah 13 hari data VHP belum diimport/);
  });

  it("complete but provisional data is a note, not a task", () => {
    const r = needs({ ...base, reminders: reminders("2026-11-24", "2026-11-23") });
    expect(r.items).toEqual([]);
    expect(r.note).toMatch(/masih sementara/);
  });

  it("asks for CS's booking file when it was never imported or is more than a week old", () => {
    expect(needs({ ...base, waImport: null }).items[0]).toMatchObject({ title: "Import file BOOKING BY WA", detail: "Belum pernah diimport.", action: "Import" });
    expect(needs({ ...base, waImport: "2026-11-16T05:00:00Z" }).items[0].detail).toBe("Terakhir diimport 16 Nov.");
    expect(needs({ ...base, waImport: "2026-11-20T05:00:00Z" }).items).toEqual([]);
    expect(needs(base).items, "not read (no Marketing access): nothing asked").toEqual([]);
  });
});
