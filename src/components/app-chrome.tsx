"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { FileSpreadsheet, LayoutDashboard, LogOut, Megaphone, Settings, UploadCloud, type LucideIcon } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { Bars } from "@/components/ui/bars";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon; adminOnly?: boolean }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload-mingguan", label: "Upload Data", icon: UploadCloud },
  { href: "/data-sheets", label: "Data Google Sheets", icon: FileSpreadsheet },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/pengaturan", label: "Pengaturan", icon: Settings, adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = { admin: "Admin", manager: "Manager", staff: "Staff" };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Spinner shown on the clicked nav item until the next page renders. */
function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Bars className="absolute -right-1 -top-1 h-3 w-3 text-lemon" />;
}

/** Who is signed in, and for which hotel; one quiet line above the page. */
export function TopBar({ username, role, propertyName }: { username: string; role: string; propertyName: string | null }) {
  return (
    <header className="mb-5 flex items-center gap-3 print:hidden">
      <div aria-hidden className="skeuo-knob flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold">
        {username.slice(0, 1).toUpperCase() || "?"}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold leading-tight text-navy-900">{propertyName ?? "Sanghyang Analytics"}</p>
        <p className="truncate text-sm text-navy-600">
          Selamat datang, {username || "tamu"} · {ROLE_LABEL[role] ?? role}
        </p>
      </div>
      <form action={signOut}>
        <button type="submit" title="Keluar" className="skeuo-pill-light inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold">
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Keluar</span>
          <span className="sr-only sm:hidden">Keluar</span>
        </button>
      </form>
    </header>
  );
}

/** Black rail of icons; the open page is lighter, with a lemon mark on its edge. */
export function IconRail({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);
  return (
    <nav
      aria-label="Menu utama"
      className="skeuo-pill-dark z-30 flex gap-2.5 rounded-[2.25rem] p-2.5 print:hidden max-md:justify-center md:sticky md:top-6 md:flex-col md:self-start md:p-3"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-14 w-14 items-center justify-center rounded-3xl",
              active ? "bg-white/20 text-white" : "text-navy-300 hover:bg-white/10 hover:text-white",
            )}
          >
            {active && <span aria-hidden className="absolute bg-lemon max-md:-bottom-2 max-md:h-1 max-md:w-6 max-md:rounded-full md:-left-3 md:h-6 md:w-1 md:rounded-r-full" />}
            <Icon className="h-6 w-6" />
            <span className="pointer-events-none absolute left-[72px] z-50 hidden whitespace-nowrap rounded-full bg-navy-900 px-3 py-1.5 text-sm font-semibold text-white shadow-md md:group-hover:block md:group-focus-visible:block">
              {item.label}
            </span>
            <NavPending />
          </Link>
        );
      })}
    </nav>
  );
}
