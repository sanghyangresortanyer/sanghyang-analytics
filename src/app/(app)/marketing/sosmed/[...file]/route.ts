import { marketingAccess, sosmedImage } from "@/lib/marketing/web";

/**
 * Promotion pictures. The login proxy skips .jpg/.png paths, so this route checks the session itself.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const refused = await marketingAccess();
  if (refused) return refused;
  try {
    const rel = (await params).file.map((p) => decodeURIComponent(p)).join("/");
    const img = sosmedImage(rel);
    if (!img) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(img.body), { headers: { "content-type": img.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
