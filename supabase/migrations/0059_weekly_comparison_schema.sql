-- Weekly Meeting Comparison Schema (Revenue, Pembelian, Inventory)
-- Enforces tenant isolation via auth_property_id() RLS and OCC via version column.

create table if not exists public.weekly_meetings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  meeting_date date not null,
  period_start date not null,
  period_end date not null,
  title text not null,
  notes text,
  revenue_filename text not null,
  purchase_filename text not null,
  inventory_filename text not null,
  total_revenue numeric not null default 0,
  total_purchase numeric not null default 0,
  total_inventory numeric not null default 0,
  purchase_to_revenue_pct numeric not null default 0,
  inventory_to_revenue_ratio numeric not null default 0,
  has_outlet_inventory boolean not null default false,
  version integer not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_meetings_period_check check (period_end >= period_start)
);

create index if not exists idx_weekly_meetings_property_date
  on public.weekly_meetings (property_id, meeting_date desc, period_end desc);

create table if not exists public.weekly_outlet_metrics (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.weekly_meetings(id) on delete cascade,
  outlet_name text not null,
  revenue_amount numeric not null default 0,
  revenue_qty numeric not null default 0,
  revenue_share_pct numeric not null default 0,
  inventory_amount numeric
);

create index if not exists idx_weekly_outlet_metrics_meeting
  on public.weekly_outlet_metrics (meeting_id);

create table if not exists public.weekly_purchase_suppliers (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.weekly_meetings(id) on delete cascade,
  supplier_name text not null,
  purchase_amount numeric not null default 0,
  line_count integer not null default 0
);

create index if not exists idx_weekly_purchase_suppliers_meeting
  on public.weekly_purchase_suppliers (meeting_id);

create table if not exists public.weekly_purchase_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.weekly_meetings(id) on delete cascade,
  ingredient_code text not null,
  description text not null,
  unit text not null,
  total_qty numeric not null default 0,
  total_amount numeric not null default 0
);

create index if not exists idx_weekly_purchase_items_meeting
  on public.weekly_purchase_items (meeting_id);

create table if not exists public.weekly_inventory_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.weekly_meetings(id) on delete cascade,
  outlet_name text,
  item_code text,
  item_name text not null,
  unit text,
  qty numeric not null default 0,
  unit_price numeric not null default 0,
  total_value numeric not null default 0
);

create index if not exists idx_weekly_inventory_items_meeting
  on public.weekly_inventory_items (meeting_id);

-- RLS Policies
alter table public.weekly_meetings enable row level security;
alter table public.weekly_outlet_metrics enable row level security;
alter table public.weekly_purchase_suppliers enable row level security;
alter table public.weekly_purchase_items enable row level security;
alter table public.weekly_inventory_items enable row level security;

drop policy if exists weekly_meetings_tenant on public.weekly_meetings;
create policy weekly_meetings_tenant on public.weekly_meetings
  for all to authenticated
  using (property_id = auth_property_id())
  with check (property_id = auth_property_id());

drop policy if exists weekly_outlet_metrics_tenant on public.weekly_outlet_metrics;
create policy weekly_outlet_metrics_tenant on public.weekly_outlet_metrics
  for all to authenticated
  using (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ))
  with check (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ));

drop policy if exists weekly_purchase_suppliers_tenant on public.weekly_purchase_suppliers;
create policy weekly_purchase_suppliers_tenant on public.weekly_purchase_suppliers
  for all to authenticated
  using (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ))
  with check (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ));

drop policy if exists weekly_purchase_items_tenant on public.weekly_purchase_items;
create policy weekly_purchase_items_tenant on public.weekly_purchase_items
  for all to authenticated
  using (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ))
  with check (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ));

drop policy if exists weekly_inventory_items_tenant on public.weekly_inventory_items;
create policy weekly_inventory_items_tenant on public.weekly_inventory_items
  for all to authenticated
  using (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ))
  with check (exists (
    select 1 from public.weekly_meetings m
    where m.id = meeting_id and m.property_id = auth_property_id()
  ));
