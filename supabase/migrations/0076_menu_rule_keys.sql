-- Owner rules 2026-11-20: a menu is dead after 3 months without a sale (dead_menu_days, default 90) and
-- rarely sold below N portions in one month (slow_menu_days, default 30; slow_menu_below, default 5).
-- Replaces slow_menu_max from 0075 (never saved).
delete from public.property_settings where key = 'slow_menu_max';
alter table public.property_settings drop constraint if exists property_settings_key_check;
alter table public.property_settings add constraint property_settings_key_check check (key in ('dead_menu_days', 'slow_menu_days', 'slow_menu_below'));
