-- Daily lines behind each weekly upload, so the dashboard can be sliced by any date range.
-- A new upload replaces the lines of its own period (latest file wins per date), while
-- weekly_meetings keeps one F/O Turnover snapshot per upload.

alter table public.weekly_meetings
  add column if not exists journal_filename text,
  add column if not exists revenue_source text check (revenue_source in ('fo', 'journal'));

create table if not exists public.weekly_sales_lines (
  id bigint generated always as identity primary key,
  property_id uuid not null references public.properties(id) on delete cascade,
  meeting_id uuid not null references public.weekly_meetings(id) on delete cascade,
  sale_date date not null,
  outlet_name text not null,
  art_no text,
  description text not null,
  qty numeric not null default 0,
  sales_amount numeric not null default 0,
  coupon_amount numeric not null default 0
);
create index if not exists idx_weekly_sales_lines_property_date on public.weekly_sales_lines (property_id, sale_date);
create index if not exists idx_weekly_sales_lines_meeting on public.weekly_sales_lines (meeting_id);

create table if not exists public.weekly_purchase_lines (
  id bigint generated always as identity primary key,
  property_id uuid not null references public.properties(id) on delete cascade,
  meeting_id uuid not null references public.weekly_meetings(id) on delete cascade,
  receive_date date not null,
  supplier_name text not null,
  art_no text,
  description text not null,
  unit text,
  qty numeric not null default 0,
  amount numeric not null default 0
);
create index if not exists idx_weekly_purchase_lines_property_date on public.weekly_purchase_lines (property_id, receive_date);
create index if not exists idx_weekly_purchase_lines_meeting on public.weekly_purchase_lines (meeting_id);

alter table public.weekly_sales_lines enable row level security;
alter table public.weekly_purchase_lines enable row level security;

drop policy if exists weekly_sales_lines_tenant on public.weekly_sales_lines;
create policy weekly_sales_lines_tenant on public.weekly_sales_lines
  for all to authenticated
  using (property_id = public.auth_property_id())
  with check (property_id = public.auth_property_id());

drop policy if exists weekly_purchase_lines_tenant on public.weekly_purchase_lines;
create policy weekly_purchase_lines_tenant on public.weekly_purchase_lines
  for all to authenticated
  using (property_id = public.auth_property_id())
  with check (property_id = public.auth_property_id());

grant select, insert, update, delete on public.weekly_sales_lines to authenticated, service_role;
grant select, insert, update, delete on public.weekly_purchase_lines to authenticated, service_role;
