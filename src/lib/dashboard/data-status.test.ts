import { describe, expect, it } from "vitest";
import { compactDays, dataBanner, dataReminders, missingDays, supersededProvisional, uploadCoverage, type UploadPeriod } from "./data-status";

const m = (start: string, end: string, extra: Partial<UploadPeriod> = {}) => ({
  period_start: start,
  period_end: end,
  revenue_source: "fo" as const,
  journal_filename: "penjualan.txt",
  purchase_filename: "(Belum diunggah)",
  ...extra,
});

describe("missingDays", () => {
  it("lists every day no upload covers", () => {
    expect(missingDays([{ start: "2026-11-01", end: "2026-11-02" }, { start: "2026-11-04", end: "2026-11-04" }], "2026-11-01", "2026-11-05")).toEqual([
      "2026-11-03",
      "2026-11-05",
    ]);
  });
});

describe("compactDays", () => {
  it("joins runs of days", () => {
    expect(compactDays(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-17"])).toBe("1–3 Nov, 17 Nov");
    expect(compactDays([])).toBe("");
    expect(compactDays(["2026-11-30", "2026-12-01"])).toBe("30 Nov–1 Des");
  });
});

describe("uploadCoverage", () => {
  it("counts revenue only from Turnover uploads and purchases only when a purchase file was given", () => {
    const c = uploadCoverage([
      m("2026-11-01", "2026-11-16", { purchase_filename: "Pembelian1.txt", journal_filename: null }),
      m("2026-11-17", "2026-11-17"),
      m("2026-11-18", "2026-11-18", { revenue_source: "journal" }),
    ]);
    expect(c.revenue.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: "2026-11-01", end: "2026-11-16" },
      { start: "2026-11-17", end: "2026-11-17" },
    ]);
    expect(c.sales.map((s) => s.start)).toEqual(["2026-11-17", "2026-11-18"]);
    expect(c.purchase.map(({ start, end }) => ({ start, end }))).toEqual([{ start: "2026-11-01", end: "2026-11-16" }]);
  });

  it("never counts a placeholder file name as data (22 Nov: an upload written outside the app hid missing days)", () => {
    const c = uploadCoverage([m("2026-11-01", "2026-11-21", { journal_filename: "(Belum diunggah)", fo_journal_filename: "(Belum diunggah)" })]);
    expect(c.sales).toEqual([]);
    expect(c.foJournal).toEqual([]);
  });
});

