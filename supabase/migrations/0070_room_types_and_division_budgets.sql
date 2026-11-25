-- Room type per room number and monthly purchase budget per division, both edited in Pengaturan.
-- Room types: SRD = Sanghyang Deluxe, SS = Sanghyang Suite, KV = Krakatau Villa, BC = Baduy Condo
-- (confirmed by the owner 2026-11-19). Rooms without a row show as "Belum diatur" (code defaults
-- from VHP Room Revenue Breakdown 1 Nov 2026 cover 19 rooms).
-- Everyone of the property reads; only an admin of that property writes.

create table if not exists public.room_types (
  property_id uuid not null references public.properties(id) on delete cascade,
  room_no text not null,
  room_type text not null check (room_type in ('SRD', 'SS', 'KV', 'BC')),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (property_id, room_no)
);

create table if not exists public.division_budgets (
  property_id uuid not null references public.properties(id) on delete cascade,
  division text not null,
  monthly_budget numeric not null check (monthly_budget >= 0),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (property_id, division)
);

alter table public.room_types enable row level security;
alter table public.division_budgets enable row level security;

drop policy if exists room_types_read on public.room_types;
create policy room_types_read on public.room_types for select to authenticated using (property_id = public.auth_property_id());
drop policy if exists room_types_admin_write on public.room_types;
create policy room_types_admin_write on public.room_types for all to authenticated
  using (property_id = public.auth_property_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (property_id = public.auth_property_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists division_budgets_read on public.division_budgets;
create policy division_budgets_read on public.division_budgets for select to authenticated using (property_id = public.auth_property_id());
drop policy if exists division_budgets_admin_write on public.division_budgets;
create policy division_budgets_admin_write on public.division_budgets for all to authenticated
  using (property_id = public.auth_property_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (property_id = public.auth_property_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

grant select, insert, update, delete on public.room_types to authenticated, service_role;
grant select, insert, update, delete on public.division_budgets to authenticated, service_role;

-- Saves the whole room list in one transaction. Each row carries the version it was read at
-- (0 = no row yet) and its type, or null to clear a saved type. A row changed elsewhere in
-- between aborts the whole save.
create or replace function public.save_room_types(p_property uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  n int;
  v int;
  t text;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v := coalesce((r->>'version')::int, 0);
    t := nullif(r->>'type', '');
    if v = 0 and t is null then
      continue;
    elsif v = 0 then
      insert into public.room_types (property_id, room_no, room_type, updated_by)
      values (p_property, r->>'room', t, auth.uid())
      on conflict (property_id, room_no) do nothing;
    elsif t is null then
      delete from public.room_types where property_id = p_property and room_no = r->>'room' and version = v;
    else
      update public.room_types
         set room_type = t, version = version + 1, updated_at = now(), updated_by = auth.uid()
       where property_id = p_property and room_no = r->>'room' and version = v;
    end if;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'SETTINGS_CONFLICT: %', r->>'room';
    end if;
  end loop;
end;
$$;

create or replace function public.save_division_budgets(p_property uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  n int;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce((r->>'version')::int, 0) = 0 then
      insert into public.division_budgets (property_id, division, monthly_budget, updated_by)
      values (p_property, r->>'division', (r->>'budget')::numeric, auth.uid())
      on conflict (property_id, division) do nothing;
    else
      update public.division_budgets
         set monthly_budget = (r->>'budget')::numeric, version = version + 1, updated_at = now(), updated_by = auth.uid()
       where property_id = p_property and division = r->>'division' and version = (r->>'version')::int;
    end if;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'SETTINGS_CONFLICT: %', r->>'division';
    end if;
  end loop;
end;
$$;

-- Room revenue per room number (Front Office postings with a room), with room nights from Lodging.
create or replace function public.room_revenue_by_room(p_property uuid, p_from date, p_to date)
returns table (room_no text, revenue numeric, room_nights numeric, lodging numeric)
language sql stable as $$
  select room_no,
         sum(sales_amount),
         sum(case when art_no = '100' then 1 else 0 end),
         sum(case when art_no = '100' then sales_amount else 0 end)
  from public.weekly_sales_lines
  where property_id = p_property and source = 'fo' and outlet_name = 'Front Office'
    and room_no is not null and room_no <> '' and sale_date between p_from and p_to
  group by 1
$$;

-- Every room number seen in the F/O Journal, so Pengaturan can list rooms not yet given a type.
create or replace function public.known_rooms(p_property uuid)
returns table (room_no text)
language sql stable as $$
  select distinct room_no from public.weekly_sales_lines
  where property_id = p_property and source = 'fo' and art_no = '100' and room_no is not null and room_no <> ''
  order by 1
$$;

revoke all on function public.save_room_types(uuid, jsonb) from public, anon;
revoke all on function public.save_division_budgets(uuid, jsonb) from public, anon;
grant execute on function public.save_room_types(uuid, jsonb) to authenticated;
grant execute on function public.save_division_budgets(uuid, jsonb) to authenticated;
grant execute on function public.room_revenue_by_room(uuid, date, date) to authenticated;
grant execute on function public.known_rooms(uuid) to authenticated;
