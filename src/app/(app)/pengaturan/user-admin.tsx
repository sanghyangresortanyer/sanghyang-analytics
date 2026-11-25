"use client";

import { DataTable } from "@/components/ui/data-table";
import { useActionState } from "react";
import { createUser, resetPassword, setUserActive, type UserActionState } from "@/lib/actions/users";
import { formatDateID } from "@/lib/format-date";

export type ManagedUser = {
  id: string;
  username: string;
  role: string;
  createdAt: string;
  active: boolean;
};

const INPUT = "h-9 rounded-lg border border-slate-300 px-3 text-base outline-none focus:border-navy-600 focus:ring-2 focus:ring-navy-100";

function Feedback({ state }: { state: UserActionState }) {
  if (state?.error) return <p className="text-base font-medium text-red-700">{state.error}</p>;
  if (state?.ok) return <p className="text-base font-medium text-emerald-700">{state.ok}</p>;
  return null;
}

function UserRow({ user, isSelf }: { user: ManagedUser; isSelf: boolean }) {
  const [resetState, resetAction, resetting] = useActionState(resetPassword, undefined);
  const [activeState, activeAction, switching] = useActionState(setUserActive, undefined);

  return (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <td className="px-3 py-2 font-medium text-slate-900">
        {user.username}
        {isSelf && <span className="ml-2 text-sm font-normal text-slate-500">(Anda)</span>}
      </td>
      <td className="px-3 py-2">{user.role}</td>
      <td className="px-3 py-2">{formatDateID(user.createdAt)}</td>
      <td className="px-3 py-2">
        {user.active ? (
          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-700">Aktif</span>
        ) : (
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-600">Nonaktif</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-start gap-2">
          <form action={resetAction} className="flex gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              placeholder="Password baru"
              aria-label={`Password baru untuk ${user.username}`}
              className={`${INPUT} w-40`}
            />
            <button type="submit" disabled={resetting} className="h-9 rounded-lg border border-slate-300 px-3 text-base font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              {resetting ? "Menyimpan..." : "Reset"}
            </button>
          </form>

          <form action={activeAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="activate" value={user.active ? "0" : "1"} />
            <button
              type="submit"
              disabled={switching || (user.active && isSelf)}
              title={user.active && isSelf ? "Tidak bisa menonaktifkan akun sendiri" : undefined}
              className={`h-9 rounded-lg px-3 text-base font-semibold disabled:opacity-50 ${
                user.active ? "border border-red-300 text-red-700 hover:bg-red-50" : "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              {switching ? "Memproses..." : user.active ? "Nonaktifkan" : "Aktifkan"}
            </button>
          </form>
        </div>
        <div className="mt-1 space-y-1">
          <Feedback state={resetState} />
          <Feedback state={activeState} />
        </div>
      </td>
    </tr>
  );
}

export function UserAdmin({ users, currentUserId }: { users: ManagedUser[]; currentUserId: string }) {
  const [createState, createAction, creating] = useActionState(createUser, undefined);

  return (
    <div className="space-y-7">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold text-slate-900">Buat User Baru</h2>
        <p className="mt-1 text-base text-slate-600">User cukup login memakai username dan password; email internal dibuat otomatis.</p>
        <form action={createAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="new-username" className="text-base font-semibold text-slate-800">Username</label>
            <input id="new-username" name="username" type="text" autoCapitalize="none" spellCheck={false} required className={`${INPUT} w-56`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-password" className="text-base font-semibold text-slate-800">Password</label>
            <input id="new-password" name="password" type="password" autoComplete="new-password" required className={`${INPUT} w-56`} />
          </div>
          <button type="submit" disabled={creating} className="h-9 rounded-lg bg-navy-800 px-4 text-base font-semibold text-white hover:bg-navy-900 disabled:opacity-50">
            {creating ? "Membuat..." : "Buat User"}
          </button>
        </form>
        <div className="mt-3">
          <Feedback state={createState} />
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="p-3">
          <DataTable
            rows={users}
            rowKey={(u) => u.id}
            empty="Belum ada user."
            initialSort={{ key: "username", dir: "asc" }}
            columns={[
              { key: "username", header: "Username", sort: (u) => u.username, render: () => null },
              { key: "role", header: "Peran", sort: (u) => u.role, render: () => null },
              { key: "created", header: "Dibuat", sort: (u) => u.createdAt, render: () => null },
              { key: "status", header: "Status", sort: (u) => (u.active ? 1 : 0), render: () => null },
              { key: "actions", header: "Aksi", render: () => null },
            ]}
            renderRow={(user) => <UserRow user={user} isSelf={user.id === currentUserId} />}
          />
        </div>
      </section>
    </div>
  );
}
