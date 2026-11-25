import "server-only";
import { cache } from "react";
import { withPropertySupabaseCache } from "@/lib/cache/cached";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache/tags";
import { mergeBudgets, type DivisionBudget } from "./division-budgets";
import { mergeRoomTypes, type RoomSetting } from "./room-types";
import { dbarSplit } from "./dbar-split";
import { DEFAULT_MENU_RULES, type MenuRules } from "./menu-activity";

/** Every room with its type (Pengaturan → Jenis kamar), over the rooms seen in the F/O Journal. */
export const getRoomSettings = cache(async (propertyId: string): Promise<RoomSetting[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["room-settings"],
    tags: [CACHE_TAGS.settingsRooms(propertyId), CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.settings,
    query: async (supabase) => {
      const [rooms, saved] = await Promise.all([
        supabase.rpc("known_rooms", { p_property: propertyId }),
        supabase.from("room_types").select("room_no, room_type, version").eq("property_id", propertyId),
      ]);
      if (rooms.error) throw new Error(rooms.error.message);
      if (saved.error) throw new Error(saved.error.message);
      return mergeRoomTypes(((rooms.data ?? []) as { room_no: string }[]).map((r) => r.room_no), saved.data ?? []);
    },
  }),
);

/** Monthly purchase budget per division (Pengaturan → Budget belanja). */
export const getDivisionBudgets = cache(async (propertyId: string): Promise<DivisionBudget[]> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["division-budgets"],
    tags: [CACHE_TAGS.settingsBudgets(propertyId)],
    revalidate: CACHE_TTL.settings,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("division_budgets")
        .select("division, monthly_budget, version")
        .eq("property_id", propertyId);
      if (error) throw new Error(error.message);
      return mergeBudgets(data ?? []);
    },
  }),
);

/** Room revenue per room number in a period (F/O Journal). */
export const getRoomRevenue = cache(async (propertyId: string, from: string, to: string) =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["room-revenue", from, to],
    tags: [CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase.rpc("room_revenue_by_room", { p_property: propertyId, p_from: from, p_to: to });
      if (error) throw new Error(error.message);
      return ((data ?? []) as { room_no: string; revenue: unknown; room_nights: unknown; lodging: unknown }[]).map((r) => ({
        room_no: r.room_no,
        revenue: Number(r.revenue),
        room_nights: Number(r.room_nights),
        lodging: Number(r.lodging),
      }));
    },
  }),
);

/** d'Bar Karaoke & DBC split into DBC menus, d'Bar & Karaoke menus and discounts (migration 0074). */
export const getDbarSplit = cache(async (propertyId: string, from: string, to: string) =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["dbar-split", from, to],
    tags: [CACHE_TAGS.vhpSales(propertyId)],
    revalidate: CACHE_TTL.vhp,
    query: async (supabase) => {
      const { data, error } = await supabase.rpc("dbar_split", { p_property: propertyId, p_from: from, p_to: to });
      if (error) throw new Error(error.message);
      return dbarSplit((data ?? []) as { part: string; revenue: number | string; open_days: number }[]);
    },
  }),
);

export type MenuRuleSettings = MenuRules & { versions: Record<"dead_menu_days" | "slow_menu_days" | "slow_menu_below", number> };

/** Dead and rarely sold menu rules (Pengaturan → Aturan menu tidak laku); 90 days, 30 days, under 5 portions until saved. */
export const getMenuRules = cache(async (propertyId: string): Promise<MenuRuleSettings> =>
  withPropertySupabaseCache({
    propertyId,
    keyParts: ["menu-rules"],
    tags: [CACHE_TAGS.settingsMenuRules(propertyId)],
    revalidate: CACHE_TTL.settings,
    query: async (supabase) => {
      const { data, error } = await supabase
        .from("property_settings")
        .select("key, value, version")
        .eq("property_id", propertyId);
      if (error) throw new Error(error.message);
      const row = (key: string) => (data ?? []).find((r) => r.key === key) as { value: number | string; version: number } | undefined;
      const dead = row("dead_menu_days");
      const days = row("slow_menu_days");
      const below = row("slow_menu_below");
      const D = DEFAULT_MENU_RULES;
      return {
        deadDays: dead ? Number(dead.value) : D.deadDays,
        slowDays: days ? Number(days.value) : D.slowDays,
        slowBelow: below ? Number(below.value) : D.slowBelow,
        versions: { dead_menu_days: dead?.version ?? 0, slow_menu_days: days?.version ?? 0, slow_menu_below: below?.version ?? 0 },
      };
    },
  }),
);
