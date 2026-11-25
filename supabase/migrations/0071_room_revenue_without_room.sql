-- Room revenue per room: Front Office postings without a room number are kept as one row ('')
-- so the per-room-type total equals the per-segment total.
create or replace function public.room_revenue_by_room(p_property uuid, p_from date, p_to date)
returns table (room_no text, revenue numeric, room_nights numeric, lodging numeric)
language sql stable as $$
  select coalesce(room_no, ''),
         sum(sales_amount),
         sum(case when art_no = '100' then 1 else 0 end),
         sum(case when art_no = '100' then sales_amount else 0 end)
  from public.weekly_sales_lines
  where property_id = p_property and source = 'fo' and outlet_name = 'Front Office'
    and sale_date between p_from and p_to
  group by 1
$$;
