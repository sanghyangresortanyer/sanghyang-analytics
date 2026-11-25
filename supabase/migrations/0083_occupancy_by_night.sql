-- Rooms sold, room revenue and package items per night, for OCC and ARR as the hotel reports them (owner, 24-25 Nov 2026).
-- A room is sold when one guest type has a positive Lodging (art 100) total that night: a correction posted on another
-- guest type does not unsell it, a stay reversed to zero does not count. Package = breakfast and drinks (art 11, 12)
-- of d'Bistro and Sunset Grill charged to a room in the F/O Journal.
-- Additive and read-only: a new function, nothing else changes. Runs with the caller's rights (RLS applies).
create or replace function public.occupancy_by_night(p_property uuid, p_from date, p_to date)
returns table (night date, rooms bigint, lodging numeric, package numeric)
language sql stable as $$
  with fo as (
    select sale_date, outlet_name, art_no, coalesce(room_no, '') as room, coalesce(segment, '') as seg, sales_amount
    from public.weekly_sales_lines
    where property_id = p_property and source = 'fo' and sale_date between p_from and p_to
  ), stays as (
    select sale_date, room from fo
    where outlet_name = 'Front Office' and art_no = '100' and room <> ''
    group by sale_date, room, seg
    having sum(sales_amount) > 0
  ), sold as (
    select sale_date, count(distinct room) as rooms from stays group by sale_date
  ), money as (
    select sale_date,
           sum(sales_amount) filter (where outlet_name = 'Front Office' and art_no = '100') as lodging,
           sum(sales_amount) filter (where outlet_name in ('d''Bistro', 'Sunset Grill') and art_no in ('11', '12') and room <> '') as package
    from fo group by sale_date
  )
  select m.sale_date, coalesce(s.rooms, 0), coalesce(m.lodging, 0), coalesce(m.package, 0)
  from money m left join sold s on s.sale_date = m.sale_date
  order by m.sale_date
$$;

grant execute on function public.occupancy_by_night(uuid, date, date) to authenticated;
