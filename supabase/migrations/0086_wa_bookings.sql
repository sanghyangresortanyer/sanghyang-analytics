-- Bookings closed on WhatsApp, imported from CS's file "BOOKING BY WA" (owner, 25 Nov 2026: "cukup kita import saja
-- filenya"). Only the file's row number, check-in, check-out and room numbers are kept: guest names and phone numbers
-- are never read into the database. The file holds every booking, so an import replaces the property's rows.
create table if not exists public.wa_bookings (
  property_id uuid not null references public.properties(id) on delete cascade,
  ord int not null,
  row_no int,
  check_in date not null,
  check_out date not null check (check_out >= check_in),
  rooms text[] not null check (cardinality(rooms) > 0),
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  primary key (property_id, ord)
);

alter table public.wa_bookings enable row level security;

drop policy if exists wa_bookings_read on public.wa_bookings;
create policy wa_bookings_read on public.wa_bookings
  for select to authenticated using (property_id = (select public.auth_property_id()));
drop policy if exists wa_bookings_write on public.wa_bookings;
create policy wa_bookings_write on public.wa_bookings
  for all to authenticated
  using (property_id = (select public.auth_property_id()))
  with check (property_id = (select public.auth_property_id()));

-- Supabase's default ACL hands authenticated every table privilege, TRUNCATE included, and TRUNCATE ignores RLS:
-- revoke all first so authenticated ends with exactly the four row privileges the policies govern.
revoke all on table public.wa_bookings from public, anon, authenticated;
grant select, insert, update, delete on public.wa_bookings to authenticated, service_role;

-- One transaction: the old list is removed and the new one written, or nothing changes.
create or replace function public.replace_wa_bookings(p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
begin
  if public.auth_property_id() is null then
    raise exception 'NO_PROPERTY';
  end if;
  delete from public.wa_bookings where property_id = public.auth_property_id();
  insert into public.wa_bookings (property_id, ord, row_no, check_in, check_out, rooms, imported_by)
  select public.auth_property_id(), (r->>'ord')::int, nullif(r->>'no', '')::int, (r->>'checkIn')::date, (r->>'checkOut')::date,
         array(select jsonb_array_elements_text(r->'rooms')), auth.uid()
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.replace_wa_bookings(jsonb) from public, anon;
grant execute on function public.replace_wa_bookings(jsonb) to authenticated;

-- Every booked night with the room charge VHP posted to that room that night (null: no Lodging posting).
create or replace function public.wa_booking_nights(p_property uuid, p_from date, p_to date)
returns table (ord int, row_no int, check_in date, night date, room text, lodging numeric, segment text)
language sql
stable
set search_path = public
as $$
  with nights as (
    select b.ord, b.row_no, b.check_in, d::date as night, r as room
    from public.wa_bookings b,
         generate_series(b.check_in, b.check_out - 1, interval '1 day') d,
         unnest(b.rooms) r
    where b.property_id = p_property and b.check_out > b.check_in
  ), posted as (
    select sale_date, room_no, segment, sum(sales_amount) as amount
    from public.weekly_sales_lines
    where property_id = p_property and source = 'fo' and outlet_name = 'Front Office' and art_no = '100'
      and sale_date between p_from and p_to
    group by 1, 2, 3
    having sum(sales_amount) > 0
  )
  select n.ord, n.row_no, n.check_in, n.night, n.room, p.amount, p.segment
  from nights n left join posted p on p.sale_date = n.night and p.room_no = n.room
  where n.night between p_from and p_to
  order by n.night, n.room
$$;

revoke execute on function public.wa_booking_nights(uuid, date, date) from public, anon;
grant execute on function public.wa_booking_nights(uuid, date, date) to authenticated, service_role;
