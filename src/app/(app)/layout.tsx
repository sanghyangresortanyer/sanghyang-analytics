import { IconRail, TopBar } from "@/components/app-chrome";
import { currentUser } from "@/lib/auth/role";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  return (
    <div className="skeuo-backdrop min-h-screen w-full p-2 sm:p-3 md:p-5">
      <div className="skeuo-canvas flex min-h-[calc(100vh-2.5rem)] flex-col gap-4 p-3 md:flex-row md:gap-6 md:p-5">
        <IconRail isAdmin={me?.role === "admin"} />
        <main className="min-w-0 flex-1 pb-24 lg:pb-4">
          <TopBar username={me?.username ?? ""} role={me?.role ?? "staff"} propertyName={me?.propertyName ?? null} />
          {children}
        </main>
      </div>
    </div>
  );
}
