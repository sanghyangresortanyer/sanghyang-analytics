import { progressStreamResponse } from "@/lib/market/refresh-stream";
import { requireMarketingApiAccess } from "@/lib/marketing/api-auth";

export const dynamic = "force-dynamic";

/**
 * Aliran Server-Sent Events progres "Perbarui Semua Data" dari komputer lokal: keadaan saat tersambung, setiap perubahan
 * langkah, dan ping berkala. Klien yang terputus menyambung ulang dan langsung menerima keadaan terakhir.
 */
export async function GET(req: Request) {
  const refused = await requireMarketingApiAccess();
  if (refused) return refused;

  return progressStreamResponse(req.signal);
}
