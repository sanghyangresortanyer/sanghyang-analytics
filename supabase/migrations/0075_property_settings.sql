-- Simple numeric settings per property, edited in Pengaturan by an admin. First keys (owner, 2026-11-20):
-- dead_menu_days = days without a sale after which a menu counts as dead (default 90);
-- slow_menu_max  = most portions in that window for a menu to count as rarely sold (default 6).
create table if not exists public.property_settings (
  property_id uuid not null references public.properties(id) on delete cascade,
  key text not null check (key in ('dead_menu_days', 'slow_menu_max')),
  value numeric not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (property_id, key)
);

alter table public.property_settings enable row level security;

drop policy if exists property_settings_read on public.property_settings;
create policy property_settings_read on public.property_settings for select to authenticated using (property_id = public.auth_property_id());
drop policy if exists property_settings_admin_write on public.property_settings;
create policy property_settings_admin_write on public.property_settings for all to authenticated
  using (property_id = public.auth_property_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (property_id = public.auth_property_id() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

grant select, insert, update, delete on public.property_settings to authenticated, service_role;

-- Saves several settings in one transaction; each row carries the version it was read at (0 = new).
create or replace function public.save_property_settings(p_property uuid, p_rows jsonb)
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
      insert into public.property_settings (property_id, key, value, updated_by)
      values (p_property, r->>'key', (r->>'value')::numeric, auth.uid())
      on conflict (property_id, key) do nothing;
    else
      update public.property_settings
         set value = (r->>'value')::numeric, version = version + 1, updated_at = now(), updated_by = auth.uid()
       where property_id = p_property and key = r->>'key' and version = (r->>'version')::int;
    end if;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'SETTINGS_CONFLICT: %', r->>'key';
    end if;
  end loop;
end;
$$;

revoke all on function public.save_property_settings(uuid, jsonb) from public, anon;
grant execute on function public.save_property_settings(uuid, jsonb) to authenticated;
