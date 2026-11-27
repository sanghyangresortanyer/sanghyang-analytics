// Items of the left rail and the switch that adds Knowledge Graph. Plain module (no "use client"), so the server layout
// and Pengaturan can read the cookie name while the rail itself stays a client component.
import { FileSpreadsheet, FileText, LayoutDashboard, Megaphone, Network, Settings, UploadCloud, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

export const KNOWLEDGE_GRAPH_HREF = "/knowledge-graph";

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload-mingguan", label: "Upload Data", icon: UploadCloud },
  { href: "/data-sheets", label: "Data Google Sheets", icon: FileSpreadsheet },
  { href: "/laporan-resort", label: "Laporan Resort", icon: FileText },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/pengaturan", label: "Pengaturan", icon: Settings, adminOnly: true },
  // Owner, 27 Nov 2026: only when "Tampilkan Knowledge Graph" is on in Pengaturan, right under Pengaturan.
  { href: KNOWLEDGE_GRAPH_HREF, label: "Knowledge Graph", icon: Network },
];

/** Per-browser choice from Pengaturan; read on the server so the rail is right on the first paint. */
export const KNOWLEDGE_GRAPH_NAV_COOKIE = "sa-nav-knowledge-graph";

/** The switch writes "1" for on and "0" for off; a missing or unknown value keeps the rail as it was before. */
export const knowledgeGraphNavShown = (value: string | undefined): boolean => value === "1";

export function visibleNavItems({ isAdmin, showKnowledgeGraph }: { isAdmin: boolean; showKnowledgeGraph: boolean }): NavItem[] {
  return NAV_ITEMS.filter((item) => (!item.adminOnly || isAdmin) && (item.href !== KNOWLEDGE_GRAPH_HREF || showKnowledgeGraph));
}
