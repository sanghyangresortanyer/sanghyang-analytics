-- Monthly revenue target per outlet, editable in Pengaturan instead of in code.
-- Without a row the app uses the targets given by the user on 2026-11-17 (outlet-targets.ts).
-- Everyone of the property reads them (dashboard); only an admin of that property writes them.

create table if not exists public.outlet_targets (
  property_id uuid not null references public.properties(id) on delete cascade,
  outlet text not null,
  monthly_target numeric not null check (monthly_target >= 0),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (property_id, outlet)
);

alter table public.outlet_targets enable row level security;

drop policy if exists outlet_targets_read on public.outlet_targets;
create policy outlet_targets_read on public.outlet_targets
  for select to authenticated
  using (property_id = public.auth_property_id());

drop policy if exists outlet_targets_admin_write on public.outlet_targets;
create policy outlet_targets_admin_write on public.outlet_targets
  for all to authenticated
  using (
    property_id = public.auth_property_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    property_id = public.auth_property_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

grant select, insert, update, delete on public.outlet_targets to authenticated, service_role;

-- Saves every row of the form in one transaction. Each row carries the version it was read at
-- (0 = not in the table yet); a row changed by someone else in between aborts the whole save.
create or replace function public.save_outlet_targets(p_property uuid, p_rows jsonb)
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
      insert into public.outlet_targets (property_id, outlet, monthly_target, updated_by)
      values (p_property, r->>'outlet', (r->>'target')::numeric, auth.uid())
      on conflict (property_id, outlet) do nothing;
    else
      update public.outlet_targets
         set monthly_target = (r->>'target')::numeric,
             version = version + 1,
             updated_at = now(),
             updated_by = auth.uid()
       where property_id = p_property
         and outlet = r->>'outlet'
         and version = (r->>'version')::int;
    end if;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'OUTLET_TARGETS_CONFLICT: %', r->>'outlet';
    end if;
  end loop;
end;
$$;

revoke all on function public.save_outlet_targets(uuid, jsonb) from public, anon;
grant execute on function public.save_outlet_targets(uuid, jsonb) to authenticated;
