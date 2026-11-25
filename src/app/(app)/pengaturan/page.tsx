import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/config";
import { SetupNeeded } from "@/components/setup-needed";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGIN_USERS_TAG } from "@/lib/auth/login-users";
import { currentUser } from "@/lib/auth/role";
import { emailToUsername, isAppAccount } from "@/lib/auth/username";
import { withCache } from "@/lib/cache/cached";
import { CACHE_TTL } from "@/lib/cache/tags";
import { UserAdmin, type ManagedUser } from "./user-admin";
import { DataSources } from "./data-sources";
import { TargetSettings } from "./target-settings";
import { getOutletTargets } from "@/lib/dashboard/outlet-targets-query";
import { mergeTargets } from "@/lib/dashboard/outlet-targets";
import { getDivisionBudgets, getMenuRules, getRoomSettings } from "@/lib/dashboard/settings-query";
import { MenuRuleSettingsForm } from "./menu-rule-settings";
import { BudgetSettings } from "./budget-settings";
import { RoomTypeSettings } from "./room-type-settings";

export default async function PengaturanPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold text-slate-900">Pengaturan</h1>
        <SetupNeeded />
      </div>
    );
  }

  const me = await currentUser();
  // Staff and manager keep every weekly feature; only user management is closed.
  if (me?.role !== "admin") notFound();

  // ponytail: one page of accounts, paginate if this team ever passes 1000.
  const pid = me.propertyId;
  const [userListResult, targets, budgets, rooms, menuRules] = await Promise.all([
    withCache(
      async () => {
        const admin = createAdminClient();
        const [{ data: listed, error: listErr }, { data: profiles }] = await Promise.all([
          admin.auth.admin.listUsers({ perPage: 1000 }),
          admin.from("profiles").select("id, role"),
        ]);
        if (listErr) {
          return { users: [] as ManagedUser[], errorMessage: listErr.message };
        }
        const roleById = new Map((profiles ?? []).map((p) => [p.id, p.role as string]));
        const managed: ManagedUser[] = (listed?.users ?? [])
          .filter((u) => Boolean(u.email && isAppAccount(u.email)))
          .map((u) => ({
            id: u.id,
            username: emailToUsername(u.email!),
            role: roleById.get(u.id) ?? "staff",
            createdAt: u.created_at,
            active: !u.banned_until || new Date(u.banned_until) <= new Date(),
          }))
          .sort((a, b) => a.username.localeCompare(b.username, "id-ID"));
        return { users: managed, errorMessage: null as string | null };
      },
      ["pengaturan-managed-users"],
      { tags: [LOGIN_USERS_TAG], revalidate: CACHE_TTL.adminUsers },
    ),
    pid ? getOutletTargets(pid).then((t) => ({ t, error: null }), (e: Error) => ({ t: mergeTargets([]), error: e.message })) : null,
    pid ? getDivisionBudgets(pid).then((b) => ({ b, error: null }), (e: Error) => ({ b: null, error: e.message })) : null,
    pid ? getRoomSettings(pid).then((r) => ({ r, error: null }), (e: Error) => ({ r: null, error: e.message })) : null,
    pid ? getMenuRules(pid).then((m) => ({ m, error: null }), (e: Error) => ({ m: null, error: e.message })) : null,
  ]);
  const error = userListResult.errorMessage ? { message: userListResult.errorMessage } : null;
  const users = userListResult.users;

  return (
    <div className="w-full space-y-7">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900">Pengaturan</h1>
        <p className="mt-2 text-lg text-slate-600">
          Kelola akun pengguna Sanghyang Analytics, target outlet, budget belanja, jenis kamar, aturan menu, dan lihat sumber data dashboard. Hanya admin yang bisa membuka halaman ini.
        </p>
      </div>

      {error && <p className="text-base text-red-600">Daftar user tidak dapat dimuat: {error.message}</p>}

      {targets?.error && <p className="text-base text-red-600">Target tersimpan tidak dapat dimuat ({targets.error}); yang tampil angka awal.</p>}
      {targets && <TargetSettings targets={targets.t} />}

      {budgets?.error && <p className="text-base text-red-600">Budget tidak dapat dimuat: {budgets.error}</p>}
      {budgets?.b && <BudgetSettings budgets={budgets.b} />}

      {rooms?.error && <p className="text-base text-red-600">Daftar kamar tidak dapat dimuat: {rooms.error}</p>}
      {rooms?.r && <RoomTypeSettings rooms={rooms.r} />}

      {menuRules?.error && <p className="text-base text-red-600">Aturan menu tidak dapat dimuat: {menuRules.error}</p>}
      {menuRules?.m && <MenuRuleSettingsForm rules={menuRules.m} />}

      <UserAdmin users={users} currentUserId={me.id} />

      {me.propertyId && <DataSources propertyId={me.propertyId} />}
    </div>
  );
}
