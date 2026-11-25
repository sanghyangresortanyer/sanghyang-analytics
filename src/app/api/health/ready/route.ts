import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/config";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const READINESS_TIMEOUT_MS = 2000;

/**
 * Readiness probe — memeriksa konektivitas Supabase, PostgreSQL/Prisma (`SELECT 1`),
 * dan status konfigurasi AI (tanpa menyebut nama model) dalam batas waktu ketat 2,0 detik.
 */
export async function GET() {
  const gemini = { configured: Boolean(process.env.GEMINI_API_KEY?.trim()) };

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { status: "unconfigured", supabase: "unconfigured", database: "unchecked", gemini },
      { status: 503 },
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const checkSupabase = async (): Promise<boolean> => {
      const supabase = await createClient();
      const { error } = await supabase.from("properties").select("id").limit(1);
      // Pengunjung anon sengaja ditolak RLS (42501); penolakan tersebut membuktikan koneksi database aktif.
      return !error || error.code === "42501";
    };

    const checkPrisma = async (): Promise<boolean> => {
      await db.$queryRaw`SELECT 1`;
      return true;
    };

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Readiness timeout")), READINESS_TIMEOUT_MS);
    });

    const [supabaseOk, prismaOk] = await Promise.race([
      Promise.all([
        checkSupabase().catch(() => false),
        checkPrisma().catch(() => false),
      ]),
      timeout,
    ]);

    if (!supabaseOk || !prismaOk) {
      return NextResponse.json(
        {
          status: "degraded",
          supabase: supabaseOk ? "connected" : "disconnected",
          database: prismaOk ? "connected" : "disconnected",
          gemini,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        status: "ready",
        supabase: "connected",
        database: "connected",
        gemini,
      },
      { status: 200 },
    );
  } catch (err) {
    const timedOut = err instanceof Error && err.message === "Readiness timeout";
    return NextResponse.json(
      {
        status: "unavailable",
        ...(timedOut ? { error: "timeout" } : {}),
        gemini,
      },
      { status: 503 },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
