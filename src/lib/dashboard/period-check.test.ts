import { describe, expect, it } from "vitest";
import { closingWarning, periodWarnings } from "./period-check";

const today = "2026-11-18";

describe("periodWarnings", () => {
  it("accepts a whole month, one closed day, and this month up to yesterday", () => {
    expect(periodWarnings("2026-01-01", "2026-01-31", today)).toEqual([]);
    expect(periodWarnings("2026-02-01", "2026-02-28", today)).toEqual([]);
    expect(periodWarnings("2026-11-17", "2026-11-17", today)).toEqual([]);
    expect(periodWarnings("2026-11-01", "2026-11-17", today)).toEqual([]);
  });

  it("flags a month that misses its 1st (February from 02/02)", () => {
    expect(periodWarnings("2026-02-02", "2026-02-28", today)).toEqual(["Mulai 02/02: tanggal 1 tidak ikut."]);
  });

  it("flags a closed month that stops before its last day", () => {
    expect(periodWarnings("2026-03-01", "2026-03-30", today)).toEqual(["Berakhir 30/03: akhir bulan (31/03) tidak ikut."]);
  });

  it("flags a period that runs through today", () => {
    expect(periodWarnings("2026-11-01", "2026-11-18", today)).toEqual(["Sampai 18/11: hari ini belum tutup. Tarik sampai tanggal kemarin."]);
  });
});

describe("closingWarning (owner 22 Nov: room revenue 0 on the last day = VHP has not closed that day)", () => {
  it("warns when the last day's room revenue is 0, and only then", () => {
    expect(closingWarning(0, "2026-11-21")).toBe(
      "Room revenue (Lodging) tanggal 21/11 masih 0: kemungkinan tutup hari (night audit) belum dijalankan. Data tanggal itu dianggap sementara; tarik ulang setelah tutup hari.",
    );
    expect(closingWarning(5_407_495, "2026-11-21")).toBeNull();
    expect(closingWarning(null, "2026-11-21")).toBeNull();
  });
});
