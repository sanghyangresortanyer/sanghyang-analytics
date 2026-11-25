import { chatReturnUrl, sameOrigin } from "@/lib/marketing/ads-report";
import { HTML_HEADERS, marketingAccess, saveChats, weeklyReportPage } from "@/lib/marketing/web";

export const dynamic = "force-dynamic";

/** Google Ads report, print-ready: ?mode=minggu|bulan|bebas, since/until (A), since2/until2 (B), bulan=YYYY-MM. */
export async function GET(request: Request) {
  const refused = await marketingAccess();
  if (refused) return refused;
  const q = new URL(request.url).searchParams;
  try {
    return new Response(await weeklyReportPage(Object.fromEntries(["mode", "since", "until", "since2", "until2", "bulan", "bulan2", "pekan", "pekan2", "hari", "hari2", "refresh"].map((k) => [k, q.get(k) || undefined]))), { headers: HTML_HEADERS });
  } catch (error) {
    return new Response(`Laporan tidak bisa dibuat: ${(error as Error).message}`, { status: 400 });
  }
}

/** CS's number of new WhatsApp chats for the day or week on screen; then back to the same report. */
export async function POST(request: Request) {
  const refused = await marketingAccess();
  if (refused) return refused;
  if (!sameOrigin(request)) return new Response("Permintaan ditolak. Buka halaman Marketing lalu isi lagi.", { status: 403 });
  const form = await request.formData();
  const problem = await saveChats(form);
  if (problem) return new Response(`${problem} Tekan tombol kembali di browser untuk memperbaiki.`, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(null, { status: 303, headers: { location: chatReturnUrl(form) } });
}
