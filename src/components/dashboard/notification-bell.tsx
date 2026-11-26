"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { Need } from "@/lib/dashboard/needs";
import { cn } from "@/lib/utils";

const subscribeResize = (callback: () => void) => {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
};

const getNeedsSlot = () => {
  const el = document.getElementById("needs-slot");
  return el && el.offsetParent !== null ? el : null;
};

/**
 * One bell for what someone has to do next (owner, 24 Nov 2026: "dibuat jadi icon lonceng saja 1, diklik
 * muncul notifikasi"). The number shows how many; a click opens the list, Esc or a click outside closes it.
 * On a wide screen the list opens in the empty left column (#needs-slot, owner 25 Nov: "biar tidak menutup tampilan
 * lainnya"); on a phone, or a page without that column, it drops down under the bell.
 */
export function NotificationBell({ items, note }: { items: Need[] | null; note: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const panel = useId();
  const slot = useSyncExternalStore(
    subscribeResize,
    () => (open ? getNeedsSlot() : null),
    () => null,
  );

  useEffect(() => {
    if (!open) return;
    const inside = (t: Node) => !!(box.current?.contains(t) || list.current?.contains(t));
    const outside = (e: PointerEvent) => !inside(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const count = items?.length ?? 0;
  const content = (
    <>
      <p className="text-base font-semibold text-navy-900">Perlu dikerjakan</p>
      {items === null ? (
        <p className="mt-2 text-sm text-navy-600">Memeriksa…</p>
      ) : count === 0 ? (
        <p className="mt-2 text-sm text-navy-700">Tidak ada yang perlu dikerjakan sekarang.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((it, i) => (
            <li key={it.title} className={cn("rounded-2xl p-3", i === 0 ? "border-2 border-navy-900 bg-white" : "skeuo-inset")}>
              <p className="text-sm font-semibold text-navy-900">{it.title}</p>
              <p className="text-sm text-navy-700">{it.detail}</p>
              <Link href={it.href} prefetch={false} onClick={() => setOpen(false)} className={cn("mt-2 inline-flex min-h-9 items-center rounded-full px-4 text-sm font-semibold", i === 0 ? "skeuo-pill-dark" : "skeuo-pill-light")}>
                {it.action}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-3 text-sm text-navy-600">{note}</p>}
    </>
  );

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panel}
        aria-label={items === null ? "Notifikasi (memeriksa)" : count ? `Notifikasi: ${count} perlu dikerjakan` : "Notifikasi: tidak ada"}
        title="Notifikasi"
        className={cn("skeuo-pill-light relative flex h-14 w-14 items-center justify-center rounded-full", open && "ring-2 ring-navy-900")}
      >
        <Bell className="h-7 w-7" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-navy-900 bg-lemon px-1 text-sm font-bold text-navy-900">
            {count}
          </span>
        )}
      </button>
      {open && !slot && (
        <div ref={list} id={panel} role="dialog" aria-label="Notifikasi" className="skeuo-card absolute right-0 top-16 z-50 w-96 p-4 max-sm:fixed max-sm:inset-x-4 max-sm:top-20 max-sm:w-auto">
          {content}
        </div>
      )}
      {open &&
        slot &&
        createPortal(
          <div ref={list} id={panel} role="dialog" aria-label="Notifikasi" className="skeuo-card p-3">
            {content}
          </div>,
          slot,
        )}
    </div>
  );
}
