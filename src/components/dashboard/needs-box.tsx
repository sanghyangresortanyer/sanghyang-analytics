import { cache } from "react";
import type { DataReminders } from "@/lib/dashboard/data-status";
import { needs } from "@/lib/dashboard/needs";
import { todayISO } from "@/lib/format-date";
import { adsBalanceData, marketingAccess, openChatWeek } from "@/lib/marketing/web";
import { NotificationBell } from "./notification-bell";

/** Marketing figures only for the property they belong to; anything unreadable is left out, never guessed. */
const marketing = cache(async () => {
  // marketingAccess() returns a refusal (Response) or null when allowed: any refusal shows no marketing figures.
  if (await marketingAccess()) return { balance: null, chatWeek: null };
  const [money, chatWeek] = await Promise.all([adsBalanceData(), openChatWeek().catch(() => null)]);
  return { balance: "error" in money ? null : money.balance, chatWeek };
});

/** The bell with what someone has to do next, most urgent first (needs.ts). */
export async function NeedsBell({ reminders }: { reminders: DataReminders | null }) {
  const n = needs({ today: todayISO(), reminders, ...(await marketing()) });
  return <NotificationBell items={n.items} note={n.note} />;
}

/** Shown while Google Ads is read; the list follows. */
export function NeedsBellLoading() {
  return <NotificationBell items={null} note={null} />;
}
