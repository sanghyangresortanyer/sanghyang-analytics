import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/cron memvalidasi Authorization: Bearer <CRON_SECRET> sendiri; tanpa sesi browser.
const PUBLIC_PATHS = ["/login", "/api/health", "/api/cron"] as const;

function matchesPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  const isPublic = matchesPublicPath(pathname);
  const isApiRoute = pathname === "/api" || pathname.startsWith("/api/");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Fail-closed untuk API (dan seluruh halaman di produksi) saat konfigurasi Supabase belum diisi.
  if (!supabaseUrl || !supabasePublishableKey) {
    if (isPublic) return response;
    if (isApiRoute) {
      return NextResponse.json(
        { ok: false, error: "Konfigurasi autentikasi belum lengkap." },
        { status: 503 },
      );
    }
    if (process.env.NODE_ENV === "production") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims memverifikasi token ES256 di server ini dan hanya menghubungi Supabase saat token perlu disegarkan.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  if (!user && !isPublic) {
    if (isApiRoute) {
      return NextResponse.json(
        { ok: false, error: "Sesi login telah berakhir. Silakan login ulang." },
        { status: 401 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
