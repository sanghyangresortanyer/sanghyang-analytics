-- Bill number of a Penjualan per Artikel line (owner, 25 Nov 2026: split d'Bar discounts automatically). Filled by new
-- uploads; older lines stay null until their month is uploaded again. Additive: a nullable column and a new function.

-- An upload holding weekly_sales_lines would make the ALTER wait while every later query queues behind it; give up instead.
set local lock_timeout = '5s';

alter table public.weekly_sales_lines add column if not exists bill_no text;

-- d'Bar Karaoke & DBC split into DBC ("DBC ...", sometimes "<7351>DBC ...") and the other menus. Discounts and
-- compliments go to the part whose menus are on the same bill. Before this (dbar_split) every compliment was taken from
-- d'Bar & Karaoke and discounts were left apart. "belum" = a bill with menus of both parts, or a line without bill number.
create or replace function public.dbar_parts(p_property uuid, p_from date, p_to date)
returns table (part text, menu numeric, discount numeric, compliment numeric, open_days int)
language sql
stable
set search_path = public
as $$
  with l as (
    select sale_date, nullif(bill_no, '') as bill, sales_amount, coupon_amount,
           case
             when coalesce(category, '') ilike 'disc%' then 'diskon'
             when coupon_amount <> 0 then 'compliment'
             when description ~* '^\s*(<[0-9]+>)?\s*DBC' then 'dbc'
             else 'bar'
           end as kind
    from public.weekly_sales_lines
    where property_id = p_property and source = 'pos' and outlet_name = 'd''Bar Karaoke & DBC'
      and sale_date between p_from and p_to
  ), bills as (
    select sale_date, bill, case when bool_or(kind = 'dbc') and bool_or(kind = 'bar') then 'belum' else min(kind) end as owner
    from l where bill is not null and kind in ('dbc', 'bar') group by sale_date, bill
  ), x as (
    select case when l.kind in ('dbc', 'bar') then l.kind else coalesce(b.owner, 'belum') end as part, l.*
    from l left join bills b on b.sale_date = l.sale_date and b.bill = l.bill
  )
  select x.part,
         coalesce(sum(sales_amount - coupon_amount) filter (where kind in ('dbc', 'bar')), 0),
         coalesce(sum(sales_amount - coupon_amount) filter (where kind = 'diskon'), 0),
         coalesce(sum(sales_amount - coupon_amount) filter (where kind = 'compliment'), 0),
         (count(distinct sale_date) filter (where kind in ('dbc', 'bar') and sales_amount > 0))::int
  from x group by x.part
$$;

revoke execute on function public.dbar_parts(uuid, date, date) from public, anon;
grant execute on function public.dbar_parts(uuid, date, date) to authenticated, service_role;
