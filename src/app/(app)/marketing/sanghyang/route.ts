import { HTML_HEADERS, marketingAccess, sanghyangPage } from "@/lib/marketing/web";

export const dynamic = "force-dynamic";

/** Google Ads + GA4 page (old /sanghyang) for logged-in users. */
export async function GET(request: Request) {
  const refused = await marketingAccess();
  if (refused) return refused;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    return new Response(await sanghyangPage(refresh), { headers: HTML_HEADERS });
  } catch (error) {
    return new Response(`Halaman Google Ads gagal: ${(error as Error).message}`, { status: 500 });
  }
}
