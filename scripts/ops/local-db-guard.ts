/**
 * Penjaga untuk skrip pengumpul data yang menulis ke DB: hanya DB kerja lokal (PostgreSQL lokal sanghyang-analytics di
 * 127.0.0.1:55432, lihat AGENTS.md "Produksi tidak disentuh") yang boleh ditulis. Pengaman umum di src/lib/db.ts
 * menolak DB jarak jauh; penjaga ini juga menolak DB lokal lain (mis. Supabase lokal proyek lain di 54322).
 */
const LOCAL_WORK_DB = { hosts: new Set(["127.0.0.1", "localhost"]), port: "55432" };

export function assertLocalWorkDatabase(env: Record<string, string | undefined> = process.env): void {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL kosong; jalankan dengan --env-file=.env.development.local.");
  if (!URL.canParse(raw)) throw new Error("DATABASE_URL tidak terbaca sebagai URL.");
  const { hostname, port } = new URL(raw);
  // Hanya host dan port yang disebut di pesan; nama pengguna dan sandi tidak pernah dicetak.
  if (!LOCAL_WORK_DB.hosts.has(hostname) || port !== LOCAL_WORK_DB.port) {
    throw new Error(`Skrip ini hanya menulis ke DB kerja lokal 127.0.0.1:${LOCAL_WORK_DB.port}, bukan ${hostname}:${port || "(port bawaan)"}.`);
  }
}
