-- Sales category per daily line: the "F/O Artikel" column of Penjualan per Artikel ("Food Sunset Grill",
-- "Beverage Alcoholic d'Bar", "Cigarette d'Bar", …) and the article name of an F/O Journal posting
-- ("Lodging", "B'fast d'Bistro (FIT)"). The dashboard groups it into food, drinks, tobacco and others.
alter table public.weekly_sales_lines
  add column if not exists category text;

-- Roll-ups for the revenue charts, so the page reads a few hundred rows instead of every sales line.
-- SECURITY INVOKER (the default): the caller's row-level security on weekly_sales_lines applies.
-- Revenue = sales less complimentary payments, the way F/O Turnover counts it.
create or replace function public.revenue_by_month(p_property uuid)
returns table (month text, outlet_name text, revenue numeric)
language sql stable as $$
  select to_char(sale_date, 'YYYY-MM'), outlet_name, sum(sales_amount - coupon_amount)
  from public.weekly_sales_lines
  where property_id = p_property
  group by 1, 2
$$;

create or replace function public.revenue_by_day(p_property uuid, p_from date, p_to date)
returns table (sale_date date, outlet_name text, revenue numeric)
language sql stable as $$
  select sale_date, outlet_name, sum(sales_amount - coupon_amount)
  from public.weekly_sales_lines
  where property_id = p_property and sale_date between p_from and p_to
  group by 1, 2
  order by 1, 2
$$;

-- Gross sales per category (before complimentary payments, which have no menu category) plus the
-- complimentary total per outlet in the category "(compliment)".
create or replace function public.revenue_by_category(p_property uuid, p_from date, p_to date)
returns table (outlet_name text, category text, sales numeric, qty numeric)
language sql stable as $$
  select outlet_name, coalesce(category, '(tanpa kategori)'), sum(sales_amount),
         sum(case when sales_amount > 0 and source = 'pos' then qty else 0 end)
  from public.weekly_sales_lines
  where property_id = p_property and sale_date between p_from and p_to and sales_amount <> 0
  group by 1, 2
  union all
  select outlet_name, '(compliment)', -sum(coupon_amount), 0
  from public.weekly_sales_lines
  where property_id = p_property and sale_date between p_from and p_to and coupon_amount <> 0
  group by 1
$$;

grant execute on function public.revenue_by_month(uuid) to authenticated;
grant execute on function public.revenue_by_day(uuid, date, date) to authenticated;
grant execute on function public.revenue_by_category(uuid, date, date) to authenticated;
