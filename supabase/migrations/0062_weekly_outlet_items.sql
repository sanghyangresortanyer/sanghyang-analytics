-- Migration 0062: Store per-outlet sold items / articles for drill-down analysis
create table if not exists public.weekly_outlet_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.weekly_meetings(id) on delete cascade,
  outlet_name text not null,
  art_no text,
  description text not null,
  total_qty numeric not null default 0,
  total_amount numeric not null default 0
);

create index if not exists idx_weekly_outlet_items_meeting
  on public.weekly_outlet_items (meeting_id, outlet_name);

alter table public.weekly_outlet_items enable row level security;

drop policy if exists weekly_outlet_items_tenant on public.weekly_outlet_items;
create policy weekly_outlet_items_tenant on public.weekly_outlet_items
  for all to authenticated
  using (
    exists (
      select 1 from public.weekly_meetings m
      where m.id = weekly_outlet_items.meeting_id
        and m.property_id = public.auth_property_id()
    )
  )
  with check (
    exists (
      select 1 from public.weekly_meetings m
      where m.id = weekly_outlet_items.meeting_id
        and m.property_id = public.auth_property_id()
    )
  );

grant select, insert, update, delete on public.weekly_outlet_items to authenticated;
grant select, insert, update, delete on public.weekly_outlet_items to service_role;
