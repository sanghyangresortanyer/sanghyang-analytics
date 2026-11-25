-- Same as occupancy_by_night (0083), for chosen guest types only: the Google Ads report counts WALK IN, FIT and OTA
-- (owner, 25 Nov 2026), while the dashboard keeps all guests like the hotel's WA group.
-- A room sold to two of the chosen guest types in one night is one room.
-- Additive and read-only: a new function, nothing else changes. Runs with the caller's rights (RLS applies).
create or replace function public.occupancy_for_segments(p_property uuid, p_from date, p_to date, p_segments text[])
returns table (night date, rooms bigint, lodging numeric, package numeric)
language sql stable as $$
  with fo as (
    select sale_date, outlet_name, art_no, coalesce(room_no, '') as room, coalesce(segment, '') as seg, sales_amount
    from public.weekly_sales_lines
    where property_id = p_property and source = 'fo' and sale_date between p_from and p_to
  ), stays as (
    select sale_date, room from fo
    where outlet_name = 'Front Office' and art_no = '100' and room <> '' and seg = any(p_segments)
    group by sale_date, room, seg
    having sum(sales_amount) > 0
  ), sold as (
    select sale_date, count(distinct room) as rooms from stays group by sale_date
  ), money as (
    select sale_date,
           sum(sales_amount) filter (where seg = any(p_segments) and outlet_name = 'Front Office' and art_no = '100') as lodging,
           sum(sales_amount) filter (where seg = any(p_segments) and outlet_name in ('d''Bistro', 'Sunset Grill') and art_no in ('11', '12') and room <> '') as package
    from fo group by sale_date
  )
  select m.sale_date, coalesce(s.rooms, 0), coalesce(m.lodging, 0), coalesce(m.package, 0)
  from money m left join sold s on s.sale_date = m.sale_date
  order by m.sale_date
$$;

grant execute on function public.occupancy_for_segments(uuid, date, date, text[]) to authenticated;
