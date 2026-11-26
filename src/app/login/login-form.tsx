"use client";

import { ChevronDown, CircleAlert, Eye, EyeOff } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/actions/auth";
import styles from "./login.module.css";

export function LoginForm({ usernames }: { usernames: string[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signIn, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const exiting = !!state?.ok;
  const hasList = usernames.length > 0;
  const invalid = state?.error ? true : undefined;
  const describedBy = state?.error ? "login-error" : undefined;

  // Warm the dashboard while the user types, then go straight there on success.
  useEffect(() => {
    router.prefetch("/");
  }, [router]);
  useEffect(() => {
    if (exiting) router.replace("/");
  }, [exiting, router]);

  return (
    <div className="w-full max-w-sm">
      <h2 className={styles.heading}>Masuk</h2>
      <p className={styles.help}>
        {hasList ? "Pilih nama Anda, lalu masukkan password." : "Masukkan username dan password Anda."}
      </p>

      <form action={formAction} className="mt-8 space-y-7">
        <div>
          <label className={styles.label} htmlFor="username">
            User
          </label>
          <div className="relative mt-1">
            {hasList ? (
              <>
                <select
                  id="username"
                  name="username"
                  required
                  defaultValue=""
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={() => passwordRef.current?.focus()}
                  className={`${styles.field} ${styles.select}`}
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
                <ChevronDown aria-hidden className={styles.chevron} size={18} />
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
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className={styles.field}
              />
            )}
          </div>
        </div>

        <div>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <div className="relative mt-1">
            <input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder="Masukkan password"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              className={`${styles.field} ${styles.password}`}
            />
            <button
              type="button"
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              onClick={() => setShowPassword((v) => !v)}
              className={styles.reveal}
            >
              {showPassword ? <EyeOff aria-hidden size={18} /> : <Eye aria-hidden size={18} />}
            </button>
          </div>
        </div>

        {state?.error && (
          <p id="login-error" role="alert" className={styles.alert}>
            <CircleAlert aria-hidden className="mt-0.5 shrink-0" size={18} />
            <span>{state.error}</span>
          </p>
        )}

        <button type="submit" disabled={pending || exiting} className={styles.submit}>
          {exiting ? "Membuka dashboard…" : pending ? "Memproses…" : "Masuk"}
        </button>
      </form>
    </div>
  );
}
