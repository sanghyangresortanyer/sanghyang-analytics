-- Nett revenue (before service 10% and tax 10%) per department, straight from F/O Turnover (MTD-Nett).
-- The dashboard shows nett as its main revenue figure (user decision 2026-11-19).
alter table public.weekly_outlet_metrics
  add column if not exists revenue_nett numeric;

-- Booking segment and room of an F/O Journal posting (SegmentCode: FIT, FIT-TA, WALK IN, FIT-CORP,
-- GIT-CORP), for room revenue per segment and, later, per room type.
alter table public.weekly_sales_lines
  add column if not exists segment text,
  add column if not exists room_no text;

-- Room revenue (Front Office articles 100-199) per segment: revenue and room nights (Lodging postings).
create or replace function public.room_revenue_by_segment(p_property uuid, p_from date, p_to date)
returns table (segment text, revenue numeric, room_nights numeric, lodging numeric)
language sql stable as $$
  select coalesce(nullif(segment, ''), '(tidak diisi)'),
         sum(sales_amount),
         sum(case when art_no = '100' then 1 else 0 end),
         sum(case when art_no = '100' then sales_amount else 0 end)
  from public.weekly_sales_lines
  where property_id = p_property and source = 'fo' and outlet_name = 'Front Office'
    and sale_date between p_from and p_to
  group by 1
$$;

-- One row per menu sold at an outlet cashier: quantity since p_from, quantity in the recent window
-- [p_window_from, p_to] and the last day it sold. Feeds the slow-moving and dead menu lists.
create or replace function public.menu_activity(p_property uuid, p_from date, p_window_from date, p_to date)
returns table (outlet_name text, art_no text, description text, total_qty numeric, window_qty numeric, total_sales numeric, last_sold date, first_sold date)
language sql stable as $$
  select outlet_name, art_no, max(description),
         sum(qty),
         sum(case when sale_date >= p_window_from then qty else 0 end),
         sum(sales_amount),
         max(sale_date),
         min(sale_date)
  from public.weekly_sales_lines
  where property_id = p_property and source = 'pos' and art_no is not null and sales_amount > 0
    and sale_date between p_from and p_to
  group by 1, 2
  order by 1, 2
$$;

grant execute on function public.room_revenue_by_segment(uuid, date, date) to authenticated;
grant execute on function public.menu_activity(uuid, date, date, date) to authenticated;
