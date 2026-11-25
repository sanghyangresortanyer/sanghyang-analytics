"use client";

import { BarChart3, ChevronDown, Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/actions/auth";

const FIELD =
  "h-14 w-full rounded-xl border border-slate-300 bg-white pl-12 text-lg text-slate-900 outline-none placeholder:text-slate-500 focus:border-navy-600 focus:ring-2 focus:ring-navy-100";

export function LoginForm({ usernames }: { usernames: string[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signIn, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const exiting = !!state?.ok;

  // Warm the dashboard while the user types, then go straight there on success.
  useEffect(() => {
    router.prefetch("/");
  }, [router]);
  useEffect(() => {
    if (exiting) router.replace("/");
  }, [exiting, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 sm:p-12">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-navy-800 text-white">
            <BarChart3 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Sanghyang Analytics</h1>
            <p className="text-base text-slate-600">Revenue, Pembelian, Inventory &amp; Pemasaran</p>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-8">
          <h2 className="text-2xl font-semibold text-slate-900">Masuk ke Dashboard</h2>
          <p className="mt-2 text-lg text-slate-600">Pilih nama Anda, lalu masukkan password.</p>

          <form action={formAction} className="mt-8 space-y-6">
            <div>
              <label className="block text-base font-semibold text-slate-800" htmlFor="username">
                User
              </label>
              <div className="relative mt-2">
                <UserRound aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                {usernames.length > 0 ? (
                  <>
                    <select
                      id="username"
                      name="username"
                      required
                      defaultValue=""
                      onChange={() => passwordRef.current?.focus()}
                      className={`${FIELD} cursor-pointer appearance-none pr-12 capitalize`}
                    >
                      <option value="" disabled>
                        Pilih user…
                      </option>
                      {usernames.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" size={22} />
                  </>
                ) : (
                  // Fallback when the user list cannot be loaded: typing still works.
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    placeholder="Masukkan username"
                    className={`${FIELD} pr-4`}
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-base font-semibold text-slate-800" htmlFor="password">
                Password
              </label>
              <div className="relative mt-2">
                <LockKeyhole aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="Masukkan password"
                  className={`${FIELD} pr-14`}
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {state?.error && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-base font-medium text-rose-700">
                {state.error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending || exiting}
              className="h-14 w-full rounded-xl bg-navy-800 px-4 text-lg font-semibold text-white hover:bg-navy-900 disabled:opacity-60"
            >
              {exiting ? "Membuka dashboard…" : pending ? "Memproses…" : "Masuk"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
