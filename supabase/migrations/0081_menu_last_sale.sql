-- Menu paling tidak laku shows how many portions were sold on the last day a menu sold (owner, 24 Nov 2026).
-- Additive and read-only: a new function, nothing else changes. Runs with the caller's rights (RLS applies).
create or replace function public.menu_last_sale(p_property uuid, p_from date, p_to date)
returns table (outlet_name text, art_no text, last_sold date, last_qty numeric)
language sql stable as $$
  with per_day as (
    select outlet_name, art_no, sale_date, sum(qty) as qty
    from public.weekly_sales_lines
    where property_id = p_property and source = 'pos' and art_no is not null and sales_amount > 0
      and sale_date between p_from and p_to
    group by 1, 2, 3
  )
  select distinct on (outlet_name, art_no) outlet_name, art_no, sale_date, qty
  from per_day
  order by outlet_name, art_no, sale_date desc
$$;

grant execute on function public.menu_last_sale(uuid, date, date) to authenticated;