describe("dataReminders", () => {
  it("lists every source with the days still missing up to yesterday", () => {
    const r = dataReminders({
      today: "2026-11-18",
      meetings: [m("2026-11-01", "2026-11-16", { purchase_filename: "Pembelian1.txt" }), m("2026-11-17", "2026-11-17")],
      notConnected: ["Liquor"],
      hkThrough: "2026-11-16",
    });
    expect(r.through).toBe("2026-11-17");
    expect(r.complete).toBe(false);
    expect(r.groups).toEqual([
      {
        name: "VHP",
        items: [
          { label: "Revenue", missing: null },
          { label: "Penjualan per Artikel", missing: null },
          // No print time known for these uploads, so the weekly re-export is due.
          { label: "Pembelian", missing: "17 Nov · ekspor ulang dari tgl 1" },
          { label: "F/O Journal", missing: "1–17 Nov" },
        ],
      },
      {
        name: "Google Sheets",
        items: [
          { label: "HK", missing: "17 Nov" },
          { label: "Liquor", missing: "belum tersambung" },
        ],
      },
    ]);
  });

  it("marks a day as not closed when its only report was printed that same day", () => {
    const r = dataReminders({
      today: "2026-11-18",
      meetings: [
        m("2026-11-01", "2026-11-16", { purchase_filename: "p.txt" }),
        // Receiving List 1-17 printed 17 Nov 12:01 WIB: 17 Nov is not closed yet.
        { ...m("2026-11-01", "2026-11-17", { purchase_filename: "p2.txt", revenue_source: null, journal_filename: null }), revenue_filename: "(Belum diunggah)", purchase_exported_at: "2026-11-17T05:01:29+00:00" },
        { ...m("2026-11-17", "2026-11-17"), revenue_exported_at: "2026-11-18T05:20:00+00:00" },
      ],
      notConnected: [],
    });
    expect(r.groups[0].items).toEqual([
      { label: "Revenue", missing: null },
      { label: "Penjualan per Artikel", missing: null },
      { label: "Pembelian", missing: "17 Nov belum tutup" },
      { label: "F/O Journal", missing: "1–17 Nov" },
    ]);
  });

  it("asks for a weekly re-export of purchases", () => {
    const upload = (printed: string) => ({
      ...m("2026-11-01", "2026-11-17", { purchase_filename: "p.txt", revenue_source: null, journal_filename: null }),
      revenue_filename: "(Belum diunggah)",
      purchase_exported_at: printed,
    });
    const fresh = dataReminders({ today: "2026-11-24", meetings: [upload("2026-11-18T08:21:01+00:00")], notConnected: [] });
    expect(fresh.groups[0].items[2]).toEqual({ label: "Pembelian", missing: "18–23 Nov" });
    const stale = dataReminders({ today: "2026-11-25", meetings: [upload("2026-11-18T08:21:01+00:00")], notConnected: [] });
    expect(stale.groups[0].items[2].missing).toBe("18–24 Nov · ekspor ulang dari tgl 1 (terakhir 18 Nov)");
  });

  it("on the 1st checks the whole previous month", () => {
    const r = dataReminders({ today: "2026-12-01", meetings: [], notConnected: [] });
    expect(r.from).toBe("2026-11-01");
    expect(r.groups[0].items[0]).toEqual({ label: "Revenue", missing: "1–30 Nov" });
  });
});

describe("dataReminders behind", () => {
  it("counts the days since the last revenue day, up to yesterday", () => {
    const r = dataReminders({ today: "2026-11-20", meetings: [m("2026-11-01", "2026-11-17")], notConnected: [] });
    expect(r.behind).toEqual({ days: 2, from: "2026-11-18", to: "2026-11-19", text: "18–19 Nov" });
  });

  it("is null when revenue reaches yesterday", () => {
    expect(dataReminders({ today: "2026-11-18", meetings: [m("2026-11-01", "2026-11-17")], notConnected: [] }).behind).toBeNull();
  });

  it("looks back past the start of the month", () => {
    const r = dataReminders({ today: "2026-12-02", meetings: [m("2026-11-01", "2026-11-28")], notConnected: [] });
    expect(r.behind).toMatchObject({ days: 3, from: "2026-11-29", to: "2026-12-01" });
  });

  it("is null without any revenue upload (nothing to count from)", () => {
    expect(dataReminders({ today: "2026-11-20", meetings: [], notConnected: [] }).behind).toBeNull();
  });
});

