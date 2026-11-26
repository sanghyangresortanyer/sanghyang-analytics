import { currentUser } from "@/lib/auth/role";
import { resortReportPage } from "@/lib/resort/resort-data";

export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  // Shown in an iframe of the Sanghyang Analytics Laporan Resort page: only this app itself may frame it.
  "content-security-policy": "frame-ancestors 'self'; form-action 'self'",
  "x-frame-options": "SAMEORIGIN",
};

/** Laporan Resort, print-ready: ?mode=bulan|minggu|hari|bebas and the same dates as the Google Ads report. */
export async function GET(request: Request) {
  if (!(await currentUser())) return new Response("Silakan login.", { status: 401 });
  const q = new URL(request.url).searchParams;
  try {
    const query = Object.fromEntries(["mode", "since", "until", "since2", "until2", "bulan", "bulan2", "pekan", "pekan2", "hari", "hari2"].map((k) => [k, q.get(k) || undefined]));
    return new Response(await resortReportPage(query), { headers: HEADERS });
  } catch (error) {
    return new Response(`Laporan tidak bisa dibuat: ${(error as Error).message}`, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
