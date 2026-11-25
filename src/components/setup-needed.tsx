export function SetupNeeded() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
      <h2 className="font-semibold text-amber-900">Supabase belum dikonfigurasi</h2>
      <p className="mt-2 text-base text-amber-800">
        Profil pengguna belum terhubung ke property. Hubungi admin untuk menautkan akun ini.
        <span className="mt-2 block">Isi <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
        <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>, dan{" "}
        <code className="rounded bg-amber-100 px-1">SUPABASE_SECRET_KEY</code> di{" "}
        <code className="rounded bg-amber-100 px-1">.env.local</code> (lihat{" "}
        <code className="rounded bg-amber-100 px-1">.env.example</code>), lalu jalankan migration di{" "}
        <code className="rounded bg-amber-100 px-1">supabase/migrations/0000_core_foundation.sql</code>.</span>
      </p>
    </div>
  );
}