describe("dataBanner (owner 21–22 Nov: one banner; weekly uploads are provisional, the monthly one is final)", () => {
  const full = (extra = {}) => ({ purchase_filename: "Pembelian.txt", fo_journal_filename: "fo.txt", ...extra });
  // October uploaded complete, so last month never turns the banner red unless a test says so.
  const oct = m("2026-10-01", "2026-10-31", full({ purchase_exported_at: "2026-11-02T01:00:00Z" }));

  it("is red only when revenue is more than 7 days behind, and lists everything still to upload", () => {
    const b = dataBanner(dataReminders({ today: "2026-11-26", meetings: [oct, m("2026-11-01", "2026-11-17", full())], notConnected: ["Liquor"], hkThrough: "2026-11-25" }));
    expect(b).toMatchObject({ tone: "red", title: "Sudah 8 hari data VHP belum diimport (18–25 Nov)." });
    expect(b?.items.map((i) => i.label)).toEqual(["Revenue", "Penjualan per Artikel", "Pembelian", "F/O Journal"]);
    expect(b?.items[0]).toEqual({ label: "Revenue", missing: "18–25 Nov" });
  });

  it("is amber up to 7 days behind (weekly uploads)", () => {
    const b = dataBanner(dataReminders({ today: "2026-11-21", meetings: [oct, m("2026-11-01", "2026-11-17", full())], notConnected: [], hkThrough: "2026-11-20" }));
    expect(b).toMatchObject({ tone: "amber", title: "Data belum lengkap. Yang belum diunggah:" });
    expect(b?.items[0]).toEqual({ label: "Revenue", missing: "18–20 Nov" });
  });

  it("lists only what is left once revenue is in", () => {
    const b = dataBanner(
      dataReminders({
        today: "2026-11-21",
        meetings: [oct, m("2026-11-01", "2026-11-17", full()), m("2026-11-18", "2026-11-20", { fo_journal_filename: "fo.txt" })],
        notConnected: ["Liquor"],
        hkThrough: "2026-11-19",
      }),
    );
    expect(b).toMatchObject({ tone: "amber", title: "Data belum lengkap. Yang belum diunggah:" });
    expect(b?.items).toEqual([
      { label: "Pembelian", missing: "18–20 Nov · ekspor ulang dari tgl 1 (terakhir 2 Nov)" },
      { label: "HK", missing: "20 Nov" },
    ]);
  });

  it("when everything is in, still says this month is provisional; sheets without a link never count", () => {
    const meetings = [oct, m("2026-11-01", "2026-11-20", full({ purchase_exported_at: "2026-11-21T01:00:00Z" }))];
    const b = dataBanner(dataReminders({ today: "2026-11-21", meetings, notConnected: ["Liquor"], hkThrough: "2026-11-20" }));
    expect(b).toEqual({ tone: "amber", title: "Data Nov 2026 masih sementara. Angka resmi setelah upload bulan lengkap (1–30 Nov) di awal Desember.", items: [] });
    expect(dataBanner(null)).toBeNull();
  });

  it("turns red after the 5th when last month was not uploaded complete", () => {
    const octShort = m("2026-10-01", "2026-10-30", full({ purchase_exported_at: "2026-11-02T01:00:00Z" }));
    const nov = m("2026-11-01", "2026-11-05", full({ purchase_exported_at: "2026-11-06T01:00:00Z" }));
    const b = dataBanner(dataReminders({ today: "2026-11-06", meetings: [octShort, nov], notConnected: [] }));
    expect(b).toMatchObject({ tone: "red", title: "Data Okt 2026 belum lengkap (31 Okt). Upload ulang 1–31 Okt dari VHP untuk angka resmi bulan lalu." });
    // Up to the 5th the admin may still be correcting last month: not red yet.
    expect(dataBanner(dataReminders({ today: "2026-11-05", meetings: [octShort, nov], notConnected: [] }))?.tone).toBe("amber");
  });
});

