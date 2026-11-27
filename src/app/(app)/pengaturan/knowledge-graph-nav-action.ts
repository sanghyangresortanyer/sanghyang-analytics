"use server";

import { cookies } from "next/headers";
import { KNOWLEDGE_GRAPH_NAV_COOKIE } from "@/components/app-nav";
import { currentUser } from "@/lib/auth/role";

// Browsers cap a cookie's lifetime at 400 days (RFC 6265bis), so the choice lasts that long after its last change.
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export type KnowledgeGraphNavState = { ok?: string; error?: string };

/**
 * Pengaturan → Tampilkan Knowledge Graph. Only this browser remembers the choice (owner, 27 Nov 2026: no table, no env).
 * Setting the cookie makes Next re-render the layout in the same response, so the rail gains or drops the item at once.
 */
export async function saveKnowledgeGraphNav(show: boolean): Promise<KnowledgeGraphNavState> {
  const me = await currentUser();
  if (me?.role !== "admin") return { error: "Hanya admin yang bisa mengubah menu ini." };
  if (typeof show !== "boolean") return { error: "Pilihan tidak terbaca. Muat ulang halaman, lalu coba lagi." };
  (await cookies()).set(KNOWLEDGE_GRAPH_NAV_COOKIE, show ? "1" : "0", {
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: show ? "Knowledge Graph tampil di menu kiri, tepat di bawah Pengaturan." : "Knowledge Graph tidak lagi tampil di menu kiri." };
}
