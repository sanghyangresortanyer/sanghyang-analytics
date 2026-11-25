import { describe, it, expect } from "vitest";
import { formatDateID, formatPeriodShort, todayISO } from "./format-date";

describe("formatDateID", () => {
  it("formats a plain YYYY-MM-DD string without timezone shift", () => {
    expect(formatDateID("2026-09-04")).toBe("04/09/2026");
  });

  it("formats a full ISO timestamp using its local calendar date", () => {
    const d = new Date(2026, 8, 4, 10, 30);
    expect(formatDateID(d.toISOString())).toBe(formatDateID(d));
  });

  it("formats a Date object with zero-padded day/month", () => {
    expect(formatDateID(new Date(2026, 0, 5))).toBe("05/01/2026");
  });
});

describe("todayISO", () => {
  it("uses the Jakarta calendar date, not UTC", () => {
    // 16:59Z = 23:59 WIB, masih tanggal 8 — satu menit kemudian sudah tanggal 9.
    expect(todayISO(new Date("2026-09-08T16:59:59Z"))).toBe("2026-09-08");
    expect(todayISO(new Date("2026-09-08T17:00:00Z"))).toBe("2026-09-09");
  });

  it("zero-pads month and day", () => {
    expect(todayISO(new Date("2026-01-05T03:00:00Z"))).toBe("2026-01-05");
  });
});

describe("formatPeriodShort", () => {
  it("labels a period within one month and across months", () => {
    expect(formatPeriodShort("2026-11-01", "2026-11-14")).toBe("1–14 Nov");
    expect(formatPeriodShort("2026-10-28", "2026-11-03")).toBe("28 Okt – 3 Nov");
  });
});
