-- d'Bar Karaoke & DBC is one outlet in VHP. Its menus split it: DBC menus are named "DBC ..." (sold at
-- tables 1–27 and 51–60, never on Thursday, when DBC is closed); the other menus are d'Bar & Karaoke
-- (tables 41–47). Discount lines cannot be tied to either, so they stay apart. Owner approved 2026-11-20;
-- the monthly target stays on the combined outlet.
create or replace function public.dbar_split(p_property uuid, p_from date, p_to date)
returns table (part text, revenue numeric, open_days int)
language sql stable as $$
  select case
           when coalesce(category, '') ilike 'disc%' then 'diskon'
           when upper(description) like 'DBC%' then 'dbc'
           else 'bar'
         end,
         sum(sales_amount - coupon_amount),
         count(distinct sale_date) filter (where sales_amount > 0)::int
  from public.weekly_sales_lines
  where property_id = p_property and source = 'pos' and outlet_name = 'd''Bar Karaoke & DBC'
    and sale_date between p_from and p_to
  group by 1
$$;

grant execute on function public.dbar_split(uuid, date, date) to authenticated;