describe("provisional days (owner 21 Nov: pulling through today is allowed, marked as not final)", () => {
  it("names today's VHP data as provisional in the banner, even when the rest is complete", () => {
    const meetings = [m("2026-10-01", "2026-10-31", { fo_journal_filename: "fo.txt", purchase_filename: "P.txt", purchase_exported_at: "2026-11-02T01:00:00Z" }), m("2026-11-01", "2026-11-21", { fo_journal_filename: "fo.txt", purchase_filename: "P.txt", revenue_exported_at: "2026-11-21T11:02:00Z", journal_exported_at: "2026-11-21T11:02:00Z", fo_journal_exported_at: "2026-11-21T11:02:00Z", purchase_exported_at: "2026-11-21T11:02:00Z" })];
    const r = dataReminders({ today: "2026-11-21", meetings, notConnected: [], hkThrough: "2026-11-20" });
    expect(r.provisional).toEqual(["Revenue", "Penjualan per Artikel", "Pembelian", "F/O Journal"]);
    const b = dataBanner(r);
    expect(b?.tone).toBe("amber");
    expect(b?.items).toEqual([
      { label: "Revenue", missing: "21 Nov sementara, tarik ulang besok" },
      { label: "Penjualan per Artikel", missing: "21 Nov sementara, tarik ulang besok" },
      { label: "Pembelian", missing: "21 Nov sementara, tarik ulang besok" },
      { label: "F/O Journal", missing: "21 Nov sementara, tarik ulang besok" },
    ]);
  });

  it("adds the note to a source that is also missing days", () => {
    const meetings = [m("2026-10-01", "2026-10-31", { fo_journal_filename: "fo.txt", purchase_filename: "P.txt" }), m("2026-11-01", "2026-11-17", { fo_journal_filename: "fo.txt", purchase_filename: "P.txt" }), m("2026-11-21", "2026-11-21", { journal_filename: null, revenue_exported_at: "2026-11-21T11:02:00Z" })];
    const b = dataBanner(dataReminders({ today: "2026-11-21", meetings, notConnected: [] }));
    expect(b?.items.find((i) => i.label === "Revenue")).toEqual({ label: "Revenue", missing: "18–20 Nov · 21 Nov sementara, tarik ulang besok" });
  });
});

describe("supersededProvisional (owner 21 Nov: a later pull replaces a not-final one)", () => {
  const up = (id: string, start: string, end: string, printed: string | null, kinds = { revenue: true, journal: true, purchase: false, foJournal: true }) => ({ id, start, end, printed, kinds });
  const mine = up("new", "2026-11-01", "2026-11-22", "2026-11-23");

  it("drops an upload of the same start whose last day was not closed when it was printed", () => {
    expect(supersededProvisional(mine, [up("a", "2026-11-01", "2026-11-21", "2026-11-21")])).toEqual(["a"]);
  });

  it("keeps final uploads, other starts, uploads with data the new one lacks, and unknown print days", () => {
    expect(
      supersededProvisional(mine, [
        up("final", "2026-11-01", "2026-11-20", "2026-11-21"),
        up("other-start", "2026-11-21", "2026-11-21", "2026-11-21"),
        up("has-purchase", "2026-11-01", "2026-11-21", "2026-11-21", { revenue: true, journal: true, purchase: true, foJournal: true }),
        up("unknown", "2026-11-01", "2026-11-21", null),
      ]),
    ).toEqual([]);
  });

  it("treats an upload whose last day was not closed (room revenue 0) as provisional, whenever it was pulled", () => {
    expect(supersededProvisional(mine, [{ ...up("a", "2026-11-01", "2026-11-21", "2026-11-22"), open: true }])).toEqual(["a"]);
  });

  it("does nothing when the new pull is itself not after that day", () => {
    expect(supersededProvisional(up("new", "2026-11-01", "2026-11-22", "2026-11-21"), [up("a", "2026-11-01", "2026-11-21", "2026-11-21")])).toEqual([]);
  });
});

describe("day not closed in VHP (owner 22 Nov: room revenue 0 on the last day although pulled the day after)", () => {
  it("keeps the last day 'belum tutup' when the report says its room revenue is still 0", () => {
    const meetings = [
      m("2026-11-01", "2026-11-21", { fo_journal_filename: "fo.txt", purchase_filename: "P.txt", revenue_exported_at: "2026-11-22T02:00:00Z", journal_exported_at: "2026-11-22T02:00:00Z", fo_journal_exported_at: "2026-11-22T02:00:00Z", purchase_exported_at: "2026-11-22T02:00:00Z", revenue_open_day: true }),
    ];
    const r = dataReminders({ today: "2026-11-22", meetings, notConnected: [] });
    expect(r.groups[0].items[0]).toEqual({ label: "Revenue", missing: "21 Nov belum tutup" });
  });
});
