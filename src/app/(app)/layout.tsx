import { cookies } from "next/headers";
import { IconRail, TopBar } from "@/components/app-chrome";
import { KNOWLEDGE_GRAPH_NAV_COOKIE, knowledgeGraphNavShown } from "@/components/app-nav";
import { currentUser } from "@/lib/auth/role";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, jar] = await Promise.all([currentUser(), cookies()]);
  const showKnowledgeGraph = knowledgeGraphNavShown(jar.get(KNOWLEDGE_GRAPH_NAV_COOKIE)?.value);
  return (
    <div className="skeuo-backdrop min-h-screen w-full p-2 sm:p-3 md:p-5">
      <div className="skeuo-canvas flex min-h-[calc(100vh-2.5rem)] flex-col gap-4 p-3 md:flex-row md:gap-6 md:p-5">
        <IconRail isAdmin={me?.role === "admin"} showKnowledgeGraph={showKnowledgeGraph} />
        <main className="min-w-0 flex-1 pb-24 lg:pb-4">
          <TopBar username={me?.username ?? ""} role={me?.role ?? "staff"} propertyName={me?.propertyName ?? null} />
          {children}
        </main>
      </div>
    </div>
  );
}
