-- Audit Promo fills itself from Instagram posts (owner, 2026-11-24): where an event came from, and "Abaikan".
-- Additive only: the version already in production keeps working.
alter table public.social_promo_events add column if not exists source_post_id text;
alter table public.social_promo_events add column if not exists ignored boolean not null default false;
create unique index if not exists uq_social_promo_events_post_menu
  on public.social_promo_events (property_id, source_post_id, outlet_name, lower(menu_keyword))
  where source_post_id is not null;

-- Menu names of the outlet tills since a date (Audit Promo matches post texts with them). RLS applies (invoker).
create or replace function public.menu_names(p_property uuid, p_from date)
returns table (outlet_name text, description text)
language sql stable as $$
  select outlet_name, description from public.weekly_sales_lines
  where property_id = p_property and sale_date >= p_from and source <> 'fo' and sales_amount > 0
  group by 1, 2 order by 1, 2
$$;
grant execute on function public.menu_names(uuid, date) to authenticated;
