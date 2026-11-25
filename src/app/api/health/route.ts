import { NextResponse } from "next/server";

/**
 * Liveness probe — tanpa dependensi eksternal, membalas HTTP 200 instan.
 */
export async function GET() {
  return NextResponse.json({ status: "ok", service: "sanghyang-analytics" }, { status: 200 });
}
