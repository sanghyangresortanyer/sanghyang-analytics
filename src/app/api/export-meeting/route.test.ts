import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authState = vi.hoisted(() => ({
  user: null as { id: string; role: string; propertyId: string | null; propertyName: string | null; username: string } | null,
  meetingData: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth/role", () => ({
  currentUser: async () => authState.user,
}));

vi.mock("@/lib/actions/weekly-meeting", () => ({
  getWeeklyMeetingData: async () => authState.meetingData,
}));

vi.mock("@/lib/export/spreadsheet", () => ({
  buildWorkbook: async () => Buffer.from("PK-xlsx-test"),
}));

import { GET } from "./route";

describe("GET /api/export-meeting", () => {
  beforeEach(() => {
    authState.user = null;
    authState.meetingData = null;
  });

  it("returns 401 JSON with Cache-Control: no-store when user is not signed in", async () => {
    const res = await GET(new NextRequest("http://localhost:3001/api/export-meeting"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: false,
      error: "Sesi login telah berakhir. Silakan login ulang.",
    });
  });

  it("returns 200 workbook with Cache-Control: no-store for authenticated user", async () => {
    authState.user = {
      id: "user-1",
      role: "admin",
      propertyId: "prop-1",
      propertyName: "Sanghyang",
      username: "awi",
    };
    authState.meetingData = {
      meeting: {
        title: "Minggu 1",
        meeting_date: "2026-11-23",
        period_start: "2026-11-16",
        period_end: "2026-11-22",
        total_revenue: 1000,
        total_purchase: 500,
        total_inventory: 200,
        purchase_to_revenue_pct: 50,
        inventory_to_revenue_ratio: 0.2,
      },
      outlets: [],
      suppliers: [],
      purchaseItems: [],
      inventoryItems: [],
    };

    const res = await GET(new NextRequest("http://localhost:3001/api/export-meeting"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});
