import { HTML_HEADERS, marketingAccess, sosmedPage } from "@/lib/marketing/web";

export const dynamic = "force-dynamic";

/** Social media page (old /sosmed) for logged-in users. */
export async function GET(request: Request) {
  const refused = await marketingAccess();
  if (refused) return refused;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    return new Response(await sosmedPage(refresh), { headers: HTML_HEADERS });
  } catch (error) {
    return new Response(`Halaman sosmed gagal: ${(error as Error).message}`, { status: 500 });
  }
}
